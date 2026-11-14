/**
 * WHICH OF THE NEW ABILITIES THIS BINARY HAS (perms/SPEC.md 5.2; build 8.9.1's additions in docs: perms2 9.2). Free of
 * react-native, so the rule is tested on its own (permCaps.test.ts). A name is said only when the native function behind it is
 * really there, so an over-the-air update that reaches an older binary says none of them and the server draws none of the buttons.
 *
 * Build 8.9.1 adds a second test for the same reason, read from the binary itself: `tulmi-perms.abilities()` says whether this
 * BINARY and this OS can do the thing — the usage key is in Info.plist, the OS is new enough, the framework says isSupported, the
 * Android permission is in the merged manifest. So a key cut after the proof build removes its capability with no JavaScript
 * change, and EventKit or CoreMotion is never called in a binary whose missing key would crash it.
 */
import {
  APP_ATTEST_CAPABILITY, ARRIVAL_CAPABILITY, CALENDAR_ADD_CAPABILITY, CALENDAR_READ_CAPABILITY, CONTACT_PICK_CAPABILITY,
  DEVICE_CHECK_CAPABILITY, FOCUS_CAPABILITY, HEALTH_CAPABILITY, HEALTH_SLEEP_CAPABILITY, LOCATION_CAPABILITY,
  MOTION_CAPABILITY, PLAY_INTEGRITY_CAPABILITY, REMINDERS_CAPABILITY,
} from "../sdui/types.ts";

/** What the binary says it can do (`abilities()`), name by name. */
export type Ability =
  | "calendarAdd" | "calendarRead" | "reminders" | "focus" | "motion" | "healthSleep" | "arrival"
  | "appAttest" | "deviceCheck" | "playIntegrity";

/** What was found on this binary. Each is null when the module or package is missing. */
export interface PermsFound {
  perms: {
    pickEmail?: unknown; locationArea?: unknown; calendarEditor?: unknown; calendarBusy?: unknown;
    remindersRead?: unknown; focusState?: unknown; motionDays?: unknown; arrivalArm?: unknown;
    attestKey?: unknown; deviceCheckToken?: unknown; integrityToken?: unknown;
  } | null;
  /** The HealthKit hybrid object (iOS) or the Health Connect module (Android), whichever this platform uses. */
  health: unknown | null;
  /** tulmi-perms.abilities(): what this binary AND this OS can do, read natively (keys present, OS version, isSupported). */
  abilities?: Partial<Record<Ability, boolean>> | null;
}

/** The function behind each 8.9.1 name, and the ability the binary must also confirm. */
const PAIRS: { cap: string; fn: keyof NonNullable<PermsFound["perms"]>; ability: Ability; needsHealth?: boolean }[] = [
  { cap: CALENDAR_ADD_CAPABILITY, fn: "calendarEditor", ability: "calendarAdd" },
  { cap: CALENDAR_READ_CAPABILITY, fn: "calendarBusy", ability: "calendarRead" },
  { cap: REMINDERS_CAPABILITY, fn: "remindersRead", ability: "reminders" },
  { cap: FOCUS_CAPABILITY, fn: "focusState", ability: "focus" },
  { cap: MOTION_CAPABILITY, fn: "motionDays", ability: "motion" },
  { cap: ARRIVAL_CAPABILITY, fn: "arrivalArm", ability: "arrival" },
  { cap: APP_ATTEST_CAPABILITY, fn: "attestKey", ability: "appAttest" },
  { cap: DEVICE_CHECK_CAPABILITY, fn: "deviceCheckToken", ability: "deviceCheck" },
  { cap: PLAY_INTEGRITY_CAPABILITY, fn: "integrityToken", ability: "playIntegrity" },
];

export function permCapsFrom(found: PermsFound): string[] {
  const out: string[] = [];
  if (typeof found.perms?.pickEmail === "function") out.push(CONTACT_PICK_CAPABILITY);
  if (typeof found.perms?.locationArea === "function") out.push(LOCATION_CAPABILITY);
  const health = found.health != null;
  if (health) out.push(HEALTH_CAPABILITY);
  const can = found.abilities ?? null;
  for (const p of PAIRS) {
    if (typeof found.perms?.[p.fn] !== "function") continue;
    if (can?.[p.ability] !== true) continue;
    out.push(p.cap);
  }
  // Sleep is not its own function: it is the health package plus the binary's own usage string (iOS) or the READ_SLEEP
  // permission in the merged manifest (Android), so it needs Health1 as well.
  if (health && can?.healthSleep === true) out.push(HEALTH_SLEEP_CAPABILITY);
  return out;
}

/** Every hybrid object the HealthKit package creates the moment it is imported (its src/modules.ts). */
export const HK_OBJECTS = [
  "CoreModule", "MedicationModule", "WorkoutsModule", "CharacteristicTypeModule", "QuantityTypeModule",
  "CategoryTypeModule", "CorrelationTypeModule", "ElectrocardiogramModule", "HeartbeatSeriesModule", "StateOfMindModule",
] as const;

/**
 * HealthKit, only when this binary has every object the package creates at import. A require that throws outside Metro's own
 * guard is reported as FATAL and never reaches a catch, so `load` must not be called unless they are all registered.
 */
export function healthKitFrom<T>(has: (name: string) => boolean, load: () => unknown): T | null {
  try {
    if (!HK_OBJECTS.every((n) => has(n))) return null;
    const m = load() as { requestAuthorization?: unknown } | null | undefined;
    return typeof m?.requestAuthorization === "function" ? (m as T) : null;
  } catch {
    return null;
  }
}

/**
 * Health Connect, only when its native module is linked. When unlinked, the package still imports (it exports a proxy that
 * throws on use), so a JS export proves nothing: `native` is the native module lookup, and `load` runs only when it is there.
 */
export function healthConnectFrom<T>(native: unknown | null | undefined, load: () => unknown): T | null {
  try {
    if (native == null) return null;
    const m = load() as { getSdkStatus?: unknown } | null | undefined;
    return typeof m?.getSdkStatus === "function" ? (m as T) : null;
  } catch {
    return null;
  }
}

/**
 * The PUSH cap that says this JavaScript answers the pre-ring check (perms2 9.3): sent only when the phone also declared Motion1
 * or Focus1, because without one there is nothing to answer with.
 */
export const CALL_CHECK_CAP = "CallCheck1";

export function callCheckCaps(caps: readonly string[]): string[] {
  return caps.includes(MOTION_CAPABILITY) || caps.includes(FOCUS_CAPABILITY) ? [CALL_CHECK_CAP] : [];
}
