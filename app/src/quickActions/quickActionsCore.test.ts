// node --test --experimental-strip-types src/quickActions/quickActionsCore.test.ts
//
// The app icon's long-press list: the server's, checked per platform, in its order, capped.

import test from "node:test";
import assert from "node:assert";
import { cleanQuickActions, quickActionsSignature } from "./quickActionsCore.ts";

const LIST = [
  { id: "ask", title: "Ask", subtitle: "Ask any bot", icon: "sparkles", url: "tulmi://screen/bots.ask" },
  { id: "dictate", title: "Dictate", icon: "waveform", url: "tulmi://screen/bots.keybot", arm: "screen/flow_arm" },
  { id: "note", title: "New note", icon: "square.and.pencil", url: "tulmi://screen/bots.plan.item?kind=task" },
  { id: "spaces", title: "Spaces", icon: "person.2", url: "https://app.x0bot.com/s/bots.spaces" },
];

test("in the server's order, each checked", () => {
  const ios = cleanQuickActions(LIST, "ios", 4);
  assert.deepEqual(ios.map((a) => a.id), ["ask", "dictate", "note", "spaces"]);
  assert.equal(ios[1]!.arm, "screen/flow_arm");
  assert.equal(ios[0]!.subtitle, "Ask any bot");
  // Android: drawable names, no arming tombstone.
  const android = cleanQuickActions([{ ...LIST[0]!, icon: "tailzu_wi_ask" }, LIST[1]!, { ...LIST[2]!, icon: "square.and.pencil" }], "android", 4);
  assert.equal(android[0]!.icon, "tailzu_wi_ask");
  assert.equal(android[1]!.arm, undefined);
  assert.equal(android[2]!.icon, undefined);
});

test("bad entries are left out, the list is capped", () => {
  const out = cleanQuickActions([
    { id: "web", title: "Web", url: "https://evil.com" },
    { id: "BAD", title: "x", url: "tulmi://screen/a" },
    { id: "empty", title: " ", url: "tulmi://screen/a" },
    { id: "arm", title: "Arm", url: "tulmi://screen/a", arm: "../x" },
    { id: "arm", title: "Again", url: "tulmi://screen/b" },
    ...LIST,
  ], "ios", 3);
  assert.deepEqual(out.map((a) => a.id), ["arm", "ask", "dictate"]);
  assert.equal(out[0]!.arm, undefined);
  assert.equal(cleanQuickActions(LIST, "ios", 99).length, 4);
  assert.equal(cleanQuickActions(LIST, "ios", 0).length, 0);
  assert.deepEqual(cleanQuickActions("nope", "ios", 4), []);
});

test("a signature that moves only when the list does", () => {
  const a = cleanQuickActions(LIST, "ios", 4);
  assert.equal(quickActionsSignature(a), quickActionsSignature(cleanQuickActions(LIST, "ios", 4)));
  assert.notEqual(quickActionsSignature(a), quickActionsSignature(cleanQuickActions([{ ...LIST[0]!, title: "Ask X0" }, ...LIST.slice(1)], "ios", 4)));
});
