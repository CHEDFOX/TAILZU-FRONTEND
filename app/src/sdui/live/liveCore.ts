/**
 * LIVE UPDATES, THE RULES (live.ts wires them to the app). The server says "this changed" over WS /v1/live (backend
 * routes/live.ts); a screen whose `liveTopics` hear that topic reloads itself quietly. Free of react-native: the socket, the
 * clock and the timers are handed in, so every rule is tested on its own (liveCore.test.ts). The window's live.js keeps the same
 * rules.
 *
 *   LiveClient       one socket while the app is in front: signs in with its first message (never a token in the URL), answers
 *                    pings, reconnects with backoff (1 s, 2 s, 4 s … at most 30 s, with jitter), drops a socket that has gone
 *                    quiet for two and a half heartbeats, and says `onResume` when it is back after a gap (what was said
 *                    meanwhile was missed, so the screen on show reloads once)
 *   hears            whether a screen's topics hear an event's topic ("job:*" hears every job)
 *   ReloadScheduler  a burst of events is one reload, DELAY_MS after the last (at most MAX_WAIT_MS after the first); never while
 *                    the person is typing (QUIET_MS since their last keystroke, at most MAX_DEFER_MS); one at a time, and an
 *                    event during a reload brings one more after it
 *   mergeLiveState   the new screen's state over the old, except what was changed on this screen since it loaded: a half-typed
 *                    field keeps its words
 */

export const DELAY_MS = 300;
export const MAX_WAIT_MS = 1000;
export const QUIET_MS = 1200;
export const MAX_DEFER_MS = 15_000;
export const CONNECT_TIMEOUT_MS = 15_000;
export const DEFAULT_HEARTBEAT_MS = 25_000;
/** Server close codes (backend routes/live.ts). */
export const CLOSE = { unauthorized: 4401, tooMany: 4008, renew: 4000 } as const;

export type LiveMessage =
  | { type: "ready"; heartbeatMs: number }
  | { type: "event"; topic: string; at?: number; data?: Record<string, unknown> }
  | { type: "ping"; at?: number }
  | { type: "error"; code: string };

/** A server message, or null for anything that is not one of ours. */
export function parseLiveMessage(raw: unknown): LiveMessage | null {
  if (typeof raw !== "string" || raw.length > 65_536) return null;
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  switch (m.type) {
    case "ready": return { type: "ready", heartbeatMs: Number(m.heartbeatMs) > 0 ? Number(m.heartbeatMs) : DEFAULT_HEARTBEAT_MS };
    case "event": return typeof m.topic === "string" && m.topic
      ? { type: "event", topic: m.topic, ...(typeof m.at === "number" ? { at: m.at } : {}), ...(m.data && typeof m.data === "object" ? { data: m.data } : {}) }
      : null;
    case "ping": return { type: "ping" };
    case "error": return { type: "error", code: String(m.code ?? "") };
    default: return null;
  }
}

/** The live socket's address on the same host as the API: https → wss, http → ws. */
export function wsUrlOf(base: string, path = "/v1/live"): string {
  const root = String(base || "").replace(/\/+$/, "").replace(/^http/i, "ws");
  return root + (path.startsWith("/") ? path : `/${path}`);
}

/** Whether a screen listening to `topics` hears `topic`. "job:*" hears every "job:<id>". */
export function hears(topics: readonly string[] | undefined | null, topic: string): boolean {
  if (!topics?.length || !topic) return false;
  for (const t of topics) {
    if (t === topic) return true;
    if (t.endsWith(":*") && topic.startsWith(t.slice(0, -1))) return true;
  }
  return false;
}

/** How long to wait before reconnect number `attempt` (0 first): 1 s doubling to 30 s, between half and all of it. */
export function backoffMs(attempt: number, random: () => number = Math.random, baseMs = 1000, maxMs = 30_000): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, Math.min(attempt, 20)));
  return Math.round(cap * (0.5 + 0.5 * Math.min(1, Math.max(0, random()))));
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/**
 * What to write into the screen's state for the new copy: [path, value] pairs. A value the screen changed since the server last
 * said it (a field typed in, a choice made) stays as it is; everything else takes the server's new word. Plain objects are
 * followed key by key; arrays and the rest are one value each. Keys the new copy does not name are left alone (the app's own,
 * such as the device's readings).
 */
