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
import { Animated, Easing, PanResponder, Pressable, View } from "react-native";
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
  /** The mark inside each circle. 0 leaves them plain — which is the default
   *  look: two clean discs, nothing drawn in them. */
  const dot = props?.dot !== undefined ? Number(props.dot) : 0;
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
  /**
   * Put the disc back at the start this long after committing. 0 leaves it at
   * the end, which is the default and right whenever the commit navigates —
   * see commit() below.
   */
  const resetAfterMs = Number(props?.resetAfterMs) || 0;
  /**
   * A tap commits too.
   *
   * The drag is the intended gesture and the hint advertises it, but a pill
   * that looks like a button and does nothing when pressed reads as broken —
   * and the person who taps it is not told why nothing happened. So a tap runs
   * the disc across itself: the same commit, the same travel, just triggered
   * without the finger doing the work. Anyone who taps still SEES the gesture
   * they were meant to make, which teaches it for next time.
   */
  const tapToo = props?.tap !== false;

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
   * WHERE THE DISC ACTUALLY IS, and where this drag started from.
   *
   * The disc used to be placed at the gesture's dx outright, which quietly
   * assumes it was at zero when the finger landed. It very often is not: the
   * hint nudges it out and springs it back, a previous drag may still be
   * settling, and either way the first move frame teleports the disc to the
   * finger instead of moving with it. The circle jumps, and after that the
   * whole drag is offset by however far it jumped — so the far end arrives
   * early or never arrives at all.
   *
   * A drag is a relative gesture. It starts from wherever the thing is.
   */
  const at = useRef(0);
  const from = useRef(0);
  useEffect(() => {
    const id = x.addListener(({ value }) => { at.current = value; });
    return () => x.removeListener(id);
  }, [x]);

  /** True while a finger is down, so the hint cannot animate over the drag. */
  const held = useRef(false);

  /**
   * Arrived, and parked there by hand rather than by the animation.
   *
   * State, not a ref, because it has to cause the render that pins the disc —
   * see commit(). Everything else about this control is a ref precisely to
   * avoid re-rendering during a gesture; this one moment is the exception,
   * and it happens once, after the gesture is over.
   */
  const [landed, setLanded] = useState(false);

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
      // Never over a finger. The hint exists for someone who has not touched
      // the pill; animating it while they are dragging takes the disc off them.
      if (done.current || held.current) return;
      Animated.sequence([
        Animated.spring(x, { toValue: hintDistance, friction: friction - 1, tension: tension + 10, useNativeDriver: true }),
        Animated.spring(x, { toValue: 0, friction, tension, useNativeDriver: true }),
      ]).start();
    }, hintDelayMs);
    return () => clearTimeout(t);
  }, [x, hintDelayMs, run, hintDistance, friction, tension]);

  const commit = useCallback(() => {
    done.current = true;
    setLanded(false);
    Animated.timing(x, {
      toValue: runRef.current,
      duration: commitMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      /**
       * PIN IT BEFORE ANYTHING ELSE HAPPENS — and this is the whole bug.
       *
       * A native-driven animation runs on the other side of the bridge and
       * does not write its result back: when this callback runs, the native
       * node has the disc at the far end and the JS value is still whatever it
       * was when the animation started, which for a tap is zero. Nothing is
       * wrong until something re-renders — and the very next line re-renders,
       * because firing the action navigates. React re-commits `translateX` from
       * the stale JS value and the disc jumps home, a frame or two before the
       * new screen paints over it. The disc ran right, snapped left, and then
       * the screen changed: three separate events where there should be one.
       *
       * `landed` takes the disc off the animated value entirely and puts it at
       * the end as a plain number, so a re-render has nothing left to get
       * wrong; setValue brings the JS side back in step for whatever comes
       * after. Both, in that order, and before the action fires.
       */
      setLanded(true);
      x.setValue(runRef.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      fire("onComplete");
      // THE DISC STAYS WHERE IT WAS THROWN, unless the screen asks otherwise.
      //
      // It used to snap home 420ms later, on the assumption that the commit
      // navigates and the reset happens behind the new screen. That is true of
      // every use today — and when it is true the reset is also unnecessary,
      // because navigating unmounts this node and a remount starts at zero
      // anyway. When it is NOT true the timer is simply visible: the disc
      // arrives at the end and walks back, which reads as the gesture being
      // refused a beat after it was accepted.
      //
      // So: 0 means stay, and a screen whose commit does not navigate — one
      // that fires an endpoint and stands still — sets resetAfterMs to make the
      // control usable a second time.
      if (resetAfterMs > 0) {
        setTimeout(() => { setLanded(false); x.setValue(0); done.current = false; }, resetAfterMs);
      }
    });
  }, [x, fire, commitMs, resetAfterMs]);

  // Read inside the PanResponder, which is built once and would otherwise
  // close over the first render's value forever.
  const tapRef = useRef(tapToo);
  tapRef.current = tapToo;

  // Nothing sends a committed disc home. A spring that arrives after the
  // commit reads as the gesture being taken back, and it is the same picture
  // as the stale-value jump whatever started it.
  const springBack = useCallback(() => {
    if (done.current) return;
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
        // A second gesture on a pill that has already fired is a touch on the
        // way out of the screen, not a new drag.
        if (done.current) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        crossed.current = false;
        held.current = true;
        // Take the disc off whatever was moving it and start from there. A
        // spring left running under the finger drags the disc one way while
        // the hand pulls it the other, which is most of what "the circle does
        // not follow" looks like.
        x.stopAnimation();
        from.current = at.current;
      },
      onPanResponderMove: (_, g) => {
        if (done.current) return;
        const r = runRef.current;
        const v = Math.max(0, Math.min(r, from.current + g.dx));
        x.setValue(v);
        // A tick at the point of no return, so the commit is felt before it is
        // seen and nobody lets go one pixel short wondering if it took.
        const mark = r * threshold;
        if (!crossed.current && v >= mark) { crossed.current = true; Haptics.selectionAsync().catch(() => {}); }
        else if (crossed.current && v < mark) crossed.current = false;
      },
      onPanResponderRelease: (_, g) => {
        held.current = false;
        if (done.current) return;
        const r = runRef.current;
        const v = Math.max(0, Math.min(r, from.current + g.dx));
        if (v >= r * threshold) commit();
        // Barely moved on either axis: that was a tap, not a failed drag.
        else if (tapRef.current && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) commit();
        else springBack();
      },
      onPanResponderTerminate: () => { held.current = false; springBack(); },
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

  const body = (
    <>
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
        {dot > 0 ? (
          <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: targetDot }} />
        ) : null}
      </Animated.View>

      {/* The disc. It claims touches on itself — children are offered a touch
          before their parents — so the pan below still wins its own gestures
          even with a Pressable wrapping the whole pill. */}
      <Animated.View
        {...pan.panHandlers}
        // A 46pt disc is a 46pt target and a thumb is wider than that. The slop
        // costs nothing — everything around it is the pill, whose only other
        // gesture is a tap that does the same thing.
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        style={{
          position: "absolute",
          left: pad,
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: discBackground,
          alignItems: "center",
          justifyContent: "center",
          // A plain number once it has arrived — see commit(). While it is
          // moving the animated value owns it; once it is parked, nothing does.
          transform: [{ translateX: landed ? run : x }],
        }}
      >
        {dot > 0 ? (
          <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: dotColor }} />
        ) : null}
      </Animated.View>
    </>
  );

  const frame = {
    height,
    borderRadius: radius,
    backgroundColor: background,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };

  // Pressable only when a tap is allowed, so a drag-only pill costs a plain
  // View and cannot be committed by a stray touch.
  if (!tapToo) {
    return (
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[frame, style]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPress={() => { if (!done.current) commit(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[frame, style]}
    >
      {body}
    </Pressable>
  );
};
