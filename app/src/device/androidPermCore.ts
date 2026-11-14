/**
 * ASKING FOR AN ANDROID RUNTIME PERMISSION: THE ONE DECISION, WRITTEN ONCE
 * (perms2/SPEC.md 2.3, 5.1, 7.2, 9.1; Android half, build 8.9.1).
 *
 * Pure: no react-native import, so every rule is tested in Node (androidPermCore.test.ts). The
 * caller passes `PermissionsAndroid.check`, `.request`, `.requestMultiple` and `Platform.Version`
 * in, exactly as `src/device/locate.ts` already calls them for coarse location.
 *
 * WHY THIS FILE EXISTS AT ALL. On the iPhone one module function both asks and reports, and a
 * fourth answer ("blocked") comes back with it. Android has neither:
 *
 *  1. **The native side cannot ask.** `TulmiPermsModule`'s `calendarAsk` / `motionAsk` answer
 *     "granted" or "undetermined" and prompt nothing, exactly as `locationAsk` has always done, so
 *     a JavaScript path that only called them could never get a grant: the system sheet would never
 *     appear, and the person would be told "X0 Bot can't see your calendar" without being asked.
 *     **The PermissionsAndroid path is not optional — it is the only way in.**
 *  2. **"Never ask again" is only knowable by asking.** `check()` is a boolean: held or not held. A
 *     refusal that can be asked again and one that cannot look identical to it, and only
 *     `request()`'s `never_ask_again` tells them apart. So "blocked" — the answer that makes a
 *     screen offer Settings instead of a dead button — can only ever come out of a real ask.
 *  3. **A permission that does not exist yet must not be asked for.** `ACTIVITY_RECOGNITION` only
 *     exists from Android 10; on 9 and below `check()` is false and `request()` comes back
 *     `never_ask_again`, which would read as "blocked for good" and offer Settings for a switch
 *     that is not there. `sinceApi` answers "granted" below that level, because the capability is
 *     not permission-gated there at all.
 */

/** What this app can know about an Android runtime permission. */
export type AndroidPerm = "granted" | "denied" | "blocked" | "undetermined";

/** The native names, spelled once. */
export const READ_CALENDAR = "android.permission.READ_CALENDAR";
export const ACTIVITY_RECOGNITION = "android.permission.ACTIVITY_RECOGNITION";
export const ACCESS_FINE_LOCATION = "android.permission.ACCESS_FINE_LOCATION";
export const ACCESS_COARSE_LOCATION = "android.permission.ACCESS_COARSE_LOCATION";
export const ACCESS_BACKGROUND_LOCATION = "android.permission.ACCESS_BACKGROUND_LOCATION";

/** The Android API level ACTIVITY_RECOGNITION became a runtime permission (Android 10). */
export const ACTIVITY_SINCE_API = 29;

/** React Native's PermissionsAndroid, as the four things this app uses of it. */
export interface AndroidAsk {
  /** `PermissionsAndroid.check` — NEVER prompts. */
  check: (perm: string) => Promise<boolean>;
  /** `PermissionsAndroid.request` — THIS is the system sheet. */
  request: (perm: string) => Promise<string>;
  /** `PermissionsAndroid.requestMultiple` — one sheet for a pair that must be asked together. */
  requestMulti?: (perms: string[]) => Promise<Record<string, string>>;
  /** `Platform.Version` on Android: the API level. */
  api?: number;
}

/**
 * What one `request()` answered. `never_ask_again` is the only honest "blocked" on this platform,
 * and anything unrecognised is "denied" — never "granted", because a wrong yes asks the native side
 * for data it does not hold and the read fails in a way the person cannot act on.
 */
export function answer(raw: unknown): AndroidPerm {
  if (raw === "granted") return "granted";
  if (raw === "never_ask_again") return "blocked";
  return "denied";
}

/**
 * Whether it is held, WITHOUT prompting. "granted" or "undetermined" and nothing else: `check()` is
 * a boolean, so a refusal cannot be told from "not asked yet" here (see the note above).
 *
 * `sinceApi` answers "granted" on an Android too old for the permission to exist.
 */
export async function held(perm: string, deps: AndroidAsk, sinceApi?: number): Promise<AndroidPerm> {
  if (sinceApi !== undefined && typeof deps.api === "number" && deps.api < sinceApi) return "granted";
  try {
    return (await deps.check(perm)) ? "granted" : "undetermined";
  } catch {
    return "undetermined";
  }
}

/**
 * Check, then ask once if we may.
 *
 * `ask: false` NEVER prompts — a page-appear sync must not put a system sheet in front of someone
 * who tapped nothing (SPEC 2.3) — and answers "undetermined", which the caller reads as "not now".
 */
export async function hold(
  perm: string,
  ask: boolean,
  deps: AndroidAsk,
  sinceApi?: number,
): Promise<AndroidPerm> {
  const now = await held(perm, deps, sinceApi);
  if (now === "granted" || !ask) return now;
  try {
    return answer(await deps.request(perm));
  } catch {
    return "denied";
  }
}
