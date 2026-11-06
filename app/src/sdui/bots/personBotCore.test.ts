// node --test --experimental-strip-types src/sdui/bots/personBotCore.test.ts
//
// A person as their own tiny bot, on the real engine: the node's props read safely; the same id the same seed, a second of the
// same person another; every catalog look standing inside his box, feet on its floor, in the middle; the idle recipe compiles
// and plays; alive for minutes with his gestures he stays in his box and on his spot (and walks back to it when pushed off);
// bots side by side never sway, blink or gesture in step, and never gesture together; still is still; the one loop runs only
// for bots on screen, in front, at its frame rate, and drops a bot whose frames keep failing.
import test from "node:test";
import assert from "node:assert";
import { compileLooks, type Looks, type Moment, type TileCtx } from "../../botTiles/core.ts";
import { STARTER } from "../../botTiles/starter.ts";
import {
  GestureGate, PERSON, PERSON_IDLE, PersonIdle, SharedLoop, freeSalt, idleOptions, personIdle, personTile, readPersonBot, seedOf, stageOf,
  standIn, type LoopMember,
} from "./personBotCore.ts";

const L: Looks = compileLooks(STARTER);
const PEOPLE = ["pip", "dot", "bolt", "sage", "scout", "dapper", "nova", "blip"];
const GESTURES: Moment[] = PERSON.gestures.map((id) => L.moment(id)).filter((m): m is Moment => !!m);

/** A drawing context that only keeps the drawing's extent (px, after translations), strokes' widths included. */
function extent() {
  let tx = 0, ty = 0;
  const stack: Array<[number, number]> = [];
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  const pt = (x: number, y: number, r: number) => {
    b.x0 = Math.min(b.x0, x + tx - r); b.x1 = Math.max(b.x1, x + tx + r);
    b.y0 = Math.min(b.y0, y + ty - r); b.y1 = Math.max(b.y1, y + ty + r);
  };
  const ctx = {
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "round", lineJoin: "round",
    save() { stack.push([tx, ty]); }, restore() { const s = stack.pop(); if (s) { tx = s[0]; ty = s[1]; } },
    translate(x: number, y: number) { tx += x; ty += y; }, beginPath() {}, closePath() {}, fill() {}, stroke() {},
    moveTo(x: number, y: number) { pt(x, y, ctx.lineWidth / 2); }, lineTo(x: number, y: number) { pt(x, y, ctx.lineWidth / 2); },
    quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) { pt(x, y, ctx.lineWidth / 2); },
    arc(x: number, y: number, r: number) { pt(x, y, r); },
  };
  return { ctx: ctx as unknown as TileCtx, b };
}

/** His drawing's extent in his box's own px (the box's left at 0). */
function inBox(size: number, draw: (g: TileCtx) => void) {
  const { ctx, b } = extent();
  const st = stageOf(size);
  ctx.save(); ctx.translate(-st.boxX, 0); draw(ctx); ctx.restore();
  return b;
}

const make = (avatar: string, size = 32, id = `user-${avatar}`, salt = 0) => {
  const seed = seedOf(id, salt);
  const bot = personTile({ seed, color: "#5B7DB1", size, avatar: L.avatar("custom", avatar) });
  const st = stageOf(size);
  return { bot, st, seed, idle: new PersonIdle(bot, st.w / 2, seed, idleOptions(size)) };
};

test("the node's props: a size in range (32 by default), a colour that is one, live unless false, a label or none", () => {
  const d = readPersonBot({});
  assert.deepStrictEqual(d, { seed: "", avatar: "", color: PERSON.ink, size: 32, live: true, label: "" });
  const p = readPersonBot({ seed: "u1", avatar: "pip", color: "#B5654A", size: 28.4, live: false, label: "Mom" });
  assert.deepStrictEqual(p, { seed: "u1", avatar: "pip", color: "#B5654A", size: 28, live: false, label: "Mom" });
  assert.strictEqual(readPersonBot({ size: 4 }).size, PERSON.minSize);
  assert.strictEqual(readPersonBot({ size: 4000 }).size, PERSON.maxSize);
  assert.strictEqual(readPersonBot({ size: "big" }).size, 32);
  assert.strictEqual(readPersonBot({ color: "red" }).color, PERSON.ink, "not a #rrggbb: ink");
  assert.strictEqual(readPersonBot({ color: "url(x)" }).color, PERSON.ink);
  assert.strictEqual(readPersonBot({ color: "#abc" }).color, "#abc");
  assert.strictEqual(readPersonBot({ live: 0 }).live, true, "only false stills him");
  assert.strictEqual(readPersonBot(null).size, 32);
});

