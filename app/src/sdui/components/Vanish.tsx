/**
 * Vanish — its children vaporise when `goneWhen` turns true, and come back when it turns false (types.ts VanishProps,
 * component "Vanish"; section 3i): Spaces' "Create · Your Own Space" row going as the box grows. They rise 8 px, shrink a
 * touch and fade over 520 ms (on a phone opacity and scale stand in for the window's blur) while twelve ink specks drift up
 * and fade; then the room they took closes (240 ms). Coming back runs the same the other way.
 *
 * Kept per `key` for the life of the app: drawn gone at once when it is gone at its first draw, and a repaint never
 * replays it. Reduce Motion: gone and back at once.
 *
 *   { type: "Vanish", props: { goneWhen, key }, children: [...] }
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import type { CompProps } from "./props";
import { evalCondition } from "../actions";
import * as K from "../knobs";
import { useReducedMotion } from "../../botTiles/TileSurface";

/** Whether each key was last drawn gone. */
const KEPT = new Map<string, boolean>();
const INK = "#0a0a0a";
const SPECKS = 12;

export const Vanish = ({ props, ctx, children, style }: CompProps): React.ReactElement => {
  const key = String(props?.key || "vanish");
  const gone = props?.goneWhen ? evalCondition(props.goneWhen, ctx) : false;
  const reduced = useReducedMotion();
  const was = KEPT.get(key);
  const startGone = was === undefined ? gone : was;
  const p = useRef(new Animated.Value(startGone ? 1 : 0)).current;
  const h = useRef(new Animated.Value(0)).current;
  const sp = useRef(new Animated.Value(0)).current;
  const [fixed, setFixed] = useState(startGone);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const contentH = useRef(0);
  const shown = useRef(startGone);

  // Where each speck starts (a fraction across and down the row) and how far it drifts.
  const specks = useMemo(() => Array.from({ length: SPECKS }, (_v, i) => {
    const r = (n: number) => { const s = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s); };
    return { fx: r(1), fy: 0.2 + r(2) * 0.6, dx: (r(3) - 0.5) * 30, dy: -14 - r(4) * 30, s: 2 + r(5), delay: r(6) * 0.35 };
  }), []);

  useEffect(() => {
    if (shown.current === gone) { KEPT.set(key, gone); return; }
    shown.current = gone;
    KEPT.set(key, gone);
    const fadeMs = reduced ? 0 : K.num("ui.Vanish.fadeMs", 520);
    const closeMs = reduced ? 0 : K.num("ui.Vanish.closeMs", 240);
    const ease = Easing.bezier(0.2, 0.7, 0.3, 1);
    if (gone) {
      h.setValue(contentH.current);
      setFixed(true);
      sp.setValue(0);
      Animated.sequence([
        Animated.parallel([
          Animated.timing(p, { toValue: 1, duration: fadeMs, easing: ease, useNativeDriver: false }),
          Animated.timing(sp, { toValue: 1, duration: fadeMs + 160, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        ]),
        Animated.timing(h, { toValue: 0, duration: closeMs, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]).start();
    } else {
      sp.setValue(1);
      Animated.sequence([
        Animated.timing(h, { toValue: contentH.current, duration: closeMs, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.parallel([
          Animated.timing(p, { toValue: 0, duration: fadeMs, easing: ease, useNativeDriver: false }),
          Animated.timing(sp, { toValue: 0, duration: fadeMs + 160, easing: Easing.in(Easing.quad), useNativeDriver: false }),
        ]),
      ]).start(({ finished }) => { if (finished && !shown.current) setFixed(false); });
    }
  }, [gone, key, reduced, p, h, sp]);

  return (
    <Animated.View pointerEvents={gone ? "none" : "auto"} style={[style, fixed ? { height: h, overflow: "visible" } : null]}>
      <Animated.View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          contentH.current = height;
          if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
        }}
        style={{
          opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
            { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) },
          ],
        }}
      >
        {children}
      </Animated.View>
      {size.w > 0 && specks.map((s, i) => {
        // each speck lives in its own part of the run: it shows, drifts up, and fades
        const a = s.delay, b = Math.min(1, a + 0.55);
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute", left: s.fx * size.w, top: s.fy * size.h, width: s.s, height: s.s, borderRadius: s.s / 2, backgroundColor: INK,
              opacity: sp.interpolate({ inputRange: [0, a, a + 0.08, b, 1], outputRange: [0, 0, 0.8, 0, 0], extrapolate: "clamp" }),
              transform: [
                { translateX: sp.interpolate({ inputRange: [a, b], outputRange: [0, s.dx], extrapolate: "clamp" }) },
                { translateY: sp.interpolate({ inputRange: [a, b], outputRange: [0, s.dy], extrapolate: "clamp" }) },
              ],
            }}
          />
        );
      })}
    </Animated.View>
  );
};
