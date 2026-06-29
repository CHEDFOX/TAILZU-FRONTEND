/**
 * LanguageSelectScreen — the first screen after auth. A 1:1 port of Plutto's
 * language picker: a big "Hello" greeting that rotates through languages in the
 * centre, then (after a beat) glides up to the top while a grid of language
 * pills fades in. Tap a pill → medium haptic → onSelect(code).
 *
 * Pure black, hairline pills, light-weight type — exactly like Plutto. The
 * chosen language is the app/keyboard's main language (drives STT routing).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Localization from "expo-localization";
import * as Haptics from "expo-haptics";

const { height: SH } = Dimensions.get("window");

const ARRIVAL_HOLD_MS = 2400;   // greeting sits centred…
const ARRIVAL_MOVE_MS = 1100;   // …then glides up
const ROTATE_INTERVAL_MS = 2400;
const ROTATE_FADE_MS = 280;

const GREETING_CENTER_Y = SH * 0.4;
const GREETING_TOP_Y = SH * 0.1;
const LIST_TOP = SH * 0.36;
const LIST_BOTTOM = SH * 0.06;

const WHITE = "#FFFFFF";
const VOID = "#000000";

export interface Language {
  code: string;
  name: string;     // endonym, shown on the pill
  greeting: string; // "hello" in that language, shown rotating
  regions?: string[];
}

/** Supported languages with native names + greetings (drives the rotation). */
const LANGUAGES: Language[] = [
  { code: "en", name: "English", greeting: "Hello", regions: ["US", "GB", "CA", "AU", "IN"] },
  { code: "hi", name: "हिन्दी", greeting: "नमस्ते", regions: ["IN"] },
  { code: "es", name: "Español", greeting: "Hola", regions: ["ES", "MX", "AR"] },
  { code: "fr", name: "Français", greeting: "Bonjour", regions: ["FR", "CA"] },
  { code: "ar", name: "العربية", greeting: "مرحبا", regions: ["AE", "SA", "EG"] },
  { code: "pt", name: "Português", greeting: "Olá", regions: ["PT", "BR"] },
  { code: "de", name: "Deutsch", greeting: "Hallo", regions: ["DE"] },
  { code: "it", name: "Italiano", greeting: "Ciao", regions: ["IT"] },
  { code: "ru", name: "Русский", greeting: "Привет", regions: ["RU"] },
  { code: "ja", name: "日本語", greeting: "こんにちは", regions: ["JP"] },
  { code: "ko", name: "한국어", greeting: "안녕하세요", regions: ["KR"] },
  { code: "zh", name: "中文", greeting: "你好", regions: ["CN"] },
  { code: "bn", name: "বাংলা", greeting: "নমস্কার", regions: ["BD", "IN"] },
  { code: "ta", name: "தமிழ்", greeting: "வணக்கம்", regions: ["IN", "LK"] },
  { code: "te", name: "తెలుగు", greeting: "నమస్కారం", regions: ["IN"] },
  { code: "mr", name: "मराठी", greeting: "नमस्कार", regions: ["IN"] },
  { code: "gu", name: "ગુજરાતી", greeting: "નમસ્તે", regions: ["IN"] },
  { code: "pa", name: "ਪੰਜਾਬੀ", greeting: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", regions: ["IN"] },
  { code: "ur", name: "اردو", greeting: "السلام علیکم", regions: ["PK", "IN"] },
  { code: "tr", name: "Türkçe", greeting: "Merhaba", regions: ["TR"] },
  { code: "id", name: "Indonesia", greeting: "Halo", regions: ["ID"] },
  { code: "vi", name: "Tiếng Việt", greeting: "Xin chào", regions: ["VN"] },
  { code: "th", name: "ไทย", greeting: "สวัสดี", regions: ["TH"] },
  { code: "nl", name: "Nederlands", greeting: "Hallo", regions: ["NL"] },
];

/** Device language first, then same-region cluster, then a shuffled remainder. */
function orderLanguages(deviceLang: string, deviceRegion: string): Language[] {
  const matches: Language[] = [];
  const cluster: Language[] = [];
  const rest: Language[] = [];
  LANGUAGES.forEach((l) => {
    if (l.code === deviceLang) matches.push(l);
    else if (deviceRegion && l.regions?.includes(deviceRegion)) cluster.push(l);
    else rest.push(l);
  });
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...matches, ...cluster, ...rest];
}

