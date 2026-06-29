/**
 * AuthGate — a faithful port of Plutto's sign-in screen. Pure black, centered,
 * no titles/branding. Methods:
 *   • email / phone "pills" — swipe the badge → (or tap the white arrow) to send
 *   • Apple as a plain circular sign-in button below a hairline divider
 * → Plutto send animation (envelope + sonar) → round code boxes that auto-verify.
 *
 * Phone is OFF by default and turned on FROM THE BACKEND — bootstrap flag
 * auth.enablePhone (needs an SMS provider in Supabase); no app update required.
 * Google is intentionally off for now (the scaffold lives in authConfig); it
 * needs a native iOS URL scheme, so it can't be flipped on via OTA.
 *
 * Back from the code step: top-left arrow OR swipe-right-from-the-left-edge
 * (the app-wide edge-swipe capability, src/sdui/gestures) — swipe, haptic, back.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { BlurView } from "expo-blur";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Localization from "expo-localization";
import * as Haptics from "expo-haptics";
import { supabaseAuth } from "./supabaseClient";
import EmailSendAnimation from "./EmailSendAnimation";
import { useEdgeSwipeBack } from "../sdui/gestures";
import { fetchAuthConfig } from "../sdui/client";
import { AUTH_METHODS, COUNTRIES, pickCountry, Country } from "./authConfig";

const { width: SW, height: SH } = Dimensions.get("window");
const PILL_W = Math.min(320, SW - 56);
const PILL_H = 56;
const PILL_PAD = 5;
const BADGE = PILL_H - PILL_PAD * 2; // 46
const SOCIAL_SIZE = 52;
const SOCIAL_GAP = 16;
const SHAKE = 8;
const MAX_DRAG = PILL_W - PILL_PAD * 2 - BADGE;
const DRAG_THRESHOLD = MAX_DRAG * 0.6;
const EMAIL_RX = /^\S+@\S+\.\S+$/;
const CODE_LEN = 6;
const WHITE = "#FFFFFF";
const VOID = "#000000";
const ABYSS = "#050508";

interface Field { id: string; type: "email" | "phone" }
interface ActiveMethod { type: "email" | "phone"; value: string }

// ── Glyphs (Plutto's exact paths) ────────────────────────────────────────────
const Envelope = ({ c = WHITE }: { c?: string }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24">
    <Rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke={c} strokeWidth="1.6" fill="none" />
    <Path d="M3.5 7 L12 13 L20.5 7" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const PhoneMark = ({ c = WHITE }: { c?: string }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24">
    <Path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.7 21 3 13.3 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z" fill={c} />
  </Svg>
);
const Arrow = ({ c = "#000" }: { c?: string }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M5 12h14M13 6l6 6-6 6" stroke={c} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const Chevron = ({ c = "rgba(255,255,255,0.5)" }: { c?: string }) => (
  <Svg width={12} height={12} viewBox="0 0 24 24">
    <Path d="M6 9l6 6 6-6" stroke={c} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const AppleMark = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path fill={WHITE} d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.46 1.58-1.51 3.14-.9 1.36-1.84 2.71-3.32 2.71-1.48 0-1.86-.88-3.56-.88-1.66 0-2.25.91-3.6.91-1.36 0-2.3-1.27-3.22-2.61-1.87-2.61-3.34-7.53-1.42-10.86.95-1.66 2.65-2.7 4.5-2.73 1.4-.03 2.72.95 3.58.95.85 0 2.45-1.18 4.12-1.01.7.03 2.67.28 3.93 2.13-.1.06-2.35 1.37-2.33 4.07.03 3.22 2.83 4.29 2.86 4.31z" />
  </Svg>
);
const Back = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M15 6l-6 6 6 6" stroke="rgba(255,255,255,0.55)" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const Resend = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ── Country picker (phone only) ──────────────────────────────────────────────
function CountryPickerModal({
  visible, current, onClose, onSelect,
}: { visible: boolean; current: Country; onClose: () => void; onSelect: (c: Country) => void }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const data = term
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(term) || c.dial.includes(term))
    : COUNTRIES;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <TextInput
            style={s.modalSearch}
            value={q}
            onChangeText={setQ}
            placeholder="Search"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <FlatList
            data={data}
            keyExtractor={(c) => c.iso}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            renderItem={({ item }) => {
              const sel = current.iso === item.iso;
              return (
                <TouchableOpacity style={s.cRow} activeOpacity={0.6} onPress={() => { onSelect(item); onClose(); }}>
                  <Text style={s.cFlag}>{item.flag}</Text>
                  <Text style={[s.cName, sel ? { color: "#FFFFFF", fontWeight: "600" } : null]} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.cDial}>{item.dial}</Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

// ── One method pill (email or phone): swipe the badge → or tap the arrow ──────
function MethodPill({ field, onSubmit, hintDelay }: { field: Field; onSubmit: (f: Field, value: string) => void; hintDelay: number }) {
  const isPhone = field.type === "phone";
  const [value, setValue] = useState("");
  const region = Localization.getLocales?.()?.[0]?.regionCode || "US";
  const [country, setCountry] = useState<Country>(() => pickCountry(region));
  const [pickerOpen, setPickerOpen] = useState(false);

  const digits = value.replace(/\D/g, "");
  const valid = isPhone ? digits.length >= 6 && digits.length <= 14 : EMAIL_RX.test(value.trim());
  const submitValue = isPhone ? `${country.dial}${digits}` : value.trim();

  const validRef = useRef(valid);
  const valRef = useRef(submitValue);
  const crossed = useRef(false);
  useEffect(() => { validRef.current = valid; }, [valid]);
  useEffect(() => { valRef.current = submitValue; }, [submitValue]);

  const envX = useRef(new Animated.Value(0)).current;
  const arrowAppear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(arrowAppear, { toValue: valid ? 1 : 0, duration: 240, useNativeDriver: false }).start();
  }, [valid, arrowAppear]);

  // gentle "swipe me" hint
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.sequence([
        Animated.spring(envX, { toValue: 20, friction: 5, tension: 90, useNativeDriver: false }),
        Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }),
      ]).start();
    }, hintDelay);
    return () => clearTimeout(t);
  }, [envX, hintDelay]);

  const commit = useCallback(() => {
    Animated.timing(envX, { toValue: MAX_DRAG, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: false })
      .start(() => { onSubmit(field, valRef.current); envX.setValue(0); });
  }, [envX, field, onSubmit]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); crossed.current = false; },
      onPanResponderMove: (_, g) => {
        const x = Math.max(0, Math.min(MAX_DRAG, g.dx));
        envX.setValue(x);
        if (!crossed.current && x >= DRAG_THRESHOLD) { crossed.current = true; Haptics.selectionAsync().catch(() => {}); }
        else if (crossed.current && x < DRAG_THRESHOLD) crossed.current = false;
      },
      onPanResponderRelease: (_, g) => {
        const x = Math.max(0, Math.min(MAX_DRAG, g.dx));
        if (x >= DRAG_THRESHOLD && validRef.current) commit();
        else {
          if (x >= DRAG_THRESHOLD) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }).start(),
    }),
  ).current;

  const overlapFade = envX.interpolate({ inputRange: [MAX_DRAG * 0.55, MAX_DRAG], outputRange: [1, 0], extrapolate: "clamp" });
  const arrowOpacity = Animated.multiply(arrowAppear, overlapFade);
  const inputOpacity = envX.interpolate({ inputRange: [0, MAX_DRAG], outputRange: [1, 0.12], extrapolate: "clamp" });

  return (
    <View style={s.pillWrap}>
      <BlurView intensity={24} tint="light" style={s.pill} />
      <View style={s.pillBorder} pointerEvents="none" />

      <Animated.View style={[s.contentRow, { opacity: inputOpacity }]} pointerEvents="box-none">
        {isPhone && (
          <TouchableOpacity
            style={s.countryChip}
            activeOpacity={0.7}
            onPress={() => { Keyboard.dismiss(); Haptics.selectionAsync().catch(() => {}); setPickerOpen(true); }}
          >
            <Text style={s.flag}>{country.flag}</Text>
            <Text style={s.dial}>{country.dial}</Text>
            <Chevron />
          </TouchableOpacity>
        )}
        <TextInput
          style={s.input}
          value={value}
          onChangeText={setValue}
          placeholder={isPhone ? "Phone" : "Email"}
          placeholderTextColor="rgba(255,255,255,0.32)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={isPhone ? "phone-pad" : "email-address"}
          textContentType={isPhone ? "telephoneNumber" : "emailAddress"}
          returnKeyType="go"
          onSubmitEditing={() => validRef.current && commit()}
        />
      </Animated.View>

      {/* badge — swipe me (envelope / phone) */}
      <Animated.View style={[s.envWrap, { transform: [{ translateX: envX }] }]} {...pan.panHandlers}>
        <View style={s.envCircle}>{isPhone ? <PhoneMark /> : <Envelope />}</View>
      </Animated.View>

      {/* white arrow badge — tap to send (appears when valid) */}
      <Animated.View style={[s.arrowWrap, { opacity: arrowOpacity }]} pointerEvents={valid ? "auto" : "none"}>
        <TouchableOpacity style={s.arrowCircle} activeOpacity={0.85} onPress={() => validRef.current && commit()}>
          <Arrow />
        </TouchableOpacity>
      </Animated.View>

      {isPhone && (
        <CountryPickerModal
          visible={pickerOpen}
          current={country}
          onClose={() => setPickerOpen(false)}
          onSelect={(c) => { setCountry(c); Haptics.selectionAsync().catch(() => {}); }}
        />
      )}
    </View>
  );
}

