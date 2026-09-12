/**
 * MorphOut — how the opening scene leaves.
 *
 * WHY THIS IS NOT A SUCTION ANY MORE
 *
 * It used to translate the plate toward the in-app mic and shrink it, on the
 * idea that the intro and the mic are one object and the eye should follow it
 * into its resting place. Good idea; there is nothing at the destination to
 * follow it INTO. The intro plate is a 128pt circle in the dead centre of a
 * black window. The in-app mic is a 38pt control pinned to the right edge of a
 * text box, partway down a page that scrolls — so its position depends on how
 * much content happens to sit above it, and no fixed offset can find it.
 *
 * What shipped was 70pt straight down, ending at 23pt: wrong direction, wrong
 * distance, wrong final size. A move toward a target it cannot reach reads
 * exactly as what it is — an object that shrank and died in the middle of the
 * screen — and no amount of easing rescues a gesture that lands nowhere.
 *
 * So it does not aim. It collapses where it stands, and the whole design goes
 * into making that collapse feel physical:
 *
 *   ANTICIPATION. The first sixth expands the plate very slightly. Every real
 *   object gathers before it moves; without it the collapse starts from
 *   nothing, which is the single biggest reason a scale-down reads as a
 *   dismissal rather than an exit.
 *
 *   ACCELERATION. The rest keeps most of its size through the first third and
 *   then goes — the last fifth covers as much ground as the first half. Long
 *   enough that the eye registers the plate is still whole, short enough that
 *   it never watches it dwindle. Dwindling is the cheap part.
 *
 *   LATE FADE. Opacity holds at 1 for 82% of the travel. Fading with the scale
 *   turns the move into a dissolve, and a dissolve reads as two separate
 *   things — the exact impression this exists to remove.
 *
 * `dx`/`dy` are still honoured and default to zero, so a caller that does know
 * where its destination is can still aim at it.
 *
 * It never blocks: the navigation that follows is on its own timer, so if this
 * component is missing from an older bundle the backend's `fallback` renders
 * the plain plate and the intro still ends on time.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import type { CompProps } from "./components";

/**
 * The collapse, as explicit stops rather than an easing curve.
 *
 * Animated.interpolate applies an `easing` per SEGMENT, so a multi-stop range
 * cannot carry one curve for the gather and another for the fall. Hand-placed
 * stops can, and they also let the shape be read here instead of inferred from
 * a curve name: gather to 1.045, hold most of the size through the first third,
 * then go, with the last quarter covering more ground than the first half.
 *
 * A pure quartic ease-in was the obvious alternative and is wrong for this: it
 * is so flat at the start that the plate sits still for 300ms and then
 * disappears in 100, which reads as a stall followed by a cut.
 */
const COLLAPSE_IN =  [0, 0.16, 0.40, 0.62, 0.80, 1];
const COLLAPSE_OUT = [1, 1.045, 0.88, 0.62, 0.32, 0];
/** Where the gather ends. Travel, when a caller aims, starts here. */
const WINDUP = 0.16;

export function MorphOut({ props, style, children }: CompProps): React.ReactElement {
  const active = props.active === true;
  const durationMs = Number(props.durationMs) || 560;
  // Aim, for a caller that has a real target. Zero — collapse in place — is the
  // right default precisely because the intro's destination cannot be located.
  const dx = Number(props.dx) || 0;
  const dy = Number(props.dy) || 0;
  // All the way to nothing. The old 0.18 left a visible disc at the moment the
  // screen changed, so the last thing the eye saw was a small white dot being
  // cut off rather than an object finishing its move.
  const toScale = Number(props.toScale ?? 0);

  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    // One driver, shaped below rather than sequenced: a sequence re-enters the
    // animation system at the hand-off and can drop a frame exactly where the
    // eye is most sensitive — the moment the gather turns into the fall.
    Animated.timing(p, {
      toValue: 1,
      duration: durationMs,
      // Linear driver: the shape lives in the interpolation stops below, so
      // there is exactly one place to read it and one place to tune it.
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [active, durationMs, p]);

  const size = Number((style as { width?: number } | undefined)?.width) || 128;

  // Gather, then collapse — the whole shape, in one interpolation.
  const scale = p.interpolate({
    inputRange: COLLAPSE_IN,
    // toScale scales the whole curve, so a caller that wants to stop short of
    // nothing still gets the same shape on the way there.
    outputRange: COLLAPSE_OUT.map((v, i) =>
      i === COLLAPSE_OUT.length - 1 ? toScale : v),
  });

  // Movement starts only after the wind-up, so the gather is pure scale and
  // reads as breath rather than drift.
  const travel = p.interpolate({
    inputRange: [0, WINDUP, 1],
    outputRange: [0, 0, 1],
    easing: Easing.in(Easing.cubic),
  });

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [
            { translateX: Animated.multiply(travel, dx * size) },
            { translateY: Animated.multiply(travel, dy * size) },
            { scale },
          ],
          // Held at full opacity for most of the travel: fading early turns
          // the move into a dissolve, and a dissolve is exactly the "two
          // separate things" reading this exists to remove.
          opacity: p.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1, 1, 0] }),
        },
      ]}
    >
      <View style={{ width: "100%", height: "100%" }}>{children}</View>
    </Animated.View>
  );
}

export default MorphOut;
