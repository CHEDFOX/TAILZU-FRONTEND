/** Button: the plain labelled button (the launch card's). */
import { Text } from "react-native";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import { typeRole } from "../theme/typeRole";
import { readableOn } from "../theme/style";
import type { CompProps } from "./props";
import { SpringPressable } from "./motion";

// The press flash: a neutral pale-ink veil, like the keyboard's KEY_PRESSED.
// Not the brand amber — amber is only for what is live (recording, listening),
// and a tap is not. It is the ui.Button.flashColor knob,
// read at each press.

export const Button = ({ props, style, fire }: CompProps) => {
  const theme = useTheme();
  const isSecondary = props.variant === "secondary";
  const isGhost = props.variant === "ghost";
  const bg =
    props.variant === "danger" ? theme.color.danger :
    isGhost || isSecondary ? K.color("ui.Button.clearBackground", "transparent") : theme.color.primary;
  // Secondary was a hard-coded near-white, which is invisible on a light
  // theme — the tone editor's Edit and Cancel rendered as empty pills for
  // anyone whose phone was in light mode. The theme's own text colour reads
  // on the theme's own surface, in both modes.
  const labelColor = isGhost || isSecondary ? theme.color.text : readableOn(bg);
  return (
    <SpringPressable
      onPress={() => fire("onPress")}
      disabled={props.disabled}
      impactOnRelease={!isSecondary && !isGhost}
      // The press flash, a neutral veil by default ("we heard that" without
      // the live colour); "none" removes it for a button whose own colour
      // change already says so.
      flashColor={props.flashColor === "none" ? undefined : String(props.flashColor ?? K.color("ui.Button.flashColor", "rgba(243,226,198,0.18)"))}
      pressScale={props.pressScale !== undefined ? Number(props.pressScale) : undefined}
      style={[
        // paddingHorizontal matters: a hug-width button without it renders the
        // label touching the pill's edges ("Allow Microphone" overflow bug).
        {
          backgroundColor: bg,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.pill ?? K.num("ui.Button.radius", 999),
          paddingVertical: props.paddingVertical !== undefined ? Number(props.paddingVertical) : K.num("ui.Button.paddingVertical", 17),
          paddingHorizontal: props.paddingHorizontal !== undefined ? Number(props.paddingHorizontal) : K.num("ui.Button.paddingHorizontal", 28),
          alignItems: "center",
          justifyContent: "center",
          opacity: props.disabled ? Number(props.disabledOpacity ?? K.num("ui.Button.disabledOpacity", 0.5)) : 1,
        },
        // Secondary: a quiet hairline outline (the editorial look the auth
        // screen's social circles use) — the old solid gray chip read heavy
        // and cheap next to the white primary.
        isSecondary ? {
          borderWidth: Number(props.borderWidth ?? K.num("ui.Button.secondaryBorderWidth", 1)),
          borderColor: String(props.borderColor ?? K.color("ui.Button.secondaryBorder", "rgba(255,255,255,0.18)")),
          backgroundColor: String(props.background ?? K.color("ui.Button.secondaryFill", "rgba(255,255,255,0.04)")),
        } : null,
        style,
      ]}
    >
      {/* The label's type comes from the scale (button / buttonSecondary);
          a node can still override any of it per button. */}
      <Text
        style={[
          typeRole(theme, isSecondary ? "buttonSecondary" : "button",
            { fontWeight: isSecondary ? "600" : "700", fontSize: 16, letterSpacing: 0.4 }),
          {
            color: props.labelColor ? String(props.labelColor) : labelColor,
            ...(props.fontWeight ? { fontWeight: String(props.fontWeight) as any } : null),
            ...(props.fontSize !== undefined ? { fontSize: Number(props.fontSize) } : null),
            ...(props.tracking !== undefined ? { letterSpacing: Number(props.tracking) } : null),
          },
        ]}
      >
        {props.label ?? ""}
      </Text>
    </SpringPressable>
  );
};
