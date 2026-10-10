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
 *   flags["gestures.swipeBackArm"]       → number px (default 8)      drag before it claims
 *   flags["gestures.swipeBackAxisRatio"] → number    (default 1.4)    |dx| must beat |dy| by
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
import { bool, num } from "./knobs";

export interface EdgeSwipeConfig {
  enabled: boolean;
  edgeWidth: number;
  distance: number;
  velocity: number; // px/s
  /** How far right a drag must go before the zone claims it, px. */
  arm: number;
  /** How much more horizontal than vertical that drag must be. */
  axisRatio: number;
}

/**
 * The edge-swipe config, from the bootstrap in hand (knobs).
 *
 * The `flags` argument is kept for callers that pass one; the knobs already
 * read the same bootstrap. A string "false" still switches it off, as it did.
 */
export function resolveEdgeSwipe(flags?: Record<string, unknown>): EdgeSwipeConfig {
  return {
    enabled: bool("gestures.swipeBack", true) && flags?.["gestures.swipeBack"] !== "false",
    edgeWidth: num("gestures.swipeBackEdge", 30),
    distance: num("gestures.swipeBackDistance", 64),
    velocity: num("gestures.swipeBackVelocity", 600),
    arm: num("gestures.swipeBackArm", 8),
    axisRatio: num("gestures.swipeBackAxisRatio", 1.4),
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
  const cfg = { ...resolveEdgeSwipe(), ...config };
  const fired = useRef(false);
  // PanResponder velocity is px/ms; the config velocity is px/s.
  const velPerMs = cfg.velocity / 1000;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Arm only on a clearly rightward drag; a vertical scroll won't grab it.
        onMoveShouldSetPanResponder: (_, g) => g.dx > cfg.arm && Math.abs(g.dx) > Math.abs(g.dy) * cfg.axisRatio,
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
    [onBack, cfg.distance, velPerMs, cfg.arm, cfg.axisRatio],
  );

  if (!cfg.enabled || !onBack) return { edgeZone: null };

  return {
    edgeZone: <View style={[styles.edgeZone, { width: cfg.edgeWidth }]} {...pan.panHandlers} />,
  };
}

const styles = StyleSheet.create({
  edgeZone: { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 50 },
});
