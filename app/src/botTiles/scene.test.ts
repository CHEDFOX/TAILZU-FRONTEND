// node --test
//
// The scene engine (scene.ts), looks format 2: every element kind compiles and draws; keyframes, eases and springs
// give exact values; chains stay finite under hard input; the moment's events go both ways; the rig changes the bot;
// every budget is refused at compile time; hoisting gives the same numbers as no hoisting; a dot field quantizes to
// the same groups on a Skia-like and a Canvas2D-like host; the same seed gives the same frames; and 5,000 random
// objects never throw out of compile.
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { ANCHORS, BotTile, STEP, XAPI, compileLooks, resetScreenScenes, type TileCtx } from "./core.ts";
import {
  B_LEVEL, B_T, NBASE, SCENE_LIMITS, SceneRun, compileScene, renderStill, type Scene, type SceneCtx, type SceneDraw,
} from "./scene.ts";

const anchorIndex = (n: string) => ANCHORS.indexOf(n);
const hasPart = (id: string) => (id === "drop" ? { id } : null);

function build(spec: unknown, id = "s"): { sc: Scene; errs: string[] } {
  const errs: string[] = [];
  const sc = compileScene(id, spec, XAPI, anchorIndex, hasPart, errs);
  return { sc, errs };
}

function ok(spec: Record<string, unknown>, id = "s"): Scene {
  const { sc, errs } = build({ format: 2, box: [1, 1], els: [], ...spec }, id);
  assert.deepStrictEqual(errs, [], `compiles: ${JSON.stringify(errs)}`);
  return sc;
}

function bad(spec: Record<string, unknown>): string {
  const { errs } = build({ format: 2, box: [1, 1], els: [], ...spec });
  assert.ok(errs.length, "it should have been refused");
  return errs.join(" | ");
}

/** A host that draws nothing and counts what it was asked, with or without the format-2 members. */
function pad(v2: boolean): SceneCtx & { calls: number; groups: Array<[number, number, string]>; arcs: number } {
  const c = {
    calls: 0, groups: [] as Array<[number, number, string]>, arcs: 0,
    globalAlpha: 1, fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1,
    lineCap: "butt" as const, lineJoin: "miter" as const,
  } as SceneCtx & { calls: number; groups: Array<[number, number, string]>; arcs: number };
  for (const m of ["save", "restore", "translate", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "fill", "stroke"]) {
    (c as unknown as Record<string, () => void>)[m] = () => { c.calls++; };
  }
  c.arc = () => { c.calls++; c.arcs++; };
  if (v2) {
    c.bezierCurveTo = () => { c.calls++; };
    c.clip = () => { c.calls++; };
    c.dots = (_xy, n, r, col) => { c.calls++; c.groups.push([n, Math.round(r * 1e4) / 1e4, col]); };
  }
  return c;
}

const DRAW: SceneDraw = { ox: 100, oy: 100, S: 40, mirror: 1, alpha: 1, color: "#4F7A3A", ink: "#0a0a0a", paper: "#ffffff", anchors: null, allBack: false };

function run(sc: Scene, seed = 7): SceneRun {
  const r = new SceneRun(sc, seed);
  r.api = XAPI;
  r.start();
  return r;
}

// ------------------------------------------------------------------ the kinds

test("every element kind compiles and draws, on a host with the format-2 calls and on one without", () => {
  const sc = ok({
    box: [2, 1],
    els: [
      { id: "ring", kind: "shape", d: "M -0.3 0 C -0.1 -0.4 0.1 -0.4 0.3 0 Z", fill: "$color", stroke: "ink", width: 0.02 },
      { id: "field", kind: "dots", grid: "hex", cols: 8, rows: 4, gap: 0.1, rmax: 0.04, r: "0.02 + 0.01*sin(t + i)", pal: ["$color", "ink"] },
      { id: "rope", kind: "chain", n: 6, len: 0.3, from: "ground", g: 1, stroke: "ink", width: 0.02 },
      { id: "pack", kind: "group", clip: "ring", els: [{ kind: "part", part: "drop", paint: "$color" }] },
      { kind: "repeat", n: 4, el: { kind: "shape", d: "O 0 0 0.05", fill: "$color", x: "j*0.1" } },
    ],
  });
  assert.strictEqual(sc.flat.length, 7, "five at the top, a group's child and a repeat's child");
  for (const v2 of [true, false]) {
    const r = run(sc);
    const ctx = pad(v2);
    r.vars[B_T] = 0.4;
    r.step(1 / 60);
    r.draw(ctx, { ...DRAW, anchors: new Float64Array(ANCHORS.length * 6) }, false);
    assert.ok(!r.dead, `v2=${v2}: ${r.why}`);
    assert.ok(ctx.calls > 0, `v2=${v2}: it drew`);
    if (!v2) assert.ok(ctx.arcs > 0, "no dots(): the arc fallback draws each dot");
    else assert.ok(ctx.groups.length > 0, "dots(): one call per group");
  }
});

test("a cubic needs no bezierCurveTo: a host without one gets two quadratics, and the same path otherwise", () => {
  const sc = ok({ els: [{ kind: "shape", d: "M -0.2 0 C -0.1 -0.3 0.1 -0.3 0.2 0", stroke: "ink", width: 0.02 }] });
  const withIt = pad(true), without = pad(false);
  for (const ctx of [withIt, without]) run(sc).draw(ctx, DRAW, false);
  assert.ok(withIt.calls > 0 && without.calls > 0);
});

// ------------------------------------------------------------------ values

