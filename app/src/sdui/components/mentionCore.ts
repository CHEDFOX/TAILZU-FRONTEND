/**
 * THE @ AND / OF A MESSAGE FIELD (MentionField.tsx), pure: no React Native, tested in Node. The window's mention.js does
 * the same; keep the two alike.
 *
 * The field holds its words and at most two chips: a person (picked with "@") and a thing from one of the person's bots
 * (picked with "/", a bot, then one of its things). "@" or "/" typed at the start or after a space opens its list, filtered
 * by what is typed after it; a pick takes the "@wo" or "/wo" out of the words. Backspace in an empty field takes the last
 * chip off. What the field says (MentionDraft) is its words without the chips, and the chips' ids and names.
 *
 * Sending "@name" typed out: with no person chip, words that start with "@word" become that person's chip when exactly one
 * person's first name is the word (any case); when more than one is, the People list opens filtered to it and nothing is
 * sent. So "@mom see you at 7" never goes to everyone because the list was skipped (the server asks too: spaceFeed.ts).
 */

export interface Person { id: string; name: string }
export interface BotRef { slug: string; name: string; color: string; kind: string }
export interface Thing { id: string; title: string; line: string }

export type Menu =
  | { kind: "people"; query: string; start: number; end: number }
  | { kind: "bots"; query: string; start: number; end: number }
  | { kind: "things"; bot: string; botName: string };

export interface MentionState {
  text: string;
  person: Person | null;
  thing: { bot: string; botName: string; id: string; title: string } | null;
  menu: Menu | null;
}

export interface MentionDraft {
  text: string;
  toId: string; toName: string;
  bot: string; botName: string; thingId: string; thingTitle: string;
}

export const EMPTY: MentionState = { text: "", person: null, thing: null, menu: null };

/** The word the caret is at the end of: from the last space before it (or the start) to the caret. */
export function tokenAt(text: string, caret: number): { start: number; end: number; word: string } {
  const end = Math.max(0, Math.min(text.length, caret));
  let start = end;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  return { start, end, word: text.slice(start, end) };
}

/**
 * The words changed (the caret at `caret`; none given: the end). "@" (with no person chip yet) or "/" at the start of the
 * word the caret is in opens its list, filtered by what follows; any other word closes it. A bot's things stay open until a
 * pick, Escape or another "@" or "/".
 */
export function typed(s: MentionState, text: string, caret = text.length): MentionState {
  const t = tokenAt(text, caret);
  let menu: Menu | null = s.menu && s.menu.kind === "things" ? s.menu : null;
  if (t.word.startsWith("@") && !s.person) menu = { kind: "people", query: t.word.slice(1), start: t.start, end: t.end };
  else if (t.word.startsWith("/")) menu = { kind: "bots", query: t.word.slice(1), start: t.start, end: t.end };
  return { ...s, text, menu };
}

const lc = (v: string) => v.toLocaleLowerCase();

/** The people whose name, or a word of it, starts with the query (any case); all of them for none. */
export function filterPeople(people: Person[], query: string): Person[] {
  const q = lc(query.trim());
  if (!q) return people;
  return people.filter((p) => lc(p.name).split(/\s+/).some((w) => w.startsWith(q)) || lc(p.name).startsWith(q));
}

/** The bots whose name starts with the query, or holds it (any case). */
export function filterBots(bots: BotRef[], query: string): BotRef[] {
  const q = lc(query.trim());
  if (!q) return bots;
  return bots.filter((b) => lc(b.name).includes(q) || lc(b.slug).startsWith(q));
}

/** The words with the trigger's "@wo" or "/wo" taken out (and the space after it, so no double space is left). */
function cut(text: string, start: number, end: number): string {
  let e = end;
  if (text[e] === " " && (start === 0 || text[start - 1] === " ")) e++;
  return text.slice(0, start) + text.slice(e);
}

export function pickPerson(s: MentionState, p: Person): MentionState {
  const m = s.menu;
  const text = m && m.kind === "people" ? cut(s.text, m.start, m.end) : s.text;
  return { ...s, text, person: { id: p.id, name: p.name }, menu: null };
}

