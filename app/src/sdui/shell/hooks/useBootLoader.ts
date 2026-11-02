import { useCallback } from "react";
import { Platform } from "react-native";
import { publishWidgetMonth } from "../../../widgets/month";
import { bootstrap, peekBootstrap, hydrateScreenCache, syncKeyboardCredentials, callEndpoint } from "../../client";
import { loadRemoteFonts } from "../../theme/remoteFonts";
import type { BootstrapResponse } from "../../types";
import { setKnobs, num, bool, str } from "../../knobs";
import { getLanguage, setLanguage } from "../../../storage";
import { setMediaRegistry, pickMediaRegistry } from "../../../media/resolveMedia";
import { refreshDeviceSignalsBounded } from "../../../device/signals";
import { consumeKeyboardDeepLink, consumeKeyboardRecordRequest } from "../../../../modules/tulmi-bridge";
import { initBilling, isBillingEnabled, hasEntitlement, setBillingKey } from "../../../billing/purchases";
import { publishQuickAccess } from "../../../widgets/quickAccess";
import { publishShareConfig } from "../../../share/shareConfig";
import type { NavItem, Phase, SetState, Ref, KbEntry } from "../types";
import { applyDirection, inferSystemLanguage } from "../locale";

/**
 * How long the whole boot may take before the app stops waiting and offers a
 * retry instead. Generous: a slow connection on a cold start legitimately takes
 * seconds, and interrupting a boot that would have worked is its own bug. What
 * this catches is the boot that was never going to finish.
 */
const bootWatchdogMs = () => num("app.boot.watchdogMs", 12000);

