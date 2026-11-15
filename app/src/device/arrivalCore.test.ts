// node --test --experimental-strip-types src/device/arrivalCore.test.ts
//
// Arrival reminders' rules (docs: perms2 7): nothing is ever POSTed, the set is bounded and checked, Approximate Location is
// refused rather than armed, Android's "Allow all the time" step is its own outcome and not a refusal, a tap opens the item
// it came from, and the armed places are unarmed when the account goes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARRIVE_PREFIX, MAX_ITEMS, RADIUS_DEFAULT, RADIUS_MAX, RADIUS_MIN, arrivalOpening, arrivalSync, arrivalTapScreen, cleanItems,
  type ArrivalDeps,
} from "./arrivalCore.ts";

const ONE = { id: "item-1", lat: 12.9345, lon: 77.6101, radiusM: 150, title: "You're at Koramangala Market", body: "Pick up dry cleaning", screen: "bots.plan-item" };

function deps(over: Partial<ArrivalDeps> = {}) {
  const armed: unknown[] = [];
  const count = { cleared: 0, asked: 0 };
  const d: ArrivalDeps = {
    available: () => true,
    // One call for the whole permission flow, because Android's is two grants in sequence. `asked` counts the prompts.
    grant: async (ask) => { if (ask) count.asked++; return "arm"; },
    arm: async (items) => { armed.push(items); return { armed: items.length }; },
    clear: async () => { count.cleared++; },
    ...over,
  };
  return Object.assign(d, { armed, count });
}

test("an item's bounds are checked here too, and a bad row never costs the others", () => {
  const got = cleanItems([
    ONE,
    { ...ONE, id: "Bad Id" },
    { ...ONE, id: "item-2", lat: 91 },
    { ...ONE, id: "item-3", lon: -181 },
    { ...ONE, id: "item-4", title: "" },
    { ...ONE, id: "item-1" },                                  // the same id twice: once
    { ...ONE, id: "item-5", radiusM: 10 },
    { ...ONE, id: "item-6", radiusM: 9999 },
    { ...ONE, id: "item-7", radiusM: "x" },
    { ...ONE, id: "item-8", title: "t".repeat(200), body: "b".repeat(400), screen: "s".repeat(400) },
    null,
    "nope",
  ]);
  assert.deepEqual(got.map((i) => i.id), ["item-1", "item-5", "item-6", "item-7", "item-8"]);
  assert.equal(got[1].radiusM, RADIUS_MIN);
  assert.equal(got[2].radiusM, RADIUS_MAX);
  assert.equal(got[3].radiusM, RADIUS_DEFAULT);
  assert.equal(got[4].title.length, 60);
  assert.equal(got[4].body.length, 140);
  assert.equal(got[4].screen?.length, 120);
  assert.deepEqual(cleanItems("nope"), []);
  // ten at most, because iOS watches no more
  const many = Array.from({ length: 30 }, (_, i) => ({ ...ONE, id: `i-${i}` }));
  assert.equal(cleanItems(many).length, MAX_ITEMS);
  assert.equal(ARRIVE_PREFIX, "x0.arrive.");
});

test("arming asks for location only when told to, and never posts anything", async () => {
  const d = deps({ grant: async (ask) => { if (!ask) return "denied"; throw new Error("asked without ask"); } });
  assert.deepEqual(await arrivalSync({ items: [ONE] }, d), { outcome: "denied" });
  assert.equal(d.count.asked, 0);
  assert.equal(d.armed.length, 0);
  const asking = deps();
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, asking), { outcome: "armed", armed: 1 });
  assert.equal(asking.count.asked, 1);
  assert.deepEqual(asking.armed, [[{ ...ONE }]]);
});

test("Approximate Location is said, not worked around", async () => {
  // The iPhone's native side reports it at arm time; Android reports it from the grant step.
  const d = deps({ arm: async () => "approximate" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, d), { outcome: "approximate" });
  const android = deps({ grant: async () => "approximate" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, android), { outcome: "approximate" });
  assert.equal(android.armed.length, 0);
});

// ANDROID'S SECOND STEP. Precise location IS held and "Allow all the time" is not, and that is not a refusal: the server's own
// card explains it and its Continue asks for it. Nothing is armed yet, and nothing is posted either way.
test("the Android background-location step is its own outcome, not a denial", async () => {
  const d = deps({ grant: async () => "background" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, d), { outcome: "background" });
  assert.equal(d.armed.length, 0);
  // And the same word coming back from the native arm (a grant revoked between the two calls) reads the same way.
  const late = deps({ arm: async () => "background" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, late), { outcome: "background" });
  // A build with the switch off answers "unavailable" rather than pretending to arm.
  const off = deps({ arm: async () => "unavailable" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, off), { outcome: "unavailable" });
});

