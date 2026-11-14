// node --test --experimental-strip-types src/sdui/motion/motionCore.test.ts
//
// Motion on any node: the value model. Keyframes are read the way a scene reads them (holding at both ends,
// easing into each key, wrapping when they loop), a spring is the same damped spring the bot plays, a section
// folds onto nine numbers without allocating, sections compose rather than one winning, and nothing a server
// can send throws — a bad value is left out and named instead. Then Reduce Motion: enters and exits become a
// cross-fade, loops stop where they start, and "off" leaves everything at rest.

import test from "node:test";
import assert from "node:assert";
import {
  compileMotion, cubicEase, E_CUBIC, E_OUT, easeAt, foldSection, foldSprings, forMode, keysUsed, K_OPACITY,
  K_ROT, K_TY, KSTRIDE, MOTION_LIMITS, movesAnything, multiplies, NO_MOTION, resetValues, restOf, restValues,
  LiveCount, MAX_SPRINGS, sampleKeys, springDamping, stepSpring, usesKey,
} from "./motionCore.ts";

// ===================================================================== keyframes

test("keyframes hold at both ends and walk between the keys", () => {
  // [[0, 0], [1, 10]]
  const flat = [0, 0, 0, 0, 0, 0, 0, 1, 10, 0, 0, 0, 0, 0];
  assert.equal(sampleKeys(flat, 2, false, -5), 0, "before the first key it holds the first value");
  assert.equal(sampleKeys(flat, 2, false, 0), 0);
  assert.equal(sampleKeys(flat, 2, false, 0.5), 5, "linear between two keys");
  assert.equal(sampleKeys(flat, 2, false, 1), 10);
  assert.equal(sampleKeys(flat, 2, false, 99), 10, "after the last key it holds the last value");
});

test("one key is a constant, and no keys is zero", () => {
  assert.equal(sampleKeys([0, 7, 0, 0, 0, 0, 0], 1, false, 3), 7);
  assert.equal(sampleKeys([], 0, false, 3), 0);
});

test("a looping track wraps its clock back into the span, forwards and backwards", () => {
  const flat = [0, 0, 0, 0, 0, 0, 0, 2, 20, 0, 0, 0, 0, 0];
  assert.equal(sampleKeys(flat, 2, true, 2.5), 5, "half a second past the wrap");
  assert.equal(sampleKeys(flat, 2, true, 4.5), 5, "two wraps later, the same place");
  assert.equal(sampleKeys(flat, 2, true, -0.5), 15, "a clock before the start wraps forwards, never to NaN");
});

test("the ease on a key shapes the segment arriving AT it", () => {
  // The same two keys, the second eased "out": the walk is ahead of linear in the middle.
  const lin = [0, 0, 0, 0, 0, 0, 0, 1, 10, 0, 0, 0, 0, 0];
  const out = [0, 0, 0, 0, 0, 0, 0, 1, 10, E_OUT, 0, 0, 0, 0];
  assert.equal(sampleKeys(lin, 2, false, 0.5), 5);
  assert.equal(sampleKeys(out, 2, false, 0.5), 7.5, "out is 1 - (1 - w)^2");
  assert.equal(sampleKeys(out, 2, false, 1), 10, "and still lands exactly");
});

test("a cubic ease is solved for y at x, and is flat outside 0..1", () => {
  assert.equal(cubicEase(0.25, 0.1, 0.25, 1, 0), 0);
  assert.equal(cubicEase(0.25, 0.1, 0.25, 1, 1), 1);
  const mid = cubicEase(0.25, 0.1, 0.25, 1, 0.5);
  assert.ok(mid > 0.5 && mid < 1, `an ease-out curve is above the line at halfway, got ${mid}`);
  const flat = [0, 0, E_CUBIC, 0.25, 0.1, 0.25, 1, 0, 0, 0, 0, 0, 0, 0];
  assert.ok(Math.abs(easeAt(flat, 0, 0.5) - mid) < 1e-12, "easeAt reads the cubic out of the key");
});

