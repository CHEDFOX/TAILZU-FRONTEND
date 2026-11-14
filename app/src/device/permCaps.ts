/**
 * The capability names for location, contacts, health and build 8.9.1's own things, read from the natives gate and nothing else
 * (perms/SPEC.md 5.2; docs: perms2 9.2). Said by a JS check of the module's presence, as VoiceLive is, plus the binary's own
 * `abilities()`; binaryFeatures and binaryCore.ts are not touched.
 *
 * Health1 needs the package itself (HealthKit on iOS; Health Connect on Android, linked only when the build's Android health
 * switch is on). Whether Health Connect is INSTALLED on the phone is checked later, by health.sync, because this is synchronous.
 */
import { Platform } from "react-native";
import { healthConnect, healthKit, tulmiPerms } from "./natives";
import { callCheckCaps, permCapsFrom, type Ability } from "./permCapsCore";

/** `abilities()` is synchronous and in older binaries missing; anything it throws leaves every 8.9.1 name unsaid. */
function abilities(): Partial<Record<Ability, boolean>> | null {
  try {
    const got = tulmiPerms()?.abilities?.();
    return got && typeof got === "object" ? got : null;
  } catch {
    return null;
  }
}

export function permCaps(): string[] {
  try {
    const health = Platform.OS === "ios" ? healthKit("ios") : healthConnect("android");
    return permCapsFrom({ perms: tulmiPerms(), health, abilities: abilities() });
  } catch {
    return [];
  }
}

/** The push caps this JavaScript adds: CallCheck1, only when this phone declared Motion1 or Focus1 (notifications/push.ts). */
export function permPushCaps(): string[] {
  try {
    return callCheckCaps(permCaps());
  } catch {
    return [];
  }
}
