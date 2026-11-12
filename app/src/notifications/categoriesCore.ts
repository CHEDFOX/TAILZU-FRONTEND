/**
 * A NOTIFICATION'S BUTTONS, THE RULES (categories.ts registers them, actions.ts runs them). Free of react-native and of
 * expo-notifications, so each rule is tested on its own (categoriesCore.test.ts).
 *
 * The server lists the categories in the bootstrap (push.categories) and gives each push kind one (push.<kind>.category, the push
 * engine's); the phone registers them on launch, so a new category or a renamed button needs no release. One category:
 *
 *   { id: "x0_reply", actions: [{ id: "reply", title: "Reply", icon: "arrowshape.turn.up.left",
 *     input: { placeholder: "Reply…", send: "Send" }, foreground: false, destructive: false, auth: false, act: "reply" }] }
 *
 * What a button does is one of:
 *   act: "<button>"        POST /v1/widgets/act { item: the push's data.item, action, text, key } with the app's own session
 *   open: true             open the push's screen, as a tap does
 *   call: { method, path, body }   any of the app's own /v1/ endpoints, `{data.<field>}` and `{text}` filled from the push and the
 *                          words typed (never a path outside /v1/)
 *
 * `icon` is kept for when the notification library can show one (expo-notifications 56 cannot); a button id is unique across all
 * categories (the phone is told only the button).
 */

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface CategoryAction {
  id: string;
  title: string;
  icon?: string;
  input?: { placeholder: string; send: string };
  foreground: boolean;
  destructive: boolean;
  auth: boolean;
  act?: string;
  open?: boolean;
  call?: { method: Method; path: string; body?: Record<string, unknown> };
}

export interface Category { id: string; actions: CategoryAction[]; previewPlaceholder?: string }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** iOS and Android both read a category id: letters, digits and _ (no ":" or "-", which expo-notifications warns about). */
const CAT_ID = /^[A-Za-z0-9_]{1,40}$/;
const BUTTON_ID = /^[a-z0-9_]{1,24}$/;
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

/** A /v1/ path with nothing in it that could leave the API (the same rule as security.isBackendPath, for a template). */
function apiPath(p: unknown): p is string {
  // eslint-disable-next-line no-control-regex
  return typeof p === "string" && p.startsWith("/v1/") && !/[\\@\s\u0000-\u001f\u007f]|\/\/|\/\.\.?(\/|$)/.test(p);
}

function cleanAction(a: unknown): CategoryAction | null {
  if (!isObj(a) || typeof a.id !== "string" || !BUTTON_ID.test(a.id) || typeof a.title !== "string" || !a.title.trim()) return null;
  const out: CategoryAction = {
    id: a.id, title: a.title.trim().slice(0, 40),
    foreground: a.foreground === true, destructive: a.destructive === true, auth: a.auth === true,
  };
  if (typeof a.icon === "string" && a.icon) out.icon = a.icon;
  if (isObj(a.input)) {
    out.input = {
      placeholder: typeof a.input.placeholder === "string" ? a.input.placeholder.slice(0, 80) : "",
      send: typeof a.input.send === "string" && a.input.send ? a.input.send.slice(0, 20) : "Send",
    };
  }
  if (typeof a.act === "string" && BUTTON_ID.test(a.act)) out.act = a.act;
  else if (a.open === true) out.open = true;
  else if (isObj(a.call) && typeof a.call.method === "string" && METHODS.has(a.call.method.toUpperCase()) && apiPath(a.call.path)) {
    out.call = { method: a.call.method.toUpperCase() as Method, path: a.call.path, ...(isObj(a.call.body) ? { body: a.call.body } : {}) };
  } else return null;
  return out;
}

