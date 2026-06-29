import { requireNativeModule } from "expo-modules-core";

export interface KeyboardStatus {
  /** The keyboard has run at least once (iOS) / the IME is enabled (Android). */
  enabled: boolean;
  /** iOS: "Allow Full Access" granted. Android: same as enabled. */
  fullAccess: boolean;
  /** iOS: epoch-ms the keyboard last ran (0 if never). */
  lastActiveMs: number;
}

interface TulmiBridgeNative {
  setKeyboardCredentials(baseUrl: string, token: string): void;
  getKeyboardStatus?(): KeyboardStatus | undefined;
  setDictionary?(json: string): void;
}

// The native module exists only in dev/prod builds (not in Expo Go). Resolve it
// lazily and fall back to a no-op so the JS app still runs everywhere.
let native: TulmiBridgeNative | null = null;
try {
  native = requireNativeModule("TulmiBridge") as unknown as TulmiBridgeNative;
} catch {
  native = null;
}

/**
 * Share the app's backend URL + the signed-in user's token with the native
 * keyboard extension so the keyboard reaches the same backend as the app and
 * authenticates as the user.
 *
 *  - iOS: written to the shared App Group `group.com.tulmi.app` (UserDefaults).
 *  - Android: written to the app's `tulmi` SharedPreferences (the IME, same
 *    package, reads them directly).
 *
 * No-op in Expo Go (native module absent). Never throws.
 */
export function setKeyboardCredentials(baseUrl: string, token: string): void {
  try {
    native?.setKeyboardCredentials(baseUrl, token);
  } catch {
    // Bridging is best-effort; never let it break the app.
  }
}

/**
 * The keyboard's current state (enabled + Full Access), read from the shared
 * container. Returns null when the bridge isn't available (Expo Go) so callers
 * can fall back gracefully instead of trapping the user.
 */
export function getKeyboardStatus(): KeyboardStatus | null {
  try {
    const s = native?.getKeyboardStatus?.();
    if (!s) return null;
    return { enabled: !!s.enabled, fullAccess: !!s.fullAccess, lastActiveMs: Number(s.lastActiveMs) || 0 };
  } catch {
    return null;
  }
}

/**
 * Push the user's text-expansion dictionary to the keyboard via the shared
 * container (App Group on iOS / SharedPreferences on Android). The keyboard
 * reads this and expands a typed trigger word into its replacement.
 * `entries` is a list of { word, replacement }.
 */
export function setKeyboardDictionary(entries: { word: string; replacement: string }[]): void {
  try {
    native?.setDictionary?.(JSON.stringify(entries ?? []));
  } catch {
    // best-effort; never block the app
  }
}

/** True when the native bridge is available (a dev/prod build, not Expo Go). */
export function isBridgeAvailable(): boolean {
  return native != null;
}
