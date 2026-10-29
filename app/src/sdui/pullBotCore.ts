/**
 * PULL-A-BOT: PULL TO REFRESH, WITH A BOT IN IT. The physics and the state (PullBot.tsx draws it and wires it to a Screen).
 *
 * Pull the list down at its top and a small bot stands on the list's top edge, revealed feet first in the gap that
 * opens; pull it up at its end and he holds the list up from below, head first. The pull is a rubber band (rubber()).
 * Past the line (threshold) he gets excited and the phone ticks once. Let go past the line: the list springs back (an
 * underdamped spring, one small bounce), he rides it, and at the moment it passes its rest he is thrown off it (a
 * slingshot): up off the top of the screen from the top, down behind the bar under the list from the bottom, spinning,
 * squashed and stretched by his speed, arms and legs flailing, with a small puff of dust at the edge. Then the screen
 * refreshes. Let go early: he slides away with the list and nothing refreshes. Reduce Motion: he is never thrown; he
 * goes back with the list, and the refresh still happens.
 *
 * The numbers and the moves are the approved prototype's (pull-bot/index.html), one for one. Built for the UI thread:
 *   - the whole state is one flat number array (newPullState(), indices S_*), changed in place: nothing is allocated
 *     in a frame;
 *   - every function a frame calls is a worklet (Reanimated runs it on the UI thread as it is) and plain TypeScript
 *     (node --test runs it as it is): no imports, no classes, nothing captured but numbers;
 *   - a fixed 1/240 s step, a frame clamped to 1/20 s, as the prototype steps.
 *
 * The rest (countNew, pillFor, lookOf, configFrom) runs on the JS thread: what is new after a refresh, what the pill
 * says, which bot appears, and the server's knobs made safe.
 */

// ===================================================================== numbers

/** The prototype's values: the app's defaults, each a knob (PullBot.tsx reads them; the server can change any). */
export const PULL_DEFAULTS = {
  /** Pull (px, after the rubber band) that arms the throw. */
  threshold: 60,
  /** The rubber band's size: the list can never go further out than this. */
  rubber: 300,
  /** The list's spring back: rate (rad/s) and damping ratio (1 = no bounce). */
  springRate: 17,
  springDamping: 0.58,
  /** The throw: at least this fast (px/s), or the list's own speed times the boost, whichever is more. */
  throwSpeed: 1750,
  throwBoost: 2.6,
  /** Pulls a flying bot down (px/s²). */
  gravity: 2600,
  /** The drawing's units to px: 0.5 makes him about 58 px tall. */
  scale: 0.5,
} as const;

/** The drawing's units: his feet below the head's centre, his antenna's tip above it. */
export const FEET = 71;
export const ANT = 43;

/** The fixed step, the longest frame simulated, and the most steps in one frame. */
export const STEP = 1 / 240;
export const MAX_FRAME = 0.05;
export const MAX_STEPS = 48;

// ===================================================================== the state array

/** Seconds simulated, and time not stepped yet. */
export const S_T = 0;
export const S_ACC = 1;
/** The pull: on (1), its edge (0 top, 1 bottom), the finger's distance (px, before the band), the list's offset (px), held by a finger, the list's speed. */
export const S_P = 2;
export const S_PE = 3;
export const S_PD = 4;
export const S_PO = 5;
export const S_PH = 6;
export const S_PV = 7;
/** The bot: his phase (BOT_*), his edge, excited (1). */
export const S_B = 8;
export const S_BE = 9;
export const S_EX = 10;
/** Where he is (px, in the overlay's space), his speed, his turn (rad) and its rate. */
export const S_X = 11;
export const S_Y = 12;
export const S_VX = 13;
export const S_VY = 14;
export const S_ROT = 15;
export const S_W = 16;
/** Springs: the value at i, its speed at i + 1. Arms and legs are angles (rad), sq his squash, ant his antenna's lean, look his eyes' height. */
export const S_ARM_L = 17;
export const S_ARM_R = 19;
export const S_LEG_L = 21;
export const S_LEG_R = 23;
export const S_SQ = 25;
export const S_ANT = 27;
export const S_LOOK = 29;
/** Blinking: seconds to the next blink, the blink's time left, how open his eyes are (0 to 1). */
export const S_BLINK_IN = 31;
export const S_BLINK_T = 32;
export const S_BLINK = 33;
/** What the JS thread should hear about after this frame (EV_*). */
export const S_EV = 34;
/** A finger is down on the list. */
export const S_TOUCH = 35;
/** The last frame drawn was the empty one. */
export const S_IDLE = 36;
/** The dust: PUFFS puffs of PUFF_LEN numbers each (x, y, vx, vy, r, life). */
export const S_PUFF = 40;
export const PUFFS = 10;
export const PUFF_LEN = 6;
export const STATE_LEN = S_PUFF + PUFFS * PUFF_LEN;