// ===================================================================== springs

test("a spring's damping ratio becomes a coefficient the same way a scene's does", () => {
  assert.equal(springDamping(100, 1), 20, "critical at damp 1 is 2 * sqrt(k)");
  assert.equal(springDamping(0, 1), 0);
  assert.equal(springDamping(-5, 1), 0, "a stiffness below nothing is nothing, never NaN");
});

test("a damped spring arrives at its target and stops", () => {
  const s = [0, 0];
  for (let i = 0; i < 400; i++) stepSpring(s, 10, 180, 0.9, 1 / 60);
  assert.ok(Math.abs(s[0] - 10) < 0.01, `settles on the target, got ${s[0]}`);
  assert.ok(Math.abs(s[1]) < 0.01, "and with no speed left");
});

test("a spring given an impossible frame is held, not flung", () => {
  const s = [0, 0];
  stepSpring(s, 10, 180, 0.9, 30);
  assert.ok(Number.isFinite(s[0]) && Math.abs(s[0]) < 100, `a 30 second frame is clamped, got ${s[0]}`);
  const dead = [0, 0];
  assert.equal(stepSpring(dead, 5, 180, 0.9, 0), 0, "no time is no movement");
});

// ===================================================================== folding a frame

test("rest is 1 for the keys that multiply and 0 for the ones that add", () => {
  assert.equal(restOf(K_OPACITY), 1);
  assert.equal(restOf(K_TY), 0);
  assert.ok(multiplies(K_OPACITY));
  assert.ok(!multiplies(K_ROT));
  assert.deepEqual(restValues(), [1, 0, 0, 1, 1, 1, 0, 0, 0]);
});

test("two sections on one key compose rather than one of them winning", () => {
  const c = compileMotion({
    enter: { translateY: { k: [[0, 10], [1, 0]] }, opacity: { k: [[0, 0], [1, 1]] } },
    loop: { translateY: { k: [[0, 0], [1, 4]] } },
  });
  const out = restValues();
  foldSection(out, c.enter, 1);
  foldSection(out, c.loop, 0.5);
  assert.equal(out[K_TY], 2, "the entrance has landed at 0 and the loop adds its 2");
  assert.equal(out[K_OPACITY], 1);
});

test("a frame reuses its own row of numbers", () => {
  const out = restValues();
  const c = compileMotion({ enter: { opacity: { k: [[0, 0], [1, 1]] } } });
  foldSection(out, c.enter, 1);
  assert.equal(out[K_OPACITY], 1);
  resetValues(out);
  assert.deepEqual(out, [1, 0, 0, 1, 1, 1, 0, 0, 0], "and goes back to rest without a new array");
});

test("springs fold from the row the view keeps, and a track with no slot is skipped", () => {
  const c = compileMotion({ enter: { scale: { spring: 1, from: 0.5, k: 200, damp: 0.7 } } });
  assert.equal(c.springs, 1);
  assert.equal(c.enter[0].slot, 0);
  const out = restValues();
  foldSprings(out, c.enter, [0.75, 0, 0, 0]);
  assert.equal(out[3], 0.75, "the scale is the spring's number right now");
});

// ===================================================================== compiling