test("the same id is the same seed everywhere; a second of the same person on screen is another; never 0", () => {
  assert.strictEqual(seedOf("user-1"), seedOf("user-1"));
  assert.notStrictEqual(seedOf("user-1"), seedOf("user-2"));
  assert.notStrictEqual(seedOf("user-1", 0), seedOf("user-1", 1));
  assert.notStrictEqual(seedOf("user-1", 1), seedOf("user-1", 2));
  assert.ok(seedOf("") > 0);
  assert.strictEqual(freeSalt(new Set()), 0);
  assert.strictEqual(freeSalt(new Set([0, 1, 3])), 2, "the lowest free one");
});

test("every look stands inside his box, in the middle, his feet on its floor (12 to 96 px boxes)", () => {
  for (const size of [12, 20, 28, 32, 48, 96]) {
    for (const a of PEOPLE) {
      const { bot, st } = make(a, size);
      const b = inBox(size, (g) => bot.draw(g));
      assert.ok(b.y0 >= 0, `${a} @${size}: his top ${b.y0.toFixed(2)} inside the box`);
      assert.ok(b.x0 >= 0 && b.x1 <= size, `${a} @${size}: inside the box across (${b.x0.toFixed(2)}..${b.x1.toFixed(2)})`);
      assert.ok(Math.abs(b.y1 - size) <= Math.max(0.6, size * 0.02), `${a} @${size}: his feet on the floor (${b.y1.toFixed(2)})`);
      const mid = (b.x0 + b.x1) / 2;
      assert.ok(Math.abs(mid - size / 2) <= size * 0.08, `${a} @${size}: in the middle (${mid.toFixed(2)})`);
      assert.ok(Math.abs(bot.crown().x - st.w / 2) < 1e-6, "his head over the middle of his world");
      assert.ok(bot.still, "made still: nothing steps until he is let live");
    }
  }
});

test("his idle is a recipe the engine plays: it compiles clean and loops", () => {
  const C = compileLooks(PERSON_IDLE);
  assert.deepStrictEqual(C.errors, []);
  const m = personIdle();
  assert.ok(m && m.ok, "playable");
  assert.ok(m!.loop, "a loop");
  for (const id of PERSON.gestures) assert.ok(L.moment(id), `the catalog plays ${id}`);
});

test("alive for five minutes with his gestures, every look stays in his box and on his spot", () => {
  for (const a of PEOPLE) {
    const { bot, st, idle } = make(a, 32);
    // Gestures every few seconds here (rare in the app), so five minutes hold many.
    idle.o = { ...idle.o, every: [3, 5], first: [1, 2] };
    const gate = new GestureGate(0);
    idle.start();
    let top = Infinity, x0 = Infinity, x1 = -Infinity, far = 0, gestures = 0, was = "";
    for (let f = 0; f < 60 * 300; f++) {
      idle.frame(1 / 60, f / 60, GESTURES, gate);
      const id = bot.momentId();
      if (id && id !== "person.idle" && id !== was) gestures++;
      was = id;
      if (f % 4) continue;
      const b = inBox(32, (g) => bot.draw(g));
      top = Math.min(top, b.y0); x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1);
      far = Math.max(far, Math.abs(bot.crown().x - st.w / 2));
    }
    assert.ok(bot.finite(), `${a}: finite`);
    assert.ok(gestures >= 40, `${a}: he gestured (${gestures})`);
    assert.ok(top >= 0 && x0 >= -0.5 && x1 <= 32.5, `${a}: inside his box (top ${top.toFixed(1)}, ${x0.toFixed(1)}..${x1.toFixed(1)})`);
    assert.ok(far < 32 * 0.2, `${a}: never far off his spot (${far.toFixed(2)} px)`);
  }
});

