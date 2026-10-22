// node --test --experimental-strip-types src/sdui/fontGate.test.ts
//
// The sign-in gate may wait for its two faces, but only a moment, and only for
// faces that are actually coming.

import test from "node:test";
import assert from "node:assert";
import { createFontGate } from "./fontGate.ts";

const settles = async (p: Promise<void>, ms: number): Promise<"done" | "pending"> =>
  Promise.race([p.then(() => "done" as const), new Promise<"pending">((r) => setTimeout(() => r("pending"), ms))]);

test("nothing is waited for when nothing is loading", async () => {
  const g = createFontGate();
  assert.equal(await settles(g.ready(["Tailzu Grotesk", "Tailzu Hand"], 1000), 50), "done");
});

test("a face that is loading is waited for, and the wait ends when it lands", async () => {
  const g = createFontGate();
  g.start("A"); g.start("B");
  const p = g.ready(["A", "B"], 5000);
  assert.equal(await settles(p, 30), "pending");
  g.done("A", true);
  assert.equal(await settles(p, 30), "pending", "one of two is not enough");
  g.done("B", true);
  assert.equal(await settles(p, 30), "done");
});

test("a face that fails is not waited for either", async () => {
  const g = createFontGate();
  g.start("A");
  const p = g.ready(["A"], 5000);
  g.done("A", false);
  assert.equal(await settles(p, 30), "done");
  assert.equal(g.known("A"), false, "and it can be tried again on the next bootstrap");
});

test("the wait ends at the deadline whatever has happened", async () => {
  const g = createFontGate();
  g.start("A");
  const t0 = Date.now();
  await g.ready(["A"], 60);
  const took = Date.now() - t0;
  assert.ok(took >= 50 && took < 400, `ended at the deadline, took ${took} ms`);
});

test("faces that are loaded, or were never asked for, do not hold anyone up", async () => {
  const g = createFontGate();
  g.start("A"); g.done("A", true);
  assert.equal(g.loaded("A"), true);
  assert.equal(g.known("A"), true);
  assert.equal(await settles(g.ready(["A", "never-requested"], 1000), 30), "done");
  g.start("B");
  const p = g.ready(["A", "B", "never-requested"], 1000);
  assert.equal(await settles(p, 30), "pending", "only B is being waited for");
  g.done("B", true);
  assert.equal(await settles(p, 30), "done");
});
