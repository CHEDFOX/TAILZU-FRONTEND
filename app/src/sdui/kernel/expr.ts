/**
 * THE EXPRESSION LANGUAGE (pure SPEC 2.2, B1), closed on purpose.
 *
 * A screen may say `{ "$": "state.busy ? 0.4 : 1" }` and the device works it out. That is the whole point of the
 * pure renderer, and it is also the one place where server data comes closest to being code — so the language is
 * closed, and this file is the only thing that runs it:
 *
 *   • no loops, no user-defined functions, no assignment, no regular expressions, no I/O, no `eval`;
 *   • a fixed set of names (`state`, `device`, `local`, `item`, `index`, `args`, `ui`) and a fixed set of functions;
 *   • a cost known at COMPILE time: an expression is refused above `LIMITS.exprOps`, so running it is bounded
 *     before it ever runs once;
 *   • anything not finite becomes 0, the same rule the bot tiles' numeric engine follows (coreGrammar.ts);
 *   • `__proto__`, `constructor` and `prototype` are not reachable, and a function found on an object is never
 *     returned, let alone called.
 *
 * While compiling, the paths an expression reads are written down (`deps`), so the renderer can re-render one node
 * when one value changes instead of the screen on every write.
 */

import { LIMITS, byteLen } from "./limits.ts";
import { pathsTouch } from "./paths.ts";
import {
  type FormatEnv, PLAIN_ENV, finite, fmtCurrency, fmtDatetime, fmtDuration, fmtElapsed, fmtNumber, fmtPlural,
  fmtRelative,
} from "./format.ts";

/** Something the server sent is wrong. `code` says which rule it broke, for the report the device sends back. */
export class KernelError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KernelError";
    this.code = code;
  }
}

/** What an expression may read while it runs. The renderer fills it; everything is optional but `env`. */
export interface Scope {
  /** The screen's store. */
  state?: unknown;
  /** The fixed device facts (SPEC 2.9). */
  device?: unknown;
  /** What this phone remembers (SPEC 2.9). */
  local?: unknown;
  /** The row, inside a list or a template. */
  item?: unknown;
  /** The row's place, from 0. */
  index?: number;
  /** A template's arguments. */
  args?: unknown;
  /** Where a gesture ended (SPEC 2.5). */
  ui?: unknown;
  /** The locale, the clock and the zone. */
  env?: FormatEnv;
  /** Catalog copy, for `t(key, vars)`. Missing keys come back as the key. */
  text?: (key: string, vars?: Record<string, unknown>) => string;
}

/** A compiled expression: what it cost, what it reads, and how to run it. */
export interface Compiled {
  /** The source, as the server wrote it. */
  src: string;
  /** Operations counted while compiling. Never above `LIMITS.exprOps`. */
  ops: number;
  /** The paths it reads, e.g. `state.done`, `device.perm.mic`, `@time`. */
  deps: readonly string[];
  /** Work it out in this scope. Throws KernelError only when a limit is broken. */
  run(scope: Scope): unknown;
}

/** An expression that reads the clock depends on this, so the renderer knows it must tick. */
export const TIME_DEP = "@time";

/** The roots an expression may start from. Everything else is a function name or nothing at all. */
const ROOTS = ["state", "device", "local", "item", "index", "args", "ui"] as const;
const ROOT_SET: ReadonlySet<string> = new Set(ROOTS);

/** Keys no path may reach, however it is spelled. */
const BLOCKED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

// ---- values

/** One step of a path, with every door to the prototype chain shut. Functions are never handed back. */
export function pick(base: unknown, key: unknown): unknown {
  if (base === null || base === undefined) return undefined;
  let k: string;
  if (typeof key === "number") k = Number.isFinite(key) ? String(Math.trunc(key)) : "";
  else if (typeof key === "string") k = key;
  else if (typeof key === "boolean") k = String(key);
  else return undefined;
  if (k === "" || BLOCKED_KEYS.has(k)) return undefined;
  if (typeof base === "string") {
    if (k === "length") return base.length;
    const i = Number(k);
    return Number.isInteger(i) && i >= 0 && i < base.length ? base[i] : undefined;
  }
  if (Array.isArray(base)) {
    if (k === "length") return base.length;
    const i = Number(k);
    return Number.isInteger(i) && i >= 0 && i < base.length ? base[i] : undefined;
  }
  if (typeof base !== "object") return undefined;
  if (!Object.prototype.hasOwnProperty.call(base, k)) return undefined;
  const v = (base as Record<string, unknown>)[k];
  return typeof v === "function" ? undefined : v;
}

