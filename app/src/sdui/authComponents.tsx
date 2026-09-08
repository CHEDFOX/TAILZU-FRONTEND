/**
 * The sign-in screen's components, in the SDUI registry.
 *
 * These are what stood between the auth screen and the rest of the app. Every
 * other screen is composed by the server; this one was not, because the pills,
 * the country sheet and the native sign-in buttons had no registry entries —
 * and components live in the binary, so no amount of backend work could add
 * them. Registering these is what moves auth onto the same footing as the
 * other twenty-four.
 *
 * They are WRAPPERS, deliberately. MethodPill below is the one that already
 * ships, imported rather than reimplemented: it carries the swipe-to-submit
 * gesture, the drag threshold, the country gate and the haptics, all of which
 * are load-bearing and none of which are worth writing twice. What these add is
 * a props surface, so the server decides placement, copy and which methods
 * exist.
 *
 * The auth LOGIC is not here and must never move here. It stays in
 * AuthGateScreen and arrives through AuthFlowContext, so the native screen
 * remains the thing doing the work and stays a working fallback. A component
 * that finds no flow draws nothing rather than throwing — an auth node that
 * somehow rendered on another screen must not take that screen down.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import Svg, { Path } from "react-native-svg";
// TYPE-ONLY. A value import here would close a cycle:
//   components → authComponents → AuthGateScreen → authRender → components
// and Metro resolves a cycle by handing someone a half-initialised module. The
// symptom is not a warning, it is the app throwing during module init — before
// the first render, so the splash never leaves, and the keyboard falls back to
// its built-in layout because the config it reads is written on boot by an app
// that never booted. Types are erased at build time and cost nothing at
// runtime; the component itself is fetched lazily below.
import type { Field } from "../auth/AuthGateScreen";
import { useAuthFlow } from "../auth/AuthFlowContext";
import type { CompProps } from "./components";

/**
 * SwipePill — one sign-in method. Swipe the badge or tap the arrow.
 *
 * props.method  "email" | "phone"
 * props.hintDelayMs  when the badge nudges itself to advertise the gesture
 */
export const SwipePill = ({ props }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  // Resolved at RENDER time, not module-init time. By the time anything
  // renders, every module has finished initialising, so reaching back into the
  // auth screen here is safe where a top-level import is not.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MethodPill } = require("../auth/AuthGateScreen") as {
    MethodPill: React.ComponentType<{
      field: Field;
      onSubmit: (f: Field, value: string) => void;
      hintDelay: number;
    }>;
  };
  const method = props?.method === "phone" ? "phone" : "email";
  if (!flow) return null;
  // A method the backend offers but this build cannot serve draws nothing.
  // Better an absent row than a row that fails when someone taps it.
  if (method === "phone" && !flow.phoneEnabled) return null;
  const field: Field = { id: method, type: method };
  return (
    <MethodPill
      field={field}
      onSubmit={(f, value) => flow.submit(f.type, value)}
      hintDelay={Number(props?.hintDelayMs) || 1100}
    />
  );
};

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
  const size = Number(props?.size) || 52;
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={Number(props?.radius ?? size / 2)}
      style={[{ width: Number(props?.width) || size, height: size }, style]}
      onPress={flow.signInApple}
    />
  );
};

/**
 * GoogleSignIn — hidden until the three OAuth client ids are configured, so a
 * half-configured build shows no button rather than one that dead-ends.
 */
