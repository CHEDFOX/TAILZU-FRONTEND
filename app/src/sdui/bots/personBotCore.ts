/**
 * A PERSON AS THEIR OWN TINY BOT (PersonBot.tsx), pure: what the node says, how he stands in his box, how he idles, and the one
 * loop every PersonBot on a screen shares. Plain TypeScript on the real engine (botTiles/core.ts), so personBotCore.test.ts runs
 * him in Node.
 *
 * HIS BOX is size x size (32 by default) and its bottom edge is his floor: he stands on it. His world is wider than the box
 * (stageOf: half as wide again, the box in its middle), so his arms never meet a wall in a shrug, and where he looks about is
 * as much to his left as to his right. His height (the engine's S) is 0.76 of the box: every look in the catalog, a top hat or
 * a crown or a star on an antenna, stays inside it, with room for a gesture. No cloth under him, no toys.
 *
 * HOW HE IDLES (PersonIdle). He settles at once into his standing pose (no first frames of him finding his feet), then, after a
 * pause of his own, plays PERSON_IDLE on a loop: he looks about, now and then at you, sways a little (a lean and a head tilt on
 * two slow sines whose speed and phase are his own) and blinks (the engine's blinks, on his seed). Rarely, a small gesture from
 * the catalog (a shrug, a look); never two bots on one loop within GAP seconds of each other (GestureGate). A gesture can leave
 * him a little off his spot: past `drift` of the box he shuffles back to it. All of it is seeded by the person's id and how many
 * of that person are on the screen already (seedOf), so a list never moves in step, the same person in two rows included.
 * Reduce Motion, or `live` false: the standing pose, still.
 *
 * THE LOOP (SharedLoop): one animation frame loop for every PersonBot on a screen. It steps only the ones on screen, and does
 * not run at all with none on screen or the app in the background. A bot whose frame keeps failing leaves the loop (he stays
 * drawn as he was); the others carry on.
 */
import { BotTile, compileLooks, rng, type Avatar, type Moment } from "../../botTiles/core.ts";

/**
 * size / minSize / maxSize: the box (px). scale: his height over the box's side. world: his world's width over the box's.
 * ink: the colour when the node's is not one. every: seconds between his gestures; first: before his first; start: before his
 * idle begins (so bots that appear together are out of step); retry: a gesture the gate held back, tried again in; gap: the
 * least time between two gestures on one loop. drift: off his spot by this share of the box after a gesture, he walks back,
 * at walkSpeed (the engine's: 1 his walk), giving up after walkFor seconds. gestures: the catalog's moments he may play.
 * fps: the loop draws at most this often. PersonBot.tsx reads every, first, gap, gestures and fps from the server's knobs
 * (ui.PersonBot.*), with these as their fallbacks.
 */
export const PERSON = {
  size: 32, minSize: 12, maxSize: 128,
  scale: 0.76, world: 1.5,
  ink: "#0a0a0a",
  every: [16, 36] as [number, number],
  first: [4, 24] as [number, number],
  start: [0, 4] as [number, number],
  retry: [1, 3] as [number, number],
  gap: 2.5,
  drift: 0.1, walkSpeed: 0.6, walkFor: 4,
  gestures: ["shrug", "react.look"],
  fps: 30,
};

/** What the node says (types.ts PersonBotProps), read safely: a size in range, a colour that is one. */
export interface PersonBotSpec {
  seed: string;
  avatar: string;
  color: string;
  size: number;
  live: boolean;
  /** What a screen reader says; "": he is decoration beside the name. */
  label: string;
}

export function readPersonBot(p: Record<string, unknown> | null | undefined): PersonBotSpec {
  const n = Number(p?.size);
  const size = Math.round(Math.min(PERSON.maxSize, Math.max(PERSON.minSize, Number.isFinite(n) && n > 0 ? n : PERSON.size)));
  const c = typeof p?.color === "string" ? p.color.trim() : "";
  return {
    seed: typeof p?.seed === "string" || typeof p?.seed === "number" ? String(p.seed) : "",
    avatar: typeof p?.avatar === "string" ? p.avatar : "",
    color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : PERSON.ink,
    size,
    live: p?.live !== false,
    label: typeof p?.label === "string" ? p.label : "",
  };
}

