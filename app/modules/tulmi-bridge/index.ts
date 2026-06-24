import { requireNativeModule } from "expo-modules-core";

interface TulmiBridgeNative {
  setKeyboardCredentials(baseUrl: string, token: string): void;
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

/** True when the native bridge is available (a dev/prod build, not Expo Go). */
export function isBridgeAvailable(): boolean {
  return native != null;
}