export const BOT_NONE = 0;
export const BOT_PULL = 1;
export const BOT_RIDE = 2;
export const BOT_FLY = 3;

export const EV_TICK = 1;

/** His faces: eyes (rest), happy (excited at the top), effort (excited at the bottom), whee (flying), wow (riding). */
export const FACE_EYES = 0;
export const FACE_HAPPY = 1;
export const FACE_EFFORT = 2;
export const FACE_WHEE = 3;
export const FACE_WOW = 4;

// ===================================================================== the config and geometry arrays

/** The config array (configFrom): the knobs, Reduce Motion, which edges are on. */
export const C_THRESH = 0;
export const C_RUB = 1;
export const C_RATE = 2;
export const C_DAMP = 3;
export const C_THROW = 4;
export const C_BOOST = 5;
export const C_GRAV = 6;
export const C_SCALE = 7;
export const C_STILL = 8;
export const C_TOP = 9;
export const C_BOTTOM = 10;
export const CONFIG_LEN = 11;

/** The geometry array: the overlay's width, and where the list's viewport starts and ends in it (px). */
export const G_W = 0;
export const G_TOP = 1;
export const G_BOT = 2;

export function newPullState(): number[] {
  const s: number[] = [];
  for (let i = 0; i < STATE_LEN; i++) s.push(0);
  s[S_BLINK] = 1;
  return s;
}

// ===================================================================== the rubber band and the springs

/** The finger's distance `d` to the list's offset: follows the finger at first, then less and less, never past `rub`. */
export function rubber(d: number, rub: number): number {
  "worklet";
  return rub * (1 - 1 / ((Math.max(0, d) * 0.55) / rub + 1));
}

/** rubber's inverse: the finger's distance that gives offset `o`. */
export function unrubber(o: number, rub: number): number {
  "worklet";
  return (rub / 0.55) * (1 / (1 - Math.min(o, rub - 1) / rub) - 1);
}

/** A damped spring at s[i] (its speed at s[i + 1]) toward `to`: rate in rad/s, damp the damping ratio. */
export function spring(s: number[], i: number, to: number, dt: number, rate: number, damp: number): number {
  "worklet";
  s[i + 1] += ((to - s[i]) * rate * rate - 2 * damp * rate * s[i + 1]) * dt;
  s[i] += s[i + 1] * dt;
  return s[i];
}

// ===================================================================== the bot

function makeBot(s: number[], edge: number): void {
  "worklet";
  const arm = edge === 0 ? 0.3 : 2.35;
  s[S_B] = BOT_PULL; s[S_BE] = edge; s[S_EX] = 0;
  s[S_X] = 0; s[S_Y] = 0; s[S_VX] = 0; s[S_VY] = 0; s[S_ROT] = 0; s[S_W] = 0;
  s[S_ARM_L] = arm; s[S_ARM_L + 1] = 0; s[S_ARM_R] = arm; s[S_ARM_R + 1] = 0;
  s[S_LEG_L] = 0.08; s[S_LEG_L + 1] = 0; s[S_LEG_R] = 0.08; s[S_LEG_R + 1] = 0;
  s[S_SQ] = 0; s[S_SQ + 1] = 0; s[S_ANT] = 0; s[S_ANT + 1] = 0; s[S_LOOK] = 0; s[S_LOOK + 1] = 0;
  s[S_BLINK_IN] = 1.4; s[S_BLINK_T] = 0; s[S_BLINK] = 1;
}

