/**
 * One Reminders list, kept in step with Plan Ease's to-dos (docs: perms2 3). iPhone only: Android has no reminders store, and
 * the server's Google Tasks connector covers it there. Every native function is reached through natives.ts and may be missing
 * (an older binary, Expo Go, a cut usage key), and then the action says "unavailable".
 *
 * iOS offers no write-only grant, so the person gives full access — and the module still opens only the X0 Bot list. The rules
 * are in remindersCore.ts.
 */
import { tulmiPerms } from "./natives";
import {
  remindersSync,
  type RemindersDeps, type RemindersOutcome, type RemindersReady, type SyncOps,
} from "./remindersCore";

const lastAt = new Map<string, number>();

async function prepare(ask: boolean): Promise<RemindersReady> {
  const m = tulmiPerms();
  if (!m?.remindersRead || !m.remindersApply || !m.remindersStatus) return "unavailable";
  const status = m.remindersStatus();
  if (status === "granted") return "ready";
  if (status === "blocked") return "blocked";
  if (!ask || !m.remindersAsk) return "denied";
  const after = await m.remindersAsk();
  return after === "granted" ? "ready" : after === "blocked" ? "blocked" : "denied";
}

const deps = (post: (path: string, body: unknown) => Promise<unknown>, everyMs: number): RemindersDeps => ({
  now: () => new Date(),
  prepare,
  read: async () => {
    const m = tulmiPerms();
    if (!m?.remindersRead) throw new Error("no reminders module");
    return m.remindersRead();
  },
  apply: async (ops: SyncOps) => {
    const m = tulmiPerms();
    if (!m?.remindersApply) throw new Error("no reminders module");
    return m.remindersApply(ops);
  },
  post,
  everyMs,
  lastAt,
});

/** The reminders.sync action. Returns the outcome name only; no item text comes back to the screen. */
export function runRemindersSync(
  action: { path: string; ask?: boolean; enable?: boolean },
  post: (path: string, body: unknown) => Promise<unknown>,
  everyMs: number,
): Promise<{ outcome: RemindersOutcome }> {
  return remindersSync(action, deps(post, everyMs));
}
