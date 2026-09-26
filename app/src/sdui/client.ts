/**
 * SDUI transport. Talks to the Experience service (/v1/app/*) with the same
 * base URL + Supabase auth as src/api.ts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, Dimensions, I18nManager, PixelRatio, Platform } from "react-native";
import * as Localization from "expo-localization";
import { bumpLaunchCount, getBaseUrl, getLanguage, saveKnobSnapshot } from "../storage";
import { getSupabaseAccessToken as getAccessToken } from "../auth/supabaseClient";
import type {
  BootstrapResponse,
  ScreenResponse,
  BootstrapRequest,
  ScreenRequest,
} from "./types";
import { getDeviceSignals } from "../device/signals";
import { SDUI_SCHEMA_VERSION } from "./types";
import { CORE_COMPONENTS, CORE_ACTIONS, CORE_TEMPLATES } from "./registry";
import { setKeyboardCredentials } from "../../modules/tulmi-bridge";
import { setKnobs, txt, num, bool, str, obj, color } from "./knobs";

/**
 * THE VERSION OF THE BINARY THAT IS ACTUALLY RUNNING.
 *
 * This was the literal "1.0.0" while the store build was 1.0.1, so the update
 * gate compared the server's minimum against a number no device had, and every
 * capability handshake reported the wrong build. The native version is what
 * the store installed; expo-constants' manifest version is the fallback for a
 * runtime without expo-application, and the old literal is the last resort.
 */
function readAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v = require("expo-application")?.nativeApplicationVersion;
    if (typeof v === "string" && v) return v;
  } catch { /* not in this runtime */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const C = require("expo-constants");
    const v = (C?.default ?? C)?.expoConfig?.version;
    if (typeof v === "string" && v) return v;
  } catch { /* not in this runtime */ }
  return "1.0.0";
}

export const APP_VERSION = readAppVersion();

/**
 * Share the current backend URL + the user's token with the native keyboard
 * extension so the keyboard reaches the same backend and authenticates as the
 * user. Safe to call often; no-op in Expo Go.
 */
export async function syncKeyboardCredentials(): Promise<void> {
  try {
    const [base, tok] = await Promise.all([getBaseUrl(), getAccessToken()]);
    setKeyboardCredentials(base, tok ?? "dev");
  } catch {
    // best-effort: never block the app on bridging
  }
}

async function token(): Promise<string> {
  // Signed-in user's Supabase JWT; "dev" fallback for DEV_SKIP_AUTH backends.
  return (await getAccessToken()) ?? "dev";
}

/**
 * Standard headers for every backend call: auth + the user's chosen language.
 * The language token (X-App-Language, plus Accept-Language) lets the backend
 * localize ANY endpoint's response to the selected language — so adding more
 * languages later is purely a backend concern. Omitted until a language is set.
 */
async function commonHeaders(): Promise<Record<string, string>> {
  const [tok, lang] = await Promise.all([token(), getLanguage()]);
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (lang) {
    h["X-App-Language"] = lang;
    h["Accept-Language"] = lang;
  }
  return h;
}

/**
 * Ask for an update, out loud.
 *
 * expo-updates checks on launch by itself and says nothing either way, so a
 * build that never applies an update is indistinguishable from one where no
 * update was ever published — which is exactly the week this cost. This runs
 * the same check explicitly and reports the answer to the server, where one
 * grep settles it: whether the app asked, whether anything was offered, and
 * whether it failed.
 *
 * It does not reload. Applying an update mid-session would swap the bundle out
 * from under whatever the user is doing; expo-updates already applies it on
 * the next launch, and the next launch is soon enough.
 */
