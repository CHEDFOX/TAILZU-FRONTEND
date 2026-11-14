// node --test --experimental-strip-types src/device/remindersCore.test.ts
//
// One list's rules (docs: perms2 3): the path is pinned, ask:false never prompts, only a title, a due date and done cross in
// either direction, and the second request carries only the links of items really added.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ITEMS, REMINDERS_PATH, cleanApplied, cleanItems, cleanOps, opsEmpty, remindersPathOk, remindersSync,
  type RemindersDeps, type RemindersReady, type SyncOps,
} from "./remindersCore.ts";

const ITEM = { ext: "ext-1", title: "Pick up dry cleaning", dueIso: "2026-11-15T04:30:00.000Z", dueHasTime: true, done: false, changedAt: "2026-11-14T09:00:00.000Z" };

function deps(over: Partial<RemindersDeps> = {}) {
  const posted: { path: string; body: unknown }[] = [];
  const applied: SyncOps[] = [];
  const d: RemindersDeps = {
    now: () => new Date("2026-11-14T09:40:00.000Z"),
    prepare: async () => "ready" as RemindersReady,
    read: async () => ({ listId: "list-x0", items: [ITEM] }),
    apply: async (ops) => { applied.push(ops); return { applied: ops.add.map((a) => ({ id: a.id, ext: `new-${a.id}` })) }; },
    post: async (path, body) => {
      posted.push({ path, body });
      // the first request's answer; the second answers nothing
      return posted.length === 1 ? { add: [{ id: "todo-9", title: "Call the plumber", dueHasTime: false }], update: [], remove: [] } : {};
    },
    everyMs: 0,
    lastAt: new Map<string, number>(),
    ...over,
  };
  return Object.assign(d, { posted, applied });
}

test("the path is pinned: nothing is read off it", async () => {
  assert.ok(remindersPathOk(REMINDERS_PATH));
  for (const p of ["/ask", "/v1/botsapp/plan/reminders", "", null]) assert.ok(!remindersPathOk(p as never));
  let read = 0;
  const d = deps({ read: async () => { read++; return { listId: "l", items: [] }; } });
  assert.deepEqual(await remindersSync({ path: "/v1/botsapp/plan/reminders", ask: true }, d), { outcome: "error" });
  assert.equal(read, 0);
  assert.equal(d.posted.length, 0);
});

test("ask:false never prompts; denied, blocked and unavailable post nothing", async () => {
  for (const ready of ["denied", "blocked", "unavailable"] as const) {
    const d = deps({ prepare: async () => ready });
    assert.deepEqual(await remindersSync({ path: REMINDERS_PATH }, d), { outcome: ready });
    assert.equal(d.posted.length, 0);
  }
  const d = deps({ prepare: async (ask) => { assert.equal(ask, false); return "ready"; } });
  await remindersSync({ path: REMINDERS_PATH }, d);
});

test("one sync is two requests: the list up, the ops applied, the links up", async () => {
  const d = deps();
  assert.deepEqual(await remindersSync({ path: REMINDERS_PATH, ask: true, enable: true }, d), { outcome: "synced" });
  assert.equal(d.posted.length, 2);
  assert.deepEqual(d.posted[0], { path: REMINDERS_PATH, body: { enable: true, listId: "list-x0", items: [ITEM] } });
  assert.deepEqual(d.applied[0], { listId: "list-x0", add: [{ id: "todo-9", title: "Call the plumber", dueHasTime: false }], update: [], remove: [] });
  assert.deepEqual(d.posted[1], { path: REMINDERS_PATH, body: { applied: [{ id: "todo-9", ext: "new-todo-9" }] } });
});

test("nothing to do means no second request and no write to the list", async () => {
  const d = deps({ post: async (path, body) => { d.posted.push({ path, body }); return { add: [], update: [], remove: [] }; } });
  d.posted.length = 0;
  assert.deepEqual(await remindersSync({ path: REMINDERS_PATH }, d), { outcome: "synced" });
  assert.equal(d.posted.length, 1);
  assert.equal(d.applied.length, 0);
});

test("a list the module cannot name is an error, not a guess", async () => {
  for (const listId of [undefined, "", 7, null, "x".repeat(400)]) {
    const d = deps({ read: async () => ({ listId, items: [] }) as never });
    assert.deepEqual(await remindersSync({ path: REMINDERS_PATH }, d), { outcome: "error" });
    assert.equal(d.posted.length, 0);
  }
});

test("a run within everyMs is skipped; asking or enabling is never skipped", async () => {
  const d = deps({ everyMs: 900_000 });
  await remindersSync({ path: REMINDERS_PATH }, d);
  assert.deepEqual(await remindersSync({ path: REMINDERS_PATH }, d), { outcome: "skipped" });
  assert.deepEqual(await remindersSync({ path: REMINDERS_PATH, enable: true }, d), { outcome: "synced" });
});

test("only a title, a due date, done and when it changed come up from the list", () => {
  const got = cleanItems([
    { ...ITEM, notes: "secret", url: "https://x", location: "home", priority: 1, subtasks: [1] },
    { ext: "", title: "no id" },
    { ext: "e2", title: "" },
    { ext: "e3", title: "ok", changedAt: "nonsense", dueIso: "nonsense" },
    "nope",
  ]);
  assert.deepEqual(Object.keys(got[0]).sort(), ["changedAt", "done", "dueHasTime", "dueIso", "ext", "title"]);
  assert.equal(got.length, 2);
  assert.equal(got[1].dueIso, undefined);
  assert.equal(got[1].changedAt, new Date(0).toISOString());
  // titles are cut, control characters go
  assert.equal(cleanItems([{ ext: "e", title: `a\u0000b${"c".repeat(500)}` }])[0].title.length, 200);
  assert.deepEqual(cleanItems("nope"), []);
});

