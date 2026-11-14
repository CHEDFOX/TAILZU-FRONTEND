/**
 * MOTION ON ANY NODE, drawn (pure SPEC 2.5, block B4). The value model and every decision that is arithmetic
 * are in motionCore.ts; this file is the Reanimated wiring and nothing else.
 *
 *   enter   one clock per node, in seconds, read by an animated style. The first frame is already the first
 *           key, so nothing flashes at its end state before the entrance starts.
 *   loop    a second clock, repeating.
 *   drive   the `ui.*` values (values.ts), read on the UI thread. A scroll or a finger never waits on a render.
 *   exit    Reanimated's own `exiting`, built as a sequence of timings — one per segment of the keyframes, with
 *           that segment's ease — because a node being removed is gone before any clock of ours could run.
 *   layout  Reanimated's LinearTransition, with the spring written as stiffness and damping, which is the same
 *           spring botTiles/scene.ts plays (motionCore.springDamping).
 *   shared  Shared.tsx. Reanimated's own shared transitions are compiled out of this binary (sharedCore.ts).
 *
 * Reduce Motion, the `sdui.motion` switch and safe mode all arrive as one answer (motionMode() in safety.ts,
 * useReducedMotion() for the phone's own setting) and are folded into the compiled motion by forMode(), so this
 * file never asks twice and never has two ideas of what "reduced" means.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation, Easing, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat,
  withSequence, withSpring, withTiming, type EasingFunction, type SharedValue,
} from "react-native-reanimated";
import {
  compileMotion, foldSection, foldSprings, forMode, keysUsed, LiveCount, MAX_SPRINGS, MOTION_LIMITS, multiplies,
  resetValues, restValues, sampleKeys, springDamping, usesKey, E_CUBIC, E_IN, E_INOUT, E_OUT, E_STEP, KSTRIDE,
  K_OPACITY, K_ROT, K_SCALE, K_SKX, K_SKY, K_SX, K_SY, K_TX, K_TY, NO_MOTION,
  type Compiled, type MotionMode, type Track,
} from "./motionCore";
import { holdValue, releaseValue, valueFor } from "./values";
import { motionMode } from "../safety";

/**
 * WHAT THE RENDERER HANDS THIS BLOCK (the seam: V1 owns the renderer, this folder owns the motion).
 *
 * Both members are optional, so a MotionView works with no host at all — which is how the tests and the
 * one-off callers use it.
 */
export interface MotionHost {
  /**
   * A UI-thread value by name, for `drive`. Asked FIRST, so a host can answer with anything it keeps on the
   * UI thread — in particular a state path (`drive.by: "state.progress"`), which only V1 can mirror because
   * only V1 owns the store. A name it does not know, and every `ui.*` name, falls through to the value bus
   * (values.ts), where gestures and scrolls write.
   */
  value?(name: string): SharedValue<number> | null;
  /** Anything in the node's motion that could not be read, for the handshake's `sdui.bad`. */
  bad?(notes: readonly string[], node?: unknown): void;
}

/** At most this many springs in one node's motion. Compiling hands out the slots (motionCore.MAX_SPRINGS). */
export { MAX_SPRINGS } from "./motionCore";

/**
 * HOW MANY ANIMATED NODES ARE ALIVE, against SPEC 5.1's 64. One count for the launch, because the limit is
 * about what the UI thread is being asked to do, and the UI thread has one of those whatever screen is on show.
 *
 * Past the cap a node draws, in its place, without an animated style: a screen that asks for too much motion
 * loses the motion, never the screen.
 */
const liveNodes = new LiveCount(MOTION_LIMITS.nodes);

/** How many animated nodes are alive. For the handshake and for the tests. */
export function liveMotionNodes(): number { return liveNodes.live; }

/** Forget the count: a sign-out, safe mode, a test. */
export function resetMotionCount(): void { liveNodes.reset(); }

// ===================================================================== compiling, once per screen

/**
 * A screen's JSON is parsed once, so a node's `motion` object keeps its identity across every re-render. That
 * makes it the key: compile once, and never again while the screen is on show.
 */
const compiled = new WeakMap<object, Compiled>();
const byMode = new WeakMap<Compiled, Partial<Record<MotionMode, Compiled>>>();

export function compiledFor(raw: unknown): Compiled {
  if (!raw || typeof raw !== "object") return NO_MOTION;
  const had = compiled.get(raw as object);
  if (had) return had;
  const c = compileMotion(raw);
  compiled.set(raw as object, c);
  return c;
}

