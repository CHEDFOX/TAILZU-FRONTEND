/** TextField: a text box bound to a state path. */
import { useContext } from "react";
import { Platform, TextInput } from "react-native";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import type { CompProps } from "./props";
import { FooterField } from "./Screen";

/**
 * KitExtras' `keyboard`: email (the email keyboard, no capitals or corrections, filled from the person's addresses) or
 * code (capitals, no corrections, a code from a message offered over the keyboard). Anything else: the field's own props.
 */
function keyboardOf(k: unknown): {
  keyboardType?: "email-address" | "ascii-capable" | "visible-password";
  autoCapitalize?: "none" | "characters";
  autoCorrect?: boolean;
  textContentType?: "emailAddress" | "oneTimeCode";
  autoComplete?: "email" | "one-time-code";
} {
  if (k === "email") return { keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false, textContentType: "emailAddress", autoComplete: "email" };
  // ASCII letters and digits only (a code is 7KQ-29D): iOS's own ASCII keyboard, Android's that offers no words.
  if (k === "code") return { keyboardType: Platform.OS === "ios" ? "ascii-capable" : "visible-password", autoCapitalize: "characters", autoCorrect: false, textContentType: "oneTimeCode", autoComplete: "one-time-code" };
  return {};
}

export const TextField = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  // In a footer that stays above the keyboard: it moves while this field has it.
  const footer = useContext(FooterField);
  const kb = keyboardOf(props.keyboard);
  return (
    <TextInput
      value={String(props.value ?? "")}
      onFocus={footer ? () => footer(true) : undefined}
      onBlur={footer ? () => footer(false) : undefined}
      onChangeText={(t) => {
        if (bindPath) store.set(bindPath, t);
        fire("onChange", t);
      }}
      placeholder={props.placeholder}
      placeholderTextColor={props.placeholderColor ?? theme.color.muted}
      // The return key runs the node's on.onSubmit (the Bots app's ask bar sends with it). A field without one
      // keeps the keyboard's own return, as before.
      onSubmitEditing={node.on?.onSubmit ? (e) => fire("onSubmit", e.nativeEvent.text) : undefined}
      returnKeyType={props.returnKeyType}
      submitBehavior={node.on?.onSubmit && !props.multiline ? "blurAndSubmit" : undefined}
      multiline={props.multiline}
      autoCapitalize={kb.autoCapitalize ?? props.autoCapitalize}
      autoCorrect={kb.autoCorrect ?? props.autoCorrect}
      keyboardType={kb.keyboardType}
      textContentType={kb.textContentType}
      autoComplete={kb.autoComplete}
      // KitExtras: focused when it first appears (the TextInput mounts when a when() shows it, as the email field after
      // Create does), never again on a repaint; and the most it takes.
      autoFocus={props.autoFocus === true}
      maxLength={Number(props.maxLength) > 0 ? Number(props.maxLength) : undefined}
      style={[
        {
          backgroundColor: props.background ?? theme.color.inputBg, color: props.color ?? theme.color.text,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.md ?? K.num("ui.TextField.radius", 13),
          paddingHorizontal: Number(props.paddingHorizontal ?? K.num("ui.TextField.paddingHorizontal", 12)),
          paddingVertical: Number(props.paddingVertical ?? K.num("ui.TextField.paddingVertical", 10)),
          minHeight: props.multiline
            ? Number(props.minHeightMultiline ?? K.num("ui.TextField.minHeightMultiline", 80))
            : Number(props.minHeight ?? K.num("ui.TextField.minHeight", 44)),
          borderWidth: Number(props.borderWidth ?? K.num("ui.TextField.borderWidth", 1)),
          borderColor: props.borderColor ?? theme.color.border, textAlignVertical: props.multiline ? "top" : "center",
        },
        style,
      ]}
    />
  );
};
