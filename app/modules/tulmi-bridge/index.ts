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
  setKeyboardLanguage?(code: string): void;
  getKeyboardStatus?(): KeyboardStatus | undefined;
  setDictionary?(json: string): void;
  consumeKeyboardDeepLink?(): string;
  // Mic handoff — see TulmiBridgeModule.swift for the flow.
  writeAppWarmHeartbeat?(): void;
  consumeKeyboardRecordRequest?(): {
    sessionId?: string;
    requestedAtMs?: number;
    hostApp?: string;
  } | undefined;
  completeKeyboardHandoff?(sessionId: string, text: string): void;
  cancelKeyboardHandoff?(sessionId: string): void;
}

export interface KeyboardRecordRequest {
  sessionId: string;
  requestedAtMs: number;
  hostApp: string;
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

/**
 * Push the user's chosen language code into the shared App Group so the
 * keyboard extension can use it for:
 *   - STT bias (transcribe hint → better recognition for non-English speech)
 *   - Refinement language (server prompts the LLM to output in this code)
 *
 * Call after the user selects a language on the onboarding screen or in
 * Settings. Accepts any ISO-639-1 code plus "auto" / "hinglish".
 */
export function setKeyboardLanguage(code: string): void {
  try {
    native?.setKeyboardLanguage?.(code || "auto");
  } catch {
    // best-effort; never block the app
  }
}

/** True when the native bridge is available (a dev/prod build, not Expo Go). */
export function isBridgeAvailable(): boolean {
  return native != null;
}

/**
 * Read (and clear) any deep-link path the keyboard extension left for the app
 * — since keyboard extensions can't call openURL, they drop the target in the
 * shared App Group and the app picks it up here on foreground.
 *
 * Returns null when nothing is pending. Path shapes:
 *   "screen/<screenId>"  → navigate to that SDUI screen
 *   "openSettings"       → open the app's system settings page
 */
export function consumeKeyboardDeepLink(): string | null {
  try {
    const s = native?.consumeKeyboardDeepLink?.();
    return s && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

/**
 * Bump the "app is warm" timestamp in the shared App Group. The keyboard
 * extension consults this on every mic tap to decide whether it can hand off
 * to a suspended main app (fast) or has to open the primer screen (cold).
 * Called on every foreground transition of the main app.
 */
export function writeAppWarmHeartbeat(): void {
  try {
    native?.writeAppWarmHeartbeat?.();
  } catch {
    /* best-effort */
  }
}

/**
 * Read (and clear) any pending record request the keyboard left behind. The
 * main app calls this on foreground; if a request exists, we navigate to the
 * keyboard_record SDUI screen so recording starts immediately.
 * Returns null when nothing is pending.
 */
export function consumeKeyboardRecordRequest(): KeyboardRecordRequest | null {
  try {
    const r = native?.consumeKeyboardRecordRequest?.();
    if (!r || !r.sessionId) return null;
    return {
      sessionId: String(r.sessionId),
      requestedAtMs: Number(r.requestedAtMs) || 0,
      hostApp: String(r.hostApp ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * Finish a mic handoff: write the cleaned text to the App Group and fire a
 * Darwin notification the keyboard extension is listening on. The keyboard
 * observes the notification, reads the text, and inserts it at the cursor.
 * Invoked by the SDUI `completeKeyboardHandoff` action.
 */
export function completeKeyboardHandoff(sessionId: string, text: string): void {
  try {
    native?.completeKeyboardHandoff?.(sessionId, text);
  } catch {
    /* best-effort */
  }
}

/**
 * Abort a handoff (user cancelled the record screen). Fires the same
 * completion notification with an empty result so the keyboard stops waiting.
 */
export function cancelKeyboardHandoff(sessionId: string): void {
  try {
    native?.cancelKeyboardHandoff?.(sessionId);
  } catch {
    /* best-effort */
  }
}