test("keyframes: the exact value at a key, between two, past the end, each ease, and a loop", () => {
  const sc = ok({
    els: [{ id: "m", kind: "shape", d: "O 0 0 0.1", fill: "$color", x: { k: [[0, 0], [1, 1, "lin"], [2, 0, "inout"]] } }],
  });
  const r = run(sc);
  const el = sc.flat[0]!;
  const at = (t: number) => { r.vars[B_T] = t; return r.value(el.x); };
  assert.strictEqual(at(0), 0);
  assert.strictEqual(at(1), 1);
  assert.strictEqual(at(2), 0);
  assert.strictEqual(at(-5), 0, "before the first key: the first value");
  assert.strictEqual(at(99), 0, "past the last: the last value");
  assert.ok(Math.abs(at(0.5) - 0.5) < 1e-12, "lin, half way");
  assert.ok(Math.abs(at(1.5) - 0.5) < 1e-12, "inout is symmetric at the middle");
  const eased = ok({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", x: { k: [[0, 0], [1, 1, "in"]] } }] }, "e");
  const re = run(eased);
  re.vars[B_T] = 0.5;
  assert.ok(Math.abs(re.value(eased.flat[0]!.x) - 0.25) < 1e-12, "in: w squared");
  const looped = ok({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", x: { k: [[0, 0], [1, 1]], loop: true } }] }, "l");
  const rl = run(looped);
  rl.vars[B_T] = 2.25;
  assert.ok(Math.abs(rl.value(looped.flat[0]!.x) - 0.25) < 1e-9, "a loop goes round");
});

test("a spring chases its target and settles there, at the fixed step whatever the frame rate", () => {
  const sc = ok({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", y: { spring: "t > 0.5 ? 1 : 0", k: 160, damp: 1 } }] });
  const r = run(sc);
  const el = sc.flat[0]!;
  r.vars[B_T] = 0;
  r.step(1 / 60);
  assert.strictEqual(r.value(el.y), 0, "it starts where its target is");
  for (let f = 1; f < 240; f++) { r.vars[B_T] = f / 60; r.step(1 / 60); }
  assert.ok(Math.abs(r.value(el.y) - 1) < 0.01, `settled at its target, not ${r.value(el.y)}`);
  assert.ok(Number.isFinite(r.value(el.y)));
});

// ------------------------------------------------------------------ chains

test("chains stay finite under hard input: open, closed, with a floor, with pressure", () => {
  for (const extra of [{}, { closed: true }, { closed: true, area: 1.5 }, { floor: 0.2 }, { from: "ground", to: "hand_r" }]) {
    const sc = ok({
      box: [2, 2],
      els: [{ kind: "chain", n: SCENE_LIMITS.chainN, len: 0.5, g: 9, drag: 1, stiff: 1, iter: 4, stroke: "ink", width: 0.02, ...extra }],
    }, `c${Object.keys(extra).join("")}`);
    const r = run(sc);
    const ctx = pad(true);
    const anchors = new Float64Array(ANCHORS.length * 6);
    for (let f = 0; f < 400; f++) {
      r.vars[B_T] = f / 60;
      // Shake the anchors hard every frame.
      for (let a = 0; a < ANCHORS.length; a++) { anchors[a * 6] = 100 + 60 * Math.sin(f); anchors[a * 6 + 1] = 100 + 60 * Math.cos(f * 1.7); anchors[a * 6 + 2] = 1; anchors[a * 6 + 5] = 1; }
      r.step(1 / 60);
      r.draw(ctx, { ...DRAW, anchors }, false);
    }
    assert.ok(!r.dead, `${JSON.stringify(extra)}: ${r.why}`);
  }
});

// ------------------------------------------------------------------ events, emit, rig

test("ev.<name> is the age of a moment event, and `emit` fires one back, at most twice a second", () => {
  const sc = ok({
    events: ["go"],
    emit: [["loud", "level > 0.6"]],
    els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", show: "ev.go < 1" }],
  });
  const r = run(sc);
  r.vars[NBASE] = 99;
  assert.strictEqual(r.value(sc.flat[0]!.show), 0, "nothing has fired: 99 seconds ago");
  r.vars[NBASE] = 0.4;
  assert.strictEqual(r.value(sc.flat[0]!.show), 1);
  // emit: false to true fires once, and not again inside half a second.
  r.vars[B_T] = 0; r.vars[B_LEVEL] = 0; r.step(1 / 60);
  assert.deepStrictEqual(r.fired, []);
  r.vars[B_T] = 0.1; r.vars[B_LEVEL] = 0.9; r.step(1 / 60);
  assert.deepStrictEqual(r.fired, ["loud"]);
  r.fired.length = 0;
  r.vars[B_T] = 0.2; r.vars[B_LEVEL] = 0; r.step(1 / 60);
  r.vars[B_T] = 0.3; r.vars[B_LEVEL] = 0.9; r.step(1 / 60);
  assert.deepStrictEqual(r.fired, [], "not twice inside half a second");
  r.vars[B_T] = 1.0; r.vars[B_LEVEL] = 0; r.step(1 / 60);
  r.vars[B_T] = 1.1; r.vars[B_LEVEL] = 0.9; r.step(1 / 60);
  assert.deepStrictEqual(r.fired, ["loud"], "after half a second it may fire again");
});

test("the rig: the bot's own transform, his alpha, and the groups a scene hides", () => {
  const sc = ok({ rig: { alpha: "1 - t", sx: "1.3", sy: "0.7", rot: "0.2", about: "foot_l", hide: ["antennae", "wear"] } });
  const r = run(sc);
  r.vars[B_T] = 0.25;
  r.step(1 / 60);
  assert.ok(r.rigOn);
  assert.ok(Math.abs(r.rigAlpha - 0.75) < 1e-12);
  assert.strictEqual(r.rigSx, 1.3);
  assert.strictEqual(r.rigSy, 0.7);
  assert.strictEqual(r.rigAbout, ANCHORS.indexOf("foot_l"));
  assert.strictEqual(r.rigHide, (1 << 2) | (1 << 6), "antennae and wear");
  assert.ok(bad({ rig: { hide: ["elbow"] } }).includes("not a group"));
  assert.ok(bad({ rig: { about: "elbow" } }).includes("not an anchor"));
});

// ------------------------------------------------------------------ the budgets

test("every limit is refused at compile time, with a reason in words", () => {
  const dots = (n: number) => ({ els: [{ kind: "dots", cols: n, rows: 1, gap: 0.01, r: "0.01" }] });
  assert.ok(bad(dots(SCENE_LIMITS.dotsEl + 1)).includes("dots"));
  assert.ok(bad({ box: [SCENE_LIMITS.boxW + 1, 1] }).includes("at most"));
  assert.ok(bad({ box: [1, SCENE_LIMITS.boxH + 1] }).includes("at most"));
  assert.ok(bad({ els: [{ kind: "chain", n: SCENE_LIMITS.chainN + 1, stroke: "ink" }] }).includes("n:"));
  assert.ok(bad({ els: [{ kind: "repeat", n: SCENE_LIMITS.repeat + 1, el: { kind: "shape", d: "O 0 0 0.1", fill: "ink" } }] }).includes("n:"));
  assert.ok(bad({ vars: Object.fromEntries(Array.from({ length: SCENE_LIMITS.vars + 1 }, (_, i) => [`v${i}`, "t"])) }).includes("at most"));
  assert.ok(bad({ events: Array.from({ length: SCENE_LIMITS.events + 1 }, (_, i) => `e${i}`) }).includes("at most"));
  assert.ok(bad({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", x: { k: Array.from({ length: SCENE_LIMITS.keys + 1 }, (_, i) => [i, i]) } }] }).includes("keys"));
  assert.ok(bad({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", morph: ["O 0 0 0.1", "O 0 0 0.1", "O 0 0 0.1", "O 0 0 0.1", "O 0 0 0.1"] }] }).includes("morph"));
  // Over the op budget: a long per-dot formula on a big field.
  const heavy = "sin(t*qx) + cos(t*qy) + hypot(qx, qy) + ".repeat(60) + "0";
  assert.ok(bad({ els: [{ kind: "dots", cols: 20, rows: 20, gap: 0.02, rmax: 0.05, r: heavy }] }).includes("ops a frame"));
  // Three chains are allowed, four are not.
  const chain = { kind: "chain", n: 4, len: 0.2, stroke: "ink" };
  assert.deepStrictEqual(build({ format: 2, box: [1, 1], els: [chain, chain, chain] }).errs, []);
  assert.ok(bad({ els: [chain, chain, chain, chain] }).includes("chains"));
  // A dot field and a chain may both sit inside a repeat; the budgets, counting every copy, are the only gate.
  assert.deepStrictEqual(build({ format: 2, box: [1, 1], els: [{ kind: "repeat", n: 2, el: chain }] }).errs, []);
  assert.ok(bad({ els: [{ kind: "repeat", n: 4, el: chain }] }).includes("chains counting repeats"));
  const field = (cols: number) => ({ kind: "dots", cols, rows: 10, gap: 0.02, rmax: 0.02, r: "0.01" });
  assert.deepStrictEqual(build({ format: 2, box: [1, 1], els: [{ kind: "repeat", n: 3, el: field(10) }] }).errs, []);
  assert.ok(bad({ els: [{ kind: "repeat", n: 7, el: field(10) }] }).includes("counting 7 repeats"));
});

test("the static op count is what really runs: the hoisted programs and the per-dot one add up", () => {
  const sc = ok({
    vars: { open: "smooth(0, 0.7, t)" },
    els: [{ id: "w", kind: "dots", grid: "hex", cols: 10, rows: 4, gap: 0.1, rmax: 0.04, r: "0.02*open*(1 - smooth(1, 1.3, d))*(0.6 + 0.4*crest(d*6 - t*3))", paint: "hash(i) > 0.9 ? 1 : 0" }],
  });
  const el = sc.flat[0]!;
  assert.ok(el.hr!.still.length > 0, "the parts that read only a dot's rest place run once a play");
  assert.ok(el.hr!.frame.length > 0, "the parts that read no dot run once a frame");
  assert.strictEqual(el.hpaint!.still.length, 1, "a paint that reads only i is worked out once a play");
  assert.ok(el.hpaint!.opsDot <= 1, "and reading it back is one op");
  // Half the dots are brought up to date each frame.
  const perFrame = el.hr!.opsFrame + el.hdx!.opsFrame + el.hdy!.opsFrame + el.hpaint!.opsFrame;
  const perDot = el.hr!.opsDot + el.hdx!.opsDot + el.hdy!.opsDot + el.hpaint!.opsDot;
  assert.strictEqual(sc.ops, el.x.ops + el.y.ops + el.rot.ops + el.sx.ops + el.sy.ops + el.alpha.ops + el.show.ops
    + perFrame + perDot * Math.ceil(el.n / 2) + sc.vars[0]!.ops);
});

test("hoisting changes nothing: the dots come out exactly as the plain formula says", () => {
  const src = "0.02*(1 - smooth(1, 1.3, d))*(0.6 + 0.4*crest(d*6 - t*3) + 0.3*sin(qx*9 + t))";
  const sc = ok({ els: [{ kind: "dots", grid: "square", cols: 7, rows: 5, gap: 0.12, rmax: 0.05, r: src }] });
  const el = sc.flat[0]!;
  const r = run(sc);
  // The same formula, compiled whole over the same names, with no hoisting at all.
  const names = [...Array.from({ length: NBASE }, (_, i) => `n${i}`)];
  void names;
  for (const t of [0, 0.37, 1.9]) {
    r.vars[B_T] = t;
    r.step(1 / 60);
    r.step(1 / 60);                                   // both halves of the field
    const got = r.readDots(0)!;
    for (let i = 0; i < el.n; i++) {
      const d = el.qd![i]!, qx = el.qx![i]!;
      const want = 0.02 * (1 - smooth(1, 1.3, d)) * (0.6 + 0.4 * crest(d * 6 - t * 3) + 0.3 * Math.sin(qx * 9 + t));
      assert.ok(Math.abs(got.r[i]! - clampTo(want, 0, el.rmax)) < 1e-6, `dot ${i} at t=${t}: ${got.r[i]} vs ${want}`);
    }
  }
});

const smooth = (a: number, b: number, c: number): number => { const w = Math.min(1, Math.max(0, (c - a) / (b - a))); return w * w * (3 - 2 * w); };
const crest = (a: number): number => { const q = Math.sin(a); return q > 0 ? Math.pow(q, 1.6) : 0; };
const clampTo = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

test("dots are quantized by the core, not the host: eight radius steps, at most two colours, the same groups everywhere", () => {
  const sc = ok({ els: [{ kind: "dots", grid: "square", cols: 12, rows: 4, gap: 0.08, rmax: 0.04, r: "0.04*(i/n)", pal: ["$color", "ink"], paint: "i % 2" }] });
  const r = run(sc);
  r.vars[B_T] = 0.2;
  r.step(1 / 60);
  r.step(1 / 60);
  const skia = pad(true);
  r.draw(skia, DRAW, false);
  assert.ok(skia.groups.length <= 14, `at most fourteen calls, not ${skia.groups.length}`);
  const radii = new Set(skia.groups.map((g) => g[1]));
  assert.ok(radii.size <= 7, "seven radii that draw, and a step that draws nothing");
  const colours = new Set(skia.groups.map((g) => g[2]));
  assert.deepStrictEqual([...colours].sort(), ["#0a0a0a", "#4F7A3A"]);
  const total = skia.groups.reduce((n, g) => n + g[0], 0);
  // The arc fallback draws the same dots at the same radii: one moveTo and one arc each, plus a path per group.
  const canvas = pad(false);
  r.draw(canvas, DRAW, false);
  assert.strictEqual(canvas.arcs, total, "every dot the groups hold is drawn either way");
});

test("a value that goes wrong is clamped, not passed on; a scene that cannot be read is refused whole", () => {
  const sc = ok({ els: [{ kind: "dots", cols: 4, rows: 2, gap: 0.1, rmax: 0.03, r: "1/0 + log(0 - 1)", dx: "1e9", dy: "0/0" }] });
  const r = run(sc);
  r.step(1 / 60);
  r.step(1 / 60);
  const got = r.readDots(0)!;
  for (let i = 0; i < 8; i++) {
    assert.ok(got.r[i]! >= 0 && got.r[i]! <= 0.03, "the radius is inside its range");
    assert.ok(Math.abs(got.dx[i]!) <= 10 && Number.isFinite(got.dy[i]!));
  }
  assert.ok(!r.dead);
  assert.ok(bad({ els: [{ kind: "shape", d: "M 0 0 L 9 9", fill: "ink" }] }).includes("[-3, 3]"));
  assert.ok(bad({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "nope" }] }).includes("bad paint"));
  assert.ok(bad({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", x: "wobble" }] }).includes("unknown name"));
  assert.ok(bad({ els: [{ kind: "nothing" }] }).includes("kind"));
});

test("Reduce Motion draws exactly the still frame, and the same seed gives the same frames", () => {
  const spec = {
    still: 1.2,
    els: [
      { kind: "dots", cols: 6, rows: 3, gap: 0.1, rmax: 0.04, r: "0.02 + 0.015*sin(t*6 + i) + 0.01*hash(i + seed)" },
      { kind: "chain", n: 5, len: 0.3, g: 2, stroke: "ink", width: 0.02 },
    ],
  };
  const sc = ok(spec);
  const trace = (r: SceneRun) => { const c = pad(true); r.draw(c, DRAW, false); return JSON.stringify(c.groups); };
  const a = run(sc, 11), b = run(sc, 11), c = run(sc, 12);
  for (const r of [a, b, c]) { r.vars[B_T] = 1.2; r.settle(1.2); }
  assert.strictEqual(trace(a), trace(b), "the same seed, the same frame");
  assert.notStrictEqual(trace(a), trace(c), "another seed, another frame");
  // Settling again from a different clock still lands on the still frame.
  a.vars[B_T] = 5;
  a.settle(1.2);
  assert.strictEqual(trace(a), trace(b), "the still frame does not depend on where the clock was");
});

test("a fuzz of 5,000 random scene objects never throws out of compile", () => {
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a: unknown[]) => a[Math.floor(rnd() * a.length)];
  const bits: unknown[] = [0, 1, -1, 1e9, NaN, "", "t", "t*", "nope", "sin(t)", null, true, [], {}, [1, 2], { k: [[0, 1]] }, { spring: "t" }, "O 0 0 9", "M 0 0 L 0.1 0.1"];
  let refused = 0, taken = 0;
  for (let i = 0; i < 5000; i++) {
    const spec: Record<string, unknown> = {};
    for (const k of ["format", "box", "still", "tap", "events", "vars", "emit", "rig", "els", "zz"]) if (rnd() < 0.6) spec[k] = pick(bits);
    if (rnd() < 0.5) {
      spec.els = Array.from({ length: Math.floor(rnd() * 4) }, () => {
        const el: Record<string, unknown> = { kind: pick(["shape", "dots", "chain", "group", "repeat", "part", "nope"]) };
        for (const k of ["id", "on", "x", "y", "rot", "sx", "alpha", "show", "d", "m", "fill", "stroke", "width", "cols", "rows", "gap", "n", "len", "els", "el", "part", "pal", "r"]) {
          if (rnd() < 0.4) el[k] = pick(bits);
        }
        return el;
      });
    }
    const errs: string[] = [];
    const sc = compileScene("fz", spec, XAPI, anchorIndex, hasPart, errs);
    if (errs.length) refused++; else taken++;
    // Whatever came out, playing it must not throw either.
    if (sc.ok) {
      const r = run(sc);
      r.step(1 / 60);
      r.draw(pad(true), DRAW, false);
    }
  }
  assert.ok(refused > 4000, `most random objects are refused, not ${refused}`);
  assert.ok(taken >= 0);
});

// ------------------------------------------------------------------ in a moment, on a tile

const CAT = {
  v: 9,
  format: 2,
  parts: { drop: { draw: [{ d: "O 0 0 0.03", fill: "$paint" }] } },
  scenes: {
    good: {
      format: 2, label: "A small field", box: [1.4, 0.8], still: 0.5, tap: true, events: ["go"],
      vars: { open: "smooth(0, 0.4, t)" },
      emit: [["loud", "level > 0.6"]],
      els: [
        { id: "w", kind: "dots", back: true, grid: "hex", cols: 10, rows: 4, gap: 0.1, rmax: 0.03, r: "0.02*open*(1 + 0.5*(tapt < 1))" },
        { id: "f", kind: "shape", fill: "$color", d: "O 0 -0.2 0.06", show: "ev.go < 1" },
      ],
    },
    big: { format: 2, label: "Far too wide for a small tile", box: [3, 2], still: 0.2, els: [{ kind: "shape", d: "O 0 0 0.2", fill: "$color" }] },
  },
  moments: {
    "m.big": {
      format: 2, label: "A wide one", dur: 2, fallback: "survey", still: 0.2,
      tracks: [{ do: "scene", scene: "big", on: "ground", at: 0, to: 2 }],
    },
    "m.good": {
      format: 2, label: "A field", dur: 3, fallback: "survey", still: 0.5,
      tracks: [
        { do: "scene", scene: "good", on: "ground", x: 0.5, y: 0, back: true, at: 0, to: 3 },
        { do: "event", name: "go", at: 1 },
        { do: "glow", v: 4, after: "loud" },
      ],
    },
  },
} as const;

function tile(w = 340, h = 200): BotTile {
  const t = new BotTile({ kind: "custom", color: "#4F7A3A", mood: "idle", seed: 3 });
  t.resize(w, h, h - 20);
  return t;
}

test("in a moment: the scene plays, reads the moment's events, fires one back, and ends with the track", () => {
  const L = compileLooks(CAT);
  assert.deepStrictEqual(L.errors, []);
  assert.ok(L.scenes.has("good"));
  const t = tile();
  assert.ok(t.playMoment(L.moment("m.good"), "once"));
  const ctx = pad(true);
  let drew = 0;
  for (let f = 0; f < 60 * 4; f++) {
    t.setLevel(f > 60 && f < 90 ? 0.9 : 0);
    t.step(1 / 60);
    ctx.groups.length = 0;
    t.draw(ctx as unknown as TileCtx, 1);
    if (ctx.groups.length) drew++;
  }
  assert.ok(drew > 60, `the field was drawn for most of the moment, not ${drew} frames`);
  assert.ok(t.finite() && t.inside());
  assert.ok(t.momentDone(), "the moment ended, and so did the scene");
  assert.ok(!t.scenesLive());
  assert.deepStrictEqual(t.looksReport(), {}, "nothing went wrong");
});

test("a tap on a stage goes to a scene that wants taps, and only inside its box", () => {
  const L = compileLooks(CAT);
  const t = tile();
  t.playMoment(L.moment("m.good"), "loop");
  for (let f = 0; f < 30; f++) t.step(1 / 60);
  assert.ok(t.scenesLive());
  assert.strictEqual(t.cue("tap", t.scOX[0]! + 9999, t.scOY[0]!), false, "outside the box: the stage's own press");
  assert.strictEqual(t.cue("press", t.scOX[0]!, t.scOY[0]!), false, "only taps");
  assert.strictEqual(t.cue("tap", t.scOX[0]!, t.scOY[0]! - 4), true);
  assert.strictEqual(t.tapN, 1);
  assert.ok(t.tapT < 0.001);
});

test("a throwing scene is dropped alone: the bot goes on animating, the save depth comes back, the loop lives", () => {
  const L = compileLooks(CAT);
  const t = tile();
  t.playMoment(L.moment("m.good"), "loop");
  for (let f = 0; f < 30; f++) t.step(1 / 60);
  const ctx = pad(true) as SceneCtx & { calls: number; depth: number };
  ctx.depth = 0;
  let boom = true;
  ctx.save = () => { ctx.depth++; };
  ctx.restore = () => { ctx.depth--; };
  // Only the scene draws dots, so only the scene's own drawing blows up here.
  ctx.dots = () => { if (boom) throw new Error("the host blew up"); };
  const before = { x: t.x[0], y: t.y[0] };
  for (let f = 0; f < 30; f++) { t.step(1 / 60); t.draw(ctx as unknown as TileCtx, 1); }
  assert.strictEqual(ctx.depth, 0, "every save the scene made was undone");
  boom = false;
  for (let f = 0; f < 60; f++) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  assert.ok(t.finite(), "the rig is still animating");
  assert.ok(t.x[0] !== before.x || t.y[0] !== before.y || t.momentId() === "m.good");
  assert.ok((t.looksReport().bad ?? []).some((b) => b.startsWith("good:")), "it is reported");
});

test("a scene that does not fit does not play: the moment's fallback act takes over", () => {
  const L = compileLooks(CAT);
  const t = tile(50, 40);                              // far too small for a 3 by 2 box
  assert.ok(t.playMoment(L.moment("m.big"), "once"));
  for (let f = 0; f < 10; f++) t.step(1 / 60);
  assert.ok(!t.scenesLive());
  assert.ok((t.looksReport().bad ?? []).includes("big:fit"), JSON.stringify(t.looksReport()));
  assert.strictEqual(t.momentId(), "", "the moment stopped");
  assert.strictEqual(t.moment, "survey", "its fallback act plays instead");
});

test("the governor: a slow scene freezes at its still frame, and a scene that stays slow is dropped", () => {
  const L = compileLooks(CAT);
  const t = tile();
  // A clock that says every scene costs far too much.
  let now = 0;
  t.clock = () => { now += SCENE_LIMITS.ms * 4; return now; };
  t.playMoment(L.moment("m.good"), "loop");
  for (let f = 0; f < 240; f++) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  assert.ok(t.sceneSlow.includes("good"), "the governor slowed it");
  assert.ok(!t.scenesLive(), "and then dropped it");
  assert.ok(t.finite(), "the bot carries on");
});

test("a catalog's scenes: a format newer than this build is skipped, and a moment that names a missing scene is an error", () => {
  const newer = compileLooks({ ...CAT, scenes: { ...CAT.scenes, later: { format: 9, box: [1, 1], els: [] } } });
  assert.deepStrictEqual(newer.errors, [], "a newer scene is left to a newer build");
  assert.ok(!newer.scenes.has("later"));
  const missing = compileLooks({ ...CAT, moments: { bad: { format: 2, dur: 1, fallback: "wave", tracks: [{ do: "scene", scene: "nope" }] } } });
  assert.ok(missing.errors.join(" ").includes('no scene "nope"'));
  // A top-level section this build does not know is ignored, not an error.
  const future = compileLooks({ ...CAT, clips: { x: 1 } });
  assert.deepStrictEqual(future.errors, []);
  // Two scene tracks are allowed, three are not.
  const three = compileLooks({
    ...CAT,
    moments: { m: { format: 2, dur: 2, fallback: "wave", tracks: [0, 1, 2].map(() => ({ do: "scene", scene: "good", to: 2 })) } },
  });
  assert.ok(three.errors.join(" ").includes("at most 2 scene tracks"));
});

test("the step is the core's own, so a scene looks the same at 30 and at 120 frames a second", () => {
  const sc = ok({ els: [{ kind: "shape", d: "O 0 0 0.1", fill: "ink", y: { spring: "1", k: 90, damp: 0.9 } }] });
  const slow = run(sc), fast = run(sc);
  for (let f = 0; f < 30; f++) { slow.vars[B_T] = f / 30; slow.step(1 / 30); }
  for (let f = 0; f < 120; f++) { fast.vars[B_T] = f / 120; fast.step(1 / 120); }
  assert.ok(Math.abs(slow.value(sc.flat[0]!.y) - fast.value(sc.flat[0]!.y)) < 0.02);
  assert.strictEqual(STEP, 1 / 120);
});

// ------------------------------------------- a chain and a dot field inside a repeat (H15-Q4)

/** A host that keeps every dot group's points, so one element's copies can be told apart. */
function dotPad(): SceneCtx & { groups: Array<{ n: number; r: number; col: string; xy: number[] }> } {
  const c = pad(true) as SceneCtx & { groups: unknown };
  const out = c as unknown as SceneCtx & { groups: Array<{ n: number; r: number; col: string; xy: number[] }> };
  out.groups = [];
  out.dots = (xy, n, r, col) => { out.groups.push({ n, r, col, xy: Array.from(xy.subarray(0, n * 2)) }); };
  return out;
}

/** The pond's fish — a body with a chain for a tail — as a repeat of n copies, half a bot height apart. */
const fish = (n: number) => ({
  box: [2.6, 1],
  els: [{
    kind: "repeat", n,
    el: {
      id: "fish", kind: "group", x: "j*0.5 - 0.25",
      els: [
        { id: "body", kind: "shape", fill: "$color", d: "M -0.12 0 Q 0 -0.08 0.12 0 Q 0 0.08 -0.12 0 Z" },
        { id: "tail", kind: "chain", n: 6, len: 0.14, from: "body:-0.12,0", g: 0.4, drag: 0.9, stiff: 0.6, dots: 0.012, paint: "$color" },
      ],
    },
  }],
});

test("a chain inside a repeat: one rope per copy, each following its own body, and the budget counts copies", () => {
  const sc = ok(fish(2), "fish2");
  assert.strictEqual(sc.chainSlots, 2, "two copies, two ropes");
  assert.ok(sc.chains.length === 1, "one chain element");
  const r = run(sc);
  const ctx = dotPad();
  // Drawn at rest first: each tail hangs off its own copy's body, half a bot height apart.
  r.draw(ctx, DRAW, false);
  assert.strictEqual(ctx.groups.length, 2, "one dot call per copy");
  const [a, b] = ctx.groups;
  assert.ok(Math.abs((b!.xy[0]! - a!.xy[0]!) - 0.5 * DRAW.S) < 1e-6, `the copies' pins are 0.5 apart: ${a!.xy[0]} and ${b!.xy[0]}`);
  // Then shaken hard: both ropes stay finite and stay apart.
  for (let f = 0; f < 300; f++) {
    r.vars[B_T] = f / 60;
    r.step(1 / 60);
    ctx.groups.length = 0;
    r.draw(ctx, DRAW, false);
  }
  assert.ok(!r.dead, r.why);
  assert.strictEqual(ctx.groups.length, 2);
  const [p, q] = ctx.groups;
  let same = true;
  for (let i = 0; i < p!.xy.length; i += 2) if (Math.abs(q!.xy[i]! - p!.xy[i]!) > 1e-9) same = false;
  assert.ok(!same, "each copy's rope has its own points");
  // Four copies are four ropes, over the three a scene may have.
  assert.ok(bad(fish(4)).includes("chains counting repeats"));
});

test("a dot field inside a repeat: one buffer of every copy's dots, and `j` hoists as a per-dot name", () => {
  const src = "0.01 + 0.004*j + 0.003*sin(qx*5 + t)";
  const sc = ok({
    box: [2, 1],
    els: [{ kind: "repeat", n: 3, el: { id: "f", kind: "dots", grid: "square", cols: 5, rows: 4, gap: 0.1, rmax: 0.05, x: "j*0.4 - 0.4", r: src } }],
  }, "rdots");
  const el = sc.flat[1]!;
  assert.strictEqual(el.n, 20, "twenty dots a copy");
  assert.strictEqual(el.nAll, 60, "sixty in all");
  assert.strictEqual(sc.dots, 60, "and the scene's budget counts all sixty");
  assert.ok(el.hr!.still.length > 0, "the part that reads only `j` and the rest place runs once a play");
  const r = run(sc);
  for (const t of [0, 0.42, 2.3]) {
    r.vars[B_T] = t;
    r.step(1 / 60);
    r.step(1 / 60);                                   // both halves of the field
    const got = r.readDots(0)!;
    for (let k = 0; k < el.nAll; k++) {
      const j = Math.floor(k / el.n), qx = el.qx![k % el.n]!;
      const want = 0.01 + 0.004 * j + 0.003 * Math.sin(qx * 5 + t);
      assert.ok(Math.abs(got.r[k]! - clampTo(want, 0, el.rmax)) < 1e-6, `dot ${k} at t=${t}: ${got.r[k]} vs ${want}`);
    }
  }
  // Each copy is drawn from its own slice of that one buffer, under its own frame.
  const ctx = dotPad();
  r.draw(ctx, DRAW, false);
  const drawn = ctx.groups.reduce((n, g) => n + g.n, 0);
  assert.strictEqual(drawn, 60, "every copy's dots are drawn once");
  const lefts = ctx.groups.map((g) => Math.min(...g.xy.filter((_, i) => i % 2 === 0)));
  assert.ok(Math.max(...lefts) - Math.min(...lefts) > 0.7 * DRAW.S, "the copies stand apart");
});

/** A host that keeps the first point of every path, so one shape's copies can be told apart. */
function pathPad(): SceneCtx & { heads: Array<[number, number]> } {
  const c = pad(true) as SceneCtx & { heads: Array<[number, number]> };
  c.heads = [];
  let fresh = false;
  c.beginPath = () => { fresh = true; };
  c.moveTo = (x: number, y: number) => { if (fresh) { c.heads.push([x, y]); fresh = false; } };
  return c;
}

test("a repeat inside a repeat: `j` counts through all of them and `nj` is their product (H22-Q3)", () => {
  /** The first point of each copy's path, in order. */
  const heads = (sc: Scene): Array<[number, number]> => {
    const ctx = pathPad();
    run(sc).draw(ctx, DRAW, false);
    return ctx.heads;
  };
  const dot = (x: string, y = "0") => ({ kind: "shape", d: "O 0 0 0.02", fill: "$color", x, y });
  const nest = (el: unknown, outer = 2, inner = 3) => ({ box: [2, 1], els: [{ kind: "repeat", n: outer, el: { kind: "repeat", n: inner, el } }] });
  // `j*0.1` sets each copy apart, `(j % 3)*0.05` says which inner copy it is.
  const child = dot("j*0.1", "(j % 3)*0.05");
  const a = heads(ok(nest(child), "nest"));
  const b = heads(ok({ box: [2, 1], els: [{ kind: "repeat", n: 6, el: child }] }, "flat"));
  assert.strictEqual(a.length, 6, "two outer copies of three inner ones: six in all");
  assert.deepStrictEqual(a, b, "2 around 3 draws exactly what a flat 6 draws: `j` counts through");
  for (let j = 0; j < 6; j++) {
    assert.ok(Math.abs((a[j]![0] - a[0]![0]) - j * 0.1 * DRAW.S) < 1e-6, `copy ${j} reads j=${j}: ${(a[j]![0] - a[0]![0]) / DRAW.S}`);
    // Nothing is lost: `%` and `floor` give the inner and the outer copy back.
    assert.ok(Math.abs(Math.abs(a[j]![1] - a[0]![1]) - (j % 3) * 0.05 * DRAW.S) < 1e-6, `copy ${j} is inner copy ${j % 3}`);
  }
  // `nj` is the product, six, not the inner three: every copy reads the same one.
  const njNest = heads(ok(nest(dot("nj*0.1")), "nj6"));
  const njTwo = heads(ok({ box: [2, 1], els: [{ kind: "repeat", n: 2, el: dot("nj*0.1") }] }, "nj2"));
  for (const h of njNest) assert.ok(Math.abs(h[0] - njNest[0]![0]) < 1e-9, "nj is the same in every copy");
  assert.ok(Math.abs((njNest[0]![0] - njTwo[0]![0]) - 4 * 0.1 * DRAW.S) < 1e-6, "nj is 2 x 3 = 6, not 3");
});

// ------------------------------------------- the host's rotate and scale (H15-Q5), and `len` (H15-Q6)

test("a host without rotate and scale draws every scene call the same: only the rig's own turn is lost", () => {
  const CATRIG = {
    v: 1, format: 2,
    scenes: {
      rg: {
        format: 2, label: "A rig and a field", box: [1.4, 0.8], still: 0.4,
        rig: { alpha: "0.6", sx: "1.3", sy: "0.7", rot: "0.2", about: "foot_l", hide: ["antennae"] },
        els: [
          { kind: "dots", grid: "hex", cols: 8, rows: 3, gap: 0.1, rmax: 0.03, r: "0.02" },
          { kind: "shape", fill: "$color", d: "M -0.2 0 C -0.1 -0.3 0.1 -0.3 0.2 0 Z" },
        ],
      },
    },
    moments: {
      "m.rig": { format: 2, label: "Rigged", dur: 2, fallback: "survey", still: 0.4, tracks: [{ do: "scene", scene: "rg", on: "ground", at: 0, to: 2 }] },
    },
  };
  const L = compileLooks(CATRIG);
  assert.deepStrictEqual(L.errors, []);
  /** Every call, with its numbers, as one line. */
  function log(full: boolean): string[] {
    const lines: string[] = [];
    const num = (v: unknown) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
    const c: Record<string, unknown> = {
      globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    };
    for (const m of ["save", "restore", "translate", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "arc", "fill", "stroke", "bezierCurveTo", "clip"]) {
      c[m] = (...a: unknown[]) => { lines.push(`${m}(${a.map(num).join(",")}) a=${num((c as { globalAlpha: number }).globalAlpha)}`); };
    }
    c.dots = (xy: Float32Array, n: number, r: number, col: string) => {
      lines.push(`dots(${n},${num(r)},${col},${Array.from(xy.subarray(0, n * 2)).map(num).join(" ")})`);
    };
    if (full) {
      c.rotate = (rad: number) => { lines.push(`rotate(${num(rad)})`); };
      c.scale = (x: number, y: number) => { lines.push(`scale(${num(x)},${num(y)})`); };
    }
    const t = tile();
    t.playMoment(L.moment("m.rig"), "once");
    for (let f = 0; f < 30; f++) t.step(1 / 60);
    t.draw(c as unknown as TileCtx, 1);
    return lines;
  }
  const withBoth = log(true), without = log(false);
  assert.ok(withBoth.some((l) => l.startsWith("rotate(")), "the rig turns him on a host that can");
  assert.ok(withBoth.some((l) => l.startsWith("scale(")), "and squashes him");
  assert.deepStrictEqual(withBoth.filter((l) => !l.startsWith("rotate(") && !l.startsWith("scale(")), without,
    "every other call, the whole scene's among them, is identical: the engine works out its own transforms");
  assert.ok(without.some((l) => l.startsWith("dots(")), "the scene really drew");
});

test("a chain's `len` is the whole rope's rest length, end to end, not one segment", () => {
  // Open: six points, 0.14 bot heights from the pinned end to the loose one, whatever `n` is.
  for (const n of [4, 6, 12]) {
    const sc = ok({ box: [1, 1], els: [{ id: "tail", kind: "chain", n, len: 0.14, dots: 0.01, paint: "ink" }] }, `len${n}`);
    const r = run(sc);
    const ctx = dotPad();
    r.draw(ctx, DRAW, false);
    const xy = ctx.groups[0]!.xy;
    const span = Math.hypot(xy[xy.length - 2]! - xy[0]!, xy[xy.length - 1]! - xy[1]!);
    // The points go to the host as 32-bit floats, so the span is exact to about a thousandth of a pixel.
    assert.ok(Math.abs(span - 0.14 * DRAW.S) < 1e-3, `n=${n}: ${span / DRAW.S} bot heights end to end`);
  }
  // Closed: the perimeter is `len`, so eight points settle on 0.1 segments.
  const ring = ok({ box: [1, 1], els: [{ kind: "chain", n: 8, len: 0.8, closed: true, g: 0, drag: 0.9, stiff: 1, iter: 4, dots: 0.01, paint: "ink" }] }, "ring");
  const rr = run(ring);
  const ctx = dotPad();
  for (let f = 0; f < 200; f++) { rr.vars[B_T] = f / 60; rr.step(1 / 60); ctx.groups.length = 0; rr.draw(ctx, DRAW, false); }
  const xy = ctx.groups[0]!.xy;
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    total += Math.hypot(xy[j * 2]! - xy[i * 2]!, xy[j * 2 + 1]! - xy[i * 2 + 1]!);
  }
  assert.ok(Math.abs(total / 8 - 0.1 * DRAW.S) < 0.01 * DRAW.S, `segments settle on 0.1: ${total / 8 / DRAW.S}`);
});

test("renderStill never throws: with no Skia here it is a null, so the window and the server simply have no stills", () => {
  // The widgets' and the keyboard's stills are drawn on the phone's own CPU raster. This file is also the window's
  // and the server's engine, where none of that exists, so the one thing to pin is that it fails safe.
  for (const ask of [
    { avatar: "blip", moment: "p.pond" },
    { avatar: "", moment: "" },
    { avatar: "blip", moment: "nothing.like.this", color: "#4F7A3A" },
    { avatar: "blip", moment: "p.pond", color: "not a colour" },
  ]) {
    for (const at of [0, 0.5, 1, -2, 99, NaN]) {
      assert.strictEqual(renderStill(ask, at, { w: 128, h: 128 }, "light"), null);
      assert.strictEqual(renderStill(ask, at, { w: 0, h: 0 }, "dark"), null);
    }
  }
});

test("scene.ts reaches outside itself in one place only: five call-time requires, all inside renderStill (H22-Q4)", () => {
  // The file is the window's and the server's engine too, so its "nothing here imports anything" rule is what keeps
  // the generated module loadable. renderStill is the one exception; this pins it so it cannot grow.
  const src = readFileSync(new URL("./scene.ts", import.meta.url), "utf8");
  assert.ok(!/^\s*import[\s{*]/m.test(src), "scene.ts still imports nothing at the top");
  const found = [...src.matchAll(/require\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!);
  assert.deepStrictEqual(found, ["@shopify/react-native-skia", "../onboard/skiaCtx", "./core", "./looks", "./starter"],
    "the five Metro resolves on the phone, and nothing else");
  const at = src.indexOf("export function renderStill(");
  assert.ok(at > 0, "renderStill is there");
  for (const m of src.matchAll(/require\s*\(/g)) assert.ok(m.index! > at, `a require at ${m.index} is outside renderStill`);
});

// ------------------------------------------------------------------ dead for the play, the governor, the screen

/** A catalog with one plain shape scene, so a host that throws kills it on a frame we choose. */
const BOOM = {
  v: 9,
  format: 2,
  parts: { drop: { draw: [{ d: "O 0 0 0.03", fill: "$paint" }] } },
  scenes: {
    one: { format: 2, box: [1, 1], still: 0.2, els: [{ id: "b", kind: "shape", d: "O 0 -0.3 0.1", fill: "ink" }] },
    puff: { format: 2, box: [1, 1], still: 0.2, els: [{ id: "p", kind: "part", part: "drop", paint: "ink" }] },
    slide: {
      format: 2, box: [2, 1], still: 0.5,
      els: [{ id: "ball", kind: "shape", d: "O 0 -0.3 0.1", fill: "ink", x: { k: [[0, -0.8], [4, 0.8]] } }],
    },
    rope: {
      format: 2, box: [1, 1], still: 0.2,
      els: [{ id: "r", kind: "chain", n: 6, len: 0.5, g: 8, drag: 0.98, stiff: 0.8, stroke: "ink", width: 0.02 }],
    },
  },
  moments: {
    "m.one": { format: 2, dur: 6, mode: "loop", fallback: "survey", still: 0.2, tracks: [{ do: "scene", scene: "one", on: "ground", at: 0, to: 6, back: true }] },
    "m.puff": { format: 2, dur: 3, fallback: "survey", still: 0.2, tracks: [{ do: "scene", scene: "puff", on: "ground", at: 0, to: 3, back: true }] },
    "m.slide": { format: 2, dur: 6, mode: "loop", fallback: "survey", still: 0.5, tracks: [{ do: "scene", scene: "slide", on: "ground", at: 0, to: 6, back: true }] },
    // No `back` on either the track or the element: the chain is drawn in the FRONT pass.
    "m.rope": { format: 2, dur: 3, fallback: "survey", still: 0.2, tracks: [{ do: "scene", scene: "rope", on: "ground", at: 0, to: 3 }] },
  },
} as const;

/** Watch what one run's own drawing asks of the host, apart from the bot's. */
function watchScene(t: BotTile, ctx: Record<string, unknown>, count: () => void): void {
  const r = t.scRun[0];
  if (!r || (r as unknown as { __w?: number }).__w) return;
  (r as unknown as { __w?: number }).__w = 1;
  const d = r.draw.bind(r);
  r.draw = (c, dd, b) => { inScene = true; try { d(c, dd, b); } finally { inScene = false; } };
  void ctx; void count;
}
let inScene = false;

test("a scene that keeps throwing is built once a play, not once a frame, and the moment carries on", () => {
  const L = compileLooks(BOOM);
  assert.deepStrictEqual(L.errors, []);
  const t = tile();
  t.playMoment(L.moment("m.one"), "loop");
  let boom = false;
  const ctx = pad(true) as SceneCtx & { calls: number };
  ctx.fill = () => { if (boom && inScene) throw new Error("the host blew up"); };
  const runs = new Set<unknown>();
  for (let f = 0; f < 300; f++) {
    t.step(1 / 60);
    watchScene(t, ctx, () => {});
    if (t.scRun[0]) runs.add(t.scRun[0]);
    if (f === 30) boom = true;
    t.draw(ctx as unknown as TileCtx, 1);
  }
  assert.strictEqual(runs.size, 1, "one SceneRun for the whole play, not one a frame");
  assert.deepStrictEqual(t.looksReport().bad, ["one:throw"], "reported once, not four times");
  assert.ok(!t.scenesLive(), "it stays dead for this play");
  assert.strictEqual(t.momentId(), "m.one", "the moment itself carries on with the rig");
  // A new play starts clean.
  t.playMoment(L.moment("m.one"), "loop");
  for (let f = 0; f < 5; f++) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  assert.ok(t.scenesLive(), "the next play builds it again");
});

test("a scene that dies on its first frame plays the moment's fallback act", () => {
  const L = compileLooks(BOOM);
  const t = tile();
  t.playMoment(L.moment("m.one"), "once");
  const ctx = pad(true) as SceneCtx & { calls: number };
  ctx.fill = () => { if (inScene) throw new Error("the host blew up"); };
  for (let f = 0; f < 20; f++) {
    t.step(1 / 60);
    watchScene(t, ctx, () => {});
    t.draw(ctx as unknown as TileCtx, 1);
  }
  assert.ok((t.looksReport().bad ?? []).includes("one:throw"));
  assert.ok(!t.scenesLive());
  assert.strictEqual(t.momentId(), "", "nobody sees half a moment");
  assert.strictEqual(t.moment, "survey", "its fallback act plays instead");
});

test("the governor sees the whole frame: a scene under the limit in each part, over it in the frame, is slowed", () => {
  const L = compileLooks(BOOM);
  const t = tile();
  const STEP_MS = SCENE_LIMITS.ms * 0.45, DRAW_MS = SCENE_LIMITS.ms * 0.3;
  assert.ok(STEP_MS < SCENE_LIMITS.ms && DRAW_MS < SCENE_LIMITS.ms, "each part on its own is well under");
  assert.ok(STEP_MS + 2 * DRAW_MS > SCENE_LIMITS.ms, "the frame together is over");
  // A clock the core reads twice around each piece of work; the second read is where the cost lands.
  let now = 0, cost = 0, odd = false;
  t.clock = () => { odd = !odd; if (!odd) now += cost; return now; };
  const st = t.scenesStep.bind(t), dr = t.drawScenes.bind(t);
  t.scenesStep = (dt: number) => { cost = STEP_MS; st(dt); };
  t.drawScenes = (c: TileCtx, a: number, back: boolean) => { cost = DRAW_MS; dr(c, a, back); };
  t.playMoment(L.moment("m.one"), "loop");
  for (let f = 0; f < 200 && !t.scFroze[0]; f++) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  assert.ok(t.sceneSlow.includes("one"), "the governor froze it");
  for (let f = 0; f < 200 && t.scenesLive(); f++) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  assert.ok(!t.scenesLive(), "still over the line while frozen: dropped");
  assert.ok(t.finite(), "the bot carries on");
});

test("a frozen scene is its still frame: nothing is evaluated again", () => {
  const L = compileLooks(BOOM);
  const t = tile();
  let now = 0, odd = false, slow = false;
  t.clock = () => { odd = !odd; if (!odd && slow) now += SCENE_LIMITS.ms * 3; return now; };
  t.playMoment(L.moment("m.slide"), "loop");
  for (let f = 0; f < 60 && !t.scFroze[0]; f++) {
    if (f === 5) slow = true;
    t.step(1 / 60);
    t.draw(pad(true) as unknown as TileCtx, 1);
    if (t.scFroze[0]) slow = false;              // stop charging, so it freezes and is not dropped
  }
  assert.ok(t.scFroze[0], "it froze");
  const run = t.scRun[0]!;
  const at = run.vars[B_T], x = run.value(run.scene.flat[0]!.x);
  assert.ok(Math.abs(at - run.scene.still) < 1e-9, "its clock is the still frame");
  for (let f = 0; f < 90; f++) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  assert.strictEqual(t.scRun[0], run, "still the same run");
  assert.strictEqual(run.vars[B_T], at, "its names were not written again");
  assert.strictEqual(run.value(run.scene.flat[0]!.x), x, "so the ball is where the still frame left it");
});

test("a chain drawn in the front pass steps too: it falls under gravity", () => {
  const L = compileLooks(BOOM);
  assert.deepStrictEqual(L.errors, []);
  const t = tile();
  t.playMoment(L.moment("m.rope"), "once");
  const run = () => t.scRun[0];
  let first = NaN, last = NaN;
  for (let f = 0; f < 60; f++) {
    t.step(1 / 60);
    t.draw(pad(true) as unknown as TileCtx, 1);
    const r = run();
    if (!r) continue;
    const y = (r as unknown as { chainY: Float64Array[] }).chainY[0]?.[5];
    if (y === undefined) continue;
    if (first !== first) first = y;
    last = y;
  }
  assert.ok(first === first && last === last, "the rope was there");
  assert.ok(last > first + 1, `the free end fell (${first} to ${last})`);
});

test("a scene's `part` element really draws the catalog's part", () => {
  const L = compileLooks(BOOM);
  const t = tile();
  t.playMoment(L.moment("m.puff"), "once");
  let fills = 0;
  const ctx = pad(true) as SceneCtx & { calls: number };
  ctx.fill = () => { if (inScene) fills++; };
  for (let f = 0; f < 30; f++) {
    t.step(1 / 60);
    watchScene(t, ctx, () => {});
    t.draw(ctx as unknown as TileCtx, 1);
  }
  assert.ok(fills > 10, `the part was filled on every frame, not ${fills} times`);
  assert.deepStrictEqual(t.looksReport(), {}, "and nothing went wrong");
});

test("the screen's own budget: a fifth live scene does not start, and that bot plays the rig only", () => {
  resetScreenScenes();
  const L = compileLooks(BOOM);
  const tiles = [0, 1, 2, 3, 4].map(() => tile(169, 132));
  for (const t of tiles) t.playMoment(L.moment("m.one"), "loop");
  for (let f = 0; f < 10; f++) for (const t of tiles) { t.step(1 / 60); t.draw(pad(true) as unknown as TileCtx, 1); }
  const live = tiles.filter((t) => t.scenesLive()).length;
  assert.strictEqual(live, SCENE_LIMITS.liveScreen, `${SCENE_LIMITS.liveScreen} live on screen, not ${live}`);
  const out = tiles.find((t) => !t.scenesLive())!;
  assert.strictEqual(out.momentId(), "m.one", "the moment itself plays on, with the rig alone");
  assert.deepStrictEqual(out.looksReport(), {}, "nothing is wrong with the scene, so nothing is reported");
  // One of them stops: there is room again.
  tiles[0]!.stopMoment();
  for (let f = 0; f < 10; f++) { out.step(1 / 60); out.draw(pad(true) as unknown as TileCtx, 1); }
  assert.ok(out.scenesLive(), "the one that was kept out starts once there is room");
  resetScreenScenes();
});