export function mergeLiveState(
  prev: Record<string, unknown> | undefined | null,
  local: Record<string, unknown> | undefined | null,
  next: Record<string, unknown> | undefined | null,
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  const walk = (base: string, p: Record<string, unknown>, l: Record<string, unknown>, n: Record<string, unknown>) => {
    for (const k of Object.keys(n)) {
      if (UNSAFE.has(k) || k.includes(".")) continue;
      const path = base ? `${base}.${k}` : k;
      const nv = n[k], lv = l[k], pv = p[k];
      if (isPlain(nv) && isPlain(lv) && (pv === undefined || isPlain(pv))) { walk(path, (pv as Record<string, unknown>) ?? {}, lv, nv); continue; }
      if (!same(lv, pv)) continue;          // changed here since the server's last word: theirs
      if (!same(lv, nv)) out.push([path, nv]);
    }
  };
  walk("", prev ?? {}, local ?? {}, next ?? {});
  return out;
}

export interface LiveTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const realTimers: LiveTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface ReloadOptions {
  run: () => void | Promise<void>;
  /** When the person last typed in a field on this screen (ms), 0 for never. */
  lastTypedAt?: () => number;
  timers?: LiveTimers;
  delayMs?: number;
  maxWaitMs?: number;
  quietMs?: number;
  maxDeferMs?: number;
}

/** When to run a reload asked for at `firstAt` and last at `lastAt`: ms from `now` (0: now). */
export function reloadDelay(now: number, firstAt: number, lastAt: number, typedAt: number, o: Required<Omit<ReloadOptions, "run" | "lastTypedAt" | "timers">>): number {
  const settled = Math.min(lastAt + o.delayMs, firstAt + o.maxWaitMs);
  const quiet = typedAt > 0 ? Math.min(typedAt + o.quietMs, firstAt + o.maxDeferMs) : 0;
  return Math.max(0, Math.max(settled, quiet) - now);
}

/** One quiet reload per burst of events, never on top of typing, one at a time. */
export class ReloadScheduler {
  private firstAt = 0;
  private lastAt = 0;
  private timer: unknown = null;
  private running = false;
  private again = false;
  private stopped = false;
  private readonly t: LiveTimers;
  private readonly o: Required<Omit<ReloadOptions, "run" | "lastTypedAt" | "timers">>;
  private readonly opts: ReloadOptions;

  constructor(opts: ReloadOptions) {
    this.opts = opts;
    this.t = opts.timers ?? realTimers;
    this.o = {
      delayMs: opts.delayMs ?? DELAY_MS, maxWaitMs: opts.maxWaitMs ?? MAX_WAIT_MS,
      quietMs: opts.quietMs ?? QUIET_MS, maxDeferMs: opts.maxDeferMs ?? MAX_DEFER_MS,
    };
  }

  /** Something this screen hears changed. */
  poke(): void {
    if (this.stopped) return;
    const now = this.t.now();
    if (this.running) { this.again = true; return; }
    if (!this.firstAt) this.firstAt = now;
    this.lastAt = now;
    this.arm();
  }

  /** Whether a reload is waiting or running. */
  get pending(): boolean { return !!this.firstAt || this.running; }

  cancel(): void {
    this.stopped = true;
    if (this.timer != null) this.t.clear(this.timer);
    this.timer = null;
    this.firstAt = 0;
    this.again = false;
  }

  private arm(): void {
    if (this.timer != null) this.t.clear(this.timer);
    const wait = reloadDelay(this.t.now(), this.firstAt, this.lastAt, this.opts.lastTypedAt?.() ?? 0, this.o);
    this.timer = this.t.set(() => this.fire(), wait);
  }

  private fire(): void {
    this.timer = null;
    if (this.stopped || !this.firstAt) return;
    // Typed since this was armed: wait for the quiet (reloadDelay says how long; 0 once it has come or MAX_DEFER_MS has passed).
    const wait = reloadDelay(this.t.now(), this.firstAt, this.lastAt, this.opts.lastTypedAt?.() ?? 0, this.o);
    if (wait > 0) { this.timer = this.t.set(() => this.fire(), wait); return; }
    this.firstAt = 0;
    this.running = true;
    this.again = false;
    let done: Promise<void>;
    try { done = Promise.resolve(this.opts.run()); } catch { done = Promise.resolve(); }
    void done.catch(() => undefined).then(() => {
      this.running = false;
      if (this.again && !this.stopped) { this.again = false; this.poke(); }
    });
  }
}

