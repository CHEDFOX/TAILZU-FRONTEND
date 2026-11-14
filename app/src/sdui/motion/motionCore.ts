/**
 * MOTION ON ANY NODE: the value model, compiled (pure SPEC 2.5, block B4). MotionView.tsx draws it.
 *
 * A node's `motion` is data in the animation spec's format-2 value model, so one model covers the bot and the
 * screen: a number, keyframes over a clock, or a spring chasing a target. This file turns that data into flat
 * numbers a worklet can read, and holds every decision that is arithmetic rather than React:
 *
 *   enter / exit   keyframes played over the node's own clock, in seconds
 *   loop           keyframes played round and round
 *   drive          keyframes read against ONE input (a scroll offset, a gesture's value), piecewise
 *   layout         a spring the view settles into when its box moves
 *   shared         an id; the move itself is drawn in JS (sharedCore.ts), because Reanimated's own shared
 *                  transitions are compiled out of this binary
 *
 * Built the way pullBotCore.ts is built, and for the same reason:
 *   - the compiled form is flat arrays of numbers, made once per screen and never written to, so a frame
 *     allocates nothing of ours;
 *   - every function a frame calls is a worklet (Reanimated runs it on the UI thread as it is) and plain
 *     TypeScript (node --test runs it as it is): no imports, nothing captured but numbers.
 *
 * Degrade rule (SPEC 2.0 principle 5): nothing here throws. An unknown field is ignored, a bad number falls back
 * or clamps, and what could not be read is named in `bad` so the handshake can carry it home.
 */
import { LIMITS } from "../kernel/limits.ts";

// ===================================================================== limits

/**
 * The motion numbers from SPEC 5.1, read from the kernel (src/sdui/kernel/limits.ts) now that V1 has wired it
 * in: three of them are the kernel's own, and the two below it are this block's alone. One set of numbers, so
 * the device and the server lint can only disagree by a missed generate.
 */
export const MOTION_LIMITS = {
  /** Keys in one animated value. */
  keyframes: LIMITS.keyframes,
  /** Animated nodes alive at once. */
  nodes: LIMITS.motionNodes,
  /** Shared moves running together. */
  sharedMoves: LIMITS.sharedMoves,
  /** Animated style keys in one node's motion, across every section. */
  tracks: 16,
  /** The longest clock a keyframe track may run, in seconds. A typo of 1e9 is a node that never settles. */
  seconds: 60,
} as const;

/**
 * At most this many springs in one node's motion. Springs are rare; keyframes are the usual way. The view keeps
 * one fixed row of spring values (hooks cannot be counted out at run time), so this is also how long that row is.
 * It lives here rather than beside the view because compiling is what hands out the slots.
 */
export const MAX_SPRINGS = 4;

/**
 * HOW MANY OF A THING ARE ALIVE, against SPEC 5.1's ceiling. Motion counts animated nodes and gestures count
 * live gestures, and both want the same four lines: reserve if there is room, give back on the way out.
 *
 * Reserving is all-or-nothing: a node that asks for three gestures with two left over gets none rather than two,
 * because half a node's gestures is a control that half works, which is worse than one that plainly does not.
 */
export class LiveCount {
  private n = 0;
  private readonly max: number;

  constructor(max: number) {
    this.max = max > 0 ? max : 0;
  }

  /** Reserve `want`. True when there was room, and then `give` must be called with the same number. */
  take(want: number): boolean {
    if (!(want > 0)) return true;
    if (this.n + want > this.max) return false;
    this.n += want;
    return true;
  }

  /** Hand `want` back. Never goes below zero, so a double release cannot make room that does not exist. */
  give(want: number): void {
    const n = this.n - (want > 0 ? want : 0);
    this.n = n > 0 ? n : 0;
  }

  /** How many are alive. For the handshake and for the tests. */
  get live(): number { return this.n; }

  /** Forget everything: a sign-out, safe mode, a test. */
  reset(): void { this.n = 0; }
}

// ===================================================================== style keys

/**
 * THE STYLE KEYS MOTION MAY MOVE, and nothing else.
 *
 * Opacity and the transforms, because those are the keys Reanimated animates on the UI thread without asking the
 * layout to run again. A key outside this list is ignored: a server that animates `width` would be asking every
 * frame to re-lay-out the screen, which is the one thing a phone cannot afford at 120 Hz.
 */
export const MOTION_KEYS = Object.freeze([
  "opacity", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "skewX", "skewY",
] as const);

