/**
 * Tab icons drawn as thread art.
 *
 * The bottom bar used to be three words. These replace them, and the whole
 * point is that they should NOT look vector-perfect: real thread pulled around
 * pins never sits on a clean curve, the tension varies, and a couple of ends
 * always stick out past the last pin.
 *
 * So the paths are hand-placed with deliberate irregularity rather than
 * generated from a formula — a wobble that repeats is worse than no wobble,
 * because the eye reads the repeat and the illusion goes. Each icon also
 * carries one or two loose ends and a slightly uneven stroke, which is what
 * sells "made by hand" at 26pt.
 *
 * Active state: the thread takes the brand amber and shakes — a short, damped
 * wobble, as if it were plucked. Not a loop; a plucked string settles.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

export const THREAD_ACTIVE = "#E8A23C";

type Props = { active: boolean; color: string; size?: number };

/**
 * The pluck. Runs when a tab BECOMES active (and again on each tap of the
 * already-active tab, driven by `nonce`).
 *
 * Rotation rather than translation: a shake that slides looks like a UI error
 * state, and a shake that pivots looks like something physical was knocked.
 * Amplitude decays across the four beats so it settles instead of stopping.
 */
function usePluck(active: boolean, nonce: number) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    spin.setValue(0);
    Animated.sequence([
      Animated.timing(spin, { toValue: 1, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(spin, { toValue: -0.72, duration: 80, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(spin, { toValue: 0.4, duration: 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(spin, { toValue: 0, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [active, nonce, spin]);
  return spin.interpolate({ inputRange: [-1, 1], outputRange: ["-9deg", "9deg"] });
}

function Frame({ active, nonce, size, children }: {
  active: boolean; nonce: number; size: number; children: React.ReactNode;
}) {
  const rotate = usePluck(active, nonce);
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size} viewBox="0 0 32 32">{children}</Svg>
    </Animated.View>
  );
}

/**
 * YOU — a fingerprint, wound.
 *
 * This was a zig-zag: seven straight segments, next to a brain built from
 * chords and a circle built from a chord envelope. It read as the icon nobody
 * had thought about, because it was.
 *
 * A fingerprint is the right answer and not an arbitrary one. It is the mark
 * that means a specific person and no other, and it is already made of what
 * this set is made of — continuous open lines that never quite close. Nothing
 * else in the bar could be mistaken for it.
 *
 * Drawn as four open whorls that do not nest evenly, plus two ridge endings —
 * the short stubs where a real ridge stops between its neighbours, which is
 * the detail that makes a print look printed rather than drawn. Each arc opens
 * at a different angle so the eye never finds a shared seam.
 */
export function ThreadYou({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      {/* the core curl — where every ridge turns back on itself */}
      <Path d="M13.6 16.6 C13.1 14.1 17.5 13.4 18.0 15.9 C18.4 18.2 15.1 19.3 13.9 17.6"
        stroke={c} strokeWidth={1.5} strokeLinecap="round" fill="none" />
      {/* Whorls that wrap nearly all the way round, each opening at a
          DIFFERENT angle. Drawn as arcs opening only ~60°: at 200° they read
          as a wifi fan, which is the wrong icon entirely. */}
      <Path d="M12.0 19.2 A 5.0 5.6 0 1 1 17.5 20.9"
        stroke={c} strokeWidth={1.45} strokeLinecap="round" fill="none" opacity={0.95} />
      <Path d="M12.2 22.5 A 7.2 8.0 0 1 1 19.4 22.5"
        stroke={c} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.82} />
      <Path d="M12.6 25.2 A 9.4 10.2 0 1 1 21.2 24.0"
        stroke={c} strokeWidth={1.35} strokeLinecap="round" fill="none" opacity={0.68} />
      {/* ridge endings — the short stubs a real print is full of */}
      <Path d="M15.4 21.4 L15.6 23.6" stroke={c} strokeWidth={1.1} strokeLinecap="round" fill="none" opacity={0.6} />
      <Path d="M19.0 19.6 L20.4 21.2" stroke={c} strokeWidth={1.0} strokeLinecap="round" fill="none" opacity={0.5} />
      {/* the thread leaving the print, as every icon here has one */}
      <Path d="M21.2 24.0 L23.4 26.8" stroke={c} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.7} />
    </Frame>
  );
}

/**
 * TRAIN — a brain, wound rather than drawn.
 *
 * The outline is two lobes that do not quite meet, with the interior filled by
 * chord lines the way string art fills a shape: straight threads between pins
 * on the boundary, which the eye assembles into folds. Drawing actual smooth
 * gyri would read as an icon of a brain; this reads as a brain someone wound.
 */
export function ThreadTrain({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d="M15.8 5.1 C10.4 4.4 6.1 7.6 6.0 11.4 C3.7 13.1 4.2 17.0 6.6 18.2
               C6.1 21.6 9.0 24.4 12.4 23.9 C13.6 26.2 17.2 26.4 18.4 24.2
               C22.3 25.0 25.6 21.9 25.0 18.6 C27.6 17.1 27.5 13.0 25.1 11.6
               C25.4 7.7 20.8 4.3 15.8 5.1 Z"
        stroke={c} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* The fissure between the hemispheres, full strength — this one line is
          what makes the shape read as a brain rather than a bean. */}
      <Path d="M15.9 5.4 L15.6 24.6" stroke={c} strokeWidth={1.3} strokeLinecap="round" opacity={0.85} fill="none" />
      {/* Three chords, not six. At 26pt a dense winding stops being folds and
          becomes a mesh, and a woven ball is not a brain — the silhouette has
          to win. These suggest the folds and then get out of the way. */}
      <Path d="M7.4 12.4 L19.4 8.6" stroke={c} strokeWidth={0.95} strokeLinecap="round" opacity={0.5} fill="none" />
      <Path d="M7.8 18.2 L20.8 14.2" stroke={c} strokeWidth={0.95} strokeLinecap="round" opacity={0.5} fill="none" />
      <Path d="M12.6 22.8 L23.2 17.4" stroke={c} strokeWidth={0.9} strokeLinecap="round" opacity={0.42} fill="none" />
      {/* the stem, and a thread end left hanging */}
      <Path d="M15.7 24.4 L15.2 28.3" stroke={c} strokeWidth={1.3} strokeLinecap="round" fill="none" opacity={0.8} />
    </Frame>
  );
}

/**
 * STATS — a rising thread, pulled taut over pins.
 *
 * This was a circular chord winding: beautiful on its own, and at 26pt almost
 * indistinguishable from the brain beside it. Two round icons full of straight
 * lines is one idea shown twice, and the bar has three seconds to be read.
 *
 * A climb over pins is unmistakable at any size, says what the tab holds
 * without a chart's furniture, and is still the same craft — the thread is
 * straight between pins because thread is, and the pins are where it turns.
 */
export function ThreadStats({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  // Uneven on purpose: a monotonic climb reads as a logo, and real numbers
  // dip. The third pin falls below the second.
  const pins: Array<[number, number]> = [[5.0, 23.6], [10.6, 18.8], [16.0, 20.6], [21.4, 13.2], [27.0, 7.8]];
  const line = pins.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return (
    <Frame active={active} nonce={nonce} size={size}>
      {/* the ground the pins are driven into — open at both ends */}
      <Path d="M3.6 27.0 L28.4 27.0" stroke={c} strokeWidth={1.15} strokeLinecap="round"
        fill="none" opacity={0.45} strokeDasharray="17 5" />
      {/* two threads dropped to the ground, so the climb has a scale */}
      <Path d="M10.6 18.8 L10.6 26.6" stroke={c} strokeWidth={0.95} strokeLinecap="round" fill="none" opacity={0.4} />
      <Path d="M21.4 13.2 L21.4 26.6" stroke={c} strokeWidth={0.95} strokeLinecap="round" fill="none" opacity={0.4} />
      {/* the climb */}
      <Path d={line} stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* the pins it turns on */}
      {pins.map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={i === pins.length - 1 ? 1.5 : 1.15} fill={c}
          opacity={i === pins.length - 1 ? 1 : 0.85} />
      ))}
      {/* the end, carrying on past the last pin */}
      <Path d="M27.0 7.8 L29.5 4.9" stroke={c} strokeWidth={1.25} strokeLinecap="round" fill="none" opacity={0.7} />
    </Frame>
  );
}

/**
 * Pick an icon for a tab. Matched on the tab id the backend sends, with the
 * title as a fallback, so renaming a tab's label never blanks its icon.
 */
export function TabThreadIcon({ id, title, active, color, nonce }: {
  id: string; title?: string; active: boolean; color: string; nonce: number;
}) {
  const k = `${id} ${title ?? ""}`.toLowerCase();
  if (k.includes("train")) return <ThreadTrain active={active} color={color} nonce={nonce} />;
  if (k.includes("stat")) return <ThreadStats active={active} color={color} nonce={nonce} />;
  if (k.includes("you") || k.includes("home")) return <ThreadYou active={active} color={color} nonce={nonce} />;
  return <ThreadYou active={active} color={color} nonce={nonce} />;
}

/**
 * Settings — three lines, short to long.
 *
 * Replaces the gear glyph, which was a pictograph in a product that ships no
 * pictographs, and rendered at whatever weight the system font felt like.
 * Drawn as views so it is the same three strokes on both platforms.
 */
export function SettingsLines({ color, size = 20 }: { color: string; size?: number }) {
  const w = [0.5, 0.75, 1];
  return (
    <View style={{ width: size, gap: 4, alignItems: "flex-end" }}>
      {w.map((f, i) => (
        <View key={i} style={{ width: size * f, height: 2, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}
