/**
 * MOTION ON ANDROID: THE PERMISSION FLOW AND THE STEP LEDGER (perms2/SPEC.md 5.1, 5.2, 5.3, 9.1;
 * Android half, build 8.9.1).
 *
 * Pure: no react-native, no native module, so every rule is tested in Node
 * (androidMotionCore.test.ts). `src/device/motion.ts` calls `motionReady` below in its
 * `Platform.OS === "android"` branch, and reads `motionDays(fromMs, toMs, offsetMin)` and
 * `motionDriving(windowSec)` through the module — on Android
 * `modules/tulmi-perms/android/.../TulmiMotionSteps.kt` and `.../TulmiMotionDrive.kt`, which answer
 * the SAME shapes as the iPhone's CoreMotion reads, so the cleaning and the payload stay in the
 * shared `motionCore.ts` and nothing here duplicates them.
 *
 * ONE PERMISSION FOR BOTH HALVES: `ACTIVITY_RECOGNITION` (runtime from Android 10), behind the build
 * switch `TULMI_ANDROID_MOTION`. From Android 10 the system will not even register a step-counter
 * listener without it, so steps and the driving check share the one grant, exactly as they share
 * `NSMotionUsageDescription` on the iPhone. **Below Android 10 the permission does not exist**, and
 * `motionReady` answers "ready" there rather than asking for something that would come back
 * `never_ask_again` and read as refused for good.
 *
 * TWO THINGS ANDROID DOES DIFFERENTLY, AND BOTH ARE DECIDED WHERE THEY HAPPEN:
 *
 *  1. **No workouts. Ever.** The iPhone's walk/run/ride spans come from a queryable motion history.
 *     Android has none: Google Fit is shut down, and Play services' activity recognition reports
 *     transitions live and keeps nothing, so an Android "ride of 10 minutes or more" could only be
 *     guessed from events we happened to be awake for. A made-up workout on a fitness bot's streak
 *     is worse than no workout, so the Kotlin's reader writes `spans` as an empty list and there is
 *     no path that can fill it — the promise is kept at the only producer, not re-checked here.
 *  2. **A day never read is absent, not zero.** `TYPE_STEP_COUNTER` is a total since boot with no
 *     history, so the native side keeps the day ledger below and can only know days X0 Bot read on.
 *     A zero for a day nobody read would say "walked nothing" and quietly break a streak the person
 *     earned, so unknown days are left out of the payload and the server's day stays as it was.
 */
import {
  ACTIVITY_RECOGNITION, ACTIVITY_SINCE_API, answer, held, type AndroidAsk, type AndroidPerm,
} from "./androidPermCore.ts";

export { ACTIVITY_RECOGNITION, ACTIVITY_SINCE_API };

