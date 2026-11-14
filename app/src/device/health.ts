/**
 * Apple Health (iOS) and Health Connect (Android) for a fitness bot (perms/SPEC.md 4). Both packages are reached ONLY through
 * natives.ts, never by a top-level import (the HealthKit package creates its hybrid object the moment it is imported), and both
 * may be missing: an older binary, Expo Go, or an Android build with the health switch off. Then every call says "unavailable".
 *
 * Reads two things, read only: daily step totals and workouts (kind, minutes). Nothing is written to Health, and no background
 * delivery is set up: this file never calls configureBackgroundTypes, enableBackgroundDelivery or subscribeToChanges
 * (permsScan.test.ts scans for them). The rules and tables are in healthCore.ts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { healthConnect, healthKit } from "./natives";
import {
  HC_REFUSALS_BLOCKED, dayKey, durationMinutes, healthSync, kindFromHC, kindFromHK,
  sleepByDayFrom, sleepSpansFromHC, sleepSpansFromHK,
  type HealthDeps, type HealthOutcome, type HealthPayload, type HealthReady, type WorkoutIn,
} from "./healthCore";
import { androidMotionHere, forgetMotion, prepareMotion, readMotion } from "./motion";

const STEPS_HK = "HKQuantityTypeIdentifierStepCount";
const WORKOUT_HK = "HKWorkoutTypeIdentifier";
const SLEEP_HK = "HKCategoryTypeIdentifierSleepAnalysis";
const HC_TYPES = ["Steps", "ExerciseSession"] as const;
/** Sleep is asked for on its own (perms2 6.1), so the steps sheet is never shown again for it. */
const HC_SLEEP = "SleepSession";
const HC_DENIED_KEY = "perm.healthConnect.refusals";

const lastAt = new Map<string, number>();

// ----------------------------------------------------------------------------------------------------------------- iOS
async function prepareIos(ask: boolean): Promise<HealthReady> {
  const hk = healthKit("ios");
  if (!hk) return "unavailable";
  if (hk.isHealthDataAvailable && !hk.isHealthDataAvailable()) return "unavailable";
  // HealthKit never says whether a READ was allowed (a refusal looks like no data), so there is nothing to check without
  // asking. The sheet shows once per type; after that this resolves at once.
  if (ask) { await hk.requestAuthorization({ toRead: [STEPS_HK, WORKOUT_HK], toShare: [] }); return "ready"; }
  // Never asked on this phone (new phone, reinstall): say denied so the screen runs the card and the prompt, not "no data".
  try {
    const status = await hk.getRequestStatusForAuthorization?.({ toRead: [STEPS_HK, WORKOUT_HK] });
    if (status === 1) return "denied";
  } catch { /* can't tell: treat as asked */ }
  return "ready";
}

async function readIos(from: Date, to: Date, offsetMin: number) {
  const hk = healthKit("ios");
  if (!hk) throw new Error("no healthkit");
  const filter = { date: { startDate: from, endDate: to } };
  const rows = await hk.queryStatisticsCollectionForQuantity(STEPS_HK, ["cumulativeSum"], from, { day: 1 }, { filter });
  const stepsByDay = new Map<string, number>();
  for (const r of rows) {
    if (!r.startDate) continue;
    // Each bucket starts at the phone's local midnight, so its local day is the day it starts on.
    const day = dayKey(r.startDate, offsetMin);
    stepsByDay.set(day, (stepsByDay.get(day) ?? 0) + Number(r.sumQuantity?.quantity ?? 0));
  }
  const ws = await hk.queryWorkoutSamples({ filter, limit: -1, ascending: true });
  const workouts: WorkoutIn[] = ws.map((w) => ({
    day: dayKey(w.startDate, offsetMin), kind: kindFromHK(w.workoutActivityType), minutes: durationMinutes(w.duration),
  }));
  return { stepsByDay, workouts };
}

/** Sleep on the iPhone: its own authorization request, so a refusal leaves the steps grant alone. */
async function prepareSleepIos(ask: boolean): Promise<HealthReady> {
  const hk = healthKit("ios");
  if (!hk?.queryCategorySamples) return "unavailable";
  if (hk.isHealthDataAvailable && !hk.isHealthDataAvailable()) return "unavailable";
  if (ask) { await hk.requestAuthorization({ toRead: [SLEEP_HK], toShare: [] }); return "ready"; }
  try {
    const status = await hk.getRequestStatusForAuthorization?.({ toRead: [SLEEP_HK] });
    if (status === 1) return "denied";
  } catch { /* can't tell: treat as asked */ }
  return "ready";
}

