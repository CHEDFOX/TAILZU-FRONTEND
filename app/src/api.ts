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
// SDK 56 moved the classic file-system functions to the /legacy entry — same
// namespace actions.ts uses. We need uploadAsync from here (see transcribeClean).
import * as FileSystem from "expo-file-system/legacy";
// Auth + language headers are the SDUI transport's own (one definition).
import { HttpError, commonHeaders as authHeaders, token as getToken } from "./sdui/client";
import { str, list, txt } from "./sdui/knobs";

export type LanguageHint = "auto" | "hi" | "en" | "hinglish" | string;
export type TargetApp = string;

export interface Usage {
  audioSeconds: number;
  words: number;
  model: string;
}

interface Options {
  targetApp?: TargetApp;
  language?: LanguageHint;
}

/**
 * A server-supplied path, appended to the base URL, must begin with "/". The
 * base has no trailing slash, so "@evil.com/x" would turn the backend's host
 * into the user part of ANOTHER host's URL — and the token would go there.
 */
function rooted(path: string): string {
  if (!path.startsWith("/")) throw new Error(`refusing server path: ${path}`);
  return path;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw failed(res.status, `POST ${path} failed: ${res.status} ${await safeText(res)}`);
  return (await res.json()) as T;
}

/**
 * A refused call, worded for a person; the raw path, status and body go to the
 * log. Components show a thrown message as it stands, so this is what users
 * read — it used to be "/v1/refine failed: 500 {…}".
 */
function failed(status: number, detail: string): HttpError {
  console.warn(`[api] ${detail}`);
  return new HttpError(status, detail);
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
  const res = await fetch(`${base}${rooted(str("net.healthPath", "/healthz"))}`);
  if (!res.ok) throw failed(res.status, `health failed: ${res.status}`);
  return res.json();
}

// --- Typing: refine typed text ---------------------------------------------


export async function refine(
  text: string,
  opts: Options & { tone?: string } = {},
): Promise<{ refinedText: string; usage: Usage }> {
  const { tone, ...rest } = opts;
  // Route to the per-tone endpoint like the keyboard does, so the refine runs in
  // the selected tone. "none" → the basic/skip-refine endpoint; a known LLM tone
  // → its dedicated route; anything else → the catch-all /v1/refine.
  const toneId = String(tone ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const tones = list<string>("net.refine.llmTones", ["formal", "casual", "very-casual", "excited"]);
  const path = rooted(tones.includes(toneId)
    ? `${str("net.refinePath", "/v1/refine")}/${toneId}`
    : toneId === "none"
      ? str("net.refineNonePath", "/v1/refine/none")
      : str("net.refinePath", "/v1/refine"));
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

  // THE RECORDING GOES ONCE IT HAS BEEN SENT, sent well or not. expo-audio
  // writes every take to a new file in the cache, so each dictation left the
  // user's voice on disk until the OS happened to purge it; nothing reads a
  // take twice (a failure means recording again).
  const res = await FileSystem.uploadAsync(`${base}${rooted(str("net.transcribeCleanPath", "/v1/transcribe-clean"))}`, audioUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "audio", // backend reads the "audio" part; format falls back to m4a
    mimeType: "audio/m4a",
    parameters,
    headers: { ...(await authHeaders()) },
  }).finally(() => { FileSystem.deleteAsync(audioUri, { idempotent: true }).catch(() => {}); });
  if (res.status < 200 || res.status >= 300) {
    throw failed(res.status, `transcribe failed: ${res.status} ${res.body ?? ""}`);
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
    // The diagnosis is for the log; the person gets words they can act on.
    console.warn(
      `[api] transcribe: the server returned ${res.status} but not JSON — check the ` +
      `backend URL is reaching Tailzu and not a proxy or parked domain. ` +
      `First bytes: ${String(res.body ?? "").slice(0, 80)}`,
    );
    throw new Error(txt("error.badResponse", "Tailzu's server sent something unexpected. Try again in a moment."));
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
  return { url: `${ws}${rooted(str("net.transcribeStreamPath", "/v1/transcribe-stream"))}${query}`, token: await getToken() };
}

// --- Screen: draft a personalized reply -------------------------------------

export async function draft(
  screenContent: string,
  intent: string,
  opts: Options & { recipient?: string } = {},
): Promise<{ draftText: string; usage: Usage }> {
  return jsonPost(rooted(str("net.draftPath", "/v1/draft")), { screenContent, intent, ...opts });
}
