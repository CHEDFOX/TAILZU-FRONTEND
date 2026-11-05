// node --test
//
// The living tiles' core (core.ts): the same seed gives the same frames; long runs stay finite, inside their tile
// and calm; a look target turns the head; Reduce Motion is still; a frame draws in a bounded number of calls; and the
// window's generated copy (TAILZU-DESKTOP/botTiles.js) is this file, unchanged. A bot on a stage of his own (BotStage):
// walking to a spot, out and back in, roaming, listening, his crown; his thought's trail and the resting box following
// him; a crowd of tiny bots drawn in bounded calls.
import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import {
  BotTile, BotTilesWorld, CARRY, FOLLOW, Fabric, LiveMark, Roam, STEP, TRAIL, checkExpression, compileLooks, compileWith, followStep, gridWorld, rng,
  thoughtTrail, trailRoom, writeOnTimes, type BotKind, type BotMood, type BuddyAct, type FollowState, type TileCtx,
} from "./core.ts";
import { STARTER } from "./starter.ts";
// @ts-expect-error a plain .mjs script, no types
import { DEFAULT_OUT, SOURCE, hashesOf, sha } from "./genDesktop.mjs";

const KINDS: BotKind[] = ["code", "keybot", "plan", "travel", "notes", "make", "custom"];
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

