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

// --- the launch the server sends ------------------------------------------------------------------------------------

const core = async () => import("./launchCore.ts");
const starter = async () => (await import("./launchStarter.ts")).LAUNCH_STARTER;

/**
 * A tiny launch of its own, so a test does not depend on what the file happens to say. Every field is at rest at
 * t 0 (the splash's own frame, which every launch must start on) and holds its one value from the next moment on.
 */
const small = () => ({
  v: 9, length: 1000, fade: 100, pinchAt: 500,
  macros: { twice: [["a"], "a*2"] as [string[], string] },
  let: [["hundred", "100"]] as Array<[string, string]>,
  bar: { dy: "t > 0 ? twice(hundred) : 0" },
  head: { dy: "t > 0 ? Z : 0", sway: "t" },
  gloves: { gx: "t > 0 ? (side ? cx : 0 - cx) : 0", lift: "t > 0 ? half : 0" },
  strip: { dx: "t > 0 ? i : 0", sx: "t > 0 ? n : 1", sy: "t > 0 ? x : 1", shown: "t > 0 ? d : 1" },
});

test("the copy this build carries is the launch the backend generated it from", async () => {
  const file = new URL("../../../../TAILZU-BACKEND/shared/launch/launch.json", import.meta.url);
  if (!fs.existsSync(file)) return;   // the two repos are not side by side
  assert.deepEqual(await starter(), JSON.parse(fs.readFileSync(file, "utf8")));
});

test("the copy this build carries plays exactly the motion this build was cut with: nothing jumps", async () => {
  const { launchMotion, BUILT_IN, STRIPS, LAUNCH_MS, FADE_MS, PINCH_AT } = await core();
  const L = launchMotion(await starter());
  assert.deepEqual(L.errors, []);
  assert.deepEqual([L.v, L.length, L.fade, L.pinchAt], [(await starter()).v, LAUNCH_MS, FADE_MS, PINCH_AT]);
  const near = (a: number, b: number, where: string) => assert.ok(Math.abs(a - b) < 1e-9, `${where}: ${a} vs ${b}`);
  for (let t = 0; t <= LAUNCH_MS; t += 5) {
    near(L.bar(t), BUILT_IN.bar(t), `bar at ${t}`);
    const h = L.head(t), h0 = BUILT_IN.head(t);
    for (const k of ["dy", "sway", "sq", "shut", "shown"] as const) near(h[k], h0[k], `head.${k} at ${t}`);
    for (const s of [0, 1] as const) {
      const g = L.glove(s, t), g0 = BUILT_IN.glove(s, t);
      for (const k of ["grip", "dy", "edge", "lift", "flip", "gx", "turn", "size", "shown"] as const) near(g[k], g0[k], `glove ${s} ${k} at ${t}`);
    }
    for (const i of [0, 11, 23, 24, 47]) {
      const st = L.strip(i, STRIPS, t), st0 = BUILT_IN.strip(i, STRIPS, t);
      for (const k of ["dx", "sx", "sy", "shown"] as const) near(st[k], st0[k], `strip ${i} ${k} at ${t}`);
    }
  }
});

test("a launch starts on the splash frame, and a part it leaves out stays at rest there", async () => {
  const { launchMotion, STRIPS } = await core();
  for (const spec of [await starter(), small(), { v: 2, length: 900, pinchAt: 400 }]) {
    const L = launchMotion(spec);
    assert.deepEqual(L.errors, []);
    assert.equal(L.bar(0), 0);
    assert.deepEqual(L.head(0), { dy: 0, sway: 0, sq: 1, shut: 0, shown: 1 });
    for (const s of [0, 1] as const) assert.deepEqual(L.glove(s, 0), { grip: 0, dy: 0, edge: 0, lift: 0, flip: 1, gx: 0, turn: 0, size: 1, shown: 1 });
    for (const i of [0, 24, 47]) assert.deepEqual(L.strip(i, STRIPS, 0), { dx: 0, sx: 1, sy: 1, shown: 1 });
  }
});

