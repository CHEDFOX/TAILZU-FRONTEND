/**
 * WHERE THE APP WILL GO, AND WHAT IT WILL CARRY THERE.
 *
 * Every check that stands between a string and a request, a browser or the
 * user's token lives here, free of react-native so each one is tested on its
 * own (security.test.ts). The server is trusted to write screens; these are
 * the lines a screen, a link from anywhere on the internet, or a value typed
 * into the developer's connection screen still cannot cross.
 */

/** tailzu.space itself, or any subdomain of it. */
export function isTailzuHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "tailzu.space" || h.endsWith(".tailzu.space");
}

function parse(url: unknown): URL | null {
  if (typeof url !== "string" || !url || /[\s\\]/.test(url)) return null;
  try { return new URL(url); } catch { return null; }
}

/**
 * The backend base URL, normalised, or null when this build must not use it.
 *
 * It receives the user's token on every request and is handed to the keyboard,
 * so a release build talks only to https on tailzu.space. A development build
 * may point anywhere (a PC on the LAN, the Android emulator's 10.0.2.2).
 * Never credentials, a query or a fragment: the paths are appended to it.
 */
export function checkBaseUrl(raw: unknown, dev: boolean): string | null {
  const u = parse(typeof raw === "string" ? raw.trim() : raw);
  if (!u || u.username || u.password || u.search || u.hash) return null;
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) return null;
  if (!dev && !isTailzuHost(u.hostname)) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

/**
 * A path the generic callEndpoint action may send the token to: under /v1/,
 * on the configured backend, and nowhere else — no scheme, no `//host`, no
 * credentials, no backslash (a URL parser reads it as a slash), no control
 * characters, and no `.` or `..` segment, spelled out or percent-encoded, that
 * would walk the request out of /v1/.
 */
export function isBackendPath(path: unknown): boolean {
  if (typeof path !== "string" || !path.startsWith("/v1/")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\@\s\u0000-\u001f\u007f]|\/\//.test(path)) return false;
  const pathname = path.split(/[?#]/)[0];
  for (const seg of pathname.split("/")) {
    let s: string;
    try { s = decodeURIComponent(seg); } catch { return false; }
    if (s === "." || s === ".." || s.includes("\\")) return false;
  }
  return true;
}

/** http(s) only — the in-app browser, a download, a picture. */
export function isWebUrl(url: unknown): url is string {
  const u = parse(url);
  return !!u && (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
}

/**
 * What `openUrl` may hand to the operating system: a web page, a mail, a
 * call, a text, the app's own settings page or this app's own scheme. Not
 * `javascript:`, `file:`, `content:`, `data:`, Android `intent:` (which can
 * start any activity) or another app's private scheme.
 */
const OPENABLE = new Set(["https:", "http:", "mailto:", "tel:", "sms:", "app-settings:", "tulmi:"]);
export function isOpenableUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(url.trim())?.[1]?.toLowerCase();
  if (!scheme || !OPENABLE.has(scheme)) return false;
  return scheme === "https:" || scheme === "http:" ? isWebUrl(url.trim()) : true;
}

/** A page the WebView node may show: https on tailzu.space. */
export function isTailzuPage(url: unknown): url is string {
  const u = parse(url);
  return !!u && u.protocol === "https:" && isTailzuHost(u.hostname);
}

/** A screen id as the server writes them — never a path, a URL or markup. */
export function isScreenId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(id);
}

/** A file name inside the app's cache directory, never a path out of it. */
export function safeFileName(name: unknown, fallback: string): string {
  const base = String(name ?? "").split(/[/\\]/).pop() ?? "";
  const clean = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return clean || fallback;
}
