// node --test --experimental-strip-types src/device/binaryCore.test.ts
//
// What the server is told the binary can do: only what the native bridge says, only what this platform can have, and only the
// names the server knows. An older binary says nothing, so an update can never promise what it lacks.

import test from "node:test";
import assert from "node:assert";
import { cleanFeatures, featureCaps, pushCaps } from "./binaryCore.ts";

test("an older binary or Expo Go (no answer, or not a list) promises nothing", () => {
  for (const said of [undefined, null, "", "timeSensitive", { timeSensitive: true }, 1]) {
    assert.deepStrictEqual(cleanFeatures(said, "ios"), []);
  }
  assert.deepStrictEqual(featureCaps(cleanFeatures(undefined, "ios")), []);
  assert.deepStrictEqual(pushCaps(cleanFeatures(undefined, "ios")), []);
});

test("an iPhone binary with both: Time Sensitive and the widget's steps, each once, in a fixed order", () => {
  const f = cleanFeatures(["glanceSteps", "timeSensitive", "glanceSteps"], "ios");
  assert.deepStrictEqual(f, ["timeSensitive", "glanceSteps"]);
  assert.deepStrictEqual(featureCaps(f), ["PushTimeSensitive", "GlanceSteps"]);
  assert.deepStrictEqual(pushCaps(f), ["PushTimeSensitive"]);
});

test("Time Sensitive is iOS's alone: an Android binary that said it would still not be told", () => {
  const f = cleanFeatures(["timeSensitive", "glanceSteps"], "android");
  assert.deepStrictEqual(f, ["glanceSteps"]);
  assert.deepStrictEqual(featureCaps(f), ["GlanceSteps"]);
  // Nothing on the push token: an Android push is woken by its priority and channel.
  assert.deepStrictEqual(pushCaps(f), []);
});

test("a store build with the live call: VoiceRealtime on either platform, and nothing extra on the push token", () => {
  for (const platform of ["ios", "android"]) {
    const f = cleanFeatures(["realtimeCall", "glanceSteps"], platform);
    assert.deepStrictEqual(f, ["glanceSteps", "realtimeCall"]);
    assert.ok(featureCaps(f).includes("VoiceRealtime"));
    // The ring is an ordinary notification either way: a live call changes nothing about how the push is sent.
    assert.deepStrictEqual(pushCaps(f), []);
  }
});

test("an older binary says no realtimeCall, so an update written for the live call promises nothing", () => {
  const f = cleanFeatures(["timeSensitive", "glanceSteps"], "ios");
  assert.ok(!f.includes("realtimeCall"));
  assert.ok(!featureCaps(f).includes("VoiceRealtime"));
});

test("names this JavaScript does not know, and non-strings, are dropped (a newer binary's feature waits for its update)", () => {
  assert.deepStrictEqual(cleanFeatures(["liveActivityLeave", 7, null, "glanceSteps", "toString", "__proto__"], "ios"), ["glanceSteps"]);
});

test("a platform that has none of them (the web) is told nothing", () => {
  assert.deepStrictEqual(cleanFeatures(["timeSensitive", "glanceSteps"], "web"), []);
});

test("an iPhone store build with the drawing code: looks, key faces, push-to-start and the spare board", () => {
  const f = cleanFeatures(
    ["timeSensitive", "glanceSteps", "realtimeCall", "nativeLook", "keySkin", "activityPushStart", "widgetBoard"], "ios");
  assert.deepStrictEqual(f, [
    "timeSensitive", "glanceSteps", "realtimeCall", "nativeLook", "keySkin", "activityPushStart", "widgetBoard",
  ]);
  assert.deepStrictEqual(featureCaps(f), [
    "PushTimeSensitive", "GlanceSteps", "VoiceRealtime", "NativeLook1", "KeySkin1", "ActivityPushStart", "WidgetBoard1",
  ]);
  // Only Time Sensitive and NativeLook1 (the silent catalog nudge) change how a push is SENT.
  assert.deepStrictEqual(pushCaps(f), ["PushTimeSensitive", "NativeLook1"]);
});

test("an Android build: the ongoing notice is its own, and push-to-start is not", () => {
  const f = cleanFeatures(
    ["glanceSteps", "realtimeCall", "nativeLook", "keySkin", "liveUpdate", "widgetBoard", "activityPushStart"], "android");
  assert.deepStrictEqual(f, ["glanceSteps", "realtimeCall", "nativeLook", "keySkin", "liveUpdate", "widgetBoard"]);
  assert.ok(featureCaps(f).includes("LiveUpdate1"));
  // A Live Activity is iOS's: an Android binary that said push-to-start is still not told.
  assert.ok(!featureCaps(f).includes("ActivityPushStart"));
  // The notice is drawn from a data-only push, so the push token says LiveUpdate1 too: the server sends it to nothing else.
  assert.deepStrictEqual(pushCaps(f), ["LiveUpdate1", "NativeLook1"]);
  // An iPhone binary never says it, whatever its bridge answered.
  assert.deepStrictEqual(pushCaps(cleanFeatures(["liveUpdate", "timeSensitive"], "ios")), ["PushTimeSensitive"]);
  assert.deepStrictEqual(pushCaps(cleanFeatures(["liveUpdate"], "android")), ["LiveUpdate1"]);
});

test("the ongoing notice is Android's: an iPhone binary that said it is still not told", () => {
  const f = cleanFeatures(["nativeLook", "liveUpdate"], "ios");
  assert.deepStrictEqual(f, ["nativeLook"]);
  assert.deepStrictEqual(featureCaps(f), ["NativeLook1"]);
});

test("an Android below API 31 says no nativeLook, so the server never names a design for it", () => {
  // The bridge itself leaves the name out below API 31 (TulmiBridgeModule.kt); the phone keeps today's 12 layouts.
  const f = cleanFeatures(["glanceSteps", "keySkin", "liveUpdate"], "android");
  assert.ok(!f.includes("nativeLook"));
  assert.ok(!featureCaps(f).includes("NativeLook1"));
  // The keyboard's faces live in the same APK whatever the API level, so that one still stands.
  assert.ok(featureCaps(f).includes("KeySkin1"));
});

test("an older binary says none of the new names, so an update written for them promises nothing", () => {
  const f = cleanFeatures(["timeSensitive", "glanceSteps", "realtimeCall"], "ios");
  for (const cap of ["NativeLook1", "KeySkin1", "ActivityPushStart", "LiveUpdate1", "WidgetBoard1"]) {
    assert.ok(!featureCaps(f).includes(cap));
  }
});
