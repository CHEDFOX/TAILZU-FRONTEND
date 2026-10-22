// node --test --experimental-strip-types src/sdui/fill.test.ts
//
// What Ask on the phone runs with one tap of Do it: the question goes out
// with what was typed, the answer's hand-off is opened as the server wrote
// it, and an approval opens the task the answer named. Each reference is
// filled in once, from the screen's state, and nothing a value holds is
// read as another reference.

import test from "node:test";
import assert from "node:assert";
import { fillText, navParams, resolveValue, type Scope } from "./fill.ts";
import { Store } from "./state.ts";
import { isOpenableUrl } from "../security.ts";

const scope = (state: Record<string, any>, flags: Record<string, any> = {}): Scope =>
  ({ store: new Store(state), flags, labels: { "ask.empty": "Say what to do" } });

test("the ask carries what was typed", () => {
  const s = scope({ ask: { text: "pay rahul 200" } });
  assert.deepEqual(
    resolveValue({ text: "$state.ask.text", platform: "android" }, s),
    { text: "pay rahul 200", platform: "android" },
  );
});

test("openUrl opens the answer's hand-off exactly as the server wrote it", () => {
  for (const url of [
    "https://wa.me/919876543210?text=Running%2010%20min%20late",
    "upi://pay?pa=rahul.k@okaxis&pn=Rahul&am=200.00&cu=INR",
    "tel:+919876543210",
    "sms:?body=Reached",
    "https://www.google.com/maps/dir/?api=1&destination=Connaught%20Place",
  ]) {
    const filled = fillText("$state.ask.res.open.url", scope({ ask: { res: { say: "Opening it.", open: { url, label: "Open" } } } }));
    assert.equal(filled, url);
    assert.equal(isOpenableUrl(filled), true, url);
  }
});

test("a value is filled in once: what it holds is never read as a reference", () => {
  const url = "https://wa.me/?text=$state.secret";
  const s = scope({ secret: "token", ask: { res: { open: { url } } } });
  assert.equal(fillText("$state.ask.res.open.url", s), url);
});

test("no hand-off opens nothing", () => {
  const s = scope({ ask: { res: { say: "Done." } } });
  assert.equal(fillText("$state.ask.res.open.url", s), "");
  assert.equal(isOpenableUrl(fillText("$state.ask.res.open.url", s)), false);
  // A link the phone does not open stays unopened, wherever it came from.
  const bad = scope({ ask: { res: { open: { url: "intent://pay#Intent;scheme=upi;end" } } } });
  assert.equal(isOpenableUrl(fillText("$state.ask.res.open.url", bad)), false);
});

test("navigate opens the task the answer named", () => {
  const s = scope({ ask: { res: { taskId: "t_42" } } });
  assert.deepEqual(navParams({ taskId: "$state.ask.res.taskId", alone: "1" }, s), { taskId: "t_42", alone: "1" });
});

test("navigate's literal params go as written, and none stay none", () => {
  const s = scope({ ask: { res: {} } }, { beta: true });
  assert.deepEqual(navParams({ taskId: "t_7", pushId: "p1", n: 3 }, s), { taskId: "t_7", pushId: "p1", n: 3 });
  assert.deepEqual(navParams({ price: "$5" }, s), { price: "$5" });
  assert.deepEqual(navParams({ beta: "$flags.beta" }, s), { beta: true });
  assert.equal(navParams(undefined, s), undefined);
  // An answer without a task leaves the param empty, and the sheet shows the
  // newest waiting task as it did before.
  assert.deepEqual(navParams({ taskId: "$state.ask.res.taskId" }, s), { taskId: undefined });
});

test("a toast's words: a catalog key, a sentence with state in it", () => {
  const s = scope({ name: "Rahul" });
  assert.equal(fillText("@ask.empty", s), "Say what to do");
  assert.equal(fillText("@missing.key", s), "");
  assert.equal(fillText("Paying $state.name.", s), "Paying Rahul.");
});
