// node --test --experimental-strip-types src/sdui/pullBotCore.test.ts
//
// Pull-a-bot: the rubber band and the spring are the prototype's; a pull at either edge brings the bot out (feet first
// at the top, head first at the bottom), past the line he gets excited and the phone ticks once; let go past it and the
// list springs back, he rides it and is thrown at the moment it passes its rest (up and away from the top, down and away
// from the bottom), with dust at the edge, and a refresh starts; let go early and he goes back with the list; Reduce
// Motion never throws him. Then: what counts as new, what the pill says, which bot appears, and the knobs held safe.

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  advance, ANT, BOT_FLY, BOT_NONE, BOT_PULL, BOT_RIDE, busy, C_DAMP, C_RATE, C_RUB, C_SCALE, C_STILL, C_THRESH, C_THROW, configFrom,
  countNew, drag, EV_TICK, FACE_EFFORT, FACE_EYES, FACE_HAPPY, FACE_WHEE, FACE_WOW, faceOf, FEET, G_BOT, G_TOP, G_W, grab, listOffset,
  lookOf, newPullState, pillFor, PULL_DEFAULTS, PULL_LOOKS, PUFF_LEN, PUFFS, release, rubber, S_B, S_EV, S_PO, S_PUFF, S_PV, S_P,
  S_PH, S_VX, S_VY, S_X, S_Y, STEP, step, unrubber,
} from "./pullBotCore.ts";
import { drawScene, makeKit } from "./pullBotDraw.ts";

/** mulberry32, so the throw's random spin and the dust are the same every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = seeded(7);

/** A phone like the prototype's: the list's viewport from 104 to 646 in a 320-wide overlay. */
const GEO = [320, 104, 646];
const both = () => configFrom({}, { top: true, bottom: true });
/** Run `sec` seconds of frames at 60 fps. */
const run = (s: number[], c: number[], sec: number, each?: () => void) => {
  for (let t = 0; t < sec; t += 1 / 60) { advance(s, c, GEO, 1 / 60); each?.(); }
};
/** Pull from an edge by `px` of finger in 10 px moves (the list at rest at that edge). */
function pull(s: number[], c: number[], edge: "top" | "bottom", px: number, refreshing = false, maxScroll = 1200) {
  grab(s, c);
  const y = edge === "top" ? 0 : maxScroll;
  for (let moved = 0; moved < px; moved += 10) {
    drag(s, c, edge === "top" ? 10 : -10, y, maxScroll, refreshing);
    advance(s, c, GEO, 1 / 60);
  }
}

test("the rubber band: the prototype's curve, its inverse, never past its size", () => {
  const R = PULL_DEFAULTS.rubber;
  assert.equal(rubber(0, R), 0);
  assert.equal(rubber(-40, R), 0);
  // 300 * (1 - 1 / (d * 0.55 / 300 + 1)), the prototype's numbers.
  assert.ok(Math.abs(rubber(100, R) - 300 * (1 - 1 / (55 / 300 + 1))) < 1e-9);
  assert.ok(Math.abs(rubber(280, R) - 101.5) < 0.5);
  for (const d of [1, 30, 136, 400, 2000]) assert.ok(Math.abs(unrubber(rubber(d, R), R) - d) < 1e-6, `d ${d}`);
  assert.ok(rubber(1e7, R) < R);
  let last = 0;
  for (let d = 5; d < 1000; d += 5) { const o = rubber(d, R); assert.ok(o > last); last = o; }
  // The line (60) is about 136 px of finger.
  assert.ok(Math.abs(unrubber(60, R) - 136.4) < 0.1);
});

test("pulling down at the top: the bot stands on the list's top edge, revealed feet first", () => {
  const s = newPullState(), c = both();
  grab(s, c);
  assert.equal(drag(s, c, 10, 0, 1200, false), 1);
  assert.equal(s[S_B], BOT_PULL);
  assert.equal(listOffset(s), rubber(10, PULL_DEFAULTS.rubber));
  advance(s, c, GEO, 1 / 60);
  // His feet on the list's top edge, which is the viewport's top plus the gap.
  assert.ok(Math.abs(s[S_Y]! + FEET * PULL_DEFAULTS.scale - (GEO[G_TOP]! + s[S_PO]!)) < 1e-6);
  assert.equal(s[S_X], GEO[G_W]! / 2);
  assert.equal(faceOf(s), FACE_EYES);
});

