// node --test --experimental-strip-types src/device/androidMotionCore.test.ts
//
// Motion on Android (perms2/SPEC.md 5.1, 5.2; build 8.9.1). Three rules this file holds: the grant
// goes through a real system sheet (and is not asked for on an Android too old to have it), no
// invented zero days, and NO FABRICATED DAILY TOTALS — a day is closed at its own last read.
//
// Every ledger case below has the same numbers as the Kotlin's own test,
// modules/tulmi-perms/android/src/test/java/expo/modules/tulmiperms/TulmiMotionStepsTest.kt. A
// change to one is a change to both.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_RECOGNITION, EMPTY_LEDGER, MAX_MOTION_DAYS,
  dayKey, foldCounter, ledgerSteps, motionAsked, motionReady, motionStep,
} from "./androidMotionCore.ts";
import type { AndroidAsk } from "./androidPermCore.ts";

function fake(opts: { has?: boolean; reply?: string; api?: number }): AndroidAsk & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    api: opts.api ?? 34,
    check: async () => opts.has === true,
    request: async (p) => {
      asked.push(p);
      return opts.reply ?? "denied";
    },
  };
}

// --------------------------------------------------------------------------- the permission

test("ask:false never asks; never_ask_again reads as blocked", () => {
  assert.deepEqual(motionStep("granted", false), { ask: false });
  assert.deepEqual(motionStep("undetermined", false), { ask: false, outcome: "denied" });
  assert.deepEqual(motionStep("blocked", true), { ask: false, outcome: "blocked" });
  assert.deepEqual(motionStep("denied", true), { ask: true });
  assert.deepEqual(motionAsked("granted"), { granted: true });
  assert.deepEqual(motionAsked("blocked"), { granted: false, outcome: "blocked" });
  assert.deepEqual(motionAsked("denied"), { granted: false, outcome: "denied" });
});

test("THE CARD'S CONTINUE REACHES A REAL SYSTEM SHEET", async () => {
  const yes = fake({ reply: "granted" });
  assert.equal(await motionReady(true, yes), "ready");
  assert.deepEqual(yes.asked, [ACTIVITY_RECOGNITION]);
  const never = fake({ reply: "never_ask_again" });
  assert.equal(await motionReady(true, never), "blocked");
  const no = fake({ reply: "denied" });
  assert.equal(await motionReady(true, no), "denied");
});

test("a page-appear sync answers denied without a sheet; a held grant needs none", async () => {
  const quiet = fake({});
  assert.equal(await motionReady(false, quiet), "denied");
  assert.deepEqual(quiet.asked, []);
  const had = fake({ has: true, reply: "granted" });
  assert.equal(await motionReady(true, had), "ready");
  assert.deepEqual(had.asked, []);
});

test("below Android 10 there is no such permission, so nothing is asked and the read may go ahead", async () => {
  const old = fake({ api: 28 });
  assert.equal(await motionReady(true, old), "ready");
  assert.deepEqual(old.asked, []);
});

// --------------------------------------------------------------------------- the day key

test("the local day is the phone's, not UTC's", () => {
  // 00:30 UTC on the 14th is 06:00 on the 14th in +05:30, and still the 13th in -06:00.
  const at = Date.UTC(2026, 10, 14, 0, 30);
  assert.equal(dayKey(at, 330), "2026-11-14");
  assert.equal(dayKey(at, -360), "2026-11-13");
  assert.equal(dayKey(Number.NaN, 0), "");
});

