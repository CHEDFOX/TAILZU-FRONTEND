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

/** The one local module (modules/tulmi-perms): the contact picker and the one-fix, OS-geocoded area. Coordinates never come back. */
export interface TulmiPermsNative {
  /** The system contact picker (no permission). The ONE email tapped, or null when cancelled. */
  pickEmail?: () => Promise<string | null>;
  locationStatus?: () => "granted" | "denied" | "blocked" | "undetermined";
  /** iOS only: requestWhenInUseAuthorization. Resolves with the status after the answer. */
  locationAsk?: () => Promise<"granted" | "denied" | "blocked" | "undetermined">;
  /** One fix, then the OS geocoder. Address parts only, never a coordinate. null when nothing could be named. */
  locationArea?: (timeoutMs: number) => Promise<AreaParts | null>;
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
  readRecords: (type: "ExerciseSession", o: {
    timeRangeFilter: { operator: "between"; startTime: string; endTime: string }; pageSize?: number; pageToken?: string;
  }) => Promise<{ records: { exerciseType: number; startTime: string; endTime: string }[]; pageToken?: string }>;
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