test("the server's reply can only add, change or remove in THAT list, and nothing else", () => {
  const ops = cleanOps({
    add: [
      { id: "a1", title: "x", dueIso: "2026-11-20T00:00:00Z", dueHasTime: true, notes: "no" },
      { id: "", title: "x" },
      { id: "a2", title: "" },
    ],
    update: [
      { ext: "e1", done: true, notes: "no" },
      { ext: "e2" },                            // nothing to change
      { ext: "", done: true },
    ],
    remove: ["e9", "", 7],
    listId: "someone-elses-list",               // ignored: the list is the phone's own
    extra: "ignored",
  }, "list-x0");
  assert.equal(ops.listId, "list-x0");
  assert.deepEqual(ops.add, [{ id: "a1", title: "x", dueHasTime: true, dueIso: "2026-11-20T00:00:00.000Z" }]);
  assert.deepEqual(ops.update, [{ ext: "e1", done: true }]);
  assert.deepEqual(ops.remove, ["e9"]);
  assert.ok(opsEmpty(cleanOps(null, "l")));
  assert.ok(opsEmpty(cleanOps({ add: "x" }, "l")));
});

test("only real pairs of ids are recorded as links", () => {
  assert.deepEqual(cleanApplied([{ id: "a", ext: "b" }, { id: "a" }, { ext: "b" }, null, "x"]), [{ id: "a", ext: "b" }]);
  assert.deepEqual(cleanApplied(undefined), []);
});

// ------------------------------------------------------- due dates, both ways, in a pinned zone (docs: perms2 3.2)

/** The phone's own zone decides which day a due date lands on, so each of these runs in a named one. */
function inZone(tz: string, run: () => void): void {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { run(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

test("a day-only due date keeps its day in both directions, east and west of UTC", () => {
  for (const [tz, offset] of [["Asia/Kolkata", "+05:30"], ["America/New_York", "-05:00"]] as const) {
    inZone(tz, () => {
      const base = { title: "Pay the bill", dueHasTime: false, done: false, changedAt: "2026-11-14T09:00:00.000Z" };
      // UP: the module writes the instant in the item's OWN zone, so its first ten characters are the day the person sees.
      // toISOString() would move it to UTC and, east of UTC, name the day before — the day the server then files it on.
      const up = cleanItems([{ ext: "e1", ...base, dueIso: `2026-11-20T00:00:00${offset}` }]);
      assert.equal(up[0].dueIso, "2026-11-20");
      // a time the person really set still goes up as an instant
      const timed = cleanItems([{ ext: "e2", ...base, dueHasTime: true, dueIso: `2026-11-20T11:30:00${offset}` }]);
      assert.equal(timed[0].dueIso, new Date(`2026-11-20T11:30:00${offset}`).toISOString());
      // DOWN: the server's day-only "2026-11-20" becomes LOCAL noon, which is the 20th wherever the phone is. UTC midnight
      // (what new Date("2026-11-20") gives) is the 19th anywhere west of UTC, and Reminders would show that day.
      const ops = cleanOps({
        add: [{ id: "t1", title: "Pay the bill", dueIso: "2026-11-20", dueHasTime: false }],
        update: [{ ext: "e1", title: "Pay the bill", dueIso: "2026-11-20", dueHasTime: false }],
      }, "list-x0");
      for (const due of [ops.add[0].dueIso, ops.update[0].dueIso]) {
        const when = new Date(String(due));
        assert.equal(when.getFullYear(), 2026);
        assert.equal(when.getMonth(), 10);
        assert.equal(when.getDate(), 20, `${tz}: ${due}`);
        assert.equal(when.getHours(), 12);
      }
    });
  }
});

test("an update keeps dueHasTime, so a due time is not stripped in Reminders", () => {
  // The module reads a missing dueHasTime as day-only and clears the time; the server sends it, so it must go through.
  const ops = cleanOps({
    update: [
      { ext: "e1", title: "Call the plumber", dueIso: "2026-11-20T11:30:00.000Z", dueHasTime: true },
      { ext: "e2", title: "Someday", dueHasTime: false },   // the to-do has no due date at all: the item's goes
      { ext: "e3", title: "Only a title" },
    ],
  }, "list-x0");
  assert.deepEqual(ops.update[0], { ext: "e1", title: "Call the plumber", dueIso: "2026-11-20T11:30:00.000Z", dueHasTime: true });
  assert.deepEqual(ops.update[1], { ext: "e2", title: "Someday", dueHasTime: false });
  assert.deepEqual(ops.update[2], { ext: "e3", title: "Only a title" });
});

test("the list that goes up is 300 items at most, which is all the server takes", () => {
  assert.equal(MAX_ITEMS, 300);
  const many = Array.from({ length: 600 }, (_, i) =>
    ({ ext: `e${i}`, title: `t${i}`, dueHasTime: false, done: false, changedAt: "2026-11-14T09:00:00.000Z" }));
  assert.equal(cleanItems(many).length, MAX_ITEMS);
});

test("a throw anywhere is an error, never a half-applied sync", async () => {
  assert.deepEqual(await remindersSync({ path: REMINDERS_PATH }, deps({ read: async () => { throw new Error("x"); } })), { outcome: "error" });
  assert.deepEqual(await remindersSync({ path: REMINDERS_PATH }, deps({ apply: async () => { throw new Error("x"); } })), { outcome: "error" });
});
