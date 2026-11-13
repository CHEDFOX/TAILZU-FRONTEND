/**
 * ONE INPUT NODE, MANY KINDS — the part that is not pixels (pure/SPEC.md 2.8, B8).
 *
 * Every value a person types, drags or picks passes through here before it reaches the screen's store: trimmed of the
 * characters that have no business in a value, capped at a length, clamped to a range, and shaped to one written
 * format per kind so the server always reads the same thing.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP (pure/SPEC.md 2.2, principle 4):
 *   - what a person writes is DATA. It is never parsed, never filled, never evaluated. `{{ state.token }}` typed into
 *     a note stays those nineteen characters all the way to the server.
 *   - what a person writes is never longer than the cap, so one held key cannot grow a screen's store without end.
 *
 * Pure: no React, no react-native, runs under `node --test`.
 */

/** The kinds, by wave (pure/SPEC.md 2.8). `multiline` and `toggle` are the server kit's older names for two of them. */
export const INPUT_KINDS_WAVE1 = ["text", "multiline", "number", "code", "search", "switch", "toggle", "slider", "segmented", "slideToConfirm"] as const;
export const INPUT_KINDS_WAVE2 = ["stepper", "picker", "date", "time", "rating", "chips"] as const;
export const INPUT_KINDS = [...INPUT_KINDS_WAVE1, ...INPUT_KINDS_WAVE2] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** pure/SPEC.md 5.1: a prop is at most 8 KB, and no input writes more than that. Each kind narrows it further. */
export const INPUT_LIMITS = {
  /** Characters a text value may hold. */
  textMax: 8192,
  /** Characters a one-line value may hold unless the node asks for fewer. */
  lineMax: 512,
  /** Characters of a search query. */
  searchMax: 128,
  /** Digits or letters in a code. */
  codeMax: 12,
  /** Chips in one field. */
  chipsMax: 32,
  /** Characters in one chip. */
  chipMax: 64,
  /** Options a picker or a segmented control may offer. */
  optionsMax: 64,
  /** Stars a rating may offer. */
  ratingMax: 10,
} as const;

/** The kind a node asked for, or null when it is not one we draw (the node then falls back). */
export function inputKind(raw: unknown): InputKind | null {
  return typeof raw === "string" && (INPUT_KINDS as readonly string[]).includes(raw) ? (raw as InputKind) : null;
}

/**
 * Characters taken out of every value, whatever the kind.
 *
 * Control characters (a paste from a terminal, a stray \u0000), and the bidirectional overrides, which can make a
 * value read on screen as the reverse of what is stored — a real trick against anyone approving what they see.
 * Newlines survive only where the kind allows them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/g;

/** A line's worth of text: no newlines, no control characters, capped. The text itself is untouched. */
export function sanitizeLine(raw: unknown, max: number = INPUT_LIMITS.lineMax): string {
  const s = raw == null ? "" : String(raw);
  const cap = Math.max(0, Math.min(INPUT_LIMITS.textMax, Math.floor(max) || 0));
  return s.replace(/[\r\n\t]+/g, " ").replace(CONTROL, "").slice(0, cap);
}

/** Several lines: newlines kept (\r\n folded to \n), everything else as above. */
export function sanitizeText(raw: unknown, max: number = INPUT_LIMITS.textMax): string {
  const s = raw == null ? "" : String(raw);
  const cap = Math.max(0, Math.min(INPUT_LIMITS.textMax, Math.floor(max) || 0));
  return s.replace(/\r\n?/g, "\n").replace(CONTROL, "").slice(0, cap);
}

/** A search box: one line, short, and with the leading and trailing spaces gone. */
export function sanitizeSearch(raw: unknown, max: number = INPUT_LIMITS.searchMax): string {
  return sanitizeLine(raw, Math.min(max, INPUT_LIMITS.searchMax)).replace(/\s+/g, " ").trimStart();
}

/**
 * A code (an OTP, a join code): the letters and digits only, upper case, capped at the length asked for.
 *
 * `7KQ-29D` typed with its dash, or pasted with spaces from a message, becomes `7KQ29D`, so the screen can compare it
 * to what it was sent without knowing how it was typed.
 */
export function sanitizeCode(raw: unknown, length: number = 6, digitsOnly = false): string {
  const cap = Math.max(1, Math.min(INPUT_LIMITS.codeMax, Math.floor(length) || 1));
  const keep = digitsOnly ? /[^0-9]/g : /[^0-9a-z]/gi;
  return String(raw ?? "").replace(keep, "").toUpperCase().slice(0, cap);
}

