/**
 * BotPeek — the bot rises from behind an edge of the screen, holds, and ducks back (types.ts BotPeekProps,
 * component "BotPeek" with BotsMotion).
 *
 * The window's Blip has done this for a long time (TAILZU-DESKTOP src/shared/blip.js `rise`, src/agent/guide/peek.js
 * for the timings: 280 ms up, 300 ms down, a hop when the words have landed). This is that gesture here.
 *
 * WHAT THIS FILE DOES, AND WHAT IT DOES NOT. It decides WHERE he is and WHEN he moves; the figure is BotBuddy's, on
 * the same physics core as Home's tiles, so he keeps his lid, his hands and his kind's play. The ANTENNA'S GLOW is
 * not here either: it is a moment in the server's catalog (`liveMoment`), because what he looks like has always been
 * data and a glow hard-coded here could never be changed without a release.
 *
 * TWO RULES, both in peekCore.ts where they can be tested:
 *
 *   1. HE IS CLIPPED. The pocket at the edge is `overflow: hidden`, and at full rise only part of him is past it. A
 *      whole figure standing on a person's page is not a peek.
 *   2. HE NEVER CROSSES THE SCREEN. The next spot is taken at `hidden`, with the animation off, where nobody sees it.
 *      The only movement anybody watches is straight over an edge and straight back.
 *
 * Reduce Motion: he rises once, stays, and never hops — the gesture is motion, so the answer to "no motion" is to
 * stop moving rather than to vanish.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, View, useWindowDimensions, AccessibilityInfo } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CompProps } from "../components/props";
import { evalCondition } from "../actions";
import { BotBuddy } from "./BotBuddy";
import { DUCK_MS, HOP_MS, RISE_MS, SIZE, hopTo, inRange, nextSpot, placeOf, widthOf, type PeekFrame, type PeekSpot } from "./peekCore";

type Phase = "hidden" | "rising" | "up" | "hopping" | "ducking";

export const BotPeek = (all: CompProps) => {
  const { props, ctx } = all;
  const p = (props ?? {}) as Record<string, any>;
  const spots: PeekSpot[] = Array.isArray(p.spots) ? p.spots : [];
  const size: number = typeof p.size === "number" && p.size > 0 ? p.size : SIZE;
  const bot = (p.bot ?? {}) as Record<string, any>;

  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const frame: PeekFrame = useMemo(() => ({
    width: win.width, height: win.height,
    top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right,
  }), [win.width, win.height, insets.top, insets.bottom, insets.left, insets.right]);

  const live = !!p.liveWhen && evalCondition(p.liveWhen, ctx);
  const done = !!p.doneWhen && evalCondition(p.doneWhen, ctx);
  const home = typeof p.home === "number" && p.home >= 0 && p.home < spots.length ? p.home : -1;

  const [at, setAt] = useState(() => (spots.length ? 0 : -1));
  const [phase, setPhase] = useState<Phase>("hidden");
  const [reduce, setReduce] = useState(false);
  const rise = useRef(new Animated.Value(0)).current;   // 0 hidden, 1 shown
  const hop = useRef(new Animated.Value(0)).current;    // 0 at rest, 1 at the top of the hop
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (alive) setReduce(!!on); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => setReduce(!!on));
    return () => { alive = false; (sub as { remove?: () => void } | undefined)?.remove?.(); };
  }, []);

  const place = at >= 0 && spots[at] ? placeOf(spots[at]!, frame, size) : null;

  /** Called, he comes to `home` and stays there; that is the one time the spot is not his own choice. */
  useEffect(() => {
    if (!live || home < 0 || at === home) return;
    setAt(home);
    rise.setValue(0);
    setPhase("rising");
  }, [live, home]);

  // The loop. Each step sets the next one; nothing here runs while he is held up by `live`.
  useEffect(() => {
    if (!spots.length || at < 0) return;
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    clear();

    if (phase === "hidden") {
      if (reduce) { setPhase("rising"); return clear; }
      timer.current = setTimeout(() => {
        setAt((was) => nextSpot(spots, was, Math.random()));
        setPhase("rising");
      }, inRange(p.every ?? [6, 14], Math.random()) * 1000);
      return clear;
    }

    if (phase === "rising") {
      Animated.timing(rise, { toValue: 1, duration: reduce ? 0 : RISE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(() => setPhase("up"));
      return clear;
    }

    if (phase === "up") {
      if (live || reduce) return clear;                       // held up while the microphone is live
      timer.current = setTimeout(() => setPhase("ducking"), inRange(p.up ?? [2, 4], Math.random()) * 1000);
      return clear;
    }

    if (phase === "hopping") {
      Animated.sequence([
        Animated.timing(hop, { toValue: 1, duration: HOP_MS / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: HOP_MS / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(() => setPhase(live ? "up" : "ducking"));
      return clear;
    }

    // ducking: down, then he takes his next place while nobody can see him.
    Animated.timing(rise, { toValue: 0, duration: reduce ? 0 : DUCK_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => setPhase("hidden"));
    return clear;
  }, [phase, at, live, reduce, spots.length]);

  /** The answer has landed: one hop, then away. */
  useEffect(() => { if (done && phase === "up") setPhase("hopping"); }, [done]);

  if (!place) return null;
  const w = widthOf(size);
  const { pocket, from, to } = place;
  const hopBy = hopTo(place, size);

  // THE POCKET IS THE SAFETY. It sits inside the safe area and is only as deep as a peek, so nothing of him can be
  // drawn over the status bar or the tab bar whatever the phone's cutout is. He moves inside it, and that is all.
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute", left: pocket.x, top: pocket.y, width: pocket.width, height: pocket.height,
        overflow: "hidden", zIndex: 6,
      }}
    >
      <Animated.View
        style={{
          position: "absolute", left: 0, top: 0, width: w, height: size,
          transform: [
            { translateX: rise.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] }) },
            { translateY: Animated.add(
                rise.interpolate({ inputRange: [0, 1], outputRange: [from.y, to.y] }),
                hop.interpolate({ inputRange: [0, 1], outputRange: [0, hopBy.y - to.y] }),
              ) },
            ...(place.flip ? [{ rotate: "180deg" as const }] : []),
          ],
        }}
      >
        <BotBuddy
          // BotBuddy is a renderer component: it takes the same bag every component takes, so the parts that are
          // not ours (the store, `fire`) are handed straight on rather than invented here.
          {...all}
          node={{ type: "BotBuddy" }}
          style={undefined}
          children={undefined}
          props={{
            kind: bot.kind ?? "custom",
            color: bot.color ?? "#4a535c",
            life: bot.life ?? "peek",
            height: size,
            size,
            width: w,
            state: bot.state ?? "idle",
            ...(bot.avatar ? { avatar: bot.avatar } : {}),
            // The glow is the catalog's, not this file's.
            ...(live && p.liveMoment ? { moment: p.liveMoment, momentMode: "loop" } : {}),
          }}
        />
      </Animated.View>
    </View>
  );
};
