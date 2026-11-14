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
 */

import { useEffect, useMemo, useRef } from "react";
import { compileRules } from "../kernel/rules.ts";
import type { Ctx } from "../actions";
import { runAction } from "../actions";
import { noteBadNode } from "../safety";
import { baseScope, watchFacts } from "./scope";
import { kernelScope } from "./nodeCore.ts";
import { RulesHost } from "./rulesHost.ts";

/** The paths every `when` in this set reads, so the facts watcher knows what to listen to. */
function depsOf(rules: ReturnType<typeof compileRules>["rules"]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (!r.when) continue;
    for (const d of r.when.deps) if (!out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * Drive one set of rules for as long as the caller is mounted.
 *
 * `raw` is whatever the server put in `rules`; bad ones are dropped with a reason and reported, so one wrong rule
 * never costs a screen the other thirty-one.
 */
export function useRules(raw: unknown, ctx: Ctx, on: boolean, visible: boolean): void {
  const compiled = useMemo(() => (on && raw ? compileRules(raw) : null), [on, raw]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const hostRef = useRef<RulesHost | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (!compiled || compiled.rules.length === 0) {
      hostRef.current = null;
      return;
    }
    for (const why of compiled.errors.slice(0, 2)) {
      try { noteBadNode(`rules:${why.slice(0, 40)}`); } catch { /* reporting is never the next error */ }
    }
    const host = new RulesHost(compiled.rules, {
      now: () => Date.now(),
      setTimer: (ms, fn) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      scope: () => kernelScope(baseScope(ctxRef.current), undefined),
      fire: (action) => { void runAction(action as never, ctxRef.current); },
    }, visibleRef.current);
    hostRef.current = host;

    const pass = () => host.pass();
    const stops = [ctx.store.subscribe(pass), watchFacts(depsOf(compiled.rules), pass)];
    host.pass();
    return () => {
      host.stop();
      hostRef.current = null;
      for (const s of stops) s();
    };
  }, [compiled, ctx.store]);

  // A node went off or came back on screen: its timers start again from here rather than firing every tick it
  // missed (RuleMachine.setVisible).
  useEffect(() => {
    hostRef.current?.setVisible(visible);
  }, [visible]);
}
