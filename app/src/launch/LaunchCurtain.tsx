/**
 * THE LAUNCH, DRAWN: the splash's picture, then the bot pulls himself up over his bar, the bar is pulled in, and the
 * app is there (launchCore.ts says how it fits together, and has every number).
 *
 * LaunchCurtain sits over the whole app from its first render. It draws the native splash's own frame (the same art,
 * size, place and ground), and once that is on screen it lifts the native splash from under it, so the join is one
 * picture replacing itself. Then the motion plays, all of it on the native driver. The curtain ends on the app's white
 * and lets go once the motion is over and the app has lifted the launch (liftLaunch, from SduiApp when there is a
 * screen), whichever comes later. Reduce Motion: the still, then the fade.
 *
 * The layers, back to front: his head (behind the bar, shown only below its top edge), the bar (whole, then in strips
 * for the pull-in), his gloves (in front, each its own half, gripping, then letting go over the edge).
 *
 * LaunchStill is the same picture standing still: the boot view between the launch and a first screen.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from "react-native";
import { num } from "../sdui/knobs";
import {
  BAR, BAR_TOP, FADE_MS, GRIP_AT, GROUND, LAUNCH_MS, PINCH_AT, SPLASH_PT, STRIPS, U,
  barDy, degKeys, glove, head, hideNativeSplash, isLifted, keys, liftLaunch, onLift, strip,
} from "./launchCore";

/* eslint-disable @typescript-eslint/no-require-imports */
const ART = {
  splash: require("../../assets/launch/splash.png"),
  head: require("../../assets/launch/head.png"),
  bar: require("../../assets/launch/bar.png"),
  hands: require("../../assets/launch/hands.png"),
  blink: require("../../assets/launch/blink.png"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const Z = SPLASH_PT;
/** The head's clip reaches past the art on both sides: his sway may take an ear over its edge. */
const WIDE = 60;

/** Every key, sampled once. The strips only move from the pinch on, so theirs start there. */
const K = {
  bar: keys(barDy, 0, 1300),
  head: { dy: keys((t) => head(t).dy, 0, 900), sway: degKeys((t) => head(t).sway, 0, 900), sq: keys((t) => head(t).sq, 0, 900),
    shut: keys((t) => head(t).shut, 0, 700), shown: keys((t) => head(t).shown, 880, 900, 20) },
  gloves: ([0, 1] as const).map((s) => ({ grip: keys((t) => glove(s, t).grip, 0, 1000), dy: keys((t) => glove(s, t).dy, 800, 1000), shown: keys((t) => glove(s, t).shown, 800, 1000) })),
  whole: { inputRange: [0, PINCH_AT - 1, PINCH_AT], outputRange: [1, 1, 0] },
  strips: Array.from({ length: STRIPS }, (_, i) => ({
    dx: keys((t) => strip(i, STRIPS, t).dx, PINCH_AT, 1600), sx: keys((t) => strip(i, STRIPS, t).sx, PINCH_AT, 1600),
    sy: keys((t) => strip(i, STRIPS, t).sy, PINCH_AT, 1600), shown: keys((t) => strip(i, STRIPS, t).shown, PINCH_AT, 1600),
  })),
};
const SHOW_STRIPS = { inputRange: [0, PINCH_AT - 1, PINCH_AT], outputRange: [0, 0, 1] };

/** The splash's picture, still, where the splash has it. */
export function LaunchStill() {
  return (
    <View style={styles.ground} pointerEvents="none">
      <Image source={ART.splash} style={styles.art} />
    </View>
  );
}

export default function LaunchCurtain() {
  const [gone, setGone] = useState(isLifted);
  const t = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const loads = useRef(0);
  const started = useRef(false);
  // It lets go when both are true: the motion is over (or will not play) and the app has lifted the launch.
  const over = useRef(false);
  const up = useRef(false);
  const letGo = useRef(() => {
    if (!over.current || !up.current) return;
    Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
  }).current;

  // The art is on screen: the native splash can go, and the bot can move.
  const start = useRef(() => {
    if (started.current) return;
    started.current = true;
    requestAnimationFrame(() => {
      hideNativeSplash();
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((still) => {
        if (still || isLifted()) { over.current = true; letGo(); return; }
        Animated.timing(t, { toValue: LAUNCH_MS, duration: LAUNCH_MS, easing: Easing.linear, useNativeDriver: true })
          .start(() => { over.current = true; letGo(); });
      });
    });
  }).current;
  const loaded = () => { if (++loads.current >= 4) start(); };

  useEffect(() => {
    if (gone) return;
    const late = setTimeout(start, 500);   // art that never says it loaded still lets the native splash go
    // Nothing holds the launch forever: the app's own floor (SduiApp) lifts it, and so does this, should the app
    // never get that far.
    const cap = setTimeout(() => { over.current = true; liftLaunch(); }, num("app.splash.maxHoldMs", 7000));
    const off = onLift(() => { up.current = true; letGo(); });
    return () => { clearTimeout(late); clearTimeout(cap); off(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;
  const at = (k: { inputRange: number[]; outputRange: number[] | string[] }) => t.interpolate({ ...k, extrapolate: "clamp" } as never);
  const bar = at(K.bar);
  const barH = (BAR.y1 - BAR.y0) * U, stripW = (BAR.x1 - BAR.x0) * U / STRIPS;
  return (
    <Animated.View style={[styles.ground, { opacity: fade }]} pointerEvents="none">
      <View style={styles.art}>
        {/* His head, behind the bar: only what is below the bar's top edge shows, and the edge rides the bar. */}
        <Animated.View style={[styles.below, { left: -WIDE, width: Z + 2 * WIDE, transform: [{ translateY: bar }] }]}>
          <Animated.View style={[styles.piece, { left: WIDE, opacity: at(K.head.shown), transformOrigin: "50% 0%",
            transform: [{ rotate: at(K.head.sway) }, { scaleY: at(K.head.sq) }, { translateY: at(K.head.dy) }] }]}>
            <Image source={ART.head} style={styles.lifted} onLoad={loaded} />
            <Animated.Image source={ART.blink} style={[styles.lifted, { opacity: at(K.head.shut) }]} onLoad={loaded} />
          </Animated.View>
        </Animated.View>
        {/* The bar: whole, until it pinches; then in strips, each pulled in to the middle. */}
        <Animated.Image source={ART.bar} style={[styles.layer, { opacity: at(K.whole), transform: [{ translateY: bar }] }]} onLoad={loaded} />
        <Animated.View style={[styles.layer, { opacity: t.interpolate({ ...SHOW_STRIPS, extrapolate: "clamp" }), transform: [{ translateY: bar }] }]}>
          {K.strips.map((s, i) => {
            const left = BAR.x0 * U + i * stripW;
            return (
              <Animated.View key={i} style={{ position: "absolute", overflow: "hidden", left, top: BAR.y0 * U, width: stripW + 0.6, height: barH,
                opacity: at(s.shown), transform: [{ translateX: at(s.dx) }, { scaleX: at(s.sx) }, { scaleY: at(s.sy) }] }}>
                <Image source={ART.bar} style={{ position: "absolute", left: -left, top: -BAR.y0 * U, width: Z, height: Z }} />
              </Animated.View>
            );
          })}
        </Animated.View>
        {/* His gloves, in front: each its own half, squeezed toward the bar as they grip, then up over its edge. */}
        {K.gloves.map((g, side) => (
          <Animated.View key={side} style={[styles.below, { left: side * Z / 2, width: Z / 2, opacity: at(g.shown), transform: [{ translateY: bar }] }]}>
            <Animated.View style={[styles.piece, { transformOrigin: `50% ${GRIP_AT * 100}%`,
              transform: [{ scaleY: t.interpolate({ ...g.grip, outputRange: g.grip.outputRange.map((v) => 1 - v), extrapolate: "clamp" }) }] }]}>
              <Animated.Image source={ART.hands} style={[styles.lifted, { left: -side * Z / 2, transform: [{ translateY: at(g.dy) }] }]} onLoad={side ? undefined : loaded} />
            </Animated.View>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;
const styles = StyleSheet.create({
  ground: { ...fill, backgroundColor: GROUND, alignItems: "center", justifyContent: "center" },
  art: { width: Z, height: Z },
  layer: { position: "absolute", top: 0, left: 0, width: Z, height: Z },
  // A clip from the bar's top edge down: nothing above the ledge shows.
  below: { position: "absolute", top: BAR_TOP, height: Z, overflow: "hidden" },
  // The art's own square, laid from that edge.
  piece: { position: "absolute", top: 0, left: 0, width: Z, height: Z },
  lifted: { position: "absolute", top: -BAR_TOP, left: 0, width: Z, height: Z },
});
