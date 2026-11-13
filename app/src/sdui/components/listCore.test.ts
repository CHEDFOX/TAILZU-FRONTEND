// node --test --experimental-strip-types src/sdui/components/listCore.test.ts
//
// Lists: the window a row size asks for, the paths a page may come from, what a page does to the rows already held,
// and which child of a Screen becomes the screen's scroller.
import test from "node:test";
import assert from "node:assert";
import {
  LIST_LIMITS, apiPath, asking, boundedHeight, canAsk, eachCount, firstPage, itemLayout, keyOf, merged, pageBody,
  pageFailed, pageOk, refreshed, rowKeys, rowSize, rowsOf, screenListPlan, windowPlan,
} from "./listCore.ts";

test("a row size is clamped, and nonsense becomes the fallback", () => {
  assert.strictEqual(rowSize(72), 72);
  assert.strictEqual(rowSize("72"), 72);
  assert.strictEqual(rowSize(0), 8, "below the floor");
  assert.strictEqual(rowSize(1e9), 2000, "above the ceiling");
  assert.strictEqual(rowSize("tall"), 64);
  assert.strictEqual(rowSize(undefined), 64);
  assert.strictEqual(rowSize(NaN), 64);
});

test("the window is a screenful plus a row, half-screen batches, and a few screenfuls kept", () => {
  const p = windowPlan(72, 800); // 12 rows of 72 cover 800
  assert.strictEqual(p.initialNumToRender, 13, "a screenful plus one, so the first paint is never short");
  assert.strictEqual(p.maxToRenderPerBatch, 6);
  assert.ok(p.windowSize >= 3 && p.windowSize <= 11);
  // A tiny row in a tall view must not mount thousands of cells.
  const tiny = windowPlan(8, 2000);
  assert.ok(tiny.initialNumToRender <= 61, `one screenful at most (${tiny.initialNumToRender})`);
  assert.ok(tiny.windowSize <= 11);
  // No height yet (the screen's scroller has not measured): still a usable plan, never zero.
  assert.ok(windowPlan(64, 0).initialNumToRender > 1);
  assert.deepStrictEqual(itemLayout(72, 3), { length: 72, offset: 216, index: 3 });
});

test("a page may only come from our own API, under /v1/", () => {
  assert.strictEqual(apiPath("/v1/feed?cursor=7"), "/v1/feed?cursor=7");
  assert.strictEqual(apiPath(" /v1/feed "), "/v1/feed", "trimmed");
  assert.strictEqual(apiPath("https://evil.example/v1/feed"), null, "a whole URL");
  assert.strictEqual(apiPath("//evil.example/v1/feed"), null, "an authority");
  assert.strictEqual(apiPath("/v1/../../admin"), null, "a climb");
  assert.strictEqual(apiPath("/v2/feed"), null, "another version");
  assert.strictEqual(apiPath("/feed"), null, "no /v1/");
  assert.strictEqual(apiPath("/v1/feed?u=https://evil.example"), null, "a scheme anywhere");
  assert.strictEqual(apiPath("/v1/feed\nHost: evil"), null, "control characters");
  assert.strictEqual(apiPath("/v1/" + "x".repeat(LIST_LIMITS.pathMax)), null, "too long");
  assert.strictEqual(apiPath(42), null);
  assert.strictEqual(apiPath(null), null);
});

test("a first page with no usable endpoint has nothing to ask for", () => {
  const bad = firstPage("https://evil.example/v1/feed");
  assert.strictEqual(bad.next, null);
  assert.strictEqual(bad.done, true);
  assert.strictEqual(canAsk(bad), false);
  const good = firstPage("/v1/feed");
  assert.strictEqual(good.next, "/v1/feed");
  assert.strictEqual(canAsk(good), true);
  assert.strictEqual(canAsk(asking(good)), false, "one page in the air at a time");
});