/** A value as a number: a boolean counts, anything else that is not a finite number is 0. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

/**
 * A value as text, for `+` and for a `$t` hole. An object or a list becomes "", never "[object Object]": a screen
 * that meant to show a name and got a row should show nothing, not debug output.
 */
export function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "boolean") return v ? "true" : "false";
  return "";
}

/**
 * Strings a screen builds have the same ceiling as strings it sends. Every expression's RESULT goes through this
 * (see `compileExpr`), so the ceiling holds whichever function made the string — `upper`, `slice`, `t` or a `+`.
 *
 * Counting bytes walks the string, and this runs on every re-render, so the two cheap bounds come first: a code
 * unit is one to three UTF-8 bytes, which settles almost every real string without counting.
 */
function capText(s: string): string {
  if (s.length * 3 <= LIMITS.stringBytes) return s;
  if (s.length > LIMITS.stringBytes || byteLen(s) > LIMITS.stringBytes) {
    throw new KernelError("string", `an expression built a string over ${LIMITS.stringBytes} bytes`);
  }
  return s;
}

/** Equality: null and undefined are the same nothing, numbers compare as numbers, everything else is strict. */
function eq(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") {
    if (typeof a === "number" && typeof b === "number") return num(a) === num(b);
    return false;
  }
  return a === b;
}

