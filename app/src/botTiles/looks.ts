/**
 * THE BOTS' LOOKS AND MOMENTS ON THIS PHONE: the store (looksStore.ts) with the build's starter pack (starter.ts), the
 * device's kept copy (AsyncStorage) and the server's (GET on the API's own origin, when the bootstrap's "bots.looks"
 * flag names a version this phone does not have). BotTiles, BotBuddy and BotCard read `looks()` and re-skin their bots
 * when `useLooks()` says a new catalog is in.
 */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getBaseUrl } from "../storage";
import type { Looks } from "./core";
import { LooksStore } from "./looksStore";
import { STARTER } from "./starter";

// The kept copy's key carries the format: a build that plays format 2 must not keep reading the format-1 copy a
// format-1 build of the same version left behind (SPEC 2.7).
const KEY = "tz.botLooks.f2";

const store = new LooksStore(STARTER, {
  read: () => AsyncStorage.getItem(KEY),
  write: (text) => AsyncStorage.setItem(KEY, text),
  fetch: async (path) => {
    const base = await getBaseUrl();
    const res = await fetch(base.replace(/\/$/, "") + path, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`bots looks ${res.status}`);
    return res.json();
  },
});
// The kept copy, as soon as the app starts (a screen drawn before it lands wears the starter's looks, then these).
const restored = store.restore();
void restored;

/**
 * The catalog in use, for code outside React (native/botArt.ts draws the widgets' stills with it). It waits for the
 * kept copy, because in a silent-push wake the app has only just started and a plain getter would hand back the
 * build's starter pack.
 */
export async function currentLooks(): Promise<Looks> {
  try {
    await restored;
  } catch { /* nothing kept, or nothing readable: the starter stands */ }
  return store.current;
}

/** The catalog as it stands this instant, with the server's switched-off moments (scene.ts's renderStill). */
export function looksNow(): { looks: Looks; off: (id: string) => boolean } {
  return { looks: store.current, off: (id: string) => store.isOff(id) };
}

/** The bootstrap's "bots.looks" flag: fetch and keep the server's catalog when it is another version. Never throws. */
export function syncLooks(flag: unknown): void {
  void store.sync(flag).catch(() => {});
}

/** The catalog in use, as React state: a component re-renders when a new one is in. */
export function useLooks(): Looks {
  const [l, setL] = useState<Looks>(store.current);
  useEffect(() => {
    if (l !== store.current) setL(store.current);
    return store.subscribe(setL);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

/**
 * WHAT THIS PHONE REPORTS BACK about the catalog (anim/SPEC.md 3.9), so a push is never a silent no-op: the version
 * and format in use, whether it compiled, and the first scenes that went wrong or that the governor slowed. At most
 * 512 bytes, and nothing about the person. It rides on every bootstrap (sdui/client/capabilities.ts), and the server
 * logs it when `ok` is false or `bad`/`slow` is set.
 */
const trouble = { bad: [] as string[], slow: [] as string[] };

/** A tile noticed a scene misbehaving. Called only when there is something to say, so a good frame costs nothing. */
export function noteScenes(bad: readonly string[], slow: readonly string[]): void {
  for (const b of bad) if (b && !trouble.bad.includes(b) && trouble.bad.length < 4) trouble.bad.push(b);
  for (const s of slow) if (s && !trouble.slow.includes(s) && trouble.slow.length < 4) trouble.slow.push(s);
}

export interface LooksReport { v: number; f: number; ok: boolean; why?: string; bad?: string[]; slow?: string[] }

export function looksReport(): LooksReport {
  const L = store.current;
  const out: LooksReport = { v: L.v, f: store.currentF, ok: !L.errors.length };
  if (L.errors.length) out.why = String(L.errors[0]).slice(0, 120);
  if (trouble.bad.length) out.bad = trouble.bad.slice(0, 4);
  if (trouble.slow.length) out.slow = trouble.slow.slice(0, 4);
  return out;
}
