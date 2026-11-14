/**
 * "PLAN AROUND MY CALENDAR" ON ANDROID: THE PERMISSION FLOW (perms2/SPEC.md 2.3, 9.1; Android half,
 * build 8.9.1).
 *
 * Pure: no react-native, no native module, so every rule is tested in Node
 * (androidCalendarCore.test.ts). `src/device/calendar.ts` calls `calendarReady` below in its
 * `Platform.OS === "android"` branch and reads the busy times through the native
 * `calendarBusy(fromMs, toMs, max)`, which on Android is
 * `modules/tulmi-perms/android/.../TulmiCalendarRead.kt` and answers the SAME shape as the iPhone's
 * EventKit read — `{ s, e, allDay }[]` — so the window, the payload and the sync loop stay in the
 * shared `calendarCore.ts` and nothing here duplicates them.
 *
 * WHAT IS ONLY ANDROID'S, AND IS THEREFORE HERE: the asking. iOS has one module call that both
 * prompts and reports. Android's native half cannot prompt at all (`calendarAsk` answers "granted"
 * or "undetermined", exactly as `locationAsk` always has), and "never ask again" is knowable only
 * from a real request, so the grant has to go through `PermissionsAndroid` — see
 * `androidPermCore.ts` for why that is the only way in rather than a nicety.
 *
 * READ ONLY, AND ONE PERMISSION. `READ_CALENDAR` behind the build switch `TULMI_ANDROID_CALENDAR`;
 * never `WRITE_CALENDAR`. Adding an event is the calendar app's own ACTION_INSERT screen, which
 * needs no permission at all (SPEC 2.2), so nothing in this file is about writing.
 */
import { READ_CALENDAR, answer, held, type AndroidAsk, type AndroidPerm } from "./androidPermCore.ts";

export { READ_CALENDAR };

/** The server's and the Kotlin's caps (SPEC 2.4, 2.5), for the screens' own words. */
export const MAX_BUSY_BLOCKS = 300;
/** The window the card promises: the next two weeks. */
export const BUSY_DAYS = 14;

/** The Android permission as PermissionsAndroid can report it. */
export type CalPerm = AndroidPerm;

/** What the busy sync answers. The same names the iPhone's does, so one screen handles both. */
export type BusyOutcome = "synced" | "empty" | "denied" | "blocked" | "unavailable" | "error" | "skipped";

/** What `calendarCore.ts`'s `prepare()` answers, which is what `calendarReady` has to produce. */
export type CalendarReady = "ready" | "denied" | "blocked";

/**
 * THE ANDROID PERMISSION FLOW, as a decision rather than as branches inside the action.
 *
 * `status` is what `PermissionsAndroid.check` said (never a prompt). The answer says whether to ask,
 * and what the outcome is when we must not or cannot.
 *
 *  - held already          → read, no prompt.
 *  - blocked               → never ask again; the screen offers Settings. Asking would do nothing.
 *  - not held, `ask` false → "denied", and NO prompt: a page-appear sync must never put a system
 *                            sheet in front of someone who did not tap anything (SPEC 2.3).
 *  - not held, `ask` true  → ask once. never_ask_again reads as blocked, anything else as denied.
 */
export function calendarStep(status: CalPerm, ask: boolean): { ask: boolean; outcome?: BusyOutcome } {
  if (status === "granted") return { ask: false };
  if (status === "blocked") return { ask: false, outcome: "blocked" };
  if (!ask) return { ask: false, outcome: "denied" };
  return { ask: true };
}

/** What the answer to that one ask means. */
export function calendarAsked(after: CalPerm): { granted: boolean; outcome?: BusyOutcome } {
  if (after === "granted") return { granted: true };
  return { granted: false, outcome: after === "blocked" ? "blocked" : "denied" };
}

/**
 * The whole Android half of `calendar.ts`'s `prepare(ask)`: check, ask once if we may, and say
 * which of the three words the action is to use.
 *
 * **`ask: true` really does prompt.** That is the bug this function exists to stop coming back: the
 * native `calendarAsk` cannot prompt, so a path that trusted it would show the card, take the
 * person's Continue, prompt nothing, and tell them X0 Bot cannot see their calendar.
 */
export async function calendarReady(ask: boolean, deps: AndroidAsk): Promise<CalendarReady> {
  const now = await held(READ_CALENDAR, deps);
  const step = calendarStep(now, ask);
  if (!step.ask) {
    if (now === "granted") return "ready";
    return step.outcome === "blocked" ? "blocked" : "denied";
  }
  let after: CalPerm = "denied";
  try {
    after = answer(await deps.request(READ_CALENDAR));
  } catch {
    after = "denied";
  }
  const done = calendarAsked(after);
  return done.granted ? "ready" : done.outcome === "blocked" ? "blocked" : "denied";
}
