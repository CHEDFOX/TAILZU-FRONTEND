/**
 * Tab icons.
 *
 * Active state: the icon takes the brand amber and shakes — a short, damped
 * wobble, as if it were plucked. Not a loop; a plucked string settles. Kept
 * from the set these replaced, because the motion was never the problem.
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
/**
 * ONE GRID, ONE WEIGHT, THREE SILHOUETTES THAT CANNOT BE CONFUSED.
 *
 * These replace a set drawn as "thread art" — a wound brain, a fingerprint,
 * a climb over pins. The craft was real and the idea was good; the icons were
 * not legible, which in a tab bar is the only thing that counts. Rendered at
 * their actual 26pt the brain read as a LEAF (a lobed outline with a centre
 * vein, diagonal veins and a stem — every cue points to leaf) and the
 * fingerprint read as WIFI, which its own source comment had already worried
 * about. A tab bar is scanned in well under a second and never studied, so an
 * icon that needs explaining has failed before the explanation arrives.
 *
 * What replaced them is deliberately ordinary. Novelty costs recognition, and
 * recognition is the entire job here: a speech bubble, a rising line, a
 * figure. Nobody has to learn them.
 *
 * The three differ by SILHOUETTE, not by detail — a closed round shape with a
 * tail, an open diagonal, a figure with a gap in the middle. Detail is the
 * first thing lost at small sizes and in peripheral vision, which is where a
 * tab bar is usually read from.
 *
 * Shared: a 32 grid, 1.9 stroke, round caps and joins, and roughly equal ink.
 * Equal ink matters more than equal bounding boxes — the bubble is wider than
 * the figure and they still weigh the same, which is what stops one tab
 * looking selected when it is not.
 */

/** TRAIN — a conversation. Not a microphone: the mic already means "record"
 *  in the keyboard and on this screen, and a tab is a place, not an action. */
export function ThreadTrain({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path
        d="M12 7.5 H20 A5 5 0 0 1 25 12.5 V16.5 A5 5 0 0 1 20 21.5 H16.4 L11.9 25.5
           L12 21.5 A5 5 0 0 1 7 16.5 V12.5 A5 5 0 0 1 12 7.5 Z"
        stroke={c} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" fill="none"
      />
    </Frame>
  );
}

/** STATS — a climb. The one icon kept from the old set, because it was the one
 *  that read: unmistakable at any size, and it says what the tab holds without
 *  a chart's furniture. Trimmed to four points and stripped of its dashed
 *  ground and drop lines, which at 26pt were mush. */
export function ThreadStats({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  // Uneven on purpose: a monotonic climb reads as a logo, and real numbers dip.
  const pins: Array<[number, number]> = [[7, 21.5], [13.5, 16.6], [19, 18.6], [25, 9.6]];
  const line = pins.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={line} stroke={c} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {pins.map(([x, y], i) => (
        // The last point is larger: the eye needs somewhere to land, and where
        // the line has GOT to is the only part of a trend anyone acts on.
        <Circle key={i} cx={x} cy={y} r={i === pins.length - 1 ? 2.3 : 1.45} fill={c} />
      ))}
    </Frame>
  );
}

/** YOU — a figure, with the head as the brand's own rounded square. That is
 *  the one place the identity gets to show through: the app icon is rounded
 *  squares joined by a thread, so a rounded square reads as this product's
 *  person rather than any person. */
export function ThreadYou({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      {/* Square, 7.6 on both sides. Drawn wider than tall it stopped being a
          head and became a screen on a stand. */}
      <Path
        d="M14.8 7.4 H17.2 A2.6 2.6 0 0 1 19.8 10 V12.4 A2.6 2.6 0 0 1 17.2 15
           H14.8 A2.6 2.6 0 0 1 12.2 12.4 V10 A2.6 2.6 0 0 1 14.8 7.4 Z"
        stroke={c} strokeWidth={1.9} strokeLinejoin="round" fill="none"
      />
      {/* Shoulders. The control point is chosen, not eyeballed: for a symmetric
          cubic the apex is 0.25*end + 0.75*control, so 15.7 puts it at 18 —
          three below the head, which is the gap that reads as a neck. */}
      <Path d="M9 25 C9 15.7 23 15.7 23 25"
        stroke={c} strokeWidth={1.9} strokeLinecap="round" fill="none" />
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
