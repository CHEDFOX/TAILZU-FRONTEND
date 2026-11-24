/**
 * How a navigate changes the stack — pure, so it is tested (navStack.test.ts) and imports nothing.
 *
 * A push used to append, always. That made Back a replay of every tap rather than a way up:
 *
 *   - A screen's own way out that NAVIGATES rather than going back (the language pages' "Stop for now" and their
 *     back chevron are `open(lingo)`, the meeting's "All meetings" is `open(notes)`) put a second copy of a screen
 *     that was already underneath on top, so Back walked down through the practice screen to the copy below it.
 *   - A double tap on a row pushed the same screen twice, and Back showed it again.
 *   - A `replace: true` onto the screen right under the top (planSend's "plan" after a send) left two of it.
 *
 * So a navigate to a screen ALREADY ON THE STACK — same id, same params — goes back to it instead of stacking
 * another; anything else is pushed or swapped exactly as before. The entry put there is always the new one (a new
 * object), so the screen is fetched again just as a push would have, and its `present` is the one asked for now.
 */

/** The part of a stack entry this cares about. */
export interface StackEntry { screenId: string; params?: Record<string, unknown> }

/** Key order and an empty `{}` do not make two entries different. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** One string per screen + params: two entries with the same key are the same place. */
export function entryKey(e: StackEntry): string {
  const p = e.params && Object.keys(e.params).some((k) => e.params![k] !== undefined) ? stable(e.params) : "";
  return `${e.screenId}${p ? `::${p}` : ""}`;
}

/** The topmost index in `stack[0..end)` that is the same place as `item`, or -1. */
function lastIndexOf<T extends StackEntry>(stack: readonly T[], item: StackEntry, end = stack.length): number {
  const k = entryKey(item);
  for (let i = Math.min(end, stack.length) - 1; i >= 0; i--) if (entryKey(stack[i]) === k) return i;
  return -1;
}

/** A push: back down to the same screen when it is already on the stack, on top otherwise. */
export function pushEntry<T extends StackEntry>(stack: readonly T[], item: T): T[] {
  const i = lastIndexOf(stack, item);
  return i >= 0 ? [...stack.slice(0, i), item] : [...stack, item];
}

/** A replace: the top swapped, and back down to the same screen when it is already under the top. */
export function replaceEntry<T extends StackEntry>(stack: readonly T[], item: T): T[] {
  if (!stack.length) return [item];
  const i = lastIndexOf(stack, item, stack.length - 1);
  return i >= 0 ? [...stack.slice(0, i), item] : [...stack.slice(0, -1), item];
}

/**
 * The tab a navigate is really a tab switch to: a tab root reached by `navigate` instead of `switchTab` (a tab
 * root takes no params). Pushed, it sat on top of the other tab's screens with the wrong tab lit, and Back walked
 * through all of them.
 */
export function tabForEntry(
  tabs: ReadonlyArray<{ id: string; screenId: string }> | undefined,
  item: StackEntry,
): string | null {
  if (!tabs?.length || entryKey(item) !== item.screenId) return null;
  return tabs.find((t) => t.screenId === item.screenId)?.id ?? null;
}
