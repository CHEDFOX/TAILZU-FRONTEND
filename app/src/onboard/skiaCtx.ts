/**
 * BLIP ON SKIA: THE 2D CONTEXT HE IS DRAWN WITH, AND THE PICTURE HE BECOMES.
 *
 * blipFigure.ts draws him against a small canvas-like vocabulary (Ctx2D) and
 * hands back dots. This file is the Skia half of that bargain:
 *
 *   SkiaCtx     Ctx2D over an SkCanvas, so the figure can be drawn by Skia.
 *   SkiaRaster  a small CPU surface the greys are drawn on and read back from.
 *               CPU on purpose: the readback is the point, and a GPU surface
 *               would have to be flushed and copied across for every frame.
 *   recordBlip  the dots, as one recorded SkPicture: the ink sticker, the pale
 *               dots, the antenna's glow and the prop in his hand.
 *
 * The picture is what the overlay's Canvas shows (through a shared value), so
 * it is drawn on the UI thread; this file runs on the JS thread and only ever
 * records. A frame is about a hundred drawing calls into the raster, one
 * readPixels, and two drawPoints (a point with a round cap is a dot, and one
 * call draws a few thousand of them; asking the path for a circle each would
 * be a few thousand calls across the bridge instead of two).
 */
import {
  AlphaType,
  ClipOp,
  ColorType,
  PaintStyle,
  PointMode,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkCanvas,
  type SkColor,
  type SkPaint,
  type SkPathBuilder,
  type SkPicture,
  type SkSurface,
} from "@shopify/react-native-skia";
import { drawProp, hasProp, type Ctx2D, type DitherOut, type Grad, type Raster } from "./blipFigure.ts";

// Colours are parsed once. The figure uses a few hundred distinct greys at most.
const colors = new Map<string, SkColor>();
function col(c: string): SkColor {
  let v = colors.get(c);
  if (!v) {
    v = Skia.Color(c);
    if (colors.size > 512) colors.clear();
    colors.set(c, v);
  }
  return v;
}

class SkGrad implements Grad {
  stops: [number, string][] = [];
  x0: number; y0: number; r0: number; x1: number; y1: number; r1: number;
  constructor(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
    this.x0 = x0; this.y0 = y0; this.r0 = r0; this.x1 = x1; this.y1 = y1; this.r1 = r1;
  }
  addColorStop(offset: number, color: string): void { this.stops.push([offset, color]); }
}

const CAPS = { butt: StrokeCap.Butt, round: StrokeCap.Round, square: StrokeCap.Square } as const;
const JOINS = { miter: StrokeJoin.Miter, round: StrokeJoin.Round, bevel: StrokeJoin.Bevel } as const;

/** A canvas-shaped wrapper over an SkCanvas. Only what blipFigure.ts uses. */
export class SkiaCtx implements Ctx2D {
  fillStyle: string | Grad = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineCap: "butt" | "round" | "square" = "butt";
  lineJoin: "round" | "miter" | "bevel" = "miter";
  /** Multiplies every colour's alpha (the living tiles draw their faint fabric and props with it). */
  globalAlpha = 1;
  private canvas: SkCanvas;
  private paint: SkPaint;
  // A PathBuilder, not a mutable SkPath: Skia 2 deprecates building on the
  // path itself (it warns once per method, and will stop working).
  private path: SkPathBuilder;

  constructor(canvas: SkCanvas) {
    this.canvas = canvas;
    this.paint = Skia.Paint();
    this.paint.setAntiAlias(true);
    this.path = Skia.PathBuilder.Make();
  }

