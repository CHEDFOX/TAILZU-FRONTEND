/**
 * FITNESS BOT HEALTH: THE RULES (perms/SPEC.md 4). Pure: no react-native, no health package, so each rule is tested in Node
 * (healthCore.test.ts); health.ts reads HealthKit / Health Connect and calls these.
 *
 * Read: daily STEP totals and WORKOUTS (kind, minutes) only. Summed on the phone, by LOCAL day, then POSTed straight to the server.
 * No raw sample, no source, no timestamp finer than a day, no heart rate, sleep, weight or route. No health value reaches `$state`,
 * a log, an analytics event or Sentry (telemetry/scrubCore.ts). Nothing here calls HealthKit's background APIs.
 */

/** The one path health.sync may POST to: this bot's days. A screen bug cannot send health data to, say, /ask (an AI service). */
export const HEALTH_PATH = /^\/v1\/bots\/[a-z0-9]+(?:-[a-z0-9]+)*\/health\/days$/;

export function healthPathOk(path: unknown): path is string {
  return typeof path === "string" && path.length <= 200 && HEALTH_PATH.test(path);
}

export const KINDS = ["run", "walk", "cycle", "strength", "cardio", "swim", "yoga", "sport", "other"] as const;
export type WorkoutKind = (typeof KINDS)[number];

/** The server's bounds (4.5), applied here first so a request is never refused for size. */
export const MAX_DAYS = 31;
export const MAX_STEPS = 200_000;
export const MAX_WORKOUTS_PER_DAY = 8;
export const MAX_MINUTES = 600;
/** A night is at most a whole day of sleep; the server checks the same bound. */
export const MAX_SLEEP_MINUTES = 1440;

export interface HealthDay {
  day: string;
  steps: number;
  workouts: { kind: WorkoutKind; minutes: number }[];
  /** Minutes asleep that night (perms2 6), only when the person turned sleep on for this bot. No stages, no bed or wake time. */
  sleepMinutes?: number;
}

export interface HealthPayload {
  enable?: true;
  tz: string;
  days: HealthDay[];
  /** This request is the sleep one (perms2 6.1): it asked the phone for the sleep type, so the server may keep the nightly
   *  minutes in `days` and turn the bot's sleep switch on. Without it the server drops every `sleepMinutes` it is sent. */
  sleep?: true;
  /** Where the steps came from: Apple Health / Health Connect ("health", the default and not sent) or the iPhone's own step
   *  counter ("motion", perms2 5.1). The server keeps one source per bot. */
  source?: "motion";
}

const table = (kind: WorkoutKind, ids: number[]): [number, WorkoutKind][] => ids.map((i) => [i, kind]);

/** HKWorkoutActivityType (the numbers of the package's WorkoutActivityType enum) to the closed list. Unknown goes to "other". */
const HK_KIND = new Map<number, WorkoutKind>([
  ...table("run", [37, 71]),
  ...table("walk", [52, 24, 70]),
  ...table("cycle", [13, 74]),
  ...table("strength", [20, 50, 59]),
  ...table("cardio", [11, 14, 15, 16, 30, 35, 44, 63, 64, 65, 68, 69, 73, 77, 78]),
  ...table("swim", [46, 53]),
  ...table("yoga", [57, 66, 58, 72, 62, 29]),
  ...table("sport", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 17, 18, 21, 22, 23, 25, 27, 28, 31, 34, 36, 38, 39, 40, 41, 42, 43,
    45, 47, 48, 49, 51, 54, 55, 56, 60, 61, 67, 75, 79]),
]);

/** Health Connect ExerciseType numbers to the closed list. Unknown goes to "other". */
const HC_KIND = new Map<number, WorkoutKind>([
  ...table("run", [56, 57]),
  ...table("walk", [79, 37, 82]),
  ...table("cycle", [8, 9]),
  ...table("strength", [1, 3, 6, 7, 13, 15, 17, 18, 19, 20, 21, 22, 23, 24, 30, 42, 43, 49, 67, 70, 77, 81]),
  ...table("cardio", [10, 12, 16, 25, 26, 36, 40, 41, 53, 54, 68, 69]),
  ...table("swim", [73, 74]),
  ...table("yoga", [33, 48, 71, 83]),
  ...table("sport", [2, 4, 5, 11, 14, 27, 28, 29, 31, 32, 34, 35, 38, 39, 44, 46, 47, 50, 51, 52, 55, 58, 59, 60, 61, 62,
    63, 64, 65, 66, 72, 75, 76, 78, 80]),
]);

