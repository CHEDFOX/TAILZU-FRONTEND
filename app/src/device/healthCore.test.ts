// node --test --experimental-strip-types src/device/healthCore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  KINDS, MAX_SLEEP_MINUTES, buildPayload, dayKey, durationMinutes, healthPathOk, healthSync, kindFromHC, kindFromHK,
  mergeSpans, sleepByDayFrom, sleepSpansFromHC, sleepSpansFromHK, tzString, windowDays, windowSize, type HealthDeps,
} from "./healthCore.ts";

const IST = 330;

test("the path pin: only this bot's days", () => {
  assert.ok(healthPathOk("/v1/bots/gym-buddy/health/days"));
  assert.ok(healthPathOk("/v1/bots/abc123/health/days"));
  for (const bad of [
    "/v1/bots/gym-buddy/ask", "/v1/bots/gym-buddy/health/days/", "/v1/bots/gym-buddy/health/days?x=1", "/v1/bots/Gym/health/days",
    "/v1/bots/-a/health/days", "/v1/bots/a--b/health/days", "/v1/bots//health/days", "/v1/bots/a/b/health/days",
    "/v1/botsapp/x/health/days", "https://evil.example/v1/bots/a/health/days", "", null, 5,
  ]) assert.ok(!healthPathOk(bad as never), String(bad));
});

test("days are LOCAL days: 23:30 UTC is already tomorrow in India, and still today in New York", () => {
  const t = Date.UTC(2026, 10, 12, 23, 30);
  assert.equal(dayKey(t, IST), "2026-11-13");
  assert.equal(dayKey(t, -300), "2026-11-12");
  assert.equal(dayKey("nope", 0), "");
});

test("tz strings", () => {
  assert.equal(tzString(330), "+05:30");
  assert.equal(tzString(-300), "-05:00");
  assert.equal(tzString(0), "+00:00");
});

test("the window is 1..31 local days ending today", () => {
  assert.equal(windowSize(undefined), 31);
  assert.equal(windowSize(99), 31);
  assert.equal(windowSize(0), 1);
  assert.equal(windowSize(7.9), 7);
  const now = new Date(Date.UTC(2026, 10, 12, 20, 0)); // 01:30 on the 13th in India
  assert.deepEqual(windowDays(3, now, IST), ["2026-11-11", "2026-11-12", "2026-11-13"]);
});

test("durations in seconds, minutes, hours", () => {
  assert.equal(durationMinutes({ quantity: 2880, unit: "s" }), 48);
  assert.equal(durationMinutes({ quantity: 48, unit: "min" }), 48);
  assert.equal(durationMinutes({ quantity: 1.5, unit: "hr" }), 90);
  assert.equal(durationMinutes({ quantity: -1, unit: "s" }), 0);
  assert.equal(durationMinutes(undefined), 0);
});

test("HealthKit workout types map to the closed list; unknown is other", () => {
  assert.equal(kindFromHK(37), "run");
  assert.equal(kindFromHK(52), "walk");
  assert.equal(kindFromHK(13), "cycle");
  assert.equal(kindFromHK(50), "strength");
  assert.equal(kindFromHK(63), "cardio");
  assert.equal(kindFromHK(46), "swim");
  assert.equal(kindFromHK(57), "yoga");
  assert.equal(kindFromHK(41), "sport");
  assert.equal(kindFromHK(3000), "other");
  assert.equal(kindFromHK(99999), "other");
  assert.equal(kindFromHK("running"), "other");
  assert.equal(kindFromHK(undefined), "other");
});

test("Health Connect exercise types map to the closed list; unknown is other", () => {
  assert.equal(kindFromHC(56), "run");
  assert.equal(kindFromHC(79), "walk");
  assert.equal(kindFromHC(8), "cycle");
  assert.equal(kindFromHC(70), "strength");
  assert.equal(kindFromHC(36), "cardio");
  assert.equal(kindFromHC(74), "swim");
  assert.equal(kindFromHC(83), "yoga");
  assert.equal(kindFromHC(64), "sport");
  assert.equal(kindFromHC(0), "other");
  assert.equal(kindFromHC(45), "other"); // not a Health Connect type
  assert.equal(kindFromHC(null), "other");
});

