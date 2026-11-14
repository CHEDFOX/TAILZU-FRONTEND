/**
 * ONE SCREEN, AS A TREE OF BLOCKS (pure/SPEC.md 2.0, 2.3, 2.4, 2.12).
 *
 * `ScreenHost` builds the store and the ctx; this decides what the screen is allowed to be, and then draws it:
 *
 *   1. THE GATE. The screen says which blocks it needs. If this client lacks one, nothing of the screen is drawn:
 *      it gets the server's own fallback, or the small "open X0 again / update X0" tree. Half a screen — a
 *      slide-to-confirm that looks right and does nothing — is the one answer that is never given (SPEC 2.0
 *      principle 6, 2.12). A screen with no `needs` is a screen from before all this, and draws exactly as it did.
 *   2. TEMPLATES. `Use` and `Slot` are expanded once per screen, by the kernel, when the screen needs `defs`.
 *   3. RULES. The screen's own rules drive the kernel's RuleMachine, woken by `nextWakeAt` and by store changes.
 *   4. THE HOSTS. One object per block interface, in the contexts the blocks read.
 *
 * Everything here costs nothing for a screen that asks for nothing: no `needs` means no expansion, no machine and
 * no provider that was not there before.
 */

import React, { useEffect, useMemo } from "react";
import { RenderNode } from "../Renderer";
import type { Ctx } from "../actions";
import { runAction } from "../actions";
import type { Node, ScreenResponse } from "../types";
import { txt } from "../knobs";
import { noteBadNode, rulesOn } from "../safety";
import { blocksForScreen, missingForScreen, screenNeeds, updateTree } from "./blocksCore.ts";
import { setupBlocks } from "./registry";
import { clientBlocks } from "./declared.ts";
import { StateMirror, makeGestureHost, makeMotionHost, makeShellHost, makeSubscribeHost, makeV3Host } from "./hosts";
import { itemBool as itemBoolOf } from "./scope";
import { RuleBudgetContext, makeRuleBudget, useRules } from "./useRules";
import { ScreenBudget } from "./nodeCore.ts";
import { V3HostContext } from "../components/v3Host";
import type { ItemScope } from "../components/v3Host";
import { bindSubscribeHost, subscribeHub } from "../live/subscribe";
import { expandItem, expandTree, type Defs } from "../kernel/defs.ts";
import { KernelError } from "../kernel/index.ts";

/** A screen whose blocks this client cannot draw: the server's own answer first, ours only if it gave none. */
function missingScreen(screen: ScreenResponse, missing: readonly string[]): Node {
  const own = screen.root?.fallback;
  if (own) return own;
  // "Open X0 again" when an update is already waiting for this same binary; "Update X0" when it is not. The
  // client cannot tell which from here, so it asks for the kinder of the two and the server's own screen (which
  // it nearly always sends) says the exact thing.
  return updateTree(
    missing,
    {
      reopen: txt("blocks.reopen", "Open X0 again to see this"),
      update: txt("blocks.update", "Update X0 to see this"),
    },
    true,
  ) as unknown as Node;
}

/**
 * THE LAST VERSION OF A SCREEN THAT REALLY DREW (pure/SPEC.md 5.2).
 *
 * "A screen that fails to compile on the device is refused whole. The cached previous version is shown, and the
 * server is told." Before this the refusal drew NOTHING at all — a blank screen, which is the one answer the
 * fail-safe rules forbid. Keyed by screen id, one root each, and small: it is the last good copy of the handful
 * of screens this launch has been to.
 */
const lastGood = new Map<string, Node>();

function keepGood(id: string | undefined, root: Node | null): void {
  if (!id || !root) return;
  if (lastGood.size > 24 && !lastGood.has(id)) {
    const first = lastGood.keys().next();
    if (!first.done) lastGood.delete(first.value);
  }
  lastGood.set(id, root);
}

