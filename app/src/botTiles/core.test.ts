// node --test
//
// The living tiles' core (core.ts): the same seed gives the same frames; long runs stay finite, inside their tile
// and calm; a look target turns the head; Reduce Motion is still; a frame draws in a bounded number of calls; and the
// window's generated copy (TAILZU-DESKTOP/botTiles.js) is this file, unchanged.
import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { BotTile, BotTilesWorld, Fabric, STEP, rng, type BotKind, type BotMood, type TileCtx } from "./core.ts";
// @ts-expect-error a plain .mjs script, no types
import { DEFAULT_OUT, SOURCE, hashesOf, sha } from "./genDesktop.mjs";

const KINDS: BotKind[] = ["code", "keybot", "plan", "travel", "make", "custom"];
const MOODS: BotMood[] = ["idle", "working", "needs"];

function tile(kind: BotKind, mood: BotMood = "idle", seed = 5, w = 169, h = 132, floor = 72): BotTile {
  const t = new BotTile({ kind, color: "#4F7A3A", mood, seed });
  t.resize(w, h, floor);
  return t;
}

/** A context that draws nothing and counts what it was asked. */
function counter(): TileCtx & { calls: number } {
  const c = {
    calls: 0, globalAlpha: 1, fillStyle: "#000" as unknown, strokeStyle: "#000" as unknown, lineWidth: 1,
    lineCap: "butt" as const, lineJoin: "miter" as const,
  } as TileCtx & { calls: number };
  for (const m of ["save", "restore", "translate", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "fill", "stroke"]) {
    (c as unknown as Record<string, () => void>)[m] = () => { c.calls++; };
  }
  return c;
}

test("the same seed and the same frames give the same tile, exactly", () => {
  for (const kind of KINDS) {
    const a = tile(kind, "working", 42), b = tile(kind, "working", 42);
    const r = rng(9);
    for (let f = 0; f < 900; f++) { const dt = 1 / 60 + (r() - 0.5) / 200; a.step(dt); b.step(dt); }
    assert.deepStrictEqual(Array.from(a.x), Array.from(b.x), kind);
    assert.deepStrictEqual(Array.from(a.y), Array.from(b.y), kind);
    assert.deepStrictEqual(Array.from(a.fabric.ux), Array.from(b.fabric.ux), kind);
    const c = tile(kind, "working", 43);
    for (let f = 0; f < 900; f++) c.step(1 / 60);
    assert.notDeepStrictEqual(Array.from(a.x), Array.from(c.x), `${kind}: another seed, another life`);
  }
});

test("three minutes of every bot in every mood: finite, inside the tile, energy bounded", () => {
  for (const kind of KINDS) {
    for (const mood of MOODS) {
      const t = tile(kind, mood, 3);
      const r = rng(17);
      let first = 0, second = 0, worstShift = 0;
      const frames = 60 * 180;
      for (let f = 0; f < frames; f++) {
        // Ragged frames: the odd long one (a hitch, a backgrounded tab) must not blow it up.
        const dt = r() < 0.01 ? 0.4 : 1 / 60 + (r() - 0.5) / 120;
        t.step(dt);
        if (f % 30 === 0) {
          assert.ok(t.finite(), `${kind}/${mood}: NaN at frame ${f}`);
          assert.ok(t.inside(), `${kind}/${mood}: left its tile at frame ${f}`);
          const e = t.energy();
          if (f < frames / 2) first = Math.max(first, e); else second = Math.max(second, e);
          worstShift = Math.max(worstShift, t.fabric.maxShift());
        }
      }
      // Nothing builds up: the second half is no livelier than the first allows.
      assert.ok(second < first * 3 + 1e5, `${kind}/${mood}: energy grew ${first.toFixed(0)} -> ${second.toFixed(0)}`);
      assert.ok(second < 5e6, `${kind}/${mood}: energy ${second.toFixed(0)}`);
      assert.ok(worstShift <= t.fabric.lim + 1e-9, `${kind}/${mood}: the fabric tore (${worstShift})`);
    }
  }
});

test("the fabric settles back flat when nothing moves it", () => {
  const f = new Fabric(1);
  f.layout(169, 132);
  f.kick(80, 60, 90, 60);
  for (let i = 0; i < 120 * 4; i++) f.step(STEP);
  assert.ok(f.maxShift() < 0.05, `still rippling: ${f.maxShift()}`);
  assert.ok(f.energy() < 1, `energy left: ${f.energy()}`);
});

