/**
 * `subscribe`, THE ACTION AND NODE PROP (pure SPEC 2.10): `{ topic, into, mode: replace | append | merge, max }`. A screen listens to a
 * live topic and the server's data lands in state. Free of react-native and of the socket, so every rule is tested on its own
 * (subscribe.test.ts).
 *
 * It rides the EXISTING live socket (live.ts, liveCore.ts LiveClient on WS /v1/live, our origin only, signed in by the first message).
 * There is no second connection. live.ts calls `subscribeEvent(topic, data)` for each event it hears, the way it calls `streamEvent`
 * for an answer's words; a screen's own `liveTopics` reload is untouched.
 *
 *   limits   ≤ 4 topics per screen; a message over 64 KB is dropped; ≤ 20 merges a second (the rest wait their turn, the newest
 *            replace-message of a subscription replaces an older waiting one, at most 200 wait); `into` must be a safe state path;
 *            `ask:*` topics are the answer stream's (askStream.ts) and are refused here; a topic is letters, digits and : _ - . *
 *   replace  the data is written at `into`.
 *   append   the data (one item, or an array of items) is added to the list at `into`; `max` (default and ceiling 2000) keeps the newest.
 *   merge    a plain object's keys are written over the object at `into` (shallow; prototype keys never).
 */
import { safeStatePath } from "../client/endpointCore.ts";
import { hears, realTimers, type LiveTimers } from "./liveCore.ts";

export const SUBSCRIBE_LIMITS = Object.freeze({ topics: 4, messageBytes: 64 * 1024, mergesPerSecond: 20, listItems: 2000, waiting: 200, topicChars: 64, perScreen: 4, storeBytes: 2 * 1024 * 1024 });

export type SubscribeMode = "replace" | "append" | "merge";
export interface SubscribeSpec { topic: string; into: string; mode?: SubscribeMode; max?: number }

/** The schema of the action and the node prop, for the server lint and the renderer. */
export const SPEC = Object.freeze({
  action: "subscribe",
  props: {
    // The exact grammar: /^[A-Za-z0-9:_\-.*]{1,64}$/, not starting with "ask:", a wildcard only as a trailing ":*" (or "*" alone).
    // It is a topic, not a /v1/ network path: lint must not apply networkPathOk to it.
    topic: "string /^[A-Za-z0-9:_\\-.*]{1,64}$/, not ask:*, wildcard only as trailing :*",
    into: "state path (segments of A-Za-z0-9_-, at most 12)",
    mode: ["replace", "append", "merge"],
    max: "number 1..2000 (append)",
  },
  limits: SUBSCRIBE_LIMITS,
});

const TOPIC = /^[A-Za-z0-9:_\-.*]{1,64}$/;
/** A wildcard is only the whole topic or a trailing ":*". */
const wildOk = (t: string): boolean => !t.includes("*") || t === "*" || (t.endsWith(":*") && t.indexOf("*") === t.length - 1);
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/** A spec with every value checked and clamped, or null when it cannot be honoured. */
export function normalizeSubscribe(s: unknown): Required<SubscribeSpec> | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (typeof o.topic !== "string" || !TOPIC.test(o.topic) || o.topic.startsWith("ask:") || !wildOk(o.topic)) return null;
  if (!safeStatePath(o.into)) return null;
  const mode: SubscribeMode = o.mode === "append" || o.mode === "merge" ? o.mode : "replace";
  const m = typeof o.max === "number" ? o.max : NaN;
  const max = Number.isFinite(m) ? Math.min(SUBSCRIBE_LIMITS.listItems, Math.max(1, Math.floor(m))) : SUBSCRIBE_LIMITS.listItems;
  return { topic: o.topic, into: o.into, mode, max };
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The next value at `into` for one message. Pure. */
export function nextValue(mode: SubscribeMode, current: unknown, data: unknown, max: number): unknown {
  if (mode === "append") {
    const list = Array.isArray(current) ? current : [];
    const add = Array.isArray(data) ? data : [data];
    const all = list.concat(add);
    return all.length > max ? all.slice(all.length - max) : all;
  }
  if (mode === "merge") {
    if (!isPlain(data)) return current;
    const out: Record<string, unknown> = isPlain(current) ? { ...current } : {};
    for (const k of Object.keys(data)) if (!UNSAFE.has(k)) out[k] = data[k];
    return out;
  }
  return data;
}

/** UTF-8 length of a string (the kernel's byteLen, copied until the kernel can be imported). */
export function utf8Len(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) { n += 4; i++; } else n += 3;
  }
  return n;
}

/** The size of a message in UTF-8 bytes (a message that cannot be written as JSON counts as too big). */
export function messageBytes(data: unknown): number {
  try { const t = JSON.stringify(data); return t === undefined ? 0 : utf8Len(t); } catch { return Infinity; }
}

export interface SubscribeHost {
  read(path: string): unknown;
  write(path: string, value: unknown): void;
}

interface Sub { id: number; screen: string; spec: Required<SubscribeSpec>; sizes: number[] }

/** Every subscription of every screen on show, and the rules that keep them small. */
export class SubscriptionHub {
  private subs: Sub[] = [];
  private seq = 0;
  private stamps: number[] = [];
  private queue: { sub: Sub; data: unknown; size: number }[] = [];
  private timer: unknown = null;
  private readonly t: LiveTimers;

  private readonly host: SubscribeHost;
  constructor(host: SubscribeHost, timers: LiveTimers = realTimers) { this.host = host; this.t = timers; }
  private now(): number { return this.t.now(); }

