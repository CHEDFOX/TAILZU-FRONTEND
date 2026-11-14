/**
 * WHAT THE SERVER MAY SEND IN `motion`, as data (pure SPEC 2.5, block B4).
 *
 * One exported object, so there is exactly one description of this block and three readers of it: the server's
 * lint (S1, `tulmi/src/experience/sdui2/lint.ts`), the renderer (V1), and whoever is reading this file to find
 * out what a node can do. The numbers are motionCore.ts's own, imported rather than written again, so the
 * description can never drift from what the phone actually enforces.
 *
 * It is a description, not a validator: motionCore.compileMotion is the validator, and it runs on the device.
 */
import { MAX_SPRINGS, MOTION_KEYS, MOTION_LIMITS } from "./motionCore";

export const MOTION_SPEC = Object.freeze({
  /** The handshake name (kernel/blocks.ts). A screen that uses `motion` must say it needs this block. */
  block: "motion",

  /** Where it goes: one optional `motion` object on any node. */
  prop: "motion",

  /** The style keys motion may move, and nothing else. An unknown key is ignored, never an error. */
  keys: MOTION_KEYS,

  /**
   * A value is one of these three, which is the animation spec's format-2 value model, unchanged:
   *   number                              hold this value
   *   { k: [[t, v], [t, v, ease]], loop } keyframes over a clock, in seconds (in `drive`, in the input's units)
   *   { spring: to, k, damp, from }       a damped spring, mass 1, damping = 2 * damp * sqrt(k)
   */
  value: Object.freeze({
    eases: Object.freeze(["lin", "in", "out", "inout", "step"] as const),
    cubicEase: "[x1, y1, x2, y2]",
    springDefaults: Object.freeze({ k: 160, damp: 0.8 }),
  }),

  /** The sections of a `motion` object. */
  sections: Object.freeze({
    /** Played once when the node arrives. Keyframes or springs. */
    enter: "map of style key to value",
    /** Played once as the node leaves. Keyframes only: a spring has no end to leave on, and is refused. */
    exit: "map of style key to keyframes",
    /** Played round and round. `loop: true` on a value wraps its clock. */
    loop: "map of style key to value",
    /**
     * ONE input, mapped piecewise. `by` names a scroll offset (`ui.scrollY`, from a Screen or Scroll with
     * `scrollInto`), a gesture's own value (`ui.<into>.x | y | scale | progress`), or a state path
     * (`state.progress`, which the renderer mirrors onto the UI thread). One input and no expressions,
     * deliberately: that is what keeps it on the UI thread (SPEC 2.5).
     */
    drive: "map of style key to { by, k: [[input, value]] }",
    /** The node settles into its new box through a spring: `true`, `{ k, damp }`, or `{ spring: false, ms }`. */
    layout: "true | { k, damp } | { spring: false, ms }",
    /** A shared-element id. The move is drawn as a JS overlay; `<SharedOverlay/>` must be mounted. */
    shared: "string",
  }),

  /** SPEC 5.1's numbers, as the device enforces them. */
  limits: Object.freeze({
    keyframesPerValue: MOTION_LIMITS.keyframes,
    animatedNodes: MOTION_LIMITS.nodes,
    sharedMovesAtOnce: MOTION_LIMITS.sharedMoves,
    keysPerNode: MOTION_LIMITS.tracks,
    springsPerNode: MAX_SPRINGS,
    seconds: MOTION_LIMITS.seconds,
  }),

  /**
   * What Reduce Motion, `sdui.motion: "reduced"` and safe mode do (motionCore.forMode). The server does not
   * need to send a second, quieter screen: the device folds it.
   */
  reduced: Object.freeze({
    enter: "a cross-fade",
    exit: "a cross-fade",
    loop: "stopped at its first key",
    layout: "lands at once",
    shared: "no flight; the arriving node cross-fades in",
    drive: "kept — it follows the person's own finger or scroll, it is not the app moving by itself",
  }),

  /** `sdui.motion: "off"`, and safe mode: nothing moves, every key rests, the node is simply there. */
  off: "nothing moves",
} as const);

export type MotionSpec = typeof MOTION_SPEC;