test("idling, he only sways a little: his head within a couple of px, his feet where they were", () => {
  const { bot, st, idle } = make("blip", 32);
  idle.o = { ...idle.o, every: [1e9, 1e9], first: [1e9, 1e9] };
  idle.start();
  let head = 0, moved = false;
  const x0 = bot.crown().x;
  for (let f = 0; f < 60 * 60; f++) {
    idle.frame(1 / 60, f / 60, GESTURES, new GestureGate(0));
    head = Math.max(head, Math.abs(bot.crown().x - st.w / 2));
    if (Math.abs(bot.crown().x - x0) > 0.2) moved = true;
  }
  assert.ok(moved, "he does move");
  assert.ok(head < 2.5, `a small sway (${head.toFixed(2)} px)`);
  assert.strictEqual(bot.momentId(), "person.idle");
});

test("pushed off his spot, after his next gesture he walks back to it", () => {
  const { bot, st, idle } = make("pip", 32);
  idle.o = { ...idle.o, every: [2, 2], first: [1, 1], start: [0, 0] };
  idle.start();
  standIn(bot, st.w / 2 + 6);
  assert.ok(Math.abs(bot.crown().x - st.w / 2) > 5);
  let walked = false;
  for (let f = 0; f < 60 * 12; f++) {
    idle.frame(1 / 60, f / 60, GESTURES, new GestureGate(0));
    if (bot.walking()) walked = true;
  }
  assert.ok(walked, "he walked");
  assert.ok(Math.abs(bot.crown().x - st.w / 2) <= idle.o.drift + 1, `back on his spot (${(bot.crown().x - st.w / 2).toFixed(2)} px off)`);
});

test("side by side, no two sway, blink or gesture in step; the gate keeps gestures apart", () => {
  const N = 6;
  const gate = new GestureGate(PERSON.gap);
  // The same person twice among them (one id, two salts), as on the spaces list.
  const bots = Array.from({ length: N }, (_, i) => make(PEOPLE[i % PEOPLE.length]!, 32, i === N - 1 ? "user-0" : `user-${i}`, i === N - 1 ? 1 : 0));
  for (const b of bots) { b.idle.o = { ...b.idle.o, every: [4, 8], first: [1, 6] }; b.idle.start(); }
  const heads: number[][] = bots.map(() => []);
  const starts: number[] = [];
  const lids: number[][] = bots.map(() => []);
  const was = bots.map(() => "");
  for (let f = 0; f < 60 * 120; f++) {
    const now = f / 60;
    bots.forEach((b, i) => {
      b.idle.frame(1 / 60, now, GESTURES, gate);
      const id = b.bot.momentId();
      if (id && id !== "person.idle" && id !== was[i]) starts.push(now);
      was[i] = id;
      if (f % 2 === 0) { heads[i]!.push(b.bot.crown().x); lids[i]!.push(b.bot.lid > 0.8 ? 1 : 0); }
    });
  }
  starts.sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= PERSON.gap - 1e-9, "never two gestures within the gap");
  assert.ok(starts.length >= 10, `they gestured (${starts.length})`);
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let ab = 0, aa = 0, bb = 0;
    for (let k = 0; k < a.length; k++) { ab += (a[k]! - ma) * (b[k]! - mb); aa += (a[k]! - ma) ** 2; bb += (b[k]! - mb) ** 2; }
    return ab / Math.sqrt(aa * bb || 1);
  };
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    assert.ok(corr(heads[i]!, heads[j]!) < 0.9, `bots ${i} and ${j} do not sway in step`);
    assert.notDeepStrictEqual(lids[i], lids[j], `bots ${i} and ${j} do not blink in step`);
  }
});