/** Throw him off the list at speed `v` (the list's own): up from the top, down from the bottom, with a puff of dust at the edge. */
export function launch(s: number[], c: number[], g: number[], v: number): void {
  "worklet";
  const top = s[S_BE] === 0;
  const speed = Math.max(c[C_THROW], Math.abs(v) * c[C_BOOST]);
  s[S_B] = BOT_FLY;
  s[S_VY] = (top ? -1 : 1) * speed;
  s[S_VX] = (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 170);
  s[S_W] = (s[S_VX] < 0 ? -1 : 1) * (8 + Math.random() * 7);
  const ey = top ? g[G_TOP] : g[G_BOT];
  for (let k = 0; k < PUFFS; k++) {
    const p = S_PUFF + k * PUFF_LEN, side = k < PUFFS / 2 ? -1 : 1;
    s[p] = s[S_X] + side * (4 + Math.random() * 14);
    s[p + 1] = ey;
    s[p + 2] = side * (40 + Math.random() * 90);
    s[p + 3] = (top ? 1 : -1) * (8 + Math.random() * 30);
    s[p + 4] = 2.5 + Math.random() * 3;
    s[p + 5] = 1;
  }
}

function stepBot(s: number[], c: number[], g: number[], dt: number): void {
  "worklet";
  const phase = s[S_B];
  if (phase === BOT_NONE) return;
  const t = s[S_T], top = s[S_BE] === 0, scale = c[C_SCALE], on = s[S_P] === 1;
  if (phase === BOT_PULL || phase === BOT_RIDE) {
    const off = on ? s[S_PO] : 0;
    s[S_X] = g[G_W] / 2;
    s[S_Y] = top ? g[G_TOP] + off - FEET * scale : g[G_BOT] - off + ANT * scale;
    // Riding: the list passes its rest, its fastest moment, and he leaves it. (A spring the server made with no bounce
    // never quite gets there: he goes once it has all but stopped.)
    if (phase === BOT_RIDE && (!on || s[S_PO] <= 0 || (s[S_PO] < 0.5 && Math.abs(s[S_PV]) < 8))) launch(s, c, g, on ? s[S_PV] : 0);
    else if (phase === BOT_PULL && !on) { s[S_B] = BOT_NONE; return; }
  } else {
    s[S_VY] += c[C_GRAV] * dt;
    s[S_X] += s[S_VX] * dt; s[S_Y] += s[S_VY] * dt; s[S_ROT] += s[S_W] * dt;
    if (s[S_Y] < -170 || s[S_Y] > g[G_BOT] + 170 || s[S_X] < -170 || s[S_X] > g[G_W] + 170) { s[S_B] = BOT_NONE; return; }
  }
  const now = s[S_B], still = c[C_STILL] === 1;
  const ex = now === BOT_PULL && on && s[S_PO] >= c[C_THRESH] ? 1 : 0;
  if (ex !== s[S_EX]) {
    s[S_EX] = ex;
    if (ex) { s[S_ANT + 1] += 14; s[S_SQ + 1] += 3.5; s[S_EV] = s[S_EV] | EV_TICK; }
  }
  // Under Reduce Motion the poses hold; nothing wiggles.
  const wig = still ? 0 : 1;
  let aL: number, aR: number, lL: number, lR: number, sq: number;
  if (now === BOT_FLY) {
    aL = 2.2 + 0.7 * Math.sin(t * 31); aR = 2.2 + 0.7 * Math.sin(t * 31 + 2.1);
    lL = 0.55 * Math.sin(t * 27); lR = 0.55 * Math.sin(t * 27 + Math.PI);
    sq = -Math.min(0.22, Math.sqrt(s[S_VX] * s[S_VX] + s[S_VY] * s[S_VY]) / 10000);
  } else if (now === BOT_RIDE) {
    aL = 2.5; aR = 2.5; lL = top ? 0.05 : 0.3; lR = lL; sq = top ? 0.16 : -0.12;
  } else if (top) {
    aL = ex ? 2.15 + 0.35 * wig * Math.sin(t * 17) : 0.3; aR = ex ? 2.15 + 0.35 * wig * Math.sin(t * 17 + Math.PI) : 0.3;
    lL = 0.08; lR = 0.08; sq = ex ? 0.05 * wig * Math.sin(t * 14) : 0;
  } else {
    aL = 2.35; aR = 2.35;
    lL = ex ? 0.45 * wig * Math.sin(t * 15) : 0.12 * wig * Math.sin(t * 2.6);
    lR = ex ? 0.45 * wig * Math.sin(t * 15 + Math.PI) : -0.12 * wig * Math.sin(t * 2.6);
    sq = ex ? 0.04 * wig * Math.sin(t * 19) : 0;
  }
  spring(s, S_ARM_L, aL, dt, 24, 0.45); spring(s, S_ARM_R, aR, dt, 24, 0.45);
  spring(s, S_LEG_L, lL, dt, 22, 0.4); spring(s, S_LEG_R, lR, dt, 22, 0.4);
  spring(s, S_SQ, sq, dt, 26, 0.35);
  spring(s, S_ANT, now === BOT_FLY ? -s[S_W] * 0.05 : 0, dt, 13, 0.16);
  spring(s, S_LOOK, top ? 1.5 : -2.5, dt, 10, 0.8);
  s[S_BLINK_IN] -= dt;
  if (s[S_BLINK_IN] <= 0) { s[S_BLINK_IN] = 2 + Math.random() * 2.5; s[S_BLINK_T] = 0.15; }
  if (s[S_BLINK_T] > 0) { s[S_BLINK_T] -= dt; s[S_BLINK] = Math.abs(Math.cos((1 - s[S_BLINK_T] / 0.15) * Math.PI)); } else s[S_BLINK] = 1;
}