/**
 * His engine seed: the person's id (FNV-1a, the same on every device) and `salt`, the how-manieth of that person on the screen
 * now (0 for the first), so the same person shown twice still blinks and sways on his own.
 */
export function seedOf(id: string, salt = 0): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  if (salt) h = Math.imul(h ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return h >>> 0 || 1;
}

/**
 * The lowest salt not taken among `inUse` (the salts of that person's bots on screen now): a bot that leaves frees his, and the
 * next one in takes it, so two of the same person never share one.
 */
export function freeSalt(inUse: ReadonlySet<number>): number {
  let s = 0;
  while (inUse.has(s)) s++;
  return s;
}

/** His world for a box of `size`: its width and height, his floor (the box's bottom), his height, and the box's left in it. */
export interface PersonStage { w: number; h: number; floor: number; S: number; boxX: number }

export function stageOf(size: number): PersonStage {
  const w = size * PERSON.world;
  // The engine keeps a floor at least 4 px over its world's bottom: the world is that much taller than the box.
  return { w, h: size + 4, floor: size, S: size * PERSON.scale, boxX: (w - size) / 2 };
}

/**
 * Move him, as he is, so his head is over x: every particle by the same distance, positions and last positions alike, so
 * nothing about how he moves changes. The engine settles a bot a third of the way into his world; a person stands in the middle.
 */
export function standIn(bot: BotTile, x: number): void {
  const dx = x - bot.crown().x;
  if (!Number.isFinite(dx) || Math.abs(dx) < 1e-6) return;
  for (let i = 0; i < bot.n; i++) {
    bot.x[i] = bot.x[i]! + dx;
    bot.px[i] = bot.px[i]! + dx;
  }
}

/** A person's tiny bot in his box: standing in the middle in his resting pose, still (PersonIdle.start lets him live). */
export function personTile(o: { seed: number; color: string; size: number; avatar: Avatar | null }): BotTile {
  const st = stageOf(o.size);
  const bot = new BotTile({ kind: "custom", color: o.color, mood: "idle", seed: o.seed, size: st.S, toys: false, avatar: o.avatar });
  bot.cloth = 0;
  // "stand": between his moments the engine's brain keeps him standing where he is, looking about (never a play, never a wander).
  bot.setAct("stand");
  bot.resize(st.w, st.h, st.floor);
  bot.settle(true);
  standIn(bot, st.w / 2);
  return bot;
}

/**
 * HIS IDLE, as a recipe in the catalog's own language (docs/bots-app.md "Looks and moments"), compiled once by the engine. A loop
 * of 9 s: he looks about (a new spot every 2 to 5 s) and, on half the rounds, at you for a while; he leans and tilts his head on
 * two slow sines. `T + 9*k` is the time since the loop began (T starts again each round, k counts the rounds), so the sines never
 * jump; `rnd` and `rnd2` are his own draws for this play, so no two bots sway alike.
 */
export const PERSON_IDLE = {
  v: 1,
  moments: {
    "person.idle": {
      label: "Idles",
      note: "A person's tiny bot standing in their row: looks about, sways a little, blinks (PersonBot).",
      dur: 9,
      mode: "loop",
      fallback: "settle",
      tracks: [
        { do: "look", target: "around", rate: 0.3 },
        { do: "look", target: "screen", at: 4.2, to: 6.6, chance: 0.5 },
        { do: "lean", v: "0.04*sin((T + 9*k)*(1.05 + 0.4*rnd) + 6.283*rnd2)" },
        { do: "tilt", v: "0.05*sin((T + 9*k)*(0.7 + 0.3*rnd2) + 6.283*rnd)" },
      ],
    },
  },
};