export type MotionKey = (typeof MOTION_KEYS)[number];

/** Each key's index, so a worklet switches on a number and never compares strings. */
export const K_OPACITY = 0, K_TX = 1, K_TY = 2, K_SCALE = 3, K_SX = 4, K_SY = 5, K_ROT = 6, K_SKX = 7, K_SKY = 8;

const KEY_INDEX: Record<string, number> = {
  opacity: K_OPACITY, translateX: K_TX, translateY: K_TY, scale: K_SCALE,
  scaleX: K_SX, scaleY: K_SY, rotate: K_ROT, skewX: K_SKX, skewY: K_SKY,
};

/**
 * Where a key sits when nothing is animating it: 1 for the ones that multiply (opacity, the scales), 0 for the
 * ones that add (the translates, the turns). A track that says nothing about a key leaves it here.
 */
export function restOf(key: number): number {
  "worklet";
  return key === K_OPACITY || key === K_SCALE || key === K_SX || key === K_SY ? 1 : 0;
}

/** True when the key multiplies rather than adds, which is how two sections compose on one key. */
export function multiplies(key: number): boolean {
  "worklet";
  return key === K_OPACITY || key === K_SCALE || key === K_SX || key === K_SY;
}

// ===================================================================== keyframes

/** A key is seven numbers: time, value, ease, and a cubic ease's four. The same shape botTiles/scene.ts uses. */
export const KSTRIDE = 7;
export const E_LIN = 0, E_IN = 1, E_OUT = 2, E_INOUT = 3, E_STEP = 4, E_CUBIC = 5;

const EASES: Record<string, number> = { lin: E_LIN, in: E_IN, out: E_OUT, inout: E_INOUT, step: E_STEP };