/** Less-than and friends: text against text reads as text, everything else as numbers. */
function cmp(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  const x = num(a), y = num(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** JavaScript's own truthiness, so `state.name && state.name` reads the way the server author expects. */
function truthy(v: unknown): boolean {
  return !!v;
}

// ---- the functions a screen may call

type Fn = (a: unknown[], s: Scope) => unknown;
interface FnSpec { min: number; max: number; call: Fn; time?: boolean }

const fmtEnv = (s: Scope): FormatEnv => s.env ?? PLAIN_ENV;

/** A list, or nothing. Strings are not lists here: `count` handles both, the rest want rows. */
function rows(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const FUNCS: Record<string, FnSpec> = {
  // math
  min: { min: 1, max: 8, call: (a) => a.reduce<number>((m, v) => Math.min(m, num(v)), num(a[0])) },
  max: { min: 1, max: 8, call: (a) => a.reduce<number>((m, v) => Math.max(m, num(v)), num(a[0])) },
  clamp: { min: 3, max: 3, call: (a) => { const v = num(a[0]), lo = num(a[1]), hi = num(a[2]); return v < lo ? lo : v > hi ? hi : v; } },
  round: { min: 1, max: 2, call: (a) => { const d = Math.max(0, Math.min(8, Math.trunc(num(a[1])))); const p = Math.pow(10, d); const r = Math.round(num(a[0]) * p) / p; return Number.isFinite(r) ? r : 0; } },
  floor: { min: 1, max: 1, call: (a) => Math.floor(num(a[0])) },
  ceil: { min: 1, max: 1, call: (a) => Math.ceil(num(a[0])) },
  abs: { min: 1, max: 1, call: (a) => Math.abs(num(a[0])) },
  sqrt: { min: 1, max: 1, call: (a) => { const v = num(a[0]); return v < 0 ? 0 : Math.sqrt(v); } },
  sin: { min: 1, max: 1, call: (a) => Math.sin(num(a[0])) },
  cos: { min: 1, max: 1, call: (a) => Math.cos(num(a[0])) },
  atan2: { min: 2, max: 2, call: (a) => Math.atan2(num(a[0]), num(a[1])) },

  // text
  len: { min: 1, max: 1, call: (a) => (typeof a[0] === "string" ? a[0].length : Array.isArray(a[0]) ? a[0].length : 0) },
  upper: { min: 1, max: 1, call: (a) => toText(a[0]).toUpperCase() },
  lower: { min: 1, max: 1, call: (a) => toText(a[0]).toLowerCase() },
  trim: { min: 1, max: 1, call: (a) => toText(a[0]).trim() },
  slice: {
    min: 2, max: 3,
    call: (a) => {
      const from = Math.trunc(num(a[1]));
      const to = a[2] === undefined ? undefined : Math.trunc(num(a[2]));
      if (Array.isArray(a[0])) return a[0].slice(from, to);
      return toText(a[0]).slice(from, to);
    },
  },
  contains: {
    min: 2, max: 2,
    call: (a) => (Array.isArray(a[0]) ? a[0].some((v) => eq(v, a[1])) : toText(a[0]).includes(toText(a[1]))),
  },
  startsWith: { min: 2, max: 2, call: (a) => toText(a[0]).startsWith(toText(a[1])) },
  endsWith: { min: 2, max: 2, call: (a) => toText(a[0]).endsWith(toText(a[1])) },
  replace: {
    min: 3, max: 3,
    call: (a) => {
      const subject = toText(a[0]);
      const find = toText(a[1]);
      if (find === "") return subject;
      const with_ = toText(a[2]);
      // How long the answer would be, worked out before it is built: 8 KB of needles in 8 KB of hay would
      // otherwise allocate tens of megabytes and only then be refused.
      let hits = 0;
      for (let at = subject.indexOf(find); at !== -1; at = subject.indexOf(find, at + find.length)) hits += 1;
      const grown = subject.length + hits * (with_.length - find.length);
      if (grown > LIMITS.stringBytes) {
        throw new KernelError("string", `an expression built a string over ${LIMITS.stringBytes} bytes`);
      }
      return capText(subject.split(find).join(with_));
    },
  },
  pad: {
    min: 2, max: 3,
    call: (a) => {
      const s = toText(a[0]);
      const want = Math.max(0, Math.min(256, Math.trunc(num(a[1]))));
      const ch = (a[2] === undefined ? " " : toText(a[2]).slice(0, 1)) || " ";
      return s.length >= want ? s : ch.repeat(want - s.length) + s;
    },
  },

  // lists
  count: {
    min: 1, max: 1,
    call: (a) => {
      const v = a[0];
      if (Array.isArray(v)) return v.length;
      if (typeof v === "string") return v.length;
      if (v && typeof v === "object") return Object.keys(v as object).length;
      return 0;
    },
  },
  first: { min: 1, max: 1, call: (a) => rows(a[0])[0] },
  last: { min: 1, max: 1, call: (a) => { const r = rows(a[0]); return r[r.length - 1]; } },
  join: { min: 1, max: 2, call: (a) => capText(rows(a[0]).map(toText).join(a[1] === undefined ? ", " : toText(a[1]))) },
  includes: { min: 2, max: 2, call: (a) => rows(a[0]).some((v) => eq(v, a[1])) },

  // copy from the catalog. Whatever comes back is data: it is never looked at for holes again.
  t: {
    min: 1, max: 2,
    call: (a, s) => {
      const key = toText(a[0]);
      const vars = a[1] && typeof a[1] === "object" && !Array.isArray(a[1]) ? (a[1] as Record<string, unknown>) : undefined;
      return s.text ? toText(s.text(key, vars)) : key;
    },
  },

  // time
  now: { min: 0, max: 0, time: true, call: (_a, s) => fmtEnv(s).now },
  since: {
    min: 1, max: 1, time: true,
    call: (a, s) => {
      const t = typeof a[0] === "number" ? a[0] : Date.parse(toText(a[0]));
      return Number.isFinite(t) ? fmtEnv(s).now - (t as number) : 0;
    },
  },

  // formats (the `fmt.` names, spelled out here with a dot so the parser can find them)
  "fmt.number": { min: 1, max: 2, call: (a, s) => fmtNumber(a[0], a[1], fmtEnv(s)) },
  "fmt.currency": { min: 2, max: 2, call: (a, s) => fmtCurrency(a[0], a[1], fmtEnv(s)) },
  "fmt.plural": { min: 3, max: 3, call: (a, s) => fmtPlural(a[0], a[1], a[2], fmtEnv(s)) },
  "fmt.relative": { min: 1, max: 1, time: true, call: (a, s) => fmtRelative(a[0], fmtEnv(s)) },
  "fmt.datetime": { min: 1, max: 2, call: (a, s) => fmtDatetime(a[0], a[1], fmtEnv(s)) },
  "fmt.duration": { min: 1, max: 1, call: (a) => fmtDuration(a[0]) },
  "fmt.elapsed": { min: 1, max: 1, time: true, call: (a, s) => fmtElapsed(a[0], fmtEnv(s)) },
};

/** Every function name a screen may call, for lint messages and for the server's builders. */
export const FUNCTION_NAMES: readonly string[] = Object.freeze(Object.keys(FUNCS).sort());

/** Constants, which are names rather than calls. */
const CONSTS: Record<string, unknown> = { pi: Math.PI, true: true, false: false, null: null };

// ---- tokens

const T_NUM = 0, T_STR = 1, T_NAME = 2, T_OP = 3;
interface Tok { t: number; v: string; n: number }

/** Longest first, so `??` is never read as two `?`. */
const OPS2 = ["**", "??", "?.", "==", "!=", "<=", ">=", "&&", "||"];
const OPS1 = "+-*/%<>!?:.()[],";

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < src.length;) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i += 1; continue; }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && src[j]! >= "0" && src[j]! <= "9") j += 1;
      if (src[j] === ".") { j += 1; while (j < src.length && src[j]! >= "0" && src[j]! <= "9") j += 1; }
      // An exponent, as the bot engine's grammar has it: 1e5, 2.5e-3.
      if (src[j] === "e" || src[j] === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k += 1;
        if (src[k]! >= "0" && src[k]! <= "9") { j = k; while (j < src.length && src[j]! >= "0" && src[j]! <= "9") j += 1; }
      }
      out.push({ t: T_NUM, v: "", n: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      for (;;) {
        if (j >= src.length) throw new KernelError("expr", "a string is not closed");
        const d = src[j]!;
        if (d === "\\") {
          const e = src[j + 1];
          if (e === undefined) throw new KernelError("expr", "a string is not closed");
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2;
          continue;
        }
        if (d === c) { j += 1; break; }
        s += d;
        j += 1;
      }
      out.push({ t: T_STR, v: s, n: 0 });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j += 1;
      out.push({ t: T_NAME, v: src.slice(i, j), n: 0 });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { out.push({ t: T_OP, v: two, n: 0 }); i += 2; continue; }
    if (OPS1.includes(c)) { out.push({ t: T_OP, v: c, n: 0 }); i += 1; continue; }
    throw new KernelError("expr", `an expression cannot contain "${c}"`);
  }
  return out;
}

