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

test("names this JavaScript does not know, and non-strings, are dropped (a newer binary's feature waits for its update)", () => {
  assert.deepStrictEqual(cleanFeatures(["liveActivityLeave", 7, null, "glanceSteps", "toString", "__proto__"], "ios"), ["glanceSteps"]);
});

test("a platform that has none of them (the web) is told nothing", () => {
  assert.deepStrictEqual(cleanFeatures(["timeSensitive", "glanceSteps"], "web"), []);
});
