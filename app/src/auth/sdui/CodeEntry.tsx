import React, { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Platform, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useAuthFlow } from "../AuthFlowContext";
import type { CompProps } from "../../sdui/components/props";
import * as K from "../../sdui/knobs";
import { codeLiftTarget } from "./codeLift";

/**
 * CodeEntry — the code, as ONE pill built like the method pills.
 *
 * It OWNS ITS INPUT. The first version borrowed the native screen's hidden
 * field through the flow's focusCode, and on this path that field is never
 * rendered — so tapping the pill focused nothing, no keyboard came up, and
 * the control was simply dead. Anything the server-composed screen needs has
 * to exist inside the server-composed screen.
 *
 * Same shape as a method pill, deliberately: digits on the left, one badge on
 * the right. The badge is resend while the field is empty and an arrow once
 * the code is complete, so the affordance to continue is where it was on the
 * screen before — and there is never a moment with no badge and no way on.
 *
 * It lifts itself the same way the method pills do, off focus and remembered
 * keyboard height rather than off the keyboard's arrival, because moving
 * between fields fires no keyboard event at all.
 *
 * props.variant "boxes" draws the onboarding's version instead: one box per
 * digit, the sentence "I sent a 6-digit code to ..." above, and under them a
 * line that says what is happening, a way to send it again and a way to change
 * the address. Same input, same shake, same flow: only the drawing and the words
 * (all of them the server's) differ. It does not lift: the boxes sit near the
 * top of the step, not at the foot of the screen, and the step's own scroll
 * view makes room for the keyboard (see codeLiftTarget).
 */
