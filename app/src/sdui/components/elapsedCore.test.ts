// node --test --experimental-strip-types src/sdui/components/elapsedCore.test.ts
//
// A call's running time ("On a call · 0:12"): minutes and seconds, hours past an hour, never below zero, and nothing at all for
// a start time that is not one.

import test from "node:test";
import assert from "node:assert";
import { elapsedText } from "./elapsedCore.ts";

const T0 = 1_762_850_000_000;

test("just answered reads 0:00", () => {
  assert.equal(elapsedText(T0, T0), "0:00");
  assert.equal(elapsedText(T0, T0 + 999), "0:00");
});

test("seconds, then minutes and seconds", () => {
  assert.equal(elapsedText(T0, T0 + 12_000), "0:12");
  assert.equal(elapsedText(T0, T0 + 65_000), "1:05");
  assert.equal(elapsedText(T0, T0 + 59 * 60_000 + 59_000), "59:59");
});

test("past an hour, hours too", () => {
  assert.equal(elapsedText(T0, T0 + 3723_000), "1:02:03");
  assert.equal(elapsedText(T0, T0 + 3600_000), "1:00:00");
});

test("a start still to come (a clock a little ahead) is held at 0:00, never negative", () => {
  assert.equal(elapsedText(T0 + 5_000, T0), "0:00");
});

test("the start may come as ms in a string, or as ISO", () => {
  assert.equal(elapsedText(String(T0), T0 + 12_000), "0:12");
  assert.equal(elapsedText(new Date(T0).toISOString(), T0 + 65_000), "1:05");
});

test("junk is nothing at all", () => {
  for (const junk of [undefined, null, "", "  ", "soon", {}, [], NaN, Infinity, true]) {
    assert.equal(elapsedText(junk, T0), "", String(junk));
  }
});
