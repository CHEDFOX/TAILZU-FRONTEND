/**
 * THE LAUNCH: the native splash, then the bot pulls himself up over his bar and is gone, hands and all; his hands come
 * back and grip the bar, and it is pulled in to its middle with them; and the app is there.
 *
 * The native splash (app.config.ts, expo-splash-screen) is the app icon's bot, small, hanging from a piece of its clay
 * bar, centred on white: the Bots app's own paper, so the end of the launch is already the app's ground.
 * LaunchCurtain draws that same picture in the same place from the same art (assets/launch, cut by
 * tools/media/brand/x0-icon/curious-hang/launch.mjs), lifts the native splash from under it, and plays the motion
 * below. It lets go once the motion is over and the app has a screen (SduiApp calls liftLaunch()), whichever is later.
 *
 * Every moving part is a function of t, the ms since the motion began, sampled into keys for Animated.interpolate:
 * the whole motion runs on the native driver, so a busy JavaScript thread during start-up cannot stutter it.
 *
 * Nothing here imports React Native, so the numbers are tested on their own (launchCore.test.ts).
 */

import { FEELER_ART } from "./feelerArt.ts";

/** The ground. The NATIVE splash's colour (app.config.ts), so it is a constant: a server value could only break the join. */
export const GROUND = "#FFFFFF";

/** The splash art's size in points: app.config.ts imageWidth. The art is centred in the window on both. */
export const SPLASH_PT = 136;

/** One art pixel in points (the art is 544 px square, 4x). */
export const U = SPLASH_PT / 544;

/** The bar, in the art's pixels (launch.mjs prints it; the bar layer's own bounds). */
export const BAR = { x0: 48, y0: 138, x1: 495, y1: 195 } as const;

/** The bar's top edge, in points from the art's top: the ledge he goes over. Nothing of him shows above it. */
export const BAR_TOP = BAR.y0 * U + SPLASH_PT * 0.012;

/** Where the gloves grip: the bar's lower edge, as a fraction of the art below BAR_TOP (their squeeze's origin). */
export const GRIP_AT = (BAR.y1 * U - BAR_TOP) / SPLASH_PT;

/** How long the motion lasts, ms: then the window is the app's white. */
export const LAUNCH_MS = 2200;

/** How long the curtain takes to fade into the app, ms. */
export const FADE_MS = 220;

/** How many strips the bar is cut into for its pull-in. */
export const STRIPS = 48;

