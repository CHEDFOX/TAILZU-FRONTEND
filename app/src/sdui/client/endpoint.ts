import { getBaseUrl } from "../../storage";
import { isBackendPath } from "../../security";
import { QuotaExceededError, HttpError } from "./errors";
import { commonHeaders } from "./http";

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
): Promise<any> {
  if (!isBackendPath(path)) throw new Error(`callEndpoint: refusing path: ${String(path)}`);
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
