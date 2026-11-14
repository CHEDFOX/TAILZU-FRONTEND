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
import { useRules } from "./useRules";
import { V3HostContext } from "../components/v3Host";
import type { ItemScope } from "../components/v3Host";
import { bindSubscribeHost, subscribeHub } from "../live/subscribe";
import { expandTree, type Defs } from "../kernel/defs.ts";
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
  const screenCtx = useMemo<Ctx>(
    () => {
      const base: Ctx = { ...ctx, blocks: live, screenId: screen.screenId };
      return { ...base, hosts: { motion: makeMotionHost(mirror), gesture: makeGestureHost(base) } };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, live.join(","), screen.screenId, mirror],
  );

  // TEMPLATES, once per screen. A screen that does not need `defs` is not walked at all.
  const root = useMemo<Node | null>(() => {
    const given = screen.root ?? null;
    if (!given || !live.includes("defs")) return given;
    try {
      const made = expandTree(given, (screen as { defs?: Defs }).defs ?? {});
      return (made.node as Node) ?? given;
    } catch (e) {
      // A screen whose templates do not compile is refused WHOLE (SPEC 5.2): the tree it would draw is not the
      // tree it meant. The server hears about it, and the person sees the screen's own fallback.
      try { noteBadNode(`defs:${screen.screenId}`, e instanceof KernelError ? e : undefined); } catch { /* ignore */ }
      return given.fallback ?? null;
    }
  }, [screen, live.includes("defs")]);

  const renderItem = React.useCallback(
    (template: unknown, scope: ItemScope, key: string): React.ReactNode =>
      React.createElement(RenderNode, {
        key,
        node: template as Node,
        ctx: screenCtx,
        scope: { item: scope.item, index: scope.index, argsStack: scope.args ? [scope.args] : undefined },
      }),
    [screenCtx],
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
  useRules((screen as { rules?: unknown }).rules, screenCtx, rulesOn() && live.includes("rules"), true);

  if (!root) return null;
  if (missing.length > 0) {
    return <RenderNode node={missingScreen(screen, missing)} ctx={ctx} />;
  }
  const tree = <RenderNode node={root} ctx={screenCtx} />;
  // The provider costs one element and nothing else; a screen without lists, inputs or media never reads it.
  return live.length === 0 ? tree : <V3HostContext.Provider value={v3}>{tree}</V3HostContext.Provider>;
}

/** The shell's host for the screen on show, for the trees the bootstrap draws outside this component. */
const shellHostRef: { current: ReturnType<typeof makeShellHost> | null } = { current: null };
export const currentShellHost = (): ReturnType<typeof makeShellHost> | null => shellHostRef.current;

/** Run one action in a screen's ctx. Exported for the shell trees, which have no node to fire from. */
export function runScreenAction(action: unknown, ctx: Ctx): void {
  void runAction(action as never, ctx);
}
