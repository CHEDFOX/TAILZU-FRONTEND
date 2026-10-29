/**
 * THE LAUNCH: the native splash, then a second of the bot swinging on its bar, then the app.
 *
 * The native splash (app.config.ts, expo-splash-screen) is the app icon's bot, small, on a piece of its clay bar,
 * centred on the cream ground. LaunchCurtain draws that same picture in the same place, from the same art
 * (assets/launch, cut by tools/media/brand/x0-icon/curious-hang/launch.mjs), lifts the native splash from under it,
 * and swings the bot once. It never holds the app: the moment SduiApp has a screen it calls liftLaunch(), and the
 * curtain fades, wherever the swing has got to.
 *
 * Nothing here imports React Native, so the numbers are tested on their own (launchCore.test.ts).
 */

/** The ground. The NATIVE splash's colour (app.config.ts), so it is a constant: a server value could only break the join. */
export const GROUND = "#F7F3EC";

/** The splash art's size in points: app.config.ts imageWidth. The art is centred in the window on both. */
export const SPLASH_PT = 136;

/** Where the hands hold the bar (the middle of the bar, between the gloves), as a fraction of the art. launch.mjs prints it. */
export const PIVOT: readonly [number, number] = [0.4997, 0.3053];

/** How long the motion lasts, ms. */
export const LAUNCH_MS = 1050;

/** The first part of the motion is the splash itself, still: the join is a held frame, not a cut into movement. */
const HOLD = 0.1;

/**
 * The bot's swing at u (0..1 of LAUNCH_MS), in degrees, clockwise. A push, one swing out, a smaller one back, and
 * still: a damped pendulum that is exactly 0 at both ends.
 */
export function swingDeg(u: number): number {
  if (u <= HOLD || u >= 1) return 0;
  const p = (u - HOLD) / (1 - HOLD);
  const ease = Math.min(1, p / 0.08);                    // a push, not a jolt
  const decay = Math.exp(-3.2 * p) * (1 - p * p);        // dies away, and lands on 0
  return 10 * Math.sin(2 * Math.PI * 1.6 * p) * decay * ease;
}

/** The blink, once it has all but stopped: eyes shut between these two points of u. */
export const BLINK: readonly [number, number] = [0.78, 0.87];

/** swingDeg sampled for Animated.interpolate: inputRange 0..1, outputRange "<n>deg". */
export function swingKeys(n = 48): { inputRange: number[]; outputRange: string[] } {
  const inputRange = Array.from({ length: n + 1 }, (_, i) => i / n);
  return { inputRange, outputRange: inputRange.map((u) => `${+swingDeg(u).toFixed(3)}deg`) };
}

/** How long the curtain takes to fade into the app, ms. */
export const FADE_MS = 220;

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