test("every mapped kind is in the closed list", () => {
  for (let i = 0; i < 100; i++) { assert.ok(KINDS.includes(kindFromHK(i))); assert.ok(KINDS.includes(kindFromHC(i))); }
});

test("the payload: every day sent, caps applied, enable only when asked", () => {
  const window = ["2026-11-11", "2026-11-12", "2026-11-13"];
  const many = Array.from({ length: 12 }, () => ({ day: "2026-11-12", kind: "run" as const, minutes: 30 }));
  const { payload, empty } = buildPayload({
    window,
    stepsByDay: new Map([["2026-11-12", 7412.6], ["2026-11-13", 999_999], ["2026-10-01", 5]]),
    workouts: [
      ...many,
      { day: "2026-11-11", kind: "yoga", minutes: 0.2 }, // too short, dropped
      { day: "2026-11-11", kind: "walk", minutes: 5000 }, // capped at 600
      { day: "2026-09-01", kind: "run", minutes: 30 }, // outside the window
    ],
    offsetMin: IST,
    enable: true,
  });
  assert.equal(empty, false);
  assert.equal(payload.enable, true);
  assert.equal(payload.tz, "+05:30");
  assert.equal(payload.days.length, 3);
  assert.deepEqual(payload.days[0], { day: "2026-11-11", steps: 0, workouts: [{ kind: "walk", minutes: 600 }] });
  assert.equal(payload.days[1].steps, 7413);
  assert.equal(payload.days[1].workouts.length, 8);
  assert.equal(payload.days[2].steps, 200_000);
  assert.equal(buildPayload({ window, stepsByDay: new Map(), workouts: [], offsetMin: 0 }).payload.enable, undefined);
});

test("nothing read is empty (what a refused iOS read looks like)", () => {
  const r = buildPayload({ window: ["2026-11-13"], stepsByDay: new Map([["2026-11-13", 0]]), workouts: [], offsetMin: 0 });
  assert.equal(r.empty, true);
});

// ------------------------------------------------------------------------------------------------ the action
function mk(over: Partial<HealthDeps> = {}) {
  const calls = { prepare: [] as boolean[], read: 0, posts: [] as { path: string; body: any }[] };
  const deps: HealthDeps = {
    now: () => new Date(Date.UTC(2026, 10, 13, 4, 0)),
    offsetMin: () => IST,
    prepare: async (ask) => { calls.prepare.push(ask); return "ready"; },
    read: async () => {
      calls.read++;
      return { stepsByDay: new Map([["2026-11-13", 5000]]), workouts: [{ day: "2026-11-13", kind: "run", minutes: 30 }] };
    },
    post: async (path, body) => { calls.posts.push({ path, body }); return {}; },
    everyMs: 3_600_000,
    lastAt: new Map(),
    ...over,
  };
  return { deps, calls };
}
const P = "/v1/bots/gym-buddy/health/days";

test("a path off the pin is refused BEFORE anything is read, asked or sent", async () => {
  const { deps, calls } = mk();
  for (const path of ["/v1/bots/gym-buddy/ask", "/v1/me", "https://x.example/v1/bots/a/health/days", ""]) {
    assert.deepEqual(await healthSync({ path, ask: true, enable: true }, deps), { outcome: "error" });
  }
  assert.equal(calls.prepare.length, 0);
  assert.equal(calls.read, 0);
  assert.equal(calls.posts.length, 0);
});

test("ask:true enable:true reads, posts once with enable, and says synced", async () => {
  const { deps, calls } = mk();
  assert.deepEqual(await healthSync({ path: P, ask: true, enable: true, days: 31 }, deps), { outcome: "synced" });
  assert.deepEqual(calls.prepare, [true]);
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0].path, P);
  assert.equal(calls.posts[0].body.enable, true);
  assert.equal(calls.posts[0].body.days.length, 31);
  assert.equal(calls.posts[0].body.days.at(-1).day, "2026-11-13");
});

