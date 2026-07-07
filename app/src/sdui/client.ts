/**
 * SDUI transport. Talks to the Experience service (/v1/app/*) with the same
 * base URL + Supabase auth as src/api.ts.
 */
import { Appearance, Dimensions, I18nManager, PixelRatio, Platform } from "react-native";
import * as Localization from "expo-localization";
import { getBaseUrl, getLanguage } from "../storage";
import { getSupabaseAccessToken as getAccessToken } from "../auth/supabaseClient";
import type { BootstrapResponse, ScreenResponse } from "./types";
import { CORE_COMPONENTS, CORE_ACTIONS, CORE_TEMPLATES } from "./registry";
import { setKeyboardCredentials } from "../../modules/tulmi-bridge";

export const APP_VERSION = "1.0.0";
const SDUI_SCHEMA_VERSION = 1;

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
  const colorScheme = Appearance.getColorScheme() === "dark" ? "dark" : "light";
  const locale = Localization.getLocales?.()[0]?.languageTag ?? "en-US";
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    platform: Platform.OS === "ios" ? "ios" : "android",
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
  return withRetry(() =>
    post<BootstrapResponse>("/v1/app/bootstrap", { capabilities: buildCapabilities() }),
  );
}

export async function fetchScreen(screenId: string, params?: Record<string, any>): Promise<ScreenResponse> {
  return withRetry(() =>
    post<ScreenResponse>("/v1/app/screen", {
      screenId,
      params,
      capabilities: buildCapabilities(),
    }),
  );
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
