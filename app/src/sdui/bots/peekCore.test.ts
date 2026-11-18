/**
 * THE PEEK'S ARITHMETIC (bots/peekCore.ts).
 *
 * THE ONE TEST THAT MATTERS is the pocket: it must sit on the safe side of its edge and be shallow enough that
 * nothing of him can reach the status bar's words or the tab bar — on any phone, whatever its cutout looks like.
 * The first version of this file clipped him against the screen edge instead, which works on a wide notch and draws
 * him over the clock on a punch-hole. The rest follows from that:
 *
 *   - `from` is entirely outside the pocket, so hidden means invisible, not "mostly hidden"
 *   - `from` and `to` differ along ONE axis, the edge's own: he rises straight over it and never slides
 *   - two peeks in a row are never in the same place
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { placeOf, nextSpot, hopTo, inRange, pocketIn, widthOf, SIZE, SHOW, RISE_MS, DUCK_MS } from "./peekCore.ts";

/** A real iPhone: 390 x 844, a notch, and a tab bar over the home line. */
const FRAME = { width: 390, height: 844, top: 59, bottom: 83, left: 0, right: 0 };
const EDGES = ["left", "right", "bottom", "notch"] as const;
const W = widthOf(SIZE);
const SHOWN = Math.round(SIZE * SHOW);

test("the window's own timings are what this uses", () => {
  assert.equal(RISE_MS, 280);
  assert.equal(DUCK_MS, 300);
});

test("THE POCKET IS INSIDE THE SAFE AREA on every edge: he can never reach the status bar or the tab bar", () => {
  for (const edge of EDGES) {
    for (const along of [0, 0.5, 1]) {
      const { pocket } = placeOf({ edge, along }, FRAME);
      assert.ok(pocket.y >= FRAME.top, `${edge}: pocket starts below the notch (${pocket.y})`);
      assert.ok(pocket.y + pocket.height <= FRAME.height - FRAME.bottom, `${edge}: pocket ends above the tab bar`);
      assert.ok(pocket.x >= FRAME.left, `${edge}: inside the left inset`);
      assert.ok(pocket.x + pocket.width <= FRAME.width - FRAME.right, `${edge}: inside the right inset`);
    }
  }
});

test("a narrow punch-hole is as safe as a wide notch, because the pocket never depends on the cutout's shape", () => {
  // The same spot on a phone whose top inset is small: still below it, never over it.
  for (const top of [24, 34, 47, 59, 72]) {
    const { pocket } = placeOf({ edge: "notch", along: 0 }, { ...FRAME, top });
    assert.equal(pocket.y, top);
    assert.ok(pocket.height <= SIZE, "and only as deep as a peek");
  }
});

test("`from` is ENTIRELY outside the pocket: hidden means invisible", () => {
  for (const edge of EDGES) {
    const p = placeOf({ edge, along: 0.4 }, FRAME);
    const out =
      p.from.y + SIZE <= 0 ||                 // above the pocket
      p.from.y >= p.pocket.height ||          // below it
      p.from.x + W <= 0 ||                    // left of it
      p.from.x >= p.pocket.width;             // right of it
    assert.ok(out, `${edge}: from is clipped away entirely`);
  }
});

test("`to` really shows him: some of him is inside the pocket, and he is still cut off", () => {
  for (const edge of EDGES) {
    const p = placeOf({ edge, along: 0.4 }, FRAME);
    const visibleH = Math.min(p.pocket.height, p.to.y + SIZE) - Math.max(0, p.to.y);
    const visibleW = Math.min(p.pocket.width, p.to.x + W) - Math.max(0, p.to.x);
    assert.ok(visibleH > 0 && visibleW > 0, `${edge}: something of him shows`);
    assert.ok(visibleH < SIZE || visibleW < W, `${edge}: and not all of him — that is the peek`);
  }
});

test("`from` and `to` differ along ONE axis, so he never slides across the screen", () => {
  for (const edge of EDGES) {
    const p = placeOf({ edge, along: 0.5 }, FRAME);
    const moved = (p.from.x !== p.to.x ? 1 : 0) + (p.from.y !== p.to.y ? 1 : 0);
    assert.equal(moved, 1, `${edge} moves on one axis`);
  }
});

test("a side comes in sideways; the bottom and the notch come in vertically", () => {
  assert.equal(placeOf({ edge: "right", along: 0.5 }, FRAME).from.y, placeOf({ edge: "right", along: 0.5 }, FRAME).to.y);
  assert.equal(placeOf({ edge: "bottom", along: 0.5 }, FRAME).from.x, placeOf({ edge: "bottom", along: 0.5 }, FRAME).to.x);
  assert.equal(placeOf({ edge: "notch", along: 0 }, FRAME).from.x, placeOf({ edge: "notch", along: 0 }, FRAME).to.x);
});

