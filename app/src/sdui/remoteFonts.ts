/**
 * Fonts the BACKEND supplies, loaded at runtime.
 *
 * Until now the app could only use fonts the OS already had — the theme could
 * name "Georgia" and nothing else, because nothing was bundled and nothing was
 * downloaded. Changing the product's typeface meant adding a file to the repo
 * and shipping a build, which is the one category of design change that should
 * never need one.
 *
 * The bootstrap can now carry:
 *
 *   fonts: { "Tailzu-Display": "https://.../display.ttf", ... }
 *
 * Each is registered under its own name, so any node can ask for it by
 * `style.fontFamily`, and `theme.font.family` can name one for the whole app.
 *
 * Three rules keep this from being a way to break the app from the server:
 *
 *   - It NEVER blocks. Registration happens in the background and the UI
 *     renders in the system font until a face is ready. A slow or dead font URL
 *     costs nothing but the fallback.
 *   - A failure is per-font and silent. One bad URL cannot stop the others, and
 *     cannot stop the app.
 *   - Only https, and only a font file extension. A font URL is a URL the app
 *     fetches and hands to the OS; it should not be able to be anything else.
 */
import * as Font from "expo-font";

const loaded = new Set<string>();
const inFlight = new Set<string>();

/** A plausible font: https, and a real font extension. */
function usable(name: string, url: string): boolean {
  if (!name || !/^[A-Za-z0-9 _-]{1,64}$/.test(name)) return false;
  if (!/^https:\/\//i.test(url)) return false;
  return /\.(ttf|otf|woff|woff2)(\?|$)/i.test(url);
}

/**
 * Register whatever the backend sent. Safe to call on every bootstrap: names
 * already loaded, or already being loaded, are skipped.
 */
export function loadRemoteFonts(fonts: Record<string, unknown> | undefined): void {
  if (!fonts) return;
  for (const name of Object.keys(fonts)) {
    const url = String(fonts[name] ?? "");
    if (loaded.has(name) || inFlight.has(name)) continue;
    if (!usable(name, url)) continue;
    inFlight.add(name);
    // Deliberately not awaited: the first screens should draw immediately in
    // the system font rather than wait on a network fetch for a typeface.
    Font.loadAsync({ [name]: url })
      .then(() => { loaded.add(name); })
      .catch(() => { /* one bad font must not cost the others, or the app */ })
      .finally(() => { inFlight.delete(name); });
  }
}

/** Names currently available — for a component that wants to avoid a flash. */
export function fontReady(name: string | undefined): boolean {
  return !!name && loaded.has(name);
}
