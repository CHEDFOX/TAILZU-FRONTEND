/**
 * THE `ui.*` VALUES: numbers that live on the UI thread, by name (pure SPEC 2.5).
 *
 * A gesture following a finger and a scroll view being scrolled both make a number that changes faster than
 * React can re-render. `motion.drive` reads one of those numbers and maps it, piecewise, through keyframes:
 *
 *   gesture `into: "pill"`        writes  ui.pill.x, ui.pill.y, ui.pill.scale, ui.pill.progress
 *   Screen / Scroll `scrollInto`  writes  ui.scrollY  (and ui.scrollX on a sideways one)
 *   motion `drive: { translateY: { by: "ui.scrollY", k: … } }`  reads it
 *
 * This is the one place those numbers live, so the writer and the reader never have to know about each other
 * or mount in a particular order: whoever asks first makes the value at 0, and whoever writes it writes it.
 *
 * Nothing here ever crosses to JavaScript by itself. A gesture writes its end value to the store once, when the
 * finger lifts (GestureView.tsx), and that is the only `ui.*` an expression or a rule ever sees (SPEC 2.5).
 *
 * The book-keeping — the names, the cap and who is still holding what — is valuesCore.ts, which is pure and
 * tested in Node. This file is only what it takes to make a Reanimated value and set one.
 */
import { makeMutable, type SharedValue } from "react-native-reanimated";
import { bareName as bare, ValueBus } from "./valuesCore";

/**
 * How many names may exist at once. A screen has a handful; the cap is here so a server that invents a name per
 * row of a long list cannot quietly fill memory with shared values nobody reads.
 */
export const MAX_VALUES = 64;

const bus = new ValueBus<SharedValue<number>>(MAX_VALUES, () => makeMutable(0));

export { bareName } from "./valuesCore";

/**
 * The value under this name, made at 0 if nobody has made it yet.
 *
 * Made on demand on purpose: a node whose motion is driven by a scroll offset can mount before the Screen that
 * publishes that offset, and the other way round. Both get the same handle, and the one that writes it wins.
 * Null only when the cap has been reached, which the caller must survive (the motion simply does not drive).
 */
export function valueFor(name: string): SharedValue<number> | null {
  return bus.get(name);
}

/**
 * The same value, and a promise to let go of it: the view that owns this name — the gesture that writes it, the
 * Screen that publishes its offset, the motion that drives off it — holds it while it is mounted.
 */
export function holdValue(name: string): SharedValue<number> | null {
  return bus.hold(name);
}

/** Let go of one hold. The name goes when the last view that kept it has gone. */
export function releaseValue(name: string): void {
  bus.release(name);
}

/**
 * Put a name back where a fresh mount should find it.
 *
 * A value is a module-level number, so without this the second visit to a screen opens with the first visit's
 * ending: a slide-to-confirm already slid, a parallax header already scrolled. The mounting view says what rest
 * means for it (a drag's `min`, a scale's 1, a scroll's 0).
 */
export function resetValue(name: string, to: number): void {
  const sv = bus.get(name);
  if (sv && Number.isFinite(to)) sv.value = to;
}

/** The value under this name, or null — without making one. For a reader that must not create names. */
export function peekValue(name: string): SharedValue<number> | null {
  return bus.peek(name);
}

/** What a name reads right now, on the JS thread. 0 when there is no such name. */
export function readValue(name: string): number {
  const sv = bus.peek(name);
  return sv ? sv.value : 0;
}

/** How many names exist. For the handshake, and for the tests. */
export function valueCount(): number {
  return bus.size;
}

/** How many views are holding this name. For the tests. */
export function holdsOf(name: string): number {
  return bus.holds(bare(name));
}

/**
 * Forget every name. Leaving a screen does NOT do this — a name may outlive one screen on purpose (the shell's
 * own scroll) — but signing out, safe mode and the tests do.
 */
export function clearValues(): void {
  bus.clear();
}
