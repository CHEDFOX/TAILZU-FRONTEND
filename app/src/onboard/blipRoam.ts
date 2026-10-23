/**
 * BLIP ON THE EDGE OF A CARD: what he does there, in order, round and round.
 *
 * The You tab's task card has him on its top edge instead of inside it. He
 * stands there presenting it, walks along the edge, stops and points down into
 * it, sneaks on (crouched, slow), ducks behind the edge until only his antenna
 * shows, blinking, peeks back over it, bobs, jumps into the card and cheers,
 * waves, jumps back out onto the edge and walks home, and starts again.
 *
 * Nothing here draws. `x` is a fraction of the strip's width; `y` is how far
 * below the card's top edge his feet are, as a fraction of his height (0 is
 * standing on the edge). `behind` hides what is below the edge, so he is
 * behind the card rather than in front of it. Roamer plays it on a Blip;
 * BlipRoam.tsx draws him.
 */
import { walkPose, type Blip } from "./blipMotion.ts";

export type RoamStep =
  /** Stand where he is, in a pose. */
  | { kind: "stand"; pose: string; ms: number }
  /** Walk along the edge to `x`; slowly and crouched when sneaking. */
  | { kind: "walk"; x: number; pose: string; ms?: number; sneak?: boolean }
  /** Jump to `x`, `y`: off the edge, into the card, back. */
  | { kind: "hop"; x: number; y: number; pose: string }
  /** Straight down or up to `y`, behind the edge when `behind`. */
  | { kind: "sink"; y: number; ms: number; pose: string; behind: boolean };

/** Where he starts, and where every round ends. */
export const ROAM_START = 0.16;

/** How far into the card he lands, as a fraction of his height: beside the card's heading. */
export const ROAM_IN_CARD = 0.95;

export const ROAM: readonly RoamStep[] = [
  { kind: "stand", pose: "present", ms: 1800 },
  { kind: "walk", x: 0.5, pose: "pointd" },
  { kind: "stand", pose: "pointd", ms: 1100 },
  { kind: "walk", x: 0.7, pose: "walk", ms: 1900, sneak: true },
  { kind: "sink", y: 0.96, ms: 420, pose: "wait", behind: true },
  { kind: "stand", pose: "wait", ms: 900 },
  { kind: "sink", y: 0.5, ms: 320, pose: "present", behind: true },
  { kind: "stand", pose: "present", ms: 1100 },
  { kind: "sink", y: 0.66, ms: 170, pose: "present", behind: true },
  { kind: "sink", y: 0.48, ms: 170, pose: "present", behind: true },
  { kind: "stand", pose: "present", ms: 500 },
  { kind: "hop", x: 0.86, y: ROAM_IN_CARD, pose: "tada" },
  { kind: "stand", pose: "tada", ms: 1300 },
  { kind: "stand", pose: "wave", ms: 1400 },
  { kind: "hop", x: 0.9, y: 0, pose: "present" },
  { kind: "walk", x: ROAM_START, pose: "present" },
];

/** A fraction of the strip, kept far enough in that he never leaves it. */
export function roamX(f: number, width: number, box: number): number {
  const pad = box / 2 + 4;
  return Math.min(width - pad, Math.max(pad, f * width));
}

/**
 * Plays the round on a Blip, a frame at a time: starts each step when the last
 * is done, slides him down or up for a sink, keeps him crouched while he
 * sneaks, and says when he is behind the card (`behind`). While `busy` (the
 * card working) he finishes where he is going, then stands and thinks.
 */
export class Roamer {
  private i = -1;
  private until = 0;
  private moving = false;
  private sneaking = false;
  private thinking = false;
  private sink: { y0: number; y1: number; t0: number; ms: number } | null = null;
  behind = false;
  private readonly bot: Blip;
  private readonly H: number;
  private readonly edge: number;
  private readonly X: (f: number) => number;
  private readonly onBehind: (on: boolean) => void;

  // No parameter properties: node's strip-only TypeScript (the tests) cannot erase them.
  /** His height, the card's top edge (y), and where a fraction across the strip is (x). */
  constructor(bot: Blip, H: number, edge: number, X: (f: number) => number, onBehind: (on: boolean) => void = () => {}) {
    this.bot = bot; this.H = H; this.edge = edge; this.X = X; this.onBehind = onBehind;
    bot.snap(X(ROAM_START), edge, H);
    bot.pose = "present";
  }

  private hide(on: boolean): void {
    if (on !== this.behind) { this.behind = on; this.onBehind(on); }
  }

  private begin(s: RoamStep, now: number): void {
    const bot = this.bot;
    this.sneaking = false; this.sink = null;
    if (s.kind === "stand") { bot.pose = s.pose; this.until = now + s.ms; return; }
    if (s.kind === "sink") {
      this.hide(s.behind); bot.pose = s.pose;
      this.sink = { y0: bot.y, y1: this.edge + s.y * this.H, t0: now, ms: s.ms };
      this.until = now + s.ms;
      return;
    }
    this.hide(false); this.moving = true;
    const land = () => { this.moving = false; };
    if (s.kind === "walk") {
      this.sneaking = !!s.sneak;
      bot.pose = walkPose(bot.pose);
      bot.travel(this.X(s.x), this.edge, this.H, s.pose, land, now, s.ms ? { ms: s.ms } : {});
    } else {
      bot.travel(this.X(s.x), this.edge + s.y * this.H, this.H, s.pose, land, now, { hop: true });
    }
  }

  /** Advance to the clock `now` (ms). */
  step(now: number, busy = false): void {
    const bot = this.bot;
    if (busy && !this.moving && !this.sink) {
      if (!this.thinking) { this.thinking = true; bot.pose = "think"; }
      this.until = Math.max(this.until, now + 150);
    } else if (this.thinking && !busy) {
      this.thinking = false; bot.pose = "present"; this.until = now + 600;
    }
    if (this.sink) {
      const k = Math.min(1, (now - this.sink.t0) / this.sink.ms), e = k * k * (3 - 2 * k);
      bot.y = this.sink.y0 + (this.sink.y1 - this.sink.y0) * e;
      if (k >= 1) this.sink = null;
    }
    if (!this.moving && !this.sink && now >= this.until && !this.thinking) {
      this.i = (this.i + 1) % ROAM.length;
      this.begin(ROAM[this.i]!, now);
    }
    bot.tick(now);
    // Sneaking: crouched low the whole way, not just before he sets off.
    if (this.sneaking && bot.tr) { bot.sq = .1; bot.sqV = 0; }
  }
}
