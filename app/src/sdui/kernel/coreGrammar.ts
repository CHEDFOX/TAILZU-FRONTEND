/**
 * THE NUMERIC GRAMMAR, COPIED FROM THE BOT TILES' CORE (pure SPEC 2.0, principle 1).
 *
 * The bot's animation language and a screen's expressions have to agree about what a number means: the same
 * precedence, the same functions, the same "anything not finite is 0". `src/botTiles/core.ts` is self-contained and
 * frozen by its own sha chain, so the kernel does not import it — it keeps a copy of its numeric grammar here,
 * between the markers below, and `tools/ci/marked-regions.mjs` (pair CoreExprGrammar, lang TS) diffs the two byte
 * for byte. Nothing between the markers may be edited here: change core.ts and copy it across in one commit.
 *
 * This copy is what the kernel tests its own evaluator against (expr.test.ts): a number expression means the same
 * thing in a moment and on a screen, or one of the two is wrong.
 *
 * Two helpers the copied region reads sit outside it, byte-identical to core.ts's own, because they are declared
 * elsewhere in that file.
 */

/** A full turn, as core.ts has it. */
const TAU = Math.PI * 2;

/** A number in [0, 1) from n: the same n, the same number (core.ts's own, used by the `hash` function). */
const hash01 = (n: number): number => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// BEGIN CoreExprGrammar
// ---- the expression language (the mic program's, motionLang.ts on the server: same grammar, numbers only)

/** The names an expression may read. t: seconds into the track; u: 0 to 1 through it; T: seconds into the moment; D: the track's length; beat: beats (bpm); k: loops so far; side: 1 facing right, -1 left; rnd, rnd2: random per play; W: the stage's width; x: his hips from its left; px: the other bot ahead of him (bot heights, 0: none). */
export const MOMENT_VARS = ["t", "u", "T", "D", "beat", "k", "side", "rnd", "rnd2", "W", "x", "px"];
const XCONST: Record<string, number> = { pi: Math.PI, tau: TAU, e: Math.E };
/** Built-ins: [id, fewest arguments, most]. motionLang's, and sign, tri (a triangle wave, period 1), hash (0 to 1 from n). */
const XFUNC: Record<string, readonly number[]> = {
  sin: [0, 1, 1], cos: [1, 1, 1], tan: [2, 1, 1], abs: [3, 1, 1], sqrt: [4, 1, 1], floor: [5, 1, 1], ceil: [6, 1, 1], round: [7, 1, 1],
  exp: [8, 1, 1], log: [9, 1, 1], atan2: [10, 2, 2], min: [11, 1, 8], max: [12, 1, 8], pow: [13, 2, 2], hypot: [14, 1, 8],
  clamp: [15, 3, 3], smooth: [16, 3, 3], lerp: [17, 3, 3], crest: [18, 1, 1], ramp: [19, 3, 4], run: [20, 5, 5], noise: [21, 1, 1],
  sign: [22, 1, 1], tri: [23, 1, 1], hash: [24, 1, 1],
};
export const MOMENT_FUNCS = Object.keys(XFUNC);
const XBIN = ["+", "-", "*", "/", "%", "^", "<", "<=", ">", ">=", "==", "!=", "&&", "||"];
const XO_NUM = 1, XO_VAR = 2, XO_NEG = 3, XO_NOT = 4, XO_BIN = 5, XO_TERN = 6, XO_CALL = 7;
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A compiled number: a constant, or bytecode run on the moment's names. */
interface Xp { c: number; code: Float64Array | null }
const XP0: Xp = { c: 0, code: null };

/** Expression text into bytecode (a constant when it reads no name). Throws on anything it does not know. `names` are the
 *  names it may read, in the order their values are handed to it: a moment's (MOMENT_VARS), or a caller's own. */
