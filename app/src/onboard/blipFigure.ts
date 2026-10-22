/**
 * BLIP, THE DOTTED CHARACTER: THE FIGURE, THE POSES, THE DITHER.
 *
 * Ported line for line from the approved prototype (assistant/index.html) and
 * from the site's hero, so he is the same character on the phone, on the
 * desktop and on the web. Three parts:
 *
 *   figure()   draws him in greys, with a plain 2D-canvas vocabulary.
 *   dither()   reads those greys back and turns them into the dots: an ink
 *              "sticker" grown one cell around him, and the pale dots the
 *              Bayer pattern lets through.
 *   POSES      what each pose asks of his joints, and the spring that gets
 *              him there.
 *
 * Nothing here knows about Skia or React Native. The figure is written against
 * the small Ctx2D below, which is a strict subset of the HTML canvas, so the
 * same code runs on a real canvas (the desktop, the tests) and on Skia
 * (skiaCtx.ts). Arcs and ellipses are walked as short straight segments here
 * rather than asked of the context, so the context needs no arc support at
 * all: at the size he is drawn at (one cell is about two points) a 40-sided
 * circle is a circle.
 */

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// --- The drawing vocabulary -------------------------------------------------

export interface Grad { addColorStop(offset: number, color: string): void }

export interface Ctx2D {
  fillStyle: string | Grad;
  strokeStyle: string;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "round" | "miter" | "bevel";
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Grad;
}

