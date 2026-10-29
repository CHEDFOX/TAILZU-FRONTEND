/**
 * THE BOTS' SOUNDS: the rules (sounds.ts plays them; the server's side is backend experience/bots/sounds.ts and
 * shared/types/sdui.ts 3h).
 *
 *   parsePack(spec)       the server's catalog (GET /v1/bots/sounds), made safe: what does not read is left out.
 *   SoundStore            the pack this phone has: the kept one at start, the server's when the bootstrap's flag
 *                         "bots.sounds" names another version (its files fetched first, then it is taken, then the old
 *                         files go). Plain TypeScript with its IO handed in, so node --test runs it.
 *   pick(pack, kind, …)   which sound now: weighted, never the one that played last (pullBot.sounds.noRepeat), the rare
 *                         one about rareChance of the time.
 *   mayPlay(rules)        whether a sound may play at all: the server's switch, the person's, the app in front, no other
 *                         sound of the app's own playing or recording.
 *   SFX_MODE              the audio session a sound asks for: mixed with what else is playing (ducking nothing), and
 *                         silent when the phone is (iOS: the ambient category, which the silent switch silences;
 *                         Android: nothing while the ringer is on silent or vibrate). expo-audio does both for this.
 */

export type SoundKind = "throw" | "tick" | "new" | "uptodate" | "moment";
export const SOUND_KINDS: readonly SoundKind[] = ["throw", "tick", "new", "uptodate", "moment"];

export interface Sound {
  /** For a moment: the name its recipe's sound track says. */
  id: string;
  kind: SoundKind;
  /** A path on the API's origin, or an https address. */
  url: string;
  hash: string;
  weight: number;
  rare: boolean;
  ms: number;
  label?: string;
}

export interface SoundPack {
  v: number;
  sounds: Sound[];
}

const ID = /^[a-z0-9][a-z0-9._-]{0,40}$/;
const HASH = /^[0-9a-f]{8,64}$/;
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The server's catalog, made safe; null when it has no version or nothing that reads. */
export function parsePack(spec: unknown): SoundPack | null {
  if (!isRec(spec)) return null;
  const v = Number(spec.v);
  if (!Number.isInteger(v) || v < 1 || !Array.isArray(spec.sounds)) return null;
  const seen = new Set<string>();
  const sounds: Sound[] = [];
  for (const s of spec.sounds.slice(0, 64)) {
    if (!isRec(s)) continue;
    const id = String(s.id ?? ""), kind = s.kind as SoundKind, url = String(s.url ?? ""), hash = String(s.hash ?? "");
    if (!ID.test(id) || seen.has(id) || !SOUND_KINDS.includes(kind) || !HASH.test(hash)) continue;
    if (!/^(\/[a-z0-9]|https:\/\/)/i.test(url) || url.includes("..") || /\s/.test(url)) continue;
    const weight = Number(s.weight ?? 1);
    if (!Number.isFinite(weight) || weight < 0) continue;
    seen.add(id);
    sounds.push({
      id, kind, url, hash, weight: Math.min(100, weight), rare: s.rare === true, ms: Math.max(0, Number(s.ms) || 0),
      ...(typeof s.label === "string" ? { label: s.label.slice(0, 60) } : {}),
    });
  }
  return sounds.length ? { v, sounds } : null;
}

/** Where a sound is kept on the phone: its id and hash (a changed file is another name). */
export function fileName(s: Sound): string {
  return `${s.id.replace(/[^a-z0-9_-]/gi, "_")}-${s.hash}.m4a`;
}

export interface PickOpts {
  /** The id that played last of this kind (never again straight after, when noRepeat). */
  last: string | null;
  rareChance: number;
  noRepeat: boolean;
  rand: () => number;
  /** Only these may be picked (the ones on the phone); none: any. */
  usable?: (s: Sound) => boolean;
}

function weighted(pool: Sound[], rand: () => number): Sound | null {
  const total = pool.reduce((t, s) => t + s.weight, 0);
  if (!(total > 0)) return null;
  let r = rand() * total;
  for (const s of pool) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return pool[pool.length - 1] ?? null;
}

/**
 * Which sound of `kind` now. The rare ones get one roll of `rareChance`; otherwise the others, by weight. When noRepeat,
 * the one that played last is left out (and if that leaves nothing on its side, the other side is used: the rare one is
 * never heard twice running either).
 */
export function pick(pack: SoundPack | null, kind: SoundKind, o: PickOpts): Sound | null {
  if (!pack) return null;
  const ok = (s: Sound) => s.kind === kind && s.weight > 0 && (!o.usable || o.usable(s));
  const all = pack.sounds.filter(ok);
  if (!all.length) return null;
  const fresh = (list: Sound[]) => (o.noRepeat && all.length > 1 ? list.filter((s) => s.id !== o.last) : list);
  const rares = fresh(all.filter((s) => s.rare)), commons = fresh(all.filter((s) => !s.rare));
  const chance = Math.max(0, Math.min(1, Number.isFinite(o.rareChance) ? o.rareChance : 0));
  const first = rares.length && o.rand() < chance ? rares : commons;
  return weighted(first.length ? first : first === rares ? commons : rares, o.rand);
}

