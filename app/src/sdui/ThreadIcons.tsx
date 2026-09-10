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
import React, { useEffect, useId, useMemo, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg";

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
/** Thinner than the thread it replaces: three ticks at thread weight close the
 *  gaps between them and the coil becomes a bar. */
const STROKE_COIL = 1.4;

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
const YOU_THREAD = "M9.78 22.64 L11.25 11.12";

/**
 * THE COIL, on the one thread that carries it in the app icon.
 *
 * The mark stitches the run between its top node and its right node and leaves
 * the other thread plain. No tab icon had ever carried that, so the icon was
 * the mark's arrangement without the mark's most particular detail.
 *
 * Three ticks, and three is not a style choice. A whole tab set was drawn in
 * this coil — the wave stitched, the bars stitched — and rendered at 26pt it
 * came back as blocks: a coil needs air between its ticks to read as a coil,
 * and at that size there is room for air OR for enough ticks, never both. This
 * diagonal is the longest uninterrupted run in the set, which is the only
 * reason three fit here with light between them.
 */
const YOU_COIL =
  "M19.62 9.17 L16.1 12.43 M21.55 11.24 L18.02 14.5 M23.47 13.32 L19.95 16.58";

/** The one that stays solid. */
const YOU_LIT = 1;

export function ThreadYou({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={YOU_THREAD} stroke={c} strokeWidth={STROKE_THREAD} strokeLinecap="round" fill="none" />
      <Path d={YOU_COIL} stroke={c} strokeWidth={STROKE_COIL} strokeLinecap="round" fill="none" />
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
 * THE RAIL — the tab bar as ONE object instead of three pictures in three boxes.
 *
 * Every version before this drew each icon inside its own 32-square and hoped
 * they looked related. But the app icon is not three marks; it is nodes on ONE
 * thread, and a tab bar is three positions on one line. So the thread is drawn
 * across the whole bar and the icons sit on it, which is the mark at the size
 * the bar actually is.
 *
 * It also rescues the coil. Stitching failed inside a 26pt icon because a coil
 * needs air between its ticks and there is no room for both at that size. Here
 * the run between two tabs is over a hundred points wide, so the ticks get all
 * the air they want and finally read as cloth.
 *
 * What the thread SAYS: before the open tab it is a wave, after it, stitched.
 * The open tab is where speech turns into writing, and the boundary springs
 * across the bar when you switch — the product's whole claim, restated by
 * every tap, in the furniture rather than in a sentence.
 */
export const THREAD_RAIL_HEIGHT = 30;
const RAIL_H = THREAD_RAIL_HEIGHT;
/** Half the gap the thread leaves around each icon. Wider and the bar breaks
 *  into pieces; narrower and the thread collides with the glyphs. */
const RAIL_GAP = 17;
const RAIL_EDGE = 10;

function railWave(x0: number, x1: number, y: number): string {
  if (x1 - x0 < 10) return "";
  // Long and shallow. At an 11 wavelength this read as a zigzag and fought the
  // icons for attention; the thread is meant to be noticed second.
  const amp = 3.0, lam = 19.0, steps = Math.max(8, Math.round((x1 - x0) / 2));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = x0 + (x1 - x0) * t;
    pts.push(`${x.toFixed(2)} ${(y - amp * Math.sin(((x - x0) / lam) * Math.PI * 2)).toFixed(2)}`);
  }
  return `M${pts.join(" L")}`;
}

function railCoil(x0: number, x1: number, y: number): string {
  const span = x1 - x0;
  if (span < 8) return "";
  // Spacing first, count second. A tick count that ignores the run length is
  // how the earlier attempts turned into blocks on short segments.
  const n = Math.max(2, Math.round(span / 8.5));
  const amp = 3.0, lean = 1.25;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + (span * (i + 0.5)) / n;
    out.push(`M${(x - lean).toFixed(2)} ${(y - amp).toFixed(2)} L${(x + lean).toFixed(2)} ${(y + amp).toFixed(2)}`);
  }
  return out.join(" ");
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export function ThreadRail({ width, count, index, color, top = 0 }: {
  width: number; count: number; index: number; color: string; top?: number;
}) {
  const y = RAIL_H / 2;
  // Clip ids live in one document-wide namespace on react-native-svg, so two
  // rails on screen would silently share one clip. Cheap to make unique.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const centres = useMemo(
    () => Array.from({ length: count }, (_, i) => ((i + 0.5) * width) / count),
    [width, count],
  );
  // The thread is one line with holes punched where the icons stand. The holes
  // never move, so the path is built once and only the clip animates.
  const { wave, coil } = useMemo(() => {
    const segs: Array<[number, number]> = [];
    let x = RAIL_EDGE;
    for (const c of centres) { segs.push([x, c - RAIL_GAP]); x = c + RAIL_GAP; }
    segs.push([x, width - RAIL_EDGE]);
    return {
      wave: segs.map(([a, b]) => railWave(a, b, y)).filter(Boolean).join(" "),
      coil: segs.map(([a, b]) => railCoil(a, b, y)).filter(Boolean).join(" "),
    };
  }, [centres, width, y]);

  const edge = useRef(new Animated.Value(centres[index] ?? 0)).current;
  useEffect(() => {
    Animated.spring(edge, {
      toValue: centres[index] ?? 0,
      // Not bouncy: the boundary is reporting where you are, and a tab bar that
      // wobbles after every tap reads as unfinished rather than as alive.
      stiffness: 190, damping: 26, mass: 1,
      useNativeDriver: false,
    }).start();
  }, [centres, index, edge]);

  if (width <= 0) return null;
  return (
    <Svg width={width} height={RAIL_H} style={{ position: "absolute", top, left: 0 }}
      pointerEvents="none">
      <Defs>
        <ClipPath id={`speech${uid}`}>
          <AnimatedRect x={0} y={0} width={edge} height={RAIL_H} />
        </ClipPath>
        <ClipPath id={`cloth${uid}`}>
          <AnimatedRect x={edge} y={0} width={width} height={RAIL_H} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#speech${uid})`}>
        <Path d={wave} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" opacity={0.5} />
      </G>
      <G clipPath={`url(#cloth${uid})`}>
        <Path d={coil} fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" opacity={0.42} />
      </G>
    </Svg>
  );
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
