/**
 * Tab icons.
 *
 * Active state: the icon takes the brand amber and shakes — a short, damped
 * wobble, as if it were plucked. Not a loop; a plucked string settles. Kept
 * from the set these replaced, because the motion was never the problem.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Path } from "react-native-svg";

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
 * ONE VOCABULARY: the brand's rounded node, and the thread.
 *
 * The app icon is rounded squares joined by a thread. That is the only shape
 * language this product has, and until now none of it reached the tab bar —
 * which had a wound brain that rendered as a leaf, a fingerprint that rendered
 * as wifi, and then, briefly, a stock speech bubble and a stock line chart.
 * The first pair failed on legibility. The second pair was legible and could
 * have belonged to any app on the phone, which is the same failure wearing
 * better clothes.
 *
 * So all three are built from the mark's own parts, and each is a different
 * thing that vocabulary can do:
 *
 *   TRAIN  the thread, loud, resolving into a ruled line
 *   STATS  the node, three of them, rising off a baseline
 *   YOU    the mark's constellation, with one node solid
 *
 * They still differ by SILHOUETTE — a horizontal wave, aligned verticals, a
 * triangle — because detail is the first thing lost at 26pt and in the
 * peripheral vision a tab bar is usually read from. Sharing a hand is what
 * makes them a set; differing in outline is what makes them findable.
 *
 * Shared: a 32 grid, ~1.9 stroke, round caps and joins, equal ink. Equal ink
 * rather than equal boxes — the wave is wider than the bars and weighs the
 * same, which is what stops one tab looking selected when it is not.
 */

/**
 * TRAIN — the product itself, in one stroke.
 *
 * A single unbroken thread that starts as speech and ends as a ruled line.
 * That IS what the app does: you talk, and what comes out is finished writing
 * in your voice. Nothing else in the tab bar could mean this, and no other app
 * would draw it, which is the point — the previous version was a speech bubble
 * and could have been anyone's.
 *
 * The swings decay rather than stopping: sound settling into order, not sound
 * cut off. Two of them, not four — at 26pt more oscillation is a smudge.
 */
export function ThreadTrain({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d="M5 16 C6.6 5 10.4 27 12 16 C13.5 6.5 17 25.5 18.5 16 L27 16"
        stroke={c} strokeWidth={2.2} strokeLinecap="round" fill="none" />
    </Frame>
  );
}

/**
 * STATS — the node, three times, rising.
 *
 * A bar chart drawn with the mark's own rounded square instead of plain
 * rectangles, so it reads as this product's chart rather than a chart. The
 * corner radius is the tell and it costs nothing at any size.
 *
 * Bars, not the climbing line this replaced: a polyline with dots is what
 * every analytics screen uses, and the line's slope was doing the work that
 * three different heights do more plainly.
 */
export function ThreadStats({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  /** x, top y. All three share a baseline at 25.6 — a chart whose bars do not
   *  stand on one line is not a chart. */
  const bars: Array<[number, number]> = [[4.7, 19.4], [12.7, 13.6], [20.7, 7.2]];
  return (
    <Frame active={active} nonce={nonce} size={size}>
      {bars.map(([x, top], i) => (
        <Path key={i}
          d={`M${x + 1.9} ${top} H${x + 4.7} A1.9 1.9 0 0 1 ${x + 6.6} ${top + 1.9}
              V23.7 A1.9 1.9 0 0 1 ${x + 4.7} 25.6 H${x + 1.9} A1.9 1.9 0 0 1 ${x} 23.7
              V${top + 1.9} A1.9 1.9 0 0 1 ${x + 1.9} ${top} Z`}
          stroke={c} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
      ))}
    </Frame>
  );
}

/**
 * YOU — the mark's constellation, with one node solid.
 *
 * Three nodes joined by threads is the app icon; filling one of them makes it
 * about a choice rather than about the brand. Which is exactly what the tab
 * holds: four things that are yours — voices, words, keys, languages — and you
 * are picking between them.
 *
 * The solid node sits at the bottom, nearest the thumb, and it is the only
 * filled shape in the whole bar. That is deliberate: fill is the loudest
 * device available at this size, so it is spent once, on the tab that is about
 * the person using the app.
 */
export function ThreadYou({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d="M7.6 8.5 H11.4 A2.2 2.2 0 0 1 13.6 10.7 V13.3 A2.2 2.2 0 0 1 11.4 15.5
               H7.6 A2.2 2.2 0 0 1 5.4 13.3 V10.7 A2.2 2.2 0 0 1 7.6 8.5 Z"
        stroke={c} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
      <Path d="M20.6 8.5 H24.4 A2.2 2.2 0 0 1 26.6 10.7 V13.3 A2.2 2.2 0 0 1 24.4 15.5
               H20.6 A2.2 2.2 0 0 1 18.4 13.3 V10.7 A2.2 2.2 0 0 1 20.6 8.5 Z"
        stroke={c} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
      {/* The chosen one. Slightly larger than the other two, because a filled
          shape reads smaller than an outlined one of the same size. */}
      <Path d="M13.9 19.4 H18.1 A2.4 2.4 0 0 1 20.5 21.8 V24.2 A2.4 2.4 0 0 1 18.1 26.6
               H13.9 A2.4 2.4 0 0 1 11.5 24.2 V21.8 A2.4 2.4 0 0 1 13.9 19.4 Z"
        fill={c} />
      <Path d="M11.9 15.1 L14.6 19.2 M20.1 15.1 L17.4 19.2"
        stroke={c} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.8} />
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
