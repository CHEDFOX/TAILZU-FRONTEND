import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { RenderNode } from "../Renderer";
import { Store } from "../state";
import { keptStore, liveShowing } from "../live/live";
import { PullBotContext } from "../bots/PullBot";
import { useSoundsState } from "../../media/sounds";
import type { Ctx, NavApi } from "../actions";
import { leaveMedia } from "../../media/media";
import { leaveVoice } from "../voice/voiceLive";
import { leaveSpeech } from "../voice/speech";
import type { ScreenResponse } from "../types";
import { num } from "../knobs";
import { useOfflineState } from "../offline/offline";
import { refreshDeviceSignals } from "../../device/signals";

/** Builds the per-screen Store + Ctx and renders the node tree. */
export function ScreenHost({
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
  // A quiet live reload of the same screen keeps its Store (live.ts); a screen arriving afresh gets a new one.
  const store = useMemo(() => keptStore(screen) ?? new Store(screen.state ?? {}), [screen]);
  useEffect(() => liveShowing(screen, store), [screen, store]);
  // Leaving a screen stops its sound, throws away its recording and stops its upload (media.ts), ends its voice session
  // (voiceLive.ts) and stops the words its call was saying (speech.ts). A quiet live reload keeps the Store, and so the session:
  // a voice chat lives through the feed updating.
  useEffect(() => () => { leaveMedia(store); leaveVoice(store); leaveSpeech(store); }, [store]);
  // Memoised, because it is the identity every RenderNode in the tree reads.
  // Rebuilt each render, it made a single parent re-render — a toast, a
  // foreground bootstrap, a loading flag — walk and re-render the WHOLE screen,
  // which on a tree with Skia canvases and video in it is the difference
  // between a frame and several.
  const ctx: Ctx = useMemo(
    () => ({ store, actions: screen.actions ?? {}, flags, labels, nav, toast }),
    [store, screen.actions, flags, labels, nav, toast],
  );
  // `online`, `outbox` and `outboxWaiting` in the screen's state (offline.tsx).
  useOfflineState(store);
  // `soundsOn` in the screen's state: the Sounds switch shows what this phone has (sounds.ts).
  useSoundsState(store);

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
    iv = setInterval(() => { if (!stop) sync(); }, num("device.signalsPollMs", 1500));
    const subAS = AppState.addEventListener("change", (st) => { if (st === "active") sync(); });
    return () => { disposed = true; if (iv) clearInterval(iv); subAS.remove(); };
  }, [store]);

  // A screen is a full `root` tree; one without draws nothing.
  if (!screen.root) return null;
  // Pull-a-bot, when the screen asks for it: its Screen pulls a bot (PullBot.tsx).
  return (
    <PullBotContext.Provider value={screen.pullBot ?? null}>
      <RenderNode node={screen.root} ctx={ctx} />
    </PullBotContext.Provider>
  );
}
