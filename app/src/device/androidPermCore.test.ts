// node --test --experimental-strip-types src/device/androidPermCore.test.ts
//
// Asking for an Android runtime permission (perms2/SPEC.md 2.3, 5.1, 7.2; build 8.9.1). The rule
// this file exists to hold: ASK:TRUE REALLY ASKS. The native module cannot prompt on Android, so a
// path that never calls PermissionsAndroid.request can never be granted anything — the card's
// Continue would lead to no sheet and then to "X0 Bot can't see your calendar".
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_RECOGNITION, ACTIVITY_SINCE_API, READ_CALENDAR, answer, held, hold,
  type AndroidAsk,
} from "./androidPermCore.ts";

/** A fake PermissionsAndroid that counts what it was asked to do. */
function fake(opts: {
  granted?: string[];
  reply?: Record<string, string>;
  api?: number;
  throwOn?: "check" | "request";
}): AndroidAsk & { asked: string[]; checked: string[] } {
  const asked: string[] = [];
  const checked: string[] = [];
  return {
    asked,
    checked,
    api: opts.api,
    check: async (p) => {
      if (opts.throwOn === "check") throw new Error("no");
      checked.push(p);
      return (opts.granted ?? []).includes(p);
    },
    request: async (p) => {
      if (opts.throwOn === "request") throw new Error("no");
      asked.push(p);
      return opts.reply?.[p] ?? "denied";
    },
  };
}

test("never_ask_again is the only blocked, and nothing unknown is ever granted", () => {
  assert.equal(answer("granted"), "granted");
  assert.equal(answer("never_ask_again"), "blocked");
  assert.equal(answer("denied"), "denied");
  for (const bad of [undefined, null, "", "GRANTED", true, 1, {}]) {
    assert.equal(answer(bad), "denied", JSON.stringify(bad));
  }
});

test("check never prompts, and can only answer granted or undetermined", async () => {
  const f = fake({ granted: [READ_CALENDAR] });
  assert.equal(await held(READ_CALENDAR, f), "granted");
  assert.equal(await held(ACTIVITY_RECOGNITION, f), "undetermined");
  assert.deepEqual(f.asked, []);
});

test("a permission that does not exist on this Android reads as granted, unasked", async () => {
  // ACTIVITY_RECOGNITION arrives in API 29. On 28 a request comes back never_ask_again, which would
  // read as "refused for good" and offer Settings for a switch that is not there.
  const old = fake({ api: 28 });
  assert.equal(await held(ACTIVITY_RECOGNITION, old, ACTIVITY_SINCE_API), "granted");
  assert.deepEqual(old.checked, []);
  assert.deepEqual(old.asked, []);
  const now = fake({ api: 34 });
  assert.equal(await held(ACTIVITY_RECOGNITION, now, ACTIVITY_SINCE_API), "undetermined");
  assert.deepEqual(now.checked, [ACTIVITY_RECOGNITION]);
});

test("ASK:FALSE NEVER PROMPTS: a page-appear sync puts no sheet in front of anyone", async () => {
  const f = fake({});
  assert.equal(await hold(READ_CALENDAR, false, f), "undetermined");
  assert.deepEqual(f.asked, []);
});

test("ASK:TRUE PROMPTS, and the answer is what the system said", async () => {
  const yes = fake({ reply: { [READ_CALENDAR]: "granted" } });
  assert.equal(await hold(READ_CALENDAR, true, yes), "granted");
  assert.deepEqual(yes.asked, [READ_CALENDAR]);

  const never = fake({ reply: { [READ_CALENDAR]: "never_ask_again" } });
  assert.equal(await hold(READ_CALENDAR, true, never), "blocked");
  assert.deepEqual(never.asked, [READ_CALENDAR]);

  const no = fake({ reply: { [READ_CALENDAR]: "denied" } });
  assert.equal(await hold(READ_CALENDAR, true, no), "denied");
});

test("already held: no second sheet", async () => {
  const f = fake({ granted: [READ_CALENDAR], reply: { [READ_CALENDAR]: "granted" } });
  assert.equal(await hold(READ_CALENDAR, true, f), "granted");
  assert.deepEqual(f.asked, []);
});

test("a module that throws is not a grant", async () => {
  assert.equal(await held(READ_CALENDAR, fake({ throwOn: "check" })), "undetermined");
  assert.equal(await hold(READ_CALENDAR, true, fake({ throwOn: "request" })), "denied");
});
