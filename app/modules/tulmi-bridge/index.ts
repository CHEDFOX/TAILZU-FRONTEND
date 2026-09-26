import { requireNativeModule } from "expo-modules-core";

export interface KeyboardStatus {
  /** The keyboard has run at least once (iOS) / the IME is enabled (Android). */
  enabled: boolean;
  /** iOS: "Allow Full Access" granted. Android: same as enabled. */
  fullAccess: boolean;
  /** iOS: epoch-ms the keyboard last ran (0 if never). */
  lastActiveMs: number;
}

/**
 * The Flow Session's numbers and switches, from the server's flags. Every
 * field is optional; an absent one keeps the value the native side always
 * used (shown after each). See FlowTuning in FlowSessionManager.swift.
 */
export interface FlowArmOptions {
  /** How often the liveness heartbeat is stamped. 1000. */
  heartbeatMs?: number;
  /** How recent the last audio buffer must be for a heartbeat. 2000. */
  bufferFreshMs?: number;
  /** Audio kept until the socket opens, in bytes. 96000 (3 s). */
  prerollCapBytes?: number;
  /** Ceiling on one buffered one-shot utterance, in bytes. 3840000 (~2 min). */
  oneShotCapBytes?: number;
  /** After stop, how long to wait for the server's terminal message. 9000. */
  closeTimeoutMs?: number;
  /** Shorter than this is a mis-tap, not speech, in bytes. 3200 (0.1 s). */
  minUtteranceBytes?: number;
  /** Retries of a failed one-shot upload. 1. */
  oneShotRetries?: number;
  /** Wait before each retry. 800. */
  oneShotRetryDelayMs?: number;
  /** The one-shot upload's request timeout. 90000. */
  oneShotTimeoutMs?: number;
  /** Duck other apps' audio while armed. true. */
  duckOthers?: boolean;
  /** The OS voice-processing IO (echo cancel, noise suppression). true. */
  voiceProcessing?: boolean;
  /** Frames per audio tap callback. 2048. */
  tapFrames?: number;
  /** Streaming endpoint path. "/v1/transcribe-stream". */
  streamPath?: string;
  /** One-shot upload endpoint path. "/v1/transcribe-clean". */
  uploadPath?: string;
}

/**
 * The Flow Live Activity's words and symbols. `{n}` in wordsSoFar / words is
 * the count. Each absent key keeps the word the widget was built with.
 */
export type FlowActivityCopy = Partial<Record<
  | "listening" | "writing" | "ready" | "readyHint" | "wordsSoFar" | "words"
  | "stop" | "end" | "compact"
  | "iconListening" | "iconIdle" | "iconMinimal" | "iconStop" | "iconEnd",
  string
>>;

