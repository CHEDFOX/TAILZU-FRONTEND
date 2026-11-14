/**
 * WHAT AN EXPRESSION MAY READ ON THIS PHONE (pure/SPEC.md 2.2's names, 2.9's facts).
 *
 * The kernel names seven roots — `state`, `device`, `local`, `item`, `index`, `args`, `ui` — and knows where none
 * of them come from. This is where they come from:
 *
 *   state   the screen's own store (state.ts)
 *   device  the fixed fact list (device/facts.ts), nothing else, no identifiers
 *   local   what this phone remembers (local.ts)
 *   ui      where a gesture ended, which the gesture block wrote into the store under `ui.*`
 *   env     the locale and the clock, read fresh every time, so `now()` means now
 *   text    the catalog, for `t(key, vars)`
 *
 * Read through getters, so building a scope costs nothing: a node that reads only `state.x` never touches the
 * device facts or the phone's own values at all.
 */

import { useEffect, useState } from "react";
import type { Ctx } from "../actions";
import { getDeviceFacts, subscribeDeviceFacts } from "../device/facts";
import { allLocal, subscribeLocal } from "../local";
import type { BaseScope, RenderScope } from "./nodeCore.ts";
import { kernelScope, nodeReads } from "./nodeCore.ts";
import { compileExpr, type Scope } from "../kernel/index.ts";
import type { ItemScope } from "../components/v3Host";

/** `t(key, vars)`: the catalog's copy, with `{name}` holes filled. A key the catalog lacks comes back as the key. */
function catalogText(labels: Record<string, string>): (key: string, vars?: Record<string, unknown>) => string {
  return (key, vars) => {
    const line = labels[key];
    if (line === undefined) return key;
    if (!vars) return line;
    return line.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
      const v = vars[name];
      return v === undefined || v === null ? whole : String(v);
    });
  };
}

/**
 * The roots a screen brings, as getters: nothing is read until an expression asks for it.
 *
 * `device` and `local` are their own BLOCKS (SPEC 2.9), so they are here only for a screen that said it needs
 * them — which is also what `sdui.off: ["local"]` has to mean, because `clientBlocks` takes an off block out of
 * what the screen is given. A screen that did not name them reads `undefined`, the same as a name the kernel
 * does not know. `env` still has the locale, because that is the formatter's and not a fact a screen may read.
 */
export function baseScope(ctx: Ctx): BaseScope {
  const text = catalogText(ctx.labels ?? {});
  const has = (block: string): boolean => !!ctx.blocks && ctx.blocks.includes(block);
  return {
    get state() { return ctx.store.snapshot(); },
    get device() { return has("device") ? getDeviceFacts() : undefined; },
    get local() { return has("local") ? allLocal() : undefined; },
    get ui() { return ctx.store.get("ui"); },
    get env() {
      const facts = getDeviceFacts() as { locale?: string };
      return { locale: typeof facts.locale === "string" && facts.locale ? facts.locale : "en-US", now: Date.now() };
    },
    text,
  };
}

/** One scope, ready for the kernel: the screen's roots plus this node's row and arguments. */
export function scopeOf(ctx: Ctx, scope?: RenderScope): Scope {
  return kernelScope(baseScope(ctx), scope);
}

/** Does a change at this device-fact or local path matter to anything in `deps`? */
export function factsMatter(deps: readonly string[], changed: readonly string[], root: "device" | "local"): boolean {
  for (const c of changed) if (nodeReads(deps, `${root}.${c}`)) return true;
  return false;
}

/** Watch the device facts and the phone's own values, for the paths these deps read. Null deps watches nothing. */
export function watchFacts(deps: readonly string[] | null, onChange: () => void): () => void {
  if (!deps || deps.length === 0) return () => {};
  const wantsDevice = deps.some((d) => d === "device" || d.startsWith("device."));
  const wantsLocal = deps.some((d) => d === "local" || d.startsWith("local."));
  const stops: Array<() => void> = [];
  if (wantsDevice) stops.push(subscribeDeviceFacts((changed) => { if (factsMatter(deps, changed, "device")) onChange(); }));
  if (wantsLocal) stops.push(subscribeLocal((path) => { if (factsMatter(deps, [path], "local")) onChange(); }));
  return () => { for (const s of stops) s(); };
}

/**
 * The hook behind that, for a node: re-render when a device fact or a phone-local value this node reads changes.
 *
 * Always called, so a node that gains an expression cannot change the hook order; it subscribes to nothing at all
 * unless the node really reads `device.*` or `local.*`.
 */
export function useFactsWatch(deps: readonly string[] | null): void {
  const [, force] = useState(0);
  const key = deps ? deps.join(",") : "";
  useEffect(
    () => watchFacts(key ? key.split(",") : null, () => force((n) => n + 1)),
    [key],
  );
}

/**
 * `List.sticky`: is this row's expression true? Compiled once per source string, because a list asks it for
 * every row it holds.
 */
const stickyCache = new Map<string, { run(s: Scope): unknown } | null>();

export function itemBool(expr: unknown, ctx: Ctx, scope: ItemScope): boolean {
  // ONLY THE `{ "$": … }` SHAPE (SPEC 2.2 principle 4). A bare string is data, not a template, everywhere else in
  // this renderer, and `sticky` is no exception: compiling one here would be the one place a plain string from
  // the server gets run as an expression.
  const src = expr && typeof expr === "object" && typeof (expr as { $?: unknown }).$ === "string"
    ? (expr as { $: string }).$
    : null;
  if (!src) return false;
  let compiled = stickyCache.get(src);
  if (compiled === undefined) {
    try { compiled = compileExpr(src); } catch { compiled = null; }
    // One cache for the launch, and a small one: a screen has a handful of sticky expressions, not one per row.
    if (stickyCache.size > 64) stickyCache.clear();
    stickyCache.set(src, compiled);
  }
  if (!compiled) return false;
  try {
    return !!compiled.run(kernelScope(baseScope(ctx), { item: scope.item, index: scope.index, argsStack: scope.args ? [scope.args] : undefined }));
  } catch {
    return false;
  }
}
