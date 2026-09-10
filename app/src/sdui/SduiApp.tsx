/**
 * The Tulmi app shell — a GENERIC renderer. It boots from the server, draws the
 * server's navigation + screens, and runs the server's actions. The only
 * client-local screen is Connection (you need it to reach the server at all).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { bootstrap, peekBootstrap, hydrateScreenCache, fetchScreen, peekScreen, invalidateScreens, prefetchScreens, refreshCachedScreens, reportUpdateCheck, syncKeyboardCredentials, callEndpoint, APP_VERSION } from "./client";
import {
  TabThreadIcon, SettingsLines, ThreadRail, THREAD_ACTIVE, THREAD_RAIL_HEIGHT,
} from "./ThreadIcons";
import { loadRemoteFonts } from "./remoteFonts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RenderNode } from "./Renderer";
import { ThemeContext, typeRole } from "./components";
import { Store } from "./state";
import { composeTemplate } from "./templates";
import { runAction } from "./actions";
import type { Ctx, NavApi } from "./actions";
import type { ActionSpec, BootstrapResponse, LaunchCard, ScreenResponse, ThemeTokens, UpdateGate } from "./types";
import { hasSeenCard, markCardSeen } from "./launchCard";
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl, getLanguage, setLanguage, getProfileDone, isFreshInstall } from "../storage";
import { setMediaRegistry, pickMediaRegistry } from "../media/resolveMedia";
import { refreshDeviceSignals, refreshDeviceSignalsBounded } from "../device/signals";
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
import { initBilling, identifyBilling, restorePurchases, isBillingEnabled, hasEntitlement } from "../billing/purchases";
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

/**
 * The device's language, when it is one Tailzu supports.
 *
 * Region is dropped ("hi-IN" → "hi"): the choice drives recognition and
 * writing, where the language matters and the region does not. An
 * unsupported language returns null and the user stays on "auto".
 */
const SUPPORTED_SYSTEM_LANGUAGES = new Set([
  "hi", "mr", "ta", "te", "bn", "gu", "pa", "kn", "ml", "ur",
  "en", "es", "fr", "de", "pt", "ar", "ja", "ko", "zh", "ru",
]);

function inferSystemLanguage(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Localization = require("expo-localization");
    const tag = Localization.getLocales?.()?.[0]?.languageCode;
    const code = String(tag ?? "").trim().toLowerCase().split("-")[0];
    return SUPPORTED_SYSTEM_LANGUAGES.has(code) ? code : null;
  } catch {
    return null;   // module absent — the user keeps "auto"
  }
}

/**
 * How long the splash may wait for the first screen's picture to arrive.
 *
 * A cached file resolves in milliseconds. This is the ceiling for the case
 * where it does not — a cold install on a bad connection — because a splash
 * that waits forever is worse than the black it was holding back.
 */
const SPLASH_MEDIA_WAIT_MS = 1500;

/**
 * How long a FIRST run may hold the splash while it fetches what the opening
 * needs — the intro's animation and the onboarding screen's art.
 *
 * Longer than the returning-user budget on purpose. A first launch has an
 * empty cache and one chance to make the opening look composed; the
 * alternative is not "faster", it is watching each piece pop in one at a time
 * across the first three screens. It is still a ceiling, not a promise: when
 * it expires the app opens regardless.
 */
const FIRST_RUN_MEDIA_WAIT_MS = 4500;

/** How often to refresh cached screens while the app is open and in front. */
const LIVE_REFRESH_MS = 5 * 60_000;

/**
 * How long the whole boot may take before the app stops waiting and offers a
 * retry instead. Generous: a slow connection on a cold start legitimately takes
 * seconds, and interrupting a boot that would have worked is its own bug. What
 * this catches is the boot that was never going to finish.
 */
const BOOT_WATCHDOG_MS = 12000;

/**
 * The first remote picture on a screen, if it has one.
 *
 * A screen existing is not a screen you can look at. The opening media is a
 * file on the server, and it only starts downloading once the node that wants
 * it has rendered — so dropping the splash the moment a screen exists shows
 * black until that file lands. This finds what to wait for.
 *
 * Only `{ url }` sources count. A `{ key }` source needs the client media
 * registry, which is populated as the bootstrap lands — the exact race that
 * made the server resolve urls itself. Falling through on one means hiding
 * immediately, which is what happened before this existed: no regression, just
 * no improvement.
 */
/**
 * Every remote asset on a screen — pictures AND clips.
 *
 * firstRemoteImage below answers "is there something to wait for"; this
 * answers "what is all of it", which is what a first run needs. Someone
 * opening the app for the first time should not watch the intro download, then
 * the onboarding art download, then the keyboard walkthrough download. They
 * wait once, on the splash, where waiting is invisible.
 */
