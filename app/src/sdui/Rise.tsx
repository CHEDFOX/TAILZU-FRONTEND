/**
 * Rise — one element arriving from below and settling.
 *
 * The entrance the sign-in screen is built from: each row starts below the
 * bottom edge and springs up. A spring rather than a timing curve, because a
 * spring overshoots and settles, which is what makes it read as something
 * arriving rather than something fading in.
 *
 * Two faces, one implementation. `RiseView` is an ordinary React component the
 * native screen uses directly; `Rise` is the SDUI node that wraps whatever the
 * server puts inside it. They share the animation so the two paths cannot drift
 * apart — the whole point of putting it here rather than writing it twice.
 *
 * EVERY NUMBER IS PER ELEMENT AND COMES FROM THE SERVER. There is no shared
 * stagger index and no notion of "which one am I": each node carries its own
 * delay, its own travel and its own spring. That is deliberate. A stagger
 * computed from position means the order is decided by the layout and can only
 * be changed by moving things; a delay carried per node means the backend can
 * make the socials arrive first, or land two rows together, or hold the brand
 * back a beat, without touching the composition at all.
 *
 * Reduced motion lands everything in place with no travel — not a slower
 * version of the same flight.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import type { CompProps } from "./components";

export type RiseCfg = {
  /** Wait this long before starting. The ONLY thing that orders an entrance. */
  delayMs?: number;
  /** How far below its resting place it starts, in points. */
  fromY?: number;
  /** Scale it grows from. 1 disables the scale entirely. */
  scaleFrom?: number;
  /** Spring shape. Lower damping overshoots more; higher stiffness lands sooner. */
  damping?: number;
  stiffness?: number;
  mass?: number;
};

const D: Required<RiseCfg> = {
  delayMs: 0,
  fromY: 120,
  scaleFrom: 0.86,
  damping: 14,
  stiffness: 110,
  mass: 0.9,
};

export function RiseView({
  cfg,
  reduce,
  style,
  children,
}: {
  cfg?: RiseCfg;
  /** Pass it in when the caller already knows; otherwise this asks. */
  reduce?: boolean;
  style?: object;
  children: React.ReactNode;
}) {
  const c = { ...D, ...(cfg ?? {}) };
  const [askedReduce, setAskedReduce] = useState(false);
  const still = reduce ?? askedReduce;

  useEffect(() => {
    if (reduce !== undefined) return;
    AccessibilityInfo.isReduceMotionEnabled?.().then(setAskedReduce).catch(() => {});
  }, [reduce]);

  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) { t.setValue(1); return; }
    const anim = Animated.spring(t, {
      toValue: 1,
      delay: c.delayMs,
      damping: c.damping,
      stiffness: c.stiffness,
      mass: c.mass,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, still, c.delayMs, c.damping, c.stiffness, c.mass]);

  return (
    <Animated.View
      style={[
        {
          // Fades in over the first third of the travel, so it is never a
          // ghost sliding up from off-screen — it is already there by the
          // time it is worth looking at.
          opacity: t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [c.fromY, 0] }) },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [c.scaleFrom, 1] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The SDUI node. Wraps anything:
 *
 *   { "type": "Rise", "props": { "delayMs": 190, "fromY": 140 },
 *     "children": [ … ] }
 *
 * Draws its children with no animation if the props are nonsense, because an
 * entrance is decoration and the thing inside it is the screen.
 */
export const Rise = ({ props, style, children }: CompProps): React.ReactElement => {
  const cfg: RiseCfg = {
    delayMs: Number(props?.delayMs) || 0,
    fromY: props?.fromY !== undefined ? Number(props.fromY) : undefined,
    scaleFrom: props?.scaleFrom !== undefined ? Number(props.scaleFrom) : undefined,
    damping: props?.damping !== undefined ? Number(props.damping) : undefined,
    stiffness: props?.stiffness !== undefined ? Number(props.stiffness) : undefined,
    mass: props?.mass !== undefined ? Number(props.mass) : undefined,
  };
  // Drop anything that did not parse, so one bad value falls back to the
  // default rather than to NaN — which reanimates to nowhere and hides the row.
  for (const k of Object.keys(cfg) as (keyof RiseCfg)[]) {
    if (cfg[k] === undefined || Number.isNaN(cfg[k])) delete cfg[k];
  }
  return <RiseView cfg={cfg} style={style}>{children}</RiseView>;
};
