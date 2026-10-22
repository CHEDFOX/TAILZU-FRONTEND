// node --test --experimental-strip-types src/onboard/blipMotion.test.ts
//
// How Blip moves, held to the approved prototype's numbers. The desktop is held
// to the same ones.

import test from "node:test";
import assert from "node:assert";
import {
  BUBBLE, Blip, CONFETTI, CROUCH_MS, EASE, GLIDE, GLIDE_REDUCED, HOP_MS, NEAR_PX, REDUCED_SNAP_MS,
  anchorsFor, boxOf, cellFor, confettiPieces, isHop, planArrival, travelMs, walkPose,
} from "./blipMotion.ts";

test("the glide is 26 px, 230 out, 320 in after 60, on one curve; reduced motion is a plain fade", () => {
  assert.deepEqual({ ...GLIDE }, { slide: 26, outMs: 230, inMs: 320, inDelayMs: 60 });
  assert.deepEqual({ ...GLIDE_REDUCED }, { slide: 0, outMs: 260, inMs: 260, inDelayMs: 0 });
  assert.deepEqual([...EASE], [0.32, 0.72, 0, 1]);
  assert.equal(GLIDE.inDelayMs + GLIDE.inMs, 380, "about 380 ms from first move to last");
});

test("under 46 away he hops for 460 ms; further, he walks clamp(430 + 2.3 d, 520, 960)", () => {
  assert.equal(isHop(45.9), true);
  assert.equal(isHop(46), false);
  assert.equal(travelMs(10), HOP_MS);
  assert.equal(HOP_MS, 460);
  assert.ok(Math.abs(travelMs(46) - 535.8) < 1e-9, "the shortest walk is 430 + 105.8, so the 520 floor is only a guard");
  assert.equal(travelMs(100), 660);
  assert.equal(travelMs(200), 890);
  assert.equal(travelMs(231), 960);
  assert.equal(travelMs(2000), 960, "capped");
  assert.ok(Math.abs(travelMs(150) - (430 + 150 * 2.3)) < 1e-9);
});

test("a journey starts with a 90 ms crouch and carries the hop or walk times it was given", () => {
  const b = new Blip(2, 0);
  b.snap(0, 0, 100);
  b.travel(100, 0, 100, "tap", undefined, 1000);
  assert.equal(CROUCH_MS, 90);
  assert.equal(b.tr!.t0, 1000 + 90);
  assert.equal(b.tr!.T, 660);
  assert.equal(b.tr!.hop, false);
  assert.equal(b.tr!.swapAt, 0.6);
  const h = new Blip(2, 0);
  h.snap(0, 0, 100);
  h.travel(20, 0, 100, "tap", undefined, 0);
  assert.equal(h.tr!.hop, true);
  assert.equal(h.tr!.T, 460);
  assert.equal(h.tr!.swapAt, 0.45);
});

test("a change of height counts toward the distance, half as much", () => {
  const b = new Blip(2, 0);
  b.snap(0, 0, 100);
  b.travel(0, 0, 196, "wave", undefined, 0);
  assert.equal(b.tr!.dist, 48);
  assert.equal(b.tr!.hop, false, "48 is not under 46");
});

test("he crouches, then changes pose 60% of the way (45% for a hop), and lands with the callback", () => {
  const b = new Blip(2, 0);
  b.snap(0, 0, 100);
  b.pose = "walk";
  let landed = 0;
  b.travel(200, 0, 100, "listen", () => { landed++; }, 0);
  const T = b.tr!.T;
  b.tick(10);
  b.tick(50);
  assert.equal(b.x, 0, "still crouching: he has not moved");
  assert.ok(b.sq > 0, "and he is squashed");
  b.tick(90 + T * 0.5);
  assert.equal(b.pose, "walk", "not yet");
  b.tick(90 + T * 0.61);
  assert.equal(b.pose, "listen", "swapped past 60%");
  assert.equal(landed, 0);
  b.tick(90 + T + 5);
  assert.equal(landed, 1);
  assert.equal(b.tr, null);
  assert.equal(b.x, 200);
  assert.equal(b.pose, "listen");
  assert.ok(b.sq > 0.04 && b.sq < 0.17, "lands with a squash, already springing back");
  for (let ms = 90 + T + 5; ms < 90 + T + 1200; ms += 16) b.tick(ms);
  assert.equal(b.sq, 0, "which settles to exactly zero");

  const h = new Blip(2, 0);
  h.snap(0, 0, 100);
  h.pose = "walk";
  h.travel(20, 0, 100, "tada", undefined, 0);
  h.tick(10);
  h.tick(90 + 460 * 0.46);
  assert.equal(h.pose, "tada", "a hop swaps at 45%");
  assert.ok(h.lift > 0, "and is off the ground");
});

test("he walks, except in poses that hold something, which he keeps", () => {
  assert.equal(walkPose("present"), "walk");
  assert.equal(walkPose("listen"), "walk");
  assert.equal(walkPose("tada"), "walk");
  assert.equal(walkPose("wave"), "wave");
  assert.equal(walkPose("key"), "key");
  assert.equal(walkPose("carry"), "carry");
});

test("a spot within 8 px at the same height is the same place: he only changes pose", () => {
  const at = { placed: true, x: 100, y: 200, h: 96 };
  assert.equal(NEAR_PX, 8);
  assert.equal(planArrival(at, { x: 100, y: 200, h: 96 }, false).kind, "repose");
  assert.equal(planArrival(at, { x: 108, y: 192, h: 96 }, false).kind, "repose", "8 is still near");
  assert.equal(planArrival(at, { x: 109, y: 200, h: 96 }, false).kind, "travel", "9 is not");
  assert.equal(planArrival(at, { x: 100, y: 200, h: 100 }, false).kind, "travel", "a different height is a different spot");
});

