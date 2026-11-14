/**
 * WHAT THE SERVER MAY SEND IN `gestures`, as data (pure SPEC 2.5, block B5).
 *
 * One exported object, so there is exactly one description of this block: the server's lint (S1,
 * `tulmi/src/experience/sdui2/lint.ts`), the renderer (V1), and anyone reading. The numbers are
 * gestureCore.ts's own, imported rather than written again, so the description cannot drift from what the
 * phone enforces. gestureCore.compileGestures is the validator, and it runs on the device.
 */
import { GESTURE_DEFAULTS, GESTURE_KINDS, GESTURE_LIMITS } from "./gestureCore";

export const GESTURE_SPEC = Object.freeze({
  /** The handshake name (kernel/blocks.ts). A screen that uses `gestures` must say it needs this block. */
  block: "gesture",

  /** Where it goes: one optional `gestures` list on any node. */
  prop: "gestures",

  kinds: GESTURE_KINDS,

  /** Every field a gesture may carry. Anything else is ignored. */
  fields: Object.freeze({
    kind: "one of `kinds`",
    id: "this gesture's own name, so another can ask to run after it",
    into: "where its values go, under `ui.` — a plain name of at most 12 parts",
    claim: "exclusive (the default) | simultaneous | after:<id>",
    axis: "x | y | both — drag, pan and swipe",
    min: "a drag's run starts here",
    max: "and ends here",
    snap: "points a drag settles onto, nearest wins (its own speed carries it first)",
    rubber: "true, or a number of points: how far past the run it may be pulled",
    springK: "the spring it settles with: stiffness,",
    springDamp: "and damping ratio (1 is exactly critical)",
    projectMs: "how far its own speed carries it when the finger lifts",
    taps: "1 to 3 (doubleTap is 2)",
    window: "the window a second tap has to land in",
    hold: "how long a long press is held",
    slop: "how far a finger may wander and still be a tap or a hold",
    distance: "a swipe: how far,",
    velocity: "or how fast — either is enough",
    minScale: "a pinch's run,",
    maxScale: "both ends",
    do: "an action, every kind",
    commitIf: "a condition, asked after the end values are in the store",
    onCommit: "an action, when it is true",
    onCancel: "an action, or { kind: \"spring\", to } to put the value back",
    onLeft: "a swipe's four,",
    onRight: "one per direction;",
    onUp: "the one that happened runs,",
    onDown: "and then `do`",
  }),

  /**
   * THE TWO KINDS OF `ui.*` VALUE, which is the whole design (SPEC 2.5):
   *   while a finger moves, `ui.<into>.x | y | scale | progress` live only on the UI thread, and only
   *   `motion.drive` reads them;
   *   when it lifts, those four are written to the store, once. In expressions, in `commitIf` and in rules,
   *   `ui.*` always means that value at the end.
   */
  values: Object.freeze(["x", "y", "scale", "progress"] as const),

  /** The defaults, each a knob the server can retune for everyone (`gesture.*`). */
  defaults: GESTURE_DEFAULTS,

  /** SPEC 5.1's numbers, as the device enforces them. */
  limits: Object.freeze({
    perScreen: GESTURE_LIMITS.perScreen,
    perNode: GESTURE_LIMITS.perNode,
    snapPoints: GESTURE_LIMITS.snaps,
    intoSegments: GESTURE_LIMITS.pathSegments,
    intoChars: GESTURE_LIMITS.pathChars,
    storeWrittenOn: "end only",
  }),

  /**
   * Scroll offset is an input like any other: `Screen` and `Scroll` take `scrollInto: "scrollY"`, and a motion
   * then drives off `ui.scrollY`.
   */
  scrollInto: "a name under `ui.` for a Screen's or a Scroll's own offset",

  /** Safe mode drops every gesture (safety.ts gesturesOn), and so does a binary with no gesture-handler. */
  off: "the node draws, and takes no finger",
} as const);

export type GestureSpec = typeof GESTURE_SPEC;
