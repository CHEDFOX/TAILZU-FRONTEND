/**
 * Input: ONE node, many kinds (pure/SPEC.md 2.8, B8).
 *
 * `CodeEntry`, `SwipePill`, the deleted Switch, Slider and Picker — each of those was its own component, its own
 * commit and its own app update. Here they are one node with a `kind`, so a new kind of field is a new value in a
 * string the server already sends.
 *
 *   { "type": "Input", "props": { "kind": "code", "length": 6 }, "bind": { "value": "state.code" },
 *     "on": { "onSubmit": "verify" } }
 *
 * The rules every kind keeps:
 *   - the value is written only through the host (v3Host.ts), at the node's own bound path;
 *   - it is sanitized and capped by inputCore first;
 *   - it is DATA. Nothing a person types is filled, evaluated or read as a template, ever (pure/SPEC.md 2.2).
 *
 * A kind this build does not know draws the node's `fallback`, like any unknown node: an older phone that meets a
 * wave-2 kind shows what the server says to show instead, not a blank.
 */
import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import type { CompProps } from "../props";
import { useV3Host } from "../v3Host";
import { inputKind } from "./inputCore";
import { useWrite, type KindProps } from "./parts";
import { CodeKind, NumberKind, TextKind } from "./TextKinds";
import { ChipsKind, PickerKind, RatingKind, SegmentedKind, StepperKind, SwitchKind } from "./ChoiceKinds";
import { SliderKind, SlideToConfirmKind } from "./RangeKinds";
import { DateKind, TimeKind } from "./DateKinds";

export const Input = ({ node, props, style, children, fire }: CompProps) => {
  const theme = useTheme();
  const host = useV3Host();
  const write = useWrite(host, node, props, fire);
  const kind = inputKind(props.kind);
  const bag: KindProps = { node, props, style, value: props.value, write, fire, disabled: props.disabled === true };

  // A kind we do not draw: whatever the node holds (a server's own stand-in), or nothing. The node's `fallback` is
  // the renderer's answer for an unknown TYPE; an unknown kind is this node's own, and reads the same way.
  if (!kind) return <View style={style}>{children}</View>;

  const field = (() => {
    switch (kind) {
      case "text": return <TextKind {...bag} kind="text" />;
      case "multiline": return <TextKind {...bag} kind="multiline" />;
      case "search": return <TextKind {...bag} kind="search" />;
      case "number": return <NumberKind {...bag} />;
      case "code": return <CodeKind {...bag} />;
      case "switch":
      case "toggle": return <SwitchKind {...bag} />;
      case "segmented": return <SegmentedKind {...bag} />;
      case "picker": return <PickerKind {...bag} />;
      case "chips": return <ChipsKind {...bag} />;
      case "rating": return <RatingKind {...bag} />;
      case "stepper": return <StepperKind {...bag} />;
      case "slider": return <SliderKind {...bag} />;
      case "slideToConfirm": return <SlideToConfirmKind {...bag} />;
      case "date": return <DateKind {...bag} />;
      case "time": return <TimeKind {...bag} />;
    }
  })();

  // A label above the field, for the kinds that do not carry their own (switch puts its label on its own row).
  if (!props.label || kind === "switch" || kind === "toggle" || kind === "slideToConfirm") return field;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: props.labelColor ?? theme.color.muted, fontSize: Number(props.labelSize ?? 13) }}>{String(props.label)}</Text>
      {field}
    </View>
  );
};
