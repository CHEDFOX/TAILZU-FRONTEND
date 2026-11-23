import test from "node:test";
import assert from "node:assert/strict";
import { linkScreen, LINK_SCREENS } from "./linkScreensCore.ts";

test("a screen not meant to be linked to is not opened from a link", () => {
  assert.equal(linkScreen("bots.plan.go", { item: "x", button: "pay" }), null);
  assert.equal(linkScreen("bots.space.pay", {}), null);
  assert.equal(linkScreen("settings_delete_account", {}), null);
});

test("a linked screen keeps only the params its links carry, each id-shaped", () => {
  assert.deepEqual(linkScreen("bots.spaces", { join: "ABC123", button: "pay", pushId: "p1" }), { screenId: "bots.spaces", params: { join: "ABC123" } });
  assert.deepEqual(linkScreen("bots.code.job", { id: "j-1", autoApprove: "1" }), { screenId: "bots.code.job", params: { id: "j-1" } });
  assert.deepEqual(linkScreen("bots.ask", { voice: "1", text: "send my password" }), { screenId: "bots.ask", params: { voice: "1" } });
  assert.deepEqual(linkScreen("bots.spaces", { join: "<script>" }), { screenId: "bots.spaces", params: {} }, "a value that is not id-shaped is dropped");
  assert.deepEqual(linkScreen("paywall", { plan: "x" }), { screenId: "paywall", params: {} });
});

test("every link the server and the app's own surfaces write still opens", () => {
  for (const [id, q] of [
    ["bots.ask", {}], ["bots.ask", { voice: "1" }], ["bots.spaces", {}], ["bots.code", {}], ["bots.keybot", {}], ["bots.keybot.on", {}],
    ["bots.plan.item", { kind: "task" }], ["bots.usage", {}], ["bots.thread", { id: "t1" }], ["bots.space.tasks", { id: "s1" }],
    ["bots.link", { l: "a".repeat(43) }], ["bots.link", { c: "K7Q42MXP" }], ["bots.bot", { slug: "gym-bot" }], ["bots.approve", { task: "t-1" }],
    ["home", {}], ["bots.home", {}], ["assistant_apps", { entry: "link" }], ["assistant_tasks", {}], ["bots.plan", {}],
  ] as const) {
    const r = linkScreen(id, q as Record<string, string>);
    assert.ok(r, id);
    assert.deepEqual(r.params, q, id);
  }
});

test("the microphone screens pass through with nothing, for the shell's tombstone check", () => {
  assert.deepEqual(linkScreen("flow_arm", { button: "x" }, { transient: ["flow_arm"] }), { screenId: "flow_arm", params: {} });
  assert.equal(linkScreen("flow_arm", {}), null, "not a link target on its own");
});

test("the server can replace the list and give a screen it adds its params", () => {
  const rules = { screens: ["bots.ask", "bots.new"], params: { "bots.new": ["id"], "bots.ask": ["text"] } };
  assert.equal(linkScreen("bots.spaces", { join: "ABC123" }, rules), null);
  assert.deepEqual(linkScreen("bots.new", { id: "n1", x: "y" }, rules), { screenId: "bots.new", params: { id: "n1" } });
  assert.deepEqual(linkScreen("bots.ask", { voice: "1", text: "hi" }, rules), { screenId: "bots.ask", params: { voice: "1" } }, "a compiled screen keeps its own params");
  assert.ok(Object.isFrozen(LINK_SCREENS));
});
