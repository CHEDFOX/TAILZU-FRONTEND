// node --test --experimental-strip-types src/notifications/categoriesCore.test.ts
//
// A notification's buttons: the server's categories checked before they are registered, what each button sends, and the
// answers kept for later when the phone could not send them.

import test from "node:test";
import assert from "node:assert";
import { TAP_SEEN_CAP, answerKey, callFor, categoriesSignature, cleanCategories, fillTemplate, findAction, latestOnly, owe, pressedButton, pressKey, retryable, stillOwed, tapSeenKey } from "./categoriesCore.ts";

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

test("a button that opens says which it was; a plain tap says nothing", () => {
  const DEFAULT = "expo.modules.notifications.actions.DEFAULT";
  assert.equal(pressedButton("p_pay", DEFAULT), "p_pay");
  assert.equal(pressedButton(DEFAULT, DEFAULT), "");
  assert.equal(pressedButton(undefined, DEFAULT), "");
  assert.equal(pressedButton("x; rm -rf", DEFAULT), "");
});

// ------------------------------------------------------------------ one press, one key (Plan Ease follow-through)

/** The act door's key rule (tulmi src/widgets/act.ts KEY_RE): a key outside it is ignored and the item + button is used instead. */
const SERVER_KEY = /^[A-Za-z0-9_.:-]{8,120}$/;
const PUSH_A = "4f1c2b9e-7d3a-4c55-9a10-2e6f8b7c1d00";
const PUSH_B = "9b2d7e11-0c4f-4a3e-8f21-6d5c4b3a2f10";

test("a press's key: the same push and button is the same key, another button or another push is another", () => {
  const a = pressKey(PUSH_A, "f_later");
  assert.equal(a, `p${PUSH_A}:f_later`);
  assert.equal(pressKey(PUSH_A, "f_later"), a);
  assert.notEqual(pressKey(PUSH_A, "f_done"), a);
  // Later on climb 1 and Later on climb 2: two pushes (one collapse id, two push ids), two answers.
  assert.notEqual(pressKey(PUSH_B, "f_later"), a);
  assert.match(a!, SERVER_KEY);
});

test("a press's key keeps only what the server accepts, stays within 120, and is null without a real push id", () => {
  assert.equal(pressKey("ab/cd ef\ngh?ij", "f_done"), "pabcdefghij:f_done");
  assert.equal(pressKey(`${PUSH_A}\u0000<script>`, "f_done"), `p${PUSH_A}script:f_done`);
  const long = pressKey("x".repeat(300), "f_done")!;
  assert.ok(long.length <= 120);
  assert.match(long, SERVER_KEY);
  // The id gives way, never the button: two buttons of one long push are still two keys.
  assert.ok(long.endsWith(":f_done"));
  assert.notEqual(pressKey("x".repeat(300), "f_cant"), long);
  for (const id of [undefined, null, "", "short", "1234567", "///////////", 12345678, { id: PUSH_A }]) {
    assert.equal(pressKey(id, "f_done"), null, String(id));
  }
  assert.equal(pressKey("12345678", "f_done"), "p12345678:f_done");
  assert.equal(pressKey(PUSH_A, ""), null);
});

test("the key a press is answered under: the press's own for a button, a fresh one for typed words or a push without an id", () => {
  const cats = cleanCategories(DEFAULTS);
  let n = 0;
  const fresh = () => `k${++n}fresh0000`;
  assert.equal(answerKey(findAction(cats, "done")!, { item: "task:c1", pushId: PUSH_A }, fresh), `p${PUSH_A}:done`);
  assert.equal(answerKey(findAction(cats, "done")!, { item: "task:c1", pushId: PUSH_A }, fresh), `p${PUSH_A}:done`);
  assert.equal(answerKey(findAction(cats, "reply")!, { item: "thread:t1", pushId: PUSH_A }, fresh), "k1fresh0000");
  assert.equal(answerKey(findAction(cats, "reply")!, { item: "thread:t1", pushId: PUSH_A }, fresh), "k2fresh0000");
  assert.equal(answerKey(findAction(cats, "yes")!, { item: "task:c1" }, fresh), "k3fresh0000");
  assert.equal(answerKey(findAction(cats, "yes")!, { item: "task:c1", pushId: "p1" }, fresh), "k4fresh0000");
});

