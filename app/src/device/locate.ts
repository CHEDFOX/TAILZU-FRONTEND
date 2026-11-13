/**
 * "Use my location" on the phone (perms/SPEC.md 2). The one native entry point is TulmiPerms.locationArea, reached through
 * natives.ts. While using the app only, approximate first; the coordinate never reaches JavaScript. Without the module (an older
 * binary, Expo Go) every call answers "error" or "not granted" and the person types their area, as before.
 */
import { PermissionsAndroid, Platform } from "react-native";
import { tulmiPerms } from "./natives";
import { locateArea, type LocStatus, type LocateDeps, type LocateOutcome } from "./locateCore";

const COARSE = "android.permission.ACCESS_COARSE_LOCATION" as const;

/** Android asks for the approximate permission only; iOS goes through the module. */
async function status(): Promise<LocStatus> {
  if (Platform.OS === "android") {
    return (await PermissionsAndroid.check(COARSE)) ? "granted" : "undetermined";
  }
  return tulmiPerms()?.locationStatus?.() ?? "denied";
}

async function ask(): Promise<LocStatus> {
  if (Platform.OS === "android") {
    const r = await PermissionsAndroid.request(COARSE);
    return r === PermissionsAndroid.RESULTS.GRANTED ? "granted" : r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
  }
  const m = tulmiPerms();
  if (!m?.locationAsk) return "denied";
  return m.locationAsk();
}

const deps: LocateDeps = {
  status,
  ask,
  area: async (timeoutMs) => {
    const m = tulmiPerms();
    if (!m?.locationArea) throw new Error("no location module");
    return m.locationArea(timeoutMs);
  },
};

/** The location.area action. Returns the outcome and, when found, the area's words. */
export function runLocateArea(ask: boolean | undefined): Promise<{ outcome: LocateOutcome; label?: string }> {
  return locateArea({ ask }, deps);
}

/** checkPermission "location": never prompts. */
export async function locationGranted(): Promise<boolean> {
  try { return (await status()) === "granted"; } catch { return false; }
}

/** requestPermission "location": the system prompt, and whether the answer is final (blocked). */
export async function locationRequest(): Promise<{ granted: boolean; blocked: boolean }> {
  try {
    const s0 = await status();
    if (s0 === "granted") return { granted: true, blocked: false };
    if (s0 === "blocked") return { granted: false, blocked: true };
    const s = await ask();
    return { granted: s === "granted", blocked: s === "blocked" };
  } catch {
    return { granted: false, blocked: false };
  }
}