/** A grey from 0 (black) to 1 (white), as a colour string both canvases and Skia read. */
export function grey(l: number): string {
  const v = Math.round(clamp(l) * 255);
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

/** Segments for an arc of `sweep` radians: about a fortieth of a turn each. */
const segs = (sweep: number) => Math.max(4, Math.ceil(Math.abs(sweep) / (TAU / 40)));

/** An arc as straight segments, starting a fresh sub-path at its first point. */
export function arcPath(g: Ctx2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const n = segs(a1 - a0);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
}

/** An ellipse (rotated by `rot`) as straight segments, from angle a0 to a1. */
export function ellipsePath(
  g: Ctx2D, cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number,
): void {
  const n = segs(a1 - a0), cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
    const x = cx + ex * cr - ey * sr, y = cy + ex * sr + ey * cr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
}

/** A rounded rectangle path. Corners are quarter-arcs walked as segments. */
export function roundRect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  const corner = (cx: number, cy: number, a0: number, first: boolean) => {
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (first && i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
  };
  corner(x + w - rr, y + rr, -Math.PI / 2, true);
  corner(x + w - rr, y + h - rr, 0, false);
  corner(x + rr, y + h - rr, Math.PI / 2, false);
  corner(x + rr, y + rr, Math.PI, false);
  g.closePath();
}

// --- Poses ------------------------------------------------------------------

/** What a pose asks of his joints. The spring moves him toward these. */
export interface PoseTarget {
  ra0: number; ra1: number; la0: number; la1: number;
  tilt: number; brows: number; lx: number; ly: number;
  thumb: number; point: number; hop: number; grin: number;
}

export type PoseName =
  | "present" | "tap" | "pointd" | "tada" | "thumbs" | "wave" | "listen"
  | "carry" | "wait" | "key" | "nod" | "think" | "walk";

const P = (
  ra0: number, ra1: number, la0: number, la1: number, tilt: number, brows: number,
  lx: number, ly: number, thumb: number, point: number, hop: number, grin: number,
): PoseTarget => ({ ra0, ra1, la0, la1, tilt, brows, lx, ly, thumb, point, hop, grin });

const BASE: Record<string, PoseTarget> = {
  present: P(1.22, .4, .2, .16, -.03, .45, .9, -.35, 0, 0, 0, 0),
  tap: P(1.8, .06, .18, .14, -.05, .55, 1, -.45, 0, 1, 0, 0),
  pointd: P(1.0, .25, .2, .16, -.04, .6, .9, .3, 0, 1, 0, 0),
  tada: P(2.62, .24, 2.62, .24, 0, .9, .3, -.2, 0, 0, 1, 1),
  thumbs: P(.62, 1.92, .18, .14, -.06, .7, .4, -.1, 1, 0, 0, 1),
  wave: P(2.5, -.55, .16, .12, -.06, .75, .1, 0, 0, 0, 0, 1),
  listen: P(2.5, 1.0, .2, .16, -.13, .8, .6, -.2, 0, 0, 0, 0),
  carry: P(1.5, -.3, .35, .2, -.04, .6, .8, .2, 0, 0, 0, 1),
  wait: P(.35, .2, .2, .16, -.06, .5, .9, -.4, 0, 0, 0, 0),
  walk: P(.32, .22, .32, .2, -.03, .5, .9, -.1, 0, 0, 0, 0),
  think: P(1.9, 2.75, .2, .16, -.1, .9, .8, -.7, 0, 0, 0, 0),
};

/** Same targets as another pose: the key is held like the box, a nod is a thumbs-up. */
export const POSES: Record<string, PoseTarget> = {
  ...BASE,
  key: BASE.carry,
  nod: BASE.thumbs,
};

/** How much his antenna glows in each pose. Absent means none. */
export const GLOW: Record<string, number> = { listen: 1, tada: .9, wait: 1 };

/** Poses whose arms swing while he walks (walk itself swings the right one too). */
export const WALKARMS: Record<string, number> = { walk: 1, wave: 1, key: 1, carry: 1 };

export function poseOf(name: string): PoseTarget {
  return POSES[name] ?? POSES.present;
}

/**
 * One step of the spring that carries his joints to a pose: stiffness 150,
 * damping 17, with the time step capped so a slow frame cannot fling a limb.
 */
export function spring(S: Record<string, number>, V: Record<string, number>, tg: object, dt: number): void {
  const h = Math.min(dt, .05);
  const target = tg as Record<string, number>;
  for (const k in target) {
    const x = S[k], v = V[k] || 0, acc = (target[k] - x) * 150 - v * 17;
    V[k] = v + acc * h;
    S[k] = x + V[k] * h;
  }
}

// --- The figure -------------------------------------------------------------

/** What the figure needs to know to draw one frame. */
export interface FigureState {
  bob: number; drop: number; swayK: number; antWob: number; walkK: number;
  legs: { th: number; lift: number }[];
  ra: [number, number]; la: [number, number];
  tilt: number; brows: number; mouth: "grin" | "smile";
  look: [number, number]; thumb: number; point: number;
}

function arm(g: Ctx2D, H: number, sx: number, sy: number, s: number, a1: number, a2: number): [number, number] {
  const L1 = .2 * H, L2 = .18 * H;
  const ex = sx + s * Math.sin(a1) * L1, ey = sy + Math.cos(a1) * L1;
  const a = a1 + a2;
  const hx = ex + s * Math.sin(a) * L2, hy = ey + Math.cos(a) * L2;
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = grey(.5); g.lineWidth = .085 * H;
  g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
  g.strokeStyle = grey(.68); g.lineWidth = .028 * H;
  g.beginPath(); g.moveTo(sx - s * .012 * H, sy - .02 * H); g.lineTo(ex - s * .012 * H, ey - .02 * H); g.stroke();
  const px = hx + s * Math.sin(a) * .035 * H, py = hy + Math.cos(a) * .035 * H;
  g.fillStyle = grey(.84);
  g.beginPath(); arcPath(g, px, py, .052 * H, 0, TAU); g.fill();
  return [px, py];
}

/** Draws him in greys into a W by H box. Returns where his hand and antenna ball ended up. */
export function figure(
  g: Ctx2D, W: number, H: number, st: FigureState, t: number,
): { hand: [number, number]; ball: [number, number] } {
  const cx = W / 2, bob = st.bob, sway = Math.sin(t * TAU * .45) * .025 * st.swayK, drop = st.drop;
  // legs, with their striped socks and shoes
  [-1, 1].forEach((s, i) => {
    const L = st.legs[i], hx = cx + s * .06 * H, hy = .72 * H + drop, len = .21 * H;
    const ax = hx + Math.sin(L.th) * len + s * .012 * H, ay = hy + Math.cos(L.th) * len - L.lift;
    g.strokeStyle = grey(.34); g.lineWidth = .034 * H; g.lineCap = "round";
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(ax, ay); g.stroke();
    g.lineCap = "butt"; g.lineWidth = .038 * H;
    for (let k = 0; k < 4; k++) {
      const f0 = .5 + k * .105, f1 = f0 + .105;
      g.strokeStyle = grey(k % 2 ? .88 : .16);
      g.beginPath(); g.moveTo(lerp(hx, ax, f0), lerp(hy, ay, f0)); g.lineTo(lerp(hx, ax, f1), lerp(hy, ay, f1)); g.stroke();
    }
    const dir = lerp(s, 1, st.walkK);
    g.save();
    g.translate(ax + dir * .038 * H, ay + .026 * H);
    g.rotate(-L.lift / H * 2.2 * Math.sign(dir || 1));
    g.fillStyle = grey(.14);
    g.beginPath(); ellipsePath(g, 0, 0, .105 * H, .04 * H, 0, 0, TAU); g.fill();
    g.fillStyle = grey(.42);
    g.beginPath(); ellipsePath(g, dir * .005 * H, -.016 * H, .065 * H, .013 * H, 0, 0, TAU); g.fill();
    g.restore();
  });
  // body: a striped jumper, clipped to its own shape
  const top = .52 * H + bob + drop, bot = .75 * H + drop;
  g.save();
  g.beginPath();
  g.moveTo(cx - .085 * H, top);
  g.quadraticCurveTo(cx - .2 * H, bot, cx - .17 * H, bot);
  g.lineTo(cx + .17 * H, bot);
  g.quadraticCurveTo(cx + .2 * H, bot, cx + .085 * H, top);
  g.closePath();
  g.clip();
  for (let i = 0; i < 7; i++) {
    g.fillStyle = grey(i % 2 ? .66 : .38);
    g.fillRect(cx - .22 * H, top + i * .035 * H, .44 * H, .035 * H);
  }
  g.restore();
  // arms, and a pointing finger or a thumb on the right hand
  const hand = arm(g, H, cx + .1 * H, top + .035 * H, 1, st.ra[0], st.ra[1]);
  if (st.point > .02 || st.thumb > .02) {
    const a = st.ra[0] + st.ra[1];
    g.strokeStyle = grey(.84); g.lineCap = "round";
    if (st.point > .02) {
      g.lineWidth = .026 * H;
      g.beginPath(); g.moveTo(hand[0], hand[1]);
      g.lineTo(hand[0] + Math.sin(a) * .075 * H * st.point, hand[1] + Math.cos(a) * .075 * H * st.point);
      g.stroke();
    }
    if (st.thumb > .02) {
      g.lineWidth = .032 * H;
      g.beginPath(); g.moveTo(hand[0], hand[1] - .02 * H);
      g.lineTo(hand[0] - .006 * H, hand[1] - .02 * H - .055 * H * st.thumb);
      g.stroke();
    }
  }
  arm(g, H, cx - .1 * H, top + .035 * H, -1, st.la[0], st.la[1]);
  // neck
  g.strokeStyle = grey(.72); g.lineWidth = .028 * H; g.lineCap = "round";
  g.beginPath(); g.moveTo(cx, top + .01 * H);
  g.quadraticCurveTo(cx + .035 * H, .49 * H + bob + drop, cx, .44 * H + bob + drop);
  g.stroke();
  // head, tilted about its base
  const hx = cx, hy = .3 * H + bob + drop, R = .16 * H, rot = st.tilt + sway;
  g.save();
  g.translate(hx, hy + R); g.rotate(rot); g.translate(-hx, -(hy + R));
  const wob = Math.sin(t * TAU * 1.6) * .025 * H + st.antWob;
  // antennae
  g.strokeStyle = grey(.55); g.lineWidth = .012 * H;
  g.beginPath(); g.moveTo(hx - .05 * H, hy - R * .9);
  g.quadraticCurveTo(hx - .11 * H, hy - R * 1.35, hx - .065 * H + wob, hy - R * 1.55);
  g.stroke();
  g.fillStyle = grey(.96);
  g.beginPath(); arcPath(g, hx - .065 * H + wob, hy - R * 1.55, .024 * H, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(hx + .055 * H, hy - R * .88);
  g.lineTo(hx + .09 * H, hy - R * 1.22); g.lineTo(hx + .135 * H, hy - R * 1.16);
  g.stroke();
  // head shell, lit from the upper left
  const sg = g.createRadialGradient(hx - .06 * H, hy - .06 * H, 0, hx, hy, R * 1.3);
  sg.addColorStop(0, grey(.93)); sg.addColorStop(.6, grey(.75)); sg.addColorStop(1, grey(.46));
  g.fillStyle = sg;
  g.beginPath(); ellipsePath(g, hx, hy, R * 1.1, R * .94, 0, 0, TAU); g.fill();
  // ears
  g.fillStyle = grey(.5);
  [-1, 1].forEach((s) => {
    roundRect(g, hx + s * R * 1.1 - .012 * H, hy - .015 * H, .024 * H, .03 * H, .006 * H);
    g.fill();
  });
  // the eye: blinks every 3.1 s, looks where the pose says
  const blink = ((t * 1000 + 300) % 3100) < 130, ex = hx - .005 * H, ey = hy - .012 * H, er = .082 * H;
  g.fillStyle = grey(.1);
  g.beginPath(); arcPath(g, ex, ey, er + .011 * H, 0, TAU); g.fill();
  if (!blink) {
    g.fillStyle = grey(.99);
    g.beginPath(); arcPath(g, ex, ey, er, 0, TAU); g.fill();
    const lx = st.look[0] * .034 * H, ly = .004 * H + st.look[1] * .026 * H;
    g.fillStyle = grey(.05);
    g.beginPath(); arcPath(g, ex + lx, ey + ly, .036 * H, 0, TAU); g.fill();
    g.fillStyle = grey(.99);
    g.beginPath(); arcPath(g, ex + lx - .011 * H, ey + ly - .012 * H, .009 * H, 0, TAU); g.fill();
    g.fillStyle = grey(.62);
    g.beginPath(); arcPath(g, ex, ey, er + .002 * H, Math.PI * 1.1, Math.PI * 1.9); g.closePath(); g.fill();
  } else {
    g.fillStyle = grey(.62);
    g.beginPath(); arcPath(g, ex, ey, er, 0, TAU); g.fill();
    g.strokeStyle = grey(.1); g.lineWidth = .013 * H;
    g.beginPath(); g.moveTo(ex - er * .8, ey + .01 * H); g.lineTo(ex + er * .8, ey + .01 * H); g.stroke();
  }
  // brow
  g.strokeStyle = grey(.1); g.lineWidth = .017 * H; g.lineCap = "round";
  g.beginPath(); arcPath(g, ex, ey - .016 * H - st.brows * .018 * H, er * 1.2, Math.PI * 1.22, Math.PI * 1.78); g.stroke();
  // freckles
  g.fillStyle = grey(.3);
  ([[.075, .055], [.095, .07], [.07, .08]] as const).forEach(([dx, dy]) => {
    g.beginPath(); arcPath(g, hx + dx * H, hy + dy * H, .006 * H, 0, TAU); g.fill();
  });
  // mouth
  const mx = hx + .035 * H, my = hy + .105 * H;
  if (st.mouth === "grin") {
    g.fillStyle = grey(.08);
    g.beginPath(); ellipsePath(g, mx, my, .05 * H, .03 * H, -.15, 0, Math.PI); g.fill();
    g.fillStyle = grey(.97); g.fillRect(mx - .012 * H, my - .002 * H, .02 * H, .014 * H);
  } else {
    g.strokeStyle = grey(.1); g.lineWidth = .014 * H;
    g.beginPath(); arcPath(g, mx, my - .022 * H, .04 * H, Math.PI * .2, Math.PI * .75); g.stroke();
    g.fillStyle = grey(.97); g.fillRect(mx - .004 * H, my + .012 * H, .014 * H, .012 * H);
  }
  g.restore();
  // where the antenna ball is, after the head's tilt
  const bx = hx - .065 * H + wob - hx, by = hy - R * 1.55 - (hy + R), c = Math.cos(rot), s = Math.sin(rot);
  return { hand, ball: [hx + bx * c - by * s, hy + R + bx * s + by * c] };
}

// --- The dither -------------------------------------------------------------

/**
 * The 8 by 8 Bayer matrix. A cell is lit when its brightness beats its entry,
 * which is what turns a smooth grey figure into dots.
 */
export const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

/**
 * A small surface to draw the greys on and read back. skiaCtx.ts makes one over
 * a CPU raster; the tests make one that records.
 */
export interface Raster {
  /** A cleared bw by bh surface's drawing context. */
  begin(bw: number, bh: number): Ctx2D;
  /** What was drawn, as RGBA bytes (not premultiplied), bw*bh*4 long. Null if it cannot be read. */
  pixels(): ArrayLike<number> | null;
}

export interface DitherIn {
  H: number;
  /** One grey pixel is this many points on screen. */
  cell: number;
  /** Where his feet are, in the picture he is drawn into. */
  x: number;
  y: number;
  /** Horizontal facing: 1 right, -1 left, between them while he turns. */
  sx?: number;
  lift?: number;
  padX?: number;
  st: FigureState;
  t: number;
  glow: number;
}

export interface DitherOut {
  /** Centres of the ink sticker's dots, x y x y ... and how big each is. */
  sticker: number[];
  stickerR: number;
  /** Centres of the pale dots. */
  dots: number[];
  dotR: number;
  /** The soft shadow under his feet. */
  shadow: { x: number; y: number; rx: number; ry: number; a: number };
  /** The antenna's glow, or null when it is off. */
  glow: { x: number; y: number; r: number; a: number } | null;
  hand: [number, number];
  ball: [number, number];
}

/**
 * Draw the figure into a tiny raster (one cell per pixel), read it back, and
 * turn it into dots. The sticker is every cell that is lit or touches a lit
 * one, drawn a little wider than a pale dot so it reads as an ink edge; the
 * pale dots are the cells whose brightness beats the Bayer threshold.
 *
 * Returns a function that keeps its work buffer between frames: this runs
 * thirty times a second.
 */
export function makeDither() {
  let on = new Uint8Array(0);
  return function dither(raster: Raster, o: DitherIn): DitherOut | null {
    const H = o.H, W = H * .84, cell = o.cell, PX = o.padX || 0, TOP = .14 * H;
    const bw = Math.ceil((W + PX * 2) / cell), bh = Math.ceil((H + TOP) / cell) + 1, lift = o.lift || 0;
    const g = raster.begin(bw, bh);
    g.save();
    g.scale(1 / cell, 1 / cell);
    g.translate(PX, TOP);
    const sx0 = o.sx === undefined ? 1 : o.sx;
    // Turning through zero would flatten him to a line; keep a sliver.
    const sx = Math.abs(sx0) < .06 ? (sx0 < 0 ? -.06 : .06) : sx0;
    if (sx !== 1) { g.translate(W / 2, 0); g.scale(sx, 1); g.translate(-W / 2, 0); }
    const f = figure(g, W, H, o.st, o.t);
    g.restore();
    const map = (fx: number, fy: number): [number, number] => [o.x + (fx - W / 2) * sx, o.y - lift - H + fy];
    const src = raster.pixels();
    if (!src || src.length < bw * bh * 4) return null;
    const ox = o.x - W / 2 - PX, oy = o.y - lift - H - TOP;
    // His shadow shrinks and fades as he leaves the ground.
    const sk = 1 - clamp(lift / (H * .3)) * .5;
    if (on.length < bw * bh) on = new Uint8Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) on[i] = src[i * 4 + 3] > 60 ? 1 : 0;
    const sticker: number[] = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let hit = on[y * bw + x];
        if (!hit) {
          for (let j = -1; j <= 1 && !hit; j++) {
            for (let i = -1; i <= 1 && !hit; i++) {
              const xx = x + i, yy = y + j;
              if (xx >= 0 && yy >= 0 && xx < bw && yy < bh && on[yy * bw + xx]) hit = 1;
            }
          }
        }
        if (hit) sticker.push(ox + x * cell + cell / 2, oy + y * cell + cell / 2);
      }
    }
    const dots: number[] = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = (y * bw + x) * 4, a = src[i + 3];
        if (a < 90) continue;
        const lum = (src[i] * .3 + src[i + 1] * .59 + src[i + 2] * .11) / 255 * (a / 255);
        if (lum > (BAYER[(y & 7) * 8 + (x & 7)] + .5) / 64) dots.push(ox + x * cell + cell / 2, oy + y * cell + cell / 2);
      }
    }
    const hand = map(f.hand[0], f.hand[1]), ball = map(f.ball[0], f.ball[1]);
    return {
      sticker, stickerR: cell * .64,
      dots, dotR: cell * .46,
      shadow: { x: o.x, y: o.y - .004 * H, rx: H * .2 * sk, ry: H * .022 * sk, a: .1 * sk },
      glow: o.glow > .02 ? { x: ball[0], y: ball[1], r: H * .05, a: o.glow } : null,
      hand, ball,
    };
  };
}