// ---- the parser, which builds one closure per node and counts as it goes

type Run = (s: Scope) => unknown;
/** A piece being parsed: how to run it, and the path it reads when that is still known. */
interface Piece { run: Run; path: string | null }

class Parser {
  toks: Tok[];
  at = 0;
  ops = 0;
  maxOps: number;
  deps: string[] = [];

  constructor(toks: Tok[], maxOps: number) {
    this.toks = toks;
    this.maxOps = maxOps;
  }

  /** Every node costs one. The cap is checked here, so an expression is refused before it ever runs. */
  op(): void {
    this.ops += 1;
    if (this.ops > this.maxOps) throw new KernelError("expr", `an expression is at most ${this.maxOps} operations`);
  }

  dep(path: string): void {
    if (!this.deps.includes(path)) this.deps.push(path);
  }

  peek(): Tok | undefined {
    return this.toks[this.at];
  }

  isOp(v: string): boolean {
    const k = this.toks[this.at];
    return !!k && k.t === T_OP && k.v === v;
  }

  take(v: string): void {
    if (!this.isOp(v)) throw new KernelError("expr", `expected "${v}"`);
    this.at += 1;
  }

  // precedence, loosest first
  ternary(): Piece {
    const cond = this.nullish();
    if (!this.isOp("?")) return cond;
    this.at += 1;
    const yes = this.ternary();
    this.take(":");
    const no = this.ternary();
    this.op();
    return { run: (s) => (truthy(cond.run(s)) ? yes.run(s) : no.run(s)), path: null };
  }

  nullish(): Piece {
    let left = this.or();
    while (this.isOp("??")) {
      this.at += 1;
      const right = this.or();
      const a = left;
      this.op();
      left = { run: (s) => { const v = a.run(s); return v === null || v === undefined ? right.run(s) : v; }, path: null };
    }
    return left;
  }

  or(): Piece {
    let left = this.and();
    while (this.isOp("||")) {
      this.at += 1;
      const right = this.and();
      const a = left;
      this.op();
      left = { run: (s) => { const v = a.run(s); return truthy(v) ? v : right.run(s); }, path: null };
    }
    return left;
  }

  and(): Piece {
    let left = this.equality();
    while (this.isOp("&&")) {
      this.at += 1;
      const right = this.equality();
      const a = left;
      this.op();
      left = { run: (s) => { const v = a.run(s); return truthy(v) ? right.run(s) : v; }, path: null };
    }
    return left;
  }

  equality(): Piece {
    let left = this.relational();
    while (this.isOp("==") || this.isOp("!=")) {
      const o = this.toks[this.at]!.v;
      this.at += 1;
      const right = this.relational();
      const a = left;
      this.op();
      left = { run: (s) => (o === "==" ? eq(a.run(s), right.run(s)) : !eq(a.run(s), right.run(s))), path: null };
    }
    return left;
  }

