/**
 * THE RULES BEHIND SENDING A FILE, SPEAKING AND PLAYING A SOUND (media.ts), free of react-native so each is tested
 * on its own (mediaCore.test.ts): what the screen is told while a file goes and a sound plays, how a size and a time
 * are written, which refusals are said in the server's own words, which addresses a sound may come from, and how loud
 * a voice is. media.ts is the only caller.
 */

/** The most a file may be: the upload route's own limit (backend media/types.ts CAP_MAX). */
export const MAX_BYTES = 50 * 1024 * 1024;

/** "820 B", "412 KB", "3.4 MB". */
export function sizeWords(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  const mb = b / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

/** "0:02", "1:05", "12:00". */
export function clock(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How far, 0-100, never past 100 and never NaN. */
export function pctOf(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

export type PickKind = "photo" | "screenshot" | "video" | "file" | "camera";

/** What the screen reads while a file goes (uploadFile's `progressTo`). */
export function progressOf(name: string, kind: PickKind, sent: number, total: number): { name: string; kind: PickKind; pct: number; percent: string; size: string } {
  const pct = pctOf(sent, total);
  return { name, kind, pct, percent: `${pct}%`, size: sizeWords(total) };
}

/** What the screen reads while a sound plays (playAudio's `statePath`). */
export function playStateOf(id: string, at: number, of: number): { id: string; pct: number; at: string; of: string; time: string } {
  const a = clock(at);
  const o = clock(of);
  return { id, pct: pctOf(at, of), at: a, of: o, time: of > 0 ? `${a} / ${o}` : a };
}

/** A file's name as it can go in a multipart part and onto a disk: no folders, no control characters, not hidden. */
export function cleanName(name: unknown, fallback: string): string {
  const base = String(name ?? "").split(/[/\\]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, "").replace(/^[.\s]+/, "").trim().slice(0, 120);
  return clean || fallback;
}

/** A name for what was picked when the picker gave none: "photo.jpg", "recording.mp4". */
export function nameFor(kind: PickKind, given: unknown, uri: string, mime?: string): string {
  const own = cleanName(given, "");
  if (own) return own;
  const ext = (/\.([A-Za-z0-9]{1,5})(?:\?|$)/.exec(uri)?.[1] ?? (mime?.split("/")[1] ?? "")).toLowerCase().replace("jpeg", "jpg").replace("quicktime", "mov");
  const stem = kind === "video" ? "recording" : kind === "screenshot" ? "screenshot" : kind === "file" ? "file" : "photo";
  return ext ? `${stem}.${ext}` : stem;
}

/** "That file is over 50 MB, the most Tailzu takes." */
export function tooBigWords(max: number): string {
  return `That file is over ${Math.round(max / 1024 / 1024)} MB, the most Tailzu takes.`;
}

export interface RefusalWords {
  /** A refusal we have no words for. */
  fallback: string;
  /** Signed out (401, 403). */
  signedOut: string;
  /** Too many at once (429). */
  tooMany: string;
  /** Files are not on for this server (404 media_off). */
  off: string;
}

/**
 * A refused upload in words a person can read. The file routes word what is wrong with a file for a person (too big,
 * a kind not read, password-protected, a reader not on yet): 413, 415, 422, 503 and 504 say what the server said.
 * Anything else (a sign-in, a proxy's page, a developer's message) gets this app's own words.
 */
export function refusalWords(status: number, body: string, w: RefusalWords): string {
  let parsed: { code?: unknown; message?: unknown } = {};
  try { parsed = JSON.parse(body) as typeof parsed; } catch { /* a page, not an answer */ }
  const said = typeof parsed.message === "string" && parsed.message.trim().length > 0 && parsed.message.length <= 240 ? parsed.message.trim() : "";
  if (status === 401 || status === 403) return w.signedOut;
  if (status === 429) return w.tooMany;
  if (status === 404 && parsed.code === "media_off") return w.off;
  if ([413, 415, 422, 503, 504].includes(status) && said) return said;
  return w.fallback;
}

/** Fill "$state.x" in a path or an address, each value made safe for a URL. */
export function fillPath(url: string, get: (path: string) => unknown): string {
  return url.replace(/\$state\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g, (m) => {
    const v = get(m.slice("$state.".length));
    return v == null ? "" : encodeURIComponent(String(v));
  });
}

/**
 * Where a sound may come from: one of this app's server paths ("/v1/…", fetched with the session) or an https
 * address (fetched without it). "//host" is another host, and a path never carries the token anywhere else.
 */
export function soundSource(url: string): { path: string } | { web: string } | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("..")) return { path: url };
  if (/^https:\/\/[^\s/]+\//i.test(url) || /^https:\/\/[^\s/]+$/i.test(url)) return { web: url };
  return null;
}

/** A path only ever names this app's own server. */
export const isApiPath = (path: unknown): path is string => typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("..");

/**
 * How loud a voice is, 0-1 in tenths, from the recorder's metering (dB, about -160 silent to 0 loud). Speech sits
 * between about -50 and -10; below that is the room.
 */
export function levelOf(db: unknown, floor = -50, ceil = -12): number {
  const d = Number(db);
  if (!Number.isFinite(d)) return 0;
  const t = (d - floor) / (ceil - floor);
  return Math.round(Math.min(1, Math.max(0, t)) * 10) / 10;
}

/** The words just said, after what was there (one space between). */
export function joinWords(before: unknown, said: string): string {
  const a = typeof before === "string" ? before.trimEnd() : "";
  const b = said.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/** At most one write per `ms`, except the last one (done), which always goes. */
export function every(ms: number, now: () => number = Date.now): (done?: boolean) => boolean {
  let last = -Infinity;
  return (done = false) => {
    const t = now();
    if (!done && t - last < ms) return false;
    last = t;
    return true;
  };
}