function allRemoteMedia(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const c of node) allRemoteMedia(c, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const n = node as Record<string, any>;
  const src = n.props?.source;
  const url = typeof src === "string" ? src : src?.url;
  if (typeof url === "string" && /^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
  for (const k of Object.keys(n)) {
    if (k === "props" || k === "style") continue;
    allRemoteMedia(n[k], out);
  }
  if (n.props) allRemoteMedia(n.props, out);
  return out;
}

function firstRemoteImage(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[]; fallback?: unknown };
  if (n.type === "Image" || n.type === "Slideshow") {
    const src = n.props?.source ?? (n.props?.frames as unknown[] | undefined)?.[0];
    const url =
      typeof src === "string" ? src
      : typeof src === "object" && src !== null ? (src as { url?: string }).url
      : undefined;
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  for (const c of n.children ?? []) {
    const hit = firstRemoteImage(c);
    if (hit) return hit;
  }
  return firstRemoteImage(n.fallback);
}

export default function SduiApp() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  // HOOKS BELONG HERE, above every early return.
  //
  // These two sat further down, past the `auth` / `language` / `connect`
  // returns. React counts hooks per render: those phases ran two fewer, and
  // the moment the app reached `ready` it saw two more and threw "Rendered
  // more hooks than during the previous render" — a blank screen, arriving
  // exactly as the Connection screen handed over.
  const insets = useSafeAreaInsets();
  /** Bumped on every tab tap so the thread plucks again even when the tab
   *  does not change. */
  const [tabPluck, setTabPluck] = useState(0);
  /** Measured, not assumed: the rail spans the row, and the row is whatever the
   *  device is wide minus its insets. 0 until the first layout, which is the
   *  one frame the rail declines to draw. */
  const [tabsWidth, setTabsWidth] = useState(0);
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
  // The launch card, once we know this install hasn't already seen it.
  // Null until then, so a card never flashes and then vanishes on someone who
  // dismissed it yesterday.
  const [launchCard, setLaunchCard] = useState<LaunchCard | null>(null);
  // Whether the post-onboarding name + gender card is done. Default true so it
  // never flashes before we know.
  //
  // The SERVER is the authority (bootstrap flag profile.complete): the card's
  // answers live on the account, so a reinstall or a second device doesn't ask
  // again. Device storage is only the offline fallback, and only ever to
  // SUPPRESS the card — a local "not done" must not override a server that says
  // this user already answered.
  const [profileDone, setProfileDoneState] = useState(true);

  // Set the moment the user finishes the card, so a bootstrap refresh that
  // still carries the pre-save answer can't put it back in front of them.
  const profileJustDone = useRef(false);
  const profileDoneRef = useRef(true);

  useEffect(() => {
    if (profileJustDone.current) return;
    const serverSaysComplete = boot?.flags?.["profile.complete"];
    if (typeof serverSaysComplete === "boolean") {
      profileDoneRef.current = serverSaysComplete;
      setProfileDoneState(serverSaysComplete);
      return;
    }
    getProfileDone().then((done) => {
      if (done) { profileDoneRef.current = true; setProfileDoneState(true); }
    }).catch(() => {});
  }, [boot]);

  // A deep-link / push-notification screen target that arrived DURING cold boot,
  // before loadBoot committed the first stack. Stashed here and applied once we
  // reach "ready" (cold-entry effect below) so the default [home] stack can't
  // clobber it. Mirrors how consumeKeyboardEntry defers keyboard cold-starts.
  const pendingLinkRef = useRef<NavItem | null>(null);

  /**
   * What the keyboard asked for, held back because first run is not finished.
   *
   * A mic tap can arrive at any moment, including in the gap between adding the
   * keyboard and answering the name card — the keyboard works from the instant
   * it is enabled, and nothing about first run makes it wait. Opening the
   * recording screen then put the user somewhere they could not act, with the
   * profile card landing on top of it a beat later. The request is not wrong,
   * it is only early: parked here and replayed the moment the card is done.
   */
  const pendingKbRef = useRef<{ screenId: string; params?: Record<string, any>; arm?: boolean } | null>(null);
  /**
   * What the keyboard left for us, read at BOOT rather than in a later effect.
   *
   * Both bridge calls clear as they read, so there is no way to peek — and the
   * answer is needed before the first screen is chosen, because "intro" and
   * "the screen the keyboard asked for" are two different first screens and
   * the intro takes the whole window on a timer. So boot reads it once and
   * stashes it here; consumeKeyboardEntry drains the stash instead of asking
   * the bridge a second time (which would return nothing).
   */
  const kbEntryRef = useRef<{ rec: ReturnType<typeof consumeKeyboardRecordRequest>; link: string | null } | null | undefined>(undefined);
  /** True once the keyboard's entry has actually been routed. commitBoot runs
   *  twice and must not put the user back on Home after that. */
  const kbRoutedRef = useRef(false);
  /**
   * Sticky: the keyboard wanted this launch.
   *
   * Separate from the entry itself because the entry is drained — once the
   * cold-start effect has taken it, kbEntryRef is null, and a commitBoot
   * running after that would otherwise conclude nobody asked for anything and
   * put the intro back over the screen the keyboard requested.
   */
  const kbWantedRef = useRef(false);
  // True once phase === "ready": lets the mount-once link listener apply a HOT
  // link immediately, vs. stashing a COLD one for the cold-entry effect.
  const readyRef = useRef(false);

  /**
   * The backend's arrival prompt, held until the user is plainly idle.
   *
   * A card that appears the moment the app opens interrupts whatever brought
   * the user here. So it is armed, not shown: after the delay it appears only
   * if they are still sitting on the screen they landed on, having neither
   * navigated nor switched tabs. Anyone who started doing something never
   * sees it, and the server will ask again on a later launch.
   *
   * The timer is cancelled on any navigation and on unmount, so a dismissed
   * or superseded prompt can never surface later on top of unrelated work.
   */
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptIdleRef = useRef(false);

  const cancelArrivalPrompt = useCallback(() => {
    promptIdleRef.current = false;
    if (promptTimer.current) {
      clearTimeout(promptTimer.current);
      promptTimer.current = null;
    }
  }, []);

  const armArrivalPrompt = useCallback((screenId: string, afterMs: number) => {
    cancelArrivalPrompt();
    promptIdleRef.current = true;
    promptTimer.current = setTimeout(() => {
      promptTimer.current = null;
      // Still untouched? Then this is a pause, and the card is welcome.
      if (!promptIdleRef.current || !readyRef.current) return;
      promptIdleRef.current = false;
      setStack((cur) => (cur.length === 1 ? [...cur, { screenId }] : cur));
    }, Math.max(0, afterMs));
  }, [cancelArrivalPrompt]);

  useEffect(() => cancelArrivalPrompt, [cancelArrivalPrompt]);
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
      } else if (target.kind === "auth" || target.kind === "session") {
        // A SIGN-IN LINK THAT WAS MAILED INSTEAD OF A CODE.
        //
        // The app asks for a code; whether one is sent is decided by a Supabase
        // email template. This is the safety net for the template being wrong —
        // before it, a tapped link parsed as `unknown` and did nothing at all.
        //
        // Redeeming it lands a session exactly as typing the code would, and
        // the auth gate is watching for one, so the app simply proceeds.
        void (async () => {
          try {
            const { error } = target.kind === "auth"
              ? await supabaseAuth.verifyLinkToken(target.tokenHash, target.type)
              : await supabaseAuth.setSession(target.accessToken, target.refreshToken);
            // A used or expired link is not worth a dialog: the user is looking
            // at the code screen, which still works and still has Resend.
            if (error) console.warn("[auth] mailed link could not be redeemed:", error.message);
          } catch (e) {
            console.warn("[auth] mailed link could not be redeemed:", e);
          }
        })();
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
    // READ THE DEVICE BEFORE ASKING THE SERVER WHAT TO SHOW.
    //
    // The bootstrap carries mic + keyboard state, and the server picks the
    // first screen from it — so a reading that lands after the request is a
    // reading that arrives too late, and the setup steps flash past on a phone
    // that never needed them. Bounded, because boot must not hang on a native
    // call: the fallback is "nothing granted", which shows the steps.
    await refreshDeviceSignalsBounded();
    // Everything below `commitBoot` is what a bootstrap turns into on screen.
    // It runs twice on a cold start: once at once from the last bootstrap on
    // disk, so the app paints before the network answers, and again when the
    // fresh one lands, which replaces it (a changed cacheVersion refetches the
    // current screen). Offline, the first run is the whole app instead of the
    // connect screen. A screen that had never bootstrapped waits, as before.
    const commitBoot = async (b: BootstrapResponse): Promise<boolean> => {
      await hydrateScreenCache(String(b.cacheVersion ?? ""));
      // Register any typeface the backend supplied. Never awaited: the first
      // screens draw in the system font and re-render when a face lands.
      loadRemoteFonts((b as unknown as { fonts?: Record<string, unknown> }).fonts);
      // If the user's language flips the layout direction, this restarts the
      // app — so do it before we commit the rest of the boot state.
      if (await applyDirection(b.flags)) return false;
      // Publish the media registry BEFORE setBoot, not after.
      //
      // setBoot triggers the render that mounts the first screen, and the
      // resolver is MODULE state rather than React state — so a component that
      // resolves a key while the registry is still empty gets nothing and is
      // never re-rendered when it arrives. The intro did exactly that: its
      // timer ran, the screen held, and the media never appeared.
      //
      // Nothing reads the registry before this line, so publishing first costs
      // nothing and removes the race entirely.
      setMediaRegistry(pickMediaRegistry(b));
      setBoot(b);
      // WHICH TAB THE APP OPENS ON is the server's call, because it turns on
      // something only the server knows: whether this person has ever reached
      // the tabs before. A first-timer who just finished onboarding lands on
      // You; everyone after that lands on Stats.
      //
      // Falls back to the first tab, which is what this did before the field
      // existed — so a build that predates it keeps working, and a server that
      // stops sending it does not strand anyone on a blank id.
      const nav = b.navigation;
      const landing =
        nav.kind === "tabs"
          ? (nav.initialTabId && nav.tabs.some((t) => t.id === nav.initialTabId)
              ? nav.initialTabId
              : nav.tabs[0]?.id ?? "")
          : "";
      setTabId(landing);
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
      let langPicked = !!(await getLanguage());
      // Nothing stored: take the answer from the phone rather than asking.
      //
      // The language does real work — it is the script exemplar the recognizer
      // is primed with, the default output language, and what the app's copy is
      // translated into — so leaving it unset costs a Hindi-first user all
      // three. Their phone's language is usually the honest answer, and this
      // runs whether or not the pick screen is enabled, so turning that screen
      // off never leaves the signal empty.
      //
      // Only for languages we actually support; anything else stays "auto",
      // which is a real answer (detect per utterance), not a missing one.
      if (!langPicked) {
        const sys = inferSystemLanguage();
        if (sys) {
          try {
            // LOCAL first, and awaited: it is a disk write, it cannot hang, and
            // everything below reads it.
            await setLanguage(sys);
            langPicked = true;
            // The server copy is NOT awaited. This line used to be, and the
            // comment under it said a default was not worth failing the boot
            // for — but awaiting it is precisely how it failed the boot. A
            // request that never resolves (no timeout, a token refresh that
            // stalls, a captive portal that accepts the socket and answers
            // nothing) parks commitBoot forever, so setPhase("ready") never
            // runs and the app sits on its splash colour with no screen, no
            // error and nothing on screen to retry from. The keyboard follows
            // it down, because the token it reads is refreshed by a boot that
            // never finishes.
            //
            // Best-effort means best-effort: fire it, let it land whenever it
            // lands, and if it never does the local value is still correct and
            // the next boot will try again.
            void callEndpoint("PUT", "/v1/profile", { language: sys })
              .catch(() => { /* the local default already did the work */ });
          } catch { /* a default is not worth failing the boot for */ }
        }
      }
      if (needsLanguagePick && !langPicked) {
        setPhase("language");
        return false;
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
      // Ensure RevenueCat is configured and entitlements are loaded BEFORE the
      // gate reads them — otherwise a paying user is hard-locked behind the
      // paywall on cold start (the gate raced the async init). Shared promise,
      // so this is cheap once warm.
      // Read the keyboard's entry HERE, before anything picks a first screen —
      // and EXACTLY ONCE, however many times this function runs.
      //
      // It runs twice on a normal launch: once to paint from the disk cache,
      // once when the fresh bootstrap lands. These bridge calls clear as they
      // read, so the first pass took the entry and the second pass found
      // nothing, decided nobody had asked for anything, and set the stack back
      // to the intro — over the screen the keyboard had opened the app for.
      // `undefined` means never read; `null` means read and since consumed.
      if (kbEntryRef.current === undefined) {
        const rec = consumeKeyboardRecordRequest();
        const link = consumeKeyboardDeepLink();
        kbEntryRef.current = { rec, link };
        kbWantedRef.current = !!rec || (!!link && link !== "openSettings");
      }
      const kbWantsUs = kbWantedRef.current;

      const paywallEnt = String(b.flags?.["paywall.entitlement"] ?? "");
      if (paywallEnt) await initBilling();
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
      } else if (kbWantsUs) {
        // THE KEYBOARD OPENED US. It did not open us to watch the intro.
        //
        // initialScreenId is "intro" for anyone who has not seen it, and the
        // intro takes the whole window — no header, no tabs — for a few
        // seconds and then navigates on its own timer. So a keyboard mic tap
        // landed on a brand animation, and the entry the keyboard left was
        // read by a later effect that set the right screen underneath it, only
        // for the intro's timer to fire afterwards and navigate away from it.
        // Two owners of the stack, and the loser was the thing the user
        // actually asked for.
        //
        // NOTHING, until the cold-start effect places the real screen.
        //
        // This used to park on Home. Home is a whole screen — it painted, and
        // the user saw the Training tab flash before the mic screen replaced
        // it. An empty stack renders the quiet themed background instead,
        // which is what the app already shows while the first screen loads.
        // The point was never Home; it was that the INTRO must not mount,
        // because its timer would outlive the handoff and navigate away from
        // whatever the keyboard asked for.
        //
        // Guarded because this function runs twice — once off the disk cache,
        // once when the fresh bootstrap lands — and the cold-start effect
        // fires between them. Unguarded, the second pass cleared the stack
        // the effect had just filled.
        if (!kbRoutedRef.current) setStack([]);
      } else {
        setStack([{ screenId: firstScreenId }]);
        // A question the backend wants asked again — presented ON TOP of the
        // app rather than in front of it, and only once the user has stopped.
        //
        // It is pushed like the soft paywall, so back and edge-swipe dismiss
        // it and the app is right there underneath. But it is NOT pushed at
        // boot: landing a card the instant the app opens interrupts whatever
        // the user came to do. armArrivalPrompt waits, and abandons the card
        // if they start doing something in the meantime.
        //
        // The server decides whether, which, and how long to wait; the client
        // only honours it. Skipped when it names the screen we are already on,
        // so a prompt can never bury its own subject.
        const promptScreenId = b.flags?.["promptScreenId"];
        if (typeof promptScreenId === "string" && promptScreenId && promptScreenId !== firstScreenId) {
          armArrivalPrompt(promptScreenId, Number(b.flags?.["promptAfterMs"]) || 9000);
        }
      }
      setPhase("ready");
      return true;
    };
    // A WATCHDOG OVER THE WHOLE BOOT.
    //
    // The specific hang this was written for is fixed one screen up, but the
    // shape of it is what matters: commitBoot awaits several things, at least
    // one of which still talks to the network (initBilling), and a promise that
    // never settles leaves phase at "loading" forever. That state renders the
    // splash colour with no screen, no error and nothing to retry from — the
    // app looks broken and offers no way out, which is the worst failure the
    // app has.
    //
    // So: if the boot has not finished in BOOT_WATCHDOG_MS, stop waiting and
    // show the connection screen, which has a retry on it. A wrong-looking
    // retry card beats a dead splash, and if the boot completes later it simply
    // wins — commitBoot sets "ready" and the card is replaced.
    const watchdog = setTimeout(() => {
      setPhase((p) => (p === "loading" ? "connect" : p));
    }, BOOT_WATCHDOG_MS);
    let paintedFromDisk = false;
    try {
      const cached = await peekBootstrap();
      const fresh = bootstrap();
      if (cached) {
        // Give the network a beat; on a good connection the fresh bootstrap
        // wins outright and the disk copy is never shown.
        const first = await Promise.race([
          fresh.then((b) => ({ b, fresh: true })),
          new Promise<{ b: BootstrapResponse; fresh: false }>((r) => setTimeout(() => r({ b: cached, fresh: false }), 350)),
        ]);
        if (!first.fresh) {
          paintedFromDisk = await commitBoot(first.b);
          const b = await fresh;
          await commitBoot(b);
          return;
        }
        await commitBoot(first.b);
        return;
      }
      await commitBoot(await fresh);
    } catch {
      if (!paintedFromDisk) setPhase("connect");
    } finally {
      clearTimeout(watchdog);
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
      // The local pick is committed, so the picker won't return — but the
      // server never localized anything. Say so instead of silently leaving
      // the whole app in English with no visible reason.
      showToast("Couldn't save your language — you can change it anytime in Settings.", "error");
    }
    await loadBoot();
  }, [loadBoot]);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // A REINSTALL IS NOT A LAUNCH. The Keychain survives app deletion, so a
      // delete-and-reinstall came back holding the previous install's session
      // and walked straight past sign-in. Cleared BEFORE the session is read,
      // so the app sees what a new install should see: nobody signed in.
      // Local scope only — the account and its other devices are untouched.
      if (await isFreshInstall()) {
        await supabaseAuth.clearLocalSession().catch(() => {});
      }
      // Gate on auth first: the app needs a JWT to talk to the backend.
      const { data: { session } } = await supabaseAuth.getSession();
      // Tie RevenueCat purchases/entitlements to the signed-in user so they
      // restore across devices (was never identified → anonymous-only).
      if (session?.user?.id) void identifyBilling(session.user.id);
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

  /**
   * WHAT TO DRAW RIGHT NOW — resolved during render, not after it.
   *
   * `screen` is state, and it is set from an EFFECT. So a tab press used to
   * take two frames even with a warm cache: the first painted the new tab over
   * the OLD screen, because the effect that swaps it had not run yet, and only
   * the second showed the screen the tab belongs to. One frame of the previous
   * tab under the new highlight is precisely what "not instant" feels like,
   * and no amount of caching fixes it, because the cache was never the thing
   * being waited on.
   *
   * The cache can answer synchronously, so it is asked here. When the state's
   * screen is not the one the stack is pointing at and a cached copy exists,
   * that copy is drawn immediately — the same frame as the tap. The effect
   * still runs and still revalidates; it just no longer owns the first paint.
   *
   * With no cached copy this falls through to the old behaviour deliberately:
   * the previous screen stays until the fetch lands, rather than blanking. A
   * flash of nothing is worse than a beat of something.
   */
  const shown = useMemo(() => {
    if (!current || phase !== "ready") return screen;
    if (screen && screen.screenId === current.screenId) return screen;
    return peekScreen(current.screenId, current.params)?.screen ?? screen;
  }, [screen, current, phase]);


  // Warm and refresh the whole app once we are up.
  //
  // Two jobs, in this order, because they answer two different complaints:
  //
  //   1. prefetchScreens(warm list) — the FIRST launch. Fetch every screen the
  //      server says is reachable, not just the tab destinations, so nothing a
  //      tap deeper ever waits on the network.
  //   2. refreshCachedScreens() — EVERY launch after that. The disk cache is
  //      loaded stale, so without this the app showed whatever it last saw
  //      until the user happened to open that screen. Usage counts, history and
  //      entitlement all change while the app is closed; this is what makes
  //      them right before they are looked at.
  //
  // Delayed and sequential, so it never competes with the screen on screen.
  useEffect(() => {
    if (phase !== "ready" || !boot) return;
    const tabs = boot.navigation.kind === "tabs"
      ? boot.navigation.tabs.map((t) => t.screenId)
      : [];
    // The server's list wins; tabs are the floor, so an older backend that
    // sends no list still warms what it always did.
    const ids = Array.from(new Set([...(boot.warmScreenIds ?? []), ...tabs]));
    const t = setTimeout(() => {
      void (async () => {
        if (ids.length) await prefetchScreens(ids);
        await refreshCachedScreens();
      })();
      // And say, out loud, whether an update is available. Silent update
      // machinery is how a week of published fixes reached nobody.
      void reportUpdateCheck();
    }, 600);
    return () => clearTimeout(t);
  }, [phase, boot]);

  // KEEPING IT FRESH WHILE THEY ARE IN IT.
  //
  // The warm pass above runs once, at launch. That was the whole story, so a
  // session left open for an hour showed hour-old screens — usage counts,
  // history, entitlement and anything the backend deployed in the meantime.
  // The disk cache made that worse rather than better: it painted stale
  // instantly and confidently.
  //
  // Two triggers, both cheap because refreshCachedScreens only re-fetches what
  // is already cached and the responses are small:
  //
  //   coming back to the front — the moment most likely to follow a change
  //     made elsewhere, and the moment a user is about to look
  //   a slow tick while in front — for the session nobody backgrounds
  //
  // Nothing runs while the app is away. A timer that fires in the background
  // spends battery to refresh screens nobody is looking at.
  useEffect(() => {
    if (phase !== "ready") return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { void refreshCachedScreens(); }, LIVE_REFRESH_MS);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = undefined; } };
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        // Straight away, then resume ticking. Someone returning to the app is
        // about to read it.
        void refreshCachedScreens();
        void reportUpdateCheck();
        start();
      } else {
        stop();
      }
    });
    if (AppState.currentState === "active") start();
    return () => { stop(); sub.remove(); };
  }, [phase]);

  // Fetch the current screen whenever the top of the stack (or reload) changes.
  // On failure we surface a visible error state with a retry button instead of
  // silently keeping the previous (or empty) screen — the old behavior looked
  // identical to a successful empty render, which is what surfaced as "Home
  // and Settings are blank" in the field.
  useEffect(() => {
    if (phase !== "ready" || !current) return;
    let alive = true;
    // Show what we already have INSTANTLY, then revalidate behind it. A screen
    // the user has opened before should not make them wait on the network to
    // see it again; that wait is the whole of "the app feels slow".
    const cached = peekScreen(current.screenId, current.params);
    if (cached) {
      setScreen(cached.screen);
      setScreenError(null);
      // Fresh enough to trust — don't refetch at all.
      if (!cached.stale) { setScreenLoading(false); return; }
    }
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

  /**
   * Has this user spent the free plan's words?
   *
   * The server computes it — it counts the words and it knows who has paid —
   * and sends the answer in the bootstrap, refreshed on every launch and every
   * foreground. The app only has to route on it. An entitled user is never
   * over: `quota.exceeded` already folds the entitlement in, so there is no
   * second condition here to get out of step with the server's.
   */
  const overFreeLimit = useCallback(
    () => bootRef.current?.flags?.["quota.exceeded"] === true,
    [],
  );

  // Consume whatever the keyboard extension left in the shared App Group (a mic
  // "handoff" record request or a deep-link tombstone) and route / arm from it.
  // Returns "record" (routed to the mic-record screen), "navigated" (routed via
  // a deep link, e.g. Flow arm), or "none". Shared by BOTH the cold-start path
  // and the foreground AppState path: the keyboard can COLD-LAUNCH a terminated
  // app (or one iOS killed in the background), and on a cold launch the AppState
  // "change→active" event never fires — so without a cold-start caller, a Flow
  // "arm" tombstone is never consumed, armFlowSession never runs, the session
  // never arms, and the keyboard mic just re-opens the app forever.
  /**
   * Turn the background mic on. Lifted out of the flow_arm branch so a request
   * held back through first run can still arm when it is finally replayed —
   * arming and routing have to travel together or the screen appears over a
   * mic that was never turned on.
   */
  const armFlow = useCallback(() => {
    void (async () => {
      const [base, tok, lang] = await Promise.all([
        getBaseUrl(), getSupabaseAccessToken(), getLanguage(),
      ]);
      const idle = Number(bootRef.current?.flags?.["kb.flow.idleTimeoutMs"] ?? 300000);
      const oneShot = bootRef.current?.flags?.["kb.flow.transport"] === "oneshot";
      armFlowSession(base, tok ?? "dev", lang || "auto", idle, oneShot);
    })();
  }, []);

  /**
   * WHAT THE APP STILL OWES, before anything the keyboard asks for may open.
   *
   * Two gates, and both must be past. The setup steps are read from the screen
   * the SERVER picked — it already decides that from the profile and the
   * device, so asking it is asking the one thing that knows. The name card is
   * read from the server's own flag where it has one, because a keyboard tap
   * can arrive before the local copy has been loaded and the local default is
   * "done", which is the answer that lets this through wrongly.
   */
  const firstRunOwed = useCallback((): { screenId: string } | null => {
    const b = bootRef.current;
    const first = b?.initialScreenId;
    if (first === "onboarding" || first === "onboarding_keyboard") return { screenId: first };
    const server = b?.flags?.["profile.complete"];
    const done = typeof server === "boolean" ? server : profileDoneRef.current;
    // The card renders over the You tab, so that is where the user has to be
    // standing for it to appear at all.
    return done ? null : { screenId: "personality" };
  }, []);

  const consumeKeyboardEntry = useCallback((): "record" | "navigated" | "none" => {
    // The stash first: boot already drained the bridge, and asking it again
    // would answer "nothing" for the very launch this exists to handle.
    const stash = kbEntryRef.current ?? null;
    kbEntryRef.current = null;
    const rec = stash ? stash.rec : consumeKeyboardRecordRequest();
    if (rec) {
      // Fresh mic handoff. Drain the PAIRED deep-link tombstone too, so it can't
      // re-open the record screen on a later, unrelated foreground.
      if (!stash) consumeKeyboardDeepLink();
      // Over the free cap, the mic is not what should open. The server will
      // refuse the dictation anyway, so arming a session and showing a
      // recording screen only walks the user into a rejection — and lands them
      // on an error toast instead of the one screen that can fix it.
      if (overFreeLimit()) {
        kbRoutedRef.current = true;
        setStack([{ screenId: "paywall" }]);
        return "navigated";
      }
      // FIRST RUN COMES FIRST. Same shape as the free-limit check above: the
      // request is not refused, it is parked — and replayed the moment the
      // thing that was owed is done.
      const owed = firstRunOwed();
      if (owed) {
        pendingKbRef.current = {
          screenId: "keyboard_record",
          params: { session: rec.sessionId, host: rec.hostApp, source: "keyboard" },
        };
        kbRoutedRef.current = true;
        setStack([{ screenId: owed.screenId }]);
        return "navigated";
      }
      kbRoutedRef.current = true;
      setStack([{
        screenId: "keyboard_record",
        params: { session: rec.sessionId, host: rec.hostApp, source: "keyboard" },
      }]);
      return "record";
    }
    const pending = stash ? stash.link : consumeKeyboardDeepLink();
    if (!pending) return "none";
    if (pending === "openSettings") {
      Linking.openSettings().catch(() => {});
      return "none";
    }
    if (pending.startsWith("screen/")) {
      const screenId = pending.slice("screen/".length);
      if (screenId === "flow_arm") {
        // Same rule as the mic handoff: no point arming a mic whose every
        // transcript the server is going to refuse.
        if (overFreeLimit()) {
          kbRoutedRef.current = true;
          setStack([{ screenId: "paywall" }]);
          return "navigated";
        }
        // First run first — and crucially, DO NOT ARM YET. Turning the mic on
        // and then showing the name card would leave a live microphone behind
        // a screen that says nothing about it.
        const owedFlow = firstRunOwed();
        if (owedFlow) {
          pendingKbRef.current = { screenId: "flow_arm", arm: true };
          kbRoutedRef.current = true;
          setStack([{ screenId: owedFlow.screenId }]);
          return "navigated";
        }
        // Flow Session arming: the keyboard opened us here to turn the background
        // mic on. Arm it deterministically (idle window backend-tunable via
        // kb.flow.idleTimeoutMs) AND route to the backend-authored "swipe back"
        // arming screen (whose onAppear re-arms too — arm() is idempotent).
        armFlow();
        kbRoutedRef.current = true;
        setStack([{ screenId: "flow_arm" }]);
        return "navigated";
      }
      if (screenId && screenId !== "keyboard_record" && screenId !== "keyboard_primer") {
        // keyboard_record / keyboard_primer are mic-tap-only (owned by the
        // record-request path above); a leftover deep-link to them is stale.
        kbRoutedRef.current = true;
        setStack([{ screenId }]);
        return "navigated";
      }
    }
    return "none";
  }, [firstRunOwed, armFlow, overFreeLimit]);

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

  // Arm the Flow Session as soon as we have the flags, NOT only on a
  // background→foreground transition.
  //
  // AppState "change" fires on a TRANSITION. Launching the app from the home
  // screen is a cold start straight into "active" — no transition, no event, no
  // arm. So the most ordinary thing a user can do (open the app, swipe away,
  // dictate from the keyboard somewhere else) left the session unarmed, and the
  // keyboard correctly found nothing alive and reopened the app. The keyboard
  // was not being stupid; nobody had ever armed anything.
  //
  // The keyboard-initiated cold launch was already covered by its tombstone.
  // This is the same hole for a user-initiated one.
  //
  // arm() is idempotent — re-arming just refreshes the idle window — so running
  // this whenever the flags land is safe and self-healing.
  useEffect(() => {
    if (bootRef.current?.flags?.["kb.flow.armOnForeground"] !== true) return;
    if (AppState.currentState !== "active") return;
    void (async () => {
      const [base, tok, lang] = await Promise.all([
        getBaseUrl(), getSupabaseAccessToken(), getLanguage(),
      ]);
      const idle = Number(bootRef.current?.flags?.["kb.flow.idleTimeoutMs"] ?? 300000);
      const oneShot = bootRef.current?.flags?.["kb.flow.transport"] === "oneshot";
      armFlowSession(base, tok ?? "dev", lang || "auto", idle, oneShot);
    })();
  }, [boot]);

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
      // Wispr-style warm-keeping: when the backend opts in
      // (kb.flow.armOnForeground), re-arm the background Flow Session on every
      // foreground so the keyboard dictates without reopening the app — the
      // difference that makes the Wispr flow feel seamless. arm() is idempotent;
      // the idle window is backend-tunable. This holds the mic in the background
      // (recording indicator + battery), so it's a backend flag, OFF unless the
      // backend explicitly turns it on.
      if (bootRef.current?.flags?.["kb.flow.armOnForeground"] === true) {
        void (async () => {
          const [base, tok, lang] = await Promise.all([
            getBaseUrl(), getSupabaseAccessToken(), getLanguage(),
          ]);
          const idle = Number(bootRef.current?.flags?.["kb.flow.idleTimeoutMs"] ?? 300000);
          const oneShot = bootRef.current?.flags?.["kb.flow.transport"] === "oneshot";
          armFlowSession(base, tok ?? "dev", lang || "auto", idle, oneShot);
        })();
      }
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
      // Register any typeface the backend supplied. Never awaited: the first
      // screens draw in the system font and re-render when a face lands.
          loadRemoteFonts((b as unknown as { fonts?: Record<string, unknown> }).fonts);
          // Before setBoot, always: a media upload only reaches the resolver
          // through one of these refreshes, and a component that re-renders
          // first would resolve against the old registry.
          setMediaRegistry(pickMediaRegistry(b));
          setBoot((prev) => {
            // If cacheVersion changed, the whole screen cache is stale — bump
            // reload so the current screen refetches. Otherwise still update
            // theme/labels but don't force screen work.
            if (prev?.cacheVersion !== b.cacheVersion) {
              setReload((n) => n + 1);
            }
            return b;
          });
          // Every other cached screen too, not just the one in front. A user
          // who dictates from the keyboard in another app and comes back
          // should find the stats and history already counting it, without
          // watching each tab refresh itself as they arrive.
          void refreshCachedScreens();
        } catch {
          /* offline / transient — user's next interaction retries */
        }
      })();
    });
    return () => sub.remove();
  }, [phase, consumeKeyboardEntry]);

  const nav: NavApi = useMemo(
    () => ({
      // Any of these means the user is doing something, so a pending arrival
      // prompt is dropped rather than landing on top of it. The server will
      // ask again on a later launch; interrupting is the one thing it must
      // not do.
      push: (screenId, params) => {
        cancelArrivalPrompt();
        setStack((s) => [...s, { screenId, params }]);
      },
      // Swap the top rather than stack on it. A linear flow — onboarding — is
      // a sequence of steps, not a place you browse: pushing left every step
      // behind the next one, so an edge swipe walked back into a permission
      // screen that had already been answered. Replacing means each step is
      // the only thing on the stack and there is nothing to go back to.
      replace: (screenId, params) => {
        cancelArrivalPrompt();
        setStack((s) => (s.length ? [...s.slice(0, -1), { screenId, params }] : [{ screenId, params }]));
      },
      back: () => {
        cancelArrivalPrompt();
        setStack((s) => {
          if (s.length > 1) return s.slice(0, -1);
          // Nothing to pop. Usually right — you cannot go back from home — but
          // the keyboard's mic handoff REPLACES the stack, so keyboard_record
          // and flow_arm are the only thing on it and their Cancel button did
          // nothing at all. Leaving the user on a recording screen with a dead
          // way out is the worst version of this: the mic is the one place
          // they most want a way out.
          const top = s[0]?.screenId;
          const home = bootRef.current?.initialScreenId;
          const transient = top === "keyboard_record" || top === "keyboard_primer" || top === "flow_arm";
          return transient && home ? [{ screenId: home }] : s;
        });
      },
      switchTab: (id) => {
        cancelArrivalPrompt();
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
      // Register any typeface the backend supplied. Never awaited: the first
      // screens draw in the system font and re-render when a face lands.
      loadRemoteFonts((b as unknown as { fonts?: Record<string, unknown> }).fonts);
            if (await applyDirection(b.flags)) return; // RTL change → app restarts
            setMediaRegistry(pickMediaRegistry(b));
            setBoot(b);
            setReload((n) => n + 1);
          } catch {
            /* keep current UI if the refresh fails */
          }
        })();
      },
    }),
    [boot, cancelArrivalPrompt],
  );

  // Keep the mount-once deep-link listener reading fresh values: readiness (so a
  // hot link applies immediately while a cold one stashes) and the action
  // dispatcher (so it uses the current nav + flags, not the initial ones).
  useEffect(() => { readyRef.current = phase === "ready"; }, [phase]);

  // Decide about the launch card once the bootstrap has landed.
  //
  // Asked once per card id, not once per render: `repeat: "everyLaunch"` means
  // every cold open, and this component mounts once per open, so the effect
  // firing is the launch. A card is marked seen when it is PUT UP rather than
  // when it is dismissed — a card that crashes or is killed mid-read has still
  // been shown, and showing it again forever is worse than missing it once.
  useEffect(() => {
    const card = boot?.launchCard;
    if (phase !== "ready" || !card?.id || !card.root) { setLaunchCard(null); return; }
    let alive = true;
    void (async () => {
      if (card.repeat !== "everyLaunch" && (await hasSeenCard(card.id))) return;
      if (!alive) return;
      setLaunchCard(card);
      void markCardSeen(card.id);
    })();
    return () => { alive = false; };
  }, [phase, boot?.launchCard]);

  // DROP THE SPLASH once there is a PICTURE under it, and not a moment before.
  //
  // index.ts holds it at launch. Three moments were candidates for letting go,
  // and only the last one is black-free:
  //
  //   phase === "ready"  — the bootstrap landed. No screen yet.
  //   screen !== null    — the screen landed. Its media has not started.
  //   the file is here   — this one.
  //
  // The opening media is a file on the server. The node that wants it only
  // begins fetching once it has rendered, so hiding on `screen` uncovers a
  // download in progress. Prefetching it first puts that download behind the
  // splash, where a wait is invisible.
  //
  // The timeout is the promise this cannot break: whatever the network does,
  // the splash goes. A splash that waits forever is worse than the black it
  // was holding back.
  // BREADCRUMBS. A boot that hangs cannot report on itself, so each stage
  // writes where it got to and the NEXT launch carries that on its bootstrap —
  // the first call any launch makes, and therefore the one that always gets
  // through. Diagnostic only; nothing branches on it.
  useEffect(() => {
    void (async () => {
      try {
        const { getLastBoot, setLastBoot } = require("../storage");
        const { LAST_BOOT_NOTE } = require("./client");
        LAST_BOOT_NOTE.value = (await getLastBoot()) ?? "none";
        await setLastBoot("started");
      } catch { /* diagnostics must never break a boot */ }
    })();
  }, []);

  // Where the boot actually ended up, written a few seconds in — long after a
  // healthy launch has a screen, and while a stuck one is still stuck.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const { setLastBoot } = require("../storage");
        void setLastBoot(
          `phase=${phase} boot=${boot ? 1 : 0} screen=${screen ? 1 : 0}` +
          ` err=${screenError ? 1 : 0} stack=${stack.length}` +
          ` kbWants=${kbWantedRef.current ? 1 : 0} kbRouted=${kbRoutedRef.current ? 1 : 0}`,
        );
      } catch { /* diagnostics must never break a boot */ }
    }, 6000);
    return () => clearTimeout(t);
  }, [phase, boot, screen, screenError, stack.length]);

  // Whether this device has finished onboarding. Read once at startup, and a
  // ref rather than state because the splash gate must not re-run when it
  // resolves — a second pass there would drop the splash early.
  const onboardedRef = useRef(false);
  useEffect(() => {
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getOnboarded } = require("../storage");
        onboardedRef.current = await getOnboarded();
      } catch { /* treat an unreadable flag as a first run — it only costs a wait */ }
    })();
  }, []);

  const splashHidden = useRef(false);
  useEffect(() => {
    // THE SPLASH LIFTS WHEN THERE IS ANYTHING TO LOOK AT — not only when an
    // SDUI screen arrives.
    //
    // This used to wait for `screen` alone, and three render paths never
    // produce one: the auth gate, the language pick and the connection error.
    // index.ts calls preventAutoHideAsync, so nothing else was ever going to
    // lift it. A signed-out user therefore got a perfectly good sign-in screen
    // drawn underneath a splash that never moved — and could not sign in,
    // which meant no session, which meant the next launch did the same thing.
    // The keyboard came down with it: the token it reads is refreshed by an
    // app that gets past its own front door, so it fell back to its built-in
    // layout and looked like a regression of its own.
    //
    // Every one of those symptoms was this one line.
    const somethingToSee =
      phase === "auth" || phase === "language" || phase === "connect" ||
      !!screen || !!screenError;
    if (splashHidden.current || !somethingToSee) return;
    splashHidden.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const drop = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("expo-splash-screen").hideAsync?.()?.catch?.(() => {});
      } catch { /* nothing was holding it */ }
    };
    // The media wait belongs to the SCREEN path only. On every other path
    // there is no opening picture to wait for, and waiting for one that will
    // never come is how this broke in the first place.
    if (!screen) { drop(); return; }

    // A FIRST RUN WAITS FOR THE WHOLE OPENING, not just its first picture.
    //
    // Someone new sees the intro, then onboarding, then the keyboard step, and
    // fetching each one as they arrive means three separate pops in the first
    // fifteen seconds. The splash is the one place a wait is invisible, so it
    // is the place to spend it — once, for all of it.
    //
    // A returning user waits for the opening picture and nothing else: their
    // cache is warm, and the rest is already on disk.
    const first = !onboardedRef.current;
    const urls = first
      ? allRemoteMedia((screen as ScreenResponse).root)
      : [firstRemoteImage((screen as ScreenResponse).root)].filter(Boolean) as string[];

    if (!urls.length && !first) { drop(); return; }
    timer = setTimeout(drop, first ? FIRST_RUN_MEDIA_WAIT_MS : SPLASH_MEDIA_WAIT_MS);

    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ExpoImage = require("expo-image")?.Image;
        const warm = (u: string) => ExpoImage?.prefetch?.(u, "disk") ?? Promise.resolve();

        if (first) {
          // The screen AFTER this one, too. On a first run that is the
          // onboarding step, and it is the next thing they will look at.
          const nextId = (boot?.flags?.["postLanguageScreenId"] as string | undefined)
            ?? (boot?.initialScreenId === "intro" ? "onboarding" : null);
          if (nextId) {
            const next = await fetchScreen(nextId).catch(() => null);
            if (next?.root) {
              for (const u of allRemoteMedia(next.root)) if (!urls.includes(u)) urls.push(u);
            }
          }
        }
        await Promise.all(urls.map((u) => warm(u).catch(() => {})));
        drop();
      } catch { drop(); }
    })();
    return () => { if (timer) clearTimeout(timer); };
  }, [screen, screenError, phase]);
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
        theme={boot?.theme}
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
  if (phase === "loading" || !theme || (!shown && !screenError)) {
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
  const hideChrome = shown?.hideChrome === true;
  // Header only. A tab root that wants its art at the top of the window still
  // needs its tabs — see hideHeader in types.
  const hideHeader = hideChrome || shown?.hideHeader === true;

  return (
    <View style={[styles.app, { backgroundColor: theme.color.bg }]}>
      {!hideHeader && (
        <View style={styles.header}>
          {canGoBack ? (
            <Pressable onPress={nav.back} hitSlop={10}>
              <Text style={[typeRole(theme, "headerIcon", styles.headerIcon), { color: theme.color.text }]}>‹</Text>
            </Pressable>
          ) : (
            <Text style={[typeRole(theme, "title", styles.brand), { color: theme.color.text, flex: 1 }]} numberOfLines={1}>{shown?.title ?? boot?.labels?.["app.name"] ?? "Tailzu"}</Text>
          )}
          {canGoBack && <Text style={[typeRole(theme, "title", styles.brand), { color: theme.color.text, flex: 1, marginLeft: 8 }]} numberOfLines={1}>{shown?.title ?? ""}</Text>}
          {/* Settings gear — top-right on the tab roots (Home / You). Opens the
              Settings screen (pushed, with a back arrow). Replaces the old dev
              "Connection" entry, and stands in for the removed Settings tab.
              Hidden on pushed screens, where the back arrow + title own the bar. */}
          {!canGoBack && (
            <Pressable onPress={() => nav.push("settings")} hitSlop={12} accessibilityLabel="Settings">
              <SettingsLines color={theme.color.muted} />
            </Pressable>
          )}
        </View>
      )}

      <View style={{ flex: 1 }}>
        {shown ? (
          <ThemeContext.Provider value={theme}>
            {/*
              KEYED BY SCREEN. Without this React keeps the same component
              instance across a navigation, because the element type and
              position never change — so every node's onAppear, which fires
              once on mount with an empty dep array, does NOT fire again.

              That strands any screen whose exit depends on onAppear. The
              intro is exactly that: its timer is what moves it on, so
              returning to it from another screen left the media looping with
              nothing to end it, forever.

              The key is the screen's identity, not its content, so a
              revalidation of the SAME screen still updates in place and does
              not restart its animations or re-fire its actions.
            */}
            <ScreenHost
              key={`${current?.screenId ?? ""}:${JSON.stringify(current?.params ?? {})}`}
              screen={shown} nav={nav} flags={boot?.flags ?? {}} labels={boot?.labels ?? {}} toast={showToast} />
          </ThemeContext.Provider>
        ) : screenError ? (
          // Never-loaded-once + failure: render a real error card with a
          // Retry button. The old behavior showed a spinner or nothing at
          // all, which read as "the app is broken."
          <View style={[styles.center, { paddingHorizontal: 24 }]}>
            <Text style={typeRole(theme, "errorTitle", { color: theme.color.text, fontSize: 18, fontWeight: "700", marginBottom: 8 })}>
              {boot?.labels?.["error.screenTitle"] ?? "Couldn't load this screen"}
            </Text>
            <Text style={typeRole(theme, "errorBody", { color: theme.color.muted, textAlign: "center", marginBottom: 20 })}>
              {screenError}
            </Text>
            <Pressable
              onPress={() => setReload((n) => n + 1)}
              style={{ backgroundColor: theme.color.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28 }}
            >
              <Text style={[typeRole(theme, "errorAction", { fontWeight: "700" }), { color: theme.color.bg }]}>
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
        {shown && screenError && (
          <Pressable
            onPress={() => setReload((n) => n + 1)}
            style={{
              position: "absolute", top: 0, left: 0, right: 0,
              backgroundColor: theme.color.errorBanner ?? "#3a1417",
              paddingVertical: 10, alignItems: "center",
            }}
          >
            <Text style={[typeRole(theme, "banner", { fontWeight: "600" }), { color: theme.color.errorBannerText ?? "#fff" }]}>
              {boot?.labels?.["error.refreshBanner"] ?? "Couldn't refresh — tap to retry"}
            </Text>
          </Pressable>
        )}
        {screenLoading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color={THREAD_ACTIVE} />
          </View>
        )}
      </View>

      {!hideChrome && tabs.length > 0 && (
        <View style={[styles.tabs, {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
          // Lift the row clear of the system gesture area on BOTH platforms.
          // There was no inset at all, so the tabs sat directly against the
          // home indicator on iPhone and the gesture bar on Android — a tap
          // near the bottom of a tab went to the OS, not to us. The floor keeps
          // a comfortable strip on hardware with no inset to report.
          paddingBottom: Math.max(insets.bottom, 12) + 6,
        }]}
        onLayout={(e) => setTabsWidth(e.nativeEvent.layout.width)}>
          {/* The thread that makes the row one object rather than three icons.
              Behind them, and untouchable — it reports where you are, it is
              never something to press. */}
          {(boot?.navigation.kind !== "tabs" || boot.navigation.rail !== false) && (
            <ThreadRail
              width={tabsWidth}
              count={tabs.length}
              index={Math.max(0, tabs.findIndex((t) => t.id === tabId))}
              color={theme.color.muted}
              top={TAB_RAIL_TOP}
            />
          )}
          {tabs.map((t) => {
            const active = t.id === tabId;
            return (
              <Pressable
                key={t.id}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.title}
                onPress={() => {
                  // Bump the nonce so tapping the tab you are already on
                  // plucks the thread again — the tap should always feel
                  // answered, not only when it changes screens.
                  setTabPluck((n) => n + 1);
                  nav.switchTab(t.id);
                }}
              >
                <TabThreadIcon
                  id={t.id}
                  title={t.title}
                  active={active}
                  color={theme.color.muted}
                  nonce={tabPluck}
                  surface={theme.color.surface}
                  glyph={t.glyph}
                />
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
          <Text style={[typeRole(theme, "toast"), { color: theme.color.toastText ?? "#fff" }]}>{toast.message}</Text>
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
          onDone={() => {
            profileJustDone.current = true;
            profileDoneRef.current = true;
            setProfileDoneState(true);
            // THE REPLAY. Whatever the keyboard asked for while the card was
            // still owed happens now, in the order it should have happened in:
            // arm first, then show the screen that reports it.
            const next = pendingKbRef.current;
            pendingKbRef.current = null;
            if (next) {
              if (next.arm) armFlow();
              setStack([{ screenId: next.screenId, params: next.params }]);
            }
          }}
          mediaUri={typeof boot?.flags?.["profileCard.media"] === "string" ? (boot.flags["profileCard.media"] as string) : undefined}
          theme={theme}
        />
      )}

      {/* The card the app opens with, LAST in the list and last in the queue.
          Everything above it is something the user must deal with — signing
          in, an update, the name they still owe us — and an announcement that
          talks over any of those is an announcement nobody reads. */}
      {launchCard && !updateForced && !updateOptional
        && !(!profileDone && shouldShowProfileGate(current?.screenId, boot?.flags)) && (
        <LaunchCardOverlay
          card={launchCard}
          nav={nav}
          flags={boot?.flags ?? {}}
          labels={boot?.labels ?? {}}
          toast={showToast}
          onClose={() => setLaunchCard(null)}
        />
      )}
    </View>
  );
}

/**
 * The card the app opens with — whatever the backend put in `launchCard`.
 *
 * This is the entire app-side of the feature, and it is deliberately thin: a
 * sheet, a scrim, and the ordinary renderer pointed at a node tree the server
 * wrote. Every card after this one is a backend change and nothing else.
 *
 * THE NAV IS THE TRICK. A card's button carries an ordinary `navigate` — the
 * same action any button anywhere carries — so nothing in the tree has to
 * know it is inside a card. The nav handed to it closes the card first and
 * then does the real thing, which is what stops a card being left hanging
 * over the screen it just sent you to. `dismiss` maps to nav.back, so inside
 * a card that is simply "close", with no separate action kind to learn.
 */
function LaunchCardOverlay({
  card,
  nav,
  flags,
  labels,
  toast,
  onClose,
}: {
  card: LaunchCard;
  nav: NavApi;
  flags: Record<string, any>;
  labels: Record<string, string>;
  toast: (m: string, tone?: string) => void;
  onClose: () => void;
}) {
  const theme = useContext(ThemeContext)!;
  const store = useMemo(() => new Store({}), [card.id]);
  const cardNav: NavApi = useMemo(() => ({
    push: (s, p) => { onClose(); nav.push(s, p); },
    replace: (s, p) => { onClose(); nav.replace(s, p); },
    // Inside a card, "back" is "close the card".
    back: onClose,
    switchTab: (t) => { onClose(); nav.switchTab(t); },
    reloadCurrent: nav.reloadCurrent,
    refreshLocale: nav.refreshLocale,
  }), [nav, onClose]);
  const ctx: Ctx = useMemo(
    () => ({ store, actions: {}, flags, labels, nav: cardNav, toast }),
    [store, flags, labels, cardNav, toast],
  );

  return (
    <View style={[StyleSheet.absoluteFill, {
      alignItems: "center", justifyContent: "center", padding: 24,
    }]}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: card.backdrop ?? "rgba(4,4,6,0.72)" }]}
        onPress={card.dismissOnBackdrop === false ? undefined : onClose}
        accessibilityRole="button"
        accessibilityLabel={labels["action.dismiss"] ?? "Dismiss"}
      />
      <View style={[
        {
          backgroundColor: theme.color.card, borderRadius: theme.radius.card,
          padding: 24, width: "100%", maxWidth: 360,
        },
        card.sheet as any,
      ]}>
        <RenderNode node={card.root} ctx={ctx} />
      </View>
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
      <Text style={typeRole(theme, "updateTitle", { color: theme.color.text, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 10 })}>
        {info.title ?? labels["updateGate.title"] ?? "Update available"}
      </Text>
      <Text style={typeRole(theme, "updateBody", { color: theme.color.muted, fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 22 })}>
        {info.message ?? labels["updateGate.message"] ?? "A new version is available."}
      </Text>
      <Pressable
        onPress={() => storeUrl && Linking.openURL(storeUrl)}
        style={{ backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingVertical: 14, paddingHorizontal: 28, minWidth: 200, alignItems: "center" }}
      >
        <Text style={[typeRole(theme, "updateAction", { fontWeight: "700", fontSize: 15 }), { color: theme.color.primaryText ?? "#fff" }]}>
          {info.cta ?? labels["updateGate.cta"] ?? "Update now"}
        </Text>
      </Pressable>
      {!forced && (
        <Pressable onPress={onDismiss} style={{ marginTop: 14 }}>
          <Text style={typeRole(theme, "updateLater", { color: theme.color.muted })}>
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
  // Memoised, because it is the identity every RenderNode in the tree reads.
  // Rebuilt each render, it made a single parent re-render — a toast, a
  // foreground bootstrap, a loading flag — walk and re-render the WHOLE screen,
  // which on a tree with Skia canvases and video in it is the difference
  // between a frame and several.
  const ctx: Ctx = useMemo(
    () => ({ store, actions: screen.actions ?? {}, flags, labels, nav, toast }),
    [store, screen.actions, flags, labels, nav, toast],
  );

  // Inject live device signals into screen state so the BACKEND can gate on them
  // declaratively (e.g. only show the "continue" button when the keyboard has
  // Full Access): $state.keyboardReady / $state.keyboardEnabled / $state.micGranted.
  // No bridge (Expo Go) → report ready so nothing is ever blocked in development.
  // Polls while not-yet-ready and re-checks when the app returns from Settings.
  //
  // THE RE-CHECK IS THE POINT, and it is why a permission belongs here rather
  // than in a one-shot action on the screen that cares. Every one of these
  // answers changes in SETTINGS — somewhere else, while the app is in the
  // background — so a screen that reads it once on mount is reading it at the
  // only moment it is guaranteed not to have changed yet. Coming back is when
  // the answer is new, and coming back is not a mount.
  useEffect(() => {
    let stop = false;
    let disposed = false;
    // `iv` MUST be declared before sync() runs: the first synchronous sync()
    // call below can hit `clearInterval(iv)` (when the keyboard already has
    // Full Access), and a `const iv` declared afterward would be in its
    // temporal dead zone → ReferenceError under Hermes, crashing the app on
    // mount for exactly the users who completed keyboard setup.
    let iv: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      void (async () => {
        const d = await refreshDeviceSignals();
        if (disposed) return;
        // PERMISSIVE HERE, on purpose. These gate BUTTONS, so a missing native
        // bridge has to read as ready or development blocks on a module that
        // is not there. The bootstrap capabilities read the same facts the
        // other way — see device/signals — because there they decide whether a
        // setup step is shown at all, and skipping a needed one is the costly
        // mistake. Same readings, opposite safe defaults, deliberately.
        store.set("keyboardEnabled", d.keyboard ? d.keyboard.enabled : true);
        store.set("keyboardReady", d.keyboard ? d.keyboard.fullAccess : true);
        store.set("micGranted", d.micGranted);
        if (d.keyboard?.fullAccess) { stop = true; if (iv) clearInterval(iv); }
      })();
    };
    sync();
    iv = setInterval(() => { if (!stop) sync(); }, 1500);
    const subAS = AppState.addEventListener("change", (st) => { if (st === "active") sync(); });
    return () => { disposed = true; if (iv) clearInterval(iv); subAS.remove(); };
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

/**
 * The tab row's own spacing, named because the rail has to line up with the
 * icons and a rail that floats above or below them looks like a bug rather
 * than like a thread. Derived, not typed twice: the rail sits where the icon
 * centreline sits.
 */
const TAB_PAD_TOP = 12;
const TAB_PAD_V = 6;
const TAB_ICON = 26;
const TAB_RAIL_TOP = TAB_PAD_TOP + TAB_PAD_V + (TAB_ICON - THREAD_RAIL_HEIGHT) / 2;

const styles = StyleSheet.create({
  app: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16 },
  brand: { fontSize: 22, fontWeight: "800" },
  headerIcon: { fontSize: 24, fontWeight: "700" },
  tabs: { flexDirection: "row", borderTopWidth: 1, paddingTop: TAB_PAD_TOP },
  tab: { flex: 1, paddingVertical: TAB_PAD_V, alignItems: "center", justifyContent: "center" },
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
