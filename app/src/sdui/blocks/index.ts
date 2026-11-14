/**
 * THE GLUE (pure/SPEC.md 2.0-2.12): everything that joins the blocks to the renderer, in one folder.
 *
 *   blocksCore.ts  which blocks this client has, which a screen needs, and what to draw when they disagree (pure)
 *   nodeCore.ts    one node's expressions, compiled and worked out, and what it reads (pure)
 *   rulesHost.ts   the scheduler around the kernel's rule machine (pure)
 *   declared.ts    what the handshake says: the block names and this binary's runtime
 *   registry.ts    the one adapter every block's `register…` goes through, and the node-type-to-block map
 *   scope.ts       where `state`, `device`, `local`, `ui`, the clock and the catalog come from
 *   hosts.ts       the host interfaces the blocks declared, implemented once
 *   useRules.ts    the React half of rules and timers
 *   ScreenTree.tsx one screen: the gate, its templates, its rules, its hosts
 */

export { blocksForScreen, declaredBlocks, kernelFingerprint, missingForScreen, screenNeeds, updateTree } from "./blocksCore.ts";
export { compileNode, kernelScope, nodeReads, resolveInto, scopeFor } from "./nodeCore.ts";
export type { BaseScope, CompiledNode, RenderScope } from "./nodeCore.ts";
export { RulesHost } from "./rulesHost.ts";
export type { RulesWorld } from "./rulesHost.ts";
export { appRuntime, clientBlocks, registeredNames } from "./declared.ts";
export { blockForType, blockSpecs, blocksThatFailed, registeredBlocks, setupBlocks } from "./registry";
export { baseScope, itemBool, scopeOf, useFactsWatch, watchFacts } from "./scope";
export { StateMirror, makeGestureHost, makeMotionHost, makeShellHost, makeSubscribeHost, makeV3Host } from "./hosts";
export { useRules } from "./useRules";
export { ScreenTree } from "./ScreenTree";
