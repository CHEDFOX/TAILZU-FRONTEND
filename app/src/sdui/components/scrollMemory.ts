/**
 * WHERE A PAGE WAS LEFT, SO COMING BACK LANDS THERE.
 *
 * The shell draws ONE screen: the top of the stack (SduiApp, keyed by `shownKey`). Opening a bot does not cover Home,
 * it replaces it, so coming back is a fresh mount and every ref inside it starts again — which is why a page you had
 * scrolled half-way down opened at the top. The scroll offset is the one piece of that state worth keeping, so it is
 * kept HERE, outside the tree, under the same identity the shell keys the screen by (`screenId:{params}`).
 *
 * In memory only, and deliberately: it is where you were a moment ago, not a preference. A restart starts at the top,
 * which is right. Bounded, so a long session that opens hundreds of screens cannot grow it without end — the oldest
 * go first, and the worst a forgotten one costs is the top of a page.
 */

/** Plenty for any session's worth of back-and-forth; past it the oldest are dropped. */
const MAX = 60;

const left = new Map<string, number>();

/** Remember where this screen is, under the shell's own key for it. */
export function keepScrolled(key: string | undefined, y: number): void {
  if (!key) return;
  // Re-insert so the most recently seen screens are the last to be dropped.
  if (left.has(key)) left.delete(key);
  left.set(key, y > 0 ? y : 0);
  while (left.size > MAX) {
    const oldest = left.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    left.delete(oldest);
  }
}

/** Where this screen was left, or 0 for one never seen (which is the top, as it should be). */
export function scrolledTo(key: string | undefined): number {
  return (key && left.get(key)) || 0;
}

/** Tests, and a sign-out: nothing here should outlive the person. */
export function forgetScrolled(): void {
  left.clear();
}
