/**
 * THE X0 WIDGET, THE RULES (glance.ts wires them to the app). Free of react-native, so each is tested on its own
 * (glanceCore.test.ts). The contract is the backend's docs/widget-glance-v2.md.
 *
 *   cleanGlance      what GET /v1/shell/glance?v=2 answered, checked before it reaches a widget: version 2 only; every field
 *                    typed, cut to its length at a word ("…" only when cut), every link one this app opens (a PR's only on
 *                    github.com), every face a safe file name and an https picture, an answer's id one the widget's answer path
 *                    takes; the case the widget leads with is the server's when the rest of the glance backs it, else picked
 *                    by the contract's order (needs → done → working → quiet)
 *   cleanSteps       the glance's `steps`: lines that take over at their own minute with no new glance (a leave-by, then the
 *                    next thing), so the widget's words stay true while the app is not opened; glanceAt is the glance as it reads
 *                    at a moment (the rule X0Glance.swift `asOf(_:)` and TailzuX0Widget.kt X0Doc apply), nextStepAt when it next changes
 *   glanceDue        whether to ask again now: the server's refreshAfterSec, sooner when something happened
 *   faceSources      the bot faces the widget will draw (face key → picture), and facesToFetch the ones not on the phone yet
 *   activityPlan     the "Bots at work" Live Activity (iOS) after a glance: start, update or end it, and what it shows
 */
import { isAppLink } from "./nowCore.ts";

export type GlanceCase = "needs" | "working" | "done" | "quiet";
export type BotState = "needs" | "working" | "done" | "failed" | "idle";

export interface GlanceBot {
  slug: string;
  name: string;
  /** "#RRGGBB", or null: the widget then uses its own colour for the slug. */
  color: string | null;
  /** A head key: the file faces/<face>.png (iOS) / widget-faces/<face>.png (Android). Null: a disc and the initial. */
  face: string | null;
  faceUrl: string | null;
  state: BotState;
  needs: number;
  working: boolean;
  line: string;
  link: string;
}

export interface GlanceChoice { id: string; label: string; primary?: boolean }

export interface GlanceItem {
  id: string;
  kind: string;
  bot: string;
  botName: string;
  face: string | null;
  question: string;
  choices: GlanceChoice[];
  decideLink: string;
  private: boolean;
  answerable: boolean;
  link: string;
}

export interface GlanceJob {
  id: string;
  bot: string;
  task: string;
  stage: number;
  of: number;
  stageName: string;
  stages: string[];
  startedAt: number;
  link: string;
}

export interface GlancePr { number: number; url: string }

export interface GlanceDone {
  id: string;
  bot: string;
  botName: string;
  result: string;
  endedAt: number;
  minutes: number;
  pr: GlancePr | null;
  link: string;
}

/**
 * A line that takes over at its own minute (only for a binary that asked for steps, device/binaryCore.ts GlanceSteps). From `at`
 * until the next step for the same bot, `line` is that bot's row line; from `at` until the next step with lock words, `lock` is
 * the lock screen's. A row that is asking, working or showing something done keeps its own line, and the lock screen keeps a
 * question's words while the widget leads with it: what needs the person beats the time of day.
 */
export interface GlanceStep {
  at: number;
  /** The bot whose row line it sets ("plan"), or "" for lock words alone. */
  bot: string;
  line: string;
  /** The lock screen's words from `at` on, or null: they stay as they were. */
  lock: { inline: string; title: string; line: string } | null;
}

