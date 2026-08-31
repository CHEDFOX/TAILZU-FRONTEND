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
 * YOU — a single zig-zag thread.
 *
 * One continuous run, because a person is one thread. The peaks are
 * deliberately uneven in height and the spacing drifts, so it reads as pulled
 * by hand rather than stepped by an algorithm. One end overshoots.
 */
export function ThreadYou({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d="M3.5 20.4 L7.8 10.9 L11.6 21.3 L15.9 8.2 L20.2 22.1 L24.1 11.8 L28.6 19.2"
        stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* loose end past the last pin */}
      <Path d="M28.6 19.2 L30.4 22.6" stroke={c} strokeWidth={1.3} strokeLinecap="round" fill="none" opacity={0.75} />
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
      {/* chords — the winding that fills the shape */}
      <Path d="M15.9 5.4 L15.6 24.6" stroke={c} strokeWidth={1.35} strokeLinecap="round" opacity={0.9} fill="none" />
      <Path d="M6.4 11.9 L20.6 8.0" stroke={c} strokeWidth={1.05} strokeLinecap="round" opacity={0.6} fill="none" />
      <Path d="M6.9 18.0 L21.8 13.4" stroke={c} strokeWidth={1.05} strokeLinecap="round" opacity={0.6} fill="none" />
      <Path d="M12.1 23.6 L24.6 17.1" stroke={c} strokeWidth={1.05} strokeLinecap="round" opacity={0.55} fill="none" />
      <Path d="M10.2 7.4 L9.1 21.9" stroke={c} strokeWidth={0.95} strokeLinecap="round" opacity={0.45} fill="none" />
      <Path d="M21.4 7.2 L22.3 21.4" stroke={c} strokeWidth={0.95} strokeLinecap="round" opacity={0.45} fill="none" />
      {/* the stem, and a thread end left hanging */}
      <Path d="M15.7 24.4 L15.2 28.3" stroke={c} strokeWidth={1.3} strokeLinecap="round" fill="none" opacity={0.8} />
    </Frame>
  );
}

/**
 * STATS — a circular winding.
 *
 * Pins around a ring with the thread crossing the middle at a fixed step, which
 * is how a real string-art circle is made: the envelope of all those straight
 * chords is the curve you see, and no curve was ever drawn. The ring itself is
 * left slightly open so it reads as wound, not printed.
 */
export function ThreadStats({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  const R = 11, CX = 16, CY = 16, N = 13, STEP = 5;
  const pt = (i: number) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
  };
  const chords: string[] = [];
  for (let i = 0; i < N; i++) {
    const [x1, y1] = pt(i);
    const [x2, y2] = pt((i * STEP) % N);
    chords.push(`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`);
  }
  return (
    <Frame active={active} nonce={nonce} size={size}>
      {/* the ring, deliberately not closed */}
      <Circle cx={CX} cy={CY} r={R} stroke={c} strokeWidth={1.7} fill="none"
        strokeDasharray="58 8" strokeLinecap="round" opacity={0.95} />
      {chords.map((d, i) => (
        <Path key={i} d={d} stroke={c} strokeWidth={0.95} strokeLinecap="round"
          opacity={0.42 + (i % 3) * 0.12} fill="none" />
      ))}
      <Path d="M16 5 L17.9 2.2" stroke={c} strokeWidth={1.25} strokeLinecap="round" fill="none" opacity={0.75} />
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
