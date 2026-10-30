/**
 * BlipWalkOut — Blip waving hello on Home's welcome, who turns and walks off the side when it is time (`goWhen`).
 *
 * The onboarding's Blip (blipFigure, blipMotion, skiaCtx), not a picture: he stands in the middle of his strip,
 * waving; when the state path `goWhen` turns true he faces the way out and walks there, legs and arms going, until he is
 * past the edge, and then draws nothing more. Reduced motion: he stands, presenting, and is gone at once when it is
 * time. The loop stops while the app is in the background. It never takes a touch, and a fault in it removes him and
 * nothing else.
 *
 *   { type: "BlipWalkOut", props: { h: 120, goWhen: "helloSeen", dir?: 1 | -1, walkMs?: 1400, look?: {dot, sticker, glow} } }
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, PixelRatio, View } from "react-native";
import { Canvas, Picture, type SkPicture } from "@shopify/react-native-skia";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { CompProps } from "../sdui/components";
import { makeDither } from "./blipFigure";
import { Blip, boxOf } from "./blipMotion";
import { SkiaRaster, emptyPicture, recordBlip } from "./skiaCtx";

const LOOK = { dot: "#F3E2C6", sticker: "#151311", glow: "#39FF14" };

class Guard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BlipWalkOut] stopped:", error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export const BlipWalkOut = (p: CompProps): React.ReactElement => <Guard><WalkOut {...p} /></Guard>;

function WalkOut({ props, style, store }: CompProps): React.ReactElement {
  const H = Math.min(200, Math.max(40, Number(props?.h) || 120));
  const fit = boxOf(H);
  const box = { w: fit.w + 60, h: fit.h + Math.ceil(H * .3) };
  const go = typeof props?.goWhen === "string" ? props.goWhen : null;
  const dir = Number(props?.dir) === -1 ? -1 : 1;
  const walkMs = Math.max(500, Number(props?.walkMs) || 1400);
  const look = { ...LOOK, ...(props?.look && typeof props.look === "object" ? props.look : {}) };

  const [w, setW] = useState(0);
  const blank = useRef(emptyPicture(box.w, box.h)).current;
  const pic = useSharedValue<SkPicture>(blank);
  const bx = useSharedValue(-1000);
  const botStyle = useAnimatedStyle(() => ({ transform: [{ translateX: bx.value }] }));

  useEffect(() => {
    if (!w) return;
    const raster = new SkiaRaster();
    const dither = makeDither();
    const bot = new Blip(PixelRatio.get());
    bot.snap(w / 2, box.h - 2, H);
    bot.pose = "wave";
    let raf = 0, dead = false, faults = 0, reduced = false, active = AppState.currentState === "active", last = 0;
    let left = false, out = false;

    const draw = (dt: number) => {
      const fr = bot.frame(dt, reduced);
      const cx = box.w / 2, cy = box.h - 2;
      const img = dither(raster, { H: bot.H, cell: bot.cell, x: cx, y: cy, sx: bot.fx, lift: bot.lift, padX: bot.H * .27, st: fr.st, t: fr.t, glow: fr.glow });
      if (!img) return;
      pic.value = recordBlip(img, { w: box.w, h: box.h, cx, cy, squash: bot.sq, pose: bot.pose, H: bot.H, t: fr.t, still: reduced, look });
      bx.value = (bot.tr ? bot.x : Math.round(bot.x)) - box.w / 2;
    };

    const frame = () => {
      raf = 0;
      if (dead || !active) return;
      const now = performance.now(), dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
      last = now;
      try {
        const time = !!(go && store.get(go));
        if (reduced) {
          if (time) { bx.value = -10000; return; }
          bot.pose = "present";
          draw(dt);
          return; // one picture, and no loop
        }
        if (time && !left) {
          // He turns to the way out (travel faces him there) and walks till he is past the edge.
          left = true;
          bot.travel(dir > 0 ? w + box.w : -box.w, bot.y, H, "walk", () => { out = true; }, now, { ms: walkMs });
          bot.pose = "walk";
        }
        bot.tick(now);
        if (out) { bx.value = -10000; return; } // gone: nothing more to draw
        draw(dt);
        faults = 0;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[Tailzu][BlipWalkOut] frame failed:", e);
        if (++faults >= 3) { dead = true; bx.value = -10000; return; }
      }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && !dead && active) { last = 0; raf = requestAnimationFrame(frame); } };

    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { reduced = !!on; wake(); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => { reduced = !!on; wake(); });
    const app = AppState.addEventListener("change", (s) => { active = s === "active"; if (active) wake(); });
    // Reduced motion draws once; it must still hear when it is time to go.
    const unsub = go ? store.subscribe?.(() => wake()) : undefined;
    wake();
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      motion?.remove?.();
      app.remove();
      if (typeof unsub === "function") unsub();
      raster.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, H, go, dir, walkMs]);

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => { const nw = Math.round(e.nativeEvent.layout.width); if (nw > 0 && nw !== w) setW(nw); }}
      style={[{ height: box.h, alignSelf: "stretch", overflow: "visible" }, style]}
      accessibilityLabel={typeof props?.label === "string" ? props.label : undefined}
    >
      <Reanimated.View style={[{ position: "absolute", left: 0, top: 0, width: box.w, height: box.h }, botStyle]}>
        <Canvas style={{ width: box.w, height: box.h }}>
          <Picture picture={pic} />
        </Canvas>
      </Reanimated.View>
    </View>
  );
}