export const CodeEntry = ({ props, style }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // The caret in the box being filled blinks, twice a second, while it is the
  // box with the cursor in it.
  const [caretOn, setCaretOn] = useState(true);
  const boxes = props?.variant === "boxes";
  const typing = boxes && focused && flow?.phase === "verify";
  useEffect(() => {
    if (!typing) { setCaretOn(true); return; }
    const t = setInterval(() => setCaretOn((on) => !on), 500);
    return () => clearInterval(t);
  }, [typing]);
  const [kbHeight, setKbHeight] = useState(0);
  const lift = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e: any) => setKbHeight(e?.endCoordinates?.height ?? 0));
    const onHide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  // The lift: how far above the keyboard the pill rides (its overlap with the
  // keyboard's own top, in points) and the spring that carries it there.
  const liftLook = K.obj("ui.CodeEntry.lift", { overlap: 34, damping: 20, stiffness: 190, mass: 0.7 });
  useEffect(() => {
    Animated.spring(lift, {
      toValue: codeLiftTarget({ boxes, focused, kbHeight, overlap: liftLook.overlap }),
      damping: liftLook.damping, stiffness: liftLook.stiffness, mass: liftLook.mass,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, kbHeight, lift]);

  const errored = flow?.codeError ?? false;
  useEffect(() => {
    if (!errored) return;
    // The wrong-code shake, beat by beat: where it throws to and for how long.
    const beats = K.list<{ to: number; ms: number }>("ui.CodeEntry.shake", [
      { to: 8, ms: 60 }, { to: -8, ms: 60 }, { to: 4, ms: 60 }, { to: 0, ms: 80 },
    ]);
    Animated.sequence(beats.map((b) =>
      Animated.timing(shake, { toValue: Number(b.to) || 0, duration: Number(b.ms) || 0, useNativeDriver: true }),
    )).start();
  }, [errored, shake]);

  // The caret belongs here the moment the code step opens — this IS the step.
  const focusDelayMs = Number(props?.focusDelayMs ?? K.num("ui.CodeEntry.focusDelayMs", 320));
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus?.(), focusDelayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!flow) return null;

  const h = Number(props?.height) || K.num("ui.CodeEntry.height", 56);
  const len = flow.codeLength;
  const complete = flow.code.length === len;
  const blank = String(props?.blankGlyph ?? K.txt("ui.CodeEntry.blankGlyph", "·")) || "·";
  const spacer = String(props?.digitSeparator ?? K.txt("ui.CodeEntry.digitSeparator", " "));
  const shown = flow.code.padEnd(len, blank).split("").join(spacer);
  const badgeInset = Number(props?.badgeInset ?? K.num("ui.CodeEntry.badgeInset", 10));
  const badge = h - badgeInset;

  if (boxes) {
    // No lift here: see codeLiftTarget. The boxes sit near the top of the step,
    // and the step's scroll view already makes room for the keyboard.
    return (
      <Animated.View style={[{ transform: [{ translateX: shake }] }, style]}>
        <CodeBoxes
          flow={flow}
          props={props}
          errored={errored}
          caretOn={caretOn}
          onFocusInput={() => input.current?.focus?.()}
        />
        {/* Off-screen, not hidden: a display:none input cannot hold a caret.
            It carries the real value and the number pad. */}
        <TextInput
          ref={input}
          value={flow.code}
          onChangeText={flow.setCode}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={len}
          editable={flow.phase === "verify"}
          underlineColorAndroid="transparent"
          style={{ position: "absolute", opacity: 0, height: 1, width: 1, left: -9999 }}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[{ transform: [{ translateY: lift }, { translateX: shake }] }, style]}>
      <Pressable
        onPress={() => input.current?.focus?.()}
        accessibilityRole="button"
        accessibilityLabel={String(props?.label ?? K.txt("ui.CodeEntry.label", "Enter the code we sent you"))}
        style={{
          height: h,
          borderRadius: Number(props?.radius ?? h / 2),
          backgroundColor: String(props?.background ?? K.color("ui.CodeEntry.background", "rgba(255,255,255,0.06)")),
          borderWidth: Number(props?.borderWidth ?? K.num("ui.CodeEntry.borderWidth", 1)),
          borderColor: errored
            ? String(props?.errorColor ?? K.color("ui.CodeEntry.errorColor", "rgba(255,90,60,0.85)"))
            : String(props?.borderColor ?? K.color("ui.CodeEntry.borderColor", "rgba(255,255,255,0.10)")),
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: Number(props?.paddingLeft) || K.num("ui.CodeEntry.paddingLeft", 20),
          paddingRight: Number(props?.paddingRight ?? K.num("ui.CodeEntry.paddingRight", 5)),
        }}
      >
        <Text
          style={{
            flex: 1,
            color: String(props?.textColor ?? K.color("ui.CodeEntry.textColor", "#FFFFFF")),
            fontSize: Number(props?.fontSize) || K.num("ui.CodeEntry.fontSize", 17),
            letterSpacing: Number(props?.letterSpacing ?? K.num("ui.CodeEntry.letterSpacing", 6)),
            fontVariant: ["tabular-nums"],
          }}
        >
          {shown}
        </Text>

        {/* The badge. Resend until there is a full code, then the way on —
            so the pill always offers exactly one next move. */}
        <Pressable
          onPress={() => (complete ? flow.verify(flow.code) : flow.resend())}
          hitSlop={Number(props?.badgeHitSlop ?? K.num("ui.CodeEntry.badgeHitSlop", 8))}
          accessibilityRole="button"
          accessibilityLabel={complete
            ? String(props?.continueLabel ?? K.txt("ui.CodeEntry.continueLabel", "Continue"))
            : String(props?.resendLabel ?? K.txt("ui.CodeEntry.resendLabel", "Send the code again"))}
          style={{
            width: badge, height: badge, borderRadius: badge / 2,
            backgroundColor: complete
              ? String(props?.badgeReadyBackground ?? K.color("ui.CodeEntry.badgeReadyBackground", "#FFFFFF"))
              : String(props?.badgeBackground ?? K.color("ui.CodeEntry.badgeBackground", "rgba(255,255,255,0.1)")),
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{
            color: complete
              ? String(props?.badgeReadyColor ?? K.color("ui.CodeEntry.badgeReadyColor", "#000000"))
              : String(props?.badgeColor ?? K.color("ui.CodeEntry.badgeColor", "#FFFFFF")),
            fontSize: Number(props?.badgeFontSize ?? K.num("ui.CodeEntry.badgeFontSize", 16)),
            fontWeight: String(props?.badgeWeight ?? K.str("ui.CodeEntry.badgeWeight", "600")) as "600",
          }}>
            {complete
              ? String(props?.continueGlyph ?? K.txt("ui.CodeEntry.continueGlyph", "\u2192"))
              : String(props?.resendGlyph ?? K.txt("ui.CodeEntry.resendGlyph", "\u21bb"))}
          </Text>
        </Pressable>

        {/* Off-screen, not hidden: a display:none input cannot hold a caret.
            It carries the real value and the number pad. */}
        <TextInput
          ref={input}
          value={flow.code}
          onChangeText={flow.setCode}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={len}
          editable={flow.phase === "verify"}
          underlineColorAndroid="transparent"
          style={{ position: "absolute", opacity: 0, height: 1, width: 1, left: -9999 }}
        />
      </Pressable>
    </Animated.View>
  );
};

/**
 * The boxes version of the code step (CodeEntry, variant "boxes").
 *
 * Everything on it that is a word comes from the server, with {to} and {len}
 * filled in. The boxes are 60 high with a gap of 8; the one being filled has a
 * ring and a blinking caret, a filled one is white with an ink edge. Under
 * them, in order: one line for what is happening (waiting, got it, couldn't
 * send), a link to send it again (held while one is on its way, so a second
 * tap cannot orphan the first), and "Wrong number?" with a link that goes
 * back to the entry step. The code is verified the moment it is complete, as
 * it always was, so there is no button to wait on.
 */
function CodeBoxes({ flow, props, errored, caretOn, onFocusInput }: {
  flow: NonNullable<ReturnType<typeof useAuthFlow>>;
  props: Record<string, any>;
  errored: boolean;
  caretOn: boolean;
  onFocusInput: () => void;
}) {
  const len = flow.codeLength;
  const boxH = Number(props.boxHeight) || 60;
  const boxR = Number(props.boxRadius) || 14;
  const gap = props.boxGap !== undefined ? Number(props.boxGap) : 8;
  const ink = String(props.linkColor ?? "#1C1A17");
  const soft = String(props.textColor ?? "rgba(28,26,23,0.7)");
  const border = String(props.boxBorderColor ?? "rgba(28,26,23,0.13)");
  const bg = String(props.boxBackground ?? "#FCFBF8");
  const fillBg = String(props.boxFilledBackground ?? "#FFFFFF");
  const fillBorder = String(props.boxFilledBorderColor ?? "#1C1A17");
  const ring = String(props.boxActiveRing ?? "rgba(57,255,20,0.2)");
  const digitColor = String(props.digitColor ?? ink);
  const digitFont = props.digitFont ? String(props.digitFont) : undefined;
  const digitSize = Number(props.digitSize) || 28;
  const errColor = K.color("ui.CodeEntry.errorColor", "rgba(255,90,60,0.85)");
  const verifying = flow.phase === "verifying";
  const done = flow.code.length === len || verifying;
  const to = flow.active?.value ?? "";
  const email = flow.active?.type === "email";

  // "I sent a {len}-digit code to {to}." with the address in bold.
  const sentTo = typeof props.sentTo === "string" ? props.sentTo : "";
  const parts = sentTo.split(/(\{to\}|\{len\})/);

  const status = done ? props.okLabel : flow.sendFailed ? props.failLabel : props.waitLabel;

  return (
    <View>
      {sentTo ? (
        <Text style={{ color: soft, fontSize: 15, lineHeight: 21, marginBottom: 12 }}>
          {parts.map((part, i) =>
            part === "{to}" ? <Text key={i} style={{ fontWeight: "700", color: ink }}>{to}</Text>
              : part === "{len}" ? String(len)
              : part)}
        </Text>
      ) : null}

      <Pressable
        onPress={onFocusInput}
        accessibilityRole="button"
        accessibilityLabel={String(props.label ?? K.txt("ui.CodeEntry.label", "Enter the code we sent you"))}
        style={{ flexDirection: "row", gap, marginTop: 6, marginBottom: 12 }}
      >
        {Array.from({ length: len }).map((_, i) => {
          const digit = flow.code[i];
          const cur = !digit && i === flow.code.length && !verifying;
          return (
            <View key={i} style={{ flex: 1, minWidth: 0 }}>
              {cur ? (
                // The ring: a rounded rectangle a few points bigger, behind a
                // box that is opaque, so it shows as an edge round it.
                <View style={{ position: "absolute", left: -3, right: -3, top: -3, bottom: -3, borderRadius: boxR + 3, backgroundColor: ring }} />
              ) : null}
              <View
                style={{
                  height: boxH, borderRadius: boxR, borderWidth: 1.5,
                  borderColor: errored ? errColor : digit || cur ? fillBorder : border,
                  backgroundColor: digit ? fillBg : bg,
                  alignItems: "center", justifyContent: "center", flexDirection: "row",
                }}
              >
                {digit ? (
                  <Text style={{ color: digitColor, fontSize: digitSize, fontFamily: digitFont, includeFontPadding: false }}>{digit}</Text>
                ) : null}
                {cur && caretOn ? <View style={{ width: 2, height: digitSize, backgroundColor: digitColor }} /> : null}
              </View>
            </View>
          );
        })}
      </Pressable>

      {/* One line for what is happening, so nothing below it ever moves. */}
      <View accessibilityLiveRegion="polite" style={{ minHeight: 22, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}>
        {done ? (
          <Svg width={15} height={15} viewBox="0 0 24 24">
            <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={ink} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : null}
        <Text style={{ color: done ? ink : soft, fontSize: 14, fontWeight: "600", textAlign: "center" }}>{status ? String(status) : ""}</Text>
      </View>

      <View style={{ alignItems: "center", gap: 8, marginTop: 18 }}>
        {props.resendLabel ? (
          <Pressable
            onPress={flow.resend}
            // Not while one is already on its way: a second tap would orphan
            // the first attempt and start its backoff over.
            disabled={flow.sending}
            hitSlop={8}
            accessibilityRole="button"
            style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: flow.sending ? 0.4 : 1 }}
          >
            <Svg width={15} height={15} viewBox="0 0 24 24">
              <Path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2" stroke={soft} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text style={{ color: ink, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" }}>{String(props.resendLabel)}</Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Text style={{ color: soft, fontSize: 14, fontWeight: "500" }}>{String(email ? props.wrongEmailLabel ?? "" : props.wrongLabel ?? "")}</Text>
          {props.changeLabel ? (
            <Pressable onPress={flow.back} hitSlop={10} accessibilityRole="button">
              <Text style={{ color: ink, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" }}>{String(props.changeLabel)}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
