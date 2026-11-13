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

export interface HealthDay {
  day: string;
  steps: number;
  workouts: { kind: WorkoutKind; minutes: number }[];
}

export interface HealthPayload {
  enable?: true;
  tz: string;
  days: HealthDay[];
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
    return { day, steps, workouts };
  });
  const payload: HealthPayload = { ...(opts.enable ? { enable: true as const } : {}), tz: tzString(opts.offsetMin), days };
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
  action: { path: string; days?: number; ask?: boolean; enable?: boolean },
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
    const { payload, empty } = buildPayload({ window, stepsByDay: read.stepsByDay, workouts: read.workouts, offsetMin: off, enable });
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