export function ScreenTree({ screen, ctx }: { screen: ScreenResponse; ctx: Ctx }) {
  // Turning the blocks on is a no-op after the first call; asked here so a screen can never be drawn before it.
  setupBlocks();
  const declared = clientBlocks();
  const needs = useMemo(() => screenNeeds(screen), [screen]);
  const missing = useMemo(() => missingForScreen(declared, needs), [declared.join(","), needs.join(",")]);
  const live = useMemo(
    () => (missing.length > 0 ? [] : blocksForScreen(declared, needs)),
    [declared.join(","), needs.join(","), missing.length],
  );

  // THE HOSTS. One per screen, so a block sees the same object for as long as the screen is up.
  const mirror = useMemo(() => new StateMirror(ctx.store), [ctx.store]);
  useEffect(() => () => mirror.stop(), [mirror]);

  // The ctx every node under here reads: the same object, plus which blocks are live on this screen and what
  // the motion and gesture blocks talk to the renderer through.
  // WHAT THIS SCREEN MAY SPEND (SPEC 5.1). One of each per screen: the expression budget every node claims
  // from as it compiles, and the rules-and-timers allowance every node's `useRules` claims from.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const budget = useMemo(() => new ScreenBudget(), [screen.screenId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ruleBudget = useMemo(() => makeRuleBudget(), [screen.screenId]);

  const screenCtx = useMemo<Ctx>(
    () => {
      const base: Ctx = { ...ctx, blocks: live, screenId: screen.screenId, budget };
      return { ...base, hosts: { motion: makeMotionHost(mirror), gesture: makeGestureHost(base) } };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, live.join(","), screen.screenId, mirror, budget],
  );

  // TEMPLATES, once per screen — and the screen's own size, depth and node limits, which are checked for every
  // vocab-2 screen whether it has templates or not (SPEC 5.1: 2,500 nodes, depth 48).
  const root = useMemo<Node | null>(() => {
    const given = screen.root ?? null;
    if (!given || live.length === 0) return given;
    const defs = live.includes("defs") ? (screen as { defs?: Defs }).defs ?? {} : {};
    try {
      const made = expandTree(given, defs);
      const out = (made.node as Node) ?? given;
      keepGood(screen.screenId, out);
      return out;
    } catch (e) {
      // A screen whose templates do not compile, or that is past a limit, is refused WHOLE (SPEC 5.2): the tree
      // it would draw is not the tree it meant. The server hears about it, and the person sees — in this order —
      // the screen's own fallback, the last version of this screen that drew, or the "update X0" card. Never a
      // blank screen, which is what the refusal used to give.
      try { noteBadNode(`defs:${screen.screenId}`, e instanceof KernelError ? e : undefined); } catch { /* ignore */ }
      return given.fallback ?? lastGood.get(screen.screenId ?? "") ?? null;
    }
  }, [screen, live.length, live.includes("defs")]);

  /**
   * ONE ROW, DRAWN (pure/SPEC.md 2.6, 2.3).
   *
   * A row template is usually a `Use` (the SPEC's own example is), and `Use` draws nothing by itself: the kernel
   * has to expand it against the screen's definitions first. The screen's own expansion above does not reach it,
   * because `List.item` is a PROP and the walk follows `children` — so every row used to be a node of type
   * "Use", which is in no registry, and every row drew its fallback or nothing at all.
   *
   * Expanded once per template object and kept on a WeakMap: a list asks for this once per row.
   */
  const expanded = useMemo(() => new WeakMap<object, Node | null>(), [screen]);
  const rowOf = React.useCallback((template: unknown): Node | null => {
    if (!template || typeof template !== "object") return null;
    const kept = expanded.get(template as object);
    if (kept !== undefined) return kept;
    let made: Node | null = template as Node;
    if (live.includes("defs")) {
      try {
        made = (expandItem(template, (screen as { defs?: Defs }).defs ?? {}).node as Node) ?? null;
      } catch (e) {
        try { noteBadNode(`item:${screen.screenId}`, e instanceof KernelError ? e : undefined); } catch { /* ignore */ }
        made = null;
      }
    }
    expanded.set(template as object, made);
    return made;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, screen, live.includes("defs")]);

  const renderItem = React.useCallback(
    (template: unknown, scope: ItemScope, key: string): React.ReactNode => {
      const node = rowOf(template);
      if (!node) return null;
      return React.createElement(RenderNode, {
        key,
        node,
        ctx: screenCtx,
        scope: { item: scope.item, index: scope.index, argsStack: scope.args ? [scope.args] : undefined },
      });
    },
    [screenCtx, rowOf],
  );
  const v3 = useMemo(
    () => makeV3Host(screenCtx, renderItem, (expr, scope) => itemBoolOf(expr, screenCtx, scope)),
    [screenCtx, renderItem],
  );

  // The data block's `subscribe` writes into this screen's store while it is the screen on show, and its
  // subscriptions go when it does.
  const wantsData = live.includes("data");
  useEffect(() => {
    if (!wantsData) return;
    bindSubscribeHost(makeSubscribeHost(ctx.store));
    const id = screen.screenId;
    return () => { subscribeHub()?.dropScreen(id); bindSubscribeHost(null); };
  }, [wantsData, ctx.store, screen.screenId]);

  // The shell block reads state and runs actions the same way a node does. Its trees are drawn by the shell
  // itself (V5), so the host is put where the shell can find it rather than mounted here.
  const shellHost = useMemo(() => makeShellHost(screenCtx), [screenCtx]);
  useEffect(() => { shellHostRef.current = shellHost; return () => { shellHostRef.current = null; }; }, [shellHost]);

  // RULES: the screen's own. A node's are driven by the node (Renderer.tsx), because they are live only while it is.
  useRules(
    (screen as { rules?: unknown }).rules, screenCtx, rulesOn() && live.includes("rules"), true,
    undefined, ruleBudget,
  );

  // The gate first: a screen this client cannot draw gets the server's own answer whatever became of its
  // templates, and a screen that could not be built at all gets the "update X0" card rather than nothing.
  if (missing.length > 0) {
    return <RenderNode node={missingScreen(screen, missing)} ctx={ctx} />;
  }
  if (!root) {
    if (!screen.root) return null;                       // a screen with no tree is not a screen that failed
    return <RenderNode node={missingScreen(screen, needs)} ctx={ctx} />;
  }
  const tree = <RenderNode node={root} ctx={screenCtx} />;
  // The providers cost one element each and nothing else; a screen without lists, inputs or media never reads
  // the host, and a screen without rules never claims from the budget.
  return live.length === 0 ? tree : (
    <RuleBudgetContext.Provider value={ruleBudget}>
      <V3HostContext.Provider value={v3}>{tree}</V3HostContext.Provider>
    </RuleBudgetContext.Provider>
  );
}

/** The shell's host for the screen on show, for the trees the bootstrap draws outside this component. */
const shellHostRef: { current: ReturnType<typeof makeShellHost> | null } = { current: null };
export const currentShellHost = (): ReturnType<typeof makeShellHost> | null => shellHostRef.current;

/** Run one action in a screen's ctx. Exported for the shell trees, which have no node to fire from. */
export function runScreenAction(action: unknown, ctx: Ctx): void {
  void runAction(action as never, ctx);
}
