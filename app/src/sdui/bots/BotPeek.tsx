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
import { Animated, Easing, Pressable, View, useWindowDimensions, AccessibilityInfo } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CompProps } from "../components/props";
import { evalCondition } from "../actions";
import { BotBuddy } from "./BotBuddy";
import { Blur } from "../components/blur";
import { DUCK_MS, HOP_MS, RISE_MS, SIZE, hopTo, inRange, nextSpot, placeOf, pocketIn, widthOf, type PeekFrame, type PeekSpot } from "./peekCore";

type Phase = "hidden" | "rising" | "up" | "hopping" | "ducking";

export const BotPeek = (all: CompProps) => {
  const { props, ctx, fire } = all;
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
  /** CALLED, HE IS THE SCREEN: the page blurred behind him and the server's panel over it. Only while he is live. */
  const veiled = live && !!p.veil;
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

  /**
   * WHERE HIS HOST SITS IN THE WINDOW. The pocket is worked out in the window's own coordinates, because that is the
   * frame the safe area is written in; this node is mounted inside something else (on Home, a SafeArea that has
   * already taken the notch's height as padding), and an absolute child is placed against its parent. Measured once
   * the host has a layout, and again whenever it moves, so the pocket lands where the arithmetic meant it to.
   */
  const host = useRef<View | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const measure = () => {
    const h = host.current as unknown as { measureInWindow?: (cb: (x: number, y: number) => void) => void } | null;
    h?.measureInWindow?.((x, y) => {
      if (typeof x !== "number" || typeof y !== "number" || x !== x || y !== y) return;
      setOrigin((was) => (was && Math.abs(was.x - x) < 0.5 && Math.abs(was.y - y) < 0.5 ? was : { x, y }));
    });
  };

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

  // Nothing is drawn until the host has been measured: a pocket in the wrong frame is a bot standing on the page.
  // `box-none` while the veil is up: the layer itself takes nothing, its veil and panel do. "none" the rest of the
  // time, so a bot peeking from an edge is never in the way of the page he is peeking at.
  const shell = (inner: React.ReactNode) => (
    <View
      ref={host}
      onLayout={measure}
      pointerEvents={veiled ? "box-none" : "none"}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
    >
      {inner}
    </View>
  );
  if (!place || !origin) return shell(null);
  const w = widthOf(size);
  const { from, to } = place;
  const pocket = pocketIn(place, origin);
  const hopBy = hopTo(place, size);

  // THE POCKET IS THE SAFETY. It sits inside the safe area and is only as deep as a peek, so nothing of him can be
  // drawn over the status bar or the tab bar whatever the phone's cutout is. He moves inside it, and that is all.
  // THE VEIL AND THE PANEL. Home goes soft behind him under the same <Blur/> a thought's veil draws, and what the
  // SERVER sent as children is drawn under wherever he is hanging — the words as he hears them, his thinking, the
  // answer. He decides none of that: a line of text and a card are the same thing to him, which is the point.
  const veil = veiled ? (
    <>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, opacity: rise }}>
        <Pressable
          onPress={() => fire("onDismiss")}
          accessibilityRole="button"
          accessibilityLabel="Stop listening"
          style={{ flex: 1 }}
        >
          <Blur />
        </Pressable>
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 16, right: 16,
          top: pocket.y + pocket.height + 14,
          opacity: rise,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        }}
      >
        <View style={{ borderRadius: 22, backgroundColor: "#fff", maxHeight: Math.max(120, frame.height * 0.62), overflow: "hidden" }}>
          {all.children}
        </View>
      </Animated.View>
    </>
  ) : null;

  return shell(
    <>
    {veil}
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
            // LISTENING, and that is the whole of the antenna's light: the motion core lights it from the voice's own
            // level in this act (botTiles/core.ts `glowTo = level * 1.2`), exactly as the window's Blip does. A page
            // that wants something MORE than the light while he listens sends a `liveMoment` as well.
            ...(live ? { act: "listen" as const } : {}),
            ...(live && p.liveMoment ? { moment: p.liveMoment, momentMode: "loop" } : {}),
          }}
        />
      </Animated.View>
    </View>
    </>,
  );
};