test("pulling up at the bottom: he holds the list up from below, head first", () => {
  const s = newPullState(), c = both();
  pull(s, c, "bottom", 50);
  assert.equal(s[S_B], BOT_PULL);
  assert.ok(listOffset(s) < 0, "the list goes up");
  assert.ok(Math.abs(s[S_Y]! - ANT * PULL_DEFAULTS.scale - (GEO[G_BOT]! - s[S_PO]!)) < 1e-6);
});

test("past the line he gets excited and the phone ticks once; happy at the top, effort at the bottom", () => {
  const s = newPullState(), c = both();
  let ticks = 0;
  const count = () => { if (s[S_EV]! & EV_TICK) { ticks++; s[S_EV] = 0; } };
  grab(s, c);
  for (let i = 0; i < 40; i++) { drag(s, c, 10, 0, 1200, false); advance(s, c, GEO, 1 / 60); count(); }
  assert.ok(s[S_PO]! >= c[C_THRESH]!);
  assert.equal(ticks, 1);
  assert.equal(faceOf(s), FACE_HAPPY);
  // Back under the line and over it again: one more tick.
  for (let i = 0; i < 30; i++) { drag(s, c, -10, 0, 1200, false); advance(s, c, GEO, 1 / 60); count(); }
  assert.ok(s[S_PO]! < c[C_THRESH]!);
  assert.equal(faceOf(s), FACE_EYES);
  for (let i = 0; i < 30; i++) { drag(s, c, 10, 0, 1200, false); advance(s, c, GEO, 1 / 60); count(); }
  assert.equal(ticks, 2);

  const b = newPullState();
  pull(b, c, "bottom", 300);
  assert.equal(faceOf(b), FACE_EFFORT);
});

test("let go past the line: a refresh, the list springs back, he rides it and is thrown as it passes its rest", () => {
  const s = newPullState(), c = both();
  pull(s, c, "top", 300);
  const off = s[S_PO]!;
  assert.ok(off > 60);
  assert.equal(release(s, c, false), 1, "a refresh from the top");
  assert.equal(s[S_B], BOT_RIDE);
  assert.equal(faceOf(s), FACE_WOW);
  // Step finely and catch the moment he leaves.
  let prevOff = s[S_PO]!, launchedAt = -1, offAtLaunch = NaN, t = 0;
  while (t < 1 && launchedAt < 0) {
    step(s, c, GEO, STEP); t += STEP;
    if (s[S_B] === BOT_FLY) { launchedAt = t; offAtLaunch = s[S_PO]!; }
    else prevOff = s[S_PO]!;
  }
  assert.ok(launchedAt > 0.03 && launchedAt < 0.2, `thrown at ${launchedAt.toFixed(3)} s`);
  assert.ok(offAtLaunch <= 0 && prevOff > 0, "at the moment the list passes its rest");
  assert.equal(faceOf(s), FACE_WHEE);
  assert.ok(s[S_VY]! <= -PULL_DEFAULTS.throwSpeed, "up, fast");
  assert.ok(Math.abs(s[S_VX]!) >= 140 && Math.abs(s[S_VX]!) <= 310);
  // A puff of dust at the top edge (already one step old).
  let puffs = 0;
  for (let k = 0; k < PUFFS; k++) if (s[S_PUFF + k * PUFF_LEN + 5]! > 0) { puffs++; assert.ok(Math.abs(s[S_PUFF + k * PUFF_LEN + 1]! - GEO[G_TOP]!) < 1); }
  assert.equal(puffs, PUFFS);
  // He leaves off the top of the screen, the list settles, the dust clears; then there is nothing to draw.
  let minY = Infinity;
  run(s, c, 1.5, () => { if (s[S_B] === BOT_FLY) minY = Math.min(minY, s[S_Y]!); });
  assert.ok(minY < 0, "off the top");
  assert.equal(s[S_B], BOT_NONE);
  assert.equal(s[S_P], 0);
  assert.equal(listOffset(s), 0);
  assert.equal(busy(s), false);
});

test("the list's spring back: quick, one small bounce (rate 17, damping 0.58)", () => {
  const s = newPullState(), c = both();
  pull(s, c, "bottom", 100);
  const start = s[S_PO]!;
  assert.ok(start > 0 && start < 60);
  assert.equal(release(s, c, false), 0, "under the line: no refresh");
  let min = Infinity, t = 0, settledAt = -1;
  while (t < 1.5) { step(s, c, GEO, STEP); t += STEP; if (s[S_P] === 1) min = Math.min(min, s[S_PO]!); else if (settledAt < 0) settledAt = t; }
  // An underdamped spring at 0.58 overshoots by exp(-ζπ/√(1-ζ²)) ≈ 10.7%.
  const want = Math.exp((-0.58 * Math.PI) / Math.sqrt(1 - 0.58 * 0.58));
  assert.ok(Math.abs(-min / start - want) < 0.02, `overshoot ${(-min / start).toFixed(3)}`);
  assert.ok(settledAt > 0 && settledAt < 0.7, `settled at ${settledAt.toFixed(2)} s`);
});

