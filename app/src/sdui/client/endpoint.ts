import { getBaseUrl } from "../../storage";
import { isBackendPath } from "../../security";
import { QuotaExceededError, HttpError } from "./errors";
import { commonHeaders } from "./http";
import { bindSubscribeHost } from "../live/subscribe";
import {
  asNetworkError, ENDPOINT_LIMITS, normalizeCache, normalizeMultipart, ResponseCache, toProgress, withRetry, type CallOptions,
} from "./endpointCore";
import { supabaseAuth } from "../../auth/supabaseClient";

export type { CallOptions } from "./endpointCore";

/** Answers kept by `cache: { key, ttlMs }` (endpointCore.ts). */
const answers = new ResponseCache();
/** Sign-out and account changes: nothing kept may outlive the account. */
export function clearCallCache(): void { answers.clear(); }
// Sign-out or a changed account/language clears the kept answers, whoever signed out. (Guarded: tests run without the auth client.)
try {
  supabaseAuth?.onAuthStateChange?.((event: string) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED") { clearCallCache(); try { bindSubscribeHost(null); } catch { /* ignore */ } }
  });
} catch { /* no auth client here */ }

/**
 * Generic call used by the `callEndpoint` action. Path-only: `path` MUST stay
 * under /v1/ on the configured base (security.isBackendPath) so a malicious or
 * misconfigured screen can never send this — and the token with it — anywhere
 * else. The base URL is added here, not by the caller.
 */
export async function callEndpoint(
  method: string,
  path: string,
  body?: unknown,
  opts?: CallOptions,
): Promise<any> {
  if (!isBackendPath(path)) throw new Error(`callEndpoint: refusing path: ${String(path)}`);
  // No options: exactly the call it has always been.
  if (!opts) {
    const r = await send(method, path, body);
    // A write that went through may have changed what a kept answer says (every caller, options or not).
    if (method.toUpperCase() !== "GET") answers.clear();
    return r;
  }
  const isGet = method.toUpperCase() === "GET";
  const cache = isGet ? normalizeCache(opts.cache) : null;
  const ckey = cache ? ResponseCache.keyOf(cache, path) : "";
  if (cache) {
    const hit = answers.get(ckey, Date.now());
    if (hit.hit) return hit.value;
  }
  const multipart = normalizeMultipart(opts.multipart);
  // Files were asked for and none is usable: fail (the action's onError runs) instead of posting without them.
  if (opts.multipart && !multipart) throw new Error("callEndpoint: no usable file to upload");
  const once = () => (multipart ? upload(method, path, multipart, body, opts.onProgress) : send(method, path, body));
  const res = await withRetry(method, opts.retry, once, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  if (cache) answers.set(ckey, res, cache.ttlMs, Date.now());
  // A write that went through may have changed what a kept answer says.
  else if (!isGet) answers.clear();
  return res;
}

const FIELD_NAME = /^[A-Za-z0-9_.\-\[\]]{1,64}$/;

/** The text fields of a multipart body: a plain object's values (anything else is dropped). */
function bodyFields(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const k of Object.keys(body)) {
      const v = (body as Record<string, unknown>)[k];
      if (!FIELD_NAME.test(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v).slice(0, ENDPOINT_LIMITS.fieldValueChars);
    }
  }
  return out;
}

/** Multipart upload with progress. XMLHttpRequest, because fetch cannot say how far an upload has got. The path is already pinned. */
async function upload(
  method: string, path: string, mp: NonNullable<ReturnType<typeof normalizeMultipart>>, body: unknown,
  onProgress?: (p: { loaded: number; total: number; pct: number }) => void,
): Promise<any> {
  const base = await getBaseUrl();
  const headers = await commonHeaders();
  const form = new FormData();
  const fields: Record<string, unknown> = { ...bodyFields(body), ...(mp.fields ?? {}) };
  for (const k of Object.keys(fields)) form.append(k, String(fields[k]));
  // React Native reads { uri, name, type } as a file.
  for (const f of mp.files) form.append(f.field, { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
  let lastTotal = 0;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${base}${path}`);
    // No Content-Type: the boundary is added with the body.
    for (const k of Object.keys(headers)) if (k.toLowerCase() !== "content-type") xhr.setRequestHeader(k, (headers as Record<string, string>)[k]);
    if (onProgress && xhr.upload) xhr.upload.onprogress = (e) => { try { if (e.lengthComputable) lastTotal = e.total; onProgress(toProgress(e.loaded, e.lengthComputable ? e.total : 0)); } catch { /* the screen's own problem */ } };
    xhr.onerror = () => reject(asNetworkError(new Error(`${method} ${path} → network`)));
    xhr.ontimeout = xhr.onerror;
    xhr.onload = () => {
      const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) try { onProgress(lastTotal ? toProgress(lastTotal, lastTotal) : toProgress(1, 1)); } catch { /* ignore */ }
        const ct = xhr.getResponseHeader("content-type") ?? "";
        if (!ct.includes("application/json")) return resolve(text);
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`${method} ${path} → bad json`)); }
        return;
      }
      if (xhr.status === 429 && text.includes("quota_exceeded")) return reject(new QuotaExceededError(text));
      console.warn(`[net] ${method} ${path} → ${xhr.status}`);
      let server: { code: string; message: string } | undefined;
      if (xhr.status < 500) {
        try {
          const b = JSON.parse(text) as { code?: unknown; message?: unknown };
          if (b && typeof b.message === "string" && b.message && b.message.length <= 300) server = { code: typeof b.code === "string" ? b.code : "", message: b.message };
        } catch { /* no explanation */ }
      }
      reject(new HttpError(xhr.status, `${method} ${path} → ${xhr.status}`, server));
    };
    xhr.send(form as unknown as XMLHttpRequestBodyInit);
  });
}

/** One plain JSON call (the original callEndpoint, unchanged). */
async function send(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
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
  const headers = {
    ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(await commonHeaders()),
  };
  let res: Response;
  // Only a fetch that throws is "no network"; everything after an answer came is not.
  try { res = await fetch(`${base}${path}`, { method, headers, body: payload }); } catch (e) { throw asNetworkError(e instanceof Error ? e : new Error(String(e))); }
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
    // A 4xx the server explains ({ code, message }: "That wasn't posted…", "needs your OK…") is kept, so the screen's own
    // failure can say it (actions.ts puts it at state lastError). Never a 5xx's: those stay vague.
    let server: { code: string; message: string } | undefined;
    if (res.status < 500) {
      const b = await res.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
      if (b && typeof b.message === "string" && b.message && b.message.length <= 300) server = { code: typeof b.code === "string" ? b.code : "", message: b.message };
    }
    throw new HttpError(res.status, `${method} ${path} → ${res.status}`, server);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? res.json() : res.text();
}
