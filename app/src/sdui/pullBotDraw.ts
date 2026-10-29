/**
 * PULL-A-BOT'S DRAWING: the approved prototype's drawBot, on a Skia canvas (PullBot.tsx records it on the UI thread; a
 * check can run it in Node over CanvasKit, through react-native-skia's web Skia).
 *
 *   makeKit(sk, look, scale)            once per look and size, on the JS thread: every paint, shader, blur and shape
 *                                       (in the bot's own units), so a frame makes nothing.
 *   drawScene(cv, s, c, g, K)           a frame: the soft shadow where the gap opens, the bot in the gap while pulled
 *                                       (feet first from the top, head first from the bottom), free once riding and
 *                                       flying (with speed lines), and the dust. A worklet; Skia-free (no rect made per
 *                                       frame: a unit rect under a scale, the clip kept once the scale is undone).
 *
 * The canvas's shadows become blurred copies drawn first (shadowBlur 8 and 5 CSS px: a Gaussian of half that, in the
 * bot's units, so it scales with him); the antenna's quadratic curve is eight short round-capped lines; an eye's rounded
 * rect is one round-capped line. Everything else is the prototype's shape for shape.
 *
 * No imports but types: the caller hands in its Skia and the enums.
 */
import type { SkCanvas, SkPaint, SkPoint, SkRect, SkRRect, SkShader, SkMaskFilter, SkColor, SkPictureRecorder } from "@shopify/react-native-skia";
import {
  ANT, BOT_FLY, BOT_NONE, BOT_PULL, C_SCALE, FACE_EFFORT, FACE_HAPPY, FACE_WHEE, FACE_WOW, faceOf, FEET, G_BOT, G_TOP, G_W, PUFF_LEN, PUFFS,
  S_ANT, S_ARM_L, S_ARM_R, S_B, S_BE, S_BLINK, S_EX, S_LEG_L, S_LEG_R, S_LOOK, S_P, S_PE, S_PO, S_PUFF, S_ROT, S_SQ, S_VX, S_VY, S_X, S_Y,
  type PullLook,
} from "./pullBotCore.ts";

/** What makeKit needs of a Skia: the native one (react-native-skia) or the web one over CanvasKit. */
export interface SkiaLike {
  Skia: {
    Paint(): SkPaint;
    Color(c: string): SkColor;
    XYWHRect(x: number, y: number, w: number, h: number): SkRect;
    RRectXY(r: SkRect, rx: number, ry: number): SkRRect;
    MaskFilter: { MakeBlur(style: number, sigma: number, respectCTM: boolean): SkMaskFilter };
    Shader: { MakeLinearGradient(a: SkPoint, b: SkPoint, colors: SkColor[], pos: number[] | null, mode: number): SkShader };
    PictureRecorder(): SkPictureRecorder;
  };
  PaintStyle: { Fill: number; Stroke: number };
  StrokeCap: { Round: number };
  StrokeJoin: { Round: number };
  BlurStyle: { Normal: number };
  TileMode: { Clamp: number };
  ClipOp: { Intersect: number };
  vec(x: number, y: number): SkPoint;
}

/** Everything a frame draws with. */
export interface Kit {
  leg: SkPaint; arm: SkPaint; accent: SkPaint; chest: SkPaint; body: SkPaint; hi22: SkPaint; hi55: SkPaint;
  antenna: SkPaint; rim: SkPaint; hand: SkPaint; head: SkPaint; visor: SkPaint;
  face: SkPaint; faceLine: SkPaint; eye: SkPaint; shine: SkPaint; shineLine: SkPaint; shineEye: SkPaint;
  speed: SkPaint; puff: SkPaint; gap: SkPaint;
  rBody: SkRRect; rBodyHi: SkRRect; rHead: SkRRect; rHeadHi: SkRRect; rVisor: SkRRect; rFoot: SkRRect; rMouth: SkRRect;
  oWhee: SkRect; oWow: SkRect; arcL: SkRect; arcR: SkRect;
  /** A 1 x 1 rect at the origin: scaled to any rect a frame needs. */
  unit: SkRect;
  intersect: number;
}

