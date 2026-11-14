/**
 * ONE NODE, WORKED OUT (pure/SPEC.md 2.2 B1, 2.3 B2): what its props and its style come to, and what it reads.
 *
 * The renderer walks a tree; this file is everything about ONE node that is arithmetic rather than drawing, so it
 * can be tested in Node without React. It does three things:
 *
 *   1. COMPILES a node once — every `{ "$": … }` value and `{ "$t": … }` text in its props, its style and its
 *      template arguments — and keeps the compiled form on a WeakMap keyed by the node object. A screen's tree is
 *      the same object every render, so a node compiles once per screen, not once per frame.
 *   2. RUNS it against a scope. A bare string is NEVER looked at: it comes back exactly as the server wrote it,
 *      because that is where people's own words live (SPEC 2.2 principle 4).
 *   3. SAYS WHAT IT READS, so the renderer can re-render it only when one of those paths changes. A node with no
 *      expressions reads nothing and keeps today's behaviour (re-render on any store write).
 *
 * Template markers: `$args` (the argument frames the kernel's expansion left) and `$argsUp` (how many frames slot
 * content steps back past). Both are turned into a scope here — see `scopeFor`.
 */

import {
  type CompiledProp, type Scope, compileCondition, compileProp, isEvaluable, pathsTouch, runProp,
} from "../kernel/index.ts";
import { ARGS_KEY, ARGS_UP_KEY } from "../kernel/defs.ts";

/** What a node is drawn with beyond the screen's own state: a row, its place, and a template's arguments. */
export interface RenderScope {
  item?: unknown;
  index?: number;
  /** The argument frames in force, outermost first. The last one is `args` in an expression. */
  argsStack?: readonly Record<string, unknown>[];
}

/** The scope the kernel runs an expression in, less the parts one node brings. */
export interface BaseScope {
  state?: unknown;
  device?: unknown;
  local?: unknown;
  ui?: unknown;
  env?: Scope["env"];
  text?: Scope["text"];
}

/** A node, compiled: only what had an expression in it is here. */
export interface CompiledNode {
  /** Compiled props, by prop name. Only props that were `$`/`$t` shapes. */
  props: ReadonlyArray<readonly [string, CompiledProp]>;
  /** Compiled style values, by style key. */
  style: ReadonlyArray<readonly [string, CompiledProp]>;
  /** `visibleIf: { expr }`, compiled. Null when the node uses the old condition shape or none. */
  visible: { run(scope: Scope): unknown; deps: readonly string[] } | null;
  /** The argument frames on this node (`$args`), each a map of name to compiled value. */
  argFrames: ReadonlyArray<ReadonlyArray<readonly [string, CompiledProp]>>;
  /** How many argument frames to step back past first (`$argsUp`). */
  argsUp: number;
  /** Every path anything on this node reads. Empty means nothing on it is an expression. */
  deps: readonly string[];
  /** Whatever could not be compiled, as plain sentences, for the handshake's `sdui.bad`. */
  errors: readonly string[];
  /** True when this node has anything the kernel has to run at all. */
  live: boolean;
}

/** A node with nothing for the kernel to do — and the answer for every node on a screen that has no `expr`. */
export const NO_EXPRESSIONS: CompiledNode = Object.freeze({
  props: [], style: [], visible: null, argFrames: [], argsUp: 0, deps: [], errors: [], live: false,
});
const EMPTY = NO_EXPRESSIONS;