test("let go early: he slides away with the list and nothing refreshes", () => {
  const s = newPullState(), c = both();
  pull(s, c, "top", 80);
  assert.ok(s[S_PO]! < 60);
  assert.equal(release(s, c, false), 0);
  let flew = false;
  run(s, c, 1, () => { if (s[S_B] === BOT_FLY || s[S_B] === BOT_RIDE) flew = true; });
  assert.equal(flew, false);
  assert.equal(s[S_B], BOT_NONE);
  assert.equal(busy(s), false);
});

test("from the bottom he drops away, down behind the bar under the list", () => {
  const s = newPullState(), c = both();
  pull(s, c, "bottom", 300);
  assert.equal(release(s, c, false), 2, "a refresh from the bottom");
  let thrown = false, lowest = -Infinity;
  run(s, c, 1.5, () => { if (s[S_B] === BOT_FLY) { thrown = true; lowest = Math.max(lowest, s[S_Y]!); } });
  assert.ok(thrown);
  assert.ok(lowest > GEO[G_BOT]!, "below the list's bottom edge, where the overlay ends");
  assert.equal(s[S_B], BOT_NONE);
});

test("Reduce Motion: no throw, he goes back with the list; the refresh still happens", () => {
  const s = newPullState(), c = configFrom({}, { top: true, bottom: true, still: true });
  assert.equal(c[C_STILL], 1);
  pull(s, c, "top", 300);
  assert.equal(release(s, c, false), 1);
  assert.equal(s[S_B], BOT_PULL);
  let flew = false;
  run(s, c, 1.2, () => { if (s[S_B] === BOT_FLY || s[S_B] === BOT_RIDE) flew = true; });
  assert.equal(flew, false);
  assert.equal(s[S_B], BOT_NONE);
  assert.equal(busy(s), false);
});

test("while a refresh is on, a pull still stretches but brings no bot and no second refresh", () => {
  const s = newPullState(), c = both();
  pull(s, c, "top", 300, true);
  assert.equal(s[S_P], 1);
  assert.equal(s[S_B], BOT_NONE);
  assert.equal(release(s, c, true), 0);
});

test("an edge the screen did not turn on does nothing; the bottom needs a list longer than its viewport", () => {
  const s = newPullState();
  const topOnly = configFrom({}, { top: true });
  assert.equal(drag(s, topOnly, -10, 1200, 1200, false), 0);
  assert.equal(s[S_P], 0);
  const bottomOnly = configFrom({}, { bottom: true });
  assert.equal(drag(s, bottomOnly, 10, 0, 1200, false), 0);
  assert.equal(drag(s, both(), -10, 0, 0, false), 0, "nothing to hold up: the whole list is on screen");
  assert.equal(drag(s, both(), 10, 300, 1200, false), 0, "mid-list: the scroll view's own");
});

test("the finger back past where it began ends the pull; the scroll view takes over", () => {
  const s = newPullState(), c = both();
  pull(s, c, "top", 40);
  assert.equal(s[S_P], 1);
  assert.equal(drag(s, c, -45, 0, 1200, false), 0);
  assert.equal(s[S_P], 0);
  assert.equal(s[S_B], BOT_NONE);
  assert.equal(listOffset(s), 0);
});

test("a list caught while it springs back follows the finger from there; mid-throw it is not caught", () => {
  const s = newPullState(), c = both();
  pull(s, c, "top", 100);
  release(s, c, false);
  run(s, c, 0.05);
  const off = s[S_PO]!;
  assert.ok(off > 0);
  grab(s, c);
  assert.equal(s[S_PH], 1);
  drag(s, c, 0.0001, 0, 1200, false);
  assert.ok(Math.abs(s[S_PO]! - off) < 0.01, "no jump");

  const f = newPullState();
  pull(f, c, "top", 300);
  release(f, c, false);
  grab(f, c);
  assert.equal(f[S_PH], 0, "riding: the throw finishes first");
  assert.equal(drag(f, c, 10, 0, 1200, false), 1, "and the list holds its edge till it rests");
});

