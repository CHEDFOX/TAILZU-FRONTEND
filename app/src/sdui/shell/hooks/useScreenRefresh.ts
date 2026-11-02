import { useEffect } from "react";
import { AppState } from "react-native";
import { prefetchScreens, refreshCachedScreens, reportUpdateCheck } from "../../client";
import type { BootstrapResponse } from "../../types";
import { num } from "../../knobs";
import type { Phase } from "../types";

/** How often to refresh cached screens while the app is open and in front. */
const liveRefreshMs = () => num("app.liveRefreshMs", 300000);

/** Every reachable screen warmed once the app is up, and the cached ones kept fresh while it is in front. */
export function useScreenRefresh({ phase, boot }: { phase: Phase; boot: BootstrapResponse | null }) {
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
    }, num("app.warmDelayMs", 600));
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
      timer = setInterval(() => { void refreshCachedScreens(); }, liveRefreshMs());
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
}
