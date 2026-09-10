/**
 * PieChart — a ring of slices the backend describes and the app only draws.
 *
 *   { type: "PieChart", props: {
 *       slices: [{ label, value, color }],
 *       size, thickness, gap,
 *       centerValue, centerLabel,
 *       legend: true, legendColor, emptyLabel,
 *   } }
 *
 * A RING, NOT A DISC. These charts answer "what share", and a share is read
 * off arc length, which a ring gives you without the wedge's false precision
 * near the middle — and the hole is where the one number worth reading at a
 * glance goes. `thickness` collapses it back to a pie if that is ever wanted.
 *
 * NOTHING IS COMPUTED HERE BEYOND GEOMETRY. Values arrive as counts and are
 * turned into angles; the labels, the colours, the order and what a slice
 * even means are all decided on the server. The one judgement the app makes
 * is the minimum sweep below — see MIN_SWEEP.
 *
 * Drawn with stroke-dasharray on concentric circles rather than arc paths:
 * one circle per slice, each dashed to its own share and rotated to start
 * where the last one ended. No path arithmetic, no large-arc-flag bug at the
 * 180° boundary, and every slice is a single element the renderer can animate
 * or hit-test later.
 */
import React from "react";
import { View, Text } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useTheme, typeRole } from "./components";
import type { CompProps } from "./components";

/**
 * The smallest arc a non-zero slice may take, in degrees.
 *
 * A slice worth 0.2% of the total rounds to nothing and disappears, which
 * tells the reader it does not exist rather than that it is small. Anything
 * present gets a sliver you can see; the rest of the ring absorbs the
 * difference proportionally, so the arcs still sum to the circle.
 */
const MIN_SWEEP = 2.2;

interface Slice { label: string; value: number; color: string }

export const PieChart = ({ props, style }: CompProps): React.ReactElement => {
  const theme = useTheme();
  const raw: Slice[] = Array.isArray(props.slices)
    ? props.slices
        .map((s: any) => ({
          label: String(s?.label ?? ""),
          value: Number(s?.value) || 0,
          color: String(s?.color ?? theme.color.muted),
        }))
        .filter((s: Slice) => s.value > 0)
    : [];

  const size = Number(props.size) || 104;
  const thickness = Number(props.thickness) || 14;
  const gap = Number(props.gap) || 2;
  const showLegend = props.legend !== false;

  const total = raw.reduce((sum, s) => sum + s.value, 0);

  // Nothing to draw. An empty ring with a caption is the honest picture of
  // "you have not done this yet"; a full ring of one grey slice would read as
  // data, and zeros would read as a measurement that came back empty.
  if (!raw.length || total <= 0) {
    return (
      <View style={[{ alignItems: "center", justifyContent: "center", height: size }, style]}>
        <Text style={typeRole(theme, "caption", { fontSize: 12, color: theme.color.muted })}>
          {String(props.emptyLabel ?? "Nothing yet")}
        </Text>
      </View>
    );
  }

  // Share of the circle per slice, with every non-zero slice guaranteed a
  // visible sliver. The floor is taken out of the total first, then the rest
  // is shared proportionally, so the arcs still close the circle exactly.
  const floor = MIN_SWEEP * raw.length;
  const spare = Math.max(0, 360 - floor);
  const sweeps = raw.map((s) => MIN_SWEEP + (s.value / total) * spare);

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let angle = 0;

  return (
    <View style={[{ alignItems: "center" }, style]}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* -90° so the first slice starts at twelve o'clock, where a reader
              expects a ring to begin. */}
          <G rotation={-90} originX={size / 2} originY={size / 2}>
            {raw.map((s, i) => {
              const sweep = sweeps[i]!;
              const arc = (sweep / 360) * circumference;
              // The gap is taken OUT of each slice rather than added between
              // them, so the ring stays closed however many slices there are.
              const drawn = Math.max(0.5, arc - gap);
              const el = (
                <Circle
                  key={`${s.label}-${i}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeLinecap="butt"
                  fill="none"
                  strokeDasharray={`${drawn} ${circumference - drawn}`}
                  strokeDashoffset={-(angle / 360) * circumference}
                />
              );
              angle += sweep;
              return el;
            })}
          </G>
        </Svg>
        {/* The hole. One number and one word — anything more and the ring is
            a frame around a paragraph. */}
        {(props.centerValue != null || props.centerLabel != null) && (
          <View style={{
            position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
            alignItems: "center", justifyContent: "center",
          }}>
            {props.centerValue != null && (
              <Text style={typeRole(theme, "chartValue", {
                fontSize: Math.round(size * 0.23), fontWeight: "700", color: theme.color.text,
              })}>
                {String(props.centerValue)}
              </Text>
            )}
            {props.centerLabel != null && (
              <Text style={typeRole(theme, "chartCenterLabel", {
                fontSize: 9, letterSpacing: 0.8, color: theme.color.muted,
              })}>
                {String(props.centerLabel)}
              </Text>
            )}
          </View>
        )}
      </View>

      {showLegend && (
        <View style={{ marginTop: 10, alignSelf: "stretch", gap: 5 }}>
          {raw.map((s, i) => (
            <View key={`${s.label}-legend-${i}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.color }} />
              <Text
                numberOfLines={1}
                style={[
                  typeRole(theme, "chartLegend", { fontSize: 11.5 }),
                  { flex: 1, color: props.legendColor ? String(props.legendColor) : theme.color.body },
                ]}
              >
                {s.label}
              </Text>
              <Text style={[
                typeRole(theme, "chartLegendValue", { fontSize: 11.5, fontWeight: "600" }),
                { color: props.legendColor ? String(props.legendColor) : theme.color.text },
              ]}>
                {Math.round((s.value / total) * 100)}%
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};
