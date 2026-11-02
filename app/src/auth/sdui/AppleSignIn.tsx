import React from "react";
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuthFlow } from "../AuthFlowContext";
import type { CompProps } from "../../sdui/components/props";
import * as K from "../../sdui/knobs";

/**
 * AppleSignIn — the real Apple button, not a lookalike.
 *
 * Apple's guidelines require their own control, so this renders theirs and the
 * server only decides whether it is there and how tall. It hides itself when
 * the platform cannot serve it, which is every Android device and any iOS
 * device where the check has not come back yet.
 */
export const AppleSignIn = ({ props, style }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  if (!flow || !flow.appleAvailable || Platform.OS !== "ios") return null;
  const size = Number(props?.size) || K.num("ui.AppleSignIn.size", 52);
  // Apple's own variants, by name: SIGN_IN | CONTINUE | SIGN_UP, and
  // WHITE | WHITE_OUTLINE | BLACK. An unknown name keeps the default.
  const types = AppleAuthentication.AppleAuthenticationButtonType as unknown as Record<string, number>;
  const styles = AppleAuthentication.AppleAuthenticationButtonStyle as unknown as Record<string, number>;
  const typeName = String(props?.buttonType ?? K.str("ui.AppleSignIn.buttonType", "SIGN_IN"));
  const styleName = String(props?.buttonStyle ?? K.str("ui.AppleSignIn.buttonStyle", "WHITE"));
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={(types[typeName] ?? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN) as AppleAuthentication.AppleAuthenticationButtonType}
      buttonStyle={(styles[styleName] ?? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE) as AppleAuthentication.AppleAuthenticationButtonStyle}
      cornerRadius={Number(props?.radius ?? size / 2)}
      style={[{ width: Number(props?.width) || size, height: size }, style]}
      onPress={flow.signInApple}
    />
  );
};
