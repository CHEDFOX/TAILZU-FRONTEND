/**
 * MorphOut — the opening scene being drawn into the mic.
 *
 * The intro and the in-app mic show the SAME piece of media: the mic's own
 * animation, in a white circular plate. Until now the intro simply cut to
 * home, so the user watched a thing, the screen blanked, and then an
 * identical thing appeared somewhere else. Two objects, when there was only
 * ever one.
 *
 * This makes it one. When `active` flips, the plate accelerates inward —
 * shrinking toward the point the mic occupies on the screen behind — and
 * fades as it goes. The eye follows a single object into its resting place
 * rather than watching one disappear and another arrive.
 *
 * The easing carries the whole idea. A linear or ease-out shrink reads as
 * something receding; suction is the opposite shape — slow to let go, then
 * quick — so this is a cubic ease-IN. Getting that backwards makes the same
 * animation look like a dismissal.
 *
 * It never blocks: the navigation that follows is on its own timer, so if
 * this component is missing from an older bundle the backend's `fallback`
 * renders the plain plate and the intro still ends on time.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import type { CompProps } from "./components";

export function MorphOut({ props, style, children }: CompProps): React.ReactElement {
  const active = props.active === true;
  const durationMs = Number(props.durationMs) || 520;
  // Where it goes, as a fraction of the plate's own size. Positive dy moves
  // down the screen — the mic sits below the intro plate's centre on home.
  const dx = Number(props.dx) || 0;
  const dy = Number(props.dy ?? 0.55);
  const toScale = Number(props.toScale ?? 0.18);

  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    Animated.timing(p, {
      toValue: 1,
      duration: durationMs,
      // Slow to let go, then quick. Suction, not recession.
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, durationMs, p]);

  const size = Number((style as { width?: number } | undefined)?.width) || 128;

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [
            { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, dx * size] }) },
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, dy * size] }) },
            { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, toScale] }) },
          ],
          // Held at full opacity for most of the travel: fading early turns
          // the move into a dissolve, and a dissolve is exactly the "two
          // separate things" reading this exists to remove.
          opacity: p.interpolate({ inputRange: [0, 0.72, 1], outputRange: [1, 1, 0] }),
        },
      ]}
    >
      <View style={{ width: "100%", height: "100%" }}>{children}</View>
    </Animated.View>
  );
}

export default MorphOut;
