// node --test --experimental-strip-types src/sdui/shell/blocks/sheetMath.test.ts
//
// Sheet detents: names and fractions, where a drag lands, when it closes; and how a navigate says how it comes up.
import test from "node:test";
import assert from "node:assert";
import { clampDrag, detentHeights, normalizeDetents, settle } from "./sheetMath.ts";
import { isOverlayLike, normalizePresentation } from "./presentation.ts";

test("detents: names, fractions, sorted, no repeats, at most 4, default large", () => {
  assert.deepEqual(normalizeDetents(["large", "small", "medium"]), [0.25, 0.5, 0.9]);
  assert.deepEqual(normalizeDetents(["medium", 0.5, 0.5]), [0.5]);
  assert.deepEqual(normalizeDetents([0.1, 0.2, 0.3, 0.4, 0.5]), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(normalizeDetents([5, -1, "huge", NaN]), [0.1, 1]);
  assert.deepEqual(normalizeDetents(undefined), [0.9]);
  assert.deepEqual(normalizeDetents("medium"), [0.5]);
});

test("heights in px for a screen", () => {
  assert.deepEqual(detentHeights(["small", "large"], 800), [200, 720]);
  assert.deepEqual(detentHeights(["medium"], NaN), [0]);
});

test("settle: nearest detent, velocity carries, low and fast closes", () => {
  const h = [200, 400, 720];
  assert.equal(settle(h, 390, 0), 1);
  assert.equal(settle(h, 390, 800), 1); // coasts to 550: still nearer 400
  assert.equal(settle(h, 390, 1500), 2); // coasts to 690
  assert.equal(settle(h, 250, -400), 0); // coasts to 170
  assert.equal(settle(h, 100, 0), 0); // 100 is not below half of 200
  assert.equal(settle(h, 99, 0), "close");
  assert.equal(settle(h, 300, -1500), "close"); // coasts to 0
  assert.equal(settle(h, 99, 0, false), 0); // a sheet that cannot close stays
  assert.equal(settle([], 80, 0), "close");
  assert.equal(settle(h, NaN, NaN), "close");
});

test("a dragged height stays between the ends", () => {
  const h = [200, 720];
  assert.equal(clampDrag(h, 900), 720);
  assert.equal(clampDrag(h, -50), 0);
  assert.equal(clampDrag(h, 100, false), 200);
  assert.equal(clampDrag(h, NaN, false), 200);
});

test("navigate presentation: push is the default for anything unknown", () => {
  assert.deepEqual(normalizePresentation(undefined), { presentation: "push", transition: "default", dismissible: true });
  assert.equal(normalizePresentation({ presentation: "teleport" }).presentation, "push");
  const s = normalizePresentation({ presentation: "sheet", detents: ["medium", "large"], dismissible: false });
  assert.deepEqual(s, { presentation: "sheet", transition: "default", detents: [0.5, 0.9], dismissible: false });
  assert.equal(normalizePresentation({ presentation: "fade" }).transition, "fade");
  assert.equal(normalizePresentation({ presentation: "modal", transition: "evil" }).transition, "default");
  assert.equal(normalizePresentation({ presentation: "modal", detents: [1] }).detents, undefined);
  assert.ok(isOverlayLike("sheet"));
  assert.ok(!isOverlayLike("push"));
});
