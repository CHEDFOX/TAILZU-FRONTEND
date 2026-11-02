/** Screens: fetched, kept in memory and on disk by the server's TTL, warmed, refreshed and invalidated. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getBaseUrl } from "../../storage";
import type { ScreenResponse, ScreenRequest } from "../types";
import { num } from "../knobs";
import { post, withRetry } from "./http";
import { buildCapabilities } from "./capabilities";

// ---------------------------------------------------------------------------
// Persisted cache
//
// Everything the app draws comes from the server, so without a disk cache a
// cold start is a blank screen until the network answers — every launch, on
// every connection. Two things persist:
//
//   - The last bootstrap. A cold start paints from it at once and the fresh
//     one replaces it when it lands; offline, it IS the app.
//   - Every screen the server marked cacheable (cacheTtlSeconds > 0). They
//     load into the in-memory cache as STALE at boot, so a screen the user
//     has seen before appears instantly and refreshes behind itself.
//
// Both are keyed by the base url, and screens by the server's cacheVersion
// too, so pointing at another server or a server-side bump orphans every old
// entry rather than serving it. Screens that ask never to be cached
// (cacheTtlSeconds 0 — anything sensitive or live) are never written.
//
// Nothing here blocks: writes are fire-and-forget, and the one read at boot
// is small and bounded. A failure in any of it costs the cache, never the app.
// ---------------------------------------------------------------------------
const SCREEN_PREFIX = (base: string, ver: string) => `tulmi.cache.screen:${base}:${ver}:`;
let persistBase = "";
let persistVersion = "";

/**
 * Load persisted screens for this server + cacheVersion into memory, as stale,
 * and drop persisted screens from any other version. Called once per boot,
 * before the first screen renders.
 */
export async function hydrateScreenCache(cacheVersion: string): Promise<void> {
  try {
    const base = await getBaseUrl();
    persistBase = base;
    persistVersion = String(cacheVersion ?? "");
    const keys = await AsyncStorage.getAllKeys();
    const mine = SCREEN_PREFIX(base, persistVersion);
    const stale: string[] = [];
    const live: string[] = [];
    for (const k of keys) {
      if (!k.startsWith("tulmi.cache.screen:")) continue;
      (k.startsWith(mine) ? live : stale).push(k);
    }
    if (stale.length) AsyncStorage.multiRemove(stale).catch(() => {});
    if (!live.length) return;
    const rows = await AsyncStorage.multiGet(live);
    for (const [k, raw] of rows) {
      if (!raw) continue;
      try {
        const screen = JSON.parse(raw) as ScreenResponse;
        const cacheK = k.slice(mine.length);
        // Only fill what the session has not already fetched fresh.
        if (!screenCache.has(cacheK)) {
          screenCache.set(cacheK, { at: 0, ttlMs: 1, screen });   // stale on arrival
        }
      } catch { /* one bad row must not cost the rest */ }
    }
  } catch { /* cache only */ }
}

function persistScreen(cacheK: string, screen: ScreenResponse): void {
  if (!persistBase) return;
  const key = SCREEN_PREFIX(persistBase, persistVersion) + cacheK;
  AsyncStorage.setItem(key, JSON.stringify(screen))
    .then(async () => {
      // Bounded, not ordered: getAllKeys makes no promise about order, so this
      // drops SOME entries once over the cap, not the oldest. That is fine —
      // the cap is a disk guard, and anything dropped is refetched and
      // re-persisted on the next launch. It is only wrong if the cap is low
      // enough to thrash, which is why it sits well above the screen count.
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(SCREEN_PREFIX(persistBase, persistVersion)));
      const max = num("cache.persistMaxScreens", 80);
      if (keys.length > max) {
        await AsyncStorage.multiRemove(keys.slice(0, keys.length - max));
      }
    })
    .catch(() => {});
}

function unpersistScreens(cacheK?: string): void {
  if (!persistBase) return;
  const prefix = SCREEN_PREFIX(persistBase, persistVersion);
  if (cacheK) { AsyncStorage.removeItem(prefix + cacheK).catch(() => {}); return; }
  AsyncStorage.getAllKeys()
    .then((keys) => AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(prefix))))
    .catch(() => {});
}

/**
 * Screens already fetched, keyed by screen + params.
 *
 * Every navigation used to be a full network round trip — with retry — before
 * anything could render, which is why moving between tabs and in and out of a
 * card felt slow. The backend has been sending `cacheTtlSeconds` on every
 * screen all along and the client simply ignored it.
 *
 * Entries are kept even once stale: a stale screen is shown IMMEDIATELY while a
 * fresh one is fetched behind it, so navigation is instant and the content
 * catches up. That is the right trade for screens that are almost always
 * unchanged between visits — and screens that must never be stale say so
 * themselves with cacheTtlSeconds: 0.
 */
