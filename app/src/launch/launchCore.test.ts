// node --test --experimental-strip-types src/launch/launchCore.test.ts
//
// The launch: the native splash and the curtain that takes over from it must be one picture, the motion must start
// on that picture, and it must end on the app's white.

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { BAR, BAR_TOP, COME_BACK, COME_BACK_MS, GLOVES, GROUND, LAUNCH_MS, LET_GO, LET_GO_MS, BAR_MID, CLOSE_MS, FROM, GONE_AT, OPEN, PINCH_AT, SLIP, SUCK_AT, gloveX, heldAt, SPLASH_PT, STRIPS, U, barDy, glove, head, isLifted, keys, liftLaunch, onLift, strip } from "./launchCore.ts";

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
    for (const s of [0, 1] as const) assert.deepEqual(glove(s, t), { grip: 0, dy: -0, edge: 0, lift: 0, flip: 1, gx: 0, turn: 0, size: 1, shown: 1 });
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

test("his gloves come back to the bar's middle, the left in from above to grip its top, the right in from below", () => {
  for (const s of [0, 1] as const) {
    assert.ok(COME_BACK[s] - 900 >= 500, "he is gone first (900), and half a second passes with nobody there");
    // Not drawn from the moment they are gone until they come back: the move to the middle happens out of sight.
    for (let t = LET_GO[s] + LET_GO_MS; t < COME_BACK[s]; t += 5) assert.equal(glove(s, t).shown, 0, `glove ${s} shows at ${t}`);
    const back = glove(s, COME_BACK[s] + COME_BACK_MS);
    assert.deepEqual([back.lift, back.shown, back.flip], [0, 1, s ? 1 : -1], `glove ${s} all the way back`);
    // At the middle, side by side, not over each other.
    assert.ok(Math.abs(GLOVES[s].cx + back.gx - heldAt(s)) < 1e-9);
    assert.ok(heldAt(1) - heldAt(0) >= GLOVES[0].half + GLOVES[1].half);
    // It squeezes as it lands, then settles to its grip.
    const landed = COME_BACK[s] + COME_BACK_MS;
    assert.ok(glove(s, landed + 40).grip > glove(s, landed - 60).grip && glove(s, landed + 200).grip < glove(s, landed + 40).grip);
  }
  // Halfway in: the left still above the bar, turned over, its clip edge out of its way; the right still below it.
  const left = glove(0, COME_BACK[0] + COME_BACK_MS / 2), right = glove(1, COME_BACK[1] + COME_BACK_MS / 2);
  assert.ok(left.lift < 0 && left.flip === -1 && left.edge === -OPEN && left.shown === 1);
  assert.ok(right.lift > 0 && right.edge === 0 && right.shown === 1);
  // The left, turned over about the bar's middle and lifted, is all inside its clip: nothing of it is cut off.
  const HANDS_BOTTOM = 222 * U, top = 2 * BAR_MID - HANDS_BOTTOM;
  assert.ok(top - FROM >= BAR_TOP - OPEN, "the left glove's clip is open far enough");
});

test("they twist against each other as the bar goes, and are still when it is gone", () => {
  const mid = (SUCK_AT + GONE_AT) / 2 - 85;
  assert.ok(Math.sign(glove(0, mid).turn) === -Math.sign(glove(1, mid).turn) && Math.abs(glove(0, mid).turn) > 3);
  assert.ok(Math.abs(glove(0, GONE_AT).turn) < 1e-9);
  assert.ok(Math.abs(barDy(PINCH_AT)) < 1e-9, "the bar has settled after they grab it, before it is pulled in");
});

