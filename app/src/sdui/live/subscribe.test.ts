// node --test --experimental-strip-types src/sdui/live/subscribe.test.ts
//
// subscribe: modes, the 4-topic cap, the 64 KB cap, the 20-merges-a-second cap, safe paths and the answer stream left alone.
import test from "node:test";
import assert from "node:assert";
import { messageBytes, utf8Len, nextValue, normalizeSubscribe, SubscriptionHub } from "./subscribe.ts";
import type { LiveTimers } from "./liveCore.ts";

function rig() {
  let now = 1_000_000, seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: LiveTimers = {
    set: (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
    clear: (h) => { due.delete(h as number); },
    now: () => now,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      due.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  };
  const state = new Map<string, unknown>();
  const writes: string[] = [];
  const hub = new SubscriptionHub({ read: (p) => state.get(p), write: (p, v) => { state.set(p, v); writes.push(p); } }, timers);
  return { hub, state, writes, advance };
}

test("spec: bad topic, ask: topics and unsafe paths are refused; max and mode are clamped", () => {
  assert.equal(normalizeSubscribe({ topic: "ask:abc", into: "a" }), null);
  assert.equal(normalizeSubscribe({ topic: "has space", into: "a" }), null);
  assert.equal(normalizeSubscribe({ topic: "t", into: "a.__proto__" }), null);
  assert.equal(normalizeSubscribe({ topic: "t" }), null);
  assert.deepEqual(normalizeSubscribe({ topic: "t", into: "a", mode: "weird", max: 1e9 }), { topic: "t", into: "a", mode: "replace", max: 2000 });
  assert.equal(normalizeSubscribe({ topic: "t", into: "a", max: -5 })!.max, 1);
});

test("modes: replace, append (keeps the newest `max`), merge (no prototype keys)", () => {
  assert.equal(nextValue("replace", 1, 2, 5), 2);
  assert.deepEqual(nextValue("append", [1, 2], 3, 3), [1, 2, 3]);
  assert.deepEqual(nextValue("append", [1, 2, 3], [4, 5], 3), [3, 4, 5]);
  assert.deepEqual(nextValue("append", "nope", 1, 3), [1]);
  assert.deepEqual(nextValue("merge", { a: 1, b: 2 }, { b: 3 }, 1), { a: 1, b: 3 });
  const m = nextValue("merge", {}, JSON.parse('{"__proto__":{"x":1},"ok":1}'), 1) as any;
  assert.equal(m.ok, 1);
  assert.equal(({} as any).x, undefined);
  assert.equal(Object.keys(m).length, 1);
  assert.deepEqual(nextValue("merge", { a: 1 }, [1], 1), { a: 1 });
});

test("an event reaches the subscription that hears it, wildcards too", () => {
  const { hub, state } = rig();
  hub.add("s", { topic: "job:*", into: "job", mode: "merge" });
  assert.equal(hub.event("job:7", { p: 1 }), true);
  assert.deepEqual(state.get("job"), { p: 1 });
  assert.equal(hub.event("other", { p: 2 }), false);
  assert.equal(hub.event("ask:zz", { p: 2 }), false);
});

test("a screen may listen to 4 topics, no more; dropping the screen frees them", () => {
  const { hub } = rig();
  for (const t of ["a", "b", "c", "d"]) assert.ok(hub.add("s", { topic: t, into: t }));
  assert.equal(hub.add("s", { topic: "e", into: "e" }), null);
  assert.ok(hub.add("t", { topic: "e", into: "e" }));
  assert.equal(hub.topicsOf("s").length, 4);
  hub.dropScreen("s");
  assert.equal(hub.size, 1);
  assert.ok(hub.add("s", { topic: "e", into: "e" }));
});

test("stopping a subscription stops its writes", () => {
  const { hub, writes } = rig();
  const off = hub.add("s", { topic: "t", into: "x" })!;
  off();
  hub.event("t", 1);
  assert.equal(writes.length, 0);
});

test("a message over 64 KB is dropped", () => {
  const { hub, writes } = rig();
  hub.add("s", { topic: "t", into: "x" });
  assert.equal(hub.event("t", "a".repeat(70_000)), false);
  assert.equal(writes.length, 0);
  assert.ok(messageBytes("a".repeat(10)) < 65536);
  const cyc: any = {}; cyc.me = cyc;
  assert.equal(messageBytes(cyc), Infinity);
});

test("at most 20 merges a second: the rest wait and land in order in the next second", () => {
  const { hub, state, writes, advance } = rig();
  hub.add("s", { topic: "t", into: "log", mode: "append" });
  for (let i = 0; i < 30; i++) hub.event("t", i);
  assert.equal(writes.length, 20);
  assert.equal(hub.waiting, 10);
  advance(1100);
  assert.equal(writes.length, 30);
  assert.deepEqual(state.get("log"), Array.from({ length: 30 }, (_, i) => i));
  assert.equal(hub.waiting, 0);
});

test("while waiting, the newest replace stands in for older ones", () => {
  const { hub, state, advance } = rig();
  hub.add("s", { topic: "t", into: "v" });
  for (let i = 0; i < 20; i++) hub.event("t", i);
  for (let i = 100; i < 150; i++) hub.event("t", i);
  assert.equal(hub.waiting, 1);
  advance(1100);
  assert.equal(state.get("v"), 149);
});

test("a throwing host never escapes into the socket", () => {
  const h = new SubscriptionHub({ read: () => undefined, write: () => { throw new Error("boom"); } });
  h.add("s", { topic: "t", into: "x" });
  assert.doesNotThrow(() => h.event("t", 1));
});

test("an event with no data is a hint: state stays and nothing is taken", () => {
  const { hub, state } = rig();
  hub.add("s", { topic: "note:abc", into: "note" });
  hub.add("s", { topic: "log", into: "log", mode: "append" });
  hub.event("log", 1);
  assert.equal(hub.event("note:abc", undefined), false);
  assert.equal(hub.event("log", null), false);
  assert.equal(state.get("note"), undefined);
  assert.deepEqual(state.get("log"), [1]);
});

test("the size limit counts UTF-8 bytes, and nothing is serialised when nobody listens", () => {
  const { hub, state } = rig();
  assert.equal(utf8Len("é€😀"), 2 + 3 + 4);
  hub.add("s", { topic: "t", into: "v" });
  assert.equal(hub.event("t", "漢".repeat(30000)), false);
  assert.equal(state.get("v"), undefined);
  let calls = 0;
  const spy = { toJSON() { calls++; return 1; } };
  assert.equal(hub.event("other", spy), false);
  assert.equal(calls, 0);
});

test("append keeps to a byte budget, dropping the oldest", () => {
  const { hub, state, advance } = rig();
  hub.add("s", { topic: "t", into: "log", mode: "append" });
  for (let s = 0; s < 10; s++) { for (let i = 0; i < 20; i++) hub.event("t", "x".repeat(60000)); advance(1000); }
  const list = state.get("log") as string[];
  assert.ok(list.length > 0 && list.length * 60000 <= 1024 * 1024 + 60000);
});

test("a screen holds at most 4 subscriptions, and max must be a number", () => {
  const { hub } = rig();
  for (let i = 0; i < 4; i++) assert.ok(hub.add("s", { topic: "t", into: `v${i}` }));
  assert.equal(hub.add("s", { topic: "t", into: "v9" }), null);
  for (const m of [null, "", true]) assert.equal(normalizeSubscribe({ topic: "t", into: "x", max: m })!.max, 2000);
});

test("topic grammar: wildcard only trailing, no ask:", () => {
  for (const t of ["a*b", "*:x", "ask:1", "/v1/job/7", "a b"]) assert.equal(normalizeSubscribe({ topic: t, into: "x" }), null, t);
  for (const t of ["job:7", "job:*", "*"]) assert.ok(normalizeSubscribe({ topic: t, into: "x" }), t);
});
