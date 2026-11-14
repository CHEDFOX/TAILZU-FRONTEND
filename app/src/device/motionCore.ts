/**
 * MOTION & FITNESS: THE RULES (docs: perms2 5). Pure: no react-native, no native module, so each rule is tested in Node
 * (motionCore.test.ts); motion.ts reads CoreMotion through the module.
 *
 * Two uses, both narrow. (A) STEPS for a fitness bot when Apple Health is not used: the phone's own step counter, plus walks,
 * runs and rides of ten minutes or more, turned into exactly the summary Health sends — a day, a step total and a few
 * {kind, minutes}. Nothing finer than a day, no place, and a car is never sent as a workout. (B) The DRIVING CHECK just before a
 * Plan Ease call: the phone answers "driving" or "not driving" and nothing else, and it is not kept past that call's own record.
 */
import type { WorkoutIn, WorkoutKind } from "./healthCore.ts";

/** A span shorter than this is not a walk, run or ride: it is walking to the kitchen. */
export const MIN_SPAN_MINUTES = 10;

/** How far back the driving check looks (perms2 5.3: an automotive activity in the last three minutes). */
export const DRIVE_WINDOW_SEC = 180;

/** CoreMotion's activity names, as the module reports them, to the closed list of kinds. A car is not here on purpose. */
const SPAN_KIND: Record<string, WorkoutKind> = {
  walking: "walk",
  walk: "walk",
  running: "run",
  run: "run",
  cycling: "cycle",
  cycle: "cycle",
};

/** The kind a span counts as, or null when it is not one we send (automotive, stationary, unknown). */
export function spanKind(name: unknown): WorkoutKind | null {
  if (typeof name !== "string") return null;
  return SPAN_KIND[name.trim().toLowerCase()] ?? null;
}

/** One day as the module reports it: the day's steps and its spans in whole minutes. */
export interface MotionDay {
  day?: unknown;
  steps?: unknown;
  spans?: unknown;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the module read, in the shape healthCore's payload builder takes: step totals by local day, and one workout per span of
 * ten minutes or more. A day the module could not name, a car, a stationary span and anything shorter than ten minutes are
 * dropped rather than guessed at; the payload builder then applies the same bounds as Apple Health's (steps, 8 a day, minutes).
 */
export function motionRead(rows: unknown): { stepsByDay: Map<string, number>; workouts: WorkoutIn[] } {
  const stepsByDay = new Map<string, number>();
  const workouts: WorkoutIn[] = [];
  if (!Array.isArray(rows)) return { stepsByDay, workouts };
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as MotionDay;
    const day = typeof row.day === "string" && DAY.test(row.day) ? row.day : "";
    if (!day) continue;
    const steps = Number(row.steps);
    if (Number.isFinite(steps) && steps > 0) stepsByDay.set(day, (stepsByDay.get(day) ?? 0) + Math.round(steps));
    if (!Array.isArray(row.spans)) continue;
    for (const s of row.spans) {
      if (!s || typeof s !== "object") continue;
      const span = s as { kind?: unknown; minutes?: unknown };
      const kind = spanKind(span.kind);
      if (!kind) continue;
      const minutes = Math.round(Number(span.minutes));
      if (!Number.isFinite(minutes) || minutes < MIN_SPAN_MINUTES) continue;
      workouts.push({ day, kind, minutes });
    }
  }
  return { stepsByDay, workouts };
}

/** The driving answer: true, false, or null when the phone cannot tell (which the server reads as no answer). */
export function drivingAnswer(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
