/**
 * SiteView's decisions, with nothing of React Native in them (SiteView.tsx draws; this decides), so every rule here
 * runs under `node --test` on any machine.
 *
 * A SiteView is a REAL site in a real, persistent WebView: the person signs in to Swiggy or Amazon on the site's own
 * page, full size, with their own keyboard and the SMS code filling itself in, and stays signed in there the way any
 * browser does. Nothing of that session ever leaves the phone. What leaves is what a page said — read here, sent as
 * words — which the server turns into a card. (The server's docs/sites.md, "Signed in on the phone".)
 *
 * The scripts it runs come FROM the server (src/sites/phone.ts there), each an expression that evaluates to a plain
 * object; wrapScript is how one is run and its answer brought back. They live on the server so they change when it
 * deploys, without a build.
 *
 *   siteViewOf(props)     the node's props, checked: anything missing or malformed is no SiteView at all
 *   hostAllowed(url, h)   where the page itself may go: the site, and the sign-in pages a site hands off to
 *   wrapScript(k, js)     a server script made into something injectJavaScript can run and answer from
 *   parseSiteMessage(d)   what came back, size-capped and shaped — every message is untrusted
 *   signInStep / pressed  the walk to the sign-in page, and noticing when they are through it
 *   readOf(v)             a read, trimmed to what the server's route accepts
 */

export type SiteMode = "signin" | "read";

export interface SiteScripts { shape: string; findLogin: string; read: string }

export interface SiteViewProps {
  mode: SiteMode;
  /** Where to start: the site's own sign-in page (or, in read mode, the page to read). */
  url: string;
  /** The site's home, for when the start is not a sign-in and has nothing to press. */
  home?: string;
  /** The host shown to the person, so what they are typing into is never a surprise. */
  site: string;
  /** Host names the page itself may go to: the site's, and a social sign-in's. */
  hosts: string[];
  scripts: SiteScripts;
}

const MAX_SCRIPT = 20_000;
/** Only https: a SiteView keeps the person's cookies, and a page over http could be anyone's. */
const isHttps = (u: string): boolean => /^https:\/\//i.test(u);

/**
 * The sign-in pages a site may hand off to besides itself (Google's and Apple's), compiled in: a sign-in may go there,
 * a read never does, and no screen can add another.
 */
export const SIGN_IN_HANDOFFS: readonly string[] = Object.freeze(["accounts.google.com", "appleid.apple.com"]);

const hostOfUrl = (u: string): string => {
  try { return new URL(u).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
};

/** A name a site owns as a whole ("swiggy.com", "flipkart.co.in"), not a public suffix ("com", "co.in"). */
function ownable(h: string): boolean {
  const labels = h.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) return false;
  const generic = ["co", "com", "org", "net", "gov", "ac", "edu"];
  return !(labels.length === 2 && labels[1].length === 2 && generic.includes(labels[0]));
}

/**
 * Is `h` the same site as the page's own host: that host, one of its subdomains, or the name the site owns that the host
 * is under (www.swiggy.com is swiggy.com's)? A screen that names any other host is refused, so a SiteView can only ever
 * be the site it opens on.
 */
export function sameSite(h: string, pageHost: string): boolean {
  if (!h || !pageHost) return false;
  return h === pageHost || h.endsWith(`.${pageHost}`) || (pageHost.endsWith(`.${h}`) && ownable(h));
}

/** The node's props, or null: a SiteView that cannot say where it is or what it may do draws nothing. */
export function siteViewOf(p: Record<string, unknown> | null | undefined): SiteViewProps | null {
  if (!p) return null;
  const mode = p.mode === "read" ? "read" : p.mode === "signin" ? "signin" : null;
  const url = typeof p.url === "string" && isHttps(p.url) ? p.url : "";
  const site = typeof p.site === "string" ? p.site.trim().toLowerCase() : "";
  const hosts = Array.isArray(p.hosts) ? p.hosts.filter((h): h is string => typeof h === "string" && /^[a-z0-9.-]+$/i.test(h)).map((h) => h.toLowerCase()) : [];
  const s = (p.scripts ?? {}) as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_SCRIPT;
  if (!mode || !url || !site || !hosts.length || !ok(s.shape) || !ok(s.findLogin) || !ok(s.read)) return null;
  // The page it starts on, the name shown, and every host it may go to are one site; a sign-in may also hand off to
  // Google's or Apple's sign-in, and nothing else. A screen that pairs a site with someone else's host draws nothing.
  const pageHost = hostOfUrl(url);
  if (!sameSite(site, pageHost)) return null;
  if (!hosts.every((h) => sameSite(h, pageHost) || (mode === "signin" && SIGN_IN_HANDOFFS.includes(h)))) return null;
  if (!hosts.some((h) => sameSite(h, pageHost)) || !hostAllowed(url, hosts)) return null;
  const home = typeof p.home === "string" && isHttps(p.home) && hostAllowed(p.home, hosts) && sameSite(hostOfUrl(p.home), pageHost) ? p.home : undefined;
  return { mode, url, site, hosts, scripts: { shape: s.shape, findLogin: s.findLogin, read: s.read }, ...(home ? { home } : {}) };
}

/**
 * Where the page itself may go. A site's sign-in hands off to other places (Google, Apple, the site's own auth
 * host), and those are in `hosts`; anywhere else the page tries to take itself is refused, so a SiteView is the
 * site and never a browser that wandered off. about:blank is allowed — WebViews start there.
 */