export interface Glance {
  v: 2;
  at: number;
  refreshAfterSec: number;
  case: GlanceCase;
  greeting: { hello: string; line: string; part: string };
  summary: string;
  week: { done: number; minutesSaved: number; dots: number; line: string };
  bots: GlanceBot[];
  more: number;
  needs: { count: number; items: GlanceItem[] };
  job: GlanceJob | null;
  lastDone: GlanceDone | null;
  counts: { working: number; needs: number };
  lock: { inline: string; title: string; line: string };
  links: { ask: string; home: string; mic: string };
  words: Record<string, string>;
  /** Oldest first; empty for a server or a request without them. */
  steps: GlanceStep[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Cut to `max` characters at a word, never mid-word when a word break is near, "…" only when cut. Whitespace runs are one space. */
export function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  const room = chars.slice(0, Math.max(1, max - 1)).join("");
  const space = room.lastIndexOf(" ");
  const base = space >= Math.floor(max * 0.4) ? room.slice(0, space) : room;
  return base.replace(/[\s,.;:!?–—-]+$/u, "") + "…";
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? cut(v, max) : "");
const whole = (v: unknown, min: number, max: number, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const time = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const link = (v: unknown): string => (isAppLink(v) ? v : "");

/** A face key that is safe as a file name. */
export const FACE_KEY = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** What the widgets' answer path takes (TailzuWidgetActReceiver; the iOS widget's intent): the item and the answer. */
export const ITEM_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
export const CHOICE_ID = /^[a-z0-9_]{1,24}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HEX = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;
const STATES: BotState[] = ["needs", "working", "done", "failed", "idle"];
const CASES: GlanceCase[] = ["needs", "working", "done", "quiet"];

const face = (v: unknown): string | null => (typeof v === "string" && FACE_KEY.test(v) ? v : null);

/** A picture a face is downloaded from: https only, no credentials, no spaces. */
export function isFaceUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 600 || /[\s\\]/.test(v)) return false;
  const m = /^https:\/\/([^/?#@]+)(?:[/?#]|$)/i.exec(v);
  return !!m && !!m[1] && !m[1].startsWith(".");
}

/** A pull request's page: only on github.com, over https. */
export function isPrUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= 400 && !/[\s\\]/.test(v) && /^https:\/\/github\.com\/[^?#]+$/i.test(v);
}

function cleanBot(b: unknown): GlanceBot | null {
  if (!isObj(b) || typeof b.slug !== "string" || !SLUG.test(b.slug)) return null;
  const state = STATES.includes(b.state as BotState) ? (b.state as BotState) : "idle";
  return {
    slug: b.slug,
    name: text(b.name, 32) || b.slug,
    color: typeof b.color === "string" && HEX.test(b.color) ? b.color.slice(0, 7).toUpperCase() : null,
    face: face(b.face),
    faceUrl: isFaceUrl(b.faceUrl) ? b.faceUrl : null,
    state,
    needs: whole(b.needs, 0, 99),
    working: b.working === true || state === "working",
    line: text(b.line, 40),
    link: link(b.link),
  };
}

function cleanChoice(c: unknown): GlanceChoice | null {
  if (!isObj(c) || typeof c.id !== "string" || !CHOICE_ID.test(c.id)) return null;
  const label = text(c.label, 20);
  if (!label) return null;
  return c.primary === true ? { id: c.id, label, primary: true } : { id: c.id, label };
}

function cleanItem(i: unknown): GlanceItem | null {
  if (!isObj(i) || typeof i.id !== "string" || !ITEM_ID.test(i.id) || typeof i.kind !== "string" || !i.kind) return null;
  const choices = Array.isArray(i.choices) ? i.choices.map(cleanChoice).filter((c): c is GlanceChoice => !!c).slice(0, 3) : [];
  return {
    id: i.id,
    kind: text(i.kind, 24),
    bot: typeof i.bot === "string" && SLUG.test(i.bot) ? i.bot : "",
    botName: text(i.botName, 32),
    face: face(i.face),
    question: text(i.question, 100),
    choices,
    decideLink: link(i.decideLink),
    private: i.private === true,
    // Answered in place only when the server says so and there is an answer to give.
    answerable: i.answerable === true && choices.length > 0,
    link: link(i.link),
  };
}

function cleanJob(j: unknown): GlanceJob | null {
  if (!isObj(j) || typeof j.id !== "string" || !ITEM_ID.test(j.id)) return null;
  const stages = Array.isArray(j.stages) ? j.stages.filter((s): s is string => typeof s === "string").map((s) => cut(s, 16)).slice(0, 8) : [];
  const of = whole(j.of, 1, 8, stages.length || 1);
  return {
    id: j.id,
    bot: typeof j.bot === "string" && SLUG.test(j.bot) ? j.bot : "",
    task: text(j.task, 40),
    stage: whole(j.stage, 1, of, 1),
    of,
    stageName: text(j.stageName, 20),
    stages,
    startedAt: time(j.startedAt),
    link: link(j.link),
  };
}

function cleanDone(d: unknown): GlanceDone | null {
  if (!isObj(d) || typeof d.id !== "string" || !ITEM_ID.test(d.id)) return null;
  const pr = isObj(d.pr) && isPrUrl(d.pr.url) ? { number: whole(d.pr.number, 0, 1e9), url: d.pr.url } : null;
  return {
    id: d.id,
    bot: typeof d.bot === "string" && SLUG.test(d.bot) ? d.bot : "",
    botName: text(d.botName, 32),
    result: text(d.result, 50),
    endedAt: time(d.endedAt),
    minutes: whole(d.minutes, 0, 100_000),
    pr,
    link: link(d.link),
  };
}

function cleanWords(w: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(w)) return out;
  for (const [k, v] of Object.entries(w).slice(0, 60)) {
    if (/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k) && typeof v === "string" && v.trim()) out[k] = cut(v, 48);
  }
  return out;
}

