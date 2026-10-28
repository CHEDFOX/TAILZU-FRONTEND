/**
 * SVG `shapes` — the Bots app's glyphs: several circles and paths in one drawing, and the kit's three motions.
 *
 *   breathe  a working bot: loops, 1.8 s, opacity 1 → .5 and scale 1 → .78 about the shape's centre
 *   pop      lands once: scale 0 → 1 on cubic-bezier(.3, 1.6, .5, 1) in 420 ms, after `delayMs`
 *   draw     a ring draws once to its dash length in 700 ms, after `delayMs`
 *
 * Under Reduce Motion nothing moves and every shape is drawn as it ends up; the state still reads, because shape
 * and colour carry it. The contract is the backend's (shared/types/sdui.ts SvgShape); desktop/sdui.js draws the
 * same shapes with CSS animations.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import type { SvgShape } from "./types";

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Reduce Motion, followed live. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v: boolean) => setReduce(!!v));
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

function centreOf(sh: SvgShape, viewBox: string): [number, number] {
  if (sh.origin) return sh.origin;
  if (sh.circle) return [sh.circle[0], sh.circle[1]];
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
  return [(x || 0) + (w || 24) / 2, (y || 0) + (h || 24) / 2];
}

/** The shape's own drawing props (fill, stroke, dash…). */
function paint(sh: SvgShape) {
  return {
    fill: sh.fill ?? "none",
    stroke: sh.stroke,
    strokeWidth: sh.stroke ? sh.strokeWidth ?? 1.5 : undefined,
    strokeDasharray: sh.dash,
    strokeLinecap: sh.linecap ?? "round",
    strokeLinejoin: sh.linejoin ?? "round",
    opacity: sh.opacity,
  } as const;
}

function Still({ sh, dashOffset }: { sh: SvgShape; dashOffset?: Animated.AnimatedInterpolation<number> | Animated.Value }) {
  const p = paint(sh);
  if (sh.circle) {
    const [cx, cy, r] = sh.circle;
    return dashOffset
      ? <AnimatedCircle cx={cx} cy={cy} r={r} {...p} strokeDashoffset={dashOffset as any} />
      : <Circle cx={cx} cy={cy} r={r} {...p} />;
  }
  return dashOffset
    ? <AnimatedPath d={sh.d ?? ""} {...p} strokeDashoffset={dashOffset as any} />
    : <Path d={sh.d ?? ""} {...p} />;
}

function Moving({ sh, centre, reduce }: { sh: SvgShape; centre: [number, number]; reduce: boolean }) {
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(sh.motion === "breathe" ? 0 : 1); return; }
    if (sh.motion === "breathe") {
      const half = (to: number) => Animated.timing(v, { toValue: to, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false });
      const loop = Animated.loop(Animated.sequence([half(1), half(0)]));
      loop.start();
      return () => loop.stop();
    }
    const run = Animated.timing(v, {
      toValue: 1, delay: sh.delayMs ?? 0, useNativeDriver: false,
      duration: sh.motion === "pop" ? 420 : 700,
      easing: sh.motion === "pop" ? Easing.bezier(0.3, 1.6, 0.5, 1) : Easing.out(Easing.ease),
    });
    run.start();
    return () => run.stop();
  }, [reduce, sh.motion, sh.delayMs, v]);

  const [cx, cy] = centre;
  if (sh.motion === "draw") {
    const length = Number(String(sh.dash ?? "").split(/[\s,]+/)[0]) || 0;
    const offset = v.interpolate({ inputRange: [0, 1], outputRange: [length, 0] });
    return <Still sh={sh} dashOffset={reduce ? undefined : offset} />;
  }
  const scale = sh.motion === "breathe" ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] }) : v;
  const opacity = sh.motion === "breathe" ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) : 1;
  return (
    <AnimatedG scale={scale as any} opacity={opacity as any} originX={cx} originY={cy}>
      <Still sh={sh} />
    </AnimatedG>
  );
}

export function SvgShapes({ viewBox, shapes }: { viewBox: string; shapes: SvgShape[] }) {
  const reduce = useReduceMotion();
  return (
    <Svg width="100%" height="100%" viewBox={viewBox}>
      {shapes.map((sh, i) => {
        const centre = centreOf(sh, viewBox);
        const drawn = sh.motion ? <Moving key={i} sh={sh} centre={centre} reduce={reduce} /> : <Still key={i} sh={sh} />;
        return sh.rotate
          ? <G key={i} rotation={sh.rotate} originX={centre[0]} originY={centre[1]}>{drawn}</G>
          : drawn;
      })}
    </Svg>
  );
}
