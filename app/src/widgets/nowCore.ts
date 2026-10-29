/**
 * THE QUICK-ACCESS WIDGETS, THE RULES (now.ts wires them to the app). Free of react-native, so each is tested on its own
 * (nowCore.test.ts):
 *
 *   cleanNow          what GET /v1/widgets/now answered, checked before it reaches a widget: a document of the version the native
 *                     side reads, every link one this app opens (tulmi://, com.tulmi.app://, or the app's own https hosts), every
 *                     button's mode one the widgets know. Anything else is dropped, never drawn.
 *   fetchDue          whether to ask the server again now (the server's own interval, or forced by a push or an answer)
 *   tokenDue          whether the widgets' narrow token needs asking for again (missing, or past the share of its life the server
 *                     said: widgets.token.renewAt)
 *   installId         a phone's id for its token: made once, letters and digits only
 */

/** The document versions this build's widgets read. */
export const NOW_VERSIONS = [1];

/** Hosts whose https links the app claims (associatedDomains / intentFilters in app.config.ts). */
const APP_HOSTS = new Set(["x0bot.com", "app.x0bot.com", "tailzu.space", "app.tailzu.space"]);

/** A link a widget may open: this app's own, never a web page or another app. */
export function isAppLink(url: unknown): url is string {
  if (typeof url !== "string" || !url || url.length > 600) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f\\]/.test(url)) return false;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  if (!m) return false;
  const scheme = m[1]!.toLowerCase();
  if (scheme === "tulmi" || scheme === "com.tulmi.app") return true;
  return scheme === "https" && APP_HOSTS.has(m[2]!.toLowerCase());
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function cleanAction(a: unknown): Obj | null {
  if (!isObj(a) || typeof a.id !== "string" || !/^[a-z0-9_]{1,24}$/.test(a.id) || typeof a.label !== "string") return null;
  const mode = a.mode === "open" ? "open" : a.mode === "inPlace" ? "inPlace" : null;
  if (!mode) return null;
  if (mode === "open" && !isAppLink(a.url)) return null;
  const out: Obj = { ...a, label: a.label.slice(0, 40) };
  if (out.url !== undefined && !isAppLink(out.url)) delete out.url;
  return out;
}

function cleanRow(r: unknown): Obj | null {
  if (!isObj(r) || typeof r.id !== "string" || typeof r.kind !== "string") return null;
  const out: Obj = { ...r, url: isAppLink(r.url) ? r.url : "" };
  if (Array.isArray(r.actions)) out.actions = r.actions.map(cleanAction).filter((x): x is Obj => !!x).slice(0, 4);
  return out;
}

function cleanSection(s: unknown): Obj {
  if (!isObj(s)) return { on: false, rows: [] };
  const empty = isObj(s.empty) ? { ...s.empty, url: isAppLink(s.empty.url) ? s.empty.url : "" } : undefined;
  return {
    ...s,
    url: isAppLink(s.url) ? s.url : "",
    rows: Array.isArray(s.rows) ? s.rows.map(cleanRow).filter((x): x is Obj => !!x).slice(0, 20) : [],
    ...(empty ? { empty } : {}),
  };
}

/** The document a widget may be given, or null when it is not one this build reads. */
export function cleanNow(doc: unknown): Obj | null {
  if (!isObj(doc) || typeof doc.v !== "number" || !NOW_VERSIONS.includes(doc.v)) return null;
  return { ...doc, people: cleanSection(doc.people), needs: cleanSection(doc.needs) };
}

/** Whether to fetch again: never more often than the server's interval, unless forced (a push came, an answer was given). */
export function fetchDue(lastAt: number, now: number, fetchSec: number, force = false): boolean {
  if (force || !lastAt) return true;
  const gap = Number.isFinite(fetchSec) && fetchSec >= 0 ? fetchSec * 1000 : 60_000;
  return now - lastAt >= gap;
}

export interface TokenMeta { issuedAt: number; expiresAt: number; renewAt?: number }

/** Whether to ask for a new widget token: none yet, run out, or past the share of its life the server set (half by default). */
export function tokenDue(meta: TokenMeta | null, now: number): boolean {
  if (!meta || !Number.isFinite(meta.expiresAt) || !Number.isFinite(meta.issuedAt) || meta.expiresAt <= now) return true;
  const share = typeof meta.renewAt === "number" && meta.renewAt > 0 && meta.renewAt <= 1 ? meta.renewAt : 0.5;
  return now >= meta.issuedAt + (meta.expiresAt - meta.issuedAt) * share;
}

/** A phone's install id (8 to 64 letters, digits, - and _), made from `random` (0–1). */
export function installId(random: () => number = Math.random): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "x0";
  for (let i = 0; i < 30; i++) s += chars[Math.floor(random() * chars.length) % chars.length];
  return s;
}

/** An answer's key: unique per tap, kept for its retries. */
export function actKey(random: () => number = Math.random, now = Date.now()): string {
  return `k${now.toString(36)}${installId(random).slice(2, 14)}`;
}