/** How many steps a glance may carry, and how far past the glance's own time (the server writes a day or so ahead). */
export const STEPS_MAX = 16;
export const STEPS_AHEAD_MS = 48 * 3_600_000;

const cleanLock = (v: unknown): GlanceStep["lock"] => {
  if (!isObj(v)) return null;
  const lock = { inline: text(v.inline, 40), title: text(v.title, 60), line: text(v.line, 100) };
  return lock.inline || lock.title || lock.line ? lock : null;
};

/**
 * The steps a widget may be given: each with a time, setting a line of a bot the glance has or lock words, within
 * STEPS_AHEAD_MS of the glance's time; oldest first. Of those already begun by `now` only the last for each bot and the last
 * with lock words are kept (the rest can never show again); at most STEPS_MAX, the ones in force first.
 */
export function cleanSteps(v: unknown, bots: readonly GlanceBot[], at: number, now: number): GlanceStep[] {
  if (!Array.isArray(v)) return [];
  const slugs = new Set(bots.map((b) => b.slug));
  const all = v.slice(0, 64).map((s): GlanceStep | null => {
    if (!isObj(s)) return null;
    const when = time(s.at);
    if (!when || when > Math.max(at, now) + STEPS_AHEAD_MS) return null;
    const bot = typeof s.bot === "string" && slugs.has(s.bot) ? s.bot : "";
    const line = bot ? text(s.line, 40) : "";
    const lock = cleanLock(s.lock);
    if (!line && !lock) return null;
    return { at: when, bot: line ? bot : "", line, lock };
  }).filter((s): s is GlanceStep => !!s).sort((a, b) => a.at - b.at);
  const begun = all.filter((s) => s.at <= now);
  const keep = new Set<GlanceStep>();
  const lastLine = new Map<string, GlanceStep>();
  let lastLock: GlanceStep | null = null;
  for (const s of begun) {
    if (s.bot) lastLine.set(s.bot, s);
    if (s.lock) lastLock = s;
  }
  for (const s of lastLine.values()) keep.add(s);
  if (lastLock) keep.add(lastLock);
  // The latest begun step wins for a line and for the lock words alike (glanceAt), so the ones kept read as the whole list did.
  return [...begun.filter((s) => keep.has(s)), ...all.filter((s) => s.at > now)].slice(0, STEPS_MAX);
}

/** The glance as it reads at `t`: each idle row's line and the lock words from the latest of their steps begun by then. */
export function glanceAt(g: Glance, t: number): Glance {
  const due = g.steps.filter((s) => s.at <= t);
  if (due.length === 0) return g;
  const lineOf = (slug: string) => [...due].reverse().find((s) => s.bot === slug && s.line)?.line;
  const bots = g.bots.map((b) => {
    if (b.state !== "idle" || b.working) return b;
    const line = lineOf(b.slug);
    return line ? { ...b, line } : b;
  });
  const lock = g.case === "needs" ? null : [...due].reverse().find((s) => s.lock)?.lock ?? null;
  return { ...g, bots, ...(lock ? { lock } : {}) };
}

/** When the glance next reads differently on its own, or null. */
export function nextStepAt(g: Pick<Glance, "steps">, t: number): number | null {
  return g.steps.find((s) => s.at > t)?.at ?? null;
}

/** The case the contract's order picks: needs (count > 0) → done (lastDone) → working (a bot working or a job) → quiet. */
export function pickCase(g: Pick<Glance, "needs" | "lastDone" | "job" | "bots" | "counts">): GlanceCase {
  if (g.needs.count > 0 || g.needs.items.length > 0) return "needs";
  if (g.lastDone) return "done";
  if (g.job || g.counts.working > 0 || g.bots.some((b) => b.working)) return "working";
  return "quiet";
}

/** Whether the glance has what a case shows. */
function backs(c: GlanceCase, g: Pick<Glance, "needs" | "lastDone" | "job" | "bots" | "counts">): boolean {
  if (c === "needs") return g.needs.count > 0 || g.needs.items.length > 0;
  if (c === "done") return !!g.lastDone;
  if (c === "working") return !!g.job || g.counts.working > 0 || g.bots.some((b) => b.working);
  return true;
}

