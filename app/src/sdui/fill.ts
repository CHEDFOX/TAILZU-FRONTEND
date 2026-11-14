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
import { isEvaluable } from "./kernel/text.ts";

/** What a reference is read from. actions.ts's Ctx is one. */
export interface Scope {
  store: Pick<Store, "get" | "snapshot">;
  flags: Record<string, any>;
  labels: Record<string, string>;
  event?: any;
  /**
   * VOCAB 2 INSIDE AN ACTION (pure/SPEC.md 2.2, 2.4).
   *
   * A rule's own example is `do: { kind: "setState", path: "now", value: { "$": "now()" } }`, and the value
   * reached the store as that object: the references below are the only thing that was ever filled in, and an
   * expression is not a reference. `callEndpoint.path: { "$t": … }` was worse — a path that is not a string
   * threw, so the call was never made at all.
   *
   * actions.ts puts the kernel here, and only for a screen that asked for `expr`; absent everywhere else, so an
   * action on a vocab-1 screen is filled exactly as it always was.
   */
  expr?: (value: unknown, opts?: { encode?: boolean }) => unknown;
}

/**
 * THE ESCAPE (pure/SPEC.md 2.2, "Today's fillText has the same weakness").
 *
 * `fillText` fills every `$state.` token it finds ANYWHERE inside an action's string — which is right for a
 * sentence the server wrote, and wrong for a sentence that has somebody's own words in it. A note titled
 * "$state.user.email" baked into a toast's literal would otherwise pull that value out of the store and put it
 * in front of whoever is looking.
 *
 * So the server's kit escapes a `$` in text that came from a person: it sends `\$`, and this is the only place
 * that reads it — `\$` becomes a plain `$` and the token after it is NOT filled. A backslash before anything
 * else is left exactly as it is, because people type backslashes.
 */
const ESCAPED = "\\$";

/** Resolve "$state.x" / "$event" / "$flags.x" placeholders — and `{ $ }` / `{ $t }` — inside any value. */
export function resolveValue(value: any, ctx: Scope, opts?: { encode?: boolean }): any {
  // An escaped reference is the characters themselves, not a reference: "\$state.x" is the text "$state.x".
  if (typeof value === "string" && value.startsWith(ESCAPED)) return value.slice(1);
  if (typeof value === "string" && value.startsWith("$")) {
    if (value === "$event") return ctx.event;
    if (value === "$state") return ctx.store.snapshot();
    if (value.startsWith("$state.")) return ctx.store.get(value.slice("$state.".length));
    if (value.startsWith("$flags.")) return ctx.flags[value.slice("$flags.".length)];
    return value;
  }
  // The kernel's two shapes, worked out whole: nothing inside one is a reference to fill in afterwards.
  if (ctx.expr && isEvaluable(value)) return ctx.expr(value, opts);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx, opts));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value)) out[k] = resolveValue(value[k], ctx, opts);
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
export function fillText(value: any, ctx: Scope, opts?: { encode?: boolean }): string {
  if (typeof value !== "string") {
    // `opts` rides along, so the holes in a `{ $t }` URL are encoded exactly as the holes in a literal one are.
    const v = resolveValue(value, ctx, opts);
    return v == null ? "" : typeof v === "string" ? v : String(v);
  }
  if (value.startsWith("@")) return ctx.labels[value.slice(1)] ?? "";
  if (value === "$event" || /^\$(state|flags)\.[A-Za-z0-9_.]*[A-Za-z0-9_]$/.test(value)) {
    const v = resolveValue(value, ctx);
    return v == null ? "" : String(v);
  }
  // `encode` is for an address (openUrl, openInAppBrowser): a value filled INTO a longer URL is encoded, so a
  // value holding "&", "#" or a space cannot change where the link goes. A whole-value reference is the URL
  // itself and is handled above, unencoded.
  return value.replace(/\\\$|\$(?:state|flags)\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g, (m) => {
    if (m === ESCAPED) return "$";
    const v = resolveValue(m, ctx);
    if (v == null) return "";
    return opts?.encode ? encodeURIComponent(String(v)) : String(v);
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