test("ask:false never asks, posts no enable, and is skipped within the hour", async () => {
  const { deps, calls } = mk();
  assert.deepEqual(await healthSync({ path: P }, deps), { outcome: "synced" });
  assert.deepEqual(calls.prepare, [false]);
  assert.equal(calls.posts[0].body.enable, undefined);
  assert.deepEqual(await healthSync({ path: P }, deps), { outcome: "skipped" });
  assert.equal(calls.read, 1);
  // an hour later it runs again
  deps.now = () => new Date(Date.UTC(2026, 10, 13, 5, 1));
  assert.deepEqual(await healthSync({ path: P }, deps), { outcome: "synced" });
  assert.equal(calls.read, 2);
});

test("a permission the person took back: denied or blocked, nothing read or sent", async () => {
  for (const r of ["denied", "blocked", "unavailable"] as const) {
    const { deps, calls } = mk({ prepare: async () => r });
    assert.deepEqual(await healthSync({ path: P, ask: true, enable: true }, deps), { outcome: r });
    assert.equal(calls.read, 0);
    assert.equal(calls.posts.length, 0);
  }
});

test("an empty read: with enable it still turns the switch on; without it nothing is sent (no wiping kept days)", async () => {
  const nothing = async () => ({ stepsByDay: new Map<string, number>(), workouts: [] });
  const a = mk({ read: nothing });
  assert.deepEqual(await healthSync({ path: P, ask: true, enable: true }, a.deps), { outcome: "empty" });
  assert.equal(a.calls.posts.length, 1);
  assert.equal(a.calls.posts[0].body.enable, true);
  const b = mk({ read: nothing });
  assert.deepEqual(await healthSync({ path: P }, b.deps), { outcome: "empty" });
  assert.equal(b.calls.posts.length, 0);
});

test("a read or post that throws is an error", async () => {
  assert.deepEqual(await healthSync({ path: P, ask: true }, mk({ read: async () => { throw new Error("x"); } }).deps), { outcome: "error" });
  assert.deepEqual(await healthSync({ path: P, ask: true }, mk({ post: async () => { throw new Error("409"); } }).deps), { outcome: "error" });
});

test("the window starts at the local midnight of its first day", async () => {
  let from: Date | undefined;
  const { deps } = mk({ read: async (f) => { from = f; return { stepsByDay: new Map(), workouts: [] }; } });
  await healthSync({ path: P, ask: true, days: 2 }, deps);
  // 2026-11-12 00:00 +05:30 is 2026-11-11 18:30 UTC
  assert.equal(from?.toISOString(), "2026-11-11T18:30:00.000Z");
});

// ------------------------------------------------------------------- sleep and the motion source (docs: perms2 5, 6)

test("sleep is asked for in its OWN request, and a refusal leaves steps working", async () => {
  const asked: string[] = [];
  const a = mk({
    prepareSleep: async (ask) => { asked.push(`sleep:${ask}`); return "ready"; },
    readSleep: async () => new Map([["2026-11-13", 430]]),
  });
  a.deps.prepare = async (ask) => { asked.push(`main:${ask}`); return "ready"; };
  assert.deepEqual(await healthSync({ path: P, ask: true, enable: true, sleep: true }, a.deps), { outcome: "synced" });
  assert.deepEqual(asked, ["main:true", "sleep:true"]);
  assert.equal(a.calls.posts[0].body.days.at(-1).sleepMinutes, 430);
  // a refused sleep grant: the steps of this very sync still go up, with no nightly minutes at all
  const b = mk({ prepareSleep: async () => "denied", readSleep: async () => { throw new Error("never read"); } });
  assert.deepEqual(await healthSync({ path: P, ask: true, sleep: true }, b.deps), { outcome: "synced" });
  assert.equal(b.calls.posts[0].body.days.at(-1).steps, 5000);
  assert.equal(b.calls.posts[0].body.days.at(-1).sleepMinutes, undefined);
  // a sleep read that throws does not lose the steps either
  const c = mk({ prepareSleep: async () => "ready", readSleep: async () => { throw new Error("x"); } });
  assert.deepEqual(await healthSync({ path: P, ask: true, sleep: true }, c.deps), { outcome: "synced" });
  assert.equal(c.calls.posts[0].body.days.at(-1).sleepMinutes, undefined);
});