test("the spec's own example compiles to what it says", () => {
  const c = compileMotion({
    enter: { opacity: { k: [[0, 0], [0.26, 1, "out"]] }, translateY: { k: [[0, 10], [0.26, 0, "out"]] } },
    exit: { opacity: { k: [[0, 1], [0.18, 0]] } },
    layout: { spring: true, k: 180, damp: 0.85 },
    drive: { translateY: { by: "ui.scrollY", k: [[0, 0], [120, -40]] } },
    loop: { rotate: { k: [[0, 0], [2, 360]], loop: true } },
    shared: "bot-42",
  });
  assert.equal(c.bad.length, 0, c.bad.join("; "));
  assert.equal(c.enterMs, 260);
  assert.equal(c.exitMs, 180);
  assert.equal(c.loopMs, 2000);
  assert.equal(c.shared, "bot-42");
  assert.deepEqual(c.layout, { k: 180, damp: 0.85, ms: 0, spring: true });
  assert.equal(c.drive[0].by, "scrollY", "the `ui.` is dropped: the bus keys on the bare name");
  assert.ok(c.loop[0].loop);
  assert.equal(sampleKeys(c.drive[0].flat, c.drive[0].n, false, 60), -20, "half way down the drive");
});

test("an unknown style key is ignored and the rest still plays", () => {
  const c = compileMotion({ enter: { width: { k: [[0, 0], [1, 100]] }, opacity: { k: [[0, 0], [1, 1]] } } });
  assert.equal(c.enter.length, 1, "width would re-lay-out the screen every frame; it is not a motion key");
  assert.equal(c.enter[0].key, K_OPACITY);
  assert.equal(c.bad.length, 0, "an unknown prop is ignored, not an error");
});

test("a bad value is left out and named, and never throws", () => {
  const c = compileMotion({
    enter: { opacity: { k: [[1, 0], [0, 1]] }, translateY: { k: [[0, 0], [1, 5]] } },
  });
  assert.equal(c.enter.length, 1, "keys that go backwards in time are refused");
  assert.ok(c.bad.some((b) => b.includes("forward in time")), c.bad.join("; "));
  assert.equal(compileMotion({ enter: { opacity: { k: [] } } }).enter.length, 0);
  assert.equal(compileMotion({ enter: { opacity: { k: [[0, Infinity]] } } }).enter.length, 0);
  assert.equal(compileMotion("fly"), NO_MOTION);
  assert.equal(compileMotion(null), NO_MOTION);
});

test("too many keys in one value is refused at the spec's number", () => {
  const ok = Array.from({ length: MOTION_LIMITS.keyframes }, (_, i) => [i / 100, i]);
  const over = Array.from({ length: MOTION_LIMITS.keyframes + 1 }, (_, i) => [i / 100, i]);
  assert.equal(compileMotion({ enter: { opacity: { k: ok } } }).enter.length, 1);
  assert.equal(compileMotion({ enter: { opacity: { k: over } } }).enter.length, 0);
});

test("a driven value must name an input, and may not be a spring", () => {
  assert.equal(compileMotion({ drive: { translateY: { k: [[0, 0], [1, 1]] } } }).drive.length, 0);
  assert.equal(compileMotion({ drive: { translateY: { by: "ui.a b", k: [[0, 0], [1, 1]] } } }).drive.length, 0);
  assert.equal(compileMotion({ drive: { translateY: { spring: 1 } } }).drive.length, 0);
  assert.equal(compileMotion({ drive: { translateY: { by: "pill.x", k: [[0, 0], [1, 1]] } } }).drive[0].by, "pill.x");
  assert.equal(
    compileMotion({ drive: { opacity: { by: "state.progress", k: [[0, 0], [1, 1]] } } }).drive[0].by,
    "state.progress",
    "a state path is kept whole: the renderer is the only thing that can mirror one onto the UI thread",
  );
});

test("a spring's numbers are clamped, never trusted", () => {
  const c = compileMotion({ enter: { scale: { spring: 1, k: -9, damp: 500 } } });
  assert.equal(c.enter[0].k, 1, "a stiffness below one is held at one");
  assert.equal(c.enter[0].damp, 4, "and a damping ratio is held at four");
});

test("a shared id must be short and plain, and the whole motion survives a bad one", () => {
  const c = compileMotion({ shared: "x".repeat(200), enter: { opacity: { k: [[0, 0], [1, 1]] } } });
  assert.equal(c.shared, "");
  assert.equal(c.enter.length, 1);
  assert.ok(c.bad.length > 0);
});

