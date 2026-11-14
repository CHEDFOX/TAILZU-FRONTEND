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

/** The roots a screen brings, as getters: nothing is read until an expression asks for it. */
export function baseScope(ctx: Ctx): BaseScope {
  const text = catalogText(ctx.labels ?? {});
  return {
    get state() { return ctx.store.snapshot(); },
    get device() { return getDeviceFacts(); },
    get local() { return allLocal(); },
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
  const src = typeof expr === "string" ? expr
    : expr && typeof expr === "object" && typeof (expr as { $?: unknown }).$ === "string" ? (expr as { $: string }).$
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