/** Bootstrap → first screen: painted from the disk copy first when there is one, then from the fresh bootstrap. */
export function useBootLoader({
  setPhase, setBoot, setTabId, setShowConnection, setStack, kbEntryRef, kbWantedRef, kbRoutedRef, armArrivalPrompt,
}: {
  setPhase: SetState<Phase>;
  setBoot: SetState<BootstrapResponse | null>;
  setTabId: SetState<string>;
  setShowConnection: SetState<boolean>;
  setStack: SetState<NavItem[]>;
  kbEntryRef: Ref<KbEntry>;
  kbWantedRef: Ref<boolean>;
  kbRoutedRef: Ref<boolean>;
  armArrivalPrompt: (screenId: string, afterMs: number) => void;
}) {
  const loadBoot = useCallback(async (opts?: { quiet?: boolean }) => {
    // The offline card retries quietly: dropping to "loading" unmounted it on
    // every attempt, so it flashed blank and its back-off restarted at zero.
    if (!opts?.quiet) setPhase("loading");
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
      // Every knob read below must see THIS bootstrap, not the one on screen.
      // setKnobs is idempotent, and a render in between (the state set here
      // re-renders with the previous boot) can move it back — so it is called
      // again after each await, right before the reads that follow it.
      setKnobs(b);
      await hydrateScreenCache(String(b.cacheVersion ?? ""));
      // Register any typeface the backend supplied. Never awaited: the first
      // screens draw in the system font and re-render when a face lands.
      loadRemoteFonts((b as unknown as { fonts?: Record<string, unknown> }).fonts);
      // If the user's language flips the layout direction, this restarts the
      // app — so do it before we commit the rest of the boot state.
      setKnobs(b);
      if (await applyDirection()) return false;
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
      // The Home and Lock Screen widget shows this month's numbers; it is
      // handed them here, from the same flags the stats screen draws.
      // The NEW bootstrap's words too, not whatever the knobs last pointed at.
      publishWidgetMonth(b.flags as Record<string, unknown> | undefined, b.labels);
      // The iOS share extension's words and limits, from the same knobs (share/shareConfig.ts).
      publishShareConfig();
      // The app icon's long-press list and a notification's buttons, from this bootstrap (src/widgets/quickAccess.ts).
      publishQuickAccess();
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

      // First screen after auth: the server's initialScreenId. Every routing
      // decision goes through backend flags — the client no longer hardcodes
      // screen ids or branches on their string values.
      setKnobs(b);
      // No language stored: take the answer from the phone rather than asking.
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
      if (!(await getLanguage())) {
        const sys = inferSystemLanguage(b.languages);
        if (sys) {
          try {
            // LOCAL first, and awaited: it is a disk write, it cannot hang, and
            // everything below reads it.
            await setLanguage(sys);
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
            void callEndpoint("PUT", str("net.profilePath", "/v1/profile"), { language: sys })
              .catch(() => { /* the local default already did the work */ });
          } catch { /* a default is not worth failing the boot for */ }
        }
      }
      setKnobs(b);
      const firstScreenId = b.initialScreenId;

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
        const link = consumeKeyboardDeepLink(num("app.keyboard.deepLinkMaxAgeMs", 45000));
        kbEntryRef.current = { rec, link };
        kbWantedRef.current = !!rec || (!!link && link !== "openSettings");
      }
      const kbWantsUs = kbWantedRef.current;

      // The SDK key, from the server, BEFORE anything tries to configure with
      // it. It is the public one — it ships in the binary and sits in the
      // update manifest in plain text — and taking it from here means an
      // `eas update` published without the build variables set can no longer
      // replace a working key with an empty string.
      setKnobs(b);
      setBillingKey(Platform.OS === "ios"
        ? str("billing.revenueCatKey.ios", "")
        : str("billing.revenueCatKey.android", ""));
      const paywallEnt = str("paywall.entitlement", "");
      const paywallBlock = bool("paywall.blockUntilEntitled", false);
      const paywallAfterOnboarding = bool("paywall.showAfterOnboarding", false);
      /**
       * THE STORE DOES NOT GET TO DECIDE WHETHER THE APP OPENS.
       *
       * This awaited RevenueCat on every launch, because an entitlement name
       * is configured — even with both gates switched off, which they are.
       * So a boot that had nothing to gate still waited on a Play Billing
       * connection that can be absent, broken or slow: an emulator, a device
       * with no Play account, a review farm, a blocked region. The SDK retries
       * rather than failing, and the app sat on its splash with no screen and
       * nothing to retry from — which is what "isn't responding" is.
       *
       * It is the same mistake this boot has already made once, with the
       * profile PUT: a best-effort call the boot awaited.
       *
       * So it is awaited ONLY when a gate is actually on and the answer
       * therefore changes what is drawn — and even then the SDK's own
       * deadline applies. Otherwise it is started and left to land.
       */
      if (paywallEnt && (paywallBlock || paywallAfterOnboarding)) await initBilling();
      else if (paywallEnt) void initBilling();
      setKnobs(b);
      // The server's answer counts as much as the store SDK's: a subscription
      // bought on another platform, or granted from the console, is in
      // billing.entitled even when this device's store has never seen it.
      const lacksEntitlement =
        !!paywallEnt && isBillingEnabled() && !hasEntitlement(paywallEnt)
        && !bool("billing.entitled", false);
      const paywallScreenId = str("paywall.screenId", "paywall");
      const shouldShowPaywall =
        lacksEntitlement && (paywallBlock || paywallAfterOnboarding);

      if (shouldShowPaywall) {
        // blockUntilEntitled is a HARD gate — make the paywall the SOLE stack
        // entry so back / edge-swipe has nothing to pop to (pushing it on top of
        // home let the user swipe past it into the full app). The softer
        // showAfterOnboarding paywall stays dismissible (sits on top of home).
        setStack(
          paywallBlock
            ? [{ screenId: paywallScreenId }]
            : [{ screenId: firstScreenId }, { screenId: paywallScreenId }],
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
        // THE BAR FOLLOWS THE SCREEN, ALWAYS.
        //
        // The lit tab was set from navigation.initialTabId and the screen from
        // initialScreenId, two fields that the server works hard to keep in
        // agreement — and any moment they are not, the bar lights one tab
        // while another tab's screen is showing. There are several ways for
        // that to happen and no way to see it from either side: a bootstrap
        // painted from the disk cache is one version behind, a build predating
        // a server change is another, and the fix on the server cannot reach
        // either of them.
        //
        // So the client stops trusting the pair. Whatever screen it has just
        // put on the stack, if that screen is a tab's root then that tab is
        // the one that lights. A tab bar is not a label, it is a claim about
        // where you are, and it is now derived from where you actually are.
        if (b.navigation.kind === "tabs") {
          const owner = b.navigation.tabs.find((t) => (t.screenId ?? t.id) === firstScreenId);
          if (owner) setTabId(owner.id);
        }
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
        const promptScreenId = str("promptScreenId", "");
        if (promptScreenId && promptScreenId !== firstScreenId) {
          armArrivalPrompt(promptScreenId, num("promptAfterMs", 9000));
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
    // So: if the boot has not finished in app.boot.watchdogMs, stop waiting and
    // show the connection screen, which has a retry on it. A wrong-looking
    // retry card beats a dead splash, and if the boot completes later it simply
    // wins — commitBoot sets "ready" and the card is replaced.
    const watchdog = setTimeout(() => {
      setPhase((p) => (p === "loading" ? "connect" : p));
    }, bootWatchdogMs());
    let paintedFromDisk = false;
    try {
      const cached = await peekBootstrap();
      const fresh = bootstrap();
      if (cached) {
        // Give the network a beat; on a good connection the fresh bootstrap
        // wins outright and the disk copy is never shown.
        const race = num("app.boot.diskRaceMs", 350);
        const first = await Promise.race([
          fresh.then((b) => ({ b, fresh: true })),
          new Promise<{ b: BootstrapResponse; fresh: false }>((r) => setTimeout(() => r({ b: cached, fresh: false }), race)),
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
  return loadBoot;
}