  relational(): Piece {
    let left = this.additive();
    while (this.isOp("<") || this.isOp("<=") || this.isOp(">") || this.isOp(">=")) {
      const o = this.toks[this.at]!.v;
      this.at += 1;
      const right = this.additive();
      const a = left;
      this.op();
      left = {
        run: (s) => {
          const c = cmp(a.run(s), right.run(s));
          return o === "<" ? c < 0 : o === "<=" ? c <= 0 : o === ">" ? c > 0 : c >= 0;
        },
        path: null,
      };
    }
    return left;
  }

  additive(): Piece {
    let left = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const o = this.toks[this.at]!.v;
      this.at += 1;
      const right = this.multiplicative();
      const a = left;
      this.op();
      left = {
        run: (s) => {
          const x = a.run(s), y = right.run(s);
          if (o === "-") return finite(num(x) - num(y));
          if (typeof x === "string" || typeof y === "string") return capText(toText(x) + toText(y));
          return finite(num(x) + num(y));
        },
        path: null,
      };
    }
    return left;
  }

  multiplicative(): Piece {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const o = this.toks[this.at]!.v;
      this.at += 1;
      const right = this.unary();
      const a = left;
      this.op();
      left = {
        run: (s) => {
          const x = num(a.run(s)), y = num(right.run(s));
          if (o === "*") return finite(x * y);
          if (y === 0) return 0;
          return finite(o === "/" ? x / y : x - Math.floor(x / y) * y);
        },
        path: null,
      };
    }
    return left;
  }

  unary(): Piece {
    if (this.isOp("!")) {
      this.at += 1;
      const v = this.unary();
      this.op();
      return { run: (s) => !truthy(v.run(s)), path: null };
    }
    if (this.isOp("-")) {
      this.at += 1;
      const v = this.unary();
      this.op();
      return { run: (s) => finite(-num(v.run(s))), path: null };
    }
    return this.power();
  }

  /** `**` binds tighter than a leading minus, so `-2 ** 2` is -(2 ** 2). */
  power(): Piece {
    const base = this.postfix(this.primary());
    if (!this.isOp("**")) return base;
    this.at += 1;
    const exp = this.unary();
    this.op();
    return { run: (s) => finite(Math.pow(num(base.run(s)), num(exp.run(s)))), path: null };
  }

  /** `.name`, `?.name` and `[…]`, keeping the path while every step is written out. */
  postfix(start: Piece): Piece {
    let cur = start;
    for (;;) {
      if (this.isOp(".") || this.isOp("?.")) {
        const safe = this.toks[this.at]!.v === "?.";
        this.at += 1;
        const k = this.peek();
        if (!k || k.t !== T_NAME) throw new KernelError("expr", "a name must follow a dot");
        this.at += 1;
        const key = k.v;
        const base = cur;
        this.op();
        const path = base.path === null ? null : `${base.path}.${key}`;
        cur = {
          run: (s) => {
            const b = base.run(s);
            if (safe && (b === null || b === undefined)) return undefined;
            return pick(b, key);
          },
          path,
        };
        continue;
      }
      if (this.isOp("[")) {
        this.at += 1;
        const key = this.ternary();
        this.take("]");
        const base = cur;
        this.op();
        if (base.path !== null) this.dep(`${base.path}.*`);
        cur = { run: (s) => pick(base.run(s), key.run(s)), path: null };
        continue;
      }
      break;
    }
    if (cur.path !== null) this.dep(cur.path);
    return cur;
  }

  /** The arguments of a call, between the brackets. */
  args(name: string, spec: FnSpec): Piece[] {
    this.take("(");
    const out: Piece[] = [];
    if (!this.isOp(")")) {
      out.push(this.ternary());
      while (this.isOp(",")) { this.at += 1; out.push(this.ternary()); }
    }
    this.take(")");
    if (out.length < spec.min || out.length > spec.max) {
      const want = spec.min === spec.max ? `${spec.min}` : `${spec.min} to ${spec.max}`;
      throw new KernelError("expr", `${name} takes ${want} arguments`);
    }
    return out;
  }

  call(name: string): Piece {
    const spec = FUNCS[name]!;
    const parts = this.args(name, spec);
    this.op();
    if (spec.time) this.dep(TIME_DEP);
    return {
      run: (s) => {
        const vals: unknown[] = [];
        for (const p of parts) vals.push(p.run(s));
        return spec.call(vals, s);
      },
      path: null,
    };
  }

  primary(): Piece {
    const k = this.peek();
    if (!k) throw new KernelError("expr", "an expression ends too early");
    if (k.t === T_NUM) {
      this.at += 1;
      this.op();
      const n = Number.isFinite(k.n) ? k.n : 0;
      return { run: () => n, path: null };
    }
    if (k.t === T_STR) {
      this.at += 1;
      this.op();
      const v = k.v;
      return { run: () => v, path: null };
    }
    if (k.t === T_OP && k.v === "(") {
      this.at += 1;
      const inner = this.ternary();
      this.take(")");
      return { run: inner.run, path: null };
    }
    if (k.t !== T_NAME) throw new KernelError("expr", `an expression cannot start with "${k.v}"`);
    this.at += 1;
    const name = k.v;

    // fmt.something(…): one name with a dot in it, so `fmt` is not a value of its own.
    if (name === "fmt" && this.isOp(".")) {
      const after = this.toks[this.at + 1];
      const full = after && after.t === T_NAME ? `fmt.${after.v}` : "fmt";
      if (!Object.prototype.hasOwnProperty.call(FUNCS, full)) {
        throw new KernelError("expr", `there is no ${full}`);
      }
      this.at += 2;
      return this.call(full);
    }
    if (this.isOp("(")) {
      if (!Object.prototype.hasOwnProperty.call(FUNCS, name)) throw new KernelError("expr", `there is no function ${name}`);
      return this.call(name);
    }
    if (Object.prototype.hasOwnProperty.call(CONSTS, name)) {
      this.op();
      const v = CONSTS[name];
      return { run: () => v, path: null };
    }
    if (!ROOT_SET.has(name)) throw new KernelError("expr", `there is no name ${name}`);
    this.op();
    if (name === "index") return { run: (s) => (typeof s.index === "number" ? s.index : 0), path: "index" };
    const root = name as (typeof ROOTS)[number];
    return { run: (s) => s[root], path: root };
  }
}

