// node --test --experimental-strip-types src/sdui/gesture/gestureCore.test.ts
//
// Gestures on any node: the arithmetic a finger runs on (bounds, the rubber band past them, where a flick
// coasts to, the nearest snap point, how far along a run a value is, and what counts as a swipe), the rules
// about where a gesture may write, and the compiling — defaults, clamps, the order `after:<id>` asks for, and
// the degrade rule that one unreadable gesture never takes the others with it.

import test from "node:test";
import assert from "node:assert";
import {
  AXIS_BOTH, AXIS_X, AXIS_Y, bounded, claimOrder, CLAIM_AFTER, CLAIM_EXCLUSIVE, CLAIM_SIMULTANEOUS, clamp,
  compileGestures, GESTURE_DEFAULTS, GESTURE_LIMITS, nearestSnap, needsValues, okInto, progressOf, project,
  rubber, settle, SWIPE_DOWN, SWIPE_LEFT, SWIPE_NONE, SWIPE_RIGHT, SWIPE_UP, swipeOf,
  cancelUi, pickUi, restUi, uiFields, UI_PROGRESS, UI_SCALE, UI_X, UI_Y,
} from "./gestureCore.ts";
import { LiveCount } from "../motion/motionCore.ts";

// ===================================================================== the arithmetic

test("a value is held between its bounds", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});

test("the rubber band gives less the further it is pulled, and never reaches its limit", () => {
  assert.equal(rubber(0, 100), 0);
  const small = rubber(10, 100), big = rubber(1000, 100);
  assert.ok(small > 0 && small < 10, `a small pull mostly gives, got ${small}`);
  assert.ok(big < 100, `and a huge one never passes the limit, got ${big}`);
  assert.ok(big > rubber(500, 100), "but it is still going the right way");
  assert.equal(rubber(-10, 100), -small, "and it is the same on both sides");
  assert.equal(rubber(10, 0), 0, "no band asked for is no band");
});

test("bounds hold hard without a rubber band and softly with one", () => {
  assert.equal(bounded(120, 0, 100, 0), 100);
  assert.equal(bounded(-20, 0, 100, 0), 0);
  const soft = bounded(120, 0, 100, 60);
  assert.ok(soft > 100 && soft < 120, `it is past the end but not by the whole pull, got ${soft}`);
  assert.equal(bounded(50, 0, 100, 60), 50, "and inside the run nothing happens at all");
});

test("a flick coasts on its own speed", () => {
  assert.equal(project(100, 0, 90), 100, "standing still goes nowhere");
  assert.equal(project(100, 1000, 100), 200, "1000 px a second for a tenth of one");
  assert.equal(project(100, -1000, 100), 0);
  assert.equal(project(100, NaN, 100), 100, "a speed that is not a number leaves it where it is");
});

test("the nearest snap point wins, and no points means no snapping", () => {
  assert.equal(nearestSnap(37, [0, 50, 100]), 50);
  assert.equal(nearestSnap(24, [0, 50, 100]), 0);
  assert.equal(nearestSnap(-80, [0, 50, 100]), 0);
  assert.equal(nearestSnap(37, []), 37);
});

test("settling carries the speed first, then snaps, then holds the bounds", () => {
  // Let go at 40 with a shove to the right: it coasts past the half-way point and lands on 100.
  assert.equal(settle(40, 1000, 0, 100, [0, 100], 90), 100);
  // The same place, let go dead: it falls back to 0.
  assert.equal(settle(40, 0, 0, 100, [0, 100], 90), 0);
  // A shove that would carry it off the end is still held at the end.
  assert.equal(settle(90, 9000, 0, 100, [], 90), 100);
  assert.equal(settle(10, -9000, 0, 100, [], 90), 0);
});

test("progress is 0 to 1 along the run, and a run of nothing is 0", () => {
  assert.equal(progressOf(0, 0, 100), 0);
  assert.equal(progressOf(60, 0, 100), 0.6);
  assert.equal(progressOf(200, 0, 100), 1, "and never past the end");
  assert.equal(progressOf(5, 10, 10), 0, "a run of nothing never divides by nothing");
});

