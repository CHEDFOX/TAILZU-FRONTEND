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
import { keepScrolled, scrolledTo, forgetScrolled } from "./scrollMemory.ts";

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
