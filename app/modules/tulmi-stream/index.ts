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
  /** User JWT (or "dev"). */
  token: string;
  targetApp?: string;
  language?: string;
}

export interface StreamHandlers {
  onReady?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
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

/**
 * Open a live dictation session. Throws if the native module is unavailable —
 * guard with isStreamAvailable() first.
 */
export function startStream(options: StreamOptions, handlers: StreamHandlers): LiveSession {
  const mod = native;
  if (!mod) throw new Error("Live streaming module not available");

  const subs: EventSubscription[] = [];
  const cleanup = () => {
    for (const s of subs) s.remove();
    subs.length = 0;
  };
  const on = (name: string, fn?: (e: any) => void) => {
    if (fn) subs.push(mod.addListener(name, fn));
  };

  on("onReady", () => handlers.onReady?.());
  on("onPartial", (e) => handlers.onPartial?.(e?.text ?? ""));
  on("onFinal", (e) => handlers.onFinal?.(e?.text ?? ""));
  on("onError", (e) => handlers.onError?.(e?.message ?? "stream error"));
  on("onClosed", () => {
    handlers.onClosed?.();
    cleanup();
  });

  mod.start(options);

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
