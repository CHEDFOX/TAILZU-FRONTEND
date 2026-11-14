/**
 * THE ONE PLACE EVERY BLOCK IS TURNED ON (pure/SPEC.md 2.0 principle 2).
 *
 * Each block was built to stay off: it exports a `register…` function and wires itself into nothing. This file is
 * the only caller of all of them, and the one adapter between the three register shapes they chose —
 * `addBlock(name, spec)` (motion, gesture, paint, device, local), `register(block, spec, impl)` (data) and
 * `register(block, spec, nodes, helpers)` (shell) — plus the node registry the list, input and media nodes go into.
 *
 * Registering is a PROMISE, not a wish: a name reaches `blocks` in the handshake only after its code has loaded and
 * said it works. `gesture` is asked first (a binary without gesture-handler can draw a gesture node but can never
 * take a finger on it), and anything that throws while registering is left out with a note, so one block that
 * cannot load costs the server one block and not the app.
 *
 * `expr`, `defs` and `rules` have no register function of their own: they ARE the kernel plus this renderer, so
 * this file declares them once the kernel is here.
 */

import { REGISTRY, registerListsInputsMedia, LISTS_INPUTS_MEDIA_SPEC, BLOCK_NODES } from "../components";
import { registerMotion, MOTION_SPEC } from "../motion";
import { registerGesture, gesturesAvailable, GESTURE_SPEC } from "../gesture";
import { registerPaint } from "../theme/paint";
import { registerDevice } from "../device/facts";
import { registerLocal } from "../local";
import { registerData, SPEC as DATA_SPEC } from "../data";
import { registerShell, SPEC as SHELL_SPEC } from "../shell/blocks";
import { LIMITS, VOCAB } from "../kernel/index.ts";
import type { BlockRegistry } from "../blockRegistry";
import { setRegisteredBlocks } from "./declared.ts";

/** What the kernel's own three blocks promise, as data, for the server lint. */
const KERNEL_SPECS: Record<string, unknown> = {
  expr: {
    block: "expr", vocab: VOCAB,
    shapes: ['{ "$": "expr" } one value', '{ "$t": "… {{ expr }} …" } text with holes', '{ "expr": "…" } a condition'],
    note: "a bare string is never a template; a value from state, a row or an endpoint is data",
    limits: { chars: LIMITS.exprChars, ops: LIMITS.exprOps, perScreen: LIMITS.exprPerScreen },
  },
  defs: {
    block: "defs", nodes: { Use: "{ def, args?, slots? }", Slot: "{ name?, children? (the default) }" },
    limits: { defs: LIMITS.defs, depth: LIMITS.defsDepth, nodes: LIMITS.defsNodes },
  },
  rules: {
    block: "rules", shape: '{ id, when { expr } | every | after, do, once?, debounceMs?, whileVisible? }',
    limits: { rules: LIMITS.rules, timers: LIMITS.timers, everyMs: LIMITS.everyMs, firesPerSecond: LIMITS.firesPerSecond },
  },
};

/** Every block that registered, with what it says about itself. */
const specs = new Map<string, unknown>();
/** Anything that could not be turned on, for the handshake's report and for a log. */
const failed: string[] = [];
/**
 * WHICH BLOCK EACH NEW NODE TYPE BELONGS TO.
 *
 * Registering puts `List` and the rest in the one registry, for the whole launch. A SCREEN still only gets them
 * when it said it needs that block (SPEC 2.0 principle 2), and the renderer asks this to know which block a type
 * came from. A type that is not here is vocab 1 and belongs to no block, as every type did before this.
 */
const nodeBlock = new Map<string, string>();
let done = false;

/** The adapter: the three shapes every block picked, answered by one object. */
class Adapter implements BlockRegistry {
  addBlock(name: string, spec: unknown): void {
    specs.set(name, spec);
  }

