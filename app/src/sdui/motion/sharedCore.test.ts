// node --test --experimental-strip-types src/sdui/motion/sharedCore.test.ts
//
// The shared-element move: a flight carries one box onto another about its CENTRE (the corner version is the
// off-by-half-a-box that makes a shared move look like it is aiming at the wrong thing), two boxes that are
// nearly the same are not worth flying, and the book pairs a node that left with one that arrives — once,
// inside its window, and never more flights at a time than the spec allows.

import test from "node:test";
import assert from "node:assert";
import { flightOf, okBox, SHARED_WINDOW_MS, SharedBook, worthFlying, type Box } from "./sharedCore.ts";

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

test("a flight starts at the old box and moves its centre onto the new one", () => {
  const f = flightOf(box(0, 0, 100, 100), box(200, 300, 50, 50));
  assert.equal(f.x, 0);
  assert.equal(f.y, 0);
  assert.equal(f.w, 100);
  assert.equal(f.h, 100);
  assert.equal(f.dx, 175, "centres: 225 - 50");
  assert.equal(f.dy, 275, "centres: 325 - 50");
  assert.equal(f.sx, 0.5);
  assert.equal(f.sy, 0.5);
});

test("a flight between identical boxes moves nothing", () => {
  const f = flightOf(box(10, 20, 30, 40), box(10, 20, 30, 40));
  assert.deepEqual([f.dx, f.dy, f.sx, f.sy], [0, 0, 1, 1]);
  assert.equal(worthFlying(box(10, 20, 30, 40), box(10, 20, 30, 40)), false);
  assert.equal(worthFlying(box(10, 20, 30, 40), box(10, 22, 30, 40)), true, "two points apart is worth it");
});

test("a box with no size is never flown from or to", () => {
  assert.equal(okBox(box(0, 0, 0, 20)), false);
  assert.equal(okBox(box(0, 0, 10, 10)), true);
  assert.equal(okBox(null), false);
  assert.equal(okBox({ x: NaN, y: 0, w: 10, h: 10 }), false);
  const f = flightOf(box(0, 0, 0, 0), box(0, 0, 10, 10));
  assert.ok(Number.isFinite(f.sx) && Number.isFinite(f.sy), "and a zero width never divides by nothing");
});

test("the book hands a leaving node's box to the one that arrives, once", () => {
  const b = new SharedBook<string>(2, SHARED_WINDOW_MS);
  b.note("bot-42", box(0, 0, 10, 10), "a copy", 1000);
  const first = b.claim("bot-42", 1100);
  assert.equal(first?.copy, "a copy");
  assert.deepEqual(first?.box, box(0, 0, 10, 10));
  assert.equal(b.claim("bot-42", 1120), null, "two arrivals cannot both fly from one departure");
});

test("a box left too long ago is not claimed", () => {
  const b = new SharedBook<string>();
  b.note("x", box(0, 0, 10, 10), "c", 0);
  assert.equal(b.claim("x", SHARED_WINDOW_MS + 1), null, "that is two unrelated screens, not a move");
});

test("a box that never really existed is not kept", () => {
  const b = new SharedBook<string>();
  b.note("x", box(0, 0, 0, 0), "c", 0);
  b.note("", box(0, 0, 10, 10), "c", 0);
  assert.equal(b.claim("x", 10), null);
});

test("no more flights at a time than the spec allows", () => {
  const b = new SharedBook<string>(2);
  b.note("a", box(0, 0, 10, 10), "a", 0); assert.ok(b.claim("a", 1));
  b.note("b", box(0, 0, 10, 10), "b", 0); assert.ok(b.claim("b", 1));
  b.note("c", box(0, 0, 10, 10), "c", 0);
  assert.equal(b.claim("c", 1), null, "the third waits rather than making the screen a flock");
  assert.equal(b.inFlight, 2);
  b.landed();
  b.note("d", box(0, 0, 10, 10), "d", 0);
  assert.ok(b.claim("d", 1), "and once one lands there is room again");
});

test("claiming reserves the place, so a burst in one frame cannot oversubscribe the air", () => {
  // Three arrivals in the same frame, before any of them has had a chance to take off. Reserving at the claim
  // is what stops the third from being told there is room, flying, and never being counted back.
  const b = new SharedBook<string>(2);
  for (const id of ["a", "b", "c"]) b.note(id, box(0, 0, 10, 10), id, 0);
  assert.ok(b.claim("a", 1));
  assert.ok(b.claim("b", 1));
  assert.equal(b.claim("c", 1), null);
  assert.equal(b.inFlight, 2, "two are spoken for before either has left the ground");
  // Both give their place back, whether they flew or were refused by the overlay.
  b.landed(); b.landed();
  assert.equal(b.inFlight, 0, "and the air is empty again, not quietly full for the rest of the launch");
});

test("landing never counts below nothing", () => {
  const b = new SharedBook<string>();
  b.landed();
  b.landed();
  assert.equal(b.inFlight, 0);
});

test("a sweep drops what nobody came for, and clear drops everything", () => {
  const b = new SharedBook<string>();
  b.note("old", box(0, 0, 10, 10), "o", 0);
  b.note("new", box(0, 0, 10, 10), "n", 10_000);
  b.sweep(10_000);
  assert.equal(b.claim("old", 10_000), null);
  assert.ok(b.claim("new", 10_010));
  b.note("x", box(0, 0, 10, 10), "x", 0);
  b.clear();
  assert.equal(b.inFlight, 0);
  assert.equal(b.claim("x", 1), null);
});