test("a look target turns the head (and the eye) toward it, and letting go lets it come back", () => {
  for (const side of [1, -1]) {
    const t = tile("keybot", "idle", 11);
    for (let f = 0; f < 120; f++) t.step(1 / 60);
    const base = t.gaze();
    const tx = base.headX + side * 400, ty = base.headY - 150;
    t.lookAt(tx, ty);
    for (let f = 0; f < 60; f++) t.step(1 / 60);
    const g = t.gaze();
    assert.ok(side * g.tilt > 0.12, `head turned ${g.tilt.toFixed(2)} for side ${side}`);
    assert.ok(side * g.face > 0.5, `faces ${g.face.toFixed(2)} for side ${side}`);
    assert.ok(side * (g.w - g.face * 0.22 * t.rH) >= 0, "the pupil looks that way too");
    t.lookAway();
    for (let f = 0; f < 120; f++) t.step(1 / 60);
    assert.ok(Math.abs(t.gaze().tilt) < Math.abs(g.tilt), "and turns back");
  }
});

test("a tap in the grid: every other bot looks at the tapped tile, the tapped one perks up", () => {
  const w = new BotTilesWorld();
  const kinds: BotKind[] = ["code", "keybot", "plan", "make"];
  kinds.forEach((k, i) => w.add(new BotTile({ kind: k, color: "#A9573A", mood: "idle", seed: 3 + i })));
  kinds.forEach((_k, i) => w.place(i, (i % 2) * 181, Math.floor(i / 2) * 144, 169, 132, 72));
  for (let f = 0; f < 240; f++) w.step(1 / 60);
  w.focus(3, 80, 60);
  for (let f = 0; f < 40; f++) w.step(1 / 60);
  // Tile 3 is bottom right: tile 0 (top left) looks right and down, tile 1 (top right) down, tile 2 (bottom left) right.
  const g0 = w.tiles[0]!.gaze(), g2 = w.tiles[2]!.gaze();
  assert.ok(g0.face > 0.5 && g0.tilt > 0, `top-left turned ${g0.face.toFixed(2)}/${g0.tilt.toFixed(2)}`);
  assert.ok(g2.face > 0.5 && g2.tilt > 0.1, `bottom-left turned ${g2.face.toFixed(2)}/${g2.tilt.toFixed(2)}`);
  assert.ok(w.tiles[3]!.cheerT >= 0 || w.tiles[3]!.glow > 0, "the tapped bot perks up");
  w.release();
  assert.ok(w.tiles.every((t) => t.focusX !== t.focusX), "released");
});

test("Reduce Motion: a resting pose, and nothing moves after it", () => {
  for (const kind of KINDS) {
    for (const mood of MOODS) {
      const t = tile(kind, mood, 8);
      for (let f = 0; f < 200; f++) t.step(1 / 60);
      t.settle(true);
      assert.ok(t.finite() && t.inside(), `${kind}/${mood}`);
      const x = Array.from(t.x), fab = t.fabric.maxShift();
      for (let f = 0; f < 120; f++) t.step(1 / 60);
      assert.deepStrictEqual(Array.from(t.x), x, `${kind}/${mood} moved`);
      assert.strictEqual(fab, 0, "the fabric is flat");
      if (mood === "needs" && kind !== "make") assert.ok(Math.abs(t.face) < 0.2, "needs you: facing the person");
      t.settle(false);
      t.step(0.1);
      assert.notDeepStrictEqual(Array.from(t.x), x, `${kind}/${mood} lives again`);
    }
  }
});

test("a frame draws in a bounded number of calls, and steps in fixed time", () => {
  for (const kind of KINDS) {
    const t = tile(kind, "working", 2);
    const c = counter();
    let worst = 0;
    for (let f = 0; f < 600; f++) { t.step(1 / 60); c.calls = 0; t.draw(c); worst = Math.max(worst, c.calls); }
    assert.ok(worst < 720, `${kind}: ${worst} calls in a frame`);
    // A long frame is clamped: one step() never runs more than its share of fixed steps.
    const before = t.t;
    t.step(5);
    assert.ok(t.t - before <= 1 / 20 + STEP, "a long pause is not caught up");
  }
});

test("a tile keeps its bots when it is resized, and its floor moves", () => {
  const t = tile("code", "idle", 4);
  for (let f = 0; f < 120; f++) t.step(1 / 60);
  const hx = t.x[2]!;
  t.resize(200, 150, 90);
  assert.ok(Math.abs(t.x[2]! - hx * (200 / 169)) < 1e-6, "kept, scaled across");
  for (let f = 0; f < 240; f++) t.step(1 / 60);
  assert.ok(t.finite() && t.inside());
  assert.ok(t.y[3]! > 80, "feet on the new floor");
});

test("the window's botTiles.js is generated from this core, unchanged", { skip: !existsSync(DEFAULT_OUT) && "TAILZU-DESKTOP is not beside this repo" }, () => {
  const out = readFileSync(DEFAULT_OUT, "utf8");
  const h = hashesOf(out);
  assert.strictEqual(h.src, sha(readFileSync(SOURCE, "utf8")), "core.ts changed: run `node src/botTiles/genDesktop.mjs` and commit TAILZU-DESKTOP/botTiles.js");
  assert.strictEqual(h.actualBody, h.body, "TAILZU-DESKTOP/botTiles.js was edited by hand: regenerate it");
});