/** The glance a widget may be given, or null when it is not one this build reads. */
export function cleanGlance(doc: unknown, now = Date.now()): Glance | null {
  if (!isObj(doc) || doc.v !== 2) return null;
  const greeting = isObj(doc.greeting) ? doc.greeting : {};
  const week = isObj(doc.week) ? doc.week : {};
  const needs = isObj(doc.needs) ? doc.needs : {};
  const counts = isObj(doc.counts) ? doc.counts : {};
  const lock = isObj(doc.lock) ? doc.lock : {};
  const links = isObj(doc.links) ? doc.links : {};
  const bots = Array.isArray(doc.bots) ? doc.bots.map(cleanBot).filter((b): b is GlanceBot => !!b).slice(0, 8) : [];
  const items = Array.isArray(needs.items) ? needs.items.map(cleanItem).filter((i): i is GlanceItem => !!i).slice(0, 3) : [];
  const g: Omit<Glance, "case"> = {
    v: 2,
    at: time(doc.at) || now,
    refreshAfterSec: whole(doc.refreshAfterSec, 60, 86_400, 900),
    greeting: { hello: text(greeting.hello, 60), line: text(greeting.line, 100), part: text(greeting.part, 16) },
    summary: text(doc.summary, 72),
    week: {
      done: whole(week.done, 0, 100_000),
      minutesSaved: whole(week.minutesSaved, 0, 1_000_000),
      dots: whole(week.dots, 0, 5),
      line: text(week.line, 60),
    },
    bots,
    more: whole(doc.more, 0, 999),
    needs: { count: Math.max(whole(needs.count, 0, 999), items.length), items },
    job: cleanJob(doc.job),
    lastDone: cleanDone(doc.lastDone),
    counts: { working: whole(counts.working, 0, 999), needs: whole(counts.needs, 0, 999) },
    lock: { inline: text(lock.inline, 40), title: text(lock.title, 60), line: text(lock.line, 100) },
    links: { ask: link(links.ask), home: link(links.home), mic: link(links.mic) },
    words: cleanWords(doc.words),
    steps: cleanSteps(doc.steps, bots, time(doc.at) || now, now),
  };
  const said = CASES.includes(doc.case as GlanceCase) ? (doc.case as GlanceCase) : null;
  return { ...g, case: said && backs(said, g) ? said : pickCase(g) };
}

// ------------------------------------------------------------------ when to ask

/**
 * Whether to ask the server again now. "due": the server's refreshAfterSec has passed (launch, a bootstrap, coming to the
 * front). "soon": something may have changed (the app is leaving the front, so the widget is what the person sees next): at
 * most every `floorSec`. "force": something did change (a push, an answer).
 */
export function glanceDue(lastAt: number, now: number, refreshAfterSec: number, mode: "due" | "soon" | "force", floorSec = 15): boolean {
  if (mode === "force" || !lastAt) return true;
  const floor = Number.isFinite(floorSec) && floorSec >= 0 ? floorSec : 15;
  if (mode === "soon") return now - lastAt >= floor * 1000;
  const gap = Number.isFinite(refreshAfterSec) && refreshAfterSec > 0 ? refreshAfterSec : 900;
  return now - lastAt >= Math.max(floor, gap) * 1000;
}

// ------------------------------------------------------------------ faces

/** Every face the widget may draw, once each, with the picture it comes from. An answer's face takes its bot's picture. */
export function faceSources(g: Glance): Array<{ face: string; url: string }> {
  const out = new Map<string, string>();
  for (const b of g.bots) if (b.face && b.faceUrl && !out.has(b.face)) out.set(b.face, b.faceUrl);
  return [...out].map(([face, url]) => ({ face, url }));
}

/** The faces whose picture is not on the phone yet, or changed (a new ?v=). `have`: face → the url it was fetched from. */
export function facesToFetch(sources: Array<{ face: string; url: string }>, have: Record<string, string>): Array<{ face: string; url: string }> {
  return sources.filter((s) => have[s.face] !== s.url);
}

/** Whether downloaded bytes are a PNG of a sane size. */
export function isPng(bytes: Uint8Array, maxBytes = 1_000_000): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > sig.length && bytes.length <= maxBytes && sig.every((b, i) => bytes[i] === b);
}

// ------------------------------------------------------------------ the Live Activity (iOS)

