/**
 * SCROLL OFFSET AS A VALUE (pure SPEC 2.5: "scroll offset is an input like any other").
 *
 * A `Screen` or a `Scroll` with `scrollInto: "scrollY"` publishes how far it is scrolled under that name, and
 * a motion then drives off `ui.scrollY`:
 *
 *   { "type": "Screen", "props": { "scrollInto": "scrollY" }, … }
 *   { "type": "Stack", "motion": { "drive": { "translateY": { "by": "ui.scrollY", "k": [[0, 0], [120, -40]] } } } }
 *
 * This is the only thing src/sdui/components/Screen.tsx and Scroll.tsx had to learn, and it is deliberately
 * two lines each: the name is read here, the number is written here, and neither file has to know what a
 * shared value is.
 *
 * HOW FAST IT IS. The offset is taken from the scroll view's own onScroll, which is the JS thread at the
 * throttle those files already set (16 ms on a Screen). That is one frame behind a true UI-thread handler.
 * Making it exact means turning the Screen's ScrollView into an Animated.ScrollView with
 * useAnimatedScrollHandler, which is PLAYER-CORE's to decide when V3 gives the Screen its List hand-off; the
 * value's name and meaning do not change when it does.
 */
import { useEffect } from "react";
import { holdValue, releaseValue, resetValue, valueFor } from "./values";

/** The name this node asked for, or "". One place the prop is read, so Screen and Scroll cannot disagree. */
export function scrollIntoName(props: Record<string, unknown> | null | undefined): string {
  const v = props?.scrollInto;
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : "";
}

/**
 * The name this scroller publishes under, held for as long as it is mounted and put back to 0 when it mounts.
 *
 * Both halves matter. Holding keeps the name out of the value bus's sweep while something is writing it, and
 * resetting is why the second visit to a screen opens at the top: the number is a module-level value, so
 * without this a parallax header would come back already scrolled away.
 */
export function useScrollInto(props: Record<string, unknown> | null | undefined): string {
  const into = scrollIntoName(props);
  useEffect(() => {
    if (!into) return undefined;
    holdValue(into);
    resetValue(into, 0);
    return () => releaseValue(into);
  }, [into]);
  return into;
}

/** Say how far it is scrolled. Nothing happens when nobody asked for a name, or when the bus is full. */
export function publishScroll(name: string, offset: number): void {
  if (!name || !Number.isFinite(offset)) return;
  const sv = valueFor(name);
  if (sv) sv.value = offset;
}
