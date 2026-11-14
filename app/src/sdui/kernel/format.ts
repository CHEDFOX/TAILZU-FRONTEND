/**
 * THE FORMATTING HELPERS a screen may call (pure SPEC 2.2, the `fmt.*` functions).
 *
 * These are the only way a screen turns a number or a time into words, so "3 of 5 done", "2 min ago" and a call's
 * running clock are server data and not another app build. Everything here is a plain function over plain values
 * plus an environment (the locale, what time it is now, which zone) — no clock of its own, so a test can pin it.
 *
 * Times are MILLISECONDS everywhere in this kernel, to match `now()` and the rule timers. A time may also arrive as
 * an ISO string, which is what the server sends.
 *
 * `Intl` is used when the build has it, and every call falls back to plain English, because a formatter throwing
 * would take a screen down for a label.
 */

/** What the renderer hands the formatters. */
export interface FormatEnv {
  /** The device's locale, e.g. "en-IN". */
  locale: string;
  /** What time it is, in milliseconds. */
  now: number;
  /** The zone dates are drawn in. The device's own when the renderer does not say. */
  timeZone?: string;
  /** False turns `Intl` off, for a build without it and for tests of the plain path. */
  intl?: boolean;
}

/** A quiet environment for tests and for anything that only needs a number formatted. */
export const PLAIN_ENV: FormatEnv = Object.freeze({ locale: "en-US", now: 0, timeZone: "UTC", intl: true });

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Anything not a finite number becomes 0, as everywhere else in the kernel. */
export function finite(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** A time as milliseconds: a number stays, an ISO string is parsed, anything else is null. */
export function millisOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.length > 0) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** True when this build can format with `Intl` and the environment allows it. */
function useIntl(env: FormatEnv): boolean {
  return env.intl !== false && typeof Intl !== "undefined";
}

/** The `Intl` objects these helpers build. */
type AnyFormat = Intl.NumberFormat | Intl.PluralRules | Intl.RelativeTimeFormat | Intl.DateTimeFormat;

/**
 * Built `Intl` objects, kept by what was asked for. Building one costs about twenty microseconds and formatting
 * with it costs well under one, so a hundred-row list on a one-second tick would spend most of its time in
 * constructors. A build that lacks a formatter is remembered as `null`, so a missing `RelativeTimeFormat` is not
 * thrown and caught on every label.
 *
 * Bounded: a phone has one locale, so a handful of entries covers everything. Past the bound the whole thing is
 * dropped rather than half-kept, which is one line and cannot leak.
 */
const FORMATTERS = new Map<string, AnyFormat | null>();
const FORMATTERS_MAX = 32;

function cachedFormat<T extends AnyFormat>(kind: string, locale: string, opts: unknown, make: () => T): T | null {
  const key = `${kind}|${locale}|${opts === undefined ? "" : JSON.stringify(opts)}`;
  const had = FORMATTERS.get(key);
  if (had !== undefined) return had as T | null;
  let made: T | null = null;
  try {
    made = make();
  } catch {
    made = null;
  }
  if (FORMATTERS.size >= FORMATTERS_MAX) FORMATTERS.clear();
  FORMATTERS.set(key, made);
  return made;
}

/** Thousands separators by hand, for a build with no `Intl`. */
function groupPlain(s: string): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? "" : body.slice(dot);
  let out = "";
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ",";
    out += whole[i];
  }
  return (neg ? "-" : "") + out + rest;
}

/** A number with its grouping. `digits` fixes the decimals when it is given. */
export function fmtNumber(value: unknown, digits?: unknown, env: FormatEnv = PLAIN_ENV): string {
  const n = finite(value);
  const d = digits === undefined || digits === null ? null : Math.max(0, Math.min(8, Math.round(finite(digits))));
  if (useIntl(env)) {
    const opts = d === null ? {} : { minimumFractionDigits: d, maximumFractionDigits: d };
    const f = cachedFormat("number", env.locale, opts, () => new Intl.NumberFormat(env.locale, opts));
    if (f) {
      try {
        return (f as Intl.NumberFormat).format(n);
      } catch {
        // falls through to the plain path
      }
    }
  }
  return groupPlain(d === null ? String(n) : n.toFixed(d));
}

/** An amount of money. The code is a currency code such as "INR"; an unknown one is simply put in front. */
export function fmtCurrency(value: unknown, code: unknown, env: FormatEnv = PLAIN_ENV): string {
  const n = finite(value);
  const c = typeof code === "string" && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : "";
  if (c && useIntl(env)) {
    const opts = { style: "currency" as const, currency: c };
    const f = cachedFormat("currency", env.locale, opts, () => new Intl.NumberFormat(env.locale, opts));
    if (f) {
      try {
        return (f as Intl.NumberFormat).format(n);
      } catch {
        // falls through to the plain path
      }
    }
  }
  const body = fmtNumber(n, 2, { ...env, intl: false });
  return c ? `${c} ${body}` : body;
}

