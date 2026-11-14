/**
 * WHAT NEVER GOES TO SENTRY (perms/SPEC.md 4.6, rule 7; docs: perms2 12). Pure, so it is tested in Node (scrubCore.test.ts).
 *
 * Health numbers and the area the phone named must not ride along on a crash report: not in a request body, a breadcrumb, or an
 * extra. The health POST goes to /v1/bots/<slug>/health/days, and the health.sync action carries the same days; both are cut here.
 *
 * Build 8.9.1 adds the rest of what the phone now reads, on exactly the same footing: the busy times of a calendar, the items of
 * the X0 Bot list, whether a Focus is on, the driving answer of a pre-ring check, and every abuse-prevention token. Their bodies
 * are cut whole, because none of them is worth a crash report and all of them are the person's own.
 */

const HEALTH_URL = /\/health\/days(?:[/?#]|$)/;
/** The 8.9.1 paths whose bodies never ride along either (perms2 12). */
const PRIVATE_URL = /\/v1\/botsapp\/plan\/(?:busy|focus|reminders\/sync|calls\/[^/?#]+\/check)(?:[/?#]|$)|\/v1\/trust\//;
const HEALTH_KEYS = new Set([
  "steps", "workouts", "days", "toRead", "area", "home_near",
  // 8.9.1: busy blocks, reminder items and their ops, nightly sleep, motion spans, the Focus and driving answers, and anything
  // Apple or Google handed back for a trust check.
  "blocks", "items", "applied", "add", "update", "remove", "sleepMinutes", "spans",
  "driving", "focus", "hold", "attestation", "assertion", "token", "challenge", "keyId",
]);
const REDACTED = "[health removed]";

const isHealthUrl = (u: unknown) => typeof u === "string" && (HEALTH_URL.test(u) || PRIVATE_URL.test(u));

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
        if (isHealthUrl(url) || /health\.sync|location\.area|calendar\.sync|reminders\.sync|focus\.sync|arrival\.sync|plan_call_check/.test(action)) {
          // The path and the status stay (they are ours, not the person's); everything else the breadcrumb carried goes.
          return { ...b, message: b.message ? REDACTED : b.message, data: b.data ? { url: typeof url === "string" ? url.split("?")[0] : undefined, status_code: b.data.status_code } : b.data };
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
