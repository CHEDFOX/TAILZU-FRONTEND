/** TextField: a text box bound to a state path. */
import { useContext } from "react";
import { TextInput } from "react-native";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import type { CompProps } from "./props";
import { FooterField } from "./Screen";

export const TextField = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  // In a footer that stays above the keyboard: it moves while this field has it.
  const footer = useContext(FooterField);
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
      autoCapitalize={props.autoCapitalize}
      autoCorrect={props.autoCorrect}
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