// --- Props he carries ---------------------------------------------------------

/**
 * The little things he holds: a tile with a number (the app he carries over)
 * and a key (the way in). Drawn on top of the dots, in plain strokes, because
 * a prop is an object and not part of him. `hand` is where his hand is.
 */
export function drawProp(
  g: Ctx2D, pose: string, H: number, hand: [number, number], t: number, still: boolean,
  ink = "#151311", paper = "#FCFBF8", neon = "#39FF14",
): void {
  if (pose === "carry") {
    const s = H * .3, [x, y] = hand;
    g.save();
    g.translate(x, y - s * .62);
    g.rotate(still ? 0 : Math.sin(t * 2.2) * .05);
    g.fillStyle = paper; g.strokeStyle = ink; g.lineWidth = 1.8;
    roundRect(g, -s / 2, -s / 2, s, s, s * .2); g.fill(); g.stroke();
    // the tile's header band
    g.fillStyle = ink;
    roundRect(g, -s / 2, -s / 2, s, s * .3, s * .2); g.fill();
    g.fillRect(-s / 2, -s * .3, s, s * .12);
    // the day on it, "17", as two strokes of ink: the context has no text
    g.strokeStyle = ink; g.lineWidth = s * .075; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(-s * .17, s * .09); g.lineTo(-s * .1, s * .02); g.lineTo(-s * .1, s * .32); g.stroke();
    g.beginPath(); g.moveTo(s * .03, s * .02); g.lineTo(s * .17, s * .02); g.lineTo(s * .08, s * .32); g.stroke();
    g.restore();
  } else if (pose === "key") {
    const s = H * .34, [x, y] = hand;
    g.save();
    g.translate(x, y - s * .55);
    g.rotate(.18 + (still ? 0 : Math.sin(t * 2.2) * .05));
    g.fillStyle = paper; g.strokeStyle = ink; g.lineWidth = 1.8; g.lineJoin = "round";
    roundRect(g, -s * .07, -s * .12, s * .14, s * .62, s * .05); g.fill(); g.stroke();
    roundRect(g, s * .07, s * .26, s * .18, s * .08, s * .02); g.fill(); g.stroke();
    roundRect(g, s * .07, s * .4, s * .13, s * .08, s * .02); g.fill(); g.stroke();
    g.beginPath(); arcPath(g, 0, -s * .3, s * .22, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = neon;
    g.beginPath(); arcPath(g, 0, -s * .3, s * .08, 0, TAU); g.fill(); g.stroke();
    g.restore();
  }
}

/** True when a pose carries a prop that needs drawing after the dots. */
export const hasProp = (pose: string): boolean => pose === "carry" || pose === "key";
