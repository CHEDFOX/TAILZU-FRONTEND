// node --test --experimental-strip-types src/sdui/client/endpointCore.test.ts
//
// callEndpoint's new options: retry with backoff, the answer cache, path pinning, multipart checks, progress and optimistic writes.
import test from "node:test";
import assert from "node:assert";
import {
  applyOptimistic, normalizeCache, normalizeMultipart, normalizeRetry, pinned, progressSink, ResponseCache, retryable, retryDelayMs,
  safeStatePath, toProgress, withRetry, asNetworkError,
} from "./endpointCore.ts";

const sleeps = () => { const l: number[] = []; return { l, io: { sleep: async (ms: number) => { l.push(ms); }, random: () => 1 } }; };
const http = (status: number, name = "HttpError") => Object.assign(new Error("x"), { status, name });

test("backoff doubles from 500 ms, stops at 8 s, a number is itself, fixed is 1 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((i) => retryDelayMs(i, "exp", () => 1)), [500, 1000, 2000, 4000, 8000, 8000, 8000]);
  assert.equal(retryDelayMs(0, "exp", () => 0), 375);
  assert.equal(retryDelayMs(3, 250), 250);
  assert.equal(retryDelayMs(3, "fixed"), 1000);
});

test("retry spec is clamped", () => {
  assert.equal(normalizeRetry({ times: 99 }).times, 5);
  assert.equal(normalizeRetry({ times: -2 }).times, 0);
  assert.equal(normalizeRetry({ times: NaN as any }).times, 0);
  assert.equal(normalizeRetry(undefined).times, 0);
  assert.equal(normalizeRetry({ times: 1, backoff: 99999 }).backoff, 8000);
});

test("which failures retry", () => {
  assert.ok(!retryable("POST", undefined));
  assert.ok(retryable("POST", undefined, true));
  assert.ok(retryable("GET", undefined));
  assert.ok(retryable("POST", 429));
  assert.ok(retryable("POST", 503));
  assert.ok(!retryable("POST", 500));
  assert.ok(retryable("POST", 500, true));
  assert.ok(retryable("GET", 502));
  assert.ok(!retryable("GET", 404));
  assert.ok(!retryable("GET", 400));
});

test("withRetry tries again with growing waits, then succeeds", async () => {
  const { l, io } = sleeps();
  let n = 0;
  const out = await withRetry("GET", { times: 3 }, async () => { if (++n < 3) throw http(503); return "ok"; }, io);
  assert.equal(out, "ok");
  assert.equal(n, 3);
  assert.deepEqual(l, [500, 1000]);
});

test("withRetry gives up after `times` and throws the last error", async () => {
  const { io } = sleeps();
  let n = 0;
  await assert.rejects(withRetry("GET", { times: 2 }, async () => { n++; throw http(503); }, io), { status: 503 });
  assert.equal(n, 3);
});

test("withRetry never retries a 4xx, a quota refusal, or no retry spec", async () => {
  const { io } = sleeps();
  let n = 0;
  await assert.rejects(withRetry("GET", { times: 3 }, async () => { n++; throw http(404); }, io));
  await assert.rejects(withRetry("POST", { times: 3 }, async () => { n++; throw http(429, "QuotaExceededError"); }, io));
  await assert.rejects(withRetry("GET", undefined, async () => { n++; throw http(503); }, io));
  assert.equal(n, 3);
});

test("a POST is not repeated after a 500 unless idempotent", async () => {
  const { io } = sleeps();
  let n = 0;
  await assert.rejects(withRetry("POST", { times: 3 }, async () => { n++; throw http(500); }, io));
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(withRetry("POST", { times: 2, idempotent: true }, async () => { n++; throw http(500); }, io));
  assert.equal(n, 3);
});

test("cache: hit inside ttl, miss after, key and path together, bounded, ttl capped", () => {
  const c = new ResponseCache(2);
  const k = ResponseCache.keyOf({ key: "a", ttlMs: 1000 }, "/v1/x");
  c.set(k, { v: 1 }, 1000, 0);
  assert.deepEqual(c.get(k, 999), { hit: true, value: { v: 1 } });
  assert.deepEqual(c.get(k, 1000), { hit: false });
  assert.notEqual(k, ResponseCache.keyOf({ key: "a", ttlMs: 1000 }, "/v1/y"));
  c.set("1", 1, 5000, 0); c.set("2", 2, 5000, 0); c.set("3", 3, 5000, 0);
  assert.equal(c.size, 2);
  assert.equal(c.get("1", 1).hit, false);
  c.set("z", 1, 0, 0);
  assert.equal(c.get("z", 0).hit, false);
  c.set("big", 1, 10 ** 12, 0);
  assert.equal(c.get("big", 10 * 60 * 1000 + 1).hit, false);
  c.clear();
  assert.equal(c.size, 0);
});

test("cache spec needs a key and a positive time", () => {
  assert.equal(normalizeCache({ key: "", ttlMs: 5 }), null);
  assert.equal(normalizeCache({ key: "k", ttlMs: 0 }), null);
  assert.equal(normalizeCache({ key: "k", ttlMs: "x" as any }), null);
  assert.deepEqual(normalizeCache({ key: "k", ttlMs: 9e9 }), { key: "k", ttlMs: 600000 });
});

