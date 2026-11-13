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
