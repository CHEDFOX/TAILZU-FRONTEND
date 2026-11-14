/**
 * Whether a Focus (iPhone) or Do Not Disturb (Android) is on (docs: perms2 4). No permission on either phone, so no card and no
 * system prompt. The native function is reached through natives.ts and may be missing (an older binary, Expo Go): then the action
 * says "unavailable" and the row is not drawn next time.
 *
 * On the iPhone the value is what X0 Bot's own Focus Filter last wrote to the App Group; on Android it is
 * NotificationManager's interruption filter. Only on/off and the filter's own choice ever leave the phone (focusCore.ts).
 */
import { Platform } from "react-native";
import { tulmiPerms } from "./natives";
import {
  focusBody, focusSync,
  type FocusBody, type FocusDeps, type FocusOutcome, type FocusSource,
} from "./focusCore";

const source = (): FocusSource => (Platform.OS === "ios" ? "filter" : "dnd");

function read(): unknown | null {
  try {
    return tulmiPerms()?.focusState?.() ?? null;
  } catch {
    return null;
  }
}

const deps = (post: (path: string, body: FocusBody) => Promise<unknown>): FocusDeps => ({
  now: () => Date.now(),
  source: source(),
  read,
  post,
});

/** The focus.sync action. Returns the outcome name only. */
export function runFocusSync(
  action: { path: string },
  post: (path: string, body: FocusBody) => Promise<unknown>,
): Promise<{ outcome: FocusOutcome }> {
  return focusSync(action, deps(post));
}

/**
 * Whether a Focus is on right now, for the pre-ring check (perms2 5.3). null when this phone cannot say, which the server reads
 * as "no answer" and rings as it does today.
 */
export function focusNow(): boolean | null {
  const body = focusBody(read(), source(), Date.now());
  return body ? body.on : null;
}