test("the same press still being answered by its other copy is tried again later, not reported as refused", () => {
  assert.equal(retryable(409, "in_progress"), true);
  assert.equal(retryable(409, "not_waiting"), false);
  assert.equal(retryable(409), false);
  assert.equal(retryable(400, "in_progress"), false);
});

/**
 * The server's follow buttons, copied from tulmi src/botsBots/planKinds.ts FOLLOW_CATEGORIES (docs/plan-ease.md "Follow-through"),
 * and the rest of the server's list by button id, in the server's order (experience/appKnobs.ts withPlanPush): the app's three
 * (DEFAULTS), PLAN_CATEGORIES, the follow's, then CALL_CATEGORIES. A follow button whose id is already taken would be left out by
 * the phone.
 */
const FOLLOW_CATEGORIES = [
  { id: "x0_follow", actions: [
    { id: "f_done", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" },
    { id: "f_later", title: "Later", icon: "clock", foreground: false, destructive: false, auth: false, act: "later" },
    { id: "f_cant", title: "Can't", icon: "xmark", foreground: false, destructive: false, auth: false, act: "cant" },
  ] },
  { id: "x0_follow_last", actions: [
    { id: "f_done2", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" },
    { id: "f_cant2", title: "Can't", icon: "xmark", foreground: false, destructive: false, auth: false, act: "cant" },
  ] },
  { id: "x0_follow_tell", actions: [
    { id: "f_call", title: "Call", icon: "phone", foreground: true, destructive: false, auth: false, open: true },
    { id: "f_done3", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" },
  ] },
  { id: "x0_follow_check", actions: [
    { id: "f_look", title: "Look", icon: "eye", foreground: true, destructive: false, auth: false, open: true },
    { id: "f_done5", title: "Done", icon: "checkmark", foreground: false, destructive: false, auth: false, act: "done" },
  ] },
  { id: "x0_follow_none", actions: [
    { id: "f_mine", title: "I'll do it", icon: "hand.raised", foreground: false, destructive: false, auth: false, act: "take" },
  ] },
];
const PLAN_BUTTONS: Record<string, string[]> = {
  x0_todo: ["p_done", "p_later"], x0_todo_last: ["p_done_last"], x0_leave: ["p_map"], x0_move: ["p_move", "p_keep"],
  x0_due: ["p_pay", "p_paid"], x0_wait: ["p_send", "p_sorted"], x0_came: ["p_came", "p_notcame"], x0_claim: ["p_take"],
  x0_in: ["p_in"], x0_turn: ["p_cant"], x0_paid: ["p_paid2"], x0_capture: ["p_addall", "p_look"],
};
const CALL_BUTTONS: Record<string, string[]> = { x0_call: ["p_answer", "p_notnow"], x0_call_missed: ["p_callback"] };
const stubs = (buttons: Record<string, string[]>) =>
  Object.entries(buttons).map(([id, ids]) => ({ id, actions: ids.map((b) => ({ id: b, title: "X", act: "x" })) }));

test("the copy of the server's follow buttons is the server's list exactly (planKinds.ts FOLLOW_CATEGORIES: five, no Send)", () => {
  assert.deepEqual(FOLLOW_CATEGORIES.map((c) => c.id), ["x0_follow", "x0_follow_last", "x0_follow_tell", "x0_follow_check", "x0_follow_none"]);
  assert.equal(FOLLOW_CATEGORIES.flatMap((c) => c.actions).some((a) => a.id === "f_send"), false);
});

test("the server's follow buttons pass the phone's checks whole: no category or button left out, alone or among the rest", () => {
  const alone = cleanCategories(FOLLOW_CATEGORIES);
  assert.deepEqual(alone, FOLLOW_CATEGORIES);
  const server = [...DEFAULTS, ...stubs(PLAN_BUTTONS), ...FOLLOW_CATEGORIES, ...stubs(CALL_BUTTONS)];
  const all = cleanCategories(server);
  assert.equal(all.length, server.length);
  assert.equal(all.flatMap((c) => c.actions).length, server.flatMap((c) => c.actions).length);
  assert.deepEqual(all.filter((c) => c.id.startsWith("x0_follow")), FOLLOW_CATEGORIES);
});

test("a follow press: the climb's own item, the button's act, and the press's key", () => {
  const cats = cleanCategories(FOLLOW_CATEGORIES);
  const data = { item: "pf:0c9a3c1e-5b7d-4e2f-9a8b-1c2d3e4f5a6b:2", screenId: "bots.plan.follow", pushId: PUSH_A, kind: "plan_follow" };
  const later = findAction(cats, "f_later")!;
  assert.deepEqual(callFor(later, data, "", answerKey(later, data, () => "fresh-key-1"), "/v1/widgets/act"), {
    kind: "act", path: "/v1/widgets/act", body: { item: data.item, action: "later", key: `p${PUSH_A}:f_later` },
  });
  const take = findAction(cats, "f_mine")!;
  assert.equal(callFor(take, data, "", answerKey(take, data, () => "fresh-key-1"), "/v1/widgets/act").kind, "act");
  assert.deepEqual(callFor(findAction(cats, "f_look")!, data, "", "k", "/v1/widgets/act"), { kind: "open" });
});

// ------------------------------------------------------------------ one tap, acted on once (push.ts)

test("a tap is remembered by its notification, its push and its button", () => {
  const n = "follow-0c9a3c1e-5b7d-4e2f-9a8b-1c2d3e4f5a6b";
  const first = tapSeenKey(n, { pushId: PUSH_A, item: "pf:x:1" }, "f_later");
  // The same response handed over twice (the launch tap and the listener): one key.
  assert.equal(tapSeenKey(n, { pushId: PUSH_A, item: "pf:x:1" }, "f_later"), first);
  // The follow's next push has the same identifier (its collapse id) but its own push id: not the same tap.
  assert.notEqual(tapSeenKey(n, { pushId: PUSH_B, item: "pf:x:2" }, "f_later"), first);
  assert.notEqual(tapSeenKey(n, { pushId: PUSH_B }, "expo.modules.notifications.actions.DEFAULT"), tapSeenKey(n, { pushId: PUSH_A }, "expo.modules.notifications.actions.DEFAULT"));
  // A tap and a press on the same push are two things.
  assert.notEqual(tapSeenKey(n, { pushId: PUSH_A }, "f_done"), first);
  // A notification of the phone's own (no push id): by its identifier and button, as before.
  assert.equal(tapSeenKey("local-1", {}, "reply"), "local-1::reply");
  assert.equal(tapSeenKey("local-1", null, undefined), "local-1::");
  assert.equal(tapSeenKey("local-1", { pushId: 42 }, "reply"), "local-1::reply");
  // No identifier: nothing to remember it by.
  assert.equal(tapSeenKey(undefined, { pushId: PUSH_A }, "f_done"), "");
  assert.equal(tapSeenKey("", { pushId: PUSH_A }, "f_done"), "");
  // The cap this JavaScript sends so the server may collapse a follow's pushes (push/tokens.ts PUSH_CAPS on the server).
  assert.equal(TAP_SEEN_CAP, "PushTapSeen");
});

// ------------------------------------------------------------------ the newest buttons registered (categories.ts)

test("one registration at a time, and one asked for meanwhile is run once more after it, never lost", async () => {
  const seen: number[] = [];
  let version = 1;
  let release: () => void = () => {};
  let runs = 0;
  const register = latestOnly(async () => {
    runs++;
    const v = version;   // read at the start, as categories.ts reads the knobs
    if (runs === 1) await new Promise<void>((r) => { release = r; });
    seen.push(v);
  });
  const first = register();
  version = 2;           // a newer bootstrap lands while the first is still registering
  const second = register();
  const third = register();
  assert.equal(second, first);
  assert.equal(third, first);
  release();
  await first;
  assert.deepEqual(seen, [1, 2]);   // two runs, not three; the last one saw the newest
  // Nothing running: the next ask runs at once, on its own.
  version = 3;
  await register();
  assert.deepEqual(seen, [1, 2, 3]);
});

test("a registration that fails does not stop the next one", async () => {
  let n = 0;
  const register = latestOnly(async () => { n++; if (n === 1) throw new Error("no"); });
  await register();
  await register();
  assert.equal(n, 2);
});
