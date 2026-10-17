/**
 * A SIGN-IN LINK IS ONLY GOOD ON THE PHONE THAT ASKED FOR IT.
 *
 * Any web page, mail or message can open tulmi://, and a link carrying a
 * session, a PKCE code or a token hash minted for SOMEONE ELSE's account
 * would sign this phone into that account — the victim then dictates into an
 * account the attacker reads (login CSRF). "Only while nobody is signed in"
 * narrowed that; it did not close it, because signed out is exactly when
 * someone is signing in.
 *
 * So every flow that comes back through a link starts here: the app mints a
 * random `state`, keeps it on the phone for a short while, and sends it out
 * in the redirect (the backend's /auth/callback refuses a return without
 * one and hands it back untouched). A link is redeemed only if it carries
 * the state this phone is waiting for, unexpired, and only once. The Supabase
 * client runs the PKCE flow as well, so a code is also useless without the
 * verifier that never left this phone.
 *
 * Why links exist at all: Google on Android comes back from Supabase's page
 * through one, and a mail carries one whenever a Supabase template still
 * says {{ .ConfirmationURL }} instead of {{ .Token }} — a safety net for a
 * dashboard setting, not the design.
 *
 * Free of react-native so every rule is tested on its own (linkState.test.ts);
 * the phone's side — storage, randomness, Supabase — is ./linkSignIn.ts.
 */

/** What a sign-in link can carry. `state` is the phone's own, echoed back. */
export type AuthLink =
  /** PKCE: exchanged with the verifier stored on this phone. */
  | { kind: "code"; code: string; state?: string }
  /** Implicit flow: the session itself, in the fragment. */
  | { kind: "session"; accessToken: string; refreshToken: string; state?: string }
  /** A hashed one-time token from a mailed link, and its GoTrue type. */
  | { kind: "auth"; tokenHash: string; type: string; state?: string };

/** GoTrue's verification types. Anything else with a `token` is not auth. */
const AUTH_TYPES = new Set(["signup", "magiclink", "recovery", "invite", "email", "email_change"]);

/**
 * How long a sign-in this phone started stays redeemable. Long enough to
 * finish Google or fetch a mail from another app; short enough that a state
 * lying around is not a standing invitation. Not a knob: nothing is gained
 * by letting a server widen it.
 */
export const STATE_TTL_MS = 15 * 60_000;

/** The shape this app mints (32 random bytes, base64url) and the backend checks. */
const STATE_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function isState(s: unknown): s is string {
  return typeof s === "string" && STATE_RE.test(s);
}

/** 32+ random bytes → base64url, without padding. */
export function mintState(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 24) throw new Error("mintState: need at least 24 random bytes");
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63];
  }
  return out;
}

/** The redirect with this phone's state on it, before any fragment. */
export function withState(url: string, state: string): string {
  const at = url.indexOf("#");
  const base = at < 0 ? url : url.slice(0, at);
  const frag = at < 0 ? "" : url.slice(at);
  return `${base}${base.includes("?") ? "&" : "?"}state=${encodeURIComponent(state)}${frag}`;
}

export interface PendingState { state: string; exp: number }

export function newPending(state: string, now: number): PendingState {
  return { state, exp: now + STATE_TTL_MS };
}

/** The stored record, or null for anything that is not one. */
export function parsePending(raw: string | null | undefined): PendingState | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingState>;
    return isState(p?.state) && typeof p.exp === "number" && Number.isFinite(p.exp) ? { state: p.state, exp: p.exp } : null;
  } catch {
    return null;
  }
}

/** Query or fragment of a URL as parameters. Tokens are base64url: no `+` to undo. */
function params(part: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of part.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    } catch { /* a malformed pair is not worth failing the whole link over */ }
  }
  return out;
}

function split(url: string): { q: Record<string, string>; frag: Record<string, string> } {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const qAt = beforeHash.indexOf("?");
  return {
    q: qAt < 0 ? {} : params(beforeHash.slice(qAt + 1)),
    // Supabase's implicit flow returns the session AFTER the `#`.
    frag: hashAt < 0 ? {} : params(url.slice(hashAt + 1)),
  };
}

