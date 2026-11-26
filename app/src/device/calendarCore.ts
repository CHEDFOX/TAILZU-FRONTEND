/**
 * THE PHONE'S CALENDAR: THE RULES (docs: perms2 2). Pure: no react-native, no native module, so each rule is tested in Node
 * (calendarCore.test.ts); calendar.ts calls the module and the server.
 *
 * Two things, and nothing else. (A) *Add to my calendar* opens the phone's OWN event editor, already filled in: no permission,
 * nothing read, and the event is made by the phone's calendar app, not by us. (B) *Plan around my calendar* reads BUSY TIMES —
 * when each event starts and ends, and whether it is all day — for the next two weeks and posts them to one pinned path. The
 * Swift builds that array, so an event's name, place, notes, attendees, URL and calendar name never cross into JavaScript, and
 * nothing of either flow reaches `$state`, a log or an analytics event beyond its outcome name.
 */

/** The one path calendar.sync may POST to. A screen bug cannot send busy times to, say, /ask (an AI service). */
export const BUSY_PATH = "/v1/botsapp/plan/busy";

export const busyPathOk = (p: unknown): p is string => p === BUSY_PATH;

/** The server's bounds (2.5), applied here first so a request is never refused for size. */
export const MAX_BLOCKS = 300;
export const MAX_WINDOW_DAYS = 14;
/** A single block is at most two days long; longer ones are cut to the window like any other. */
export const MAX_BLOCK_MS = 2 * 86_400_000;

export const TITLE_MAX = 200;
export const NOTES_MAX = 1000;
/** The line the editor's notes always carry, so an event made here says where it came from. No link, no token. */
export const MADE_LINE = "Made with X0 Bot";

const DEFAULT_EVENT_MS = 3_600_000;

/** Control characters out, whitespace tidied, cut to `max`. */
function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** What the phone's own editor opens with. Nothing comes back but the outcome. */
export interface EventDraft {
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  notes: string;
}

/**
 * The editor's event from the action. null when there is nothing to open with (no title, or a start the phone cannot read), so
 * the editor is never shown half-filled. An end that is missing or not after the start becomes one hour (a whole day when
 * `allDay`).
 */
export function eventDraft(action: {
  title?: unknown; startsAtIso?: unknown; endsAtIso?: unknown; allDay?: unknown; notes?: unknown;
}): EventDraft | null {
  const title = clean(action.title, TITLE_MAX);
  const startMs = typeof action.startsAtIso === "string" ? Date.parse(action.startsAtIso) : NaN;
  if (!title || !Number.isFinite(startMs)) return null;
  const allDay = action.allDay === true;
  const asked = typeof action.endsAtIso === "string" ? Date.parse(action.endsAtIso) : NaN;
  const endMs = Number.isFinite(asked) && asked > startMs ? asked : startMs + (allDay ? 86_400_000 : DEFAULT_EVENT_MS);
  const own = clean(action.notes, NOTES_MAX - MADE_LINE.length - 1);
  // The server's own notes already end with this line, so adding it again would print it twice in the editor.
  const notes = !own ? MADE_LINE : own.includes(MADE_LINE) ? own : `${own}\n${MADE_LINE}`;
  return { title, startMs, endMs, allDay, notes };
}

export type EditorOutcome = "saved" | "cancel" | "opened" | "unavailable" | "error";

/** What the module said, as an outcome name. Android cannot tell saved from cancelled, so it says "opened". */
export function editorOutcome(v: unknown): EditorOutcome {
  return v === "saved" || v === "cancel" || v === "opened" || v === "unavailable" ? v : "error";
}

/** One busy block: when it starts and ends, and whether it is all day. Nothing else exists in JavaScript. */
export interface BusyBlock { s: number; e: number; allDay: boolean }

export interface BusyPayload {
  enable?: true;
  tz: string;
  /** The window the phone read, in epoch MILLISECONDS — the same unit as each block's `s` and `e`, which is what the server
   *  reads (perms2 2.5). An ISO string here is refused before a single block is stored. */
  from: number;
  to: number;
  blocks: BusyBlock[];
}

/** How many days to read: the action's `days`, whole, 1 to 14 (14 when it says nothing sensible). */
export function windowSize(days: unknown): number {
  const n = typeof days === "number" && Number.isFinite(days) ? Math.floor(days) : MAX_WINDOW_DAYS;
  return Math.max(1, Math.min(MAX_WINDOW_DAYS, n));
}

