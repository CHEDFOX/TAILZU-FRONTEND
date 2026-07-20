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
