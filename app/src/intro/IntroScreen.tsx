/**
 * Post-splash intro sequence — the brand animation the user sees between
 * the native splash and the main app.
 *
 * Sequence on cold launch:
 *
 *   iOS splash (native)   ← handled by expo-splash-screen from assets/splash.png
 *      │
 *   JS bundle boots
 *      │
 *   /v1/app/bootstrap     ← app pulls theme + flags + media registry
 *      │
 *   IntroScreen           ← THIS component, backend-driven media
 *      │
 *   SduiApp               ← the actual product
 *
 * Backend controls, all optional:
 *   flags["intro.media"]         MediaSpec — the video/Lottie/GIF/image
 *                                  to play. Absent → intro is skipped.
 *   flags["intro.maxDurationMs"] Number    — hard cap (default 4500).
 *   flags["intro.background"]    Hex       — solid color behind the media
 *                                  (default #0e0e12 — app's dark ground).
 *   flags["intro.showEveryLaunch"] Boolean — true → replay on every open.
 *                                  Default false = shown once, cached in
 *                                  AsyncStorage under "intro.seen.v1".
 *
 * User can tap anywhere to skip. onEnd from MediaPlayer also dismisses.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { MediaPlayer } from "../media/MediaPlayer";
import type { MediaSpec } from "../media/resolveMedia";

type Props = {
  spec: MediaSpec;
  maxDurationMs?: number;
  background?: string;
  onDone: () => void;
};

export function IntroScreen({
  spec,
  maxDurationMs = 4500,
  background = "#0e0e12",
  onDone,
}: Props): React.ReactElement {
  const opacity = useRef(new Animated.Value(1)).current;
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    // Short fade to the app instead of a hard cut — the SduiApp underneath
    // has already rendered by the time this runs, so the transition reads
    // as one smooth handoff.
    Animated.timing(opacity, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [opacity, onDone]);

  // Hard-cap timer so a static image (which has no natural end) or a very
  // long video doesn't wedge the user in the intro.
  useEffect(() => {
    const t = setTimeout(dismiss, maxDurationMs);
    return () => clearTimeout(t);
  }, [dismiss, maxDurationMs]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: background,
          opacity,
          alignItems: "center",
          justifyContent: "center",
          zIndex: 999,
        },
      ]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={dismiss}
        accessibilityLabel="Skip intro"
      />
      <MediaPlayer
        spec={spec}
        style={styles.media}
        contentFit="contain"
        autoplay
        loop={false}
        muted
        // Fires when a Lottie / video reaches its end. Static images and
        // GIFs never fire this — the maxDurationMs cap dismisses them.
        onEnd={dismiss}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Big — fills most of the screen, contentFit="contain" preserves aspect.
  // Explicit dimensions instead of flex so images with intrinsic size
  // ratio correctly on every device.
  media: {
    width: "100%",
    height: "100%",
  },
});
