// node --test --experimental-strip-types src/sdui/bots/dotArtCore.test.ts
//
// Dot art that obeys physics: the node's props read safely; a field at rest is exactly its picture and asks for no frames; each way
// in (fall, grow, gather) starts away from home, lets the dots go in order and brings every one home, still, with no timed curve;
// a fall is caught at home and overshoots below it, as a weight on a spring does; a tap pushes the near dots away and the springs
// bring them back; heat trembles about home by about the amount asked; still means still; same seed, same frames; and drawing is a
// call per radius and tone.
import test from "node:test";
import assert from "node:assert";
import { DOT_PHYSICS, DotField, Kept, fieldFor, readDotArt, type DotCtx } from "./dotArtCore.ts";

/** A bar of 10 dots in a row, one row of 4 below it in another group, on a 200 x 60 canvas. */
const props = (over: Record<string, unknown> = {}) => {
  const d: number[] = [];
  for (let i = 0; i < 10; i++) d.push(10 + i * 12, 20, 3, 1, 0);
  for (let i = 0; i < 4; i++) d.push(10 + i * 12, 44, 2, 0.36, 1);
  return { w: 200, h: 60, d, key: "turn-1.b0", ...over };
};

const run = (f: DotField, seconds: number, fps = 60) => { for (let s = 0; s < seconds * fps; s++) f.frame(1 / fps); };
const offHome = (f: DotField): number => {
  let m = 0;
  for (let i = 0; i < f.spec.n; i++) m = Math.max(m, Math.hypot(f.px[i]! - f.spec.x[i]!, f.py[i]! - f.spec.y[i]!));
  return m;
};

test("reads the node's props safely", () => {
  const s = readDotArt(props({ enter: "fall", heat: 3, ink: "red", seed: 7 }))!;
  assert.equal(s.n, 14);
  assert.equal(s.enter, "fall");
  assert.equal(s.heat, 1);
  assert.equal(s.ink, "#0a0a0a");
  assert.equal(s.seed, 7);
  assert.equal(readDotArt({ w: 0, h: 10, d: [1, 1, 1, 1, 0] }), null);
  assert.equal(readDotArt({ w: 10, h: 10, d: [1, 1, -1, 1, 0, "x", 2, 2, 1, 0] }), null);
  assert.equal(readDotArt(null), null);
  assert.equal(readDotArt(props({ enter: "explode" }))!.enter, "none");
  // a bad dot is skipped, the rest kept
  assert.equal(readDotArt({ w: 10, h: 10, d: [1, 1, 1, 1, 0, NaN, 2, 2, 1, 0, 3, 3, 1, 1, 0] })!.n, 2);
});

test("at rest it is exactly its picture and asks for no frames", () => {
  const f = new DotField(readDotArt(props())!);
  assert.equal(f.awake, false);
  assert.equal(f.frame(1 / 60), false);
  assert.equal(offHome(f), 0);
});

for (const enter of ["fall", "grow", "gather"] as const) {
  test(`${enter}: starts away from home, lets the dots go in order, and brings every one home and still`, () => {
    const f = new DotField(readDotArt(props({ enter }))!);
    assert.equal(f.awake, true);
    assert.ok(offHome(f) > 10, "starts away from home");
    // the second group is let go after the first
    const first = Math.min(...Array.from(f.release.subarray(10)));
    const last0 = Math.max(...Array.from(f.release.subarray(0, 10)));
    if (enter !== "grow") assert.ok(first >= last0 * 0.5, "groups go in order");
    run(f, 4);
    assert.equal(f.awake, false, "asleep once home");
    assert.equal(offHome(f), 0);
    assert.equal(f.frame(1 / 60), false);
  });
}

test("a fall is caught at home and overshoots below it, as a weight on a spring does", () => {
  const f = new DotField(readDotArt(props({ enter: "fall" }))!);
  let lowest = -Infinity;
  for (let s = 0; s < 120; s++) { f.frame(1 / 60); lowest = Math.max(lowest, f.py[0]! - f.spec.y[0]!); }
  assert.ok(lowest > 1, `it went past home (${lowest.toFixed(2)} points below)`);
  assert.ok(lowest < 60, "but the spring held it");
});

test("a grow draws the row out from the left", () => {
  const f = new DotField(readDotArt(props({ enter: "grow" }))!);
  assert.ok(f.release[9]! > f.release[0]!, "the right end goes last");
  assert.equal(f.px[5], 0);
});

test("a tap pushes the near dots away and the springs bring them back", () => {
  const f = new DotField(readDotArt(props())!);
  assert.equal(f.poke(10, 20), true);
  assert.equal(f.awake, true);
  f.frame(1 / 30);
  assert.ok(f.px[1]! > 22 || Math.hypot(f.vx[1]!, f.vy[1]!) > 0, "a near dot moved");
  // a far dot barely felt it
  assert.ok(Math.abs(f.px[9]! - f.spec.x[9]!) < 0.5);
  run(f, 3);
  assert.equal(f.awake, false);
  assert.equal(offHome(f), 0);
  // a tap far from every dot wakes nothing (the push fades with distance, and below a point a second it is nothing)
  assert.equal(new DotField(readDotArt(props())!).poke(600, 300), false);
});

