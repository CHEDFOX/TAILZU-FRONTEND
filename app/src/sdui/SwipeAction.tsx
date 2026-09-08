/**
 * SwipeAction — a pill you drag open.
 *
 * The same gesture as the sign-in pills, made general: a disc at one end of a
 * pill, dragged to the other end, which fires an action when it lands. The
 * physics are lifted from MethodPill deliberately rather than reinvented — a
 * product should have ONE way of saying "commit this", and two hand-tuned
 * springs that nearly match read as two different apps.
 *
 * WHY A DRAG RATHER THAN A TAP. What is behind this is a live microphone and a
 * voice on the other end. A tap is the cheapest gesture there is and it is
 * over before anyone has decided anything; a drag is a held intention, so
 * nobody opens a conversation by brushing the screen on the way past. It also
 * costs the moment its own beat — the disc travelling IS the transition, so
 * the screen has already started changing before it changes.
 *
 * The disc sits on the LEFT and travels right, exactly as the auth pills do.
 * The reference art has its circle on the right, but a circle already parked
 * at the end it is meant to reach cannot suggest a direction — and a gesture
 * nobody can guess is a gesture nobody performs.
 *
 * Everything is a prop, because this is the way into the product and its feel
 * belongs to whoever is tuning the product, not to whoever shipped the build.
 *
 *   { "type": "SwipeAction",
 *     "props": { "label": "BEGIN", "hintDelayMs": 1200 },
 *     "on": { "onComplete": "enter" } }
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CompProps } from "./components";

export const SwipeAction = ({ props, style, fire }: CompProps): React.ReactElement => {
  const label = String(props?.label ?? "");
  const height = Number(props?.height) || 58;
  const radius = props?.radius !== undefined ? Number(props.radius) : height / 2;
  const background = String(props?.background ?? "#0B0B0D");
  const color = String(props?.color ?? "#FFFFFF");
  const fontSize = Number(props?.fontSize) || 12;
  const tracking = props?.tracking !== undefined ? Number(props.tracking) : 1.8;
  const disc = Number(props?.disc) || 46;
  const discBackground = String(props?.discBackground ?? "rgba(255,255,255,0.14)");
  const dot = Number(props?.dot) || 7;
  const dotColor = String(props?.dotColor ?? "#FFFFFF");
  /** What the disc lands in. The one warm thing on the pill, so the end of the
   *  journey is visible from the start of it. */
  const target = String(props?.targetBackground ?? "#C9862B");
  const targetDot = String(props?.targetDotColor ?? "#000000");
  const pad = Number(props?.padding) || 6;
  /** How far along counts as committed, 0..1 of the run. */
  const threshold = Number(props?.threshold) || 0.62;
  /** When the disc nudges itself to advertise the drag. 0 disables the hint. */
  const hintDelayMs = props?.hintDelayMs !== undefined ? Number(props.hintDelayMs) : 1200;
  /** How far the hint nudge travels, px. */
  const hintDistance = props?.hintDistance !== undefined ? Number(props.hintDistance) : 22;
  /** The spring the disc rides back on when a drag falls short. */
  const friction = Number(props?.friction) || 6;
  const tension = Number(props?.tension) || 80;
  /** How long the disc takes to run home once committed, ms. */
  const commitMs = Number(props?.commitMs) || 230;

  // The pill's width is whatever the layout gives it, so the run is measured
  // rather than assumed — a fixed guess breaks on the first narrow phone.
  const [width, setWidth] = useState(0);
  const run = Math.max(0, width - disc - pad * 2);

  const x = useRef(new Animated.Value(0)).current;
  const crossed = useRef(false);
  const done = useRef(false);
  const runRef = useRef(0);
  runRef.current = run;

  /**
   * THE HINT. One nudge out and back, once, a beat after arrival.
   *
   * Without it the gesture exists and nobody finds it — this is the whole way
   * into the screen, so a drag no one discovers is a dead end with a button on
   * it. Late enough that it is not part of the entrance, early enough to be
   * seen before anyone has given up and tapped.
   */
  useEffect(() => {
    if (!hintDelayMs || !run) return;
    const t = setTimeout(() => {
      if (done.current) return;
      Animated.sequence([
        Animated.spring(x, { toValue: hintDistance, friction: friction - 1, tension: tension + 10, useNativeDriver: true }),
        Animated.spring(x, { toValue: 0, friction, tension, useNativeDriver: true }),
      ]).start();
    }, hintDelayMs);
    return () => clearTimeout(t);
  }, [x, hintDelayMs, run, hintDistance, friction, tension]);

  const commit = useCallback(() => {
    done.current = true;
    Animated.timing(x, {
      toValue: runRef.current,
      duration: commitMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      fire("onComplete");
      // Reset behind the navigation, so coming back finds the pill as it was
      // rather than mid-gesture.
      setTimeout(() => { x.setValue(0); done.current = false; }, 420);
    });
  }, [x, fire, commitMs]);

  const springBack = useCallback(() => {
    Animated.spring(x, { toValue: 0, friction, tension, useNativeDriver: true }).start();
  }, [x, friction, tension]);

  const pan = useRef(
    PanResponder.create({
      // Claim on start as well as on move: the pill sits inside screens that
      // may have their own press or scroll handlers, and a pan that only
      // claims on MOVE has already lost the touch to an ancestor by then.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        crossed.current = false;
      },
      onPanResponderMove: (_, g) => {
        const r = runRef.current;
        const v = Math.max(0, Math.min(r, g.dx));
        x.setValue(v);
        // A tick at the point of no return, so the commit is felt before it is
        // seen and nobody lets go one pixel short wondering if it took.
        const at = r * threshold;
        if (!crossed.current && v >= at) { crossed.current = true; Haptics.selectionAsync().catch(() => {}); }
        else if (crossed.current && v < at) crossed.current = false;
      },
      onPanResponderRelease: (_, g) => {
        const r = runRef.current;
        const v = Math.max(0, Math.min(r, g.dx));
        if (v >= r * threshold) commit();
        else springBack();
      },
      onPanResponderTerminate: springBack,
    }),
  ).current;

  // The label steps aside as the disc comes through, rather than being run
  // over by it.
  const labelOpacity = run
    ? x.interpolate({ inputRange: [0, run * 0.45], outputRange: [1, 0], extrapolate: "clamp" })
    : 1;
  // The target warms up as the disc approaches — the pill answering the drag
  // instead of waiting to be finished with.
  const targetOpacity = run
    ? x.interpolate({ inputRange: [0, run * 0.5, run], outputRange: [0.35, 0.7, 1], extrapolate: "clamp" })
    : 0.35;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        {
          height,
          borderRadius: radius,
          backgroundColor: background,
          justifyContent: "center",
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Animated.Text
        numberOfLines={1}
        style={{
          textAlign: "center",
          fontSize,
          letterSpacing: tracking,
          color,
          opacity: labelOpacity,
          marginLeft: disc,
          marginRight: disc,
        }}
      >
        {label}
      </Animated.Text>

      {/* Where it is going. Drawn under the disc, at the far end. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          right: pad,
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: target,
          opacity: targetOpacity,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: targetDot }} />
      </Animated.View>

      {/* The disc. Hit area is the whole pill height, so a thumb that lands
          slightly high or low still takes the gesture. */}
      <Animated.View
        {...pan.panHandlers}
        style={{
          position: "absolute",
          left: pad,
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: discBackground,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ translateX: x }],
        }}
      >
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: dotColor }} />
      </Animated.View>
    </View>
  );
};
