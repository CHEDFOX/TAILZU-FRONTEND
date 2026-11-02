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
 * (the app-wide edge-swipe capability, src/sdui/shell/gestures) — swipe, haptic, back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Keyboard, Platform, Pressable, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import Constants from "expo-constants";
import { haptic } from "../sdui/components/haptic";
import { supabaseAuth } from "./supabaseClient";
import { CaptchaHost, solveCaptcha } from "./captcha";
import { AuthFlowProvider, type AuthFlow } from "./AuthFlowContext";
import { RiseView } from "../sdui/components/Rise";
import { RenderNode } from "../sdui/Renderer";
import { ThemeContext } from "../sdui/theme/ThemeContext";
import { useAuthSduiCtx, missingComponents } from "./sdui/authRender";
import type { Node, ThemeTokens } from "../sdui/types";
import { useEdgeSwipeBack } from "../sdui/shell/gestures";
import { callEndpoint, fetchAuthConfig, type AuthBackground } from "../sdui/client";
import { fontsReady } from "../sdui/theme/remoteFonts";
import { ErrorBoundary } from "../sdui/shell/ErrorBoundary";
import { abandon as abandonOnboard } from "../onboard/stageBus";
import { AUTH_METHODS, GOOGLE_OAUTH, isGoogleConfigured } from "./authConfig";
import { emailLinkRedirect } from "./linkSignIn";
import { list, num, obj, str, txt } from "../sdui/knobs";
import { SHAKE, FILL, at, setScale } from "./gate/look";
import type { Field, ActiveMethod } from "./gate/types";
import { s } from "./gate/styles";
import { AppleMark, GoogleMark, Back, Resend } from "./gate/glyphs";
import { AuthBackdrop } from "./gate/AuthBackdrop";
import { typedMemory } from "./gate/typedMemory";
import { MethodPill } from "./gate/MethodPill";
import { MicroLoader } from "./gate/MicroLoader";
import { useAppleSignIn } from "./gate/useAppleSignIn";
import { useGoogleSignIn } from "./gate/useGoogleSignIn";

// Lets the OAuth popup hand the redirect back to the JS auth-session listener
// when the browser closes. Safe no-op when there's no pending session.
WebBrowser.maybeCompleteAuthSession();

