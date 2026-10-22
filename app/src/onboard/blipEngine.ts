/**
 * THE DECISIONS BEHIND BLIP, WITH NOTHING DRAWN.
 *
 * BlipHost draws him and owns the animation frame loop; what it draws and when
 * is decided here. This is the part that reads the board (stageBus), keeps him
 * where he stands, and answers each change with the right move: stand there
 * the first time, walk when the next spot is far, hop when it is near, just
 * change pose when it is the same place, ride along when the step scrolls, hold
 * still while the app changes trees, let go when it settles.
 *
 * It touches the outside only through `io`: words, confetti, fades and timers
 * are things it asks for, not things it does. That is what lets
 * blipEngine.test.ts run a whole onboarding (arrive, walk, land, scroll, change
 * pose, be let go) against a scripted clock, with no phone and no Skia.
 *
 * Coordinates are the overlay's own: a spot's rect is relative to its step's
 * scroll content, so a spot's place on screen is the stage's corner (less the
 * overlay's own corner) plus the rect, less how far the step has scrolled.
 */
import { BUBBLE, Blip, anchorsFor, planArrival, walkPose } from "./blipMotion.ts";
import type { Snapshot } from "./stageBus.ts";

/** What he says, and where. `n` changes every time he says something, even the same thing again. */
export interface BubbleSpec {
  n: number;
  text: string;
  big: boolean;
  anchor: "left" | "right";
  /** The left edge for a left-anchored bubble, the right edge (from the window's right) for a right-anchored one. */
  x: number;
  /** True when it was already showing and is only being said again. */
  resay: boolean;
}

export interface EngineIO {
  /** Show these words, or (null) hide the bubble. */
  say(spec: BubbleSpec | null): void;
  /** Where the bubble's top is, for the scroll to move. */
  bubbleY(y: number): void;
  /** Throw confetti from here. */
  confetti(x: number, y: number, h: number): void;
  /** Fade him in (1) or out (0). */
  fade(to: 0 | 1): void;
  /** The paper has been held too long: let go. */
  release(): void;
  /** Run `fn` after `ms`; returns a way to cancel it. */
  later(fn: () => void, ms: number): () => void;
  /** Where the overlay's own corner is in the window. */
  hostOrigin(): { x: number; y: number };
  winW(): number;
  holdMaxMs(): number;
  /** The clock, in ms, that tick() and travel() run on. */
  now(): number;
  /** The wall clock (Date.now), which is what the board stamps a hold with. */
  wall(): number;
}

/** Where the machine thinks he should be, in the overlay's coordinates. */
export interface Target {
  token: number;
  rev: number;
  x: number;
  y: number;
  h: number;
  pose: string;
  say: string;
  bubble: "side" | "corner";
  burst: boolean;
  bubX: number;
  bubY: number;
  anchor: "left" | "right";
}

const FADE_MS = 200;

export class BlipEngine {
  readonly bot: Blip;
  target: Target | null = null;
  /** Where he stands, or is headed: what a new spot is compared with. */
  at: { x: number; y: number; h: number } | null = null;
  placed = false;
  shown = false;
  /** Something changed that needs a new picture even if he is still. */
  dirty = true;
  /** The clock time by which a fade-out has finished, so the loop knows when it may stop. */
  fadingUntil = 0;

  private io: EngineIO;
  private hmax: number;
  private scrollLayer = "";
  private scroll = 0;
  private bubbleOn = false;
  private bubbleN = 0;
  private cancelSnap: (() => void) | null = null;
  private lastFrame = 0;

  constructor(io: EngineIO, opts: { dpr: number; hmax: number; seed?: number }) {
    this.io = io;
    this.hmax = opts.hmax;
    this.bot = new Blip(opts.dpr, opts.seed);
  }

  /** The loop is worth keeping while he is up or still fading. */
  active(now: number): boolean {
    return this.shown || now < this.fadingUntil;
  }

  /** Read the board and answer whatever changed on it. */
  sync(s: Snapshot, now: number): void {
    if (s.mode === "off") {
      if (this.shown) {
        this.shown = false; this.placed = false; this.at = null; this.target = null;
        this.cancelSnap?.(); this.cancelSnap = null;
        this.hideBubble();
        this.io.fade(0);
        this.fadingUntil = now + FADE_MS + 60;
      }
      return;
    }
    this.shown = true;
    // A hold that never ends (the app never reached a tree) must not leave
    // paper over whatever the app is showing instead.
    if (s.mode === "hold" && s.holdSince && this.io.wall() - s.holdSince > this.io.holdMaxMs()) {
      this.io.release();
      return;
    }
    const sp = s.spot, st = s.stage;
    if (s.mode !== "live" || !sp || !sp.rect || !st || !st.origin) return;
    if (this.scrollLayer !== sp.layer) {
      // A different step: its scroll is its own, and he is not moved by it.
      this.scrollLayer = sp.layer;
      this.scroll = s.scroll;
    } else if (s.scroll !== this.scroll) {
      const d = s.scroll - this.scroll;
      this.scroll = s.scroll;
      this.follow(d);
    }
    if (!this.target || this.target.token !== sp.token || this.target.rev !== sp.rev) this.arrive(s);
  }

