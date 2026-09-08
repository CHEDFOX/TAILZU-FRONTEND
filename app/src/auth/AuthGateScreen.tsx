/**
 * AuthGate — a faithful port of Plutto's sign-in screen. Pure black, centered,
 * no titles/branding. Methods:
 *   • email / phone "pills" — swipe the badge → (or tap the white arrow) to send
 *   • Apple as a plain circular sign-in button below a hairline divider
 * → Plutto send animation (envelope + sonar) → round code boxes that auto-verify.
 *
 * Phone is OFF by default and turned on FROM THE BACKEND — bootstrap flag
 * auth.enablePhone (needs an SMS provider in Supabase); no app update required.
 * Google is live (client IDs in authConfig, reversed-client-id URL scheme in
 * app.config.ts) — native-build only, it can't be flipped on via OTA.
 *
 * Back from the code step: top-left arrow OR swipe-right-from-the-left-edge
 * (the app-wide edge-swipe capability, src/sdui/gestures) — swipe, haptic, back.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { BlurView } from "expo-blur";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Localization from "expo-localization";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { supabaseAuth } from "./supabaseClient";
import { CaptchaHost, solveCaptcha } from "./captcha";
import { AuthFlowProvider, type AuthFlow } from "./AuthFlowContext";
import { RiseView } from "../sdui/Rise";
import { RenderNode } from "../sdui/Renderer";
import { ThemeContext } from "../sdui/components";
import { useAuthSduiCtx, missingComponents } from "../sdui/authRender";
import type { Node, ThemeTokens } from "../sdui/types";
import EmailSendAnimation from "./EmailSendAnimation";
import { MediaPlayer } from "../media/MediaPlayer";
import { useEdgeSwipeBack } from "../sdui/gestures";
import { callEndpoint, fetchAuthConfig, type AuthBackground } from "../sdui/client";
import { setAuthName } from "../storage";
import { AUTH_METHODS, COUNTRIES, pickCountry, Country, GOOGLE_OAUTH, isGoogleConfigured } from "./authConfig";

// Lets the OAuth popup hand the redirect back to the JS auth-session listener
// when the browser closes. Safe no-op when there's no pending session.
WebBrowser.maybeCompleteAuthSession();

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
// RN 0.85 removed StyleSheet.absoluteFillObject — spreading it yields {} and
// the pill layers collapse to a zero-height centered hairline. Spell it out.
const FILL = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } as const;

export interface Field { id: string; type: "email" | "phone" }
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
// Google "G" in its four brand colors (official multicolor mark).
const GoogleMark = () => (
  <Svg width={20} height={20} viewBox="0 0 48 48">
    <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
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

/**
 * The uploaded backdrop. A still or a clip, whichever was uploaded.
 *
 * MediaPlayer rather than a hand-rolled branch: it already decides image vs
 * video from contentType first and the extension second, which is the check
 * that kept the intro black for a week when it was done the other way round.
 * Reusing it means this screen cannot reacquire that bug independently.
 *
 * Silent, looping, and never interactive. It fails to NOTHING rather than to an
 * error box — this is the sign-in screen, so a backdrop that cannot load must
 * cost someone a plain background, never the ability to get into the app.
 */
