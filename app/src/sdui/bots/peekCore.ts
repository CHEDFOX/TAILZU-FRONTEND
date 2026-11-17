/**
 * THE PEEK, AS ARITHMETIC (BotPeek; the component is BotPeek.tsx).
 *
 * The window's Blip has risen from behind an edge for a long time (TAILZU-DESKTOP src/shared/blip.js `rise`, and
 * src/agent/guide/peek.js for the timings). This is the same gesture on a phone, and everything about it that can be
 * decided without a screen is decided here, so it can be tested without one.
 *
 * TWO RULES HOLD THE WHOLE THING UP:
 *
 *   1. HE IS CLIPPED BY THE EDGE. Every place has a `hidden` and a `shown`, and the two differ along one axis only —
 *      the edge's own normal. He is drawn in a pocket at that edge that cuts him off, so he is never a whole figure
 *      standing on somebody's page.
 *   2. HE NEVER CROSSES THE SCREEN. A new spot is taken at `hidden`, with no animation, where nobody can see it. The
 *      only movement anybody watches is straight up over an edge and straight back down.
 *
 * `notch` hangs him upside down from the top centre: he comes down head first and the notch cuts off his antenna and
 * crown. He stops at the notch's own bottom edge, so the status bar's words are never covered.
 *
 * Pure. No clock, no view, no random of its own: a caller hands in the numbers (`rnd`) so a test gets the same peek twice.
 */

/** The edge a peek is clipped against. */
export type PeekEdge = "left" | "right" | "bottom" | "notch";

export interface PeekSpot {
  edge: PeekEdge;
  /** How far along that edge, 0 to 1 of what is left after the safe area. Ignored by `notch`, which is centred. */
  along: number;
}

/** The screen he peeks into, and the safe area he must keep out of. */
export interface PeekFrame {
  width: number;
  height: number;
  /** Insets: `top` is the notch and status bar, `bottom` the tab bar or home line. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PeekPlace {
  /**
   * THE POCKET: the window he is seen through, and the whole of the safety. It sits ON THE SAFE SIDE of the edge and
   * is only `SHOW` deep, so nothing of him can be drawn outside it — not over the status bar's words, not over the tab
   * bar — whatever the phone's cutout happens to look like.
   */
  pocket: { x: number; y: number; width: number; height: number };
  /** Where he sits INSIDE the pocket: `from` is clipped away entirely, `to` is peeking. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Upside down, for the notch. */
  flip: boolean;
}

/** The window's own timings (guide/peek.js PEEK_RISE, PEEK_DUCK, PEEK_HOP). */
export const RISE_MS = 280;
export const DUCK_MS = 300;
export const HOP_MS = 560;

/** His box: a figure this tall, and about four fifths as wide. */
export const SIZE = 58;
export const widthOf = (size: number): number => Math.round(size * 0.8);

/**
 * HOW MUCH OF HIM SHOWS at full rise, as a part of his height. Three fifths: enough to read him as a bot, little
 * enough that the edge is plainly cutting him off. A whole figure is not a peek.
 */
export const SHOW = 0.6;

/** A number in a range, from one 0-to-1 value. */
export const inRange = (range: readonly [number, number], rnd: number): number =>
  range[0] + (range[1] - range[0]) * Math.min(1, Math.max(0, rnd));

/**
 * The next spot: never the one he just used, so two peeks in a row are never in the same place. One spot is its own
 * answer (he has nowhere else to go); none is -1, and the caller draws nothing.
 */
export function nextSpot(spots: readonly PeekSpot[], at: number, rnd: number): number {
  if (!spots.length) return -1;
  if (spots.length === 1) return 0;
  const others: number[] = [];
  for (let i = 0; i < spots.length; i += 1) if (i !== at) others.push(i);
  const pick = Math.min(others.length - 1, Math.floor(Math.min(0.999999, Math.max(0, rnd)) * others.length));
  return others[pick]!;
}

/**
 * Where a spot puts him: the pocket, and his two places inside it.
 *
 * The pocket is the point. An earlier version of this put the pocket where HE was and let the edge do the clipping,
 * which works on a phone whose notch is wider than he is and fails on one with a small punch-hole: beside the cutout
 * he was simply drawn over the status bar. A pocket on the safe side of the edge cannot do that on any phone.
 */
export function placeOf(spot: PeekSpot, frame: PeekFrame, size = SIZE): PeekPlace {
  const w = widthOf(size);
  const show = Math.round(size * SHOW);
  const showX = Math.round(w * SHOW);
  const along = Math.min(1, Math.max(0, spot.along));

  if (spot.edge === "notch") {
    // He hangs from the notch, head first. The pocket starts at the notch's own bottom, so the status bar is his floor.
    const x = Math.round((frame.width - w) / 2);
    return {
      pocket: { x, y: frame.top, width: w, height: show },
      from: { x: 0, y: -size },            // entirely above the pocket: clipped away
      to: { x: 0, y: -(size - show) },     // his head, below the notch
      flip: true,
    };
  }

  if (spot.edge === "bottom") {
    // The bottom edge is where the tab bar ends, not where the glass does.
    const edgeY = frame.height - frame.bottom;
    const free = Math.max(0, frame.width - frame.left - frame.right - w);
    const x = Math.round(frame.left + free * along);
    return {
      pocket: { x, y: edgeY - show, width: w, height: show },
      from: { x: 0, y: show },
      to: { x: 0, y: 0 },
      flip: false,
    };
  }

  // A side: he leans in, and stands somewhere down the part of the height that is nobody else's.
  const free = Math.max(0, frame.height - frame.top - frame.bottom - size);
  const y = Math.round(frame.top + free * along);
  if (spot.edge === "left") {
    return {
      pocket: { x: frame.left, y, width: showX, height: size },
      from: { x: -w, y: 0 },
      to: { x: -(w - showX), y: 0 },
      flip: false,
    };
  }
  return {
    pocket: { x: frame.width - frame.right - showX, y, width: showX, height: size },
    from: { x: showX, y: 0 },
    to: { x: 0, y: 0 },
    flip: false,
  };
}

/** The hop he gives when the words have landed: a nudge further into the pocket, and back. */
export function hopTo(place: PeekPlace, size = SIZE): { x: number; y: number } {
  const by = Math.round(size * 0.18);
  if (place.flip) return { x: place.to.x, y: place.to.y + by };                 // hanging: further down
  if (place.from.y > place.to.y) return { x: place.to.x, y: place.to.y - by };  // standing on the bottom edge: up
  return { x: place.to.x, y: place.to.y - by };                                 // a side: a little bob
}