export const kindFromHK = (t: unknown): WorkoutKind => (typeof t === "number" && HK_KIND.get(t)) || "other";
export const kindFromHC = (t: unknown): WorkoutKind => (typeof t === "number" && HC_KIND.get(t)) || "other";

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day ("2026-11-12") of an instant, for a zone `offsetMin` minutes east of UTC (+330 for +05:30). */
export function dayKey(at: Date | string | number, offsetMin: number): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + offsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "+05:30" from minutes east of UTC. */
export function tzString(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const a = Math.abs(Math.round(offsetMin));
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** How many days to read: the action's `days`, whole, from 1 to 31 (31 when it says nothing sensible). */
export function windowSize(days: unknown): number {
  const n = typeof days === "number" && Number.isFinite(days) ? Math.floor(days) : MAX_DAYS;
  return Math.max(1, Math.min(MAX_DAYS, n));
}

/** The local days of the window, oldest first, ending today. */
export function windowDays(n: number, now: Date, offsetMin: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(now.getTime() - i * 86_400_000, offsetMin));
  // A day skipped or doubled by a clock change collapses; the list stays in order and unique.
  return out.filter((d, i) => d && out.indexOf(d) === i);
}

/** A duration as the package reports it ({quantity, unit}) in whole minutes. 0 when it cannot be read. */
export function durationMinutes(q: { quantity?: unknown; unit?: unknown } | null | undefined): number {
  const v = Number(q?.quantity);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const u = String(q?.unit ?? "s").toLowerCase();
  const min = u === "min" ? v : u === "hr" || u === "h" ? v * 60 : u === "ms" ? v / 60_000 : v / 60;
  return Math.round(min);
}

export interface WorkoutIn { day: string; kind: WorkoutKind; minutes: number }

// ---------------------------------------------------------------------------------------------------------------------------
// SLEEP (perms2 6): minutes asleep per night, and nothing else. No stages, no bed or wake time, nothing finer than a night.
// ---------------------------------------------------------------------------------------------------------------------------

/** HKCategoryValueSleepAnalysis: 1 asleep (unspecified), 3 core, 4 deep, 5 REM. In bed (0) and awake (2) are not sleep. */
export const HK_ASLEEP = new Set([1, 3, 4, 5]);

/** Health Connect sleep stages that are NOT sleep: awake (1), out of bed (3), awake in bed (7). */
export const HC_AWAKE_STAGES = new Set([1, 3, 7]);

/** One span of sleep, as either platform reports it. */
export interface SleepSpan { start: number; end: number }

/**
 * Overlapping spans merged, so a night recorded by both a Watch and the phone is counted once. Oldest first; spans that touch
 * are joined.
 */
export function mergeSpans(spans: readonly SleepSpan[]): SleepSpan[] {
  const ok = spans
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out: SleepSpan[] = [];
  for (const s of ok) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/**
 * Spans closer together than this are the same night: a short stretch awake does not end one night and start another. Watch
 * data is full of them, and one just before midnight used to cut a night in two and file half of it on the day before.
 */
export const NIGHT_GAP_MS = 3 * 3600_000;

/**
 * Minutes asleep per LOCAL DAY from merged spans. The spans are first grouped into NIGHTS, and a whole night belongs to the day
 * its last span ends on, which is how a person talks about it ("I slept seven hours last night"); each day is held to a whole
 * day of sleep at most. Only the sleeping stretches are counted, so a night's awake gaps are not slept minutes.
 */
export function sleepByDayFrom(spans: readonly SleepSpan[], offsetMin: number): Map<string, number> {
  const out = new Map<string, number>();
  let slept = 0;
  let endedAt = 0;
  let open = false;
  const file = () => {
    if (!open) return;
    open = false;
    const day = dayKey(endedAt, offsetMin);
    const minutes = Math.round(slept / 60_000);
    slept = 0;
    if (!day || minutes <= 0) return;
    out.set(day, Math.min(MAX_SLEEP_MINUTES, (out.get(day) ?? 0) + minutes));
  };
  for (const s of mergeSpans(spans)) {
    if (open && s.start - endedAt >= NIGHT_GAP_MS) file();
    slept += s.end - s.start;
    endedAt = s.end;
    open = true;
  }
  file();
  return out;
}

/** Apple Health's sleep samples (value, start, end) as spans: the asleep values only. */
export function sleepSpansFromHK(
  samples: readonly { value?: unknown; startDate?: unknown; endDate?: unknown }[],
): SleepSpan[] {
  const out: SleepSpan[] = [];
  for (const s of samples) {
    if (!HK_ASLEEP.has(Number(s?.value))) continue;
    const start = new Date(s.startDate as string).getTime();
    const end = new Date(s.endDate as string).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end });
  }
  return out;
}

