import { useMemo } from "react";
import { bootstrap } from "../../client";
import { loadRemoteFonts } from "../../theme/remoteFonts";
import { reloadQuietly } from "../../live/live";
import type { NavApi } from "../../actions";
import type { BootstrapResponse, ScreenResponse } from "../../types";
import { setKnobs } from "../../knobs";
import { setMediaRegistry, pickMediaRegistry } from "../../../media/resolveMedia";
import type { NavItem, SetState, Ref } from "../types";
import { applyDirection } from "../locale";
import { transientScreenIds } from "../transientScreens";

/** The navigation every action and node drives: push, replace, back, switchTab, reloads, and the quiet refresh. */
export function useNavApi({
  boot, bootRef, currentRef, cancelArrivalPrompt, setStack, setTabId, setReload, setScreen, setScreenError, setBoot,
}: {
  boot: BootstrapResponse | null;
  bootRef: Ref<BootstrapResponse | null>;
  currentRef: Ref<NavItem | undefined>;
  cancelArrivalPrompt: () => void;
  setStack: SetState<NavItem[]>;
  setTabId: SetState<string>;
  setReload: SetState<number>;
  setScreen: SetState<ScreenResponse | null>;
  setScreenError: SetState<string | null>;
  setBoot: SetState<BootstrapResponse | null>;
}) {
  const nav: NavApi = useMemo(
    () => ({
      // Any of these means the user is doing something, so a pending arrival
      // prompt is dropped rather than landing on top of it. The server will
      // ask again on a later launch; interrupting is the one thing it must
      // not do.
      push: (screenId, params, present) => {
        cancelArrivalPrompt();
        setStack((s) => [...s, { screenId, params, present }]);
      },
      // Swap the top rather than stack on it. A linear flow — onboarding — is
      // a sequence of steps, not a place you browse: pushing left every step
      // behind the next one, so an edge swipe walked back into a permission
      // screen that had already been answered. Replacing means each step is
      // the only thing on the stack and there is nothing to go back to.
      replace: (screenId, params, present) => {
        cancelArrivalPrompt();
        setStack((s) => (s.length ? [...s.slice(0, -1), { screenId, params, present }] : [{ screenId, params, present }]));
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
          const transient = !!top && transientScreenIds().includes(top);
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
      // Pull-a-bot's refresh: the live updates' quiet reload (no spinner, the Store kept), swapped in once `until` settles.
      refreshQuietly: (until) => {
        const target = currentRef.current;
        if (!target) return Promise.resolve(null);
        return reloadQuietly(target, (s) => { setScreen(s); setScreenError(null); }, until);
      },
      refreshLocale: () => {
        // Re-pull bootstrap so labels + direction reflect the new language,
        // then re-fetch the current screen in place (stack is preserved).
        (async () => {
          try {
            const b = await bootstrap();
            // Register any typeface the backend supplied. Never awaited: the
            // first screens draw in the system font and re-render when a face
            // lands.
            loadRemoteFonts((b as unknown as { fonts?: Record<string, unknown> }).fonts);
            setKnobs(b);
            if (await applyDirection()) return; // RTL change → app restarts
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
  return nav;
}
