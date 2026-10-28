/**
 * WHERE A LIVING TILE IS DRAWN, AND THE LOOP THAT DRIVES IT.
 *
 * The physics and the drawing are core.ts's (shared with the window). This file gives it a surface and a clock:
 *
 *   TileSurface  native: a Skia <Canvas> showing one recorded SkPicture through a Reanimated shared value. Each
 *                frame the core draws into a reused PictureRecorder through SkiaCtx (onboard/skiaCtx.ts, the same
 *                Canvas2D-shaped context Blip is drawn with) and the finished picture is handed to the UI thread.
 *                No React render per frame, no bridge serialisation. The web (react-native-web: the live preview,
 *                Expo web): a DOM <canvas> and its real 2D context, so the preview shows the same thing.
 *   useTileLoop  one requestAnimationFrame loop per grid (not per tile), on the JS thread. Why the JS thread and
 *                not a Reanimated worklet: the core must stay plain TypeScript, identical to the window's copy, and
 *                a worklet cannot run classes; its work is small (four tiles step in well under a millisecond in
 *                V8, a few in Hermes, and draw in a few hundred batched calls), and handing over a picture costs
 *                one shared-value write per tile. It stops while the app is in the background, while the grid is
 *                scrolled out of sight, and when the screen goes (the SDUI host unmounts a screen it leaves).
 */
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { AppState, Dimensions, Platform, View } from "react-native";
import type { TileCtx } from "./core";

/** Anything the core draws: a tile's bot, the living mark. */
export interface Drawable {
  draw(ctx: TileCtx): void;
}

export interface Painter {
  paint(tile: Drawable): void;
}

interface SurfaceProps {
  w: number;
  h: number;
  style?: Record<string, unknown>;
}

const WEB = Platform.OS === "web";

/** A tile's drawing surface: Skia on a phone, a canvas on the web. */
export const TileSurface = forwardRef<Painter, SurfaceProps>(function TileSurface(p, ref) {
  return WEB ? <WebSurface {...p} ref={ref} /> : <NativeSurface {...p} ref={ref} />;
});

// ------------------------------------------------------------------ native: Skia

// Required lazily, so the web bundle never touches Skia or Reanimated (the preview stubs them; Expo web would need
// CanvasKit loaded first).
/* eslint-disable @typescript-eslint/no-require-imports */
const NativeSurface = forwardRef<Painter, SurfaceProps>(function NativeSurface({ w, h, style }, ref) {
  const sk = useMemo(() => require("@shopify/react-native-skia") as typeof import("@shopify/react-native-skia"), []);
  const re = useMemo(() => require("react-native-reanimated") as typeof import("react-native-reanimated"), []);
  const sc = useMemo(() => require("../onboard/skiaCtx") as typeof import("../onboard/skiaCtx"), []);
  const blank = useMemo(() => sc.emptyPicture(Math.max(1, w), Math.max(1, h)), [sc, w, h]);
  const pic = re.useSharedValue(blank);
  const bounds = useMemo(() => sk.Skia.XYWHRect(0, 0, Math.max(1, w), Math.max(1, h)), [sk, w, h]);
  const rec = useRef<ReturnType<typeof sk.Skia.PictureRecorder> | null>(null);
  const ctx = useRef<InstanceType<typeof sc.SkiaCtx> | null>(null);
  useImperativeHandle(ref, () => ({
    paint(tile: Drawable) {
      if (!rec.current) rec.current = sk.Skia.PictureRecorder();
      const canvas = rec.current.beginRecording(bounds);
      if (!ctx.current) ctx.current = new sc.SkiaCtx(canvas); else ctx.current.retarget(canvas);
      tile.draw(ctx.current as unknown as TileCtx);
      pic.value = rec.current.finishRecordingAsPicture();
    },
  }), [sk, sc, bounds, pic]);
  const { Canvas, Picture } = sk;
  return (
    <Canvas style={[{ width: w, height: h }, style as object]} pointerEvents="none">
      <Picture picture={pic} />
    </Canvas>
  );
});
/* eslint-enable @typescript-eslint/no-require-imports */

// ------------------------------------------------------------------ web: a canvas

const WebSurface = forwardRef<Painter, SurfaceProps>(function WebSurface({ w, h, style }, ref) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = useRef<any>(null);
  const dpr = typeof window !== "undefined" ? Math.min(3, (window as { devicePixelRatio?: number }).devicePixelRatio || 1) : 1;
  useImperativeHandle(ref, () => ({
    paint(tile: Drawable) {
      const c = el.current;
      const g = c && c.getContext ? c.getContext("2d") : null;
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      tile.draw(g as TileCtx);
    },
  }), [w, h, dpr]);
  return React.createElement("canvas", {
    ref: el, width: Math.max(1, Math.round(w * dpr)), height: Math.max(1, Math.round(h * dpr)), "aria-hidden": true,
    style: { width: w, height: h, display: "block", pointerEvents: "none", ...(style ?? {}) },
  });
});

// ------------------------------------------------------------------ the loop

export interface LoopIO {
  /** Advance the physics by dt seconds and paint. Return false to stop asking (nothing moves). */
  frame(dt: number): void;
  /** Called while something should be shown but nothing moves (Reduce Motion, or a pause): paint once. */
  still(): void;
}

/**
 * Runs `io.frame` every animation frame while `run` and the view is on screen and the app is in front. `host` is the
 * view whose place on screen decides "on screen" (checked twice a second, not every frame).
 */
export function useTileLoop(io: LoopIO, run: boolean, host: React.RefObject<View | null>): void {
  const ioRef = useRef(io);
  ioRef.current = io;
  useEffect(() => {
    if (!run) { ioRef.current.still(); return; }
    let raf = 0, last = 0, dead = false, faults = 0;
    let active = AppState.currentState === "active" || AppState.currentState == null;
    let seen = true;
    const tick = () => {
      raf = 0;
      if (dead || !active || !seen) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      try {
        ioRef.current.frame(dt);
        faults = 0;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[Tailzu][BotTiles] frame failed:", e);
        if (++faults >= 3) { dead = true; return; }
      }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf && !dead && active && seen) { last = 0; raf = requestAnimationFrame(tick); } };
    const app = AppState.addEventListener("change", (s) => { active = s === "active"; if (active) wake(); });
    // On screen? Measured, not guessed: the Home body scrolls.
    const look = setInterval(() => {
      const v = host.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
      if (!v?.measureInWindow) return;
      v.measureInWindow((_x, y, _w, h) => {
        const H = Dimensions.get("window").height;
        const now = h > 0 ? y + h > 0 && y < H : true;
        if (now !== seen) { seen = now; if (seen) wake(); }
      });
    }, 500);
    wake();
    return () => { dead = true; if (raf) cancelAnimationFrame(raf); app.remove(); clearInterval(look); };
  }, [run, host]);
}

/** Reduce Motion, as the system says it now (and when it changes). */
export function useReducedMotion(): boolean | null {
  const [on, setOn] = React.useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AccessibilityInfo } = require("react-native") as typeof import("react-native");
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (live) setOn(!!v); }).catch(() => { if (live) setOn(false); });
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => setOn(!!v));
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return on;
}
