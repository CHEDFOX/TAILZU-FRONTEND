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
  Easing,
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

const WHITE = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.42)";

type Gender = "male" | "female" | "other";
const GENDERS: { key: Gender; label: string }[] = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "other", label: "Other" },
];

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

export default function ProfileGate({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [saving, setSaving] = useState(false);

  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getAuthName().then((n) => { if (n) setName((cur) => cur || n); }).catch(() => {});
    Animated.spring(appear, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
  }, [appear]);

  const canContinue = name.trim().length >= 1 && gender !== null;

  const pickGender = useCallback((g: Gender) => {
    Haptics.selectionAsync().catch(() => {});
    setGender(g);
  }, []);

  const onContinue = useCallback(async () => {
    if (!canContinue || saving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSaving(true);
    try {
      await callEndpoint("PUT", "/v1/profile", { full_name: name.trim(), gender });
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
        { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
        { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
      ],
    }),
    [appear],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)" }]} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.center}>
        <Animated.View style={[styles.card, cardStyle]}>
          <Text style={styles.hello}>Hello,</Text>

          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder="your name"
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
                <Pressable key={g.key} onPress={() => pickGender(g.key)} style={styles.genderItem}>
                  <View style={[styles.genderCircle, selected && styles.genderCircleOn]}>
                    <GenderGlyph type={g.key} color={selected ? "#000" : MUTED} />
                  </View>
                  <Text style={[styles.genderLabel, selected && { color: WHITE }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onContinue}
            disabled={!canContinue || saving}
            style={[styles.cta, { opacity: canContinue && !saving ? 1 : 0.4 }]}
          >
            <Text style={styles.ctaText}>{saving ? "…" : "Continue"}</Text>
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
    alignItems: "center",
  },
  hello: { color: WHITE, fontSize: 32, fontWeight: "700", fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "serif" }), marginBottom: 18 },
  nameInput: { width: "100%", textAlign: "center", color: WHITE, fontSize: 22, fontWeight: "300", paddingVertical: 6 },
  nameUnderline: { width: 160, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.25)", marginTop: 2, marginBottom: 34 },
  genderRow: { flexDirection: "row", justifyContent: "center", gap: 26, marginBottom: 38 },
  genderItem: { alignItems: "center", gap: 8 },
  genderCircle: {
    width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.03)",
  },
  genderCircleOn: { backgroundColor: WHITE, borderColor: WHITE },
  genderLabel: { color: MUTED, fontSize: 12, fontWeight: "400" },
  cta: { width: "100%", height: 54, borderRadius: 27, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#000", fontSize: 16, fontWeight: "700" },
});
