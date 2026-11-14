/**
 * The kinds of Input a finger drags: slider and slideToConfirm (pure/SPEC.md 2.8, wave 1).
 *
 * Drawn with React Native's own PanResponder, not gesture-handler: gestures on any node are B5's, a different
 * package and a different owner, and these two only need a finger on a track they own. No new library either way.
 *
 * WHILE THE FINGER IS DOWN, THE STORE IS NOT WRITTEN. A slider that writes on every pixel is a store write and a
 * re-render of the whole screen per frame. The knob follows the finger locally; the value lands when the finger
 * lifts, which is also the rule B5 sets for gestures (pure/SPEC.md 2.5: "store written on end only"). A node that
 * really wants the live value asks for `live: true` and gets it at most ten times a second.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Text, View, type LayoutChangeEvent } from "react-native";
import * as K from "../../knobs";
import { useTheme } from "../../theme/ThemeContext";
import type { KindProps } from "./parts";
import { clampStep, fraction, slideCommitted, slideThreshold, slideTravel, valueAtX } from "./inputCore";

/** slider: a value anywhere in a range, on a step. */
export function SliderKind({ props, style, value, write, fire, disabled }: KindProps) {
  const theme = useTheme();
  const min = props.min !== undefined ? Number(props.min) : 0;
  const max = props.max !== undefined ? Number(props.max) : 1;
  const step = props.step !== undefined ? Number(props.step) : 0;
  const knob = Number(props.knobSize ?? K.num("ui.Input.sliderKnob", 24));
  const track = Number(props.trackHeight ?? K.num("ui.Input.sliderTrack", 4));
  const [width, setWidth] = useState(0);
  // Where the finger is, in a ref so the value is read back without waiting for a render, and in state only so the
  // knob redraws.
  const at = useRef<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lastLive = useRef(0);
  const held = clampStep(value, min, max, step);
  const shown = drag ?? held;
  const k = fraction(shown, min, max);

  const pan = useMemo(() => {
    const moved = (x: number) => {
      const next = valueAtX(x, width, knob, min, max, step);
      at.current = next;
      setDrag(next);
      return next;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => { moved(e.nativeEvent.locationX); },
      onPanResponderMove: (e) => {
        const next = moved(e.nativeEvent.locationX);
        if (props.live === true) {
          const now = Date.now();
          if (now - lastLive.current >= K.num("ui.Input.sliderLiveMs", 100)) { lastLive.current = now; write(next); }
        }
      },
      onPanResponderRelease: () => {
        const end = at.current;
        at.current = null;
        setDrag(null);
        if (end !== null) { write(end); fire("onSubmit", end); }
      },
      onPanResponderTerminate: () => { at.current = null; setDrag(null); },
    });
  }, [disabled, width, knob, min, max, step, props.live, write, fire]);

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={[{ height: Math.max(knob, 40), justifyContent: "center", opacity: disabled ? 0.5 : 1 }, style]}
    >
      <View style={{ height: track, borderRadius: track, backgroundColor: props.trackColor ?? theme.color.border }}>
        <View style={{ width: `${k * 100}%`, height: track, borderRadius: track, backgroundColor: props.activeColor ?? theme.color.primary }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute", left: k * Math.max(0, width - knob), width: knob, height: knob, borderRadius: knob / 2,
          backgroundColor: props.knobColor ?? theme.color.text,
        }}
      />
    </View>
  );
}

/**
 * slideToConfirm: a disc pulled across a pill, for the one action that must not happen by a brush of a sleeve.
 *
 * It springs home unless it gets far enough (`threshold`, nine tenths by default), and only then does it write true
 * and fire `onCommit`. This is the shape the sign-in's SwipePill drew by hand; here it is one kind of one node.
 */
export function SlideToConfirmKind({ props, style, value, write, fire, disabled }: KindProps) {
  const theme = useTheme();
  // Every number is checked: a garbled height gives a garbled travel, and a NaN travel is a slide that can never
  // commit however far it is pulled.
  const height = sizeOf(props.height, K.num("ui.Input.slideHeight", 56));
  const inset = sizeOf(props.inset, K.num("ui.Input.slideInset", 8));
  const knob = Math.max(8, height - inset);
  const threshold = slideThreshold(props.threshold);
  const [width, setWidth] = useState(0);
  const travel = slideTravel(width, knob);
  const x = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  const done = useRef(value === true);

  /**
   * THE VALUE IS IN CHARGE, NOT THE LAST SLIDE.
   *
   * `done` used to be read once and never again, so a screen that set the value back to false after a failed action
   * left the control locked for good, and a screen that opened with it true drew the knob at the start while
   * refusing to move. Now the knob follows the value: committed means at the end, not committed means home.
   */
  useEffect(() => {
    const on = value === true;
    const to = on ? travel : 0;
    if (on === done.current && at.current === to) return;
    done.current = on;
    at.current = to;
    x.stopAnimation();
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0 }).start();
  }, [value, travel, x]);

  const pan = useMemo(() => {
    // A cancelled touch — the Screen's ScrollView taking the gesture, a call coming in — used to leave the knob
    // halfway along, which reads as "nearly confirmed". It springs home instead, and this control asks to keep the
    // gesture while a finger is on it.
    const home = () => {
      at.current = 0;
      Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled && !done.current,
      onMoveShouldSetPanResponder: () => !disabled && !done.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        const dx = Number(g.dx);
        if (!Number.isFinite(dx)) return;
        at.current = Math.min(travel, Math.max(0, dx));
        x.setValue(at.current);
      },
      onPanResponderRelease: () => {
        if (slideCommitted(at.current / travel, threshold)) {
          done.current = true;
          at.current = travel;
          Animated.timing(x, { toValue: travel, duration: K.num("ui.Input.slideSettleMs", 120), useNativeDriver: true }).start();
          write(true);
          fire("onSubmit", true);
          return;
        }
        home();
        fire("onDismiss");
      },
      // A cancelled touch is not a refusal, so it springs back without telling the screen anything.
      onPanResponderTerminate: home,
    });
  }, [disabled, travel, threshold, x, write, fire]);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={[
        {
          height, borderRadius: height / 2, backgroundColor: props.background ?? theme.color.inputBg,
          justifyContent: "center", opacity: disabled ? 0.5 : 1, overflow: "hidden",
        },
        style,
      ]}
    >
      {props.label ? (
        <Text style={{ alignSelf: "center", color: props.color ?? theme.color.muted }}>{String(props.label)}</Text>
      ) : null}
      <Animated.View
        {...pan.panHandlers}
        style={{
          position: "absolute", left: 4, width: knob, height: knob, borderRadius: knob / 2,
          backgroundColor: props.knobColor ?? theme.color.primary, transform: [{ translateX: x }],
        }}
      />
    </View>
  );
}

/** A size the server sent, in points. Anything that is not a real positive number is the default. */
function sizeOf(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
