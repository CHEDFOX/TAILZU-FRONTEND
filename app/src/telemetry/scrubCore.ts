/**
 * WHAT NEVER GOES TO SENTRY (perms/SPEC.md 4.6, rule 7). Pure, so it is tested in Node (scrubCore.test.ts).
 *
 * Health numbers and the area the phone named must not ride along on a crash report: not in a request body, a breadcrumb, or an
 * extra. The health POST goes to /v1/bots/<slug>/health/days, and the health.sync action carries the same days; both are cut here.
 */

const HEALTH_URL = /\/health\/days(?:[/?#]|$)/;
const HEALTH_KEYS = new Set(["steps", "workouts", "days", "toRead", "area", "home_near"]);
const REDACTED = "[health removed]";

const isHealthUrl = (u: unknown) => typeof u === "string" && HEALTH_URL.test(u);

/** Remove health-shaped keys from any object, to a safe depth. */
function strip(v: unknown, depth = 0): unknown {
  if (depth > 6 || v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => strip(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = HEALTH_KEYS.has(k) ? REDACTED : strip(val, depth + 1);
  }
  return out;
}

interface SentryLike {
  request?: { url?: string; data?: unknown; query_string?: unknown; headers?: unknown; cookies?: unknown };
  breadcrumbs?: { category?: string; message?: string; data?: Record<string, unknown> }[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  message?: string;
}

/** Scrub one Sentry event in place and return it. Never throws (a scrub that failed would drop the report, which is fine, but not crash). */
export function scrubEvent<T extends SentryLike>(event: T): T {
  try {
    if (event.request) {
      if (isHealthUrl(event.request.url)) {
        delete event.request.data;
        delete event.request.query_string;
      } else if (event.request.data !== undefined) {
        event.request.data = strip(event.request.data);
      }
    }
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        const url = b?.data?.url;
        const action = `${b?.message ?? ""} ${b?.category ?? ""}`;
        if (isHealthUrl(url) || /health\.sync|location\.area/.test(action)) {
          return { ...b, message: b.message ? REDACTED : b.message, data: b.data ? { url: isHealthUrl(url) ? "/health/days" : undefined, status_code: b.data.status_code } : b.data };
        }
        return b?.data ? { ...b, data: strip(b.data) as Record<string, unknown> } : b;
      });
    }
    if (event.extra) event.extra = strip(event.extra) as Record<string, unknown>;
    if (event.contexts) event.contexts = strip(event.contexts) as Record<string, unknown>;
  } catch {
    /* leave the event as it is rather than lose the crash */
  }
  return event;
}