export async function reportUpdateCheck(): Promise<void> {
  let outcome = "unavailable";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates");
    if (!Updates.isEnabled) {
      outcome = "disabled";
    } else {
      const res = await Updates.checkForUpdateAsync();
      if (res?.isAvailable) {
        await Updates.fetchUpdateAsync();
        outcome = "fetched";     // applies on the next launch
      } else {
        outcome = "current";
      }
    }
  } catch (e) {
    outcome = `error:${e instanceof Error ? e.message.slice(0, 60) : "?"}`;
  }
  // Best-effort and fire-and-forget: this is diagnostics, never a gate.
  try {
    await callEndpoint("POST", str("net.telemetryPath", "/v1/keyboard/telemetry"), {
      buckets: { kind: "updates" },
      counters: {},
      windowMs: 0,
      build: `ota:${outcome}:${runningBundle()}`,
    });
  } catch { /* the log line is a bonus, not a requirement */ }
}

/**
 * Which JS bundle is actually running.
 *
 * "embedded" means the binary's own bundle with no update applied; otherwise
 * the first eight characters of the update the device is running. It rides
 * along on every request, so the server log answers a question that previously
 * could only be guessed at by looking at the screen.
 */
/**
 * The previous launch's breadcrumb, read once at startup and held here so
 * buildCapabilities stays synchronous. Diagnostic only.
 */
export const LAST_BOOT_NOTE = { value: "unread" };

function runningBundle(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates");
    if (Updates.isEmbeddedLaunch) return "embedded";
    const id = String(Updates.updateId ?? "");
    return id ? id.slice(0, 8) : "embedded";
  } catch {
    return "unknown";
  }
}

export function buildCapabilities() {
  const { width, height } = Dimensions.get("window");
  const colorScheme: "light" | "dark" = Appearance.getColorScheme() === "dark" ? "dark" : "light";
  const locale = Localization.getLocales?.()[0]?.languageTag ?? str("app.defaultLocale", "en-US");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    bundle: runningBundle(),
    lastBoot: LAST_BOOT_NOTE.value,
    platform: (Platform.OS === "ios" ? "ios" : "android") as "ios" | "android",
    // THIS BUNDLE CAN COME BACK FROM GOOGLE. It carries the web path — Google
    // by way of Supabase's page, returning on tulmi:// — so the server may
    // draw the Google button for it. The store binary's own bundle does not
    // say this, and the server leaves the button out of the screen it is
    // handed, because on Android that bundle cannot come back at all. Not a
    // flag to flip: a constant, true of every bundle that has this line.
    googleWeb: true,
    components: CORE_COMPONENTS,
    actions: CORE_ACTIONS,
    templates: CORE_TEMPLATES,
    device: {
      width: Math.round(width),
      height: Math.round(height),
      scale: PixelRatio.get(),
      colorScheme,
      locale,
      // The renderer disables non-essential motion when the OS asks (a11y).
      // We don't currently plumb AccessibilityInfo through this synchronous
      // capability builder; the server-side default is "assume off".
      reduceMotion: false,
      rtl: I18nManager.isRTL,
      // WHAT THIS PHONE ALREADY HAS. The server routes on these: a permission
      // belongs to the device, not the account, so someone signing in on a
      // phone that already granted both has no use for the steps that ask.
      //
      // A bridge that did not answer reads as NOT ready — the conservative
      // direction. Showing a setup step that turns out to be unnecessary
      // costs a tap; skipping one that was necessary leaves the keyboard
      // never enabled, which is the whole product.
      micGranted: getDeviceSignals().micGranted,
      keyboardReady: getDeviceSignals().keyboard?.fullAccess ?? false,
      keyboardEnabled: getDeviceSignals().keyboard?.enabled ?? false,
    },
  };
}

/**
 * Retryable-error tag. 429 (rate-limited) and 5xx (transient backend errors)
 * are worth retrying; 4xx client errors are not. Kept as a class so
 * `withRetry` can type-check the branch without brittle string parsing.
 */
