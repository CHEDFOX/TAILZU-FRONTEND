/**
 * WHICH OF THE THREE NEW ABILITIES THIS BINARY HAS (perms/SPEC.md 5.2). Free of react-native, so the rule is tested on its own
 * (permCaps.test.ts). A name is said only when the native function behind it is really there, so an over-the-air update that
 * reaches an older binary says none of them and the server draws none of the buttons.
 */
import { CONTACT_PICK_CAPABILITY, HEALTH_CAPABILITY, LOCATION_CAPABILITY } from "../sdui/types.ts";

/** What was found on this binary. Each is null when the module or package is missing. */
export interface PermsFound {
  perms: { pickEmail?: unknown; locationArea?: unknown } | null;
  /** The HealthKit hybrid object (iOS) or the Health Connect module (Android), whichever this platform uses. */
  health: unknown | null;
}

export function permCapsFrom(found: PermsFound): string[] {
  const out: string[] = [];
  if (typeof found.perms?.pickEmail === "function") out.push(CONTACT_PICK_CAPABILITY);
  if (typeof found.perms?.locationArea === "function") out.push(LOCATION_CAPABILITY);
  if (found.health != null) out.push(HEALTH_CAPABILITY);
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