/** A cubic-bezier ease, solved for y at x (bisection: a fixed dozen steps, no allocation). */
export function cubicEase(x1: number, y1: number, x2: number, y2: number, x: number): number {
  "worklet";
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 12; i++) {
    const v = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    if (v < x) lo = u; else hi = u;
    u = (lo + hi) / 2;
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

/** The ease on the key arriving at `at`, applied to a 0..1 walk along the segment. */
export function easeAt(flat: readonly number[], at: number, w: number): number {
  "worklet";
  const kind = flat[at + 2];
  if (kind === E_STEP) return w >= 1 ? 1 : 0;
  if (kind === E_IN) return w * w;
  if (kind === E_OUT) return 1 - (1 - w) * (1 - w);
  if (kind === E_INOUT) return w * w * (3 - 2 * w);
  if (kind === E_CUBIC) return cubicEase(flat[at + 3], flat[at + 4], flat[at + 5], flat[at + 6], w);
  return w;
}

/**
 * One track's value at `clock`. Before the first key it holds the first value, after the last it holds the last,
 * and `loop` wraps the clock back into the span. Exactly botTiles/scene.ts's reading, so a motion and a scene
 * written to the same keys look the same.
 */
export function sampleKeys(flat: readonly number[], n: number, loop: boolean, clock: number): number {
  "worklet";
  if (n <= 0) return 0;
  if (n === 1) return flat[1];
  let at = clock;
  const first = flat[0], last = flat[(n - 1) * KSTRIDE];
  if (loop && last > first) {
    const span = last - first;
    at = first + (((at - first) % span) + span) % span;
  }
  if (at <= first) return flat[1];
  if (at >= last) return flat[(n - 1) * KSTRIDE + 1];
  let i = 1;
  while (i < n && flat[i * KSTRIDE] < at) i++;
  const t0 = flat[(i - 1) * KSTRIDE], v0 = flat[(i - 1) * KSTRIDE + 1];
  const t1 = flat[i * KSTRIDE], v1 = flat[i * KSTRIDE + 1];
  const w = t1 === t0 ? 1 : (at - t0) / (t1 - t0);
  return v0 + (v1 - v0) * easeAt(flat, i * KSTRIDE, w);
}

// ===================================================================== springs

/**
 * A spring's damping coefficient from its damping RATIO, with mass 1: the same conversion botTiles/scene.ts does
 * (`2 * damp * sqrt(k)`), so `damp: 1` is exactly critical, below it bounces and above it crawls in.
 *
 * Reanimated's withSpring takes stiffness and this coefficient, so one number means one thing on both sides.
 */
export function springDamping(k: number, damp: number): number {
  return 2 * damp * Math.sqrt(k > 0 ? k : 0);
}

/** The physics step springs are stepped at, whatever the frame rate. core.ts's, and scene.ts's. */
export const SSTEP = 1 / 120;
const SMAX_FRAME = 1 / 20;

/**
 * Step a damped spring for `dt` seconds. `state` is [position, velocity], changed in place, so a frame allocates
 * nothing. Returns the position. A frame longer than 1/20 s is treated as 1/20 s: a spring that is asked to catch
 * up over a stall overshoots wildly, and a stall is exactly when nobody is looking.
 */
export function stepSpring(state: number[], target: number, k: number, damp: number, dt: number): number {
  "worklet";
  const h = dt > SMAX_FRAME ? SMAX_FRAME : dt > 0 ? dt : 0;
  const steps = Math.min(16, Math.round(h / SSTEP));
  const c = 2 * damp * Math.sqrt(k > 0 ? k : 0);
  let p = state[0], v = state[1];
  for (let q = 0; q < steps; q++) {
    v += (k * (target - p) - c * v) * SSTEP;
    p += v * SSTEP;
  }
  if (!(p === p && v === v && p !== Infinity && p !== -Infinity)) { p = target; v = 0; }
  state[0] = p; state[1] = v;
  return p;
}

// ===================================================================== the compiled shape

/** A track: one style key moved by keyframes, or by a spring to a target. */
export interface Track {
  /** K_OPACITY … K_SKY. */
  key: number;
  /** Flat keys, KSTRIDE apart; empty for a spring. */
  flat: number[];
  n: number;
  loop: boolean;
  /** `drive` only: the ui value this track reads instead of a clock (`ui.scrollY` → `scrollY`). */
  by: string;
  /** A spring: where it goes, where it starts, and its shape. `k` of 0 means "not a spring". */
  springTo: number;
  springFrom: number;
  k: number;
  damp: number;
  /** A spring's place in the view's row of spring values. -1 when this track is keyframes. */
  slot: number;
}

/** What `layout` asks for: the view settles into its new box through a spring. */
export interface LayoutMove {
  k: number;
  damp: number;
  /** Milliseconds, when the server asked for a plain timing instead of a spring. */
  ms: number;
  spring: boolean;
}

export interface Compiled {
  enter: Track[];
  exit: Track[];
  loop: Track[];
  drive: Track[];
  layout: LayoutMove | null;
  /** The shared-element id, drawn as a JS overlay (sharedCore.ts). */
  shared: string;
  /** How many spring values the view must keep for this node (one per spring track). */
  springs: number;
  /** How long each clock runs, in milliseconds. */
  enterMs: number;
  exitMs: number;
  loopMs: number;
  /** What could not be read, so the handshake can carry it home. Never thrown. */
  bad: string[];
}

/** Nothing to do: the node draws at rest. Shared, frozen, so a node with no motion costs nothing. */
export const NO_MOTION: Compiled = Object.freeze({
  enter: [], exit: [], loop: [], drive: [], layout: null, shared: "", springs: 0,
  enterMs: 0, exitMs: 0, loopMs: 0, bad: [],
}) as Compiled;

/** True when this compiled motion would move or measure anything at all. */
export function movesAnything(c: Compiled): boolean {
  return c.enter.length > 0 || c.exit.length > 0 || c.loop.length > 0 || c.drive.length > 0
    || c.layout !== null || c.shared !== "";
}

// ===================================================================== compiling

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A ui value name: `ui.scrollY` or `ui.pill.x`, kept without its `ui.` so the value bus can look it up. */
function uiName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.startsWith("ui.") ? raw.slice(3) : raw;
  if (!s || s.length > 64) return "";
  // Letters, digits and dots only: a name is looked up in a Map, never evaluated, but a name with brackets in it
  // is a server that thinks this is an expression, and silence is worse than nothing.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95;
    if (!ok) return "";
  }
  return s;
}

function newTrack(key: number): Track {
  return { key, flat: [], n: 0, loop: false, by: "", springTo: 0, springFrom: 0, k: 0, damp: 0.8, slot: -1 };
}

