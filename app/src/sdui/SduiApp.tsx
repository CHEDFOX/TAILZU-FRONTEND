/**
 * The Tulmi app shell — a GENERIC renderer. It boots from the server, draws the
 * server's navigation + screens, and runs the server's actions. The only
 * client-local screen is Connection (you need it to reach the server at all).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  I18nManager,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Updates from "expo-updates";
import { bootstrap, fetchScreen, syncKeyboardCredentials, callEndpoint, APP_VERSION } from "./client";
import { RenderNode } from "./Renderer";
import { ThemeContext } from "./components";
import { Store } from "./state";
import { composeTemplate } from "./templates";
import { runAction } from "./actions";
import type { Ctx, NavApi } from "./actions";
import type { ActionSpec, BootstrapResponse, ScreenResponse, ThemeTokens, UpdateGate } from "./types";
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl, getLanguage, setLanguage, getProfileDone } from "../storage";
import { setMediaRegistry, pickMediaRegistry } from "../media/resolveMedia";
import * as api from "../api";
import AuthGateScreen from "../auth/AuthGateScreen";
import LanguageSelectScreen from "../onboarding/LanguageSelectScreen";
import ProfileGate from "../onboarding/ProfileGate";
import {
  getKeyboardStatus,
  consumeKeyboardDeepLink,
  writeAppWarmHeartbeat,
  consumeKeyboardRecordRequest,
  armFlowSession,
} from "../../modules/tulmi-bridge";
import { supabaseAuth, getSupabaseAccessToken } from "../auth/supabaseClient";
import { useEdgeSwipeBack, resolveEdgeSwipe } from "./gestures";
import { SUPABASE_CONFIGURED } from "../auth/supabaseConfig";
import { initAnalytics } from "../telemetry/analytics";
import { initSentry } from "../telemetry/sentry";
import { initBilling, restorePurchases, isBillingEnabled, hasEntitlement } from "../billing/purchases";
import { registerForPushToken, addNotificationResponseListener } from "../notifications/push";
import { installLinkListener } from "../deeplinks/router";

interface NavItem { screenId: string; params?: Record<string, any> }
interface Toast { message: string; tone?: string }

/**
 * Action `kind`s a `tulmi://action?kind=…` deep link is allowed to trigger.
 * Kept to a small, side-effect-safe set: an arbitrary/unknown kind from a URL
 * is ignored, never dispatched. These take no complex object params, so the
 * URL query (`Record<string,string>`) maps straight onto the ActionSpec.
 */
const DEEPLINK_ACTIONS = new Set<string>([
  "iap.restore",
  "iap.showPaywall",
  "requestReview",
  "openSettings",
]);

/**
 * Apply the layout direction the backend asked for (RTL for Arabic/Hebrew/…).
 * React Native only flips layout after a reload, so when the direction actually
 * changes we force it and restart the bundle. It's a no-op when already correct,
 * so this never loops.
 */
async function applyDirection(flags?: Record<string, any>): Promise<boolean> {
  const wantRTL = flags?.textDirection === "rtl";
  if (I18nManager.isRTL === wantRTL) return false;
  try {
    I18nManager.allowRTL(wantRTL);
    I18nManager.forceRTL(wantRTL);
    await Updates.reloadAsync(); // restart so the new direction takes effect
  } catch {
    // Expo Go / no updates runtime: direction applies on the next launch.
  }
  return true;
}

