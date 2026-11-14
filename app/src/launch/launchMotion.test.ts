// node --test --experimental-strip-types src/launch/launchMotion.test.ts
//
// Which launch this phone plays: the server's when the kept bootstrap has one, else the copy this build carries.
// Nothing here may reach React Native: the launch is chosen before the app has anything else.

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { LAUNCH_FLAG, keptLaunch, launchNow, launchMotion, resetLaunchForTests } from "./launchMotion.ts";
import { LAUNCH_STARTER } from "./launchStarter.ts";
import { pickLaunch } from "./launchCore.ts";

test("the flag the launch rides in is the one the backend's bootstrap sends", () => {
  assert.equal(LAUNCH_FLAG, "app.launch");
  const server = new URL("../../../../TAILZU-BACKEND/tulmi/src/experience/phone/launch.ts", import.meta.url);
  if (!fs.existsSync(server)) return;   // the two repos are not side by side
  assert.match(fs.readFileSync(server, "utf8"), /"app\.launch":/);
});

test("the copy this build carries is written by the backend's generator, not by hand", () => {
  const src = fs.readFileSync(new URL("./launchStarter.ts", import.meta.url), "utf8");
  assert.match(src, /GENERATED from TAILZU-BACKEND shared\/launch\/launch\.json/);
  assert.match(src, /gen-launch-starter\.mjs/);
  assert.ok(LAUNCH_STARTER.v >= 1 && LAUNCH_STARTER.length > 0);
});

test("nothing kept yet, or no store in this binary: the copy this build carries plays, and it compiles", () => {
  assert.equal(keptLaunch(), undefined, "there is no React Native store in a plain test");
  resetLaunchForTests();
  const L = launchNow();
  assert.deepEqual(L.errors, []);
  assert.equal(L.v, LAUNCH_STARTER.v);
  assert.equal(L.length, LAUNCH_STARTER.length);
});

test("the launch is worked out once, because the motion starts before the app has a screen", () => {
  resetLaunchForTests();
  const first = launchNow();
  assert.equal(launchNow(), first);
  resetLaunchForTests();
  assert.notEqual(launchNow(), first, "asked again, it is read again");
});

test("the server's launch is played when the kept bootstrap carries a newer one", () => {
  const sent = { ...LAUNCH_STARTER, v: LAUNCH_STARTER.v + 3, length: 1800, pinchAt: 1400 };
  const L = pickLaunch(sent, LAUNCH_STARTER);
  assert.deepEqual([L.v, L.length], [sent.v, 1800]);
  assert.equal(launchMotion(sent).v, sent.v, "the same compiler the backend's own test calls");
});