test("a motion with nothing in it is the shared empty one, so a screen without motion costs nothing", () => {
  assert.equal(compileMotion({}), NO_MOTION);
  assert.equal(movesAnything(NO_MOTION), false);
  assert.ok(movesAnything(compileMotion({ shared: "a" })), "a shared id alone is still something to do");
});

test("which style keys are ever touched is decided at compile time", () => {
  const mask = keysUsed(compileMotion({ enter: { opacity: { k: [[0, 0], [1, 1]] } }, loop: { rotate: { k: [[0, 0], [1, 360]] } } }));
  assert.ok(usesKey(mask, K_OPACITY));
  assert.ok(usesKey(mask, K_ROT));
  assert.ok(!usesKey(mask, K_TY), "so a node that only fades never pays for a translate it does not use");
});

// ===================================================================== reduce motion

test("reduced turns an entrance and an exit into a cross-fade", () => {
  const c = forMode(compileMotion({
    enter: { translateY: { k: [[0, 40], [0.4, 0]] } },
    exit: { translateY: { k: [[0, 0], [0.4, 40]] } },
  }), "reduced");
  assert.equal(c.enter.length, 1);
  assert.equal(c.enter[0].key, K_OPACITY, "it fades; it does not travel");
  assert.equal(sampleKeys(c.enter[0].flat, c.enter[0].n, false, 0), 0);
  assert.equal(sampleKeys(c.enter[0].flat, c.enter[0].n, false, 9), 1);
  assert.equal(c.exit[0].key, K_OPACITY);
  assert.equal(sampleKeys(c.exit[0].flat, c.exit[0].n, false, 9), 0);
});

test("reduced stops a loop at its first key and drops the shared flight", () => {
  const c = forMode(compileMotion({ loop: { rotate: { k: [[0, 30], [2, 390]], loop: true } }, shared: "a", layout: true }), "reduced");
  assert.equal(c.loop.length, 1);
  assert.equal(c.loop[0].n, 1);
  assert.equal(sampleKeys(c.loop[0].flat, 1, false, 99), 30, "it stands where it started");
  assert.equal(c.shared, "");
  assert.equal(c.layout, null);
});

test("reduced keeps what follows a finger, because that is the person moving, not the app", () => {
  const c = forMode(compileMotion({ drive: { translateY: { by: "ui.scrollY", k: [[0, 0], [100, -20]] } } }), "reduced");
  assert.equal(c.drive.length, 1);
});

test("off leaves every key at rest but still carries what could not be read", () => {
  const raw = compileMotion({ enter: { opacity: { k: [[0, 0], [1, 1]] } }, shared: 5 });
  const off = forMode(raw, "off");
  assert.equal(movesAnything(off), false);
  assert.deepEqual(off.bad, raw.bad, "the server still hears what was wrong with its screen");
});

test("on is the motion exactly as written", () => {
  const c = compileMotion({ enter: { translateY: { k: [[0, 10], [1, 0]] } } });
  assert.equal(forMode(c, "on"), c);
});

test("a key list is a flat row of sevens, so a frame reads numbers and never objects", () => {
  const c = compileMotion({ enter: { opacity: { k: [[0, 0], [0.5, 1]] } } });
  assert.equal(c.enter[0].flat.length, 2 * KSTRIDE);
  assert.ok(c.enter[0].flat.every((n) => typeof n === "number"));
});

// ===================================================================== what a bad screen may not do

