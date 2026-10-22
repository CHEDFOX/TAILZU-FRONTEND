/**
 * THE REFERENCES AN ACTION CARRIES, FILLED IN.
 *
 * A screen is written before anything has happened on it, so an action points
 * at what it will need: "$state.x" for what the person typed or what an answer
 * said, "$flags.x" for a flag, "$event" for what the node fired with, "@key"
 * for the catalog's words. These turn the references into values when the
 * action runs. Free of react-native, so each rule is tested on its own
 * (fill.test.ts); actions.ts is the only caller.
 */
import type { Store } from "./state";

/** What a reference is read from. actions.ts's Ctx is one. */
export interface Scope {
  store: Pick<Store, "get" | "snapshot">;
  flags: Record<string, any>;
  labels: Record<string, string>;
  event?: any;
}

/** Resolve "$state.x" / "$event" / "$flags.x" placeholders inside any value. */
export function resolveValue(value: any, ctx: Scope): any {
  if (typeof value === "string" && value.startsWith("$")) {
    if (value === "$event") return ctx.event;
    if (value === "$state") return ctx.store.snapshot();
    if (value.startsWith("$state.")) return ctx.store.get(value.slice("$state.".length));
    if (value.startsWith("$flags.")) return ctx.flags[value.slice("$flags.".length)];
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = resolveValue(value[k], ctx);
    return out;
  }
  return value;
}

/**
 * Words an action puts in front of someone — a toast, a copied line. An
 * "@key" is the catalog's copy; "$state.x" inside a sentence is filled in.
 *
 * resolveValue only rewrites a string that IS a reference, so these reached
 * the screen as written: "@history.detail.toast", "Writing as $state.vcName.".
 * A key the catalog lacks, or a value that is not there, gives "" — the caller
 * shows nothing rather than an identifier. Only the ACTION's own literal is
 * looked up: a row's text that starts with "@" is a sentence, not a key.
 */
export function fillText(value: any, ctx: Scope): string {
  if (typeof value !== "string") {
    const v = resolveValue(value, ctx);
    return v == null ? "" : typeof v === "string" ? v : String(v);
  }
  if (value.startsWith("@")) return ctx.labels[value.slice(1)] ?? "";
  if (value === "$event" || /^\$(state|flags)\.[A-Za-z0-9_.]*[A-Za-z0-9_]$/.test(value)) {
    const v = resolveValue(value, ctx);
    return v == null ? "" : String(v);
  }
  return value.replace(/\$(state|flags)\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g, (m) => {
    const v = resolveValue(m, ctx);
    return v == null ? "" : String(v);
  });
}

/**
 * A navigate's params, filled in: "$state.ask.res.taskId" is the task an
 * answer named, which no screen could have written before it was asked. A
 * literal param is sent as written; no params stay none.
 */
export function navParams(params: Record<string, any> | undefined, ctx: Scope): Record<string, any> | undefined {
  return params == null ? undefined : resolveValue(params, ctx);
}
