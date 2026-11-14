/**
 * Motion & Fitness (docs: perms2 5). Both phones from 8.9.1: CoreMotion on the iPhone, and on Android — behind
 * TULMI_ANDROID_MOTION — the step counter plus Play services' activity transitions, under one ACTIVITY_RECOGNITION grant.
 *
 * The module is reached through natives.ts and may be missing (an older binary, Expo Go, a build whose
 * NSMotionUsageDescription was cut — calling CoreMotion without it crashes, which is why the capability is read from the binary
 * itself — or an Android build with the switch off). Then everything here says unavailable or null and no screen draws its row.
 * The shared rules are in motionCore.ts; Android's asking and its step ledger are in androidMotionCore.ts, because the native
 * module cannot prompt there and the phone's counter has no history of its own.
 */
import { PermissionsAndroid, Platform } from "react-native";
import { tulmiPerms } from "./natives";
import { motionReady } from "./androidMotionCore";
import { DRIVE_WINDOW_SEC, drivingAnswer, motionRead } from "./motionCore";
import type { HealthReady, WorkoutIn } from "./healthCore";

/** PermissionsAndroid as androidMotionCore asks for it, exactly as locate.ts calls the same two functions for coarse. */
const androidAsk = {
  check: (p: string) => PermissionsAndroid.check(p as never),
  request: (p: string) => PermissionsAndroid.request(p as never) as Promise<string>,
  requestMulti: (ps: string[]) =>
    PermissionsAndroid.requestMultiple(ps as never[]) as Promise<Record<string, string>>,
  api: Number(Platform.Version),
};

/**
 * ANDROID ONLY: whether THIS BINARY really carries the motion half, which is what TULMI_ANDROID_MOTION decides.
 *
 * The functions below are in every 8.9.1 Android binary whatever the switch says — TulmiPermsModule.kt declares them
 * unconditionally and the switch only swaps TulmiMotionDrive for its "unknown" twin — so their presence says nothing. With the
 * switch off, ACTIVITY_RECOGNITION is taken back out of the merged manifest, and asking for a permission a build does not
 * declare comes straight back never_ask_again, which reads as "blocked" and makes a screen offer Settings for a switch that is
 * not there. `abilities()` is read off the manifest and the compiled source set, so it is the one honest test.
 */
export function androidMotionHere(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return tulmiPerms()?.abilities?.()?.motion === true;
  } catch {
    return false;
  }
}

/**
 * checkPermission "motion": never prompts. Synchronous, so on Android it reads the module's `motionStatus` rather than
 * PermissionsAndroid.check (which is async): that answers "granted" correctly, and the one thing it cannot say — "blocked" —
 * only ever comes out of a real request (motionRequest, above).
 */
export function motionGranted(): boolean {
  try {
    return tulmiPerms()?.motionStatus?.() === "granted";
  } catch {
    return false;
  }
}

/**
 * "Wait while I'm driving", on or off (the `motion.watch` action). ANDROID needs this: it can only answer `motionDriving` while
 * it is registered for car transitions, and it must stop keeping even that one line when the switch goes off (perms2 5.2).
 *
 * THE IPHONE HAS NOTHING TO REGISTER: CoreMotion is asked for the last few minutes at question time, so the Motion & Fitness
 * grant is the whole of it and there is no watch to turn on. A phone with no such function is therefore "done" there and
 * "nothing was turned on" on Android, where the registration is the feature.
 */
export async function watchDriving(on: boolean): Promise<boolean> {
  try {
    const m = tulmiPerms();
    if (!m?.motionWatch) return Platform.OS !== "android";
    return (await m.motionWatch(on)) ?? false;
  } catch {
    return false;
  }
}

/**
 * Switching Motion off: the phone's own daily step totals go in the same breath as the server's rows (perms2 5.1, "Switching it
 * off deletes them"). ANDROID keeps those totals because its step counter is a since-boot number with no history; iPhone keeps
 * none, and the native side answers true.
 */
export async function forgetMotion(): Promise<void> {
  try {
    await tulmiPerms()?.motionForget?.();
  } catch {
    /* the ledger holds step counts and nothing else */
  }
}