function xcompile(src: string, names: readonly string[] = MOMENT_VARS): Xp {
  const toks: Array<{ t: number; v: string; n: number }> = [];
  for (let i = 0; i < src.length;) {
    const ch = src.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { i++; continue; }
    const dig = (k: number) => { const c = src.charCodeAt(k); return c >= 48 && c <= 57; };
    if (dig(i)) {
      let j = i;
      while (j < src.length && dig(j)) j++;
      if (src[j] === ".") { j++; while (j < src.length && dig(j)) j++; }
      if (src[j] === "e" || src[j] === "E") { let k = j + 1; if (src[k] === "+" || src[k] === "-") k++; if (dig(k)) { j = k; while (j < src.length && dig(j)) j++; } }
      toks.push({ t: 0, v: "", n: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j]!)) j++;
      toks.push({ t: 1, v: src.slice(i, j), n: 0 });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "||" || two === "&&" || two === "==" || two === "!=" || two === "<=" || two === ">=") { toks.push({ t: 2, v: two, n: 0 }); i += 2; continue; }
    if ("-+*/%^<>!?:(),".indexOf(src[i]!) >= 0) { toks.push({ t: 2, v: src[i]!, n: 0 }); i++; continue; }
    throw new Error(`bad character "${src[i]}"`);
  }
  const code: number[] = [];
  let pos = 0, depth = 0, deepest = 0, reads = false;
  const push = () => { depth++; if (depth > deepest) deepest = depth; };
  const isOp = (v: string) => pos < toks.length && toks[pos]!.t === 2 && toks[pos]!.v === v;
  const take = (v: string) => { if (!isOp(v)) throw new Error(`expected "${v}"`); pos++; };
  const bin = (op: string) => { code.push(XO_BIN, XBIN.indexOf(op)); depth--; };
  const ternary = (): void => { or(); if (isOp("?")) { pos++; ternary(); take(":"); ternary(); code.push(XO_TERN); depth -= 2; } };
  const or = (): void => { and(); while (isOp("||")) { pos++; and(); bin("||"); } };
  const and = (): void => { eq(); while (isOp("&&")) { pos++; eq(); bin("&&"); } };
  const eq = (): void => { rel(); while (isOp("==") || isOp("!=")) { const o = toks[pos++]!.v; rel(); bin(o); } };
  const rel = (): void => { add(); while (isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) { const o = toks[pos++]!.v; add(); bin(o); } };
  const add = (): void => { mul(); while (isOp("+") || isOp("-")) { const o = toks[pos++]!.v; mul(); bin(o); } };
  const mul = (): void => { unary(); while (isOp("*") || isOp("/") || isOp("%")) { const o = toks[pos++]!.v; unary(); bin(o); } };
  const unary = (): void => {
    if (isOp("-")) { pos++; unary(); code.push(XO_NEG); return; }
    if (isOp("!")) { pos++; unary(); code.push(XO_NOT); return; }
    power();
  };
  const power = (): void => { primary(); if (isOp("^")) { pos++; unary(); bin("^"); } };
  const primary = (): void => {
    const k = toks[pos];
    if (!k) throw new Error("unexpected end");
    if (k.t === 0) { pos++; code.push(XO_NUM, k.n); push(); return; }
    if (k.t === 1) {
      pos++;
      if (isOp("(")) {
        pos++;
        const f = own(XFUNC, k.v) ? XFUNC[k.v]! : null;
        if (!f) throw new Error(`unknown function ${k.v}`);
        let n = 0;
        if (!isOp(")")) { ternary(); n++; while (isOp(",")) { pos++; ternary(); n++; } }
        take(")");
        if (n < f[1]! || n > f[2]!) throw new Error(`${k.v} takes ${f[1] === f[2] ? f[1] : `${f[1]} to ${f[2]}`} arguments`);
        code.push(XO_CALL, f[0]!, n);
        depth -= n - 1;
        return;
      }
      if (own(XCONST, k.v)) { code.push(XO_NUM, XCONST[k.v]!); push(); return; }
      const vi = names.indexOf(k.v);
      if (vi < 0) throw new Error(`unknown name ${k.v}`);
      code.push(XO_VAR, vi);
      reads = true;
      push();
      return;
    }
    if (isOp("(")) { pos++; ternary(); take(")"); return; }
    throw new Error(`unexpected "${k.v}"`);
  };
  ternary();
  if (pos < toks.length) throw new Error(`unexpected "${toks[pos]!.v}"`);
  if (deepest > 48) throw new Error("too deep");
  const bc = Float64Array.from(code);
  return reads ? { c: 0, code: bc } : { c: xrun(bc, XVARS0), code: null };
}

const XSTACK = new Float64Array(64);
const XVARS0 = new Float64Array(MOMENT_VARS.length);

function xbin(op: number, a: number, b: number): number {
  switch (op) {
    case 0: return a + b;
    case 1: return a - b;
    case 2: return a * b;
    case 3: return b === 0 ? 0 : a / b;
    case 4: return b === 0 ? 0 : a - Math.floor(a / b) * b;
    case 5: return Math.pow(a, b);
    case 6: return a < b ? 1 : 0;
    case 7: return a <= b ? 1 : 0;
    case 8: return a > b ? 1 : 0;
    case 9: return a >= b ? 1 : 0;
    case 10: return a === b ? 1 : 0;
    case 11: return a !== b ? 1 : 0;
    case 12: return a && b ? 1 : 0;
    default: return a || b ? 1 : 0;
  }
}

