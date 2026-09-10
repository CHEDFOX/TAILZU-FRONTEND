/**
 * Tab icons.
 *
 * FIVE sets were drawn and rejected before this one, and the reasons are the
 * design:
 *
 *   a wound brain and a fingerprint       rendered as a leaf and a wifi glyph
 *   a speech bubble and a line chart      legible, and any app's
 *   bars with the brand's corner radius   still a bar chart wearing a hat
 *   the whole set drawn in the coil       blocks at 26pt; a coil needs air
 *   knots, spools, spirals, rulers        combs, batteries, and twice a person
 *
 * Two rules came out of that and they hold everything below together. At tab
 * size a closed round form becomes a face, and a row of repeated ticks becomes
 * a comb — so neither appears here. And an icon set is a system or it is three
 * pictures: these are three things you can do to ONE material.
 *
 *   TRAIN  the thread passes THROUGH the node       your voice going in
 *   STATS  one thread FOLDED until it is cloth      how much you have made
 *   YOU    the label                                whose it is
 *
 * The silhouettes deliberately differ in axis — diagonal, horizontal, a solid
 * shape — because a tab bar is read peripherally and outline is all that
 * survives. The node keeps the mark's measured 0.204 corner radius, taken off
 * assets/icon.png, so the vocabulary is still the app icon's.
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
 * Selected differs in KIND, because the shapes do: an open stroke thickens, a
 * closed shape fills. Only two closed shapes exist here — the node and the tag
 * — so only two things ever fill, and the bar never lights up all at once.
 */
const STROKE_NODE = 2.0;
const STROKE_TAG = 1.7;

/**
 * TRAIN — the thread passes through the node.
 *
 * Not a waveform. Every voice app has a waveform, and the one that shipped here
 * was the fourth version of the same generic idea. This is the needle's actual
 * job: something goes in one side and comes out the other changed, which is
 * also the only sentence this product needs.
 *
 * The thread breaks at the node rather than crossing it, so the node reads as
 * something the thread went THROUGH and not as a bead sitting on top of it.
 */
const TRAIN_NODE =
  "M13.16 11.2 H18.84 A1.96 1.96 0 0 1 20.8 13.16 V18.84 A1.96 1.96 0 0 1 18.84 20.8 " +
  "H13.16 A1.96 1.96 0 0 1 11.2 18.84 V13.16 A1.96 1.96 0 0 1 13.16 11.2 Z";
const TRAIN_THREAD = "M3.2 25.8 L11.6 18.0 M20.4 14.0 L28.8 6.2";

export function ThreadTrain({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={TRAIN_THREAD} fill="none" stroke={c} strokeLinecap="round"
        strokeWidth={active ? 2.7 : 2.2} />
      <Path d={TRAIN_NODE}
        fill={active ? c : "none"}
        stroke={active ? undefined : c}
        strokeWidth={active ? undefined : STROKE_NODE}
        strokeLinejoin="round" />
    </Frame>
  );
}

/**
 * STATS — one thread, folded until it is cloth.
 *
 * A serpentine, not stacked bars: it is a single unbroken line that turns at
 * alternating ends, the way folded fabric actually lies. That is what the
 * screen counts — how much you have made — without borrowing the bar chart
 * every other app ships.
 *
 * FOUR rows, not three. With three the line has two turns and reads as the
 * numeral 2; the fourth turn is what makes it material instead of a glyph.
 */
const STATS_FOLD =
  "M4.6 7.6 H23 A2.8 2.8 0 0 1 23 13.2 H9 A2.8 2.8 0 0 0 9 18.8 " +
  "H24 A2.8 2.8 0 0 1 24 24.4 H5.6";

export function ThreadStats({ active, color, size = 26, nonce = 0 }: Props & { nonce?: number }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={STATS_FOLD} fill="none" stroke={c} strokeLinecap="round"
        strokeWidth={active ? 2.5 : 2.0} />
    </Frame>
  );
}

/**
 * YOU — the label.
 *
 * A tailor's label is the thing inside a garment that says whose it is, which
 * is exactly what this tab holds: your voices, your words, your keys, your
 * languages. It is also the only solid shape in the set, which is what makes
 * it findable at the far right of the bar without reading anything.
 *
 * Earlier attempts at "yours" were a knot and a wound loop. Both came back as
 * a person — a head over two legs — because at this size any closed round form
 * on a stem does. A tag has a corner cut off it and cannot.
 */
const YOU_TAG =
  "M13.4 5.2 H24.6 A2.4 2.4 0 0 1 27 7.6 V18.8 A2.4 2.4 0 0 1 26.3 20.5 " +
  "L20.5 26.3 A2.4 2.4 0 0 1 18.8 27 H7.6 A2.4 2.4 0 0 1 5.2 24.6 " +
  "V13.4 A2.4 2.4 0 0 1 5.9 11.7 L11.7 5.9 A2.4 2.4 0 0 1 13.4 5.2 Z";
const YOU_HOLE = "M19.3 10.5 A2.15 2.15 0 1 1 23.6 10.5 A2.15 2.15 0 1 1 19.3 10.5 Z";

export function ThreadYou({ active, color, size = 26, nonce = 0, holeColor = "#000000" }:
  Props & { nonce?: number; holeColor?: string }) {
  const c = active ? THREAD_ACTIVE : color;
  return (
    <Frame active={active} nonce={nonce} size={size}>
      <Path d={YOU_TAG}
        fill={active ? c : "none"}
        stroke={active ? undefined : c}
        strokeWidth={active ? undefined : STROKE_TAG}
        strokeLinejoin="round" />
      {/* Punched, not drawn: when the tag is solid the hole has to be the bar
          behind it, or it stops being a hole and becomes a dot. */}
      <Path d={YOU_HOLE}
        fill={active ? holeColor : "none"}
        stroke={active ? undefined : c}
        strokeWidth={active ? undefined : STROKE_TAG} />
    </Frame>
  );
}

/**
 * Pick an icon for a tab. Matched on the tab id the backend sends, with the
 * title as a fallback, so renaming a tab's label never blanks its icon.
 */
export function TabThreadIcon({ id, title, active, color, nonce, surface }: {
  id: string; title?: string; active: boolean; color: string; nonce: number;
  /** The bar's own background. The tag's hole is punched in it, so it has to be
   *  the real surface colour and not a guess at black. */
  surface?: string;
}) {
  const k = `${id} ${title ?? ""}`.toLowerCase();
  if (k.includes("train")) return <ThreadTrain active={active} color={color} nonce={nonce} />;
  if (k.includes("stat")) return <ThreadStats active={active} color={color} nonce={nonce} />;
  return <ThreadYou active={active} color={color} nonce={nonce} holeColor={surface} />;
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