interface TulmiBridgeNative {
  setKeyboardCredentials(baseUrl: string, token: string): void;
  setKeyboardLanguage?(code: string): void;
  getKeyboardStatus?(): KeyboardStatus | undefined;
  setDictionary?(json: string): void;
  consumeKeyboardDeepLink?(maxAgeMs?: number): string;
  // Mic handoff — see TulmiBridgeModule.swift for the flow.
  writeAppWarmHeartbeat?(): void;
  consumeKeyboardRecordRequest?(): {
    sessionId?: string;
    requestedAtMs?: number;
    hostApp?: string;
  } | undefined;
  completeKeyboardHandoff?(sessionId: string, text: string): void;
  cancelKeyboardHandoff?(sessionId: string): void;
  // Flow Session (background-audio mic) — iOS only.
  armFlowSession?(
    baseUrl: string,
    token: string,
    language: string,
    idleTimeoutMs: number,
    oneShot: boolean,
    options?: FlowArmOptions,
  ): void;
  endFlowSession?(): void;
  isFlowActive?(): boolean;
  setWidgetMonth?(json: string): void;
  setFlowActivityCopy?(json: string): void;
  setWidgetDictatePath?(path: string): void;
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
 * Arm the background-audio "Flow Session" so the app holds the mic alive after
 * the user swipes back to their app, and the keyboard can drive dictation. iOS
 * only (the keyboard can't record itself); no-op elsewhere. `idleTimeoutMs` is
 * how long the session stays live with no dictation before it must be re-armed.
 * `oneShot` buffers each utterance and sends it in one request at stop instead
 * of streaming it (backend's choice — kb.flow.transport). `options` carries the
 * rest of the session's numbers from the server (see FlowArmOptions; the app's
 * flowArmOptions() in src/widgets/flow.ts builds it from the bootstrap).
 */
export function armFlowSession(
  baseUrl: string,
  token: string,
  language: string,
  idleTimeoutMs: number,
  oneShot = false,
  options?: FlowArmOptions,
): void {
  const arm = native?.armFlowSession;
  if (!arm || !native) return;
  const args = [baseUrl, token, language || "auto", idleTimeoutMs || 300000, oneShot === true] as const;
  const opts = cleanOptions(options);
  if (opts) {
    try {
      arm.call(native, ...args, opts);
      return;
    } catch {
      // A binary older than this JS takes five arguments and rejects a sixth
      // before running anything — arm it the old way below.
    }
  }
  try {
    arm.call(native, ...args);
  } catch {
    /* best-effort; never block the app */
  }
}

/** Drop the fields that are not set, so native sees only real values. */
function cleanOptions(options: FlowArmOptions | undefined): FlowArmOptions | null {
  if (!options) return null;
  const out: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(options)) {
    if (typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || typeof v === "string") {
      out[k] = v as number | boolean | string;
    }
  }
  return Object.keys(out).length > 0 ? (out as FlowArmOptions) : null;
}

/** End the Flow Session (mic released, keyboard returns to "open app to arm"). */
export function endFlowSession(): void {
  try {
    native?.endFlowSession?.();
  } catch {
    /* best-effort */
  }
}

/** Whether a Flow Session is currently armed in the app process. */
export function isFlowActive(): boolean {
  try {
    return native?.isFlowActive?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Read (and clear) any deep-link path the keyboard extension left for the app
 * — since keyboard extensions can't call openURL, they drop the target in the
 * shared App Group and the app picks it up here on foreground.
 *
 * Returns null when nothing is pending. Path shapes:
 *   "screen/<screenId>"  → navigate to that SDUI screen
 *   "openSettings"       → open the app's system settings page
 *
 * `maxAgeMs` is how fresh the tombstone must be to count (the server's number;
 * native keeps 45000 when it is absent or not positive).
 */
export function consumeKeyboardDeepLink(maxAgeMs?: number): string | null {
  const consume = native?.consumeKeyboardDeepLink;
  if (!consume || !native) return null;
  let s: string | undefined;
  if (typeof maxAgeMs === "number" && Number.isFinite(maxAgeMs) && maxAgeMs > 0) {
    try {
      s = consume.call(native, maxAgeMs);
      return s && s.length > 0 ? s : null;
    } catch {
      // An older binary takes no argument and rejects one before reading (or
      // clearing) anything — ask it the old way below.
    }
  }
  try {
    s = consume.call(native);
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

/**
 * The month's numbers for the Home and Lock Screen widget — and, optional so
 * an older writer still fits, what the widget draws them with. Each absent
 * field keeps the widget's own literal (see WidgetLook in TailzuWidgets.swift).
 */
export interface WidgetMonth {
  used: number;
  total: number;
  remaining: number;
  earned: number;
  base: number;
  streak: number;
  entitled: boolean;
  updatedAt: number;
  /** The big number: words left on the free plan, words this month paid. */
  headline?: number;
  /** How full the line is, 0–1. */
  fraction?: number;
  /** The widget's words; `{n}` is a count where a template has one. */
  labels?: Record<string, string>;
  /** "#RRGGBB" / "#RRGGBBAA": ground, pale, amber. */
  colors?: Record<string, string>;
  /** 0–1: dim, rule, track. */
  alpha?: Record<string, number>;
  /** Where a tap on the widget goes. */
  url?: string;
  /** Seconds before the widget asks for a new timeline on its own. */
  refreshSec?: number;
  /** A subscriber's line: the words that would fill it. */
  span?: number;
}

/**
 * Hand the widget the month. Written to the App Group as JSON and the widget
 * is redrawn; the widget never fetches anything itself. A no-op where there
 * is no widget (Android, or a build without the bridge).
 */
export function setWidgetMonth(month: WidgetMonth): void {
  try {
    native?.setWidgetMonth?.(JSON.stringify(month));
  } catch {
    // never let a widget stop the app
  }
}

/**
 * Hand the Flow Live Activity its words (from the server's labels). Written to
 * the App Group; a running activity is redrawn. No-op without the native
 * function (Android, Expo Go, an older binary).
 */
export function setFlowActivityCopy(copy: FlowActivityCopy): void {
  try {
    native?.setFlowActivityCopy?.(JSON.stringify(copy ?? {}));
  } catch {
    // never let a widget stop the app
  }
}

/**
 * Tell the Dictate control which screen arms the microphone ("screen/<id>").
 * No-op without the native function.
 */
export function setWidgetDictatePath(path: string): void {
  if (!path) return;
  try {
    native?.setWidgetDictatePath?.(path);
  } catch {
    // never let a widget stop the app
  }
}
