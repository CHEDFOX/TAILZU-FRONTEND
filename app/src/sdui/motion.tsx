/**
 * Motion primitives — the physics language every SDUI touchable speaks.
 *
 * Everything the app renders that responds to touch should route through
 * these so the interaction "feel" reads as one system:
 *
 *   • Press-scale — 1.0 → 0.94, spring back on release. Uses the native
 *     driver so it survives JS-thread hitches (list scrolling, keyboard
 *     rendering).
 *   • Haptic — selection change on down, notification on error/success.
 *   • Optional lift — a small y-translate on press-up for cards/chips
 *     that ARE the interactive element (not the container).
 *
 * Sizing / colors stay with the caller — this only owns the animation.
 * That way any component (Button, Chip, Card, VoiceToggle, MicKey) can
 * wrap its own visual with the same motion in one JSX line.
 */
import React, { useCallback, useRef } from "react";
import { Animated, Pressable, StyleProp, StyleSheet, ViewStyle, PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

// Tuned to feel snappy but never abrupt. Spring, not linear — a linear
// scale reads as digital / cheap. Values chosen after eyeballing Grammarly
// + iOS system buttons on device; ~250ms round trip end-to-end.
const PRESS_SCALE = 0.94;
const SPRING_DOWN = { friction: 8, tension: 300, useNativeDriver: true };
const SPRING_UP   = { friction: 6, tension: 220, useNativeDriver: true };

export type SpringPressableProps = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  hitSlop?: PressableProps["hitSlop"];
  style?: StyleProp<ViewStyle>;
  /** Scale target on press-in. Default 0.94; use 0.98 for large cards. */
  pressScale?: number;
  /** Emit a selection haptic on press-down. Default true. */
  haptic?: boolean;
  /** Fire an impact haptic (medium) on press-up too. Rare — use for
   *  hero actions like submitting a form. */
  impactOnRelease?: boolean;
  /** Flash this color over the surface on press — the brand's "typing has
   *  our color" moment, same amber the keyboard flashes on every key. Snaps
   *  on in ~60ms, decays out over ~280ms after release. The overlay copies
   *  the caller style's borderRadius so pills stay pills mid-flash. */
  flashColor?: string;
  children?: React.ReactNode;
};

export function SpringPressable(props: SpringPressableProps): React.ReactElement {
  const {
    onPress, onLongPress, disabled, hitSlop, style,
    pressScale = PRESS_SCALE, haptic = true, impactOnRelease = false,
    flashColor,
    children,
  } = props;

  const scale = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;

  const pressIn = useCallback(() => {
    if (disabled) return;
    if (haptic) Haptics.selectionAsync().catch(() => {});
    Animated.spring(scale, { toValue: pressScale, ...SPRING_DOWN }).start();
    if (flashColor) {
      Animated.timing(flash, { toValue: 1, duration: 60, useNativeDriver: true }).start();
    }
  }, [disabled, haptic, pressScale, scale, flashColor, flash]);

  const pressOut = useCallback(() => {
    if (disabled) return;
    Animated.spring(scale, { toValue: 1, ...SPRING_UP }).start();
    if (flashColor) {
      Animated.timing(flash, { toValue: 0, duration: 280, useNativeDriver: true }).start();
    }
    if (impactOnRelease) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [disabled, impactOnRelease, scale, flashColor, flash]);

  // The flash overlay sits between the surface (the caller's background) and
  // the children (the label), so text stays crisp over the amber.
  const radius = flashColor ? (StyleSheet.flatten(style) as ViewStyle | undefined)?.borderRadius : undefined;

  return (
    <Pressable
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>
        {flashColor ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
              backgroundColor: flashColor,
              borderRadius: radius,
              opacity: flash,
            }}
          />
        ) : null}
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Motion values every screen can share for entrance animations. Wrap a
 * card in `FadeInUp` and it eases up 12px + fades in over 320ms on mount.
 * Cheap on the native driver so lists can use it too.
 */
export function FadeInUp({
  delayMs = 0,
  distance = 12,
  durationMs = 320,
  style,
  children,
}: {
  delayMs?: number;
  distance?: number;
  durationMs?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(distance)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: durationMs, delay: delayMs, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: durationMs, delay: delayMs, useNativeDriver: true }),
    ]).start();
  }, [delayMs, durationMs, opacity, translate]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY: translate }] }, style]}>
      {children}
    </Animated.View>
  );
}
