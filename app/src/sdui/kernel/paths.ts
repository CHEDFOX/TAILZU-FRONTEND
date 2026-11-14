/**
 * PATHS THE SERVER MAY NAME, checked here so the device and the server agree (pure SPEC 5.1, 2.2, 2.9).
 *
 * Three kinds of path arrive from the server and none of them is trusted:
 *
 *   • a state path (`setState.path`, a gesture's `into`, `subscribe.into`, `progressInto`) — plain segments only,
 *     never `__proto__`, `constructor` or `prototype`, which is the rule `state.ts:setPath` already enforces;
 *   • a `local` key — the same shape, in its own namespace, and never something that looks like a secret;
 *   • a network path (`callEndpoint.path`, `page.endpoint`, `subscribe.topic`) — relative, under `/v1/`, on our own
 *     API origin, with every filled value encoded.
 *
 * Every check returns a short reason instead of throwing, because the caller (renderer or lint) wants to report it.
 */

import { LIMITS, byteLen } from "./limits.ts";

/** Keys that would reach every object in the app if a path were walked blindly. */
const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);

/** A segment of a path: letters, digits, `_` and `-`. An array index is just digits. */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Empty when the state path is fine; otherwise the reason it is refused. */
export function statePathError(path: unknown): string {
  if (typeof path !== "string" || path.length === 0) return "a path must be a non-empty string";
  if (path.length > LIMITS.pathChars) return `a path is at most ${LIMITS.pathChars} characters`;
  const parts = path.split(".");
  if (parts.length > LIMITS.pathSegments) return `a path is at most ${LIMITS.pathSegments} segments`;
  for (const p of parts) {
    if (p.length === 0) return "a path has an empty segment";
    if (DANGEROUS.has(p)) return `"${p}" is not a name a path may use`;
    if (!SEGMENT.test(p)) return `"${p}" is not a plain name (letters, digits, _ and - only)`;
  }
  return "";
}

/** True when a state path is one the device will write. */
export function statePathOk(path: unknown): boolean {
  return statePathError(path) === "";
}

/** The words that make a name look like a secret. `local` is a drawer for hints and drafts, not for these. */
const SECRET_WORDS = new Set([
  "token", "secret", "password", "passwd", "pwd", "auth", "jwt", "bearer", "credential", "credentials", "cred",
  "apikey", "accesskey", "privatekey", "session", "cookie", "otp", "pin", "passcode", "signature", "refresh",
]);

/** The words in a name: `lastOtpSentAt` is last, otp, sent, at; `api_key` is api, key. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** True when a name reads like a secret (`authToken`, `api_key`, `session`). Two words joined count too. */
export function looksLikeSecret(name: string): boolean {
  const w = words(name);
  for (let i = 0; i < w.length; i += 1) {
    if (SECRET_WORDS.has(w[i]!)) return true;
    if (i + 1 < w.length && SECRET_WORDS.has(w[i]! + w[i + 1]!)) return true;
  }
  return false;
}

/** Empty when the `local` key is fine; otherwise why it is refused. */
export function localKeyError(key: unknown): string {
  const shape = statePathError(key);
  if (shape) return shape;
  const k = key as string;
  if (looksLikeSecret(k)) return `"${k}" reads like a secret; local is for hints, drafts and last choices`;
  return "";
}

/** True when a `local` key may be written on this phone. */
export function localKeyOk(key: unknown): boolean {
  return localKeyError(key) === "";
}

/** A scheme at the front: `http:`, `tulmi:`, `javascript:`. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * A dot, a slash or a backslash, however it is spelled. `%2e`, `%2f` and `%5c` are not decoration: the URL rules
 * every client here follows (WHATWG in the window, OkHttp on Android, Foundation on iOS) resolve `.%2e`, `%2e.`
 * and `%2e%2e` as `..`, so `/v1/.%2e/admin` leaves `/v1/` and lands on `/admin`. The climbing checks run on the
 * decoded text, never on the text as written.
 */
function decodeDots(s: string): string {
  if (!s.includes("%")) return s;
  return s.replace(/%2e/gi, ".").replace(/%2f/gi, "/").replace(/%5c/gi, "\\");
}

/**
 * Empty when the network path is fine; otherwise why it is refused. The path is already filled (holes encoded):
 * this is the last gate before it is joined to our API origin.
 *
 * The climbing checks (`..`, `//`, a backslash) are measured on the PATH, the part before `?` or `#`. Only that
 * part decides which endpoint is reached, and a search box holds ordinary words: `?q=wait...` or a pasted URL
 * must not cost the person their request (SPEC 2.2, and `encodeHole` keeps a filled value out of the path part
 * by encoding its dots as well as its slashes).
 */
export function networkPathError(path: unknown): string {
  if (typeof path !== "string" || path.length === 0) return "a path must be a non-empty string";
  if (byteLen(path) > 2048) return "a path is at most 2048 bytes";
  if (SCHEME.test(path)) return "a path is relative to our API, so it carries no scheme";
  if (path.startsWith("//")) return "a path is relative to our API, so it names no host";
  if (!path.startsWith("/v1/")) return "a path starts with /v1/";
  if (path.includes("\\")) return "a path never contains a backslash";
  const cut = path.search(/[?#]/);
  const head = decodeDots(cut === -1 ? path : path.slice(0, cut));
  if (head.includes("//")) return 'a path never contains "//"';
  if (head.includes("..")) return 'a path never contains ".."';
  if (head.includes("\\")) return "a path never contains a backslash";
  for (let i = 0; i < path.length; i += 1) {
    const c = path.charCodeAt(i);
    if (c < 0x21 || c === 0x7f) return "a path never contains a space or a control character";
  }
  return "";
}

/** True when a filled network path may be called. */
export function networkPathOk(path: unknown): boolean {
  return networkPathError(path) === "";
}

/**
 * One filled value inside a path, encoded. `actions.ts` already does this for `$state.` tokens; every hole in a
 * `$t` path goes through the same door, so a note id of `../admin` cannot climb out of its place.
 *
 * `encodeURIComponent` leaves a dot alone, so the dot is encoded here too (`%2E`). A filled value then cannot
 * spell a dot segment at all, and words with dots in them — "wait..." typed into a search box — ride through a
 * query without the whole call being refused.
 */
export function encodeHole(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? encodeURIComponent(String(value)) : "0";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return encodeURIComponent(value).replace(/\./g, "%2E");
  return "";
}

/**
 * True when `changed` and `dep` touch each other: the same path, one inside the other, or a dependency that ended
 * in `.*` because the screen indexed it with an expression. Used for re-rendering only what changed.
 */
export function pathsTouch(dep: string, changed: string): boolean {
  if (dep.endsWith(".*")) {
    const base = dep.slice(0, -2);
    return changed === base || changed.startsWith(base + ".") || base.startsWith(changed + ".");
  }
  return dep === changed || dep.startsWith(changed + ".") || changed.startsWith(dep + ".");
}