test("the notch hangs him UPSIDE DOWN, and its pocket starts at the notch's own bottom", () => {
  const p = placeOf({ edge: "notch", along: 0 }, FRAME);
  assert.equal(p.flip, true);
  assert.equal(p.pocket.y, FRAME.top);
  assert.equal(p.pocket.height, SHOWN);
  assert.equal(p.pocket.x, Math.round((FRAME.width - W) / 2), "centred");
});

test("the notch ignores `along`: there is one notch", () => {
  const a = placeOf({ edge: "notch", along: 0 }, FRAME);
  const b = placeOf({ edge: "notch", along: 1 }, FRAME);
  assert.deepEqual(a, b);
});

test("the bottom edge is where the TAB BAR ends, not where the glass does", () => {
  const p = placeOf({ edge: "bottom", along: 0.5 }, FRAME);
  assert.equal(p.pocket.y + p.pocket.height, FRAME.height - FRAME.bottom);
});

test("`along` runs him down a side, inside the safe area at both ends", () => {
  const top = placeOf({ edge: "right", along: 0 }, FRAME);
  const low = placeOf({ edge: "right", along: 1 }, FRAME);
  assert.equal(top.pocket.y, FRAME.top);
  assert.equal(low.pocket.y + low.pocket.height, FRAME.height - FRAME.bottom);
  assert.ok(low.pocket.y > top.pocket.y);
});

test("a side inset (held sideways, or a curved screen) moves the pocket in", () => {
  const sideways = { ...FRAME, left: 44, right: 44 };
  assert.equal(placeOf({ edge: "left", along: 0.5 }, sideways).pocket.x, 44);
  const r = placeOf({ edge: "right", along: 0.5 }, sideways);
  assert.equal(r.pocket.x + r.pocket.width, sideways.width - 44);
});

test("two peeks in a row are never in the same place", () => {
  const spots = [{ edge: "right" as const, along: 0.2 }, { edge: "left" as const, along: 0.5 }, { edge: "notch" as const, along: 0 }];
  for (const rnd of [0, 0.3, 0.5, 0.77, 0.999]) {
    for (let at = 0; at < spots.length; at += 1) assert.notEqual(nextSpot(spots, at, rnd), at);
  }
});

test("one spot is its own answer, and no spots draws nothing", () => {
  assert.equal(nextSpot([{ edge: "right", along: 0 }], 0, 0.9), 0);
  assert.equal(nextSpot([], -1, 0.5), -1);
});

test("every spot is reachable", () => {
  const spots = [{ edge: "right" as const, along: 0 }, { edge: "left" as const, along: 0 }, { edge: "bottom" as const, along: 0 }];
  const seen = new Set<number>();
  for (const rnd of [0, 0.4, 0.5, 0.9]) for (let at = 0; at < 3; at += 1) seen.add(nextSpot(spots, at, rnd));
  assert.equal(seen.size, 3);
});

test("a range gives its ends and its middle, and a stray value is clamped", () => {
  assert.equal(inRange([4, 10], 0), 4);
  assert.equal(inRange([4, 10], 1), 10);
  assert.equal(inRange([4, 10], 0.5), 7);
  assert.equal(inRange([4, 10], -3), 4);
  assert.equal(inRange([4, 10], 9), 10);
});

test("the hop goes further into the pocket and never sideways: a hop is not a move", () => {
  const hanging = placeOf({ edge: "notch", along: 0 }, FRAME);
  assert.ok(hopTo(hanging).y > hanging.to.y, "a hanging bot hops down");
  assert.equal(hopTo(hanging).x, hanging.to.x);
  const standing = placeOf({ edge: "bottom", along: 0.5 }, FRAME);
  assert.ok(hopTo(standing).y < standing.to.y, "one on the bottom edge hops up");
  assert.equal(hopTo(standing).x, standing.to.x);
});

test("THE POCKET IS TAKEN OUT OF ITS HOST'S FRAME: mounted inside the safe area, he is not pushed down twice", () => {
  const p = placeOf({ edge: "notch", along: 0 }, FRAME);
  // Home mounts him inside a SafeArea that has already taken the notch's height as padding.
  const inHost = pocketIn(p, { x: 0, y: FRAME.top });
  assert.equal(inHost.y, 0, "the notch's pocket is at the top of that host, not 59 points into it");
  assert.equal(inHost.x, p.pocket.x, "and nothing moved sideways");
  // A host at the window's own origin leaves it exactly as it was, which is why this was easy to miss.
  assert.deepEqual(pocketIn(p, { x: 0, y: 0 }), p.pocket);
});

test("the host's frame never changes his SIZE, only where the pocket is", () => {
  for (const edge of EDGES) {
    const p = placeOf({ edge, along: 0.5 }, FRAME);
    const moved = pocketIn(p, { x: 7, y: FRAME.top });
    assert.equal(moved.width, p.pocket.width);
    assert.equal(moved.height, p.pocket.height);
    assert.equal(moved.x, p.pocket.x - 7);
  }
});