/** Which face he wears now (FACE_*). */
export function faceOf(s: number[]): number {
  "worklet";
  const phase = s[S_B];
  if (phase === BOT_FLY) return FACE_WHEE;
  if (phase === BOT_RIDE) return FACE_WOW;
  if (s[S_EX] === 1) return s[S_BE] === 0 ? FACE_HAPPY : FACE_EFFORT;
  return FACE_EYES;
}

// ===================================================================== the pull

/** A pull starts at `edge` (0 top, 1 bottom) with the finger `d` px out. A bot comes with it, unless one is still about or the screen is refreshing. */
export function startPull(s: number[], c: number[], edge: number, d: number, refreshing: boolean): void {
  "worklet";
  s[S_P] = 1; s[S_PE] = edge; s[S_PD] = d; s[S_PO] = rubber(d, c[C_RUB]); s[S_PH] = 1; s[S_PV] = 0;
  if (!refreshing && s[S_B] === BOT_NONE) makeBot(s, edge);
}

/**
 * A finger came down. If the list is still springing back it is caught where it is, unless the bot is mid-throw (then
 * the throw finishes first).
 */
export function grab(s: number[], c: number[]): void {
  "worklet";
  s[S_TOUCH] = 1;
  if (s[S_P] !== 1 || s[S_PH] === 1) return;
  if (s[S_B] === BOT_RIDE || s[S_B] === BOT_FLY) return;
  s[S_PH] = 1; s[S_PD] = unrubber(Math.max(0, s[S_PO]), c[C_RUB]); s[S_PV] = 0;
}

