/**
 * THE SERVER-DRAWN LOOKS ON THIS PHONE (native/SPEC.md sections 3.1 and 4.6; the backend's docs/native-looks.md). The widgets, the
 * iOS Live Activity and the Android notice draw their APPEARANCE from data this server sends, interpreted by native code already in
 * the binary. This file is the phone's half of delivery: it fetches the catalog, checks it, gets the pictures and fonts it names, draws
 * the dotted-bot stills, and writes the lot where the natives can read it. looksCore.ts holds every rule (and its tests).
 *
 *   syncNativeLooks   the bootstrap's flag "native.looks" ({ v, url }) names a catalog. When this phone's copy is not THAT version at
 *                     THIS drawsFormat (an OTA can raise it), fetch it, clean every design on its own, download what is missing by
 *                     content hash (magic bytes, size and sha256 checked), draw the stills, and write one new versioned folder
 *                     through the bridge. Only AFTER that does the glance say `nl`, so nothing can name a design the phone lacks.
 *   syncNativeStills  after a glance: the stills of the bots it shows, drawn on a CPU raster only when missing. A new still means the
 *                     index is written again (a new folder; the natives sweep the old ones).
 *   heldLooksVersion  the catalog version this phone really holds, for the glance's `nl`
 *   reportBadLooks    design ids a widget struck twice, told to the server so it stops naming them for this person
 *   forgetNativeLooks sign-out: nothing of the account stays (its bots' stills and the slugs that named them)
 *
 * LAUNCH DARK. With the server's NATIVE_LOOKS off the bootstrap has no flag, and this file does nothing at all: no fetch, no write.
 * Every bridge call goes through bridge.ts, which makes a call only when the binary declares the feature behind it, so a binary
 * built before these existed is never asked for a function it lacks. A catalog that fails any check keeps the LAST GOOD one.
 */
import { PixelRatio } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { callEndpoint } from "../sdui/client";
import { binaryFeatures, hasBinaryFeature } from "../device/binary";
import { featureCaps } from "../device/binaryCore";
import { getBaseUrl } from "../storage";
import { bool, obj } from "../sdui/knobs";
import {
  DRAWS_FORMAT, artIndexValue, artVerdict, buildIndex, cleanNativeLooks, copyIsCurrent, fontIndexValue, fontKind, fontVerdict, looksUrl,
  planArt, planFonts, readLooksFlag, slugsOfGlance, stillFits, stillSpecs, toHex, utf8Bytes, writePayload,
  type CleanedCatalog, type NLookIndex, type StillSpec,
} from "./looksCore";
import { botsCatalogVersion, renderStill } from "./botArt";
import {
  clearNativeLooksBadIds, nativeLooksBadIds, nativeLooksVersion, platform, setNativeLooks, writeNativeArt, writeNativeFont,
} from "./bridge";
import { NLOOK_LIMITS } from "./looksTable";

const HELD_KEY = "x0.native.held.v1";
const CATALOG_KEY = "x0.native.catalog.v1";
const ART_KEY = "x0.native.art.v1";
const FONT_KEY = "x0.native.fonts.v1";
const SLUGS_KEY = "x0.native.slugs.v1";
const BAD_KEY = "x0.native.badReported.v1";

/** What the last good write was: its catalog version and the format it was cleaned at (the copy is keyed on both). */
interface Held { v: number; drawsFormat: number; at: number }
/** One file in the art channel, as the index names it. `kind: "still"` is a bot drawn on this phone, with the colour it was drawn in. */
interface ArtEntry { file: string; sha: string; bytes: number; kind: "catalog" | "still"; color?: string; lv?: number; at: number }
type ArtMemo = Record<string, ArtEntry>;
interface FontEntry { file: string; sha: string; ext: "ttf" | "otf"; at: number }
type FontMemo = Record<string, FontEntry>;

/** How long a file this phone put in the art channel is trusted without being fetched again (the natives may sweep old ones). */
const TRUST_MS = 14 * 24 * 3_600_000;
const FILE_TIMEOUT_MS = 10_000;
const CATALOG_TIMEOUT_MS = 12_000;
/** Stills drawn in one pass, so a first sync with many bots does not hold a background wake. */
const STILLS_PER_PASS = 8;