/** What a number field holds while it is being typed, and the number it stands for (NaN while it is not one yet). */
export interface NumberValue {
  /** What is drawn in the field. "-" and "1." are kept, so a number can be typed from the left. */
  text: string;
  /** The value for the store, or null while the text is not a number. */
  value: number | null;
}

export interface NumberShape {
  min?: number;
  max?: number;
  /** Digits after the point. 0 means whole numbers, and the point itself is refused. */
  decimals?: number;
  /** Below zero allowed. Default: only when `min` is below zero. */
  negative?: boolean;
}

/** A number as it is typed: digits, one point, one leading minus; clamped only once it is a number. */
export function sanitizeNumber(raw: unknown, shape: NumberShape = {}): NumberValue {
  const decimals = Number.isFinite(shape.decimals) ? Math.max(0, Math.min(6, Math.floor(shape.decimals!))) : 2;
  const negative = shape.negative ?? (Number.isFinite(shape.min) ? shape.min! < 0 : false);
  let s = String(raw ?? "").replace(/[^0-9.\-]/g, "");
  const neg = negative && s.startsWith("-");
  s = s.replace(/-/g, "");
  if (decimals === 0) s = s.replace(/\./g, "");
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "").slice(0, decimals);
  s = (neg ? "-" : "") + s;
  if (s === "" || s === "-" || s === "." || s === "-.") return { text: s, value: null };
  const n = Number(s);
  if (!Number.isFinite(n)) return { text: s, value: null };
  return { text: s, value: clampRange(n, shape.min, shape.max) };
}

/** `n` inside `min`..`max` when either is a real number. A non-finite number is 0 (pure/SPEC.md 5.4). */
export function clampRange(n: unknown, min?: number, max?: number): number {
  let v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) v = 0;
  if (Number.isFinite(min) && v < min!) v = min!;
  if (Number.isFinite(max) && v > max!) v = max!;
  return v;
}

/** A slider's value: inside its range, on its step, and rounded so 0.30000000000000004 never reaches the store. */
export function clampStep(value: unknown, min = 0, max = 1, step = 0): number {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max > lo ? max : lo + 1;
  const v = clampRange(value, lo, hi);
  const s = Number.isFinite(step) && step > 0 ? step : 0;
  if (!s) return round6(v);
  const snapped = lo + Math.round((v - lo) / s) * s;
  return round6(clampRange(snapped, lo, hi));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Where a value sits in its range, 0 to 1 — what a slider track draws. */
export function fraction(value: number, min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return clampRange((value - min) / span, 0, 1);
}

/** The value a finger at `x` means on a track `width` wide, with a knob `knob` wide. */
export function valueAtX(x: number, width: number, knob: number, min: number, max: number, step: number): number {
  const travel = Math.max(1, width - knob);
  const k = clampRange((x - knob / 2) / travel, 0, 1);
  return clampStep(min + k * (max - min), min, max, step);
}

/** A stepper's next value. */
export function stepped(value: unknown, dir: 1 | -1, min = 0, max = 100, step = 1): number {
  const s = Number.isFinite(step) && step > 0 ? step : 1;
  return clampStep(clampRange(value, min, max) + dir * s, min, max, s);
}

/** A rating: a whole number of stars, never more than there are. */
export function clampRating(value: unknown, stars: number = 5): number {
  const max = Math.max(1, Math.min(INPUT_LIMITS.ratingMax, Math.floor(stars) || 5));
  return Math.round(clampRange(value, 0, max));
}

/** One choice in a picker or a segmented control. */
export interface Option {
  value: string;
  label: string;
}

/**
 * The options a node offers, as `{value,label}` pairs.
 *
 * The server may send plain strings, or objects with `value`/`label`, or `id`/`title` (the kit's older shape). Each
 * label is one sanitized line, because an option's words can come from a person's own data (a space's name).
 */
export function options(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return [];
  const out: Option[] = [];
  // A value is what gets stored and what keys the row, so the same one twice is one option: the second would be an
  // unreachable duplicate key, and `chosen()` could only ever find the first anyway.
  const seen = new Set<string>();
  const add = (value: string, label: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, label });
  };
  for (const o of raw.slice(0, INPUT_LIMITS.optionsMax)) {
    if (typeof o === "string" || typeof o === "number") {
      const v = sanitizeLine(o, INPUT_LIMITS.chipMax);
      add(v, v);
      continue;
    }
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const value = sanitizeLine(r.value ?? r.id ?? r.key ?? "", INPUT_LIMITS.chipMax);
    add(value, sanitizeLine(r.label ?? r.title ?? r.name ?? value, INPUT_LIMITS.chipMax) || value);
  }
  return out;
}