test("a launch the server sends plays: its formulas, its macros, its lets and the art's geometry", async () => {
  const { launchMotion, GLOVES, SPLASH_PT, BAR, U, STRIPS } = await core();
  const L = launchMotion(small());
  assert.deepEqual(L.errors, []);
  assert.deepEqual([L.v, L.length, L.fade, L.pinchAt], [9, 1000, 100, 500]);
  assert.equal(L.bar(7), 200, "a macro over a let");
  const { expandLaunchMacros } = await core();
  assert.equal(expandLaunchMacros("twice(3) + 1", { twice: [["a"], "a*2"] }), "((3)*2) + 1", "a macro is spelled out before anything is compiled");
  assert.equal(L.head(7).dy, SPLASH_PT, "Z is the art's size in points");
  assert.equal(L.head(7).sway, 7, "t is the ms since the motion began");
  assert.equal(L.head(7).sq, 1, "a field it does not set is at rest");
  assert.equal(L.glove(1, 7).gx, GLOVES[1].cx);
  assert.equal(L.glove(0, 7).gx, -GLOVES[0].cx, "side picks the glove");
  assert.equal(L.glove(1, 7).lift, GLOVES[1].half);
  const w = (BAR.x1 - BAR.x0) * U, st = L.strip(3, STRIPS, 7);
  assert.equal(st.dx, 3);
  assert.equal(st.sx, STRIPS);
  assert.ok(Math.abs(st.sy - (BAR.x0 * U + w * 3.5 / STRIPS)) < 1e-9, "x is the strip's middle across the art");
  assert.ok(Math.abs(L.strip(STRIPS - 1, STRIPS, 7).shown - Math.abs(L.strip(STRIPS - 1, STRIPS, 7).sy - SPLASH_PT / 2) / (w / 2)) < 1e-9, "d is how far out it is");
});

test("a launch this build cannot play is refused whole, says why, and leaves the build's own motion playing", async () => {
  const { launchMotion, BUILT_IN } = await core();
  const bad: Array<[string, unknown]> = [
    ["a launch: an object", "x"],
    ["a launch: an object", null],
    ["v: a whole number, 1 or more", { ...small(), v: 0 }],
    ["format: this build plays 1", { ...small(), format: 2 }],
    ["length: ms, up to 10000", { ...small(), length: 0 }],
    ["length: ms, up to 10000", { ...small(), length: 20000 }],
    ["pinchAt: ms, inside the launch", { ...small(), pinchAt: 1200 }],
    ["fade: ms, up to 2000", { ...small(), fade: 5000 }],
    ["tail: not something a launch has", { ...small(), tail: 1 }],
    ["head.tail: not something the head has (dy, sway, sq, shut, shown)", { ...small(), head: { tail: 1 } }],
    ["head.dy: unknown function wobble", { ...small(), head: { dy: "wobble(t)" } }],
    ["bar.dy: unknown name nobody", { ...small(), bar: { dy: "nobody + 1" } }],
    ["bar.dy: unknown name side", { ...small(), bar: { dy: "side" } }],
    ["strip.let: a new name and an expression", { ...small(), strip: { let: [["x", "1"]] } }],
    ["gloves: at most 32 names", { ...small(), bar: {}, let: Array.from({ length: 12 }, (_, i) => [`a${i}`, "1"]),
      gloves: { let: Array.from({ length: 12 }, (_, i) => [`b${i}`, "1"]) } }],
    ["bar.dy: unclosed twice(", { ...small(), bar: { dy: "twice(1" } }],
    // A launch's own lets are compiled again for each part, so one named like a part's own name has nowhere to go.
    // NOTE: the backend's checkLaunch() does not refuse this (it checks top-level lets against NAMES only), so an
    // admin PUT of such a launch is accepted there and plays nowhere. The backend is the side to tighten.
    ["launch.let: a new name and an expression (side is already a name here)", { ...small(), let: [["hundred", "100"], ["side", "1"]] }],
    ["launch.let: a new name and an expression (i is already a name here)", { ...small(), let: [["hundred", "100"], ["i", "1"]] }],
  ];
  for (const [why, spec] of bad) {
    const L = launchMotion(spec);
    assert.equal(L.v, 0, why);
    assert.ok(L.errors.some((e) => e.startsWith(why)), `${why}: got ${JSON.stringify(L.errors)}`);
    // Still a launch to play: the one this build was cut with.
    assert.equal(L.bar(600), BUILT_IN.bar(600));
    assert.equal(L.length, BUILT_IN.length);
  }
});

test("which launch plays: the server's word while it compiles and is not older than the build's copy", async () => {
  const { pickLaunch, BUILT_IN } = await core();
  const build = await starter();
  const sent = { ...small(), v: build.v + 1 };
  assert.equal(pickLaunch(sent, build).v, sent.v, "the server's");
  assert.equal(pickLaunch({ ...small(), v: build.v }, build).v, build.v, "the same version: either plays");
  assert.equal(pickLaunch({ ...small(), v: 0 }, build).v, build.v, "older, or no version at all: the build's copy");
  assert.equal(pickLaunch({ ...sent, head: { dy: "boom(" } }, build).v, build.v, "one it cannot compile: the build's copy");
  assert.equal(pickLaunch(undefined, build).v, build.v, "nothing kept yet");
  assert.equal(pickLaunch(null, "not a launch"), BUILT_IN, "neither: the motion this build was cut with");
  assert.equal(pickLaunch(sent, "not a launch").v, sent.v, "a build whose own copy is broken still plays the server's");
});