/** Read one value — a number, keyframes, or a spring — into a track. Returns null when there was nothing usable. */
function readValue(key: number, raw: unknown, where: string, bad: string[], driven: boolean): Track | null {
  const t = newTrack(key);
  const n = fin(raw);
  if (n !== null) {
    // A plain number: a track with one key, which holds that value for ever.
    t.flat = [0, n, E_LIN, 0, 0, 0, 0];
    t.n = 1;
    return t;
  }
  if (!isRec(raw)) { bad.push(`${where}: a number, keyframes or a spring`); return null; }

  if (raw.spring !== undefined) {
    if (driven) { bad.push(`${where}: a driven value cannot be a spring`); return null; }
    const to = fin(raw.spring);
    if (to === null) { bad.push(`${where}.spring: a number`); return null; }
    t.springTo = to;
    t.springFrom = fin(raw.from) ?? restOf(key);
    t.k = Math.min(10000, Math.max(1, fin(raw.k) ?? 160));
    t.damp = Math.min(4, Math.max(0.05, fin(raw.damp) ?? 0.8));
    return t;
  }

  const list = raw.k;
  if (!Array.isArray(list)) { bad.push(`${where}: a number, keyframes or a spring`); return null; }
  if (list.length < 1 || list.length > MOTION_LIMITS.keyframes) {
    bad.push(`${where}.k: 1 to ${MOTION_LIMITS.keyframes} keys`);
    return null;
  }
  const flat: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const key_ = list[i];
    if (!Array.isArray(key_) || key_.length < 2 || key_.length > 3) { bad.push(`${where}.k[${i}]: [time, value] or [time, value, ease]`); return null; }
    const at = fin(key_[0]), v = fin(key_[1]);
    if (at === null || v === null) { bad.push(`${where}.k[${i}]: numbers`); return null; }
    if (at < last) { bad.push(`${where}.k[${i}]: keys go forward in time`); return null; }
    if (at < 0 || at > MOTION_LIMITS.seconds * (driven ? 1e6 : 1)) {
      // A driven track's clock is the input's own units (pixels of scroll, points of drag), so it is not seconds
      // and the seconds ceiling does not apply; a time clock is seconds and does.
      bad.push(`${where}.k[${i}]: a time between 0 and ${MOTION_LIMITS.seconds}`);
      return null;
    }
    last = at;
    const base = flat.length;
    flat.push(at, v, E_LIN, 0, 0, 0, 0);
    const ease = key_[2];
    if (ease == null) { /* linear */ }
    else if (typeof ease === "string" && ease in EASES) flat[base + 2] = EASES[ease];
    else if (Array.isArray(ease) && ease.length === 4 && ease.every((q) => fin(q) !== null)) {
      flat[base + 2] = E_CUBIC;
      for (let q = 0; q < 4; q++) flat[base + 3 + q] = Number(ease[q]);
      // A cubic's two x's are positions along the segment, so they belong in 0..1. The y's may go outside it —
      // that is how an ease overshoots — but an x outside it is not a curve at all, and Reanimated's own
      // Easing.bezier throws on one, which would take the node out of the screen on its way past. Clamped and
      // named instead: the exit plays a near-enough curve, and the server hears what it sent.
      if (flat[base + 3] < 0 || flat[base + 3] > 1 || flat[base + 5] < 0 || flat[base + 5] > 1) {
        flat[base + 3] = flat[base + 3] < 0 ? 0 : flat[base + 3] > 1 ? 1 : flat[base + 3];
        flat[base + 5] = flat[base + 5] < 0 ? 0 : flat[base + 5] > 1 ? 1 : flat[base + 5];
        bad.push(`${where}.k[${i}]: a cubic ease's x1 and x2 are between 0 and 1`);
      }
    } else bad.push(`${where}.k[${i}]: an ease (${Object.keys(EASES).join(", ")}) or [x1, y1, x2, y2]`);
  }
  t.flat = flat;
  t.n = list.length;
  t.loop = raw.loop === true;
  if (driven) {
    t.by = uiName(raw.by);
    if (!t.by) { bad.push(`${where}.by: the name of a value (ui.scrollY)`); return null; }
  }
  return t;
}

/** The longest clock in a set of tracks, in milliseconds. */
function spanMs(tracks: readonly Track[]): number {
  let s = 0;
  for (const t of tracks) {
    if (t.k > 0) { s = Math.max(s, 600); continue; } // a spring has no end; 600 ms is how long it is kept alive
    if (t.n > 0) s = Math.max(s, t.flat[(t.n - 1) * KSTRIDE]);
  }
  return Math.round(s * 1000);
}

