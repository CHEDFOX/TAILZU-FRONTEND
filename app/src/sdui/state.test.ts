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

test("a path that is not a string reads as nothing, never a throw", () => {
  const s = new Store({ who: "Blip" });
  // `bind: { content: { $: "state.who" } }` used to arrive here as that object (SPEC 2.2, bind by expression).
  assert.strictEqual(s.get({ $: "state.who" } as unknown as string), undefined);
  assert.strictEqual(s.get("who"), "Blip");
});
