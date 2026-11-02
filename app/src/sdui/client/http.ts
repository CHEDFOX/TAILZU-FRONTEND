/** The plumbing under every backend call: the bearer token, the shared headers, a POST, and the retry around it. */
import { getBaseUrl, getLanguage } from "../../storage";
import { getSupabaseAccessToken as getAccessToken } from "../../auth/supabaseClient";
import { num } from "../knobs";
import { QuotaExceededError, HttpError, errorDetail } from "./errors";

export async function token(): Promise<string> {
  // Signed-in user's Supabase JWT; "dev" fallback for DEV_SKIP_AUTH backends.
  return (await getAccessToken()) ?? "dev";
}

/**
 * Standard headers for every backend call: auth + the user's chosen language.
 * The language token (X-App-Language, plus Accept-Language) lets the backend
 * localize ANY endpoint's response to the selected language — so adding more
 * languages later is purely a backend concern. Omitted until a language is set.
 */
export async function commonHeaders(): Promise<Record<string, string>> {
  const [tok, lang] = await Promise.all([token(), getLanguage()]);
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (lang) {
    h["X-App-Language"] = lang;
    h["Accept-Language"] = lang;
  }
  return h;
}

/**
 * Retryable-error tag. 429 (rate-limited) and 5xx (transient backend errors)
 * are worth retrying; 4xx client errors are not. Kept as a class so
 * `withRetry` can type-check the branch without brittle string parsing.
 */
class RetryableFetchError extends HttpError {
  constructor(status: number, detail: string) {
    super(status, detail);
    this.name = "RetryableFetchError";
  }
}

export async function post<T>(path: string, body: unknown): Promise<T> {
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
export async function withRetry<T>(fn: () => Promise<T>, attempts = num("net.retry.attempts", 4)): Promise<T> {
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
