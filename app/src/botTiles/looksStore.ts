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
import { compileLooks, type Looks } from "./core.ts";

export interface LooksIO {
  /** The kept copy (text), or null. */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** The server's catalog at `path` (a path on the API, like "/v1/bots/looks?v=3"), parsed. */
  fetch(path: string): Promise<unknown>;
}

/** The bootstrap's word on the catalog: its version and where to get it. */
export interface LooksFlag { v: number; url: string }

export function readFlag(flag: unknown): LooksFlag | null {
  if (!flag || typeof flag !== "object") return null;
  const f = flag as Record<string, unknown>;
  const v = Number(f.v), url = String(f.url ?? "");
  if (!Number.isFinite(v) || v < 1 || !url.startsWith("/v1/")) return null;
  return { v, url };
}

export class LooksStore {
  current: Looks;
  private io: LooksIO;
  private listeners = new Set<(l: Looks) => void>();
  private fetching = 0;

  constructor(starter: unknown, io: LooksIO) {
    this.io = io;
    this.current = compileLooks(starter);
  }

  /** Take a catalog if it compiles cleanly (`force`: even an older one, when the server says so). True: it is in use now. */
  take(spec: unknown, force = false): boolean {
    const next = compileLooks(spec);
    if (next.errors.length || !next.v) return false;
    if (!force && next.v <= this.current.v) return false;
    this.current = next;
    for (const fn of this.listeners) { try { fn(next); } catch { /* a listener's fault is its own */ } }
    return true;
  }

  /** At start: the copy the server last sent, if it is newer than the build's own. */
  async restore(): Promise<void> {
    try {
      const text = await this.io.read();
      if (text) this.take(JSON.parse(text));
    } catch { /* nothing kept, or nothing readable: the starter stays */ }
  }

  /**
   * The bootstrap's flag: when it names another version than the one in use, fetch it, take it when it compiles,
   * and keep it for the next start. One fetch at a time per version; a failure leaves what is here.
   */
  async sync(flag: unknown): Promise<boolean> {
    const f = readFlag(flag);
    if (!f || f.v === this.current.v || f.v === this.fetching) return false;
    this.fetching = f.v;
    try {
      const spec = await this.io.fetch(f.url);
      if (!spec || typeof spec !== "object" || Number((spec as { v?: unknown }).v) !== f.v) return false;
      if (!this.take(spec, true)) return false;
      await this.io.write(JSON.stringify(spec)).catch(() => {});
      return true;
    } catch {
      return false;
    } finally {
      this.fetching = 0;
    }
  }

  subscribe(fn: (l: Looks) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}
