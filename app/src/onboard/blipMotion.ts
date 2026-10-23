/**
 * BLIP'S MOTION: HOW HE WALKS, HOPS, LANDS, AND WHEN HE DOES NONE OF THAT.
 *
 * The numbers are the approved prototype's, unchanged, and each is named here
 * so the test can hold them (blipMotion.test.ts) and the desktop can be held to
 * the same ones:
 *
 *   - Content glides ~380 ms from first move to last (26 px, 230 out, 320 in
 *     after a 60 ms beat), on one curve, cubic-bezier(.32, .72, 0, 1).
 *   - A new spot makes him crouch for 90 ms, then move: a hop (460 ms) if it
 *     is under 46 away, a walk of clamp(430 + 2.3 * distance, 520, 960) ms
 *     otherwise, smoothstep eased, height and cell size lerped as he goes.
 *   - He changes pose 60% of the way (45% for a hop) and lands with a squash.
 *   - Same place, new pose (within 8 px, same height): no travel at all.
 *   - The first spot ever, and the first after he was let go, he is simply
 *     there: no walk from nowhere.
 *   - Reduced motion: no slide, no walk (he is there after 160 ms), no bob,
 *     sway or blink, poses set at once.
 *
 * Pure: no timers, no React, no Skia. The clock is passed in.
 */
import { GLOW, WALKARMS, poseOf, spring, type FigureState } from "./blipFigure.ts";

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// --- The numbers ------------------------------------------------------------

/** The content glide between steps, in px and ms. */
export const GLIDE = { slide: 26, outMs: 230, inMs: 320, inDelayMs: 60 } as const;
/** The same, for someone who asked the phone for less motion: a fade, no travel. */
export const GLIDE_REDUCED = { slide: 0, outMs: 260, inMs: 260, inDelayMs: 0 } as const;
/** Every glide, in and out, forward and back, runs on this one curve. */
export const EASE = [0.32, 0.72, 0, 1] as const;

export const CROUCH_MS = 90;
export const HOP_UNDER = 46;
export const HOP_MS = 460;
export const NEAR_PX = 8;
export const REDUCED_SNAP_MS = 160;
export const HOP_SWAP = 0.45;
export const WALK_SWAP = 0.6;
/** How high a hop lifts him. */
export const HOP_LIFT = 20;

export const BUBBLE = {
  /** The bubble fades in over this long. */
  fadeMs: 200,
  /** And grows from .88 to 1, rising 5 px, over this long. */
  growMs: 320,
  fromScale: 0.88,
  rise: 5,
  /** Said again in the same place: .93 to 1 over this long. */
  resayFrom: 0.93,
  resayMs: 220,
  tilt: -1.5,
  /** Confetti goes off this long after he lands. */
  burstDelayMs: 250,
} as const;

/** Poses he keeps while moving, because they hold something. Otherwise he walks. */
const KEEPS_POSE = new Set(["wave", "key", "carry"]);

/** One grey pixel is this many points: about 92 of them stand him up, never fewer than 2 device pixels. */
export const cellFor = (H: number, dpr: number): number => Math.max(2, Math.round(H / 92 * dpr)) / dpr;

/** The box a spot reserves, and the picture he is drawn into, for a figure H tall. */
export const boxOf = (h: number): { w: number; h: number } => ({ w: Math.ceil(h * 1.4), h: Math.ceil(h * 1.16 + 4) });

/** The pose he travels in. */
export const walkPose = (current: string): string => (KEEPS_POSE.has(current) ? current : "walk");

export const isHop = (dist: number): boolean => dist < HOP_UNDER;
export const travelMs = (dist: number): number => (isHop(dist) ? HOP_MS : clamp(430 + dist * 2.3, 520, 960));

// --- The rule for a new spot ------------------------------------------------

export interface Plan {
  kind: "snap" | "repose" | "travel";
  /** How long to wait before a snap. */
  delayMs: number;
}

/**
 * What to do when the current spot changes.
 *
 *   placed   he has stood somewhere since he was last let go, at (x, y), h tall.
 *   to       where the new spot wants him.
 */
export function planArrival(
  placed: { placed: boolean; x: number; y: number; h: number },
  to: { x: number; y: number; h: number },
  reduced: boolean,
): Plan {
  if (!placed.placed) return { kind: "snap", delayMs: 0 };
  const near = Math.abs(to.x - placed.x) <= NEAR_PX && Math.abs(to.y - placed.y) <= NEAR_PX && to.h === placed.h;
  if (near) return { kind: "repose", delayMs: 0 };
  return reduced ? { kind: "snap", delayMs: REDUCED_SNAP_MS } : { kind: "travel", delayMs: 0 };
}

/**
 * Where his feet and his words go for a spot whose box is `rect`.
 *
 * The feet are the middle of the box's bottom edge. Beside him (side) the
 * bubble starts just inside the box's right edge, a tenth of him down; in the
 * corner it ends ten in from the right edge and six down. Corner spots stretch
 * across their parent (see BlipSpot), which is what puts "the right edge" at
 * the edge of the content, as it is in the prototype.
 */
