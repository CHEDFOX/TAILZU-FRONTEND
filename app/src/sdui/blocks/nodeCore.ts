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
  LIMITS, type CompiledProp, type Scope, compileCondition, compileProp, isEvaluable, pathsTouch, readsTime, runProp,
} from "../kernel/index.ts";
import { ARGS_KEY, ARGS_UP_KEY } from "../kernel/defs.ts";

/**
 * WHAT ONE SCREEN MAY SPEND (pure/SPEC.md 5.1: 600 expressions per screen, 20,000 ops per change of the store).
 *
 * The per-expression cap (256 ops) is the kernel compiler's. These two are the screen's, so they can only be
 * counted where a screen is: one of these is made per screen (ScreenTree) and handed to every node under it
 * through the ctx. Nothing here knows about React — a test drives it with plain numbers.
 */
export class ScreenBudget {
  /** How many expressions this screen has compiled. */
  exprs = 0;
  private ops = 0;
  private at = -1;
  private told = false;

  /** Compile time: may one more expression be compiled on this screen? */
  claimExpr(): boolean {
    if (this.exprs >= LIMITS.exprPerScreen) return false;
    this.exprs += 1;
    return true;
  }

  /**
   * Run time: may these ops be spent? The count starts again at every change of the store (`version`), because
   * the limit is per change — a screen may work as hard as it likes over a minute, just not for one write.
   */
  spend(version: number, ops: number): boolean {
    if (version !== this.at) { this.at = version; this.ops = 0; this.told = false; }
    if (this.ops >= LIMITS.opsPerChange) return false;
    this.ops += ops;
    return true;
  }

  /** True once per change of the store, so "too much work" is reported once and not twenty thousand times. */
  firstRefusal(): boolean {
    if (this.told) return false;
    this.told = true;
    return true;
  }
}

/** A guard the renderer passes down: false means "this screen has spent its ops for this change". */
export type OpsGuard = (ops: number) => boolean;

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
  /**
   * Compiled `bind` values (SPEC 2.2: `bind` by expression). A bare string in `bind` is still a dot-path and is
   * NOT here — only the two evaluable shapes, whose answer IS the value.
   */
  binds: ReadonlyArray<readonly [string, CompiledProp]>;
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
  /** True when something on this node reads the clock (`now()`, `since()`, `fmt.elapsed`), so it has to tick. */
  time: boolean;
  /** True when this node has anything the kernel has to run at all. */
  live: boolean;
}

/** A node with nothing for the kernel to do — and the answer for every node on a screen that has no `expr`. */
export const NO_EXPRESSIONS: CompiledNode = Object.freeze({
  props: [], style: [], binds: [], visible: null, argFrames: [], argsUp: 0, deps: [], errors: [],
  time: false, live: false,
});
const EMPTY = NO_EXPRESSIONS;

const cache = new WeakMap<object, CompiledNode>();

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A value that stands in for an expression that could not be compiled: the prop is simply not there. */
const NOTHING: CompiledProp = Object.freeze({ kind: "constant", value: undefined, deps: [], ops: 0 }) as CompiledProp;

/**
 * ROW-SCOPED PROPS ARE NOT THE NODE'S (pure/SPEC.md 2.6).
 *
 * A List's `sticky` is asked once per ROW, with that row in scope, and its `item` is the row's own template. Both
 * would be worked out here, at the List itself, where there is no row at all — `sticky` would come to `false` for
 * the whole list and the template would be flattened to one node. They are left exactly as the server wrote them,
 * for the list to ask about each row (scope.ts `itemBool`) and to draw (ScreenTree `renderItem`).
 */
const ROW_PROPS: Record<string, readonly string[]> = { List: ["sticky", "item"], Each: ["item"] };

/** Compile one map of values (props, style, bind, one argument frame). Only the two evaluable shapes are compiled. */
function compileMap(
  map: unknown, deps: string[], errors: string[], where: string,
  opts?: { encode?: boolean; skip?: readonly string[]; budget?: ScreenBudget },
): Array<readonly [string, CompiledProp]> {
  const out: Array<readonly [string, CompiledProp]> = [];
  if (!isMap(map)) return out;
  for (const k of Object.keys(map)) {
    if (opts?.skip?.includes(k)) continue;
    const v = map[k];
    if (!isEvaluable(v)) continue;
    if (opts?.budget && !opts.budget.claimExpr()) {
      // SPEC 5.1: at most 600 expressions per screen. Past that the prop is nothing, not the object the server
      // wrote — a component must never be handed `{ "$": … }` to draw.
      errors.push(`${where}.${k}: this screen has more than ${LIMITS.exprPerScreen} expressions`);
      out.push([k, NOTHING]);
      continue;
    }
    try {
      const c = compileProp(v, { encode: opts?.encode === true });
      out.push([k, c]);
      for (const d of c.deps) if (!deps.includes(d)) deps.push(d);
    } catch (e) {
      // AN EXPRESSION THAT WILL NOT COMPILE LEAVES NOTHING, NEVER THE OBJECT (SPEC 2.2: "a refused expression
      // leaves the else value (or nothing) in place and reports bad"). Keeping `{ "$": "state.(" }` meant a Text
      // was handed an object to draw, React threw, and the node — or, in the sign-in gate, the screen — went.
      errors.push(`${where}.${k}: ${e instanceof Error ? e.message : String(e)}`);
      out.push([k, NOTHING]);
    }
  }
  return out;
}