function xcall(f: number, s: Float64Array, at: number, n: number): number {
  const a = s[at]!, b = s[at + 1]!, c = s[at + 2]!;
  switch (f) {
    case 0: return Math.sin(a);
    case 1: return Math.cos(a);
    case 2: return Math.tan(a);
    case 3: return Math.abs(a);
    case 4: return a < 0 ? 0 : Math.sqrt(a);
    case 5: return Math.floor(a);
    case 6: return Math.ceil(a);
    case 7: return Math.round(a);
    case 8: return Math.exp(a);
    case 9: return a > 0 ? Math.log(a) : 0;
    case 10: return Math.atan2(a, b);
    case 11: { let m = a; for (let i = 1; i < n; i++) if (s[at + i]! < m) m = s[at + i]!; return m; }
    case 12: { let m = a; for (let i = 1; i < n; i++) if (s[at + i]! > m) m = s[at + i]!; return m; }
    case 13: return a < 0 && b !== Math.floor(b) ? 0 : Math.pow(a, b);
    case 14: { let q = 0; for (let i = 0; i < n; i++) q += s[at + i]! * s[at + i]!; return Math.sqrt(q); }
    case 15: return a < b ? b : a > c ? c : a;
    case 16: { const w = b === a ? (c >= b ? 1 : 0) : Math.min(1, Math.max(0, (c - a) / (b - a))); return w * w * (3 - 2 * w); }
    case 17: return a + (b - a) * c;
    case 18: { const q = Math.sin(a); return q > 0 ? Math.pow(q, 1.6) : 0; }
    case 19: { const e = (n > 3 ? s[at + 3]! : 0) || 0.06; return a < b ? 0 : a < b + e ? (a - b) / e : a < b + c ? 1 : a < b + c + e ? 1 - (a - b - c) / e : 0; }
    case 20: {
      const w = s[at + 4]!, u = (b - c) / s[at + 3]!;
      if (!(u >= 0 && u <= 1)) return 0;
      const half = w / 2, mid = u * (1 + w) - half, q = Math.abs(a - mid) / half;
      return q >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * q);
    }
    case 21: return Math.sin(a * 1.7) * Math.sin(a * 0.61 + 2.1);
    case 22: return a > 0 ? 1 : a < 0 ? -1 : 0;
    case 23: { const q = a - Math.floor(a); return q < 0.25 ? 4 * q : q < 0.75 ? 2 - 4 * q : 4 * q - 4; }
    default: return hash01(a);
  }
}

/** Run bytecode on the names (MOMENT_VARS order). Anything not finite is 0. No allocation. */
function xrun(code: Float64Array, vars: Float64Array): number {
  const s = XSTACK, n = code.length;
  let sp = 0, i = 0;
  while (i < n) {
    const op = code[i]!;
    if (op === XO_NUM) { s[sp++] = code[i + 1]!; i += 2; }
    else if (op === XO_VAR) { s[sp++] = vars[code[i + 1]!]!; i += 2; }
    else if (op === XO_BIN) { const b = s[--sp]!; s[sp - 1] = xbin(code[i + 1]!, s[sp - 1]!, b); i += 2; }
    else if (op === XO_NEG) { s[sp - 1] = -s[sp - 1]!; i++; }
    else if (op === XO_NOT) { s[sp - 1] = s[sp - 1] ? 0 : 1; i++; }
    else if (op === XO_TERN) { const b = s[--sp]!, a = s[--sp]!; s[sp - 1] = s[sp - 1] ? a : b; i++; }
    else { const argc = code[i + 2]!; sp -= argc; s[sp] = xcall(code[i + 1]!, s, sp, argc); sp++; i += 3; }
    if (s[sp - 1]! - s[sp - 1]! !== 0) s[sp - 1] = 0;
  }
  return s[0]!;
}
// END CoreExprGrammar

// ---- what the rest of the kernel uses the copy for

/** A compiled number: a constant, or bytecode over the names it was compiled with. */
export type NumericExpr = Xp;

/** The names a screen expression may hand the numeric engine. A screen has no moment, so it names its own. */
export function compileNumeric(src: string, names?: readonly string[]): NumericExpr {
  return xcompile(src, names ?? MOMENT_VARS);
}

/** Run a compiled number. `vars` holds one value per name, in the order they were compiled with. */
export function runNumeric(x: NumericExpr, vars: Float64Array): number {
  return x.code ? xrun(x.code, vars) : x.c;
}

/** Empty when the source compiles in the numeric grammar; otherwise the reason it does not. */
export function numericError(src: string, names?: readonly string[]): string {
  try {
    xcompile(src, names ?? MOMENT_VARS);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}
