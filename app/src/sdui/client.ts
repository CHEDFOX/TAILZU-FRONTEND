/**
 * SDUI transport. Talks to the Experience service (/v1/app/*) with the same
 * base URL + dev auth as src/api.ts.
 */
import { Platform } from "react-native";
import { getBaseUrl, getLanguage } from "../storage";
import { getAccessToken } from "../auth/auth";
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
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    platform: Platform.OS === "ios" ? "ios" : "android",
    components: CORE_COMPONENTS,
    actions: CORE_ACTIONS,
    templates: CORE_TEMPLATES,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await commonHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function bootstrap(): Promise<BootstrapResponse> {
  return post<BootstrapResponse>("/v1/app/bootstrap", { capabilities: buildCapabilities() });
}

export async function fetchScreen(screenId: string, params?: Record<string, any>): Promise<ScreenResponse> {
  return post<ScreenResponse>("/v1/app/screen", {
    screenId,
    params,
    capabilities: buildCapabilities(),
  });
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

/** Generic call used by the `callEndpoint` action. */
export async function callEndpoint(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
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