export type SyncResult = "off" | "same" | "written" | "failed";

let inFlight: Promise<SyncResult> | null = null;
let stillsInFlight: Promise<void> | null = null;
const lastTry = new Map<number, number>();
const listeners = new Set<() => void>();
/** Bumped at sign-out so work begun before it never writes the old account back. */
let epoch = 0;

/** Told when a new catalog or a new still has been written, so the glance can name `nl` and the widgets redraw. */
export function onNativeLooksChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const changed = (): void => { for (const fn of listeners) { try { fn(); } catch { /* a listener's fault is its own */ } } };

/** Whether this binary can draw server looks at all, and the server has not been told by a knob to leave them. */
function enabled(): boolean {
  return platform() !== null && hasBinaryFeature("nativeLook") && bool("native.looks.enabled", true);
}

/** The highest design format the binary draws: 0 for a binary that says no. */
export const drawsFormat = (): number => (hasBinaryFeature("nativeLook") ? DRAWS_FORMAT : 0);

// ------------------------------------------------------------------ what is kept

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
const writeJson = (key: string, value: unknown): Promise<void> => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});

/** The catalog version this phone REALLY holds. iOS can read its own pointer, and it wins when it disagrees (a write that failed halfway). */
export async function heldLooksVersion(): Promise<number> {
  if (!enabled()) return 0;
  const held = await readJson<Held>(HELD_KEY);
  if (!held || !(held.v > 0)) return 0;
  const bridge = nativeLooksVersion();
  return bridge !== null && bridge !== held.v ? bridge : held.v;
}

// ------------------------------------------------------------------ the network

function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  return { signal: abort.signal, done: () => clearTimeout(timer) };
}

const screenScale = (): number => {
  const s = PixelRatio.get();
  return Number.isFinite(s) && s > 0 ? s : 2;
};