/** Minutes asleep per night. The samples' values and spans only: no stage is sent, and in-bed and awake are not sleep. */
async function readSleepIos(from: Date, to: Date, offsetMin: number): Promise<Map<string, number>> {
  const hk = healthKit("ios");
  if (!hk?.queryCategorySamples) throw new Error("no sleep in this binary");
  const samples = await hk.queryCategorySamples(SLEEP_HK, { filter: { date: { startDate: from, endDate: to } }, limit: -1 });
  // Overlapping sources (a Watch and the phone) are merged before summing, so one night is counted once.
  return sleepByDayFrom(sleepSpansFromHK(samples), offsetMin);
}

// ------------------------------------------------------------------------------------------------------------- Android
async function refusals(): Promise<number> {
  try { return Number(await AsyncStorage.getItem(HC_DENIED_KEY)) || 0; } catch { return 0; }
}
async function setRefusals(n: number): Promise<void> {
  try { await AsyncStorage.setItem(HC_DENIED_KEY, String(n)); } catch { /* a counter lost is only a second ask */ }
}

const hcHas = (granted: { accessType: string; recordType: string }[], t: string) =>
  granted.some((g) => g.accessType === "read" && g.recordType === t);

async function prepareAndroid(ask: boolean): Promise<HealthReady> {
  const hc = healthConnect("android");
  if (!hc) return "unavailable";
  // 1 = not on this phone, 2 = it needs an update, 3 = ready. The screen offers Get Health Connect for both of the first two.
  if ((await hc.getSdkStatus()) !== 3) return "unavailable";
  if (!(await hc.initialize())) return "unavailable";
  let granted = await hc.getGrantedPermissions();
  if (HC_TYPES.some((t) => hcHas(granted, t))) { await setRefusals(0); return "ready"; }
  if (!ask) return "denied";
  // The system stops showing the sheet after two refusals, and says nothing: take two as final.
  if ((await refusals()) >= HC_REFUSALS_BLOCKED) return "blocked";
  granted = await hc.requestPermission(HC_TYPES.map((recordType) => ({ accessType: "read" as const, recordType })));
  if (HC_TYPES.some((t) => hcHas(granted, t))) { await setRefusals(0); return "ready"; }
  const n = (await refusals()) + 1;
  await setRefusals(n);
  return n >= HC_REFUSALS_BLOCKED ? "blocked" : "denied";
}

async function readAndroid(from: Date, to: Date, offsetMin: number) {
  const hc = healthConnect("android");
  if (!hc) throw new Error("no health connect");
  const granted = await hc.getGrantedPermissions();
  const timeRangeFilter = { operator: "between" as const, startTime: from.toISOString(), endTime: to.toISOString() };
  const stepsByDay = new Map<string, number>();
  if (hcHas(granted, "Steps")) {
    // Health Connect sums by day and drops the same steps reported by two apps; the days are the phone's local days.
    const rows = await hc.aggregateGroupByPeriod({ recordType: "Steps", timeRangeFilter, timeRangeSlicer: { period: "DAYS", length: 1 } });
    for (const r of rows) {
      const m = /^\d{4}-\d{2}-\d{2}/.exec(String(r.startTime));
      if (!m) continue;
      stepsByDay.set(m[0], (stepsByDay.get(m[0]) ?? 0) + Number(r.result?.COUNT_TOTAL ?? 0));
    }
  }
  const workouts: WorkoutIn[] = [];
  if (hcHas(granted, "ExerciseSession")) {
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await hc.readRecords("ExerciseSession", { timeRangeFilter, pageSize: 200, ...(pageToken ? { pageToken } : {}) });
      for (const r of res.records) {
        const ms = new Date(r.endTime).getTime() - new Date(r.startTime).getTime();
        workouts.push({ day: dayKey(r.startTime, offsetMin), kind: kindFromHC(r.exerciseType), minutes: Math.round(ms / 60_000) });
      }
      pageToken = res.pageToken;
      if (!pageToken) break;
    }
  }
  return { stepsByDay, workouts };
}

