/**
 * RULES AND TIMERS, WIRED TO A SCREEN (pure/SPEC.md 2.4, B3).
 *
 * The thinking is in two files that know nothing about React: the kernel's `RuleMachine` (what fires, and when to
 * come back) and `rulesHost.ts` (the one timer and the re-entrancy guard). This is the part that only React can
 * do — compile when the rules change, wake on a store write or a device fact moving, run what fired through
 * `runAction`, and stop everything when the screen or the node goes.
 *
 * Safe mode and `sdui.off: ["rules"]` turn the whole thing off upstream (`on`), so a screen that leans on a rule
 * draws without it rather than not at all.
 *
 * THREE THINGS THIS FILE HAS TO GET RIGHT, AND EACH ONE WAS A BUG:
 *   1. The same rules are the same rules. A quiet live reload hands the screen a new copy of the very same JSON,
 *      and keying the compile on the identity of that object rebuilt the machine — so every `once: true` rule
 *      fired AGAIN, and a screen that navigates or toasts on arrival did it once per reload.
 *   2. The caps are the SCREEN's, not the call's (SPEC 5.1: 32 rules, 4 timers). `compileRules` counts within one
 *      call, and the renderer calls this for every node — so a list of fifty rows with a timer each had fifty
 *      timers. The screen's budget below is shared through a context and claimed in order.
 *   3. Nothing runs in the background (SPEC 2.4). The machine is told when the app leaves the front, and `every`
 *      is compiled against the floor that applies there.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { LIMITS } from "../kernel/limits.ts";
import { compileRules, type CompiledRule } from "../kernel/rules.ts";
import type { Ctx } from "../actions";
import { runAction } from "../actions";
import { noteBadNode } from "../safety";
import { baseScope, watchFacts } from "./scope";
import { kernelScope, type RenderScope } from "./nodeCore.ts";
import { RulesHost, claimRules, releaseRules, rulesKey, type RuleBudget } from "./rulesHost.ts";

/** The paths every `when` in this set reads, so the facts watcher knows what to listen to. */
function depsOf(rules: readonly CompiledRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (!r.when) continue;
    for (const d of r.when.deps) if (!out.includes(d)) out.push(d);
  }
  return out;
}

export { type RuleBudget } from "./rulesHost.ts";

export const RuleBudgetContext = createContext<RuleBudget | null>(null);

/** A fresh allowance, for one screen. */
export function makeRuleBudget(): RuleBudget {
  return { rules: 0, timers: 0 };
}

/** True while the app is the thing on the screen. `every` is only allowed to be quick here (SPEC 2.4). */
function inFront(): boolean {
  const s = AppState.currentState;
  return s !== "background" && s !== "inactive";
}

/**
 * Drive one set of rules for as long as the caller is mounted.
 *
 * `raw` is whatever the server put in `rules`; bad ones are dropped with a reason and reported, so one wrong rule
 * never costs a screen the other thirty-one. `scope` is the node's own row and arguments, so a rule on a list row
 * can read `item` and `args` — without it a row's rule saw neither.
 */
export function useRules(
  raw: unknown, ctx: Ctx, on: boolean, visible: boolean, scope?: RenderScope, own?: RuleBudget | null,
): void {
  // The screen's own rules are driven from ScreenTree, which is ABOVE the provider it makes, so it hands the
  // allowance in directly. Every node under the screen finds the same object through the context.
  const fromContext = useContext(RuleBudgetContext);
  const budget = own ?? fromContext;
  const [front, setFront] = useState(inFront);
  // The screen's rules, by what they SAY rather than by which object says it.
  const key = on && raw !== undefined && raw !== null ? rulesKey(raw) : "";
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const compiled = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => (key ? compileRules(rawRef.current, { foreground: front }) : null),
    [key, front],
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const hostRef = useRef<RulesHost | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // IN FRONT OR NOT. A rule may not fire while the app is away (SPEC 2.4), and `every` is allowed to be quicker
  // only while it is here — so coming back is both a recompile and a fresh start for the timers.
  useEffect(() => {
    const sub = AppState.addEventListener("change", () => setFront(inFront()));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!compiled || compiled.rules.length === 0) {
      hostRef.current = null;
      return;
    }
    for (const why of compiled.errors.slice(0, 2)) {
      try { noteBadNode(`rules:${why.slice(0, 40)}`); } catch { /* reporting is never the next error */ }
    }
    const { kept, dropped } = claimRules(compiled.rules, budget);
    if (dropped > 0) {
      try { noteBadNode(`rules:${dropped} over this screen's ${LIMITS.rules}/${LIMITS.timers}`); } catch { /* ignore */ }
    }
    if (kept.length === 0) { hostRef.current = null; return () => releaseRules(kept, budget); }
    const host = new RulesHost(kept, {
      now: () => Date.now(),
      setTimer: (ms, fn) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      scope: () => kernelScope(baseScope(ctxRef.current), scopeRef.current),
      fire: (action) => { void runAction(action as never, ctxRef.current); },
    }, visibleRef.current && front);
    hostRef.current = host;

    const pass = () => host.pass();
    const stops = [ctx.store.subscribe(pass), watchFacts(depsOf(kept), pass)];
    host.pass();
    return () => {
      host.stop();
      hostRef.current = null;
      for (const s of stops) s();
      releaseRules(kept, budget);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled, ctx.store, budget, front]);

  // A node went off or came back on screen: its timers start again from here rather than firing every tick it
  // missed (RuleMachine.setVisible). The app leaving the front counts as going off screen.
  useEffect(() => {
    hostRef.current?.setVisible(visible && front);
  }, [visible, front]);
}
