/**
 * ONE REMINDERS LIST: THE RULES (docs: perms2 3). Pure: no react-native, no native module, so each rule is tested in Node
 * (remindersCore.test.ts); reminders.ts calls the module and the server.
 *
 * X0 Bot keeps ONE list, called "X0 Bot", in step with Plan Ease's to-dos. iOS has no write-only grant, so the person gives full
 * access — and the module still fetches only that one list, by its own identifier. Only a title, a due date and whether it is
 * done ever cross: no notes, URL, location, priority, alarm or subtask is read or written, no other list is touched, and nothing
 * reaches `$state`.
 *
 * One sync is two requests: the list goes up, the server answers what to add, change and remove in it, the phone does exactly
 * that to that list, and the identifiers of the items it added go up so the server can link them.
 */

/** The one path reminders.sync may POST to. */
export const REMINDERS_PATH = "/v1/botsapp/plan/reminders/sync";

export const remindersPathOk = (p: unknown): p is string => p === REMINDERS_PATH;

export const TITLE_MAX = 200;
/** The server refuses a list longer than this (its own REMINDERS_LIMITS.items), so the phone sends no more than it reads. */
export const MAX_ITEMS = 300;
export const MAX_OPS = 200;
const ID_MAX = 200;

const text = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max).trim() : s;
};

const idOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= ID_MAX && !/[\u0000-\u001f]/.test(v);

/** A due date as the phone and the server exchange it: an instant either side can read, or a day on its own. */
export const isoOk = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 10 && v.length <= 40 && Number.isFinite(Date.parse(v));

/** A due date that starts with a day, which is all either side needs when the time means nothing. */
const DAY_FIRST = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * A DAY-ONLY due date on its way UP, as the day the person sees. The module writes a full instant in the item's own zone
 * ("2026-11-20T00:00:00+05:30"), so its first ten characters ARE that day; `toISOString()` would move it to UTC and, east of
 * UTC, name the day before — which is the day the server would then file the to-do on (docs: perms2 3.2).
 */
export const dayOfDue = (v: string): string => v.slice(0, 10);

/**
 * A due date on its way INTO Reminders. A day-only value (the server sends "2026-11-20", and `dueHasTime: false` says the time
 * means nothing) becomes LOCAL NOON of that day: `new Date("2026-11-20")` is UTC midnight, which the module reads in the
 * phone's own zone and files a day early anywhere west of UTC. Noon lands on the right day in every zone.
 */
export function dueInstant(value: string, hasTime: boolean): string {
  const m = DAY_FIRST.exec(value);
  if (m && (!hasTime || value.length === 10)) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).toISOString();
  }
  return new Date(value).toISOString();
}

/** One item of the X0 Bot list, as it goes up. */
export interface ReminderItem {
  ext: string;
  title: string;
  dueIso?: string;
  dueHasTime: boolean;
  done: boolean;
  changedAt: string;
}