/** The categories the server listed, each checked; a bad entry is left out, never registered. Ids unique. */
export function cleanCategories(list: unknown): Category[] {
  if (!Array.isArray(list)) return [];
  const out: Category[] = [];
  const seenCats = new Set<string>();
  const seenButtons = new Set<string>();
  for (const c of list) {
    if (!isObj(c) || typeof c.id !== "string" || !CAT_ID.test(c.id) || seenCats.has(c.id)) continue;
    const actions = (Array.isArray(c.actions) ? c.actions : []).map(cleanAction)
      .filter((a): a is CategoryAction => !!a && !seenButtons.has(a.id)).slice(0, 4);
    if (!actions.length) continue;
    for (const a of actions) seenButtons.add(a.id);
    seenCats.add(c.id);
    out.push({ id: c.id, actions, ...(typeof c.previewPlaceholder === "string" ? { previewPlaceholder: c.previewPlaceholder } : {}) });
  }
  return out;
}

/** A fingerprint of what is registered, so an unchanged list is not registered again on every launch. */
export function categoriesSignature(cats: Category[]): string {
  const s = JSON.stringify(cats);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${cats.length}:${(h >>> 0).toString(16)}`;
}

/** The button a response names, from whichever category has it. */
export function findAction(cats: Category[], id: string): CategoryAction | null {
  for (const c of cats) for (const a of c.actions) if (a.id === id) return a;
  return null;
}

/** "{data.threadId}" and "{text}" filled; a field that is not there leaves the whole template empty (never a half path). */
export function fillTemplate(s: string, data: Obj, text: string): string {
  let missing = false;
  const out = s.replace(/\{(data\.([A-Za-z0-9_]+)|text)\}/g, (_m, all: string, field?: string) => {
    if (all === "text") return text;
    const v = field ? data[field] : undefined;
    if (typeof v !== "string" && typeof v !== "number") { missing = true; return ""; }
    return String(v);
  });
  return missing ? "" : out;
}

function fillBody(body: unknown, data: Obj, text: string): unknown {
  if (typeof body === "string") return fillTemplate(body, data, text);
  if (Array.isArray(body)) return body.map((b) => fillBody(b, data, text));
  if (isObj(body)) return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, fillBody(v, data, text)]));
  return body;
}

/** What one button press sends, or why it sends nothing. */
export type ActionCall =
  | { kind: "act"; path: string; body: { item: string; action: string; text?: string; key: string } }
  | { kind: "call"; method: string; path: string; body?: unknown }
  | { kind: "open" }
  | { kind: "none"; why: string };

export function callFor(a: CategoryAction, data: Obj, text: string, key: string, actPath: string): ActionCall {
  if (a.open) return { kind: "open" };
  if (a.act) {
    const item = typeof data.item === "string" ? data.item : "";
    if (!item) return { kind: "none", why: "no item" };
    if (a.input && !text.trim()) return { kind: "none", why: "nothing typed" };
    return { kind: "act", path: actPath, body: { item, action: a.act, ...(a.input ? { text: text.trim() } : {}), key } };
  }
  if (a.call) {
    const path = fillTemplate(a.call.path, data, encodeURIComponent(text));
    if (!apiPath(path)) return { kind: "none", why: "no path" };
    return { kind: "call", method: a.call.method, path, ...(a.call.body ? { body: fillBody(a.call.body, data, text) } : {}) };
  }
  return { kind: "none", why: "nothing to do" };
}

// ------------------------------------------------------------------ the answers still owed

/** A button press that has not reached the server yet (offline, or the phone put the app away first): tried again later. */
export interface Owed { key: string; call: Exclude<ActionCall, { kind: "open" } | { kind: "none" }>; at: number; tries: number }

/** Keep one more (once per key), newest last, at most `max`. */
export function owe(list: Owed[], o: Owed, max = 20): Owed[] {
  return [...list.filter((x) => x.key !== o.key), o].slice(-max);
}

/** What is still worth trying: younger than `maxAgeMs`, tried fewer than `maxTries` times. */
export function stillOwed(list: Owed[], now: number, maxAgeMs: number, maxTries: number): Owed[] {
  return list.filter((o) => now - o.at < maxAgeMs && o.tries < maxTries);
}

/**
 * Whether a failed answer is worth trying again: the network or the server's trouble, not a refusal. A 409 "in_progress" is not a
 * refusal either: it is this same press (the same key, pressKey) still being answered by a second copy of it (Android hands a press
 * to the background task and to a running app alike), so trying again later gets that copy's answer instead of "Couldn't do that".
 */
export function retryable(status: number | undefined, code?: string): boolean {
  return status === undefined || status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
    || (status === 409 && code === "in_progress");
}

/**
 * A press's idempotency key: the push and the button, so the same press handled twice is one answer. Null without a push id.
 * It is built from the push's own data.pushId (every server push carries its push_log id), NOT the notification's identifier: a
 * follow's pushes share one collapse id, and iOS makes a remote notification's identifier its collapse id, so two different
 * pushes (Later on climb 1, Later on climb 2) would get one key and the act door would answer the second with the first's reply.
 *
 * "p" + the push id with every character outside [A-Za-z0-9_.:-] taken out, ":", the button; at most 120 long (the act door's
 * key rule). Null when the id part is shorter than 8 (or there is no button). A very long id is cut, never the button, so two
 * buttons of one push are always two keys.
 */
export function pressKey(pushId: unknown, actionId: string): string | null {
  const id = (typeof pushId === "string" ? pushId : "").replace(/[^A-Za-z0-9_.:-]/g, "");
  const button = (typeof actionId === "string" ? actionId : "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40);
  if (id.length < 8 || !button) return null;
  return `p${id.slice(0, 120 - 2 - button.length)}:${button}`;
}

/**
 * The key a press is answered under: the push and the button (pressKey) for a plain button, so a press handled twice, or retried
 * later, is one answer; a fresh one for a button with words typed (two replies are two messages) or a push with no id.
 */
export function answerKey(a: CategoryAction, data: Obj, fresh: () => string): string {
  if (a.input) return fresh();
  return pressKey(data.pushId, a.id) ?? fresh();
}

/**
 * What push.ts remembers so one tap or press is acted on once in this run of the app (the launch tap and the listener can both
 * hand it over): the notification, the push and the button. The notification's identifier alone is not enough: every push of a
 * follow shares one collapse id ("follow-<id>"), which iOS makes the identifier (and Android's tag likewise), so without the push
 * id the second push's Later, or a tap to open it, would be taken for the first one's and dropped. "" without an identifier
 * (nothing to tell them apart by: acted on every time, as before).
 */
/**
 * The push cap this JavaScript sends with its token (push.ts): it remembers taps by push id too (tapSeenKey), so the server may give a
 * follow's pushes one collapse id. A phone on older JavaScript never says it, so the server never collapses its pushes (its taps are
 * remembered by notification id alone, and a shared id would drop the second push's press).
 */
export const TAP_SEEN_CAP = "PushTapSeen";

export function tapSeenKey(identifier: unknown, data: unknown, actionIdentifier: unknown): string {
  const id = typeof identifier === "string" ? identifier : "";
  if (!id) return "";
  const pushId = isObj(data) && typeof data.pushId === "string" ? data.pushId : "";
  return `${id}:${pushId}:${typeof actionIdentifier === "string" ? actionIdentifier : ""}`;
}

/**
 * One job run at a time, and never a newer request lost: asked while it runs, it runs once more when it ends (however many asked
 * meanwhile), so the last run always sees what was newest. Every caller gets the promise of the run in progress. categories.ts
 * registers the buttons this way: a bootstrap that lands while the last one's buttons are still being registered is registered too.
 */
export function latestOnly(job: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do {
          again = false;
          try { await job(); } catch { /* the next ask tries again */ }
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

/**
 * The pressed button's id, handed to the push's screen as its `button` param (capability PushButton), or "" for a plain tap on the
 * notification (`defaultId`, the system's own) or an id that isn't one of ours. The server's hand-off screens open WhatsApp, UPI or
 * Maps only for a button, so a tap just to look never does.
 */
export function pressedButton(actionIdentifier: unknown, defaultId: string): string {
  const id = typeof actionIdentifier === "string" ? actionIdentifier : "";
  if (!id || id === defaultId) return "";
  return /^[A-Za-z0-9_]{1,40}$/.test(id) ? id : "";
}