  /** Listen as `screen`. Returns the way to stop, or null when refused (bad spec, or the screen already has 4 topics). */
  add(screen: string, spec: unknown): (() => void) | null {
    const s = normalizeSubscribe(spec);
    if (!s) return null;
    const mine = this.subs.filter((x) => x.screen === screen);
    if (mine.some((x) => x.spec.topic === s.topic && x.spec.into === s.into)) return () => {};
    if (new Set(mine.map((x) => x.spec.topic).concat(s.topic)).size > SUBSCRIBE_LIMITS.topics) return null;
    if (mine.length >= SUBSCRIBE_LIMITS.perScreen) return null;
    const sub: Sub = { id: ++this.seq, screen, spec: s, sizes: [] };
    this.subs.push(sub);
    return () => {
      this.subs = this.subs.filter((x) => x !== sub);
      this.queue = this.queue.filter((q) => q.sub !== sub);
    };
  }

  /** A screen went away: all of its subscriptions with it. */
  dropScreen(screen: string): void {
    const gone = new Set(this.subs.filter((x) => x.screen === screen));
    this.subs = this.subs.filter((x) => !gone.has(x));
    this.queue = this.queue.filter((q) => !gone.has(q.sub));
  }

  /** The topics the screen listens to (the server may use them to send only what is wanted). */
  topicsOf(screen: string): string[] { return [...new Set(this.subs.filter((x) => x.screen === screen).map((x) => x.spec.topic))]; }

  /** live.ts: an event arrived. True when a subscription took it (so no reload is needed for it). */
  event(topic: string, data: unknown): boolean {
    if (topic.startsWith("ask:")) return false;
    // A bare "something changed" hint carries no data: it stays a hint (the screen's liveTopics reload handles it).
    if (data === undefined || data === null) return false;
    const hearing = this.subs.filter((sub) => hears([sub.spec.topic], topic));
    if (!hearing.length) return false;
    const size = messageBytes(data);
    if (size > SUBSCRIBE_LIMITS.messageBytes) return false;
    for (const sub of hearing) this.apply(sub, data, size);
    return true;
  }

  private apply(sub: Sub, data: unknown, size: number): void {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 1000);
    if (this.stamps.length < SUBSCRIBE_LIMITS.mergesPerSecond && !this.queue.length) { this.run(sub, data, t, size); return; }
    // Over the rate: the newest "replace" of a subscription stands in for the older ones waiting.
    if (sub.spec.mode === "replace") this.queue = this.queue.filter((q) => q.sub !== sub);
    this.queue.push({ sub, data, size });
    if (this.queue.length > SUBSCRIBE_LIMITS.waiting) this.queue.shift();
    this.schedule();
  }

  private run(sub: Sub, data: unknown, t: number, size: number): void {
    this.stamps.push(t);
    try {
      const { mode, into, max } = sub.spec;
      const current = this.host.read(into);
      let next = nextValue(mode, current, data, max);
      if (mode === "append") {
        // Sizes of the kept items, counted once each; the oldest go until the list fits half a screen store.
        const added = Array.isArray(data) ? data.length : 1;
        const kept = Array.isArray(next) ? next.length : 0;
        const per = added ? Math.ceil(size / added) : 0;
        // Resync if state was changed from outside (list shorter or longer than we know).
        const known = Array.isArray(current) ? current.length : 0;
        if (sub.sizes.length !== known) sub.sizes = new Array(known).fill(per);
        for (let i = 0; i < added; i++) sub.sizes.push(per);
        if (sub.sizes.length > kept) sub.sizes = sub.sizes.slice(sub.sizes.length - kept);
        const budget = SUBSCRIBE_LIMITS.storeBytes / 2;
        let total = sub.sizes.reduce((a, b) => a + b, 0), drop = 0;
        while (total > budget && drop < sub.sizes.length - 1) total -= sub.sizes[drop++];
        if (drop) { sub.sizes = sub.sizes.slice(drop); next = (next as unknown[]).slice(drop); }
      } else if (messageBytes(next) > SUBSCRIBE_LIMITS.storeBytes) return;
      this.host.write(into, next);
    } catch { /* a screen's own state is its problem; never the socket's */ }
  }

  private schedule(): void {
    if (this.timer != null || !this.queue.length) return;
    const oldest = this.stamps.length ? Math.min(...this.stamps) : this.now();
    const wait = Math.max(10, oldest + 1000 - this.now());
    this.timer = this.t.set(() => { this.timer = null; this.drain(); }, wait);
  }

  private drain(): void {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 1000);
    while (this.queue.length && this.stamps.length < SUBSCRIBE_LIMITS.mergesPerSecond) {
      const q = this.queue.shift()!;
      this.run(q.sub, q.data, t, q.size);
    }
    this.schedule();
  }

  /** Everything ends (sign-out, kill switch). */
  clear(): void {
    this.subs = []; this.queue = [];
    if (this.timer != null) this.t.clear(this.timer);
    this.timer = null;
  }

  get size(): number { return this.subs.length; }
  get waiting(): number { return this.queue.length; }
}

let hub: SubscriptionHub | null = null;
/** V1 gives the real store once (state read and write); until then nothing is listened to. */
export function bindSubscribeHost(host: SubscribeHost | null, hubFor: (h: SubscribeHost) => SubscriptionHub = (h) => new SubscriptionHub(h)): void {
  hub?.clear();
  hub = host ? hubFor(host) : null;
}
export const subscribeHub = (): SubscriptionHub | null => hub;
/** live.ts's one call per event. */
export function subscribeEvent(topic: string, data: unknown): boolean { return hub ? hub.event(topic, data) : false; }
