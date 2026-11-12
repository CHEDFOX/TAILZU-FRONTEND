/**
 * The app shell — a GENERIC renderer. It boots from the server, draws the
 * server's navigation + screens, and runs the server's actions. The only
 * client-local screen is Connection (you need it to reach the server at all).
 *
 * This component holds the shell's state and draws it; each concern it runs is
 * a hook in ./shell/hooks, called in a fixed order (effects run in the order
 * their hooks are called), and the pieces it draws are in ./shell.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { peekScreen, APP_VERSION } from "./client";
import { ThemeContext } from "./theme/ThemeContext";
import { typeRole } from "./theme/typeRole";
import { useLiveUpdates } from "./live/live";
import type { NavApi } from "./actions";
import type { BootstrapResponse, LaunchCard, ScreenResponse, ThemeTokens } from "./types";
import { setKnobs, txt, num, str, color } from "./knobs";
import OfflineScreen from "./offline/OfflineScreen";
import { OfflineBar, startOutbox, useOfflineSwitch, useOnline } from "./offline/offline";
import AuthGateScreen from "../auth/AuthGateScreen";
import { consumeKeyboardRecordRequest } from "../../modules/tulmi-bridge";
import { useEdgeSwipeBack, resolveEdgeSwipe } from "./shell/gestures";
import { refreshQuickAccess } from "../widgets/quickAccess";
import { registerNotificationCategories } from "../notifications/categories";
import { useShareIn } from "../share/useShareIn";
import { LaunchStill } from "../launch/LaunchCurtain";
import type { NavItem, Toast } from "./shell/types";
import { cmpVersion } from "./shell/cmpVersion";
import { styles } from "./shell/styles";
import { Header } from "./shell/Header";
import { TabBar } from "./shell/TabBar";
import { ToastView } from "./shell/ToastView";
import { LaunchCardOverlay } from "./shell/LaunchCardOverlay";
import { UpdateGateOverlay } from "./shell/UpdateGateOverlay";
import { ScreenHost } from "./shell/ScreenHost";
import { ConnectionScreen } from "./shell/ConnectionScreen";
import { useArrivalPrompt } from "./shell/hooks/useArrivalPrompt";
import { useStartup } from "./shell/hooks/useStartup";
import { useToast } from "./shell/hooks/useToast";
import { useBootLoader } from "./shell/hooks/useBootLoader";
import { useAuthSession } from "./shell/hooks/useAuthSession";
import { usePushAsk } from "./shell/hooks/usePushAsk";
import { useBlipPhase } from "./shell/hooks/useBlipPhase";
import { useScreenRefresh } from "./shell/hooks/useScreenRefresh";
import { useCurrentScreen } from "./shell/hooks/useCurrentScreen";
import { useKeyboardEntry } from "./shell/hooks/useKeyboardEntry";
import { useFlowArming } from "./shell/hooks/useFlowArming";
import { useForegroundRefresh } from "./shell/hooks/useForegroundRefresh";
import { useNavApi } from "./shell/hooks/useNavApi";
import { useLaunchCard } from "./shell/hooks/useLaunchCard";
import { useBootBreadcrumbs } from "./shell/hooks/useBootBreadcrumbs";
import { useSplashGate } from "./shell/hooks/useSplashGate";
import { useDeepLinkActions } from "./shell/hooks/useDeepLinkActions";
import { useScreenTheme } from "./shell/hooks/useScreenTheme";

export default function SduiApp() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  // Every knob (labels, flags) reads from the bootstrap in hand. Set during
  // render, before any child reads one, so nothing draws with a stale value.
  setKnobs(boot);
  // HOOKS BELONG HERE, above every early return.
  //
  // These two sat further down, past the `auth` / `language` / `connect`
  // returns. React counts hooks per render: those phases ran two fewer, and
  // the moment the app reached `ready` it saw two more and threw "Rendered
  // more hooks than during the previous render" — a blank screen, arriving
  // exactly as the Connection screen handed over.
  const insets = useSafeAreaInsets();
  // The connection (offline.tsx): the Offline page, the line over the rest, the outbox.
  const online = useOnline();
  /** Bumped on every tab tap so the thread plucks again even when the tab
   *  does not change. */
  const [tabPluck, setTabPluck] = useState(0);
  /** Measured, not assumed: the rail spans the row, and the row is whatever the
   *  device is wide minus its insets. 0 until the first layout, which is the
   *  one frame the rail declines to draw. */
  const [tabsWidth, setTabsWidth] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "connect" | "auth">("loading");
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
  // A deep-link / push-notification screen target that arrived DURING cold boot,
  // before loadBoot committed the first stack. Stashed here and applied once we
  // reach "ready" (cold-entry effect below) so the default [home] stack can't
  // clobber it. Mirrors how consumeKeyboardEntry defers keyboard cold-starts.
  const pendingLinkRef = useRef<NavItem | null>(null);

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

  // The backend's arrival prompt, held until the user is plainly idle (hooks/useArrivalPrompt).
  const { cancelArrivalPrompt, armArrivalPrompt } = useArrivalPrompt({ readyRef, setStack });

  // Set once nav/boot exist (effect below). Lets the mount-once link listener
  // dispatch `{kind:"action"}` deep links without capturing a stale nav/flags.
  const runLinkActionRef = useRef<(kind: string, params?: Record<string, string>) => void>(() => {});
  // Likewise the keyboard-entry consumer, for a mic-screen link that arrives
  // while the app is already in front.
  const consumeKbRef = useRef<() => void>(() => {});
  // And the long-press quick action's, for the foreground that follows one.
  const openQuickActionRef = useRef<() => void>(() => {});

  // One-time boot: crash reporting, analytics, IAP, push token, and every way into the app (hooks/useStartup).
  useStartup({ boot, readyRef, pendingLinkRef, consumeKbRef, runLinkActionRef, openQuickActionRef, setStack });

  const showToast = useToast({ setToast });

  // Shared from another app (iOS share extension, Android share intent): the
  // files go to the backend and the share-in screen opens on top of where the
  // person is (src/share/useShareIn.ts).
  useShareIn({ ready: phase === "ready", open: (screenId, params) => setStack((cur) => [...cur, { screenId, params }]), toast: showToast });

  // Bootstrap → first screen, painted from disk first when it can be (hooks/useBootLoader).
  const loadBoot = useBootLoader({
    setPhase, setBoot, setTabId, setShowConnection, setStack, kbEntryRef, kbWantedRef, kbRoutedRef, armArrivalPrompt,
  });

  // The session: restored at launch, followed through sign-in and sign-out (hooks/useAuthSession).
  useAuthSession({ loadBoot, setPhase, setStack, setScreen });

  const current = stack[stack.length - 1];
  // The screen on show, for nav.refreshQuietly (pull-a-bot), which is made once.
  const currentRef = useRef(current);
  currentRef.current = current;

  // The notification permission, asked where and when the server says (hooks/usePushAsk).
  usePushAsk({ current });

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

  // Where the app is, for Blip's overlay; and Reduce Motion (hooks/useBlipPhase).
  useBlipPhase({ phase, shown, screenError });

  /**
   * THE IDENTITY OF WHAT IS ON SCREEN — which is not always what the stack
   * points at, and that difference was a bug for as long as it existed.
   *
   * The host below is keyed so that arriving at a screen remounts it; see
   * there for why. It was keyed from the STACK, and the stack moves the
   * instant a navigation starts, while `shown` above deliberately keeps
   * drawing the previous screen until the new one's fetch lands. Between those
   * two moments the key said "training_chat" and the body was still Home — so
   * React threw the Home tree away and built a second, identical Home, which
   * then sat there until the real screen arrived.
   *
   * Nothing about that is visible as a flash, because the rebuilt screen looks
   * exactly like the one it replaced. What it destroys is everything those
   * components were holding: a pill dragged to its far end went back to the
   * start, an animation restarted, a half-typed field emptied — always at the
   * one moment the user had just committed to something, and always blamed on
   * the control rather than on the screen being silently rebuilt underneath
   * it.
   *
   * So the key follows what is DRAWN. The params come from the topmost stack
   * entry that is actually for this screen, so pushing the same screen with
   * different arguments still counts as arriving.
   */
  const shownKey = useMemo(() => {
    const id = shown?.screenId ?? "";
    if (!id) return "";
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].screenId === id) return `${id}:${JSON.stringify(stack[i].params ?? {})}`;
    }
    return `${id}:{}`;
  }, [shown, stack]);

  // Warm every reachable screen once up, and keep the cached ones fresh while in front (hooks/useScreenRefresh).
  useScreenRefresh({ phase, boot });

  // Fetch the screen on top of the stack, cache first (hooks/useCurrentScreen).
  useCurrentScreen({ phase, current, reload, online, setScreen, setScreenError, setScreenLoading });

  // LIVE UPDATES (live.ts): a change made on another device reloads the screen on show when it listens to that topic, quietly:
  // no spinner, its Store (scroll, an open sheet, what is typed) kept. The socket is open only while the app is in front.
  useLiveUpdates({
    on: phase === "ready", screen: shown, target: current, busy: screenLoading,
    apply: (s) => { setScreen(s); setScreenError(null); },
  });

  // Latest boot in a ref so the AppState listener (deps: [phase]) can read the
  // current home screen id without re-subscribing on every foreground refetch.
  const bootRef = useRef(boot);
  useEffect(() => { bootRef.current = boot; }, [boot]);

  // What the keyboard left in the App Group, routed and armed on cold start and on each foreground (hooks/useKeyboardEntry).
  const consumeKeyboardEntry = useKeyboardEntry({ phase, bootRef, kbEntryRef, kbRoutedRef, pendingLinkRef, consumeKbRef, setStack });

  // THE QUICK-ACCESS WIDGETS' ROWS (and their narrow token), and any answer from a notification still owed: once ready and on
  // each fresh bootstrap (src/widgets/quickAccess.ts; never more often than the server's interval). Coming to the front does the
  // same, below.
  useEffect(() => {
    if (phase === "ready") refreshQuickAccess();
  }, [phase, boot]);

  // A bootstrap in hand: the server's notification buttons registered (cheap: skipped when their signature is unchanged). The
  // boot loader does it on a cold start and a sign-in; this also catches the bootstraps fetched on coming to the front and on a
  // language change, so a new category (a follow's Done / Later / Can't) is there without waiting for the next cold start.
  // (Effects run after the render that called setKnobs(boot), so currentCategories() reads the new list.)
  useEffect(() => { if (boot) void registerNotificationCategories().catch(() => undefined); }, [boot]);

  // The Flow Session armed as soon as the flags allow (hooks/useFlowArming).
  const armIfAllowed = useFlowArming({ phase, boot });

  // Back to the front: heartbeat, credentials, keyboard entry, and a fresh bootstrap when the old one expired (hooks/useForegroundRefresh).
  useForegroundRefresh({ phase, consumeKeyboardEntry, armIfAllowed, openQuickActionRef, setStack, bootRef, setBoot, setReload });

  // The navigation every action and node drives (hooks/useNavApi).
  const nav: NavApi = useNavApi({
    boot, bootRef, currentRef, cancelArrivalPrompt, setStack, setTabId, setReload, setScreen, setScreenError, setBoot,
  });

  // OFFLINE (offline.tsx): Home becomes the Offline page while the connection is down and comes back with it; the outbox
  // sends what was kept, in order, whenever the phone is online, and says so once it has.
  useOfflineSwitch({ ready: phase === "ready", top: current, online, replace: nav.replace });
  useEffect(() => startOutbox(() => {
    const said = str("offline.sentToast", "");
    if (said) showToast(said, "success");
  }), [showToast]);

  // Keep the mount-once deep-link listener reading fresh values: readiness (so a
  // hot link applies immediately while a cold one stashes) and the action
  // dispatcher (so it uses the current nav + flags, not the initial ones).
  useEffect(() => { readyRef.current = phase === "ready"; }, [phase]);

  // The launch card, once per card id (hooks/useLaunchCard).
  useLaunchCard({ phase, boot, setLaunchCard });

  // Where a boot got to, reported by the next launch (hooks/useBootBreadcrumbs).
  useBootBreadcrumbs({ phase, boot, screen, screenError, stack, kbWantedRef, kbRoutedRef });

  // When the splash lifts, and the onboarded mark it reads (hooks/useSplashGate).
  useSplashGate({ phase, boot, screen, screenError, shown });

  // The bare actions a tulmi://action link may run (hooks/useDeepLinkActions).
  useDeepLinkActions({ runLinkActionRef, boot, nav, showToast });

  // The theme in force: the app's, with the screen's groups over it (hooks/useScreenTheme).
  const theme: ThemeTokens | null = useScreenTheme({ boot, screen });

  // Edge-swipe-back: a general, backend-driven capability (src/sdui/shell/gestures).
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

  if (showConnection) {
    return (
      <ConnectionScreen
        onDone={loadBoot}
        onCancel={() => setShowConnection(false)}
      />
    );
  }

  // No server and nothing cached: the offline card, which keeps retrying.
  // The developer's connection screen sits behind a long press on its title,
  // where the server's app.offline.devConnection flag (or a dev build) allows.
  if (phase === "connect") {
    return (
      <OfflineScreen
        theme={boot?.theme}
        onRetry={() => loadBoot({ quiet: true })}
        onDev={() => setShowConnection(true)}
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
    // THE BOOT VIEW IS THE SPLASH, STANDING STILL: the bot on its bar, on the
    // cream, exactly where the native splash and the launch curtain put it
    // (src/launch). At a cold start the curtain is over this and fades onto
    // it or onto the screen; after signing in it is the whole wait. No
    // spinner, and no theme colour: the boot theme is the old app's black.
    return <LaunchStill />;
  }


  const canGoBack = stack.length > 1;
  const tabs = boot?.navigation.kind === "tabs" ? boot.navigation.tabs : [];
  // Present → the tabs are a centred cluster of squares, each on its own
  // ground. Absent → the full-width row, which is what this always drew.
  const dock = boot?.navigation.kind === "tabs" ? boot.navigation.dock : undefined;

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
      {!hideHeader && <Header canGoBack={canGoBack} nav={nav} theme={theme} shown={shown} />}

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

              It is the identity of the screen BEING DRAWN, not the one the
              stack points at — see shownKey above. Those two disagree for the
              length of a fetch, and keying from the stack rebuilt the old
              screen from scratch during it.
            */}
            <ScreenHost
              key={shownKey}
              screen={shown} nav={nav} flags={boot?.flags ?? {}} labels={boot?.labels ?? {}} toast={showToast} />
          </ThemeContext.Provider>
        ) : screenError ? (
          // Never-loaded-once + failure: render a real error card with a
          // Retry button. The old behavior showed a spinner or nothing at
          // all, which read as "the app is broken."
          <View style={[styles.center, { paddingHorizontal: num("app.errorCard.padding", 24) }]}>
            <Text style={typeRole(theme, "errorTitle", { color: theme.color.text, fontSize: 18, fontWeight: "700", marginBottom: 8 })}>
              {txt("error.screenTitle", "Couldn't load this screen")}
            </Text>
            <Text style={typeRole(theme, "errorBody", { color: theme.color.muted, textAlign: "center", marginBottom: 20 })}>
              {screenError}
            </Text>
            <Pressable
              onPress={() => setReload((n) => n + 1)}
              accessibilityRole="button"
              style={{ backgroundColor: theme.color.primary, borderRadius: num("app.errorCard.buttonRadius", 999), paddingVertical: 12, paddingHorizontal: 28 }}
            >
              <Text style={[typeRole(theme, "errorAction", { fontWeight: "700" }), { color: theme.color.bg }]}>
                {txt("action.retry", "Retry")}
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
        {shown && screenError && online !== false && (
          <Pressable
            onPress={() => setReload((n) => n + 1)}
            style={{
              position: "absolute", top: 0, left: 0, right: 0,
              backgroundColor: theme.color.errorBanner ?? color("app.color.errorBanner", "#3a1417"),
              paddingVertical: 10, alignItems: "center",
            }}
          >
            <Text style={[typeRole(theme, "banner", { fontWeight: "600" }), { color: theme.color.errorBannerText ?? color("app.color.errorBannerText", "#FFFFFF") }]}>
              {txt("error.refreshBanner", "Couldn't refresh — tap to retry")}
            </Text>
          </Pressable>
        )}
        {screenLoading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            {/* Pale ink, not the tab's lit amber: loading is waiting, not live. */}
            <ActivityIndicator color="#F3E2C6" />
          </View>
        )}
      </View>

      {!hideChrome && tabs.length > 0 && (
        <TabBar
          boot={boot} theme={theme} insets={insets} dock={dock} tabs={tabs}
          tabsWidth={tabsWidth} setTabsWidth={setTabsWidth} tabId={tabId}
          tabPluck={tabPluck} setTabPluck={setTabPluck} nav={nav}
        />
      )}

      <OfflineBar online={online} screenId={shown?.screenId} top={insets.top + 6} />

      {toast && <ToastView toast={toast} theme={theme} />}

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

      {/* The card the app opens with, LAST in the list and last in the queue.
          Everything above it is something the user must deal with — signing
          in, an update — and an announcement that
          talks over any of those is an announcement nobody reads. */}
      {launchCard && !updateForced && !updateOptional && (
        <LaunchCardOverlay
          card={launchCard}
          theme={theme}
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