/**
 * Health Connect's sleep sessions as spans: the session, less its awake stretches. A session with no stages counts whole, which
 * is what Health Connect's own duration says.
 */
export function sleepSpansFromHC(
  records: readonly {
    startTime?: unknown; endTime?: unknown; stages?: readonly { stage?: unknown; startTime?: unknown; endTime?: unknown }[];
  }[],
): SleepSpan[] {
  const out: SleepSpan[] = [];
  for (const r of records) {
    const start = new Date(r?.startTime as string).getTime();
    const end = new Date(r?.endTime as string).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const stages = Array.isArray(r.stages) ? r.stages : [];
    const awake = mergeSpans(
      stages
        .filter((st) => HC_AWAKE_STAGES.has(Number(st?.stage)))
        .map((st) => ({ start: new Date(st.startTime as string).getTime(), end: new Date(st.endTime as string).getTime() })),
    );
    // Awake stretches cut the session into the parts that were really sleep, each ending where the next awake stretch begins.
    let at = start;
    for (const a of awake) {
      const cut = Math.max(start, Math.min(end, a.start));
      if (cut > at) out.push({ start: at, end: cut });
      at = Math.max(at, Math.min(end, a.end));
    }
    if (end > at) out.push({ start: at, end });
  }
  return out;
}

/**
 * The payload from what was read. `stepsByDay` is each local day's step total; `workouts` each workout with its local day. Every
 * day of the window is sent (zeros included), steps whole and within 0..200000, at most 8 workouts a day of 1..600 minutes.
 * Days outside the window are dropped. `empty` is true when there is nothing at all, which HealthKit also reports for a refused
 * read (so the screen says "Nothing yet", never a silent zero streak).
 */
export function buildPayload(opts: {
  window: string[];
  stepsByDay: ReadonlyMap<string, number>;
  workouts: readonly WorkoutIn[];
  offsetMin: number;
  enable?: boolean;
  /** Minutes asleep per local day, only when the person turned sleep on and the read was allowed. */
  sleepByDay?: ReadonlyMap<string, number> | null;
  /** True when this request asked the phone for sleep and may say so: `sleep: true` rides on the payload. */
  sleep?: boolean;
  /** "motion" rides on the payload so the server knows which source these days came from. */
  source?: "health" | "motion";
}): { payload: HealthPayload; empty: boolean } {
  const inWindow = new Set(opts.window);
  const per = new Map<string, HealthDay["workouts"]>();
  for (const w of opts.workouts) {
    if (!inWindow.has(w.day)) continue;
    const minutes = Math.min(MAX_MINUTES, Math.round(w.minutes));
    if (!(minutes >= 1)) continue;
    const list = per.get(w.day) ?? [];
    if (list.length < MAX_WORKOUTS_PER_DAY) list.push({ kind: KINDS.includes(w.kind) ? w.kind : "other", minutes });
    per.set(w.day, list);
  }
  let empty = true;
  const days = opts.window.map((day): HealthDay => {
    const raw = Number(opts.stepsByDay.get(day) ?? 0);
    const steps = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_STEPS, Math.round(raw))) : 0;
    const workouts = per.get(day) ?? [];
    if (steps > 0 || workouts.length) empty = false;
    const out: HealthDay = { day, steps, workouts };
    const slept = opts.sleepByDay ? Number(opts.sleepByDay.get(day)) : NaN;
    if (Number.isFinite(slept) && slept > 0) {
      out.sleepMinutes = Math.max(0, Math.min(MAX_SLEEP_MINUTES, Math.round(slept)));
      empty = false;
    }
    return out;
  });
  const payload: HealthPayload = {
    ...(opts.enable ? { enable: true as const } : {}),
    tz: tzString(opts.offsetMin),
    days,
    // The server keeps a night only when the request says it is the sleep one, and turns the switch on nowhere else.
    ...(opts.sleep ? { sleep: true as const } : {}),
    ...(opts.source === "motion" ? { source: "motion" as const } : {}),
  };
  return { payload, empty };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------------------------------------------------------