/** Sleep on Android: Health Connect's SleepSession, asked for on its own. Linked only when the build carries READ_SLEEP. */
async function prepareSleepAndroid(ask: boolean): Promise<HealthReady> {
  const hc = healthConnect("android");
  if (!hc) return "unavailable";
  if ((await hc.getSdkStatus()) !== 3) return "unavailable";
  if (!(await hc.initialize())) return "unavailable";
  let granted = await hc.getGrantedPermissions();
  if (hcHas(granted, HC_SLEEP)) return "ready";
  if (!ask) return "denied";
  granted = await hc.requestPermission([{ accessType: "read" as const, recordType: HC_SLEEP }]);
  return hcHas(granted, HC_SLEEP) ? "ready" : "denied";
}

async function readSleepAndroid(from: Date, to: Date, offsetMin: number): Promise<Map<string, number>> {
  const hc = healthConnect("android");
  if (!hc) throw new Error("no health connect");
  if (!hcHas(await hc.getGrantedPermissions(), HC_SLEEP)) return new Map();
  const timeRangeFilter = { operator: "between" as const, startTime: from.toISOString(), endTime: to.toISOString() };
  const spans: { start: number; end: number }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await hc.readRecords(HC_SLEEP, { timeRangeFilter, pageSize: 200, ...(pageToken ? { pageToken } : {}) });
    // A session's awake stretches come off it; nothing about a stage leaves this function.
    spans.push(...sleepSpansFromHC(res.records));
    pageToken = res.pageToken;
    if (!pageToken) break;
  }
  return sleepByDayFrom(spans, offsetMin);
}

// ------------------------------------------------------------------------------------------------------------- the action
/**
 * The health.sync action. `post` sends the payload to the server (callEndpoint in actions.ts); `everyMs` is the knob
 * health.syncEveryMs. Returns the outcome name only: no health value comes back.
 */
export async function runHealthSync(
  action: { path: string; days?: number; ask?: boolean; enable?: boolean; source?: "health" | "motion"; sleep?: boolean },
  post: (path: string, body: HealthPayload) => Promise<unknown>,
  everyMs: number,
): Promise<{ outcome: HealthOutcome }> {
  const ios = Platform.OS === "ios";
  // THE SAME SUMMARY, A DIFFERENT SOURCE (perms2 5.1). With source "motion" the phone's own step counter stands in for Apple
  // Health — one bot has one source at a time, which the server enforces — and Motion & Fitness is the grant that is asked for.
  const motion = action.source === "motion";
  // THE BINARY SAYS WHETHER ANDROID HAS IT, NOT THE PLATFORM. From 8.9.1 Android's own step counter is a source too, but only
  // in a build whose TULMI_ANDROID_MOTION switch put ACTIVITY_RECOGNITION and the sensor code in — and every 8.9.1 binary
  // carries the functions, so only `abilities().motion` (motion.ts's androidMotionHere) can tell. Anywhere else this is simply
  // unavailable, never quietly answered from Health Connect, because the days would then go up labelled as something they
  // are not.
  const noMotionHere = motion && !ios && !androidMotionHere();
  // SWITCHING MOTION OFF DELETES THE PHONE'S OWN DAYS TOO (perms2 5.1, "Switching it off deletes them"). Android keeps a ledger
  // because its step counter is a since-boot total with no history; it goes in the same breath as the server's rows, whatever
  // the sync below then answers. The iPhone keeps none and the native side answers true.
  if (motion && action.enable === false) await forgetMotion();
  const deps: HealthDeps = {
    now: () => new Date(),
    offsetMin: (at) => -at.getTimezoneOffset(),
    prepare: noMotionHere ? async () => "unavailable" : motion ? prepareMotion : ios ? prepareIos : prepareAndroid,
    read: motion ? readMotion : ios ? readIos : readAndroid,
    post,
    // Motion has no sleep of its own: sleep rides on Apple Health or Health Connect only.
    ...(motion ? {} : { prepareSleep: ios ? prepareSleepIos : prepareSleepAndroid, readSleep: ios ? readSleepIos : readSleepAndroid }),
    everyMs,
    lastAt,
  };
  return healthSync(action, deps);
}

/** Opens Health Connect's own settings (the Android "Open Health Connect" line). Nothing else is reachable from here. */
export function openHealthConnectSettings(): boolean {
  try {
    const hc = healthConnect("android");
    if (!hc) return false;
    hc.openHealthConnectSettings();
    return true;
  } catch { return false; /* the caller falls back to the app's settings */ }
}