test("a cubic ease with an x outside 0..1 is clamped and named, never handed on as it came", () => {
  // Reanimated's own Easing.bezier throws on an x outside the range, and that throw would happen while the
  // node was being drawn, so the node would vanish from the screen. Clamped, played, and reported.
  const c = compileMotion({ exit: { opacity: { k: [[0, 1], [0.3, 0, [1.4, 0, -0.2, 1]]] } } });
  assert.equal(c.exit.length, 1);
  const flat = c.exit[0].flat;
  assert.equal(flat[KSTRIDE + 2], E_CUBIC);
  assert.equal(flat[KSTRIDE + 3], 1, "x1 held at 1");
  assert.equal(flat[KSTRIDE + 5], 0, "x2 held at 0");
  assert.equal(flat[KSTRIDE + 4], 0, "the y's are left alone: an ease is allowed to overshoot");
  assert.ok(c.bad.some((b) => b.includes("x1 and x2")), "and the server hears about it");
});

test("a cubic ease inside the range is kept exactly", () => {
  const c = compileMotion({ enter: { opacity: { k: [[0, 0], [1, 1, [0.4, 0, 0.2, 1]]] } } });
  assert.deepEqual(c.enter[0].flat.slice(KSTRIDE + 3, KSTRIDE + 7), [0.4, 0, 0.2, 1]);
  assert.deepEqual(c.bad, []);
});

test("an exit spring is refused with a note, not dropped in silence", () => {
  const c = compileMotion({ exit: { opacity: { spring: 0 } } });
  assert.equal(c.exit.length, 0, "there is no end for a spring to leave on");
  assert.ok(c.bad.some((b) => b.startsWith("exit:")));
  assert.equal(movesAnything(c), false);
});

test("springs past the row the view keeps are left out and named", () => {
  const five = {
    enter: {
      opacity: { spring: 1 }, translateX: { spring: 0 }, translateY: { spring: 0 },
      scale: { spring: 1 }, rotate: { spring: 0 },
    },
  };
  const c = compileMotion(five);
  assert.equal(c.springs, MAX_SPRINGS, "four get a place in the row");
  assert.equal(c.enter.length, MAX_SPRINGS, "and the fifth is not kept as a track that never plays");
  assert.ok(c.bad.some((b) => b.includes("springs")));
  for (const t of c.enter) assert.ok(t.slot >= 0 && t.slot < MAX_SPRINGS);
});

test("reduced turns a shared move into the cross-fade the spec asks for", () => {
  // A node whose only motion was the flight: before, reduced motion left it with nothing at all and it
  // simply appeared, which reads as a missing feature rather than a quieter one.
  const c = forMode(compileMotion({ shared: "bot-42" }), "reduced");
  assert.equal(c.shared, "", "there is no flight");
  assert.equal(c.enter.length, 1);
  assert.equal(c.enter[0].key, K_OPACITY);
  assert.equal(sampleKeys(c.enter[0].flat, c.enter[0].n, false, 0), 0);
  assert.equal(sampleKeys(c.enter[0].flat, c.enter[0].n, false, 9), 1, "it fades in instead");
  assert.ok(c.enterMs > 0, "and the view is given a clock to fade it on");
});

// ===================================================================== how many may be alive

test("the live count reserves all or nothing, and gives back without going under", () => {
  const n = new LiveCount(3);
  assert.equal(n.take(2), true);
  assert.equal(n.live, 2);
  assert.equal(n.take(2), false, "two more would be five, so none of them are taken");
  assert.equal(n.live, 2, "and nothing was taken on the way to finding that out");
  assert.equal(n.take(1), true);
  assert.equal(n.take(1), false, "full");
  n.give(3);
  assert.equal(n.live, 0);
  n.give(5);
  assert.equal(n.live, 0, "a double release cannot make room that does not exist");
  assert.equal(n.take(0), true, "asking for nothing always works");
  n.take(3); n.reset();
  assert.equal(n.live, 0);
});

test("the motion limit is SPEC 5.1's 64 animated nodes", () => {
  const n = new LiveCount(MOTION_LIMITS.nodes);
  for (let i = 0; i < MOTION_LIMITS.nodes; i++) assert.equal(n.take(1), true);
  assert.equal(n.take(1), false, "the sixty-fifth node draws, without its motion");
});
