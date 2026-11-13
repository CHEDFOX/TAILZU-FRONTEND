/**
 * TEMPLATES: `Use`, `Slot` and a screen's own definitions (pure SPEC 2.3, B2).
 *
 * A screen may define a shape once and draw it many times — which is what a list row is. Definitions live inside
 * the screen that uses them; there is no catalog to fetch and nothing to keep in sync.
 *
 *   "defs": { "bot.row": { "params": ["bot"], "root": { … { "type": "Slot", "name": "trail" } … } } }
 *   { "type": "Use", "def": "bot.row", "args": { "bot": { "$": "item" } }, "slots": { "trail": { … } } }
 *
 * Expansion here is structural only: it copies trees, puts slot contents in their places, and leaves two markers
 * for the renderer. Values are never evaluated here, so this file stays pure and cheap.
 *
 * THE TWO MARKERS, which are the whole contract with the renderer:
 *
 *   `$args`   a LIST of argument frames, outermost first. The renderer works the first one out in the scope it
 *             already has, binds the result as `args`, works the next one out in THAT scope, and so on. A list,
 *             not one object, because a template whose root is itself a `Use` has two sets of arguments: the
 *             outer caller's, and the inner ones the template wrote in terms of them.
 *   `$argsUp` how many argument frames to step back past before reading this node. Slot contents are written by
 *             the CALLER but end up sitting inside the template they were given to, so without this they would
 *             read the template's `args` instead of the caller's. The renderer drops this many frames first, and
 *             then applies the node's own `$args`.
 *
 * The rules, all refused at compile: no recursion, direct or indirect; at most `LIMITS.defsDepth` deep; at most
 * `LIMITS.defs` definitions; at most `LIMITS.defsNodes` nodes in one item template; and at most
 * `LIMITS.expandSteps` steps of work, because `Use` and `Slot` draw nothing and so cost no nodes.
 */

import { LIMITS } from "./limits.ts";
import { KernelError } from "./expr.ts";
import { statePathError } from "./paths.ts";

/** A definition: the names it takes, and the tree it draws. */
export interface DefSpec {
  params?: readonly string[];
  root: unknown;
}

export type Defs = Record<string, DefSpec>;

/** The marker an expanded template root carries: the argument frames, outermost first. */
export const ARGS_KEY = "$args";

/** The marker slot content carries: how many argument frames to step back past before reading it. */
export const ARGS_UP_KEY = "$argsUp";

/**
 * Everything a `Use` may say. A `Use` leaves nothing of itself behind — what it expands to is the template's own
 * root — so a `visibleIf`, an `id` or a `style` written on it would simply disappear, and a condition that
 * disappears is a node that always shows. The author is told instead. `fallback` is allowed because it is for the
 * case where the template is missing, which never reaches an expanded tree.
 */
const USE_KEYS: ReadonlySet<string> = new Set(["type", "def", "args", "slots", "fallback"]);

