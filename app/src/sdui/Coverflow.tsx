/**
 * Coverflow — a deck of cards turned in depth, dragged and thrown.
 *
 * THE ROTATION IS AROUND THE VERTICAL AXIS, and that is the whole component.
 * A card away from the middle is turned away from you, so its far edge is
 * genuinely further off and foreshortens; the deck reads as objects standing
 * in a space. Spun flat instead — a `rotate` rather than a `rotateY` — the
 * same cards read as a hand of playing cards fanned on a table, which is a
 * different thing entirely and the mistake that is easy to make from a
 * screenshot.
 *
 * ONE NUMBER, ONE SPRING. `pos` is where the deck sits, measured in cards. A
 * drag writes it; everything else is a spring pulling it toward `target`. So a
 * flick, a tap on a side card and the settle after a drag all arrive the same
 * way and cannot disagree about how the deck moves. Every card's transform is
 * an interpolation of that one value, which is also what keeps the whole deck
 * on the native driver: the UI thread owns the animation and the JS thread is
 * free while it runs.
 *
 * WHICH CARD WAS TAPPED IS ARITHMETIC, not a hit test. A card one out is
 * rotated and pushed back, so the box the platform hit-tests is foreshortened
 * and partly behind its neighbour — press a side card and the touch often
 * lands on neither. The deck already knows where every card is: `pos` plus the
 * tap's distance from the middle, in card widths, IS the index.
 *
 *   { "type": "Coverflow",
 *     "props": { "cardWidth": 164, "cardHeight": 118 },
 *     "on": { "onSelect": "openCard", "onChange": "noteCentred" },
 *     "children": [ …one node per card… ] }
 *
 * onSelect fires with the index as `$event` when a card is CHOSEN — tapped, or
 * tapped after being brought to the middle. onChange fires with the index
 * whenever a different card ARRIVES in the middle, however it got there. They
 * are separate because the deck's backdrop follows the middle card and must
 * change while the finger is still moving, whereas opening a screen must not.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, PanResponder, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CompProps } from "./components";

export const Coverflow = ({ props, style, children, fire }: CompProps): React.ReactElement => {
  const cards = React.Children.toArray(children);
  const n = cards.length;

  const cardWidth = Number(props?.cardWidth) || 164;
  const cardHeight = Number(props?.cardHeight) || 118;
  /** Distance between neighbouring card centres. Less than the card's width, so
   *  the deck overlaps and reads as a stack rather than a row. */
  const step = Number(props?.step) || Math.round(cardWidth * 0.72);
  /** Degrees a card is turned at one card out. */
  const rotation = props?.rotation !== undefined ? Number(props.rotation) : 38;
  /** How far it recedes at one card out, in points. */
  const depth = props?.depth !== undefined ? Number(props.depth) : 132;
  /** Lower is a stronger lens — more foreshortening on the side cards. */
  const perspective = Number(props?.perspective) || 760;
  /** How much a card shrinks and fades per card out. */
  const shrink = props?.shrink !== undefined ? Number(props.shrink) : 0.06;
  const fade = props?.fade !== undefined ? Number(props.fade) : 0.3;
  /** The settle. Stiffness and damping, not a duration — a throw has to carry
   *  its speed into the stop or the deck feels like it is on rails. */
  const stiffness = Number(props?.stiffness) || 140;
  const damping = Number(props?.damping) || 18;
  const mass = Number(props?.mass) || 0.9;
  /** How far a flick is projected when choosing where to land, in cards. */
  const throwFactor = props?.throwFactor !== undefined ? Number(props.throwFactor) : 0.9;

  const pos = useRef(new Animated.Value(0)).current;
  const posNow = useRef(0);
  const [index, setIndex] = useState(0);
  const width = useRef(0);
  const moved = useRef(0);

  // The one place `pos` is read back into JS: the deck has to know where it is
  // to decide what a tap meant, and to report the centred card.
  //
  // An effect, not a memo. A memo's return value is a value, never a teardown —
  // the listener it registered was never removed, and it registered during
  // render, so a double-invoked render left two of them writing the same refs.
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    let last = Math.round(posNow.current);
    const id = pos.addListener(({ value }) => {
      posNow.current = value;
      const near = Math.max(0, Math.min(n - 1, Math.round(value)));
      if (near === last) return;
      last = near;
      setIndex(near);
      // Announced as it happens, not when the deck stops: whatever is drawn
      // behind the middle card has to arrive with the card, and a backdrop
      // that changes a beat after the deck settles reads as a glitch.
      fireRef.current("onChange", near);
    });
    return () => pos.removeListener(id);
  }, [pos, n]);

  const settle = useCallback((to: number) => {
    const clamped = Math.max(0, Math.min(n - 1, to));
    Animated.spring(pos, {
      toValue: clamped,
      stiffness, damping, mass,
      useNativeDriver: true,
    }).start();
  }, [pos, n, stiffness, damping, mass]);

  const start = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => { start.current = posNow.current; moved.current = 0; },
      onPanResponderMove: (_, g) => {
        moved.current = Math.max(moved.current, Math.abs(g.dx));
        let next = start.current - g.dx / step;
        // Rubber band past the ends — the deck resists rather than stopping
        // dead, which is the difference between a limit and a fault.
        if (next < 0) next *= 0.35;
        if (next > n - 1) next = (n - 1) + (next - (n - 1)) * 0.35;
        pos.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        // A tap, not a throw: work out which card from where the finger was.
        if (moved.current <= 6) {
          const fromCentre = (g.x0 - width.current / 2) / step;
          const i = Math.max(0, Math.min(n - 1, Math.round(posNow.current + fromCentre)));
          settle(i);
          Haptics.selectionAsync().catch(() => {});
          fire("onSelect", i);
          return;
        }
        // Where the throw was heading. vx is points per ms; one card per flick
        // unless it was hard.
        settle(Math.round(posNow.current - (g.vx * 1000 * throwFactor) / step));
      },
      onPanResponderTerminate: () => settle(Math.round(posNow.current)),
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
      style={[{ alignItems: "center", justifyContent: "center" }, style]}
    >
      {cards.map((card, i) => {
        // Linear in `pos`, so one interpolation is exact at every distance
        // rather than only near the middle.
        const translateX = pos.interpolate({
          inputRange: [i - 4, i + 4],
          outputRange: [4 * step, -4 * step],
        });
        // Clamped: a card four out must not fold flat and disappear.
        const rotateY = pos.interpolate({
          inputRange: [i - 2, i, i + 2],
          outputRange: [`${rotation * 2}deg`, "0deg", `${-rotation * 2}deg`],
          extrapolate: "clamp",
        });
        const translateZ = pos.interpolate({
          inputRange: [i - 3, i, i + 3],
          outputRange: [-depth * 3, 0, -depth * 3],
          extrapolate: "clamp",
        });
        const scale = pos.interpolate({
          inputRange: [i - 3, i, i + 3],
          outputRange: [1 - shrink * 3, 1, 1 - shrink * 3],
          extrapolate: "clamp",
        });
        const opacity = pos.interpolate({
          inputRange: [i - 3, i, i + 3],
          outputRange: [Math.max(0.1, 1 - fade * 3), 1, Math.max(0.1, 1 - fade * 3)],
          extrapolate: "clamp",
        });
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute",
              width: cardWidth,
              height: cardHeight,
              opacity,
              // The middle card is nearest, so it must draw last.
              zIndex: 100 - Math.abs(index - i),
              transform: [
                { perspective },
                { translateX },
                { translateZ } as never,
                { rotateY },
                { scale },
              ],
            }}
          >
            {card}
          </Animated.View>
        );
      })}
    </View>
  );
};
