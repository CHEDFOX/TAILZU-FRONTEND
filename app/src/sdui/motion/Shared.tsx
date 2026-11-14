/**
 * THE SHARED-ELEMENT MOVE, drawn as a JS overlay (pure SPEC 2.5). The arithmetic is sharedCore.ts.
 *
 * Reanimated's own shared transitions are compiled out of this binary — ENABLE_SHARED_ELEMENT_TRANSITIONS is
 * false in staticFlags.json and baked into the native code, and turning it on would recompile a linked native
 * package, which needs a new runtime (SPEC 4.1). There is no react-native-screens either. So:
 *
 *   1. a node with `motion.shared: "<id>"` keeps its own box measured while it is on screen;
 *   2. when it goes away it leaves that box, and a copy of itself, in the book (sharedCore.SharedBook);
 *   3. a node with the same id that arrives within the window claims it, hides itself for the flight, and asks
 *      the overlay to fly the copy from the old box to the new one;
 *   4. the overlay takes the copy off again when it lands, and the arriving node fades in under it.
 *
 * THE OVERLAY MUST BE MOUNTED for any of this to happen. `<SharedOverlay/>` goes once, high in the tree, above
 * both screens. Without it, `shared` quietly does nothing: a node still appears, in its place, with no flight.
 * That is the degrade rule, and it is also what Reduce Motion and `sdui.motion` ask for.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, withSpring, Easing } from "react-native-reanimated";
import {
  flightOf, okBox, SharedBook, SHARED_DAMP, SHARED_K, SHARED_MS, SHARED_WINDOW_MS, worthFlying, type Box, type Flight,
} from "./sharedCore";
import { springDamping, MOTION_LIMITS } from "./motionCore";
import { onPage } from "../components/pageBus";
import { num } from "../knobs";

/** The copy that flies is the node's own children, drawn again on the overlay. */
type Copy = React.ReactNode;

const book = new SharedBook<Copy>(MOTION_LIMITS.sharedMoves, SHARED_WINDOW_MS);

/**
 * ONE RESERVATION, GIVEN BACK ONCE.
 *
 * A claim takes a place in the air. Exactly one thing then has to give it back, and several of them can
 * happen — the flight lands on the clock, the overlay unmounts under it, the arriving node goes away before
 * the flight ever started — so the giving back is a closure that only works the first time. Without this the
 * count creeps up, and after a burst or two `shared` stops working for the rest of the launch.
 */
function reservation(): () => void {
  let spent = false;
  return () => { if (spent) return; spent = true; book.landed(); };
}

interface InFlight { key: number; flight: Flight; copy: Copy; release: () => void }

/** A listener answers whether it took the flight: one that is already full has not, and must not be counted. */
type Listener = (f: InFlight) => boolean;
const listeners = new Set<Listener>();
let nextKey = 1;

/** Start a flight, if an overlay is listening and the two boxes are far enough apart to be worth one. */
function fly(from: Box, to: Box, copy: Copy, release: () => void): boolean {
  if (listeners.size === 0) return false;
  if (!okBox(from) || !okBox(to) || !worthFlying(from, to)) return false;
  const f: InFlight = { key: nextKey++, flight: flightOf(from, to), copy, release };
  let took = false;
  listeners.forEach((l) => {
    try { if (l(f)) took = true; } catch { /* an overlay's fault is its own */ }
  });
  return took;
}

/** Forget every pending box and flight: a sign-out, safe mode, a test. */
export function clearShared(): void {
  book.clear();
}

// ===================================================================== the node half

/**
 * A node with `motion.shared`. It measures itself, leaves its box behind when it goes, and claims the box of
 * the one that left when it arrives.
 *
 * `enabled` is false under Reduce Motion, the `sdui.motion` switch and safe mode (forMode() drops `shared`),
 * and then this is an ordinary box that happens to be measured.
 */