/** The option a value names, or null. A value the list does not hold is not chosen — the server's default is not forced. */
export function chosen(list: readonly Option[], value: unknown): Option | null {
  const v = typeof value === "string" || typeof value === "number" ? String(value) : null;
  if (v === null) return null;
  return list.find((o) => o.value === v) ?? null;
}

/** The chips held now: each one line, each unique, capped. */
export function chipList(raw: unknown, max: number = INPUT_LIMITS.chipsMax): string[] {
  const cap = Math.max(0, Math.min(INPUT_LIMITS.chipsMax, Math.floor(max) || 0));
  const from = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? raw.split(",") : [];
  const out: string[] = [];
  for (const c of from) {
    const s = sanitizeLine(c, INPUT_LIMITS.chipMax).trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** The chips after one is typed in. Unchanged when it is empty, already there, or the field is full. */
export function chipAdded(held: readonly string[], text: unknown, max: number = INPUT_LIMITS.chipsMax): string[] {
  const list = chipList(held, max);
  const s = sanitizeLine(text, INPUT_LIMITS.chipMax).trim();
  if (!s || list.includes(s) || list.length >= Math.min(INPUT_LIMITS.chipsMax, max)) return list;
  return [...list, s];
}

/** The chips after one is taken out. */
export function chipRemoved(held: readonly string[], value: string): string[] {
  return chipList(held).filter((c) => c !== value);
}

/**
 * DATES AND TIMES ARE WRITTEN ONE WAY.
 *
 * `date` is `YYYY-MM-DD`, `time` is `HH:MM` on a 24-hour clock. Both are what the person chose where they are
 * standing — no zone, no instant, because "the 3rd" does not change when a plane lands. A screen that needs an instant
 * sends the zone itself.
 */
export type DateMode = "date" | "time";

/** `YYYY-MM-DD` for a year, month (1-12) and day. Days past the month's end are pulled back to it. */
export function dateValue(year: number, month: number, day: number): string {
  const y = Math.min(9999, Math.max(1, Math.floor(year) || 1));
  const m = Math.min(12, Math.max(1, Math.floor(month) || 1));
  const d = Math.min(daysInMonth(y, m), Math.max(1, Math.floor(day) || 1));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `HH:MM`, 24-hour. */
export function timeValue(hour: number, minute: number): string {
  const h = Math.min(23, Math.max(0, Math.floor(hour) || 0));
  const m = Math.min(59, Math.max(0, Math.floor(minute) || 0));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Days in a month, leap years included. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The day of the week the 1st falls on, 0 = Sunday (Zeller, so no Date object and no zone). */
export function firstWeekday(year: number, month: number): number {
  const m = month < 3 ? month + 12 : month;
  const y = month < 3 ? year - 1 : year;
  const k = y % 100, j = Math.floor(y / 100);
  const h = (1 + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7;
}

/** A `YYYY-MM-DD` the server or the store holds, read back. Null when it is not one. */
export function parseDate(raw: unknown): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** An `HH:MM` read back. Null when it is not one. `9:05` is read too, because a server kit wrote it that way once. */
export function parseTime(raw: unknown): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** The grid a month is drawn on: leading blanks, then the days. */
export function monthGrid(year: number, month: number): (number | null)[] {
  const lead = firstWeekday(year, month);
  const days = daysInMonth(year, month);
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** The month before or after this one, year rolled. */
export function monthStep(year: number, month: number, dir: 1 | -1): { year: number; month: number } {
  const m = month + dir;
  if (m < 1) return { year: year - 1, month: 12 };
  if (m > 12) return { year: year + 1, month: 1 };
  return { year, month: m };
}

/** Anything truthy from a server, a store or a tap, as a boolean. "false" and "0" are false, as a person would read them. */
export function asSwitch(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") return !["", "0", "false", "no", "off"].includes(raw.trim().toLowerCase());
  return Boolean(raw);
}

/** How far across a slide-to-confirm must go: the node's own, else nine tenths. Never below half. */
export const SLIDE_THRESHOLD = { min: 0.5, max: 1, fallback: 0.9 } as const;

/**
 * The threshold a slide-to-confirm commits at.
 *
 * This is the one control meant to stop a confirm by a brush of a sleeve, so a missing, null or garbled value falls
 * back to nine tenths, not to the loosest setting the clamp allows. Half is the floor: anything under that is not a
 * deliberate slide.
 */
export function slideThreshold(raw: unknown): number {
  const t = Number(raw);
  if (!Number.isFinite(t) || t <= 0) return SLIDE_THRESHOLD.fallback;
  return Math.min(SLIDE_THRESHOLD.max, Math.max(SLIDE_THRESHOLD.min, t));
}

/** A slide-to-confirm: how far along it is, and whether that is far enough to count. */
export function slideCommitted(progress: number, threshold: unknown = SLIDE_THRESHOLD.fallback): boolean {
  const p = Number(progress);
  if (!Number.isFinite(p)) return false;
  return clampRange(p, 0, 1) >= slideThreshold(threshold);
}

/** How far the knob of a slide-to-confirm can travel: the pill's width, less the knob and its inset. */
export function slideTravel(width: unknown, knob: unknown, inset = 8): number {
  const w = Number(width);
  const k = Number(knob);
  const i = Number(inset);
  if (!Number.isFinite(w) || !Number.isFinite(k) || !Number.isFinite(i)) return 1;
  return Math.max(1, w - k - i);
}

/**
 * Where a picker column scrolls to so the chosen row sits in the middle of the window.
 *
 * The hour and minute columns are short windows over tall lists; opening them at the top means the time already
 * chosen is usually out of sight.
 */
export function columnOffset(index: unknown, rowHeight: unknown, viewHeight: unknown): number {
  const i = Number(index);
  const row = Number(rowHeight);
  const view = Number(viewHeight);
  if (!Number.isFinite(i) || i < 0 || !Number.isFinite(row) || row <= 0) return 0;
  const middle = Number.isFinite(view) && view > row ? (view - row) / 2 : 0;
  return Math.max(0, Math.round(i * row - middle));
}

/**
 * THE VALUE THAT GOES INTO THE STORE, by kind.
 *
 * One place, so every kind's written format is visible at once and the server can rely on it. Text kinds give text,
 * number kinds give a number or null, switch gives a boolean, chips gives an array of strings, date and time give
 * their written forms.
 */
export function valueForStore(kind: InputKind, raw: unknown, shape: Record<string, unknown> = {}): unknown {
  switch (kind) {
    case "text":
      return sanitizeLine(raw, numberProp(shape.maxLength, INPUT_LIMITS.lineMax));
    case "multiline":
      return sanitizeText(raw, numberProp(shape.maxLength, INPUT_LIMITS.textMax));
    case "search":
      return sanitizeSearch(raw, numberProp(shape.maxLength, INPUT_LIMITS.searchMax));
    case "code":
      return sanitizeCode(raw, numberProp(shape.length, 6), shape.digitsOnly === true);
    case "number":
      return sanitizeNumber(raw, {
        min: optionalNumber(shape.min),
        max: optionalNumber(shape.max),
        decimals: optionalNumber(shape.decimals),
      }).value;
    case "switch":
    case "toggle":
      return asSwitch(raw);
    case "slider":
      return clampStep(raw, numberProp(shape.min, 0), numberProp(shape.max, 1), numberProp(shape.step, 0));
    case "stepper":
      return clampStep(raw, numberProp(shape.min, 0), numberProp(shape.max, 100), numberProp(shape.step, 1));
    case "rating":
      return clampRating(raw, numberProp(shape.stars, 5));
    case "segmented":
    case "picker":
      return chosen(options(shape.options), raw)?.value ?? null;
    case "chips":
      return chipList(raw, numberProp(shape.max, INPUT_LIMITS.chipsMax));
    case "date":
      return parseDate(raw) ? String(raw).trim() : null;
    case "time":
      return parseTime(raw) ? timeValue(parseTime(raw)!.hour, parseTime(raw)!.minute) : null;
    case "slideToConfirm":
      return asSwitch(raw);
    default:
      return null;
  }
}

function numberProp(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function optionalNumber(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
