/**
 * THE LAUNCH: the native splash, then the bot pulls himself up over his bar and is gone, the bar is pulled in to its
 * middle, and the app is there.
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
export const LAUNCH_MS = 1700;

/** How long the curtain takes to fade into the app, ms. */
export const FADE_MS = 220;

/** How many strips the bar is cut into for its pull-in. */
export const STRIPS = 48;

// The beats (t, ms):
//   0      the splash, still · 200 a blink
//   420    he gathers: a small dip, the bar giving under him · 560 he pulls himself up, quick out and slow in, a little
//          sway, his head going up behind the bar · 840 / 905 his gloves let go, left then right, over the bar's edge
//   900    the bar springs back up, free of him, and settles
//   1150   the bar's middle pinches · 1260 it is pulled in to its middle, faster and faster · 1600 gone · 1700 white

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const K = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const inOut = (x: number) => { const c = clamp(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

/** The bar's drop under him at t, points: a dip as he gathers, harder as he pulls, a kick as each glove lets go, then a spring back past rest. */
export function barDy(t: number): number {
  const gather = K(t, 420, 560), pull = K(t, 560, 900), free = K(t, 900, 1250);
  const sag = t < 560 ? ease(gather) * 1.6 : t < 900 ? 1.6 + Math.sin(pull * Math.PI) * 1.4 : 0;
  const spring = t >= 900 ? -Math.sin(free * Math.PI * 2.5) * (1 - free) * 3.2 : 0;
  const kick = -(Math.sin(K(t, 840, 900) * Math.PI) + Math.sin(K(t, 905, 965) * Math.PI)) * 1.2;
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

/** When each glove lets go, ms: the left, then the right. */
export const LET_GO = [840, 905] as const;

/** A glove at t (side 0 left, 1 right): its grip (a squeeze toward the bar), how far it has flicked up, whether it is still there. */
export function glove(side: 0 | 1, t: number): { grip: number; dy: number; shown: number } {
  const go = LET_GO[side], rel = K(t, go, go + 85);
  return {
    grip: t < go ? ease(K(t, 560, 760)) * 0.22 : 0.22 * (1 - ease(rel * 3)),
    dy: -Math.pow(rel, 1.8) * SPLASH_PT * 0.16,
    shown: rel >= 1 ? 0 : 1,
  };
}

/** The pinch and the pull-in begin, ms: until then the bar is drawn whole. */
export const PINCH_AT = 1150;

/**
 * Strip i of n at t: pulled toward the bar's middle (the near ones first, each faster as it goes), thinner, stretched
 * along the way it goes, and gone when it gets there. Nothing to see doing the pulling, and no turning.
 */
export function strip(i: number, n: number, t: number): { dx: number; sx: number; sy: number; shown: number } {
  const w = (BAR.x1 - BAR.x0) * U, left = BAR.x0 * U, mid = SPLASH_PT / 2;
  const at = left + w * (i + 0.5) / n, dx = at - mid, d = Math.abs(dx) / (w / 2);
  const pinch = K(t, PINCH_AT, 1260), suck = K(t, 1260, 1600);
  const k = Math.pow(K(suck, d * 0.22, d * 0.22 + 0.78), 2.6);
  const near = Math.exp(-d * d * 9);
  return { dx: -dx * k, sx: 1 + k * 2.2, sy: (1 - ease(pinch) * 0.38 * near) * (1 - k * 0.85), shown: k >= 0.995 ? 0 : 1 };
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
