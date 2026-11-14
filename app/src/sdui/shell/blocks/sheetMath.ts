/**
 * SHEET DETENTS, THE MATH (pure SPEC 2.10): the heights a sheet rests at, where a drag lands, when it closes. Free of react-native,
 * tested on its own (sheetMath.test.ts).
 *
 *   detents   up to 4 of: "small" (25% of the screen), "medium" (50%), "large" (90%), or a fraction 0.1..1. Sorted, no repeats.
 *             Nothing usable means ["large"].
 *   settle    a drag ends at `height` with `velocity` (px per second, up is positive). The sheet lands where it would have
 *             coasted to in 200 ms, on the nearest detent. Coasting below half of the lowest detent closes it (when it can close).
 */
export const DETENT_NAMES = Object.freeze({ small: 0.25, medium: 0.5, large: 0.9 });
export const MAX_DETENTS = 4;
export const COAST_MS = 200;

/** Fractions of the screen, sorted and clamped. */
export function normalizeDetents(d: unknown): number[] {
  const list = Array.isArray(d) ? d : typeof d === "string" || typeof d === "number" ? [d] : [];
  const out: number[] = [];
  for (const v of list) {
    const f = typeof v === "string" ? (DETENT_NAMES as Record<string, number>)[v] : typeof v === "number" ? v : undefined;
    if (f == null || !Number.isFinite(f)) continue;
    const c = Math.round(Math.min(1, Math.max(0.1, f)) * 1000) / 1000;
    if (!out.includes(c)) out.push(c);
    if (out.length >= MAX_DETENTS) break;
  }
  return out.length ? out.sort((a, b) => a - b) : [DETENT_NAMES.large];
}

/** The resting heights in px for a screen `screenH` tall. */
export function detentHeights(d: unknown, screenH: number): number[] {
  const h = Number.isFinite(screenH) && screenH > 0 ? screenH : 0;
  return normalizeDetents(d).map((f) => Math.round(f * h));
}

/** Where a drag that ends at `height` going `velocity` lands: a detent index, or "close". */
export function settle(heights: readonly number[], height: number, velocity: number, canClose = true): number | "close" {
  if (!heights.length) return "close";
  const v = Number.isFinite(velocity) ? velocity : 0;
  const at = (Number.isFinite(height) ? height : 0) + (v * COAST_MS) / 1000;
  if (canClose && at < heights[0] / 2) return "close";
  let best = 0;
  for (let i = 1; i < heights.length; i++) if (Math.abs(heights[i] - at) < Math.abs(heights[best] - at)) best = i;
  return best;
}

/** A dragged height held between the lowest detent less a little rubber band and the highest. */
export function clampDrag(heights: readonly number[], height: number, canClose = true): number {
  if (!heights.length) return 0;
  const lo = canClose ? 0 : heights[0], hi = heights[heights.length - 1];
  return Math.min(hi, Math.max(lo, Number.isFinite(height) ? height : lo));
}
