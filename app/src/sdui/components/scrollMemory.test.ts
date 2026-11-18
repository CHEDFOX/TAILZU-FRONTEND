/**
 * WHERE A PAGE WAS LEFT (components/scrollMemory.ts).
 *
 * The shell draws only the top of the stack, so coming back to a page is a fresh mount and every ref in it starts
 * again. This is the one piece of that state worth keeping, and these are the things it has to get right: a page
 * never seen opens at the top, two bots on one screen id are not the same page, and a long session cannot grow it
 * without end.
 */
import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { keepScrolled, scrolledTo, forgetScrolled, landing } from "./scrollMemory.ts";

beforeEach(() => forgetScrolled());

test("a page never seen opens at the top", () => {
  assert.equal(scrolledTo("bots.home:{}"), 0);
  assert.equal(scrolledTo(undefined), 0);
});

test("a page comes back where it was left", () => {
  keepScrolled("bots.home:{}", 420);
  assert.equal(scrolledTo("bots.home:{}"), 420);
});

test("two bots on one screen id are not the same page", () => {
  keepScrolled('bots.bot:{"slug":"code"}', 300);
  keepScrolled('bots.bot:{"slug":"travel"}', 90);
  assert.equal(scrolledTo('bots.bot:{"slug":"code"}'), 300);
  assert.equal(scrolledTo('bots.bot:{"slug":"travel"}'), 90);
});

test("scrolling back to the top is remembered as the top, not as the last place away from it", () => {
  keepScrolled("bots.home:{}", 500);
  keepScrolled("bots.home:{}", 0);
  assert.equal(scrolledTo("bots.home:{}"), 0);
});

test("a negative offset (an over-scroll at the top) is kept as the top", () => {
  keepScrolled("bots.home:{}", -60);
  assert.equal(scrolledTo("bots.home:{}"), 0);
});

test("no key, nothing kept: a screen the shell has no identity for cannot collide with one it does", () => {
  keepScrolled(undefined, 200);
  assert.equal(scrolledTo(undefined), 0);
});

test("a long session cannot grow it without end, and the oldest go first", () => {
  for (let i = 0; i < 80; i++) keepScrolled(`s${i}:{}`, i + 1);
  // The earliest are gone; the most recent are all still there.
  assert.equal(scrolledTo("s0:{}"), 0);
  assert.equal(scrolledTo("s79:{}"), 80);
  assert.equal(scrolledTo("s79:{}") > 0 && scrolledTo("s78:{}") > 0, true);
});

test("seeing a page again keeps it from being the next one dropped", () => {
  keepScrolled("old:{}", 10);
  for (let i = 0; i < 59; i++) keepScrolled(`f${i}:{}`, i + 1);
  // Touched again, so it is the most recent rather than the oldest.
  keepScrolled("old:{}", 11);
  for (let i = 0; i < 30; i++) keepScrolled(`g${i}:{}`, i + 1);
  assert.equal(scrolledTo("old:{}"), 11);
});

test("A PAGE THAT IS NOT TALL YET IS NOT SETTLED: the restore has to try again as it grows", () => {
  // left 900 down; the first pass is a third of the page
  const first = landing(900, 500, 800);
  assert.equal(first.y, 0, "nothing worth scrolling to yet");
  assert.equal(first.settled, false, "and it is not finished");
  // the tiles measure
  const second = landing(900, 1200, 800);
  assert.equal(second.y, 400);
  assert.equal(second.settled, false, "still short of where they were");
  // the page is whole
  const last = landing(900, 1800, 800);
  assert.equal(last.y, 900, "exactly where they left it");
  assert.equal(last.settled, true);
});

test("the furthest a page can go is its content LESS one screenful", () => {
  assert.deepEqual(landing(900, 1000, 800), { y: 200, settled: false });
  // a view of 0 is an UNMEASURED viewport, and taking it at its word lets through an offset that snaps back
  assert.equal(landing(900, 1000, 0).y, 900);
});

test("a page never seen, and one left at the top, ask for nothing and are already finished", () => {
  assert.deepEqual(landing(0, 1800, 800), { y: 0, settled: true });
  assert.deepEqual(landing(0, 0, 0), { y: 0, settled: true });
});

test("a page shorter than its own viewport cannot scroll, and says so rather than leaving it owing", () => {
  assert.deepEqual(landing(0, 300, 800), { y: 0, settled: true });
  assert.equal(landing(120, 300, 800).settled, false, "but one that was scrolled is still owed it");
});

test("nothing silly comes back out: no negatives, whatever goes in", () => {
  for (const [s, c, v] of [[-50, 1000, 800], [900, -10, 800], [900, 1000, -800]] as const) {
    const r = landing(s, c, v);
    assert.ok(r.y >= 0, `y ${r.y}`);
    assert.ok(Number.isFinite(r.y));
  }
});