/** A bot picked from "/": its "/wo" goes and its things open. */
export function pickBot(s: MentionState, b: BotRef): MentionState {
  const m = s.menu;
  const text = m && m.kind === "bots" ? cut(s.text, m.start, m.end) : s.text;
  return { ...s, text, menu: { kind: "things", bot: b.slug, botName: b.name } };
}

/** A tool picked from "/" (Ask for money…): its "/wo" goes and the list closes; the tool's action runs. */
export function pickTool(s: MentionState): MentionState {
  const m = s.menu;
  const text = m && m.kind === "bots" ? cut(s.text, m.start, m.end) : s.text;
  return { ...s, text, menu: null };
}

export function pickThing(s: MentionState, t: Thing): MentionState {
  const m = s.menu;
  if (!m || m.kind !== "things") return s;
  return { ...s, thing: { bot: m.bot, botName: m.botName, id: t.id, title: t.title }, menu: null };
}

/** Escape: a bot's things go back to the bots, any other list closes. */
export function escape(s: MentionState): MentionState {
  if (s.menu?.kind === "things") return { ...s, menu: { kind: "bots", query: "", start: s.text.length, end: s.text.length } };
  return { ...s, menu: null };
}

/** Backspace in an empty field: the last chip comes off (the thing, then the person). */
export function backspace(s: MentionState): MentionState {
  if (s.text) return s;
  if (s.thing) return { ...s, thing: null };
  if (s.person) return { ...s, person: null };
  return s;
}

export function draftOf(s: MentionState): MentionDraft {
  return {
    text: s.text.trim(),
    toId: s.person?.id ?? "", toName: s.person?.name ?? "",
    bot: s.thing?.bot ?? "", botName: s.thing?.botName ?? "", thingId: s.thing?.id ?? "", thingTitle: s.thing?.title ?? "",
  };
}

/** The field from what a draft says (the box opened again with words in it). */
export function fromDraft(d: unknown): MentionState {
  const o = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return {
    text: str("text"),
    person: str("toId") ? { id: str("toId"), name: str("toName") } : null,
    thing: str("thingId") && str("bot") ? { bot: str("bot"), botName: str("botName"), id: str("thingId"), title: str("thingTitle") } : null,
    menu: null,
  };
}

/** A draft that says nothing: no words, no person, no thing (or none at all). */
export function isEmptyDraft(d: unknown): boolean {
  const s = fromDraft(d);
  return !s.text.trim() && !s.person && !s.thing;
}

/** Something to send: words or a thing. */
export function canSend(s: MentionState): boolean {
  return !!s.text.trim() || !!s.thing;
}

/**
 * Enter or the send button. Words starting with "@word" and no person chip: one person whose first name is the word becomes
 * the chip (the "@word" out of the words) and it is sent; more than one opens the People list filtered to the word, and
 * nothing is sent; nobody: sent as words.
 */
export function atSubmit(s: MentionState, people: Person[]): { send: boolean; state: MentionState } {
  if (s.person) return { send: true, state: { ...s, menu: null } };
  const m = /^@(\S+)/.exec(s.text.trimStart());
  if (!m) return { send: true, state: { ...s, menu: null } };
  const word = lc(m[1]!.replace(/[.,!?;:]+$/, ""));
  const hits = people.filter((p) => lc(p.name.trim().split(/\s+/)[0] ?? "") === word);
  if (hits.length === 1) {
    const lead = s.text.length - s.text.trimStart().length;
    const at = lead, end = lead + m[0].length;
    return { send: true, state: { ...s, text: cut(s.text, at, end).trimStart(), person: { id: hits[0]!.id, name: hits[0]!.name }, menu: null } };
  }
  if (hits.length > 1) {
    const lead = s.text.length - s.text.trimStart().length;
    return { send: false, state: { ...s, menu: { kind: "people", query: m[1]!, start: lead, end: lead + m[0].length } } };
  }
  return { send: true, state: { ...s, menu: null } };
}
