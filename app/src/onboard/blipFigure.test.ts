// node --test --experimental-strip-types src/onboard/blipFigure.test.ts
//
// The figure is drawn against a small canvas vocabulary. These cases run every
// pose through a context that records, and hold the dither to its buffer size,
// so a pose that draws a NaN (a limb that vanishes, a path Skia refuses) is
// caught here and not on someone's phone.

import test from "node:test";
import assert from "node:assert";
import {
  BAYER, GLOW, POSES, drawProp, figure, grey, hasProp, makeDither, spring, type Ctx2D, type FigureState, type Raster,
} from "./blipFigure.ts";
import { Blip, boxOf, cellFor } from "./blipMotion.ts";

const POSE_NAMES = ["present", "tap", "pointd", "tada", "thumbs", "wave", "listen", "carry", "wait", "key", "nod", "think", "walk"];

interface Rec { calls: string[]; numbers: number[]; depth: number; minDepth: number; fills: number; strokes: number }

function recorder(): { g: Ctx2D; rec: Rec } {
  const rec: Rec = { calls: [], numbers: [], depth: 0, minDepth: 0, fills: 0, strokes: 0 };
  const note = (name: string, args: unknown[]) => {
    rec.calls.push(name);
    for (const a of args) if (typeof a === "number") rec.numbers.push(a);
  };
  const g = {
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    save() { note("save", []); rec.depth++; },
    restore() { note("restore", []); rec.depth--; rec.minDepth = Math.min(rec.minDepth, rec.depth); },
    translate(...a: number[]) { note("translate", a); },
    rotate(...a: number[]) { note("rotate", a); },
    scale(...a: number[]) { note("scale", a); },
    beginPath() { note("beginPath", []); },
    closePath() { note("closePath", []); },
    moveTo(...a: number[]) { note("moveTo", a); },
    lineTo(...a: number[]) { note("lineTo", a); },
    quadraticCurveTo(...a: number[]) { note("quad", a); },
    fill() { note("fill", []); rec.fills++; },
    stroke() { note("stroke", []); rec.strokes++; },
    fillRect(...a: number[]) { note("fillRect", a); },
    clip() { note("clip", []); },
    createRadialGradient(...a: number[]) { note("gradient", a); return { addColorStop(o: number) { rec.numbers.push(o); } }; },
  } as unknown as Ctx2D;
  return { g, rec };
}

const stateFor = (pose: string, H: number): { st: FigureState; t: number } => {
  const b = new Blip(2, 0);
  b.H = H; b.pose = pose;
  const f = b.frame(0.016, true);
  return { st: f.st, t: f.t };
};

test("every pose draws only finite numbers, and leaves the context as it found it", () => {
  for (const pose of POSE_NAMES) {
    for (const H of [84, 110, 196]) {
      const { g, rec } = recorder();
      const { st, t } = stateFor(pose, H);
      const out = figure(g, H * 0.84, H, st, t);
      assert.ok(rec.numbers.every(Number.isFinite), `${pose} at ${H}: a coordinate is not finite`);
      assert.ok(out.hand.every(Number.isFinite) && out.ball.every(Number.isFinite), `${pose}: hand and ball`);
      assert.equal(rec.depth, 0, `${pose}: save and restore balance`);
      assert.equal(rec.minDepth, 0, `${pose}: never restored more than saved`);
      assert.ok(rec.fills > 10 && rec.strokes > 8, `${pose}: he is actually drawn (${rec.fills} fills, ${rec.strokes} strokes)`);
    }
  }
});

test("the same pose and the same moment draw the same figure", () => {
  const a = recorder(), b = recorder();
  const { st, t } = stateFor("wave", 196);
  figure(a.g, 196 * 0.84, 196, st, t);
  figure(b.g, 196 * 0.84, 196, st, t);
  assert.deepEqual(a.rec.numbers, b.rec.numbers);
});

test("every path starts with a move, because the context has no 'current point' to fall back on", () => {
  const { g, rec } = recorder();
  const { st, t } = stateFor("tada", 110);
  figure(g, 110 * 0.84, 110, st, t);
  let started = true;
  for (const c of rec.calls) {
    if (c === "beginPath") started = false;
    else if (c === "moveTo") started = true;
    else if ((c === "lineTo" || c === "quad") && !started) assert.fail("a path drew before it moved");
  }
});

