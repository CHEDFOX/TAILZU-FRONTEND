/**
 * The capability names for location, contacts and health, read from the natives gate and nothing else (perms/SPEC.md 5.2).
 * Said by a JS check of the module's presence, as VoiceLive is; binaryFeatures and binaryCore.ts are not touched.
 *
 * Health1 needs the package itself (HealthKit on iOS; Health Connect on Android, linked only when the build's Android health
 * switch is on). Whether Health Connect is INSTALLED on the phone is checked later, by health.sync, because this is synchronous.
 */
import { Platform } from "react-native";
import { healthConnect, healthKit, tulmiPerms } from "./natives";
import { permCapsFrom } from "./permCapsCore";

export function permCaps(): string[] {
  try {
    const health = Platform.OS === "ios" ? healthKit("ios") : healthConnect("android");
    return permCapsFrom({ perms: tulmiPerms(), health });
  } catch {
    return [];
  }
}
