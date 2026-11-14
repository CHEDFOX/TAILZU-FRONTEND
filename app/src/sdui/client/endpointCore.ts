/**
 * THE RULES BEHIND callEndpoint's NEW OPTIONS (pure SPEC 2.10). Free of react-native and of the network, so each rule is tested
 * on its own (endpointCore.test.ts). endpoint.ts wires them to fetch and XMLHttpRequest.
 *
 *   retry      `{ times, backoff }`: how many more tries after the first, and the wait between them ("exp" 0.5 s doubling to 8 s,
 *              "fixed" 1 s, or a number of ms). Only failures that may pass are retried (no network, 408, 429, 5xx); a 4xx the
 *              server explained never is. A POST is not repeated after an answer that may have been acted on (500, 502, 504)
 *              unless the screen says `idempotent: true`.
 *   cache      `{ key, ttlMs }` on a GET: the answer is kept in memory for ttlMs (at most 10 minutes), by key and path. Any write
 *              that succeeds empties it, and so does sign-out.
 *   progress   `progressInto`: a state path that gets `{ loaded, total, pct }`, at most every 100 ms, always the last one.
 *   multipart  files from this phone (file:, content:, ph: and asset-library addresses only, never a web address) plus text fields.
 */
import { isBackendPath } from "../../security.ts";

/** Numbers here are the limits of pure SPEC 5.1 and 2.10, written out so this file needs nothing from the kernel. */
export const ENDPOINT_LIMITS = Object.freeze({
  retryMax: 5,
  backoffMaxMs: 8000,
  cacheTtlMaxMs: 10 * 60 * 1000,
  cacheEntries: 50,
  cacheKeyChars: 64,
  files: 8,
  fieldChars: 64,
  fieldValueChars: 8 * 1024,
  progressMs: 100,
  pathSegments: 12,
  pathChars: 128,
});

export interface RetrySpec { times?: number; backoff?: "exp" | "fixed" | number; idempotent?: boolean }
export interface CacheSpec { key: string; ttlMs: number }
export interface MultipartFile { field: string; uri: string; name?: string; type?: string }
export interface MultipartSpec { files: MultipartFile[]; fields?: Record<string, string | number | boolean> }
export interface Progress { loaded: number; total: number; pct: number }

/** The new options. Passing none keeps today's behaviour exactly. */
export interface CallOptions {
  retry?: RetrySpec;
  cache?: CacheSpec;
  multipart?: MultipartSpec;
  /** Called with upload progress (multipart only). */
  onProgress?: (p: Progress) => void;
}

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
/** The kernel's rule for one state path segment. */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** A state path a screen may write into (SPEC 5.1): ≤ 12 segments, ≤ 128 characters, letters, digits, _ and - only, no prototype keys. */
export function safeStatePath(p: unknown): p is string {
  if (typeof p !== "string" || !p || p.length > ENDPOINT_LIMITS.pathChars) return false;
  const segs = p.split(".");
  if (segs.length > ENDPOINT_LIMITS.pathSegments) return false;
  return segs.every((s) => SEGMENT.test(s) && !UNSAFE.has(s));
}

/** The one path rule for every network helper of the data block: relative, under /v1/, our origin only. */
export function pinned(path: unknown): path is string {
  return isBackendPath(path);
}

const clampInt = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d;
};

/** A retry spec with every value clamped. times 0 means no retry. */
export function normalizeRetry(r: RetrySpec | undefined | null): Required<Pick<RetrySpec, "times" | "idempotent">> & { backoff: "exp" | "fixed" | number } {
  if (!r || typeof r !== "object") return { times: 0, backoff: "exp", idempotent: false };
  const b = r.backoff;
  return {
    times: clampInt(r.times, 0, ENDPOINT_LIMITS.retryMax, 0),
    backoff: b === "fixed" ? "fixed" : typeof b === "number" && Number.isFinite(b) ? clampInt(b, 0, ENDPOINT_LIMITS.backoffMaxMs, 500) : "exp",
    idempotent: r.idempotent === true,
  };
}

/** The wait before retry number `attempt` (0 = the first retry). */
export function retryDelayMs(attempt: number, backoff: "exp" | "fixed" | number, random: () => number = Math.random): number {
  const a = Math.max(0, Math.min(attempt, 20));
  if (typeof backoff === "number") return backoff;
  if (backoff === "fixed") return 1000;
  const cap = Math.min(ENDPOINT_LIMITS.backoffMaxMs, 500 * 2 ** a);
  // Between 75% and all of it, so a crowd of phones does not retry in step.
  return Math.round(cap * (0.75 + 0.25 * Math.min(1, Math.max(0, random()))));
}

/** Whether a failure may pass on its own. `status` is absent when no answer came (no network). */
export function retryable(method: string, status: number | undefined, idempotent = false): boolean {
  // No answer: the write may or may not have arrived, so a POST or PATCH waits for the screen's say-so.
  if (status == null) return idempotent || !/^(POST|PATCH)$/i.test(method);
  if (status === 408 || status === 429 || status === 503) return true;
  if (status >= 500) return idempotent || /^(GET|HEAD|PUT|DELETE)$/i.test(method);
  return false;
}

export interface RetryIO { sleep: (ms: number) => Promise<void>; random?: () => number }

/** Mark a failure as "no answer came" (the only kind of status-less failure that may be retried). */
export function asNetworkError<E extends Error>(e: E): E { return Object.assign(e, { network: true }); }

