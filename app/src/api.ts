/**
 * Tulmi backend client. Talks to the Fastify backend (deployed on the VPS;
 * lives in its own repo). Set the base URL in the app's ⚙ Connection screen.
 *
 * Auth sends the signed-in user's Supabase JWT (see src/auth); a "dev" token is
 * used as a fallback against a backend running with DEV_SKIP_AUTH=true.
 *
 * The request/response shapes mirror the backend's shared API contract. Keep
 * them in sync when the contract changes.
 */
import { getBaseUrl, getLanguage } from "./storage";
import { getSupabaseAccessToken as getAccessToken } from "./auth/supabaseClient";

export type LanguageHint = "auto" | "hi" | "en" | "hinglish" | string;
export type TargetApp = string;

export interface Personality {
  tone?: string;
  formality?: "casual" | "neutral" | "formal";
  emoji?: "none" | "minimal" | "expressive";
  languages?: LanguageHint[];
  signature?: string;
  customInstructions?: string;
}

export interface Usage {
  audioSeconds: number;
  words: number;
  model: string;
}

interface Options {
  targetApp?: TargetApp;
  language?: LanguageHint;
  personality?: Personality;
}

async function getToken(): Promise<string> {
  // The signed-in user's Supabase JWT. Falls back to "dev" so the app still
  // works against a backend running with DEV_SKIP_AUTH=true (no session yet).
  return (await getAccessToken()) ?? "dev";
}

async function authHeaders(): Promise<Record<string, string>> {
  // Auth + the user's chosen language, so the backend can follow the selected
  // language on every endpoint (see src/sdui/client commonHeaders).
  const [tok, lang] = await Promise.all([getToken(), getLanguage()]);
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (lang) {
    h["X-App-Language"] = lang;
    h["Accept-Language"] = lang;
  }
  return h;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await safeText(res)}`);
  return (await res.json()) as T;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// --- Health ----------------------------------------------------------------

export async function health(): Promise<{ status: string; service: string; version: string }> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/healthz`);
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return res.json();
}

// --- Typing: refine typed text ---------------------------------------------

export async function refine(text: string, opts: Options = {}): Promise<{ refinedText: string; usage: Usage }> {
  return jsonPost("/v1/refine", { text, ...opts });
}

// --- Voice: transcribe + clean an audio clip (REST, one-shot) ---------------

export async function transcribeClean(
  audioUri: string,
  opts: Options = {},
): Promise<{ cleanedText: string; transcript: string; usage: Usage }> {
  const base = await getBaseUrl();
  const form = new FormData();
  // React Native FormData file shape:
  form.append("audio", {
    uri: audioUri,
    name: "audio.m4a",
    type: "audio/m4a",
  } as unknown as Blob);
  if (opts.targetApp) form.append("targetApp", opts.targetApp);
  if (opts.language) form.append("language", String(opts.language));
  if (opts.personality) form.append("personality", JSON.stringify(opts.personality));

  const res = await fetch(`${base}/v1/transcribe-clean`, {
    method: "POST",
    headers: { ...(await authHeaders()) }, // let fetch set multipart boundary
    body: form,
  });
  if (!res.ok) throw new Error(`transcribe failed: ${res.status} ${await safeText(res)}`);
  return res.json();
}

// --- Voice: live (streaming) dictation --------------------------------------

/**
 * Connection details for live dictation: the WebSocket URL (same host as the
 * REST base, with the ws/wss scheme) and the current auth token. Passed to the
 * native TulmiStream module. See STREAMING.md.
 */
export async function streamConfig(): Promise<{ url: string; token: string }> {
  const base = await getBaseUrl();
  // http→ws, https→wss (https starts with "http", so the prefix swap gives wss).
  const ws = base.replace(/^http/, "ws");
  const lang = await getLanguage();
  const query = lang ? `?language=${encodeURIComponent(lang)}` : "";
  return { url: `${ws}/v1/transcribe-stream${query}`, token: await getToken() };
}

// --- Screen: draft a personalized reply -------------------------------------

export async function draft(
  screenContent: string,
  intent: string,
  opts: Options & { recipient?: string } = {},
): Promise<{ draftText: string; usage: Usage }> {
  return jsonPost("/v1/draft", { screenContent, intent, ...opts });
}

// --- Personality ------------------------------------------------------------

export async function getPersonality(): Promise<Personality> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/v1/personality`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`get personality failed: ${res.status}`);
  const json = (await res.json()) as { personality: Personality };
  return json.personality ?? {};
}

export async function putPersonality(personality: Personality): Promise<Personality> {
  const json = await jsonPost<{ personality: Personality }>("/v1/personality", personality);
  return json.personality ?? {};
}