export type HealthOutcome = "synced" | "empty" | "denied" | "blocked" | "unavailable" | "error" | "skipped";

/** What one platform's reader says before it reads. */
export type HealthReady = "ready" | "denied" | "blocked" | "unavailable";

/** What the action needs from the phone and the server, injected so it is testable. */
export interface HealthDeps {
  now: () => Date;
  /** Minutes east of UTC for the given instant (the phone's zone, DST included). */
  offsetMin: (at: Date) => number;
  /** Checks, and asks only when `ask`. ask:false never shows a system prompt. */
  prepare: (ask: boolean) => Promise<HealthReady>;
  /** Reads the window's step totals (by local day) and workouts. Aggregates only; never a raw sample. */
  read: (from: Date, to: Date, offsetMin: number) => Promise<{ stepsByDay: Map<string, number>; workouts: WorkoutIn[] }>;
  /** POST the payload to the (already pinned) path. */
  post: (path: string, body: HealthPayload) => Promise<unknown>;
  /**
   * Sleep, asked for in ITS OWN request (perms2 6.1), so the steps-and-workouts grant is not shown again and a refusal of sleep
   * leaves steps working. Missing on a binary that has no sleep string: then `sleep: true` reads steps as usual and sends no
   * nightly minutes.
   */
  prepareSleep?: (ask: boolean) => Promise<HealthReady>;
  /** Minutes asleep per local day, a night counted on the day it ends. */
  readSleep?: (from: Date, to: Date, offsetMin: number) => Promise<Map<string, number>>;
  /** ask:false runs closer together than this many ms apart (per path) are skipped. 0 or less turns it off. */
  everyMs: number;
  lastAt: Map<string, number>;
}

/**
 * The health.sync action. The path is checked FIRST: off the pin, nothing is read. With ask:false this never prompts, never POSTs
 * an empty read (so a revoked permission cannot wipe the days already kept) and is skipped when it ran within `everyMs`. `enable`
 * rides on the first POST even when the answer is empty, so a switch turned on never reads as off.
 */
export async function healthSync(
  action: { path: string; days?: number; ask?: boolean; enable?: boolean; source?: "health" | "motion"; sleep?: boolean },
  deps: HealthDeps,
): Promise<{ outcome: HealthOutcome }> {
  if (!healthPathOk(action.path)) return { outcome: "error" };
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
    const n = windowSize(action.days);
    const window = windowDays(n, now, off);
    // The window starts at local midnight of its first day.
    const first = window[0] ?? dayKey(now, off);
    const [y, m, d] = first.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, d) - off * 60_000);
    const read = await deps.read(from, now, off);
    // SLEEP IS ITS OWN REQUEST. It is asked for separately and read separately, so a refused or missing sleep grant leaves the
    // steps and workouts of this very sync untouched.
    let sleepByDay: Map<string, number> | null = null;
    if (action.sleep === true && deps.prepareSleep && deps.readSleep) {
      try {
        if ((await deps.prepareSleep(ask)) === "ready") sleepByDay = await deps.readSleep(from, now, off);
      } catch { sleepByDay = null; }
    }
    const { payload, empty } = buildPayload({
      window, stepsByDay: read.stepsByDay, workouts: read.workouts, offsetMin: off, enable, sleepByDay,
      // `sleep: true` goes up only when sleep was really asked for AND the read was allowed, because it is what lets the
      // server keep the nights and turn the bot's sleep switch on (perms2 6.1).
      sleep: sleepByDay !== null,
      source: action.source === "motion" ? "motion" : "health",
    });
    if (empty && !enable) return { outcome: "empty" };
    await deps.post(action.path, payload);
    deps.lastAt.set(action.path, t0);
    return { outcome: empty ? "empty" : "synced" };
  } catch {
    return { outcome: "error" };
  }
}

/** Android's Health Connect never says "refused for good"; two refused asks in a row are taken as blocked (the system stops asking). */
export const HC_REFUSALS_BLOCKED = 2;