/** The Live Activity's ContentState (contract §6), with the answer's item beside the question so it can be answered in place. */
export interface BotsActivityState {
  bot: string;
  botName: string;
  face: string | null;
  task: string;
  stage: number;
  of: number;
  stageName: string;
  stages: string[];
  startedAt: number;
  phase: "working" | "needs" | "done";
  question?: string;
  choices?: GlanceChoice[];
  /** The question's item (POST /v1/widgets/act { item, action }), its kind, and where "You decide" goes. */
  itemId?: string;
  itemKind?: string;
  decideLink?: string;
  result?: string;
  pr?: GlancePr;
  /** done: how long the job took, in minutes. */
  minutes?: number;
  link: string;
}

/** What crosses the bridge: the job, what to show, and for an end how long the done state stays (seconds; 0 = now). */
export interface BotsActivityRequest {
  jobId: string;
  state: BotsActivityState;
  dismissAfterSec?: number;
}

export type ActivityOp = { op: "start" | "update" | "end" } & BotsActivityRequest;

/** What the app remembers of the activity it started: which job, and what it last showed. */
export interface ActivityMemo { jobId: string; state: BotsActivityState }

const botName = (g: Glance, slug: string, fallback = ""): string => g.bots.find((b) => b.slug === slug)?.name || fallback || slug;
const botFace = (g: Glance, slug: string): string | null => g.bots.find((b) => b.slug === slug)?.face ?? null;

/** The running job as the activity shows it; "needs" when its bot is waiting on the person (a private question shows no words). */
export function activityState(g: Glance): BotsActivityState | null {
  const j = g.job;
  if (!j) return null;
  const s: BotsActivityState = {
    bot: j.bot,
    botName: botName(g, j.bot),
    face: botFace(g, j.bot),
    task: j.task,
    stage: j.stage,
    of: j.of,
    stageName: j.stageName,
    stages: j.stages,
    startedAt: j.startedAt,
    phase: "working",
    link: j.link,
  };
  const item = g.needs.items.find((i) => i.bot === j.bot);
  if (!item) return s;
  return {
    ...s,
    phase: "needs",
    itemId: item.id,
    itemKind: item.kind,
    ...(item.decideLink ? { decideLink: item.decideLink } : {}),
    ...(item.private ? {} : { question: item.question, choices: item.choices }),
  };
}

/** The finished job's state: every stage done, what it finished, its PR. */
function doneState(g: Glance, last: BotsActivityState): BotsActivityState {
  const d = g.lastDone!;
  return {
    bot: last.bot,
    botName: last.botName,
    face: last.face,
    task: last.task,
    stage: last.of,
    of: last.of,
    stageName: last.stageName,
    stages: last.stages,
    startedAt: last.startedAt,
    phase: "done",
    result: d.result,
    ...(d.pr ? { pr: d.pr } : {}),
    ...(d.minutes > 0 ? { minutes: d.minutes } : {}),
    link: d.link || last.link,
  };
}

const same = (a: BotsActivityState, b: BotsActivityState): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The activity after a glance (contract §6): started when there is a job and none is running for it; updated whenever what it
 * shows changed; ended on the job's lastDone, showing the done state until `doneSec` after the job ended (15 min), or at once
 * when the job went without one (cancelled, failed, already seen).
 */
export function activityPlan(g: Glance, memo: ActivityMemo | null, now: number, doneSec = 900): { ops: ActivityOp[]; memo: ActivityMemo | null } {
  const ops: ActivityOp[] = [];
  const end = (m: ActivityMemo) => {
    if (g.lastDone && g.lastDone.id === m.jobId) {
      const left = g.lastDone.endedAt ? Math.round(doneSec - (now - g.lastDone.endedAt) / 1000) : doneSec;
      ops.push({ op: "end", jobId: m.jobId, state: doneState(g, m.state), dismissAfterSec: Math.max(0, Math.min(doneSec, left)) });
    } else {
      ops.push({ op: "end", jobId: m.jobId, state: m.state, dismissAfterSec: 0 });
    }
  };
  const state = activityState(g);
  if (!state || !g.job) {
    if (memo) end(memo);
    return { ops, memo: null };
  }
  if (memo && memo.jobId === g.job.id) {
    if (!same(memo.state, state)) ops.push({ op: "update", jobId: g.job.id, state });
    return { ops, memo: { jobId: g.job.id, state } };
  }
  if (memo) end(memo);
  ops.push({ op: "start", jobId: g.job.id, state });
  return { ops, memo: { jobId: g.job.id, state } };
}