test("a swipe counts when it went far enough OR fast enough", () => {
  const d = GESTURE_DEFAULTS;
  assert.equal(swipeOf(-100, 0, 0, 0, AXIS_X, d.swipeDistance, d.swipeVelocity), SWIPE_LEFT, "far, slowly");
  assert.equal(swipeOf(-10, 0, -900, 0, AXIS_X, d.swipeDistance, d.swipeVelocity), SWIPE_LEFT, "short, quickly");
  assert.equal(swipeOf(-10, 0, -10, 0, AXIS_X, d.swipeDistance, d.swipeVelocity), SWIPE_NONE, "neither");
  assert.equal(swipeOf(100, 0, 0, 0, AXIS_X, d.swipeDistance, d.swipeVelocity), SWIPE_RIGHT);
});

test("a swipe on one axis ignores the other, and `both` takes whichever went further", () => {
  const d = GESTURE_DEFAULTS;
  assert.equal(swipeOf(0, -100, 0, 0, AXIS_X, d.swipeDistance, d.swipeVelocity), SWIPE_NONE);
  assert.equal(swipeOf(-100, 0, 0, 0, AXIS_Y, d.swipeDistance, d.swipeVelocity), SWIPE_NONE);
  assert.equal(swipeOf(0, -100, 0, 0, AXIS_Y, d.swipeDistance, d.swipeVelocity), SWIPE_UP);
  assert.equal(swipeOf(0, 100, 0, 0, AXIS_BOTH, d.swipeDistance, d.swipeVelocity), SWIPE_DOWN);
  assert.equal(swipeOf(-100, 20, 0, 0, AXIS_BOTH, d.swipeDistance, d.swipeVelocity), SWIPE_LEFT);
});

// ===================================================================== where a gesture may write

test("`into` follows the path rules, so a gesture can never write where a state path could not", () => {
  assert.ok(okInto("pill"));
  assert.ok(okInto("card.drag"));
  assert.ok(!okInto(""));
  assert.ok(!okInto("a..b"));
  assert.ok(okInto("a.b.c__proto__"), "a name that merely contains it is fine");
  assert.ok(!okInto("__proto__"), "but the name itself is never allowed");
  assert.ok(!okInto("a.constructor.b"));
  assert.ok(!okInto("a.prototype"));
  assert.ok(!okInto("pill-x"), "a plain name: letters, digits, underscores and dots");
  assert.ok(!okInto("a.".repeat(GESTURE_LIMITS.pathSegments) + "b"));
  assert.ok(!okInto("x".repeat(GESTURE_LIMITS.pathChars + 1)));
  assert.ok(!okInto(7));
});

// ===================================================================== compiling

test("the spec's own example compiles to what it says", () => {
  const { list, bad } = compileGestures([{
    kind: "drag", axis: "x", into: "pill", min: 0, max: 280,
    commitIf: { expr: "ui.pill.x > 200" }, onCommit: { kind: "navigate" },
    onCancel: { kind: "spring", to: 0 }, claim: "exclusive",
  }]);
  assert.equal(bad.length, 0, bad.join("; "));
  assert.equal(list.length, 1);
  const g = list[0];
  assert.equal(g.kind, "drag");
  assert.equal(g.axis, AXIS_X);
  assert.equal(g.into, "pill");
  assert.equal(g.max, 280);
  assert.equal(g.claim, CLAIM_EXCLUSIVE);
  assert.deepEqual(g.commitIf, { expr: "ui.pill.x > 200" });
  assert.equal(g.cancelTo, 0, "`spring to` is the gesture's own answer, not a server action");
  assert.equal(g.onCancel, null, "so it is not also handed to the host as one");
});

test("a double tap is two taps in its own window, and the window is the old global delay", () => {
  const { list } = compileGestures([{ kind: "doubleTap" }, { kind: "doubleTap", window: 400 }]);
  assert.equal(list[0].taps, 2);
  assert.equal(list[0].windowMs, GESTURE_DEFAULTS.doubleTapMs);
  assert.equal(GESTURE_DEFAULTS.doubleTapMs, 260, "260 ms, now per node rather than over the whole app");
  assert.equal(list[1].windowMs, 400);
});

