/**
 * What this DEVICE can already do — read once, shared by everyone who asks.
 *
 * The microphone permission and the keyboard's Full Access are properties of
 * the phone, not of the account. Someone who signs out and back in with a
 * different email has already granted both, and the onboarding steps that ask
 * for them have nothing left to ask. The server decides which of those steps
 * to show, so the server has to be told — and it can only be told what the app
 * has already read.
 *
 * Two consumers, and they want the same facts with DIFFERENT safe defaults:
 *
 *   - screen state ($state.keyboardReady) gates a button. A missing bridge
 *     there must read as "ready", or development in Expo Go blocks on a
 *     native module that isn't there.
 *   - bootstrap capabilities decide whether a SETUP STEP IS SHOWN AT ALL. A
 *     missing bridge there must read as "not ready", because skipping the
 *     keyboard walkthrough for someone who never enabled the keyboard leaves
 *     them with an app whose whole point is unreachable.
 *
 * So this reports the raw reading — including "the bridge did not answer" as
 * null, distinct from "it answered no" — and each caller picks its own default.
 * Collapsing that distinction here is how one of those two would end up wrong.
 */
import { getKeyboardStatus } from "../../modules/tulmi-bridge";

export type DeviceSignals = {
  /** Null when the native bridge is absent (Expo Go, or a failed link). */
  keyboard: { enabled: boolean; fullAccess: boolean } | null;
  /** True only for an explicit grant. Undetermined and denied both read false. */
  micGranted: boolean;
};

let snapshot: DeviceSignals = { keyboard: null, micGranted: false };

/** The last reading. Synchronous, for callers that cannot await (capabilities). */
export function getDeviceSignals(): DeviceSignals {
  return snapshot;
}

/**
 * Re-read the device. Cheap enough to call on a timer and on every foreground,
 * which is what it is for: both of these change in Settings, while the app is
 * in the background, so the only reading that matters is the one taken after
 * coming back.
 *
 * NEVER REQUESTS. getRecordingPermissions, not request — this runs unattended,
 * and a request would fire the system dialog with nobody expecting it.
 */
export async function refreshDeviceSignals(): Promise<DeviceSignals> {
  const keyboard = getKeyboardStatus();
  let micGranted = snapshot.micGranted;
  try {
    const AudioMod = await import("expo-audio");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = await (AudioMod as any).AudioModule?.getRecordingPermissionsAsync?.();
    micGranted = !!p?.granted;
  } catch {
    // No expo-audio in this bundle. Keep the last reading rather than
    // reporting a revocation that did not happen.
  }
  snapshot = {
    keyboard: keyboard ? { enabled: keyboard.enabled, fullAccess: keyboard.fullAccess } : null,
    micGranted,
  };
  return snapshot;
}

/**
 * Read the device, but never hold the caller up for long.
 *
 * Boot awaits this so the FIRST bootstrap can carry the answers — that is the
 * request that decides which screen opens, and an answer that arrives after it
 * is an answer that arrives too late. But boot must not hang on a native call
 * that never returns: the fallback is the last snapshot, which on a cold start
 * is "nothing granted" — the conservative reading, showing a step that may not
 * be needed rather than skipping one that is.
 */
export async function refreshDeviceSignalsBounded(ms = 500): Promise<DeviceSignals> {
  return Promise.race([
    refreshDeviceSignals(),
    new Promise<DeviceSignals>((r) => setTimeout(() => r(snapshot), ms)),
  ]);
}
