/**
 * THE BOTS' LOOKS AND MOMENTS AN APP HAS (the store; looks.ts wires it to the phone, the window has its own in sdui.js).
 *
 * The catalog is the server's (TAILZU-BACKEND shared/bots/looks.json, docs/bots-app.md "Looks and moments"). An app
 * holds three copies and uses one:
 *   - the starter pack its build shipped (starter.ts, generated from the server's file at release): first launch, offline;
 *   - the last one the server sent, kept on the device (restore());
 *   - the server's now: the bootstrap's flag "bots.looks" ({ v, url }) says which version that is, and when it is not
 *     the one in use the app fetches it (sync()). The server's word wins, up or down (a pushed catalog, or one taken back).
 * A catalog is compiled once (core.ts compileLooks) and only taken when it compiles without an error; the bots are told
 * (subscribe) and take their looks at once. Nothing here runs in a frame. Plain TypeScript with its IO handed in, so
 * node --test runs it.
 */
import { LOOKS_FORMAT, compileLooks, type Looks } from "./core.ts";

export interface LooksIO {
  /** The kept copy (text), or null. */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** The server's catalog at `path` (a path on the API, like "/v1/bots/looks?v=3"), parsed. */
  fetch(path: string): Promise<unknown>;
}

/**
 * The bootstrap's word on the catalog: its version, where to get it, and (format 2 and above) which format it is
 * cut down to and which moments are switched off. A build that plays only format 1 is sent exactly what it was
 * sent before: { v, url }.
 */
export interface LooksFlag { v: number; f: number; url: string; off: string[] }

/** A catalog's own format, as the projection wrote it, never above what this build plays. */
function formatOf(spec: unknown): number {
  const f = Number((spec as { format?: unknown } | null | undefined)?.format);
  return Number.isFinite(f) && f >= 1 ? Math.min(LOOKS_FORMAT, Math.floor(f)) : 1;
}

export function readFlag(flag: unknown): LooksFlag | null {
  if (!flag || typeof flag !== "object") return null;
  const q = flag as Record<string, unknown>;
  const v = Number(q.v), url = String(q.url ?? "");
  if (!Number.isFinite(v) || v < 1 || !url.startsWith("/v1/")) return null;
  const f = Number(q.f);
  const off = Array.isArray(q.off) ? q.off.map(String).slice(0, 64) : [];
  return { v, f: Number.isFinite(f) && f >= 1 ? Math.min(LOOKS_FORMAT, Math.floor(f)) : 1, url, off };
}

export class LooksStore {
  current: Looks;
  /**
   * The format the catalog in use was cut down to: the kept copy is compared on (v, f), never on v alone. It starts
   * at the starter pack's own format (genStarter writes it), so a build that ships a format-2 starter does not call
   * itself format 1 and then take an older format-2 copy over it (SPEC 2.7).
   */
  currentF = 1;
  /** The moments the server has switched off; the app plays their fallback act instead. */
  off: string[] = [];
  private io: LooksIO;
  private listeners = new Set<(l: Looks) => void>();
  private fetching = 0;

  constructor(starter: unknown, io: LooksIO) {
    this.io = io;
    this.current = compileLooks(starter);
    this.currentF = formatOf(starter);
  }

  /**
   * Take a catalog if it compiles cleanly (`force`: even an older one, when the server says so). True: it is in
   * use now. `f` is the format it was cut down to, which is kept beside the version: a phone updated from the
   * store has the same v as before and must still fetch the richer cut (SPEC 2.7).
   */
  take(spec: unknown, force = false, f = 1): boolean {
    const next = compileLooks(spec);
    if (next.errors.length || !next.v) return false;
    // Newer content, or the same content cut less far down. An OLDER copy is never taken for its format alone.
    if (!force && !(next.v > this.current.v || (next.v === this.current.v && f > this.currentF))) return false;
    this.current = next;
    this.currentF = f;
    for (const fn of this.listeners) { try { fn(next); } catch { /* a listener's fault is its own */ } }
    return true;
  }

  /** At start: the copy the server last sent, if it is newer than the build's own, and the format it was cut to. */
  async restore(): Promise<void> {
    try {
      const text = await this.io.read();
      if (!text) return;
      const kept = JSON.parse(text) as { f?: unknown; spec?: unknown };
      // The copy a format-2 build keeps is { f, spec }; an older build's is the catalog itself.
      if (kept && typeof kept === "object" && "spec" in kept) this.take(kept.spec, false, Math.max(1, Number(kept.f) || 1));
      else this.take(kept);
    } catch { /* nothing kept, or nothing readable: the starter stays */ }
  }

  /**
   * The bootstrap's flag: when it names another version than the one in use, fetch it, take it when it compiles,
   * and keep it for the next start. One fetch at a time per version; a failure leaves what is here.
   */
  async sync(flag: unknown): Promise<boolean> {
    const q = readFlag(flag);
    if (!q) return false;
    this.off = q.off;
    const key = q.v * 16 + q.f;
    if ((q.v === this.current.v && q.f === this.currentF) || key === this.fetching) return false;
    this.fetching = key;
    try {
      const spec = await this.io.fetch(q.url);
      if (!spec || typeof spec !== "object" || Number((spec as { v?: unknown }).v) !== q.v) return false;
      if (!this.take(spec, true, q.f)) return false;
      await this.io.write(JSON.stringify({ f: q.f, spec })).catch(() => {});
      return true;
    } catch {
      return false;
    } finally {
      this.fetching = 0;
    }
  }

  /** True when the server has switched this moment off: play its fallback act instead. */
  isOff(id: string): boolean {
    return this.off.includes(id);
  }

  subscribe(fn: (l: Looks) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}
