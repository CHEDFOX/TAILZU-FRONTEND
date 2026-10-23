// node --test
//
// Blip's round on the edge of the You tab's task card (blipRoam.ts): it is a
// loop, he never leaves the strip, and he is only behind the card while he
// is below its edge.
import test from "node:test";
import assert from "node:assert";
import { ROAM, ROAM_START, roamX } from "./blipRoam.ts";
import { POSES } from "./blipFigure.ts";

test("every pose in the round is one he has", () => {
  for (const s of ROAM) assert.ok(s.pose in POSES, s.pose);
});

test("the round ends where it starts, standing on the edge", () => {
  const last = ROAM[ROAM.length - 1]!;
  assert.strictEqual(last.kind, "walk");
  assert.strictEqual(last.kind === "walk" && last.x, ROAM_START);
  assert.strictEqual(ROAM[0]!.kind, "stand");
});

test("he is behind the card only while he is below its edge, and comes back up before he walks", () => {
  let y = 0;
  for (const s of ROAM) {
    if (s.kind === "sink") { assert.ok(s.y > 0 && s.behind, "a sink goes below the edge, behind it"); y = s.y; }
    if (s.kind === "hop") y = s.y;
    if (s.kind === "walk") assert.strictEqual(y, 0, "a walk is along the edge");
  }
});

test("a place across the strip keeps all of him inside it", () => {
  assert.strictEqual(roamX(0, 360, 80), 44);
  assert.strictEqual(roamX(1, 360, 80), 316);
  assert.strictEqual(roamX(0.5, 360, 80), 180);
});

test("a round is long enough to watch and short enough to see again", () => {
  const ms = ROAM.reduce((a, s) => a + ("ms" in s && s.ms ? s.ms : 700), 0);
  assert.ok(ms > 12000 && ms < 22000, String(ms));
});

test("played on a Blip, a round goes along the edge, behind it and into the card, and comes home", async () => {
  const { Blip } = await import("./blipMotion.ts");
  const { Roamer } = await import("./blipRoam.ts");
  const bot = new Blip(3, 0), W = 360, edge = 69, H = 54;
  const behind: boolean[] = [];
  const r = new Roamer(bot, H, edge, (f) => roamX(f, W, 80), (on) => behind.push(on));
  let lowest = edge, wentBehind = false, inCard = false;
  for (let ms = 0; ms < 40000; ms += 16) {
    r.step(ms);
    lowest = Math.max(lowest, bot.y);
    if (r.behind) wentBehind = true;
    if (!r.behind && bot.y > edge + H * 0.8 && !bot.tr) inCard = true;
    assert.ok(bot.x >= 44 && bot.x <= W - 44, `x ${bot.x}`);
  }
  assert.ok(wentBehind, "he ducks behind the edge");
  assert.ok(inCard, "he stands in the card");
  assert.ok(lowest <= edge + H * 0.97);
  assert.deepStrictEqual(behind.slice(0, 2), [true, false]);
  // Working: he stops and thinks, and carries on after.
  r.step(40016, true); r.step(41000, true); r.step(42000, true);
  assert.strictEqual(bot.pose, "think");
  r.step(42100, false);
  assert.notStrictEqual(bot.pose, "think");
});
