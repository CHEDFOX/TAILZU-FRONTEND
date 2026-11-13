/**
 * GESTURES ON ANY NODE (pure SPEC 2.5, block B5): what the rest of the app imports.
 *
 * The block is OFF unless it is turned on. Nothing here wires itself into the renderer: V1 calls
 * `registerGesture(registry)` when the client declares the `gesture` block, and until it does, a node's
 * `gestures` is data nobody reads.
 *
 *   gestureCore.ts   the rules and the arithmetic (pure, tested in Node)
 *   GestureView.tsx  the gesture-handler wiring
 *   lib.ts           gesture-handler, asked for rather than assumed
 *   spec.ts          what the server may send, as data, for the lint and for V1
 *
 * The values a gesture writes live in the motion block's value bus (src/sdui/motion/values.ts), because
 * `motion.drive` is the only thing that reads them while a finger is down.
 */
import React from "react";
import type { ViewStyle } from "react-native";
import { GestureView, usesGesture, compiledGestures, type GestureHost } from "./GestureView";
import { GESTURE_SPEC } from "./spec";
import type { BlockRegistry } from "../blockRegistry";

export {
  GestureView, usesGesture, compiledGestures, springValueTo, liveGestureCount, resetGestureCount,
  type GestureHost,
} from "./GestureView";
export { gestureLib, gesturesAvailable, type GestureLib } from "./lib";
export { GESTURE_SPEC, type GestureSpec } from "./spec";
export * from "./gestureCore";

/**
 * Put a node's gestures around what it drew. Returns the child untouched when the node asks for none, so a
 * screen without gestures pays nothing for this block being present.
 */
export function wrapGesture(node: unknown, child: React.ReactNode, host?: GestureHost, style?: ViewStyle | null): React.ReactNode {
  const raw = (node as { gestures?: unknown } | null)?.gestures;
  if (!Array.isArray(raw) || raw.length === 0) return child;
  if (compiledGestures(raw).list.length === 0) return child;
  return React.createElement(GestureView, { gestures: raw, host, style }, child);
}

/**
 * Turn the gesture block on. Called by V1, once, only when the client declares `gesture`.
 *
 * The registry is the committed one (src/sdui/blockRegistry.ts), as registerPaint, registerLocal and
 * registerDevice use it. The wrapping half is `usesGesture` and `wrapGesture`, which V1 imports from here.
 */
export function registerGesture(registry: BlockRegistry): void {
  registry.addBlock("gesture", GESTURE_SPEC);
}