/**
 * The finger moved `dy` px (down is positive) while the list is scrolled to `scrollY` of `maxScroll` (the scroll view's own
 * offset: past either end while it bounces). Returns 1 while a pull is on, when the scroll view must be held at that edge.
 *
 * At an edge, moving outward starts a pull; one already held follows the finger, and ends when the finger is back where
 * it began (the scroll view takes over from there). Taking over from a scroll view that had begun to bounce on its own
 * (iOS) starts where it had got to, so nothing jumps. The bottom needs a list longer than its viewport: it has no end
 * to hold up otherwise.
 */
export function drag(s: number[], c: number[], dy: number, scrollY: number, maxScroll: number, refreshing: boolean): number {
  "worklet";
  if (s[S_P] === 1 && s[S_PH] === 1) {
    s[S_PD] += s[S_PE] === 0 ? dy : -dy;
    if (s[S_PD] <= 0) {
      s[S_P] = 0; s[S_PO] = 0; s[S_PV] = 0;
      if (s[S_B] === BOT_PULL) s[S_B] = BOT_NONE;
      return 0;
    }
    s[S_PO] = rubber(s[S_PD], c[C_RUB]);
    return 1;
  }
  if (s[S_P] === 1) return 1;   // springing back: it holds its edge until it rests
  if (dy > 0 && c[C_TOP] === 1 && scrollY <= 1) {
    startPull(s, c, 0, Math.max(dy, unrubber(Math.max(0, -scrollY), c[C_RUB])), refreshing);
    return 1;
  }
  if (dy < 0 && c[C_BOTTOM] === 1 && maxScroll > 1 && scrollY >= maxScroll - 1) {
    startPull(s, c, 1, Math.max(-dy, unrubber(Math.max(0, scrollY - maxScroll), c[C_RUB])), refreshing);
    return 1;
  }
  return 0;
}

/**
 * The finger is up. Past the line with the bot out (and no refresh already on): returns 1 for a refresh from the top, 2
 * from the bottom, and the bot rides the list's spring to be thrown (Reduce Motion: he goes back with the list). Else 0.
 */
export function release(s: number[], c: number[], refreshing: boolean): number {
  "worklet";
  s[S_TOUCH] = 0;
  if (s[S_P] !== 1 || s[S_PH] !== 1) return 0;
  s[S_PH] = 0; s[S_PV] = 0;
  if (s[S_B] === BOT_PULL && s[S_PO] >= c[C_THRESH] && !refreshing) {
    if (c[C_STILL] !== 1) s[S_B] = BOT_RIDE;
    return s[S_PE] === 0 ? 1 : 2;
  }
  return 0;
}

// ===================================================================== a frame

/** One fixed step of everything: the list (the finger's band, or its spring back), the bot, the dust. */
export function step(s: number[], c: number[], g: number[], dt: number): void {
  "worklet";
  s[S_T] += dt;
  if (s[S_P] === 1) {
    if (s[S_PH] === 1) {
      const prev = s[S_PO];
      s[S_PO] = rubber(s[S_PD], c[C_RUB]);
      s[S_PV] = (s[S_PO] - prev) / dt;
    } else {
      const w = c[C_RATE], z = c[C_DAMP];
      s[S_PV] += (-w * w * s[S_PO] - 2 * z * w * s[S_PV]) * dt;
      s[S_PO] += s[S_PV] * dt;
      if (Math.abs(s[S_PO]) < 0.3 && Math.abs(s[S_PV]) < 8 && s[S_B] !== BOT_RIDE) { s[S_P] = 0; s[S_PO] = 0; s[S_PV] = 0; }
    }
  }
  stepBot(s, c, g, dt);
  for (let k = 0; k < PUFFS; k++) {
    const p = S_PUFF + k * PUFF_LEN;
    if (s[p + 5] <= 0) continue;
    s[p + 5] -= dt * 2.4;
    s[p] += s[p + 2] * dt; s[p + 1] += s[p + 3] * dt;
    const drag5 = Math.exp(-5 * dt);
    s[p + 2] *= drag5; s[p + 3] *= drag5;
    s[p + 4] += dt * 14;
    if (s[p + 5] < 0) s[p + 5] = 0;
  }
}

