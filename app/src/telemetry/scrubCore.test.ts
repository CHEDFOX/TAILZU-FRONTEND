// node --test --experimental-strip-types src/telemetry/scrubCore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { scrubEvent } from "./scrubCore.ts";

test("the health POST's body and query never ride on a report", () => {
  const e = scrubEvent({ request: { url: "https://x0bot.com/v1/bots/gym-buddy/health/days", data: { days: [{ steps: 7000 }] }, query_string: "a=1" } });
  assert.equal(e.request?.data, undefined);
  assert.equal(e.request?.query_string, undefined);
});

test("health-shaped keys are cut from other bodies, breadcrumbs and extras", () => {
  const e = scrubEvent({
    request: { url: "https://x0bot.com/v1/other", data: { ok: 1, workouts: [{ kind: "run" }] } },
    extra: { steps: 4000, fine: "yes", nested: { workouts: [1] } },
    breadcrumbs: [
      { category: "fetch", data: { url: "https://x0bot.com/v1/bots/a/health/days", status_code: 200, body: "secret" } },
      { category: "console", message: "health.sync outcome", data: { steps: 1 } },
      { category: "nav", data: { to: "home", area: "HSR Layout" } },
    ],
  });
  assert.deepEqual(e.request?.data, { ok: 1, workouts: "[health removed]" });
  assert.deepEqual(e.extra, { steps: "[health removed]", fine: "yes", nested: { workouts: "[health removed]" } });
  const [a, b, c] = e.breadcrumbs!;
  assert.equal(a.data?.body, undefined);
  assert.equal(a.data?.status_code, 200);
  assert.equal(b.message, "[health removed]");
  assert.equal(b.data?.steps, undefined);
  assert.equal((c.data as Record<string, unknown>).area, "[health removed]");
  assert.equal((c.data as Record<string, unknown>).to, "home");
});

test("an odd event does not throw", () => {
  assert.doesNotThrow(() => scrubEvent({ breadcrumbs: [null as never], request: { url: 5 as never } }));
});

// BUILD 8.9.1 (docs: perms2 12): the busy times, the Reminders list, the Focus and driving answers and every trust token are cut
// whole, by path and by key, in a body, a breadcrumb or an extra.
test("the 8.9.1 paths never carry a body on a report", () => {
  for (const url of [
    "https://x0bot.com/v1/botsapp/plan/busy",
    "https://x0bot.com/v1/botsapp/plan/reminders/sync",
    "https://x0bot.com/v1/botsapp/plan/focus",
    "https://x0bot.com/v1/botsapp/plan/calls/c1/check",
    "https://x0bot.com/v1/trust/ios/attest",
    "https://x0bot.com/v1/trust/android/integrity",
  ]) {
    const e = scrubEvent({ request: { url, data: { blocks: [{ s: 1, e: 2 }] }, query_string: "a=1" } });
    assert.equal(e.request?.data, undefined, url);
    assert.equal(e.request?.query_string, undefined, url);
  }
  // a path that only looks like one still carries its body
  const other = scrubEvent({ request: { url: "https://x0bot.com/v1/botsapp/plan/day", data: { ok: 1 } } });
  assert.deepEqual(other.request?.data, { ok: 1 });
});

test("8.9.1's keys are cut from any body, breadcrumb or extra", () => {
  const e = scrubEvent({
    request: { url: "https://x0bot.com/v1/other", data: { blocks: [1], items: [2], ok: 3 } },
    extra: { sleepMinutes: 430, driving: true, focus: true, hold: "calls", token: "abc", challenge: "c", keyId: "k", attestation: "a", fine: "yes" },
    breadcrumbs: [
      { category: "console", message: "calendar.sync outcome", data: { blocks: [1] } },
      { category: "console", message: "plan_call_check", data: { driving: true } },
    ],
  });
  assert.deepEqual(e.request?.data, { blocks: "[health removed]", items: "[health removed]", ok: 3 });
  for (const k of ["sleepMinutes", "driving", "focus", "hold", "token", "challenge", "keyId", "attestation"]) {
    assert.equal((e.extra as Record<string, unknown>)[k], "[health removed]", k);
  }
  assert.equal(e.extra?.fine, "yes");
  for (const b of e.breadcrumbs!) {
    assert.equal(b.message, "[health removed]");
    assert.equal(b.data?.blocks, undefined);
    assert.equal(b.data?.driving, undefined);
  }
});