/** How many days of totals the phone's ledger keeps, and the server with it (SPEC 5.1). */
export const MAX_MOTION_DAYS = 31;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The local day of an instant, `offsetMin` minutes east of UTC. The same rule as healthCore's, and
 * the same rule as `TulmiMotionSteps.dayKey` — which has to format with `Locale.ROOT`, because the
 * regex this key is checked against (`motionCore`'s `^\d{4}-\d{2}-\d{2}$`) is ASCII-only and a
 * Bengali or Arabic-digit phone would otherwise send days that are all dropped.
 */
export function dayKey(at: number, offsetMin: number): string {
  if (!Number.isFinite(at) || !Number.isFinite(offsetMin)) return "";
  const d = new Date(at + offsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------------------------
// The step ledger, as an executable specification
// ---------------------------------------------------------------------------------------------

/**
 * THE LEDGER `TulmiMotionSteps.kt` KEEPS, written out here so its rules can be read and tested in
 * the language the rest of this folder is in.
 *
 * The native side owns the real one (it has to: the counter is a sensor, and the totals must survive
 * the app being killed). This is the same arithmetic, with the test that holds it to the awkward
 * cases — a reboot, a day turning over, a gap of days, and the first read ever. **A change to one is
 * a change to both**, every case here has the same numbers as
 * `modules/tulmi-perms/android/src/test/.../TulmiMotionStepsTest.kt`, and the test names each rule
 * so a drift is obvious.
 */
export interface StepLedger {
  /** The local day the running figures belong to, or "" before the first read. */
  day: string;
  /** The counter's value when the current run started. */
  base: number;
  /** Steps counted for `day` before the current run (set by a reboot). */
  acc: number;
  /** The last counter value seen, or -1 before the first read. */
  last: number;
  /** The phone's boot count at the last read, or -1 when it could not be read. */
  boot: number;
  /** Finished days, newest MAX_MOTION_DAYS kept. */
  totals: Readonly<Record<string, number>>;
}

export const EMPTY_LEDGER: StepLedger = { day: "", base: 0, acc: 0, last: -1, boot: -1, totals: {} };

/** Today's running total. */
export function ledgerSteps(l: StepLedger): number {
  return Math.max(0, l.acc + (l.last - l.base));
}

/** The newest MAX_MOTION_DAYS days. ISO day keys sort in date order. */
function prune(totals: Record<string, number>): Record<string, number> {
  const keys = Object.keys(totals).sort();
  if (keys.length <= MAX_MOTION_DAYS) return totals;
  const out: Record<string, number> = {};
  for (const k of keys.slice(-MAX_MOTION_DAYS)) out[k] = totals[k]!;
  return out;
}

/**
 * The ledger after one reading of the since-boot counter, with the phone's boot count.
 *
 *  - FIRST READ EVER: there is no earlier total to work out, so today starts at zero. The steps
 *    taken before X0 Bot first looked are nobody's, and claiming them would be inventing them.
 *  - REBOOT: keep everything counted up to the last read, then take the whole of the new counter as
 *    steps since the reboot. Steps taken while the phone was off are nobody's either. A reboot is
 *    seen two ways — the counter going backwards, and the boot count moving — because the first
 *    misses a reboot followed by more steps than the old reading, and would undercount by all of
 *    them.
 *  - A DAY IS CLOSED AT ITS OWN LAST READ. What the counter did between that read and this one is
 *    unattributable: the gap can be minutes across midnight or four days of walking. Those steps
 *    are dropped. Crediting them to the older day would pin Tuesday and Wednesday onto Monday the
 *    first time someone does not open the app for a week; crediting them to today would make a
 *    streak out of a walk that happened days ago. A count a little low is honest; a fabricated
 *    daily total is not.
 */
export function foldCounter(prev: StepLedger, counter: number, day: string, boot = -1): StepLedger {
  if (!day || !Number.isFinite(counter) || counter < 0) return prev;
  const c = Math.floor(counter);
  if (!prev.day || prev.last < 0) return { day, base: c, acc: 0, last: c, boot, totals: prev.totals };
  // Worked out BEFORE any reboot adjustment, because a reboot happened AFTER that last read.
  const atLast = Math.max(0, prev.acc + Math.max(0, prev.last - prev.base));
  const rebooted = c < prev.last || (boot >= 0 && prev.boot >= 0 && boot !== prev.boot);
  let acc = prev.acc;
  let base = prev.base;
  if (rebooted) {
    acc = atLast;
    base = 0;
  }
  if (day !== prev.day) {
    return {
      day,
      base: c,
      acc: 0,
      last: c,
      boot,
      totals: prune({ ...prev.totals, [prev.day]: atLast }),
    };
  }
  return { day, base, acc, last: c, boot, totals: prev.totals };
}

// ---------------------------------------------------------------------------------------------
// The permission flow
// ---------------------------------------------------------------------------------------------

export type MotionPerm = AndroidPerm;

/** What a motion read answers. The same names the iPhone's does. */
export type MotionOutcome = "synced" | "empty" | "denied" | "blocked" | "unavailable" | "error" | "skipped";

/** What `motion.ts`'s `prepareMotion()` answers, which is what `motionReady` has to produce. */
export type MotionHeld = "ready" | "denied" | "blocked";

/**
 * THE ANDROID PERMISSION FLOW. One grant, one sheet, and the same three-way answer the calendar
 * read has: hold it, offer Settings, or ask once. `ask: false` never prompts, so a page-appear sync
 * cannot put a system sheet in front of someone who tapped nothing.
 */
export function motionStep(status: MotionPerm, ask: boolean): { ask: boolean; outcome?: MotionOutcome } {
  if (status === "granted") return { ask: false };
  if (status === "blocked") return { ask: false, outcome: "blocked" };
  if (!ask) return { ask: false, outcome: "denied" };
  return { ask: true };
}

export function motionAsked(after: MotionPerm): { granted: boolean; outcome?: MotionOutcome } {
  if (after === "granted") return { granted: true };
  return { granted: false, outcome: after === "blocked" ? "blocked" : "denied" };
}

/**
 * The whole Android half of `motion.ts`'s `prepareMotion(ask)` and `motionRequest()`: check, ask
 * once if we may, and say which of the three words the action is to use.
 *
 * **`ask: true` really does prompt**, which the native `motionAsk` cannot do — without this the
 * card's Continue would lead to no sheet and a "can't count your steps" the person never refused.
 * **Below Android 10** there is no such permission, and this answers "ready".
 */
export async function motionReady(ask: boolean, deps: AndroidAsk): Promise<MotionHeld> {
  const now = await held(ACTIVITY_RECOGNITION, deps, ACTIVITY_SINCE_API);
  const step = motionStep(now, ask);
  if (!step.ask) {
    if (now === "granted") return "ready";
    return step.outcome === "blocked" ? "blocked" : "denied";
  }
  let after: MotionPerm = "denied";
  try {
    after = answer(await deps.request(ACTIVITY_RECOGNITION));
  } catch {
    after = "denied";
  }
  const done = motionAsked(after);
  return done.granted ? "ready" : done.outcome === "blocked" ? "blocked" : "denied";
}