/** A frame of `frameDt` seconds, in fixed steps (the frame clamped, the steps capped, the rest kept for the next frame). */
export function advance(s: number[], c: number[], g: number[], frameDt: number): void {
  "worklet";
  s[S_ACC] += Math.min(MAX_FRAME, Math.max(0, frameDt));
  let n = 0;
  while (s[S_ACC] >= STEP && n < MAX_STEPS) { step(s, c, g, STEP); s[S_ACC] -= STEP; n++; }
}

/** Where the list's content is drawn, relative to its scroll position (px, down is positive). */
export function listOffset(s: number[]): number {
  "worklet";
  if (s[S_P] !== 1) return 0;
  return s[S_PE] === 0 ? s[S_PO] : -s[S_PO];
}

/** Something to draw: a pull, the bot, dust in the air. */
export function busy(s: number[]): boolean {
  "worklet";
  if (s[S_P] === 1 || s[S_B] !== BOT_NONE) return true;
  for (let k = 0; k < PUFFS; k++) if (s[S_PUFF + k * PUFF_LEN + 5] > 0) return true;
  return false;
}

// ===================================================================== the knobs, made safe (JS thread)

export interface PullKnobs {
  threshold: number;
  rubber: number;
  springRate: number;
  springDamping: number;
  throwSpeed: number;
  throwBoost: number;
  gravity: number;
  scale: number;
}