/**
 * The free plan's word cap, refused by the server.
 *
 * Its own class because it is the one failure that is not a failure: nothing is
 * broken, the user has simply used what the free plan includes. Retrying it
 * cannot help and an error toast is the wrong answer — the right one is the
 * paywall, which is what the action runner does when it sees this.
 */
export class QuotaExceededError extends Error {
  constructor(message = "quota_exceeded") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * A REFUSED REQUEST, WORDED FOR THE PERSON HOLDING THE PHONE.
 *
 * The message used to be "/v1/app/screen → 500", and several screens show a
 * thrown error's message as it stands — so that is what users read. The
 * message is now the server's words for what happened (labels error.*), and
 * the raw path + status travel in `detail`, which is what goes to the log.
 */
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(httpErrorText(status));
    this.name = "HttpError";
  }
}

class RetryableFetchError extends HttpError {
  constructor(status: number, detail: string) {
    super(status, detail);
    this.name = "RetryableFetchError";
  }
}

/** What to tell a person about a refused request, by status. */
export function httpErrorText(status: number): string {
  if (status === 401 || status === 403) {
    return txt("error.unauthorized", "Your session has expired. Sign in again to continue.");
  }
  if (status === 404) return txt("error.notFound", "That isn't available right now.");
  if (status === 429) return txt("error.rateLimited", "Too many requests. Wait a moment, then try again.");
  if (status >= 500) return txt("error.server", "Something went wrong on our side. Try again in a moment.");
  return txt("error.generic", "Something went wrong. Try again.");
}

/**
 * Any failure, as something a person can read. Raw detail never reaches the
 * screen from here; callers log it themselves (see logError).
 */
export function userErrorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof QuotaExceededError) {
    return txt("error.quota", "You've used this month's free words.");
  }
  // fetch rejects with a TypeError when there is no connection at all.
  if (err instanceof TypeError) {
    return txt("error.network", "Couldn't reach Tailzu. Check your connection and try again.");
  }
  return txt("error.generic", "Something went wrong. Try again.");
}

