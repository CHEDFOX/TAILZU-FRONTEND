import { useEffect } from "react";
import { AppState } from "react-native";
import { bootstrap, refreshCachedScreens, syncKeyboardCredentials, bootstrapIsFresh } from "../../client";
import { loadRemoteFonts } from "../../theme/remoteFonts";
import type { BootstrapResponse } from "../../types";
import { bool } from "../../knobs";
import { setMediaRegistry, pickMediaRegistry } from "../../../media/resolveMedia";
import { writeAppWarmHeartbeat } from "../../../../modules/tulmi-bridge";
import { refreshQuickAccess } from "../../../widgets/quickAccess";
import type { NavItem, Phase, SetState, Ref } from "../types";
import { transientScreenIds } from "../transientScreens";

/** Back to the front: heartbeat, keyboard credentials, the keyboard's entry, and a new bootstrap once the last one's TTL ran out. */
export function useForegroundRefresh({
  phase, consumeKeyboardEntry, armIfAllowed, openQuickActionRef, setStack, bootRef, setBoot, setReload,
}: {
  phase: Phase;
  consumeKeyboardEntry: () => "record" | "navigated" | "none";
  armIfAllowed: () => Promise<void>;
  openQuickActionRef: Ref<() => void>;
  setStack: SetState<NavItem[]>;
  bootRef: Ref<BootstrapResponse | null>;
  setBoot: SetState<BootstrapResponse | null>;
  setReload: SetState<number>;
}) {
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
      if (phase === "ready") void armIfAllowed();
      if (phase !== "ready") return;
      // Consume whatever the keyboard left (mic-handoff record request or a
      // deep-link tombstone — it can't call openURL itself, so it drops a target
      // in the shared App Group). Handle it before the boot refresh so the user
      // lands on the right screen if they came here via a keyboard action. Same
      // path the cold-start effect above uses.
      const entry = consumeKeyboardEntry();
      if (entry === "record") return;   // mic handoff owns the foreground; skip the reset + refetch
      // A long-press quick action that brought the app forward (iOS), unless the keyboard's entry already placed a screen.
      if (entry === "none") openQuickActionRef.current();
      refreshQuickAccess();
      const navigatedThisForeground = entry === "navigated";
      // Safety net: if we're lingering on a transient mic screen from a PREVIOUS
      // session (recorded/armed, swiped back to the keyboard, now opening the app
      // normally) and we did NOT just navigate there this foreground, reset to
      // home. These screens must never be what a normal app open shows.
      if (!navigatedThisForeground) {
        setStack((prev) => {
          const topId = prev[prev.length - 1]?.screenId;
          if (topId && transientScreenIds().includes(topId)) {
            const home = bootRef.current?.initialScreenId;
            if (home) return [{ screenId: home }];
          }
          return prev;
        });
      }
      // THE BOOTSTRAP CARRIES ITS OWN TTL, and it was ignored: every
      // foreground re-bootstrapped, however recently the last one landed.
      // Inside the TTL the one in hand is what the server said to use; the
      // cached screens still refresh (the live-refresh listener does that),
      // and an explicit reload, a language change or a new launch always
      // fetches. Switchable, in case a release needs the old behaviour back.
      if (bool("cache.honourBootstrapTtl", true) && bootstrapIsFresh(bootRef.current)) return;
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
}
