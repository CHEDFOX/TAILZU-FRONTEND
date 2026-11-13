// node --test --experimental-strip-types src/device/permCaps.test.ts
//
// Each capability name is said only when the native function behind it is there; a binary without the module says none.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HK_OBJECTS, healthConnectFrom, healthKitFrom, permCapsFrom } from "./permCapsCore.ts";

const fn = () => {};

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
