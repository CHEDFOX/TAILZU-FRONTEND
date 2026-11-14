/**
 * THE LAUNCH THIS PHONE PLAYS: the server's motion, the copy this build carries, or the one it was cut with.
 *
 * The motion of the launch is the server's (TAILZU-BACKEND shared/launch/launch.json, docs/launch.md), so a new
 * launch, or a change to this one, reaches every phone without an app update. An app holds three copies and plays one:
 *   - the one the server last sent: every phone's bootstrap carries the launch whole as the flag "app.launch", and the
 *     bootstrap is kept on the device with the rest of it (storage.readKnobSnapshotSync). The launch plays before
 *     anything is fetched, so it plays the kept one: a change shows from the start after the one that received it;
 *   - the copy this build carries (launchStarter.ts, written from the server's file at release by the backend's
 *     tulmi/scripts/gen-launch-starter.mjs): a first start, and offline;
 *   - the motion this build was cut with (launchCore.ts BUILT_IN), should neither of those compile.
 * A launch is compiled once (launchCore.ts launchMotion) and played only if it compiles whole; the one chosen is
 * worked out once per launch of the app, because the motion starts before the app has a screen.
 *
 * Nothing the server sends is run as code: every field is a formula in the bots' motion language, compiled to that
 * language's own bytecode, which only does arithmetic (launchCore.ts, botTiles/core.ts compileWith).
 */
import { BUILT_IN, launchMotion, pickLaunch, type Launch, type LaunchSpec } from "./launchCore.ts";
import { LAUNCH_STARTER } from "./launchStarter.ts";

export type { Launch, LaunchSpec };
export { BUILT_IN, launchMotion };

/** The bootstrap flag the launch rides in, whole (the backend's launchFlags()). */
export const LAUNCH_FLAG = "app.launch";

/**
 * The launch the server last sent, as the kept bootstrap has it. Read through a require, so this module loads in a
 * plain node test and on a binary whose synchronous store is missing: either way there is simply no kept launch.
 */
export function keptLaunch(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const snap = require("../storage").readKnobSnapshotSync() as { flags?: Record<string, unknown> } | null;
    return snap?.flags?.[LAUNCH_FLAG];
  } catch {
    return undefined;   // no store in this binary, or nothing kept: the copy this build carries plays
  }
}

let playing: Launch | null = null;

/** The launch to play, worked out once: the server's while it compiles and is not older, else the build's own. */
export function launchNow(): Launch {
  if (!playing) playing = pickLaunch(keptLaunch(), LAUNCH_STARTER);
  return playing;
}

/** Forget what was chosen (tests, and a reload that re-reads the kept bootstrap). */
export function resetLaunchForTests(): void {
  playing = null;
}