test("a page's rows and its next path are read out of the body, and the next path is checked too", () => {
  assert.deepStrictEqual(pageBody({ items: [1, 2], next: "/v1/feed?c=2" }), { items: [1, 2], next: "/v1/feed?c=2" });
  assert.deepStrictEqual(pageBody({ rows: ["a"] }), { items: ["a"], next: null });
  assert.deepStrictEqual(pageBody({ data: ["a"], next: "https://evil.example" }), { items: ["a"], next: null });
  assert.deepStrictEqual(pageBody("no"), { items: [], next: null });
  assert.strictEqual(pageBody({ items: Array.from({ length: 500 }, (_, i) => i) }).items.length, LIST_LIMITS.pageMax);
});

test("rows merge without duplicates, and the list stops at the cap rather than dropping what is on screen", () => {
  const held = [{ id: "a" }, { id: "b" }];
  const next = merged(held, [{ id: "b" }, { id: "c" }], "append", "id");
  assert.deepStrictEqual(next, [{ id: "a" }, { id: "b" }, { id: "c" }], "b arrived twice, once is enough");
  assert.deepStrictEqual(merged(held, [{ id: "z" }], "prepend", "id")[0], { id: "z" });
  assert.deepStrictEqual(merged(held, [{ id: "z" }], "replace", "id"), [{ id: "z" }]);
  // With no key, rows are taken as they come (two identical rows are two rows).
  assert.strictEqual(merged(["x"], ["x"], "append", "").length, 2);
  const full = Array.from({ length: LIST_LIMITS.heldMax }, (_, i) => ({ id: String(i) }));
  const over = merged(full, [{ id: "new" }], "append", "id");
  assert.strictEqual(over.length, LIST_LIMITS.heldMax);
  assert.deepStrictEqual(over[0], { id: "0" }, "the rows under the finger stay");
});

test("a page that arrives moves the cursor on; the one with no next ends the list", () => {
  const first = pageOk([], { items: [{ id: "a" }], next: "/v1/feed?c=2" }, "append", "id");
  assert.strictEqual(first.state.next, "/v1/feed?c=2");
  assert.strictEqual(first.state.done, false);
  assert.strictEqual(first.state.held, 1);
  const last = pageOk(first.items, { items: [{ id: "b" }] }, "append", "id");
  assert.deepStrictEqual(last.items.map((r: any) => r.id), ["a", "b"]);
  assert.strictEqual(last.state.done, true, "no next: nothing more to ask for");
  assert.strictEqual(canAsk(last.state), false);
});

test("failures are counted, the path is kept, and a refresh starts again", () => {
  let s = firstPage("/v1/feed");
  for (let i = 0; i < LIST_LIMITS.failMax; i++) s = pageFailed(asking(s));
  assert.strictEqual(s.next, "/v1/feed", "the path is kept, so a retry is possible");
  assert.strictEqual(canAsk(s), false, "it stops asking by itself");
  const again = refreshed("/v1/feed");
  assert.strictEqual(again.fails, 0);
  assert.strictEqual(canAsk(again), true);
});

test("a row's key is its own id, else its place", () => {
  assert.strictEqual(keyOf({ id: "x" }, "id", 3), "x");
  assert.strictEqual(keyOf({ id: 7 }, "id", 3), "7");
  assert.strictEqual(keyOf({ id: "" }, "id", 3), "#3", "an empty id is no id");
  assert.strictEqual(keyOf({ id: { deep: 1 } }, "id", 3), "#3", "an object is no key");
  assert.strictEqual(keyOf("plain", "", 2), "#2");
});

test("a Screen hands its scroll to its first List, with what is above and below it", () => {
  const plan = screenListPlan([{ type: "Text" }, { type: "Stack" }, { type: "List" }, { type: "Text" }]);
  assert.deepStrictEqual(plan, { index: 2, header: [0, 1], footer: [3] });
  assert.deepStrictEqual(screenListPlan([{ type: "List" }]), { index: 0, header: [], footer: [] });
  assert.strictEqual(screenListPlan([{ type: "Text" }]), null, "no List: the Screen keeps its own scroll");
  assert.strictEqual(screenListPlan(undefined), null);
  assert.strictEqual(screenListPlan(null), null);
});

