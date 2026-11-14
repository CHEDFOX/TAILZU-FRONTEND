/**
 * FOCUS AND DO NOT DISTURB: THE RULES (docs: perms2 4). Pure: no react-native, no native module, so each rule is tested in Node
 * (focusCore.test.ts); focus.ts reads the module and posts to the server.
 *
 * Only ON OR OFF, and the choice the person made in the filter ("hold calls", or "calls and other pings"). NEVER which Focus,
 * never its name or mode: iOS does not offer it to a Focus Filter and we would not send it if it did. On the iPhone this is what
 * X0 Bot's own Focus Filter last wrote; on Android it is the interruption filter, which needs no permission at all. Nothing here
 * asks the person for anything, so there is no card and no system prompt.
 */

/** The one path focus.sync may POST to. */
export const FOCUS_PATH = "/v1/botsapp/plan/focus";

export const focusPathOk = (p: unknown): p is string => p === FOCUS_PATH;

export type FocusHold = "calls" | "callsAndPings";

/** Where the state came from: the iPhone's Focus Filter, or Android's Do Not Disturb. */
export type FocusSource = "filter" | "dnd";

export interface FocusBody {
  on: boolean;
  hold?: FocusHold;
  source: FocusSource;
  /**
   * WHEN THE FILTER ITSELF SAW THIS, in milliseconds (the App Group's own `at`). The server holds a state for 12 hours from
   * this moment, not from the post: Plan Ease reposts the same state on every page appear, so without it each repost pushed
   * the server's limit forward and a Focus whose end was never seen could hold calls for about 24 hours instead of 12.
   * Only for the filter, which writes `at`; Do Not Disturb is read at the moment it is posted.
   */
  at?: number;
}

/**
 * How long a Focus the filter saw may still be believed. iOS runs the filter's intent when a Focus starts and when it ends, but a
 * missed "ended" would otherwise hold calls for ever, so a state older than this reads as off — the same 12 hours the server
 * keeps it for.
 */
export const FOCUS_MAX_AGE_MS = 12 * 3_600_000;

/**
 * What to post, from what the module said. null when nothing is known at all (the filter has never run on this phone), because
 * "we do not know" is not "no Focus is on": posting off would turn the hold off on the server for no reason.
 */
export function focusBody(state: unknown, source: FocusSource, nowMs: number): FocusBody | null {
  if (!state || typeof state !== "object") return null;
  const s = state as { on?: unknown; hold?: unknown; at?: unknown };
  if (typeof s.on !== "boolean") return null;
  let on = s.on;
  if (on && source === "filter") {
    const at = Number(s.at);
    // A stale "on" (the app was not running when the Focus ended) reads as off rather than holding calls for ever.
    if (Number.isFinite(at) && at > 0 && nowMs - at > FOCUS_MAX_AGE_MS) on = false;
  }
  const body: FocusBody = { on, source };
  if (s.hold === "calls" || s.hold === "callsAndPings") body.hold = s.hold;
  // The filter's own moment goes with it, so the server's 12 hours run from when the filter saw this and not from the post.
  if (source === "filter") {
    const at = Number(s.at);
    if (Number.isFinite(at) && at > 0) body.at = at;
  }
  return body;
}

export type FocusOutcome = "synced" | "none" | "unavailable" | "error";

export interface FocusDeps {
  now: () => number;
  /** Which phone this is, so the server knows what it is reading. */
  source: FocusSource;
  /** The module's state, or null. Never throws for a missing module: focus.ts answers null. */
  read: () => unknown | null;
  post: (path: string, body: FocusBody) => Promise<unknown>;
}

/**
 * The focus.sync action, run on each Plan Ease page appear: it catches up a state the filter's own post could not send (a
 * widgets token issued before the scope existed gets a 403, perms2 4.5). The path is checked first; nothing is read off the pin.
 */
export async function focusSync(
  action: { path: string },
  deps: FocusDeps,
): Promise<{ outcome: FocusOutcome }> {
  if (!focusPathOk(action.path)) return { outcome: "error" };
  try {
    const state = deps.read();
    if (state == null) return { outcome: "unavailable" };
    const body = focusBody(state, deps.source, deps.now());
    if (!body) return { outcome: "none" };
    await deps.post(action.path, body);
    return { outcome: "synced" };
  } catch {
    return { outcome: "error" };
  }
}