const DEG = 180 / Math.PI;

export function makeKit(sk: SkiaLike, look: PullLook, scale: number): Kit {
  const { Skia } = sk;
  const fill = (c: string): SkPaint => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setStyle(sk.PaintStyle.Fill);
    p.setColor(Skia.Color(c));
    return p;
  };
  const stroke = (c: string, w: number): SkPaint => {
    const p = fill(c);
    p.setStyle(sk.PaintStyle.Stroke);
    p.setStrokeWidth(w);
    p.setStrokeCap(sk.StrokeCap.Round);
    p.setStrokeJoin(sk.StrokeJoin.Round);
    return p;
  };
  // The prototype's canvas shadows (shadowBlur 8 and 5 CSS px: a blur of half that), in the bot's own units.
  const blur = (p: SkPaint, cssBlur: number): SkPaint => {
    p.setMaskFilter(Skia.MaskFilter.MakeBlur(sk.BlurStyle.Normal, cssBlur / 2 / scale, true));
    return p;
  };
  const rr = (x: number, y: number, w: number, h: number, r: number): SkRRect => {
    const k = Math.max(0, Math.min(r, w / 2, h / 2));
    return Skia.RRectXY(Skia.XYWHRect(x, y, w, h), k, k);
  };
  const head = fill(look.shellTop);
  head.setShader(Skia.Shader.MakeLinearGradient(sk.vec(0, -25), sk.vec(0, 25), [Skia.Color(look.shellTop), Skia.Color(look.shellBottom)], null, sk.TileMode.Clamp));
  const gap = fill("#141615");
  gap.setShader(Skia.Shader.MakeLinearGradient(sk.vec(0, 0), sk.vec(0, 16), [Skia.Color("rgba(20,22,21,0.10)"), Skia.Color("rgba(20,22,21,0)")], null, sk.TileMode.Clamp));
  const chest = blur(fill(look.accent), 8);
  chest.setAlphaf(0.9);
  return {
    leg: stroke(look.limb, 8), arm: stroke(look.limb, 7.5), accent: fill(look.accent), chest, body: fill(look.body),
    hi22: fill("rgba(255,255,255,0.22)"), hi55: fill("rgba(255,255,255,0.55)"),
    antenna: stroke(look.shellBottom, 3.2), rim: stroke(look.shellBottom, 1.4), hand: fill(look.shellTop), head, visor: fill(look.visor),
    face: fill(look.glow), faceLine: stroke(look.glow, 3), eye: stroke(look.glow, 7),
    shine: blur(fill(look.shine), 5), shineLine: blur(stroke(look.shine, 3), 5), shineEye: blur(stroke(look.shine, 7), 5),
    speed: stroke("rgba(20,22,21,0.16)", 2.5), puff: fill(look.limb), gap,
    rBody: rr(-19, 21, 38, 32, 11), rBodyHi: rr(-13, 25, 8, 3.5, 1.7), rHead: rr(-32, -25, 64, 50, 18), rHeadHi: rr(-23, -21, 16, 4.5, 2.2),
    rVisor: rr(-24, -15.5, 48, 27, 12), rFoot: rr(-5, -2, 16, 8, 4), rMouth: rr(-4, 7, 8, 2.2, 1.1),
    oWhee: Skia.XYWHRect(-3.6, 8 - 4.2, 7.2, 8.4), oWow: Skia.XYWHRect(-2.5, 8.5 - 3, 5, 6),
    arcL: Skia.XYWHRect(-11 - 5.5, 3 - 5.5, 11, 11), arcR: Skia.XYWHRect(11 - 5.5, 3 - 5.5, 11, 11),
    unit: Skia.XYWHRect(0, 0, 1, 1), intersect: sk.ClipOp.Intersect,
  };
}

