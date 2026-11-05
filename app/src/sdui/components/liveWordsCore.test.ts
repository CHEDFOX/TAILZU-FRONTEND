// node --test --experimental-strip-types src/sdui/components/liveWordsCore.test.ts
//
// Live words: a word is born light grey and settles to ink over settleMs; a word that changes is born again; the others
// keep their place in time.
import test from "node:test";
import assert from "node:assert";
import { LiveWordsTrack, mixColor } from "./liveWordsCore.ts";

const FRESH = "#b5b5b5", INK = "#0a0a0a";

test("fresh to settled: grey when born, ink after settleMs, in between on the way", () => {
  const t = new LiveWordsTrack();
  t.update("dinner", 1000);
  assert.strictEqual(t.k(0, 1000, 600), 0);
  assert.strictEqual(mixColor(FRESH, INK, t.k(0, 1000, 600)), FRESH);
  const mid = t.k(0, 1300, 600);
  assert.ok(mid > 0.5 && mid < 1, `eased out (${mid})`);
  assert.strictEqual(t.k(0, 1600, 600), 1);
  assert.strictEqual(mixColor(FRESH, INK, t.k(0, 1600, 600)), INK);
  assert.ok(!t.settled(1599, 600) && t.settled(1600, 600));
  t.update("dinner is ready", 1400);
  assert.strictEqual(t.words[0]!.born, 1000, "the first word keeps its birth");
  assert.strictEqual(t.words[1]!.born, 1400);
  assert.strictEqual(t.words[2]!.born, 1400);
  assert.ok(t.k(0, 1500, 600) > t.k(1, 1500, 600), "the newest is the lightest");
});

test("a word that changes in a later partial starts fresh again", () => {
  const t = new LiveWordsTrack();
  t.update("see you at seven", 0);
  t.update("see you at 7:30", 500);
  assert.strictEqual(t.words[2]!.born, 0, "unchanged");
  assert.strictEqual(t.words[3]!.born, 500, "changed: born again");
  assert.strictEqual(t.k(3, 500, 600), 0);
  t.update("", 900);
  assert.deepStrictEqual(t.words, [], "empty between turns");
  assert.ok(t.settled(900, 600));
});

test("colours mix as #rrggbb; anything else is kept at its end", () => {
  assert.strictEqual(mixColor("#000000", "#ffffff", 0.5), "#808080");
  assert.strictEqual(mixColor("#000000", "#ffffff", 2), "#ffffff");
  assert.strictEqual(mixColor("ink", "#ffffff", 0.2), "ink");
});
