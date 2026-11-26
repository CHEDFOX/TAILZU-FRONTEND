// node --test --experimental-strip-types src/device/calendarCore.test.ts
//
// The calendar's rules (docs: perms2 2): the path is pinned before anything is read, ask:false never prompts, the editor's
// event is built or refused, and only {s, e, allDay} inside the window ever goes up.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSY_PATH, MADE_LINE, MAX_BLOCKS, busyPayload, busyPathOk, busySync, cleanBlocks, editorOutcome, eventDraft, windowRange,
  windowSize, type BusyDeps, type CalendarReady,
} from "./calendarCore.ts";

const DAY = 86_400_000;

function deps(over: Partial<BusyDeps> = {}): BusyDeps & { posted: { path: string; body: unknown }[] } {
  const posted: { path: string; body: unknown }[] = [];
  const d = {
    now: () => new Date("2026-11-14T09:40:00.000Z"),
    offsetMin: () => 330,
    prepare: async () => "ready" as CalendarReady,
    busy: async () => [{ s: Date.parse("2026-11-14T10:00:00Z"), e: Date.parse("2026-11-14T11:00:00Z"), allDay: false }],
    post: async (path: string, body: unknown) => { posted.push({ path, body }); return {}; },
    tz: () => "+05:30",
    everyMs: 0,
    lastAt: new Map<string, number>(),
    ...over,
  };
  return Object.assign(d, { posted }) as never;
}

test("the path is pinned: anything else is refused before a single read", async () => {
  assert.ok(busyPathOk(BUSY_PATH));
  for (const p of ["/ask", "/v1/botsapp/plan/busy/", "/v1/botsapp/plan/busy?x=1", "", null, 7]) assert.ok(!busyPathOk(p as never));
  let read = 0;
  const d = deps({ busy: async () => { read++; return []; } });
  assert.deepEqual(await busySync({ path: "/ask", ask: true }, d), { outcome: "error" });
  assert.equal(read, 0);
  assert.equal(d.posted.length, 0);
});

test("ask:false never prompts, and a refusal or a block posts nothing", async () => {
  for (const [ready, outcome] of [["denied", "denied"], ["blocked", "blocked"], ["unavailable", "unavailable"]] as const) {
    const d = deps({ prepare: async () => ready });
    assert.deepEqual(await busySync({ path: BUSY_PATH }, d), { outcome });
    assert.equal(d.posted.length, 0);
  }
  const d = deps({ prepare: async (ask) => { assert.equal(ask, false); return "denied"; } });
  await busySync({ path: BUSY_PATH, ask: false }, d);
});

test("a sync posts the window, the zone and the blocks, and enable rides on the first one", async () => {
  const d = deps();
  assert.deepEqual(await busySync({ path: BUSY_PATH, ask: true, enable: true, days: 14 }, d), { outcome: "synced" });
  const body = d.posted[0].body as ReturnType<typeof busyPayload>;
  assert.equal(d.posted[0].path, BUSY_PATH);
  assert.equal(body.enable, true);
  assert.equal(body.tz, "+05:30");
  // local midnight in +05:30 on the 14th is 18:30 UTC on the 13th. The window goes up in MILLISECONDS, the same unit as every
  // block's s and e: the server reads it with Number(), so an ISO string there is a 400 and the switch could never turn on.
  assert.equal(typeof body.from, "number");
  assert.equal(body.from, Date.parse("2026-11-13T18:30:00.000Z"));
  assert.equal(body.to, Date.parse("2026-11-27T18:30:00.000Z"));
  assert.deepEqual(body.blocks, [{ s: Date.parse("2026-11-14T10:00:00Z"), e: Date.parse("2026-11-14T11:00:00Z"), allDay: false }]);
  assert.deepEqual(Object.keys(body.blocks[0]), ["s", "e", "allDay"]);
});

test("nothing busy is still an answer, so a cleared calendar clears the server's copy", async () => {
  const d = deps({ busy: async () => [] });
  assert.deepEqual(await busySync({ path: BUSY_PATH }, d), { outcome: "synced" });
  assert.deepEqual((d.posted[0].body as { blocks: unknown[] }).blocks, []);
});

test("a run within everyMs is skipped, and an asking or enabling run never is", async () => {
  const lastAt = new Map<string, number>();
  const d = deps({ everyMs: 3_600_000, lastAt });
  await busySync({ path: BUSY_PATH }, d);
  assert.deepEqual(await busySync({ path: BUSY_PATH }, d), { outcome: "skipped" });
  assert.deepEqual(await busySync({ path: BUSY_PATH, ask: true }, d), { outcome: "synced" });
  assert.deepEqual(await busySync({ path: BUSY_PATH, enable: true }, d), { outcome: "synced" });
  assert.equal(d.posted.length, 3);
});

test("a throw anywhere is an error, never a half-sent sync", async () => {
  assert.deepEqual(await busySync({ path: BUSY_PATH }, deps({ busy: async () => { throw new Error("x"); } })), { outcome: "error" });
  assert.deepEqual(await busySync({ path: BUSY_PATH }, deps({ post: async () => { throw new Error("x"); } })), { outcome: "error" });
});