let idleMoment: Moment | null | undefined;
/** PERSON_IDLE compiled (once); null if this engine cannot play it, and he simply stands. */
export function personIdle(): Moment | null {
  if (idleMoment === undefined) idleMoment = compileLooks(PERSON_IDLE).moment("person.idle");
  return idleMoment;
}

/** The screen's say on gestures: at most one every `gap` seconds, whoever asks. */
export class GestureGate {
  gap: number;
  last = -Infinity;
  constructor(gap: number) { this.gap = gap; }
  /** May a gesture start now (seconds, the loop's clock)? Yes takes the turn. */
  take(now: number): boolean {
    if (now - this.last < this.gap) return false;
    this.last = now;
    return true;
  }
}

export interface IdleOptions {
  every: [number, number];
  first: [number, number];
  start: [number, number];
  retry: [number, number];
  /** Off his spot by this many px after a gesture: he walks back. */
  drift: number;
  walkSpeed: number;
  walkFor: number;
}

export function idleOptions(size: number, o: Partial<Omit<IdleOptions, "drift">> = {}): IdleOptions {
  return {
    every: range(o.every, PERSON.every),
    first: range(o.first, PERSON.first),
    start: range(o.start, PERSON.start),
    retry: range(o.retry, PERSON.retry),
    drift: size * PERSON.drift,
    walkSpeed: o.walkSpeed && o.walkSpeed > 0 ? o.walkSpeed : PERSON.walkSpeed,
    walkFor: o.walkFor && o.walkFor > 0 ? o.walkFor : PERSON.walkFor,
  };
}

/** A [lo, hi] of seconds, both finite and lo <= hi; else the default. */
function range(r: unknown, d: [number, number]): [number, number] {
  if (!Array.isArray(r) || r.length < 2) return d;
  const a = Number(r[0]), b = Number(r[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) return d;
  return [a, b];
}

/** One person's tiny bot living: his idle, his rare gestures, back to his spot after one. */
export class PersonIdle {
  bot: BotTile;
  /** His spot: where his head is over when he stands (world px). */
  home: number;
  o: IdleOptions;
  rand: () => number;
  idle: Moment | null;
  live = false;
  /** Seconds before his idle begins, to his next gesture, and on a walk back. */
  wait = 0;
  nextIn = 0;
  walkT = -1;

  constructor(bot: BotTile, home: number, seed: number, o: IdleOptions, idle: Moment | null = personIdle()) {
    this.bot = bot;
    this.home = home;
    this.o = o;
    this.rand = rng((seed ^ 0x6a09e667) >>> 0);
    this.idle = idle;
  }

  pick(r: [number, number]): number {
    return r[0] + this.rand() * (r[1] - r[0]);
  }

  /** He comes alive from his resting pose: the idle after his own pause, his first gesture later. */
  start(): void {
    if (this.live) return;
    this.live = true;
    this.bot.settle(false);
    this.wait = this.pick(this.o.start);
    this.nextIn = this.pick(this.o.first);
    this.walkT = -1;
  }

  /** Still (Reduce Motion, a list that asks for it): whatever he was at stops, and he is in his resting pose on his spot. */
  stop(): void {
    const b = this.bot;
    this.live = false;
    b.stopWalk();
    if (b.mo) b.stopMoment();
    b.settle(true);
    standIn(b, this.home);
  }

  /**
   * dt seconds on (now: the loop's clock, seconds). `gestures`: the catalog's moments this build can play; `gate`: the screen's.
   * Steps him; the caller paints.
   */
  frame(dt: number, now: number, gestures: readonly Moment[], gate: GestureGate): void {
    const b = this.bot;
    if (!this.live) return;
    b.step(dt);
    if (this.walkT >= 0) {
      this.walkT += dt;
      if (b.walking() && this.walkT < this.o.walkFor) return;
      if (b.walking()) b.stopWalk();
      this.walkT = -1;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0 && this.idle) b.playMoment(this.idle, "loop");
      return;
    }
    if (!b.mo) {
      // A gesture is over (or a walk back): off his spot, he walks back to it first; then his idle again.
      if (Math.abs(b.crown().x - this.home) > this.o.drift) {
        b.walkTo(this.home, { speed: this.o.walkSpeed });
        // The engine counts a walk done within a quarter of his height; a person's spot is narrower than that.
        b.steerTol = b.S * 0.05;
        this.walkT = 0;
        return;
      }
      if (this.idle) b.playMoment(this.idle, "loop");
    }
    // A gesture is playing.
    if (b.mo && b.mo !== this.idle) return;
    this.nextIn -= dt;
    if (this.nextIn > 0) return;
    const g = gestures.length ? gestures[Math.floor(this.rand() * gestures.length)]! : null;
    if (g && gate.take(now) && b.playMoment(g, "once")) this.nextIn = this.pick(this.o.every);
    else this.nextIn = g ? this.pick(this.o.retry) : this.pick(this.o.every);
  }
}