/** A moment's sound, by the name its recipe gives. */
export function momentSound(pack: SoundPack | null, name: string): Sound | null {
  return pack?.sounds.find((s) => s.kind === "moment" && s.id === name && s.weight > 0) ?? null;
}

export interface SoundRules {
  /** The server's switch (knob pullBot.sounds.enabled, or bots.sounds.moments for a moment's). */
  knob: boolean;
  /** The person's, on this phone (the Sounds switch). */
  user: boolean;
  /** The app is in front. */
  active: boolean;
  /** Something of the app's own is playing or recording (a voice sample, the microphone): a sound never cuts in. */
  busy: boolean;
}

export function mayPlay(r: SoundRules): boolean {
  return r.knob && r.user && r.active && !r.busy;
}

/**
 * The audio session a sound asks for (expo-audio setAudioModeAsync): it respects the silent switch (iOS: ambient; Android:
 * nothing on silent or vibrate), mixes with other apps' audio and lowers none of it, records nothing, stops in the background.
 */
export const SFX_MODE = {
  playsInSilentMode: false,
  interruptionMode: "mixWithOthers",
  allowsRecording: false,
  shouldPlayInBackground: false,
} as const;

/** The session the app's own players expect between sounds (media.ts sets it before each of its own as well). */
export const APP_MODE = { playsInSilentMode: true, interruptionMode: "mixWithOthers", allowsRecording: false } as const;

/** A volume knob, held to 0..1. */
export function volumeOf(v: number, def: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : def;
}

// ===================================================================== the pack on this phone

export interface SoundsFlag { v: number; url: string }

/** The bootstrap's "bots.sounds": { v, url } (a path on the API). */
export function readSoundsFlag(flag: unknown): SoundsFlag | null {
  if (!isRec(flag)) return null;
  const v = Number(flag.v), url = String(flag.url ?? "");
  if (!Number.isInteger(v) || v < 1 || !url.startsWith("/v1/")) return null;
  return { v, url };
}

export interface SoundsIO {
  /** The kept catalog (text), or null. */
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** The server's catalog at a path on the API, parsed. */
  fetch(path: string): Promise<unknown>;
  /** Fetch a sound's file (a path on the API, or https) to `name` in the sounds' folder. True when it is there. */
  download(url: string, name: string): Promise<boolean>;
  /** The names in the sounds' folder. */
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

export class SoundStore {
  pack: SoundPack | null = null;
  /** The files on the phone, by name. */
  private files = new Set<string>();
  private io: SoundsIO;
  private fetching = 0;
  private listeners = new Set<(p: SoundPack | null) => void>();

  constructor(io: SoundsIO) {
    this.io = io;
  }

  /** A sound's file name when it is on the phone, else null (it is not played). */
  file(s: Sound): string | null {
    const n = fileName(s);
    return this.files.has(n) ? n : null;
  }

  /** At start: the kept catalog, and which of its files are here. */
  async restore(): Promise<void> {
    try {
      const [text, names] = await Promise.all([this.io.read(), this.io.list().catch(() => [] as string[])]);
      this.files = new Set(names);
      const p = text ? parsePack(JSON.parse(text)) : null;
      if (p && (!this.pack || p.v !== this.pack.v)) this.take(p);
    } catch { /* nothing kept: no sounds until the server's come */ }
  }

  private take(p: SoundPack): void {
    this.pack = p;
    for (const fn of this.listeners) { try { fn(p); } catch { /* a listener's fault is its own */ } }
  }

  /**
   * The bootstrap's flag: when it names another version, fetch the catalog, fetch the files the phone lacks (one by one;
   * a sound whose file does not come is simply not played), take it, keep it, and let the old files go. The server's
   * word wins, up or down. One sync at a time per version; a failure leaves what is here.
   */
  async sync(flag: unknown): Promise<boolean> {
    const f = readSoundsFlag(flag);
    if (!f || (this.pack && f.v === this.pack.v) || f.v === this.fetching) return false;
    this.fetching = f.v;
    try {
      const p = parsePack(await this.io.fetch(f.url));
      if (!p || p.v !== f.v) return false;
      const want = new Set(p.sounds.map(fileName));
      for (const s of p.sounds) {
        const n = fileName(s);
        if (this.files.has(n)) continue;
        if (await this.io.download(s.url, n).catch(() => false)) this.files.add(n);
      }
      this.take(p);
      await this.io.write(JSON.stringify(p)).catch(() => {});
      for (const n of [...this.files]) {
        if (want.has(n)) continue;
        this.files.delete(n);
        await this.io.remove(n).catch(() => {});
      }
      return true;
    } catch {
      return false;
    } finally {
      this.fetching = 0;
    }
  }

  subscribe(fn: (p: SoundPack | null) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}
