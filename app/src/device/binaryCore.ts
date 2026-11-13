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
 *   nativeLook     this binary carries the nlook interpreter, so widget and Live Activity LOOKS arrive as data (layouts,
 *                  words, pictures, palettes, fonts, the dotted bot as a still: shared/types/nlook.ts). Told as NativeLook1,
 *                  and with `nl` on the glance's own request, so the server names a design only for a phone that can draw it.
 *                  On Android the bridge says it only from API 31, where RemoteViews gained the calls the composer needs.
 *   keySkin        the KEYBOARD in this same binary draws key faces: prints, marks, press effects and our fonts. Told as
 *                  KeySkin1, so the Keybot skin picker is served only where a skin can actually be drawn. The keyboard says
 *                  the same thing for itself in its X-Tulmi-Keyboard-Can header; this one is the app's half.
 *   activityPushStart  iOS 17.2 and later: push-to-start tokens are registered, so "Bots at work" can appear on the Lock
 *                  Screen while the app is shut. Told as ActivityPushStart.
 *   liveUpdate     Android: the ongoing "Bots at work" notice. Told as LiveUpdate1 (in the bootstrap AND on the push token, since
 *                  the server draws it from data-only pushes sent only to a phone that said so); promoted to a status-bar chip
 *                  on API 36, an ordinary ongoing progress notification below that.
 *   widgetBoard    the spare "X0 Board" widget kind is in this binary. Told as WidgetBoard1. A shipped widget kind can never
 *                  be removed, so this name, once said, is said for good.
 *
 * LAUNCH DARK. Saying a name here only means the binary CAN draw it. Every server switch behind these (native looks, native
 * activity designs, keyboard skins, push-to-start, the Android notice) starts off, and stays off until the owner's device
 * checks pass. Old builds say none of these names and keep today's views exactly.
 */

export type BinaryFeature =
  | "timeSensitive" | "glanceSteps" | "realtimeCall"
  | "nativeLook" | "keySkin" | "activityPushStart" | "liveUpdate" | "widgetBoard";

/** Each feature, the platforms that can have it, and the name the server knows it by. */
const FEATURES: Record<BinaryFeature, { platforms: readonly string[]; cap: string }> = {
  timeSensitive: { platforms: ["ios"], cap: "PushTimeSensitive" },
  glanceSteps: { platforms: ["ios", "android"], cap: "GlanceSteps" },
  realtimeCall: { platforms: ["ios", "android"], cap: "VoiceRealtime" },
  nativeLook: { platforms: ["ios", "android"], cap: "NativeLook1" },
  keySkin: { platforms: ["ios", "android"], cap: "KeySkin1" },
  // A Live Activity is iOS's; an ongoing notice is Android's. Neither platform is told the other's name even if it said it.
  activityPushStart: { platforms: ["ios"], cap: "ActivityPushStart" },
  liveUpdate: { platforms: ["android"], cap: "LiveUpdate1" },
  widgetBoard: { platforms: ["ios", "android"], cap: "WidgetBoard1" },
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
 *  call is answered in the app, so `realtimeCall` changes nothing about the ring and is not one of them. The Android notice IS one:
 *  it is drawn from a data-only push (high priority) the server sends only to a phone that said it can (LiveUpdate1, the server's PUSH_CAPS), so the
 *  name goes on the token as well as in the bootstrap. Nothing is ever sent to a binary that did not say it. */
export function pushCaps(features: readonly BinaryFeature[]): string[] {
  const out: string[] = [];
  if (features.includes("timeSensitive")) out.push(FEATURES.timeSensitive.cap);
  if (features.includes("liveUpdate")) out.push(FEATURES.liveUpdate.cap);
  // The silent catalog nudge goes only to a token that says it can use a new catalog.
  if (features.includes("nativeLook")) out.push(FEATURES.nativeLook.cap);
  return out;
}
