// node --test --experimental-strip-types src/notifications/categoriesCore.test.ts
//
// A notification's buttons: the server's categories checked before they are registered, what each button sends, and the
// answers kept for later when the phone could not send them.

import test from "node:test";
import assert from "node:assert";
import { callFor, categoriesSignature, cleanCategories, fillTemplate, findAction, owe, retryable, stillOwed } from "./categoriesCore.ts";

const DEFAULTS = [
  { id: "x0_reply", actions: [{ id: "reply", title: "Reply", icon: "arrowshape.turn.up.left", input: { placeholder: "Reply…", send: "Send" }, foreground: false, act: "reply" }] },
  { id: "x0_task", actions: [{ id: "done", title: "Done", icon: "checkmark", foreground: false, act: "done" }] },
  { id: "x0_yesno", actions: [{ id: "yes", title: "Yes", foreground: false, auth: true, act: "yes" }, { id: "no", title: "No", foreground: false, act: "no" }] },
];

test("the server's categories, checked: bad ids, buttons that do nothing, paths off the API and repeats are left out", () => {
  const cats = cleanCategories([
    ...DEFAULTS,
    { id: "bad-id", actions: [{ id: "x", title: "X", act: "x" }] },
    { id: "x0_reply", actions: [{ id: "again", title: "Again", act: "reply" }] },
    { id: "x0_odd", actions: [
      { id: "leak", title: "Leak", call: { method: "POST", path: "https://evil.com/x" } },
      { id: "up", title: "Up", call: { method: "POST", path: "/v1/../admin" } },
      { id: "nothing", title: "Nothing" },
      { id: "done", title: "Done again", act: "done" },
      { id: "snooze", title: "Later", call: { method: "post", path: "/v1/botsapp/calendar/tasks/{data.todoId}", body: { snooze: 60 } } },
      { id: "open", title: "Open", open: true },
    ] },
    "nope", null,
  ]);
  assert.deepEqual(cats.map((c) => c.id), ["x0_reply", "x0_task", "x0_yesno", "x0_odd"]);
  assert.deepEqual(cats[3]!.actions.map((a) => a.id), ["snooze", "open"]);
  assert.equal(cats[3]!.actions[0]!.call!.method, "POST");
  assert.deepEqual(cats[0]!.actions[0], { id: "reply", title: "Reply", icon: "arrowshape.turn.up.left", input: { placeholder: "Reply…", send: "Send" }, foreground: false, destructive: false, auth: false, act: "reply" });
  assert.equal(cats[2]!.actions[0]!.auth, true);
  assert.deepEqual(cleanCategories("x"), []);
});

test("a signature that moves only when the list does", () => {
  const a = cleanCategories(DEFAULTS);
  assert.equal(categoriesSignature(a), categoriesSignature(cleanCategories(DEFAULTS)));
  assert.notEqual(categoriesSignature(a), categoriesSignature(cleanCategories([{ ...DEFAULTS[0]!, actions: [{ ...DEFAULTS[0]!.actions[0]!, title: "Answer" }] }])));
});

test("what a press sends: the item the push named, the button, the words, its key", () => {
  const cats = cleanCategories(DEFAULTS);
  const reply = findAction(cats, "reply")!;
  assert.deepEqual(callFor(reply, { item: "thread:t1", screenId: "bots.chats" }, "  On my way ", "key-00000001", "/v1/widgets/act"), {
    kind: "act", path: "/v1/widgets/act", body: { item: "thread:t1", action: "reply", text: "On my way", key: "key-00000001" },
  });
  assert.deepEqual(callFor(reply, { item: "thread:t1" }, "  ", "k", "/v1/widgets/act"), { kind: "none", why: "nothing typed" });
  assert.deepEqual(callFor(findAction(cats, "done")!, {}, "", "k", "/v1/widgets/act"), { kind: "none", why: "no item" });
  assert.deepEqual(callFor(findAction(cats, "yes")!, { item: "task:c1" }, "", "k2", "/v1/widgets/act").kind, "act");
  assert.equal(findAction(cats, "nope"), null);

  const custom = cleanCategories([{ id: "x0_plan", actions: [
    { id: "snooze", title: "Later", call: { method: "PUT", path: "/v1/botsapp/calendar/tasks/{data.todoId}", body: { snoozeMin: 60, note: "{text}" } } },
    { id: "open", title: "Open", open: true },
  ] }]);
  assert.deepEqual(callFor(findAction(custom, "snooze")!, { todoId: "td9" }, "", "k", "/v1/widgets/act"), {
    kind: "call", method: "PUT", path: "/v1/botsapp/calendar/tasks/td9", body: { snoozeMin: 60, note: "" },
  });
  assert.deepEqual(callFor(findAction(custom, "snooze")!, {}, "", "k", "/v1/widgets/act"), { kind: "none", why: "no path" });
  assert.deepEqual(callFor(findAction(custom, "open")!, {}, "", "k", "/v1/widgets/act"), { kind: "open" });
});

test("templates fill whole or not at all", () => {
  assert.equal(fillTemplate("/v1/x/{data.a}/{text}", { a: "1" }, "hi"), "/v1/x/1/hi");
  assert.equal(fillTemplate("/v1/x/{data.b}", { a: "1" }, ""), "");
  assert.equal(fillTemplate("/v1/x/{data.a}", { a: { x: 1 } }, ""), "");
});

test("answers owed: once per key, newest kept, given up when old or tried too often", () => {
  const call = { kind: "act" as const, path: "/v1/widgets/act", body: { item: "stask:s:t", action: "done", key: "a" } };
  let list = owe([], { key: "a", call, at: 0, tries: 0 });
  list = owe(list, { key: "a", call, at: 5, tries: 1 });
  list = owe(list, { key: "b", call, at: 6, tries: 0 });
  assert.deepEqual(list.map((o) => [o.key, o.at]), [["a", 5], ["b", 6]]);
  assert.equal(owe(list, { key: "c", call, at: 7, tries: 0 }, 2).length, 2);
  assert.deepEqual(stillOwed([{ key: "x", call, at: 0, tries: 0 }, { key: "y", call, at: 90, tries: 0 }, { key: "z", call, at: 95, tries: 5 }], 100, 50, 5).map((o) => o.key), ["y"]);
  assert.equal(retryable(undefined), true);
  assert.equal(retryable(503), true);
  assert.equal(retryable(429), true);
  assert.equal(retryable(403), false);
  assert.equal(retryable(409), false);
});
