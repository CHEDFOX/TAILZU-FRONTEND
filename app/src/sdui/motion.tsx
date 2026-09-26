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
import * as K from "./knobs";

// Tuned to feel snappy but never abrupt. Spring, not linear — a linear
// scale reads as digital / cheap. Values chosen after eyeballing Grammarly
// + iOS system buttons on device; ~250ms round trip end-to-end.
//
// Every number is a knob (motion.*), read at the moment of the press so a new
// bootstrap retunes the whole app's feel without a remount. The literals are
// only what draws before the first bootstrap has ever arrived.
const springDown = () => ({
  friction: K.num("motion.springDown.friction", 8),
  tension: K.num("motion.springDown.tension", 300),
  useNativeDriver: true,
});
const springUp = () => ({
  friction: K.num("motion.springUp.friction", 6),
  tension: K.num("motion.springUp.tension", 220),
  useNativeDriver: true,
});

export type SpringPressableProps = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  hitSlop?: PressableProps["hitSlop"];
  style?: StyleProp<ViewStyle>;
  /** Scale target on press-in. Default motion.pressScale (0.94); 0.98 for large cards. */
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

/** Style keys that place a view in its parent, as opposed to painting it.
 *  These go on the Pressable; everything else stays on the view that scales. */
const LAYOUT_KEYS = new Set([
  "position", "top", "right", "bottom", "left", "zIndex",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "marginHorizontal", "marginVertical",
  "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf",
]);
// Sizing deliberately stays on the inner view: it is the surface being
// painted and scaled, and as a normal-flow child it already stretches to
// whatever width the Pressable ends up with. Moving width out would leave the
// background hugging its label inside a correctly sized tap target.

export function SpringPressable(props: SpringPressableProps): React.ReactElement {
  const {
    onPress, onLongPress, disabled, hitSlop, style,
    pressScale, haptic = true, impactOnRelease = false,
    flashColor,
    children,
  } = props;

  const scale = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;

  const pressIn = useCallback(() => {
    if (disabled) return;
    if (haptic) Haptics.selectionAsync().catch(() => {});
    Animated.spring(scale, { toValue: pressScale ?? K.num("motion.pressScale", 0.94), ...springDown() }).start();
    if (flashColor) {
      Animated.timing(flash, { toValue: 1, duration: K.num("motion.flashInMs", 60), useNativeDriver: true }).start();
    }
  }, [disabled, haptic, pressScale, scale, flashColor, flash]);

  const pressOut = useCallback(() => {
    if (disabled) return;
    Animated.spring(scale, { toValue: 1, ...springUp() }).start();
    if (flashColor) {
      Animated.timing(flash, { toValue: 0, duration: K.num("motion.flashOutMs", 280), useNativeDriver: true }).start();
    }
    if (impactOnRelease) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [disabled, impactOnRelease, scale, flashColor, flash]);

  // The flash overlay sits between the surface (the caller's background) and
  // the children (the label), so text stays crisp over the amber.
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, any>;
  const radius = flashColor ? (flat.borderRadius as number | undefined) : undefined;

  // WHERE a thing sits belongs to the Pressable; what it LOOKS like belongs to
  // the view that scales.
  //
  // Everything used to go on the inner Animated.View, which meant a caller
  // that said `position: absolute` took the button out of the flow of its own
  // wrapper. The Pressable, left with nothing laid out inside it, collapsed to
  // zero — and the insets then resolved against a 0×0 parent. A bar meant to
  // span the bottom of the screen rendered as its own padding: a small pill,
  // centred, because a zero-size child is centred by a centring parent. It was
  // still clickable, which is how it survived as "a dot that does something".
  const outer: Record<string, any> = {};
  const inner: Record<string, any> = {};
  for (const k of Object.keys(flat)) {
    (LAYOUT_KEYS.has(k) ? outer : inner)[k] = flat[k];
  }

  return (
    <Pressable
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      style={outer}
    >
      <Animated.View style={[{ transform: [{ scale }] }, inner]}>
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