/** Whether this binary has the motion functions at all (the capability is the server's test; this is the action's). */
export function hasMotion(): boolean {
  try {
    const m = tulmiPerms();
    return typeof m?.motionDays === "function" && typeof m?.motionStatus === "function";
  } catch {
    return false;
  }
}

/** requestPermission "motion": the system prompt, and whether the answer is final (blocked). */
export async function motionRequest(): Promise<{ granted: boolean; blocked: boolean }> {
  try {
    // A build with the switch off has the function and not the permission: there is nothing to ask for, and asking would show
    // Settings for something this binary cannot grant.
    if (Platform.OS === "android" && !androidMotionHere()) return { granted: false, blocked: false };
    // ANDROID: only PermissionsAndroid can show the sheet, and only its never_ask_again means "blocked" (androidMotionCore).
    if (Platform.OS === "android") {
      const r = await motionReady(true, androidAsk);
      return { granted: r === "ready", blocked: r === "blocked" };
    }
    const m = tulmiPerms();
    if (!m?.motionStatus) return { granted: false, blocked: false };
    const s0 = m.motionStatus();
    if (s0 === "granted") return { granted: true, blocked: false };
    if (s0 === "blocked") return { granted: false, blocked: true };
    if (!m.motionAsk) return { granted: false, blocked: false };
    const s = await m.motionAsk();
    return { granted: s === "granted", blocked: s === "blocked" };
  } catch {
    return { granted: false, blocked: false };
  }
}

/** health.sync with source "motion": the same check-and-ask shape Apple Health's reader has. */
export async function prepareMotion(ask: boolean): Promise<HealthReady> {
  const m = tulmiPerms();
  if (!m?.motionDays) return "unavailable";
  // A build with TULMI_ANDROID_MOTION off has motionDays and no ACTIVITY_RECOGNITION: nothing to ask for, nothing to read, and
  // the honest answer is the same one an older binary gives.
  if (Platform.OS === "android" && !androidMotionHere()) return "unavailable";
  // ANDROID ASKS WITH PermissionsAndroid, as locate.ts does; the module's motionAsk cannot show a sheet. Below Android 10 there
  // is no such permission at all and motionReady answers "ready" rather than asking for something that comes back as refused
  // for good. The whole decision — including that ask:false prompts nothing — is androidMotionCore.motionReady.
  if (Platform.OS === "android") return motionReady(ask, androidAsk);
  if (!m.motionStatus) return "unavailable";
  const status = m.motionStatus();
  if (status === "granted") return "ready";
  if (status === "blocked") return "blocked";
  if (!ask || !m.motionAsk) return "denied";
  const after = await m.motionAsk();
  return after === "granted" ? "ready" : after === "blocked" ? "blocked" : "denied";
}

/** health.sync with source "motion": the window's steps and spans, in the same shape Apple Health's reader returns. */
export async function readMotion(
  from: Date,
  to: Date,
  offsetMin: number,
): Promise<{ stepsByDay: Map<string, number>; workouts: WorkoutIn[] }> {
  const m = tulmiPerms();
  if (!m?.motionDays) throw new Error("no motion module");
  const days = await m.motionDays(from.getTime(), to.getTime(), offsetMin);
  // ANDROID HAS NO WORKOUTS, AND THAT IS A DECISION (TulmiMotionSteps.kt, androidMotionCore.ts): there is no queryable motion
  // history there, so `spans` is always empty and a guessed ride on a fitness bot's streak is worse than none. Emptied here
  // rather than trusted, so a future build cannot start inventing them quietly.
  const clean = Platform.OS === "android" ? days.map((d) => ({ ...d, spans: [] })) : days;
  return motionRead(clean);
}

/**
 * The pre-ring driving check (perms2 5.3): is the phone in a car right now? "driving" or "not driving" and nothing else — never
 * where, never a speed, never kept past the call's own record. null when the phone cannot tell, and the server rings as today.
 */
export async function drivingNow(): Promise<boolean | null> {
  try {
    const m = tulmiPerms();
    if (!m?.motionDriving || !motionGranted()) return null;
    return drivingAnswer(await m.motionDriving(DRIVE_WINDOW_SEC));
  } catch {
    return null;
  }
}
