// node --test --experimental-strip-types src/launch/launchCore.test.ts
//
// The launch: the native splash and the curtain that takes over from it must be one picture, the motion must start
// on that picture, and it must end on the app's white.

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { BAR, BAR_TOP, COME_BACK, COME_BACK_MS, GLOVES, GROUND, LAUNCH_MS, LET_GO, LET_GO_MS, GONE_AT, PINCH_AT, SLIP, SUCK_AT, gloveX, pulled, SPLASH_PT, STRIPS, U, barDy, glove, head, isLifted, keys, liftLaunch, onLift, strip } from "./launchCore.ts";

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
    for (const s of [0, 1] as const) assert.deepEqual(glove(s, t), { grip: 0, dy: -0, edge: 0, gx: 0, size: 1, shown: 1 });
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
  assert.ok(LET_GO[0] < LET_GO[1]);
  // Both are gone before his head is, give or take a frame: no glove is left on an empty bar.
  assert.ok(LET_GO[1] + LET_GO_MS <= 900);
});

test("a glove letting go never grows back and never crosses the bar's face: it goes into the bar's lower edge", () => {
  const HANDS_BOTTOM = 222 * U, BAR_BOTTOM = BAR.y1 * U;
  for (const s of [0, 1] as const) {
    let grip = 0;
    for (let t = 560; t <= LET_GO[s] + LET_GO_MS; t += 5) {
      const g = glove(s, t);
      assert.ok(g.grip >= grip - 1e-9, `glove ${s} lets go of its squeeze at ${t}`);
      grip = g.grip;
      assert.ok(g.edge >= 0 && g.edge <= SLIP + 1e-9 && g.dy <= 0);
    }
    // Gone: all that is left below the clip edge is above the bar's lower edge, hidden by the bar.
    const end = glove(s, LET_GO[s] + LET_GO_MS);
    const grippedBottom = BAR_BOTTOM + (HANDS_BOTTOM - BAR_BOTTOM) * (1 - end.grip);
    assert.ok(grippedBottom + end.dy <= BAR_BOTTOM + 0.5, `glove ${s} still shows below the bar: ${grippedBottom + end.dy}`);
  }
});

test("his gloves come back at the bar's ends, over its top edge onto it, and only once he is gone", () => {
  const HANDS_TOP = 167 * U, HANDS_BOTTOM = 222 * U, BAR_BOTTOM = BAR.y1 * U;
  // Out of sight: above the edge it is clipped at, or gone up behind the bar.
  const hidden = (g: ReturnType<typeof glove>) => {
    const bottom = BAR_BOTTOM + (HANDS_BOTTOM - BAR_BOTTOM) * (1 - g.grip) + g.dy;
    return bottom <= BAR_TOP + g.edge + 0.5 || (g.edge >= SLIP - 1e-9 && bottom <= BAR_BOTTOM + 0.5);
  };
  for (const s of [0, 1] as const) {
    assert.ok(COME_BACK[s] >= 900, "he is gone first");
    // Hidden from the moment they are gone until they come back: moving to the end happens out of sight.
    for (let t = LET_GO[s] + LET_GO_MS; t <= COME_BACK[s]; t += 5) assert.ok(hidden(glove(s, t)), `glove ${s} shows at ${t}`);
    // Coming back, its fingers come over the bar's top edge first and it slides down onto the bar.
    const mid = glove(s, COME_BACK[s] + COME_BACK_MS / 2);
    assert.equal(mid.edge, 0);
    assert.ok(HANDS_TOP + mid.dy < BAR_TOP && !hidden(mid));
    const back = glove(s, COME_BACK[s] + COME_BACK_MS);
    assert.deepEqual([back.edge, back.dy], [0, -0], `glove ${s} all the way back`);
    // At the bar's end on its side: its outer edge on the bar's.
    const x = GLOVES[s].cx + back.gx, half = GLOVES[s].half;
    assert.ok(Math.abs(s ? x + half - BAR.x1 * U : x - half - BAR.x0 * U) < 1e-9, `glove ${s} at ${x}`);
    // Smooth coming back: no jump of more than a few points a frame (16 ms). (Pulled in, it goes as fast as its end.)
    let prev = gloveX(s, COME_BACK[s]);
    for (let t = COME_BACK[s]; t <= SUCK_AT; t += 16) {
      const x2 = gloveX(s, t);
      assert.ok(Math.abs(x2 - prev) < 6, `glove ${s} jumps at ${t}`);
      prev = x2;
    }
  }
});

test("the bar is pulled in to its middle, the middle first, his gloves going in with its ends, and the window is white before the end", () => {
  for (let i = 0; i < STRIPS; i++) assert.equal(strip(i, STRIPS, PINCH_AT - 1).sy, 1, "whole until the pinch");
  for (let i = 0; i < STRIPS; i++) assert.equal(strip(i, STRIPS, GONE_AT).shown, 0, `strip ${i}`);
  const goneAt = (i: number) => { for (let t = PINCH_AT; t <= LAUNCH_MS; t += 5) if (!strip(i, STRIPS, t).shown) return t; return Infinity; };
  assert.ok(goneAt(Math.floor(STRIPS / 2)) < goneAt(Math.floor(STRIPS / 4)) && goneAt(Math.floor(STRIPS / 4)) < goneAt(0));
  for (const s of [0, 1] as const) {
    // A glove is on its end of the bar the whole way in, and gone with it.
    for (let t = SUCK_AT; t < GONE_AT; t += 10) {
      const k = pulled(gloveX(s, SUCK_AT), t), x = gloveX(s, SUCK_AT);
      assert.ok(Math.abs(gloveX(s, t) - (x - (x - SPLASH_PT / 2) * k)) < 1e-9, `glove ${s} off its end at ${t}`);
    }
    assert.equal(glove(s, GONE_AT).shown, 0);
    assert.ok(COME_BACK[s] + COME_BACK_MS <= PINCH_AT, "back on the bar before it pinches");
  }
  assert.ok(Math.abs(barDy(1300)) < 1e-9, "the bar has settled before it is pulled in");
  assert.ok(GONE_AT < LAUNCH_MS && LAUNCH_MS <= 2000);
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
