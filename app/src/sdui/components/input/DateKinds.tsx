/**
 * date and time, drawn in JavaScript (pure/SPEC.md 2.8, wave 2).
 *
 * "The native date picker module is not linked, and is not needed." So a month is a grid of pressables and a time is
 * two columns of them, built from the same arithmetic the tests cover (inputCore: monthGrid, daysInMonth,
 * firstWeekday). A date is stored as `YYYY-MM-DD` and a time as `HH:MM`, 24-hour — what the person chose where they
 * are standing, with no zone and no instant, because the 3rd does not become the 2nd when a plane lands.
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as K from "../../knobs";
import { useTheme } from "../../theme/ThemeContext";
import type { KindProps } from "./parts";
import { columnOffset, dateValue, monthGrid, monthStep, parseDate, parseTime, timeValue } from "./inputCore";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** date: a month at a time. The month on show is the node's own; the day chosen is the screen's. */
export function DateKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const picked = parseDate(value);
  const today = new Date();
  const [shown, setShown] = useState(() => picked
    ? { year: picked.year, month: picked.month }
    : { year: today.getFullYear(), month: today.getMonth() + 1 });
  const cells = monthGrid(shown.year, shown.month);
  const cell = Number(props.cellSize ?? K.num("ui.Input.dateCell", 40));
  const head = (label: string, dir: 1 | -1) => (
    <Pressable disabled={disabled} onPress={() => setShown(monthStep(shown.year, shown.month, dir))} hitSlop={8} style={{ padding: 6 }}>
      <Text style={{ color: theme.color.muted, fontSize: 18 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[{ opacity: disabled ? 0.5 : 1 }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        {head("‹", -1)}
        <Text style={{ color: props.color ?? theme.color.text }}>{`${MONTHS[shown.month - 1]} ${shown.year}`}</Text>
        {head("›", 1)}
      </View>
      <View style={{ flexDirection: "row" }}>
        {WEEK.map((d, i) => (
          <Text key={i} style={{ width: cell, textAlign: "center", color: theme.color.muted, fontSize: 12 }}>{d}</Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((day, i) => {
          const on = day !== null && picked?.year === shown.year && picked?.month === shown.month && picked?.day === day;
          return (
            <Pressable
              key={i}
              disabled={disabled || day === null}
              onPress={() => day !== null && write(dateValue(shown.year, shown.month, day))}
              style={{
                width: cell, height: cell, alignItems: "center", justifyContent: "center",
                borderRadius: cell / 2, backgroundColor: on ? (props.activeColor ?? theme.color.primary) : "transparent",
              }}
            >
              <Text style={{ color: day === null ? "transparent" : on ? (props.activeTextColor ?? theme.color.bg) : (props.color ?? theme.color.text) }}>
                {day ?? ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** time: hours down one column, minutes down the other, on the step the node asks for. */
export function TimeKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const now = parseTime(value);
  const step = Math.max(1, Math.min(30, Number(props.minuteStep ?? 5) || 5));
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes: number[] = [];
  for (let m = 0; m < 60; m += step) minutes.push(m);
  const height = Number(props.height ?? K.num("ui.Input.timeHeight", 160)) || K.num("ui.Input.timeHeight", 160);
  const row = K.num("ui.Input.timeRow", 34);
  const column = (items: number[], picked: number | null, onPick: (n: number) => void) => (
    <TimeColumn items={items} picked={picked} onPick={onPick} props={props} disabled={disabled} height={height} row={row} />
  );
  return (
    <View
      style={[
        {
          flexDirection: "row", gap: 8, opacity: disabled ? 0.5 : 1,
          borderRadius: theme.radius.md ?? K.num("ui.Input.radius", 13), overflow: "hidden",
          backgroundColor: props.background ?? theme.color.inputBg,
        },
        style,
      ]}
    >
      {column(hours, now?.hour ?? null, (h) => write(timeValue(h, now?.minute ?? 0)))}
      {column(minutes, now?.minute ?? null, (m) => write(timeValue(now?.hour ?? 0, m)))}
    </View>
  );
}

/**
 * One column of a time picker.
 *
 * `nestedScrollEnabled` is the whole reason this is its own component on Android: a vertical ScrollView inside the
 * Screen's vertical ScrollView gives its drag to the outer one, so without it the later hours cannot be reached.
 * Scroll.tsx and MentionField.tsx already set it for exactly this. It also opens on the value already chosen, so
 * 9 pm is not twenty rows above the top of the window.
 */
function TimeColumn({ items, picked, onPick, props, disabled, height, row }: {
  items: number[];
  picked: number | null;
  onPick: (n: number) => void;
  props: Record<string, any>;
  disabled: boolean;
  height: number;
  row: number;
}) {
  const theme = useTheme();
  const ref = useRef<ScrollView>(null);
  const at = picked === null ? -1 : items.indexOf(picked);
  useEffect(() => {
    if (at < 0) return;
    const y = columnOffset(at, row, height);
    const id = requestAnimationFrame(() => ref.current?.scrollTo({ y, animated: false }));
    return () => cancelAnimationFrame(id);
    // Only when the column opens: scrolling under the finger on every pick would fight the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ScrollView ref={ref} nestedScrollEnabled style={{ flex: 1, maxHeight: height }} showsVerticalScrollIndicator={false}>
      {items.map((n) => {
        const on = picked === n;
        return (
          <Pressable
            key={n}
            disabled={disabled}
            onPress={() => onPick(n)}
            style={{ height: row, justifyContent: "center", alignItems: "center", backgroundColor: on ? (props.activeColor ?? theme.color.primary) : "transparent" }}
          >
            <Text style={{ color: on ? (props.activeTextColor ?? theme.color.bg) : (props.color ?? theme.color.text) }}>
              {String(n).padStart(2, "0")}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