  save(): void { this.canvas.save(); }
  restore(): void { this.canvas.restore(); }
  translate(x: number, y: number): void { this.canvas.translate(x, y); }
  // The canvas turns in radians and Skia in degrees.
  rotate(rad: number): void { this.canvas.rotate(rad * 180 / Math.PI, 0, 0); }
  scale(x: number, y: number): void { this.canvas.scale(x, y); }
  beginPath(): void { this.path.reset(); }
  closePath(): void { this.path.close(); }
  moveTo(x: number, y: number): void { this.path.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.path.lineTo(x, y); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.path.quadTo(cx, cy, x, y); }
  /** A circle (a whole turn) or an arc, clockwise as the canvas draws it (radians). */
  arc(x: number, y: number, r: number, a0: number, a1: number): void {
    const sweep = a1 - a0;
    if (sweep >= Math.PI * 2 - 1e-6) { this.path.addCircle(x, y, r); return; }
    this.path.arcToOval(Skia.XYWHRect(x - r, y - r, 2 * r, 2 * r), a0 * 180 / Math.PI, sweep * 180 / Math.PI, false);
  }
  /** Draw on another canvas (a new picture each frame) with the same paint and path. */
  retarget(canvas: SkCanvas): void { this.canvas = canvas; }
  clip(): void { this.canvas.clipPath(this.path.build(), ClipOp.Intersect, true); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Grad {
    return new SkGrad(x0, y0, r0, x1, y1, r1);
  }

  fill(): void {
    const p = this.paint;
    p.setStyle(PaintStyle.Fill);
    this.paintFill(p);
    this.canvas.drawPath(this.path.build(), p);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const p = this.paint;
    p.setStyle(PaintStyle.Fill);
    this.paintFill(p);
    this.canvas.drawRect(Skia.XYWHRect(x, y, w, h), p);
  }

  stroke(): void {
    const p = this.paint;
    p.setShader(null);
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(this.lineWidth);
    p.setStrokeCap(CAPS[this.lineCap]);
    p.setStrokeJoin(JOINS[this.lineJoin]);
    p.setColor(col(this.strokeStyle));
    if (this.globalAlpha < 1) p.setAlphaf(col(this.strokeStyle)[3]! * this.globalAlpha);
    this.canvas.drawPath(this.path.build(), p);
  }

  /** A colour, or a gradient between two circles that runs on past its ends like the canvas's does. */
  private paintFill(p: SkPaint): void {
    const f = this.fillStyle;
    if (typeof f === "string") {
      p.setShader(null);
      p.setColor(col(f));
      if (this.globalAlpha < 1) p.setAlphaf(col(f)[3]! * this.globalAlpha);
      return;
    }
    const g = f as SkGrad;
    p.setShader(Skia.Shader.MakeTwoPointConicalGradient(
      { x: g.x0, y: g.y0 }, g.r0, { x: g.x1, y: g.y1 }, g.r1,
      g.stops.map((s) => col(s[1])), g.stops.map((s) => s[0]), TileMode.Clamp,
    ));
  }
}

const CLEAR = Skia.Color("transparent");

/**
 * The raster he is drawn on. It only ever grows: he changes size as he walks
 * between spots, and a new surface for every frame of that would be waste. The
 * part that is read back is exactly the size asked for.
 */
export class SkiaRaster implements Raster {
  private surface: SkSurface | null = null;
  private ctx: SkiaCtx | null = null;
  private w = 0;
  private h = 0;
  private bw = 0;
  private bh = 0;

  begin(bw: number, bh: number): Ctx2D {
    if (!this.surface || bw > this.w || bh > this.h) {
      const w = Math.max(bw, Math.ceil(this.w * 1.25)), h = Math.max(bh, Math.ceil(this.h * 1.25));
      const s = Skia.Surface.Make(w, h);
      if (!s) throw new Error("no raster surface");
      try { this.surface?.dispose(); } catch { /* already gone */ }
      this.surface = s; this.w = w; this.h = h;
      this.ctx = new SkiaCtx(s.getCanvas());
    }
    this.bw = bw; this.bh = bh;
    this.surface.getCanvas().clear(CLEAR);
    return this.ctx as SkiaCtx;
  }

  pixels(): ArrayLike<number> | null {
    const s = this.surface;
    if (!s) return null;
    s.flush();
    const img = s.makeImageSnapshot();
    try {
      // Spelled out: the default is the platform's own order (BGRA on Apple),
      // and the dither reads red, green, blue, alpha.
      return img.readPixels(0, 0, {
        width: this.bw, height: this.bh,
        colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul,
      });
    } finally {
      try { img.dispose(); } catch { /* already gone */ }
    }
  }