test("an empty set clears the phone's own reminders and needs no permission at all", async () => {
  const d = deps({ grant: async () => { throw new Error("never asked"); } });
  assert.deepEqual(await arrivalSync({ items: [] }, d), { outcome: "cleared", armed: 0 });
  assert.deepEqual(await arrivalSync({ items: "nonsense" }, d), { outcome: "cleared", armed: 0 });
  assert.equal(d.count.cleared, 2);
});

test("a blocked or refused grant, a binary without the functions, and a throw each say so", async () => {
  assert.deepEqual(await arrivalSync({ items: [ONE] }, deps({ grant: async () => "blocked" })), { outcome: "blocked" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, deps({ grant: async () => "blocked" })), { outcome: "blocked" });
  assert.deepEqual(await arrivalSync({ items: [ONE], ask: true }, deps({ arm: async () => "blocked" })), { outcome: "blocked" });
  assert.deepEqual(await arrivalSync({ items: [ONE] }, deps({ available: () => false })), { outcome: "unavailable" });
  assert.deepEqual(await arrivalSync({ items: [ONE] }, deps({ arm: async () => { throw new Error("x"); } })), { outcome: "error" });
});

test("a tap on the phone's own arrival notification opens that item, and nothing else routes", () => {
  assert.equal(arrivalTapScreen({ kind: "arrival", screen: "bots.plan-item" }), "bots.plan-item");
  assert.equal(arrivalTapScreen({ kind: "arrival" }), null);
  assert.equal(arrivalTapScreen({ kind: "arrival", screen: "" }), null);
  assert.equal(arrivalTapScreen({ kind: "bots.update", screen: "home" }), null);
  for (const v of [null, undefined, "arrival", 7]) assert.equal(arrivalTapScreen(v), null);
  assert.equal(arrivalTapScreen({ kind: "arrival", screen: "s".repeat(400) })?.length, 120);
  // AND A TAP HANDS ON THE SCREEN ID ALONE. TulmiArrival.swift's userInfo is `{kind: "arrival", screen: "bots.plan"}`, and
  // expo-notifications gives a local notification's whole userInfo back as the push's data; push.ts turns that into the
  // screen's params, which fetchScreen POSTs to /v1/app/screen. So `kind: "arrival"` must not ride along: it would tell
  // X0 Bot's servers the moment someone arrived somewhere.
  assert.deepEqual(arrivalOpening({ kind: "arrival", screen: "bots.plan" }), { screenId: "bots.plan" });
  assert.deepEqual(arrivalOpening({ kind: "arrival", screen: "bots.plan", place: "Bengaluru", at: 1 }), { screenId: "bots.plan" });
  // Any other push is left exactly as it was: null means "not one of ours".
  assert.equal(arrivalOpening({ kind: "bots.update", screen: "home" }), null);
  assert.equal(arrivalOpening({ kind: "arrival" }), null);
});

// AND THE PLACES ARE UNARMED WHEN THE ACCOUNT GOES (Apple's account-deletion page, TN3194). The pending x0.arrive.*
// notifications hold the item's title and its place, so one left armed would fire for a deleted account, or for the
// next person on the phone. The wiring is read here rather than mocked, because what matters is that the one path
// that always arrives really calls it: the SIGNED_OUT branch runs forgetAccountData, which clears them.
test("forgetting an account clears the armed places, once, and nothing waits on it", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  // The one guarded call, exactly as deps.clear reaches the module: through natives.ts, optional, never throwing.
  const arrival = read("src/device/arrival.ts");
  assert.match(arrival, /export async function forgetArrival\(\): Promise<void> \{[\s\S]*?tulmiPerms\(\)\?\.arrivalClear\?\.\(\)[\s\S]*?catch/);

  // SIGN-OUT, A SESSION REVOKED, AN ACCOUNT DELETED: all one event, and it wipes the account's data.
  const auth = read("src/sdui/shell/hooks/useAuthSession.ts");
  const signedOut = auth.slice(auth.indexOf('if (e === "SIGNED_OUT"'), auth.indexOf("if (s) void syncKeyboardCredentials"));
  assert.ok(signedOut.includes("forgetAccountData()"), "the SIGNED_OUT branch must forget the account's data");
  // ONE CALL, NOT TWO. forgetAccountData clears them itself, so a second call here only started the same native
  // work twice at once.
  assert.ok(!auth.includes("forgetArrival"), "arrival is cleared through forgetAccountData, not a second time here");

  const boot = read("src/sdui/client/bootstrap.ts");
  const forget = boot.slice(boot.indexOf("export async function forgetAccountData"));
  assert.ok(forget.includes("void forgetArrival()"), "forgetAccountData must clear the armed places");
  // AND THE REST OF THE WIPE DOES NOT WAIT ON THE NATIVE CALL: the keyboard's token, the local store and the
  // storage sweep may not sit behind a geofence task that can settle neither way.
  assert.ok(!forget.includes("await forgetArrival()"), "the wipe must not wait on the arrival module");
});