/** An eye: the prototype's rounded rect (7 wide, eh tall, radius 3.5) as one round-capped line. */
function eye(cv: SkCanvas, x: number, fy: number, eh: number, p: SkPaint): void {
  "worklet";
  const h = Math.max(1, eh);
  if (h >= 7) {
    p.setStrokeWidth(7);
    cv.drawLine(x, fy - h / 2 + 3.5, x, fy + h / 2 - 3.5, p);
  } else {
    p.setStrokeWidth(h);
    cv.drawLine(x - 3.5 + h / 2, fy, x + 3.5 - h / 2, fy, p);
  }
}

/** His face on the visor (FACE_*), its glow under it first: the prototype's shadow under each shape. */
function drawFace(cv: SkCanvas, s: number[], K: Kit): void {
  "worklet";
  const fy = -2 + s[S_LOOK];
  const face = faceOf(s);
  for (let pass = 0; pass < 2; pass++) {
    const f = pass === 0 ? K.shine : K.face, l = pass === 0 ? K.shineLine : K.faceLine;
    if (face === FACE_HAPPY) {
      cv.save(); cv.translate(0, fy);
      cv.drawArc(K.arcL, 207, 126, false, l); cv.drawArc(K.arcR, 207, 126, false, l);
      cv.restore();
    } else if (face === FACE_EFFORT || face === FACE_WHEE) {
      for (let k = 0; k < 2; k++) {
        const sg = k === 0 ? -1 : 1;
        cv.drawLine(sg * 15, fy - 5, sg * 8, fy, l); cv.drawLine(sg * 8, fy, sg * 15, fy + 5, l);
      }
      cv.save(); cv.translate(0, fy);
      if (face === FACE_WHEE) cv.drawOval(K.oWhee, f); else cv.drawRRect(K.rMouth, f);
      cv.restore();
    } else if (face === FACE_WOW) {
      cv.drawCircle(-11, fy, 4.6, f); cv.drawCircle(11, fy, 4.6, f);
      cv.save(); cv.translate(0, fy); cv.drawOval(K.oWow, f); cv.restore();
    } else {
      const e = pass === 0 ? K.shineEye : K.eye, eh = 11 * s[S_BLINK];
      eye(cv, -11, fy, eh, e); eye(cv, 11, fy, eh, e);
    }
  }
}

/** The bot, the prototype's drawBot: legs and feet, body, chest light, ears and antenna, head, visor, face, arms in front. */
export function drawBot(cv: SkCanvas, s: number[], c: number[], K: Kit): void {
  "worklet";
  const top = s[S_BE] === 0, phase = s[S_B], scale = c[C_SCALE];
  cv.save();
  cv.translate(s[S_X], s[S_Y]);
  if (phase === BOT_FLY) {
    const st = -s[S_SQ];
    cv.rotate(s[S_ROT] * DEG, 0, 0);
    cv.scale(scale * (1 - st * 0.5), scale * (1 + st));
  } else {
    cv.scale(scale, scale);
    const py = top ? FEET : -ANT;
    cv.translate(0, py); cv.scale(1 + s[S_SQ] * 0.6, 1 - s[S_SQ]); cv.translate(0, -py);
  }
  for (let k = 0; k < 2; k++) {
    const sg = k === 0 ? -1 : 1, a = k === 0 ? s[S_LEG_L] : s[S_LEG_R], hx = sg * 10, hy = 50;
    const ex = hx + sg * Math.sin(a) * 16, ey = hy + Math.cos(a) * 16;
    cv.drawLine(hx, hy, ex, ey, K.leg);
    cv.save(); cv.translate(ex, ey); cv.rotate((Math.atan2(ey - hy, ex - hx) - Math.PI / 2) * DEG, 0, 0); cv.scale(sg, 1);
    cv.drawRRect(K.rFoot, K.accent);
    cv.restore();
  }
  cv.drawRRect(K.rBody, K.body);
  cv.drawRRect(K.rBodyHi, K.hi22);
  if (s[S_EX] === 1 || phase !== BOT_PULL) cv.drawCircle(0, 37, 3.6, K.chest);
  cv.drawCircle(0, 37, 3.6, K.accent);
  cv.drawCircle(-32, 1, 6.5, K.accent); cv.drawCircle(32, 1, 6.5, K.accent);
  // The antenna: the prototype's quadratic from (0, -23) through (ax / 5, ay + 5) to its tip, in short round-capped lines.
  const ax = Math.sin(s[S_ANT]) * 14, ay = -24 - Math.cos(s[S_ANT]) * 14, cx = ax * 0.2, cy = ay + 5;
  let px = 0, py = -23;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, u = 1 - t;
    const qx = 2 * u * t * cx + t * t * ax, qy = u * u * -23 + 2 * u * t * cy + t * t * ay;
    cv.drawLine(px, py, qx, qy, K.antenna);
    px = qx; py = qy;
  }
  cv.drawCircle(ax, ay, 4.6, K.accent);
  cv.drawRRect(K.rHead, K.head);
  cv.drawRRect(K.rHeadHi, K.hi55);
  cv.drawRRect(K.rVisor, K.visor);
  drawFace(cv, s, K);
  for (let k = 0; k < 2; k++) {
    const sg = k === 0 ? -1 : 1, a = k === 0 ? s[S_ARM_L] : s[S_ARM_R], sx = sg * 18, sy = 29;
    const hx = sx + sg * Math.sin(a) * 22, hy = sy + Math.cos(a) * 22;
    cv.drawLine(sx, sy, hx, hy, K.arm);
    cv.drawCircle(hx, hy, 5.6, K.hand);
    cv.drawCircle(hx, hy, 5.6, K.rim);
  }
  cv.restore();
}