/** The raw detail of a failure, for logs only. */
export function errorDetail(err: unknown): string {
  if (err instanceof HttpError) return err.detail;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await commonHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // 429 (rate-limit) and 5xx (server) → let `withRetry` back off and try
    // again; other 4xx are permanent (bad screen id, unauthorized) — throw a
    // plain Error and stop.
    if (res.status === 429) {
      // The word cap is not transient — backing off and asking again four
      // times only delays the paywall by two seconds.
      const text = await res.text().catch(() => "");
      if (text.includes("quota_exceeded")) throw new QuotaExceededError(text);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableFetchError(res.status, `${path} → ${res.status}`);
    }
    console.warn(`[net] ${path} → ${res.status}`);
    throw new HttpError(res.status, `${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Retry-with-backoff for transient failures (429 / 5xx / network). Exponential:
 * ~200 ms, 400 ms, 800 ms, capped at 2 s. Only retries the `RetryableFetchError`
 * class and native network errors (TypeError from fetch); permanent 4xx errors
 * short-circuit on the first attempt.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = num("net.retry.attempts", 4)): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof RetryableFetchError || err instanceof TypeError;
      if (!retryable || i === attempts - 1) {
        if (retryable) console.warn(`[net] giving up: ${errorDetail(err)}`);
        throw err;
      }
      const backoff = Math.min(num("net.retry.maxMs", 2000), num("net.retry.baseMs", 200) * Math.pow(2, i));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  // TS control-flow appeaser: unreachable in practice.
  throw lastErr;
}

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
const BOOT_KEY = (base: string) => `tulmi.cache.boot:${base}`;
const SCREEN_PREFIX = (base: string, ver: string) => `tulmi.cache.screen:${base}:${ver}:`;
let persistBase = "";
let persistVersion = "";

/** The last bootstrap this install received from the current server, or null. */
/**
 * A cached bootstrap is only worth painting while the answers it was computed
 * from still hold.
 *
 * initialScreenId is decided by the server FROM THE DEVICE SIGNALS THE APP
 * SENT — so the copy on disk carries a routing decision made under whatever
 * was true last time. Grant the microphone and reopen the app, and the disk
 * copy still says "show the voice step": it paints, the fresh bootstrap lands
 * a moment later saying otherwise, and the screen the user had already dealt
 * with flashes past on the way to the right one.
 *
 * Stamping the signals into the cache makes that detectable. They match, the
 * cached route is still correct and the app paints instantly as before; they
 * differ, the route is known-stale and the only honest thing to do is wait for
 * the fresh one — a slightly slower open in exactly the case where the fast
 * one would have been wrong.
 */
function signalStamp(): string {
  const d = getDeviceSignals();
  return `${d.micGranted ? 1 : 0}${d.keyboard?.fullAccess ? 1 : 0}${d.keyboard?.enabled ? 1 : 0}`;
}

export async function peekBootstrap(): Promise<BootstrapResponse | null> {
  try {
    const base = await getBaseUrl();
    const raw = await AsyncStorage.getItem(BOOT_KEY(base));
    if (!raw) return null;
    const stored = JSON.parse(raw) as BootstrapResponse & { __signals?: string };
    if (!stored || typeof stored !== "object" || !stored.navigation || !stored.initialScreenId) return null;
    // Written before the stamp existed, or written under different answers.
    if (stored.__signals !== signalStamp()) return null;
    return stored;
  } catch {
    return null;
  }
}

function persistBootstrap(base: string, b: BootstrapResponse): void {
  AsyncStorage.setItem(BOOT_KEY(base), JSON.stringify({ ...b, __signals: signalStamp() })).catch(() => {});
  // And the knobs alone, somewhere the next launch can read before it has
  // loaded anything (see storage.readKnobSnapshotSync).
  saveKnobSnapshot({ labels: b.labels, flags: b.flags as Record<string, unknown> | undefined });
}

/**
 * Point the knobs at the last bootstrap on disk, when nothing better is in hand.
 *
 * The sign-in screen and the pre-boot moments run before this launch has a
 * bootstrap of its own. App.tsx already primes the knobs synchronously where
 * the binary allows (MMKV); this is the asynchronous floor under that, for a
 * binary without it. Unlike peekBootstrap it ignores the device-signal stamp:
 * the stamp guards a ROUTING decision, and knobs are words and numbers.
 */
let knobsPrimed = false;
export function markKnobsPrimed(): void { knobsPrimed = true; }
export async function primeKnobsFromDisk(): Promise<void> {
  if (knobsPrimed) return;
  try {
    const base = await getBaseUrl();
    const raw = await AsyncStorage.getItem(BOOT_KEY(base));
    if (!raw || knobsPrimed) return;
    const stored = JSON.parse(raw) as Partial<BootstrapResponse> | null;
    if (!stored || typeof stored !== "object") return;
    setKnobs({ labels: stored.labels ?? {}, flags: stored.flags ?? {} });
    knobsPrimed = true;
  } catch { /* the fallbacks stand */ }
}

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

export async function bootstrap(): Promise<BootstrapResponse> {
  // Counted here rather than at the call site so every bootstrap — cold
  // start, reconnect, re-bootstrap after a language change — agrees on what
  // "an open" is.
  const launchCount = await bumpLaunchCount();
  const body: BootstrapRequest = { capabilities: buildCapabilities(), launchCount };
  const b = await withRetry(() => post<BootstrapResponse>("/v1/app/bootstrap", body));
  getBaseUrl().then((base) => persistBootstrap(base, b)).catch(() => {});
  knobsPrimed = true;
  lastBootstrapAt = Date.now();
  return b;
}

/** When this session last received a bootstrap from the network (ms epoch). */
let lastBootstrapAt = 0;

/**
 * Forget that the bootstrap is fresh, so the next foreground fetches a new one.
 * For moments that change what it says about the user — a purchase, a restore,
 * hitting the free cap — which must not wait out the server's cache TTL.
 */
export function expireBootstrap(): void {
  lastBootstrapAt = 0;
}

/**
 * Whether a bootstrap received this session is still inside the TTL the
 * server put on it. False when there has been none, or the server sent no TTL.
 */
export function bootstrapIsFresh(b: Pick<BootstrapResponse, "cacheTtlSeconds"> | null | undefined): boolean {
  const ttl = Number(b?.cacheTtlSeconds ?? 0);
  if (!lastBootstrapAt || !Number.isFinite(ttl) || ttl <= 0) return false;
  return Date.now() - lastBootstrapAt < ttl * 1000;
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
const screenCache = new Map<string, CacheEntry>();

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

/**
 * Pre-session auth config, read from the public SDUI bootstrap `flags`. Lets the
 * backend turn auth methods on/off without an app update — e.g. flip phone
 * sign-in on once an SMS provider is live. Resilient: returns null on any
 * failure so the gate falls back to its safe local defaults (never bricks).
 *
 *   flags["auth.enablePhone"] → boolean   (default off)
 */
/** The sign-in backdrop, served in the boot flags. See catalog.ts. */
export type AuthBackground = {
  url: string;
  contentType?: string;
  /** Painted behind the media, so a video's first frame is not a black flash. */
  background: string;
  fit: "cover" | "contain";
};

function readGoogleWeb(v: unknown): { callback: string; resume: string } | null {
  if (!v || typeof v !== "object") return null;
  const callback = String((v as any).callback ?? "");
  const resume = String((v as any).resume ?? "");
  if (!/^https:\/\//.test(callback) || !/^tulmi:\/\//.test(resume)) return null;
  return { callback, resume };
}

export async function fetchAuthConfig(): Promise<
  {
    enablePhone: boolean;
    reviewEmail: string;
    /**
     * Google on Android by way of Supabase's OAuth page. `callback` is the
     * backend page Supabase lands on; `resume` is the app scheme that page
     * hands the session to. Null when the backend has not switched it on,
     * and the native Google client is used instead.
     */
    googleWeb: { callback: string; resume: string } | null;
    background: AuthBackground | null;
    /** The code step's own backdrop, when one was uploaded. */
    backgroundCode: AuthBackground | null;
    /** The server-composed sign-in screen, and whether to draw it. */
    sdui: boolean;
    screen: unknown | null;
    scrim: number;
    suction: unknown | null;
    /** The theme, needed to draw the server tree at all. See AuthGateScreen. */
    theme: BootstrapResponse["theme"] | null;
    /** The bootstrap's flags and labels, for the server tree's ctx. */
    flags: Record<string, unknown>;
    labels: Record<string, string>;
  } | null
> {
  try {
    const b = await bootstrap();
    const f = b.flags ?? {};
    // Every knob below reads THIS bootstrap. The sign-in screen has no other:
    // SduiApp has not committed one yet, so without this the auth screen's
    // words, sizes and switches would all be the compiled-in fallbacks.
    setKnobs(b);
    return {
      enablePhone: bool("auth.enablePhone", false) || f["auth.enablePhone"] === "true",
      // The one address that takes a password instead of a code. Empty
      // whenever the backend is not in a submission window, and an empty
      // string can never equal a typed address, so the path simply is not
      // there the rest of the time.
      reviewEmail: str("auth.reviewEmail", "").trim().toLowerCase(),
      // Both halves or neither. The page has to be https and the resume has
      // to be a scheme this build claims — anything else would send the user
      // somewhere the app cannot come back from, which is the bug this exists
      // to fix.
      googleWeb: readGoogleWeb(obj("auth.googleWeb", {})),
      // Absent whenever nothing has been uploaded to `hero.auth`, and the
      // screen is designed to read on plain black in exactly that case — an
      // empty slot must never cost anyone a broken first screen.
      background: readBackground(obj("auth.background", {})),
      backgroundCode: readBackground(obj("auth.background.code", {})),
      // Both halves must be present. A flag saying yes with no tree behind it
      // would draw an empty sign-in screen, which is worse than the native one
      // in every way — so the absence of either falls back.
      // The tree itself is content, not a knob: absent means "no server
      // screen", and nothing may stand in for it.
      sdui: bool("auth.sdui", false) && !!f["auth.screen"],
      screen: f["auth.screen"] ?? null,
      scrim: Math.max(0, Math.min(1, num("auth.scrim", 0.42))),
      suction: obj("auth.suction", { staggerMs: 95, durationMs: 780, fromY: 120 }),
      theme: b.theme ?? null,
      flags: f as Record<string, unknown>,
      labels: b.labels ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Validate the backdrop the server sent. Anything malformed resolves to null
 * rather than throwing: this runs on the sign-in screen, where a thrown error
 * is a user who cannot get into the app at all.
 */
function readBackground(raw: unknown): AuthBackground | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  // https only. This URL is rendered before there is a session, so it is the
  // one piece of server-controlled content the gate trusts.
  if (!/^https:\/\//i.test(url)) return null;
  const fit = o.fit === "contain" ? "contain" : "cover";
  return {
    url,
    contentType: typeof o.contentType === "string" ? o.contentType : undefined,
    background: typeof o.background === "string" ? o.background : color("auth.background.ground", "#000000"),
    fit,
  };
}

/**
 * Path-only calls to the backend. `path` MUST start with "/v1/" so a
 * malicious/misconfigured backend response can't ever redirect this action to
 * an arbitrary URL. The base URL is added by us, not the caller.
 */
function assertBackendPath(path: string): void {
  if (typeof path !== "string" || !path.startsWith("/v1/")) {
    throw new Error(`callEndpoint: refusing non-/v1/ path: ${path}`);
  }
  // Reject anything that could break out of base — schemes, protocol-relative
  // URLs (//host), or embedded credentials.
  if (
    path.includes("://") ||
    path.startsWith("//") ||
    path.includes("@") ||
    path.includes("\r") ||
    path.includes("\n")
  ) {
    throw new Error(`callEndpoint: unsafe path: ${path}`);
  }
}

/** Generic call used by the `callEndpoint` action. */
export async function callEndpoint(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  assertBackendPath(path);
  const base = await getBaseUrl();
  // NO BODY, NO CONTENT-TYPE.
  //
  // The header went on everything and the body only went on some of it, and
  // that pair is not a small inconsistency: a server told "this is JSON" and
  // handed nothing is entitled to refuse the request, and Fastify's default
  // parser does, with a 400 raised before the route is ever entered.
  //
  // Delete account is the one that made it visible. The request left the
  // phone, reached the server and was turned away at the door, so the button
  // could not have worked on any build that has ever shipped. Every body-less
  // call had the same hole.
  //
  // The server now reads an empty body as {}, which is what it means, and this
  // stops describing a body that is not there.
  const payload = body != null && method !== "GET" ? JSON.stringify(body) : undefined;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await commonHeaders()),
    },
    body: payload,
  });
  if (!res.ok) {
    if (res.status === 429) {
      // Two very different things share this status: the rate limiter, and the
      // free-plan word cap. Only the body tells them apart, and getting it
      // wrong is what made "you have used your free words" arrive as
      // "Something went wrong. Check your connection." — a bug report instead
      // of an upgrade.
      const text = await res.text().catch(() => "");
      if (text.includes("quota_exceeded")) throw new QuotaExceededError(text);
    }
    // The raw path and status go to the log; the thrown message is the one a
    // screen may show (see HttpError).
    console.warn(`[net] ${method} ${path} → ${res.status}`);
    throw new HttpError(res.status, `${method} ${path} → ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? res.json() : res.text();
}