// ===================================================================== the one loop

/** What the loop drives: a bot that steps and paints, dt seconds on (now: the loop's clock, in seconds). */
export interface LoopMember {
  frame(dt: number, now: number): void;
}

export interface LoopIO {
  raf(cb: () => void): unknown;
  caf(handle: unknown): void;
  /** Milliseconds. */
  now(): number;
}

/**
 * One animation frame loop for many bots. It runs while the app is in front and at least one member is on screen, steps only
 * those, and draws at most `fps` times a second. A member that throws three frames running is dropped (onDrop says so).
 */
export class SharedLoop {
  io: LoopIO;
  fps: number;
  onDrop: ((member: LoopMember, error: unknown) => void) | null = null;
  members = new Map<LoopMember, { seen: boolean; faults: number }>();
  active = true;
  handle: unknown = null;
  last = 0;

  constructor(io: LoopIO, fps = PERSON.fps) {
    this.io = io;
    this.fps = fps;
  }

  add(m: LoopMember, seen = true): void {
    this.members.set(m, { seen, faults: 0 });
    this.wake();
  }

  remove(m: LoopMember): void {
    this.members.delete(m);
    if (!this.anySeen()) this.sleep();
  }

  /** On screen or not (measured by the caller). */
  setSeen(m: LoopMember, seen: boolean): void {
    const s = this.members.get(m);
    if (!s || s.seen === seen) return;
    s.seen = seen;
    if (seen) this.wake();
    else if (!this.anySeen()) this.sleep();
  }

  /** The app in front (true) or in the background. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.wake();
    else this.sleep();
  }

  running(): boolean {
    return this.handle !== null;
  }

  anySeen(): boolean {
    for (const s of this.members.values()) if (s.seen) return true;
    return false;
  }

  wake(): void {
    if (this.handle !== null || !this.active || !this.anySeen()) return;
    this.last = 0;
    this.handle = this.io.raf(this.tick);
  }

  sleep(): void {
    if (this.handle !== null) this.io.caf(this.handle);
    this.handle = null;
  }

  tick = (): void => {
    this.handle = null;
    if (!this.active || !this.anySeen()) return;
    const now = this.io.now();
    // Drawn at most fps times a second: a frame that comes sooner is skipped (a millisecond's grace for the display's jitter).
    if (this.last && this.fps > 0 && now - this.last < 1000 / this.fps - 1) { this.handle = this.io.raf(this.tick); return; }
    const dt = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    for (const [m, s] of [...this.members]) {
      if (!s.seen) continue;
      try {
        m.frame(dt, now / 1000);
        s.faults = 0;
      } catch (e) {
        if (++s.faults >= 3) { this.members.delete(m); this.onDrop?.(m, e); }
      }
    }
    if (this.handle === null && this.active && this.anySeen()) this.handle = this.io.raf(this.tick);
  };
}
