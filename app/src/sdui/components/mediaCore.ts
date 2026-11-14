/**
 * VIDEO, AUDIO AND THE CAMERA — the part that is not pixels (pure/SPEC.md 2.10, B10's media half).
 *
 * What a source is allowed to be, what the numbers mean, how a clock reads, and how often a scanned code may reach
 * the screen. Pure: no React, no react-native, no expo. Runs under `node --test`.
 */

/** pure/SPEC.md 5.1 and 2.10. */
export const MEDIA_LIMITS = {
  /** Characters of a media URL. */
  urlMax: 2048,
  /** The slowest and fastest a clip may be played. */
  rate: { min: 0.25, max: 4 },
  /** How often play position is written into the store, at most. */
  tickMinMs: 200,
  /** The same code scanned again inside this many ms is one scan, not two. */
  scanRepeatMs: 1500,
  /** Scans handed to the screen per second, at most. */
  scansPerSecond: 5,
  /** Characters of a scanned code we pass on. A QR can hold far more than any screen should take in one go. */
  scanDataMax: 4096,
} as const;

/**
 * A SOURCE THE PLAYER MAY LOAD.
 *
 * https only, like images (pure/SPEC.md 5.1). A clip is fetched by the OS media stack, outside our own client, so a
 * plain http URL would be an unencrypted request made by the app, and a `file://` or `content://` from a server would
 * be the server reading the phone's disk through the player. `null` means the node draws nothing.
 */
export function mediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MEDIA_LIMITS.urlMax) return null;
  if (!/^https:\/\/[^\s/?#]+\//i.test(s)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/**
 * A source the CAMERA just made, on its way back out as an event.
 *
 * This one is a local file, because expo-camera writes the picture to the app's cache and hands back its path. It
 * never comes from a server, so it is checked the other way round: it must be local, and nothing else.
 */
export function capturedUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MEDIA_LIMITS.urlMax) return null;
  return /^(file:\/\/|\/)/.test(s) && !s.includes("..") ? s : null;
}

/** 0 to 1. */
export function clampVolume(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/** Playback speed, inside what the players accept. */
export function clampRate(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MEDIA_LIMITS.rate.max, Math.max(MEDIA_LIMITS.rate.min, n));
}

/** How often the player writes where it is. Never faster than tickMinMs, so a long clip is not a store write per frame. */
export function tickMs(raw: unknown, fallback = 500): number {
  const n = Number(raw);
  const ms = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(MEDIA_LIMITS.tickMinMs, Math.round(ms));
}

/** How far through, 0 to 1. A duration that is not known yet is 0, never NaN (pure/SPEC.md 5.4). */
export function progressOf(currentTime: unknown, duration: unknown): number {
  const t = Number(currentTime), d = Number(duration);
  if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.min(1, Math.max(0, t / d));
}

/** Seconds as a clock: `0:07`, `4:03`, `1:02:30`. Anything unknown is `0:00`. */
export function clock(seconds: unknown): string {
  const n = Number(seconds);
  const s = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(r).padStart(2, "0")}` : `${mm}:${String(r).padStart(2, "0")}`;
}

/** How a clip fills its box. Anything else is `contain`, which never crops. */
export function contentFit(raw: unknown): "contain" | "cover" | "fill" {
  return raw === "cover" || raw === "fill" ? raw : "contain";
}

/** The camera's two modes (pure/SPEC.md 2.10). */
export function cameraMode(raw: unknown): "photo" | "scan" {
  return raw === "scan" ? "scan" : "photo";
}

/** Which way the camera looks. */
export function cameraFacing(raw: unknown): "back" | "front" {
  return raw === "front" ? "front" : "back";
}

/** The kinds of code the scanner is asked for; the closed set expo-camera draws on both platforms. */
export const BARCODE_TYPES = [
  "qr", "ean13", "ean8", "upc_a", "upc_e", "code39", "code93", "code128", "codabar", "itf14", "pdf417", "aztec", "datamatrix",
] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

/** The kinds a node asked for, kept to the ones we know. Nothing asked for means QR, which is what a screen means. */
export function barcodeTypes(raw: unknown): BarcodeType[] {
  if (!Array.isArray(raw)) return ["qr"];
  const out = raw.filter((t): t is BarcodeType => typeof t === "string" && (BARCODE_TYPES as readonly string[]).includes(t));
  return out.length ? Array.from(new Set(out)) : ["qr"];
}

/** What a scan hands the screen. */
export interface Scan {
  type: string;
  data: string;
}

/**
 * THE GATE BETWEEN THE SCANNER AND THE SCREEN.
 *
 * A camera in scan mode reads the same code thirty times a second while it is pointed at it. Firing an action thirty
 * times — a navigate, a join, a payment hand-off — is the bug that writes itself, so a code is passed on once, and
 * the same code again only after it has been away for a while. A different code is let through at the rate cap.
 */
export class ScanGate {
  private lastData = "";
  private lastAt = -Infinity;
  private recent: number[] = [];

  /** The scan to hand on, or null when this one is a repeat or over the rate cap. */
  take(type: unknown, data: unknown, now: number): Scan | null {
    const text = typeof data === "string" ? data.slice(0, MEDIA_LIMITS.scanDataMax) : "";
    if (!text) return null;
    if (text === this.lastData && now - this.lastAt < MEDIA_LIMITS.scanRepeatMs) {
      this.lastAt = now;
      return null;
    }
    this.recent = this.recent.filter((t) => now - t < 1000);
    if (this.recent.length >= MEDIA_LIMITS.scansPerSecond) return null;
    this.recent.push(now);
    this.lastData = text;
    this.lastAt = now;
    return { type: typeof type === "string" ? type.slice(0, 32) : "unknown", data: text };
  }

  /** Forget what was scanned, so the same code counts again (the screen came back, the sheet closed). */
  reset(): void {
    this.lastData = "";
    this.lastAt = -Infinity;
    this.recent = [];
  }
}

/** Where a player writes what it is doing. Each is a state path, and a path left out is simply not written. */
export interface MediaInto {
  playing?: string;
  time?: string;
  duration?: string;
  progress?: string;
  ended?: string;
  loading?: string;
}

/** The `into` map a node sent, keeping only the keys we write and only paths that are strings. */
export function mediaInto(raw: unknown): MediaInto {
  const out: MediaInto = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of ["playing", "time", "duration", "progress", "ended", "loading"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** What the player knows now, as the values that go into the store. */
export interface MediaStatus {
  playing: boolean;
  time: number;
  duration: number;
  ended: boolean;
  loading: boolean;
}

/** Only what changed, so an unmoved player writes nothing. `time` moves only past its own step. */
export function statusWrites(into: MediaInto, was: MediaStatus | null, now: MediaStatus, timeStep = 0.25): [string, unknown][] {
  const out: [string, unknown][] = [];
  const moved = !was || Math.abs(now.time - was.time) >= timeStep;
  if (into.playing && (!was || was.playing !== now.playing)) out.push([into.playing, now.playing]);
  if (into.time && moved) out.push([into.time, Math.round(now.time * 1000) / 1000]);
  if (into.duration && (!was || was.duration !== now.duration)) out.push([into.duration, now.duration]);
  if (into.progress && moved) out.push([into.progress, progressOf(now.time, now.duration)]);
  if (into.ended && (!was || was.ended !== now.ended)) out.push([into.ended, now.ended]);
  if (into.loading && (!was || was.loading !== now.loading)) out.push([into.loading, now.loading]);
  return out;
}