const cache = new WeakMap<object, CompiledNode>();

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Compile one map of values (props, style, one argument frame). Only the two evaluable shapes are compiled. */
function compileMap(
  map: unknown, deps: string[], errors: string[], where: string, encode = false,
): Array<readonly [string, CompiledProp]> {
  const out: Array<readonly [string, CompiledProp]> = [];
  if (!isMap(map)) return out;
  for (const k of Object.keys(map)) {
    const v = map[k];
    if (!isEvaluable(v)) continue;
    try {
      const c = compileProp(v, { encode });
      out.push([k, c]);
      for (const d of c.deps) if (!deps.includes(d)) deps.push(d);
    } catch (e) {
      errors.push(`${where}.${k}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** Compile a node, once, and keep it. A node that holds no expression compiles to one shared empty answer. */
export function compileNode(node: unknown): CompiledNode {
  if (!isMap(node)) return EMPTY;
  const kept = cache.get(node);
  if (kept) return kept;

  const deps: string[] = [];
  const errors: string[] = [];
  const props = compileMap(node.props, deps, errors, "props");
  const style = compileMap(node.style, deps, errors, "style");

  let visible: CompiledNode["visible"] = null;
  const vis = node.visibleIf;
  if (isMap(vis) && typeof vis.expr === "string") {
    try {
      const c = compileCondition(vis);
      visible = c;
      for (const d of c.deps) if (!deps.includes(d)) deps.push(d);
    } catch (e) {
      errors.push(`visibleIf: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const argFrames: Array<Array<readonly [string, CompiledProp]>> = [];
  const frames = node[ARGS_KEY];
  if (Array.isArray(frames)) {
    for (const f of frames) {
      // An argument may be a plain value as well as an expression, so every key is kept — `compileProp` makes a
      // constant of anything that is not one of the two shapes.
      const one: Array<readonly [string, CompiledProp]> = [];
      if (isMap(f)) {
        for (const k of Object.keys(f)) {
          try {
            const c = compileProp(f[k]);
            one.push([k, c]);
            for (const d of c.deps) if (!deps.includes(d)) deps.push(d);
          } catch (e) {
            errors.push(`args.${k}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      argFrames.push(one);
    }
  }
  const argsUp = typeof node[ARGS_UP_KEY] === "number" ? Math.max(0, Math.trunc(node[ARGS_UP_KEY] as number)) : 0;

  const made: CompiledNode = {
    props, style, visible, argFrames, argsUp,
    deps: Object.freeze(deps.sort()),
    errors: Object.freeze(errors),
    live: props.length > 0 || style.length > 0 || visible !== null || argFrames.length > 0 || argsUp > 0,
  };
  cache.set(node, made);
  return made;
}

/** The kernel scope for one node: the screen's own roots, plus the row and the arguments in force. */
export function kernelScope(base: BaseScope, scope: RenderScope | undefined): Scope {
  const stack = scope?.argsStack;
  return {
    state: base.state,
    device: base.device,
    local: base.local,
    ui: base.ui,
    env: base.env,
    text: base.text,
    item: scope?.item,
    index: scope?.index,
    args: stack && stack.length > 0 ? stack[stack.length - 1] : undefined,
  };
}

/**
 * The scope a node's CHILDREN are drawn in, given the markers the kernel's expansion left on it.
 *
 * `$argsUp` first (slot content reads the scope where it was WRITTEN, not where it landed), then each `$args`
 * frame in turn — each one worked out in the scope the one before it made, which is what a template whose root is
 * itself a `Use` needs.
 */
export function scopeFor(
  compiled: CompiledNode, base: BaseScope, scope: RenderScope | undefined, onError?: (why: string) => void,
): RenderScope | undefined {
  if (compiled.argsUp === 0 && compiled.argFrames.length === 0) return scope;
  const had = scope?.argsStack ?? [];
  let stack: Record<string, unknown>[] = compiled.argsUp > 0
    ? had.slice(0, Math.max(0, had.length - compiled.argsUp))
    : had.slice();
  for (const frame of compiled.argFrames) {
    const made: Record<string, unknown> = {};
    const inner: RenderScope = { item: scope?.item, index: scope?.index, argsStack: stack };
    for (const [k, c] of frame) {
      try {
        made[k] = runProp(c, kernelScope(base, inner));
      } catch (e) {
        onError?.(`args.${k}: ${e instanceof Error ? e.message : String(e)}`);
        made[k] = undefined;
      }
    }
    stack = [...stack, made];
  }
  return { item: scope?.item, index: scope?.index, argsStack: stack };
}

/** Put the compiled values over the node's own: a prop that was not an expression is left exactly as it came. */
export function resolveInto(
  into: Record<string, unknown>,
  compiled: ReadonlyArray<readonly [string, CompiledProp]>,
  scope: Scope,
  onError?: (why: string) => void,
): Record<string, unknown> {
  if (compiled.length === 0) return into;
  for (const [k, c] of compiled) {
    try {
      into[k] = runProp(c, scope);
    } catch (e) {
      // A value that cannot be worked out leaves what the server wrote underneath it, and is reported. A screen
      // loses one value, never its shape.
      onError?.(`${k}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return into;
}

/** True when a change at `changed` could change anything this node reads. */
export function nodeReads(deps: readonly string[], changed: string): boolean {
  for (const d of deps) if (pathsTouch(d, changed)) return true;
  return false;
}