export function forModeCached(c: Compiled, mode: MotionMode): Compiled {
  if (mode === "on") return c;
  let row = byMode.get(c);
  if (!row) { row = {}; byMode.set(c, row); }
  const had = row[mode];
  if (had) return had;
  const made = forMode(c, mode);
  row[mode] = made;
  return made;
}

/** How much motion this launch may play: the switch and safe mode (safety.ts), then the phone's own setting. */
export function useMotionMode(): MotionMode {
  const reduce = useReducedMotion();
  const mode = motionMode();
  if (mode === "off") return "off";
  if (mode === "reduced" || reduce) return "reduced";
  return "on";
}

// ===================================================================== eases, for the exit sequence

/**
 * The exit runs as Reanimated animations rather than off a clock of ours, so each segment's ease has to be one
 * of Reanimated's easing functions. Made on the JS thread, once, and handed to the worklet as data.
 */
function easingOf(flat: readonly number[], at: number): EasingFunction {
  const kind = flat[at + 2];
  if (kind === E_IN) return Easing.in(Easing.quad);
  if (kind === E_OUT) return Easing.out(Easing.quad);
  if (kind === E_INOUT) return smoothEase;
  if (kind === E_STEP) return stepEase;
  if (kind === E_CUBIC) return Easing.bezier(flat[at + 3], flat[at + 4], flat[at + 5], flat[at + 6]).factory();
  return Easing.linear;
}

/** A step ease: it holds its old value and jumps at the end of the segment. Reanimated has no name for it. */
function stepEase(t: number): number {
  "worklet";
  return t >= 1 ? 1 : 0;
}

/**
 * `inout`, the smoothstep motionCore.easeAt and botTiles/scene.ts both play. Reanimated's own
 * `Easing.inOut(Easing.quad)` is a different curve (piecewise 2t², 1-2(1-t)²; at a quarter of the way it is
 * 0.125 against this 0.156), and an exit is meant to be the same keyframes the entrance was, read backwards.
 */
function smoothEase(t: number): number {
  "worklet";
  return t * t * (3 - 2 * t);
}

interface Seg { to: number; ms: number; easing: EasingFunction }

/** One exit track as a first value and a run of segments: exactly its keyframes, nothing lost. */
function segmentsOf(t: Track): { from: number; segs: Seg[] } {
  if (t.n <= 0) return { from: 0, segs: [] };
  const from = t.flat[1];
  const segs: Seg[] = [];
  for (let i = 1; i < t.n; i++) {
    const at = i * KSTRIDE;
    const ms = Math.max(0, Math.round((t.flat[at] - t.flat[(i - 1) * KSTRIDE]) * 1000));
    segs.push({ to: t.flat[at + 1], ms, easing: easingOf(t.flat, at) });
  }
  return { from, segs };
}

// ===================================================================== the view

export interface MotionViewProps {
  /** The node's `motion`, as the server sent it. Compiled here, once. */
  motion: unknown;
  host?: MotionHost;
  style?: ViewStyle | ViewStyle[] | null;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  children?: React.ReactNode;
}

/**
 * One animated box around whatever the node draws.
 *
 * A node with nothing to animate gets its children back untouched, with no view and no hook work, so putting
 * this in the renderer's path costs a screen without motion nothing at all.
 */
