/**
 * The action interpreter — turns declarative ActionSpecs from the server into
 * real behavior (navigation, network, state, haptics, toasts…).
 */
import { Linking, Vibration } from "react-native";
import type { ActionRef, ActionSpec, Condition } from "./types";
import { Store } from "./state";
import { callEndpoint } from "./client";
import { signOut } from "../auth/auth";

export interface NavApi {
  push: (screenId: string, params?: Record<string, any>) => void;
  back: () => void;
  switchTab: (tabId: string) => void;
  reloadCurrent: () => void;
  /** Re-fetch bootstrap (labels + direction) and the current screen in place. */
  refreshLocale: () => void;
}

export interface Ctx {
  store: Store;
  actions: Record<string, ActionSpec>;
  flags: Record<string, any>;
  /** Central copy from the catalog; "@key" props resolve through this. */
  labels: Record<string, string>;
  nav: NavApi;
  toast: (message: string, tone?: string) => void;
  event?: any;
}

/** Resolve "$state.x" / "$event" / "$flags.x" placeholders inside any value. */
export function resolveValue(value: any, ctx: Ctx): any {
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

export function evalCondition(cond: Condition | undefined, ctx: Ctx): boolean {
  if (!cond) return true;
  if ("eq" in cond) return resolveValue(`$state.${cond.eq[0]}`, ctx) === cond.eq[1];
  if ("neq" in cond) return resolveValue(`$state.${cond.neq[0]}`, ctx) !== cond.neq[1];
  if ("truthy" in cond) return !!ctx.store.get(cond.truthy);
  if ("not" in cond) return !evalCondition(cond.not, ctx);
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, ctx));
  return true;
}

function spec(ref: ActionRef, ctx: Ctx): ActionSpec | null {
  if (typeof ref === "string") return ctx.actions[ref] ?? null;
  return ref;
}

export async function runAction(ref: ActionRef | undefined, ctx: Ctx): Promise<void> {
  if (!ref) return;
  const action = spec(ref, ctx);
  if (!action) return;

  switch (action.kind) {
    case "navigate":
      ctx.nav.push(action.screenId, action.params);
      break;
    case "navigateBack":
    case "dismiss":
      ctx.nav.back();
      break;
    case "switchTab":
      ctx.nav.switchTab(action.tabId);
      break;
    case "openUrl":
      Linking.openURL(action.url).catch(() => ctx.toast("Couldn't open link", "error"));
      break;
    case "refresh":
      ctx.nav.reloadCurrent();
      break;
    case "setState":
      ctx.store.set(action.path, resolveValue(action.value, ctx));
      break;
    case "toggleState":
      ctx.store.toggle(action.path);
      break;
    case "haptic":
      Vibration.vibrate(action.style === "heavy" ? 30 : action.style === "medium" ? 18 : 10);
      break;
    case "toast":
      ctx.toast(action.message, action.tone);
      break;
    case "callEndpoint": {
      try {
        const body = action.body != null ? resolveValue(action.body, ctx) : undefined;
        const res = await callEndpoint(action.method, action.path, body);
        if (action.assignTo) ctx.store.set(action.assignTo, res);
        await runAction(action.onSuccess, ctx);
        // Changing the language preference re-localizes the whole UI: pull a
        // fresh bootstrap (translated labels + RTL direction) and re-fetch the
        // current screen, with no need to tap "Reload".
        if (
          action.path === "/v1/profile" &&
          body != null &&
          typeof body === "object" &&
          "language" in body
        ) {
          ctx.nav.refreshLocale();
        }
      } catch {
        await runAction(action.onError, ctx);
      }
      break;
    }
    case "sequence":
      for (const a of action.actions) await runAction(a, ctx);
      break;
    case "condition":
      await runAction(evalCondition(action.if, ctx) ? action.then : action.else, ctx);
      break;
    case "signOut":
      // Clears the session; SduiApp's onAuthChange listener shows the gate.
      await signOut();
      break;
    case "speak":
    case "playMedia":
      // Wired in a later phase (uses /v1/speak); no-op for now.
      break;
  }
}
