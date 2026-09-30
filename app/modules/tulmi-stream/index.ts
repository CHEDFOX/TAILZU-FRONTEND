import { requireNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";

/**
 * Live (streaming) dictation for the main app — a thin JS wrapper over the
 * native TulmiStream module. The native side opens the WebSocket and captures
 * the mic; JS just gets transcript events. See STREAMING.md for the protocol.
 *
 * The native module exists only in dev/prod builds (not in Expo Go). We resolve
 * it lazily so the JS app still runs everywhere; callers check isStreamAvailable()
 * and fall back to the file-based path when it's absent.
 */

export interface StreamOptions {
  /** Full ws/wss URL to /v1/transcribe-stream. */
  url: string;
  /** User JWT. */
  token: string;
  targetApp?: string;
  language?: string;
  /**
   * This session also PLAYS.
   *
   * Dictation only records, and takes the narrower `.record` audio category.
   * The spoken conversation listens, answers through the synthesiser and
   * listens again — and a `.record` session cannot play, so the two end up
   * handing the session back and forth every turn and iOS eventually refuses
   * one of the handovers ("session activation failed"). Set this and the
   * native side takes one `.playAndRecord` session that serves both, and holds
   * it between turns instead of releasing it.
   */
  duplex?: boolean;
}

/** Why a live session failed, for picking the right words and for the log. */
export interface StreamFailure {
  /**
   * The server's code (`unauthorized`, `quota_exceeded`, `stt_failed`,
   * `audio_too_long`, `bad_request`, `internal`) or the device's own
   * (`permission`, `mic`, `network`, `url`). Builds made before the native
   * side sent codes send none; the text is then read for the two cases that
   * matter (see classify).
   */
  code?: string;
  /** What the native side reported, as it reported it. For the log only. */
  detail: string;
}

export interface StreamHandlers {
  onReady?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  /**
   * `message` is the server's sentence for the person when it sent one, and
   * "" otherwise: the caller then shows its own words, picked by
   * `failure.code`. Never a raw error; that is in `failure.detail`.
   */
  onError?: (message: string, failure: StreamFailure) => void;
  onClosed?: () => void;
}

export interface LiveSession {
  /** Finish gracefully: stop the mic, flush, and close. */
  stop(): void;
  /** Abort immediately. */
  cancel(): void;
}

interface TulmiStreamNative {
  start(options: StreamOptions): void;
  stop(): void;
  cancel(): void;
  addListener(eventName: string, listener: (event: any) => void): EventSubscription;
}

let native: TulmiStreamNative | null = null;
try {
  native = requireNativeModule("TulmiStream") as unknown as TulmiStreamNative;
} catch {
  native = null;
}

/** True when the native streaming module is available (a dev/prod build). */
export function isStreamAvailable(): boolean {
  return native != null;
}

/** Failures the device reports itself; there is no server sentence behind them. */
const DEVICE_CODES = new Set(["permission", "mic", "network", "url"]);

/**
 * The native side's own texts, from builds that send no code. They are notes
 * for a developer ("Mic start: Error Domain=NSOSStatusErrorDomain …") and were
 * shown in a toast as they stood.
 */
const DEVICE_TEXT = /^(Mic start:|Audio session:|stream lost:|Bad server URL|stream error|stream failed|Mic unavailable)/i;
const PERMISSION_TEXT = /^Microphone permission denied/i;
/** The server's sign-in refusal, kept verbatim for the keyboards that match it. */
const UNAUTHORIZED_TEXT = /invalid or missing token|unauthorized/i;

/**
 * Does this read as a sentence written for a person?
 *
 * Builds without codes hand over the server's sentence and the device's own
 * text through the same field, and on Android the device's is OkHttp's
 * ("timeout", "Socket closed", "Failed to connect to /10.0.2.2:8770"), which
 * cannot be listed in advance. The server writes every stream error meant to
 * be read as a whole sentence (its tests/stream-errors.test.ts applies this
 * same check), so the shape is what tells them apart. It fails closed:
 * anything that does not pass gets the caller's words instead.
 */
function readsAsSentence(s: string): boolean {
  const t = s.trim();
  if (t.split(/\s+/).length < 3) return false;
  if (!/^[A-Z]/.test(t) || !/[.!?]$/.test(t)) return false;
  if (/[:;/\\{}[\]<>=_|@#$%^*~`]/.test(t)) return false;
  return !/\b(error|exception|errno|null|nil|undefined|nan|socket|websocket|https?|wss?|url|json|stt|token|timeout|timed out|abnormal(ly)?|domain|status|code|stream|frames?)\b/i.test(t);
}

/**
 * Split a native error event into what may be shown and what is only logged.
 *
 * A server code means the text is the server's; it is still checked, because
 * a server not yet redeployed sends developer notes under the same codes. A
 * device code never carries anything to show. Without a code the text itself
 * is all there is: the permission refusal and the sign-in refusal are
 * recognised so the caller can say the right thing, and the rest is shown
 * only if it reads as a sentence.
 */
function classify(e: any): { message: string; failure: StreamFailure } {
  const detail = typeof e?.message === "string" ? e.message : "";
  let code = typeof e?.code === "string" && e.code ? e.code : undefined;
  if (!code && PERMISSION_TEXT.test(detail)) code = "permission";
  if (!code && UNAUTHORIZED_TEXT.test(detail)) code = "unauthorized";
  const fromDevice = code ? DEVICE_CODES.has(code) : DEVICE_TEXT.test(detail);
  const message = !fromDevice && readsAsSentence(detail) ? detail.trim() : "";
  // eslint-disable-next-line no-console
  console.warn(`[stream] failed (${code ?? "no code"}): ${detail}`);
  return { message, failure: { code, detail } };
}

/** The listeners of the session before this one, if it never said it closed. */
let detachPrevious: (() => void) | null = null;

/**
 * Open a live dictation session. Throws if the native module is unavailable —
 * guard with isStreamAvailable() first.
 */
export function startStream(options: StreamOptions, handlers: StreamHandlers): LiveSession {
  const mod = native;
  if (!mod) throw new Error("Live streaming module not available");

  // ONE SESSION'S HANDLERS AT A TIME. The native module is a singleton and its
  // events carry no session id, so listeners left by a session whose onClosed
  // never came (a stop on a dead network) heard the NEXT session too — its
  // partials delivered to a screen that had already gone.
  detachPrevious?.();
  const subs: EventSubscription[] = [];
  const cleanup = () => {
    for (const s of subs) s.remove();
    subs.length = 0;
    if (detachPrevious === cleanup) detachPrevious = null;
  };
  detachPrevious = cleanup;
  const on = (name: string, fn?: (e: any) => void) => {
    if (fn) subs.push(mod.addListener(name, fn));
  };

  on("onReady", () => handlers.onReady?.());
  on("onPartial", (e) => handlers.onPartial?.(e?.text ?? ""));
  on("onFinal", (e) => handlers.onFinal?.(e?.text ?? ""));
  on("onError", (e) => {
    const { message, failure } = classify(e);
    handlers.onError?.(message, failure);
  });
  on("onClosed", () => {
    handlers.onClosed?.();
    cleanup();
  });

  try {
    mod.start(options);
  } catch (e) {
    cleanup();
    throw e;
  }

  return {
    stop() {
      try {
        mod.stop();
      } catch {
        cleanup();
      }
    },
    cancel() {
      try {
        mod.cancel();
      } finally {
        cleanup();
      }
    },
  };
}
