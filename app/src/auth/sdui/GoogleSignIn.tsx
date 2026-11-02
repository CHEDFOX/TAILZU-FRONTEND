import React from "react";
import { Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useAuthFlow } from "../AuthFlowContext";
import type { CompProps } from "../../sdui/components/props";
import * as K from "../../sdui/knobs";

/**
 * GoogleSignIn — hidden until the three OAuth client ids are configured, so a
 * half-configured build shows no button rather than one that dead-ends.
 */
export const GoogleSignIn = ({ props, style, children }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  if (!flow || !flow.googleEnabled) return null;
  const size = Number(props?.size) || K.num("ui.GoogleSignIn.size", 52);
  const logo = Number(props?.logoSize ?? K.num("ui.GoogleSignIn.logoSize", 20));
  const pressedOpacity = Number(props?.pressedOpacity ?? K.num("ui.GoogleSignIn.pressedOpacity", 0.7));
  return (
    <Pressable
      onPress={flow.signInGoogle}
      accessibilityRole="button"
      accessibilityLabel={String(props?.label ?? K.txt("ui.GoogleSignIn.label", "Continue with Google"))}
      style={({ pressed }) => [
        {
          width: Number(props?.width) || size,
          height: size,
          borderRadius: Number(props?.radius ?? size / 2),
          backgroundColor: String(props?.background ?? K.color("ui.GoogleSignIn.background", "rgba(255,255,255,0.06)")),
          borderWidth: Number(props?.borderWidth ?? K.num("ui.GoogleSignIn.borderWidth", 1)),
          borderColor: String(props?.borderColor ?? K.color("ui.GoogleSignIn.borderColor", "rgba(255,255,255,0.13)")),
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? pressedOpacity : 1,
        },
        style,
      ]}
    >
      {/* Google's actual mark. This drew a letter "G" before, which is not
          Google's brand and reads as a placeholder next to Apple's real
          button — the two sit side by side, so one being a stand-in is
          obvious. */}
      {/* `children` is an empty ARRAY for a node with none, not undefined, so
          `??` never fell through and this button rendered blank. Length is the
          only honest test. */}
      {React.Children.count(children) > 0 ? children : (
        <Svg width={logo} height={logo} viewBox="0 0 48 48">
          <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </Svg>
      )}
    </Pressable>
  );
};