const owns = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A plain node object, as a screen sends it. */
function isNode(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The children of a node, as a list. */
function childrenOf(node: Record<string, unknown>): unknown[] {
  const c = node.children;
  return Array.isArray(c) ? c : [];
}

/** What a walk of one definition found: the templates it calls, and anything wrong on the way. */
interface Scan {
  uses: string[];
  problems: string[];
}

function note(found: Scan, problem: string): void {
  if (!found.problems.includes(problem)) found.problems.push(problem);
}

/**
 * Walk a definition's tree: every `Use` by the name it calls, and every way the tree is already wrong. The depth
 * is capped, because this runs on data the server sent and a tree six thousand deep would otherwise overflow the
 * stack of the publish gate rather than be reported by it.
 */
function scanTree(tree: unknown, depth: number, found: Scan): void {
  if (depth > LIMITS.depth) {
    note(found, `nests more than ${LIMITS.depth} deep`);
    return;
  }
  if (Array.isArray(tree)) {
    for (const t of tree) scanTree(t, depth + 1, found);
    return;
  }
  if (!isNode(tree)) return;
  if (tree.type === "Use") {
    if (typeof tree.def === "string" && tree.def) {
      if (!found.uses.includes(tree.def)) found.uses.push(tree.def);
    } else {
      note(found, "has a Use that names no template");
    }
    for (const k of Object.keys(tree)) {
      if (USE_KEYS.has(k)) continue;
      note(found, `has a Use carrying "${k}", which expansion would drop; put it on the template or on a node around the Use`);
    }
  }
  for (const c of childrenOf(tree)) scanTree(c, depth + 1, found);
  const slots = tree.slots;
  if (isNode(slots)) for (const k of Object.keys(slots)) scanTree(slots[k], depth + 1, found);
}

/**
 * Everything wrong with a screen's definitions, as plain sentences. Empty means they are fine. Lint wants them all
 * at once, so this collects rather than throws — including for the hostile shapes (a definition called
 * `__proto__`, a tree nested thousands deep), which must be reported by the publish gate, not crash it.
 */
export function checkDefs(defs: unknown): string[] {
  const errors: string[] = [];
  if (defs === undefined || defs === null) return errors;
  if (!isNode(defs)) return ["defs must be an object of definitions"];
  const names = Object.keys(defs);
  if (names.length > LIMITS.defs) errors.push(`a screen has at most ${LIMITS.defs} definitions`);
  // Maps, not plain objects: `graph["__proto__"] = []` on an object goes nowhere, and the walk below would then
  // follow a definition that is never marked as visited and recurse until the stack gives out.
  const graph = new Map<string, string[]>();
  const known = new Set(names);
  for (const name of names) {
    graph.set(name, []);
    const shape = statePathError(name);
    if (shape) {
      errors.push(`the definition name "${name}" is not a plain name: ${shape}`);
      continue;
    }
    const d = defs[name];
    if (!isNode(d) || !owns(d, "root")) {
      errors.push(`the definition "${name}" has no root`);
      continue;
    }
    const spec = d as unknown as DefSpec;
    if (spec.params !== undefined && !Array.isArray(spec.params)) errors.push(`the definition "${name}" has params that are not a list`);
    const found: Scan = { uses: [], problems: [] };
    scanTree(spec.root, 1, found);
    for (const p of found.problems) errors.push(`the definition "${name}" ${p}`);
    for (const u of found.uses) if (!known.has(u)) errors.push(`the definition "${name}" uses "${u}", which this screen does not define`);
    graph.set(name, found.uses.filter((u) => known.has(u)));
  }

  // A cycle means a screen that draws forever. Walk each name, keeping the path, and name the loop we find.
  const state = new Map<string, number>();
  const path: string[] = [];
  const walk = (name: string): void => {
    const was = state.get(name);
    if (was === 2) return;
    if (was === 1) {
      const from = path.indexOf(name);
      errors.push(`the definitions ${[...path.slice(from), name].join(" → ")} use each other in a circle`);
      return;
    }
    state.set(name, 1);
    path.push(name);
    for (const next of graph.get(name) ?? []) walk(next);
    path.pop();
    state.set(name, 2);
  };
  for (const name of names) walk(name);
  return errors;
}

/** One `Use` being expanded: the slots it was given, over the frame that gave them. */
interface Frame {
  slots: Record<string, unknown>;
  parent: Frame | null;
  /** How many argument frames were in effect where these slots were written. */
  argDepth: number;
}

interface Work {
  defs: Defs;
  maxNodes: number;
  maxDepth: number;
  nodes: number;
  deepest: number;
  /** Every call of `expandOne`, so a fan-out through `Use` and `Slot` that draws nothing is still bounded. */
  steps: number;
}

const EMPTY_FRAME: Frame = { slots: {}, parent: null, argDepth: 0 };

/**
 * Copy a node, with its children already expanded. The other props are carried over as they are: nothing here
 * changes a value, and two rows drawn from one template may share the prop objects they were given, because
 * nothing in the renderer writes to them.
 */
function rebuild(node: Record<string, unknown>, children: unknown[] | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(node)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = node[k];
  }
  if (children) out.children = children;
  return out;
}

/** Mark slot content: it reads the scope of the place it was WRITTEN, which is `up` argument frames back. */
function markUp(made: unknown, up: number): unknown {
  if (Array.isArray(made)) return made.map((m) => markUp(m, up));
  if (!isNode(made)) return made;
  // Content handed on through a second slot steps back past both hops.
  const had = typeof made[ARGS_UP_KEY] === "number" ? (made[ARGS_UP_KEY] as number) : 0;
  return { ...made, [ARGS_UP_KEY]: had + up };
}

/** Put a `Use`'s arguments on what it expanded to, keeping any the template itself wrote. */
function withArgs(made: unknown, args: Record<string, unknown>): unknown {
  if (Array.isArray(made)) return made.map((m) => withArgs(m, args));
  if (!isNode(made)) return made;
  const up = typeof made[ARGS_UP_KEY] === "number" ? (made[ARGS_UP_KEY] as number) : 0;
  if (up > 0) {
    // This is slot content the caller wrote, so it reads the caller's `args`: this frame is one of the ones it
    // steps back past, and putting the frame here simply cancels one of those steps.
    const out = { ...made };
    if (up === 1) delete out[ARGS_UP_KEY];
    else out[ARGS_UP_KEY] = up - 1;
    return out;
  }
  const had = made[ARGS_KEY];
  return { ...made, [ARGS_KEY]: Array.isArray(had) ? [args, ...had] : [args] };
}

