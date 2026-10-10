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
import { list, str } from "../sdui/knobs";
import { isScreenId } from "../security";
import { readAuthLink, type AuthLink } from "../auth/linkState";

export type LinkTarget =
  | { kind: "screen"; screenId: string; params?: Record<string, string> }
  | { kind: "action"; actionKind: string; params?: Record<string, string> }
  /**
   * A SIGN-IN LINK: a PKCE code, a session, or a mailed token hash (see
   * auth/linkState.ts for the shapes). Parsed here so every way a link arrives
   * is looked at once — and redeemed ONLY by auth/linkSignIn.ts, which checks
   * that this phone started that sign-in. Any web page can open tulmi://, and
   * a link minted for someone else's account is precisely what an attacker
   * would send.
   */
  | AuthLink
  | { kind: "unknown" };

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

    // AUTH FIRST: a sign-in link is never also a screen. Its own rules
    // (which parameters, which path) live in auth/linkState.ts.
    const auth = readAuthLink(url);
    if (auth) return auth;

    // A screen id as the server writes them, or nothing: a link from anywhere
    // must not hand the renderer "../" or markup as an id.
    if (list<string>("deeplink.screenPrefixes", ["s", "screen"]).includes(parts[0])) {
      const screenId = parts[1];
      if (isScreenId(screenId)) return { kind: "screen", screenId, params: q };
    }
    if (parts[0] === str("deeplink.actionPrefix", "action") && typeof q.kind === "string" && q.kind) {
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