test("the first spot, and the first after he was let go, he is simply there", () => {
  const p = planArrival({ placed: false, x: 0, y: 0, h: 0 }, { x: 80, y: 400, h: 110 }, false);
  assert.deepEqual(p, { kind: "snap", delayMs: 0 });
  // Reduced motion changes nothing for a first placement.
  assert.deepEqual(planArrival({ placed: false, x: 0, y: 0, h: 0 }, { x: 80, y: 400, h: 110 }, true), { kind: "snap", delayMs: 0 });
});

test("with reduced motion he does not walk: he is there after 160 ms", () => {
  assert.equal(REDUCED_SNAP_MS, 160);
  const p = planArrival({ placed: true, x: 0, y: 0, h: 100 }, { x: 300, y: 500, h: 100 }, true);
  assert.deepEqual(p, { kind: "snap", delayMs: 160 });
  // Even then, the same place is just a new pose.
  assert.equal(planArrival({ placed: true, x: 0, y: 0, h: 100 }, { x: 3, y: 2, h: 100 }, true).kind, "repose");
});

test("a scroll under him moves him, and the journey he is on, by the same amount", () => {
  const b = new Blip(2, 0);
  b.snap(50, 300, 100);
  b.travel(50, 600, 100, "tap", undefined, 0);
  b.shiftY(-40);
  assert.equal(b.y, 260);
  assert.equal(b.tr!.y0, 260);
  assert.equal(b.tr!.y1, 560);
});

test("his feet are the middle of the bottom of the box; his words start inside its right edge", () => {
  const rect = { x: 20, y: 100, w: 140, h: 120 };
  const side = anchorsFor({ h: 100, bubble: "side" }, rect);
  assert.deepEqual(side, { footX: 90, footY: 218, bubX: 20 + 140 - 16, bubY: 100 + 10, anchor: "left" });
  const corner = anchorsFor({ h: 196, bubble: "corner" }, { x: 20, y: 80, w: 320, h: 232 });
  assert.deepEqual(corner, { footX: 180, footY: 310, bubX: 330, bubY: 86, anchor: "right" });
});

test("the box a spot reserves is 1.4 wide and 1.16 + 4 tall", () => {
  assert.deepEqual(boxOf(196), { w: 275, h: 232 });
  assert.deepEqual(boxOf(100), { w: 140, h: 120 });
});

test("one grey pixel is about a 92nd of him, never finer than two device pixels", () => {
  assert.equal(cellFor(196, 2), 2);
  assert.equal(cellFor(110, 2), 1);
  assert.equal(cellFor(60, 3), 2 / 3);
  assert.equal(cellFor(196, 3), 2);
});

test("confetti is 22 pieces thrown from him, in four colours, gone in 1.2 s", () => {
  const pieces = confettiPieces(() => 0.5);
  assert.equal(pieces.length, 22);
  assert.equal(CONFETTI.pieces, 22);
  assert.equal(CONFETTI.ms, 1200);
  assert.deepEqual(new Set(pieces.map((p) => p.color)), new Set([0, 1, 2, 3]));
  const hi = confettiPieces(() => 1), lo = confettiPieces(() => 0);
  assert.ok(hi.every((p) => p.dx === 120 && p.dy === 70 && p.rot === 360));
  assert.ok(lo.every((p) => p.dx === -120 && p.dy === -130 && p.rot === -360));
  assert.equal(BUBBLE.burstDelayMs, 250);
});

test("the bubble appears over 200 ms, grows from .88 over 320, and says again from .93 over 220", () => {
  assert.deepEqual({ ...BUBBLE }, {
    fadeMs: 200, growMs: 320, fromScale: 0.88, rise: 5, resayFrom: 0.93, resayMs: 220, tilt: -1.5, burstDelayMs: 250,
  });
});

test("his pose springs toward its target, and reduced motion takes it at once", () => {
  const b = new Blip(2, 0);
  b.pose = "tada";
  const one = b.frame(0.016, false);
  assert.ok(one.st.ra[0] < 2.62 && one.st.ra[0] > 1.22, "on its way");
  for (let i = 0; i < 200; i++) b.frame(0.016, false);
  assert.ok(Math.abs(b.S.ra0 - 2.62) < 0.02, "arrived");
  const s = new Blip(2, 0);
  s.pose = "tada";
  const f = s.frame(0.016, true);
  assert.equal(f.st.ra[0], 2.62, "at once");
  assert.equal(f.st.bob, 0, "no bob");
  assert.equal(f.st.swayK, 0, "no sway");
  assert.equal(f.t, 0.5, "and a clock that does not run, so no blink");
  assert.equal(f.glow, 0.9, "his glow is just there");
});

test("walking swings his legs and the dropped body; standing does not", () => {
  const b = new Blip(2, 0);
  b.walk = 1; b.ph = Math.PI / 3;
  const w = b.frame(0.016, true);
  assert.ok(Math.abs(w.st.legs[0].th) > 0.1);
  assert.ok(w.st.drop > 0);
  const s = new Blip(2, 0);
  const st = s.frame(0.016, true);
  assert.equal(st.st.legs[0].th, 0);
  assert.equal(st.st.drop, 0);
});
