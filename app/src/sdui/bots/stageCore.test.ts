// node --test --experimental-strip-types src/sdui/bots/stageCore.test.ts
//
// The bot stage: the mode's order; the stage's least height with and without a resting box; the inline stage grown by its
// open box; the rest, listen, open (square and wide), low and full rects for a given screen; a tap against a double tap.
import test from "node:test";
import assert from "node:assert";
import { BotTile, compileLooks, trailRoom } from "../../botTiles/core.ts";
import {
  STAGE, fullRect, grownHeight, keyboardLift, listenRect, lowLayout, minStageHeight, pillBottom, pillBounds, pillRect, restHeight, squareRect,
  stageAct, stageMode, tapDue, tapInStage, tapOn, walksLow, wideRect, type Win,
} from "./stageCore.ts";

const PHONE: Win = { w: 390, h: 844, top: 47, bottom: 34 };

test("the mode: full, then open, then listening (with a thought), then rest", () => {
  const all = { thought: true, full: true, open: true, listen: true };
  assert.strictEqual(stageMode(all), "full");
  assert.strictEqual(stageMode({ ...all, full: false }), "open");
  assert.strictEqual(stageMode({ ...all, full: false, open: false }), "listen");
  assert.strictEqual(stageMode({ thought: true, full: false, open: false, listen: false }), "rest");
  assert.strictEqual(stageMode({ ...all, thought: false }), "rest", "no thought: always at rest");
});

test("what he does: thinking wins (a voice chat's turn going), then listening with a thought, then standing, then play", () => {
  const none = { thought: true, listening: false, thinking: false, standing: false };
  assert.strictEqual(stageAct({ ...none, listening: true, thinking: true }), "think", "a turn's words going: he thinks, the box still listens");
  assert.strictEqual(stageAct({ ...none, listening: true }), "listen");
  assert.strictEqual(stageAct({ ...none, listening: true, thought: false }), "play", "no thought: no listening pose");
  assert.strictEqual(stageAct({ ...none, standing: true }), "stand");
  assert.strictEqual(stageAct(none), "play");
});

test("a low thought walks him to the middle, except while he is out at a side", () => {
  const go = { low: true, still: false, placed: true, out: false as boolean | null };
  assert.strictEqual(walksLow(go), true);
  assert.strictEqual(walksLow({ ...go, out: null }), true, "never out yet");
  assert.strictEqual(walksLow({ ...go, out: true }), false, "out for Call Your People: he stays out");
  assert.strictEqual(walksLow({ ...go, still: true }), false);
  assert.strictEqual(walksLow({ ...go, low: false }), false);
});

test("the stage's least height: him and his room; with a resting box, the trail's room and the pill's too", () => {
  assert.strictEqual(minStageHeight(30, false), 48);
  const withBox = minStageHeight(26, true);
  assert.strictEqual(withBox, Math.ceil(26 + 18 + trailRoom(1) + 48));
  assert.ok(withBox > 130 && withBox <= 136, `about the feed's 136 (${withBox})`);
  assert.strictEqual(restHeight(112, 26, true), withBox, "a server's 112 is drawn at the least");
  assert.strictEqual(restHeight(184, 30, true), 184, "a taller one as it is");
  assert.strictEqual(restHeight(132, 30, false), 132);
});

test("no veil: the open stage is the rest height plus what the box grew over the pill", () => {
  const rest = restHeight(176, 26, true);
  assert.strictEqual(grownHeight(rest, 40), rest, "a box the pill's size: no growth");
  assert.strictEqual(grownHeight(rest, 160), rest + 160 - STAGE.pillH);
  assert.strictEqual(grownHeight(rest, 10), rest, "never smaller");
});

test("the resting pill: over him at the trail's room, inside the gutters; listening it widens in place and grows up", () => {
  const floor = 174, crownH = 30;
  const bottom = pillBottom(floor, crownH);
  assert.strictEqual(bottom, floor - crownH - trailRoom(1));
  const p = pillRect(200, 220, bottom, 390);
  assert.deepStrictEqual(p, { x: 90, y: bottom - 40, w: 220, h: 40 });
  assert.strictEqual(pillRect(20, 220, bottom, 390).x, STAGE.gutter, "kept in at the left");
  assert.strictEqual(pillRect(380, 220, bottom, 390).x, 390 - 16 - 220, "and at the right");
  assert.deepStrictEqual(pillBounds(390, 220), { lo: 126, hi: 264 });
  const l = listenRect(p, 390, 90);
  assert.strictEqual(l.w, STAGE.pillMax);
  assert.strictEqual(l.y + l.h, p.y + p.h, "its bottom where the pill's was");
  assert.strictEqual(l.h, 90);
  assert.strictEqual(listenRect(p, 390, 10).h, STAGE.pillH);
});

test("open, wide (inline): the stage's width less the gutters, as tall as its content within 56 and 55% of the window", () => {
  const w = wideRect(390, 100, 120, 844);
  assert.deepStrictEqual(w, { x: 16, y: -20, w: 358, h: 120 });
  assert.strictEqual(wideRect(390, 100, 20, 844).h, 56);
  assert.strictEqual(wideRect(390, 100, 900, 844).h, Math.round(844 * 0.55));
});

