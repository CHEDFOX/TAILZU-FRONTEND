// node --test --experimental-strip-types src/launch/launchCore.test.ts
//
// The launch: the native splash and the curtain that takes over from it must be one picture, and the swing must
// start and end on that picture.

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { BLINK, GROUND, LAUNCH_MS, PIVOT, SPLASH_PT, isLifted, liftLaunch, onLift, swingDeg, swingKeys } from "./launchCore.ts";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url));

test("the native splash is the curtain's first frame: same art, size and ground, light and dark", () => {
  const config = read("../../app.config.ts").toString();
  const block = config.slice(config.indexOf('"expo-splash-screen",'), config.indexOf("],", config.indexOf('"expo-splash-screen",')));
  assert.match(block, new RegExp(`imageWidth: ${SPLASH_PT},`));
  assert.equal(block.match(/backgroundColor: "([^"]+)"/g)?.length, 2);
  for (const bg of block.match(/backgroundColor: "([^"]+)"/g)!) assert.equal(bg, `backgroundColor: "${GROUND}"`);
  for (const img of block.match(/image: "([^"]+)"/g)!) assert.equal(img, 'image: "./assets/launch/splash.png"');
});

test("the art is one square frame, 4x the splash's points, for every layer", () => {
  for (const name of ["splash", "head", "bar", "hands", "blink"]) {
    const png = read(`../../assets/launch/${name}.png`);
    assert.equal(png.readUInt32BE(16), SPLASH_PT * 4, name);
    assert.equal(png.readUInt32BE(20), SPLASH_PT * 4, name);
    assert.equal(png[25], 6, `${name} is RGBA`);
  }
  assert.ok(PIVOT[0] > 0.4 && PIVOT[0] < 0.6 && PIVOT[1] > 0.1 && PIVOT[1] < 0.5, "the pivot is on the bar, between the hands");
});

test("the swing starts and ends on the splash, swings once, and settles before the blink", () => {
  assert.equal(swingDeg(0), 0);
  assert.equal(swingDeg(0.1), 0);
  assert.equal(swingDeg(1), 0);
  const us = Array.from({ length: 1001 }, (_, i) => i / 1000);
  const peak = Math.max(...us.map((u) => Math.abs(swingDeg(u))));
  assert.ok(peak > 4 && peak < 9, `peak ${peak}`);
  for (const u of us.filter((u) => u >= BLINK[0])) assert.ok(Math.abs(swingDeg(u)) < 0.5, `still at ${u}`);
  assert.ok(LAUNCH_MS >= 800 && LAUNCH_MS <= 1200);
  const keys = swingKeys();
  assert.equal(keys.outputRange[0], "0deg");
  assert.equal(keys.outputRange[keys.outputRange.length - 1], "0deg");
  assert.ok(keys.inputRange.every((u, i) => i === 0 || u > keys.inputRange[i - 1]!));
});

test("the lift is once, and reaches whoever is waiting, before or after", () => {
  let early = 0, late = 0;
  const off = onLift(() => { early++; });
  let never = 0;
  onLift(() => { never++; })();          // unsubscribed
  assert.equal(isLifted(), false);
  liftLaunch();
  liftLaunch();
  onLift(() => { late++; });
  off();
  assert.deepEqual([early, late, never, isLifted()], [1, 1, 0, true]);
});