/** What the module read, bounded and tidied. Anything without an identifier or a title is dropped rather than guessed at. */
export function cleanItems(raw: unknown): ReminderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReminderItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS * 2)) {
    if (!r || typeof r !== "object") continue;
    const it = r as Record<string, unknown>;
    const ext = idOk(it.ext) ? it.ext : "";
    const title = text(it.title, TITLE_MAX);
    if (!ext || !title) continue;
    const item: ReminderItem = {
      ext,
      title,
      dueHasTime: it.dueHasTime === true,
      done: it.done === true,
      changedAt: isoOk(it.changedAt) ? new Date(it.changedAt).toISOString() : new Date(0).toISOString(),
    };
    if (isoOk(it.dueIso)) {
      const raw = String(it.dueIso);
      item.dueIso = item.dueHasTime || !DAY_FIRST.test(raw) ? new Date(raw).toISOString() : dayOfDue(raw);
    }
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** What the server answers: what to add to the list, what to change in it, what to take out of it. */
export interface SyncOps {
  listId: string;
  add: { id: string; title: string; dueIso?: string; dueHasTime: boolean }[];
  /** `dueHasTime` rides with every due date the server changes: the module reads a missing one as day-only and would strip
   *  the time (docs: perms2 3.2). On its own it is the server saying the to-do has no due date at all. */
  update: { ext: string; title?: string; dueIso?: string; dueHasTime?: boolean; done?: boolean }[];
  remove: string[];
}

/**
 * The server's reply, checked before it reaches the phone's calendar store: every op is bounded, every identifier is a plain
 * string, and nothing but a title, a due date and done can be written. A reply the phone cannot read is simply an empty sync.
 */
export function cleanOps(reply: unknown, listId: string): SyncOps {
  const ops: SyncOps = { listId, add: [], update: [], remove: [] };
  if (!reply || typeof reply !== "object") return ops;
  const r = reply as { add?: unknown; update?: unknown; remove?: unknown };
  if (Array.isArray(r.add)) {
    for (const a of r.add.slice(0, MAX_OPS)) {
      if (!a || typeof a !== "object") continue;
      const row = a as Record<string, unknown>;
      const id = idOk(row.id) ? row.id : "";
      const title = text(row.title, TITLE_MAX);
      if (!id || !title) continue;
      const add: SyncOps["add"][number] = { id, title, dueHasTime: row.dueHasTime === true };
      if (isoOk(row.dueIso)) add.dueIso = dueInstant(String(row.dueIso), add.dueHasTime);
      ops.add.push(add);
    }
  }
  if (Array.isArray(r.update)) {
    for (const u of r.update.slice(0, MAX_OPS)) {
      if (!u || typeof u !== "object") continue;
      const row = u as Record<string, unknown>;
      if (!idOk(row.ext)) continue;
      const up: SyncOps["update"][number] = { ext: row.ext };
      const title = text(row.title, TITLE_MAX);
      if (title) up.title = title;
      const hasDue = isoOk(row.dueIso);
      if (hasDue) up.dueIso = dueInstant(String(row.dueIso), row.dueHasTime === true);
      // The flag goes with a due date we could read, and alone only when the server sent no date at all (no due date).
      if (typeof row.dueHasTime === "boolean" && (hasDue || row.dueIso === undefined)) up.dueHasTime = row.dueHasTime;
      if (typeof row.done === "boolean") up.done = row.done;
      if (up.title === undefined && up.dueIso === undefined && up.dueHasTime === undefined && up.done === undefined) continue;
      ops.update.push(up);
    }
  }
  if (Array.isArray(r.remove)) {
    for (const x of r.remove.slice(0, MAX_OPS)) if (idOk(x)) ops.remove.push(x);
  }
  return ops;
}

export const opsEmpty = (ops: SyncOps): boolean => !ops.add.length && !ops.update.length && !ops.remove.length;

/** The links the second request records: which to-do became which item in the list. */
export function cleanApplied(raw: unknown): { id: string; ext: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { id: string; ext: string }[] = [];
  for (const a of raw.slice(0, MAX_OPS)) {
    if (!a || typeof a !== "object") continue;
    const row = a as Record<string, unknown>;
    if (idOk(row.id) && idOk(row.ext)) out.push({ id: row.id, ext: row.ext });
  }
  return out;
}

export type RemindersOutcome = "synced" | "denied" | "blocked" | "unavailable" | "error" | "skipped";

/** What one platform's reader says before it reads. */
export type RemindersReady = "ready" | "denied" | "blocked" | "unavailable";

export interface RemindersDeps {
  now: () => Date;
  /** Checks, and asks only when `ask`. ask:false never shows a system prompt. */
  prepare: (ask: boolean) => Promise<RemindersReady>;
  /** The X0 Bot list only (made on first use): its identifier and its items. */
  read: () => Promise<{ listId?: unknown; items?: unknown }>;
  /** Applies the ops to that list only. */
  apply: (ops: SyncOps) => Promise<{ applied?: unknown }>;
  post: (path: string, body: unknown) => Promise<unknown>;
  everyMs: number;
  lastAt: Map<string, number>;
}

/**
 * The reminders.sync action. The path is checked FIRST: off the pin, nothing is read. ask:false never prompts and is skipped when
 * it ran within `everyMs`. `enable` rides on the first POST. The second request is sent only when something was really added,
 * because there is nothing to link otherwise.
 */
export async function remindersSync(
  action: { path: string; ask?: boolean; enable?: boolean },
  deps: RemindersDeps,
): Promise<{ outcome: RemindersOutcome }> {
  if (!remindersPathOk(action.path)) return { outcome: "error" };
  const ask = action.ask === true;
  const enable = action.enable === true;
  try {
    const t0 = deps.now().getTime();
    if (!ask && !enable && deps.everyMs > 0) {
      const last = deps.lastAt.get(action.path);
      if (last !== undefined && t0 - last >= 0 && t0 - last < deps.everyMs) return { outcome: "skipped" };
    }
    const ready = await deps.prepare(ask);
    if (ready !== "ready") return { outcome: ready };
    const read = await deps.read();
    if (!idOk(read?.listId)) return { outcome: "error" };
    const listId = read.listId;
    const items = cleanItems(read.items);
    const reply = await deps.post(action.path, { ...(enable ? { enable: true as const } : {}), listId, items });
    const ops = cleanOps(reply, listId);
    if (!opsEmpty(ops)) {
      const applied = cleanApplied((await deps.apply(ops))?.applied);
      // Exactly what the contract names (perms2 3.2): the links, and nothing beside them.
      if (applied.length) await deps.post(action.path, { applied });
    }
    deps.lastAt.set(action.path, t0);
    return { outcome: "synced" };
  } catch {
    return { outcome: "error" };
  }
}
