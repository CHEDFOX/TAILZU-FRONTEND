// node --test --experimental-strip-types src/sdui/device/factsCore.test.ts
import test from "node:test";
import assert from "node:assert";
import { probeSchemes, CAN_OPEN_SCHEMES, FACT_PATHS, changedPaths, defaultFacts, locationPerm, mergeFacts, permFrom, readFact, sizeClassOf } from "./factsCore.ts";

test("permission mapping", () => {
  assert.equal(permFrom({ status: "granted", granted: true }), "granted");
  assert.equal(permFrom({ status: "undetermined" }), "unasked");
  assert.equal(permFrom({ status: "denied", canAskAgain: true }), "denied");
  assert.equal(permFrom({ status: "denied", canAskAgain: false }), "blocked");
  assert.equal(permFrom(null), "unasked");
  assert.equal(locationPerm("undetermined"), "unasked");
  assert.equal(locationPerm(undefined), "unsupported");
});
test("size class", () => {
  assert.deepEqual([sizeClassOf(390), sizeClassOf(700), sizeClassOf(1024)], ["compact", "regular", "large"]);
});
test("merge type-checks, clamps and ignores unknown fields", () => {
  const f = mergeFacts(defaultFacts(), { insets: { top: -5, bottom: 34 }, width: 800, fontScale: 99, scheme: "pink", perm: { mic: "granted", camera: "maybe" }, id: "abc", locale: 5 });
  assert.equal(f.insets.top, 0);
  assert.equal(f.insets.bottom, 34);
  assert.equal(f.sizeClass, "regular");
  assert.equal(f.fontScale, 5);
  assert.equal(f.scheme, "light");
  assert.equal(f.perm.mic, "granted");
  assert.equal(f.perm.camera, "unasked");
  assert.equal(f.locale, "en");
  assert.equal((f as any).id, undefined);
});
test("only the fixed list answers; nothing private is on it", () => {
  const f = defaultFacts();
  assert.equal(readFact(f, "perm.mic"), "unasked");
  assert.equal(readFact(f, "canOpen.upi"), false);
  assert.equal(readFact(f, "perm"), undefined);
  assert.equal(readFact(f, "constructor"), undefined);
  assert.equal(readFact(f, "__proto__.x"), undefined);
  assert.ok(!FACT_PATHS.some((p) => /^(id|token|lat|lon|latitude|longitude|address|idfa|adid)$|Id$/.test(p.split(".").pop()!)));
  assert.deepEqual(Object.keys(CAN_OPEN_SCHEMES), ["upi", "phonepe", "gpay", "paytm", "cred", "bhim"]);
});
test("changedPaths names what moved", () => {
  const a = defaultFacts();
  const b = mergeFacts(a, { keyboard: { visible: true, height: 300 }, online: false });
  assert.deepEqual(changedPaths(a, b), ["keyboard.visible", "keyboard.height", "online"]);
  assert.deepEqual(changedPaths(a, a), []);
});
test("android probes only upi; the rest read null, not false", () => {
  assert.deepEqual(probeSchemes("android"), ["upi"]);
  assert.equal(probeSchemes("ios").length, Object.keys(CAN_OPEN_SCHEMES).length);
  const f = mergeFacts(defaultFacts(), { canOpen: { upi: true, phonepe: null } });
  assert.equal(f.canOpen.upi, true);
  assert.equal(f.canOpen.phonepe, null);
});