  /**
   * Move him on to `now`, if a frame is due (about 30 a second at rest, 60
   * while he walks). Returns whether to draw one, and the time it covers.
   */
  advance(now: number, reduced: boolean): { draw: boolean; dt: number } {
    const walking = !!this.bot.tr;
    const due = now - this.lastFrame >= (walking ? 13 : 28);
    if (!(this.shown && this.placed && due)) return { draw: false, dt: 0 };
    this.bot.tick(now);
    const dt = Math.min(.06, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    // Reduced motion draws only when something changed: he is a still.
    const draw = !reduced || walking || this.dirty;
    if (draw) this.dirty = false;
    return { draw, dt };
  }

  dispose(): void {
    this.cancelSnap?.();
    this.cancelSnap = null;
    this.target = null;
  }

  // --- what a change on the board means ---------------------------------------

  private hideBubble(): void {
    if (!this.bubbleOn) return;
    this.bubbleOn = false;
    this.io.say(null);
  }

  private say(t: Target, resay: boolean): void {
    if (!t.say) { this.hideBubble(); return; }
    this.bubbleOn = true;
    this.io.bubbleY(t.bubY);
    this.io.say({
      n: ++this.bubbleN, text: t.say, big: t.bubble === "corner", anchor: t.anchor,
      x: t.anchor === "left" ? t.bubX : this.io.winW() - t.bubX, resay,
    });
  }

  private cheer(t: Target): void {
    this.io.later(() => { if (this.target === t) this.io.confetti(this.bot.x, this.bot.y - t.h * .45, t.h); }, BUBBLE.burstDelayMs);
  }

  /** He has arrived (or changed pose in place): say it, and cheer if asked. */
  private land(t: Target): void {
    if (this.target !== t) return;
    this.say(t, false);
    if (t.burst) this.cheer(t);
  }

  private arrive(s: Snapshot): void {
    const sp = s.spot, st = s.stage;
    if (!sp || !sp.rect || !st || !st.origin) return;
    const a = anchorsFor(sp, sp.rect);
    const host = this.io.hostOrigin();
    const ox = st.origin.x - host.x, oy = st.origin.y - host.y - s.scroll;
    const h = Math.min(this.hmax, sp.h);
    const next: Target = {
      token: sp.token, rev: sp.rev,
      x: a.footX + ox, y: a.footY + oy, h,
      pose: sp.pose, say: sp.say, bubble: sp.bubble, burst: sp.burst,
      bubX: a.bubX + ox, bubY: a.bubY + oy, anchor: a.anchor,
    };
    const prev = this.target;
    this.target = next;
    this.dirty = true;
    this.cancelSnap?.(); this.cancelSnap = null;
    const bot = this.bot;

    if (!this.placed || !this.at) {
      // The first spot ever, or the first since he was let go: he is just there.
      bot.snap(next.x, next.y, h);
      bot.pose = next.pose;
      this.placed = true;
      this.at = { x: next.x, y: next.y, h };
      this.io.fade(1);
      this.land(next);
      return;
    }

    const plan = planArrival({ placed: this.placed, x: this.at.x, y: this.at.y, h: this.at.h }, next, s.reduced);
    this.at = { x: next.x, y: next.y, h };

    if (plan.kind === "repose") {
      // The same place. Only the pose, and perhaps the words, change.
      if (bot.tr) {
        bot.tr.x1 = next.x; bot.tr.y1 = next.y; bot.tr.pose1 = next.pose;
        bot.tr.onland = () => this.land(next);
        return;
      }
      bot.x = next.x; bot.y = next.y;
      bot.pose = next.pose;
      const changed = !prev || prev.say !== next.say || prev.bubble !== next.bubble || prev.token !== next.token;
      if (changed) {
        if (next.say) this.say(next, this.bubbleOn); else this.hideBubble();
        if (next.burst && (!prev || prev.token !== next.token)) this.cheer(next);
      } else if (this.bubbleOn) {
        this.io.bubbleY(next.bubY);
      }
      return;
    }

    this.hideBubble();
    if (plan.kind === "snap") {
      this.cancelSnap = this.io.later(() => {
        this.cancelSnap = null;
        if (this.target !== next) return;
        bot.snap(next.x, next.y, h);
        bot.pose = next.pose;
        this.dirty = true;
        this.land(next);
      }, plan.delayMs);
      return;
    }
    bot.pose = walkPose(bot.pose);
    bot.travel(next.x, next.y, h, next.pose, () => this.land(next), this.io.now());
  }

  /** The step scrolled by `d`: he rides with it, and so do his words. */
  private follow(d: number): void {
    this.bot.shiftY(-d);
    const t = this.target;
    if (t) {
      t.y -= d; t.bubY -= d;
      if (this.at) this.at.y -= d;
      if (this.bubbleOn) this.io.bubbleY(t.bubY);
    }
    this.dirty = true;
  }
}
