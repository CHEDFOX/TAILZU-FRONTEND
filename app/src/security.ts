/**
 * WHERE THE APP WILL GO, AND WHAT IT WILL CARRY THERE.
 *
 * Every check that stands between a string and a request, a browser or the
 * user's token lives here, free of react-native so each one is tested on its
 * own (security.test.ts). The server is trusted to write screens; these are
 * the lines a screen, a link from anywhere on the internet, or a value typed
 * into the developer's connection screen still cannot cross.
 */

/** Our domains, each itself or any subdomain of it: x0bot.com, and tailzu.space from before the move. */
const OUR_DOMAINS = ["x0bot.com", "tailzu.space"];

/** x0bot.com or tailzu.space itself, or any subdomain of either. */
export function isTailzuHost(host: string): boolean {
  const h = host.toLowerCase();
  return OUR_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

function parse(url: unknown): URL | null {
  if (typeof url !== "string" || !url || /[\s\\]/.test(url)) return null;
  try { return new URL(url); } catch { return null; }
}

/**
 * The backend base URL, normalised, or null when this build must not use it.
 *
 * It receives the user's token on every request and is handed to the keyboard,
 * so a release build talks only to https on our domains. A development build
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
 * call, a text, a UPI payment, the app's own settings page or this app's own
 * scheme. Not `javascript:`, `file:`, `content:`, `data:`, Android `intent:`
 * (which can start any activity) or another app's private scheme.
 */
const OPENABLE = new Set(["https:", "http:", "mailto:", "tel:", "sms:", "upi:", "app-settings:", "tulmi:"]);
/**
 * A UPI payment and nothing else: upi://pay?pa=… (NPCI's linking spec), the
 * link the assistant's hand-off writes. The UPI app opens with the payee and
 * the amount filled in, and the PIN is typed there, by the person. Not a
 * mandate, a collect request or any other link a UPI app answers to, and
 * nothing a space, a backslash or a control character could split.
 */
const UPI_PAY = /^upi:\/\/pay\?pa=[^&#]+(?:&[^#]*)?$/i;
export function isOpenableUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(url.trim())?.[1]?.toLowerCase();
  if (!scheme || !OPENABLE.has(scheme)) return false;
  // eslint-disable-next-line no-control-regex
  if (scheme === "upi:") return UPI_PAY.test(url) && !/[\s\\\u0000-\u001f\u007f]/.test(url);
  return scheme === "https:" || scheme === "http:" ? isWebUrl(url.trim()) : true;
}

/** The longest hand-off the assistant writes (the backend's LINK_MAX), as the desktop opens. */
const HANDOFF_MAX = 8000;
/** A Telegram username as a t.me path: a letter, then letters, digits or _, 4 to 32 in all. */
const TG_CHAT = /^\/([A-Za-z][A-Za-z0-9_]{3,31})$/;
/** t.me's own pages, which are no one's username: they join, log in, pay or set a proxy. */
const TG_PAGES = new Set([
  "share", "proxy", "socks", "joinchat", "login", "confirmphone", "setlanguage", "addstickers", "addemoji",
  "addtheme", "addlist", "invoice", "giftcode", "boost", "contact", "premium", "stars", "nft",
]);
/**
 * The https hand-offs: the exact origin and path the backend writes, the
 * query keys each may carry, and a key that must have one value. Paths are
 * read as written, never normalised, and Spotify's one free segment is never
 * "." or "..", which the OS would walk out of /search/ on.
 */
const HANDOFF_WEB: ReadonlyArray<{ at: string; path: RegExp; keys: readonly string[]; fixed?: readonly [string, string] }> = [
  { at: "https://wa.me", path: /^\/(?:\d{6,15})?$/, keys: ["text"] },
  { at: "https://api.whatsapp.com", path: /^\/send$/, keys: ["phone", "text"] },
  { at: "https://t.me", path: /^\/share\/url$/, keys: ["url", "text"] },
  { at: "https://t.me", path: TG_CHAT, keys: ["text"] },
  { at: "https://www.google.com", path: /^\/maps\/dir\/$/, keys: ["api", "destination", "travelmode"], fixed: ["api", "1"] },
  { at: "https://www.google.com", path: /^\/maps\/search\/$/, keys: ["api", "query"], fixed: ["api", "1"] },
  { at: "https://m.uber.com", path: /^\/ul\/$/, keys: ["action", "pickup", "dropoff[formatted_address]"] },
  { at: "https://www.amazon.in", path: /^\/s$/, keys: ["k"] },
  { at: "https://www.flipkart.com", path: /^\/search$/, keys: ["q"] },
  { at: "https://www.youtube.com", path: /^\/results$/, keys: ["search_query"] },
  { at: "https://music.youtube.com", path: /^\/search$/, keys: ["q"] },
  { at: "https://open.spotify.com", path: /^\/search\/(?!(?:\.|%2[eE]){1,2}$)[^/]+$/, keys: [] },
  { at: "https://www.threads.com", path: /^\/intent\/post$/, keys: ["text", "url"] },
  { at: "https://www.threads.net", path: /^\/intent\/post$/, keys: ["text", "url"] },
  { at: "https://www.booking.com", path: /^\/searchresults\.html$/, keys: ["ss", "checkin", "checkout", "group_adults", "no_rooms"] },
  { at: "https://mail.google.com", path: /^\/mail\/$/, keys: ["view", "fs", "to", "cc", "bcc", "su", "body"], fixed: ["view", "cm"] },
];
const MAILTO_KEYS = ["to", "cc", "bcc", "subject", "body"];

/** A query's pairs with their keys decoded, or null when one is not a key on `keys` or comes twice. */
function queryPairs(query: string | undefined, keys: readonly string[]): Map<string, string> | null {
  const out = new Map<string, string>();
  if (!query) return out;
  for (const part of query.split("&")) {
    const at = part.indexOf("=");
    let k: string;
    try { k = decodeURIComponent(at < 0 ? part : part.slice(0, at)).toLowerCase(); } catch { return null; }
    if (!keys.includes(k) || out.has(k)) return null;
    out.set(k, at < 0 ? "" : part.slice(at + 1));
  }
  return out;
}

/**
 * What an answer of the assistant may open (openUrl with `handoff`): only a
 * link on its hand-off list, in the form the backend writes it
 * (tulmi/src/connectors/handoffs/links.ts), whatever the answer says. A
 * WhatsApp, Telegram or Threads draft, a Maps route or search, an Uber ride,
 * a shop's, YouTube's or Spotify's search, Booking.com's results, a Gmail or
 * mailto: draft, and the phone's own: a call (tel:+digits), a text
 * (sms:digits?body=) and a UPI payment (upi://pay?pa=&pn=&am=&cu=INR&tn=).
 * Never another site, another parameter, or anything unencoded.
 */
export function isHandoffUrl(url: unknown): url is string {
  // eslint-disable-next-line no-control-regex
  if (typeof url !== "string" || !url || url.length > HANDOFF_MAX || /[\s\\\u0000-\u001f\u007f-\u009f]/.test(url)) return false;
  if (/^tel:\+?\d{3,15}$/.test(url)) return true;
  if (/^sms:(?:\+?\d{3,15})?\?body=[^&#]*$/.test(url)) return true;
  if (/^upi:\/\/pay\?pa=[A-Za-z0-9._-]+@[A-Za-z0-9.-]+&pn=[^&#]*&am=\d{1,6}\.\d{2}&cu=INR(?:&tn=[^&#]*)?$/.test(url)) return true;
  const mail = /^mailto:([^?#]+)(?:\?([^#]*))?$/.exec(url);
  if (mail) return queryPairs(mail[2], MAILTO_KEYS) !== null;
  const web = /^(https:\/\/[a-z0-9.-]+)(\/[^?#]*)(?:\?([^#]*))?$/.exec(url);
  if (!web) return false;
  const [, origin, path, query] = web;
  return HANDOFF_WEB.some((h) => {
    if (h.at !== origin || !h.path.test(path!)) return false;
    if (h.path === TG_CHAT && TG_PAGES.has(TG_CHAT.exec(path!)![1]!.toLowerCase())) return false;
    const pairs = queryPairs(query, h.keys);
    return !!pairs && (!h.fixed || pairs.get(h.fixed[0]) === h.fixed[1]);
  });
}

/** A page the WebView node may show: https on our domains. */
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