test("taking over a bounce the scroll view had started (iOS) starts where it had got to", () => {
  const s = newPullState(), c = both();
  drag(s, c, 2, -24, 1200, false);
  assert.ok(Math.abs(s[S_PO]! - 24) < 1e-6);
  const b = newPullState();
  drag(b, c, -2, 1230, 1200, false);
  assert.ok(Math.abs(b[S_PO]! - 30) < 1e-6);
});

test("a long frame is clamped, not caught up; steps are fixed", () => {
  const s = newPullState(), c = both();
  pull(s, c, "top", 300);
  release(s, c, false);
  const before = s[S_PO]!;
  advance(s, c, GEO, 3);
  // At most 1/20 s simulated: the list has not settled.
  assert.ok(s[S_PO]! < before && s[S_P] === 1);
});

test("a spring the server made with no bounce still throws him", () => {
  const s = newPullState(), c = configFrom({ springDamping: 1.2 }, { top: true });
  assert.equal(c[C_DAMP], 1.2);
  pull(s, c, "top", 300);
  release(s, c, false);
  let thrown = false;
  run(s, c, 3, () => { if (s[S_B] === BOT_FLY) thrown = true; });
  assert.ok(thrown);
  assert.equal(busy(s), false);
});

test("the throw: at least the throw speed, or the list's speed times the boost", () => {
  const s = newPullState(), c = configFrom({ throwSpeed: 400, throwBoost: 4 }, { top: true });
  assert.equal(c[C_THROW], 400);
  pull(s, c, "top", 300);
  release(s, c, false);
  let v = 0, vy = 0;
  for (let i = 0; i < 2000 && s[S_B] !== BOT_FLY; i++) { v = s[S_PV]!; step(s, c, GEO, STEP); vy = s[S_VY]!; }
  assert.ok(Math.abs(vy) >= 400 && Math.abs(Math.abs(vy) - Math.max(400, Math.abs(v) * 4)) < Math.abs(v) * 4 * 0.1 + 1);
});

test("what is new: ids after the refresh that were not there before", () => {
  assert.equal(countNew(["a", "b"], ["c", "a", "b", "d"]), 2);
  assert.equal(countNew(["a", "b"], ["b"]), 0, "gone is not new");
  assert.equal(countNew(["a"], ["x", "x"]), 1, "an id once");
  assert.equal(countNew(undefined, ["a"]), 0, "nothing to compare: up to date");
  assert.equal(countNew(["a"], null), 0);
  assert.equal(countNew([1, 2], ["1", "3"]), 1);
});

test("the pill: checking, how many are new and where, up to date, couldn't check", () => {
  const w = { checking: "Checking", fresh: "{n} new", freshTop: "{n} new at the top", freshBottom: "{n} new at the bottom", upToDate: "You're up to date", failed: "Couldn't check. Try again." };
  assert.deepEqual(pillFor("checking", "top", "top", w), { text: "Checking", busy: true, fresh: false, goTo: null });
  assert.deepEqual(pillFor(2, "top", "top", w), { text: "2 new", busy: false, fresh: true, goTo: null });
  assert.deepEqual(pillFor(3, "bottom", "top", w), { text: "3 new at the top", busy: false, fresh: true, goTo: "top" });
  assert.deepEqual(pillFor(1, "top", "bottom", w), { text: "1 new at the bottom", busy: false, fresh: true, goTo: "bottom" });
  assert.deepEqual(pillFor(1, "bottom", "bottom", w), { text: "1 new", busy: false, fresh: true, goTo: null });
  assert.deepEqual(pillFor(0, "bottom", "top", w), { text: "You're up to date", busy: false, fresh: false, goTo: null });
  assert.equal(pillFor("failed", "top", "top", w).text, "Couldn't check. Try again.");
});

test("which bot appears: the prototype's by default; the server's id, its own looks, a screen's colours", () => {
  assert.deepEqual(lookOf(undefined, "x0", {}), PULL_LOOKS.x0);
  assert.equal(PULL_LOOKS.x0!.accent, "#C9683F");
  assert.deepEqual(lookOf(undefined, "nobody", {}), PULL_LOOKS.x0);
  assert.deepEqual(lookOf("ink", "x0", {}), PULL_LOOKS.ink);
  assert.deepEqual(lookOf(undefined, "ink", {}), PULL_LOOKS.ink);
  const mint = lookOf("mint", "x0", { mint: { accent: "#2F5D50", visor: "#102020", shellTop: "not a colour" } });
  assert.equal(mint.accent, "#2F5D50");
  assert.equal(mint.visor, "#102020");
  assert.equal(mint.shellTop, PULL_LOOKS.x0!.shellTop);
  assert.equal(lookOf({ accent: "rgba(47, 93, 80, 0.9)" }, "x0", {}).accent, "rgba(47, 93, 80, 0.9)");
  assert.deepEqual(lookOf({ accent: 42 }, "x0", {}), PULL_LOOKS.x0);
  assert.deepEqual(lookOf("x0", "ink", []), PULL_LOOKS.x0);
});

