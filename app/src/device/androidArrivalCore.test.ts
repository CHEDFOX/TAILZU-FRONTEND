// node --test --experimental-strip-types src/device/androidArrivalCore.test.ts
//
// Arrival reminders on Android (perms2/SPEC.md 7; build 8.9.1). The rules this file holds: the
// two-step Android 11+ flow — precise location asked WITH coarse, then "Allow all the time" after
// our own card — and that "background" is not a denial.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_BACKGROUND_LOCATION, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION,
  ARRIVAL_PREFIX, MAX_ARRIVALS,
  arrivalBackground, arrivalGrants, arrivalOutcome, arrivalStep,
} from "./androidArrivalCore.ts";
import type { AndroidAsk } from "./androidPermCore.ts";

function fake(opts: {
  granted?: string[];
  reply?: Record<string, string>;
  api?: number;
  noMulti?: boolean;
}): AndroidAsk & { asked: string[][] } {
  const asked: string[][] = [];
  const base: AndroidAsk & { asked: string[][] } = {
    asked,
    api: opts.api ?? 34,
    check: async (p) => (opts.granted ?? []).includes(p),
    request: async (p) => {
      asked.push([p]);
      return opts.reply?.[p] ?? "denied";
    },
  };
  if (!opts.noMulti) {
    base.requestMulti = async (perms) => {
      asked.push(perms);
      const out: Record<string, string> = {};
      for (const p of perms) out[p] = opts.reply?.[p] ?? "denied";
      return out;
    };
  }
  return base;
}

test("the shape the server and the Kotlin agree on", () => {
  assert.equal(ARRIVAL_PREFIX, "x0.arrive.");
  assert.equal(MAX_ARRIVALS, 10);
});

test("the step machine: our card before Settings, and never a sheet without ask", () => {
  const on = { fine: true, background: true, supported: true };
  assert.equal(arrivalStep(on, false), "arm");
  assert.equal(arrivalStep({ ...on, supported: false }, true), "unsupported");
  assert.equal(arrivalStep({ ...on, fine: false }, true), "ask-fine");
  assert.equal(arrivalStep({ ...on, fine: false }, false), "denied");
  assert.equal(arrivalStep({ ...on, background: false }, true), "card-background");
  // Step two is our own card, not a system sheet, so it does not wait for `ask`: naming the state
  // prompts nobody, and a page-appear read must tell "one step owed" from "refused".
  assert.equal(arrivalStep({ ...on, background: false }, false), "card-background");
});

test("a page-appear sync asks for nothing", async () => {
  const f = fake({});
  assert.equal(await arrivalGrants(false, f), "denied");
  assert.deepEqual(f.asked, []);
});

test("STEP ONE ASKS FINE AND COARSE TOGETHER: Android 12+ ignores a FINE-only request", async () => {
  const f = fake({
    reply: { [ACCESS_FINE_LOCATION]: "granted", [ACCESS_COARSE_LOCATION]: "granted" },
    granted: [ACCESS_BACKGROUND_LOCATION],
  });
  assert.equal(await arrivalGrants(true, f), "arm");
  assert.deepEqual(f.asked, [[ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION]]);
});

test("Approximate picked in the sheet is 'approximate', not a refusal", async () => {
  const f = fake({ reply: { [ACCESS_FINE_LOCATION]: "denied", [ACCESS_COARSE_LOCATION]: "granted" } });
  assert.equal(await arrivalGrants(true, f), "approximate");
});

test("never_ask_again on precise location is blocked; a plain no is denied", async () => {
  const never = fake({ reply: { [ACCESS_FINE_LOCATION]: "never_ask_again", [ACCESS_COARSE_LOCATION]: "never_ask_again" } });
  assert.equal(await arrivalGrants(true, never), "blocked");
  const no = fake({ reply: { [ACCESS_FINE_LOCATION]: "denied", [ACCESS_COARSE_LOCATION]: "denied" } });
  assert.equal(await arrivalGrants(true, no), "denied");
});

test("STEP TWO IS NOT A DENIAL: precise held, 'Allow all the time' still owed", async () => {
  const f = fake({ granted: [ACCESS_FINE_LOCATION] });
  assert.equal(await arrivalGrants(true, f), "background");
  // Nothing was prompted for: the card comes first, and only its Continue asks.
  assert.deepEqual(f.asked, []);
  // ask:false gets the same news without a sheet, so a page-appear sync can show the row's state.
  assert.equal(await arrivalGrants(false, fake({ granted: [ACCESS_FINE_LOCATION] })), "background");
});

test("below Android 10 the background grant comes with precise location", async () => {
  const old = fake({ granted: [ACCESS_FINE_LOCATION], api: 28 });
  assert.equal(await arrivalGrants(true, old), "arm");
  assert.equal(await arrivalBackground(old), "granted");
  assert.deepEqual(old.asked, []);
});

test("step two asks the system, so the screen learns the answer", async () => {
  const yes = fake({ reply: { [ACCESS_BACKGROUND_LOCATION]: "granted" } });
  assert.equal(await arrivalBackground(yes), "granted");
  assert.deepEqual(yes.asked, [[ACCESS_BACKGROUND_LOCATION]]);
  const never = fake({ reply: { [ACCESS_BACKGROUND_LOCATION]: "never_ask_again" } });
  assert.equal(await arrivalBackground(never), "blocked");
  const no = fake({ reply: {} });
  assert.equal(await arrivalBackground(no), "denied");
});

test("a binary with no requestMultiple still asks, with FINE alone", async () => {
  const f = fake({ reply: { [ACCESS_FINE_LOCATION]: "granted" }, granted: [ACCESS_BACKGROUND_LOCATION], noMulti: true });
  assert.equal(await arrivalGrants(true, f), "arm");
  assert.deepEqual(f.asked, [[ACCESS_FINE_LOCATION]]);
});

test("the native answer becomes one outcome, and approximate stays its own word", () => {
  assert.deepEqual(arrivalOutcome({ armed: 3 }), { outcome: "armed", armed: 3 });
  assert.deepEqual(arrivalOutcome({ armed: 99 }), { outcome: "armed", armed: MAX_ARRIVALS });
  assert.deepEqual(arrivalOutcome({ armed: 0 }), { outcome: "armed", armed: 0 });
  assert.deepEqual(arrivalOutcome("background"), { outcome: "background", armed: 0 });
  // Android never produces this one (TulmiArrivalGeofences has no such answer); the iPhone does,
  // and its screen says exactly that, so the one shared mapping must not turn it into a refusal.
  assert.deepEqual(arrivalOutcome("approximate"), { outcome: "approximate", armed: 0 });
  assert.deepEqual(arrivalOutcome("denied"), { outcome: "denied", armed: 0 });
  assert.deepEqual(arrivalOutcome("blocked"), { outcome: "blocked", armed: 0 });
  assert.deepEqual(arrivalOutcome("unavailable"), { outcome: "unavailable", armed: 0 });
  for (const bad of [null, undefined, "", "yes", 7, [], {}, { armed: "x" }]) {
    assert.deepEqual(arrivalOutcome(bad), { outcome: "error", armed: 0 }, JSON.stringify(bad));
  }
});