type CacheEntry = { at: number; ttlMs: number; screen: ScreenResponse };
export const screenCache = new Map<string, CacheEntry>();

function cacheKey(screenId: string, params?: Record<string, any>): string {
  return params && Object.keys(params).length
    ? `${screenId}::${JSON.stringify(params)}`
    : screenId;
}

/** A cached screen, fresh or stale, or null. `stale` says whether to revalidate. */
export function peekScreen(
  screenId: string,
  params?: Record<string, any>,
): { screen: ScreenResponse; stale: boolean } | null {
  const hit = screenCache.get(cacheKey(screenId, params));
  if (!hit) return null;
  // ttlMs 0 means the screen asked never to be reused — drop it rather than
  // serving it stale, or a settings toggle would show its old value.
  if (hit.ttlMs <= 0) return null;
  return { screen: hit.screen, stale: Date.now() - hit.at > hit.ttlMs };
}

/**
 * Drop cached screens. Called after any write that could change what a screen
 * renders, so a saved setting is never followed by its own stale copy.
 */
/**
 * Warm the cache for screens the user is about to reach.
 *
 * A TTL only helps the SECOND visit; the first still waits on the network,
 * which is why every tab felt slow the first time even with caching on. The
 * tab destinations are known at boot, so they can be fetched while the user is
 * still reading the first screen — by the time they tap, it is already there.
 *
 * Sequential and silent on purpose: this is background work, so it must not
 * compete with the screen actually being looked at, and must never surface an
 * error for a screen nobody has asked for yet.
 */
export async function prefetchScreens(ids: string[]): Promise<void> {
  for (const id of ids) {
    // Skip only what is genuinely FRESH. Skipping anything merely cached made
    // this a no-op from the second launch onward: hydrateScreenCache loads
    // every persisted screen as stale, so `peekScreen` answered "already warm"
    // for all of them and nothing was ever refetched. The user saw yesterday's
    // numbers until they happened to open the tab.
    const hit = peekScreen(id);
    if (hit && !hit.stale) continue;
    try { await fetchScreen(id); } catch { /* silent: nobody is waiting on it */ }
  }
}

/** Everything in the cache, as the arguments that fetched it. */
function cachedTargets(): Array<{ screenId: string; params?: Record<string, any> }> {
  const out: Array<{ screenId: string; params?: Record<string, any> }> = [];
  for (const k of Array.from(screenCache.keys())) {
    const i = k.indexOf("::");
    if (i < 0) {
      out.push({ screenId: k });
      continue;
    }
    try {
      out.push({ screenId: k.slice(0, i), params: JSON.parse(k.slice(i + 2)) });
    } catch {
      out.push({ screenId: k.slice(0, i) });
    }
  }
  return out;
}

/**
 * Re-fetch every screen the cache holds, and write the results back to disk.
 *
 * The warm list covers the screens the server knows about; this covers the
 * rest — anything reached with params, anything opened last session. Run on
 * each launch and each foreground, so data that changed on the server (usage,
 * history, entitlement) is already correct the moment a screen is opened
 * rather than after the user watches it refresh.
 *
 * Sequential and silent: background work must never compete with the screen
 * being looked at, and must never raise an error for a screen nobody asked for.
 */
export async function refreshCachedScreens(): Promise<void> {
  for (const t of cachedTargets()) {
    try { await fetchScreen(t.screenId, t.params); } catch { /* silent */ }
  }
}

export function invalidateScreens(screenId?: string): void {
  unpersistScreens(screenId ? cacheKey(screenId) : undefined);
  if (!screenId) { screenCache.clear(); return; }
  for (const k of Array.from(screenCache.keys())) {
    if (k === screenId || k.startsWith(`${screenId}::`)) screenCache.delete(k);
  }
}

export async function fetchScreen(screenId: string, params?: Record<string, any>): Promise<ScreenResponse> {
  const body: ScreenRequest = {
    screenId,
    params,
    capabilities: buildCapabilities(),
    // JS getTimezoneOffset is minutes BEHIND UTC (positive west) — negate so
    // the server receives the conventional "UTC+X in minutes" sign.
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  };
  const screen = await withRetry(() => post<ScreenResponse>("/v1/app/screen", body));
  const ttl = Number(screen.cacheTtlSeconds ?? 0);
  if (Number.isFinite(ttl) && ttl > 0) {
    persistScreen(cacheKey(screenId, params), screen);
    screenCache.set(cacheKey(screenId, params), {
      at: Date.now(),
      // Capped: a backend that sends a very long TTL should not be able to
      // pin a screen in memory past the session it was fetched in.
      ttlMs: Math.min(ttl, num("cache.screenTtlCapSeconds", 900)) * 1000,
      screen,
    });
  } else {
    screenCache.delete(cacheKey(screenId, params));
  }
  return screen;
}