/** The one place a PKCE code is expected: the callback page's hand-back. */
const CALLBACK = /^tulmi:\/\/auth\/callback(?:[/?#]|$)/i;

/**
 * The sign-in half of a link, or null when it is not a sign-in link.
 *
 * Matched on the PARAMETERS rather than the path for the two shapes a mailed
 * link can take, because that path is whatever the Site URL and a template
 * produce. Narrow on purpose: `token_hash` is a Supabase spelling; a bare
 * `token` counts only beside a GoTrue type; and a bare `code` counts only on
 * tulmi://auth/callback — a screen link, or another OAuth client's redirect
 * (Google's own, with its own code and state), is not ours to redeem.
 */
export function readAuthLink(url: string): AuthLink | null {
  if (typeof url !== "string" || !url) return null;
  const { q, frag } = split(url);
  const s = q.state ?? frag.state;
  const state = s ? { state: s } : {};

  const authType = q.type ?? frag.type;
  const hash = q.token_hash ?? frag.token_hash
    ?? (authType && AUTH_TYPES.has(authType) ? (q.token ?? frag.token) : undefined);
  if (hash) return { kind: "auth", tokenHash: hash, type: authType && AUTH_TYPES.has(authType) ? authType : "email", ...state };

  const at = q.access_token ?? frag.access_token;
  const rt = q.refresh_token ?? frag.refresh_token;
  if (at && rt) return { kind: "session", accessToken: at, refreshToken: rt, ...state };

  const code = q.code ?? frag.code;
  if (code && CALLBACK.test(url) && !(q.error ?? frag.error)) return { kind: "code", code, ...state };
  return null;
}

export type Verdict = "ok" | "signed-in" | "no-state" | "no-pending" | "expired" | "mismatch";

/** Same length, same bytes — without stopping at the first difference. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * May this phone redeem this link now? Only "ok" redeems.
 *
 * Signed in: never — a signed-in user has nothing to finish, and a swap to
 * another account is the attack. No state, no pending sign-in, a stale one or
 * a different one: never — this phone did not start the flow that link ends.
 */
export function judgeLink(link: AuthLink, pending: PendingState | null, now: number, signedIn: boolean): Verdict {
  if (signedIn) return "signed-in";
  if (!isState(link.state)) return "no-state";
  if (!pending) return "no-pending";
  if (now > pending.exp) return "expired";
  return same(link.state, pending.state) ? "ok" : "mismatch";
}

export type RedeemResult = { ok: true } | { ok: false; verdict: Verdict | "failed"; message?: string };

/** What redeeming needs from the phone — injected, so the order is testable. */
export interface RedeemDeps {
  signedIn(): Promise<boolean>;
  readPending(): Promise<string | null>;
  clearPending(): Promise<void>;
  /** Spend the link: exchange the code, adopt the session, verify the hash. */
  spend(link: AuthLink): Promise<{ error: { message: string } | null }>;
  now(): number;
}

/**
 * The one door every sign-in link goes through.
 *
 * ONE REDEMPTION PER STATE. On Android the browser session's own result and
 * the global link listener receive the SAME url; a PKCE code can be spent
 * once, so the second caller is handed the first one's answer instead of a
 * failure. And the pending state is cleared BEFORE the link is spent, so the
 * same link replayed — or another carrying the same state — finds nothing
 * waiting.
 */
export function makeRedeemer(deps: RedeemDeps): (link: AuthLink) => Promise<RedeemResult> {
  const redeeming = new Map<string, Promise<RedeemResult>>();
  const redeem = async (link: AuthLink): Promise<RedeemResult> => {
    const verdict = judgeLink(link, parsePending(await deps.readPending().catch(() => null)), deps.now(), await deps.signedIn());
    if (verdict !== "ok") return { ok: false, verdict };
    await deps.clearPending().catch(() => {});
    try {
      const { error } = await deps.spend(link);
      return error ? { ok: false, verdict: "failed", message: error.message } : { ok: true };
    } catch (e) {
      return { ok: false, verdict: "failed", message: String((e as { message?: unknown })?.message ?? e) };
    }
  };
  return (link) => {
    const key = link.state ?? "";
    const running = key ? redeeming.get(key) : undefined;
    if (running) return running;
    const p = redeem(link);
    if (key) redeeming.set(key, p);
    return p;
  };
}
