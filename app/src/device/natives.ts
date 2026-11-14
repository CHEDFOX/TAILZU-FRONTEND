// The one gate for native code added AFTER the current store build.
//
// Rule: the runtime label (app.config.ts) is not bumped for additions, so JS
// may only reach a native package or local-module function that older binaries
// might lack through this file, and must handle `null`. Anything already in
// app/native-inputs.lock can be imported normally. natives.test.ts enforces it.
import { requireOptionalNativeModule } from "expo-modules-core";
import { TurboModuleRegistry } from "react-native";
import { NitroModules } from "react-native-nitro-modules";
import { healthConnectFrom, healthKitFrom } from "./permCapsCore";

/** The native module called `name`, or null when this binary does not have it. */
export function optionalNative<T = unknown>(name: string): T | null {
  try {
    return requireOptionalNativeModule<T>(name) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Location, contacts and health (perms/SPEC.md 5.2). Added after the running build, so each is found here or not at all, and
// every caller handles null. Nothing else in src/ may import these packages or name TulmiPerms (natives.test.ts scans for it).
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * The one local module (modules/tulmi-perms): the contact picker, the one-fix OS-geocoded area, and build 8.9.1's calendar,
 * reminders, Focus, motion, arrival and trust functions (docs: perms2 10.2). Coordinates and the phone's position never come
 * back, and every function is optional: this JavaScript also reaches binaries built before it, where the name is simply missing
 * and the capability (permCapsCore.ts) is never said.
 */
export interface TulmiPermsNative {
  /** The system contact picker (no permission). The ONE email tapped, or null when cancelled. */
  pickEmail?: () => Promise<string | null>;
  locationStatus?: () => "granted" | "denied" | "blocked" | "undetermined";
  /** iOS only: requestWhenInUseAuthorization. Resolves with the status after the answer. */
  locationAsk?: () => Promise<"granted" | "denied" | "blocked" | "undetermined">;
  /** One fix, then the OS geocoder. Address parts only, never a coordinate. null when nothing could be named. */
  locationArea?: (timeoutMs: number) => Promise<AreaParts | null>;

  /** What this BINARY and this OS can do: the usage keys that are in Info.plist, the OS version, each `isSupported`. Synchronous. */
  abilities?: () => Partial<Record<PermAbility, boolean>>;

  // --- calendar (perms2 2.6) ---
  /** The phone's own event editor, filled in. iPhone 17+: out of process, no permission. Android: ACTION_INSERT, "opened". */
  calendarEditor?: (e: NativeEventDraft) => Promise<"saved" | "cancel" | "opened" | "unavailable">;
  calendarStatus?: () => PermStatus;
  /** requestFullAccessToEvents (iOS 17+): there is no read-only calendar grant. */
  calendarAsk?: () => Promise<PermStatus>;
  /** BUSY TIMES ONLY, built in Swift: free, declined and cancelled events are skipped and no name, place, note or attendee
   *  crosses into JavaScript. */
  calendarBusy?: (fromMs: number, toMs: number, max: number) => Promise<NativeBusyBlock[]>;

  // --- reminders, the X0 Bot list only (perms2 3.4) ---
  remindersStatus?: () => PermStatus;
  remindersAsk?: () => Promise<PermStatus>;
  /** The X0 Bot list (made on first use): open items plus items completed in the last 7 days. No other list is fetched. */
  remindersRead?: () => Promise<{ listId: string; items: NativeReminderItem[] }>;
  /** Applies the server's reply to that list only. Answers which added items got which identifier. */
  remindersApply?: (ops: NativeReminderOps) => Promise<{ applied: { id: string; ext: string }[] }>;

  // --- Focus (perms2 4.5) ---
  /** iPhone: what X0 Bot's Focus Filter last wrote to the App Group. Android: the interruption filter. null when nothing is known. */
  focusState?: () => NativeFocusState | null;

  // --- motion (perms2 5.4) ---
  motionStatus?: () => PermStatus;
  motionAsk?: () => Promise<PermStatus>;
  /** The same daily summary Health sends: steps a day, and walking/running/cycling spans in whole minutes. Never a place. */
  motionDays?: (fromMs: number, toMs: number, offsetMin: number) => Promise<NativeMotionDay[]>;
  /** Whether the phone is in a car right now (an automotive activity in the last `windowSec`). null when it cannot tell. */
  motionDriving?: (windowSec: number) => Promise<boolean | null>;
  /** Android: registers the car-transition watch, which is how it can answer motionDriving at all. iOS: a no-op answering true. */
  motionWatch?: (on: boolean) => Promise<boolean>;
  /** Android: forgets the phone's daily step totals. iOS: a no-op answering true. See index.ts for why Android keeps them. */
  motionForget?: () => Promise<boolean>;

  // --- arrival reminders the phone itself watches (perms2 7.4) ---
  /** Replaces the x0.arrive.* set. "approximate": Precise is off. Android adds "background" ("Allow all the time" not given
   *  yet, which is not a denial: the way on is the card then Settings) and "unavailable" (no geofencing in this build). */
  arrivalArm?: (items: NativeArrivalItem[]) => Promise<{ armed: number } | "approximate" | "denied" | "background" | "unavailable">;
  arrivalList?: () => Promise<string[]>;
  arrivalClear?: () => Promise<void>;

  // --- abuse and fraud prevention, dark (perms2 8.5). Never a device id made from the phone. ---
  /** App Attest. `account` is an opaque per-account key (a hash of the account id, never the id), used only to file the key id
   *  in the Keychain; the module hashes the challenge as SHA256("x0|attest|" + challenge) itself. */
  attestKey?: (account: string, challenge: string) => Promise<{ keyId: string; attestation: string }>;
  /** That same key signing SHA256("x0|assert|" + challenge). */
  attestAssert?: (account: string, challenge: string) => Promise<{ keyId: string; assertion: string }>;
  /** Forgets this account's key id, so the next attestation starts a fresh key. */
  attestForget?: (account: string) => Promise<void>;
  /** DeviceCheck: one token for the server to query Apple's two bits with. No entitlement, no prompt. */
  deviceCheckToken?: () => Promise<string>;
  /** Play Integrity's warm-up, for the Cloud project number the bootstrap sent (not a secret). */
  integrityPrepare?: (cloudProjectNumber: string) => Promise<boolean>;
  /** Play Integrity's token over hex(SHA256("x0|integrity|" + challenge)), which the caller computes. */
  integrityToken?: (requestHash: string) => Promise<string>;
}

/** What `abilities()` may say (the names of permCapsCore.ts's Ability). */
export type PermAbility =
  | "calendarAdd" | "calendarRead" | "reminders" | "focus" | "motion" | "healthSleep" | "arrival"
  | "appAttest" | "deviceCheck" | "playIntegrity";

export type PermStatus = "granted" | "denied" | "blocked" | "undetermined";

/** The event the phone's own editor opens with. Nothing is read back. */
export interface NativeEventDraft {
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  notes: string;
}

/** One busy block: when it starts and ends, and whether it is all day. Nothing else. */
export interface NativeBusyBlock { s: number; e: number; allDay: boolean }

/** One item of the X0 Bot list: its opaque identifier, title, due date, done, and when it last changed. */
export interface NativeReminderItem {
  ext: string;
  title: string;
  dueIso?: string;
  dueHasTime: boolean;
  done: boolean;
  changedAt: string;
}

export interface NativeReminderOps {
  listId: string;
  add: { id: string; title: string; dueIso?: string; dueHasTime: boolean }[];
  update: { ext: string; title?: string; dueIso?: string; done?: boolean }[];
  remove: string[];
}

/** iPhone: `{ on, hold, at }` from the Focus Filter. Android: `{ on }`. Never which Focus. */
export interface NativeFocusState {
  on: boolean;
  hold?: "calls" | "callsAndPings";
  at?: number;
}

export interface NativeMotionDay {
  day: string;
  steps: number;
  spans: { kind: string; minutes: number }[];
}

export interface NativeArrivalItem {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  title: string;
  body: string;
  screen?: string;
}

/** What the native area function may return: words, never a street, number, postcode or coordinate. */
export interface AreaParts {
  subLocality?: string | null;
  locality?: string | null;
  subAdminArea?: string | null;
  adminArea?: string | null;
  countryCode?: string | null;
}

export function tulmiPerms(): TulmiPermsNative | null {
  return optionalNative<TulmiPermsNative>("TulmiPerms");
}

/** What health.ts uses of each health package. Typed here by hand so no package type is imported (they may be absent). */
export interface HealthKitNative {
  isHealthDataAvailable?: () => boolean;
  /** 1 = the person was never asked (shouldRequest). */
  getRequestStatusForAuthorization?: (req: { toRead?: readonly string[]; toShare?: readonly string[] }) => Promise<number>;
  requestAuthorization: (req: { toRead?: readonly string[]; toShare?: readonly string[] }) => Promise<boolean>;
  queryStatisticsCollectionForQuantity: (
    id: string, stats: readonly string[], anchor: Date, interval: { day?: number },
    options?: { filter?: { date?: { startDate?: Date; endDate?: Date } }; unit?: string },
  ) => Promise<readonly { startDate?: Date; sumQuantity?: { quantity: number } }[]>;
  queryWorkoutSamples: (options: {
    filter?: { date?: { startDate?: Date; endDate?: Date } }; limit: number; ascending?: boolean;
  }) => Promise<readonly { workoutActivityType: number; startDate: Date; duration: { quantity: number; unit: string } }[]>;
  /** Sleep (perms2 6.1): the sleep-analysis category samples. Their VALUE and span only — no source, device or anything else.
   *  Optional: a binary older than the sleep string has no use for it, and the capability is not said. */
  queryCategorySamples?: (
    id: string,
    options?: { filter?: { date?: { startDate?: Date; endDate?: Date } }; limit?: number; ascending?: boolean },
  ) => Promise<readonly { value: number; startDate: Date; endDate: Date }[]>;
}

/** One page of a Health Connect record read. */
export interface HealthConnectRead {
  timeRangeFilter: { operator: "between"; startTime: string; endTime: string };
  pageSize?: number;
  pageToken?: string;
}

export interface HealthConnectNative {
  getSdkStatus: () => Promise<number>;
  initialize: () => Promise<boolean>;
  requestPermission: (p: { accessType: "read"; recordType: string }[]) => Promise<{ accessType: string; recordType: string }[]>;
  getGrantedPermissions: () => Promise<{ accessType: string; recordType: string }[]>;
  aggregateGroupByPeriod: (req: {
    recordType: "Steps"; timeRangeFilter: { operator: "between"; startTime: string; endTime: string };
    timeRangeSlicer: { period: "DAYS"; length: number };
  }) => Promise<{ result: { COUNT_TOTAL?: number }; startTime: string; endTime: string }[]>;
  readRecords(type: "ExerciseSession", o: HealthConnectRead):
    Promise<{ records: { exerciseType: number; startTime: string; endTime: string }[]; pageToken?: string }>;
  /** Sleep (perms2 6.1): each session's span and its stages, so awake stretches can be taken off. Nothing else. */
  readRecords(type: "SleepSession", o: HealthConnectRead):
    Promise<{ records: { startTime: string; endTime: string; stages?: { stage: number; startTime: string; endTime: string }[] }[]; pageToken?: string }>;
  openHealthConnectSettings: () => void;
}

let kit: HealthKitNative | null | undefined;
let connect: HealthConnectNative | null | undefined;

/** HealthKit (iOS only). Importing the package creates its hybrid objects, so it is required here, once, and only when all exist. */
export function healthKit(platform: string): HealthKitNative | null {
  if (platform !== "ios") return null;
  if (kit !== undefined) return kit;
  kit = healthKitFrom<HealthKitNative>(
    (n) => NitroModules.hasHybridObject(n),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require("@kingstinct/react-native-healthkit"),
  );
  return kit;
}

/** Health Connect (Android only). Unlinked (build switch off, older binary): the package imports fine but is a throwing proxy. */
export function healthConnect(platform: string): HealthConnectNative | null {
  if (platform !== "android") return null;
  if (connect !== undefined) return connect;
  let native: unknown = null;
  try { native = TurboModuleRegistry.get("HealthConnect"); } catch { native = null; }
  connect = healthConnectFrom<HealthConnectNative>(
    native,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require("react-native-health-connect"),
  );
  return connect;
}
