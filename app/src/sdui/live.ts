/**
 * LIVE UPDATES ON THE PHONE (the rules are liveCore.ts's; the server's side is backend routes/live.ts and src/live).
 *
 * While signed in and in front, one socket to /v1/live. When the server says a topic changed and the screen on show lists it in
 * its `liveTopics`, that screen is fetched again and swapped in QUIETLY: no spinner, the same Store (so its scroll, a sheet that is
 * open and a request in flight all carry on), and the new state written over the old except what was changed on this screen since
 * it loaded (a half-typed field keeps its words). Never while the person is typing; a burst of changes is one reload.
 *
 * In the background the socket closes; back in front it opens again and the screen on show reloads once, since anything said in
 * between was missed. A screen further back reloads when it comes to the front again, as every Bots app screen does (they are
 * never cached).
 *
 * Knobs: live.enabled (true), live.path ("/v1/live"), live.debounceMs (300), live.typingQuietMs (1200).
 *
 *   SduiApp:    useLiveUpdates({ on, screen: shown, target: current, apply })
 *   ScreenHost: store = keptStore(screen) ?? new Store(...);  useEffect(() => liveShowing(screen, store), [screen, store])
 */
import { useEffect, useRef } from "react";
import { AppState, TextInput, type AppStateStatus } from "react-native";
import { getBaseUrl } from "../storage";
import { fetchScreen, token } from "./client";
import { bool, num, str } from "./knobs";
import type { Store } from "./state";
import type { ScreenResponse } from "./types";
import { hears, LiveClient, mergeLiveState, ReloadScheduler, wsUrlOf, type LiveSocket } from "./liveCore";
import { streamEvent } from "./askStream";

type Target = { screenId: string; params?: Record<string, any> };

/** The screen on show and its Store, as ScreenHost last said. */
let showing: { screen: ScreenResponse; store: Store } | null = null;
/** When the person last typed into a field of the screen on show. */
let lastTypedAt = 0;
/** A screen swapped in by a quiet reload → the Store it keeps. */
const kept = new WeakMap<ScreenResponse, Store>();

const typing = (): boolean => {
  try { return !!TextInput.State?.currentlyFocusedInput?.(); } catch { return false; }
};

/** The screen's words: every top-level string in its state, as one. */
function wordsOf(store: Store): string {
  const s = store.snapshot();
  let out = "";
  for (const k in s) if (typeof s[k] === "string") out += `${k}\u0000${s[k]}\u0000`;
  return out;
}

/** The Store a quietly reloaded screen keeps, or undefined for a screen arriving afresh. */
export function keptStore(screen: ScreenResponse): Store | undefined {
  return kept.get(screen);
}

/** ScreenHost: this screen is on show with this Store. Returns the way to say it no longer is. */
export function liveShowing(screen: ScreenResponse, store: Store): () => void {
  const me = { screen, store };
  showing = me;
  // Words changing in the Store while a field has the keyboard are the person typing (the device's readings, also written
  // here, are never words).
  let words = wordsOf(store);
  const unsub = store.subscribe(() => {
    const now = wordsOf(store);
    if (now !== words && typing()) lastTypedAt = Date.now();
    words = now;
  });
  return () => { unsub(); if (showing === me) showing = null; };
}

/**
 * Fetch the screen on show again and swap it in without losing what is on it. Nothing happens when another screen came up in the
 * meantime. `until`: swap it in no sooner than that settles (pull-a-bot's "Checking" has its moment). Returns the screen swapped in,
 * or null when none was.
 */
export async function reloadQuietly(target: Target, apply: (s: ScreenResponse) => void, until?: Promise<unknown>): Promise<ScreenResponse | null> {
  const before = showing;
  if (!before || before.screen.screenId !== target.screenId) return null;
  const next = await fetchScreen(target.screenId, target.params);
  if (until) await until.catch(() => undefined);
  const now = showing;
  if (!now || now.store !== before.store || now.screen.screenId !== next.screenId) return null;
  // One tick, so React draws the writes and the new tree together.
  for (const [path, value] of mergeLiveState(now.screen.state, now.store.snapshot(), next.state)) now.store.set(path, value);
  kept.set(next, now.store);
  apply(next);
  return next;
}

/** Live updates for the app: on while `on` (signed in and drawing screens), the socket only while the app is in front. */
export function useLiveUpdates(o: {
  on: boolean;
  screen: ScreenResponse | null | undefined;
  target: Target | undefined;
  /** A screen is being fetched (a navigation, a retry): it brings the news itself, so no reload starts meanwhile. */
  busy?: boolean;
  apply: (s: ScreenResponse) => void;
}): void {
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    if (!o.on || !bool("live.enabled", true) || typeof WebSocket === "undefined") return;
    const listening = (): readonly string[] | undefined => ref.current.screen?.liveTopics;
    const scheduler = new ReloadScheduler({
      delayMs: num("live.debounceMs", 300),
      quietMs: num("live.typingQuietMs", 1200),
      lastTypedAt: () => lastTypedAt,
      run: async () => {
        const { target, apply, busy } = ref.current;
        if (target && !busy) await reloadQuietly(target, apply).catch(() => undefined);
      },
    });
    const client = new LiveClient({
      open: (url) => new WebSocket(url) as unknown as LiveSocket,
      url: async () => wsUrlOf(await getBaseUrl(), str("live.path", "/v1/live")),
      token: () => token(),
      // An answer's words as they come (askStream.ts) are for the call that asked, never a reload.
      onEvent: (topic, m) => { if (streamEvent(topic, m.data)) return; if (hears(listening(), topic)) scheduler.poke(); },
      onResume: () => { if (listening()?.length) scheduler.poke(); },
    });
    // "inactive" is a moment (a sheet over the app, the switcher): only the background closes the socket.
    const follow = (st: AppStateStatus) => { if (st === "active") client.start(); else if (st === "background") client.stop(); };
    follow(AppState.currentState);
    const sub = AppState.addEventListener("change", follow);
    return () => { sub.remove(); client.stop(); scheduler.cancel(); };
  }, [o.on]);
}
