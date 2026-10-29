/**
 * THE LAUNCH, DRAWN: the splash's picture, then one swing, then the app (launchCore.ts says how it fits together).
 *
 * LaunchCurtain sits over the whole app from its first render. It draws the native splash's own frame (the same art,
 * size, place and ground), and once that is on screen it lifts the native splash from under it, so the join is one
 * picture replacing itself. Then the bot swings on its bar and blinks. It lets go when the app lifts the launch
 * (liftLaunch, from SduiApp when there is a screen), fading wherever the swing has got to: it never holds the app.
 * Reduce Motion: the still, then the fade.
 *
 * LaunchStill is the same picture standing still: the boot view between the launch and a first screen.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from "react-native";
import { num } from "../sdui/knobs";
import { BLINK, FADE_MS, GROUND, LAUNCH_MS, PIVOT, SPLASH_PT, hideNativeSplash, isLifted, liftLaunch, onLift, swingKeys } from "./launchCore";

/* eslint-disable @typescript-eslint/no-require-imports */
const ART = {
  splash: require("../../assets/launch/splash.png"),
  head: require("../../assets/launch/head.png"),
  bar: require("../../assets/launch/bar.png"),
  hands: require("../../assets/launch/hands.png"),
  blink: require("../../assets/launch/blink.png"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const SWING = swingKeys();
const SHUT = { inputRange: [0, BLINK[0], BLINK[0] + 0.001, BLINK[1], BLINK[1] + 0.001, 1], outputRange: [0, 0, 1, 1, 0, 0] };
const ORIGIN = `${PIVOT[0] * 100}% ${PIVOT[1] * 100}%`;

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

  // The art is on screen: the native splash can go, and the bot can move.
  const start = useRef(() => {
    if (started.current) return;
    started.current = true;
    requestAnimationFrame(() => {
      hideNativeSplash();
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((still) => {
        if (!still && !isLifted()) Animated.timing(t, { toValue: 1, duration: LAUNCH_MS, easing: Easing.linear, useNativeDriver: true }).start();
      });
    });
  }).current;
  const loaded = () => { if (++loads.current >= 4) start(); };

  useEffect(() => {
    if (gone) return;
    const late = setTimeout(start, 500);   // art that never says it loaded still lets the native splash go
    // Nothing holds the launch forever: the app's own floor (SduiApp) lifts it, and so does this, should the app
    // never get that far.
    const cap = setTimeout(liftLaunch, num("app.splash.maxHoldMs", 7000));
    const off = onLift(() => Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true)));
    return () => { clearTimeout(late); clearTimeout(cap); off(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;
  // The head swings behind the bar and the gloves in front of it, about the same point: stacked, they are splash.png.
  const swing = [styles.layer, { transform: [{ rotate: t.interpolate(SWING) }], transformOrigin: ORIGIN }];
  return (
    <Animated.View style={[styles.ground, { opacity: fade }]} pointerEvents="none">
      <View style={styles.art}>
        <Animated.View style={swing}>
          <Image source={ART.head} style={styles.layer} onLoad={loaded} />
          <Animated.Image source={ART.blink} style={[styles.layer, { opacity: t.interpolate(SHUT) }]} onLoad={loaded} />
        </Animated.View>
        <Image source={ART.bar} style={styles.layer} onLoad={loaded} />
        <Animated.View style={swing}>
          <Image source={ART.hands} style={styles.layer} onLoad={loaded} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;
const styles = StyleSheet.create({
  ground: { ...fill, backgroundColor: GROUND, alignItems: "center", justifyContent: "center" },
  art: { width: SPLASH_PT, height: SPLASH_PT },
  layer: { ...fill, width: SPLASH_PT, height: SPLASH_PT },
});
