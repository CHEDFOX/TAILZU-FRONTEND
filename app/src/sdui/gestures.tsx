/**
 * Edge-swipe-back — a general, backend-driven gesture capability.
 *
 * "Swipe right from the left edge to go back", available anywhere in the app.
 * The whole thing is tunable from the server via bootstrap `flags`, so the
 * backend can turn it off or retune the feel without an app build:
 *
 *   flags["gestures.swipeBack"]          → boolean   (default true)   on/off
 *   flags["gestures.swipeBackEdge"]      → number px (default 30)     hot-zone width
 *   flags["gestures.swipeBackDistance"]  → number px (default 64)     commit distance
 *   flags["gestures.swipeBackVelocity"]  → number    (default 600)    fling velocity
 *
 * Physics-proof + haptic: a rightward drag past the distance OR a fast fling
 * commits with a medium impact; a vertical scroll cancels it.
 *
 * Usage:
 *   const { edgeZone } = useEdgeSwipeBack(goBack, resolveEdgeSwipe(flags));
 *   return (<View>…{edgeZone}</View>);   // render edgeZone LAST so it sits on top
 */
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

export interface EdgeSwipeConfig {
  enabled: boolean;
  edgeWidth: number;
  distance: number;
  velocity: number;
}

const DEFAULTS: EdgeSwipeConfig = { enabled: true, edgeWidth: 30, distance: 64, velocity: 600 };

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Read the edge-swipe config from backend bootstrap flags (all optional). */
export function resolveEdgeSwipe(flags?: Record<string, boolean | number | string>): EdgeSwipeConfig {
  const f = flags ?? {};
  return {
    enabled: f["gestures.swipeBack"] !== false && f["gestures.swipeBack"] !== "false",
    edgeWidth: num(f["gestures.swipeBackEdge"], DEFAULTS.edgeWidth),
    distance: num(f["gestures.swipeBackDistance"], DEFAULTS.distance),
    velocity: num(f["gestures.swipeBackVelocity"], DEFAULTS.velocity),
  };
}

/**
 * Returns an `edgeZone` element (an invisible, gesture-detecting strip pinned to
 * the screen's left edge) that fires `onBack` on a committed swipe. Returns
 * `edgeZone: null` when disabled (by config) or when `onBack` is falsy.
 */
export function useEdgeSwipeBack(
  onBack: (() => void) | null | undefined,
  config: Partial<EdgeSwipeConfig> = {},
): { edgeZone: React.ReactNode } {
  const cfg = { ...DEFAULTS, ...config };

  const gesture = useMemo(() => {
    const fire = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onBack && onBack();
    };
    return Gesture.Pan()
      .activeOffsetX(12) // only a rightward drag arms it
      .failOffsetY([-14, 14]) // a vertical scroll cancels it
      .onEnd((e) => {
        "worklet";
        if (e.translationX > cfg.distance || e.velocityX > cfg.velocity) {
          runOnJS(fire)();
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, cfg.distance, cfg.velocity]);

  if (!cfg.enabled || !onBack) return { edgeZone: null };

  return {
    edgeZone: (
      <GestureDetector gesture={gesture}>
        <View style={[styles.edgeZone, { width: cfg.edgeWidth }]} />
      </GestureDetector>
    ),
  };
}

const styles = StyleSheet.create({
  edgeZone: { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 50 },
});