test("no sleep is read unless the action asks for it", async () => {
  let reads = 0;
  const d = mk({ prepareSleep: async () => "ready", readSleep: async () => { reads++; return new Map(); } });
  await healthSync({ path: P, ask: true }, d.deps);
  assert.equal(reads, 0);
  assert.equal(d.calls.posts[0].body.days.at(-1).sleepMinutes, undefined);
});

test("a night of sleep alone is not an empty read", async () => {
  const d = mk({
    read: async () => ({ stepsByDay: new Map<string, number>(), workouts: [] }),
    prepareSleep: async () => "ready",
    readSleep: async () => new Map([["2026-11-13", 400]]),
  });
  assert.deepEqual(await healthSync({ path: P, sleep: true }, d.deps), { outcome: "synced" });
  assert.equal(d.calls.posts.length, 1);
});

test("the payload carries nightly minutes, bounded, and source only for motion", () => {
  const { payload } = buildPayload({
    window: ["2026-11-13", "2026-11-14"],
    stepsByDay: new Map([["2026-11-13", 100]]),
    workouts: [],
    offsetMin: IST,
    sleepByDay: new Map([["2026-11-13", 99_999], ["2026-11-14", 0]]),
  });
  assert.equal(payload.days[0].sleepMinutes, MAX_SLEEP_MINUTES);
  assert.equal(payload.days[1].sleepMinutes, undefined);
  assert.equal(payload.source, undefined);
  assert.equal(buildPayload({ window: ["2026-11-13"], stepsByDay: new Map(), workouts: [], offsetMin: IST, source: "motion" }).payload.source, "motion");
  assert.equal(buildPayload({ window: ["2026-11-13"], stepsByDay: new Map(), workouts: [], offsetMin: IST, source: "health" }).payload.source, undefined);
});

test("the payload says `sleep: true` only when sleep was asked for AND allowed", async () => {
  // Without it the server drops every sleepMinutes it is sent and never turns the bot's sleep switch on.
  const a = mk({ prepareSleep: async () => "ready", readSleep: async () => new Map([["2026-11-13", 430]]) });
  await healthSync({ path: P, ask: true, enable: true, sleep: true }, a.deps);
  assert.equal(a.calls.posts[0].body.sleep, true);
  // sleep not asked for: no flag at all, so an ordinary steps sync can never carry a night
  const b = mk({ prepareSleep: async () => "ready", readSleep: async () => new Map([["2026-11-13", 430]]) });
  await healthSync({ path: P, ask: true }, b.deps);
  assert.equal("sleep" in b.calls.posts[0].body, false);
  // asked for but refused: steps still go up, and nothing claims a night was read
  const c = mk({ prepareSleep: async () => "denied", readSleep: async () => new Map([["2026-11-13", 430]]) });
  await healthSync({ path: P, ask: true, sleep: true }, c.deps);
  assert.equal("sleep" in c.calls.posts[0].body, false);
  // and on a binary with no sleep reader at all
  const d = mk();
  await healthSync({ path: P, ask: true, sleep: true }, d.deps);
  assert.equal("sleep" in d.calls.posts[0].body, false);
});