export default function LanguageSelectScreen({ onSelect }: { onSelect: (code: string) => void }) {
  const [arrivalDone, setArrivalDone] = useState(false);
  const [index, setIndex] = useState(0);

  const deviceLang = useMemo(() => Localization.getLocales?.()?.[0]?.languageCode || "en", []);
  const deviceRegion = useMemo(() => Localization.getLocales?.()?.[0]?.regionCode || "", []);
  const langs = useMemo(() => orderLanguages(deviceLang, deviceRegion), [deviceLang, deviceRegion]);

  const arrival = useRef(new Animated.Value(0)).current;
  const greetingFade = useRef(new Animated.Value(1)).current;

  // Hold centred, then glide the greeting up and reveal the grid.
  useEffect(() => {
    if (arrivalDone) return;
    const t = setTimeout(() => {
      Animated.timing(arrival, {
        toValue: 1,
        duration: ARRIVAL_MOVE_MS,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      }).start(() => setArrivalDone(true));
    }, ARRIVAL_HOLD_MS);
    return () => clearTimeout(t);
  }, [arrival, arrivalDone]);

  // Fade the new greeting in whenever the index changes.
  useEffect(() => {
    Animated.timing(greetingFade, { toValue: 1, duration: ROTATE_FADE_MS, useNativeDriver: true }).start();
  }, [index, greetingFade]);

  // Rotate greetings on a timer (fade out → advance → fade in).
  useEffect(() => {
    if (langs.length < 2) return;
    const iv = setInterval(() => {
      Animated.timing(greetingFade, { toValue: 0, duration: ROTATE_FADE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setIndex((p) => (p + 1) % langs.length);
      });
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [langs.length, greetingFade]);

  const select = useCallback((code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onSelect(code);
  }, [onSelect]);

  if (!langs.length) return <View style={s.container} />;

  const greetingTranslateY = arrival.interpolate({ inputRange: [0, 1], outputRange: [0, GREETING_TOP_Y - GREETING_CENTER_Y] });
  const listOpacity = arrival.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

  return (
    <View style={s.container}>
      <Animated.Text
        style={[s.greeting, { top: GREETING_CENTER_Y, opacity: greetingFade, transform: [{ translateY: greetingTranslateY }] }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {langs[index]?.greeting || ""}
      </Animated.Text>

      <Animated.View style={[s.listContainer, { opacity: listOpacity }]} pointerEvents={arrivalDone ? "auto" : "none"}>
        <ScrollView contentContainerStyle={s.listGrid} showsVerticalScrollIndicator={false}>
          {langs.map((l) => (
            <TouchableOpacity key={l.code} style={s.langBox} activeOpacity={0.7} onPress={() => select(l.code)}>
              <Text style={s.langText} numberOfLines={1}>{l.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: VOID },
  greeting: {
    position: "absolute", left: 0, right: 0,
    fontSize: 52, fontWeight: "300", color: WHITE, textAlign: "center", letterSpacing: 0,
    paddingHorizontal: 24,
  },
  listContainer: { position: "absolute", top: LIST_TOP, bottom: LIST_BOTTOM, left: 18, right: 18 },
  listGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, paddingBottom: 18 },
  langBox: {
    width: 105, height: 52, borderRadius: 26,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.12)",
    justifyContent: "center", alignItems: "center", margin: 8,
  },
  langText: { fontSize: 15, fontWeight: "300", color: WHITE, letterSpacing: 0.5 },
});
