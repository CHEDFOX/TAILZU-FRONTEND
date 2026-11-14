/**
 * MOTION ON ANY NODE (pure SPEC 2.5, block B4): what the rest of the app imports.
 *
 * The block is OFF unless it is turned on. Nothing in here wires itself into the renderer: V1 calls
 * `registerMotion(registry)` when the client declares the `motion` block, and until it does, a node's `motion`
 * is data nobody reads.
 *
 *   motionCore.ts   the value model and every decision that is arithmetic (pure, tested in Node)
 *   MotionView.tsx  the Reanimated wiring
 *   sharedCore.ts   the shared-element move, worked out (pure, tested in Node)
 *   Shared.tsx      the overlay that draws it
 *   values.ts       the `ui.*` numbers gestures and scrolls write and `drive` reads
 *   valuesCore.ts   the name bus under it: the cap, and who is still holding what (pure, tested in Node)
 *   spec.ts         what the server may send, as data, for the lint and for V1
 */
import React from "react";
import type { ViewStyle } from "react-native";
import { MotionView, compiledFor, forModeCached, useMotionMode, type MotionHost } from "./MotionView";
import { SharedNode } from "./Shared";
import { movesAnything } from "./motionCore";
import { MOTION_SPEC } from "./spec";
import type { BlockRegistry } from "../blockRegistry";

export {
  MotionView, compiledFor, forModeCached, useMotionMode, liveMotionNodes, resetMotionCount, type MotionHost,
} from "./MotionView";
export { SharedNode, SharedOverlay, clearShared } from "./Shared";
export { MOTION_SPEC, type MotionSpec } from "./spec";
export * from "./motionCore";
export { flightOf, okBox, worthFlying, SharedBook, SHARED_MS, SHARED_WINDOW_MS, type Box, type Flight } from "./sharedCore";
export {
  valueFor, holdValue, releaseValue, resetValue, peekValue, readValue, valueCount, holdsOf, clearValues,
  bareName, MAX_VALUES,
} from "./values";
export { ValueBus } from "./valuesCore";
export { scrollIntoName, publishScroll, useScrollInto } from "./scroll";

/** True when this node asks for the motion block at all. V1 skips the wrap entirely when it does not. */
export function usesMotion(node: unknown): boolean {
  const m = (node as { motion?: unknown } | null)?.motion;
  if (!m || typeof m !== "object") return false;
  return movesAnything(compiledFor(m));
}

/**
 * Put a node's motion around what it drew.
 *
 * Returns the child untouched when the node asks for nothing, so a screen with no motion pays nothing for this
 * block being present. A node with `shared` gets the overlay's half too, outside the animated box, because the
 * flight measures where the node IS, not where its own entrance currently has it.
 */
export function wrapMotion(node: unknown, child: React.ReactNode, host?: MotionHost, style?: ViewStyle | null): React.ReactNode {
  const raw = (node as { motion?: unknown } | null)?.motion;
  if (!raw || typeof raw !== "object") return child;
  const compiled = compiledFor(raw);
  if (!movesAnything(compiled)) return child;
  return React.createElement(MotionGate, { raw, host, style }, child);
}

/** The one component that knows this launch's motion mode, so the two halves cannot disagree about it. */
function MotionGate(
  { raw, host, style, children }: { raw: unknown; host?: MotionHost; style?: ViewStyle | null; children?: React.ReactNode },
): React.ReactElement {
  const mode = useMotionMode();
  const c = forModeCached(compiledFor(raw), mode);
  const inner = React.createElement(MotionView, { motion: raw, host, style }, children);
  return c.shared
    ? React.createElement(SharedNode, { id: c.shared, enabled: true }, inner)
    : inner;
}

/**
 * Turn the motion block on. Called by V1, once, only when the client declares `motion`.
 *
 * The registry is the committed one (src/sdui/blockRegistry.ts), the same one registerPaint, registerLocal and
 * registerDevice use: a block says its name and hands over its schema, and nothing else. The wrapping half is
 * `usesMotion` and `wrapMotion`, which V1 imports from this file — a block does not need a registry shape of
 * its own to be wrapped, and inventing one would make V1 keep two.
 */
export function registerMotion(registry: BlockRegistry): void {
  registry.addBlock("motion", MOTION_SPEC);
}