test("a short wake before midnight does not split one night in two", () => {
  // An IST night, 22:30 to 06:30, with ten minutes awake at 23:50: one night of 7 h 50, on the day it ends.
  const hk = sleepSpansFromHK([
    { value: 3, startDate: "2026-11-13T17:00:00Z", endDate: "2026-11-13T18:20:00Z" },
    { value: 2, startDate: "2026-11-13T18:20:00Z", endDate: "2026-11-13T18:30:00Z" },   // awake
    { value: 4, startDate: "2026-11-13T18:30:00Z", endDate: "2026-11-14T01:00:00Z" },
  ]);
  assert.deepEqual([...sleepByDayFrom(hk, IST)], [["2026-11-14", 470]]);
  // the same night as Health Connect reports it, as one session with an awake stage
  const hc = sleepSpansFromHC([{
    startTime: "2026-11-13T17:00:00Z", endTime: "2026-11-14T01:00:00Z",
    stages: [{ stage: 1, startTime: "2026-11-13T18:20:00Z", endTime: "2026-11-13T18:30:00Z" }],
  }]);
  assert.deepEqual([...sleepByDayFrom(hc, IST)], [["2026-11-14", 470]]);
  // a real gap is still two nights: an afternoon nap is not last night's sleep
  const twice = sleepSpansFromHK([
    { value: 1, startDate: "2026-11-13T17:00:00Z", endDate: "2026-11-13T23:00:00Z" },   // the night
    { value: 1, startDate: "2026-11-14T08:00:00Z", endDate: "2026-11-14T09:00:00Z" },   // a nap, nine hours later
  ]);
  assert.deepEqual([...sleepByDayFrom(twice, IST)], [["2026-11-14", 360 + 60]]);
});

test("overlapping sources are merged, so a Watch and a phone are one night", () => {
  const t = (iso: string) => Date.parse(iso);
  assert.deepEqual(mergeSpans([
    { start: t("2026-11-13T22:00:00Z"), end: t("2026-11-14T02:00:00Z") },
    { start: t("2026-11-14T01:00:00Z"), end: t("2026-11-14T03:00:00Z") },
    { start: t("2026-11-14T05:00:00Z"), end: t("2026-11-14T06:00:00Z") },
    { start: t("2026-11-14T06:00:00Z"), end: t("2026-11-14T05:00:00Z") },
  ]), [
    { start: t("2026-11-13T22:00:00Z"), end: t("2026-11-14T03:00:00Z") },
    { start: t("2026-11-14T05:00:00Z"), end: t("2026-11-14T06:00:00Z") },
  ]);
});

test("a night belongs to the day it ends on, and only asleep values count (iOS)", () => {
  const spans = sleepSpansFromHK([
    { value: 0, startDate: "2026-11-13T21:00:00Z", endDate: "2026-11-13T22:00:00Z" },   // in bed is not sleep
    { value: 2, startDate: "2026-11-13T22:00:00Z", endDate: "2026-11-13T22:30:00Z" },   // awake is not sleep
    { value: 3, startDate: "2026-11-13T22:30:00Z", endDate: "2026-11-14T00:30:00Z" },   // core
    { value: 5, startDate: "2026-11-14T00:30:00Z", endDate: "2026-11-14T01:00:00Z" },   // REM
    { value: 1, startDate: "x", endDate: "y" },
  ]);
  assert.equal(spans.length, 2);
  // +05:30: the night ends at 06:30 on the 14th, so it is the 14th's
  assert.deepEqual([...sleepByDayFrom(spans, IST)], [["2026-11-14", 150]]);
});

test("an Android session counts, less its awake stretches (Android)", () => {
  const spans = sleepSpansFromHC([
    {
      startTime: "2026-11-13T22:00:00Z", endTime: "2026-11-14T04:00:00Z",
      stages: [
        { stage: 4, startTime: "2026-11-13T22:00:00Z", endTime: "2026-11-14T00:00:00Z" },
        { stage: 1, startTime: "2026-11-14T00:00:00Z", endTime: "2026-11-14T00:30:00Z" },  // awake
        { stage: 7, startTime: "2026-11-14T00:30:00Z", endTime: "2026-11-14T01:00:00Z" },  // awake in bed
        { stage: 6, startTime: "2026-11-14T01:00:00Z", endTime: "2026-11-14T04:00:00Z" },
      ],
    },
    // a session with no stages counts whole, which is what Health Connect's own duration says
    { startTime: "2026-11-12T23:00:00Z", endTime: "2026-11-13T01:00:00Z" },
    { startTime: "nope", endTime: "nope" },
  ]);
  assert.deepEqual([...sleepByDayFrom(spans, IST)], [["2026-11-13", 120], ["2026-11-14", 300]]);
});
