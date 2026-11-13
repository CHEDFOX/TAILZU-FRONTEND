/**
 * react-native-gesture-handler, ASKED FOR RATHER THAN ASSUMED.
 *
 * This block ships over the air on runtime `tailzu-2026-11-x0-blip`, and a JS update can reach a binary built
 * before a package was linked. The library's own import throws there, so it is required only once its native
 * module answers — the pattern src/sdui/bots/PullBot.tsx already uses for the same library, and the rule the
 * spec states for every optional native thing (SPEC 2.11, 4.1).
 *
 * Without it, a node with gestures draws exactly as it did before: its children, and no finger.
 *
 * When V1 lands `src/device/natives.ts` this should move there, so there is one place the app asks what the
 * binary under it actually has. Until then it lives beside the block that needs it.
 */
import { NativeModules, TurboModuleRegistry } from "react-native";

export type GestureLib = typeof import("react-native-gesture-handler");

let lib: GestureLib | null | undefined;

/** The library when this binary has its native half; else null. Asked once, then remembered. */
export function gestureLib(): GestureLib | null {
  if (lib !== undefined) return lib;
  try {
    const native = TurboModuleRegistry.get("RNGestureHandlerModule")
      ?? (NativeModules as Record<string, unknown>).RNGestureHandlerModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = native ? (require("react-native-gesture-handler") as GestureLib) : null;
  } catch {
    lib = null;
  }
  return lib;
}

/** True when this build can take a finger at all. The handshake's `gesture` block depends on it. */
export function gesturesAvailable(): boolean {
  return gestureLib() !== null;
}