export function SharedNode({
  id, enabled, children, style,
}: {
  id: string;
  enabled: boolean;
  children?: React.ReactNode;
  style?: object | null;
}): React.ReactElement {
  const ref = useRef<View>(null);
  const box = useRef<Box | null>(null);
  const kids = useRef<React.ReactNode>(children);
  kids.current = children;
  // While the copy is in the air, the arriving node is not drawn: two of the same thing on screen at once is
  // the one way a shared move reads as a bug rather than a move.
  const hide = useSharedValue(0);

  const measure = useCallback((_e?: LayoutChangeEvent) => {
    ref.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) box.current = { x, y, w, h };
    });
  }, []);

  useEffect(() => {
    if (!id || !enabled) return undefined;
    // On arrival: is there a box the node that just left put down? Claiming reserves the place in the air.
    const now = Date.now();
    book.sweep(now);
    const claimed = book.claim(id, now);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let release: (() => void) | null = null;
    // Did something else take on giving the reservation back — a flyer in the air — and has this node gone?
    let handed = false;
    let gone = false;
    if (claimed) {
      release = reservation();
      const give = release;
      hide.value = 1;
      // The arriving node has to be laid out before it can be measured, so the claim waits one frame.
      timer = setTimeout(() => {
        ref.current?.measureInWindow((x, y, w, h) => {
          if (gone) return; // this node left while it was being measured; the cleanup has already given back
          const to = { x, y, w, h };
          // The flyer gives the reservation back when it lands or is taken off; here it is given back only
          // when nothing ever took the flight.
          const started = okBox(to) && fly(claimed.box, to, claimed.copy, give);
          if (!started) { give(); hide.value = 0; }
          else {
            handed = true;
            hide.value = withTiming(0, { duration: num("motion.sharedMs", SHARED_MS), easing: Easing.out(Easing.quad) });
          }
        });
      }, 0);
    }
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
      // A claim this node never managed to fly — it went away in the frame it was waiting to be measured in —
      // still holds a place. A flight already in the air keeps its own, and gives it back when it lands.
      if (release && !handed) release();
      // On the way out: leave the box and a copy for whoever arrives next.
      book.note(id, box.current, kids.current, Date.now());
    };
  }, [id, enabled, hide]);

  /**
   * A FEED SCROLLS, AND onLayout DOES NOT FIRE. The box is where the node was when it was laid out, and the
   * card that was tapped is usually one the person scrolled to, so the flight would start from where the card
   * first stood — often off screen. The page's own scroll says when to look again, at most once a frame.
   */
  useEffect(() => {
    if (!id || !enabled) return undefined;
    let last = 0;
    return onPage(() => {
      const t = Date.now();
      if (t - last < 16) return;
      last = t;
      measure();
    });
  }, [id, enabled, measure]);

  const fade = useAnimatedStyle(() => ({ opacity: 1 - hide.value }));

  return (
    <Animated.View ref={ref} onLayout={measure} style={[style as object, enabled ? fade : null]} collapsable={false}>
      {children}
    </Animated.View>
  );
}

// ===================================================================== the overlay half

/**
 * The layer the copies fly on. Mount it once, above both screens, and it draws nothing until something flies.
 * It never takes a touch: the screens underneath keep every finger.
 */
export function SharedOverlay(): React.ReactElement | null {
  const [live, setLive] = useState<InFlight[]>([]);
  // How many are on the layer right now, read without waiting for a render: three arrivals in one frame all
  // ask before any of them has been drawn, and the third has to be able to see that there is no room.
  const held = useRef(0);

  useEffect(() => {
    const on: Listener = (f) => {
      if (held.current >= MOTION_LIMITS.sharedMoves) return false;
      held.current += 1;
      setLive((was) => [...was, f]);
      return true;
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);

  // The flight is off the layer; its Flyer unmounts, and that is what gives the reservation back.
  const done = useCallback((key: number) => {
    setLive((was) => was.filter((f) => f.key !== key));
  }, []);

  const dropped = useCallback(() => { held.current = held.current > 0 ? held.current - 1 : 0; }, []);

  if (live.length === 0) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      {live.map((f) => <Flyer key={f.key} at={f} onDone={done} onGone={dropped} />)}
    </View>
  );
}

/** One copy in the air: drawn at the old box, springing onto the new one, then gone. */
function Flyer(
  { at, onDone, onGone }: { at: InFlight; onDone: (key: number) => void; onGone: () => void },
): React.ReactElement {
  const t = useSharedValue(0);
  const f = at.flight;
  useEffect(() => {
    const k = num("motion.sharedK", SHARED_K);
    t.value = withSpring(1, { stiffness: k, damping: springDamping(k, num("motion.sharedDamp", SHARED_DAMP)), mass: 1 });
    // The spring settles long before it is exactly 1, and a copy left on screen is worse than one taken off a
    // frame early, so the overlay drops it on the clock rather than on the spring.
    const timer = setTimeout(() => onDone(at.key), num("motion.sharedMs", SHARED_MS));
    // THE ONE PLACE A FLIGHT IS GIVEN BACK. It runs when the flight lands and when the overlay is taken away
    // mid-flight, and it only counts once, so the two cannot double up.
    return () => { clearTimeout(timer); onGone(); at.release(); };
  }, [at, onDone, onGone, t, f]);

  const style = useAnimatedStyle(() => {
    const u = t.value;
    return {
      transform: [
        { translateX: f.dx * u },
        { translateY: f.dy * u },
        { scaleX: 1 + (f.sx - 1) * u },
        { scaleY: 1 + (f.sy - 1) * u },
      ],
    };
  }, [f]);

  const place = useMemo(
    () => ({ position: "absolute" as const, left: f.x, top: f.y, width: f.w, height: f.h }),
    [f],
  );

  return <Animated.View pointerEvents="none" style={[place, style]}>{at.copy}</Animated.View>;
}