test("the day key is ASCII, which is what the Kotlin's Locale.ROOT is for", () => {
  // motionCore accepts ^\d{4}-\d{2}-\d{2}$ and JavaScript's \d is ASCII-only, so a Bengali or
  // Arabic-digit day key from the phone would make every row of the read drop silently.
  assert.match(dayKey(Date.UTC(2026, 10, 14), 0), /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
});

// --------------------------------------------------------------------------- the ledger

test("the first read ever claims nothing: steps taken before X0 Bot looked are nobody's", () => {
  const l = foldCounter(EMPTY_LEDGER, 9_000, "2026-11-14");
  assert.equal(ledgerSteps(l), 0);
  assert.equal(l.day, "2026-11-14");
  assert.deepEqual(l.totals, {});
});

test("steps since the first read are today's", () => {
  let l = foldCounter(EMPTY_LEDGER, 9_000, "2026-11-14");
  l = foldCounter(l, 9_450, "2026-11-14");
  assert.equal(ledgerSteps(l), 450);
  l = foldCounter(l, 11_000, "2026-11-14");
  assert.equal(ledgerSteps(l), 2_000);
});

test("a reboot keeps what was counted and takes the restarted counter as steps since", () => {
  let l = foldCounter(EMPTY_LEDGER, 9_000, "2026-11-14");
  l = foldCounter(l, 9_500, "2026-11-14"); // 500 today
  l = foldCounter(l, 120, "2026-11-14"); // counter restarted at boot
  assert.equal(ledgerSteps(l), 620);
  l = foldCounter(l, 300, "2026-11-14");
  assert.equal(ledgerSteps(l), 800);
});

test("A DAY IS CLOSED AT ITS OWN LAST READ, not at the next day's read", () => {
  let l = foldCounter(EMPTY_LEDGER, 1_000, "2026-11-13");
  l = foldCounter(l, 5_000, "2026-11-13"); // 4000 on the 13th, at its last read
  l = foldCounter(l, 5_600, "2026-11-14"); // the first read of the 14th
  // 4000, NOT 4600: the 600 between the two reads straddles midnight and belongs to nobody.
  assert.deepEqual(l.totals, { "2026-11-13": 4_000 });
  assert.equal(ledgerSteps(l), 0);
  l = foldCounter(l, 6_000, "2026-11-14");
  assert.equal(ledgerSteps(l), 400);
});

test("A GAP OF DAYS IS NOT PINNED ON THE LAST DAY READ", () => {
  // Health sync runs on page appear, so not opening X0 Bot for a few days is ordinary. Crediting
  // four days of walking to the Monday would be a fabricated daily total on a fitness bot's streak.
  let l = foldCounter(EMPTY_LEDGER, 1_000, "2026-11-13");
  l = foldCounter(l, 1_500, "2026-11-13");
  l = foldCounter(l, 41_500, "2026-11-17");
  assert.deepEqual(l.totals, { "2026-11-13": 500 });
  assert.equal(ledgerSteps(l), 0);
  assert.ok(Object.keys(l.totals).every((d) => d <= "2026-11-13"));
});

test("a reboot across midnight closes the old day at its last read and never goes negative", () => {
  let l = foldCounter(EMPTY_LEDGER, 20_000, "2026-11-13");
  l = foldCounter(l, 23_000, "2026-11-13"); // 3000 on the 13th
  l = foldCounter(l, 80, "2026-11-14"); // rebooted overnight
  assert.deepEqual(l.totals, { "2026-11-13": 3_000 });
  assert.equal(ledgerSteps(l), 0);
  for (const day of Object.keys(l.totals)) assert.ok(l.totals[day]! >= 0);
});

test("the boot count catches a reboot the counter cannot show", () => {
  // The reading is HIGHER than the last one although the phone restarted: they walked more after
  // the reboot than before it, so `counter < last` sees nothing.
  let l = foldCounter(EMPTY_LEDGER, 1_000, "2026-11-14", 7);
  l = foldCounter(l, 1_200, "2026-11-14", 7); // 200 today
  l = foldCounter(l, 5_000, "2026-11-14", 8); // rebooted, then 5000 steps
  assert.equal(ledgerSteps(l), 5_200);
  assert.equal(l.boot, 8);
  // Without the boot count the same readings would have been one run, and 1200 steps lost.
  const blind = foldCounter({ day: "2026-11-14", base: 1_000, acc: 0, last: 1_200, boot: -1, totals: {} }, 5_000, "2026-11-14");
  assert.equal(ledgerSteps(blind), 4_000);
});

test("the ledger keeps 31 days, oldest dropped first", () => {
  const start = Date.UTC(2026, 0, 1);
  let l = foldCounter(EMPTY_LEDGER, 0, dayKey(start, 0));
  for (let i = 1; i <= 40; i++) {
    l = foldCounter(l, i * 1_000, dayKey(start + i * 86_400_000, 0));
  }
  const days = Object.keys(l.totals).sort();
  assert.equal(days.length, MAX_MOTION_DAYS);
  assert.equal(days[days.length - 1], dayKey(start + 39 * 86_400_000, 0));
  assert.equal(days[0], dayKey(start + 9 * 86_400_000, 0));
});

test("a bad reading changes nothing", () => {
  const before = foldCounter(EMPTY_LEDGER, 5, "2026-11-14");
  assert.deepEqual(foldCounter(before, Number.NaN, "2026-11-14"), before);
  assert.deepEqual(foldCounter(before, -1, "2026-11-14"), before);
  assert.deepEqual(foldCounter(before, 10, ""), before);
});
