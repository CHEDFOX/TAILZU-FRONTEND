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
// SDK 56 moved the classic file-system functions to the /legacy entry — same
// namespace actions.ts uses. We need uploadAsync from here (see transcribeClean).
import * as FileSystem from "expo-file-system/legacy";

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
  return jsonRequest<T>("POST", path, body);
}

async function jsonRequest<T>(method: string, path: string, body: unknown): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method,
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

const LLM_TONES = new Set(["formal", "casual", "very-casual", "excited"]);

export async function refine(
  text: string,
  opts: Options & { tone?: string } = {},
): Promise<{ refinedText: string; usage: Usage }> {
  const { tone, ...rest } = opts;
  // Route to the per-tone endpoint like the keyboard does, so the refine runs in
  // the selected tone. "none" → the basic/skip-refine endpoint; a known LLM tone
  // → its dedicated route; anything else → the catch-all /v1/refine.
  const toneId = String(tone ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const path = LLM_TONES.has(toneId)
    ? `/v1/refine/${toneId}`
    : toneId === "none"
      ? "/v1/refine/none"
      : "/v1/refine";
  return jsonPost(path, { text, ...rest });
}

// --- Voice: transcribe + clean an audio clip (REST, one-shot) ---------------

export async function transcribeClean(
  audioUri: string,
  opts: Options = {},
): Promise<{ cleanedText: string; transcript: string; usage: Usage }> {
  const base = await getBaseUrl();

  // Upload via expo-file-system's NATIVE multipart uploader — NOT fetch + a
  // React-Native `{ uri, name, type }` FormData part. Under Expo SDK 54+'s
  // WinterCG fetch, that legacy part shape is rejected with
  // "Unsupported FormDataPart implementation" (the exact error users saw on
  // the app mic). uploadAsync streams the file from disk natively and never
  // touches FormData/fetch part serialization, so it works on every runtime.
  const parameters: Record<string, string> = {};
  if (opts.targetApp) parameters.targetApp = opts.targetApp;
  if (opts.language) parameters.language = String(opts.language);
  if (opts.personality) parameters.personality = JSON.stringify(opts.personality);

  const res = await FileSystem.uploadAsync(`${base}/v1/transcribe-clean`, audioUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "audio", // backend reads the "audio" part; format falls back to m4a
    mimeType: "audio/m4a",
    parameters,
    headers: { ...(await authHeaders()) },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`transcribe failed: ${res.status} ${res.body ?? ""}`);
  }
  // A 2xx with a body that is not JSON means something between us and the
  // backend answered instead of the backend — a proxy landing page, a captive
  // portal, a misrouted domain. JSON.parse surfaces that as
  // "Unexpected token <", which tells the user nothing and sends the next hour
  // to the wrong place. Say what actually happened.
  try {
    return JSON.parse(res.body) as {
      cleanedText: string;
      transcript: string;
      usage: Usage;
    };
  } catch {
    throw new Error(
      `transcribe: the server returned ${res.status} but not JSON — check the ` +
      `backend URL is reaching Tailzu and not a proxy or parked domain. ` +
      `First bytes: ${String(res.body ?? "").slice(0, 80)}`,
    );
  }
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
  // PUT, because that is what the route is. This was a POST, which the server
  // answers with a 404 — the call has no caller today, so nothing broke, but
  // the first thing to reach for it would have.
  const json = await jsonRequest<{ personality: Personality }>("PUT", "/v1/personality", personality);
  return json.personality ?? {};
}