test("the bar is pulled in to its middle, the middle first, into his gloves there, and the window is white before the end", () => {
  for (let i = 0; i < STRIPS; i++) assert.equal(strip(i, STRIPS, PINCH_AT - 1).sy, 1, "whole until the pinch");
  for (let i = 0; i < STRIPS; i++) assert.equal(strip(i, STRIPS, GONE_AT).shown, 0, `strip ${i}`);
  const goneAt = (i: number) => { for (let t = PINCH_AT; t <= LAUNCH_MS; t += 5) if (!strip(i, STRIPS, t).shown) return t; return Infinity; };
  assert.ok(goneAt(Math.floor(STRIPS / 2)) < goneAt(Math.floor(STRIPS / 4)) && goneAt(Math.floor(STRIPS / 4)) < goneAt(0));
  for (const s of [0, 1] as const) {
    // A glove holds the middle while the bar is pulled in to it, and closes on it at the end.
    for (let t = SUCK_AT; t < GONE_AT - CLOSE_MS; t += 10) assert.equal(gloveX(s, t), heldAt(s), `glove ${s} moves at ${t}`);
    assert.ok(Math.abs(gloveX(s, GONE_AT) - SPLASH_PT / 2) < 1e-9);
    assert.equal(glove(s, GONE_AT).shown, 0);
    assert.ok(COME_BACK[s] + COME_BACK_MS <= PINCH_AT, "back on the bar before it pinches");
  }
  assert.ok(Math.abs(barDy(PINCH_AT)) < 1e-9, "the bar has settled before it is pulled in");
  assert.ok(GONE_AT < LAUNCH_MS && LAUNCH_MS <= 2300);
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

test("Blip's feelers: they start at rest (the splash's pose), swing when he moves, stay in reach, and settle", async () => {
  const { feelerTrack, feeler } = await import("./launchCore.ts");
  const { FEELER_ART } = await import("./feelerArt.ts");
  const tr = feelerTrack();
  assert.equal(tr.length, 91);
  // the first frame is the splash: the feelers as drawn (no turn), and at rest under gravity there
  void FEELER_ART;
  for (const k of ["l1", "l2", "r1", "r2"] as const) assert.ok(Math.abs(tr[0][k]) < 0.05, `${k} ${tr[0][k]}`);
  // still while he is still (the first 400 ms: only a blink), then they swing as he gathers and pulls
  for (let t = 0; t <= 400; t += 10) assert.ok(Math.abs(feeler("l1", t) - tr[0].l1) < 1, `l1 at ${t}`);
  const swing = Math.max(...tr.slice(42, 68).map((a) => Math.abs(a.l1 - tr[0].l1)));
  assert.ok(swing > 3, `the left feeler swings as he pulls up (${swing.toFixed(1)} deg)`);
  // never wild while they show: every angle stays within a half turn of rest
  for (const a of tr.slice(0, 69)) for (const k of ["l1", "l2", "r1", "r2"] as const) assert.ok(Math.abs(a[k] - tr[0][k]) < 120, `${k} ${a[k]}`);
});

test("the feelers stand above the bar, so they go as he starts up: shown at rest, gone before his head is", async () => {
  const { feelersShown, FEELERS_OUT } = await import("./launchCore.ts");
  assert.equal(feelersShown(0), 1);
  assert.equal(feelersShown(FEELERS_OUT[0]), 1);
  assert.equal(feelersShown(FEELERS_OUT[1]), 0);
  assert.ok(FEELERS_OUT[1] < 900, "before the head goes");
});

test("the splash is the launch's layers stacked at rest, feelers and all: one picture, so the motion carries on from it", () => {
  for (const f of ["splash", "head", "bar", "hands", "blink", "feelerL1", "feelerL2", "feelerR1", "feelerR2"]) {
    const png = read(`../../assets/launch/${f}.png`);
    assert.equal(png.readUInt32BE(16), 544, `${f}.png is 544 wide`);
    assert.equal(png.readUInt32BE(20), 544, `${f}.png is 544 high`);
  }
  const curtain = read("./LaunchCurtain.tsx").toString();
  for (const f of ["feelerL1", "feelerL2", "feelerR1", "feelerR2"]) assert.match(curtain, new RegExp(`assets/launch/${f}\\.png`));
});
