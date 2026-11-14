// node --test --experimental-strip-types src/device/signalsCore.test.ts
//
// The required-reason rule for the keyboard reading (privacy manifest reasons 54BD.1, 3EC4.1 and CA92.1): what the
// iPhone sends the server comes from the keyboard's own App Group heartbeat, never from the system's keyboard list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keyboardEnabledOffDevice } from "./signalsCore.ts";

const app = process.cwd();

test("the iPhone sends the heartbeat, not the system's keyboard list", () => {
  // Added in Settings but never opened: the system list says yes, the heartbeat says nothing. The server is told no.
  assert.equal(keyboardEnabledOffDevice("ios", { enabled: true, fullAccess: false, lastActiveMs: 0 }), false);
  // It has really run: this phone's own value, which may leave the phone (reason 1C8F.1).
  assert.equal(keyboardEnabledOffDevice("ios", { enabled: true, fullAccess: true, lastActiveMs: 1 }), true);
  // A heartbeat without the list (turned on, run, then removed in Settings) is still this app's own reading.
  assert.equal(keyboardEnabledOffDevice("ios", { enabled: false, fullAccess: false, lastActiveMs: 1763000000000 }), true);
  // Nothing at all.
  assert.equal(keyboardEnabledOffDevice("ios", { enabled: false, fullAccess: false, lastActiveMs: 0 }), false);
});

test("Android keeps sending `enabled`, because it has no heartbeat", () => {
  assert.equal(keyboardEnabledOffDevice("android", { enabled: true, fullAccess: true, lastActiveMs: 0 }), true);
  assert.equal(keyboardEnabledOffDevice("android", { enabled: false, fullAccess: false, lastActiveMs: 0 }), false);
});

test("a bridge that did not answer reads as not enabled, the conservative direction", () => {
  assert.equal(keyboardEnabledOffDevice("ios", null), false);
  assert.equal(keyboardEnabledOffDevice("android", null), false);
});

test("the bootstrap's keyboardEnabled goes through this rule and nothing else", () => {
  const caps = readFileSync(join(app, "src/sdui/client/capabilities.ts"), "utf8");
  // The field name is unchanged, so the server's routing is unchanged.
  assert.match(caps, /keyboardEnabled: keyboardEnabledOffDevice\(Platform\.OS, getDeviceSignals\(\)\.keyboard\)/);
  // ...and the system-list reading is not sent from here under any name.
  assert.ok(
    !/keyboard\?\.enabled/.test(caps),
    "capabilities.ts must not send the device reading's `enabled`: on the iPhone it is partly the system's list",
  );
});

test("the screens keep the on-phone reading, which is what `enabled` is for", () => {
  const host = readFileSync(join(app, "src/sdui/shell/ScreenHost.tsx"), "utf8");
  const facts = readFileSync(join(app, "src/sdui/device/facts.ts"), "utf8");
  assert.match(host, /store\.set\("keyboardEnabled", d\.keyboard \? d\.keyboard\.enabled : true\)/);
  assert.match(facts, /enabled: s\.keyboard \? s\.keyboard\.enabled : true/);
});