export function MotionView({ motion, host, style, pointerEvents, children }: MotionViewProps): React.ReactElement {
  const mode = useMotionMode();
  const raw = compiledFor(motion);
  const c = forModeCached(raw, mode);

  // The host is V1's, and V1 may well build it inline on every render. Kept in a ref so that nothing below
  // depends on its identity: a host that is a new object each time would otherwise re-register the animated
  // style's mapper on every store change.
  const hostRef = useRef(host);
  hostRef.current = host;

  // Compile complaints go home once, not on every render.
  const told = useRef(false);
  useEffect(() => {
    if (told.current || !raw.bad.length || !hostRef.current?.bad) return;
    told.current = true;
    hostRef.current.bad(raw.bad, motion);
  }, [raw, motion]);

  // SPEC 5.1: at most 64 animated nodes live. Taken on mount rather than during render, so a render React
  // throws away cannot leak a place in the count. The first frame of a node past the cap is animated and the
  // next is not, which is one frame of motion nobody will see rather than a node that does not draw.
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    const got = liveNodes.take(1);
    if (!got) {
      setCapped(true);
      hostRef.current?.bad?.([`motion: at most ${MOTION_LIMITS.nodes} animated nodes at once`], motion);
    }
    return () => { if (got) liveNodes.give(1); };
  }, [motion]);

  // The two clocks, in seconds, and a fixed row of spring values. Fixed because hooks cannot be counted out at
  // run time; four is more springs than a node has ever wanted, and the fifth is simply not played.
  const clock = useSharedValue(0);
  const loopClock = useSharedValue(0);
  const s0 = useSharedValue(0), s1 = useSharedValue(0), s2 = useSharedValue(0), s3 = useSharedValue(0);
  const springs = useMemo(() => [s0, s1, s2, s3], [s0, s1, s2, s3]);

  // A spring must stand at its start on the very first frame: setting it from an effect would show one frame at
  // zero, which on opacity or scale is a flash of nothing. So it is placed during the first render.
  const placed = useRef<Compiled | null>(null);
  if (placed.current !== c) {
    placed.current = c;
    for (const t of c.enter) if (t.slot >= 0 && t.slot < MAX_SPRINGS) springs[t.slot].value = t.springFrom;
    for (const t of c.loop) if (t.slot >= 0 && t.slot < MAX_SPRINGS) springs[t.slot].value = t.springFrom;
  }

  // The inputs `drive` reads, resolved once: each track with the value it follows. The host is read through
  // the ref, so a host rebuilt on every render does not rebuild this.
  const drivers = useMemo(() => {
    const h = hostRef.current;
    const out: Array<{ flat: number[]; n: number; loop: boolean; key: number; mul: boolean; sv: SharedValue<number> }> = [];
    for (const t of c.drive) {
      const sv = h?.value ? h.value(t.by) ?? valueFor(t.by) : valueFor(t.by);
      if (!sv) continue;
      out.push({ flat: t.flat, n: t.n, loop: t.loop, key: t.key, mul: multiplies(t.key), sv });
    }
    return out;
  }, [c]);

  // A name this node drives off is held while the node is on screen, so the value bus does not sweep it from
  // under a running parallax. Held after the resolve above, which is the same tick: nothing can sweep between.
  const driveNames = useMemo(() => c.drive.map((t) => t.by).filter((n) => n.length > 0), [c]);
  useEffect(() => {
    for (const n of driveNames) holdValue(n);
    return () => { for (const n of driveNames) releaseValue(n); };
  }, [driveNames]);

  // One scratch row of nine numbers and one of four, made once and overwritten every frame: a frame allocates
  // nothing but the style object Reanimated asks for.
  const scratch = useMemo(() => ({ out: restValues(), sp: [0, 0, 0, 0] }), []);
  const mask = useMemo(() => keysUsed(c), [c]);

  useEffect(() => {
    if (c.enterMs > 0) {
      clock.value = 0;
      clock.value = withTiming(c.enterMs / 1000, { duration: c.enterMs, easing: Easing.linear });
    } else {
      clock.value = 0;
    }
    return () => cancelAnimation(clock);
  }, [c, clock]);

  useEffect(() => {
    if (c.loopMs <= 0) { loopClock.value = 0; return; }
    loopClock.value = 0;
    loopClock.value = withRepeat(withTiming(c.loopMs / 1000, { duration: c.loopMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(loopClock);
  }, [c, loopClock]);

  useEffect(() => {
    const live: Array<SharedValue<number>> = [];
    for (const t of [...c.enter, ...c.loop]) {
      if (t.slot < 0 || t.slot >= MAX_SPRINGS) continue;
      const sv = springs[t.slot];
      live.push(sv);
      sv.value = withSpring(t.springTo, { stiffness: t.k, damping: springDamping(t.k, t.damp), mass: 1 });
    }
    return () => { for (const sv of live) cancelAnimation(sv); };
  }, [c, springs]);

  const enter = c.enter, loop = c.loop;
  const animated = useAnimatedStyle(() => {
    const out = scratch.out, sp = scratch.sp;
    resetValues(out);
    sp[0] = s0.value; sp[1] = s1.value; sp[2] = s2.value; sp[3] = s3.value;
    foldSection(out, enter, clock.value);
    foldSprings(out, enter, sp);
    foldSection(out, loop, loopClock.value);
    foldSprings(out, loop, sp);
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      const v = sampleKeys(d.flat, d.n, d.loop, d.sv.value);
      if (d.mul) out[d.key] *= v; else out[d.key] += v;
    }
    // The transform list has the same shape on every frame: which entries exist was decided when the motion
    // was compiled, never from this frame's numbers.
    const tf: Array<Record<string, number | string>> = [];  // one shape for the node's whole life
    if (usesKey(mask, K_TX)) tf.push({ translateX: out[K_TX] });
    if (usesKey(mask, K_TY)) tf.push({ translateY: out[K_TY] });
    if (usesKey(mask, K_SCALE) || usesKey(mask, K_SX)) tf.push({ scaleX: out[K_SCALE] * out[K_SX] });
    if (usesKey(mask, K_SCALE) || usesKey(mask, K_SY)) tf.push({ scaleY: out[K_SCALE] * out[K_SY] });
    if (usesKey(mask, K_ROT)) tf.push({ rotate: `${out[K_ROT]}deg` });
    if (usesKey(mask, K_SKX)) tf.push({ skewX: `${out[K_SKX]}deg` });
    if (usesKey(mask, K_SKY)) tf.push({ skewY: `${out[K_SKY]}deg` });
    const made = usesKey(mask, K_OPACITY) ? { opacity: out[K_OPACITY], transform: tf } : { transform: tf };
    // The transform entries are built from a key index, so their shape is right but not provably so to the
    // type checker; React Native reads exactly these names.
    return made as unknown as Record<string, unknown>;
  }, [enter, loop, drivers, mask]);

  // The exit, as Reanimated's own: one sequence of timings per style key, each segment with its own ease.
  // Built inside a guard: the eases are Reanimated's own functions and some of them refuse what they are
  // given, and a node is not allowed to disappear from a screen because its exit could not be made.
  const exiting = useMemo(() => {
    try {
      return buildExit(c.exit);
    } catch {
      return undefined;
    }
  }, [c]);
  const layout = useMemo(() => {
    const l = c.layout;
    if (!l) return undefined;
    return l.spring
      ? LinearTransition.springify().stiffness(l.k).damping(springDamping(l.k, l.damp)).mass(1)
      : LinearTransition.duration(l.ms);
  }, [c]);

  if (capped) {
    return <View style={style as ViewStyle} pointerEvents={pointerEvents}>{children}</View>;
  }
  return (
    <Animated.View
      style={[style as ViewStyle, animated]}
      pointerEvents={pointerEvents}
      exiting={exiting as never}
      layout={layout}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The `exiting` builder: a worklet Reanimated calls when the view is being removed. It is handed plain data —
 * a first value and a list of segments per key — so nothing of ours has to be re-read on the UI thread.
 *
 * A key that two exit tracks both name is the later one: animations cannot be folded together the way a frame's
 * numbers can, and silently blending two would be worse than plainly taking one.
 */
function buildExit(tracks: readonly Track[]): ((values: unknown) => Record<string, unknown>) | undefined {
  if (tracks.length === 0) return undefined;
  const plan = tracks
    .filter((t) => t.n > 0 && t.slot < 0)
    .map((t) => ({ key: t.key, ...segmentsOf(t) }));
  if (plan.length === 0) return undefined;
  return (() => {
    "worklet";
    const initialValues: Record<string, unknown> = {};
    const animations: Record<string, unknown> = {};
    const first: Array<Record<string, number | string>> = [];
    const moves: Array<Record<string, unknown>> = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const chain: unknown[] = [];
      for (let j = 0; j < p.segs.length; j++) {
        const s = p.segs[j];
        chain.push(withTiming(s.to, { duration: s.ms, easing: s.easing }));
      }
      // One segment is a timing; several are a sequence. None means the key simply holds its first value.
      const anim = chain.length === 0 ? p.from : chain.length === 1 ? chain[0] : withSequence(...(chain as never[]));
      if (p.key === K_OPACITY) { initialValues.opacity = p.from; animations.opacity = anim; continue; }
      const name = p.key === K_TX ? "translateX" : p.key === K_TY ? "translateY"
        : p.key === K_SCALE ? "scale" : p.key === K_SX ? "scaleX" : p.key === K_SY ? "scaleY"
          : p.key === K_ROT ? "rotate" : p.key === K_SKX ? "skewX" : "skewY";
      const deg = p.key === K_ROT || p.key === K_SKX || p.key === K_SKY;
      first.push({ [name]: deg ? `${p.from}deg` : p.from });
      moves.push({ [name]: anim });
    }
    if (first.length > 0) { initialValues.transform = first; animations.transform = moves; }
    return { initialValues, animations };
  }) as (values: unknown) => Record<string, unknown>;
}
