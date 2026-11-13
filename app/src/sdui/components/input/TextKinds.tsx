/**
 * The typed kinds of Input: text, multiline, number, code and search (pure/SPEC.md 2.8, wave 1).
 *
 * All five are one `TextInput` with different rules about what may be in it. What a person types goes through
 * inputCore before it goes anywhere: control characters and bidirectional overrides out, length capped, and the
 * shape the kind promises (a number is a number, a code is upper-case letters and digits). It is then stored as
 * data. Nothing typed here is ever filled, evaluated or read as a template (pure/SPEC.md 2.2, principle 4).
 */
import React, { useContext, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as K from "../../knobs";
import { useTheme } from "../../theme/ThemeContext";
import { FooterField } from "../Screen";
import type { KindProps } from "./parts";
import { INPUT_LIMITS, sanitizeCode, sanitizeLine, sanitizeNumber, sanitizeSearch, sanitizeText } from "./inputCore";

/** The box every typed kind sits in, so they all read as one control. */
function fieldStyle(theme: ReturnType<typeof useTheme>, props: Record<string, any>, multiline: boolean) {
  return {
    backgroundColor: props.background ?? theme.color.inputBg,
    color: props.color ?? theme.color.text,
    borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.md ?? K.num("ui.Input.radius", 13),
    paddingHorizontal: Number(props.paddingHorizontal ?? K.num("ui.Input.paddingHorizontal", 12)),
    paddingVertical: Number(props.paddingVertical ?? K.num("ui.Input.paddingVertical", 10)),
    minHeight: multiline ? Number(props.minHeight ?? K.num("ui.Input.minHeightMultiline", 80)) : Number(props.minHeight ?? K.num("ui.Input.minHeight", 44)),
    borderWidth: Number(props.borderWidth ?? K.num("ui.Input.borderWidth", 1)),
    borderColor: props.borderColor ?? theme.color.border,
    textAlignVertical: multiline ? ("top" as const) : ("center" as const),
  };
}

/** text, multiline and search: one sanitizer each, the same box. */
export function TextKind({ node, props, style, value, write, fire, disabled, kind }: KindProps & { kind: "text" | "multiline" | "search" }) {
  const theme = useTheme();
  const footer = useContext(FooterField);
  const multiline = kind === "multiline";
  const max = Number(props.maxLength) > 0 ? Number(props.maxLength)
    : kind === "search" ? INPUT_LIMITS.searchMax : multiline ? INPUT_LIMITS.textMax : INPUT_LIMITS.lineMax;
  const clean = (t: string) => (kind === "search" ? sanitizeSearch(t, max) : multiline ? sanitizeText(t, max) : sanitizeLine(t, max));
  return (
    <TextInput
      value={String(value ?? "")}
      editable={!disabled}
      onFocus={footer ? () => footer(true) : undefined}
      onBlur={footer ? () => footer(false) : undefined}
      onChangeText={(t) => write(clean(t))}
      onSubmitEditing={node.on?.onSubmit ? (e) => fire("onSubmit", clean(e.nativeEvent.text)) : undefined}
      submitBehavior={node.on?.onSubmit && !multiline ? "blurAndSubmit" : undefined}
      placeholder={props.placeholder}
      placeholderTextColor={props.placeholderColor ?? theme.color.muted}
      multiline={multiline}
      returnKeyType={props.returnKeyType ?? (kind === "search" ? "search" : undefined)}
      keyboardType={kind === "search" ? "default" : props.keyboard === "email" ? "email-address" : "default"}
      autoCapitalize={props.autoCapitalize ?? (kind === "search" ? "none" : "sentences")}
      autoCorrect={props.autoCorrect !== false && kind !== "search"}
      autoFocus={props.autoFocus === true}
      // The cap is enforced in the sanitizer too; this only stops the keyboard offering more.
      maxLength={Math.min(max, INPUT_LIMITS.textMax)}
      style={[fieldStyle(theme, props, multiline), style]}
    />
  );
}

/** number: digits, one point, one minus, clamped to min/max once it is a number at all. */
export function NumberKind({ node, props, style, value, write, fire, disabled }: KindProps) {
  const theme = useTheme();
  const footer = useContext(FooterField);
  const shape = {
    min: props.min !== undefined ? Number(props.min) : undefined,
    max: props.max !== undefined ? Number(props.max) : undefined,
    decimals: props.decimals !== undefined ? Number(props.decimals) : undefined,
  };
  // What is being typed is the field's own, so "1." and "-" survive the keystroke that made them; the store only
  // ever sees the number they stand for, or null while they stand for nothing.
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (value === null || value === undefined ? "" : String(value));
  return (
    <TextInput
      value={shown}
      editable={!disabled}
      onFocus={footer ? () => footer(true) : undefined}
      onBlur={() => { setTyped(null); footer?.(false); }}
      onChangeText={(t) => {
        const n = sanitizeNumber(t, shape);
        setTyped(n.text);
        write(n.value);
      }}
      onSubmitEditing={node.on?.onSubmit ? () => fire("onSubmit", sanitizeNumber(shown, shape).value) : undefined}
      placeholder={props.placeholder}
      placeholderTextColor={props.placeholderColor ?? theme.color.muted}
      keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
      autoCorrect={false}
      autoFocus={props.autoFocus === true}
      style={[fieldStyle(theme, props, false), style]}
    />
  );
}

/**
 * code: a one-time code or a join code, drawn as its own boxes.
 *
 * One real field, invisible over the boxes, so the OS can still offer a code from a message; the boxes are just the
 * drawing of what it holds. `onSubmit` fires by itself the moment the last box is filled, because nobody wants to
 * press a button after typing the sixth digit of a code they were read over the phone.
 */
export function CodeKind({ node, props, style, value, write, fire, disabled }: KindProps) {
  const theme = useTheme();
  const length = Math.max(1, Math.min(INPUT_LIMITS.codeMax, Number(props.length ?? 6) || 6));
  const digitsOnly = props.digitsOnly === true;
  const text = sanitizeCode(value, length, digitsOnly);
  const field = useRef<TextInput>(null);
  const done = useRef(false);
  const boxes = Array.from({ length }, (_, i) => text[i] ?? "");
  const gap = Number(props.gap ?? K.num("ui.Input.codeGap", 8));
  const box = Number(props.boxSize ?? K.num("ui.Input.codeBox", 46));
  return (
    <Pressable onPress={() => !disabled && field.current?.focus()} style={[{ flexDirection: "row", gap }, style]}>
      {boxes.map((c, i) => (
        <View
          key={i}
          style={{
            width: box, height: box, borderRadius: theme.radius.md ?? K.num("ui.Input.radius", 13),
            borderWidth: Number(props.borderWidth ?? K.num("ui.Input.borderWidth", 1)),
            borderColor: i === text.length && !disabled ? (props.activeBorderColor ?? theme.color.primary) : (props.borderColor ?? theme.color.border),
            backgroundColor: props.background ?? theme.color.inputBg,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{ color: props.color ?? theme.color.text, fontSize: Number(props.fontSize ?? K.num("ui.Input.codeFontSize", 20)) }}>{c}</Text>
        </View>
      ))}
      <TextInput
        ref={field}
        value={text}
        editable={!disabled}
        onChangeText={(t) => {
          const next = sanitizeCode(t, length, digitsOnly);
          write(next);
          // Once, at the moment it is complete: a code that is corrected and completed again fires again.
          if (next.length >= length && !done.current) { done.current = true; fire("onSubmit", next); }
          if (next.length < length) done.current = false;
        }}
        keyboardType={digitsOnly ? "number-pad" : Platform.OS === "ios" ? "ascii-capable" : "visible-password"}
        autoCapitalize="characters"
        autoCorrect={false}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={props.autoFocus === true}
        maxLength={length}
        caretHidden
        style={[StyleSheet.absoluteFill, { opacity: 0, color: "transparent" }]}
      />
    </Pressable>
  );
}