/** Compile a node, once, and keep it. A node that holds no expression compiles to one shared empty answer. */
export function compileNode(node: unknown, budget?: ScreenBudget): CompiledNode {
  if (!isMap(node)) return EMPTY;
  const kept = cache.get(node);
  if (kept) return kept;

  const deps: string[] = [];
  const errors: string[] = [];
  const skip = typeof node.type === "string" ? ROW_PROPS[node.type] : undefined;
  const props = compileMap(node.props, deps, errors, "props", { skip, budget });
  const style = compileMap(node.style, deps, errors, "style", { budget });
  // `bind` by expression (SPEC 2.2): the answer IS the value. A bare string there is still a dot-path, so it is
  // not evaluable and compileMap leaves it alone.
  const binds = compileMap(node.bind, deps, errors, "bind", { budget });

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
          if (isEvaluable(f[k]) && budget && !budget.claimExpr()) {
            errors.push(`args.${k}: this screen has more than ${LIMITS.exprPerScreen} expressions`);
            continue;
          }
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
    props, style, binds, visible, argFrames, argsUp,
    deps: Object.freeze(deps.sort()),
    errors: Object.freeze(errors),
    time: readsTime(deps),
    live: props.length > 0 || style.length > 0 || binds.length > 0 || visible !== null
      || argFrames.length > 0 || argsUp > 0,
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
  guard?: OpsGuard,
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
      if (guard && c.ops > 0 && !guard(c.ops)) { made[k] = undefined; onError?.(`args.${k}: too much work for one change`); continue; }
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

/**
 * Put the compiled values over the node's own: a prop that was not an expression is left exactly as it came.
 *
 * A value that cannot be worked out becomes NOTHING — not the `{ "$": … }` object the server wrote. Keeping the
 * object meant handing a component something it was never meant to draw (a Text draws its content as a child, and
 * React throws on an object), so one expression that grew too long cost the whole node, and on the sign-in screen
 * the whole screen. SPEC 2.2: a refused expression leaves the else value, or nothing.
 */
export function resolveInto(
  into: Record<string, unknown>,
  compiled: ReadonlyArray<readonly [string, CompiledProp]>,
  scope: Scope,
  onError?: (why: string) => void,
  guard?: OpsGuard,
): Record<string, unknown> {
  if (compiled.length === 0) return into;
  for (const [k, c] of compiled) {
    // SPEC 5.1: 20,000 ops per change of the store. Past that nothing more is worked out for this change.
    if (guard && c.ops > 0 && !guard(c.ops)) { into[k] = undefined; onError?.(`${k}: too much work for one change`); continue; }
    try {
      into[k] = runProp(c, scope);
    } catch (e) {
      onError?.(`${k}: ${e instanceof Error ? e.message : String(e)}`);
      into[k] = undefined;
    }
  }
  return into;
}

/**
 * AN ACTION HELD BY A TEMPLATE'S CALLER (pure/SPEC.md 2.3): `on: { onPress: { $ref: "args.onOpen" } }`.
 *
 * A template's row cannot name the action it fires — the screen that used the template did. So `$ref` is read
 * out of the scope the node is drawn in: `args.*` (the arguments this `Use` was given) and `item.*` (the row).
 * Nothing else is reachable, there is no expression to run, and a `$ref` that points at another `$ref` is
 * followed only a few times, so a template cannot point at itself for ever.
 */
export function resolveActionRef(action: unknown, scope: Scope, depth = 4): unknown {
  let at = action;
  for (let i = 0; i < Math.max(0, depth); i += 1) {
    if (!isMap(at)) return at;
    const ref = (at as { $ref?: unknown }).$ref;
    if (typeof ref !== "string" || !ref) return at;
    const parts = ref.split(".");
    const root = parts.shift();
    let cur: unknown = root === "args" ? scope.args : root === "item" ? scope.item : undefined;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== "object") { cur = undefined; break; }
      if (p === "__proto__" || p === "constructor" || p === "prototype") { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur === at) return undefined;
    at = cur;
  }
  return at;
}

/** True when a change at `changed` could change anything this node reads. */
export function nodeReads(deps: readonly string[], changed: string): boolean {
  for (const d of deps) if (pathsTouch(d, changed)) return true;
  return false;
}
