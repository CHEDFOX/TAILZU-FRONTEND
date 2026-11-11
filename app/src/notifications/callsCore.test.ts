// node --test --experimental-strip-types src/notifications/callsCore.test.ts
//
// "X0 is calling" on the phone: what the push token says it can take, which notifications are a call's and when a ring is over,
// when Android may be rung at all, and the server's call buttons as the phone registers and runs them.

import test from "node:test";
import assert from "node:assert";
import {
  CALLS_CHANNEL, CALLS_MISSED_CHANNEL, CALL_CAP, CALL_VIBRATION, RINGTONE_CAP, RINGTONE_FILE, STALE_RING_MS,
  callCaps, callOf, channelsUsable, deliveredMs, isRingingCall, isStaleRing,
} from "./callsCore.ts";
import { callFor, cleanCategories, findAction, pressedButton } from "./categoriesCore.ts";
import { CORE_COMPONENTS } from "../sdui/registry.ts";
import { BOT_CALL_CAPABILITY } from "../sdui/types.ts";

const ID = "3f2b9c1e-8a4d-4f6b-9c2e-1d5a7b8c9e0f";
const ring = { call: ID, state: "ringing", day: "2026-11-11", screenId: "bots.plan.call", pushId: "p1", kind: "plan_call" };
const missed = { ...ring, state: "missed", pushId: "p2", kind: "plan_call_missed" };
const NOW = 1_762_850_000_000;

test("the names the server knows: the caps, the tone's file and the channels are the contract's, letter for letter", () => {
  assert.equal(CALL_CAP, "BotCall");
  assert.equal(CALL_CAP, BOT_CALL_CAPABILITY);
  assert.equal(RINGTONE_CAP, "BotRingtone");
  assert.equal(RINGTONE_FILE, "x0_ring_1.wav");
  assert.equal(CALLS_CHANNEL, "calls");
  assert.equal(CALLS_MISSED_CHANNEL, "calls_missed");
  assert.equal(STALE_RING_MS, 50_000);
});

test("an iPhone always takes calls, and says it has the ringtone only once it is in place", () => {
  assert.deepStrictEqual(callCaps("ios", { ringtone: true }), ["BotCall", "BotRingtone"]);
  assert.deepStrictEqual(callCaps("ios", { ringtone: false }), ["BotCall"]);
  assert.deepStrictEqual(callCaps("ios", {}), ["BotCall"]);
  // Android channels mean nothing to an iPhone.
  assert.deepStrictEqual(callCaps("ios", { channels: true }), ["BotCall"]);
});

test("an Android phone takes calls only with its call channels usable, and never says it has a ringtone", () => {
  assert.deepStrictEqual(callCaps("android", { channels: true }), ["BotCall"]);
  assert.deepStrictEqual(callCaps("android", { channels: false }), []);
  assert.deepStrictEqual(callCaps("android", {}), []);
  assert.deepStrictEqual(callCaps("android", { channels: true, ringtone: true }), ["BotCall"]);
});

test("anything else (the web) is never rung", () => {
  assert.deepStrictEqual(callCaps("web", { ringtone: true, channels: true }), []);
});

test("the call screen's pieces are declared to the server under the same name the push token carries", () => {
  assert.ok((CORE_COMPONENTS as readonly string[]).includes(BOT_CALL_CAPABILITY));
  assert.equal((CORE_COMPONENTS as readonly string[]).filter((c) => c === "BotCall").length, 1);
});

test("a ringing call's notification is told by its kind, and every one of a call's notifications names the call", () => {
  assert.equal(isRingingCall(ring), true);
  assert.equal(callOf(ring), ID);
  // A missed call names its call too, but it is not ringing.
  assert.equal(isRingingCall(missed), false);
  assert.equal(callOf(missed), ID);
});

test("other pushes and junk are not a call's", () => {
  for (const junk of [undefined, null, "", "plan_call", 7, [], { kind: "plan_leave", item: "pe:x:2026-11-11" }, { kind: "plan_call" },
    { kind: "plan_call", call: 42 }, { kind: "plan_call", call: "" }, { kind: "plan_call", call: "../../etc" }, { kind: "plan_call", call: "a b" },
    { kind: "plan_call", call: "x".repeat(65) }]) {
    assert.equal(isRingingCall(junk), false, JSON.stringify(junk));
  }
  assert.equal(callOf({ call: "../x" }), "");
  assert.equal(callOf({ call: { id: ID } }), "");
  assert.equal(callOf("nope"), "");
});

test("a ring is over 50 seconds after it arrived: 49 s is still ringing, 51 s is stale", () => {
  assert.equal(isStaleRing(ring, NOW - 49_000, NOW), false);
  assert.equal(isStaleRing(ring, NOW - 51_000, NOW), true);
});

test("an iPhone's delivery time comes in seconds and is read as such, so a live iPhone ring is never cleared", () => {
  // expo-notifications on iOS: Notification.date is timeIntervalSince1970 (seconds); on Android it is ms.
  assert.equal(deliveredMs((NOW - 10_000) / 1000), NOW - 10_000);
  assert.equal(deliveredMs(NOW - 10_000), NOW - 10_000);
  assert.equal(isStaleRing(ring, (NOW - 10_000) / 1000, NOW), false);
  assert.equal(isStaleRing(ring, (NOW - 60_000) / 1000, NOW), true);
});