test("paths are pinned to our API under /v1/", () => {
  assert.ok(pinned("/v1/files"));
  for (const p of ["https://evil.example/v1/x", "//evil.example/v1/x", "/v1/../etc", "/v2/x", "/v1/a@b", "v1/x", "/v1/a\\b", 5, null]) assert.ok(!pinned(p), String(p));
});

test("state paths: 12 segments, 128 chars, no prototype keys", () => {
  assert.ok(safeStatePath("a.b.c"));
  assert.ok(!safeStatePath("a.__proto__.b"));
  assert.ok(!safeStatePath("a.constructor"));
  assert.ok(!safeStatePath("a..b"));
  assert.ok(!safeStatePath(Array(13).fill("a").join(".")));
  assert.ok(!safeStatePath("a".repeat(129)));
  assert.ok(!safeStatePath(""));
});

test("multipart keeps only local files and safe names", () => {
  const m = normalizeMultipart({
    files: [
      { field: "file", uri: "file:///a.jpg", type: "image/jpeg" },
      { field: "file", uri: "https://evil.example/a.jpg" },
      { field: "bad name", uri: "file:///b" },
      { field: "x", uri: "content://m/1", type: "not a type" },
    ],
    fields: { a: 1, "b c": "no", ok: true, o: {} as any },
  })!;
  assert.deepEqual(m.files.map((f) => f.uri), ["file:///a.jpg", "content://m/1"]);
  assert.equal(m.files[1].type, "application/octet-stream");
  assert.deepEqual(m.fields, { a: "1", ok: "true" });
  assert.equal(normalizeMultipart({ files: [{ field: "f", uri: "http://x" }] }), null);
  assert.equal(normalizeMultipart({ files: Array.from({ length: 20 }, () => ({ field: "f", uri: "file:///a" })) })!.files.length, 8);
});

test("progress maths and the throttled sink (the last one always lands)", () => {
  assert.deepEqual(toProgress(50, 200), { loaded: 50, total: 200, pct: 25 });
  assert.deepEqual(toProgress(5, 0), { loaded: 5, total: 0, pct: 0 });
  assert.equal(toProgress(500, 200).pct, 100);
  const w: unknown[] = [];
  let t = 0;
  const sink = progressSink((p, v) => w.push([p, (v as any).pct]), "up.p", () => t);
  sink.push(toProgress(1, 10)); t = 50; sink.push(toProgress(2, 10)); t = 60; sink.push(toProgress(3, 10));
  assert.deepEqual(w, [["up.p", 10]]);
  sink.flush();
  assert.deepEqual(w, [["up.p", 10], ["up.p", 30]]);
  const bad: unknown[] = [];
  progressSink((p) => bad.push(p), "__proto__.x").push(toProgress(1, 2));
  assert.equal(bad.length, 0);
});

test("optimistic writes at once and undoes", () => {
  const m = new Map<string, unknown>([["liked", false]]);
  const store = { get: (p: string) => m.get(p), set: (p: string, v: unknown) => void m.set(p, v) };
  const undo = applyOptimistic(store, { path: "liked", value: true });
  assert.equal(m.get("liked"), true);
  undo();
  assert.equal(m.get("liked"), false);
  applyOptimistic(store, { path: "__proto__.x", value: 1 })();
  assert.equal(m.size, 1);
});

test("a failure with no status is retried only when tagged as network", async () => {
  const { io } = sleeps();
  let n = 0;
  await assert.rejects(withRetry("GET", { times: 3 }, async () => { n++; throw new SyntaxError("bad json"); }, io));
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(withRetry("GET", { times: 2 }, async () => { n++; throw asNetworkError(new Error("down")); }, io));
  assert.equal(n, 3);
});

test("a network failure on a POST is retried only when idempotent", async () => {
  const { io } = sleeps();
  let n = 0;
  await assert.rejects(withRetry("POST", { times: 3 }, async () => { n++; throw asNetworkError(new Error("down")); }, io));
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(withRetry("POST", { times: 2, idempotent: true }, async () => { n++; throw asNetworkError(new Error("down")); }, io));
  assert.equal(n, 3);
});

test("the cache hands out copies, so a local edit never reaches the kept answer", () => {
  const c = new ResponseCache();
  const k = ResponseCache.keyOf({ key: "a", ttlMs: 1000 }, "/v1/x");
  const v = { n: 1, list: [1] };
  c.set(k, v, 1000, 0);
  v.n = 9;
  const a = c.get(k, 1) as { hit: true; value: any };
  a.value.list.push(2);
  const b = c.get(k, 2) as { hit: true; value: any };
  assert.deepEqual(b.value, { n: 1, list: [1] });
  assert.notStrictEqual(a.value, b.value);
});

test("state paths follow the kernel's segment rule", () => {
  for (const bad of ["a b", "x[0]", "@key", "a/b", "$state", "a..b", ""]) assert.ok(!safeStatePath(bad), bad);
  assert.ok(safeStatePath("a-b.c_1"));
});