/** The part of a WebSocket the client uses (the browser's and React Native's both fit). */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface LiveClientOptions {
  open(url: string): LiveSocket;
  /** The socket's address, or null when there is nowhere to connect yet. */
  url(): Promise<string | null> | string | null;
  /** The session's access token, or null when signed out. */
  token(): Promise<string | null> | string | null;
  onEvent(topic: string, m: Extract<LiveMessage, { type: "event" }>): void;
  /** Signed in again after a gap (a dropped socket, a return to the front): what was said meanwhile was missed. */
  onResume?(): void;
  timers?: LiveTimers;
  random?: () => number;
}

/** One live socket, kept up while started. */
export class LiveClient {
  private ws: LiveSocket | null = null;
  private running = false;
  private ready = false;
  private everReady = false;
  private attempt = 0;
  private gen = 0;
  private heartbeatMs = DEFAULT_HEARTBEAT_MS;
  private retry: unknown = null;
  private dog: unknown = null;
  private readonly t: LiveTimers;
  private readonly o: LiveClientOptions;

  constructor(o: LiveClientOptions) { this.o = o; this.t = o.timers ?? realTimers; }

  /** Signed in and listening. */
  get connected(): boolean { return this.ready; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.gen++;
    if (this.retry != null) this.t.clear(this.retry);
    this.retry = null;
    this.drop();
  }

  private async connect(): Promise<void> {
    this.retry = null;
    const gen = ++this.gen;
    let url: string | null = null, token: string | null = null;
    try { [url, token] = await Promise.all([this.o.url(), this.o.token()]); } catch { /* tried again below */ }
    if (!this.running || gen !== this.gen) return;
    if (!url || !token) { this.later(); return; }
    let ws: LiveSocket;
    try { ws = this.o.open(url); } catch { this.later(); return; }
    this.ws = ws;
    const tok = token;
    ws.onopen = () => { if (this.ws === ws) { try { ws.send(JSON.stringify({ type: "auth", token: tok })); } catch { /* close follows */ } } };
    ws.onmessage = (ev) => this.message(ws, ev?.data);
    ws.onclose = (ev) => this.closed(ws, ev?.code);
    ws.onerror = () => { /* a close follows */ };
    this.watch(CONNECT_TIMEOUT_MS);
  }

  private message(ws: LiveSocket, raw: unknown): void {
    if (this.ws !== ws) return;
    const m = parseLiveMessage(raw);
    if (!m) return;
    if (m.type === "ready") {
      this.heartbeatMs = m.heartbeatMs;
      this.ready = true;
      this.attempt = 0;
      const resumed = this.everReady;
      this.everReady = true;
      this.watch(this.heartbeatMs * 2.5);
      if (resumed) { try { this.o.onResume?.(); } catch { /* the screen's own problem */ } }
      return;
    }
    if (!this.ready) return;
    this.watch(this.heartbeatMs * 2.5);
    if (m.type === "ping") { try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* close follows */ } return; }
    if (m.type === "event") { try { this.o.onEvent(m.topic, m); } catch { /* one bad listener never stops the socket */ } }
  }

  private closed(ws: LiveSocket, code?: number): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.ready = false;
    if (this.dog != null) this.t.clear(this.dog);
    this.dog = null;
    if (this.running) this.later(code);
  }

  /** Try again: at once for a renewal, at the longest when the server has too many of this person's, else backing off. */
  private later(code?: number): void {
    if (!this.running) return;
    if (this.retry != null) this.t.clear(this.retry);
    const random = this.o.random ?? Math.random;
    const ms = code === CLOSE.renew ? Math.round(200 + 800 * random())
      : code === CLOSE.tooMany ? backoffMs(30, random)
        : backoffMs(this.attempt++, random);
    this.retry = this.t.set(() => { void this.connect(); }, ms);
  }

  /** Nothing heard for `ms`: the socket is gone, whatever it says. */
  private watch(ms: number): void {
    if (this.dog != null) this.t.clear(this.dog);
    const ws = this.ws;
    this.dog = this.t.set(() => {
      this.dog = null;
      if (this.ws !== ws) return;
      this.drop();
      this.later();
    }, ms);
  }

  private drop(): void {
    if (this.dog != null) this.t.clear(this.dog);
    this.dog = null;
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (!ws) return;
    ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
    try { ws.close(); } catch { /* already gone */ }
  }
}