test("a launch never holds the app open past the cap, however long the server made it", async () => {
  const { launchMotion, playMs, BUILT_IN, LAUNCH_MS } = await core();
  assert.equal(playMs(BUILT_IN, 7000), LAUNCH_MS, "it fits: all of it plays");
  const long = launchMotion({ ...small(), length: 9000, pinchAt: 8000, fade: 200 });
  assert.deepEqual(long.errors, []);
  assert.equal(playMs(long, 7000), 6800, "as much as fits before the app opens");
  assert.equal(playMs(long, 100), 0, "a cap below the fade plays nothing, and the app opens");
});

test("keys drop what does not move and still draw the same line", async () => {
  const { launchMotion, keys, partKeys, STRIPS, LAUNCH_MS, PINCH_AT } = await core();
  const L = launchMotion(await starter());
  const line = (k: { inputRange: number[]; outputRange: number[] }, t: number): number => {
    const { inputRange: xs, outputRange: ys } = k;
    if (t <= xs[0]!) return ys[0]!;
    for (let i = 1; i < xs.length; i++) if (t <= xs[i]!) return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * (t - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
    return ys[ys.length - 1]!;
  };
  const trimmed = keys((t) => L.bar(t), 0, PINCH_AT);
  for (let t = 0; t <= PINCH_AT; t += 10) assert.ok(Math.abs(line(trimmed, t) - +L.bar(t).toFixed(3)) < 1e-9, `the bar at ${t}`);
  assert.equal(trimmed.inputRange[0], 0);
  assert.equal(trimmed.inputRange[trimmed.inputRange.length - 1], PINCH_AT);
  assert.ok(trimmed.inputRange.every((u, i) => i === 0 || u > trimmed.inputRange[i - 1]!));
  // A strip is still until the bar pinches: its keys are a handful, not one every 10 ms.
  const st = partKeys((t) => L.strip(0, STRIPS, t), 0, LAUNCH_MS);
  assert.ok(st.shown.inputRange.length < 8, `a strip's shown: ${st.shown.inputRange.length} keys`);
  assert.ok(st.dx.inputRange.length < 60);
  for (let t = 0; t <= LAUNCH_MS; t += 10) assert.ok(Math.abs(line(st.dx, t) - +L.strip(0, STRIPS, t).dx.toFixed(3)) < 1e-9, `strip 0 at ${t}`);
});

test("the feelers swing with the launch that is playing, not with the one this build was cut with", async () => {
  const { launchMotion, feelerTrack, feelersShown } = await core();
  const L = launchMotion(await starter());
  const mine = feelerTrack(L), built = feelerTrack();
  assert.equal(mine.length, built.length);
  for (let i = 0; i < mine.length; i++) for (const k of ["l1", "l2", "r1", "r2"] as const) assert.ok(Math.abs(mine[i]![k] - built[i]![k]) < 1e-6, `${k} at ${i * 10}`);
  // A launch whose head never moves: they hang still, and they are shown while he is.
  const still = launchMotion({ v: 3, length: 1200, pinchAt: 600 });
  for (const a of feelerTrack(still)) for (const k of ["l1", "l2", "r1", "r2"] as const) assert.ok(Math.abs(a[k]) < 0.05, `${k} ${a[k]}`);
  assert.equal(feelersShown(0, still), 1);
  assert.equal(feelersShown(880, still), 1, "his head never goes, so his feelers are still with him");
  assert.equal(feelersShown(1180, still), 0, "they fade as the launch ends");
});

test("the feelers' window is the launch's own: a slower pull-up carries them all the way up", async () => {
  const { launchMotion, feelerWindow, feelerTrack, feelersShown, BUILT_IN, FEELERS_MS, FEELERS_OUT } = await core();
  // The motion this build was cut with hides his head at 900: the window is what it always was.
  assert.deepEqual(feelerWindow(BUILT_IN), { end: FEELERS_MS, out: [FEELERS_OUT[0], FEELERS_OUT[1]] });
  assert.deepEqual(feelerWindow(launchMotion(await starter())), { end: FEELERS_MS, out: [FEELERS_OUT[0], FEELERS_OUT[1]] });
  // A launch that takes until 1700 to get him over the bar keeps its feelers until then, and fades them there.
  const slow = launchMotion({ v: 3, length: 2200, pinchAt: 1730, head: { shown: "t < 1700 ? 1 : 0" } });
  assert.deepEqual(slow.errors, []);
  assert.deepEqual(feelerWindow(slow), { end: 1700, out: [1590, 1680] });
  assert.equal(slow.head(1500).shown, 1);
  assert.equal(feelersShown(1500, slow), 1, "his head is still on its way up: his feelers are with it");
  assert.equal(feelersShown(1680, slow), 0, "gone by the time he is");
  assert.equal(feelerTrack(slow).length, 171, "and they are worked out all the way up, not to 900");
});

test("a launch that starts away from the splash frame is refused: the curtain's first frame is the splash's", async () => {
  const { launchMotion, BUILT_IN } = await core();
  const s = await starter();
  const off: Array<[string, unknown]> = [
    ["starts away from the splash frame: head.dy 8", { v: 2, length: 900, pinchAt: 400, head: { dy: "8" } }],
    ["starts away from the splash frame: bar.dy 3", { v: 2, length: 900, pinchAt: 400, bar: { dy: "3" } }],
    ["starts away from the splash frame: gloves.shown (left) 0", { v: 2, length: 900, pinchAt: 400, gloves: { shown: "0" } }],
    ["starts away from the splash frame: strip.sy (0) 0.5", { v: 2, length: 900, pinchAt: 400, strip: { sy: "0.5" } }],
    // The one the review found: today's launch with the head 8 points up at t 0, which jumps as the splash goes.
    ["starts away from the splash frame: head.dy 8", { ...s, v: s.v + 1, head: { ...s.head, dy: `8 + ${(s.head as Record<string, string>).dy}` } }],
  ];
  for (const [why, spec] of off) {
    const L = launchMotion(spec);
    assert.equal(L.v, 0, why);
    assert.ok(L.errors.some((e) => e.startsWith(why)), `${why}: got ${JSON.stringify(L.errors)}`);
    assert.equal(L.length, BUILT_IN.length, "the motion this build was cut with plays instead");
  }
  assert.equal(launchMotion({ v: 2, length: 900, pinchAt: 400, head: { dy: "8" } }).v, 0);
});

test("a launch whose feelers run away is refused: Animated throws on a turn it cannot read", async () => {
  const { launchMotion, feelerWindow, feeler, keys, asDeg, partKeys } = await core();
  const s = await starter();
  // exp(t) stays finite to about t 709, so nothing zeroes it: the feelers' physics is what overflows.
  const away = launchMotion({ ...s, v: s.v + 1, head: { ...s.head, dy: "t > 0 ? exp(t) : 0" } });
  assert.equal(away.v, 0, "refused: the copy this build carries plays");
  assert.ok(away.errors.some((e) => e.startsWith("his feelers run away")), JSON.stringify(away.errors));
  // Every turn the curtain keys says a number, so mapStringToNumericComponents has one to read.
  const NUM = /[+-]?(\d+\.?\d*|\.\d+)/;
  const L = launchMotion(s);
  const { end } = feelerWindow(L);
  for (const which of ["l1", "l2", "r1", "r2"] as const) {
    for (const d of asDeg(keys((t) => feeler(which, t, L), 0, end)).outputRange) assert.match(d, NUM);
  }
  for (const d of asDeg(partKeys((t) => L.head(t), 0, L.length).sway).outputRange) assert.match(d, NUM);
  // And under all of it: a sample that is no number at all is keyed as 0 rather than thrown at Animated.
  const nan = keys((t) => (t > 50 ? NaN : Infinity), 0, 100);
  assert.ok(nan.outputRange.every((v) => Number.isFinite(v)), JSON.stringify(nan.outputRange));
  for (const d of asDeg(nan).outputRange) assert.match(d, NUM);
  assert.ok(partKeys((t) => ({ a: t > 50 ? NaN : 1 }), 0, 100).a.outputRange.every((v) => Number.isFinite(v)));
});

test("the curtain draws behind a boundary of its own: a throw there costs the launch, not the app", () => {
  const curtain = read("./LaunchCurtain.tsx").toString();
  assert.match(curtain, /export default class LaunchCurtain extends Component/);
  assert.match(curtain, /getDerivedStateFromError/);
  assert.match(curtain, /componentDidCatch[\s\S]{0,400}liftLaunch\(\)/);
  assert.match(curtain, /catch \{ return \{ L: BUILT_IN, K: tracks\(BUILT_IN\) \}; \}/, "and a launch it cannot key drops to the build's own");
});

test("the window a launch is keyed over is never two keys at the same moment, however odd the launch", async () => {
  const { launchMotion, launchWindow, BUILT_IN, LAUNCH_MS, PINCH_AT } = await core();
  assert.deepEqual(launchWindow(BUILT_IN), { end: LAUNCH_MS, pinch: PINCH_AT });
  for (const spec of [{ v: 1, length: 10, pinchAt: 9 }, { v: 1, length: 30, pinchAt: 0.5 }, { v: 1, length: 10000, pinchAt: 9999 }]) {
    const L = launchMotion(spec);
    assert.deepEqual(L.errors, []);
    const { end, pinch } = launchWindow(L);
    assert.ok(pinch >= 2 && pinch < end, `${JSON.stringify(spec)} → ${pinch} in ${end}`);
  }
});
