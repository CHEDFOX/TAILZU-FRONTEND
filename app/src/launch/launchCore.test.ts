// node --test --experimental-strip-types src/launch/launchCore.test.ts
//
// The launch: the native splash and the curtain that takes over from it must be one picture, the motion must start
// on that picture, and it must end on the app's white.

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { BAR_TOP, GROUND, LAUNCH_MS, PINCH_AT, SPLASH_PT, STRIPS, U, barDy, glove, head, isLifted, keys, liftLaunch, onLift, strip } from "./launchCore.ts";

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
  assert.equal(U * 544, SPLASH_PT);
});

test("the motion starts on the splash: nothing has moved before he gathers", () => {
  for (const t of [0, 100, 300, 419]) {
    assert.equal(barDy(t), 0, `bar at ${t}`);
    const h = head(t);
    assert.deepEqual([h.dy, h.sway, h.sq, h.shown], [0, -0, 1, 1], `head at ${t}`);
    for (const s of [0, 1] as const) assert.deepEqual(glove(s, t), { grip: 0, dy: -0, shown: 1 });
    for (let i = 0; i < STRIPS; i++) {
      const st = strip(i, STRIPS, t);
      assert.ok(Math.abs(st.dx) < 1e-9 && st.sx === 1 && st.sy === 1 && st.shown === 1, `strip ${i} at ${t}`);
    }
  }
});

test("he goes over the bar: his head ends above its edge, his gloves let go, left then right", () => {
  const h = head(899);
  // The head's lowest pixel (405 px) is at or above the bar's top edge by the time it is hidden.
  assert.ok(405 * U + h.dy < BAR_TOP + 2, `head bottom ${405 * U + h.dy} vs ${BAR_TOP}`);
  assert.equal(head(900).shown, 0);
  assert.equal(glove(0, 930).shown, 0);
  assert.equal(glove(1, 930).shown, 1);
  assert.equal(glove(1, 1000).shown, 0);
});

test("the bar is pulled in to its middle and gone, and the window is white before the end", () => {
  for (let i = 0; i < STRIPS; i++) assert.equal(strip(i, STRIPS, 1600).shown, 0, `strip ${i}`);
  // The middle goes first.
  const mid = Math.floor(STRIPS / 2), end = 0;
  const goneAt = (i: number) => { for (let t = PINCH_AT; t <= LAUNCH_MS; t += 5) if (!strip(i, STRIPS, t).shown) return t; return Infinity; };
  assert.ok(goneAt(mid) < goneAt(end));
  assert.ok(Math.abs(barDy(1300)) < 1e-9, "the bar has settled before it goes");
  assert.ok(LAUNCH_MS >= 1600 && LAUNCH_MS <= 2000);
});

test("keys are increasing, start and end where asked, and clamp nothing away", () => {
  const k = keys(barDy, 0, 1300);
  assert.equal(k.inputRange[0], 0);
  assert.equal(k.inputRange[k.inputRange.length - 1], 1300);
  assert.ok(k.inputRange.every((u, i) => i === 0 || u > k.inputRange[i - 1]!));
  assert.equal(k.outputRange[0], 0);
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