test("every number is clamped, so a server can never ask for an impossible gesture", () => {
  const { list } = compileGestures([{
    kind: "drag", min: 100, max: 0, springK: -5, springDamp: 99, slop: -10, taps: 50,
    minScale: 9, maxScale: 1, hold: 1e9,
  }]);
  const g = list[0];
  assert.equal(g.max, 100, "a run that ends before it starts collapses to a point");
  assert.equal(g.springK, 1);
  assert.equal(g.springDamp, 4);
  assert.equal(g.slop, 0);
  assert.equal(g.taps, 3);
  assert.ok(g.maxScale >= g.minScale);
  assert.ok(g.holdMs <= 10_000);
});

test("a gesture that cannot be read is left out and named, and the others still work", () => {
  const { list, bad } = compileGestures([
    { kind: "nonsense" },
    { kind: "tap", into: "__proto__" },
    { kind: "tap", into: "ok" },
    "not even an object",
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].into, "ok");
  assert.equal(bad.length, 3, bad.join("; "));
  assert.deepEqual(compileGestures(null), { list: [], bad: [] });
  assert.deepEqual(compileGestures({ kind: "tap" }).list, [], "a map is not a list of gestures");
});

test("snap points are numbers, and too many is none rather than a silent few", () => {
  assert.deepEqual(compileGestures([{ kind: "drag", snap: [0, 50, 100] }]).list[0].snaps, [0, 50, 100]);
  assert.deepEqual(compileGestures([{ kind: "drag", snap: [0, "fifty"] }]).list[0].snaps, []);
  const many = Array.from({ length: GESTURE_LIMITS.snaps + 1 }, (_, i) => i);
  assert.deepEqual(compileGestures([{ kind: "drag", snap: many }]).list[0].snaps, []);
});

test("no more gestures on a node than it may hold", () => {
  const many = Array.from({ length: GESTURE_LIMITS.perNode + 3 }, () => ({ kind: "tap" }));
  const { list, bad } = compileGestures(many);
  assert.equal(list.length, GESTURE_LIMITS.perNode);
  assert.ok(bad.some((b) => b.includes("at most")));
});

test("`after:<id>` puts a gesture behind the one it named", () => {
  const { list } = compileGestures([
    { kind: "tap", claim: "after:hold" },
    { kind: "longPress", id: "hold" },
  ]);
  assert.equal(list[0].kind, "longPress", "the one that is waited for goes first, so it has the say");
  assert.equal(list[1].claim, CLAIM_AFTER);
  assert.equal(list[1].after, "hold");
});

test("a circle of waiting leaves the order as written rather than hanging", () => {
  const a = { kind: "tap", id: "a", claim: "after:b" };
  const b = { kind: "tap", id: "b", claim: "after:a" };
  const { list } = compileGestures([a, b]);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((g) => g.id), ["a", "b"]);
});

test("`after:` a name nobody has is simply the order it was written in", () => {
  const { list } = compileGestures([{ kind: "tap", claim: "after:ghost" }, { kind: "longPress" }]);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, "tap");
});

test("claimOrder leaves a list that waits for nothing exactly as it is", () => {
  const { list } = compileGestures([{ kind: "tap", id: "a" }, { kind: "pan", id: "b" }]);
  assert.deepEqual(claimOrder(list).map((g) => g.id), ["a", "b"]);
});

test("simultaneous is read, and it is the only thing that is not exclusive", () => {
  const { list } = compileGestures([{ kind: "pan", claim: "simultaneous" }, { kind: "pinch" }]);
  assert.equal(list.find((g) => g.kind === "pan")?.claim, CLAIM_SIMULTANEOUS);
  assert.equal(list.find((g) => g.kind === "pinch")?.claim, CLAIM_EXCLUSIVE);
});

test("only a gesture with somewhere to write needs values kept for it", () => {
  assert.equal(needsValues(compileGestures([{ kind: "tap" }]).list), false);
  assert.equal(needsValues(compileGestures([{ kind: "drag", into: "pill" }]).list), true);
});

test("a swipe defaults to sideways and a pan to either way", () => {
  assert.equal(compileGestures([{ kind: "swipe" }]).list[0].axis, AXIS_X);
  assert.equal(compileGestures([{ kind: "pan" }]).list[0].axis, AXIS_BOTH);
  assert.equal(compileGestures([{ kind: "drag", axis: "y" }]).list[0].axis, AXIS_Y);
});

