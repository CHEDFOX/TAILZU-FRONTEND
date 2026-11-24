// node --test --experimental-strip-types src/sdui/shell/navStack.test.ts
//
// How a navigate changes the stack: back down to a screen already on it, never a second copy.
import test from "node:test";
import assert from "node:assert";
import { entryKey, pushEntry, replaceEntry, tabForEntry } from "./navStack.ts";

const ids = (s: Array<{ screenId: string; params?: Record<string, unknown> }>) => s.map(entryKey);

test("entryKey: key order, {} and undefined values do not matter", () => {
  assert.equal(entryKey({ screenId: "a" }), "a");
  assert.equal(entryKey({ screenId: "a", params: {} }), "a");
  assert.equal(entryKey({ screenId: "a", params: { x: undefined } }), "a");
  assert.equal(entryKey({ screenId: "a", params: { x: 1, y: "2" } }), entryKey({ screenId: "a", params: { y: "2", x: 1 } }));
  assert.notEqual(entryKey({ screenId: "a", params: { x: 1 } }), entryKey({ screenId: "a", params: { x: 2 } }));
  assert.notEqual(entryKey({ screenId: "a", params: { x: 1 } }), entryKey({ screenId: "a" }));
});

test("push: a new screen goes on top", () => {
  assert.deepEqual(ids(pushEntry([{ screenId: "talk" }], { screenId: "bot", params: { slug: "plan" } })), ["talk", 'bot::{"slug":"plan"}']);
});

test("push: a double tap does not stack the same screen twice, and the entry is the new one", () => {
  const s = [{ screenId: "talk" }, { screenId: "settings" }];
  const item = { screenId: "settings" };
  const out = pushEntry(s, item);
  assert.deepEqual(ids(out), ["talk", "settings"]);
  assert.strictEqual(out[1], item);
});

test("push: a screen's way out that navigates to one already underneath goes back down to it", () => {
  const s = [{ screenId: "bots.talk" }, { screenId: "bots.lingo" }, { screenId: "bots.lingoSet", params: { target: "fr" } }];
  assert.deepEqual(ids(pushEntry(s, { screenId: "bots.lingo" })), ["bots.talk", "bots.lingo"]);
});

test("push: the same screen with other params is a different place", () => {
  const s = [{ screenId: "talk" }, { screenId: "note", params: { id: "1" } }];
  assert.deepEqual(ids(pushEntry(s, { screenId: "note", params: { id: "2" } })), ["talk", 'note::{"id":"1"}', 'note::{"id":"2"}']);
});

test("replace: swaps the top", () => {
  assert.deepEqual(ids(replaceEntry([{ screenId: "a" }, { screenId: "plan", params: { day: "1" } }], { screenId: "plan", params: { day: "2" } })), ["a", 'plan::{"day":"2"}']);
  assert.deepEqual(ids(replaceEntry([], { screenId: "x" })), ["x"]);
});

test("replace: onto the screen right under the top leaves one of it, not two", () => {
  const s = [{ screenId: "talk" }, { screenId: "plan" }, { screenId: "planSend" }];
  assert.deepEqual(ids(replaceEntry(s, { screenId: "plan" })), ["talk", "plan"]);
});

test("tabForEntry: only a tab root with no params is a tab switch", () => {
  const tabs = [{ id: "talk", screenId: "bots.talk" }, { id: "activity", screenId: "bots.activities" }];
  assert.equal(tabForEntry(tabs, { screenId: "bots.activities" }), "activity");
  assert.equal(tabForEntry(tabs, { screenId: "bots.activities", params: {} }), "activity");
  assert.equal(tabForEntry(tabs, { screenId: "bots.activities", params: { f: 1 } }), null);
  assert.equal(tabForEntry(tabs, { screenId: "bots.bot" }), null);
  assert.equal(tabForEntry(undefined, { screenId: "bots.talk" }), null);
});
