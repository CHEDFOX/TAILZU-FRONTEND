import { str } from "../knobs";
import { runningBundle } from "./capabilities";
import { callEndpoint } from "./endpoint";

/**
 * Ask for an update, out loud.
 *
 * expo-updates checks on launch by itself and says nothing either way, so a
 * build that never applies an update is indistinguishable from one where no
 * update was ever published — which is exactly the week this cost. This runs
 * the same check explicitly and reports the answer to the server, where one
 * grep settles it: whether the app asked, whether anything was offered, and
 * whether it failed.
 *
 * It does not reload. Applying an update mid-session would swap the bundle out
 * from under whatever the user is doing; expo-updates already applies it on
 * the next launch, and the next launch is soon enough.
 */
export async function reportUpdateCheck(): Promise<void> {
  let outcome = "unavailable";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates");
    if (!Updates.isEnabled) {
      outcome = "disabled";
    } else {
      const res = await Updates.checkForUpdateAsync();
      if (res?.isAvailable) {
        await Updates.fetchUpdateAsync();
        outcome = "fetched";     // applies on the next launch
      } else {
        outcome = "current";
      }
    }
  } catch (e) {
    outcome = `error:${e instanceof Error ? e.message.slice(0, 60) : "?"}`;
  }
  // Best-effort and fire-and-forget: this is diagnostics, never a gate.
  try {
    await callEndpoint("POST", str("net.telemetryPath", "/v1/keyboard/telemetry"), {
      buckets: { kind: "updates" },
      counters: {},
      windowMs: 0,
      build: `ota:${outcome}:${runningBundle()}`,
    });
  } catch { /* the log line is a bonus, not a requirement */ }
}
