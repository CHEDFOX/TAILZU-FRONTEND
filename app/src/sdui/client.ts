/**
 * SDUI transport. Talks to the Experience service (/v1/app/*) with the same
 * base URL + Supabase auth as src/api.ts.
 */
import { Appearance, Dimensions, I18nManager, PixelRatio, Platform } from "react-native";
import * as Localization from "expo-localization";
import { getBaseUrl, getLanguage } from "../storage";
import { getSupabaseAccessToken as getAccessToken } from "../auth/supabaseClient";
import type {
  BootstrapResponse,
  ScreenResponse,
  BootstrapRequest,
  ScreenRequest,
} from "./types";
import { SDUI_SCHEMA_VERSION } from "./types";
import { CORE_COMPONENTS, CORE_ACTIONS, CORE_TEMPLATES } from "./registry";
import { setKeyboardCredentials } from "../../modules/tulmi-bridge";

export const APP_VERSION = "1.0.0";

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

export function buildCapabilities() {
  const { width, height } = Dimensions.get("window");
  const colorScheme: "light" | "dark" = Appearance.getColorScheme() === "dark" ? "dark" : "light";
  const locale = Localization.getLocales?.()[0]?.languageTag ?? "en-US";
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    platform: (Platform.OS === "ios" ? "ios" : "android") as "ios" | "android",
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
    },
  };
}

/**
 * Retryable-error tag. 429 (rate-limited) and 5xx (transient backend errors)
 * are worth retrying; 4xx client errors are not. Kept as a class so
 * `withRetry` can type-check the branch without brittle string parsing.
 */
class RetryableFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "RetryableFetchError";
  }
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
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableFetchError(res.status, `${path} → ${res.status}`);
    }
    throw new Error(`${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Retry-with-backoff for transient failures (429 / 5xx / network). Exponential:
 * ~200 ms, 400 ms, 800 ms, capped at 2 s. Only retries the `RetryableFetchError`
 * class and native network errors (TypeError from fetch); permanent 4xx errors
 * short-circuit on the first attempt.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof RetryableFetchError || err instanceof TypeError;
      if (!retryable || i === attempts - 1) throw err;
      const backoff = Math.min(2000, 200 * Math.pow(2, i));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  // TS control-flow appeaser: unreachable in practice.
  throw lastErr;
}

export async function bootstrap(): Promise<BootstrapResponse> {
  const body: BootstrapRequest = { capabilities: buildCapabilities() };
  return withRetry(() => post<BootstrapResponse>("/v1/app/bootstrap", body));
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
    if (peekScreen(id)) continue;           // already warm
    try { await fetchScreen(id); } catch { /* silent: nobody is waiting on it */ }
  }
}

export function invalidateScreens(screenId?: string): void {
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
    screenCache.set(cacheKey(screenId, params), {
      at: Date.now(),
      // Capped: a backend that sends a very long TTL should not be able to
      // pin a screen in memory past the session it was fetched in.
      ttlMs: Math.min(ttl, 900) * 1000,
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
export async function fetchAuthConfig(): Promise<{ enablePhone: boolean } | null> {
  try {
    const b = await bootstrap();
    const f = b.flags ?? {};
    const on = f["auth.enablePhone"];
    return { enablePhone: on === true || on === "true" };
  } catch {
    return null;
  }
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
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(await commonHeaders()) },
    body: body != null && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? res.json() : res.text();
}