function AuthBackdrop({ background }: { background: AuthBackground }) {
  return (
    <MediaPlayer
      spec={{ url: background.url, contentType: background.contentType }}
      contentFit={background.fit}
      autoplay
      loop
      muted
      style={FILL}
    />
  );
}

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
          <TextInput underlineColorAndroid="transparent"
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
export function MethodPill({ field, onSubmit, hintDelay }: { field: Field; onSubmit: (f: Field, value: string) => void; hintDelay: number }) {
  const isPhone = field.type === "phone";
  const [value, setValue] = useState("");
  const region = Localization.getLocales?.()?.[0]?.regionCode || "US";
  const [country, setCountry] = useState<Country>(() => pickCountry(region));
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phone: the number box does not open until a country is chosen. The flag
  // then takes the badge's place and the cursor lands in the box, so one
  // tap on the pill is the whole first step and the second is just typing.
  const [countryPicked, setCountryPicked] = useState(false);
  const inputRef = useRef<TextInput>(null);

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

  // ONLY THE PILL BEING TYPED IN MOVES.
  //
  // A KeyboardAvoidingView around the whole stack lifted everything — the
  // other method, the social row, the lot — so opening the keyboard rearranged
  // a screen the user was not interacting with. Each pill lifts itself instead,
  // and only while it holds the caret.
  //
  // Driven by BOTH focus and keyboard height, which is the part I got wrong
  // first time. Listening to show/hide alone breaks the moment there are two
  // fields: moving from one to the other while the keyboard is already up
  // fires NEITHER event on iOS, so the pill being left stayed lifted and the
  // pill being entered never rose — the written one ended up behind the
  // keyboard and the empty one hovered above it. Height is remembered, focus
  // is state, and the lift is recomputed whenever either changes.
  const lift = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e: any) =>
      setKbHeight(e?.endCoordinates?.height ?? 0));
    const onHide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  useEffect(() => {
    // Clear the keyboard, plus a little air. The screen's own bottom padding
    // already sits below the pill, so the full keyboard height overshoots.
    const to = focused && kbHeight > 0 ? -(kbHeight - 34) : 0;
    Animated.spring(lift, {
      toValue: to,
      damping: 20, stiffness: 190, mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [focused, kbHeight, lift]);

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
    <Animated.View style={[s.pillWrap, { transform: [{ translateY: lift }] }]}>
      {/* iOS: frosted-glass pill. Android: expo-blur doesn't blur (and the 6%
          fill is invisible on OLED dark), so the oval "disappeared" — use a
          solid translucent fill there so the pill always reads as a pill. */}
      {Platform.OS === "ios" ? (
        <BlurView intensity={24} tint="light" style={s.pill} />
      ) : (
        <View style={[s.pill, s.pillAndroid]} />
      )}
      <View style={s.pillBorder} pointerEvents="none" />

      <Animated.View style={[s.contentRow, { opacity: inputOpacity }]} pointerEvents="box-none">
        {isPhone && !countryPicked && (
          <TouchableOpacity
            style={s.pickRow}
            activeOpacity={0.7}
            onPress={() => { Keyboard.dismiss(); Haptics.selectionAsync().catch(() => {}); setPickerOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel="Choose your country"
          >
            <Text style={s.pickText}>Phone</Text>
            <Chevron />
          </TouchableOpacity>
        )}
        {(!isPhone || countryPicked) && <TextInput underlineColorAndroid="transparent"
          ref={inputRef}
          style={s.input}
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={isPhone ? "Number" : "Email"}
          placeholderTextColor="rgba(255,255,255,0.32)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={isPhone ? "phone-pad" : "email-address"}
          textContentType={isPhone ? "telephoneNumber" : "emailAddress"}
          returnKeyType="go"
          onSubmitEditing={() => validRef.current && commit()}
        />}
      </Animated.View>

      {/* badge — swipe me. Envelope for email; the phone mark until a country
          is chosen, then that country's flag, so the pill itself says which
          number it is asking for. */}
      <Animated.View style={[s.envWrap, { transform: [{ translateX: envX }] }]} {...pan.panHandlers}>
        <View style={s.envCircle}>
          {!isPhone ? <Envelope /> : countryPicked ? (
            // The flag lives HERE and only here — it was also being drawn
            // where the dial code used to sit, which put two of them on one
            // pill. Tapping it reopens the picker, so removing the duplicate
            // costs nothing: the swipe still submits, because PanResponder
            // only claims a finger that has moved, and a tap has not.
            <Pressable
              onPress={() => { Keyboard.dismiss(); Haptics.selectionAsync().catch(() => {}); setPickerOpen(true); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Country ${country.name}, change`}
            >
              <Text style={s.badgeFlag}>{country.flag}</Text>
            </Pressable>
          ) : <PhoneMark />}
        </View>
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
          onSelect={(c) => {
            setCountry(c);
            setCountryPicked(true);
            Haptics.selectionAsync().catch(() => {});
            // The modal is still closing; focus once it has let go of the
            // screen, or the keyboard fights the dismissal.
            setTimeout(() => inputRef.current?.focus(), 260);
          }}
        />
      )}
    </Animated.View>
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
  // The backdrop, uploaded to `hero.auth` and served in the boot flags. Null
  // until it arrives and null forever if nothing was uploaded — the screen is
  // laid out to read on plain black either way.
  const [background, setBackground] = useState<AuthBackground | null>(null);
  const [backgroundCode, setBackgroundCode] = useState<AuthBackground | null>(null);
  // The server-composed screen, and the switch that draws it. Both null/false
  // until bootstrap answers, so the native tree is what renders on a cold
  // start and on any backend that cannot be reached.
  const [sduiTree, setSduiTree] = useState<Node | null>(null);
  const [scrim, setScrim] = useState(0.42);
  // The entrance, from the server. Defaults match what the backend ships, so a
  // cold start with no network looks the same as a warm one.
  const [suction, setSuction] = useState({ staggerMs: 95, durationMs: 780, fromY: 120 });
  const [reduceMotion, setReduceMotion] = useState(false);
  // Has the boot config answered yet? Until it has, neither tree is drawn.
  // Rendering the native one first and swapping when the server's arrived was
  // a visible flash on every launch — half a screen, then a different screen —
  // and the fix is to wait a beat rather than to make the swap prettier.
  // Bootstrap is cached, so the beat is short; the timeout is only there so a
  // dead network still gets a sign-in screen.
  const [cfgSettled, setCfgSettled] = useState(false);
  // The tokens every SDUI node resolves its colours and sizes against.
  // RenderNode THROWS without one — the provider lives in SduiApp's ready
  // path, which the auth gate returns long before reaching — so this screen
  // has to bring its own.
  const [authTheme, setAuthTheme] = useState<ThemeTokens | null>(null);

  // Google sign-in. Stays fully hidden until the three client IDs are filled in
  // authConfig (isGoogleConfigured) AND the request object is ready. The hook is
  // called unconditionally (rules-of-hooks); with placeholder IDs it just builds
  // an unused request. Uses id-token flow because Supabase's signInWithIdToken
  // needs the OIDC id_token, not an access token.
  //
  // On native iOS/Android this is really the authorization-CODE flow under the
  // hood: promptAsync resolves with only the code, and expo-auth-session then
  // exchanges it for tokens in the background, delivering the id_token through
  // the hook's RESPONSE object — never through the promptAsync result. So the
  // sign-in completion lives in the googleResponse effect below, not in the
  // button handler.
  const googleEnabled = isGoogleConfigured();
  const [googleRequest, googleResponse, googlePrompt] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_OAUTH.iosClientId,
    androidClientId: GOOGLE_OAUTH.androidClientId,
    webClientId: GOOGLE_OAUTH.webClientId,
  });

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
  // The one address that takes a password instead of a code. Empty unless the
  // backend is in a submission window, and an empty string never equals a
  // typed address — so outside that window this path does not exist.
  const [reviewEmail, setReviewEmail] = useState("");
  const fields: Field[] = [
    { id: "email", type: "email" },
    ...(phoneEnabled ? [{ id: "phone", type: "phone" as const }] : []),
  ];

  useEffect(() => {
    Animated.timing(arrival, { toValue: 1, duration: 900, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true }).start();
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    // Someone who has asked the system for less motion gets the layout with no
    // travel, not a slower version of the same flight.
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => {});
    // Whatever the network does, something is on screen shortly.
    const settle = setTimeout(() => setCfgSettled(true), 900);
    // Ask the backend whether phone sign-in is enabled (resilient; stays off on failure).
    let alive = true;
    fetchAuthConfig().then((cfg) => {
      if (!alive || !cfg) return;
      setPhoneEnabled(cfg.enablePhone);
      setReviewEmail(cfg.reviewEmail);
      setBackground(cfg.background);
      setBackgroundCode(cfg.backgroundCode);
      setCfgSettled(true);
      setAuthTheme((cfg.theme as ThemeTokens | null) ?? null);
      setScrim(cfg.scrim);
      // The app has the final say, not the flag. A tree naming a component
      // this binary does not have would draw a sign-in screen with nothing on
      // it — and someone stuck there cannot update, because the app is what
      // they would update from. So an unknown type means the native screen.
      const tree = cfg.sdui ? (cfg.screen as Node) : null;
      const missing = tree ? missingComponents(tree) : [];
      if (missing.length) {
        console.warn("[Tailzu][auth] server screen needs components this build lacks:", missing.join(", "));
      }
      setSduiTree(missing.length ? null : tree);
      // Why the server tree did or did not draw, on the next launch's
      // bootstrap. A console warning is invisible without a cable attached,
      // and this screen has already cost a day of guessing at exactly that.
      try {
        const { setLastBoot } = require("../storage");
        void setLastBoot(
          `auth sdui=${cfg.sdui ? 1 : 0} tree=${cfg.screen ? 1 : 0}` +
          ` theme=${cfg.theme ? 1 : 0} missing=${missing.join("|") || "none"}`,
        );
      } catch { /* diagnostics never break a boot */ }
      const su = cfg.suction;
      if (su && typeof su === "object") {
        setSuction({
          staggerMs: Number((su as any).staggerMs) || 95,
          durationMs: Number((su as any).durationMs) || 780,
          fromY: Number((su as any).fromY) || 120,
        });
      }
    }).catch(() => {});
    return () => { alive = false; clearTimeout(settle); };
  }, [arrival]);

  useEffect(() => {
    if (phase === "verify" || phase === "verifying") {
      Animated.parallel([
        Animated.timing(entryFade, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(verifyFade, { toValue: 1, duration: 320, delay: 80, useNativeDriver: true }),
        // finished guard: an interrupted fade (user backed out mid-animation)
        // must not yank the keyboard open over the entry screen.
      ]).start(({ finished }) => { if (finished) codeRef.current?.focus?.(); });
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
    // THE REVIEW ADDRESS SKIPS THE SEND, NOT THE SCREEN.
    //
    // Its code is a fixed pair held on the server, so there is nothing to mail
    // and nothing to wait for — but the reviewer still lands on the same code
    // screen every other user sees, because that IS the flow being reviewed.
    // The pair is checked in verify(), against /v1/auth/review-code.
    if (type === "email" && reviewEmail && value.trim().toLowerCase() === reviewEmail) {
      setActive({ type, value });
      setCode("");
      setPhase("verify");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setActive({ type, value });
    const my = ++seq.current;
    setPhase("sending");
    const animMin = new Promise((r) => setTimeout(r, 1600));
    // Solve the bot challenge inside the 1.6s the send animation runs anyway,
    // so the protection costs the user no time at all. A resend gets its own:
    // Turnstile tokens are single use.
    const captcha = await solveCaptcha();
    const apiCall = type === "phone"
      ? supabaseAuth.sendPhoneCode(value, captcha)
      : supabaseAuth.sendEmailCode(value, captcha);
    try {
      const [, res]: any = await Promise.all([animMin, apiCall]);
      if (my !== seq.current) return;
      if (res?.error) {
        setPhase("entry"); flashError();
        // SHOW the reason — a silent shake made "email rate limit exceeded" /
        // "project paused" / network failures all look identical and
        // undiagnosable in the field.
        Alert.alert("Couldn't send the code", String(res.error?.message ?? res.error));
        return;
      }
      setCode(""); setPhase("verify");
    } catch (e: any) {
      // A thrown error (offline / unexpected) would otherwise reject this
      // fire-and-forget callback and strand the user on the "sending" spinner
      // forever. Recover to the entry screen with the error shake.
      if (my !== seq.current) return;
      setPhase("entry"); flashError();
      Alert.alert("Couldn't send the code", String(e?.message ?? e ?? "Network error"));
    }
  }, [flashError, reviewEmail]);


  const handleMethodSubmit = useCallback((field: Field, value: string) => send(field.type, value), [send]);

  const verify = useCallback(async (token: string) => {
    if (!active) return;
    Keyboard.dismiss();
    const my = ++seq.current;
    setPhase("verifying");
    try {
      // THE REVIEW PAIR. Its code was never mailed — it is a fixed value held in
      // the backend's env — so the server checks the pair and, on a match, mints
      // a one-time link for that account. The app redeems it exactly as it would
      // redeem an emailed code, and what comes back is an ordinary session.
      //
      // Wrong code here fails the same way a wrong emailed code does: the shake,
      // the cleared boxes, no explanation. The two paths are not distinguishable
      // from the outside, which is the point.
      if (active.type === "email" && reviewEmail && active.value.trim().toLowerCase() === reviewEmail) {
        const res = await callEndpoint("POST", "/v1/auth/review-code", {
          email: active.value.trim().toLowerCase(),
          code: token,
        }).catch(() => null);
        const hash = res?.tokenHash;
        if (!hash) {
          setPhase("verify"); setCode(""); flashError();
          setTimeout(() => codeRef.current?.focus?.(), 60);
          return;
        }
        const { error: linkErr } = await supabaseAuth.verifyTokenHash(hash);
        if (my !== seq.current) return;
        if (linkErr) {
          setPhase("verify"); setCode(""); flashError();
          setTimeout(() => codeRef.current?.focus?.(), 60);
          return;
        }
        onAuthed();
        return;
      }
      const { error } = active.type === "phone"
        ? await supabaseAuth.verifyPhoneCode(active.value, token)
        : await supabaseAuth.verifyEmailCode(active.value, token);
      if (my !== seq.current) return;
      if (error) { setPhase("verify"); setCode(""); flashError(); setTimeout(() => codeRef.current?.focus?.(), 60); return; }
      onAuthed();
    } catch {
      // Don't strand on the "verifying" spinner if the call throws — drop back
      // to the code screen so the user can retry.
      if (my !== seq.current) return;
      setPhase("verify"); setCode(""); flashError();
      setTimeout(() => codeRef.current?.focus?.(), 60);
    }
  }, [active, flashError, onAuthed, reviewEmail]);

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
      if (error) {
        flashError();
        Alert.alert("Couldn't sign in with Apple", String(error.message ?? error));
        return;
      }
      // Apple gives the name only on first consent — stash it to pre-fill the
      // post-onboarding name card.
      const given = cred.fullName?.givenName ?? "";
      const family = cred.fullName?.familyName ?? "";
      const full = [given, family].filter(Boolean).join(" ").trim();
      if (full) setAuthName(full).catch(() => {});
      onAuthed();
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") {
        flashError();
        Alert.alert("Couldn't sign in with Apple", String(e?.message ?? e ?? "Sign-in error"));
      }
    }
  }, [flashError, onAuthed]);

  const onGoogle = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Opens the Google consent sheet. On native the resolved value only
      // carries the authorization code — the id_token lands in googleResponse
      // after expo-auth-session's background code exchange, so completion is
      // handled by the effect below.
      await googlePrompt();
    } catch (e: any) {
      flashError();
      Alert.alert("Couldn't sign in with Google", String(e?.message ?? e ?? "OAuth error"));
    }
  }, [googlePrompt, flashError]);

  // Completes Google sign-in once the hook delivers the exchanged tokens.
  // Errors get a visible reason — a silent shake made every failure
  // (misconfigured Supabase provider, missing id_token, network) look identical.
  const googleHandled = useRef<unknown>(null);
  useEffect(() => {
    if (!googleResponse || googleHandled.current === googleResponse) return;
    googleHandled.current = googleResponse;
    if (googleResponse.type === "error") {
      flashError();
      Alert.alert("Couldn't sign in with Google", String(googleResponse.error?.message ?? googleResponse.error ?? "OAuth error"));
      return;
    }
    if (googleResponse.type !== "success") return; // cancel / dismiss — silent
    const idToken = (googleResponse.params as Record<string, string> | undefined)?.id_token
      || googleResponse.authentication?.idToken;
    if (!idToken) {
      flashError();
      Alert.alert("Couldn't sign in with Google", "Google didn't return an identity token.");
      return;
    }
    (async () => {
      // The id_token echoes the request's nonce (when one was used) — Supabase
      // rejects the token unless that same nonce is passed alongside it.
      const { error } = await supabaseAuth.signInWithGoogle(idToken, googleRequest?.nonce ?? undefined);
      if (error) {
        flashError();
        Alert.alert("Couldn't sign in with Google", String(error.message ?? error));
        return;
      }
      onAuthed();
    })().catch((e: any) => {
      flashError();
      Alert.alert("Couldn't sign in with Google", String(e?.message ?? e ?? "Network error"));
    });
  }, [googleResponse, googleRequest, flashError, onAuthed]);

  const sduiCtx = useAuthSduiCtx();
  const translateY = arrival.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const onCode = phase === "verify" || phase === "verifying";
  // The code step's own art when there is some, the entry's otherwise — so one
  // upload still dresses the whole flow and a second is an option, not a duty.
  const shownBackground = onCode ? (backgroundCode ?? background) : background;

  // The flow, published for an SDUI tree to draw. Every field below is the
  // handler or the state this screen already had — this object creates no
  // behaviour of its own, which is the property that lets the native path and
  // the server-composed path be the same flow rather than two of them.
  const flow: AuthFlow = {
    phase,
    active,
    code,
    codeLength: CODE_LEN,
    setCode: (next) => { setCode(next.replace(/\D/g, "").slice(0, CODE_LEN)); if (codeError) setCodeError(false); },
    codeError,
    phoneEnabled,
    appleAvailable,
    googleEnabled,
    submit: send,
    verify,
    resend,
    back: goBack,
    signInApple: onApple,
    signInGoogle: onGoogle,
    focusCode: () => codeRef.current?.focus?.(),
  };

  return (
    <AuthFlowProvider value={flow}>
    <Animated.View style={[s.container, { transform: [{ translateX: shake }] }]}>
      {/* The backdrop, behind everything and outside the lifting pills, so a
          raised keyboard slides the FIELD and not the art.
          The scrim is not decoration: this screen is white text on whatever
          someone uploads, and without a floor under the contrast a bright clip
          makes the labels unreadable. It is painted from the art's own ground
          colour so there is no visible seam at the edges. */}
      {shownBackground ? (
        <View style={[FILL, { backgroundColor: shownBackground.background }]} pointerEvents="none">
          <AuthBackdrop background={shownBackground} key={shownBackground.url} />
          <View style={[FILL, { backgroundColor: `rgba(0,0,0,${scrim})` }]} />
        </View>
      ) : null}

      {/* The bot challenge. Draws nothing, and renders nothing at all until a
          site key exists — see ./captcha.tsx for why it lives here and not
          behind the send button. */}
      <CaptchaHost />
      {/* TAP ANYWHERE THAT IS NOT A CONTROL, AND THE KEYBOARD GOES.
          Behind everything and covering the window, so it catches the gaps —
          the space beside a pill, the area under the socials, the backdrop.
          It is a sibling rather than a wrapper on purpose: wrapping the content
          would put a touch responder above the pills and swallow the first tap
          on a field, which is a far worse bug than the one this fixes.
          accessible={false} keeps it out of the screen reader's order; it is a
          gesture, not a control. */}
      <TouchableWithoutFeedback accessible={false} onPress={() => Keyboard.dismiss()}>
        <View style={FILL} />
      </TouchableWithoutFeedback>

      {/* No KeyboardAvoidingView. It lifted the WHOLE stack — the other
          method, the social row, everything — so opening the keyboard
          rearranged parts of the screen nobody was touching. Each pill lifts
          itself instead; see the lift in MethodPill. */}
      <View style={s.kav}>
        {/* THE SERVER'S SCREEN, when there is one and the switch is on.
            Everything outside this block still belongs to the app: the
            backdrop, the captcha host, the back arrow, the edge-swipe zone —
            and, crucially, the whole auth flow, which is published through the
            provider rather than moved. So this is a change of DRAWING, not of
            behaviour, and turning the flag off returns the original screen
            without a build. */}
        {!cfgSettled ? null : sduiTree && authTheme ? (
          // The theme is REQUIRED, not decorative: every node reads its colours
          // and sizes from it, and RenderNode throws without one rather than
          // falling back — which on this screen means an error card instead of
          // a way into the app. So the tree is only drawn once the tokens have
          // arrived, and the native screen covers the gap.
          <ThemeContext.Provider value={authTheme}>
            <Animated.View style={[s.kav, { opacity: arrival, transform: [{ translateY }] }]}>
              <RenderNode node={sduiTree} ctx={sduiCtx} />
            </Animated.View>
          </ThemeContext.Provider>
        ) : (
        <Animated.View style={[s.stack, { opacity: arrival, transform: [{ translateY }] }]}>
          {phase === "entry" && (<>
            <Animated.View style={[s.block, { opacity: entryFade }]}>
              {fields.map((f, i) => (
                <RiseView key={f.id} cfg={{ delayMs: suction.staggerMs * (2 - i), fromY: suction.fromY }} reduce={reduceMotion}>
                  <View style={{ marginTop: i === 0 ? 0 : 18 }}>
                    <MethodPill field={f} onSubmit={handleMethodSubmit} hintDelay={1100 + i * 160} />
                  </View>
                </RiseView>
              ))}
              <RiseView cfg={{ delayMs: 0, fromY: suction.fromY }} reduce={reduceMotion}>
              <View style={s.divider} />
              <View style={s.socialRow}>
                {appleAvailable && (
                  <TouchableOpacity style={s.social} activeOpacity={0.7} onPress={onApple} accessibilityRole="button" accessibilityLabel="Sign in with Apple">
                    <AppleMark />
                  </TouchableOpacity>
                )}
                {googleEnabled && (
                  <TouchableOpacity style={s.social} activeOpacity={0.7} onPress={onGoogle} disabled={!googleRequest} accessibilityRole="button" accessibilityLabel="Sign in with Google">
                    <GoogleMark />
                  </TouchableOpacity>
                )}
              </View>
              </RiseView>
            </Animated.View>
          </>)}

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
              {/* No autoFocus: it fires at MOUNT, while this block is still at
                  opacity 0 — the number pad shot up over an invisible code row
                  and the boxes faded in late ("the code box is hiding"). The
                  fade-completion callback focuses instead: boxes land fully
                  visible first, THEN the keyboard rises. */}
              <TextInput underlineColorAndroid="transparent"
                ref={codeRef}
                style={s.hiddenInput}
                value={code}
                onChangeText={(t) => { setCode(t.replace(/\D/g, "").slice(0, CODE_LEN)); if (codeError) setCodeError(false); }}
                keyboardType="number-pad"
                maxLength={CODE_LEN}
                textContentType="oneTimeCode"
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
        )}
      </View>

      {/* top-left back arrow (code step) */}
      {onCode && (
        <TouchableOpacity onPress={goBack} style={s.backTopLeft} activeOpacity={0.6} hitSlop={12}>
          <Back />
        </TouchableOpacity>
      )}

      {/* edge-swipe-back zone — only on the code step */}
      {onCode ? edgeZone : null}
    </Animated.View>
    </AuthFlowProvider>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: VOID },
  kav: { flex: 1 },
  backTopLeft: { position: "absolute", top: 56, left: 18, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  // BOTTOM-ALIGNED, so background art keeps the top two thirds. This used to
  // centre the whole block, which put the pills over the middle of the picture
  // and left the composition with nowhere to breathe. Matches what the
  // server-composed screen does, so the two paths look alike and it stops
  // mattering which one is drawing.
  stack: { flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: 42, paddingHorizontal: 28 },
  block: { alignItems: "center", width: "100%" },
  brandWrap: { alignItems: "center", marginBottom: 34 },
  brand: { fontSize: 40, fontWeight: "700", color: WHITE, letterSpacing: -0.5 },
  tag: { marginTop: 6, fontSize: 16, fontWeight: "300", color: "rgba(255,255,255,0.72)", letterSpacing: 0.2 },

  pillWrap: { width: PILL_W, height: PILL_H, borderRadius: PILL_H / 2, justifyContent: "center" },
  pill: { ...FILL, borderRadius: PILL_H / 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)" },
  // Android has no blur behind it — needs a stronger fill to stay visible.
  pillAndroid: { backgroundColor: "rgba(255,255,255,0.12)" },
  pillBorder: { ...FILL, borderRadius: PILL_H / 2, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.14)" },
  contentRow: { position: "absolute", left: PILL_PAD + BADGE + 10, right: PILL_PAD + BADGE + 10, top: 0, bottom: 0, flexDirection: "row", alignItems: "center" },
  flag: { fontSize: 18, marginRight: 5 },
  pickRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 4 },
  pickText: { fontSize: 15, fontWeight: "300", color: "rgba(255,255,255,0.32)", letterSpacing: 0.3 },
  badgeFlag: { fontSize: 20, lineHeight: 24 },
  dial: { fontSize: 15, fontWeight: "300", color: WHITE, marginRight: 4 },
  input: { flex: 1, fontSize: 15, fontWeight: "300", color: WHITE, letterSpacing: 0.3, padding: 0 },

  envWrap: { position: "absolute", left: PILL_PAD, top: PILL_PAD, width: BADGE, height: BADGE, zIndex: 5 },
  envCircle: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  arrowWrap: { position: "absolute", right: PILL_PAD, top: PILL_PAD, width: BADGE, height: BADGE },
  arrowCircle: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" },

  // 48/48 was proportioned against a heading that no longer exists. Bottom
  // aligned and titleless, that much air stranded the socials at the foot of
  // the screen away from everything else.
  divider: { width: PILL_W * 0.66, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.15)", marginTop: 26, marginBottom: 24 },

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
  modalBackdrop: { ...FILL, backgroundColor: "rgba(0,0,0,0.55)" },
  modalSheet: { height: SH * 0.72, backgroundColor: ABYSS, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 18 },
  modalHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 },
  modalSearch: { height: 44, borderRadius: 12, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.06)", color: WHITE, fontSize: 15, marginBottom: 8 },
  cRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.06)" },
  cFlag: { fontSize: 22, marginRight: 12 },
  cName: { flex: 1, fontSize: 15, fontWeight: "300", color: WHITE },
  cDial: { fontSize: 14, color: "rgba(255,255,255,0.5)" },
});
