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
import { setFlowActivityCopy, type FlowActivityCopy, type FlowArmOptions } from "../../modules/tulmi-bridge";
import { bool, num, str, txt } from "../sdui/knobs";

/** The Live Activity's words. `{n}` is filled with the count by the widget. */
export function flowActivityCopy(): FlowActivityCopy {
  return {
    listening: txt("widget.flow.listening", "Listening"),
    writing: txt("widget.flow.writing", "Writing"),
    ready: txt("widget.flow.ready", "Flow is on"),
    readyHint: txt("widget.flow.readyHint", "Tap the mic on the keyboard to dictate."),
    wordsSoFar: txt("widget.flow.wordsSoFar", "{n} words so far."),
    words: txt("widget.flow.words", "{n} words"),
    stop: txt("widget.flow.stop", "Stop"),
    end: txt("widget.flow.end", "End"),
    compact: txt("widget.flow.compact", "Flow"),
    iconListening: str("widget.flow.icon.listening", "waveform"),
    iconIdle: str("widget.flow.icon.idle", "mic"),
    iconMinimal: str("widget.flow.icon.minimal", "waveform"),
    iconStop: str("widget.flow.icon.stop", "stop.fill"),
    iconEnd: str("widget.flow.icon.end", "xmark"),
  };
}

/** Write the Live Activity's words for the widget extension. iOS only. */
export function publishFlowCopy(): void {
  if (Platform.OS !== "ios") return;
  setFlowActivityCopy(flowActivityCopy());
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
  };
}
