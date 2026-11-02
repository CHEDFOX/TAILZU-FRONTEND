import { useEffect } from "react";
import { AppState } from "react-native";
import type { BootstrapResponse } from "../../types";
import { writeAppWarmHeartbeat } from "../../../../modules/tulmi-bridge";
import { initAnalytics } from "../../../telemetry/analytics";
import { initMeta } from "../../../telemetry/meta";
import { initSentry } from "../../../telemetry/sentry";
import { initBilling } from "../../../billing/purchases";
import { registerForPushToken, addNotificationResponseListener, addNotificationArrivalListener } from "../../../notifications/push";
import { installLinkListener, parseLink } from "../../../deeplinks/router";
import { refreshQuickAccess } from "../../../widgets/quickAccess";
import { onQuickAction, takeQuickAction } from "../../../quickActions/quickActions";
import { redeemSignInLink } from "../../../auth/linkSignIn";
import { isScreenId } from "../../../security";
import type { NavItem, SetState, Ref } from "../types";
import { transientScreenIds } from "../transientScreens";

/** One-time boot: crash reporting, analytics, IAP, push token, and every way into the app (links, notifications, quick actions). */
export function useStartup({
  boot, readyRef, pendingLinkRef, consumeKbRef, runLinkActionRef, openQuickActionRef, setStack,
}: {
  boot: BootstrapResponse | null;
  readyRef: Ref<boolean>;
  pendingLinkRef: Ref<NavItem | null>;
  consumeKbRef: Ref<() => void>;
  runLinkActionRef: Ref<(kind: string, params?: Record<string, string>) => void>;
  openQuickActionRef: Ref<() => void>;
  setStack: SetState<NavItem[]>;
}) {
  // One-time boot: crash reporting, analytics, IAP, push token, deep links.
  // Each init is a silent no-op when its env key is unset, so the same binary
  // works for dev/beta/prod builds without code changes.
  useEffect(() => {
    initSentry();
    void initAnalytics();
    initMeta();
    void initBilling();
    void registerForPushToken();
    // Warm heartbeat — tells the keyboard extension "the main app is alive
    // right now, handoff will be fast". Bumped on every foreground below;
    // this initial call covers cold starts.
    writeAppWarmHeartbeat();
    const linkSub = installLinkListener((target) => {
      if (target.kind === "screen") {
        // A MIC SCREEN IS NOT A LINK TARGET. flow_arm arms the background
        // microphone the moment it appears (keyboard_record and the primer
        // start a recording), and any web page can open tulmi://. The keyboard
        // and the Dictate control open these screens with an App-Group
        // tombstone beside the URL — which only this app's own extensions can
        // write — and the tombstone is what routes and arms
        // (consumeKeyboardEntry), on the cold start or the foreground that
        // follows. Already in front, no foreground is coming: consume it here.
        if (transientScreenIds().includes(target.screenId)) {
          if (readyRef.current && AppState.currentState === "active") consumeKbRef.current();
          return;
        }
        const item: NavItem = { screenId: target.screenId, params: target.params };
        // Hot link (app already booted) → navigate now. Cold link (arrived
        // mid-boot) → stash; the cold-entry effect applies it after the first
        // stack commits, so loadBoot's default screen doesn't win the race.
        if (readyRef.current) setStack([item]);
        else pendingLinkRef.current = item;
      } else if (target.kind === "action") {
        // `tulmi://action?kind=…` — run a bare action (guarded whitelist).
        runLinkActionRef.current(target.actionKind, target.params);
      } else if (target.kind === "auth" || target.kind === "session" || target.kind === "code") {
        // A SIGN-IN LINK: Google coming back from Supabase's page (a cold
        // start, if Android dropped the app meanwhile), or a mailed link when
        // a template sends one instead of a code. Redeeming it lands a session
        // exactly as typing the code would, and the auth gate is watching for
        // one, so the app simply proceeds.
        //
        // ONLY FOR A SIGN-IN THIS PHONE STARTED. Any web page can open
        // tulmi://, and a link carrying a session, code or token hash minted
        // for the ATTACKER's account would otherwise sign the victim into it —
        // everything they dictate from then on lands where the attacker reads
        // it. linkSignIn checks the link's state against the one this phone
        // is waiting for (and PKCE binds the code to this phone's verifier).
        //
        // A refused or spent link is not worth a dialog: the user is looking
        // at the sign-in screen, which still works.
        void redeemSignInLink(target)
          .then((r) => { if (!r.ok) console.warn(`[auth] sign-in link not redeemed: ${r.verdict}`, r.message ?? ""); })
          .catch((e) => console.warn("[auth] sign-in link could not be redeemed:", e));
      }
    });
    const notifSub = addNotificationResponseListener((data) => {
      if (!isScreenId(data?.screenId)) return;
      const item: NavItem = { screenId: String(data.screenId), params: data };
      if (readyRef.current) setStack([item]);
      else pendingLinkRef.current = item;
    });
    // LONG-PRESS THE APP ICON (iOS; src/quickActions): the chosen item's link, taken once and routed like any link. Never a
    // microphone screen: an item that arms one left the keyboard's tombstone instead, which consumeKeyboardEntry routes. Taken now
    // (a cold launch from one), when one arrives while the app runs, and on coming to the front (below).
    const openQuickAction = () => {
      const url = takeQuickAction();
      if (!url) return;
      const t = parseLink(url);
      if (t.kind !== "screen" || transientScreenIds().includes(t.screenId)) return;
      const item: NavItem = { screenId: t.screenId, params: t.params };
      if (readyRef.current) setStack([item]);
      else pendingLinkRef.current = item;
    };
    openQuickActionRef.current = openQuickAction;
    openQuickAction();
    const quickSub = onQuickAction(openQuickAction);
    // A push while the app runs may be news for the widgets (src/widgets/now.ts).
    const arrivalSub = addNotificationArrivalListener(() => refreshQuickAccess({ force: true }));
    return () => { linkSub(); notifSub.remove(); quickSub(); arrivalSub.remove(); };
  }, []);

  // Meta again once a bootstrap is in hand (src/telemetry/meta.ts): the mount's try above comes before the server's knobs,
  // so on an iPhone it never finds ads.meta.ios.enabled and never asks Apple's tracking prompt. This one does, on the first
  // bootstrap that turns it on. A no-op once Meta has started, or while it stays off.
  useEffect(() => { if (boot) initMeta(); }, [boot]);
}