test("a hold pushes while it lasts and lets go", () => {
  const f = new DotField(readDotArt(props())!);
  f.press({ x: 70, y: 20 });
  run(f, 0.5);
  assert.ok(offHome(f) > 2, "pushed aside");
  assert.equal(f.awake, true);
  f.press(null);
  run(f, 3);
  assert.equal(offHome(f), 0);
});

test("heat trembles about home by about the amount asked, and never sleeps", () => {
  const f = new DotField(readDotArt(props({ heat: 1 }))!);
  run(f, 1);
  let sum = 0, n = 0;
  for (let s = 0; s < 600; s++) {
    f.frame(1 / 60);
    for (let i = 0; i < f.spec.n; i++) { sum += (f.px[i]! - f.spec.x[i]!) ** 2; n += 1; }
  }
  const rms = Math.sqrt(sum / n);
  assert.ok(rms > DOT_PHYSICS.tremble * 0.4 && rms < DOT_PHYSICS.tremble * 2, `rms ${rms.toFixed(2)} near ${DOT_PHYSICS.tremble}`);
  assert.equal(f.awake, true);
});

test("still means still: no entrance, no taps, no heat", () => {
  const f = new DotField(readDotArt(props({ enter: "fall", heat: 1 }))!, { motion: false });
  assert.equal(f.awake, false);
  assert.equal(offHome(f), 0);
  assert.equal(f.poke(10, 20), false);
  f.press({ x: 10, y: 20 });
  assert.equal(f.frame(1 / 60), false);
  assert.equal(offHome(f), 0);
});

test("same seed, same frames", () => {
  const a = new DotField(readDotArt(props({ enter: "gather", heat: 0.5 }))!);
  const b = new DotField(readDotArt(props({ enter: "gather", heat: 0.5 }))!);
  run(a, 1); run(b, 1);
  assert.deepEqual(Array.from(a.px), Array.from(b.px));
  const c = new DotField(readDotArt(props({ enter: "gather", heat: 0.5, key: "turn-2.b0" }))!);
  run(c, 1);
  assert.notDeepEqual(Array.from(a.px), Array.from(c.px));
});

test("a frame is a call per radius and tone, and dots not let go yet are not drawn", () => {
  const calls: Array<{ n: number; r: number; alpha: number }> = [];
  const ctx: DotCtx = {
    globalAlpha: 1, fillStyle: "", beginPath() {}, moveTo() {}, arc() {}, fill() {},
    dots(_xy, n, r) { calls.push({ n, r, alpha: this.globalAlpha }); },
  };
  new DotField(readDotArt(props())!).draw(ctx);
  // the faint dots first, so the ink lands on top
  assert.deepEqual(calls.map((c) => [c.n, c.r]), [[4, 2], [10, 3]]);
  assert.ok(calls[0]!.alpha < calls[1]!.alpha, "the grey row is drawn fainter");
  assert.equal(ctx.globalAlpha, 1, "alpha put back");
  calls.length = 0;
  new DotField(readDotArt(props({ enter: "grow" }))!).draw(ctx);
  assert.ok(calls.reduce((s, c) => s + c.n, 0) < 14, "only the dots let go");
  // a host without dots(): circles, each a figure of its own (moved to before it is drawn, so none is joined to the last)
  const seq: string[] = [];
  new DotField(readDotArt(props())!).draw({ globalAlpha: 1, fillStyle: "", beginPath() {}, moveTo() { seq.push("m"); }, arc() { seq.push("a"); }, fill() {} });
  assert.equal(seq.join(""), "ma".repeat(14));
});

test("a picture kept by its key is not brought in again by a refresh, and a new picture is", () => {
  const kept = new Kept();
  const spec = readDotArt(props({ enter: "fall" }))!;
  const a = fieldFor(kept, spec, { motion: true, entering: true });
  assert.equal(a.awake, true);
  run(a, 4);
  const again = fieldFor(kept, readDotArt(props({ enter: "fall" }))!, { motion: true, entering: true });
  assert.equal(again, a, "the same field, at rest");
  assert.equal(again.awake, false);
  const moved = readDotArt(props({ enter: "fall", d: [5, 5, 2, 1, 0] }))!;
  assert.notEqual(fieldFor(kept, moved, { motion: true, entering: true }), a);
  // an older answer comes in at home
  const old = fieldFor(new Kept(), spec, { motion: true, entering: false });
  assert.equal(offHome(old), 0);
});

test("the window's copy is generated from this file, and current (when the window's repo is beside this one)", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { DEFAULT_OUT, hashesOf, readSource, sha } = await import("./genDotArt.mjs");
  if (!existsSync(DEFAULT_OUT)) return;
  const h = hashesOf(readFileSync(DEFAULT_OUT, "utf8"));
  assert.equal(h.src, sha(readSource()), "dotArtCore.ts changed: run `node src/sdui/bots/genDotArt.mjs` and commit TAILZU-DESKTOP/dotArt.js");
  assert.equal(h.body, h.actualBody, "TAILZU-DESKTOP/dotArt.js was edited by hand");
});
