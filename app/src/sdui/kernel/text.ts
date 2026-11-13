/**
 * TEXT WITH HOLES, AND VALUES (pure SPEC 2.2, B1): the only two shapes that are ever evaluated.
 *
 *   { "$t": "{{ count(state.done) }} of {{ count(state.items) }} done" }   text with holes
 *   { "$": "state.busy ? 0.4 : 1" }                                       one value
 *
 * Everything else is data. **A bare string is never looked at for `{{ }}`**, because the server puts people's own
 * words into string props — a note's title, a calendar invite from a stranger — and a title reading
 * `{{ state.token }}` must draw as those characters and nothing else. A value that arrives through the store, a
 * `bind`, a list row or an endpoint is data too: it is never parsed a second time.
 *
 * Holes in a path field are URL-encoded on the way out (`encode: true`), which is what `actions.ts` already does
 * for `$state.` tokens. Display text is not encoded.
 */

import { LIMITS, byteLen } from "./limits.ts";
import { type Compiled, KernelError, type Scope, compileExpr, toText } from "./expr.ts";
import { encodeHole } from "./paths.ts";

/** `{ "$t": "…" }`: text with holes. */
export interface TextTemplate { $t: string }
/** `{ "$": "…" }`: one value. */
export interface ValueBinding { $: string }

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** True for the text-with-holes shape, and only for it. */
export function isTextTemplate(v: unknown): v is TextTemplate {
  return !!v && typeof v === "object" && !Array.isArray(v) && has(v, "$t") && typeof (v as TextTemplate).$t === "string";
}

/** True for the one-value shape, and only for it. */
export function isValueBinding(v: unknown): v is ValueBinding {
  return !!v && typeof v === "object" && !Array.isArray(v) && has(v, "$") && typeof (v as ValueBinding).$ === "string";
}

/** True when this value is one the kernel evaluates at all. Anything else is drawn as it came. */
export function isEvaluable(v: unknown): boolean {
  return isTextTemplate(v) || isValueBinding(v);
}

/** A compiled `$t`: the literal pieces, the holes between them, and what it all reads. */
export interface CompiledText {
  src: string;
  ops: number;
  deps: readonly string[];
  /** One more literal than there are holes. */
  literals: readonly string[];
  holes: readonly Compiled[];
  run(scope: Scope): string;
}

/** Cut `"a {{ x }} b"` into ["a ", " b"] and ["x"]. An unclosed hole is refused, not drawn. */
function cut(src: string): { literals: string[]; sources: string[] } {
  const literals: string[] = [];
  const sources: string[] = [];
  let at = 0;
  for (;;) {
    const open = src.indexOf("{{", at);
    if (open === -1) break;
    const close = src.indexOf("}}", open + 2);
    if (close === -1) throw new KernelError("text", 'a hole is opened with "{{" and never closed');
    const inner = src.slice(open + 2, close);
    if (inner.includes("{{")) throw new KernelError("text", "a hole cannot hold another hole");
    literals.push(src.slice(at, open));
    sources.push(inner.trim());
    at = close + 2;
    if (sources.length > LIMITS.textHoles) throw new KernelError("text", `a text has at most ${LIMITS.textHoles} holes`);
  }
  literals.push(src.slice(at));
  return { literals, sources };
}

/**
 * Compile text with holes. `encode` is for path fields: every filled value is URL-encoded, so an id of `../admin`
 * cannot climb out of the path it was put in.
 */
export function compileText(src: unknown, opts?: { encode?: boolean }): CompiledText {
  if (typeof src !== "string") throw new KernelError("text", "a $t must be a string");
  if (byteLen(src) > LIMITS.stringBytes) throw new KernelError("text", `a $t is at most ${LIMITS.stringBytes} bytes`);
  const { literals, sources } = cut(src);
  const holes: Compiled[] = [];
  const deps: string[] = [];
  let ops = 0;
  for (const s of sources) {
    const left = LIMITS.exprOps - ops;
    if (left <= 0) throw new KernelError("text", `a text is at most ${LIMITS.exprOps} operations in all`);
    const c = compileExpr(s, { maxOps: left });
    ops += c.ops;
    holes.push(c);
    for (const d of c.deps) if (!deps.includes(d)) deps.push(d);
  }
  const encode = opts?.encode === true;
  const frozenLiterals = Object.freeze(literals.slice());
  const frozenHoles = Object.freeze(holes.slice());
  return {
    src,
    ops,
    deps: Object.freeze(deps.sort()),
    literals: frozenLiterals,
    holes: frozenHoles,
    run(scope: Scope): string {
      let out = frozenLiterals[0] ?? "";
      for (let i = 0; i < frozenHoles.length; i += 1) {
        const v = frozenHoles[i]!.run(scope);
        out += encode ? encodeHole(v) : toText(v);
        out += frozenLiterals[i + 1] ?? "";
        if (byteLen(out) > LIMITS.stringBytes) {
          throw new KernelError("string", `a text grew past ${LIMITS.stringBytes} bytes`);
        }
      }
      return out;
    },
  };
}

/** What a prop turned out to be once it was looked at. */
export type CompiledProp =
  | { kind: "constant"; value: unknown; deps: readonly string[]; ops: 0 }
  | { kind: "value"; expr: Compiled; deps: readonly string[]; ops: number }
  | { kind: "text"; text: CompiledText; deps: readonly string[]; ops: number };

const NO_DEPS: readonly string[] = Object.freeze([]);

/**
 * Look at one prop. Only the two shapes compile; everything else comes straight back as a constant, which is how
 * user text stays user text.
 */
export function compileProp(v: unknown, opts?: { encode?: boolean }): CompiledProp {
  if (isValueBinding(v)) {
    const expr = compileExpr(v.$);
    return { kind: "value", expr, deps: expr.deps, ops: expr.ops };
  }
  if (isTextTemplate(v)) {
    const text = compileText(v.$t, opts);
    return { kind: "text", text, deps: text.deps, ops: text.ops };
  }
  return { kind: "constant", value: v, deps: NO_DEPS, ops: 0 };
}

/** Work out a compiled prop. A constant is itself; the other two run. */
export function runProp(prop: CompiledProp, scope: Scope): unknown {
  if (prop.kind === "constant") return prop.value;
  if (prop.kind === "value") return prop.expr.run(scope);
  return prop.text.run(scope);
}

/** A condition, which a screen writes as `{ "expr": "…" }` (SPEC 2.2, `visibleIf`). */
export interface ExprCondition { expr: string }

/** True for the `{ expr }` condition shape. */
export function isExprCondition(v: unknown): v is ExprCondition {
  return !!v && typeof v === "object" && !Array.isArray(v) && has(v, "expr") && typeof (v as ExprCondition).expr === "string";
}

/** Compile a condition. What it gives back is read as true or false, nothing else. */
export function compileCondition(v: unknown): Compiled {
  if (!isExprCondition(v)) throw new KernelError("expr", "a condition is { expr: \"…\" }");
  return compileExpr(v.expr);
}

/**
 * A warning, not a refusal: a bare string that holds `{{` is probably a forgotten `$t`. It can also be a person's
 * own words, which is why this never refuses anything (SPEC 2.2, "Server side").
 */
export function looksLikeForgottenTemplate(v: unknown): boolean {
  return typeof v === "string" && v.includes("{{") && v.includes("}}");
}
