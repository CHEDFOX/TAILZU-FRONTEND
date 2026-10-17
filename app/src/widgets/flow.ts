/**
 * THE FLOW SESSION, AS THE SERVER DESCRIBES IT.
 *
 * Two things the native side cannot ask the server for itself, built here
 * from the bootstrap's knobs:
 *
 *   • publishFlowCopy()  — the Live Activity's words (widget.flow.* labels)
 *     and symbols (widget.flow.icon.* flags), written to the App Group for
 *     the widget extension. Called with the month's numbers on every
 *     bootstrap (publishWidgetMonth), and safe to call on its own.
 *   • flowArmOptions()   — the session's numbers (app.flow.* flags) for
 *     armFlowSession's optional last argument. Every fallback is the value
 *     FlowSessionManager has always used, so passing it changes nothing
 *     until the server sends a value.
 */
import { Platform } from "react-native";
import {
  armFlowSession, setFlowActivityCopy, setSetupActivity, type FlowActivityCopy, type FlowArmOptions,
} from "../../modules/tulmi-bridge";
import { getSupabaseAccessToken } from "../auth/supabaseClient";
import { getBaseUrl, getLanguage } from "../storage";
import { bool, color, num, obj, str, txt } from "../sdui/knobs";

/** The Live Activity's words. `{n}` is filled with the count by the widget. */
export function flowActivityCopy(): FlowActivityCopy {
  const copy: FlowActivityCopy = {
    listening: txt("widget.flow.listening", "Listening"),
    writing: txt("widget.flow.writing", "Writing it up"),
    ready: txt("widget.flow.ready", "Ready in any app"),
    // What to do, not what state it is in.
    readyHint: txt("widget.flow.readyHint", "Tap the mic on your keyboard and talk."),
    words: txt("widget.flow.words", "{n} words so far"),
    stop: txt("widget.flow.stop", "Stop"),
    end: txt("widget.flow.end", "End"),
    compact: txt("widget.flow.compact", "Ready"),
    iconListening: str("widget.flow.icon.listening", "waveform"),
    iconIdle: str("widget.flow.icon.idle", "mic"),
    iconMinimal: str("widget.flow.icon.minimal", "waveform"),
    iconStop: str("widget.flow.icon.stop", "stop.fill"),
    iconEnd: str("widget.flow.icon.end", "xmark"),
    // Both shown unless the server hides them (default = today's behaviour).
    showWords: bool("widget.flow.show.words", true),
    showEnd: bool("widget.flow.show.end", true),
  };
  // Per-phase accent overrides: carried only when the server sent one, so the
  // view falls back to the theme/Ink accent otherwise (empty means "unset").
  const accentListening = color("widget.flow.accent.listening", "");
  const accentWriting = color("widget.flow.accent.writing", "");
  const accentReady = color("widget.flow.accent.ready", "");
  if (accentListening) copy.accentListening = accentListening;
  if (accentWriting) copy.accentWriting = accentWriting;
  if (accentReady) copy.accentReady = accentReady;
  return copy;
}

/** Write the Live Activity's words for the widget extension. iOS only. */
export function publishFlowCopy(): void {
  if (Platform.OS !== "ios") return;
  setFlowActivityCopy(flowActivityCopy());
}

/**
 * Setup's Live Activity, exactly as the server describes it: a step with its
 * words while setup is unfinished (`liveActivity.setup`), nothing once it is —
 * and nothing ends it. iOS only.
 */
export function publishSetupActivity(): void {
  if (Platform.OS !== "ios") return;
  const s = obj<Record<string, unknown>>("liveActivity.setup", {});
  const title = typeof s.title === "string" ? s.title : "";
  if (!title) { setSetupActivity(null); return; }
  setSetupActivity({
    done: Number(s.done) || 0,
    total: Number(s.total) || 1,
    title,
    detail: typeof s.detail === "string" ? s.detail : "",
    url: typeof s.url === "string" ? s.url : "tulmi://",
  });
}

/**
 * Arm the Flow session with this app's backend, token and language — the one
 * place that does, for the shell and the `armFlowSession` action alike. No
 * session, no token: the native side skips auth rather than sending a made-up
 * one. The session's timings are the server's (flowArmOptions).
 */
export async function armFlow(
  idleTimeoutMs = num("kb.flow.idleTimeoutMs", 600000),
  oneShot = str("kb.flow.transport", "stream") === "oneshot",
): Promise<void> {
  const [base, tok, lang] = await Promise.all([getBaseUrl(), getSupabaseAccessToken(), getLanguage()]);
  armFlowSession(base, tok ?? "", lang || "auto", idleTimeoutMs, oneShot, flowArmOptions());
}

/** The Flow Session's numbers, for armFlowSession(…, flowArmOptions()). */
export function flowArmOptions(): FlowArmOptions {
  return {
    heartbeatMs: num("app.flow.heartbeatMs", 1000),
    bufferFreshMs: num("app.flow.bufferFreshMs", 2000),
    prerollCapBytes: num("app.flow.prerollCapBytes", 96000),
    oneShotCapBytes: num("app.flow.oneShotCapBytes", 3840000),
    closeTimeoutMs: num("app.flow.closeTimeoutMs", 9000),
    minUtteranceBytes: num("app.flow.minUtteranceBytes", 3200),
    oneShotRetries: num("app.flow.oneShotRetries", 1),
    oneShotRetryDelayMs: num("app.flow.oneShotRetryDelayMs", 800),
    oneShotTimeoutMs: num("app.flow.oneShotTimeoutMs", 90000),
    duckOthers: bool("app.flow.duckOthers", true),
    voiceProcessing: bool("app.flow.voiceProcessing", true),
    tapFrames: num("app.flow.tapFrames", 2048),
    streamPath: str("app.flow.streamPath", "/v1/transcribe-stream"),
    uploadPath: str("app.flow.uploadPath", "/v1/transcribe-clean"),
    level: bool("app.flow.level.enabled", true),
    levelMs: num("app.flow.level.intervalMs", 50),
    levelFloorDb: num("app.flow.level.floorDb", -50),
    levelCeilDb: num("app.flow.level.ceilDb", -12),
  };
}
