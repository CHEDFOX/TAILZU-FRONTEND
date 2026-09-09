/**
 * WHERE THE SUBJECT LANDS — the maths behind full-bleed media that has to line
 * up with something.
 *
 * The opening film is authored at one device's shape (the current one is
 * 1290×2796, an iPhone Pro Max) and then shown on every other. `cover` scales
 * the art until it fills, crops the overflow, and CENTRES what is left — so
 * the mark inside the art lands somewhere different on every aspect ratio. On
 * a squarer phone the crop is vertical and the mark rides up; on a wider one
 * it slides sideways. That is the whole of the placement trouble: nothing is
 * wrong with the art, and nothing is wrong with `cover`.
 *
 * The old answer was `nudgeX`/`nudgeY` — an offset, measured by eye, stored on
 * the upload. It works for exactly one art file on exactly the aspect it was
 * measured on, and it has to be re-measured every time either changes. Which
 * is why it kept breaking.
 *
 * THE FIX IS TO STOP STORING THE ANSWER AND STORE THE TWO FACTS INSTEAD:
 *
 *   focus   where the subject sits IN THE ART      — a property of the file
 *   anchor  where it should sit ON THE SCREEN      — a property of the screen
 *
 * Neither changes when the other does. Swap the art and you update `focus`
 * once, from the file itself; move the mark on screen and you change `anchor`,
 * and every uploaded file follows. The offset is then computed here, per
 * device, from the box the media is actually being drawn into — so it is right
 * on hardware nobody tested on.
 */

import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

export type Focus = { x: number; y: number };

export type FocusFit = {
  /** Size to draw the media at, in points. Larger than the box on one axis. */
  width: number;
  height: number;
  /** Where to put its top-left corner, in points, relative to the box. */
  left: number;
  top: number;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);

/**
 * Fit `aspect` (art width ÷ height) into `boxW × boxH` the way `cover` does,
 * then slide it so the art's focal point lands on the box's anchor point.
 *
 * The slide is CLAMPED to the overflow: an anchor can ask for a placement the
 * art cannot reach without showing an edge, and a strip of background is a
 * worse failure than a mark a few points off. What it can reach, it reaches
 * exactly.
 */
export function focusFill(
  boxW: number,
  boxH: number,
  aspect: number,
  focus: Focus = { x: 0.5, y: 0.5 },
  anchor: Focus = { x: 0.5, y: 0.5 },
): FocusFit | null {
  if (!(boxW > 0) || !(boxH > 0) || !(aspect > 0)) return null;

  const boxAspect = boxW / boxH;
  // Cover: match the axis that would otherwise leave a gap.
  const width = aspect < boxAspect ? boxW : boxH * aspect;
  const height = aspect < boxAspect ? boxW / aspect : boxH;

  const fx = clamp01(focus.x), fy = clamp01(focus.y);
  const ax = clamp01(anchor.x), ay = clamp01(anchor.y);

  // Put the focal point of the scaled art exactly on the anchor point of the
  // box, then pull back inside the overflow so no edge shows.
  const overflowX = width - boxW;
  const overflowY = height - boxH;
  const left = Math.min(0, Math.max(-overflowX, ax * boxW - fx * width));
  const top = Math.min(0, Math.max(-overflowY, ay * boxH - fy * height));

  return { width, height, left, top };
}

/**
 * Measure the box, then place the art in it so its focal point lands on the
 * anchor. The hook half of the maths above, shared by every node that draws
 * backend media — Video and Image alike, because whether a subject gets cut
 * off the side of the screen has nothing to do with whether it moves.
 *
 * OFF UNLESS THE BACKEND SUPPLIES AN ASPECT. Without the art's shape there is
 * nothing to compute, and guessing it would move media that is currently
 * correct — so an upload that says nothing keeps the centred `cover` it has
 * always had.
 */
export function useFocusFill(props: Record<string, any>): {
  on: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  fit: FocusFit | null;
} {
  const aspect = Number(props?.aspect);
  const on = Number.isFinite(aspect) && aspect > 0;
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);
  const fit = on && box
    ? focusFill(
        box.w, box.h, aspect,
        { x: Number(props?.focusX ?? 0.5), y: Number(props?.focusY ?? 0.5) },
        { x: Number(props?.anchorX ?? 0.5), y: Number(props?.anchorY ?? 0.5) },
      )
    : null;
  return { on, onLayout, fit };
}
