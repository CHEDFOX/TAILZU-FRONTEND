// node --test --experimental-strip-types src/device/permCaps.test.ts
//
// Each capability name is said only when the native function behind it is there; a binary without the module says none.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALL_CHECK_CAP, HK_OBJECTS, callCheckCaps, healthConnectFrom, healthKitFrom, permCapsFrom } from "./permCapsCore.ts";

const fn = () => {};

/** Every 8.9.1 name, its function and the ability the binary must also confirm (perms2 9.2). */
const NINE: [string, string, string][] = [
  ["CalendarAdd1", "calendarEditor", "calendarAdd"],
  ["CalendarRead1", "calendarBusy", "calendarRead"],
  ["Reminders1", "remindersRead", "reminders"],
  ["Focus1", "focusState", "focus"],
  ["Motion1", "motionDays", "motion"],
  ["Arrival1", "arrivalArm", "arrival"],
  ["AppAttest1", "attestKey", "appAttest"],
  ["DeviceCheck1", "deviceCheckToken", "deviceCheck"],
  ["PlayIntegrity1", "integrityToken", "playIntegrity"],
];

test("a binary without the module or the health package says none of the three", () => {
  assert.deepEqual(permCapsFrom({ perms: null, health: null }), []);
  assert.deepEqual(permCapsFrom({ perms: {}, health: null }), []);
});

test("ContactPick1 needs pickEmail, Location1 needs locationArea, each on its own", () => {
  assert.deepEqual(permCapsFrom({ perms: { pickEmail: fn }, health: null }), ["ContactPick1"]);
  assert.deepEqual(permCapsFrom({ perms: { locationArea: fn }, health: null }), ["Location1"]);
  assert.deepEqual(permCapsFrom({ perms: { pickEmail: "yes", locationArea: 1 }, health: null }), []);
});

test("Health1 needs the health module, whatever the perms module has", () => {
  assert.deepEqual(permCapsFrom({ perms: null, health: {} }), ["Health1"]);
  assert.deepEqual(permCapsFrom({ perms: { pickEmail: fn, locationArea: fn }, health: {} }), ["ContactPick1", "Location1", "Health1"]);
});

test("the bridge's frozen names are untouched: binaryCore.ts never names the three", () => {
  const core = readFileSync("src/device/binaryCore.ts", "utf8");
  for (const n of ["Location1", "ContactPick1", "Health1"]) assert.ok(!core.includes(n), n);
});

test("HealthKit is never required when any hybrid object is missing", () => {
  let loaded = 0;
  const load = () => { loaded++; return { requestAuthorization: fn }; };
  for (const missing of HK_OBJECTS) {
    assert.equal(healthKitFrom((n) => n !== missing, load), null);
  }
  assert.equal(loaded, 0);
  assert.equal(healthKitFrom(() => false, load), null);
  assert.ok(healthKitFrom(() => true, load));
  assert.equal(loaded, 1);
  assert.equal(healthKitFrom(() => true, () => { throw new Error("x"); }), null);
});

test("Health Connect needs the native module, not just JS exports", () => {
  let loaded = 0;
  const load = () => { loaded++; return { getSdkStatus: fn }; };
  assert.equal(healthConnectFrom(null, load), null);
  assert.equal(healthConnectFrom(undefined, load), null);
  assert.equal(loaded, 0);
  assert.ok(healthConnectFrom({}, load));
  assert.equal(healthConnectFrom({}, () => ({})), null);
});

// --------------------------------------------------------------------------------- build 8.9.1 (docs: perms2 9.2)

test("each 8.9.1 name needs BOTH its function and the binary's own ability", () => {
  for (const [cap, fname, ability] of NINE) {
    // the function alone (an older binary's abilities(), or a cut usage key) says nothing
    assert.deepEqual(permCapsFrom({ perms: { [fname]: fn }, health: null, abilities: null }), []);
    assert.deepEqual(permCapsFrom({ perms: { [fname]: fn }, health: null, abilities: {} }), []);
    assert.deepEqual(permCapsFrom({ perms: { [fname]: fn }, health: null, abilities: { [ability]: false } as never }), []);
    // the ability alone (a key present but this bundle older than the function) says nothing either
    assert.deepEqual(permCapsFrom({ perms: {}, health: null, abilities: { [ability]: true } as never }), []);
    assert.deepEqual(permCapsFrom({ perms: { [fname]: fn }, health: null, abilities: { [ability]: true } as never }), [cap], cap);
  }
});

test("a binary without the 8.9.1 functions says none of them, whatever abilities() claims", () => {
  const all = Object.fromEntries(NINE.map(([, , ability]) => [ability, true]));
  assert.deepEqual(permCapsFrom({ perms: { pickEmail: fn, locationArea: fn }, health: null, abilities: all as never }),
    ["ContactPick1", "Location1"]);
});

test("HealthSleep1 needs Health1 as well as the ability, and has no function of its own", () => {
  assert.deepEqual(permCapsFrom({ perms: null, health: null, abilities: { healthSleep: true } }), []);
  assert.deepEqual(permCapsFrom({ perms: null, health: {}, abilities: { healthSleep: true } }), ["Health1", "HealthSleep1"]);
  assert.deepEqual(permCapsFrom({ perms: null, health: {}, abilities: { healthSleep: false } }), ["Health1"]);
});

test("the names come in a fixed order, so a handshake does not churn", () => {
  const caps = permCapsFrom({
    perms: { pickEmail: fn, locationArea: fn, calendarEditor: fn, motionDays: fn, arrivalArm: fn },
    health: {},
    abilities: { calendarAdd: true, motion: true, arrival: true, healthSleep: true },
  });
  assert.deepEqual(caps, ["ContactPick1", "Location1", "Health1", "CalendarAdd1", "Motion1", "Arrival1", "HealthSleep1"]);
});

test("CallCheck1 is said only with Motion1 or Focus1 (perms2 9.3)", () => {
  assert.deepEqual(callCheckCaps([]), []);
  assert.deepEqual(callCheckCaps(["Health1", "Location1"]), []);
  assert.deepEqual(callCheckCaps(["Motion1"]), [CALL_CHECK_CAP]);
  assert.deepEqual(callCheckCaps(["Focus1"]), [CALL_CHECK_CAP]);
  assert.deepEqual(callCheckCaps(["Focus1", "Motion1"]), [CALL_CHECK_CAP]);
  assert.equal(CALL_CHECK_CAP, "CallCheck1");
});

test("the bridge's frozen names are untouched: binaryCore.ts never names the 8.9.1 capabilities", () => {
  const core = readFileSync("src/device/binaryCore.ts", "utf8");
  for (const [cap] of NINE) assert.ok(!core.includes(cap), cap);
  for (const n of ["HealthSleep1", "CallCheck1"]) assert.ok(!core.includes(n), n);
});