export function hostAllowed(url: string, hosts: string[]): boolean {
  if (url === "about:blank") return true;
  let h = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    h = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch { return false; }
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * A server script, made runnable by injectJavaScript and able to answer. The answer is posted as `{ k, v }`, or
 * `{ k, e }` if it threw — so a script that breaks on some site says so rather than going quiet. The trailing
 * `true` is what injectJavaScript on iOS wants as the last value.
 */
export function wrapScript(kind: "shape" | "login" | "read", script: string): string {
  return `(function(){var k=${JSON.stringify(kind)};try{var v=(${script});window.ReactNativeWebView.postMessage(JSON.stringify({k:k,v:v}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({k:k,e:String(e&&e.message||e).slice(0,200)}));}})();true;`;
}

export interface PageShape { url: string; title: string; signIn: boolean; loginLink: boolean }
export interface PageRead { url: string; title: string; text: string; elements: Array<{ id: string; role: string; label?: string }> }

export type SiteMessage =
  | { k: "shape"; v: PageShape }
  | { k: "login"; v: { clicked: string | null } }
  | { k: "read"; v: PageRead }
  | { k: "error"; kind: string; message: string };

const MAX_MESSAGE = 120_000;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** What came back from the page, or null. Untrusted: the page's own scripts can post here too, so it is checked. */
export function parseSiteMessage(data: unknown): SiteMessage | null {
  if (typeof data !== "string" || !data || data.length > MAX_MESSAGE) return null;
  let m: Record<string, unknown>;
  try { m = JSON.parse(data) as Record<string, unknown>; } catch { return null; }
  if (!m || typeof m !== "object") return null;
  const k = m.k;
  if (typeof m.e === "string" && (k === "shape" || k === "login" || k === "read")) return { k: "error", kind: k, message: m.e.slice(0, 200) };
  const v = (m.v ?? {}) as Record<string, unknown>;
  if (k === "shape") return { k, v: { url: str(v.url, 2000), title: str(v.title, 200), signIn: v.signIn === true, loginLink: v.loginLink === true } };
  if (k === "login") return { k, v: { clicked: typeof v.clicked === "string" ? v.clicked.slice(0, 80) : null } };
  if (k === "read") return { k, v: readOf(v) };
  return null;
}

/** A read, held to what the server's route accepts (its own caps are the same). */
export function readOf(v: Record<string, unknown>): PageRead {
  const els = Array.isArray(v.elements) ? v.elements.slice(0, 400) : [];
  return {
    url: str(v.url, 2000), title: str(v.title, 200), text: str(v.text, 20_000),
    elements: els.flatMap((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const id = str(x.id, 12), role = str(x.role, 16), label = str(x.label, 120);
      return id && role ? [{ id, role, ...(label ? { label } : {}) }] : [];
    }),
  };
}

// ------------------------------------------------------------------ the walk to the sign-in, and noticing it is done

export interface SignInState {
  /** A sign-in has been on screen. NOTHING IS "SIGNED IN" UNTIL ONE HAS: a page part way through loading looks like nothing. */
  sawSignIn: boolean;
  /** Pages where the site's own "Sign in" has already been pressed (or looked for), so it is pressed once each. */
  pressedOn: string[];
  /** The site's home has been tried, after a start that was not a sign-in and had nothing to press. */
  wentHome: boolean;
  /** Looks since the sign-in went away. Two in a row, a couple of seconds apart, before it counts. */
  clearLooks: number;
  done: boolean;
}

export const freshSignIn = (): SignInState => ({ sawSignIn: false, pressedOn: [], wentHome: false, clearLooks: 0, done: false });

/** How many quiet looks in a row before "they are through": one would catch the blink between a number and its code. */
export const CLEAR_LOOKS = 2;

export type SignInNext = "wait" | "findLogin" | "goHome" | "signedIn";

/** A page without its fragment, so the same page after a drawer opens is still the same page. */
const pageOf = (url: string): string => url.split("#")[0] ?? url;

/**
 * One look at the page during a sign-in, and what to do about it.
 *
 *   a sign-in is showing            wait — the person is typing; note that one has been seen
 *   it was, and now is not, twice   signedIn — and no "Sign in" link on the page either, which a signed-in page lacks
 *   none seen yet, page not pressed findLogin — press the site's own "Sign in" here
 *   otherwise                       wait — the person is looking at the real site and can tap it themselves
 */
export function signInStep(st: SignInState, s: PageShape): { st: SignInState; next: SignInNext } {
  if (st.done) return { st, next: "wait" };
  if (s.signIn) return { st: { ...st, sawSignIn: true, clearLooks: 0 }, next: "wait" };
  if (st.sawSignIn) {
    if (s.loginLink) return { st: { ...st, clearLooks: 0 }, next: "wait" };
    const clearLooks = st.clearLooks + 1;
    if (clearLooks >= CLEAR_LOOKS) return { st: { ...st, clearLooks, done: true }, next: "signedIn" };
    return { st: { ...st, clearLooks }, next: "wait" };
  }
  const here = pageOf(s.url);
  if (!st.pressedOn.includes(here)) return { st: { ...st, pressedOn: [...st.pressedOn, here] }, next: "findLogin" };
  return { st, next: "wait" };
}

/**
 * What the site's "Sign in" press came to. Something pressed: wait, the next look will see the sign-in. Nothing to
 * press: try the site's home once — a start address that has moved, or a 404, has no "Sign in" on it — and after
 * that, leave it to the person, who is looking at the real site.
 */
export function pressed(st: SignInState, clicked: string | null, url: string, home: string | undefined): { st: SignInState; next: SignInNext } {
  if (st.done || clicked) return { st, next: "wait" };
  if (!st.wentHome && home && pageOf(url) !== pageOf(home)) return { st: { ...st, wentHome: true }, next: "goHome" };
  return { st, next: "wait" };
}