/** One section (`enter`, `exit`, `loop`, `drive`) into tracks. Unknown style keys are ignored, as the rule says. */
function readSection(raw: unknown, where: string, bad: string[], driven: boolean, budget: { n: number }): Track[] {
  if (raw === undefined || raw === null) return [];
  if (!isRec(raw)) { bad.push(`${where}: a map of style keys`); return []; }
  const out: Track[] = [];
  for (const name of Object.keys(raw)) {
    const key = KEY_INDEX[name];
    if (key === undefined) continue; // an unknown prop is ignored (SPEC 2.0 principle 5)
    if (budget.n >= MOTION_LIMITS.tracks) { bad.push(`${where}: at most ${MOTION_LIMITS.tracks} animated keys`); break; }
    const t = readValue(key, raw[name], `${where}.${name}`, bad, driven);
    if (!t) continue;
    budget.n += 1;
    out.push(t);
  }
  return out;
}

/** `layout`: `true`, or `{ spring, k, damp }`, or `{ ms }` for a plain timing. */
function readLayout(raw: unknown, bad: string[]): LayoutMove | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (raw === true) return { k: 180, damp: 0.85, ms: 0, spring: true };
  if (!isRec(raw)) { bad.push("layout: true, or { spring, k, damp }"); return null; }
  const ms = fin(raw.ms);
  if (raw.spring === false && ms !== null) return { k: 0, damp: 0, ms: Math.min(4000, Math.max(0, ms)), spring: false };
  return {
    k: Math.min(10000, Math.max(1, fin(raw.k) ?? 180)),
    damp: Math.min(4, Math.max(0.05, fin(raw.damp) ?? 0.85)),
    ms: 0,
    spring: true,
  };
}

/** A shared-element id: short, plain, and ours to match on. */
function readShared(raw: unknown, bad: string[]): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string" || !raw || raw.length > 64) { bad.push("shared: a short id"); return ""; }
  return raw;
}

/**
 * Compile a node's `motion`. Never throws: whatever could not be read is left out and named in `bad`, and what
 * was read still plays. A node with nothing readable gets NO_MOTION and draws as it always did.
 */
export function compileMotion(raw: unknown): Compiled {
  if (!isRec(raw)) return NO_MOTION;
  const bad: string[] = [];
  const budget = { n: 0 };
  const enter = readSection(raw.enter, "enter", bad, false, budget);
  const exitAll = readSection(raw.exit, "exit", bad, false, budget);
  const loop = readSection(raw.loop, "loop", bad, false, budget);
  const drive = readSection(raw.drive, "drive", bad, true, budget);
  // An exit is played by the view as it is removed, as a run of timings with an end. A spring has no end, so
  // there is nothing to play: it would be dropped silently, which is the kind of quiet nothing this block is
  // meant not to do. Left out and named.
  const exit: Track[] = [];
  for (const t of exitAll) {
    if (t.k > 0) { bad.push("exit: a spring has no end to leave on; use keyframes"); continue; }
    exit.push(t);
  }
  // Every spring in the node gets a place in one row of numbers, so the view keeps one array and no map. The
  // row is a fixed length, so a node past it keeps its keys at rest — said out loud rather than quietly.
  let springs = 0;
  const keepSpring = (t: Track): boolean => {
    if (t.k <= 0) return true;
    if (springs >= MAX_SPRINGS) { bad.push(`at most ${MAX_SPRINGS} springs in one node's motion`); return false; }
    t.slot = springs++;
    return true;
  };
  const enterKept = enter.filter(keepSpring);
  const loopKept = loop.filter(keepSpring);
  const c: Compiled = {
    enter: enterKept, exit, loop: loopKept, drive,
    layout: readLayout(raw.layout, bad),
    shared: readShared(raw.shared, bad),
    springs,
    enterMs: spanMs(enterKept),
    exitMs: spanMs(exit),
    loopMs: spanMs(loopKept),
    bad,
  };
  return movesAnything(c) ? c : (bad.length ? { ...NO_MOTION, bad } : NO_MOTION);
}

// ===================================================================== reduce motion

/** How much motion this launch is allowed: the phone's Reduce Motion, the `sdui.motion` switch, and safe mode. */
export type MotionMode = "on" | "reduced" | "off";

/** The cross-fade a reduced enter or exit becomes, in milliseconds. Short, because it is not meant to be seen. */
export const FADE_MS = 160;

function fadeTrack(from: number, to: number, ms: number): Track {
  const t = newTrack(K_OPACITY);
  const s = ms / 1000;
  t.flat = [0, from, E_LIN, 0, 0, 0, 0, s, to, E_LIN, 0, 0, 0, 0];
  t.n = 2;
  return t;
}

