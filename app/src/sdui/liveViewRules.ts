/**
 * THE LIVE VIEW'S RULES (LiveView.tsx; the server's shared/types/sdui.ts 3e): what a running page may be loaded from, where it may go, and
 * what it may say to the app. Free of react-native, so each rule is tested on its own (liveViewRules.test.ts).
 *
 *   source     `url`: http, https, data: or about: only, never with a name and password in it. `html`: the page the server wrote, run as
 *              `origin` when that is an https origin (the viewer it frames accepts only its own parents), else as an opaque origin.
 *   navigation the page stays where it was put. Its own frames load what they load (http, https, data:, about:, blob:). The top frame
 *              may move only within the site it was opened on (a `url` page's own links); a page the server wrote never moves once it
 *              has loaded. Anything else is refused, and an http(s) address the person clicked may be OFFERED to open in the browser
 *              (the node's allowPopups; the person says yes first).
 *   messages   a string of JSON, 8 KB at most, an object with a short `t`. Everything else is dropped. Every message is untrusted:
 *              the page's own frames can post too.
 */

/** How long a page that says "ready" (`waitForReady`) has to say it. */
export const LIVE_READY_MS = 15_000;
/** The largest message the page may send. */
export const LIVE_MESSAGE_MAX = 8 * 1024;
/** The largest page the server may hand over as `html`. */
export const LIVE_HTML_MAX = 2 * 1024 * 1024;

export type LiveSource = { kind: "url"; url: string } | { kind: "html"; html: string; baseUrl: string };
export type NavDecision = "allow" | "block" | "offer";

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const schemeOf = (url: string): string => (SCHEME.exec(url)?.[1] ?? "").toLowerCase();

/** The origin of an http(s) address, or null (another scheme, or not an address). */
export function originOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /^(https?):\/\/([^/?#]*)/i.exec(url.trim());
  if (!m) return null;
  const authority = m[2]!;
  if (!authority || authority.includes("@")) return null;   // no name and password, no empty host
  return `${m[1]!.toLowerCase()}://${authority.toLowerCase()}`;
}

/** An http(s) address that may be opened in the browser: its host, or null. */
export function openableHost(url: unknown): string | null {
  const o = originOf(url);
  return o ? o.replace(/^https?:\/\//, "").replace(/:\d+$/, "") : null;
}

/** Where the page comes from, or null when nothing it was given may be shown. */
export function liveSourceOf(p: { url?: unknown; html?: unknown; origin?: unknown }): LiveSource | null {
  if (typeof p.html === "string" && p.html.length > 0) {
    if (p.html.length > LIVE_HTML_MAX) return null;
    const o = originOf(p.origin);
    return { kind: "html", html: p.html, baseUrl: o && o.startsWith("https://") ? `${o}/` : "about:blank" };
  }
  if (typeof p.url !== "string") return null;
  const url = p.url.trim();
  const scheme = schemeOf(url);
  if (scheme === "http" || scheme === "https") return originOf(url) ? { kind: "url", url } : null;
  if (scheme === "data" || scheme === "about") return { kind: "url", url };
  return null;
}

/**
 * May the page go to `url`? `topFrame` false is one of its own frames (iOS asks for those too). `settled`: the page has finished its first
 * load, so a page the server wrote is where it will stay.
 */
export function decideNav(o: { source: LiveSource; url: string; topFrame: boolean; settled: boolean }): NavDecision {
  const url = String(o.url ?? "");
  const scheme = schemeOf(url);
  const web = scheme === "http" || scheme === "https";
  if (!(web || scheme === "data" || scheme === "about" || scheme === "blob")) return "block";
  if (!o.topFrame) return "allow";
  if (url === "about:blank" || url.startsWith("about:srcdoc")) return "allow";
  if (o.source.kind === "html") {
    if (!o.settled) {
      if (url === o.source.baseUrl || (web && originOf(url) === originOf(o.source.baseUrl)) || scheme === "data") return "allow";
    }
    return web && originOf(url) ? "offer" : "block";
  }
  const start = o.source.url;
  if (web) {
    const here = originOf(start);
    if (here && originOf(url) === here) return "allow";
    return originOf(url) ? "offer" : "block";
  }
  return !o.settled && url === start ? "allow" : "block";
}

/** A message the page sent: a small object with a `t`, or null. */
export function parseLiveMessage(raw: unknown): (Record<string, unknown> & { t: string }) | null {
  if (typeof raw !== "string" || raw.length > LIVE_MESSAGE_MAX) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const t = (v as { t?: unknown }).t;
  if (typeof t !== "string" || !t || t.length > 32) return null;
  return v as Record<string, unknown> & { t: string };
}

/** What the app tells the page (its window.tzLive), as a line of script; null when there is nothing to tell. */
export function sendScript(send: unknown): string | null {
  if (!send || typeof send !== "object" || Array.isArray(send)) return null;
  let json: string;
  try { json = JSON.stringify(send); } catch { return null; }
  if (!json || json.length > LIVE_MESSAGE_MAX) return null;
  // JSON is a JavaScript expression, but for two line terminators old engines read as the end of a line.
  json = json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `try { if (typeof window.tzLive === "function") window.tzLive(${json}); } catch (e) {} true;`;
}
