/**
 * ProfileGate — the post-onboarding name + gender card (Plutto-style).
 *
 * Appears over Home (which is blurred behind it) the first time the user reaches
 * the app. "Hello," + an editable name (pre-filled from the auth provider) and a
 * row of gender icons beneath. Both are required to continue — the button stays
 * disabled until a name is entered and a gender is picked. On continue it saves
 * to the profile and dismisses (shown once).
 *
 * Black + white, spring physics, haptic-tuned.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import Svg, { Circle, Line, Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { getAuthName, setProfileDone } from "../storage";
import { callEndpoint } from "../sdui/client";
import { typeRole } from "../sdui/components";
import type { ThemeTokens } from "../sdui/types";
import { color as knobColor, list, num, str, txt } from "../sdui/knobs";

// The card's words, colours, choices and timings are the server's (profile.*).
// Read at render, so the bootstrap in hand decides them.

/** The glyphs this card can draw. A gender the server adds beyond these draws
 *  the neutral mark, so a new option never renders as nothing. */
type Gender = string;

function GenderGlyph({ type, color, size = 28 }: { type: Gender; color: string; size?: number }) {
  const sw = 1.7;
  if (type === "male") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="10" cy="14" r="6" stroke={color} strokeWidth={sw} fill="none" />
        <Line x1="14.2" y1="9.8" x2="20" y2="4" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Path d="M15 4 H20 V9" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  if (type === "female") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="9" r="6" stroke={color} strokeWidth={sw} fill="none" />
        <Line x1="12" y1="15" x2="12" y2="22" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <Line x1="8.5" y1="19" x2="15.5" y2="19" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="6.5" stroke={color} strokeWidth={sw} fill="none" />
      <Circle cx="12" cy="12" r="2.2" fill={color} />
    </Svg>
  );
}

export default function ProfileGate({ onDone, mediaUri, theme }: {
  onDone: () => void;
  mediaUri?: string;
  /** Bootstrap theme — the card's type comes from its scale. */
  theme?: ThemeTokens | null;
}) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [saving, setSaving] = useState(false);

  const WHITE = knobColor("profile.color.ink", "#FFFFFF");
  const MUTED = knobColor("profile.color.muted", "rgba(255,255,255,0.42)");
  const ORANGE = knobColor("profile.color.accent", "#E8A23C"); // brand (icon background) color
  const GENDERS = list<{ key: Gender; label: string }>("profile.genders", [
    { "key": "male", "label": "Male" },
    { "key": "female", "label": "Female" },
    { "key": "other", "label": "Other" }
  ]).filter((g) => g && typeof g.key === "string");

  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getAuthName().then((n) => { if (n) setName((cur) => cur || n); }).catch(() => {});
    Animated.spring(appear, {
      toValue: 1, friction: num("profile.anim.friction", 7), tension: num("profile.anim.tension", 60), useNativeDriver: true,
    }).start();
  }, [appear]);

  const canContinue = name.trim().length >= num("profile.nameMinLength", 1) && gender !== null;

  const pickGender = useCallback((g: Gender) => {
    Haptics.selectionAsync().catch(() => {});
    setGender(g);
  }, []);

  const onContinue = useCallback(async () => {
    if (!canContinue || saving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSaving(true);
    try {
      await callEndpoint("PUT", str("net.profilePath", "/v1/profile"), { full_name: name.trim(), gender });
    } catch {
      /* best-effort — still let the user in */
    }
    await setProfileDone();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onDone();
  }, [canContinue, saving, name, gender, onDone]);

  const cardStyle = useMemo(
    () => ({
      opacity: appear,
      transform: [
        { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [num("profile.anim.fromScale", 0.92), 1] }) },
        { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [num("profile.anim.fromY", 16), 0] }) },
      ],
    }),
    [appear],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView intensity={num("profile.blur", 32)} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: knobColor("profile.color.scrim", "rgba(0,0,0,0.45)") }]} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.center}>
        <Animated.View style={[styles.card, {
          backgroundColor: knobColor("profile.color.card", "rgba(14,14,18,0.92)"),
          borderRadius: num("profile.cardRadius", 26),
        }, cardStyle]}>
          {/* Backend-supplied background media (optional) + a scrim so the card
              content stays readable over it. */}
          {mediaUri ? (
            <>
              <Image source={{ uri: mediaUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: knobColor("profile.color.mediaScrim", "rgba(8,8,12,0.55)") }]} />
            </>
          ) : null}

          <Text style={[theme ? typeRole(theme, "profileHello", styles.hello) : styles.hello, { color: ORANGE }]}>{txt("profile.hello", "Hello,")}</Text>

          <TextInput
            style={[styles.nameBox, theme ? typeRole(theme, "profileName", styles.nameInput) : styles.nameInput, { color: WHITE }]}
            value={name}
            onChangeText={setName}
            placeholder={txt("profile.namePlaceholder", "Your Name")}
            placeholderTextColor={MUTED}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            textContentType="name"
          />
          <View style={styles.nameUnderline} />

          <View style={styles.genderRow}>
            {GENDERS.map((g) => {
              const selected = gender === g.key;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => pickGender(g.key)}
                  style={styles.genderItem}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={g.label}
                >
                  <View style={[styles.genderCircle, selected && { backgroundColor: WHITE, borderColor: WHITE }]}>
                    <GenderGlyph type={g.key} color={selected ? knobColor("profile.color.selectedGlyph", "#000000") : MUTED} size={num("profile.glyphSize", 28)} />
                  </View>
                  <Text style={[theme ? typeRole(theme, "profileLabel", styles.genderLabel) : styles.genderLabel, { color: selected ? WHITE : MUTED }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onContinue}
            disabled={!canContinue || saving}
            style={[styles.cta, { backgroundColor: WHITE, opacity: canContinue && !saving ? 1 : num("profile.ctaDisabledOpacity", 0.4) }]}
            accessibilityRole="button"
          >
            <Text style={[theme ? typeRole(theme, "profileAction", styles.ctaText) : styles.ctaText, { color: knobColor("profile.color.ctaText", "#000000") }]}>
              {saving ? txt("profile.saving", "…") : txt("profile.cta", "Go")}
            </Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  card: {
    width: "100%", maxWidth: 360, borderRadius: 26, paddingVertical: 36, paddingHorizontal: 28,
    backgroundColor: "rgba(14,14,18,0.92)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center", overflow: "hidden",
  },
  // Pre-bootstrap copies of the roles. The theme's scale replaces them the
  // moment it has landed — which, for this card, is always.
  hello: { fontSize: 32, fontWeight: "700", fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "serif" }), marginBottom: 18 },
  nameBox: { width: "100%", paddingVertical: 6 },
  nameInput: { textAlign: "center", fontSize: 22, fontWeight: "300" },
  nameUnderline: { width: 160, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.25)", marginTop: 2, marginBottom: 34 },
  genderRow: { flexDirection: "row", justifyContent: "center", gap: 26, marginBottom: 38 },
  genderItem: { alignItems: "center", gap: 8 },
  genderCircle: {
    width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.03)",
  },
  genderLabel: { fontSize: 12, fontWeight: "400" },
  cta: { alignSelf: "center", minWidth: 110, height: 50, borderRadius: 25, paddingHorizontal: 36, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