/** A loop stopped where it starts: one key, held for ever. */
function stillTrack(t: Track): Track {
  const s = newTrack(t.key);
  s.flat = [0, t.k > 0 ? t.springFrom : t.n > 0 ? t.flat[1] : restOf(t.key), E_LIN, 0, 0, 0, 0];
  s.n = 1;
  return s;
}

/**
 * The same motion as this launch may play it (SPEC 2.5).
 *
 *   "on"       as written.
 *   "reduced"  enters and exits become a cross-fade, loops stop at their first key, shared moves become a
 *              cross-fade (Shared.tsx reads `shared` being gone), and a layout move lands at once. What follows a
 *              finger or a scroll (`drive`) is kept: it is not the app moving by itself, it is the person's own
 *              hand, and taking it away leaves a control that does not answer.
 *   "off"      nothing moves. Every key rests and the node is simply there.
 */
export function forMode(c: Compiled, mode: MotionMode): Compiled {
  if (mode === "on") return c;
  if (mode === "off") return c.bad.length ? { ...NO_MOTION, bad: c.bad } : NO_MOTION;
  const ms = Math.min(FADE_MS, c.enterMs || FADE_MS);
  // SPEC 2.5: "shared moves become a cross-fade". A node whose only motion was the flight would otherwise get
  // nothing at all and simply appear, which is the one case where reduced motion looks like a missing feature.
  const fadeIn = c.enter.length > 0 || c.shared !== "";
  const enterMs = c.enter.length ? ms : FADE_MS;
  return {
    enter: fadeIn ? [fadeTrack(0, 1, enterMs)] : [],
    exit: c.exit.length ? [fadeTrack(1, 0, Math.min(FADE_MS, c.exitMs || FADE_MS))] : [],
    loop: c.loop.map(stillTrack),
    drive: c.drive,
    layout: null,
    shared: "",
    springs: 0,
    enterMs: fadeIn ? enterMs : 0,
    exitMs: c.exit.length ? Math.min(FADE_MS, c.exitMs || FADE_MS) : 0,
    loopMs: 0,
    bad: c.bad,
  };
}

// ===================================================================== sampling a whole section

/**
 * THE FRAME. Read every track of a section at its clock and fold it into `out`, which is nine numbers, one per
 * style key, held at rest before the first call. Changed in place: no object, no array, no closure per frame.
 *
 * Sections compose: a key two sections both touch adds (translate, turn) or multiplies (opacity, scale). So a
 * driven parallax on a node that also has an entrance does both, rather than one quietly winning.
 */
export function foldSection(out: number[], tracks: readonly Track[], clock: number): void {
  "worklet";
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.k > 0) continue; // springs are stepped by the view, not sampled from a clock
    const v = sampleKeys(t.flat, t.n, t.loop, clock);
    if (multiplies(t.key)) out[t.key] *= v;
    else out[t.key] += v;
  }
}

/**
 * The springs of a section, folded in the same way. `values` is the view's row, one number per spring slot,
 * which Reanimated has already stepped for this frame.
 */
export function foldSprings(out: number[], tracks: readonly Track[], values: readonly number[]): void {
  "worklet";
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.slot < 0 || t.slot >= values.length) continue;
    const v = values[t.slot];
    if (multiplies(t.key)) out[t.key] *= v;
    else out[t.key] += v;
  }
}

/** Nine numbers at rest: what a frame starts from. Made once per node, never per frame. */
export function restValues(): number[] {
  return [1, 0, 0, 1, 1, 1, 0, 0, 0];
}

/** Put the nine back at rest without making a new array. */
export function resetValues(out: number[]): void {
  "worklet";
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 1; out[4] = 1; out[5] = 1; out[6] = 0; out[7] = 0; out[8] = 0;
}

/**
 * A bit per style key this motion ever touches. The view builds its transform list from this once, so the list
 * has the same shape on every frame — Reanimated needs that — and a node that only fades never pays for a
 * rotate string it does not use.
 */
export function keysUsed(c: Compiled): number {
  let m = 0;
  for (const list of [c.enter, c.exit, c.loop, c.drive]) for (const t of list) m |= 1 << t.key;
  return m;
}

/** True when that bit is set. */
export function usesKey(mask: number, key: number): boolean {
  "worklet";
  return (mask & (1 << key)) !== 0;
}