// tiny spinner for the verifying moment
function MicroLoader() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })).start();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.7)", transform: [{ rotate }] }} />
  );
}

export default function AuthGateScreen({ onAuthed }: { onAuthed: () => void }) {
  const [phase, setPhase] = useState<"entry" | "sending" | "verify" | "verifying">("entry");
  const [active, setActive] = useState<ActiveMethod | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const arrival = useRef(new Animated.Value(0)).current;
  const entryFade = useRef(new Animated.Value(1)).current;
  const verifyFade = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const codeRef = useRef<TextInput>(null);
  const seq = useRef(0);

  // Phone sign-in is OFF by default and turned on FROM THE BACKEND (bootstrap
  // flag auth.enablePhone) — no app update needed once an SMS provider is live.
  // The local AUTH_METHODS.enablePhone is just the offline fallback default.
  const [phoneEnabled, setPhoneEnabled] = useState(AUTH_METHODS.enablePhone);
  const fields: Field[] = [
    { id: "email", type: "email" },
    ...(phoneEnabled ? [{ id: "phone", type: "phone" as const }] : []),
  ];

  useEffect(() => {
    Animated.timing(arrival, { toValue: 1, duration: 900, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true }).start();
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    // Ask the backend whether phone sign-in is enabled (resilient; stays off on failure).
    let alive = true;
    fetchAuthConfig().then((cfg) => { if (alive && cfg) setPhoneEnabled(cfg.enablePhone); }).catch(() => {});
    return () => { alive = false; };
  }, [arrival]);

  useEffect(() => {
    if (phase === "verify" || phase === "verifying") {
      Animated.parallel([
        Animated.timing(entryFade, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(verifyFade, { toValue: 1, duration: 320, delay: 80, useNativeDriver: true }),
      ]).start(() => codeRef.current?.focus?.());
    } else if (phase === "entry") {
      Animated.parallel([
        Animated.timing(verifyFade, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(entryFade, { toValue: 1, duration: 240, delay: 60, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(entryFade, { toValue: 0, duration: 280, useNativeDriver: true }).start();
    }
  }, [phase, entryFade, verifyFade]);

  const flashError = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setCodeError(true);
    Animated.sequence([
      Animated.timing(shake, { toValue: SHAKE, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -SHAKE, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: SHAKE / 2, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start(() => setTimeout(() => setCodeError(false), 400));
  }, [shake]);

  const send = useCallback(async (type: "email" | "phone", value: string) => {
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setActive({ type, value });
    const my = ++seq.current;
    setPhase("sending");
    const animMin = new Promise((r) => setTimeout(r, 1600));
    const apiCall = type === "phone" ? supabaseAuth.sendPhoneCode(value) : supabaseAuth.sendEmailCode(value);
    const [, res]: any = await Promise.all([animMin, apiCall]);
    if (my !== seq.current) return;
    if (res?.error) { setPhase("entry"); flashError(); return; }
    setCode(""); setPhase("verify");
  }, [flashError]);

  const handleMethodSubmit = useCallback((field: Field, value: string) => send(field.type, value), [send]);

  const verify = useCallback(async (token: string) => {
    if (!active) return;
    Keyboard.dismiss();
    const my = ++seq.current;
    setPhase("verifying");
    const { error } = active.type === "phone"
      ? await supabaseAuth.verifyPhoneCode(active.value, token)
      : await supabaseAuth.verifyEmailCode(active.value, token);
    if (my !== seq.current) return;
    if (error) { setPhase("verify"); setCode(""); flashError(); setTimeout(() => codeRef.current?.focus?.(), 60); return; }
    onAuthed();
  }, [active, flashError, onAuthed]);

  useEffect(() => {
    if (phase === "verify" && code.length === CODE_LEN && /^\d+$/.test(code)) verify(code);
  }, [code, phase, verify]);

  const goBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Keyboard.dismiss();
    seq.current++;
    verifyFade.setValue(0); entryFade.setValue(1);
    setCode(""); setCodeError(false); setActive(null); setPhase("entry");
  }, [entryFade, verifyFade]);

  const resend = useCallback(() => { if (active) send(active.type, active.value); }, [active, send]);

  // App-wide edge-swipe-back (swipe → haptic → back). No on-screen hint.
  const { edgeZone } = useEdgeSwipeBack(goBack);

  const onApple = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const raw = Math.random().toString(36).slice(2);
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error("no identity token");
      const { error } = await supabaseAuth.signInWithApple(cred.identityToken, raw);
      if (error) { flashError(); return; }
      onAuthed();
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") flashError();
    }
  }, [flashError, onAuthed]);

  const translateY = arrival.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const onCode = phase === "verify" || phase === "verifying";

  return (
    <Animated.View style={[s.container, { transform: [{ translateX: shake }] }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.kav}>
        <Animated.View style={[s.stack, { opacity: arrival, transform: [{ translateY }] }]}>
          {phase === "entry" && (
            <Animated.View style={[s.block, { opacity: entryFade }]}>
              {fields.map((f, i) => (
                <View key={f.id} style={{ marginTop: i === 0 ? 0 : 18 }}>
                  <MethodPill field={f} onSubmit={handleMethodSubmit} hintDelay={1100 + i * 160} />
                </View>
              ))}
              <View style={s.divider} />
              <View style={s.socialRow}>
                {appleAvailable && (
                  <TouchableOpacity style={s.social} activeOpacity={0.7} onPress={onApple} accessibilityRole="button" accessibilityLabel="Sign in with Apple">
                    <AppleMark />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          )}

          {phase === "sending" && <EmailSendAnimation />}

          {onCode && (
            <Animated.View style={[s.block, { opacity: verifyFade }]}>
              <Pressable style={s.codeRow} onPress={() => codeRef.current?.focus?.()}>
                {Array.from({ length: CODE_LEN }).map((_, i) => (
                  <View key={i} style={[s.codeBox, code[i] ? s.codeBoxFilled : null, codeError ? s.codeBoxError : null]}>
                    {code[i] ? <Text style={s.codeDigit}>{code[i]}</Text> : null}
                  </View>
                ))}
              </Pressable>
              <TextInput
                ref={codeRef}
                style={s.hiddenInput}
                value={code}
                onChangeText={(t) => { setCode(t.replace(/\D/g, "").slice(0, CODE_LEN)); if (codeError) setCodeError(false); }}
                keyboardType="number-pad"
                maxLength={CODE_LEN}
                textContentType="oneTimeCode"
                autoFocus
                editable={phase === "verify"}
              />
              <View style={s.verifyStatus}>{phase === "verifying" ? <MicroLoader /> : null}</View>
              <View style={s.divider} />
              {/* code step: resend only — back is the top-left arrow / edge-swipe */}
              <View style={s.verifyActions}>
                <TouchableOpacity onPress={resend} style={s.social} activeOpacity={0.6}><Resend /></TouchableOpacity>
              </View>
            </Animated.View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>

      {/* top-left back arrow (code step) */}
      {onCode && (
        <TouchableOpacity onPress={goBack} style={s.backTopLeft} activeOpacity={0.6} hitSlop={12}>
          <Back />
        </TouchableOpacity>
      )}

      {/* edge-swipe-back zone — only on the code step */}
      {onCode ? edgeZone : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: VOID },
  kav: { flex: 1 },
  backTopLeft: { position: "absolute", top: 56, left: 18, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  stack: { flex: 1, alignItems: "center", justifyContent: "center" },
  block: { alignItems: "center", width: "100%" },

  pillWrap: { width: PILL_W, height: PILL_H, borderRadius: PILL_H / 2, justifyContent: "center" },
  pill: { ...StyleSheet.absoluteFillObject, borderRadius: PILL_H / 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)" },
  pillBorder: { ...StyleSheet.absoluteFillObject, borderRadius: PILL_H / 2, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.14)" },
  contentRow: { position: "absolute", left: PILL_PAD + BADGE + 10, right: PILL_PAD + BADGE + 10, top: 0, bottom: 0, flexDirection: "row", alignItems: "center" },
  countryChip: { flexDirection: "row", alignItems: "center", paddingRight: 10, marginRight: 10, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.16)" },
  flag: { fontSize: 18, marginRight: 5 },
  dial: { fontSize: 15, fontWeight: "300", color: WHITE, marginRight: 4 },
  input: { flex: 1, fontSize: 15, fontWeight: "300", color: WHITE, letterSpacing: 0.3, padding: 0 },

  envWrap: { position: "absolute", left: PILL_PAD, top: PILL_PAD, width: BADGE, height: BADGE, zIndex: 5 },
  envCircle: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  arrowWrap: { position: "absolute", right: PILL_PAD, top: PILL_PAD, width: BADGE, height: BADGE },
  arrowCircle: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" },

  divider: { width: PILL_W * 0.66, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.15)", marginTop: 48, marginBottom: 48 },

  socialRow: { flexDirection: "row", gap: SOCIAL_GAP },
  social: { width: SOCIAL_SIZE, height: SOCIAL_SIZE, borderRadius: SOCIAL_SIZE / 2, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center", justifyContent: "center" },
  verifyActions: { flexDirection: "row", gap: SOCIAL_GAP },

  codeRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10 },
  codeBox: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(255,255,255,0.02)", alignItems: "center", justifyContent: "center" },
  codeBoxFilled: { borderColor: "rgba(255,255,255,0.85)", backgroundColor: "rgba(255,255,255,0.05)" },
  codeBoxError: { borderColor: "rgba(255,90,60,0.85)" },
  codeDigit: { fontSize: 17, fontWeight: "300", color: WHITE },
  hiddenInput: { position: "absolute", opacity: 0, width: 1, height: 1 },
  verifyStatus: { height: 28, marginTop: 24, alignItems: "center", justifyContent: "center" },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  modalSheet: { height: SH * 0.72, backgroundColor: ABYSS, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 18 },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 },
  modalSearch: { height: 44, borderRadius: 12, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.06)", color: WHITE, fontSize: 15, marginBottom: 8 },
  cRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  cFlag: { fontSize: 22, marginRight: 12 },
  cName: { flex: 1, fontSize: 15, fontWeight: "300", color: WHITE },
  cDial: { fontSize: 14, color: "rgba(255,255,255,0.5)" },
});
