/**
 * THE SHARED-ELEMENT MOVE, worked out (pure SPEC 2.5). Shared.tsx draws it.
 *
 * One node leaves a screen and another with the same `shared` id arrives on the next one, and the thing appears
 * to fly from where it was to where it now is. Reanimated can do this itself, and in this binary it cannot: its
 * shared transitions sit behind ENABLE_SHARED_ELEMENT_TRANSITIONS, a static flag that is false in
 * staticFlags.json and compiled into the native code, and the app has no react-native-screens either. Flipping a
 * static flag means recompiling an already-linked native package, which means a new runtime (SPEC 4.1). So the
 * move is drawn in JS instead: both boxes are measured, a copy of the leaving node is put on an overlay above
 * both screens, and it is flown from one box to the other.
 *
 * This file is the arithmetic and the book-keeping: which box a leaving node left behind, whether an arriving
 * node is close enough in time to claim it, and the transform that carries one box onto another. No React, no
 * React Native, no Reanimated — so it is tested in Node, and the drawing above it stays small.
 */

/** A box in window coordinates, as measureInWindow gives it. */
export interface Box { x: number; y: number; w: number; h: number }

/**
 * How long a box a leaving node left behind is worth claiming, in milliseconds. A navigation puts the two mounts
 * a frame or two apart; anything slower is two unrelated screens that happen to share an id, and flying between
 * them would be a thing sliding across the screen for no reason anyone could name.
 */
export const SHARED_WINDOW_MS = 450;

/** How long the flight itself takes, and the spring it lands with. */
export const SHARED_MS = 320;
export const SHARED_K = 200;
export const SHARED_DAMP = 0.9;

/** True when a measured box is real: on screen, with a size. A node that never laid out measures as zeros. */
export function okBox(b: Box | null | undefined): b is Box {
  return !!b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0.5 && b.h > 0.5;
}

/**
 * The flight: the overlay copy is drawn at `from`'s place and size, and then moved onto `to`.
 *
 * The transform scales about the copy's own centre (React Native's transforms do), so the translation is between
 * the two CENTRES, not the two corners — the corner version is the classic off-by-half-a-box that makes a shared
 * move look like it is aiming at the wrong thing.
 */
export interface Flight {
  /** Where the copy is drawn, before it moves. */
  x: number; y: number; w: number; h: number;
  /** Where it ends up, relative to that: a translation of its centre and a scale of its box. */
  dx: number; dy: number; sx: number; sy: number;
}

export function flightOf(from: Box, to: Box): Flight {
  const w = from.w > 0 ? from.w : 1;
  const h = from.h > 0 ? from.h : 1;
  return {
    x: from.x, y: from.y, w: from.w, h: from.h,
    dx: (to.x + to.w / 2) - (from.x + from.w / 2),
    dy: (to.y + to.h / 2) - (from.y + from.h / 2),
    sx: to.w / w,
    sy: to.h / h,
  };
}

/** True when the two boxes are so nearly the same that flying between them would only be a flicker. */
export function worthFlying(from: Box, to: Box): boolean {
  const f = flightOf(from, to);
  return Math.abs(f.dx) > 1 || Math.abs(f.dy) > 1 || Math.abs(f.sx - 1) > 0.02 || Math.abs(f.sy - 1) > 0.02;
}

/** What a leaving node left behind: its last measured box, and when it left. */
interface Left<T> { box: Box; at: number; copy: T }

/**
 * THE BOOK of nodes that have just left, by shared id.
 *
 * A leaving node writes its box and a copy of itself here; the next node with the same id reads it, if it is
 * within the window, and takes it — once. Generic in what a "copy" is, because what the phone puts on the
 * overlay is a React element and this file has never heard of React.
 */
export class SharedBook<T> {
  private left = new Map<string, Left<T>>();

  /** How many flights are in the air. The limit is SPEC 5.1's two at once. */
  private flying = 0;

  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number = 2, windowMs: number = SHARED_WINDOW_MS) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** A node with this id is going away. Nothing is kept for a box that never really existed. */
  note(id: string, box: Box | null, copy: T, at: number): void {
    if (!id || !okBox(box)) return;
    this.left.set(id, { box, at, copy });
  }

  /**
   * A node with this id has arrived. Returns what the one that left put down, if it was recent enough and there
   * is room for another flight — and takes it, so two arrivals cannot both fly from one departure.
   *
   * CLAIMING IS RESERVING. The place in the air is taken here, not later when the flight actually starts:
   * three arrivals in one frame would otherwise all see room, all claim, and only some of them ever report
   * landing, so the count would creep up until nothing could ever fly again. Every claim that returns a box
   * must be paired with exactly one `landed()`, including the ones that never get off the ground.
   */
  claim(id: string, at: number): { box: Box; copy: T } | null {
    const l = this.left.get(id);
    if (!l) return null;
    this.left.delete(id);
    if (at - l.at > this.windowMs || at < l.at) return null;
    if (this.flying >= this.max) return null;
    this.flying += 1;
    return { box: l.box, copy: l.copy };
  }

  /** One reservation handed back: the flight landed, was refused, or never started. */
  landed(): void { this.flying = this.flying > 0 ? this.flying - 1 : 0; }

  /** How many are in the air, for tests and for the handshake. */
  get inFlight(): number { return this.flying; }

  /** Drop anything older than the window. Called when a flight starts, so the map never grows unwatched. */
  sweep(at: number): void {
    for (const [id, l] of this.left) if (at - l.at > this.windowMs) this.left.delete(id);
  }

  /** Forget everything: a sign-out, a safe-mode restart, a test. */
  clear(): void { this.left.clear(); this.flying = 0; }
}