/** Expand one node. Gives back one node, a list of nodes (a slot that held several), or null. */
function expandOne(node: unknown, frame: Frame, useDepth: number, depth: number, w: Work, argDepth: number): unknown {
  w.steps += 1;
  if (w.steps > LIMITS.expandSteps) {
    throw new KernelError("defs", `expanding a screen takes at most ${LIMITS.expandSteps} steps`);
  }
  if (depth > w.maxDepth) throw new KernelError("defs", `a screen nests at most ${w.maxDepth} deep`);
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const c of node) pushExpanded(out, expandOne(c, frame, useDepth, depth, w, argDepth));
    return out;
  }
  if (!isNode(node)) return node;

  if (node.type === "Slot") {
    const name = typeof node.name === "string" && node.name ? node.name : "default";
    const given = owns(frame.slots, name) ? frame.slots[name] : undefined;
    if (given === undefined || given === null) {
      // Nothing was given, so the slot's own children are its default, in this same frame and this same scope.
      const kids = childrenOf(node);
      if (kids.length === 0) return null;
      const out: unknown[] = [];
      for (const c of kids) pushExpanded(out, expandOne(c, frame, useDepth, depth, w, argDepth));
      return out;
    }
    // Slot contents were written by the caller, so they are expanded in the caller's frame and read the caller's
    // arguments — however deep inside this template they land.
    const up = argDepth - frame.argDepth;
    const made = expandOne(given, frame.parent ?? EMPTY_FRAME, useDepth, depth, w, frame.argDepth);
    return up > 0 ? markUp(made, up) : made;
  }

  if (node.type === "Use") {
    for (const k of Object.keys(node)) {
      if (USE_KEYS.has(k)) continue;
      throw new KernelError("defs", `a Use carries "${k}", which expansion would drop; put it on the template or on a node around the Use`);
    }
    const name = typeof node.def === "string" ? node.def : "";
    if (!name || !owns(w.defs, name)) throw new KernelError("defs", `there is no template named "${name}"`);
    if (useDepth + 1 > LIMITS.defsDepth) throw new KernelError("defs", `templates nest at most ${LIMITS.defsDepth} deep`);
    const slots = isNode(node.slots) ? (node.slots as Record<string, unknown>) : {};
    const inner: Frame = { slots, parent: frame, argDepth };
    const args = isNode(node.args) ? node.args : undefined;
    const made = expandOne(w.defs[name]!.root, inner, useDepth + 1, depth, w, args === undefined ? argDepth : argDepth + 1);
    if (made === null || made === undefined) return null;
    if (args === undefined) return made;
    return withArgs(made, args);
  }

  w.nodes += 1;
  if (w.nodes > w.maxNodes) throw new KernelError("defs", `a screen draws at most ${w.maxNodes} nodes`);
  if (depth > w.deepest) w.deepest = depth;
  const kids = childrenOf(node);
  if (kids.length === 0) return rebuild(node, null);
  const out: unknown[] = [];
  for (const c of kids) pushExpanded(out, expandOne(c, frame, useDepth, depth + 1, w, argDepth));
  return rebuild(node, out);
}

/** A slot can give back several nodes, so a child list is flattened as it is built. */
function pushExpanded(out: unknown[], made: unknown): void {
  if (made === null || made === undefined) return;
  if (Array.isArray(made)) {
    for (const m of made) pushExpanded(out, m);
    return;
  }
  out.push(made);
}

/** What one expansion cost. */
export interface Expansion {
  node: unknown;
  nodes: number;
  depth: number;
  /** Every step it took, drawn or not. Reported back with the screen, so the limit can be tuned. */
  steps: number;
}

/**
 * Expand a tree. `maxNodes` is the screen's ceiling by default; a list-item template passes
 * `LIMITS.defsNodes` instead, because that tree is drawn once per row.
 */
export function expandTree(root: unknown, defs?: Defs, opts?: { maxNodes?: number; maxDepth?: number }): Expansion {
  const w: Work = {
    defs: defs ?? {},
    maxNodes: Math.max(1, Math.min(LIMITS.nodes, opts?.maxNodes ?? LIMITS.nodes)),
    maxDepth: Math.max(1, Math.min(LIMITS.depth, opts?.maxDepth ?? LIMITS.depth)),
    nodes: 0,
    deepest: 0,
    steps: 0,
  };
  // The same refusal the publish gate makes, so the device and the server never disagree about a definition's name.
  for (const name of Object.keys(w.defs)) {
    if (statePathError(name)) throw new KernelError("defs", `"${name}" is not a name a template may have`);
  }
  const node = expandOne(root, EMPTY_FRAME, 0, 1, w, 0);
  return { node: Array.isArray(node) ? (node[0] ?? null) : node, nodes: w.nodes, depth: w.deepest, steps: w.steps };
}

/** Expand a list-item template, under the smaller ceiling a row has to live inside. */
export function expandItem(root: unknown, defs?: Defs): Expansion {
  return expandTree(root, defs, { maxNodes: LIMITS.defsNodes });
}