test("open, square (veiled): at most 360, centred over him, its bottom 64 over his crown, never over the safe top", () => {
  const s = squareRect(PHONE, { x: 195, y: 720 });
  assert.strictEqual(s.w, 358, "the column's width on a phone");
  assert.strictEqual(s.h, s.w);
  assert.strictEqual(s.y + s.h, 720 - 64);
  assert.strictEqual(s.x, 16);
  const wide = squareRect({ ...PHONE, w: 900 }, { x: 600, y: 720 });
  assert.strictEqual(wide.w, 360);
  assert.strictEqual(wide.x, 600 - 180, "centred over him");
  const low = squareRect(PHONE, { x: 195, y: 300 });
  assert.ok(low.y >= PHONE.top + 12 && low.w === low.h, "a keyboard up: smaller, still square, under the safe top");
});

test("full: 16 from the sides, from the safe top + 12 to 72 over his crown", () => {
  assert.deepStrictEqual(fullRect(PHONE, { x: 200, y: 720 }), { x: 16, y: 59, w: 358, h: 720 - 72 - 59 });
});

test("low: the stage goes down to 24 over the safe bottom (or over the keyboard); the box fills from the top + 56 to the trail", () => {
  const { stageY, box } = lowLayout(PHONE, 132, { x: 180, y: 70 }, 0);
  assert.strictEqual(stageY + 132, 844 - 34 - 24);
  assert.strictEqual(box.y, 47 + 56);
  assert.strictEqual(box.y + box.h, stageY + 70 - trailRoom(1));
  assert.strictEqual(box.x, 16);
  assert.strictEqual(box.w, 358);
  const kb = lowLayout(PHONE, 132, { x: 180, y: 70 }, 0, 500);
  assert.strictEqual(kb.stageY + 132, 492, "over the keyboard");
  assert.ok(kb.box.h >= STAGE.wideMin);
  assert.strictEqual(keyboardLift(800, 500), 308);
  assert.strictEqual(keyboardLift(400, 500), 0);
  assert.strictEqual(keyboardLift(800, null), 0);
});

test("a tap and a double tap: without a double, a press at once; with one, the first waits 260 ms, a second inside is the double", () => {
  assert.deepStrictEqual(tapOn(null, 1000, false), { run: "press", pending: null });
  let t = tapOn(null, 1000, true);
  assert.deepStrictEqual(t, { run: "wait", pending: 1000 });
  assert.ok(!tapDue(t.pending, 1200) && tapDue(t.pending, 1261), "the press runs once 260 ms pass");
  t = tapOn(t.pending, 1200, true);
  assert.deepStrictEqual(t, { run: "double", pending: null }, "a second tap at 200 ms: the double, no press");
  assert.ok(!tapDue(t.pending, 5000));
  const late = tapOn(1000, 1300, true);
  assert.deepStrictEqual(late, { run: "wait", pending: 1300 }, "a second tap after 260 ms starts a new wait");
});

test("a tap inside a live scene's box goes to the scene, not to the stage's press (SPEC 3.6, 7)", () => {
  // The stage's own Pressable fills the stage, so its locationX/Y are already stage pixels. His hit area is a
  // separate view translated onto his body, so a tap there arrives relative to ITS corner and has to be moved back.
  const L = compileLooks({
    v: 9,
    format: 2,
    scenes: {
      pool: { format: 2, box: [1.4, 0.8], still: 0.2, tap: true, els: [{ id: "w", kind: "shape", d: "O 0 -0.2 0.2", fill: "ink" }] },
    },
    moments: {
      "m.pool": {
        format: 2, dur: 6, mode: "loop", fallback: "survey", still: 0.2,
        tracks: [{ do: "scene", scene: "pool", on: "ground", x: 0.6, y: 0, back: true, at: 0, to: 6 }],
      },
    },
  });
  assert.deepStrictEqual(L.errors, []);
  const W = 340, H = 200;
  const bot = new BotTile({ kind: "custom", color: "#4F7A3A", mood: "idle", seed: 3 });
  bot.resize(W, H, H - 20);
  assert.ok(bot.playMoment(L.moment("m.pool"), "loop"));
  for (let f = 0; f < 30; f++) bot.step(1 / 60);
  assert.ok(bot.scenesLive(), "the scene is playing");

  // His hit area, placed as BotStage's placeHit does it.
  const size = 46, hw = Math.round(size * 1.5), hh = Math.round(size * 1.9);
  const corner = {
    x: Math.max(0, Math.min(W - hw, bot.x[2]! - hw / 2)),
    y: Math.max(0, Math.min(H - hh, bot.crown().y)),
  };
  // A point inside the scene's box, in stage pixels, and the same point as his hit area reports it.
  const inBox = { x: bot.scOX[0]!, y: bot.scOY[0]! - 4 };
  const local = { x: inBox.x - corner.x, y: inBox.y - corner.y };

  const at = tapInStage(local.x, local.y, corner);
  assert.ok(Math.abs(at.x - inBox.x) < 1e-9 && Math.abs(at.y - inBox.y) < 1e-9, "it comes back to the stage's own pixels");
  assert.strictEqual(bot.cue("tap", at.x, at.y), true, "the scene takes it, so onPress does not run");
  assert.strictEqual(bot.tapN, 1);
  // The raw view coordinates land somewhere else entirely, which is the bug this guards.
  assert.ok(corner.x > 1 || corner.y > 1, "his hit area really is away from the stage's corner");
  assert.strictEqual(bot.cue("tap", local.x, local.y), false, "unmoved, the same tap misses the box");
  // The stage's own Pressable needs no move, and a tap outside the box is the stage's press as before.
  assert.strictEqual(tapInStage(inBox.x, inBox.y, null).x, inBox.x);
  assert.strictEqual(bot.cue("tap", inBox.x + 9999, inBox.y), false);
});
