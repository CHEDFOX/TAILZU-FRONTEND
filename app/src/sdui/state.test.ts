// node --test --experimental-strip-types src/sdui/state.test.ts
//
// A state path is data — a screen's, a link's — and must never reach the
// prototype every object in the app shares.

import test from "node:test";
import assert from "node:assert";
import { Store } from "./state.ts";

test("a path cannot write to Object.prototype", () => {
  const s = new Store({});
  s.set("__proto__.polluted", "yes");
  s.set("a.__proto__.polluted", "yes");
  s.set("constructor.prototype.polluted", "yes");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("ordinary paths still read and write", () => {
  const s = new Store({ a: { b: 1 } });
  s.set("a.c", 2);
  s.set("x.y.z", "deep");
  assert.equal(s.get("a.b"), 1);
  assert.equal(s.get("a.c"), 2);
  assert.equal(s.get("x.y.z"), "deep");
  assert.equal(s.get(""), undefined);
});
