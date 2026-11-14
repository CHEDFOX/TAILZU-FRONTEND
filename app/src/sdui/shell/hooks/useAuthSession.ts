import { useEffect } from "react";
import { AppState } from "react-native";
import { syncKeyboardCredentials, forgetAccountData, primeKnobsFromDisk } from "../../client";
import type { ScreenResponse } from "../../types";
import { outbox } from "../../offline/offline";
import { setLocalAccount } from "../../local";
import { isFreshInstall } from "../../../storage";
import { endFlowSession } from "../../../../modules/tulmi-bridge";
import { supabaseAuth } from "../../../auth/supabaseClient";
import { restoreSession } from "../../../auth/restore";
import { SUPABASE_CONFIGURED } from "../../../auth/supabaseConfig";
import { resetAnalytics } from "../../../telemetry/analytics";
import { identifyBilling, logOutBilling } from "../../../billing/purchases";
import { registerForPushToken, forgetPushToken } from "../../../notifications/push";
import { forgetQuickAccess } from "../../../widgets/quickAccess";
import type { NavItem, Phase, SetState } from "../types";

/**
 * Resolves once the app is in front: the phone is unlocked, and the network is the app's. Only a launch known to be in
 * the background (or passing through inactive) waits; "unknown", which a cold start can report first, does not.
 */
function untilAppActive(): Promise<void> {
  const now = AppState.currentState;
  if (now !== "background" && now !== "inactive") return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") { sub.remove(); resolve(); }
    });
  });
}

/** The session: restored at launch (a reinstall starts signed out), followed through sign-in and sign-out. */
export function useAuthSession({
  loadBoot, setPhase, setStack, setScreen,
}: {
  loadBoot: (opts?: { quiet?: boolean }) => Promise<void>;
  setPhase: SetState<Phase>;
  setStack: SetState<NavItem[]>;
  setScreen: SetState<ScreenResponse | null>;
}) {
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      // The last server's words and numbers, before anything is drawn — the
      // sign-in screen included. App.tsx does this synchronously where the
      // binary can; this is the floor under it.
      // A REINSTALL IS NOT A LAUNCH. The Keychain survives app deletion, so a
      // delete-and-reinstall came back holding the previous install's session
      // and walked straight past sign-in. Cleared BEFORE the session is read,
      // so the app sees what a new install should see: nobody signed in.
      // Local scope only — the account and its other devices are untouched.
      //
      // Asked FIRST, before anything else touches storage: AsyncStorage runs
      // one operation at a time, and a write queued ahead of this check (the
      // boot breadcrumb) made every new install look like one that had run.
      const fresh = await isFreshInstall();
      await primeKnobsFromDisk();
      if (fresh) {
        await supabaseAuth.clearLocalSession().catch(() => {});
      }
      // Gate on auth first: the app needs a JWT to talk to the backend.
      //
      // ONLY A PHONE HOLDING NO SESSION IS SIGNED OUT (auth/restore.ts). A
      // session whose refresh failed for a moment as the app opened, or a
      // Keychain read while the phone was locked, both came back "no session",
      // and the app showed the sign-in page to someone who was signed in until
      // they closed it and opened it again. Those are tried again now; a
      // session still out of reach opens the app as signed in, and is
      // refreshed the moment it can be.
      const restored = SUPABASE_CONFIGURED
        ? await restoreSession({
            getSession: async () => (await supabaseAuth.getSession()).data.session,
            stored: () => supabaseAuth.storedSession(),
            untilActive: () => untilAppActive(),
            sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
          })
        : null;
      // Tie RevenueCat purchases/entitlements to the signed-in user so they
      // restore across devices (was never identified → anonymous-only).
      // WHOSE VALUES THESE ARE (pure/SPEC.md 2.9: `local` has its own namespace). Nothing ever named the
      // account, so every person who signed in on this phone shared the "anon" namespace — and a draft one of
      // them left was the next one's draft. Said at launch and at every session change below.
      setLocalAccount(restored?.state === "in" ? restored.session?.user?.id ?? null : null);
      if (restored?.state === "in" && restored.session?.user?.id) void identifyBilling(restored.session.user.id);
      if (restored?.state === "out") setPhase("auth");
      else await loadBoot();
      // React to sign-out from anywhere (e.g. Settings → Sign out), and — just
      // as important — re-share the freshest JWT with the keyboard extension on
      // every session change. The keyboard reads a token SNAPSHOT from the
      // shared Keychain and cannot refresh Supabase itself, so without this its
      // copy goes stale ~1h after the last app open and every dictation 401s.
      // Supabase's autoRefreshToken fires TOKEN_REFRESHED before expiry; this
      // handler forwards each refresh straight to the keyboard.
      const { data: { subscription } } = supabaseAuth.onAuthStateChange((e, s) => {
        // The phone's own values belong to whoever is signed in (SPEC 2.9), before anything else reads them.
        setLocalAccount(s?.user?.id ?? null);
        // Signed out (or the account deleted): the background microphone goes
        // with the session — nothing may stay armed for nobody — and so does
        // everything else the account left on the phone.
        //
        // SIGNED_OUT only, the one event Supabase sends when the session is
        // really gone. INITIAL_SESSION also comes with no session when the
        // first read failed for a moment, and taking that as a sign-out wiped
        // the phone and showed the sign-in page to someone still signed in.
        if (e === "SIGNED_OUT" && SUPABASE_CONFIGURED) {
          endFlowSession();
          void forgetAccountData();
          outbox.clearAll();
          resetAnalytics();
          void logOutBilling();
          forgetPushToken();
          // Nothing of the account in a widget, the Keychain's widget token or an owed notification answer.
          forgetQuickAccess();
          // Nor may their last screen be what the next account sees first.
          setStack([]);
          setScreen(null);
          setPhase("auth");
          return;
        }
        if (s) void syncKeyboardCredentials();
        // A sign-in inside this launch (the gate, or after a sign-out) is a
        // new owner for the store's purchases and this phone's push token;
        // both were only ever claimed at launch.
        if (s && e === "SIGNED_IN") {
          void identifyBilling(s.user.id);
          void registerForPushToken();
        }
      });
      const front = AppState.addEventListener("change", (next) => {
        if (next === "active") void supabaseAuth.startAutoRefresh().catch(() => {});
      });
      unsub = () => { subscription.unsubscribe(); front.remove(); };
    })();
    return () => unsub();
  }, [loadBoot]);
}
