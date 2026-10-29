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

const KEY = "tz.botLooks.v1";

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
void store.restore();

/** The catalog in use now. */
export function looks(): Looks {
  return store.current;
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
