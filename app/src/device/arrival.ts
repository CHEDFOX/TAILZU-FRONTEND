/**
 * Arrival reminders the phone watches itself (docs: perms2 7). The native functions are reached through natives.ts and may be
 * missing (an older binary, Expo Go, or an Android build with TULMI_ANDROID_ARRIVAL off, which carries no geofencing at all):
 * then the action says "unavailable" and the row is not drawn next time.
 *
 * Nothing is read and nothing is sent: the places come from the server, the phone watches them, and no arrival is ever reported
 * to anyone. On the iPhone that is the system's own location notification trigger, so Location While Using is the only grant and
 * Precise Location is required (arrivalCore.ts). On ANDROID a geofence is delivered to the app, so it needs precise location AND
 * "Allow all the time" — two grants, asked in that order, with our card between them (androidArrivalCore.ts). Neither phone ever
 * brings a position into JavaScript.
 */
import { PermissionsAndroid, Platform } from "react-native";
import { tulmiPerms } from "./natives";
import { arrivalSync, type ArrivalDeps, type ArrivalGrant, type ArrivalIn, type ArrivalOutcome } from "./arrivalCore";
import { arrivalBackground, arrivalGrants } from "./androidArrivalCore";
import type { AndroidPerm } from "./androidPermCore";
import { locationRequest, locationStatus } from "./locate";

/** PermissionsAndroid as androidArrivalCore asks for it, exactly as locate.ts calls the same two functions for coarse. */
const androidAsk = {
  check: (p: string) => PermissionsAndroid.check(p as never),
  request: (p: string) => PermissionsAndroid.request(p as never) as Promise<string>,
  requestMulti: (ps: string[]) =>
    PermissionsAndroid.requestMultiple(ps as never[]) as Promise<Record<string, string>>,
  api: Number(Platform.Version),
};

/** The iPhone's one grant: While Using, through locate.ts. Approximate is detected at arm time, not here. */
async function iosGrant(ask: boolean): Promise<ArrivalGrant> {
  const now = await locationStatus();
  if (now === "granted") return "arm";
  if (now === "blocked") return "blocked";
  if (!ask) return "denied";
  const r = await locationRequest();
  return r.granted ? "arm" : r.blocked ? "blocked" : "denied";
}

const deps: ArrivalDeps = {
  // The one test, so the action and the capability gate cannot disagree.
  available: () => hasArrival(),
  // iPhone: While Using + Precise, through locate.ts, as before.
  // ANDROID: precise location asked WITH coarse (Android 12+ ignores a FINE-only request), then "Allow all the time" as its own
  // step. `grant` answers in the words arrival.sync already has, and never prompts unless `ask`.
  grant: (ask: boolean) => (Platform.OS === "android" ? arrivalGrants(ask, androidAsk, hasArrival()) : iosGrant(ask)),
  arm: async (items: ArrivalIn[]) => {
    const m = tulmiPerms();
    if (!m?.arrivalArm) throw new Error("no arrival module");
    return m.arrivalArm(items);
  },
  clear: async () => {
    const m = tulmiPerms();
    if (!m?.arrivalClear) throw new Error("no arrival module");
    await m.arrivalClear();
  },
};

/** The arrival.sync action. Returns the outcome name, and how many the phone is now watching. */
export function runArrivalSync(action: { items?: unknown; ask?: boolean }): Promise<{ outcome: ArrivalOutcome; armed?: number }> {
  return arrivalSync(action, deps);
}

/**
 * FORGET EVERY ARMED PLACE. Called when the account goes — sign-out, a session revoked from elsewhere, an account
 * deleted: once, from client/bootstrap.ts's forgetAccountData, which the SIGNED_OUT branch of useAuthSession.ts runs
 * on every one of those paths.
 *
 * The pending x0.arrive.* requests are the phone's own notifications and they hold the item's TITLE and its PLACE.
 * Left armed they would fire on arrival for an account that no longer exists, or for the next person to sign in on
 * the same phone — which Apple's account-deletion page and TN3194 both say must not happen. Nothing is reported to
 * anyone either way; this only unarms what the phone was watching.
 *
 * Never throws: a binary without the module (Expo Go, a build older than arrival, an Android build with
 * TULMI_ANDROID_ARRIVAL off) has nothing armed to clear, and no sign-out may fail over this. It does wait on the
 * native call, so its caller does not wait on it.
 */
export async function forgetArrival(): Promise<void> {
  try {
    await tulmiPerms()?.arrivalClear?.();
  } catch {
    // nothing kept is worth failing a sign-out for
  }
}

/**
 * requestPermission "backgroundLocation". ANDROID ONLY: on the iPhone the system itself watches the region, so there is nothing
 * of the kind to ask for and the honest answer is "undetermined", which the action reads as unsupported.
 *
 * It is a REQUEST, not openSettings: on API 30+ the system opens the app's own location page and answers when the person comes
 * back, so the screen learns whether they granted it.
 */
export async function arrivalBackgroundRequest(): Promise<AndroidPerm> {
  if (Platform.OS !== "android") return "undetermined";
  return arrivalBackground(androidAsk);
}

/** checkPermission "backgroundLocation". Never prompts. */
export async function arrivalBackgroundGranted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  return (await arrivalGrants(false, androidAsk, hasArrival())) === "arm";
}

/**
 * Whether this binary can really watch for a place, for actions.ts's capability gate and for `deps.available` above.
 *
 * ANDROID NEEDS MORE THAN THE FUNCTIONS. They are in every 8.9.1 binary — TulmiPermsModule.kt declares them whatever the switch
 * says, and the switch only swaps TulmiArrivalGeofences for its "unavailable" twin — while FINE and BACKGROUND location are in
 * the manifest only when TULMI_ANDROID_ARRIVAL is on. With it off, a request for precise location still shows the system sheet
 * (COARSE is declared for "Use my location"), so a stray action would prompt someone for a feature this build does not carry.
 * `abilities().arrival` is read off the manifest AND the compiled source set, so it is the honest test.
 */
export function hasArrival(): boolean {
  try {
    const m = tulmiPerms();
    const fns = typeof m?.arrivalArm === "function" && typeof m?.arrivalClear === "function";
    return fns && (Platform.OS !== "android" || m?.abilities?.()?.arrival === true);
  } catch {
    return false;
  }
}
