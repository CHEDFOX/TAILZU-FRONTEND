/**
 * WHAT A SILENT PUSH SAYS, THE RULES (backgroundTask.ts runs them in the app's JavaScript with no window). Free of react-native, so
 * each is tested on its own (backgroundCore.test.ts).
 *
 * Two kinds of data push wake the app without showing anything, and both are only ever NUDGES to something this phone already knows
 * how to do, never instructions: the server cannot make the phone do a new thing, only do an old thing now.
 *
 *   { kind: "native.looks", v }                       the looks catalog moved to `v`: fetch it (iOS content-available, Android
 *                                                      data-only). A new design still shows at the next draw, never "the minute it
 *                                                      is published" (SPEC 3.6)
 *   { kind: "bots.update", event, state, look? }       Android: repost or end the ongoing "Bots at work" notice with this state
 *                                                      (the same ContentState the iPhone's Live Activity is pushed). Data only, high
 *                                                      priority; a force-stopped app receives nothing, and that is right
 *
 * Anything else is not ours and is ignored. The state of a notice push is checked like a Live Activity's own: a job is a few short
 * strings and numbers, and the whole body is held to the same 3.5 KB, in the same order of what is given up.
 */
import { clampVars, fitActivityBody } from "../native/looksCore.ts";

export const NOTICE_KIND = "bots.update";
export const LOOKS_KIND = "native.looks";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The data a push carried, from however the platform hands it over: a task payload whose `data.dataString` is the JSON of the data
 * (Android), `data` itself (iOS and others), `notification.request.content.data`, or the data at the top. Null when there is none.
 */
export function payloadData(payload: unknown): Record<string, unknown> | null {
  if (!isObj(payload)) return null;
  const data = payload.data;
  if (isObj(data)) {
    const s = data.dataString;
    if (typeof s === "string") {
      try {
        const parsed: unknown = JSON.parse(s);
        if (isObj(parsed)) return parsed;
      } catch { /* not JSON: the keys beside it may still be the data */ }
    }
    // Expo sends a data push's `body` as JSON on some paths.
    if (typeof data.body === "string" && data.body.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(data.body);
        if (isObj(parsed) && typeof parsed.kind === "string") return parsed;
      } catch { /* the keys beside it */ }
    }
    return data;
  }
  const content = isObj(payload.notification) && isObj((payload.notification as Record<string, unknown>).request)
    ? ((((payload.notification as Record<string, unknown>).request as Record<string, unknown>).content as Record<string, unknown> | undefined)?.data)
    : undefined;
  if (isObj(content)) return content;
  return typeof payload.kind === "string" ? payload : null;
}

/** A press on a notification's button, not a data push. */
export const isPress = (payload: unknown): boolean => isObj(payload) && "actionIdentifier" in payload;

export type Nudge =
  | { kind: "looks"; v: number | null }
  | { kind: "notice"; event: "update" | "end"; json: string | null };

/** What a data push asks for, or null for anything that is not ours. */
export function nudgeOf(payload: unknown): Nudge | null {
  const d = payloadData(payload);
  if (!d) return null;
  if (d.kind === LOOKS_KIND) {
    const v = Math.round(Number(d.v));
    return { kind: "looks", v: Number.isFinite(v) && v > 0 && v < 1_000_000 ? v : null };
  }
  if (d.kind === NOTICE_KIND) {
    const event = d.event === "end" ? "end" : d.event === "update" ? "update" : null;
    if (!event) return null;
    if (event === "end") return { kind: "notice", event, json: null };
    const state = noticeState(d.state, typeof d.look === "string" ? d.look : null);
    return state ? { kind: "notice", event, json: JSON.stringify(state) } : null;
  }
  return null;
}

const PHASES = new Set(["working", "needs", "done"]);

/**
 * A notice state a phone may post: the job's few fields, each cut to its length, within the body cap. Null when it is not a job at
 * all. Unknown keys are left out, so a push can add nothing the native side does not already read.
 */
export function noticeState(raw: unknown, look: string | null): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
  const n = (v: unknown, lo: number, hi: number, d: number): number => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  const phase = typeof raw.phase === "string" && PHASES.has(raw.phase) ? raw.phase : "working";
  const bot = s(raw.bot, 48);
  if (!bot) return null;
  const out: Record<string, unknown> = {
    bot,
    botName: s(raw.botName, 40),
    face: typeof raw.face === "string" ? s(raw.face, 48) : null,
    task: s(raw.task, 200),
    stage: n(raw.stage, 0, 99, 1),
    of: n(raw.of, 1, 99, 1),
    stageName: s(raw.stageName, 40),
    stages: Array.isArray(raw.stages) ? raw.stages.slice(0, 12).map((x) => s(x, 40)) : [],
    startedAt: Number.isFinite(Number(raw.startedAt)) && Number(raw.startedAt) > 0 ? Math.round(Number(raw.startedAt)) : Date.now(),
    phase,
    link: s(raw.link, 300),
  };
  // A private item carries no question and no choices (glanceCore.activityState's rule), whatever the push said.
  const priv = raw.private === true;
  for (const k of ["question", "result", "itemId", "itemKind", "decideLink"] as const) if (!(priv && k === "question") && typeof raw[k] === "string" && raw[k]) out[k] = s(raw[k], k === "question" || k === "result" ? 200 : 300);
  if (!priv && Array.isArray(raw.choices)) {
    out.choices = raw.choices.filter(isObj).slice(0, 3).map((c) => ({
      id: s(c.id, 24), label: s(c.label, 40), ...(c.primary === true ? { primary: true } : {}),
    }));
  }
  if (isObj(raw.pr) && Number.isFinite(Number(raw.pr.number)) && typeof raw.pr.url === "string") out.pr = { number: Math.round(Number(raw.pr.number)), url: s(raw.pr.url, 300) };
  if (Number.isFinite(Number(raw.minutes)) && Number(raw.minutes) > 0) out.minutes = n(raw.minutes, 1, 100_000, 1);
  if (priv) out.private = true;
  if (raw.failed === true) out.failed = true;
  if (look && /^[a-z0-9._-]{1,40}$/.test(look)) out.look = look;
  const vars = clampVars(raw.vars);
  if (vars) out.vars = vars;
  return fitActivityBody(out).state;
}
