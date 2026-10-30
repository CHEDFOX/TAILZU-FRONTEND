/**
 * WHETHER SOMEONE IS SIGNED IN, AT LAUNCH, WITHOUT GUESSING.
 *
 * "No session" from supabase.auth.getSession() is not proof of being signed out. It also says that when:
 *   - the access token had expired (an hour after the last refresh) and the refresh failed for a moment: the network
 *     not up yet as the app opens, a dead zone. Supabase keeps the session on the phone (the refresh is retryable)
 *     and the next launch refreshes it fine;
 *   - the Keychain could not be read: the app was started in the background (a push, a Live Activity update) while
 *     the phone was locked, and the session is unreadable until it is unlocked.
 * Taking either as signed out showed the sign-in page to someone who was signed in, until they closed the app and
 * opened it again. So the only thing that means signed out is the phone holding no session at all; anything else is
 * tried again, in front, with the phone unlocked, and if it still cannot be read the app opens as signed in and the
 * session is refreshed as soon as it can be (startAutoRefresh on every return to the front).
 *
 * Pure, with its world passed in, so every case is tested (restore.test.ts).
 */
export type StoredSession = "present" | "absent" | "unreadable";

export type Restored<S> =
  | { state: "in"; session: S }
  /** A session is kept on the phone but could not be read or refreshed yet: stay signed in, it catches up. */
  | { state: "held" }
  /** Nothing kept: signed out. */
  | { state: "out" };

export interface RestoreDeps<S> {
  /** The session, refreshed if it needed to be; null (or a throw) when it could not be had just now. */
  getSession(): Promise<S | null>;
  /** What the phone holds, read without the network. */
  stored(): Promise<StoredSession>;
  /** Resolves once the app is in front (so the phone is unlocked and the network is the app's). */
  untilActive(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** How many reads before opening as held (default 5: about six seconds of backing off). */
  tries?: number;
}

export async function restoreSession<S>(d: RestoreDeps<S>): Promise<Restored<S>> {
  const tries = Math.max(1, d.tries ?? 5);
  for (let i = 0; i < tries; i++) {
    await d.untilActive();
    const session = await d.getSession().catch(() => null);
    if (session) return { state: "in", session };
    const stored = await d.stored().catch((): StoredSession => "unreadable");
    if (stored === "absent") return { state: "out" };
    if (i < tries - 1) await d.sleep(Math.min(3200, 200 * 2 ** i));
  }
  return { state: "held" };
}
