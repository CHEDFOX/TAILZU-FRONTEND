/**
 * THE OUTBOX: asks typed while offline, kept on the phone and sent once the connection is back (the server's shared/types/sdui.ts 3e,
 * docs/bots-app.md "Offline"). Free of react-native: storage, the network, the clock and ids are handed in (outbox.ts does that), so every
 * rule is tested on its own (outboxCore.test.ts).
 *
 *   add      an ask is kept with an id of its own and the time it was typed, after the others. `sub` gets "{time}" filled in ("9:38").
 *   flush    online, the waiting ones go IN ORDER, one at a time, as POST `path` with the body and { clientId: id, typedAt }. The server
 *            answers one clientId once, so a retry after an answer that was lost never asks twice.
 *            A refusal that will not change (400, 403, 404, 413, 422) marks that ask "failed" and the next one goes. Anything else (no
 *            network, 5xx, 429, 409 "still on its way", 401 while the session renews) puts it back to "waiting", tries again later
 *            (2 s, 4 s, 8 s … at most a minute), and holds the ones after it, so they still go in order.
 *   state    waiting → sending → sent | failed. What screens read: `outbox` ({ id, label, sub, state, typedAt }, oldest first) and
 *            `outboxWaiting` (waiting and sending).
 *   keep     everything is written to storage after every change, so a closed app keeps its asks. Sent ones are dropped after a day
 *            (or by "clear"); at most MAX asks are kept, and a full outbox takes no more.
 */

export type OutboxState = "waiting" | "sending" | "sent" | "failed";

export interface OutboxEntry {
  id: string;
  path: string;
  body: Record<string, unknown>;
  label: string;
  sub: string;
  state: OutboxState;
  typedAt: number;
  tries: number;
  /** Not before this time (ms) for the next try. */
  nextAt: number;
  sentAt?: number;
}

/** What screens read, per ask. */
export interface OutboxView { id: string; label: string; sub: string; state: OutboxState; typedAt: number }

export interface OutboxIO {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  /** POST it; throws on failure, with `status` when the server answered. */
  send(path: string, body: Record<string, unknown>): Promise<unknown>;
  now(): number;
  newId(): string;
  /** "9:38": when an ask was typed, as the phone tells the time. */
  timeText(ms: number): string;
}

export const OUTBOX_MAX = 20;
export const KEEP_SENT_MS = 24 * 3600_000;
const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
const FOR_GOOD = new Set([400, 403, 404, 405, 413, 422]);

/** Whether a failure is worth another try: anything but a refusal that will not change. */
export function retryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return !(typeof status === "number" && FOR_GOOD.has(status));
}

const isEntry = (x: unknown): x is OutboxEntry => {
  const e = x as OutboxEntry;
  return !!e && typeof e.id === "string" && typeof e.path === "string" && typeof e.label === "string" && typeof e.typedAt === "number"
    && !!e.body && typeof e.body === "object" && ["waiting", "sending", "sent", "failed"].includes(e.state);
};

export class Outbox {
  private list: OutboxEntry[] = [];
  private listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  /** Nothing is written before what was kept has been read: an early write would lose it. */
  private didLoad = false;
  private flushing: Promise<number> | null = null;

  private readonly io: OutboxIO;
  private readonly o: { max?: number; keepSentMs?: number };

  constructor(io: OutboxIO, o: { max?: number; keepSentMs?: number } = {}) {
    this.io = io;
    this.o = o;
  }