/**
 * One of two words by the count. `#` in either word becomes the number: `fmt.plural(n, "# note", "# notes")`.
 * `Intl.PluralRules` picks between them where a language disagrees with English about 0 or 1.
 */
export function fmtPlural(count: unknown, one: unknown, other: unknown, env: FormatEnv = PLAIN_ENV): string {
  const n = finite(count);
  const a = typeof one === "string" ? one : "";
  const b = typeof other === "string" ? other : "";
  let pick = Math.abs(n) === 1 ? a : b;
  if (useIntl(env)) {
    const f = cachedFormat("plural", env.locale, undefined, () => new Intl.PluralRules(env.locale));
    if (f) {
      try {
        pick = (f as Intl.PluralRules).select(n) === "one" ? a : b;
      } catch {
        // keeps the English choice
      }
    }
  }
  return pick.includes("#") ? pick.split("#").join(fmtNumber(n, undefined, env)) : pick;
}

/** The unit a gap is best said in, and how many of it. */
function relUnit(ms: number): { unit: "second" | "minute" | "hour" | "day" | "week" | "month" | "year"; n: number } {
  const a = Math.abs(ms);
  if (a < MINUTE) return { unit: "second", n: Math.round(ms / SECOND) };
  if (a < HOUR) return { unit: "minute", n: Math.round(ms / MINUTE) };
  if (a < DAY) return { unit: "hour", n: Math.round(ms / HOUR) };
  if (a < WEEK) return { unit: "day", n: Math.round(ms / DAY) };
  if (a < 30 * DAY) return { unit: "week", n: Math.round(ms / WEEK) };
  if (a < 365 * DAY) return { unit: "month", n: Math.round(ms / (30 * DAY)) };
  return { unit: "year", n: Math.round(ms / (365 * DAY)) };
}

const SHORT_UNIT: Record<string, string> = { second: "s", minute: "min", hour: "h", day: "d", week: "w", month: "mo", year: "y" };

/** "just now", "5 min ago", "in 2 h". `when` is a time, not a gap. */
export function fmtRelative(when: unknown, env: FormatEnv = PLAIN_ENV): string {
  const t = millisOf(when);
  if (t === null) return "";
  const gap = t - env.now;
  if (Math.abs(gap) < 45 * SECOND) return "just now";
  const { unit, n } = relUnit(gap);
  if (useIntl(env)) {
    const opts = { numeric: "auto" as const };
    const f = cachedFormat("relative", env.locale, opts, () => new Intl.RelativeTimeFormat(env.locale, opts));
    if (f) {
      try {
        return (f as Intl.RelativeTimeFormat).format(n, unit);
      } catch {
        // falls through to the plain path
      }
    }
  }
  const short = `${Math.abs(n)} ${SHORT_UNIT[unit]}`;
  return gap < 0 ? `${short} ago` : `in ${short}`;
}

/** Two digits, for the plain clock. */
function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A date, a time, or both. `style` is "date", "time" or "datetime" (the default). */
export function fmtDatetime(when: unknown, style: unknown, env: FormatEnv = PLAIN_ENV): string {
  const t = millisOf(when);
  if (t === null) return "";
  const s = style === "date" || style === "time" ? style : "datetime";
  if (useIntl(env)) {
    const opts: Record<string, string> = {};
    if (env.timeZone) opts.timeZone = env.timeZone;
    if (s !== "time") { opts.year = "numeric"; opts.month = "short"; opts.day = "numeric"; }
    if (s !== "date") { opts.hour = "numeric"; opts.minute = "2-digit"; }
    const f = cachedFormat("datetime", env.locale, opts, () => new Intl.DateTimeFormat(env.locale, opts));
    if (f) {
      try {
        return (f as Intl.DateTimeFormat).format(new Date(t));
      } catch {
        // falls through to the plain path
      }
    }
  }
  const d = new Date(t);
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return s === "date" ? date : s === "time" ? time : `${date} ${time}`;
}

/** A length of time as a clock: "0:09", "4:05", "1:02:03". Milliseconds in, and never negative. */
export function fmtDuration(ms: unknown): string {
  const total = Math.max(0, Math.floor(finite(ms) / SECOND));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** How long since something started, as a clock. This is the call screen's running time. */
export function fmtElapsed(startedAt: unknown, env: FormatEnv = PLAIN_ENV): string {
  const t = millisOf(startedAt);
  if (t === null) return fmtDuration(0);
  return fmtDuration(env.now - t);
}