/** The window: local midnight today, to `days` later. */
export function windowRange(now: Date, offsetMin: number, days: number): { fromMs: number; toMs: number } {
  const shifted = now.getTime() + offsetMin * 60_000;
  const midnight = Math.floor(shifted / 86_400_000) * 86_400_000;
  const fromMs = midnight - offsetMin * 60_000;
  return { fromMs, toMs: fromMs + days * 86_400_000 };
}

/**
 * The blocks to send: whole milliseconds, each inside the window (an event that starts before it or ends after it is cut to the
 * window's edge), each at most two days long, each really a span (e > s), oldest first, at most 300. Anything else the module
 * handed over is dropped rather than guessed at.
 *
 * A longer stretch is SPLIT into back-to-back two-day pieces rather than cut short: a week away is busy all week, and cutting it
 * to its first two days would leave the rest reading as free, so Nudj would plan and call into it.
 */
export function cleanBlocks(raw: unknown, fromMs: number, toMs: number): BusyBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: BusyBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const r = b as { s?: unknown; e?: unknown; allDay?: unknown };
    let s = Math.round(Number(r.s));
    let e = Math.round(Number(r.e));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    s = Math.max(s, fromMs);
    e = Math.min(e, toMs);
    if (e <= s) continue;
    const allDay = r.allDay === true;
    for (let a = s; a < e; a += MAX_BLOCK_MS) out.push({ s: a, e: Math.min(e, a + MAX_BLOCK_MS), allDay });
  }
  out.sort((a, b) => a.s - b.s || a.e - b.e);
  return out.slice(0, MAX_BLOCKS);
}

export function busyPayload(opts: {
  fromMs: number; toMs: number; blocks: BusyBlock[]; tz: string; enable?: boolean;
}): BusyPayload {
  return {
    ...(opts.enable ? { enable: true as const } : {}),
    tz: opts.tz,
    from: Math.round(opts.fromMs),
    to: Math.round(opts.toMs),
    blocks: opts.blocks,
  };
}

export type BusyOutcome = "synced" | "denied" | "blocked" | "unavailable" | "error" | "skipped";

/** What one platform's reader says before it reads. */
export type CalendarReady = "ready" | "denied" | "blocked" | "unavailable";

/** What the action needs from the phone and the server, injected so it is testable. */
export interface BusyDeps {
  now: () => Date;
  /** Minutes east of UTC for the given instant (the phone's zone, DST included). */
  offsetMin: (at: Date) => number;
  /** Checks, and asks only when `ask`. ask:false never shows a system prompt. */
  prepare: (ask: boolean) => Promise<CalendarReady>;
  /** Busy times only, built in Swift. */
  busy: (fromMs: number, toMs: number, max: number) => Promise<unknown>;
  post: (path: string, body: BusyPayload) => Promise<unknown>;
  /** "+05:30" for the phone's zone. */
  tz: (offsetMin: number) => string;
  /** ask:false runs closer together than this many ms apart (per path) are skipped. 0 or less turns it off. */
  everyMs: number;
  lastAt: Map<string, number>;
}

/**
 * The calendar.sync action. The path is checked FIRST: off the pin, nothing is read. With ask:false this never prompts and is
 * skipped when it ran within `everyMs`. `enable` rides on the first POST even when nothing is busy, so a switch turned on never
 * reads as off. An empty window IS an answer (nothing is busy) and is posted, which is how a cleared calendar clears the server's
 * copy; a revoked permission answers "denied" instead and posts nothing.
 */
export async function busySync(
  action: { path: string; days?: number; ask?: boolean; enable?: boolean },
  deps: BusyDeps,
): Promise<{ outcome: BusyOutcome }> {
  if (!busyPathOk(action.path)) return { outcome: "error" };
  const ask = action.ask === true;
  const enable = action.enable === true;
  try {
    const t0 = deps.now().getTime();
    if (!ask && !enable && deps.everyMs > 0) {
      const last = deps.lastAt.get(action.path);
      if (last !== undefined && t0 - last >= 0 && t0 - last < deps.everyMs) return { outcome: "skipped" };
    }
    const ready = await deps.prepare(ask);
    if (ready !== "ready") return { outcome: ready };
    const now = deps.now();
    const off = deps.offsetMin(now);
    const { fromMs, toMs } = windowRange(now, off, windowSize(action.days));
    const blocks = cleanBlocks(await deps.busy(fromMs, toMs, MAX_BLOCKS), fromMs, toMs);
    await deps.post(action.path, busyPayload({ fromMs, toMs, blocks, tz: deps.tz(off), enable }));
    deps.lastAt.set(action.path, t0);
    return { outcome: "synced" };
  } catch {
    return { outcome: "error" };
  }
}