export function anchorsFor(
  spot: { h: number; bubble: "side" | "corner" },
  rect: { x: number; y: number; w: number; h: number },
): { footX: number; footY: number; bubX: number; bubY: number; anchor: "left" | "right" } {
  const footX = rect.x + rect.w / 2, footY = rect.y + rect.h - 2;
  if (spot.bubble === "corner") {
    return { footX, footY, bubX: rect.x + rect.w - 10, bubY: rect.y + 6, anchor: "right" };
  }
  return {
    footX, footY,
    bubX: rect.x + rect.w - Math.round(spot.h * .16),
    bubY: rect.y + Math.round(spot.h * .10),
    anchor: "left",
  };
}

// --- Confetti ---------------------------------------------------------------

export const CONFETTI = { pieces: 22, ms: 1200, w: 7, h: 11, ease: [0.15, 0.7, 0.3, 1] as const } as const;

export interface Piece {
  /** Where it ends up, from where it started. */
  dx: number;
  dy: number;
  /** How far it spins, in degrees. */
  rot: number;
  /** Index into the four confetti colours. */
  color: number;
}

/** 22 pieces: thrown sideways up to 120 either way, up 130 to down 70, turning up to a turn either way. */
export function confettiPieces(rand: () => number = Math.random): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < CONFETTI.pieces; i++) {
    out.push({ dx: rand() * 240 - 120, dy: rand() * 200 - 130, rot: rand() * 720 - 360, color: i % 4 });
  }
  return out;
}

// --- The character's state --------------------------------------------------

interface Travel {
  x0: number; y0: number; H0: number; x1: number; y1: number; H1: number;
  c0: number; c1: number;
  t0: number; T: number; dist: number; hop: boolean; dir: number;
  /** How high a hop rises at its top, in points. */
  hopLift: number;
  pose1: string; swapAt: number; swapped: boolean; ph0: number;
  onland?: () => void;
}

/**
 * Everything about where he is and how he is moving. The overlay owns one,
 * calls travel() or snap() when a spot asks, tick() each frame for position,
 * and frame() for the joints to draw.
 */
export class Blip {
  x = 0; y = 0; H = 120; cell: number;
  lift = 0; walk = 0; ph = 0; fx = 1; hopK = 0; sq = 0; sqV = 0;
  tr: Travel | null = null;
  lt = 0;
  pose = "present";
  S: Record<string, number>;
  V: Record<string, number> = {};
  osc = 0; nod = 0; glow = 0; t: number;
  /** Device pixels per point, which sets how fine his dots are. */
  readonly dpr: number;

  // No `constructor(readonly dpr)` shorthand: node's strip-only TypeScript
  // cannot erase a parameter property, and the tests load this file as it is.
  constructor(dpr: number, seed = Math.random() * 4) {
    this.dpr = dpr;
    this.cell = cellFor(this.H, dpr);
    this.S = { ...poseOf("present") };
    this.t = seed;
  }

  /** Be there, now: no walk, no squash. */
  snap(x: number, y: number, H: number): void {
    this.tr = null;
    this.x = x; this.y = y; this.H = H; this.cell = cellFor(H, this.dpr);
    this.lift = 0; this.walk = 0; this.fx = 1; this.hopK = 0; this.sq = 0; this.sqV = 0;
  }

  /** Go there. `now` is the clock the later tick() calls will use (ms). */
  /**
   * Go there. `now` is the clock the later tick() calls will use (ms). Near
   * is a hop and far is a walk, unless `how` says: a hop over any distance
   * (rising higher the further it goes: a jump), or a walk taking `ms` (slow,
   * when he is sneaking).
   */
  travel(
    x1: number, y1: number, H1: number, pose1: string, onland: (() => void) | undefined, now: number,
    how: { hop?: boolean; ms?: number } = {},
  ): void {
    const dx = x1 - this.x, dy = y1 - this.y;
    const dist = Math.hypot(dx, dy) + Math.abs(H1 - this.H) * .5;
    const hop = how.hop ?? isHop(dist);
    this.tr = {
      x0: this.x, y0: this.y, H0: this.H, x1, y1, H1,
      c0: this.cell, c1: cellFor(H1, this.dpr),
      t0: now + CROUCH_MS, T: how.ms ?? (how.hop ? Math.max(HOP_MS, Math.min(760, 300 + dist * 3)) : travelMs(dist)), dist, hop,
      hopLift: how.hop ? Math.max(HOP_LIFT, dist * .45) : HOP_LIFT,
      dir: Math.abs(dx) < 8 ? 0 : Math.sign(dx),
      pose1, swapAt: hop ? HOP_SWAP : WALK_SWAP, swapped: false,
      onland, ph0: this.ph,
    };
  }

  /** Move the whole journey by dy, e.g. because the step scrolled under him. */
  shiftY(dy: number): void {
    this.y += dy;
    if (this.tr) { this.tr.y0 += dy; this.tr.y1 += dy; }
  }

