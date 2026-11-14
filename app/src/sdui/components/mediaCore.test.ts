// node --test --experimental-strip-types src/sdui/components/mediaCore.test.ts
//
// Media: which sources a player may load, how its numbers read, and the gate that keeps a scanned code from firing
// an action thirty times a second.
import test from "node:test";
import assert from "node:assert";
import {
  MEDIA_LIMITS, ScanGate, barcodeTypes, cameraFacing, cameraMode, capturedUrl, clampRate, clampVolume, clock,
  contentFit, mediaInto, mediaUrl, progressOf, statusWrites, tickMs, type MediaStatus,
} from "./mediaCore.ts";

test("a player loads https and nothing else", () => {
  assert.strictEqual(mediaUrl("https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4");
  assert.strictEqual(mediaUrl("http://cdn.example.com/a.mp4"), null, "a request the app would make unencrypted");
  assert.strictEqual(mediaUrl("file:///data/user/0/secrets.db"), null, "the server reading this phone's disk");
  assert.strictEqual(mediaUrl("content://media/external/1"), null);
  assert.strictEqual(mediaUrl("javascript:alert(1)"), null);
  assert.strictEqual(mediaUrl("https://cdn.example.com/a b.mp4"), null, "a space is not an encoded URL");
  assert.strictEqual(mediaUrl("https://" + "x".repeat(MEDIA_LIMITS.urlMax) + "/a"), null);
  assert.strictEqual(mediaUrl(7), null);
});

test("a picture the camera just took is local, and only local", () => {
  assert.strictEqual(capturedUrl("file:///cache/x.jpg"), "file:///cache/x.jpg");
  assert.strictEqual(capturedUrl("/cache/x.jpg"), "/cache/x.jpg");
  assert.strictEqual(capturedUrl("file:///cache/../../etc/passwd"), null);
  assert.strictEqual(capturedUrl("https://evil.example/x.jpg"), null, "nothing remote comes out of the shutter");
});

test("the numbers are clamped and never NaN", () => {
  assert.strictEqual(clampVolume(0.5), 0.5);
  assert.strictEqual(clampVolume(9), 1);
  assert.strictEqual(clampVolume("loud"), 1);
  assert.strictEqual(clampRate(2), 2);
  assert.strictEqual(clampRate(99), MEDIA_LIMITS.rate.max);
  assert.strictEqual(clampRate(0), MEDIA_LIMITS.rate.min);
  assert.strictEqual(clampRate(undefined), 1);
  assert.strictEqual(tickMs(1), MEDIA_LIMITS.tickMinMs, "no store write per frame");
  assert.strictEqual(tickMs(undefined), 500);
  assert.strictEqual(progressOf(5, 10), 0.5);
  assert.strictEqual(progressOf(5, 0), 0, "a duration nobody knows yet");
  assert.strictEqual(progressOf("x", 10), 0);
  assert.strictEqual(progressOf(99, 10), 1);
  assert.strictEqual(contentFit("cover"), "cover");
  assert.strictEqual(contentFit("squash"), "contain");
});

test("a clock reads the way a player's does", () => {
  assert.strictEqual(clock(7), "0:07");
  assert.strictEqual(clock(243), "4:03");
  assert.strictEqual(clock(3750), "1:02:30");
  assert.strictEqual(clock(-5), "0:00");
  assert.strictEqual(clock(NaN), "0:00");
});

test("the camera's modes and code kinds are a closed set", () => {
  assert.strictEqual(cameraMode("scan"), "scan");
  assert.strictEqual(cameraMode("film"), "photo");
  assert.strictEqual(cameraFacing("front"), "front");
  assert.strictEqual(cameraFacing(null), "back");
  assert.deepStrictEqual(barcodeTypes(["qr", "ean13"]), ["qr", "ean13"]);
  assert.deepStrictEqual(barcodeTypes(["qr", "qr"]), ["qr"]);
  assert.deepStrictEqual(barcodeTypes(["hologram"]), ["qr"], "a kind we do not know is no kind");
  assert.deepStrictEqual(barcodeTypes(undefined), ["qr"]);
});

test("the same code is handed on once, and new codes are rate-capped", () => {
  const gate = new ScanGate();
  assert.deepStrictEqual(gate.take("qr", "join:abc", 0), { type: "qr", data: "join:abc" });
  assert.strictEqual(gate.take("qr", "join:abc", 40), null, "the camera reading it again 40 ms later");
  assert.strictEqual(gate.take("qr", "join:abc", 900), null);
  // Away for long enough: the person pointed at it again on purpose.
  assert.ok(gate.take("qr", "join:abc", 900 + MEDIA_LIMITS.scanRepeatMs + 1));
  gate.reset();
  const t = 10_000;
  let through = 0;
  for (let i = 0; i < 20; i++) if (gate.take("qr", `code-${i}`, t + i)) through++;
  assert.strictEqual(through, MEDIA_LIMITS.scansPerSecond, "twenty different codes in a millisecond each");
  assert.strictEqual(gate.take("qr", "", 0), null, "an empty read is not a scan");
  gate.reset();
  const long = gate.take("qr", "x".repeat(99_999), 0);
  assert.strictEqual(long?.data.length, MEDIA_LIMITS.scanDataMax, "a QR can hold more than a screen should take");
});

test("only the state paths the node named are written, and only when something changed", () => {
  const into = mediaInto({ playing: "p", time: "t", duration: "d", progress: "k", ended: "e", nonsense: "x", bad: 7 });
  assert.deepStrictEqual(Object.keys(into).sort(), ["duration", "ended", "playing", "progress", "time"]);
  const first: MediaStatus = { playing: true, time: 0, duration: 10, ended: false, loading: false };
  assert.deepStrictEqual(statusWrites(into, null, first), [["p", true], ["t", 0], ["d", 10], ["k", 0], ["e", false]]);
  // The same status again: nothing moved, so nothing is written.
  assert.deepStrictEqual(statusWrites(into, first, first), []);
  // A twitch under the step is not a write either.
  assert.deepStrictEqual(statusWrites(into, first, { ...first, time: 0.1 }), []);
  assert.deepStrictEqual(statusWrites(into, first, { ...first, time: 5 }), [["t", 5], ["k", 0.5]]);
  assert.deepStrictEqual(statusWrites(into, first, { ...first, playing: false }), [["p", false]]);
  assert.deepStrictEqual(statusWrites(mediaInto({}), null, first), [], "a node that named no paths writes nothing");
});