const within = (v: number, lo: number, hi: number, def: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

/**
 * The config array from the knobs: anything not a number takes the default, everything is held to a range where it
 * still works (a line past the rubber band's reach could never be crossed, so it is kept inside it).
 */
export function configFrom(k: Partial<PullKnobs>, o: { still?: boolean; top?: boolean; bottom?: boolean } = {}): number[] {
  const D = PULL_DEFAULTS;
  const rub = within(Number(k.rubber), 80, 1200, D.rubber);
  const c: number[] = [];
  for (let i = 0; i < CONFIG_LEN; i++) c.push(0);
  c[C_THRESH] = Math.min(within(Number(k.threshold), 16, 240, D.threshold), rub * 0.8);
  c[C_RUB] = rub;
  c[C_RATE] = within(Number(k.springRate), 4, 60, D.springRate);
  c[C_DAMP] = within(Number(k.springDamping), 0.1, 1.5, D.springDamping);
  c[C_THROW] = within(Number(k.throwSpeed), 300, 8000, D.throwSpeed);
  c[C_BOOST] = within(Number(k.throwBoost), 0, 8, D.throwBoost);
  c[C_GRAV] = within(Number(k.gravity), 0, 12000, D.gravity);
  c[C_SCALE] = within(Number(k.scale), 0.2, 1.5, D.scale);
  c[C_STILL] = o.still ? 1 : 0;
  c[C_TOP] = o.top ? 1 : 0;
  c[C_BOTTOM] = o.bottom ? 1 : 0;
  return c;
}

// ===================================================================== what is new, and what the pill says (JS thread)

/**
 * HOW MANY ARE NEW: the screen names its list's items (ScreenResponse.pullBot.items, ids the server already has), and
 * after the refresh every id that was not there before is new. Nothing to compare (either side without ids): 0, so the
 * pill says the screen is up to date, which it now is. An item that moved or changed is not new; one that went is not
 * counted at all.
 */
export function countNew(before: unknown, after: unknown): number {
  if (!Array.isArray(before) || !Array.isArray(after)) return 0;
  const had = new Set(before.map(String));
  const seen = new Set<string>();
  for (const id of after) {
    const k = String(id);
    if (!had.has(k)) seen.add(k);
  }
  return seen.size;
}

export type Edge = "top" | "bottom";

/** The pill's words (labels; "{n}" is the count). */
export interface PillWords {
  checking: string;
  fresh: string;
  freshTop: string;
  freshBottom: string;
  upToDate: string;
  failed: string;
}

export interface Pill {
  text: string;
  /** Still checking: the hopping dots. */
  busy: boolean;
  /** Something new: the clay dot. */
  fresh: boolean;
  /** A tap goes to where the new things are (they are at the other end of the list). */
  goTo: Edge | null;
}

/**
 * What the pill says after a pull at `edge`: "Checking" while it checks; then how many are new, and where when they are
 * at the other end ("2 new at the top", which a tap goes to); "You're up to date"; or that it could not check.
 */
export function pillFor(state: "checking" | "failed" | number, edge: Edge, newAt: Edge, w: PillWords): Pill {
  if (state === "checking") return { text: w.checking, busy: true, fresh: false, goTo: null };
  if (state === "failed") return { text: w.failed, busy: false, fresh: false, goTo: null };
  const n = Math.max(0, Math.floor(state));
  if (!n) return { text: w.upToDate, busy: false, fresh: false, goTo: null };
  const fill = (s: string) => s.replace(/\{n\}/g, String(n));
  if (edge === newAt) return { text: fill(w.fresh), busy: false, fresh: true, goTo: null };
  return { text: fill(newAt === "top" ? w.freshTop : w.freshBottom), busy: false, fresh: true, goTo: newAt };
}

// ===================================================================== which bot appears (JS thread)

/** A look: the bot's colours. `accent` is his ears, antenna tip, feet and chest light; `glow` his face; `shine` its halo. */
export interface PullLook {
  shellTop: string;
  shellBottom: string;
  body: string;
  limb: string;
  visor: string;
  glow: string;
  shine: string;
  accent: string;
}

/** The looks this build knows. "x0" is the approved prototype's bot. */
export const PULL_LOOKS: Record<string, PullLook> = {
  x0: {
    shellTop: "#FBF0DE", shellBottom: "#E9D0A8", body: "#E2C59A", limb: "#D6B482", visor: "#1d1c1b",
    glow: "#FFF1D6", shine: "rgba(255,226,180,0.9)", accent: "#C9683F",
  },
  ink: {
    shellTop: "#FFFFFF", shellBottom: "#E4E4E4", body: "#EDEDED", limb: "#CFCFCF", visor: "#0A0A0A",
    glow: "#FFFFFF", shine: "rgba(255,255,255,0.85)", accent: "#0A0A0A",
  },
};

const COLOUR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
const LOOK_KEYS: Array<keyof PullLook> = ["shellTop", "shellBottom", "body", "limb", "visor", "glow", "shine", "accent"];

function over(base: PullLook, spec: unknown): PullLook {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return base;
  const out = { ...base };
  for (const k of LOOK_KEYS) {
    const v = (spec as Record<string, unknown>)[k];
    if (typeof v === "string" && COLOUR.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

/**
 * The look to draw. `avatar` is the screen's (an id, or colours over the default), `knobId` the server's default id
 * (knob pullBot.avatar), `knobLooks` looks the server added by id (knob pullBot.looks: { id: { shellTop, … } }, each over
 * "x0"). An id nobody knows, or a colour that is not one: the prototype's bot.
 */
export function lookOf(avatar: unknown, knobId: string, knobLooks: unknown): PullLook {
  const extra = knobLooks && typeof knobLooks === "object" && !Array.isArray(knobLooks) ? (knobLooks as Record<string, unknown>) : {};
  const byId = (id: string): PullLook | null => {
    if (Object.hasOwn(extra, id)) return over(PULL_LOOKS.x0!, extra[id]);
    return Object.hasOwn(PULL_LOOKS, id) ? PULL_LOOKS[id]! : null;
  };
  const base = byId(knobId) ?? PULL_LOOKS.x0!;
  if (typeof avatar === "string") return byId(avatar) ?? base;
  return over(base, avatar);
}