  /** Advance position, gait, facing and squash to the clock `ms`. */
  tick(ms: number): void {
    const dt = Math.min(.05, Math.max(0, (ms - (this.lt || ms)) / 1000));
    this.lt = ms;
    const tr = this.tr;
    let sqT = 0, walkT = 0, fxT = 1;
    if (tr) {
      fxT = tr.dir || 1;
      if (ms < tr.t0) {
        // the crouch before he goes
        sqT = .17; this.lift *= .6; this.hopK *= .6;
      } else {
        const p = clamp((ms - tr.t0) / tr.T), e = p * p * (3 - 2 * p);
        this.x = lerp(tr.x0, tr.x1, e);
        this.y = lerp(tr.y0, tr.y1, e);
        this.H = lerp(tr.H0, tr.H1, e);
        this.cell = lerp(tr.c0, tr.c1, e);
        if (tr.hop) {
          this.hopK = Math.sin(Math.PI * p);
          this.lift = this.hopK * tr.hopLift;
          sqT = p < HOP_SWAP ? -.08 : 0;
        } else {
          walkT = p < .97 ? 1 : 0;
          this.ph = tr.ph0 + e * tr.dist / (this.H * .9) * TAU;
        }
        if (!tr.swapped && p >= tr.swapAt) { tr.swapped = true; this.pose = tr.pose1; }
        if (p >= 1) {
          this.x = tr.x1; this.y = tr.y1; this.H = tr.H1; this.cell = tr.c1;
          this.lift = 0; this.hopK = 0; this.sq = .17; this.sqV = 0;
          this.pose = tr.pose1;
          this.tr = null;
          tr.onland?.();
        }
      }
    }
    this.walk = lerp(this.walk, walkT, 1 - Math.exp(-dt * 12));
    this.fx = lerp(this.fx, fxT, 1 - Math.exp(-dt * 16));
    if (Math.abs(this.fx - fxT) < .004) this.fx = fxT;
    if (this.walk < .004 && !walkT) this.walk = 0;
    // the squash is a spring toward its target, and rests at exactly zero
    this.sqV += ((sqT - this.sq) * 260 - this.sqV * 15) * dt;
    this.sq += this.sqV * dt;
    if (!sqT && Math.abs(this.sq) < .002 && Math.abs(this.sqV) < .02) { this.sq = 0; this.sqV = 0; }
  }

  /**
   * His joints for this frame. `still` is reduced motion: the pose is taken at
   * once, and there is no bob, sway or easing of the glow.
   */
  frame(dt: number, still: boolean): { st: FigureState; t: number; glow: number } {
    const tg = poseOf(this.pose), S = this.S;
    if (still) {
      Object.assign(S, tg);
      this.glow = GLOW[this.pose] || 0;
      this.osc = 0;
    } else {
      spring(S, this.V, tg, dt);
      this.osc = lerp(this.osc, this.pose === "wave" ? 1 : 0, 1 - Math.exp(-dt * 6));
      this.nod = lerp(this.nod, this.pose === "nod" ? 1 : 0, 1 - Math.exp(-dt * 6));
      // waiting blinks his antenna; every other glow eases to its level
      const gt = this.pose === "wait" ? (Math.sin(this.t * TAU * 1.2) > 0 ? 1 : .05) : (GLOW[this.pose] || 0);
      this.glow = lerp(this.glow, gt, 1 - Math.exp(-dt * (this.pose === "wait" ? 14 : 4)));
    }
    const H = this.H, t = still ? .5 : (this.t += dt);
    const w = this.walk, hk = this.hopK, sw = Math.sin(this.ph) * w, A = .55;
    const legs = hk > .01
      ? [{ th: -.32 * hk, lift: .07 * H * hk }, { th: .32 * hk, lift: .07 * H * hk }]
      : [
          { th: sw * A, lift: Math.max(0, Math.cos(this.ph)) * .05 * H * w },
          { th: -sw * A, lift: Math.max(0, -Math.cos(this.ph)) * .05 * H * w },
        ];
    const wa = WALKARMS[this.pose] ? .5 * sw : 0;
    const st: FigureState = {
      ra: [S.ra0 + (this.pose === "walk" ? wa : 0), S.ra1 + .34 * this.osc * Math.sin(t * TAU * 1.45)],
      la: [S.la0 + wa, S.la1],
      brows: S.brows, tilt: S.tilt,
      mouth: S.grin > .5 ? "grin" : "smile",
      legs,
      drop: hk > .01 ? 0 : .21 * H * (1 - Math.cos(sw * A)),
      bob: still ? 0
        : Math.sin(t * TAU * .9) * .008 * H - S.hop * Math.abs(Math.sin(t * TAU * 1.1)) * .03 * H
          + this.nod * Math.abs(Math.sin(t * TAU * 1.6)) * .03 * H,
      swayK: still ? 0 : 1,
      antWob: 0,
      walkK: w,
      look: [S.lx, S.ly],
      thumb: S.thumb, point: S.point,
    };
    return { st, t, glow: this.glow };
  }
}
