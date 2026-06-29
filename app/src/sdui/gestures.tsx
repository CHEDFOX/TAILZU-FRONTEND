/**
 * Edge-swipe-back — a general, backend-driven gesture capability.
 *
 * "Swipe right from the left edge to go back", available anywhere in the app.
 * Tunable from the server via bootstrap `flags` (no app build):
 *
 *   flags["gestures.swipeBack"]          → boolean   (default true)   on/off
 *   flags["gestures.swipeBackEdge"]      → number px (default 30)     hot-zone width
 *   flags["gestures.swipeBackDistance"]  → number px (default 64)     commit distance
 *   flags["gestures.swipeBackVelocity"]  → number    (default 600)    fling velocity (px/s)
 *
 * Physics-proof + haptic: a rightward drag past the distance OR a fast fling
 * commits with a medium impact; a vertical scroll cancels it. Built on RN's
 * PanResponder (no extra native deps) so it works everywhere.
 *
 * Usage:
 *   const { edgeZone } = useEdgeSwipeBack(goBack, resolveEdgeSwipe(flags));
 *   return (<View>…{edgeZone}</View>);   // render edgeZone LAST so it sits on top
 */
import React, { useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

export interface EdgeSwipeConfig {
  enabled: boolean;
  edgeWidth: number;
  distance: number;
  velocity: number; // px/s
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
 * Returns an `edgeZone` element (an invisible strip pinned to the left edge)
 * that fires `onBack` on a committed rightward swipe. `edgeZone: null` when
 * disabled by config or when `onBack` is falsy.
 */
export function useEdgeSwipeBack(
  onBack: (() => void) | null | undefined,
  config: Partial<EdgeSwipeConfig> = {},
): { edgeZone: React.ReactNode } {
  const cfg = { ...DEFAULTS, ...config };
  const fired = useRef(false);
  // PanResponder velocity is px/ms; the config velocity is px/s.
  const velPerMs = cfg.velocity / 1000;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Arm only on a clearly rightward drag; a vertical scroll won't grab it.
        onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderGrant: () => { fired.current = false; },
        onPanResponderRelease: (_, g) => {
          if (!fired.current && (g.dx > cfg.distance || g.vx > velPerMs)) {
            fired.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onBack && onBack();
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onBack, cfg.distance, velPerMs],
  );

  if (!cfg.enabled || !onBack) return { edgeZone: null };

  return {
    edgeZone: <View style={[styles.edgeZone, { width: cfg.edgeWidth }]} {...pan.panHandlers} />,
  };
}

const styles = StyleSheet.create({
  edgeZone: { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 50 },
});
