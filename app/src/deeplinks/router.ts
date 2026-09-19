/**
 * Deep link / universal link routing.
 *
 * A tap on any of these opens the app + navigates to a screen:
 *   tulmi://screen/xyz               → SDUI screen "xyz"
 *   https://tailzu.space/s/xyz       → same, via Universal Links
 *   https://app.tailzu.space/s/xyz   → same, via Universal Links
 *   tulmi://action?kind=iap.restore  → run a bare action (rare)
 *
 * Path shape is small on purpose so backend can generate share/email/push
 * URLs without a client update.
 */
import * as Linking from "expo-linking";

export type LinkTarget =
  | { kind: "screen"; screenId: string; params?: Record<string, string> }
  | { kind: "action"; actionKind: string; params?: Record<string, string> }
  /**
   * A SIGN-IN LINK THAT WAS MAILED INSTEAD OF A CODE.
   *
   * The app asks Supabase for a one-time code, and which of those two the user
   * receives is decided by an email template rather than by anything here: a
   * template still carrying {{ .ConfirmationURL }} mails a link, and a project
   * with one template fixed and the other not mails a link to some people and a
   * code to others — a new address gets "Confirm signup", a returning one gets
   * "Magic Link".
   *
   * The templates are the fix. This is so that getting them wrong costs a
   * clumsy sign-in rather than a dead one: before this, a tapped link parsed as
   * `unknown`, the app opened on whatever it would have opened on anyway, and
   * the user was left holding a mail that did nothing.
   */
  | { kind: "auth"; tokenHash: string; type: string }
  /** The same, after GoTrue has already redeemed it and handed back a session. */
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "unknown" };

/**
 * Read the fragment of a URL as query parameters.
 *
 * Supabase's implicit flow returns the session AFTER the `#`, which is a place
 * Linking.parse does not look — it reads the query string. The tokens are
 * therefore invisible to every other parse in this file.
 */
/** GoTrue's verification types. Anything else with a `token` is not auth. */
const AUTH_TYPES = new Set([
  "signup", "magiclink", "recovery", "invite", "email", "email_change",
]);

function hashParams(url: string): Record<string, string> {
  const at = url.indexOf("#");
  if (at < 0) return {};
  const out: Record<string, string> = {};
  for (const pair of url.slice(at + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    } catch { /* a malformed pair is not worth failing the whole link over */ }
  }
  return out;
}

export function parseLink(url: string): LinkTarget {
  try {
    const parsed = Linking.parse(url);
    const path = (parsed.path ?? "").replace(/^\/+/, "");
    const pathParts = path.split("/").filter(Boolean);
    // For a CUSTOM-scheme URL (tulmi://screen/paywall) the first segment parses
    // into `hostname`, not `path` — so ignoring hostname meant these never
    // routed (push-tap targets, keyboard/native handoffs all dead-ended).
    // Prepend it for non-HTTPS schemes; HTTPS universal links keep using path
    // (their hostname is the domain, e.g. tailzu.space).
    const parts =
      parsed.scheme && parsed.scheme !== "https" && parsed.hostname
        ? [parsed.hostname, ...pathParts]
        : pathParts;
    const q = (parsed.queryParams ?? {}) as Record<string, string>;

    // AUTH FIRST, and matched on the PARAMETERS rather than on the path.
    //
    // The path is whatever the Site URL and the template happen to produce —
    // /auth/confirm, /auth/callback, or nothing at all — so matching on it
    // means a template edit can silently stop this working.
    //
    // Narrow on purpose. `token_hash` is a Supabase spelling and means only one
    // thing; a bare `token` does not, and a screen link is perfectly entitled
    // to carry one of its own, so that spelling is accepted ONLY alongside a
    // GoTrue type. Getting this wrong would swallow ordinary links.
    const frag = hashParams(url);
    const authType = q.type ?? frag.type;
    const hash = q.token_hash ?? frag.token_hash
      ?? (authType && AUTH_TYPES.has(authType) ? (q.token ?? frag.token) : undefined);
    if (hash) return { kind: "auth", tokenHash: hash, type: authType ?? "email" };
    // Already redeemed by GoTrue, which hands the session back in the fragment.
    const at = q.access_token ?? frag.access_token;
    const rt = q.refresh_token ?? frag.refresh_token;
    if (at && rt) return { kind: "session", accessToken: at, refreshToken: rt };

    if (parts[0] === "s" || parts[0] === "screen") {
      const screenId = parts[1];
      if (screenId) return { kind: "screen", screenId, params: q };
    }
    if (parts[0] === "action" && q.kind) {
      return { kind: "action", actionKind: q.kind, params: q };
    }
  } catch {
    /* fall through */
  }
  return { kind: "unknown" };
}

/**
 * Install a listener that fires whenever a deep link arrives (cold-start or
 * background). Caller decides how to react — usually navigate the SduiApp
 * router.
 */
export function installLinkListener(handler: (target: LinkTarget) => void): () => void {
  // Cold-start URL (app was closed and launched by the link).
  Linking.getInitialURL().then((url) => {
    if (url) handler(parseLink(url));
  }).catch(() => {});
  // Hot links (app was already open).
  const sub = Linking.addEventListener("url", ({ url }) => {
    if (url) handler(parseLink(url));
  });
  return () => sub.remove();
}