test("the knobs: the prototype's values by default, anything odd held to a range that works", () => {
  const c = configFrom({}, { top: true });
  assert.equal(c[C_THRESH], 60);
  assert.equal(c[C_RUB], 300);
  assert.equal(c[C_RATE], 17);
  assert.equal(c[C_DAMP], 0.58);
  assert.equal(c[C_THROW], 1750);
  assert.equal(c[C_SCALE], 0.5);
  const odd = configFrom({ threshold: 999, rubber: 100, springRate: Number.NaN, scale: 0, gravity: -5 });
  assert.equal(odd[C_RUB], 100);
  assert.equal(odd[C_THRESH], 80, "inside the band's reach");
  assert.equal(odd[C_RATE], 17);
  assert.equal(odd[C_SCALE], 0.2);
});

test("the drawing: nothing when idle; in the gap (clipped) while pulled; free, with speed lines, once thrown", () => {
  const calls: string[] = [];
  const paint = () => ({ setAntiAlias() {}, setStyle() {}, setColor() {}, setStrokeWidth() {}, setStrokeCap() {}, setStrokeJoin() {}, setMaskFilter() {}, setShader() {}, setAlphaf() {} });
  const sk = {
    Skia: {
      Paint: paint, Color: (c: string) => c, XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
      RRectXY: (rect: unknown, rx: number, ry: number) => ({ rect, rx, ry }), MaskFilter: { MakeBlur: () => ({}) },
      Shader: { MakeLinearGradient: () => ({}) }, PictureRecorder: () => ({}),
    },
    PaintStyle: { Fill: 0, Stroke: 1 }, StrokeCap: { Round: 1 }, StrokeJoin: { Round: 1 }, BlurStyle: { Normal: 0 }, TileMode: { Clamp: 0 },
    ClipOp: { Intersect: 1 }, vec: (x: number, y: number) => ({ x, y }),
  };
  const cv = new Proxy({}, { get: (_t, name) => (...a: unknown[]) => { calls.push(String(name)); void a; } });
  const kit = makeKit(sk as never, PULL_LOOKS.x0!, 0.5);
  const s = newPullState(), c = both();
  drawScene(cv as never, s, c, GEO, kit);
  assert.deepEqual(calls, [], "idle: nothing");
  pull(s, c, "top", 300);
  drawScene(cv as never, s, c, GEO, kit);
  assert.ok(calls.indexOf("clipRect") >= 0 && calls.indexOf("clipRect") < calls.indexOf("drawRRect"), "the bot inside the gap");
  assert.ok(calls.includes("drawArc"), "excited at the top: the happy eyes");
  release(s, c, false);
  for (let i = 0; i < 400 && s[S_B] !== BOT_FLY; i++) step(s, c, GEO, STEP);
  run(s, c, 0.05);
  calls.length = 0;
  drawScene(cv as never, s, c, GEO, kit);
  assert.ok(!calls.includes("clipRect"), "thrown: free of the gap");
  assert.equal(calls.slice(0, 3).join(), "drawLine,drawLine,drawLine", "speed lines first, behind him");
  assert.ok(calls.filter((x) => x === "drawCircle").length > 10, "his parts and the dust");
});

test("the app's knob fallbacks are the prototype's values (PullBot.tsx reads them)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "PullBot.tsx"), "utf8");
  const want: Record<string, number> = {
    "pullBot.threshold": PULL_DEFAULTS.threshold, "pullBot.rubber": PULL_DEFAULTS.rubber, "pullBot.springRate": PULL_DEFAULTS.springRate,
    "pullBot.springDamping": PULL_DEFAULTS.springDamping, "pullBot.throwSpeed": PULL_DEFAULTS.throwSpeed, "pullBot.throwBoost": PULL_DEFAULTS.throwBoost,
    "pullBot.gravity": PULL_DEFAULTS.gravity, "pullBot.scale": PULL_DEFAULTS.scale,
  };
  for (const [key, v] of Object.entries(want)) {
    const m = new RegExp(`num\\("${key.replace(".", "\\.")}", (-?[\\d.]+)\\)`).exec(src);
    assert.ok(m, `${key} is read`);
    assert.equal(Number(m![1]), v, key);
  }
});