test("Each draws what it has, what it was asked for, or the hard cap — whichever is smallest", () => {
  assert.strictEqual(eachCount(5, undefined), 5);
  assert.strictEqual(eachCount(5, 3), 3);
  assert.strictEqual(eachCount(10_000, undefined), LIST_LIMITS.eachMax);
  assert.strictEqual(eachCount(10_000, 9_000), LIST_LIMITS.eachMax, "a server cannot raise the cap");
  assert.strictEqual(eachCount(5, -1), 0);
  assert.strictEqual(eachCount(5, "two"), 5, "nonsense is no cap of its own");
  assert.deepStrictEqual(rowsOf({ not: "an array" }), []);
  assert.deepStrictEqual(rowsOf([1]), [1]);
});

test("a percent-encoded parent step cannot walk out of /v1/", () => {
  // `new URL("/v1/%2e%2e/admin", origin)` is /admin, and OkHttp on Android reads %2e%2e the same way. Every `next`
  // a page response sends comes through here, so this is the only thing between a page body and the rest of the API
  // with the person's own auth on it.
  assert.strictEqual(apiPath("/v1/%2e%2e/admin/users"), null);
  assert.strictEqual(apiPath("/v1/%2E%2E/admin"), null);
  assert.strictEqual(apiPath("/v1/.%2E/admin"), null);
  assert.strictEqual(apiPath("/v1/feed/%2e%2e%2f%2e%2e/admin"), null);
  assert.strictEqual(apiPath("/v1/%2f%2fevil.example.com/x"), null, "an authority, encoded");
  assert.strictEqual(apiPath("/v1/%ZZ/feed"), null, "a broken escape is not decidable, so it is refused");
  assert.strictEqual(apiPath("/v1/feed/%20more"), null, "whitespace, encoded");
  assert.strictEqual(apiPath("/v1/feed/a%2Db"), "/v1/feed/a%2Db", "an ordinary escape still passes");
});

test("a cursor's own query may hold a time, and the scheme check stays on the path", () => {
  // A real cursor: the colons are in a timestamp, not a scheme. This used to return null, which stopped paging
  // silently — no error, no more rows.
  assert.strictEqual(apiPath("/v1/feed?before=2026-11-13T10:00:00Z"), "/v1/feed?before=2026-11-13T10:00:00Z");
  assert.strictEqual(apiPath("/v1/feed?cursor=abc%3Adef"), "/v1/feed?cursor=abc%3Adef");
  assert.strictEqual(apiPath("/v1/https://evil.example.com"), null, "a scheme in the path is still refused");
  assert.strictEqual(apiPath("/v1/javascript:alert(1)"), null);
});

test("a refresh de-duplicates too, not only an append", () => {
  const body = { items: [{ id: "a" }, { id: "a" }, { id: "b" }] };
  const after = pageOk([], body, "replace", "id");
  assert.deepStrictEqual(after.items, [{ id: "a" }, { id: "b" }], "the repeated row is dropped, not drawn twice");
  assert.deepStrictEqual(
    merged([{ id: "x" }], [{ id: "y" }, { id: "y" }], "replace", "id"),
    [{ id: "y" }],
    "replace forgets what was held, and still keeps each key once",
  );
});

test("every row gets a key of its own, even when the data repeats one", () => {
  assert.deepStrictEqual(rowKeys([{ id: "a" }, { id: "a" }, { id: "b" }], "id"), ["a", "a~1", "b"]);
  assert.deepStrictEqual(rowKeys(["x", "x"], ""), ["#0", "#1"], "no key prop: the place is the key, already unique");
  assert.deepStrictEqual(rowKeys([], "id"), []);
  const keys = rowKeys([{ id: "a" }, { id: "a" }, { id: "a~1" }], "id");
  assert.strictEqual(new Set(keys).size, 3, "a row whose own id looks like a renamed one is still unique");
});

test("a List only windows inside a height it really has", () => {
  assert.strictEqual(boundedHeight({ height: 320 }), 320);
  assert.strictEqual(boundedHeight({ maxHeight: 240 }), 240);
  assert.strictEqual(boundedHeight({ height: "50%" }), 0, "a percentage is not a number of points");
  assert.strictEqual(boundedHeight({ height: 0 }), 0);
  assert.strictEqual(boundedHeight({}), 0);
  assert.strictEqual(boundedHeight(null), 0);
  assert.strictEqual(boundedHeight(undefined), 0);
});