test("the window is 1 to 14 days", () => {
  assert.equal(windowSize(undefined), 14);
  assert.equal(windowSize(0), 1);
  assert.equal(windowSize(-5), 1);
  assert.equal(windowSize(7.9), 7);
  assert.equal(windowSize(90), 14);
  const { fromMs, toMs } = windowRange(new Date("2026-11-14T09:40:00Z"), 330, 2);
  assert.equal(new Date(fromMs).toISOString(), "2026-11-13T18:30:00.000Z");
  assert.equal(toMs - fromMs, 2 * DAY);
});

test("blocks are cut to the window, split into two-day pieces, and capped at 300", () => {
  const from = Date.parse("2026-11-14T00:00:00Z");
  const to = from + 14 * DAY;
  const got = cleanBlocks([
    { s: from - DAY, e: from + 3600_000, allDay: false },        // starts before the window: cut to its edge
    { s: to - 3600_000, e: to + DAY, allDay: true },             // ends after it: cut to its edge
    { s: from + DAY, e: from + 6 * DAY, allDay: true },          // five days long: five days of pieces, not two
    { s: from + DAY, e: from + DAY, allDay: false },             // not a span at all
    { s: from - 5 * DAY, e: from - 4 * DAY, allDay: false },     // wholly outside
    { s: "x", e: "y" },
    null,
  ], from, to);
  // A week away is busy all week: cutting the block short would leave days 3 to 5 reading as free, and Nudj would plan
  // and call into them. Each piece is two days at most, which is what the server and the table allow.
  assert.deepEqual(got, [
    { s: from, e: from + 3600_000, allDay: false },
    { s: from + DAY, e: from + 3 * DAY, allDay: true },
    { s: from + 3 * DAY, e: from + 5 * DAY, allDay: true },
    { s: from + 5 * DAY, e: from + 6 * DAY, allDay: true },
    { s: to - 3600_000, e: to, allDay: true },
  ]);
  for (const b of got) assert.ok(b.e - b.s <= 2 * DAY && b.e > b.s);
  const many = Array.from({ length: MAX_BLOCKS + 40 }, (_, i) => ({ s: from + i * 60_000, e: from + i * 60_000 + 1_000, allDay: false }));
  assert.equal(cleanBlocks(many, from, to).length, MAX_BLOCKS);
  assert.deepEqual(cleanBlocks("nope", from, to), []);
});

test("the editor's event is built from the action, or refused rather than opened half-filled", () => {
  const made = eventDraft({ title: "Dentist", startsAtIso: "2026-11-20T04:30:00Z", notes: "Bring the card" });
  assert.deepEqual(made, {
    title: "Dentist",
    startMs: Date.parse("2026-11-20T04:30:00Z"),
    endMs: Date.parse("2026-11-20T05:30:00Z"),
    allDay: false,
    notes: `Bring the card\n${MADE_LINE}`,
  });
  assert.equal(eventDraft({ title: "x", startsAtIso: "2026-11-20T04:30:00Z" })?.notes, MADE_LINE);
  assert.equal(eventDraft({ title: "", startsAtIso: "2026-11-20T04:30:00Z" }), null);
  assert.equal(eventDraft({ title: "x", startsAtIso: "not a date" }), null);
  assert.equal(eventDraft({ title: "x" }), null);
  // an end that is missing or backwards becomes an hour, or a whole day when it is an all-day event
  const back = eventDraft({ title: "x", startsAtIso: "2026-11-20T04:30:00Z", endsAtIso: "2026-11-19T00:00:00Z" });
  assert.equal(back?.endMs, Date.parse("2026-11-20T05:30:00Z"));
  const all = eventDraft({ title: "x", startsAtIso: "2026-11-20T04:30:00Z", allDay: true });
  assert.equal(all?.endMs, Date.parse("2026-11-21T04:30:00Z"));
  assert.equal(all?.allDay, true);
  // control characters out, lengths kept
  const long = eventDraft({ title: "a\u0000b".padEnd(400, "c"), startsAtIso: "2026-11-20T04:30:00Z", notes: "n".repeat(5000) });
  assert.ok(!long!.title.includes("\u0000"));
  assert.ok(long!.title.length <= 200);
  assert.ok(long!.notes.length <= 1000);
  assert.ok(long!.notes.endsWith(MADE_LINE));
});

test("the made-with line is added once, never twice", () => {
  // The server's own notes already end with it (planItem.ts), and printing it twice in the editor looks like a bug.
  const notes = eventDraft({ title: "Dentist", startsAtIso: "2026-11-20T04:30:00Z", notes: `Bring the card\n\n${MADE_LINE}` })?.notes;
  assert.equal(notes, `Bring the card\n\n${MADE_LINE}`);
  assert.equal(notes!.split(MADE_LINE).length - 1, 1);
  // and it is still added when the item's own words do not carry it
  assert.equal(eventDraft({ title: "x", startsAtIso: "2026-11-20T04:30:00Z", notes: "Bring the card" })?.notes,
    `Bring the card\n${MADE_LINE}`);
});

test("the editor's outcome is one of the five names, and anything else is an error", () => {
  assert.equal(editorOutcome("saved"), "saved");
  assert.equal(editorOutcome("cancel"), "cancel");
  assert.equal(editorOutcome("opened"), "opened");
  assert.equal(editorOutcome("unavailable"), "unavailable");
  for (const v of [null, undefined, "", "yes", 1, {}]) assert.equal(editorOutcome(v), "error");
});
