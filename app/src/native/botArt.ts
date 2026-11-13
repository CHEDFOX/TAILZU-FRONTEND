/**
 * THE DOTTED BOT AS A STILL PICTURE (native/SPEC.md section 2.7). A widget cannot animate and has no network, so the dotted bot a design
 * names (`Bot { who, moment, at, size }`) is a PNG this phone drew itself, from the bots' own catalog, and left in the art channel.
 * Nothing personal is sent anywhere to make it, and each person's own bot colours stay their own.
 *
 *   renderStill   one still, as PNG bytes, or null (then the widget draws a bundled Blip pose, and then nothing)
 *
 * TWO DRAWERS, in this order:
 *   1. `renderStill(spec, at, size, scheme)` from botTiles/scene.ts, when the animation engine has landed it ("expose renderStill ...
 *      for whatever subject the general player draws"): every animation designed there then gets a widget, Activity and key-print
 *      still for free. Looked up at run time, so this file works before it exists.
 *   2. The bots' own tile engine (botTiles/core.ts BotTile), stepped to the moment's time and drawn once.
 *
 * ON A CPU RASTER SURFACE, ALWAYS (`Skia.Surface.Make`), never a GPU or offscreen one: iOS forbids GPU work from a background app, and
 * a catalog sync can run in a silent-push wake. ONLY WHAT IS SHOWN: the caller (looks.ts) asks for the bots in the current glance, at
 * one px per role; the extension downsamples. This file never throws: any failure is a null.
 *
 * Skia, the tile engine and the Skia 2D context are required lazily, so nothing here costs the app a byte until a still is wanted.
 */
import type { StillSpec } from "./looksCore.ts";
import { NLOOK_LIMITS } from "./looksTable.ts";

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

/** What the caller knows about the bot being drawn. */
export interface StillBot {
  /** The bot's own colour (#rrggbb), or null for the engine's palette. */
  color: string | null;
}

/** Frames to settle on a spot before anything else (so he stands), and the frame rate the moment is stepped at. */
const SETTLE_FRAMES = 40;
const FPS = 30;
/** A moment may last a minute; a still never steps more than this many frames to reach its time. */
const MAX_FRAMES = 360;

function lazy<T = any>(load: () => unknown): T | null {
  try {
    return load() as T;
  } catch {
    return null;
  }
}

/** The current bots' catalog: the animation engine's own accessor when it has one, else the build's starter pack. */
async function currentLooks(core: any): Promise<any> {
  const looksMod = lazy<any>(() => require("../botTiles/looks"));
  const live = looksMod?.currentLooks;
  if (typeof live === "function") {
    // Async: in a silent-push wake the kept copy has not loaded yet.
    try { const l = await live(); if (l) return l; } catch { /* the starter pack stands */ }
  }
  const starter = lazy<any>(() => require("../botTiles/starter"));
  try {
    return starter?.STARTER ? core.compileLooks(starter.STARTER) : null;
  } catch {
    return null;
  }
}

/** A seed from a slug, so the same bot always settles the same way. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** PNG bytes from whatever a general drawer hands back (bytes, a data URI or base64). */
function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string" && v.length > 16) {
    try {
      const b64 = v.startsWith("data:") ? v.slice(v.indexOf(",") + 1) : v;
      const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64);
      if (!bin) return null;
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

/** The animation engine's general still, when it is there. */
async function viaScene(spec: StillSpec, bot: StillBot): Promise<Uint8Array | null> {
  const scene = lazy<any>(() => require("../botTiles/scene"));
  const fn = scene?.renderStill;
  if (typeof fn !== "function") return null;
  try {
    // The scene reads the bots' catalog at once: wait for the kept copy first, or a silent-push wake / cold start draws from the starter set.
    await lazy<any>(() => require("../botTiles/looks"))?.currentLooks?.();
    return bytesOf(await fn({ avatar: spec.who, moment: spec.moment, ...(bot.color ? { color: bot.color } : {}) }, spec.at, { w: spec.px, h: spec.px }, spec.scheme));
  } catch {
    return null;
  }
}

/** The bots' own tile engine, stepped to the moment's time and drawn once into a CPU raster. */
async function viaTile(spec: StillSpec, bot: StillBot): Promise<Uint8Array | null> {
  const sk = lazy<any>(() => require("@shopify/react-native-skia"));
  const ctxMod = lazy<any>(() => require("../onboard/skiaCtx"));
  const core = lazy<any>(() => require("../botTiles/core"));
  if (!sk?.Skia || !ctxMod?.SkiaCtx || !core?.BotTile) return null;
  const px = Math.max(8, Math.min(NLOOK_LIMITS.art.longEdgePx, Math.round(spec.px)));
  let surface: any = null;
  try {
    surface = sk.Skia.Surface.Make(px, px);
    if (!surface) return null;
    const kind = core.kindOf(spec.who);
    const looks = await currentLooks(core);
    const avatar = looks?.avatar ? looks.avatar(kind, spec.who) : null;
    const color = bot.color && /^#[0-9a-f]{6}$/i.test(bot.color) ? bot.color : core.PALETTE[seedOf(spec.who) % core.PALETTE.length];
    const tile = new core.BotTile({ kind, color, mood: "idle", seed: seedOf(spec.who), size: px * 0.78, avatar, toys: false });
    tile.cloth = 0;
    tile.resize(px, px, px * 0.92);
    const moment = looks?.moment ? looks.moment(spec.moment) : null;
    for (let i = 0; i < SETTLE_FRAMES; i++) tile.step(1 / FPS);
    if (moment) {
      tile.playMoment(moment, "once");
      const frames = Math.min(MAX_FRAMES, Math.round(Math.max(0, Math.min(1, spec.at)) * moment.dur * FPS));
      for (let i = 0; i < frames; i++) tile.step(1 / FPS);
    }
    // Physics settled, then drawn once: what a person sees is a frame, never a loop.
    tile.still = true;
    const canvas = surface.getCanvas();
    canvas.clear(sk.Skia.Color("transparent"));
    tile.draw(new ctxMod.SkiaCtx(canvas), 1);
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      return image.encodeToBytes(sk.ImageFormat.PNG, 100) ?? null;
    } finally {
      try { image.dispose(); } catch { /* already gone */ }
    }
  } catch {
    return null;
  } finally {
    try { surface?.dispose(); } catch { /* already gone */ }
  }
}

/** The version of the bots' catalog the next still is drawn from (0 when unknown). Waits for the kept copy to load. */
export async function botsCatalogVersion(): Promise<number> {
  try {
    const l = await lazy<any>(() => require("../botTiles/looks"))?.currentLooks?.();
    const v = Number(l?.v);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/** One still as PNG bytes, within the art file cap, or null. Never throws. */
export async function renderStill(spec: StillSpec, bot: StillBot): Promise<Uint8Array | null> {
  try {
    const png = (await viaScene(spec, bot)) ?? (await viaTile(spec, bot));
    if (!png || png.length < 16 || png.length > NLOOK_LIMITS.art.fileBytes) return null;
    return png;
  } catch {
    return null;
  }
}