test("poses: the key and the box share a target with their holder, a nod is a thumbs-up, and only some glow", () => {
  assert.equal(POSES.key, POSES.carry);
  assert.equal(POSES.nod, POSES.thumbs);
  assert.equal(GLOW.listen, 1);
  assert.equal(GLOW.tada, 0.9);
  assert.equal(GLOW.wait, 1);
  assert.equal(GLOW.present, undefined);
  for (const p of POSE_NAMES) assert.ok(POSES[p], `${p} is defined`);
  assert.equal(hasProp("carry"), true);
  assert.equal(hasProp("key"), true);
  assert.equal(hasProp("tada"), false);
});

test("the props draw something and balance, and only for the poses that carry them", () => {
  for (const pose of ["carry", "key"]) {
    const { g, rec } = recorder();
    drawProp(g, pose, 100, [60, 40], 0.5, true);
    assert.ok(rec.fills >= 2 && rec.strokes >= 1, pose);
    assert.ok(rec.numbers.every(Number.isFinite));
    assert.equal(rec.depth, 0);
  }
  const { g, rec } = recorder();
  drawProp(g, "tada", 100, [60, 40], 0.5, true);
  assert.equal(rec.calls.length, 0);
});

test("a grey is a six-digit hex, clamped", () => {
  assert.equal(grey(0), "#000000");
  assert.equal(grey(1), "#ffffff");
  assert.equal(grey(0.5), "#808080");
  assert.equal(grey(-3), "#000000");
  assert.equal(grey(9), "#ffffff");
});

test("the spring reaches its target and never runs away on a slow frame", () => {
  const S: Record<string, number> = { a: 0 }, V: Record<string, number> = {};
  for (let i = 0; i < 300; i++) spring(S, V, { a: 1 }, 0.016);
  assert.ok(Math.abs(S.a - 1) < 0.001);
  const S2: Record<string, number> = { a: 0 }, V2: Record<string, number> = {};
  spring(S2, V2, { a: 1 }, 5);
  assert.ok(S2.a <= 0.05 * 150 * 0.05 + 1e-9 && S2.a > 0, "a five-second frame is capped at 50 ms");
});

// --- the dither ---------------------------------------------------------------

/** A raster that records its size and hands back a brightness ramp. */
function fakeRaster(alphaOf: (x: number, y: number) => number, lumOf: (x: number, y: number) => number) {
  const sizes: [number, number][] = [];
  let bw = 0, bh = 0;
  const { g } = recorder();
  const r: Raster = {
    begin(w, h) { bw = w; bh = h; sizes.push([w, h]); return g; },
    pixels() {
      const px = new Uint8Array(bw * bh * 4);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = (y * bw + x) * 4, v = Math.round(lumOf(x, y) * 255);
        px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = alphaOf(x, y);
      }
      return px;
    },
  };
  return { r, sizes };
}

test("for a figure 196 tall the grey raster is 136 by 113 cells, which is what the prototype makes", () => {
  const { r, sizes } = fakeRaster(() => 255, () => 0.5);
  const b = new Blip(2, 0);
  b.H = 196; b.cell = cellFor(196, 2);
  const { st, t } = stateFor("present", 196);
  const dither = makeDither();
  const box = boxOf(196);
  dither(r, { H: 196, cell: b.cell, x: box.w / 2, y: box.h - 2, padX: 196 * 0.27, st, t, glow: 0 });
  assert.deepEqual(sizes[0], [136, 113]);
  // and for 110 at two device pixels a point, a cell of one point
  const s110 = fakeRaster(() => 255, () => 0.5);
  const { st: st2, t: t2 } = stateFor("present", 110);
  dither(s110.r, { H: 110, cell: cellFor(110, 2), x: 77, y: 130, padX: 110 * 0.27, st: st2, t: t2, glow: 0 });
  assert.deepEqual(s110.sizes[0], [Math.ceil((110 * 0.84 + 110 * 0.54) / 1), Math.ceil((110 + 0.14 * 110) / 1) + 1]);
});