export default function AuthGateScreen({ onAuthed }: { onAuthed: () => void }) {
  // No "sending" any more. It was a phase the USER was put into while a
  // network call ran, and a screen that exists only because something is slow
  // is the definition of a wait. The send now happens behind the code screen,
  // so there is no third place to be.
  const [phase, setPhase] = useState<"entry" | "verify" | "verifying">("entry");
  /**
   * Whether a code is on its way, and whether it gave up.
   *
   * Separate from `phase` on purpose. Phase is where the USER is; these are
   * what the network is doing behind them. Folding the two together is what
   * produced the old behaviour, where a send that was merely slow moved the
   * user, and a send that failed moved them back.
   */
  /**
   * Bumped when the entry screen is returned to, so the committed pills put
   * their discs back at the start. Not on commit — a disc that has been thrown
   * belongs at the end it was thrown to.
   */
  const [pillReset, setPillReset] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
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
  // True while the onboarding tree has arrived but its two faces have not
  // (see the wait in the config effect). Nothing is drawn for that moment, so
  // the first words anyone reads are never set in one face and swapped to
  // another.
  const [fontsHold, setFontsHold] = useState(false);
  const [scrim, setScrim] = useState(() => num("auth.scrim", 0.42));
  // The entrance, from the server. Defaults match what the backend ships, so a
  // cold start with no network looks the same as a warm one.
  const [suction, setSuction] = useState(() => obj("auth.suction", { staggerMs: 95, durationMs: 780, fromY: 120 }));
  // The server tree's ctx reads the same bootstrap as everything else.
  const [authFlags, setAuthFlags] = useState<Record<string, unknown> | null>(null);
  const [authLabels, setAuthLabels] = useState<Record<string, string> | null>(null);
  // The code's length is the server's; the boxes and the auto-verify follow.
  const CODE_LEN = Math.max(1, num("auth.codeLength", 6));
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
  /**
   * GOOGLE ON ANDROID GOES THROUGH SUPABASE'S PAGE, WHEN THE BACKEND SAYS SO.
   *
   * The native client returns to `com.tulmi.app:/oauthredirect`, and a build
   * that never claimed that scheme strands the user on Google after consent
   * — the manifest fix for that needs a new binary. This path needs none:
   * Supabase finishes Google itself and lands on a backend page, which hands
   * the session to tulmi://, a scheme every build has always claimed. The
   * backend owns the switch and the page; this only reads them.
   */
  const [googleWeb, setGoogleWeb] = useState<{ callback: string; resume: string } | null>(null);
  /**
   * CAN THIS BINARY COME BACK FROM GOOGLE ON ITS OWN?
   *
   * The native client returns on `${applicationId}:/oauthredirect`, and a
   * build only receives that if it CLAIMED the scheme — which is baked into
   * the binary, so the JavaScript can read it off its own config. A build
   * that claims it goes native, which is the flow that says "Tailzu" on the
   * consent screen; a build that does not takes the web bridge, whatever the
   * backend has switched on. Decided here rather than by a backend flag,
   * because the fact is per-binary and the same JavaScript runs on both.
   */
  const nativeReturns = (() => {
    const cfg = Constants.expoConfig as { scheme?: string | string[]; android?: { package?: string } } | null;
    const schemes = ([] as string[]).concat(cfg?.scheme ?? []);
    return schemes.includes(cfg?.android?.package ?? "com.tulmi.app");
  })();
  const googleViaWeb = Platform.OS === "android" && !!googleWeb && !nativeReturns;
  const googleEnabled = isGoogleConfigured() || googleViaWeb;
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

  // Whatever was typed goes with the gate, not the next person's screen.
  useEffect(() => () => { typedMemory.clear(); }, []);

  useEffect(() => {
    Animated.timing(arrival, { toValue: 1, duration: num("auth.anim.arrivalMs", 900), easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true }).start();
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
    // Someone who has asked the system for less motion gets the layout with no
    // travel, not a slower version of the same flight.
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => {});
    // Whatever the network does, something is on screen shortly.
    const settle = setTimeout(() => setCfgSettled(true), num("auth.configWaitMs", 900));
    // Ask the backend whether phone sign-in is enabled (resilient; stays off on failure).
    let alive = true;
    fetchAuthConfig().then((cfg) => {
      if (!alive || !cfg) return;
      setPhoneEnabled(cfg.enablePhone);
      setReviewEmail(cfg.reviewEmail);
      setGoogleWeb(cfg.googleWeb);
      setBackground(cfg.background);
      setBackgroundCode(cfg.backgroundCode);
      setCfgSettled(true);
      setAuthTheme((cfg.theme as ThemeTokens | null) ?? null);
      setAuthFlags(cfg.flags);
      setAuthLabels(cfg.labels);
      setScale((cfg.theme as ThemeTokens | null) ?? null);
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
      const usable = missing.length ? null : tree;
      if (usable && usable.type === "OnboardStage") {
        // THE ONBOARDING TREE WAITS FOR ITS TWO FACES, BRIEFLY. Hello is the
        // first thing a person reads and it is set in a face that arrives over
        // the network; drawing it in the system font and swapping would be a
        // flicker at the one moment there is no second chance. So nothing is
        // drawn until the faces are in, or onboard.fontWaitMs (600) has
        // passed, whichever is first. A dead font URL costs the wait and
        // nothing more: the system face draws instead.
        setFontsHold(true);
        const settle = () => { if (alive) { setSduiTree(usable); setFontsHold(false); } };
        // The Bots app's sign-in (its stage is "bots.auth") is set in Geist, not
        // in the onboarding's two faces: it waits for those instead.
        const botsAuth = (usable.props as { id?: unknown } | undefined)?.id === "bots.auth";
        const faces = botsAuth
          ? list<string>("bots.auth.fonts", ["Tailzu Geist", "Tailzu Geist SemiBold", "Tailzu Geist Bold"])
          : list<string>("onboard.fonts", ["Tailzu Grotesk", "Tailzu Hand"]);
        fontsReady(faces, num("onboard.fontWaitMs", 600))
          .then(settle, settle);
      } else {
        setSduiTree(usable);
      }
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
        // Garbage in a field keeps what was there, which is the default.
        setSuction((cur) => ({
          staggerMs: Number((su as any).staggerMs) || cur.staggerMs,
          durationMs: Number((su as any).durationMs) || cur.durationMs,
          fromY: Number((su as any).fromY) || cur.fromY,
        }));
      }
    }).catch(() => {});
    return () => { alive = false; clearTimeout(settle); };
  }, [arrival]);

  useEffect(() => {
    if (phase === "verify" || phase === "verifying") {
      Animated.parallel([
        Animated.timing(entryFade, { toValue: 0, duration: num("auth.anim.entryOutMs", 220), useNativeDriver: true }),
        Animated.timing(verifyFade, { toValue: 1, duration: num("auth.anim.verifyInMs", 320), delay: num("auth.anim.verifyInDelayMs", 80), useNativeDriver: true }),
        // finished guard: an interrupted fade (user backed out mid-animation)
        // must not yank the keyboard open over the entry screen.
      ]).start(({ finished }) => { if (finished) codeRef.current?.focus?.(); });
    } else if (phase === "entry") {
      Animated.parallel([
        Animated.timing(verifyFade, { toValue: 0, duration: num("auth.anim.verifyOutMs", 180), useNativeDriver: true }),
        Animated.timing(entryFade, { toValue: 1, duration: num("auth.anim.entryInMs", 240), delay: num("auth.anim.entryInDelayMs", 60), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(entryFade, { toValue: 0, duration: num("auth.anim.verifyingOutMs", 280), useNativeDriver: true }).start();
    }
  }, [phase, entryFade, verifyFade]);

  const flashError = useCallback(() => {
    haptic(str("app.haptics.auth.codeWrong", "warning"));
    setCodeError(true);
    const step = num("auth.anim.shakeStepMs", 60);
    Animated.sequence([
      Animated.timing(shake, { toValue: SHAKE, duration: step, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -SHAKE, duration: step, useNativeDriver: true }),
      Animated.timing(shake, { toValue: SHAKE / 2, duration: step, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: num("auth.anim.shakeSettleMs", 80), useNativeDriver: true }),
    ]).start(() => setTimeout(() => setCodeError(false), num("auth.anim.codeErrorMs", 400)));
  }, [shake]);

  /**
   * How hard the app tries to get a code out before it admits it could not.
   *
   * FOUR, and the first retry is IMMEDIATE. A send fails for two kinds of
   * reason: the connection blinked, or the server refused. The first is over by
   * the time the failure is reported, so waiting before trying again spends the
   * user's time on nothing; the second will not be fixed by any amount of
   * waiting, and four attempts is enough to establish that.
   *
   * The waits before attempts 2, 3 and 4 are auth.send.backoffMs — zero first,
   * so the retry is instant — and auth.send.rateLimitBackoffMs when the server
   * said RATE LIMIT: retrying instantly against a rate limit is how a slow send
   * becomes a blocked address, because the limiter counts the attempts.
   */
  /**
   * DELIVER THE CODE, BEHIND THE SCREEN THE USER IS ALREADY ON.
   *
   * Separated from send() because the two answer different questions. send()
   * decides where the user goes, and the answer is always "the code screen,
   * now". This decides whether a code actually got sent, which is a thing that
   * can fail, take a while, and be worth another go — none of which the user
   * should have to watch.
   *
   * It retries ITSELF. A failed send used to throw the user back to the entry
   * screen behind an alert, so the recovery from a dropped packet was: read a
   * dialog, dismiss it, retype the address. Now the first retry goes out the
   * moment the failure lands, and the user, who is already looking at the code
   * boxes, sees nothing at all unless every attempt fails.
   *
   * RATE LIMITS ARE THE ONE THING IT WILL NOT HAMMER. "over_email_send_rate_limit"
   * is the server saying "too many, too fast", and answering that instantly is
   * how a slow send becomes a blocked address. Those wait; everything else —
   * dropped connection, timeout, a 5xx — goes again straight away.
   */
  const deliver = useCallback(async (
    type: "email" | "phone", value: string, my: number, attempt: number,
  ) => {
    setSending(true);
    setSendFailed(false);
    let msg = "";
    try {
      // Turnstile tokens are single use, so every attempt solves its own.
      const captcha = await solveCaptcha();
      // A mail should carry a code; if a template sends a link instead, it
      // comes back with a state only this phone holds (fresh per attempt, as
      // each send also replaces the PKCE verifier).
      const res: any = type === "phone"
        ? await supabaseAuth.sendPhoneCode(value, captcha)
        : await supabaseAuth.sendEmailCode(value, captcha, await emailLinkRedirect().catch(() => undefined));
      if (my !== seq.current) return;
      if (res?.error) throw new Error(String(res.error?.message ?? res.error));
      setSending(false);
      setSendError(null);
      return;
    } catch (e: any) {
      if (my !== seq.current) return;
      msg = String(e?.message ?? e ?? txt("auth.error.network", "Network error"));
    }
    const next = attempt + 1;
    if (next < num("auth.send.attempts", 4)) {
      const limited = /rate limit|too many|429/i.test(msg);
      const wait = limited
        ? list<number>("auth.send.rateLimitBackoffMs", [6000, 15000, 30000])[attempt] ?? num("auth.send.rateLimitBackoffMaxMs", 30000)
        : list<number>("auth.send.backoffMs", [0, 900, 2600])[attempt] ?? num("auth.send.backoffMaxMs", 4000);
      setTimeout(() => {
        if (my === seq.current) void deliver(type, value, my, next);
      }, wait);
      return;
    }
    // Out of attempts. Say so ON THE CODE SCREEN — the user may still have an
    // older code that works, and the way back is the arrow they can already see.
    console.warn("[auth] code could not be sent:", msg);
    setSending(false);
    setSendFailed(true);
    setSendError(msg);
  }, []);

  const send = useCallback((type: "email" | "phone", value: string) => {
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
      setSending(false); setSendFailed(false); setSendError(null);
      setPhase("verify");
      return;
    }
    haptic(str("app.haptics.auth.codeSent", "medium"));
    setActive({ type, value });
    setCode("");
    // THE CODE SCREEN OPENS IN THIS FRAME. Nothing is awaited first.
    //
    // It used to wait on Promise.all([a 1.6s animation, the send]) before
    // moving, so tapping continue bought a second and a half of nothing on a
    // good connection and longer on a bad one. That is the whole of what read
    // as a dead tap — and it made Resend, which goes through here too, flip to
    // the sending animation and back for no reason a user could see.
    //
    // The code cannot arrive before the screen does, so there is nothing the
    // waiting protected.
    setPhase("verify");
    const my = ++seq.current;
    void deliver(type, value, my, 0);
  }, [deliver, reviewEmail]);


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
    haptic(str("app.haptics.auth.back", "light"));
    Keyboard.dismiss();
    seq.current++;
    verifyFade.setValue(0); entryFade.setValue(1);
    setCode(""); setCodeError(false); setActive(null); setPhase("entry");
    // Bumping seq above already orphans any retry still in flight — this is
    // only so the entry screen is not wearing the last attempt's error.
    setSending(false); setSendFailed(false); setSendError(null);
    // The pills are about to be looked at again, so the discs go home.
    setPillReset((n) => n + 1);
  }, [entryFade, verifyFade]);

  // Goes straight back through send(), which no longer moves the user — so a
  // resend is a new delivery under a screen that does not flinch.
  const resend = useCallback(() => { if (active) send(active.type, active.value); }, [active, send]);

  // App-wide edge-swipe-back (swipe → haptic → back). No on-screen hint.
  const { edgeZone } = useEdgeSwipeBack(goBack);

  const onApple = useAppleSignIn({ flashError, onAuthed });

  const onGoogle = useGoogleSignIn({ googlePrompt, googleRequest, googleResponse, googleViaWeb, googleWeb, flashError, onAuthed });

  const sduiCtx = useAuthSduiCtx(authFlags, authLabels);
  const translateY = arrival.interpolate({ inputRange: [0, 1], outputRange: [num("auth.anim.arrivalRise", 12), 0] });
  const onCode = phase === "verify" || phase === "verifying";
  // The onboarding run is a stage: it keeps its own steps, glides between them
  // and holds the arrow ("Change it") itself. So the gate gives it a still
  // frame to stand in (it fades in, but does not rise, because Blip's feet are
  // measured against where the stage is) and draws no back arrow of its own.
  // The edge-swipe back stays.
  const drawingStage = !fontsHold && !!sduiTree && !!authTheme && sduiTree.type === "OnboardStage";
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
    sending,
    sendFailed,
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
      {/* No KeyboardAvoidingView. It lifted the WHOLE stack — the other
          method, the social row, everything — so opening the keyboard
          rearranged parts of the screen nobody was touching. Each pill lifts
          itself instead; see the lift in MethodPill. */}
      {/* No KeyboardAvoidingView. It lifted the WHOLE stack — the other
          method, the social row, everything — so opening the keyboard
          rearranged parts of the screen nobody was touching. Each pill lifts
          itself instead; see the lift in MethodPill. */}
      {/* TAP ANYWHERE THAT IS NOT A CONTROL AND THE KEYBOARD GOES.
          Underneath the content, with the content set to box-none — which is
          the piece I had missing both times. Wrapping the content in a
          Touchable grabs the responder on touch START, and once an ancestor
          holds it a descendant's onMoveShouldSetPanResponder is never asked:
          that killed the badge swipe outright. A plain sibling underneath
          never fired either, because an unclaimed touch is simply unhandled.
          box-none is the answer to both: the container itself can never become
          the responder, so empty space falls through to this layer, while the
          pills inside still take their own touches. */}
      <TouchableWithoutFeedback accessible={false} onPress={() => Keyboard.dismiss()}>
        <View style={FILL} />
      </TouchableWithoutFeedback>

      {/* TAP ANYWHERE THAT IS NOT A CONTROL AND THE KEYBOARD GOES.
          An ancestor, because it has to be. box-none and a sibling underneath
          was my second wrong answer: the rows are full width, so the space
          "beside a pill" is inside a Rise wrapper, that wrapper is the hit
          target, and an unclaimed touch bubbles up its own ancestors rather
          than falling through to a sibling. Only something above everything
          sees those taps. It does not swallow the controls, because React
          Native offers a touch to the DEEPEST view first — and the badge now
          claims its own on start rather than waiting for a move. */}
      <TouchableWithoutFeedback accessible={false} onPress={() => Keyboard.dismiss()}>
      <View style={s.kav}>
        {/* THE SERVER'S SCREEN, when there is one and the switch is on.
            Everything outside this block still belongs to the app: the
            backdrop, the captcha host, the back arrow, the edge-swipe zone —
            and, crucially, the whole auth flow, which is published through the
            provider rather than moved. So this is a change of DRAWING, not of
            behaviour, and turning the flag off returns the original screen
            without a build. */}
        {!cfgSettled || fontsHold ? null : sduiTree && authTheme ? (
          // The theme is REQUIRED, not decorative: every node reads its colours
          // and sizes from it, and RenderNode throws without one rather than
          // falling back — which on this screen means an error card instead of
          // a way into the app. So the tree is only drawn once the tokens have
          // arrived, and the native screen covers the gap.
          <ThemeContext.Provider value={authTheme}>
            <Animated.View style={[s.kav, drawingStage ? { opacity: arrival } : { opacity: arrival, transform: [{ translateY }] }]}>
              {/* A tree that throws while drawing drops to the native screen
                  instead of the app-wide error card: a bad tree costs someone
                  the look, never the way in. */}
              <ErrorBoundary
                fallback={null}
                onError={() => {
                  setSduiTree(null);
                  // Blip's overlay would otherwise keep paper over the native
                  // screen this drops to, waiting for a stage that is not coming.
                  abandonOnboard();
                }}
              >
                <RenderNode node={sduiTree} ctx={sduiCtx} />
              </ErrorBoundary>
            </Animated.View>
          </ThemeContext.Provider>
        ) : (
        <Animated.View pointerEvents="box-none" style={[s.stack, { opacity: arrival, transform: [{ translateY }] }]}>
          {phase === "entry" && (<>
            <Animated.View style={[s.block, { opacity: entryFade }]}>
              {fields.map((f, i) => (
                <RiseView key={f.id} cfg={{ delayMs: suction.staggerMs * (2 - i), fromY: suction.fromY }} reduce={reduceMotion}>
                  <View style={{ marginTop: i === 0 ? 0 : num("auth.pill.gap", 18) }}>
                    <MethodPill
                      field={f}
                      onSubmit={handleMethodSubmit}
                      hintDelay={num("auth.anim.hintDelayMs", 1100) + i * num("auth.anim.hintStaggerMs", 160)}
                      resetAt={pillReset}
                    />
                  </View>
                </RiseView>
              ))}
              <RiseView cfg={{ delayMs: 0, fromY: suction.fromY }} reduce={reduceMotion}>
              <View style={s.divider} />
              <View style={s.socialRow}>
                {appleAvailable && (
                  <TouchableOpacity style={s.social} activeOpacity={0.7} onPress={onApple} accessibilityRole="button" accessibilityLabel={txt("auth.a11y.apple", "Sign in with Apple")}>
                    <AppleMark />
                  </TouchableOpacity>
                )}
                {googleEnabled && (
                  <TouchableOpacity style={s.social} activeOpacity={0.7} onPress={onGoogle} disabled={!googleRequest && !googleViaWeb} accessibilityRole="button" accessibilityLabel={txt("auth.a11y.google", "Sign in with Google")}>
                    <GoogleMark />
                  </TouchableOpacity>
                )}
              </View>
              </RiseView>
            </Animated.View>
          </>)}


          {onCode && (
            <Animated.View style={[s.block, { opacity: verifyFade }]}>
              <Pressable style={s.codeRow} onPress={() => codeRef.current?.focus?.()}>
                {Array.from({ length: CODE_LEN }).map((_, i) => (
                  <View key={i} style={[s.codeBox, code[i] ? s.codeBoxFilled : null, codeError ? s.codeBoxError : null]}>
                    {code[i] ? <Text style={[s.codeDigit, at("authCode", null)]}>{code[i]}</Text> : null}
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
              {/* One slot, three states, so nothing below it ever moves:
                  checking the code the user typed, still delivering one, or
                  out of attempts. Delivery only speaks up once it has failed
                  for the last time — the retries are not the user's problem. */}
              <View style={s.verifyStatus}>
                {phase === "verifying"
                  ? <MicroLoader />
                  : sendFailed
                    ? <Text style={[s.sendFailed, at("authNote", null)]} numberOfLines={1}>
                        {sendError && /rate limit|too many/i.test(sendError)
                          ? txt("auth.send.rateLimited", "Too many requests. Wait a moment, then resend.")
                          : txt("auth.send.failed", "Couldn't send a code. Tap resend.")}
                      </Text>
                    : null}
              </View>
              <View style={s.divider} />
              {/* code step: resend only — back is the top-left arrow / edge-swipe */}
              <View style={s.verifyActions}>
                <TouchableOpacity
                  onPress={resend}
                  // Not while one is already on its way: a second tap would
                  // orphan the first attempt and start the backoff over.
                  disabled={sending}
                  style={[s.social, sending ? s.socialBusy : null]}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={txt("auth.a11y.resend", "Send the code again")}
                ><Resend /></TouchableOpacity>
              </View>
            </Animated.View>
          )}

        </Animated.View>
        )}
      </View>
      </TouchableWithoutFeedback>

      {/* top-left back arrow (code step) */}
      {onCode && !drawingStage && (
        <TouchableOpacity
          onPress={goBack} style={s.backTopLeft} activeOpacity={0.6} hitSlop={12}
          accessibilityRole="button" accessibilityLabel={txt("auth.a11y.back", "Back")}
        >
          <Back />
        </TouchableOpacity>
      )}

      {/* edge-swipe-back zone — only on the code step */}
      {onCode ? edgeZone : null}
    </Animated.View>
    </AuthFlowProvider>
  );
}
