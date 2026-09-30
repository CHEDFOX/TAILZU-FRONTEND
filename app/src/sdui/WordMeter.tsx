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
 *
 * Every word and number on it is the server's: the node's props first, then a
 * ui.WordMeter.* knob, then what this drew before either existed.
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme, type CompProps } from "./components";
import { getLanguage } from "../storage";
import * as K from "./knobs";

/**
 * Numbers in the language the person picked, not the phone's.
 *
 * The app's language is a code the user chose ("hi", "es"), which is usually
 * a valid locale; "auto" and blends like "hinglish" are not, and neither is a
 * code the runtime has no data for. Any of those — or a runtime without Intl —
 * falls back to the device's own formatting, which is what this always did.
 */
function useNumberLocale(override: unknown): string | undefined {
  const [lang, setLang] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getLanguage().then((l) => { if (alive) setLang(l); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const want = override != null && String(override) !== "" ? String(override) : lang;
  if (!want || want === "auto") return undefined;
  try {
    // Throws RangeError for a tag that is not a locale at all.
    return Intl.NumberFormat.supportedLocalesOf([want]).length ? want : undefined;
  } catch {
    return undefined;
  }
}

export function WordMeter({ props, style }: CompProps): React.ReactElement {
  const theme = useTheme();
  const locale = useNumberLocale(props.locale ?? K.str("ui.WordMeter.locale", ""));
  const fmt = (n: number) => {
    try { return n.toLocaleString(locale); } catch { return n.toLocaleString(); }
  };

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
  const fill = String(props.fillColor ?? K.color("ui.WordMeter.fillColor", "#E8A23C"));
  const earnedColor = String(props.earnedColor ?? fill);
  const label = String(props.labelColor ?? theme.color.label ?? K.color("ui.WordMeter.labelColor", "#8A857C"));
  const track = String(props.trackColor ?? theme.color.border ?? K.color("ui.WordMeter.trackColor", "rgba(255,255,255,0.12)"));
  const tickColor = String(props.tickColor ?? theme.color.bg ?? K.color("ui.WordMeter.tickColor", "#0C0C10"));
  const valueColor = String(props.valueColor ?? theme.color.text);

  const valueSize = Number(props.valueSize ?? K.num("ui.WordMeter.valueSize", 28));
  const valueWeight = String(props.valueWeight ?? K.str("ui.WordMeter.valueWeight", "700")) as "700";
  const valueTracking = Number(props.valueTracking ?? K.num("ui.WordMeter.valueTracking", -0.5));
  const labelSize = Number(props.labelSize ?? K.num("ui.WordMeter.labelSize", 13));
  const smallSize = Number(props.smallSize ?? K.num("ui.WordMeter.smallSize", 12));
  const earnedWeight = String(props.earnedWeight ?? K.str("ui.WordMeter.earnedWeight", "600")) as "600";
  const barHeight = Number(props.barHeight ?? K.num("ui.WordMeter.barHeight", 10));
  const barRadius = Number(props.barRadius ?? K.num("ui.WordMeter.barRadius", 5));
  const barMarginTop = Number(props.barMarginTop ?? K.num("ui.WordMeter.barMarginTop", 12));
  const tickWidth = Number(props.tickWidth ?? K.num("ui.WordMeter.tickWidth", 2));
  const tickOpacity = Number(props.tickOpacity ?? K.num("ui.WordMeter.tickOpacity", 0.9));
  const leftMarginTop = Number(props.leftMarginTop ?? K.num("ui.WordMeter.leftMarginTop", 2));
  const footGap = Number(props.footGap ?? K.num("ui.WordMeter.footGap", 14));
  const footMarginTop = Number(props.footMarginTop ?? K.num("ui.WordMeter.footMarginTop", 10));
  const captionMarginTop = Number(props.captionMarginTop ?? K.num("ui.WordMeter.captionMarginTop", 12));
  const captionLineHeight = Number(props.captionLineHeight ?? K.num("ui.WordMeter.captionLineHeight", 18));

  const vars = { used: fmt(used), total: fmt(total), remaining: fmt(remaining), base: fmt(base), earned: fmt(earned) };
  const usedText = String(props.usedText ?? K.txt("ui.WordMeter.usedText", "{used} of {total} used", vars))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String((vars as Record<string, string>)[k]) : m));
  const leftText = String(props.leftText ?? K.txt("ui.WordMeter.leftText", "words left"));
  const freeText = String(props.freeText ?? K.txt("ui.WordMeter.freeText", "{base} free", vars))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String((vars as Record<string, string>)[k]) : m));
  const earnedText = String(props.earnedText ?? K.txt("ui.WordMeter.earnedText", "+{earned} earned", vars))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String((vars as Record<string, string>)[k]) : m));

  return (
    <View style={style}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ color: valueColor, fontSize: valueSize, fontWeight: valueWeight, letterSpacing: valueTracking }}>
          {fmt(remaining)}
        </Text>
        <Text style={{ color: label, fontSize: labelSize }}>
          {usedText}
        </Text>
      </View>
      <Text style={{ color: label, fontSize: labelSize, marginTop: leftMarginTop }}>{leftText}</Text>

      <View
        style={{
          height: barHeight,
          borderRadius: barRadius,
          backgroundColor: track,
          overflow: "hidden",
          marginTop: barMarginTop,
          flexDirection: "row",
        }}
      >
        <View style={{ width: `${usedPct}%`, backgroundColor: fill }} />
      </View>

      {tickPct >= 0 ? (
        // The old ceiling, left visible on purpose. A bar that simply got
        // longer looks like a bigger bar; a bar with the old end still marked
        // on it looks like something the user moved.
        <View style={{ height: barHeight, marginTop: -barHeight, flexDirection: "row", pointerEvents: "none" }}>
          <View style={{ width: `${tickPct}%` }} />
          <View style={{ width: tickWidth, backgroundColor: tickColor, opacity: tickOpacity }} />
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: footGap, marginTop: footMarginTop }}>
        <Text style={{ color: label, fontSize: smallSize }}>{freeText}</Text>
        {earned > 0 ? (
          <Text style={{ color: earnedColor, fontSize: smallSize, fontWeight: earnedWeight }}>
            {earnedText}
          </Text>
        ) : null}
      </View>

      {props.caption ? (
        <Text style={{ color: label, fontSize: labelSize, marginTop: captionMarginTop, lineHeight: captionLineHeight }}>
          {String(props.caption)}
        </Text>
      ) : null}
    </View>
  );
}

export default WordMeter;