  dispose(): void {
    try { this.surface?.dispose(); } catch { /* already gone */ }
    this.surface = null; this.ctx = null; this.w = 0; this.h = 0;
  }
}

/** What recordBlip needs besides the dots. */
export interface RecordIn {
  /** The picture's size: the box he is drawn into. */
  w: number;
  h: number;
  /** His feet, which is what the squash is about. */
  cx: number;
  cy: number;
  squash: number;
  pose: string;
  H: number;
  t: number;
  still: boolean;
  look: { dot: string; sticker: string; glow: string };
}

const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** The glow's bright core is its colour pulled a third of the way to white. */
function glowCore(glow: string, a: number): string {
  const m = hex.exec(glow);
  const [r, g, b] = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [57, 255, 20];
  const lift = (c: number) => Math.round(c + (255 - c) * .32);
  return `rgba(${lift(r)},${lift(g)},${lift(b)},${a})`;
}
function glowEdge(glow: string, a: number): string {
  const m = hex.exec(glow);
  const [r, g, b] = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [57, 255, 20];
  return `rgba(${r},${g},${b},${a})`;
}

/** Record one frame of him as a picture. */
export function recordBlip(out: DitherOut, o: RecordIn): SkPicture {
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, o.w, o.h));
  if (o.squash) {
    c.save();
    c.translate(o.cx, o.cy);
    c.scale(1 + o.squash * .75, 1 - o.squash);
    c.translate(-o.cx, -o.cy);
  }
  const paint = Skia.Paint();
  paint.setAntiAlias(true);

  // the shadow under his feet
  const sh = out.shadow;
  paint.setColor(Skia.Color(`rgba(28,24,18,${sh.a})`));
  c.drawOval(Skia.XYWHRect(sh.x - sh.rx, sh.y - sh.ry, sh.rx * 2, sh.ry * 2), paint);

  // the ink sticker, then the pale dots over it: round-capped points are dots
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeCap(StrokeCap.Round);
  const points = (xy: number[]) => {
    const pts = new Array<{ x: number; y: number }>(xy.length / 2);
    for (let i = 0; i < pts.length; i++) pts[i] = { x: xy[i * 2], y: xy[i * 2 + 1] };
    return pts;
  };
  if (out.sticker.length) {
    paint.setColor(col(o.look.sticker));
    paint.setStrokeWidth(out.stickerR * 2);
    c.drawPoints(PointMode.Points, points(out.sticker), paint);
  }
  if (out.dots.length) {
    paint.setColor(col(o.look.dot));
    paint.setStrokeWidth(out.dotR * 2);
    c.drawPoints(PointMode.Points, points(out.dots), paint);
  }

  // the antenna's glow
  if (out.glow) {
    const gl = out.glow, r = gl.r * 2.4;
    paint.setStyle(PaintStyle.Fill);
    paint.setShader(Skia.Shader.MakeRadialGradient(
      { x: gl.x, y: gl.y }, r,
      [Skia.Color(glowCore(o.look.glow, .55 * gl.a)), Skia.Color(glowEdge(o.look.glow, .22 * gl.a)), Skia.Color(glowEdge(o.look.glow, 0))],
      [0, .3, 1], TileMode.Clamp,
    ));
    c.drawCircle(gl.x, gl.y, r, paint);
    paint.setShader(null);
  }

  // what he is carrying, drawn plainly on top
  if (hasProp(o.pose)) {
    drawProp(new SkiaCtx(c), o.pose, o.H, out.hand, o.t, o.still, o.look.sticker, "#FCFBF8", o.look.glow);
  }
  if (o.squash) c.restore();
  return rec.finishRecordingAsPicture();
}

/** An empty picture, for the overlay's canvas before he has been drawn. */
export function emptyPicture(w: number, h: number): SkPicture {
  const rec = Skia.PictureRecorder();
  rec.beginRecording(Skia.XYWHRect(0, 0, w, h));
  return rec.finishRecordingAsPicture();
}