export default function SduiApp() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "connect" | "auth" | "language">("loading");
  const [tabId, setTabId] = useState("");
  const [stack, setStack] = useState<NavItem[]>([]);
  const [screen, setScreen] = useState<ScreenResponse | null>(null);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // Whether the post-onboarding name + gender card is done (loaded from storage;
  // default true so it never flashes before we know).
  const [profileDone, setProfileDoneState] = useState(true);

  useEffect(() => { getProfileDone().then(setProfileDoneState).catch(() => {}); }, []);

  // A deep-link / push-notification screen target that arrived DURING cold boot,
  // before loadBoot committed the first stack. Stashed here and applied once we
  // reach "ready" (cold-entry effect below) so the default [home] stack can't
  // clobber it. Mirrors how consumeKeyboardEntry defers keyboard cold-starts.
  const pendingLinkRef = useRef<NavItem | null>(null);
  // True once phase === "ready": lets the mount-once link listener apply a HOT
  // link immediately, vs. stashing a COLD one for the cold-entry effect.
  const readyRef = useRef(false);
  // Set once nav/boot exist (effect below). Lets the mount-once link listener
  // dispatch `{kind:"action"}` deep links without capturing a stale nav/flags.
  const runLinkActionRef = useRef<(kind: string, params?: Record<string, string>) => void>(() => {});

  // One-time boot: crash reporting, analytics, IAP, push token, deep links.
  // Each init is a silent no-op when its env key is unset, so the same binary
  // works for dev/beta/prod builds without code changes.
  useEffect(() => {
    initSentry();
    void initAnalytics();
    void initBilling();
    void registerForPushToken();
    // Warm heartbeat — tells the keyboard extension "the main app is alive
    // right now, handoff will be fast". Bumped on every foreground below;
    // this initial call covers cold starts.
    writeAppWarmHeartbeat();
    const linkSub = installLinkListener((target) => {
      if (target.kind === "screen") {
        const item: NavItem = { screenId: target.screenId, params: target.params };
        // Hot link (app already booted) → navigate now. Cold link (arrived
        // mid-boot) → stash; the cold-entry effect applies it after the first
        // stack commits, so loadBoot's default screen doesn't win the race.
        if (readyRef.current) setStack([item]);
        else pendingLinkRef.current = item;
      } else if (target.kind === "action") {
        // `tulmi://action?kind=…` — run a bare action (guarded whitelist).
        runLinkActionRef.current(target.actionKind, target.params);
      }
    });
    const notifSub = addNotificationResponseListener((data) => {
      if (!data?.screenId) return;
      const item: NavItem = { screenId: String(data.screenId), params: data };
      if (readyRef.current) setStack([item]);
      else pendingLinkRef.current = item;
    });
    return () => { linkSub(); notifSub.remove(); };
  }, []);

  const showToast = useCallback((message: string, tone?: string) => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const loadBoot = useCallback(async () => {
    setPhase("loading");
    try {
      const b = await bootstrap();
      // If the user's language flips the layout direction, this restarts the
      // app — so do it before we commit the rest of the boot state.
      if (await applyDirection(b.flags)) return;
      setBoot(b);
      // Publish the current media registry to the resolver so every <Media>
      // component in the tree can look up keys → URLs synchronously. Runs on
      // every bootstrap so hot registry pushes take effect on the next refresh.
      setMediaRegistry(pickMediaRegistry(b));
      const firstTab = b.navigation.kind === "tabs" ? b.navigation.tabs[0]?.id ?? "" : "";
      setTabId(firstTab);
      setShowConnection(false);
      // Hand the keyboard the live backend URL + user token.
      void syncKeyboardCredentials();

      // First screen after auth. Every routing decision goes through
      // backend flags — the client no longer hardcodes screen ids or
      // branches on their string values.
      //
      // Backend controls:
      //   flags["needsLanguagePick"]     bool — should the native language
      //                                    step run before initialScreenId?
      //   flags["postLanguageScreenId"]  str  — screen to render after the
      //                                    language step commits.
      const needsLanguagePick = boot?.flags?.["needsLanguagePick"] === true
        || b.flags?.["needsLanguagePick"] === true;
      const langPicked = !!(await getLanguage());
      if (needsLanguagePick && !langPicked) {
        setPhase("language");
        return;
      }
      const postLangScreenId =
        (b.flags?.["postLanguageScreenId"] as string | undefined) ?? b.initialScreenId;
      const firstScreenId = needsLanguagePick ? postLangScreenId : b.initialScreenId;

      // Paywall gate — backend requests it via flags. Two triggers:
      //   paywall.blockUntilEntitled  hard-gate every launch until unlocked
      //   paywall.showAfterOnboarding show once after onboarding completes
      // Both look up hasEntitlement(flags["paywall.entitlement"]) so RevenueCat
      // owns the truth. When lacking, we push "paywall" onto the stack on top
      // of the first screen so back-nav lands the user in the app naturally.
      const paywallEnt = String(b.flags?.["paywall.entitlement"] ?? "");
      const paywallBlock = b.flags?.["paywall.blockUntilEntitled"] === true;
      const paywallAfterOnboarding = b.flags?.["paywall.showAfterOnboarding"] === true;
      const lacksEntitlement =
        !!paywallEnt && isBillingEnabled() && !hasEntitlement(paywallEnt);
      const shouldShowPaywall =
        lacksEntitlement && (paywallBlock || paywallAfterOnboarding);

      if (shouldShowPaywall) {
        // blockUntilEntitled is a HARD gate — make the paywall the SOLE stack
        // entry so back / edge-swipe has nothing to pop to (pushing it on top of
        // home let the user swipe past it into the full app). The softer
        // showAfterOnboarding paywall stays dismissible (sits on top of home).
        setStack(
          paywallBlock
            ? [{ screenId: "paywall" }]
            : [{ screenId: firstScreenId }, { screenId: "paywall" }],
        );
      } else {
        setStack([{ screenId: firstScreenId }]);
      }
      setPhase("ready");
    } catch {
      setPhase("connect");
    }
  }, []);

  // Language chosen on the post-auth screen → persist it to the profile, THEN
  // re-bootstrap so everything (bootstrap labels + every screen the app fetches)
  // comes back from the backend translated into the selected language — exactly
  // like Plutto. We await the profile write first so the next bootstrap/screen
  // is localized, not raced. loadBoot then routes on to the keyboard step.
  const onLanguageSelect = useCallback(async (code: string) => {
    await setLanguage(code);
    setPhase("loading");
    try {
      await callEndpoint("PUT", "/v1/profile", { language: code });
    } catch {
      /* best-effort: even if the write fails, fall through and continue */
    }
    await loadBoot();
  }, [loadBoot]);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // Gate on auth first: the app needs a JWT to talk to the backend.
      const { data: { session } } = await supabaseAuth.getSession();
      if (SUPABASE_CONFIGURED && !session) setPhase("auth");
      else await loadBoot();
      // React to sign-out from anywhere (e.g. Settings → Sign out), and — just
      // as important — re-share the freshest JWT with the keyboard extension on
      // every session change. The keyboard reads a token SNAPSHOT from the
      // shared Keychain and cannot refresh Supabase itself, so without this its
      // copy goes stale ~1h after the last app open and every dictation 401s.
      // Supabase's autoRefreshToken fires TOKEN_REFRESHED before expiry; this
      // handler forwards each refresh straight to the keyboard.
      const { data: { subscription } } = supabaseAuth.onAuthStateChange((_e, s) => {
        if (!s && SUPABASE_CONFIGURED) { setPhase("auth"); return; }
        if (s) void syncKeyboardCredentials();
      });
      unsub = () => subscription.unsubscribe();
    })();
    return () => unsub();
  }, [loadBoot]);

  const current = stack[stack.length - 1];

  // Fetch the current screen whenever the top of the stack (or reload) changes.
  // On failure we surface a visible error state with a retry button instead of
  // silently keeping the previous (or empty) screen — the old behavior looked
  // identical to a successful empty render, which is what surfaced as "Home
  // and Settings are blank" in the field.
  useEffect(() => {
    if (phase !== "ready" || !current) return;
    let alive = true;
    setScreenLoading(true);
    setScreenError(null);
    fetchScreen(current.screenId, current.params)
      .then((s) => {
        if (!alive) return;
        setScreen(s);
        setScreenError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // We DON'T reset `screen` to null on error — if the user had a valid
        // previous render we keep it visible and layer the retry banner on
        // top. Only when there was NEVER a successful load do we render a
        // full-screen error card (handled in the render section below).
        const msg = err instanceof Error ? err.message : "Couldn't load screen";
        setScreenError(msg);
      })
      .finally(() => alive && setScreenLoading(false));
    return () => {
      alive = false;
    };
  }, [phase, current, reload]);

  // Latest boot in a ref so the AppState listener (deps: [phase]) can read the
  // current home screen id without re-subscribing on every foreground refetch.
  const bootRef = useRef(boot);
  useEffect(() => { bootRef.current = boot; }, [boot]);

  // Consume whatever the keyboard extension left in the shared App Group (a mic
  // "handoff" record request or a deep-link tombstone) and route / arm from it.
  // Returns "record" (routed to the mic-record screen), "navigated" (routed via
  // a deep link, e.g. Flow arm), or "none". Shared by BOTH the cold-start path
  // and the foreground AppState path: the keyboard can COLD-LAUNCH a terminated
  // app (or one iOS killed in the background), and on a cold launch the AppState
  // "change→active" event never fires — so without a cold-start caller, a Flow
  // "arm" tombstone is never consumed, armFlowSession never runs, the session
  // never arms, and the keyboard mic just re-opens the app forever.
  const consumeKeyboardEntry = useCallback((): "record" | "navigated" | "none" => {
    const rec = consumeKeyboardRecordRequest();
    if (rec) {
      // Fresh mic handoff. Drain the PAIRED deep-link tombstone too, so it can't
      // re-open the record screen on a later, unrelated foreground.
      consumeKeyboardDeepLink();
      setStack([{
        screenId: "keyboard_record",
        params: { session: rec.sessionId, host: rec.hostApp, source: "keyboard" },
      }]);
      return "record";
    }
    const pending = consumeKeyboardDeepLink();
    if (!pending) return "none";
    if (pending === "openSettings") {
      Linking.openSettings().catch(() => {});
      return "none";
    }
    if (pending.startsWith("screen/")) {
      const screenId = pending.slice("screen/".length);
      if (screenId === "flow_arm") {
        // Flow Session arming: the keyboard opened us here to turn the background
        // mic on. Arm it deterministically (idle window backend-tunable via
        // kb.flow.idleTimeoutMs) AND route to the backend-authored "swipe back"
        // arming screen (whose onAppear re-arms too — arm() is idempotent).
        void (async () => {
          const [base, tok, lang] = await Promise.all([
            getBaseUrl(), getSupabaseAccessToken(), getLanguage(),
          ]);
          const idle = Number(bootRef.current?.flags?.["kb.flow.idleTimeoutMs"] ?? 300000);
          armFlowSession(base, tok ?? "dev", lang || "auto", idle);
        })();
        setStack([{ screenId: "flow_arm" }]);
        return "navigated";
      }
      if (screenId && screenId !== "keyboard_record" && screenId !== "keyboard_primer") {
        // keyboard_record / keyboard_primer are mic-tap-only (owned by the
        // record-request path above); a leftover deep-link to them is stale.
        setStack([{ screenId }]);
        return "navigated";
      }
    }
    return "none";
  }, []);

  // Cold-start keyboard entry — runs ONCE, the first time we reach "ready". The
  // AppState listener below only fires on a background→foreground transition, so
  // a terminated app cold-launched by the keyboard would otherwise never arm.
  const coldEntryDone = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || coldEntryDone.current) return;
    coldEntryDone.current = true;
    const entry = consumeKeyboardEntry();
    // A deep link / push tap that arrived during cold boot was stashed above
    // (loadBoot's default [home] stack would otherwise clobber it). Apply it
    // now — unless a keyboard entry (mic handoff / flow arm) already claimed
    // this cold start, in which case the keyboard target wins.
    if (entry === "none" && pendingLinkRef.current) {
      setStack([pendingLinkRef.current]);
    }
    pendingLinkRef.current = null;
  }, [phase, consumeKeyboardEntry]);

  // Refetch bootstrap + current screen when the app returns to the foreground
  // — so a user who left the app open, backgrounded it for hours, and comes
  // back doesn't stare at stale UI. Also picks up a bumped cacheVersion.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Warm heartbeat is safe to bump before we're "ready" — it lets the
      // keyboard treat the app as reachable even during the boot/loading
      // phase.
      writeAppWarmHeartbeat();
      // Every foreground is a chance to hand the keyboard a fresh token, so a
      // user who taps the keyboard right after opening the app never hits an
      // expired-JWT 401. Cheap + best-effort; safe before "ready".
      void syncKeyboardCredentials();
      if (phase !== "ready") return;
      // Consume whatever the keyboard left (mic-handoff record request or a
      // deep-link tombstone — it can't call openURL itself, so it drops a target
      // in the shared App Group). Handle it before the boot refresh so the user
      // lands on the right screen if they came here via a keyboard action. Same
      // path the cold-start effect above uses.
      const entry = consumeKeyboardEntry();
      if (entry === "record") return;   // mic handoff owns the foreground; skip the reset + refetch
      const navigatedThisForeground = entry === "navigated";
      // Safety net: if we're lingering on a transient mic screen from a PREVIOUS
      // session (recorded/armed, swiped back to the keyboard, now opening the app
      // normally) and we did NOT just navigate there this foreground, reset to
      // home. These screens must never be what a normal app open shows.
      if (!navigatedThisForeground) {
        setStack((prev) => {
          const topId = prev[prev.length - 1]?.screenId;
          if (topId === "keyboard_record" || topId === "keyboard_primer" || topId === "flow_arm") {
            const home = bootRef.current?.initialScreenId;
            if (home) return [{ screenId: home }];
          }
          return prev;
        });
      }
      // Force a bootstrap re-fetch (cheap, no-store on the backend), then
      // re-fetch the current screen via the standard reload counter.
      (async () => {
        try {
          const b = await bootstrap();
          setBoot((prev) => {
            // If cacheVersion changed, the whole screen cache is stale — bump
            // reload so the current screen refetches. Otherwise still update
            // theme/labels but don't force screen work.
            if (prev?.cacheVersion !== b.cacheVersion) {
              setReload((n) => n + 1);
            }
            return b;
          });
        } catch {
          /* offline / transient — user's next interaction retries */
        }
      })();
    });
    return () => sub.remove();
  }, [phase, consumeKeyboardEntry]);

  const nav: NavApi = useMemo(
    () => ({
      push: (screenId, params) => setStack((s) => [...s, { screenId, params }]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      switchTab: (id) => {
        if (boot?.navigation.kind !== "tabs") return;
        const tab = boot.navigation.tabs.find((t) => t.id === id);
        if (!tab) return;
        setTabId(id);
        setStack([{ screenId: tab.screenId }]);
      },
      reloadCurrent: () => setReload((n) => n + 1),
      refreshLocale: () => {
        // Re-pull bootstrap so labels + direction reflect the new language,
        // then re-fetch the current screen in place (stack is preserved).
        (async () => {
          try {
            const b = await bootstrap();
            if (await applyDirection(b.flags)) return; // RTL change → app restarts
            setBoot(b);
            setReload((n) => n + 1);
          } catch {
            /* keep current UI if the refresh fails */
          }
        })();
      },
    }),
    [boot],
  );

  // Keep the mount-once deep-link listener reading fresh values: readiness (so a
  // hot link applies immediately while a cold one stashes) and the action
  // dispatcher (so it uses the current nav + flags, not the initial ones).
  useEffect(() => { readyRef.current = phase === "ready"; }, [phase]);
  useEffect(() => {
    runLinkActionRef.current = (kind, params) => {
      // Only known, side-effect-safe kinds may be triggered from a URL; anything
      // else is ignored (never dispatched) so a crafted link can't run arbitrary
      // actions or crash the app.
      if (!DEEPLINK_ACTIONS.has(kind)) return;
      const action = { kind, ...(params ?? {}) } as unknown as ActionSpec;
      void runAction(action, {
        store: new Store({}),
        actions: {},
        flags: boot?.flags ?? {},
        labels: boot?.labels ?? {},
        nav,
        toast: showToast,
      });
    };
  }, [boot, nav, showToast]);

  const theme: ThemeTokens | null = useMemo(() => {
    if (!boot) return null;
    if (!screen?.theme) return boot.theme;
    return { ...boot.theme, color: { ...boot.theme.color, ...(screen.theme.color ?? {}) } };
  }, [boot, screen]);

  // Edge-swipe-back: a general, backend-driven capability (src/sdui/gestures).
  // Swiping right from the left edge pops the nav stack. Called unconditionally
  // (before any early return) so hook order stays stable; the zone only renders
  // when there's somewhere to go back to and the backend hasn't disabled it.
  const { edgeZone } = useEdgeSwipeBack(
    stack.length > 1 ? nav.back : null,
    resolveEdgeSwipe(boot?.flags),
  );

  // --- Render states --------------------------------------------------------

  if (phase === "auth") {
    return <AuthGateScreen onAuthed={loadBoot} />;
  }

  if (phase === "language") {
    return (
      <LanguageSelectScreen
        onSelect={onLanguageSelect}
        languages={boot?.languages}
        bg={boot?.theme?.color?.bg}
        text={boot?.theme?.color?.text}
        borderColor={boot?.theme?.color?.border}
      />
    );
  }

  if (phase === "connect" || showConnection) {
    return (
      <ConnectionScreen
        onDone={loadBoot}
        onCancel={boot ? () => setShowConnection(false) : undefined}
      />
    );
  }

  // Hold the quiet splash background until the FIRST screen has actually loaded.
  // Without the `!screen` guard, the instant bootstrap finished (phase "ready")
  // but before the intro screen's fetch returned, `hideChrome` was false (it
  // reads screen?.hideChrome, and screen is still null) — so the app painted its
  // header + Home/You tab bar for a frame or two, THEN the full-bleed intro
  // screen loaded and hid them. That chrome flash was the "main app glimpse
  // before the intro plays". Gating on `!screen` keeps the splash bg (no chrome)
  // through that gap so it blends straight into the intro. A screenError still
  // falls through below to the retry card.
  if (phase === "loading" || !theme || (!screen && !screenError)) {
    // Splash colors + label route through boot.theme + boot.labels when they
    // land; the hardcoded values here are the ONLY fallback for the pre-boot
    // moment (bootstrap hasn't returned yet). Backend cannot change these.
    const splashBg = boot?.theme?.color?.bg ?? "#000000";
    // No spinner on app start — just the splash background, which blends with
    // the native splash screen for a clean, quiet boot.
    return <View style={[styles.center, { backgroundColor: splashBg }]} />;
  }


  const canGoBack = stack.length > 1;
  const tabs = boot?.navigation.kind === "tabs" ? boot.navigation.tabs : [];

  // Version gate: backend can force or suggest an app update.
  const update = boot?.update;
  const below = (v?: string) => !!v && cmpVersion(APP_VERSION, v) < 0;
  const updateForced = !!update && below(update.minVersion);
  const updateOptional = !updateForced && !!update && below(update.latestVersion) && !updateDismissed;

  // Backend can request full-bleed rendering per-screen (intro slideshow,
  // paywall walkthrough, splash-adjacent). When set, hide header + tabs
  // and let the screen's root fill the whole window.
  const hideChrome = screen?.hideChrome === true;

  return (
    <View style={[styles.app, { backgroundColor: theme.color.bg }]}>
      {!hideChrome && (
        <View style={styles.header}>
          {canGoBack ? (
            <Pressable onPress={nav.back} hitSlop={10}>
              <Text style={[styles.headerIcon, { color: theme.color.text }]}>‹</Text>
            </Pressable>
          ) : (
            <Text style={[styles.brand, { color: theme.color.text, flex: 1 }]} numberOfLines={1}>{screen?.title ?? boot?.labels?.["app.name"] ?? "Tailzu"}</Text>
          )}
          {canGoBack && <Text style={[styles.brand, { color: theme.color.text, flex: 1, marginLeft: 8 }]} numberOfLines={1}>{screen?.title ?? ""}</Text>}
          {/* Settings gear — top-right on the tab roots (Home / You). Opens the
              Settings screen (pushed, with a back arrow). Replaces the old dev
              "Connection" entry, and stands in for the removed Settings tab.
              Hidden on pushed screens, where the back arrow + title own the bar. */}
          {!canGoBack && (
            <Pressable onPress={() => nav.push("settings")} hitSlop={10}>
              <Text style={[styles.headerIcon, { color: theme.color.muted }]}>⚙</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={{ flex: 1 }}>
        {screen ? (
          <ThemeContext.Provider value={theme}>
            <ScreenHost screen={screen} nav={nav} flags={boot?.flags ?? {}} labels={boot?.labels ?? {}} toast={showToast} />
          </ThemeContext.Provider>
        ) : screenError ? (
          // Never-loaded-once + failure: render a real error card with a
          // Retry button. The old behavior showed a spinner or nothing at
          // all, which read as "the app is broken."
          <View style={[styles.center, { paddingHorizontal: 24 }]}>
            <Text style={{ color: theme.color.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
              {boot?.labels?.["error.screenTitle"] ?? "Couldn't load this screen"}
            </Text>
            <Text style={{ color: theme.color.muted, textAlign: "center", marginBottom: 20 }}>
              {screenError}
            </Text>
            <Pressable
              onPress={() => setReload((n) => n + 1)}
              style={{ backgroundColor: theme.color.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28 }}
            >
              <Text style={{ color: theme.color.bg, fontWeight: "700" }}>
                {boot?.labels?.["action.retry"] ?? "Retry"}
              </Text>
            </Pressable>
          </View>
        ) : (
          // No spinner while the first screen loads — a quiet themed bg, so the
          // intro media isn't preceded by a spinner flash on app start.
          <View style={[styles.center, { backgroundColor: theme.color.bg }]} />
        )}
        {/* Screen-loaded-but-refresh-failed: keep the stale render visible
            and layer a small tap-to-retry banner at the top so the user
            knows the content is stale. */}
        {screen && screenError && (
          <Pressable
            onPress={() => setReload((n) => n + 1)}
            style={{
              position: "absolute", top: 0, left: 0, right: 0,
              backgroundColor: theme.color.errorBanner ?? "#3a1417",
              paddingVertical: 10, alignItems: "center",
            }}
          >
            <Text style={{ color: theme.color.errorBannerText ?? "#fff", fontWeight: "600" }}>
              {boot?.labels?.["error.refreshBanner"] ?? "Couldn't refresh — tap to retry"}
            </Text>
          </Pressable>
        )}
        {screenLoading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={theme.color.primary} />
          </View>
        )}
      </View>

      {!hideChrome && tabs.length > 0 && (
        <View style={[styles.tabs, { backgroundColor: theme.color.surface, borderTopColor: theme.color.border }]}>
          {tabs.map((t) => {
            const active = t.id === tabId;
            return (
              <Pressable key={t.id} style={styles.tab} onPress={() => nav.switchTab(t.id)}>
                <Text style={{ color: active ? theme.color.text : theme.color.muted, fontWeight: active ? "700" : "400" }}>
                  {t.title}
                </Text>
                {active && <View style={[styles.tabUnderline, { backgroundColor: theme.color.primary }]} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {toast && (
        <View style={[styles.toast, {
          backgroundColor:
            toast.tone === "error"   ? (theme.color.toastError   ?? "#3a1417")
          : toast.tone === "success" ? (theme.color.toastSuccess ?? "#13301a")
          :                            (theme.color.toastInfo    ?? "#1c1c25"),
        }]}>
          <Text style={{ color: theme.color.toastText ?? "#fff" }}>{toast.message}</Text>
        </View>
      )}

      {(updateForced || updateOptional) && update && (
        <UpdateGateOverlay
          info={update}
          forced={updateForced}
          theme={theme}
          labels={boot?.labels ?? {}}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}

      {/* Backend-driven edge-swipe-back zone (left edge). Rendered last so it
          sits above the screen content; null when there's no back / disabled. */}
      {edgeZone}

      {/* Post-onboarding name + gender card — blurs the screen behind it
          until name + gender are set. Backend decides which screens the
          gate can appear on via flags["profileGate.screenIds"]; falls
          back to "home" only for backward-compat with old bootstrap. */}
      {!profileDone && shouldShowProfileGate(current?.screenId, boot?.flags) && (
        <ProfileGate
          onDone={() => setProfileDoneState(true)}
          mediaUri={typeof boot?.flags?.["profileCard.media"] === "string" ? (boot.flags["profileCard.media"] as string) : undefined}
        />
      )}
    </View>
  );
}

/** Compare dotted versions: returns <0, 0, >0. */
/**
 * Whether the ProfileGate overlay should render given the current screen.
 * Backend controls via `flags["profileGate.screenIds"]` (array of screen
 * ids). When unset, falls back to only "home" so old backends still work.
 */
function shouldShowProfileGate(
  currentScreenId: string | undefined,
  flags: Record<string, unknown> | undefined,
): boolean {
  if (!currentScreenId) return false;
  const allowed = flags?.["profileGate.screenIds"];
  if (Array.isArray(allowed)) return allowed.includes(currentScreenId);
  return currentScreenId === "home";
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Backend-driven update screen: a hard blocker (forced) or a dismissible nudge. */
function UpdateGateOverlay({
  info,
  forced,
  theme,
  labels,
  onDismiss,
}: {
  info: UpdateGate;
  forced: boolean;
  theme: ThemeTokens;
  labels: Record<string, string>;
  onDismiss: () => void;
}) {
  const storeUrl = info.url?.[Platform.OS === "ios" ? "ios" : "android"] ?? info.url?.default;
  return (
    <View style={[StyleSheet.absoluteFill, {
      backgroundColor: theme.color.updateOverlay ?? "rgba(8,8,12,0.96)",
      alignItems: "center", justifyContent: "center", padding: 28,
    }]}>
      <Text style={{ color: theme.color.text, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 10 }}>
        {info.title ?? labels["updateGate.title"] ?? "Update available"}
      </Text>
      <Text style={{ color: theme.color.muted, fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 22 }}>
        {info.message ?? labels["updateGate.message"] ?? "A new version is available."}
      </Text>
      <Pressable
        onPress={() => storeUrl && Linking.openURL(storeUrl)}
        style={{ backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: 14, paddingHorizontal: 28, minWidth: 200, alignItems: "center" }}
      >
        <Text style={{ color: theme.color.primaryText ?? "#fff", fontWeight: "700", fontSize: 15 }}>
          {info.cta ?? labels["updateGate.cta"] ?? "Update now"}
        </Text>
      </Pressable>
      {!forced && (
        <Pressable onPress={onDismiss} style={{ marginTop: 14 }}>
          <Text style={{ color: theme.color.muted }}>
            {labels["updateGate.dismiss"] ?? "Not now"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Builds the per-screen Store + Ctx and renders the node tree. */
function ScreenHost({
  screen,
  nav,
  flags,
  labels,
  toast,
}: {
  screen: ScreenResponse;
  nav: NavApi;
  flags: Record<string, any>;
  labels: Record<string, string>;
  toast: (m: string, tone?: string) => void;
}) {
  const store = useMemo(() => new Store(screen.state ?? {}), [screen]);
  const ctx: Ctx = { store, actions: screen.actions ?? {}, flags, labels, nav, toast };

  // Inject live device signals into screen state so the BACKEND can gate on them
  // declaratively (e.g. only show the "continue" button when the keyboard has
  // Full Access): $state.keyboardReady / $state.keyboardEnabled. No bridge
  // (Expo Go) → report ready so nothing is ever blocked in development. Polls
  // while not-yet-ready and re-checks when the app returns from Settings.
  useEffect(() => {
    let stop = false;
    // `iv` MUST be declared before sync() runs: the first synchronous sync()
    // call below can hit `clearInterval(iv)` (when the keyboard already has
    // Full Access), and a `const iv` declared afterward would be in its
    // temporal dead zone → ReferenceError under Hermes, crashing the app on
    // mount for exactly the users who completed keyboard setup.
    let iv: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      const s = getKeyboardStatus();
      store.set("keyboardEnabled", s ? s.enabled : true);
      store.set("keyboardReady", s ? s.fullAccess : true);
      if (s && s.fullAccess) { stop = true; if (iv) clearInterval(iv); }
    };
    sync();
    iv = setInterval(() => { if (!stop) sync(); }, 1500);
    const subAS = AppState.addEventListener("change", (st) => { if (st === "active") sync(); });
    return () => { if (iv) clearInterval(iv); subAS.remove(); };
  }, [store]);

  // A screen is either a full `root` tree, or a named `template` + `blocks`.
  const root = screen.root ?? composeTemplate(screen);
  return <RenderNode node={root} ctx={ctx} />;
}

// --- Connection (client-local; needed to reach the server) ------------------

function ConnectionScreen({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [restoreState, setRestoreState] = useState<"idle" | "running" | "done" | "off">(
    isBillingEnabled() ? "idle" : "off",
  );

  useEffect(() => {
    getBaseUrl().then((u) => {
      setUrl(u);
      setLoaded(true);
    });
  }, []);

  async function test() {
    setStatus("Checking…");
    try {
      await setBaseUrl(url);
      const h = await api.health();
      setStatus(`OK — ${h.service} v${h.version}`);
    } catch (e: any) {
      setStatus("Cannot reach backend: " + e.message);
    }
  }

  async function connect() {
    await setBaseUrl(url);
    onDone();
  }

  // Apple 3.1.1 requires an always-accessible restore path independent of the
  // server. This lives in the native shell so it's reachable even when the
  // backend is unreachable and every SDUI screen is empty.
  async function restore() {
    setRestoreState("running");
    try {
      await restorePurchases();
    } finally {
      setRestoreState("done");
    }
  }

  return (
    <View style={[styles.app, { backgroundColor: "#0e0e12", padding: 16, paddingTop: 64 }]}>
      <Text style={[styles.brand, { color: "#fff", marginBottom: 16 }]}>Connection</Text>
      <Text style={{ color: "#cfcfe0", marginBottom: 6 }}>Backend URL</Text>
      <TextInput
        value={loaded ? url : ""}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://10.0.2.2:8770 or https://your-vps"
        placeholderTextColor="#8a8a96"
        style={styles.input}
      />
      <Text style={{ color: "#8a8a96", fontSize: 13, marginTop: 8 }}>
        Emulator → your PC = http://10.0.2.2:8770. Physical phone → your PC's LAN IP, or your VPS URL.
      </Text>
      <View style={{ height: 16 }} />
      <Pressable style={[styles.btn, { backgroundColor: "#FFFFFF" }]} onPress={connect}>
        <Text style={[styles.btnText, { color: "#000000" }]}>Connect</Text>
      </Pressable>
      <View style={{ height: 8 }} />
      <Pressable style={[styles.btn, { backgroundColor: "#3a3a44" }]} onPress={test}>
        <Text style={styles.btnText}>Test connection</Text>
      </Pressable>
      {onCancel && (
        <>
          <View style={{ height: 8 }} />
          <Pressable style={[styles.btn, { backgroundColor: "transparent" }]} onPress={onCancel}>
            <Text style={[styles.btnText, { color: "#8a8a96" }]}>Cancel</Text>
          </Pressable>
        </>
      )}
      {!!status && <Text style={{ color: "#9b9bd0", marginTop: 12 }}>{status}</Text>}

      {restoreState !== "off" && (
        <>
          <View style={{ height: 24, borderBottomWidth: 1, borderBottomColor: "#2a2a36" }} />
          <Text style={{ color: "#cfcfe0", marginTop: 20, marginBottom: 6, fontWeight: "600" }}>
            Subscription
          </Text>
          <Pressable
            style={[styles.btn, { backgroundColor: "#2a2a36" }]}
            onPress={restore}
            disabled={restoreState === "running"}
          >
            <Text style={styles.btnText}>
              {restoreState === "running" ? "Restoring…" : "Restore Purchases"}
            </Text>
          </Pressable>
          {restoreState === "done" && (
            <Text style={{ color: "#9b9bd0", marginTop: 10, fontSize: 13 }}>
              Restore complete. If your subscription was on this Apple ID, it's active again.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16 },
  brand: { fontSize: 22, fontWeight: "800" },
  headerIcon: { fontSize: 24, fontWeight: "700" },
  tabs: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabUnderline: { height: 2, width: 28, borderRadius: 2, marginTop: 6 },
  loadingOverlay: { position: "absolute", top: 8, right: 16 },
  toast: { position: "absolute", left: 16, right: 16, bottom: 76, padding: 14, borderRadius: 10 },
  input: {
    backgroundColor: "#1c1c25", color: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44, borderWidth: 1, borderColor: "#2a2a36",
  },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