test("a strip under the grid (Notes): a tile of its own size in the same world; its tap and a tile's tap are one moment", () => {
  // The phone's grid, 2 x 2 at 169 x 132, and under it the strip: its stage 150 wide, the strip 100 tall.
  const w = new BotTilesWorld();
  const kinds: BotKind[] = ["code", "keybot", "plan", "make", "notes"];
  kinds.forEach((k, i) => w.add(new BotTile({ kind: k, color: "#6E4A6B", mood: "idle", seed: 21 + i })));
  kinds.slice(0, 4).forEach((_k, i) => w.place(i, (i % 2) * 181, Math.floor(i / 2) * 144, 169, 130, 72));
  w.place(4, 0, 288, 150, 98, 98 - 16 * 0.7);
  for (let f = 0; f < 240; f++) w.step(1 / 60);
  const strip = w.tiles[4]!;
  assert.ok(strip.finite() && strip.inside(), "the strip's bot stays on its stage");
  assert.ok(strip.y[3]! > 98 - 16 * 0.7 - strip.S * 0.2, "standing near its foot");
  // Tap the strip: every grid bot looks down at it.
  w.focus(4, 60, 50);
  for (let f = 0; f < 40; f++) w.step(1 / 60);
  for (const i of [0, 1, 2]) {
    const t = w.tiles[i]!;
    assert.ok(t.focusY > t.y[0]! + 100, `tile ${i} looks down at the strip`);
    assert.ok(t.eu < 0, `tile ${i}: eyes down (${t.eu.toFixed(2)})`);
  }
  w.release();
  // Tap a grid tile: the strip's bot looks up at it.
  w.focus(1, 80, 60);
  for (let f = 0; f < 40; f++) w.step(1 / 60);
  assert.ok(strip.focusY < 0, "the strip's bot looks up at the tile");
  assert.ok(strip.gaze().face > 0.5, "and turns toward it (it is up and to the right)");
  w.release();
  for (let f = 0; f < 600; f++) w.step(1 / 60);
  assert.ok(w.tiles.every((t) => t.finite() && t.inside()));
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

test("back to Home: a look left from a tap is let go at once, and every bot is at its own play again", () => {
  // The tiles live on across screens (kept by slug); the tap's own letting-go went with the Home that was left.
  const lives = KINDS.slice(0, 4).map((k, i) => tile(k, "idle", 10 + i));
  const before = gridWorld(lives);
  lives.forEach((t, i) => before.place(i, (i % 2) * 180, Math.floor(i / 2) * 144, 169, 132, 72));
  before.focus(0, 80, 60);
  for (let f = 0; f < 30; f++) before.step(1 / 60);
  assert.ok(lives.slice(1).every((t) => t.focusX === t.focusX), "the others look at the tapped tile");
  // Home is painted again: a new grid's world over the same bots.
  const again = gridWorld(lives);
  assert.strictEqual(again.focused, -1);
  for (const t of lives) assert.ok(t.focusX !== t.focusX && t.focusGoal !== t.focusGoal, `${t.kind} let go`);
  lives.forEach((t, i) => again.place(i, (i % 2) * 180, Math.floor(i / 2) * 144, 169, 132, 72));
  for (let f = 0; f < 240; f++) again.step(1 / 60);
  for (const t of lives) assert.ok(t.finite() && t.inside() && t.focusX !== t.focusX, t.kind);
});

test("the Notes bot picks up his pad, writes line after line, and tears off a full page that flutters to the floor", () => {
  const t = tile("notes", "working", 7);
  let held = false, wrote = 0, torn = 0, pageLow = false, penOnPad = false;
  for (let f = 0; f < 60 * 40; f++) {
    t.step(1 / 60);
    if (t.held === 0) held = true;
    wrote = Math.max(wrote, t.pa[0]!);
    torn = Math.max(torn, t.ptime[0]!);
    for (let i = 0; i < t.slife.length; i++) if (t.shome[i] === 2 && t.slife[i]! > 0 && t.sy[i]! >= t.floor - t.S * 0.04) pageLow = true;
    if (t.penX === t.penX) {
      const a = t.p0[0]!, xs = [t.x[a]!, t.x[a + 1]!, t.x[a + 2]!, t.x[a + 3]!];
      if (t.penX >= Math.min(...xs) - 0.5 && t.penX <= Math.max(...xs) + 0.5) penOnPad = true;
    }
    if (f % 30 === 0) assert.ok(t.finite() && t.inside(), `frame ${f}`);
  }
  assert.ok(held, "he picks the pad up");
  assert.ok(wrote >= 2, `lines written (${wrote.toFixed(2)})`);
  assert.ok(penOnPad, "his pencil writes on the pad");
  assert.ok(torn >= 1, "a full page is torn off");
  assert.ok(pageLow, "and it lands on the floor");
  const c = counter();
  t.draw(c);
  assert.ok(c.calls > 20, "the pad and its lines are drawn");
});

const ACTS: BuddyAct[] = ["play", "wave", "survey", "read", "settle", "think", "carry"];

/** A page's buddy: a header's small stage, or a setup step's. */
function buddy(kind: BotKind, act: BuddyAct, mood: BotMood = "idle", w = 104, h = 48, size = 30): BotTile {
  const t = new BotTile({ kind, color: "#4F7A3A", mood, seed: 3, size });
  t.resize(w, h, h - 2);
  t.setAct(act);
  return t;
}

test("a bot on his own page: every kind, every moment, every mood, on a header's stage and a setup step's: finite and inside", () => {
  for (const [w, h, size] of [[104, 48, 30], [150, 56, 34], [350, 128, 52]] as const) {
    for (const kind of KINDS) for (const act of ACTS) for (const mood of MOODS) {
      const t = buddy(kind, act, mood, w, h, size);
      t.setLookTo("down");
      for (let f = 0; f < 1800; f++) t.step(1 / 60);
      assert.ok(t.finite(), `${kind}/${act}/${mood} ${w}x${h}`);
      assert.ok(t.inside(), `${kind}/${act}/${mood} ${w}x${h}`);
    }
  }
});

test("the moments read as themselves: reading draws lines in, thinking a hand to the chin, survey looks down, settle sits", () => {
  const read = buddy("code", "read", "idle", 350, 128, 52);
  let homeward = 0, lit = 0;
  for (let f = 0; f < 600; f++) { read.step(1 / 60); homeward = Math.max(homeward, read.shome.reduce((a, v, i) => a + (v && read.slife[i]! > 0 ? 1 : 0), 0)); lit = Math.max(lit, read.glow); }
  assert.ok(homeward >= 4, `dots flowing in (${homeward})`);
  assert.ok(lit > 0.02, "they light his antenna as they arrive");

  const think = buddy("custom", "think", "needs");
  for (let f = 0; f < 240; f++) think.step(1 / 60);
  const hand = Math.min(Math.hypot(think.x[6]! - think.x[0]!, think.y[6]! - think.y[0]!), Math.hypot(think.x[8]! - think.x[0]!, think.y[8]! - think.y[0]!));
  assert.ok(hand < think.S * 0.45, "thinking wins over needs: a hand at his chin");
  assert.ok(think.eu > 0, "eyes up");

  const survey = buddy("code", "survey", "idle", 350, 128, 52);
  for (let f = 0; f < 240; f++) survey.step(1 / 60);
  assert.ok(survey.lookY > survey.floor, "looking down over the list");
  assert.ok(survey.eu < 0, "eyes down");

  const settle = buddy("plan", "settle");
  for (let f = 0; f < 240; f++) settle.step(1 / 60);
  assert.ok(settle.sit > 0.5 || settle.act === 3, "settled: sitting (or a stretch)");

  // Needs, on his page: he stops and faces the person.
  const needs = buddy("travel", "play", "needs");
  for (let f = 0; f < 240; f++) needs.step(1 / 60);
  assert.ok(Math.abs(needs.face) < 0.3, "facing out");
});

test("a glance at the ask field: with lookTo his eyes go to it now and then; Reduce Motion is a still pose", () => {
  const t = buddy("keybot", "play", "idle");
  t.setLookTo("down");
  let seen = 0;
  for (let f = 0; f < 3600; f++) { t.step(1 / 60); if (t.lookY > t.h) seen++; }
  assert.ok(seen > 60, `looked down at the field (${seen} frames)`);
  for (const act of ACTS) {
    const s = buddy("code", act);
    for (let f = 0; f < 60; f++) s.step(1 / 60);
    s.settle(true);
    const x = Array.from(s.x);
    for (let f = 0; f < 60; f++) s.step(1 / 60);
    assert.deepStrictEqual(Array.from(s.x), x, act);
  }
});

/** A chat's lane: the width of a phone's column, a little taller than the bot. */
function lane(kind: BotKind = "code", w = 358, h = 68, size = 44): BotTile {
  const t = new BotTile({ kind, color: "#4F7A3A", mood: "idle", seed: 9, size });
  t.cloth = 0;
  t.resize(w, h, h - 2);
  t.setAct("carry");
  return t;
}

test("carrying: in from the right, slowly across, out at the left; again, the bag heavier each trip up to the cap", () => {
  const t = lane();
  const bag = t.p0[0]!;
  const trips: Array<{ trip: number; load: number; r: number; m: number; enteredRight: boolean; leftAt: number; lean: number; vx: number }> = [];
  let cur: (typeof trips)[number] | null = null, n = 0, vsum = 0, lsum = 0;
  for (let f = 0; f < 60 * 110; f++) {
    t.step(1 / 60);
    if (f % 30 === 0) assert.ok(t.finite() && t.inside(), `frame ${f}`);
    if (t.phase === 1 && (!cur || cur.trip !== t.trip)) {
      if (cur) { cur.vx = vsum / Math.max(1, n); cur.lean = lsum / Math.max(1, n); }
      cur = { trip: t.trip, load: t.load, r: t.pr[0]!, m: 1 / t.im[bag + 1]!, enteredRight: t.x[2]! > t.w, leftAt: 0, lean: 0, vx: 0 };
      trips.push(cur); n = 0; vsum = 0; lsum = 0;
    }
    if (cur && t.phase === 1 && t.x[2]! > t.w * 0.2 && t.x[2]! < t.w * 0.8) {
      n++; vsum += t.vx(2); lsum += t.x[1]! - t.x[2]!;
      assert.strictEqual(t.held, 0, "the bag is in his hand all the way across");
    }
  }
  assert.ok(trips.length >= 7, `trips: ${trips.length}`);
  for (const tr of trips) assert.ok(tr.enteredRight, `trip ${tr.trip} comes in from the right`);
  for (let i = 1; i < trips.length; i++) {
    const a = trips[i - 1]!, b = trips[i]!;
    if (i < CARRY.trips) {
      assert.ok(b.load > a.load && b.r > a.r && b.m > a.m, `trip ${i}: heavier and bigger (${a.load} -> ${b.load})`);
    } else {
      assert.strictEqual(b.load, 1, "capped: the heaviest look from then on");
      assert.strictEqual(b.r, a.r);
    }
  }
  const first = trips[0]!, heavy = trips[CARRY.trips]!;
  assert.ok(first.vx < 0 && heavy.vx < 0, "right to left");
  assert.ok(Math.abs(heavy.vx) < Math.abs(first.vx) * 0.8, `heavy is slower (${first.vx.toFixed(1)} vs ${heavy.vx.toFixed(1)} px/s)`);
  assert.ok(Math.abs(first.vx) < t.S * 3, "and even light, a slow walk");
  assert.ok(heavy.lean < first.lean - t.S * 0.04, "he leans into it more, heavy");
});

test("the answer is here: on stage he sets the bag down and walks off light; off stage he is simply gone; carry again starts light", () => {
  const t = lane();
  // Into the second trip, half way across.
  while (!(t.trip === 1 && t.phase === 1 && t.x[2]! < t.w * 0.5)) t.step(1 / 60);
  t.deliver();
  assert.strictEqual(t.phase, 2, "setting it down");
  let let_go = -1, down = false, x0 = t.x[2]!;
  const b = t.p0[0]! + 1;
  for (let f = 0; f < 60 * 8 && !t.carryDone(); f++) {
    t.step(1 / 60);
    if (let_go < 0 && t.held < 0) { let_go = f; down = t.y[b]! + t.rad[b]! >= t.floor - 1.5; }
    assert.ok(t.finite() && t.inside());
  }
  assert.ok(let_go >= 0 && down, "he lets go of it on the floor");
  assert.ok(t.carryDone(), "and leaves");
  assert.ok(t.x[2]! < 0 && t.x[2]! < x0, "off at the left");
  assert.strictEqual(t.bagFade, 0, "the bag gave its place to the answer");

  // Off stage when it comes: gone at once.
  const off = lane();
  for (let f = 0; f < 30; f++) off.step(1 / 60);
  assert.strictEqual(off.phase, 0, "still off stage, packing");
  off.deliver();
  assert.ok(off.carryDone(), "gone, nothing to see");

  // A new ask: carrying again, from the first light bag.
  t.setAct("carry");
  assert.ok(!t.carryDone() && t.trip === 0 && t.load === 0 && t.held === 0, "a new haul");
  for (let f = 0; f < 60 * 4; f++) t.step(1 / 60);
  assert.ok(t.x[2]! < t.w + t.S, "walking in again");
  // deliver() means nothing to any other act.
  const other = buddy("code", "think");
  other.deliver();
  assert.ok(!other.carryDone() && !other.delivered);
});

test("carrying, Reduce Motion: a still bot with the bag in his hand; the stage holds only the bag, and his toys come back after", () => {
  const t = lane("plan");
  assert.strictEqual(t.np, 1, "only the bag on the stage");
  for (let f = 0; f < 200; f++) t.step(1 / 60);
  t.settle(true);
  const x = Array.from(t.x);
  for (let f = 0; f < 60; f++) t.step(1 / 60);
  assert.deepStrictEqual(Array.from(t.x), x, "still");
  assert.strictEqual(t.held, 0, "holding it");
  assert.ok(t.x[2]! > 0 && t.x[2]! < t.w, "on the stage");
  const c = counter();
  t.draw(c);
  assert.ok(c.calls > 30 && c.calls < 720, `drawn (${c.calls})`);
  t.settle(false);
  t.setAct("play");
  assert.strictEqual(t.np, 4, "his day tiles are back");
  for (let f = 0; f < 600; f++) t.step(1 / 60);
  assert.ok(t.finite() && t.inside());
});

test("carrying is the same everywhere: same seed, same frames; a desk-wide lane too", () => {
  const a = lane("custom", 640, 70, 46), b = lane("custom", 640, 70, 46);
  for (let f = 0; f < 60 * 40; f++) { a.step(1 / 60); b.step(1 / 60); }
  assert.deepStrictEqual(Array.from(a.x), Array.from(b.x));
  assert.ok(a.trip >= 1 && a.finite() && a.inside());
});

test("the living mark: springs that settle home, eyes on the finger, a scroll swings it, lit dots, a squish that springs back", () => {
  const m = new LiveMark(4);
  m.size = 44;
  m.setLit(["#4F7A3A", "#A9573A"]);
  assert.strictEqual(m.lit.filter(Boolean).length, 2);
  m.look(200, 15); // a finger far to the right
  for (let f = 0; f < 120; f++) m.step(1 / 60);
  assert.ok(m.x[8]! > 13.8 && m.x[9]! > 21.8, "both eyes to the right");
  m.lookAway();
  m.nudge(2400);
  m.press();
  let swung = 0, squished = 0;
  for (let f = 0; f < 600; f++) { m.step(1 / 60); swung = Math.max(swung, Math.abs(m.y[8]! - 15)); squished = Math.max(squished, m.squish); }
  assert.ok(swung > 0.6, `a scroll swings the eyes (${swung})`);
  assert.ok(squished > 0.1, "a press squishes it");
  assert.ok(m.finite() && Math.abs(m.squish) < 0.02, "and it springs back");
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(m.x[i]! - [17, 26, 30, 27, 17, 7, 4, 8][i]!) < 1, "ring dots near home");
  const c = counter();
  m.draw(c);
  assert.ok(c.calls > 10 && c.calls < 80, `drawn in a few calls (${c.calls})`);
  m.settle(true);
  const x = Array.from(m.x);
  for (let f = 0; f < 60; f++) m.step(1 / 60);
  assert.deepStrictEqual(Array.from(m.x), x, "Reduce Motion: still");
});

test("a line writes itself at dictation's pace: in order, uneven, a breath after a full stop; same seed, same timing", () => {
  const words = "Still up? I’m here, and I’ll keep it quiet.".split(" ");
  const t = writeOnTimes(words, 9);
  assert.strictEqual(t.length, words.length);
  for (let i = 1; i < t.length; i++) assert.ok(t[i]! > t[i - 1]!, "in order");
  const gaps = t.slice(1).map((v, i) => v - t[i]!);
  assert.ok(new Set(gaps).size > 3, "uneven");
  assert.ok(gaps[1]! > gaps[2]!, "a breath after 'up?'");
  assert.ok(t[t.length - 1]! < 4000, "done in a few seconds");
  assert.deepStrictEqual(writeOnTimes(words, 9), t);
});

test("the window's botTiles.js is generated from this core, unchanged", { skip: !existsSync(DEFAULT_OUT) && "TAILZU-DESKTOP is not beside this repo" }, () => {
  const out = readFileSync(DEFAULT_OUT, "utf8");
  const h = hashesOf(out);
  assert.strictEqual(h.src, sha(readFileSync(SOURCE, "utf8")), "core.ts changed: run `node src/botTiles/genDesktop.mjs` and commit TAILZU-DESKTOP/botTiles.js");
  assert.strictEqual(h.actualBody, h.body, "TAILZU-DESKTOP/botTiles.js was edited by hand: regenerate it");
});

test("the motion language over a caller's own names (the desktop's Blip catalog): t and v, nothing else", () => {
  const f = compileWith("sin(t*2) + v*0.5", ["t", "v"]);
  assert.ok(Math.abs(f(Float64Array.from([0.25, 1])) - (Math.sin(0.5) + 0.5)) < 1e-12);
  assert.strictEqual(compileWith("2*3", ["t"])(new Float64Array(1)), 6);
  assert.throws(() => compileWith("beat + 1", ["t", "v"]), /unknown name beat/);
  assert.strictEqual(checkExpression("beat + 1"), "", "a moment's names stay a moment's");
  assert.match(checkExpression("t + w", ["t"]), /unknown name w/);
});

// ===================================================================== a bot on a stage of his own

const LOOKS = compileLooks(STARTER);
const ROAM = { moments: ["dance", "shrug", "juggle", "hiccup", "highfive", "celebrate", "sneeze"], every: [2.4, 3.8] as [number, number], pause: [0.3, 0.9] as [number, number], span: [0.1, 0.9] as [number, number] };

/** The person's own bot on a stage: ink, no toys, no cloth, his size fixed. */
function stageBot(seed = 7, w = 360, h = 132, size = 30): BotTile {
  const t = new BotTile({ kind: "custom", color: "#0a0a0a", mood: "idle", seed, size, toys: false });
  t.cloth = 0;
  t.setAvatar(LOOKS.avatar("custom"));
  t.resize(w, h, h - 2);
  return t;
}

test("walkTo: he walks there on his own legs and stands; the same seed walks the same way", () => {
  const a = stageBot(7), b = stageBot(7);
  a.walkTo(300);
  b.walkTo(300);
  assert.ok(a.walking());
  let there = -1;
  for (let f = 0; f < 60 * 8; f++) {
    a.step(1 / 60); b.step(1 / 60);
    if (there < 0 && !a.walking()) there = f;
  }
  assert.ok(there > 0, "he gets there");
  assert.ok(Math.abs(a.x[2]! - 300) < a.S * 0.6, `standing near 300 (${a.x[2]!.toFixed(1)})`);
  assert.deepStrictEqual(Array.from(a.x), Array.from(b.x), "the same frames");
  assert.ok(a.finite() && a.inside());
  assert.strictEqual(a.np, 0, "no toys on his stage");
});

test("exit and enter: out past the edge and standing there, then back in to a spot; deterministic", () => {
  for (const side of ["left", "right"] as const) {
    const a = stageBot(9), b = stageBot(9);
    for (let f = 0; f < 60; f++) { a.step(1 / 60); b.step(1 / 60); }
    a.exit(side); b.exit(side);
    let out = false;
    for (let f = 0; f < 60 * 10 && !out; f++) { a.step(1 / 60); b.step(1 / 60); out = a.out(); }
    assert.ok(out, `out at the ${side}`);
    const hx = a.x[2]!;
    assert.ok(side === "left" ? hx < -a.S * 0.8 : hx > a.w + a.S * 0.8, `past the ${side} edge (${hx.toFixed(1)})`);
    assert.ok(!a.walking(), "standing out there");
    for (let f = 0; f < 120; f++) a.step(1 / 60);
    assert.ok(a.out() && Math.abs(a.x[2]! - hx) < a.S, "he stays out");
    for (let f = 0; f < 120; f++) b.step(1 / 60);
    a.enter(side, 180); b.enter(side, 180);
    assert.ok(!a.out() && a.walking());
    let at = NaN;
    for (let f = 0; f < 60 * 10; f++) { a.step(1 / 60); b.step(1 / 60); if (at !== at && !a.walking()) at = a.x[2]!; }
    assert.ok(!a.out() && !a.walking(), "in again");
    assert.ok(Math.abs(at - 180) < a.S * 0.5, `he stops at 180 (${at.toFixed(1)}), then his own life again`);
    assert.ok(a.finite() && a.inside());
    assert.deepStrictEqual(Array.from(a.x), Array.from(b.x), "the same frames");
  }
  // Drawn already gone (a screen whose state has him out): out at once, then in from there.
  const c = stageBot(3);
  c.exit("right", { now: true });
  assert.ok(c.out() && c.x[2]! > c.w);
  c.enter("right", 100);
  let at = NaN;
  for (let f = 0; f < 60 * 10; f++) { c.step(1 / 60); if (at !== at && !c.walking()) at = c.x[2]!; }
  assert.ok(!c.out() && Math.abs(at - 100) < c.S * 0.5);
});

test("Roam: walks to spots in his span and plays moments; the same seed, the same roam; it waits while he listens, thinks or is out", () => {
  const run = (seed: number) => {
    const t = stageBot(5);
    const r = new Roam(t, LOOKS, ROAM, t.w, seed);
    const played = new Set<string>();
    let lo = 1e9, hi = -1e9;
    for (let f = 0; f < 60 * 40; f++) {
      t.step(1 / 60);
      r.step(1 / 60);
      if (t.mo) played.add(t.mo.id);
      lo = Math.min(lo, t.x[2]!); hi = Math.max(hi, t.x[2]!);
      if (f % 60 === 0) assert.ok(t.finite() && t.inside(), `frame ${f}`);
    }
    return { t, played, lo, hi };
  };
  const a = run(11), b = run(11);
  assert.deepStrictEqual(Array.from(a.t.x), Array.from(b.t.x), "deterministic");
  assert.ok(a.played.size >= 3, `moments played: ${[...a.played].join(", ")}`);
  assert.ok(a.hi - a.lo > a.t.w * 0.3, `he walks about (${a.lo.toFixed(0)}..${a.hi.toFixed(0)})`);
  assert.ok(a.lo > a.t.w * 0.1 - a.t.S && a.hi < a.t.w * 0.9 + a.t.S, "inside his span");
  const c = run(12);
  assert.notDeepStrictEqual(Array.from(a.t.x), Array.from(c.t.x), "another seed, another roam");
  // listening: Roam leaves him be
  const t = stageBot(5), r = new Roam(t, LOOKS, ROAM, t.w, 4);
  for (let f = 0; f < 60 * 3; f++) { t.step(1 / 60); r.step(1 / 60); }
  t.setAct("listen");
  const x0 = t.x[2]!;
  for (let f = 0; f < 60 * 8; f++) { t.step(1 / 60); r.step(1 / 60); assert.ok(!t.mo && !t.walking(), "no moment, no walk while he listens"); }
  assert.ok(Math.abs(t.x[2]! - x0) < t.S * 0.6, "he stands where he is");
  t.setAct("play");
  r.pause(true);
  for (let f = 0; f < 60 * 8; f++) { t.step(1 / 60); r.step(1 / 60); assert.ok(!t.walking() && !t.mo, "paused: nothing"); }
});

test("listening: still, eyes wide open, his head toward his thought, the antenna lit with the voice; standing: still", () => {
  const t = stageBot(6);
  for (let f = 0; f < 60; f++) t.step(1 / 60);
  t.setAct("listen");
  const g0 = t.gaze();
  t.lookAt(g0.headX + 80, g0.headY - 60);
  let glow = 0, lid = 1;
  const r = rng(3);
  for (let f = 0; f < 60 * 6; f++) {
    t.setLevel(r());
    t.step(1 / 60);
    glow = Math.max(glow, t.glow);
    if (f > 60) lid = Math.min(lid, t.lid);
    assert.ok(t.finite(), `frame ${f}`);
  }
  assert.ok(t.inside());
  assert.ok(t.lid < 0.2 && lid < 0.1, `eyes open (${t.lid.toFixed(2)})`);
  assert.ok(t.gaze().tilt > 0.05 && t.gaze().tilt < 0.4, `head toward it (${t.gaze().tilt.toFixed(2)})`);
  assert.ok(Math.abs(t.x[2]! - g0.headX) < t.S * 0.6, "no step toward it: he stays");
  assert.ok(glow > 0.3, `the antenna glows with the voice (${glow.toFixed(2)})`);
  t.setLevel(0);
  for (let f = 0; f < 120; f++) t.step(1 / 60);
  assert.ok(t.glow < 0.15, "and dims when it is quiet");
  t.setAct("stand");
  t.lookAway();
  const x = t.x[2]!;
  for (let f = 0; f < 60 * 5; f++) t.step(1 / 60);
  assert.ok(Math.abs(t.x[2]! - x) < t.S * 0.5 && t.finite() && t.inside(), "standing still");
  // every kind listens and stands, finite and inside
  for (const kind of KINDS) for (const act of ["listen", "stand"] as BuddyAct[]) {
    const b = buddy(kind, act, "idle", 150, 56, 34);
    for (let f = 0; f < 600; f++) { b.setLevel((f % 20) / 20); b.step(1 / 60); }
    assert.ok(b.finite() && b.inside(), `${kind}/${act}`);
  }
});

test("his crown: finite, over his head and inside the stage, with every look", () => {
  for (const av of [...LOOKS.avatars.keys()]) {
    const t = stageBot(8);
    t.setAvatar(LOOKS.avatar("custom", av));
    for (let f = 0; f < 240; f++) t.step(1 / 60);
    const c = t.crown(), g = t.gaze();
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), av);
    assert.ok(c.y < g.headY - t.rH * 0.5, `${av}: over his head`);
    assert.ok(c.y > 0 && c.x > 0 && c.x < t.w, `${av}: inside the stage (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
  }
});

test("a bot without toys: no props and never his kind's play; every kind stays finite and inside", () => {
  for (const kind of KINDS) {
    const t = new BotTile({ kind, color: "#4F7A3A", seed: 4, size: 22, toys: false });
    t.cloth = 0;
    t.resize(120, 90, 88);
    for (let f = 0; f < 60 * 60; f++) {
      t.step(1 / 60);
      if (kind !== "make") assert.ok(t.act !== 6, `${kind}: no play without toys`);
    }
    assert.strictEqual(t.np, 0, kind);
    assert.ok(t.finite() && t.inside(), kind);
  }
});

test("the trail: three bubbles 10/17/26 with 1.5/1.75/2 outlines, equal gaps, smallest at his head, meeting the box", () => {
  const crown = { x: 100, y: 200 }, box = { x: 40, y: 60, w: 240, h: 40 };
  const b = thoughtTrail(crown, box, 0, -1);
  assert.strictEqual(b.length, 3);
  assert.deepStrictEqual(b.map((x) => Math.round(x.r * 2 * 100) / 100), TRAIL.sizes, "full size with room");
  assert.deepStrictEqual(b.map((x) => x.stroke), TRAIL.strokes);
  assert.ok(b.every((x) => x.alpha === 1));
  assert.ok(b[0]!.y > b[1]!.y && b[1]!.y > b[2]!.y, "rising to the box");
  // equal gaps along the path: from just over his crown to the first, and between each (the bob is a px at most)
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  const g1 = d(b[0]!, b[1]!) - b[0]!.r - b[1]!.r, g2 = d(b[1]!, b[2]!) - b[1]!.r - b[2]!.r;
  const g0 = crown.y - TRAIL.lift - (b[0]!.y + b[0]!.r);
  assert.ok(Math.abs(g1 - g2) < 3.5 && Math.abs(g0 - g1) < 3.5, `gaps ${g0.toFixed(1)} ${g1.toFixed(1)} ${g2.toFixed(1)}`);
  assert.ok(b[2]!.y - b[2]!.r > box.y + box.h, "the last under the box, not on it");
  assert.ok(b[2]!.x >= box.x + TRAIL.anchorPad - 1 && b[2]!.x <= box.x + box.w - TRAIL.anchorPad + 1, "meets the box inside its corners");
  // the same frame, the same bubbles; time bobs them by a px or so
  assert.deepStrictEqual(thoughtTrail(crown, box, 0, -1), b);
  const later = thoughtTrail(crown, box, 1.3, -1);
  assert.ok(later.every((x, i) => Math.abs(x.y - b[i]!.y) <= 2 * TRAIL.bob + 1e-9 && Math.abs(x.x - b[i]!.x) <= TRAIL.bob + 1e-9));
  assert.ok(later.some((x, i) => x.y !== b[i]!.y), "and they bob");
});

test("the trail: short of room the bubbles shrink together, then fade; a box not over him hides them; they swell with the voice", () => {
  const crown = { x: 100, y: 200 };
  const full = thoughtTrail(crown, { x: 0, y: 60, w: 240, h: 40 }, 0, -1);
  const short = thoughtTrail(crown, { x: 0, y: 150, w: 240, h: 20 }, 0, -1);
  const k = short[0]!.r / full[0]!.r;
  assert.ok(k < 1 && k >= TRAIL.minScale - 1e-9, `scaled ${k.toFixed(2)}`);
  for (let i = 1; i < 3; i++) assert.ok(Math.abs(short[i]!.r / full[i]!.r - k) < 1e-9, "all together");
  const none = thoughtTrail(crown, { x: 0, y: 190, w: 240, h: 20 }, 0, -1);
  assert.ok(none.every((x) => x.alpha === 0), "no room: faded out");
  const below = thoughtTrail(crown, { x: 0, y: 260, w: 240, h: 40 }, 0, -1);
  assert.ok(below.every((x) => x.alpha === 0), "a box under him: none");
  const box = { x: 0, y: 40, w: 240, h: 40 };
  const loud = thoughtTrail(crown, box, 0, 1), quiet = thoughtTrail(crown, box, 0, 0), mid = thoughtTrail(crown, box, 0, 0.5);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(loud[i]!.r / mid[i]!.r - (1 + TRAIL.pulse)) < 1e-9, "swells with the voice");
    assert.ok(Math.abs(quiet[i]!.r / mid[i]!.r - (1 - TRAIL.pulse)) < 1e-9, "and shrinks when it is quiet");
  }
  // the room a resting stage plans for holds the whole trail at full size
  const room = trailRoom(1);
  const rest = thoughtTrail(crown, { x: 0, y: crown.y - room - 40, w: 240, h: 40 }, 0, -1);
  assert.ok(Math.abs(rest[2]!.r * 2 - 26) < 1e-6, `rest room ${room}`);
  assert.ok(room > 75 && room < 90);
});

test("followStep: the box stays put while his head sways inside the deadband, follows a walk a little behind, stops at the bounds", () => {
  const B = { lo: 60, hi: 300 };
  let s: FollowState = { x: NaN, v: 0, target: NaN };
  s = followStep(s, 150, 1 / 60, B);
  assert.strictEqual(s.x, 150, "starts over him");
  for (let f = 0; f < 30; f++) s = followStep(s, 150 + Math.sin(f / 3) * (FOLLOW.deadband - 1), 1 / 60, B);
  assert.ok(Math.abs(s.x - 150) < 2, `a sway inside the deadband barely moves it (${s.x.toFixed(2)})`);
  // a walk to the right at 120 px/s: it trails him
  let head = 150, lagged = false;
  for (let f = 0; f < 60; f++) { head += 2; s = followStep(s, head, 1 / 60, B); if (s.x < head - FOLLOW.deadband - 2) lagged = true; }
  assert.ok(lagged, "a little behind him at a walk");
  for (let f = 0; f < 300; f++) s = followStep(s, head, 1 / 60, B);
  assert.ok(Math.abs(s.x - head) < 1.5, `and over him once he stands (${(s.x - head).toFixed(2)})`);
  // past the bound: it stops there, no bounce
  for (let f = 0; f < 240; f++) { head = Math.min(400, head + 3); s = followStep(s, head, 1 / 60, B); assert.ok(s.x <= B.hi + 1e-9, "never past hi"); }
  assert.strictEqual(s.x, B.hi);
  assert.ok(s.v <= 0);
  // deterministic, pure
  const a = followStep({ x: 100, v: 3, target: 110 }, 200, 1 / 60, B), b = followStep({ x: 100, v: 3, target: 110 }, 200, 1 / 60, B);
  assert.deepStrictEqual(a, b);
});

test("a crowd: seven tiny bots on their own patches, no cloth, no toys: finite, inside, and drawn in bounded calls", () => {
  const kinds: BotKind[] = ["plan", "travel", "notes", "code", "keybot", "custom", "make"];
  const world = new BotTilesWorld();
  const W = 340, H = 340;
  kinds.forEach((k, i) => {
    const t = new BotTile({ kind: k, color: "#4F7A3A", seed: 20 + i, size: 22, toys: false });
    t.cloth = 0;
    world.add(t);
  });
  kinds.forEach((_k, i) => {
    const row = i % 2, cols = 4, col = Math.floor(i / 2);
    const pw = W / cols;
    world.place(i, col * pw + (row ? pw / 2 : 0) - (row && col === cols - 1 ? pw : 0), H * 0.45 + row * H * 0.25, pw, H * 0.3, H * 0.3 - 2);
  });
  world.surprise(["dance", "shrug", "juggle"].map((id) => LOOKS.moment(id)!).filter(Boolean), 2.6, 0.75, 7);
  const c = counter();
  let worst = 0;
  for (let f = 0; f < 60 * 30; f++) {
    world.step(1 / 60);
    if (f % 10 === 0) {
      c.calls = 0;
      for (const t of world.tiles) t.draw(c);
      worst = Math.max(worst, c.calls);
    }
    if (f % 60 === 0) for (const t of world.tiles) assert.ok(t.finite() && t.inside(), `${t.kind} at ${f}`);
  }
  assert.ok(worst < 7 * 420, `${worst} calls for seven`);
  assert.ok(world.tiles.every((t) => t.np === 0 && t.fabric.maxShift() === 0), "no toys, a still cloth");
});