test("still (Reduce Motion, or live false) is his resting pose on his spot, and nothing moves", () => {
  const { bot, st, idle } = make("dapper", 32);
  idle.start();
  for (let f = 0; f < 60 * 5; f++) idle.frame(1 / 60, f / 60, GESTURES, new GestureGate(0));
  idle.stop();
  assert.ok(bot.still);
  assert.ok(Math.abs(bot.crown().x - st.w / 2) < 1e-6, "on his spot");
  const before = inBox(32, (g) => bot.draw(g));
  for (let f = 0; f < 60; f++) idle.frame(1 / 60, f / 60, GESTURES, new GestureGate(0));
  assert.deepStrictEqual(inBox(32, (g) => bot.draw(g)), before, "a still bot never steps");
});

test("the gate: one gesture per gap, whoever asks", () => {
  const g = new GestureGate(2.5);
  assert.strictEqual(g.take(10), true);
  assert.strictEqual(g.take(11), false);
  assert.strictEqual(g.take(12.4), false);
  assert.strictEqual(g.take(12.5), true);
});

/** A frame clock by hand: raf queues, run() fires the queue at a time. */
function clock() {
  let q: Array<() => void> = [];
  let t = 0, asked = 0;
  const io = {
    raf: (cb: () => void) => { asked++; q.push(cb); return cb; },
    caf: (h: unknown) => { q = q.filter((c) => c !== h); },
    now: () => t,
  };
  return {
    io,
    pending: () => q.length,
    asked: () => asked,
    /** Advance to `ms` and fire what was queued. */
    at(ms: number) { t = ms; const run = q; q = []; run.forEach((c) => c()); },
  };
}

test("the one loop: only bots on screen step, at most fps a second, only while the app is in front", () => {
  const c = clock();
  const loop = new SharedLoop(c.io, 30);
  const steps = { a: [] as number[], b: [] as number[] };
  const a: LoopMember = { frame: (dt) => { steps.a.push(dt); } };
  const b: LoopMember = { frame: (dt) => { steps.b.push(dt); } };
  assert.strictEqual(loop.running(), false, "nobody: no loop");
  loop.add(a);
  loop.add(b, false);
  assert.strictEqual(c.pending(), 1, "one loop for all of them");
  // A 60 Hz display: a frame every 16.7 ms, every other one drawn.
  for (let k = 1; k <= 10; k++) c.at((k * 1000) / 60);
  assert.strictEqual(steps.a.length, 5, `30 a second (${steps.a.length} in 10 frames)`);
  assert.strictEqual(steps.b.length, 0, "off screen: paused");
  assert.ok(steps.a.slice(1).every((dt) => dt > 0.025 && dt < 0.04), "each step the time since the last drawn frame");
  loop.setSeen(b, true);
  c.at(220);
  assert.strictEqual(steps.b.length, 1, "on screen again: steps");
  loop.setSeen(a, false);
  loop.setSeen(b, false);
  assert.strictEqual(loop.running(), false, "none on screen: the loop stops");
  assert.strictEqual(c.pending(), 0);
  loop.setSeen(a, true);
  loop.setActive(false);
  assert.strictEqual(loop.running(), false, "in the background: no loop");
  const n = steps.a.length;
  c.at(400);
  assert.strictEqual(steps.a.length, n);
  loop.setActive(true);
  c.at(420);
  assert.strictEqual(steps.a.length, n + 1);
  assert.strictEqual(steps.a[n], 1 / 60, "after a pause the first step is one frame, never the time away");
  loop.remove(a);
  loop.remove(b);
  assert.strictEqual(loop.running(), false);
});

test("the one loop: a bot whose frames keep failing leaves it, and the others carry on", () => {
  const c = clock();
  const loop = new SharedLoop(c.io, 0);
  let good = 0;
  const dropped: LoopMember[] = [];
  loop.onDrop = (m) => dropped.push(m);
  const bad: LoopMember = { frame: () => { throw new Error("broken"); } };
  loop.add(bad);
  loop.add({ frame: () => { good++; } });
  for (let ms = 16; ms <= 16 * 6; ms += 16) c.at(ms);
  assert.deepStrictEqual(dropped, [bad]);
  assert.strictEqual(loop.members.has(bad), false);
  assert.strictEqual(good, 6);
  assert.strictEqual(loop.running(), true);
});