test("a missed call is never stale, and a ring with no date is left alone", () => {
  assert.equal(isStaleRing(missed, NOW - 3_600_000, NOW), false);
  for (const date of [undefined, null, 0, -5, "", "soon", NaN]) assert.equal(isStaleRing(ring, date, NOW), false, String(date));
  assert.equal(isStaleRing({ kind: "plan_leave" }, NOW - 3_600_000, NOW), false);
});

const ch = (importance: number) => ({ importance });
const NONE = 2;
const HIGH = 6;

test("Android may ring when both call channels are there and nothing is blocked", () => {
  assert.equal(channelsUsable({ calls: ch(HIGH), missed: ch(5), reminders: ch(HIGH) }, NONE), true);
});

test("a call channel that is missing means no ring (Expo drops a push whose channel is missing)", () => {
  assert.equal(channelsUsable({ calls: null, missed: ch(5), reminders: ch(HIGH) }, NONE), false);
  assert.equal(channelsUsable({ calls: ch(HIGH), missed: null, reminders: ch(HIGH) }, NONE), false);
  assert.equal(channelsUsable({}, NONE), false);
});

test("a person who blocked Calls, or Reminders, is never rung: they get today's push, or nothing, as they chose", () => {
  assert.equal(channelsUsable({ calls: ch(NONE), missed: ch(5), reminders: ch(HIGH) }, NONE), false);
  assert.equal(channelsUsable({ calls: ch(HIGH), missed: ch(5), reminders: ch(NONE) }, NONE), false);
  // Missed calls turned off is the person's choice about the record, not the ring.
  assert.equal(channelsUsable({ calls: ch(HIGH), missed: ch(NONE), reminders: ch(HIGH) }, NONE), true);
});

test("a phone that has never had a reminders channel (the server has not listed it yet) may still ring", () => {
  assert.equal(channelsUsable({ calls: ch(HIGH), missed: ch(5), reminders: null }, NONE), true);
  assert.equal(channelsUsable({ calls: ch(HIGH), missed: ch(5) }, NONE), true);
});

test("the ring's vibration starts at once and is over in under 10 seconds", () => {
  assert.equal(CALL_VIBRATION[0], 0);
  assert.ok(CALL_VIBRATION.every((n) => Number.isInteger(n) && n >= 0));
  assert.ok(CALL_VIBRATION.reduce((a, b) => a + b, 0) < 10_000);
});

// The categories exactly as the server lists them in the bootstrap (push.categories, contract section 1.4).
const CALL_CATEGORIES = [
  { id: "x0_call", actions: [
    { id: "p_answer", title: "Answer", icon: "waveform", foreground: true, destructive: false, auth: false, open: true },
    { id: "p_notnow", title: "Not now", icon: "xmark", foreground: false, destructive: false, auth: false,
      call: { method: "POST", path: "/v1/botsapp/bots/plan/calls/{data.call}/decline" } },
  ] },
  { id: "x0_call_missed", actions: [
    { id: "p_callback", title: "Call back", icon: "arrow.uturn.left", foreground: true, destructive: false, auth: false, open: true },
  ] },
];

test("the server's call categories are registered as they are: nothing dropped, nothing changed", () => {
  const cats = cleanCategories(CALL_CATEGORIES);
  assert.deepStrictEqual(cats, CALL_CATEGORIES);
});

test("Answer and Call back open the call screen, saying which button it was; a plain tap opens it too", () => {
  const cats = cleanCategories(CALL_CATEGORIES);
  assert.deepStrictEqual(callFor(findAction(cats, "p_answer")!, ring, "", "k", "/v1/widgets/act"), { kind: "open" });
  assert.deepStrictEqual(callFor(findAction(cats, "p_callback")!, missed, "", "k", "/v1/widgets/act"), { kind: "open" });
  assert.equal(pressedButton("p_answer", "expo.modules.notifications.actions.DEFAULT"), "p_answer");
  assert.equal(pressedButton("p_callback", "expo.modules.notifications.actions.DEFAULT"), "p_callback");
  assert.equal(pressedButton("expo.modules.notifications.actions.DEFAULT", "expo.modules.notifications.actions.DEFAULT"), "");
});

test("Not now declines that call in the background, with the call's own id in the path", () => {
  const cats = cleanCategories(CALL_CATEGORIES);
  assert.deepStrictEqual(callFor(findAction(cats, "p_notnow")!, ring, "", "k", "/v1/widgets/act"), {
    kind: "call", method: "POST", path: `/v1/botsapp/bots/plan/calls/${ID}/decline`,
  });
  // A push without a call id sends nothing rather than half a path.
  assert.deepStrictEqual(callFor(findAction(cats, "p_notnow")!, { kind: "plan_call" }, "", "k", "/v1/widgets/act"), { kind: "none", why: "no path" });
});
