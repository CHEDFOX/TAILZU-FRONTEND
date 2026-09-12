/**
 * The word meter — a free plan you can watch grow.
 *
 * A plain "1,240 of 2,500 used" bar has one direction: down. Every dictation
 * moves it closer to a wall, and the only thing it can ever tell the user is
 * how much is left before they are stopped. That is a countdown, and a
 * countdown is not a reason to come back tomorrow.
 *
 * This one has two moving parts. The fill still rises with use — but the TRACK
 * itself gets longer as words are earned, and a tick marks where the plan's own
 * words ended. Everything to the right of that tick is territory the user
 * created by showing up. The bar is the reward; the caption only names it.
 *
 * Rendering notes: no external chart library, no measurement pass. Widths are
 * percentages of the parent, so it lays out correctly on the first frame and at
 * any screen width, and there is no flash of a zero-width bar.
 */
import React from "react";
import { Text, View } from "react-native";
import { useTheme, type CompProps } from "./components";

/** Fallbacks only. Every one of these is overridable from the backend — see
 *  the props read below — so the meter can be recoloured without a release. */
const AMBER = "#E8A23C";

export function WordMeter({ props, style }: CompProps): React.ReactElement {
  const theme = useTheme();

  const base = Math.max(0, Number(props.base) || 0);
  const earned = Math.max(0, Number(props.earned) || 0);
  const total = Math.max(1, base + earned);
  const used = Math.max(0, Math.min(total, Number(props.used) || 0));
  const remaining = Math.max(0, total - used);

  const usedPct = (used / total) * 100;
  // Where the plan's words stop. Only drawn once something has been earned —
  // with no earned words it sits at the far end and reads as a border.
  const tickPct = earned > 0 ? (base / total) * 100 : -1;

  // Backend-overridable, theme next, literal last. The meter is the most
  // looked-at thing on the stats screen and its colour was the one part of it
  // a release was needed to change.
  const fill = String(props.fillColor ?? AMBER);
  const earnedColor = String(props.earnedColor ?? fill);
  const label = String(props.labelColor ?? theme.color.label ?? "#8A857C");
  const track = String(props.trackColor ?? theme.color.border ?? "rgba(255,255,255,0.12)");

  return (
    <View style={style}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ color: theme.color.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 }}>
          {remaining.toLocaleString()}
        </Text>
        <Text style={{ color: label, fontSize: 13 }}>
          {used.toLocaleString()} of {total.toLocaleString()} used
        </Text>
      </View>
      <Text style={{ color: label, fontSize: 13, marginTop: 2 }}>words left</Text>

      <View
        style={{
          height: 10,
          borderRadius: 5,
          backgroundColor: track,
          overflow: "hidden",
          marginTop: 12,
          flexDirection: "row",
        }}
      >
        <View style={{ width: `${usedPct}%`, backgroundColor: fill }} />
      </View>

      {tickPct >= 0 ? (
        // The old ceiling, left visible on purpose. A bar that simply got
        // longer looks like a bigger bar; a bar with the old end still marked
        // on it looks like something the user moved.
        <View style={{ height: 10, marginTop: -10, flexDirection: "row", pointerEvents: "none" }}>
          <View style={{ width: `${tickPct}%` }} />
          <View style={{ width: 2, backgroundColor: theme.color.bg ?? "#0C0C10", opacity: 0.9 }} />
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 14, marginTop: 10 }}>
        <Text style={{ color: label, fontSize: 12 }}>{base.toLocaleString()} free</Text>
        {earned > 0 ? (
          <Text style={{ color: earnedColor, fontSize: 12, fontWeight: "600" }}>
            +{earned.toLocaleString()} earned
          </Text>
        ) : null}
      </View>

      {props.caption ? (
        <Text style={{ color: label, fontSize: 13, marginTop: 12, lineHeight: 18 }}>
          {String(props.caption)}
        </Text>
      ) : null}
    </View>
  );
}

export default WordMeter;