export const GoogleSignIn = ({ props, style, children }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  if (!flow || !flow.googleEnabled) return null;
  const size = Number(props?.size) || 52;
  return (
    <Pressable
      onPress={flow.signInGoogle}
      accessibilityRole="button"
      accessibilityLabel={String(props?.label ?? "Continue with Google")}
      style={({ pressed }) => [
        {
          width: Number(props?.width) || size,
          height: size,
          borderRadius: Number(props?.radius ?? size / 2),
          backgroundColor: String(props?.background ?? "rgba(255,255,255,0.06)"),
          borderWidth: 1,
          borderColor: String(props?.borderColor ?? "rgba(255,255,255,0.13)"),
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {/* Google's actual mark. This drew a letter "G" before, which is not
          Google's brand and reads as a placeholder next to Apple's real
          button — the two sit side by side, so one being a stand-in is
          obvious. */}
      {children ?? (
        <Svg width={20} height={20} viewBox="0 0 48 48">
          <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </Svg>
      )}
    </Pressable>
  );
};

/**
 * CodeEntry — the six-digit code, as ONE pill rather than six circles.
 *
 * The digits sit in a single tracked row and the badge on the right is the
 * resend control. While the code is being typed the badge fades out: it is the
 * only thing on the pill that is not the code, and someone mid-entry is not
 * looking for it. It comes back when the field is empty again.
 *
 * The whole pill is the tap target for the keyboard — a hidden input holds the
 * caret, exactly as the six-box version did.
 */
export const CodeEntry = ({ props, style }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  const fade = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const typing = (flow?.code.length ?? 0) > 0;
  const errored = flow?.codeError ?? false;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: typing ? 0 : 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [typing, fade]);

  useEffect(() => {
    if (!errored) return;
    Animated.sequence([
      Animated.timing(shake, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 4, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start();
  }, [errored, shake]);

  if (!flow) return null;

  const height = Number(props?.height) || 56;
  const len = flow.codeLength;
  const shown = flow.code.padEnd(len, "·").split("").join(" ");

  return (
    <Animated.View style={[{ transform: [{ translateX: shake }] }, style]}>
      <Pressable
        onPress={flow.focusCode}
        accessibilityRole="button"
        accessibilityLabel={String(props?.label ?? "Enter the code we sent you")}
        style={{
          height,
          borderRadius: Number(props?.radius ?? height / 2),
          backgroundColor: String(props?.background ?? "rgba(255,255,255,0.055)"),
          borderWidth: 1,
          borderColor: errored
            ? String(props?.errorColor ?? "rgba(255,90,60,0.85)")
            : String(props?.borderColor ?? "rgba(255,255,255,0.13)"),
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: Number(props?.paddingLeft) || 22,
          paddingRight: 6,
        }}
      >
        <Text
          style={{
            flex: 1,
            color: "#FFFFFF",
            fontSize: Number(props?.fontSize) || 17,
            letterSpacing: Number(props?.letterSpacing ?? 8),
            fontVariant: ["tabular-nums"],
          }}
        >
          {shown}
        </Text>
        {/* The resend badge. Transparent while typing rather than removed, so
            the pill does not reflow under the caret mid-entry. */}
        <Animated.View style={{ opacity: fade }} pointerEvents={typing ? "none" : "auto"}>
          <Pressable
            onPress={flow.resend}
            accessibilityRole="button"
            accessibilityLabel={String(props?.resendLabel ?? "Send the code again")}
            hitSlop={10}
            style={{
              width: height - 10,
              height: height - 10,
              borderRadius: (height - 10) / 2,
              backgroundColor: String(props?.badgeBackground ?? "rgba(255,255,255,0.1)"),
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 15 }}>↻</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
};

/**
 * AuthPhase — draws its children only during the phases the server names.
 *
 * `visibleIf` cannot express this: the flow's phase lives in a React context,
 * not in the SDUI store, so there is no state path for a condition to read.
 * Rather than mirror the phase into the store — two copies of one truth, and a
 * frame where they disagree — the gate is a node.
 *
 * props.phases  e.g. ["entry"] or ["verify", "verifying"]
 */
export const AuthPhase = ({ props, children }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  if (!flow) return null;
  const want = Array.isArray(props?.phases) ? (props.phases as string[]) : [];
  if (want.length && !want.includes(flow.phase)) return null;
  return <View>{children}</View>;
};