/** One frame of the overlay (its space: the window's top to the list's bottom edge; g says where the list's viewport is). */
export function drawScene(cv: SkCanvas, s: number[], c: number[], g: number[], K: Kit): void {
  "worklet";
  const on = s[S_P] === 1, off = on ? s[S_PO] : 0, W = g[G_W];
  // A soft shadow where the gap opens, under the edge it opens from.
  if (on && off > 0.5) {
    const top = s[S_PE] === 0, h = Math.min(16, off);
    cv.save();
    cv.translate(0, top ? g[G_TOP] : g[G_BOT]);
    if (!top) cv.scale(1, -1);
    cv.scale(W, h); cv.clipRect(K.unit, K.intersect, true); cv.scale(1 / W, 1 / h);
    cv.drawPaint(K.gap);
    cv.restore();
  }
  const phase = s[S_B];
  if (phase === BOT_PULL) {
    // Only inside the gap: feet first from the top, head first from the bottom.
    if (off > 0.25) {
      const gy = s[S_BE] === 0 ? g[G_TOP] : g[G_BOT] - off;
      cv.save();
      cv.translate(0, gy); cv.scale(W, off); cv.clipRect(K.unit, K.intersect, true); cv.scale(1 / W, 1 / off); cv.translate(0, -gy);
      drawBot(cv, s, c, K);
      cv.restore();
    }
  } else if (phase !== BOT_NONE) {
    if (phase === BOT_FLY) {
      const vx = s[S_VX], vy = s[S_VY], sp = Math.sqrt(vx * vx + vy * vy);
      if (sp > 1) {
        const len = Math.min(44, sp * 0.02), ux = -vx / sp, uy = -vy / sp;
        for (let k = -1; k <= 1; k++) {
          const o = k * 9, sx = s[S_X] + uy * o + ux * 24, sy = s[S_Y] - ux * o + uy * 24;
          cv.drawLine(sx, sy, sx + ux * len, sy + uy * len, K.speed);
        }
      }
    }
    drawBot(cv, s, c, K);
  }
  for (let k = 0; k < PUFFS; k++) {
    const p = S_PUFF + k * PUFF_LEN, life = s[p + 5];
    if (life <= 0) continue;
    K.puff.setAlphaf(life * 0.55);
    cv.drawCircle(s[p], s[p + 1], Math.max(0, s[p + 4]), K.puff);
  }
}
