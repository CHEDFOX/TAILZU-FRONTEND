/**
 * The kinds of Input that choose rather than type: switch, segmented, picker, chips, rating and stepper
 * (pure/SPEC.md 2.8 — switch and segmented in wave 1, the rest in wave 2).
 *
 * Every one of them writes through inputCore, so a picker can only ever store a value it actually offers, a rating
 * can only be a whole number of the stars that exist, and a chip is one sanitized line.
 */
import React, { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import * as K from "../../knobs";
import { useTheme } from "../../theme/ThemeContext";
import type { KindProps } from "./parts";
import {
  INPUT_LIMITS, asSwitch, chipAdded, chipList, chipRemoved, chosen, clampRating, clampStep, options, sanitizeLine, stepped,
} from "./inputCore";

/** switch / toggle: on or off. */
export function SwitchKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const on = asSwitch(value);
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, style]}>
      {props.label ? <Text style={{ color: props.color ?? theme.color.text, flexShrink: 1 }}>{String(props.label)}</Text> : null}
      <Switch
        value={on}
        disabled={disabled}
        onValueChange={(next) => write(next)}
        trackColor={{ true: props.activeColor ?? theme.color.primary, false: props.trackColor ?? theme.color.border }}
      />
    </View>
  );
}

/** segmented: every choice on show, one of them taken. */
export function SegmentedKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const list = options(props.options);
  const now = chosen(list, value);
  const radius = props.radius !== undefined ? Number(props.radius) : theme.radius.pill ?? K.num("ui.Input.segmentRadius", 999);
  return (
    <View
      style={[
        {
          flexDirection: "row", borderRadius: radius, padding: Number(props.pad ?? K.num("ui.Input.segmentPad", 3)),
          backgroundColor: props.background ?? theme.color.inputBg, opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {list.map((o) => {
        const picked = now?.value === o.value;
        return (
          <Pressable
            key={o.value}
            disabled={disabled}
            onPress={() => write(o.value)}
            style={{
              flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius,
              paddingVertical: Number(props.paddingVertical ?? K.num("ui.Input.segmentPaddingVertical", 8)),
              backgroundColor: picked ? (props.activeColor ?? theme.color.primary) : "transparent",
            }}
          >
            <Text numberOfLines={1} style={{ color: picked ? (props.activeTextColor ?? theme.color.bg) : (props.color ?? theme.color.text) }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * picker: too many choices for a row, so the list opens under the field.
 *
 * Open and shut is the node's own, not the screen's: which list is unrolled is not something a server needs to hold
 * or a person needs to lose when a live update swaps the screen under them.
 */
export function PickerKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const list = options(props.options);
  const now = chosen(list, value);
  const radius = props.radius !== undefined ? Number(props.radius) : theme.radius.md ?? K.num("ui.Input.radius", 13);
  const row = {
    paddingHorizontal: Number(props.paddingHorizontal ?? K.num("ui.Input.paddingHorizontal", 12)),
    paddingVertical: Number(props.paddingVertical ?? K.num("ui.Input.paddingVertical", 10)),
  };
  return (
    <View style={[{ opacity: disabled ? 0.5 : 1 }, style]}>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={{
          ...row, borderRadius: radius, borderWidth: Number(props.borderWidth ?? K.num("ui.Input.borderWidth", 1)),
          borderColor: props.borderColor ?? theme.color.border, backgroundColor: props.background ?? theme.color.inputBg,
          flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8,
        }}
      >
        <Text numberOfLines={1} style={{ color: now ? (props.color ?? theme.color.text) : (props.placeholderColor ?? theme.color.muted) }}>
          {now?.label ?? String(props.placeholder ?? "")}
        </Text>
        <Text style={{ color: theme.color.muted }}>{open ? "⌃" : "⌄"}</Text>
      </Pressable>
      {open ? (
        <View
          style={{
            marginTop: 6, borderRadius: radius, overflow: "hidden",
            borderWidth: Number(props.borderWidth ?? K.num("ui.Input.borderWidth", 1)), borderColor: props.borderColor ?? theme.color.border,
            backgroundColor: props.background ?? theme.color.inputBg,
          }}
        >
          {list.map((o) => (
            <Pressable key={o.value} onPress={() => { write(o.value); setOpen(false); }} style={{ ...row }}>
              <Text style={{ color: o.value === now?.value ? (props.activeColor ?? theme.color.primary) : (props.color ?? theme.color.text) }}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** chips: a few short words, each added once, each removable. */
export function ChipsKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const max = Number(props.max) > 0 ? Number(props.max) : INPUT_LIMITS.chipsMax;
  const held = chipList(value, max);
  const [draft, setDraft] = useState("");
  const radius = theme.radius.pill ?? K.num("ui.Input.chipRadius", 999);
  const full = held.length >= Math.min(max, INPUT_LIMITS.chipsMax);
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: Number(props.gap ?? K.num("ui.Input.chipGap", 8)), alignItems: "center" }, style]}>
      {held.map((c) => (
        <Pressable
          key={c}
          disabled={disabled}
          onPress={() => write(chipRemoved(held, c))}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius,
            paddingHorizontal: Number(props.chipPaddingHorizontal ?? K.num("ui.Input.chipPaddingHorizontal", 12)),
            paddingVertical: Number(props.chipPaddingVertical ?? K.num("ui.Input.chipPaddingVertical", 6)),
            backgroundColor: props.chipBackground ?? theme.color.inputBg,
          }}
        >
          <Text style={{ color: props.color ?? theme.color.text }}>{c}</Text>
          <Text style={{ color: theme.color.muted }}>{"×"}</Text>
        </Pressable>
      ))}
      {!full && props.addable !== false ? (
        <TextInput
          value={draft}
          editable={!disabled}
          onChangeText={(t) => setDraft(sanitizeLine(t, INPUT_LIMITS.chipMax))}
          onSubmitEditing={() => { write(chipAdded(held, draft, max)); setDraft(""); }}
          placeholder={props.placeholder}
          placeholderTextColor={theme.color.muted}
          returnKeyType="done"
          autoCorrect={false}
          style={{
            minWidth: Number(props.draftWidth ?? K.num("ui.Input.chipDraftWidth", 90)), color: props.color ?? theme.color.text,
            paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius,
            borderWidth: 1, borderColor: props.borderColor ?? theme.color.border,
          }}
        />
      ) : null}
    </View>
  );
}

/** rating: whole stars, tap the one you mean; tap it again to go back to none. */
export function RatingKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const stars = Math.max(1, Math.min(INPUT_LIMITS.ratingMax, Number(props.stars ?? 5) || 5));
  const now = clampRating(value, stars);
  const size = Number(props.size ?? K.num("ui.Input.ratingSize", 28));
  return (
    <View style={[{ flexDirection: "row", gap: Number(props.gap ?? K.num("ui.Input.ratingGap", 6)), opacity: disabled ? 0.5 : 1 }, style]}>
      {Array.from({ length: stars }, (_, i) => i + 1).map((n) => (
        <Pressable key={n} disabled={disabled} onPress={() => write(clampRating(now === n ? n - 1 : n, stars))} hitSlop={6}>
          <Text style={{ fontSize: size, color: n <= now ? (props.activeColor ?? theme.color.primary) : (props.color ?? theme.color.border) }}>
            {n <= now ? "★" : "☆"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** stepper: one up, one down, inside its range. */
export function StepperKind({ props, style, value, write, disabled }: KindProps) {
  const theme = useTheme();
  const min = props.min !== undefined ? Number(props.min) : 0;
  const max = props.max !== undefined ? Number(props.max) : 100;
  const step = props.step !== undefined ? Number(props.step) : 1;
  const shown = clampStep(value, min, max, 0);
  const radius = theme.radius.pill ?? K.num("ui.Input.stepperRadius", 999);
  const key = (label: string, dir: 1 | -1, off: boolean) => (
    <Pressable
      disabled={disabled || off}
      onPress={() => write(stepped(shown, dir, min, max, step))}
      style={{
        width: Number(props.keySize ?? K.num("ui.Input.stepperKey", 38)), height: Number(props.keySize ?? K.num("ui.Input.stepperKey", 38)),
        borderRadius: radius, alignItems: "center", justifyContent: "center",
        backgroundColor: props.background ?? theme.color.inputBg, opacity: off ? 0.4 : 1,
      }}
    >
      <Text style={{ color: props.color ?? theme.color.text, fontSize: Number(props.fontSize ?? K.num("ui.Input.stepperFontSize", 18)) }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: Number(props.gap ?? K.num("ui.Input.stepperGap", 10)) }, style]}>
      {key("−", -1, shown <= min)}
      <Text style={{ color: props.color ?? theme.color.text, minWidth: Number(props.valueWidth ?? K.num("ui.Input.stepperValueWidth", 34)), textAlign: "center" }}>
        {String(shown)}
      </Text>
      {key("+", 1, shown >= max)}
    </View>
  );
}