// The beats (t, ms):
//   0      the splash, still · 200 a blink
//   420    he gathers: a small dip, the bar giving under him · 560 he pulls himself up, quick out and slow in, a little
//          sway, his head going up behind the bar · 690 / 740 his gloves let go, left then right, while he is still
//          rising: each slips behind the bar after him, fingers first, and is gone as his head is
//   900    the bar springs back up, free of him, and settles; half a second with nobody there
//   1400 / 1450  his gloves come back to the bar's middle, side by side: the left in from above, grabbing its top,
//          the right in from below, grabbing its bottom; each squeezes as it lands, and the bar gives
//   1730   the bar's middle pinches · 1810 it is pulled in to its middle, faster and faster, into his gloves there,
//          the two twisting against each other as it goes · 1970 they close on the middle · 2120 gone · 2200 white

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const K = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const out = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const inOut = (x: number) => { const c = clamp(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

/** The bar's drop under him at t, points: a dip as he gathers, harder as he pulls, a kick as each glove lets go, then a spring back past rest. */
export function barDy(t: number): number {
  const gather = K(t, 420, 560), pull = K(t, 560, 900), free = K(t, 900, 1250);
  const sag = t < 560 ? ease(gather) * 1.6 : t < 900 ? 1.6 + Math.sin(pull * Math.PI) * 1.4 : 0;
  const spring = t >= 900 ? -Math.sin(free * Math.PI * 2.5) * (1 - free) * 3.2 : 0;
  const kick = -LET_GO.reduce((k, go) => k + Math.sin(K(t, go, go + 60) * Math.PI), 0) * 1.2;
  // His gloves grabbing it again: the one from above pushes it down a little, the one from below up.
  const grab = COME_BACK.reduce((k, c, side) => k + Math.sin(K(t, c + COME_BACK_MS - 20, c + COME_BACK_MS + 70) * Math.PI) * (side ? -0.9 : 0.9), 0);
  return sag + spring + kick + grab;
}

/** The head at t: how far it has gone up (dy, points, on top of the bar's), its sway (degrees), its squash, the blink. */
export function head(t: number): { dy: number; sway: number; sq: number; shut: number; shown: number } {
  const gather = K(t, 420, 560), pull = K(t, 560, 900);
  const dip = ease(gather) * 3.5 * (1 - ease(K(t, 560, 640)));
  return {
    dy: dip - inOut(pull) * SPLASH_PT * 0.47,
    sway: Math.sin(pull * Math.PI) * -2.5,
    sq: t >= 560 && t < 900 ? 1 - Math.sin(pull * Math.PI) * 0.04 : 1,
    shut: (t > 200 && t < 280) || (t > 600 && t < 660) ? 1 : 0,
    shown: t < 900 ? 1 : 0,
  };
}

/** When each glove lets go, ms: the left, then the right, while his head is still going up behind the bar. */
export const LET_GO = [690, 740] as const;

/** How long a glove takes to slip behind the bar, ms (and to come back from behind it). */
export const LET_GO_MS = 140;

/**
 * When each glove comes back, ms: to the bar's middle, side by side, the left in from above to grip its top (turned over,
 * fingers down its face), the right in from below to grip its bottom.
 */
export const COME_BACK = [1400, 1450] as const;
export const COME_BACK_MS = 200;

/** The bar's middle pinches, ms: until then the bar is drawn whole; from then, in strips. */
export const PINCH_AT = 1730;

/** The bar is pulled in to its middle from SUCK_AT, and gone, gloves and all, at GONE_AT, ms. */
export const SUCK_AT = 1810;
export const GONE_AT = 2120;

/** How far a glove's clip edge comes down as it goes behind the bar, points: from the bar's top edge to its lower one. */
export const SLIP = BAR.y1 * U - BAR_TOP;

/** How far a glove comes in from, points: the left from above the bar, the right from below it. */
export const FROM = SPLASH_PT * 0.25;

/** How far the left glove's clip edge goes up as it comes in from above, points: out of its way. */
export const OPEN = SPLASH_PT * 0.45;

/** The bar's middle, top to bottom, points from the art's top: the left glove is turned over about it. */
export const BAR_MID = (BAR.y0 + BAR.y1) / 2 * U;

/** The last of it, ms: the gloves close on the middle and are gone with the bar. */
export const CLOSE_MS = 150;

/** Each glove in the art: its middle and half its width, points (launch.mjs; the hands layer's bounds, each side). */
export const GLOVES = [{ cx: 159 * U, half: 36 * U }, { cx: 385.5 * U, half: 36.5 * U }] as const;

const MID = SPLASH_PT / 2;

/**
 * How far the bar at x (points across the art) has been pulled in to its middle at t, 0 to 1: the near parts first,
 * each faster as it goes.
 */
export function pulled(x: number, t: number): number {
  const d = Math.min(1, Math.abs(x - MID) / ((BAR.x1 - BAR.x0) * U / 2));
  return Math.pow(K(K(t, SUCK_AT, GONE_AT), d * 0.22, d * 0.22 + 0.78), 2.6);
}

/** Where a glove grips the bar when it comes back, points across the art: the bar's middle, the two side by side. */
export const heldAt = (side: 0 | 1): number => (side ? MID + GLOVES[1].half + 1 : MID - GLOVES[0].half - 1);

/** Where a glove's middle is at t, points across the art: where he held the bar; then the middle; closing on it at the end. */
export function gloveX(side: 0 | 1, t: number): number {
  if (t < COME_BACK[side]) return GLOVES[side].cx;
  const x = heldAt(side);
  return x + (MID - x) * ease(K(t, GONE_AT - CLOSE_MS, GONE_AT));
}

/**
 * A glove at t (side 0 left, 1 right).
 *
 * Holding and letting go: grip, a squeeze toward the bar; dy, how far it has gone up into the bar; edge, how far the edge
 * it is clipped at has come down the bar's face (the fingers going behind it).
 *
 * Coming back, out of sight until then: lift, how far it still is from the bar (the left above it, the right below it),
 * fading in (shown) as it comes, quick out and slow in; flip, -1 for the left, turned over about the bar's middle so it
 * grips the top, fingers down; edge, opened up out of the left's way. Each squeezes as it lands, and the bar gives.
 *
 * Then gx, how far it is from where the art has it; turn, the two twisting against each other as the bar is pulled in to
 * them (degrees); size, 1 until they close on the middle at the end.
 */
export function glove(side: 0 | 1, t: number): {
  grip: number; dy: number; edge: number; lift: number; flip: number; gx: number; turn: number; size: number; shown: number;
} {
  const away = ease(K(t, LET_GO[side], LET_GO[side] + LET_GO_MS));
  const c = COME_BACK[side], landed = c + COME_BACK_MS, back = out(K(t, c, landed));
  const close = ease(K(t, GONE_AT - CLOSE_MS, GONE_AT)), wring = K(t, SUCK_AT, GONE_AT);
  const coming = t >= c, gone = t >= LET_GO[side] + LET_GO_MS;
  return {
    grip: ease(K(t, 560, 680)) * 0.22 + Math.sin(K(t, landed - 30, landed + 110) * Math.PI) * 0.12,
    dy: coming ? 0 : -away * SPLASH_PT * 0.06,
    edge: coming ? (side ? 0 : -OPEN) : away * SLIP,
    lift: coming ? (1 - back) * FROM * (side ? 1 : -1) : 0,
    flip: coming && !side ? -1 : 1,
    gx: gloveX(side, t) - GLOVES[side].cx,
    turn: Math.sin(wring * Math.PI * 2) * (1 - close) * 10 * (side ? 1 : -1),
    size: 1 - close,
    shown: t >= GONE_AT ? 0 : !gone ? 1 : !coming ? 0 : K(t, c, c + COME_BACK_MS * 0.5),
  };
}

/**
 * Strip i of n at t: the middle pinches; then each is pulled toward the bar's middle (the near ones first, each faster as
 * it goes), thinner, stretched along the way it goes, and gone when it gets there.
 */
export function strip(i: number, n: number, t: number): { dx: number; sx: number; sy: number; shown: number } {
  const w = (BAR.x1 - BAR.x0) * U, x = BAR.x0 * U + w * (i + 0.5) / n, d = Math.abs(x - MID) / (w / 2);
  const k = pulled(x, t), near = Math.exp(-d * d * 9);
  return { dx: -(x - MID) * k, sx: 1 + k * 2.2, sy: (1 - ease(K(t, PINCH_AT, SUCK_AT)) * 0.38 * near) * (1 - k * 0.85), shown: k >= 0.995 ? 0 : 1 };
}

/** f sampled every `step` ms from `from` to `to`, for Animated.interpolate (clamped outside). */
export function keys(f: (t: number) => number, from = 0, to = LAUNCH_MS, step = 10): { inputRange: number[]; outputRange: number[] } {
  const inputRange: number[] = [];
  for (let t = from; t < to; t += step) inputRange.push(t);
  inputRange.push(to);
  return { inputRange, outputRange: inputRange.map((t) => +f(t).toFixed(3)) };
}

/** The same, as "<n>deg" for a rotation. */
export function degKeys(f: (t: number) => number, from = 0, to = LAUNCH_MS, step = 10): { inputRange: number[]; outputRange: string[] } {
  const k = keys(f, from, to, step);
  return { inputRange: k.inputRange, outputRange: k.outputRange.map((v) => `${v}deg`) };
}

// --- the feelers ---------------------------------------------------------------------------------------------------

/**
 * BLIP'S FEELERS hang from the top of his head (he hangs upside down, so that is the bottom of the picture) and swing
 * with physics. Each is two links: the first hangs from its root on his head, the second from the first one's end. They
 * are part of the head: inside its clip, they go up behind the bar with it. Each link is a pendulum on a moving pivot, with gravity, a spring toward
 * its rest angle (relative to the head for the first, to the first for the second) and damping:
 *
 *   L a'' = -(g - Ay) sin a + Ax cos a  +  L k (rest - a)  -  L c a'
 *
 * where a is the link's angle as a CSS rotation of it hanging straight down (+ve swings it left) and (Ax, Ay) is its
 * pivot's acceleration (y down: a pivot rising faster makes the link hang heavier, one slowing makes it lighter). The first link's pivot is the root, carried by the head's motion (head(t): its rise, sway and
 * squash, and the bar's dip under him); the second's is the first one's end. Integrated once in 1 ms steps from the
 * rest the splash is drawn in, sampled every 10 ms for the native driver like everything else. The feelers are the
 * icon's own, cut in two and drawn at rest; the geometry and the numbers come from the art's generator (feelerArt.ts).
 */
export interface FeelerAngles { l1: number; l2: number; r1: number; r2: number }

const FA = FEELER_ART;
const FEEL_DT = 1;   // ms

/** Where a point of the head's art (544 px frame) is at t, in points from the art's top left. */
export function headPoint(x: number, y: number, t: number): [number, number] {
  const tt = Math.max(0, t), h = head(tt), bar = barDy(Math.min(tt, PINCH_AT));
  const cx = SPLASH_PT / 2, px = x * U, py = y * U - BAR_TOP + h.dy;   // the head piece's frame: origin at the bar's top, x across the art
  const sy = py * h.sq, a = h.sway * Math.PI / 180;
  return [cx + (px - cx) * Math.cos(a) - sy * Math.sin(a), (px - cx) * Math.sin(a) + sy * Math.cos(a) + BAR_TOP + bar];
}

let feelCache: FeelerAngles[] | null = null;
/**
 * The feelers' turns every 10 ms from 0 to 900 (his head is gone after), in degrees, as the views apply them: each
 * piece's turn about its pivot AWAY FROM ITS DRAWN REST (so 0 is the art as drawn): l1 the left's first piece inside
 * the head, l2 its second piece inside the first; r1, r2 the right's.
 *
 * The springs' rests are worked out so that rest under gravity is the drawn shape: for a piece at angle a,
 * k (r - a) = (g / L) sin a, so r = a + (g / (L k)) sin a.
 */
export function feelerTrack(): FeelerAngles[] {
  if (feelCache) return feelCache;
  const rad = Math.PI / 180, { g, k1, k2, c1, c2 } = FA.phys, out: FeelerAngles[] = [];
  const sides = (["L", "R"] as const).map((s) => {
    const L1 = FA.L1[s] * U, L2 = FA.L2[s] * U, e1 = FA.rest[s].a1 * rad, e2 = FA.rest[s].a2 * rad;
    return {
      root: FA.roots[s], L1, L2, e1, e2,
      rest1: e1 + (g / (L1 * k1)) * Math.sin(e1), rest2: e2 - e1 + (g / (L2 * k2)) * Math.sin(e2),
      a1: e1, v1: 0, a2: e2, v2: 0,
    };
  });
  const dt = FEEL_DT / 1000, h = 1;   // s; the finite-difference step for the root's acceleration, ms
  for (let t = 0; t <= 900; t += FEEL_DT) {
    const sway = head(t).sway * rad;
    for (const S of sides) {
      const p0 = headPoint(S.root[0], S.root[1], t - h), p1 = headPoint(S.root[0], S.root[1], t), p2 = headPoint(S.root[0], S.root[1], t + h);
      const hs = h / 1000, ax = (p2[0] - 2 * p1[0] + p0[0]) / (hs * hs), ay = (p2[1] - 2 * p1[1] + p0[1]) / (hs * hs);
      // the first piece (its world angle a1; its spring's rest rides the head's sway)
      const acc1 = (-(g - ay) * Math.sin(S.a1) + ax * Math.cos(S.a1)) / S.L1 + k1 * (sway + S.rest1 - S.a1) - c1 * S.v1;
      // the first piece's end: the second's pivot, and its acceleration
      const jx = ax + S.L1 * (Math.sin(S.a1) * S.v1 * S.v1 - Math.cos(S.a1) * acc1), jy = ay + S.L1 * (-Math.cos(S.a1) * S.v1 * S.v1 - Math.sin(S.a1) * acc1);
      const acc2 = (-(g - jy) * Math.sin(S.a2) + jx * Math.cos(S.a2)) / S.L2 + k2 * (S.a1 + S.rest2 - S.a2) - c2 * S.v2;
      S.v1 += acc1 * dt; S.a1 += S.v1 * dt; S.v2 += acc2 * dt; S.a2 += S.v2 * dt;
    }
    if (t % 10 === 0) {
      const [L, R] = sides, d = 180 / Math.PI;
      out.push({
        l1: (L.a1 - sway - L.e1) * d, l2: (L.a2 - L.a1 - (L.e2 - L.e1)) * d,
        r1: (R.a1 - sway - R.e1) * d, r2: (R.a2 - R.a1 - (R.e2 - R.e1)) * d,
      });
    }
  }
  feelCache = out;
  return out;
}

/**
 * How much of the feelers shows at t. They hang below his head, so at the top of his climb their tips still trail
 * below the bar when the rest of him is behind it: they fade out over the end of the rise (FEELERS_OUT), before the
 * head goes at 900.
 */
export const FEELERS_OUT = [790, 880] as const;
export function feelersShown(t: number): number { return head(t).shown * (1 - K(t, FEELERS_OUT[0], FEELERS_OUT[1])); }

/** One feeler angle at t (degrees), from the track: the views' keys. */
export function feeler(which: keyof FeelerAngles, t: number): number {
  const tr = feelerTrack(), i = Math.max(0, Math.min(tr.length - 1, Math.round(t / 10)));
  return tr[i][which];
}

// --- the lift -----------------------------------------------------------------------------------------------------

let lifted = false;
const waiting = new Set<() => void>();

/** The app has something to show: the native splash goes (if it is still up) and the curtain lets go. Idempotent. */
export function liftLaunch(): void {
  hideNativeSplash();
  if (lifted) return;
  lifted = true;
  for (const f of Array.from(waiting)) f();
  waiting.clear();
}

/** Calls `f` once, when the launch is lifted (at once if it already has been). Returns the unsubscribe. */
export function onLift(f: () => void): () => void {
  if (lifted) { f(); return () => {}; }
  waiting.add(f);
  return () => { waiting.delete(f); };
}

export const isLifted = (): boolean => lifted;

/** Lift the native splash. index.ts holds it (preventAutoHideAsync); a runtime without the module has none to lift. */
export function hideNativeSplash(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("expo-splash-screen").hideAsync?.()?.catch?.(() => {});
  } catch { /* nothing was holding it */ }
}