/** Run `attempt` until it works or the tries are used up. A QuotaExceededError (named QuotaExceededError) is never retried. */
export async function withRetry<T>(
  method: string,
  spec: RetrySpec | undefined,
  attempt: () => Promise<T>,
  io: RetryIO,
): Promise<T> {
  const r = normalizeRetry(spec);
  for (let i = 0; ; i++) {
    try { return await attempt(); } catch (e) {
      const err = e as { status?: unknown; name?: unknown; network?: unknown };
      const status = typeof err?.status === "number" ? err.status : undefined;
      // A failure with no status that is not a tagged network failure (bad JSON in a 2xx, a bug) is never repeated.
      if (status == null && err?.network !== true) throw e;
      if (i >= r.times || err?.name === "QuotaExceededError" || !retryable(method, status, r.idempotent)) throw e;
      await io.sleep(retryDelayMs(i, r.backoff, io.random));
    }
  }
}

/** A deep copy of a JSON answer (text answers and anything not JSON come back as they are). */
function copyOf(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

/** In-memory answers kept by key. */
export class ResponseCache {
  private readonly m = new Map<string, { at: number; ttl: number; value: unknown }>();
  private readonly max: number;
  constructor(max = ENDPOINT_LIMITS.cacheEntries) { this.max = max; }

  /** Stored key: the screen's key and the path together, so one key cannot serve another address. */
  static keyOf(spec: CacheSpec, path: string): string { return `${spec.key.slice(0, ENDPOINT_LIMITS.cacheKeyChars)}\u0000${path}`; }

  get(k: string, now: number): { hit: true; value: unknown } | { hit: false } {
    const e = this.m.get(k);
    if (!e) return { hit: false };
    if (now - e.at >= e.ttl) { this.m.delete(k); return { hit: false }; }
    // A fresh copy each time: a screen's local edits must never reach the kept answer.
    return { hit: true, value: copyOf(e.value) };
  }

  set(k: string, value: unknown, ttlMs: number, now: number): void {
    const ttl = clampInt(ttlMs, 0, ENDPOINT_LIMITS.cacheTtlMaxMs, 0);
    if (ttl <= 0) return;
    this.m.delete(k);
    this.m.set(k, { at: now, ttl, value: copyOf(value) });
    // Oldest out first (a Map keeps insertion order).
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }

  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}

/** A valid cache spec, or null (no key, no time, or a key that is not text). */
export function normalizeCache(c: CacheSpec | undefined | null): CacheSpec | null {
  if (!c || typeof c !== "object" || typeof c.key !== "string" || !c.key) return null;
  const ttlMs = clampInt(c.ttlMs, 0, ENDPOINT_LIMITS.cacheTtlMaxMs, 0);
  return ttlMs > 0 ? { key: c.key, ttlMs } : null;
}

const LOCAL_URI = /^(file|content|ph|assets-library):/i;
const FIELD = /^[A-Za-z0-9_.\-\[\]]{1,64}$/;

/** A multipart spec with anything unsafe taken out, or null when no file is left. */
export function normalizeMultipart(m: MultipartSpec | undefined | null): MultipartSpec | null {
  if (!m || typeof m !== "object" || !Array.isArray(m.files)) return null;
  const files: MultipartFile[] = [];
  for (const f of m.files) {
    if (files.length >= ENDPOINT_LIMITS.files) break;
    if (!f || typeof f.uri !== "string" || !LOCAL_URI.test(f.uri) || typeof f.field !== "string" || !FIELD.test(f.field)) continue;
    files.push({
      field: f.field, uri: f.uri,
      name: typeof f.name === "string" && f.name ? f.name.slice(0, 120) : "file",
      type: typeof f.type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(f.type) ? f.type : "application/octet-stream",
    });
  }
  if (!files.length) return null;
  const fields: Record<string, string> = {};
  if (m.fields && typeof m.fields === "object") {
    for (const k of Object.keys(m.fields)) {
      const v = m.fields[k];
      if (!FIELD.test(k) || (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) continue;
      fields[k] = String(v).slice(0, ENDPOINT_LIMITS.fieldValueChars);
    }
  }
  return { files, fields };
}

/** loaded/total into `{ loaded, total, pct }`; an unknown total gives pct 0. */
export function toProgress(loaded: number, total: number): Progress {
  const l = Number.isFinite(loaded) && loaded > 0 ? loaded : 0;
  const t = Number.isFinite(total) && total > 0 ? total : 0;
  return { loaded: l, total: t, pct: t ? Math.min(100, Math.round((l / t) * 100)) : 0 };
}

/**
 * Where progress is written (`progressInto`): at most every 100 ms, but the last one always lands (`flush`).
 * An unsafe path writes nothing.
 */
export function progressSink(set: (path: string, value: unknown) => void, path: unknown, now: () => number = Date.now): { push(p: Progress): void; flush(): void } {
  if (!safeStatePath(path)) return { push() {}, flush() {} };
  let last = -Infinity;
  let held: Progress | null = null;
  return {
    push(p) {
      if (now() - last >= ENDPOINT_LIMITS.progressMs) { last = now(); held = null; set(path, p); } else held = p;
    },
    flush() { if (held) { const p = held; held = null; last = now(); set(path, p); } },
  };
}

/** `optimistic: { path, value }`: write now, and hand back the way to undo it if the call fails. */
export function applyOptimistic(
  store: { get(path: string): unknown; set(path: string, value: unknown): void },
  spec: { path?: unknown; value?: unknown } | undefined | null,
): () => void {
  if (!spec || !safeStatePath(spec.path)) return () => {};
  const path = spec.path;
  const before = store.get(path);
  store.set(path, spec.value);
  return () => store.set(path, before);
}
