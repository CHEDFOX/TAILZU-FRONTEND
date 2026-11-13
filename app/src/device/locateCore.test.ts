// node --test --experimental-strip-types src/device/locateCore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { areaLabel, locateArea, AREA_MAX, type LocStatus } from "./locateCore.ts";

test("the neighbourhood and the city, nothing else", () => {
  assert.equal(areaLabel({ subLocality: "HSR Layout", locality: "Bengaluru", adminArea: "Karnataka", countryCode: "IN" }), "HSR Layout, Bengaluru");
});

test("no neighbourhood: the city and the state", () => {
  assert.equal(areaLabel({ locality: "Pune", adminArea: "Maharashtra" }), "Pune, Maharashtra");
  assert.equal(areaLabel({ subAdminArea: "Mysuru", adminArea: "Karnataka" }), "Mysuru, Karnataka");
});

test("never a street number or a postcode, even if the native side sent one", () => {
  assert.equal(areaLabel({ subLocality: "12/3 MG Road", locality: "Bengaluru" }), "Bengaluru");
  assert.equal(areaLabel({ subLocality: "560102", locality: "Bengaluru" }), "Bengaluru");
  assert.equal(areaLabel({ locality: "Bengaluru 560102", adminArea: "Karnataka" }), "Karnataka");
  assert.equal(areaLabel({ subLocality: "Sector 21", locality: "Noida" }), "Sector 21, Noida");
});

test("duplicates collapse", () => {
  assert.equal(areaLabel({ subLocality: "Mumbai", locality: "mumbai" }), "Mumbai");
});

test("at most 120 characters, and null when empty", () => {
  const long = "A".repeat(200);
  const l = areaLabel({ subLocality: long, locality: "B" });
  assert.ok(l && l.length <= AREA_MAX);
  assert.equal(areaLabel({}), null);
  assert.equal(areaLabel(null), null);
  assert.equal(areaLabel({ subLocality: "  ", locality: "" }), null);
  assert.equal(areaLabel({ subLocality: "x\u0000y", locality: "Z" }), "x y, Z");
});

function deps(status: LocStatus, after: LocStatus, area: unknown) {
  const calls = { ask: 0, area: 0 };
  return {
    calls,
    d: {
      status: async () => status,
      ask: async () => { calls.ask++; return after; },
      area: async () => { calls.area++; if (area instanceof Error) throw area; return area as never; },
    },
  };
}

test("ask:false never prompts", async () => {
  for (const s of ["undetermined", "denied"] as const) {
    const { d, calls } = deps(s, "granted", { locality: "Pune" });
    assert.deepEqual(await locateArea({ ask: false }, d), { outcome: "denied" });
    assert.deepEqual(await locateArea({}, d), { outcome: "denied" });
    assert.equal(calls.ask, 0);
    assert.equal(calls.area, 0);
  }
});

test("granted: one fix, found, and only the words come back", async () => {
  const { d, calls } = deps("granted", "granted", { subLocality: "HSR Layout", locality: "Bengaluru" });
  assert.deepEqual(await locateArea({ ask: false }, d), { outcome: "found", label: "HSR Layout, Bengaluru" });
  assert.equal(calls.ask, 0);
  assert.equal(calls.area, 1);
});

test("ask:true asks once when undetermined, then reads", async () => {
  const { d, calls } = deps("undetermined", "granted", { locality: "Pune" });
  assert.deepEqual(await locateArea({ ask: true }, d), { outcome: "found", label: "Pune" });
  assert.equal(calls.ask, 1);
});

test("denied or blocked after the ask, and blocked before it", async () => {
  assert.deepEqual(await locateArea({ ask: true }, deps("undetermined", "denied", null).d), { outcome: "denied" });
  assert.deepEqual(await locateArea({ ask: true }, deps("undetermined", "blocked", null).d), { outcome: "blocked" });
  const b = deps("blocked", "granted", null);
  assert.deepEqual(await locateArea({ ask: true }, b.d), { outcome: "blocked" });
  assert.equal(b.calls.ask, 0);
});

test("nothing named is none; a throw is an error", async () => {
  assert.deepEqual(await locateArea({}, deps("granted", "granted", null).d), { outcome: "none" });
  assert.deepEqual(await locateArea({}, deps("granted", "granted", {}).d), { outcome: "none" });
  assert.deepEqual(await locateArea({}, deps("granted", "granted", new Error("timeout")).d), { outcome: "error" });
});
