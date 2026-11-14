// node --test --experimental-strip-types src/device/androidCalendarCore.test.ts
//
// "Plan around my calendar" on Android (perms2/SPEC.md 2.3; build 8.9.1). The rule this file holds:
// the Android grant goes through a REAL system sheet, and ask:false never shows one.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSY_DAYS, MAX_BUSY_BLOCKS, READ_CALENDAR, calendarAsked, calendarReady, calendarStep,
} from "./androidCalendarCore.ts";
import type { AndroidAsk } from "./androidPermCore.ts";

function fake(opts: { has?: boolean; reply?: string }): AndroidAsk & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    check: async () => opts.has === true,
    request: async (p) => {
      asked.push(p);
      return opts.reply ?? "denied";
    },
  };
}

test("the caps the card's words promise", () => {
  assert.equal(BUSY_DAYS, 14);
  assert.equal(MAX_BUSY_BLOCKS, 300);
  assert.equal(READ_CALENDAR, "android.permission.READ_CALENDAR");
});

test("ask:false never asks; never_ask_again reads as blocked", () => {
  assert.deepEqual(calendarStep("granted", false), { ask: false });
  assert.deepEqual(calendarStep("undetermined", false), { ask: false, outcome: "denied" });
  assert.deepEqual(calendarStep("blocked", true), { ask: false, outcome: "blocked" });
  assert.deepEqual(calendarStep("denied", true), { ask: true });
  assert.deepEqual(calendarAsked("granted"), { granted: true });
  assert.deepEqual(calendarAsked("blocked"), { granted: false, outcome: "blocked" });
  assert.deepEqual(calendarAsked("denied"), { granted: false, outcome: "denied" });
});

test("held already: ready, and no sheet", async () => {
  const f = fake({ has: true });
  assert.equal(await calendarReady(true, f), "ready");
  assert.deepEqual(f.asked, []);
});

test("a page-appear sync (ask:false) answers denied WITHOUT a sheet", async () => {
  const f = fake({ has: false });
  assert.equal(await calendarReady(false, f), "denied");
  assert.deepEqual(f.asked, []);
});

test("THE CARD'S CONTINUE REACHES A REAL SYSTEM SHEET", async () => {
  // This is the whole point of calendarReady. The native calendarAsk cannot prompt, so without
  // this the person would tap Continue, see nothing, and be told X0 Bot cannot see their calendar.
  const yes = fake({ has: false, reply: "granted" });
  assert.equal(await calendarReady(true, yes), "ready");
  assert.deepEqual(yes.asked, [READ_CALENDAR]);

  const never = fake({ has: false, reply: "never_ask_again" });
  assert.equal(await calendarReady(true, never), "blocked");
  assert.deepEqual(never.asked, [READ_CALENDAR]);

  const no = fake({ has: false, reply: "denied" });
  assert.equal(await calendarReady(true, no), "denied");
  assert.deepEqual(no.asked, [READ_CALENDAR]);
});
