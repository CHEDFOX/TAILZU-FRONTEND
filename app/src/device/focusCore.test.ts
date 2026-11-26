// node --test --experimental-strip-types src/device/focusCore.test.ts
//
// Focus's rules (docs: perms2 4): on or off and the filter's own choice, never which Focus; the path is pinned; a state nobody
// has ever seen is not "no Focus"; and a stale "on" reads as off rather than holding calls for ever.
import test from "node:test";
import assert from "node:assert/strict";
import { FOCUS_MAX_AGE_MS, FOCUS_PATH, focusBody, focusPathOk, focusSync, type FocusDeps } from "./focusCore.ts";

const NOW = Date.parse("2026-11-14T09:40:00Z");

function deps(over: Partial<FocusDeps> = {}) {
  const posted: { path: string; body: unknown }[] = [];
  const d: FocusDeps = {
    now: () => NOW,
    source: "filter",
    read: () => ({ on: true, hold: "calls", at: NOW - 60_000 }),
    post: async (path, body) => { posted.push({ path, body }); return {}; },
    ...over,
  };
  return Object.assign(d, { posted });
}

test("the path is pinned", async () => {
  assert.ok(focusPathOk(FOCUS_PATH));
  for (const p of ["/ask", "/v1/botsapp/plan/focus/", "", null]) assert.ok(!focusPathOk(p as never));
  const d = deps();
  assert.deepEqual(await focusSync({ path: "/ask" }, d), { outcome: "error" });
  assert.equal(d.posted.length, 0);
});

test("what goes up is on, the hold, the source and the filter's own moment — and nothing else", async () => {
  const d = deps();
  assert.deepEqual(await focusSync({ path: FOCUS_PATH }, d), { outcome: "synced" });
  assert.deepEqual(d.posted, [{ path: FOCUS_PATH, body: { on: true, hold: "calls", source: "filter", at: NOW - 60_000 } }]);
});

test("the Focus's own name or mode can never ride along", () => {
  const body = focusBody({ on: true, hold: "callsAndPings", at: NOW, name: "Work", mode: "work.focus" }, "filter", NOW);
  assert.deepEqual(body, { on: true, hold: "callsAndPings", source: "filter", at: NOW });
  // an unknown hold is simply not said
  assert.deepEqual(focusBody({ on: true, hold: "everything" }, "dnd", NOW), { on: true, source: "dnd" });
});

test("a stale on reads as off, so a missed end never holds calls for ever", () => {
  assert.equal(focusBody({ on: true, at: NOW - FOCUS_MAX_AGE_MS - 1 }, "filter", NOW)?.on, false);
  assert.equal(focusBody({ on: true, at: NOW - FOCUS_MAX_AGE_MS + 1 }, "filter", NOW)?.on, true);
  // Android reads the switch itself, so there is nothing to go stale
  assert.equal(focusBody({ on: true }, "dnd", NOW)?.on, true);
});

test("the filter's own moment goes with it, so the server's 12 hours do not creep", () => {
  // Nudj reposts the state on every page appear. Without `at` the server counted its 12 hours from each post, so a
  // Focus whose end the filter never saw could hold calls for about 24 hours instead of 12.
  const saw = NOW - 3_600_000;
  assert.deepEqual(focusBody({ on: true, hold: "calls", at: saw }, "filter", NOW), { on: true, source: "filter", hold: "calls", at: saw });
  // Android's Do Not Disturb is read at the moment it is posted, so it carries none.
  assert.equal("at" in (focusBody({ on: true, at: saw }, "dnd", NOW) ?? {}), false);
  // Nothing readable is nothing sent, rather than a made-up moment.
  assert.equal("at" in (focusBody({ on: true }, "filter", NOW) ?? {}), false);
  assert.equal("at" in (focusBody({ on: true, at: 0 }, "filter", NOW) ?? {}), false);
  assert.equal("at" in (focusBody({ on: true, at: "soon" }, "filter", NOW) ?? {}), false);
  // And an end still carries it: the server reads `on: false` whatever the moment says.
  assert.deepEqual(focusBody({ on: false, at: saw }, "filter", NOW), { on: false, source: "filter", at: saw });
});

test("nothing known is not 'no Focus is on': it posts nothing", async () => {
  const none = deps({ read: () => null });
  assert.deepEqual(await focusSync({ path: FOCUS_PATH }, none), { outcome: "unavailable" });
  assert.equal(none.posted.length, 0);
  const odd = deps({ read: () => ({ hold: "calls" }) });
  assert.deepEqual(await focusSync({ path: FOCUS_PATH }, odd), { outcome: "none" });
  assert.equal(odd.posted.length, 0);
  for (const v of [null, undefined, 7, "on", {}]) assert.equal(focusBody(v, "dnd", NOW), null);
});

test("a throw is an error", async () => {
  assert.deepEqual(await focusSync({ path: FOCUS_PATH }, deps({ read: () => { throw new Error("x"); } })), { outcome: "error" });
  assert.deepEqual(await focusSync({ path: FOCUS_PATH }, deps({ post: async () => { throw new Error("x"); } })), { outcome: "error" });
});