  /**
   * data's and shell's shape — and they are NOT the same shape, which is the whole care here.
   *
   * The shell says `register(block, spec, nodes, helpers)`: a map of node types to draw, then plain functions.
   * data says `register(block, spec, impl)`: plain functions in the third place, no node types at all. Taking
   * data's third argument for node types put `bindSubscribeHost` and `subscribeEvent` in the node registry — so
   * a screen could draw `{ "type": "bindSubscribeHost" }` and CALL one of them with a bag of props it chose,
   * replacing the live socket's host. Server data must never reach an internal function (SPEC 2.0 principle 3).
   *
   * So a name becomes a node type only when the block's own spec DECLARES it as one, under `nodes`. The spec is
   * the contract both sides read; a function the spec does not name as a node is an implementation helper and is
   * kept out of the registry.
   */
  register(block: string, spec: unknown, nodes?: Record<string, unknown>, _helpers?: Record<string, unknown>): void {
    specs.set(block, spec);
    if (!nodes) return;
    const declared = (spec as { nodes?: Record<string, unknown> } | null | undefined)?.nodes;
    if (!declared || typeof declared !== "object") return;
    for (const type of Object.keys(nodes)) {
      if (!Object.prototype.hasOwnProperty.call(declared, type)) continue;
      const comp = nodes[type];
      if (typeof comp !== "function") continue;
      REGISTRY[type] = comp as (typeof REGISTRY)[string];
      nodeBlock.set(type, block);
    }
  }
}

const adapter = new Adapter();

/** Turn one block on, and never let its own loading take the app with it. */
function turnOn(name: string, on: () => void): void {
  try {
    on();
    if (!specs.has(name)) specs.set(name, { block: name });
  } catch (e) {
    failed.push(`${name}:${e instanceof Error ? e.message : "failed"}`.slice(0, 80));
    specs.delete(name);
  }
}

/**
 * Turn every block this build has on, once. Safe to call twice (the second call does nothing).
 *
 * The kill switches are NOT read here. A switch can change while the app is up (a new bootstrap), and what
 * registered cannot; `declaredBlocks` in blocksCore.ts takes the floor off this list every time it is asked.
 */
export function setupBlocks(): readonly string[] {
  if (done) return registeredBlocks();
  done = true;

  for (const name of Object.keys(KERNEL_SPECS)) specs.set(name, KERNEL_SPECS[name]);

  turnOn("motion", () => registerMotion(adapter));
  // A binary without react-native-gesture-handler draws a gesture node and can never take a finger on it, so it
  // must not promise `gesture` (V2's hand-off note).
  if (gesturesAvailable()) turnOn("gesture", () => registerGesture(adapter));
  turnOn("paint", () => registerPaint(adapter));
  turnOn("device", () => registerDevice(adapter));
  turnOn("local", () => registerLocal(adapter));
  turnOn("data", () => registerData(adapter));
  turnOn("shell", () => registerShell(adapter));
  // Lists, inputs and media are node types rather than a spec object, and all three arrive together.
  turnOn("list", () => {
    registerListsInputsMedia(REGISTRY);
    for (const block of Object.keys(BLOCK_NODES) as Array<keyof typeof BLOCK_NODES>) {
      adapter.addBlock(block, LISTS_INPUTS_MEDIA_SPEC);
      for (const type of BLOCK_NODES[block]) nodeBlock.set(type, block);
    }
  });

  setRegisteredBlocks(registeredBlocks());
  return registeredBlocks();
}

/** The names that are really on, in no particular order. `declaredBlocks` puts them in the kernel's order. */
export function registeredBlocks(): readonly string[] {
  return [...specs.keys()];
}

/** What each block said about itself, for a test and for anyone who wants to print the contract. */
export function blockSpecs(): ReadonlyMap<string, unknown> {
  return specs;
}

/**
 * The block a node type came from, or null when it is one of the types this app always drew. A screen that did
 * not ask for that block is not given the type: the renderer draws the node's `fallback` instead, exactly as it
 * does for a type this build never had.
 */
export function blockForType(type: string): string | null {
  return nodeBlock.get(type) ?? null;
}

/** Blocks whose own code would not load. Reported with the handshake, never retried. */
export function blocksThatFailed(): readonly string[] {
  return failed;
}

export { MOTION_SPEC, GESTURE_SPEC, DATA_SPEC, SHELL_SPEC };