test("the sticker is every lit cell and its neighbours; the pale dots are the lit cells the Bayer pattern lets through", () => {
  // One lit cell, fully bright, in the middle of an otherwise empty raster.
  const lit = { x: 20, y: 20 };
  const { r } = fakeRaster((x, y) => (x === lit.x && y === lit.y ? 255 : 0), () => 1);
  const { st, t } = stateFor("present", 110);
  const dither = makeDither();
  const out = dither(r, { H: 110, cell: 1, x: 80, y: 130, padX: 30, st, t, glow: 0 })!;
  assert.equal(out.sticker.length / 2, 9, "the cell and its eight neighbours");
  assert.equal(out.dots.length / 2, 1, "full brightness beats every threshold");
  assert.equal(out.stickerR, 0.64);
  assert.equal(out.dotR, 0.46);
  // Both are on the cell grid, half a cell in.
  const ox = 80 - 110 * 0.84 / 2 - 30, oy = 130 - 110 - 0.14 * 110;
  assert.ok(Math.abs(out.dots[0] - (ox + lit.x + 0.5)) < 1e-9);
  assert.ok(Math.abs(out.dots[1] - (oy + lit.y + 0.5)) < 1e-9);
});

test("a dim cell is lit only where the Bayer threshold is low enough", () => {
  const { r } = fakeRaster(() => 255, (x, y) => 0.5);
  const { st, t } = stateFor("present", 110);
  const out = makeDither()(r, { H: 110, cell: 1, x: 80, y: 130, padX: 30, st, t, glow: 0 })!;
  const cells = out.sticker.length / 2;
  const share = out.dots.length / 2 / cells;
  assert.ok(share > 0.45 && share < 0.55, `about half of a mid grey is lit (${share})`);
  assert.equal(BAYER.length, 64);
  assert.equal(new Set(BAYER).size, 64, "the threshold matrix has every level once");
});

test("transparent cells are neither dots nor sticker, and an unreadable raster draws nothing", () => {
  const { r } = fakeRaster(() => 0, () => 1);
  const { st, t } = stateFor("present", 110);
  const out = makeDither()(r, { H: 110, cell: 2, x: 80, y: 130, padX: 30, st, t, glow: 0 })!;
  assert.equal(out.sticker.length, 0);
  assert.equal(out.dots.length, 0);
  const dead: Raster = { begin: () => recorder().g, pixels: () => null };
  assert.equal(makeDither()(dead, { H: 110, cell: 2, x: 80, y: 130, st, t, glow: 0 }), null);
});

test("the antenna glows only when asked, and his shadow shrinks as he leaves the ground", () => {
  const { r } = fakeRaster(() => 255, () => 0.5);
  const { st, t } = stateFor("listen", 110);
  const dither = makeDither();
  const base = { H: 110, cell: 2, x: 80, y: 130, padX: 30, st, t };
  assert.equal(dither(r, { ...base, glow: 0 })!.glow, null);
  const g = dither(r, { ...base, glow: 1 })!.glow!;
  assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y) && g.r > 0 && g.a === 1);
  const ground = dither(r, { ...base, glow: 0, lift: 0 })!.shadow;
  const air = dither(r, { ...base, glow: 0, lift: 20 })!.shadow;
  assert.ok(air.rx < ground.rx && air.a < ground.a);
});

test("facing left mirrors him about his middle, and turning never flattens him to nothing", () => {
  const { r } = fakeRaster(() => 255, () => 1);
  const { st, t } = stateFor("wave", 110);
  const dither = makeDither();
  const right = dither(r, { H: 110, cell: 2, x: 100, y: 130, padX: 30, st, t, glow: 0, sx: 1 })!;
  const left = dither(r, { H: 110, cell: 2, x: 100, y: 130, padX: 30, st, t, glow: 0, sx: -1 })!;
  assert.ok(left.hand[0] < 100 && right.hand[0] > 100, "the waving hand switches sides");
  const edge = dither(r, { H: 110, cell: 2, x: 100, y: 130, padX: 30, st, t, glow: 0, sx: 0 })!;
  assert.ok(Number.isFinite(edge.hand[0]));
});
