/**
 * THE LIMITS ON SERVER DATA (pure SPEC 5.1), in one table.
 *
 * The device enforces these; the server lints the same numbers out of the generated copy of this kernel, so there is
 * one set of numbers and not two that drift. Every number is a starting value, meant to be tuned from measurements:
 * change it here and both sides move together on the next generate.
 *
 * Nothing in this file knows about React, the store or the network. It is a table and three small helpers.
 */

/** Every limit, by the name the rest of the kernel asks for. Frozen: a screen must never be able to raise one. */
export const LIMITS = Object.freeze({
  /** A whole screen, as it arrives. */
  screenBytes: 512 * 1024,
  /** Nodes after templates are expanded. */
  nodes: 2500,
  /** How deep a tree may nest. */
  depth: 48,
  /**
   * Steps one expansion may take. A `Use` and a `Slot` draw nothing, so they cost no node — which means a screen
   * could fan out through them for ever while `nodes` stays at 0. This counts every step instead, so the work is
   * bounded even when the drawing is not.
   */
  expandSteps: 10000,
  /** One string prop, and the longest text an expression may build. */
  stringBytes: 8 * 1024,

  /** One expression's source text. */
  exprChars: 400,
  /** Compiled operations in one expression (counted while compiling, so running it is bounded). */
  exprOps: 256,
  /** Expressions in one screen. */
  exprPerScreen: 600,
  /** Operations across every expression run for one change of the store. */
  opsPerChange: 20000,
  /** Holes in one `$t` text. Derived from exprOps: each hole costs at least one op. */
  textHoles: 64,

  /** Template definitions in one screen. */
  defs: 32,
  /** How deep `Use` may nest. */
  defsDepth: 6,
  /** Nodes in one list-item template, after expansion. */
  defsNodes: 200,

  /** Rules on one screen (its own and its nodes'). */
  rules: 32,
  /** Timers (`every`, `after`) on one screen. */
  timers: 4,
  /** The shortest `every`, and the shortest while the node is visible and the app is in front. */
  everyMs: 1000,
  everyVisibleMs: 250,
  /**
   * The longest a timer may wait: a day. `setTimeout` on Node and on Chromium takes a 32-bit delay, and a longer
   * one fires AT ONCE, which turns a far-off `after` into a wake-tick-wake spin. A screen that wants tomorrow asks
   * the server again.
   */
  timerMaxMs: 24 * 60 * 60 * 1000,
  /** How often any rule may fire. */
  firesPerSecond: 10,
  /** How deep one action may chain into another. */
  actionDepth: 16,

  /** One page of a list, and how many rows are held at once. */
  pageItems: 100,
  listItems: 2000,

  /** Live gestures on one screen. */
  gestures: 12,
  /** Animated nodes at once, keys in one animated value, and shared moves running together. */
  motionNodes: 64,
  keyframes: 64,
  sharedMoves: 2,

  /** Images: https only, and these sizes. */
  imagePx: 4096,
  imageBytes: 8 * 1024 * 1024,

  /** A state path: `a.b.c`, this many segments and characters. */
  pathSegments: 12,
  pathChars: 128,
  /** One screen's store. */
  storeBytes: 2 * 1024 * 1024,
  /** Everything kept on this phone by `local.set`. */
  localBytes: 256 * 1024,

  /** Live topics on one screen, one message, and how often merges may land. */
  topics: 4,
  topicMessageBytes: 64 * 1024,
  mergesPerSecond: 20,
});

export type LimitName = keyof typeof LIMITS;

/**
 * How many bytes a string takes as UTF-8. Limits are in bytes, because that is what a payload costs; `s.length`
 * would let an emoji-heavy string through at four times the size.
 */
export function byteLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i += 1; continue; }
      n += 3;
    } else n += 3;
  }
  return n;
}

/** True when a string is inside the per-prop limit. */
export function stringFits(s: string): boolean {
  return byteLen(s) <= LIMITS.stringBytes;
}

/** The shortest `every` a rule may ask for, given where it sits. */
export function everyFloorMs(whileVisible: boolean, foreground: boolean): number {
  return whileVisible && foreground ? LIMITS.everyVisibleMs : LIMITS.everyMs;
}