/** How costly an expression is allowed to be. A caller may ask for less, never for more. */
function opCap(maxOps?: number): number {
  const want = typeof maxOps === "number" && Number.isFinite(maxOps) ? Math.trunc(maxOps) : LIMITS.exprOps;
  return Math.max(1, Math.min(LIMITS.exprOps, want));
}

/**
 * Compile one expression. Throws KernelError when the source is not in the language or costs too much; the caller
 * reports that and leaves the screen's `else` value in place.
 */
export function compileExpr(src: unknown, opts?: { maxOps?: number }): Compiled {
  if (typeof src !== "string") throw new KernelError("expr", "an expression must be a string");
  if (src.length > LIMITS.exprChars) throw new KernelError("expr", `an expression is at most ${LIMITS.exprChars} characters`);
  if (src.trim() === "") throw new KernelError("expr", "an expression is empty");
  const p = new Parser(lex(src), opCap(opts?.maxOps));
  const piece = p.ternary();
  if (p.at < p.toks.length) throw new KernelError("expr", `an expression has something left over: "${p.toks[p.at]!.v}"`);
  const deps = Object.freeze(p.deps.slice().sort());
  // One door for the 8 KB ceiling. `+`, `join` and `replace` cap as they build, because they are the ones that can
  // build something enormous out of small pieces; `upper`, `slice`, `t` and the `fmt.*` helpers simply hand back a
  // long value they were given, and this is where that is refused.
  const inner = piece.run;
  const run: Run = (s) => {
    const v = inner(s);
    return typeof v === "string" ? capText(v) : v;
  };
  return { src, ops: p.ops, deps, run };
}

/** Compile without throwing: for lint, which wants every reason at once. */
export function tryCompileExpr(src: unknown, opts?: { maxOps?: number }): { ok: true; expr: Compiled } | { ok: false; error: string } {
  try {
    return { ok: true, expr: compileExpr(src, opts) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Run without throwing. A broken value is `bad`, and the renderer keeps what was drawn before. */
export function runExpr(expr: Compiled, scope: Scope): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: expr.run(scope) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** True when a change at `changed` can change what these dependencies read. */
export function dependsOn(deps: readonly string[], changed: string): boolean {
  for (const d of deps) {
    if (d === TIME_DEP) continue;
    if (pathsTouch(d, changed)) return true;
  }
  return false;
}

/** True when these dependencies include the clock, so the node has to be re-drawn as time passes. */
export function readsTime(deps: readonly string[]): boolean {
  return deps.includes(TIME_DEP);
}
