/**
 * THE LAUNCH: the native splash, then the bot pulls himself up over his bar and is gone, hands and all; his hands come
 * back and wind the bar in to its middle; and the app is there.
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
export const LAUNCH_MS = 1850;

/** How long the curtain takes to fade into the app, ms. */
export const FADE_MS = 220;

/** How many strips the bar is cut into for its pull-in. */
export const STRIPS = 48;

// The beats (t, ms):
//   0      the splash, still · 200 a blink
//   420    he gathers: a small dip, the bar giving under him · 560 he pulls himself up, quick out and slow in, a little
//          sway, his head going up behind the bar · 690 / 740 his gloves let go, left then right, while he is still
//          rising: each slips behind the bar after him, fingers first, and is gone as his head is
//   900    the bar springs back up, free of him, and settles
//   980 / 1030  his gloves come back, left then right, at the bar's two ends: over its top edge from behind it,
//          fingers first, down onto it, gripping
//   1250   they wind the bar in to its middle: each rolls along it, and the bar is gone into them as they go
//   1650   they meet in the middle and are gone, with the last of the bar · 1780 gone · 1850 white

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const K = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const inOut = (x: number) => { const c = clamp(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

/** The bar's drop under him at t, points: a dip as he gathers, harder as he pulls, a kick as each glove lets go, then a spring back past rest. */
export function barDy(t: number): number {
  const gather = K(t, 420, 560), pull = K(t, 560, 900), free = K(t, 900, 1250);
  const sag = t < 560 ? ease(gather) * 1.6 : t < 900 ? 1.6 + Math.sin(pull * Math.PI) * 1.4 : 0;
  const spring = t >= 900 ? -Math.sin(free * Math.PI * 2.5) * (1 - free) * 3.2 : 0;
  const kick = -LET_GO.reduce((k, go) => k + Math.sin(K(t, go, go + 60) * Math.PI), 0) * 1.2;
  return sag + spring + kick;
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

/** When each glove comes back, ms: at the bar's end on its side. */
export const COME_BACK = [980, 1030] as const;
export const COME_BACK_MS = 200;

/** The gloves wind the bar in, from its ends to its middle, ms. */
export const WIND_AT = 1250;
export const MEET_AT = 1650;

/** They meet and are gone with the last of the bar, ms. */
export const MEET_MS = 130;

/** Until the wind, the bar is drawn whole; from it, in strips, so the gloves can take it in. */
export const PINCH_AT = WIND_AT;

/** How far a glove's clip edge comes down as it goes behind the bar, points: from the bar's top edge to its lower one. */
export const SLIP = BAR.y1 * U - BAR_TOP;

/** How far above where it grips a glove comes back from, points: all of it above the bar's top edge, out of sight. */
export const DROP = SPLASH_PT * 0.15;

/** Each glove in the art: its middle and half its width, points (launch.mjs; the hands layer's bounds, each side). */
export const GLOVES = [{ cx: 159 * U, half: 36 * U }, { cx: 385.5 * U, half: 36.5 * U }] as const;

const MID = SPLASH_PT / 2;

/** Where a glove's middle is at t, points across the art: where he held it; then the bar's end; then winding in. */
export function gloveX(side: 0 | 1, t: number): number {
  const { cx, half } = GLOVES[side];
  if (t < LET_GO[side] + LET_GO_MS) return cx;
  const end = side ? BAR.x1 * U - half : BAR.x0 * U + half, meet = side ? MID + half : MID - half;
  return end + (meet - end) * inOut(K(t, WIND_AT, MEET_AT)) + (MID - meet) * ease(K(t, MEET_AT, MEET_AT + MEET_MS));
}

/**
 * A glove at t (side 0 left, 1 right): its grip (a squeeze toward the bar); how far it is above where it grips (dy) and
 * how far the edge it is clipped at has come down (edge): letting go, the edge comes down to the bar's lower edge as the
 * glove goes up into it; coming back, it is over the bar's top edge, sliding down onto the bar from behind it; gx, how far it is from where the art has it; turn, its roll as it winds (degrees); size,
 * 1 until it meets the other; shown. It keeps the size it gripped at the whole way: nothing grows back.
 */
export function glove(side: 0 | 1, t: number): { grip: number; dy: number; edge: number; gx: number; turn: number; size: number; shown: number } {
  const away = ease(K(t, LET_GO[side], LET_GO[side] + LET_GO_MS)), back = ease(K(t, COME_BACK[side], COME_BACK[side] + COME_BACK_MS));
  const w = K(t, WIND_AT, MEET_AT), m = ease(K(t, MEET_AT, MEET_AT + MEET_MS));
  const coming = t >= COME_BACK[side];
  return {
    grip: ease(K(t, 560, 680)) * 0.22,
    dy: coming ? -(1 - back) * DROP : -away * SPLASH_PT * 0.06,
    edge: coming ? 0 : away * SLIP,
    gx: gloveX(side, t) - GLOVES[side].cx,
    turn: Math.sin(w * Math.PI * 6) * Math.sin(w * Math.PI) * 9 * (side ? -1 : 1),
    size: 1 - m,
    shown: m >= 1 ? 0 : 1,
  };
}

/**
 * Strip i of n at t: the bar, taken in by the gloves as they wind. A strip outside the gloves' middles is gone (into
 * them), and when they meet the last of it goes into the middle with them. Before the wind, every strip is where the
 * whole bar is.
 */
export function strip(i: number, n: number, t: number): { dx: number; sx: number; sy: number; shown: number } {
  const w = (BAR.x1 - BAR.x0) * U, x = BAR.x0 * U + w * (i + 0.5) / n;
  if (t < WIND_AT) return { dx: 0, sx: 1, sy: 1, shown: 1 };
  const take = ease(K(t, WIND_AT, WIND_AT + 120));
  const cutL = gloveX(0, t) - GLOVES[0].half * (1 - take), cutR = gloveX(1, t) + GLOVES[1].half * (1 - take);
  const m = ease(K(t, MEET_AT, MEET_AT + MEET_MS));
  return { dx: -(x - MID) * m, sx: 1 - 0.8 * m, sy: 1 - m, shown: x > cutL && x < cutR && m < 1 ? 1 : 0 };
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