/** The catalog, or null. A public read on the API's own origin: no auth header, no id, nothing of the person. */
async function fetchCatalog(url: string): Promise<unknown | null> {
  const t = timeoutSignal(CATALOG_TIMEOUT_MS);
  try {
    const base = (await getBaseUrl()).replace(/\/$/, "");
    const caps = featureCaps(binaryFeatures());
    const plat = platform();
    if (!plat) return null;
    const res = await fetch(base + looksUrl(url, plat, caps), { headers: { accept: "application/json" }, signal: t.signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (utf8Bytes(text) > NLOOK_LIMITS.catalogBytes + 64 * 1024) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/** One file from our own art host, by content hash, to the cache. Its bytes, or null. */
async function download(path: string, name: string, maxBytes: number, deadline?: number): Promise<{ file: File; bytes: Uint8Array } | null> {
  const tmp = new File(Paths.cache, name);
  const left = deadline === undefined ? FILE_TIMEOUT_MS : Math.min(FILE_TIMEOUT_MS, deadline - Date.now());
  if (left <= 0) return null;
  const t = timeoutSignal(left);
  try {
    if (tmp.exists) tmp.delete();
    const base = (await getBaseUrl()).replace(/\/$/, "");
    const got = await File.downloadFileAsync(base + path, tmp, { idempotent: true, signal: t.signal });
    // Judged on the file's size before any of it is read into memory.
    if (!(got.size <= maxBytes)) { discard(got); return null; }
    return { file: got, bytes: await got.bytes() };
  } catch {
    discard(tmp);
    return null;
  } finally {
    t.done();
  }
}

function discard(f: File): void {
  try { if (f.exists) f.delete(); } catch { /* the cache is the system's to clear */ }
}

const digestHex = async (bytes: Uint8Array): Promise<string> => toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as ArrayBuffer));

/** At most `n` of these at a time. */
async function pool<T, R>(items: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

// ------------------------------------------------------------------ art, fonts, stills

/** One catalog picture: downloaded, checked (PNG magic, size, sha256), handed to the bridge to keep by content. The index value, or null. */
async function getArt(job: { key: string; sha: string; scale: number; bytes: number; path: string }, memo: ArtMemo, now: number, deadline?: number): Promise<ArtEntry | null> {
  const have = memo[job.key];
  const held = have && have.kind === "catalog" && have.sha === job.sha ? have : null;
  if (held && now - held.at < TRUST_MS) return held;
  // Past the deadline nothing new is fetched: the art already held keeps drawing, and the rest draws its `alt`.
  if (deadline !== undefined && Date.now() >= deadline) return held;
  const got = await download(job.path, `nl-art-${job.sha.slice(0, 16)}-${job.scale}.png`, Math.min(job.bytes, NLOOK_LIMITS.art.fileBytes), deadline);
  if (!got) return null;
  try {
    if (artVerdict(got.bytes, job.sha, await digestHex(got.bytes)) !== "ok") return null;
    const file = writeNativeArt(job.sha, job.scale, got.file.uri);
    return file ? { file, sha: job.sha, bytes: got.bytes.length, kind: "catalog", at: now } : null;
  } finally {
    discard(got.file);
  }
}

async function getFont(job: { id: string; sha: string; bytes: number; path: string }, memo: FontMemo, now: number, deadline?: number): Promise<FontEntry | null> {
  const have = memo[job.id];
  const held = have && have.sha === job.sha ? have : null;
  if (held && now - held.at < TRUST_MS) return held;
  if (deadline !== undefined && Date.now() >= deadline) return held;
  const tmpName = `nl-font-${job.sha.slice(0, 16)}`;
  const got = await download(job.path, tmpName, Math.min(job.bytes, NLOOK_LIMITS.fonts.fileBytes), deadline);
  if (!got) return null;
  discard(got.file);
  try {
    const kind = fontKind(got.bytes);
    if (!kind || fontVerdict(got.bytes, job.sha, await digestHex(got.bytes)) !== "ok") return null;
    // The bridge reads the extension (iOS wants .ttf or .otf), so the checked bytes are written under the right one.
    const out = new File(Paths.cache, `${tmpName}.${kind}`);
    try {
      if (out.exists) out.delete();
      out.create();
      out.write(got.bytes);
      const file = writeNativeFont(job.sha, kind, out.uri);
      return file ? { file, sha: job.sha, ext: kind, at: now } : null;
    } finally {
      discard(out);
    }
  } catch {
    return null;
  }
}

const colorOf = (colors: Record<string, string | null>, who: string): string => colors[who] ?? "";

/** One still: drawn, written to the cache, handed to the bridge, entered in the memo. False when any step said no. */
async function makeStill(spec: StillSpec, colors: Record<string, string | null>, memo: ArtMemo, now: number, lv: number): Promise<boolean> {
  const png = await renderStill(spec, { color: colors[spec.who] ?? null });
  if (!png) return false;
  const sha = await digestHex(png);
  const scale = Math.max(1, Math.min(3, Math.round(screenScale())));
  // The same picture under another key (the dark and the light of a scheme-less paint) is one file.
  const twin = Object.values(memo).find((e) => e.kind === "still" && e.sha === sha);
  if (twin) { memo[spec.key] = { ...twin, color: colorOf(colors, spec.who), lv, at: now }; return true; }
  const tmp = new File(Paths.cache, `nl-still-${sha.slice(0, 16)}.png`);
  try {
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.write(png);
    const file = writeNativeArt(sha, scale, tmp.uri);
    if (!file) return false;
    memo[spec.key] = { file, sha, bytes: png.length, kind: "still", color: colorOf(colors, spec.who), lv, at: now };
    // The budget is distinct pictures, not keys.
    if (new Set(Object.values(memo).filter((e) => e.kind === "still").map((e) => e.sha)).size > NLOOK_LIMITS.art.stillFiles) {
      delete memo[spec.key];
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    discard(tmp);
  }
}

/** The sha-and-size of what a memo's stills hold. */
const stillHeld = (memo: ArtMemo): { sha: string; bytes: number }[] => Object.values(memo).filter((e) => e.kind === "still");

/** Over the byte budget at this signature (the wanted keys and the bots' catalog version): not drawn again until that changes. */
let overBudget = "";

/**
 * Draw the stills that are missing or out of date, a few per pass. A wanted still is never evicted to make room: one that would pass
 * the byte budget is not kept, and drawing stops. Returns how many were kept.
 */
async function drawStills(specs: readonly StillSpec[], colors: Record<string, string | null>, memo: ArtMemo, now: number, lv: number): Promise<number> {
  const sig = `${lv}|${specs.map((s) => s.key).join(",")}`;
  if (sig === overBudget) return 0;
  let made = 0;
  for (const s of specs) {
    const e = memo[s.key];
    if (e && e.color === colorOf(colors, s.who) && e.lv === lv) continue;
    if (made >= STILLS_PER_PASS) break;
    if (!(await makeStill(s, colors, memo, now, lv))) continue;
    const mine = memo[s.key]!;
    const others = stillHeld(Object.fromEntries(Object.entries(memo).filter(([k]) => k !== s.key)));
    if (!stillFits(others, mine, NLOOK_LIMITS.art.stillBytes)) {
      delete memo[s.key];
      overBudget = sig;
      break;
    }
    made++;
  }
  return made;
}

// ------------------------------------------------------------------ writing the index

/**
 * Write the catalog with the art and fonts held now. `art` is limited to what the catalog's designs name plus the stills that are
 * wanted, so the index never lists a file nothing draws. One call, one new version folder; "" means nothing was written.
 */
async function writeCatalog(c: CleanedCatalog, artMemo: ArtMemo, fontMemo: FontMemo, wanted: ReadonlySet<string>): Promise<boolean> {
  const art: Record<string, string> = {};
  for (const [key, e] of Object.entries(artMemo)) {
    if (e.kind === "still" ? wanted.has(key) : c.art.some((a) => a.key === key)) art[key] = e.file;
  }
  const fonts: Record<string, string> = {};
  for (const [id, e] of Object.entries(fontMemo)) if (c.fonts.some((f) => f.id === id)) fonts[id] = e.file;
  const { index, designs } = buildIndex(c, { art, fonts });
  const payload = writePayload(index as NLookIndex, designs);
  if (!payload) return false;
  return setNativeLooks(payload) !== "";
}

// ------------------------------------------------------------------ the catalog

/** The bots the last glance showed, with their colours, so a catalog that arrives later knows whose stills to draw. */
async function lastBots(): Promise<Record<string, string | null>> {
  return (await readJson<Record<string, string | null>>(SLUGS_KEY)) ?? {};
}

/**
 * The bootstrap's flag "native.looks" ({ v, url }): fetch and write the catalog when this phone's copy is not that version at this
 * drawsFormat. One at a time; never throws; the last good copy keeps drawing whenever anything fails.
 */
export function syncNativeLooks(flagRaw?: unknown, opts: { deadline?: number; stills?: boolean } = {}): Promise<SyncResult> {
  if (!enabled()) return Promise.resolve("off");
  const flag = readLooksFlag(flagRaw ?? obj("native.looks", {}));
  if (!flag) return Promise.resolve("off");
  if (inFlight) return inFlight;
  const mine = epoch;
  inFlight = (async (): Promise<SyncResult> => {
    try {
      const held = await readJson<Held>(HELD_KEY);
      const bridge = nativeLooksVersion();
      const bridgeAgrees = bridge === null || (held !== null && bridge === held.v);
      if (copyIsCurrent(held, flag, drawsFormat()) && bridgeAgrees) return "same";
      // A catalog that just failed is not asked for again in the same breath.
      if (Date.now() - (lastTry.get(flag.v) ?? 0) < 10 * 60_000) return "failed";
      lastTry.set(flag.v, Date.now());

      if (opts.deadline !== undefined && Date.now() >= opts.deadline) return "failed";
      const doc = await fetchCatalog(flag.url);
      const plat = platform();
      if (!doc || !plat || mine !== epoch) return "failed";
      const c = cleanNativeLooks(doc, { platform: plat, drawsFormat: drawsFormat() });
      if (!c || Object.keys(c.designs).length === 0) return "failed";

      const now = Date.now();
      const artMemo = (await readJson<ArtMemo>(ART_KEY)) ?? {};
      const fontMemo = (await readJson<FontMemo>(FONT_KEY)) ?? {};
      const stills = Object.fromEntries(Object.entries(artMemo).filter(([, e]) => e.kind === "still"));
      const nextArt: ArtMemo = { ...stills };
      // Two keys naming one file are fetched once (they would share a temp file), and both keys get the entry.
      const jobs = planArt(c, screenScale());
      const byFile = new Map<string, typeof jobs>();
      for (const j of jobs) byFile.set(`${j.sha}@${j.scale}`, [...(byFile.get(`${j.sha}@${j.scale}`) ?? []), j]);
      const got = await pool([...byFile.values()], 4, async (group) => ({ group, e: await getArt(group[0]!, artMemo, now, opts.deadline) }));
      for (const { group, e } of got) if (e) for (const j of group) nextArt[j.key] = e;
      const nextFonts: FontMemo = {};
      // Nothing on Android reads the font index (widgets cannot use a file font; the keyboard fetches its own).
      const gotFonts = await pool(plat === "ios" ? planFonts(c) : [], 2, async (job) => ({ job, e: await getFont(job, fontMemo, now, opts.deadline) }));
      for (const { job, e } of gotFonts) if (e) nextFonts[job.id] = e;
      if (mine !== epoch) return "failed";

      // The stills for the bots the last glance showed, so the first draw of a new design already has them.
      const colors = await lastBots();
      const specs = stillSpecs(c.designs, Object.keys(colors), { platform: plat, scale: screenScale(), liveUpdate: hasBinaryFeature("liveUpdate") });
      const wanted = new Set(specs.map((s) => s.key));
      // A still no design wants any more is forgotten here (its file is the natives' to sweep), so the memo never grows without end.
      for (const [key, e] of Object.entries(nextArt)) if (e.kind === "still" && !wanted.has(key)) delete nextArt[key];
      const lv = await botsCatalogVersion();
      // A background wake draws none: the next glance does, and the wake has a clock.
      if (opts.stills !== false) await drawStills(specs, colors, nextArt, now, lv);

      if (mine !== epoch) return "failed";
      if (!(await writeCatalog(c, nextArt, nextFonts, wanted))) return "failed";
      if (mine !== epoch) return "failed";
      await Promise.all([
        writeJson(CATALOG_KEY, c),
        writeJson(ART_KEY, nextArt),
        writeJson(FONT_KEY, nextFonts),
        writeJson(HELD_KEY, { v: c.v, drawsFormat: c.drawsFormat, at: now } satisfies Held),
      ]);
      changed();
      return "written";
    } catch {
      return "failed";
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** A nudge from a push (backgroundTask.ts): the catalog moved to `v`. Asks for it at the address the bootstrap last named, or the plain one. */
export function nudgeNativeLooks(v: number | null, flagRaw?: unknown, opts?: { deadline?: number; stills?: boolean }): Promise<SyncResult> {
  const flag = readLooksFlag(flagRaw ?? obj("native.looks", {}));
  const target = flag ?? (v && v > 0 ? { v, url: `/v1/native/looks?v=${v}` } : null);
  if (!target) return Promise.resolve("off");
  // A nudge names a newer version than the one the bootstrap last said: ask for that one.
  return syncNativeLooks(v && v > target.v ? { v, url: `/v1/native/looks?v=${v}` } : target, opts);
}

/**
 * After a glance: the stills of the bots it shows, drawn only when missing (or when a bot's colour changed). A new still means the
 * index is written again. Bounded and never throws; the widget draws a bundled pose for a still it does not have.
 */
export interface StillGlance {
  bots?: readonly { slug: string; color: string | null }[];
  job?: { bot: string } | null;
  lastDone?: { bot: string } | null;
  needs?: { items: readonly { bot: string }[] };
}

export function syncNativeStills(g: StillGlance): Promise<void> {
  if (!enabled()) return Promise.resolve();
  if (stillsInFlight) return stillsInFlight;
  const mine = epoch;
  stillsInFlight = (async () => {
    try {
      const plat = platform();
      if (!plat) return;
      const c = await readJson<CleanedCatalog>(CATALOG_KEY);
      if (!c || !Object.keys(c.designs).length) return;
      const colors: Record<string, string | null> = {};
      for (const slug of slugsOfGlance(g)) colors[slug] = g.bots?.find((b) => b.slug === slug)?.color ?? null;
      const before = await lastBots();

      const specs = stillSpecs(c.designs, Object.keys(colors), { platform: plat, scale: screenScale(), liveUpdate: hasBinaryFeature("liveUpdate") });
      const wanted = new Set(specs.map((s) => s.key));
      const artMemo = (await readJson<ArtMemo>(ART_KEY)) ?? {};
      const fontMemo = (await readJson<FontMemo>(FONT_KEY)) ?? {};
      const now = Date.now();
      const lv = await botsCatalogVersion();
      let dropped = 0;
      // Only stills no design wants are forgotten; a wanted one is never evicted for room (that loop never ended).
      for (const [key, e] of Object.entries(artMemo)) if (e.kind === "still" && !wanted.has(key)) { delete artMemo[key]; dropped++; }
      const made = await drawStills(specs, colors, artMemo, now, lv);
      if (mine !== epoch) return;
      if (JSON.stringify(before) !== JSON.stringify(colors)) await writeJson(SLUGS_KEY, colors);
      if (made === 0 && dropped === 0) return;
      if (made > 0 && (await writeCatalog(c, artMemo, fontMemo, wanted))) {
        await writeJson(ART_KEY, artMemo);
        changed();
      } else if (made === 0) {
        await writeJson(ART_KEY, artMemo);
      }
    } catch {
      // a still is never worth a failed glance
    } finally {
      stillsInFlight = null;
    }
  })();
  return stillsInFlight;
}

// ------------------------------------------------------------------ what the widgets said back

/** Design ids a widget struck twice: told to the server once each, so it stops naming them for this person. Never throws. */
export async function reportBadLooks(): Promise<void> {
  try {
    if (!enabled()) return;
    const ids = nativeLooksBadIds();
    if (!ids.length) return;
    const told = (await readJson<string[]>(BAD_KEY)) ?? [];
    const fresh = ids.filter((id) => !told.includes(id));
    if (!fresh.length) { clearNativeLooksBadIds(); return; }
    await callEndpoint("POST", "/v1/widgets/looks/bad", { ids: fresh });
    await writeJson(BAD_KEY, [...told, ...fresh].slice(-32));
    clearNativeLooksBadIds();
  } catch {
    // offline or signed out: tried again after the next glance
  }
}

/**
 * SIGN-OUT: nothing of the account stays. The bots' stills are theirs (their colours, their names), so the index is written again
 * without them and the slugs that named them are forgotten. The catalog is no one's: it stays.
 */
export function forgetNativeLooks(): void {
  epoch++;
  void (async () => {
    try {
      await AsyncStorage.multiRemove([SLUGS_KEY, BAD_KEY]).catch(() => {});
      const c = await readJson<CleanedCatalog>(CATALOG_KEY);
      const art = (await readJson<ArtMemo>(ART_KEY)) ?? {};
      const kept = Object.fromEntries(Object.entries(art).filter(([, e]) => e.kind !== "still"));
      if (c && Object.keys(kept).length !== Object.keys(art).length) {
        const fonts = (await readJson<FontMemo>(FONT_KEY)) ?? {};
        if (await writeCatalog(c, kept, fonts, new Set())) await writeJson(ART_KEY, kept);
      }
    } catch {
      // the next sync writes it clean
    }
  })();
}

// What the other files in this package import by name, kept here so the wiring reads from one place.
export { artIndexValue, fontIndexValue };
