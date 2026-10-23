/**
 * BlipRoam — Blip on the top edge of a card, doing his round (blipRoam.ts).
 *
 * A strip as tall as he is, laid directly above the card: his feet are on its
 * bottom edge, which is the card's top edge. He walks along it, sneaks, ducks
 * behind it (what is below the edge is hidden then, so he is behind the card),
 * peeks over, jumps into the card and back out. While `thinkWhile` names a
 * state path that is true (the card's "On it…"), he stops and thinks.
 *
 * It is the onboarding's Blip, not a picture of him: the same figure, dots,
 * springs, walk and hops (blipFigure, blipMotion, skiaCtx), with its own small
 * loop, because the onboarding's one Blip (BlipHost) belongs to the stages.
 * Reduced motion: he stands on the edge, presenting, and that is all. The loop
 * stops while the app is in the background. It never takes a touch, and a
 * fault in it removes him and nothing else.
 *
 *   { type: "BlipRoam", props: { h: 54, thinkWhile: "ask.busy", look?: {dot, sticker, glow} } }
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, PixelRatio, View } from "react-native";
import { Canvas, Picture, type SkPicture } from "@shopify/react-native-skia";
import Reanimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { CompProps } from "../sdui/components";
import { makeDither } from "./blipFigure";
import { Blip, boxOf } from "./blipMotion";
import { ROAM_START, Roamer, roamX } from "./blipRoam";
import { SkiaRaster, emptyPicture, recordBlip } from "./skiaCtx";

const LOOK = { dot: "#F3E2C6", sticker: "#151311", glow: "#39FF14" };

/** Anything that throws in here draws nothing, and leaves the screen alone. */
class Guard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BlipRoam] stopped:", error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export const BlipRoam = (p: CompProps): React.ReactElement => <Guard><Roam {...p} /></Guard>;

function Roam({ props, style, store }: CompProps): React.ReactElement {
  const H = Math.min(120, Math.max(32, Number(props?.h) || 54));
  const fit = boxOf(H);
  // His picture has room for a jump's height and his arms out.
  const box = { w: fit.w + 40, h: fit.h + Math.ceil(H * .9) };
  const strip = Math.max(fit.h, Number(props?.height) || fit.h);
  // How far below the edge he can go: into the card, or behind it.
  const below = Math.ceil(H * 1.3);
  const think = typeof props?.thinkWhile === "string" ? props.thinkWhile : null;
  const look = { ...LOOK, ...(props?.look && typeof props.look === "object" ? props.look : {}) };

  const [w, setW] = useState(0);
  const [behind, setBehind] = useState(false);
  const blank = useRef(emptyPicture(box.w, box.h)).current;
  const pic = useSharedValue<SkPicture>(blank);
  const bx = useSharedValue(-1000);
  const by = useSharedValue(-1000);
  const botStyle = useAnimatedStyle(() => ({ transform: [{ translateX: bx.value }, { translateY: by.value }] }));

  useEffect(() => {
    if (!w) return;
    const dpr = PixelRatio.get();
    const raster = new SkiaRaster();
    const dither = makeDither();
    const bot = new Blip(dpr);
    const edge = strip;
    const X = (f: number) => roamX(f, w, fit.w);
    const roamer = new Roamer(bot, H, edge, X, setBehind);
    let raf = 0, dead = false, faults = 0, reduced = false, active = AppState.currentState === "active", last = 0;

    const draw = (dt: number) => {
      const fr = bot.frame(dt, reduced);
      const cx = box.w / 2, cy = box.h - 2;
      const out = dither(raster, {
        H: bot.H, cell: bot.cell, x: cx, y: cy, sx: bot.fx, lift: bot.lift,
        padX: bot.H * .27, st: fr.st, t: fr.t, glow: fr.glow,
      });
      if (!out) return;
      pic.value = recordBlip(out, { w: box.w, h: box.h, cx, cy, squash: bot.sq, pose: bot.pose, H: bot.H, t: fr.t, still: reduced, look });
      bx.value = (bot.tr ? bot.x : Math.round(bot.x)) - box.w / 2;
      by.value = (bot.tr ? bot.y : Math.round(bot.y)) - box.h + 2;
    };

    const frame = () => {
      raf = 0;
      if (dead || !active) return;
      const now = performance.now(), dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
      last = now;
      try {
        if (reduced) {
          bot.pose = "present"; setBehind(false); bot.snap(X(ROAM_START), edge, H);
          draw(dt);
          return; // one picture, and no loop
        }
        roamer.step(now, !!(think && store.get(think)));
        draw(dt);
        faults = 0;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[Tailzu][BlipRoam] frame failed:", e);
        if (++faults >= 3) { dead = true; bx.value = -1000; return; }
      }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && !dead && active) { last = 0; raf = requestAnimationFrame(frame); } };

    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { reduced = !!on; wake(); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => { reduced = !!on; wake(); });
    const app = AppState.addEventListener("change", (s) => { active = s === "active"; if (active) wake(); });
    wake();
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      motion?.remove?.();
      app.remove();
      raster.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, H, strip, think]);

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => { const nw = Math.round(e.nativeEvent.layout.width); if (nw > 0 && nw !== w) setW(nw); }}
      // Above the card that follows, so a jump into it lands in front of it.
      style={[{ height: strip, zIndex: 5, elevation: 5 }, style]}
    >
      {/* Behind the card: nothing below the edge shows. In front: down into the card. */}
      <View style={{ position: "absolute", left: 0, right: 0, top: -(box.h - fit.h), height: (behind ? strip : strip + below) + (box.h - fit.h), overflow: "hidden" }}>
        <Reanimated.View style={[{ position: "absolute", left: 0, top: box.h - fit.h, width: box.w, height: box.h }, botStyle]}>
          <Canvas style={{ width: box.w, height: box.h }}>
            <Picture picture={pic} />
          </Canvas>
        </Reanimated.View>
      </View>
    </View>
  );
}
