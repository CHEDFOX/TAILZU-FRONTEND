/**
 * Tab icons.
 *
 * Three previous sets failed, each for a different reason worth keeping:
 * a wound brain and a fingerprint that rendered as a leaf and a wifi glyph;
 * a speech bubble and a line chart, legible but interchangeable with any app
 * on the phone; and then a set drawn in the right spirit but by eye, with
 * capsule corners the brand does not use.
 *
 * This set is measured off the app icon rather than guessed at. The numbers
 * below came from reading assets/icon.png directly, and they are the whole
 * argument for why these shapes look like they belong to this product:
 *
 *   node side          4.3 of a 32 grid
 *   corner radius      0.204 of the side   (the earlier set used 0.68 — capsules)
 *   node positions     (9.9, 8.6) (17.9, 15.3) (5.7, 19.1)
 *
 * The mark is nodes threaded on a line, arranged asymmetrically. That is the
 * only shape language this product has, so all three icons are built from it,
 * and each is a different thing that vocabulary can do.
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
 * WEIGHT.
 *
 * Each icon was rasterised at 256px and its ink counted as a share of the box,
 * because a stroke and a filled shape do not read as equal at equal numbers and
 * squinting will not tell you by how much. The first pass had the wave at half
 * the bars' coverage, which is exactly why it looked thin next to them.
 *
 *   idle      train 10.1%   stats 13.0%   you 12.8%
 *   selected  train 17.0%   stats 17.3%   you 16.5%
 *
 * Selected differs in KIND, because the shapes do: an open stroke cannot be
 * filled, so the wave thickens; closed shapes fill. The wave's stroke stops at
 * 4.1 — past that its own swings start to merge, and the icon becomes a smear.
 */
const STROKE_WAVE_IDLE = 3.1;
const STROKE_WAVE_ON = 4.1;
const STROKE_OUTLINE = 1.7;
const STROKE_THREAD = 1.8;

/**
 * TRAIN — the product itself, in one stroke.
 *
 * A single unbroken thread that starts as speech and ends as a ruled line.
 * That IS what the app does: you talk, and what comes out is finished writing.
 *
 * One cubic per half-period, control points at 4/3 of the amplitude, because a
 * cubic sits at 3/4 of its control offset at the midpoint — so the crest lands
 * exactly on 7.6 and 4.4 rather than wherever a hand-placed curve wandered to.
 * Two swings, not four: the half-period has to stay wider than twice the stroke
 * or the curve collides with itself, and at 26pt the collision is the only
 * thing you see.
 */
const TRAIN_WAVE =
  "M3.2 16 C5.87 5.87 8.53 5.87 11.2 16 C13.87 21.87 16.53 21.87 19.2 16 L28.4 16";

export function ThreadTrain({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={TRAIN_WAVE} stroke={c} fill="none" strokeLinecap="round"
        strokeWidth={active ? STROKE_WAVE_ON : STROKE_WAVE_IDLE} />
    </Frame>
  );
}

/**
 * STATS — the node, three times, rising off one baseline.
 *
 * A chart drawn with the mark's own rounded square instead of plain rectangles,
 * so it reads as this product's chart rather than a chart. The radius is the
 * tell and it costs nothing at any size. All three stand on 25.4, because a
 * chart whose bars do not share a baseline is not a chart.
 */
const STATS_BARS = [
  "M6.05 19.2 H8.95 A1 1 0 0 1 9.95 20.2 V24.4 A1 1 0 0 1 8.95 25.4 H6.05 A1 1 0 0 1 5.05 24.4 V20.2 A1 1 0 0 1 6.05 19.2 Z",
  "M14.55 13.3 H17.45 A1 1 0 0 1 18.45 14.3 V24.4 A1 1 0 0 1 17.45 25.4 H14.55 A1 1 0 0 1 13.55 24.4 V14.3 A1 1 0 0 1 14.55 13.3 Z",
  "M23.05 6.8 H25.95 A1 1 0 0 1 26.95 7.8 V24.4 A1 1 0 0 1 25.95 25.4 H23.05 A1 1 0 0 1 22.05 24.4 V7.8 A1 1 0 0 1 23.05 6.8 Z",
];

export function ThreadStats({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      {STATS_BARS.map((d, i) => (
        <Path key={i} d={d}
          fill={active ? c : "none"}
          stroke={active ? undefined : c}
          strokeWidth={active ? undefined : STROKE_OUTLINE}
          strokeLinejoin="round" />
      ))}
    </Frame>
  );
}

/**
 * YOU — the mark itself, with one node lit.
 *
 * Not a triangle of nodes, which is what the last version drew and which read
 * as a git branch. These are the app icon's own three positions and its own
 * angles, scaled up to fill the box: a steep thread from the low node to the
 * high one, then a long diagonal down to the third. That asymmetry is the whole
 * silhouette, and nothing else on the phone has it.
 *
 * The middle node is solid in both states. Which node is lit is the icon's
 * identity, not its state — the tab holds four things that are yours, and you
 * are picking between them. Selecting the tab lights the other two.
 */
const YOU_NODES = [
  "M11 4.34 H15.02 A1.38 1.38 0 0 1 16.4 5.72 V9.74 A1.38 1.38 0 0 1 15.02 11.12 H11 A1.38 1.38 0 0 1 9.62 9.74 V5.72 A1.38 1.38 0 0 1 11 4.34 Z",
  "M23.6 14.9 H27.62 A1.38 1.38 0 0 1 29 16.28 V20.3 A1.38 1.38 0 0 1 27.62 21.68 H23.6 A1.38 1.38 0 0 1 22.22 20.3 V16.28 A1.38 1.38 0 0 1 23.6 14.9 Z",
  "M4.38 20.88 H8.4 A1.38 1.38 0 0 1 9.78 22.26 V26.28 A1.38 1.38 0 0 1 8.4 27.66 H4.38 A1.38 1.38 0 0 1 3 26.28 V22.26 A1.38 1.38 0 0 1 4.38 20.88 Z",
];
const YOU_THREADS = "M9.78 22.64 L11.25 11.12 M16.4 9.36 L23.17 16.39";

/** The one that stays solid. */
const YOU_LIT = 1;

export function ThreadYou({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={YOU_THREADS} stroke={c} strokeWidth={STROKE_THREAD} strokeLinecap="round" fill="none" />
      {YOU_NODES.map((d, i) => {
        const filled = active || i === YOU_LIT;
        return (
          <Path key={i} d={d}
            fill={filled ? c : "none"}
            stroke={filled ? undefined : c}
            strokeWidth={filled ? undefined : STROKE_OUTLINE}
            strokeLinejoin="round" />
        );
      })}
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