test("`rubber: true` is the house pull, and a number is that many points", () => {
  assert.equal(compileGestures([{ kind: "drag", rubber: true }]).list[0].rubber, GESTURE_DEFAULTS.rubberPx);
  assert.equal(compileGestures([{ kind: "drag", rubber: 40 }]).list[0].rubber, 40);
  assert.equal(compileGestures([{ kind: "drag" }]).list[0].rubber, 0, "and by default it stops dead");
});

// ===================================================================== which values a gesture owns

test("each kind owns only the values its own fingers move", () => {
  assert.equal(uiFields("pinch", AXIS_BOTH), UI_SCALE, "a zoom says nothing about where the thing is");
  assert.equal(uiFields("tap", AXIS_BOTH), UI_X | UI_Y | UI_PROGRESS);
  assert.equal(uiFields("swipe", AXIS_X), UI_X | UI_Y | UI_PROGRESS);
  assert.equal(uiFields("drag", AXIS_X), UI_X | UI_PROGRESS, "a sideways drag does not own y");
  assert.equal(uiFields("drag", AXIS_Y), UI_Y | UI_PROGRESS);
  assert.equal(uiFields("pan", AXIS_BOTH), UI_X | UI_Y | UI_PROGRESS);
});

test("a gesture writes its own fields and leaves a sibling's alone", () => {
  // The usual photo viewer: a pan and a pinch, both `into: "photo"`, both simultaneous. Writing all four
  // from each would put the picture back in the corner on every zoom and back to life size on every pan.
  const pan = pickUi(uiFields("pan", AXIS_BOTH), 40, -12, 1, 0.5);
  assert.deepEqual(pan, { x: 40, y: -12, progress: 0.5 });
  const pinch = pickUi(uiFields("pinch", AXIS_BOTH), 0, 0, 2.5, 0);
  assert.deepEqual(pinch, { scale: 2.5 });
  const dragY = pickUi(uiFields("drag", AXIS_Y), 99, 60, 1, 0.3);
  assert.deepEqual(dragY, { y: 60, progress: 0.3 }, "the x it never touched is not written");
});

test("a cancelled drag puts back the axis it was dragged on, and only that one", () => {
  assert.deepEqual(cancelUi(AXIS_Y, 0, 0), { progress: 0, y: 0 }, "a pull-down goes home on y, not on x");
  assert.deepEqual(cancelUi(AXIS_X, 0, 0), { progress: 0, x: 0 });
  assert.deepEqual(cancelUi(AXIS_BOTH, 0, 0.25), { progress: 0.25, x: 0, y: 0 });
});

test("a fresh mount starts a gesture's values where the first mount found them", () => {
  // Without this the second visit to a screen opens with the last visit's ending: a slide-to-confirm
  // already at its end, so `commitIf ui.pill.x > 240` is true before anyone has touched it.
  assert.deepEqual(restUi(uiFields("drag", AXIS_X), 0, 320), { x: 0, progress: 0 });
  assert.deepEqual(restUi(uiFields("drag", AXIS_X), 100, 300), { x: 100, progress: 0 }, "rest is the run's start");
  assert.deepEqual(restUi(uiFields("pinch", AXIS_BOTH), 0, 0), { scale: 1 }, "a picture opens at life size");
});

test("the gesture a node compiles carries the fields it will write", () => {
  const { list } = compileGestures([
    { kind: "drag", axis: "y", into: "sheet", min: 0, max: 200 },
    { kind: "pinch", into: "sheet" },
  ]);
  assert.equal(list[0].fields, UI_Y | UI_PROGRESS);
  assert.equal(list[1].fields, UI_SCALE);
});

// ===================================================================== how many may be live

test("SPEC 5.1's twelve live gestures per screen is a number something counts", () => {
  const n = new LiveCount(GESTURE_LIMITS.perScreen);
  // Two nodes with six gestures each fill the screen's allowance exactly.
  assert.equal(n.take(6), true);
  assert.equal(n.take(6), true);
  assert.equal(n.live, GESTURE_LIMITS.perScreen);
  assert.equal(n.take(1), false, "the thirteenth gesture is not taken");
  n.give(6);
  assert.equal(n.take(6), true, "and a node that leaves gives its six back");
});