  /** Read what was kept. Anything sending when the app stopped goes back to waiting (the server answers its id once). */
  ready(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const raw = await this.io.load();
          const rows = raw ? (JSON.parse(raw) as unknown) : [];
          if (Array.isArray(rows)) {
            const kept = rows.filter(isEntry).map((e) => (e.state === "sending" ? { ...e, state: "waiting" as const, nextAt: 0 } : e));
            // Asks added before the load finished stay after the kept ones.
            const ids = new Set(kept.map((e) => e.id));
            this.list = [...kept, ...this.list.filter((e) => !ids.has(e.id))];
          }
        } catch { /* nothing readable was kept */ }
        this.didLoad = true;
        this.prune();
        this.changed();
      })();
    }
    return this.loaded;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  entries(): readonly OutboxEntry[] { return this.list; }

  view(): { outbox: OutboxView[]; outboxWaiting: number } {
    return {
      outbox: this.list.map(({ id, label, sub, state, typedAt }) => ({ id, label, sub, state, typedAt })),
      outboxWaiting: this.list.filter((e) => e.state === "waiting" || e.state === "sending").length,
    };
  }

  /** Keep an ask. Null when it cannot be kept: not a /v1/ route, nothing typed, or the outbox is full. */
  add(a: { path: unknown; body?: unknown; label?: unknown; sub?: unknown }): OutboxEntry | null {
    const path = typeof a.path === "string" ? a.path : "";
    if (!/^\/v1\/[A-Za-z0-9/_.-]*$/.test(path) || path.includes("..")) return null;
    const label = typeof a.label === "string" ? a.label.trim() : "";
    if (!label) return null;
    this.prune();
    if (this.list.length >= (this.o.max ?? OUTBOX_MAX)) {
      const sent = this.list.findIndex((e) => e.state === "sent");
      if (sent < 0) return null;
      this.list.splice(sent, 1);
    }
    const typedAt = this.io.now();
    const body = a.body && typeof a.body === "object" && !Array.isArray(a.body) ? { ...(a.body as Record<string, unknown>) } : {};
    const sub = (typeof a.sub === "string" ? a.sub : "").replace(/\{time\}/g, this.io.timeText(typedAt));
    const e: OutboxEntry = { id: this.io.newId(), path, body, label: label.slice(0, 2000), sub, state: "waiting", typedAt, tries: 0, nextAt: 0 };
    this.list.push(e);
    this.changed();
    return e;
  }

  /** Take an ask out, unless it is on its way or went. */
  remove(id: unknown): boolean {
    const i = this.list.findIndex((e) => e.id === id && (e.state === "waiting" || e.state === "failed"));
    if (i < 0) return false;
    this.list.splice(i, 1);
    this.changed();
    return true;
  }

  /** Send a failed ask again (with the next flush). */
  retry(id: unknown): boolean {
    const e = this.list.find((x) => x.id === id && x.state === "failed");
    if (!e) return false;
    e.state = "waiting"; e.tries = 0; e.nextAt = 0;
    this.changed();
    return true;
  }

  /** Drop the ones that were sent. */
  clear(): void {
    const n = this.list.length;
    this.list = this.list.filter((e) => e.state !== "sent");
    if (this.list.length !== n) this.changed();
  }

  /** Everything, for good (the account signed out). */
  clearAll(): void {
    this.list = [];
    this.changed();
  }

  /** The next time a waiting ask may go (ms), or null when none waits. */
  nextDue(): number | null {
    const w = this.list.find((e) => e.state === "waiting");
    return w ? w.nextAt : null;
  }

  /** Send what waits, in order, while online. Resolves with how many went. One flush at a time. */
  flush(online: boolean): Promise<number> {
    if (!online) return Promise.resolve(0);
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.ready();
      let sent = 0;
      for (;;) {
        const e = this.list.find((x) => x.state === "waiting" || x.state === "sending");
        if (!e || e.state !== "waiting" || e.nextAt > this.io.now()) break;
        e.state = "sending";
        this.changed();
        try {
          await this.io.send(e.path, { ...e.body, clientId: e.id, typedAt: e.typedAt });
          e.state = "sent"; e.sentAt = this.io.now();
          sent++;
          this.changed();
        } catch (err) {
          if (retryable(err)) {
            e.state = "waiting";
            e.nextAt = this.io.now() + BACKOFF_MS[Math.min(e.tries, BACKOFF_MS.length - 1)]!;
            e.tries++;
            this.changed();
            break;   // the ones after it wait, so they go in order
          }
          e.state = "failed";
          this.changed();
        }
      }
      return sent;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private prune(): void {
    const keep = this.o.keepSentMs ?? KEEP_SENT_MS;
    const t = this.io.now();
    this.list = this.list.filter((e) => e.state !== "sent" || t - (e.sentAt ?? 0) < keep);
  }

  private changed(): void {
    if (this.didLoad) this.io.save(JSON.stringify(this.list)).catch(() => { /* kept in memory still */ });
    else void this.ready();
    this.listeners.forEach((fn) => { try { fn(); } catch { /* a listener's own problem */ } });
  }
}

/** "9:38": hours and minutes, no seconds, as a phone shows them (no leading zero on the hour, 12-hour clock). */
export function clockText(ms: number, d = new Date(ms)): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}
