/**
 * WHAT THIS BINARY CAN DO THAT A JAVASCRIPT UPDATE CANNOT ADD, AND WHAT THE SERVER IS TOLD OF IT. Free of react-native, so each
 * rule is tested on its own (binaryCore.test.ts); binary.ts reads the bridge.
 *
 * An over-the-air update reaches every binary on the same runtime, including ones built before an entitlement or a widget's
 * native code. So a capability that needs the binary is never a constant in the JavaScript (registry.ts): it is said only when
 * the native bridge says so (TulmiBridgeModule.swift / .kt `binaryFeatures`), and a binary that has no such function says none.
 *
 *   timeSensitive  (iOS) the Time Sensitive entitlement is signed in (app.config.ts). Told as PushTimeSensitive, in the bootstrap's
 *                  components and with the push token (push.ts), so the server sends `interruptionLevel: "time-sensitive"` (a
 *                  leave-by, a bill due today) only to a phone that can use it.
 *   glanceSteps    the X0 widget switches its lines on its own at the glance's `steps` (glanceCore.ts stepAt; X0Glance.swift,
 *                  TailzuX0Widget.kt). Told as GlanceSteps in the bootstrap, and as `steps=1` on the glance's own request
 *                  (glance.ts), so only such a phone is sent steps.
 *   realtimeCall   this binary links the live voice client (react-native-webrtc) and tulmi-stream's callAudio, so Plan Ease's
 *                  call can be a real conversation instead of turn by turn (sdui/voice/callRealtime.ts). Told as VoiceRealtime
 *                  in the bootstrap, so the server draws the call screen's realtime mode for this phone alone; every older
 *                  binary gets today's turn-by-turn call, whatever JavaScript it is running.
 */

export type BinaryFeature = "timeSensitive" | "glanceSteps" | "realtimeCall";

/** Each feature, the platforms that can have it, and the name the server knows it by. */
const FEATURES: Record<BinaryFeature, { platforms: readonly string[]; cap: string }> = {
  timeSensitive: { platforms: ["ios"], cap: "PushTimeSensitive" },
  glanceSteps: { platforms: ["ios", "android"], cap: "GlanceSteps" },
  realtimeCall: { platforms: ["ios", "android"], cap: "VoiceRealtime" },
};

const isFeature = (v: unknown): v is BinaryFeature => typeof v === "string" && Object.prototype.hasOwnProperty.call(FEATURES, v);

/** What the bridge answered, kept to the features this JavaScript knows and the platform can have; each once, in a fixed order. */
export function cleanFeatures(said: unknown, platform: string): BinaryFeature[] {
  if (!Array.isArray(said)) return [];
  const have = new Set(said.filter(isFeature));
  return (Object.keys(FEATURES) as BinaryFeature[]).filter((f) => have.has(f) && FEATURES[f].platforms.includes(platform));
}

/** The capability names for the bootstrap's components (client/capabilities.ts). */
export function featureCaps(features: readonly BinaryFeature[]): string[] {
  return features.map((f) => FEATURES[f].cap);
}

/** The capability names a push token carries (POST /v1/push/register `caps`): only what changes how a push is sent. A live
 *  call is answered in the app, so `realtimeCall` changes nothing about the ring and is not one of them. */
export function pushCaps(features: readonly BinaryFeature[]): string[] {
  return features.includes("timeSensitive") ? [FEATURES.timeSensitive.cap] : [];
}
