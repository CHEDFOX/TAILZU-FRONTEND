/**
 * PHONE-LOCAL VALUES, pure (spec 2.9 and 5.1, B9). A small key/value store kept on the phone, one namespace per account,
 * over a plain `KV` (MMKV on the phone, localStorage on the desktop, a Map in tests). No React Native import.
 *
 * Limits: 256 KB in all (keys and values, every namespace), 8 KB per value, 256 keys, paths <= 12 segments and
 * <= 128 characters with no __proto__, constructor or prototype, and no name that looks like a secret. A write that breaks a
 * limit is REFUSED with a reason (the old value stays); a read of anything bad is undefined. Nothing here ever throws.
 */

export const LOCAL_LIMITS = { totalBytes: 256 * 1024, valueBytes: 8 * 1024, keys: 256, segments: 12, pathChars: 128 } as const;

const SECRET_WORDS_LIST = [
  "token", "secret", "password", "passwd", "pwd", "auth", "jwt", "bearer", "credential", "credentials", "cred",
  "apikey", "accesskey", "privatekey", "session", "cookie", "otp", "pin", "passcode", "signature", "refresh",
] as const;

export const LOCAL_SPEC = {
  block: "local",
  names: "local.<path> in expressions; actions local.set { path, value } and local.remove { path }",
  limits: LOCAL_LIMITS,
  rules: "own namespace per account; cleared on sign-out; values are JSON data",
  secretWords: SECRET_WORDS_LIST,
} as const;

export interface KV {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
}

export type LocalResult = { ok: true } | { ok: false; reason: string };

const BAD_SEGMENT = new Set(["__proto__", "constructor", "prototype"]);
// Same rule as the kernel's looksLikeSecret (kernel/paths.ts): whole words, not substrings. Keep the two in step.
const SECRET_WORDS = new Set<string>(SECRET_WORDS_LIST);

/** The words in a name: `lastOtpSentAt` is last, otp, sent, at; `api_key` is api, key. */
function words(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
}

export function looksLikeSecret(name: string): boolean {
  const w = words(name);
  for (let i = 0; i < w.length; i += 1) {
    if (SECRET_WORDS.has(w[i]!)) return true;
    if (i + 1 < w.length && SECRET_WORDS.has(w[i]! + w[i + 1]!)) return true;
  }
  return false;
}

/** Why this path is not allowed, or null when it is. */
export function checkLocalPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length === 0) return "empty path";
  if (path.length > LOCAL_LIMITS.pathChars) return "path too long";
  const segs = path.split(".");
  if (segs.length > LOCAL_LIMITS.segments) return "too many segments";
  for (const s of segs) {
    if (s === "") return "empty segment";
    if (BAD_SEGMENT.has(s)) return "forbidden name";
    if (!/^[A-Za-z0-9_-]+$/.test(s)) return "bad character";
  }
  if (looksLikeSecret(path)) return "looks like a secret";
  return null;
}

const bytes = (s: string) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c & 0xfc00) === 0xd800 ? (i++, 4) : 3; }
  return n;
};

export class LocalStore {
  private ns = "anon";
  private subs = new Set<(path: string) => void>();
  private kv: KV;
  private total = 0;   // running byte count of every key and value, kept in step by set / remove / clearAll
  constructor(kv: KV) { this.kv = kv; this.recount(); }

  /** Recount from the KV: at start, and after the KV was filled behind our back (hydrate). */
  recount(): void { this.total = this.size(); }

  /** Tell subscribers everything may have changed, without touching the namespace. */
  notifyAll(): void { this.emit(""); }

  /** Switch to an account's namespace (the account id is sanitised; it never leaves the phone). */
  setAccount(id: string | null | undefined): void {
    const next = (id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "anon";
    if (next === this.ns) return;
    this.ns = next;
    this.emit("");
  }

  private prefix() { return this.ns + "\u0001"; }
  private mine(): string[] { const p = this.prefix(); return this.kv.keys().filter((k) => k.startsWith(p)); }

  get(path: string): unknown {
    if (checkLocalPath(path)) return undefined;
    try {
      const raw = this.kv.get(this.prefix() + path);
      return raw === undefined ? undefined : JSON.parse(raw);
    } catch { return undefined; }
  }

  /** Every value of this account, by path (for a screen that wants the lot). */
  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const p = this.prefix();
    for (const k of this.mine()) { const v = this.get(k.slice(p.length)); if (v !== undefined) out[k.slice(p.length)] = v; }
    return out;
  }

  /** Total bytes held, every namespace (keys and values). */
  size(): number {
    let n = 0;
    for (const k of this.kv.keys()) { const v = this.kv.get(k); n += bytes(k) + (v === undefined ? 0 : bytes(v)); }
    return n;
  }

  set(path: string, value: unknown): LocalResult {
    const bad = checkLocalPath(path);
    if (bad) return { ok: false, reason: bad };
    let raw: string | undefined;
    try { raw = JSON.stringify(value); } catch { return { ok: false, reason: "not data" }; }
    if (raw === undefined) return { ok: false, reason: "not data" };
    const rawBytes = bytes(raw);
    if (rawBytes > LOCAL_LIMITS.valueBytes) return { ok: false, reason: "value too large" };
    const key = this.prefix() + path;
    const old = this.kv.get(key);
    if (old === undefined && this.kv.keys().length >= LOCAL_LIMITS.keys) return { ok: false, reason: "too many keys" };
    const keyBytes = bytes(key);
    const delta = keyBytes + rawBytes - (old === undefined ? 0 : keyBytes + bytes(old));
    if (this.total + delta > LOCAL_LIMITS.totalBytes) return { ok: false, reason: "store full" };
    try { this.kv.set(key, raw); } catch { return { ok: false, reason: "write failed" }; }
    this.total += delta;
    this.emit(path);
    return { ok: true };
  }

  remove(path: string): LocalResult {
    const bad = checkLocalPath(path);
    if (bad) return { ok: false, reason: bad };
    const key = this.prefix() + path;
    try {
      const old = this.kv.get(key);
      this.kv.delete(key);
      if (old !== undefined) this.total = Math.max(0, this.total - bytes(key) - bytes(old));
    } catch { return { ok: false, reason: "write failed" }; }
    this.emit(path);
    return { ok: true };
  }

  /** Sign-out: every namespace, nothing left. */
  clearAll(): void {
    for (const k of this.kv.keys()) { try { this.kv.delete(k); } catch { /* ignore */ } }
    this.recount();
    this.emit("");
  }

  subscribe(cb: (path: string) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  private emit(path: string) { for (const cb of [...this.subs]) { try { cb(path); } catch { /* never escapes */ } } }
}

/** A Map as a KV (tests, and the AsyncStorage fallback's memory). */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k), keys: () => [...m.keys()] };
}
