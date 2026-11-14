/**
 * GESTURES ON ANY NODE, wired to fingers (pure SPEC 2.5, block B5). The rules are gestureCore.ts; this file is
 * the gesture-handler and Reanimated wiring and nothing else.
 *
 * WHILE A FINGER MOVES nothing crosses to JavaScript: the pan's worklets write the gesture's `ui.<into>` values
 * (values.ts) straight on the UI thread, and only `motion.drive` reads them, also on the UI thread. So a drag
 * that follows a finger keeps following it through a slow render, a list fling, a keyboard coming up.
 *
 * WHEN THE FINGER LIFTS, once, the settled values are written to the store through the host, `commitIf` is
 * asked, and the server's `onCommit` or `onCancel` runs. That is the only `ui.*` an expression or a rule ever
 * sees, and it is why `commitIf` can be an ordinary expression: by the time it is asked, the number it reads is
 * already in the store (SPEC 2.5).
 *
 * Every per-finger scratch value is made with makeMutable inside one memo rather than with a hook, because the
 * number of gestures on a node is the server's to decide and hooks may not be counted out at run time.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type ViewStyle } from "react-native";
import { makeMutable, runOnJS, withSpring, type SharedValue } from "react-native-reanimated";
import {
  AXIS_X, AXIS_Y, bounded, cancelUi, CLAIM_SIMULTANEOUS, compileGestures, GESTURE_DEFAULTS, GESTURE_LIMITS,
  pickUi, progressOf, restUi, settle, SWIPE_DOWN, SWIPE_LEFT, SWIPE_NONE, SWIPE_RIGHT, SWIPE_UP, swipeOf,
  type Gesture, type GestureDefaults,
} from "./gestureCore";
import { gestureLib } from "./lib";
import { holdValue, releaseValue, valueFor } from "../motion/values";
import { LiveCount, springDamping } from "../motion/motionCore";
import { gesturesOn } from "../safety";
import { num } from "../knobs";

/**
 * WHAT THE RENDERER HANDS THIS BLOCK (the seam: V1 owns the store and the actions, this folder owns fingers).
 *
 * Every member is optional, so a GestureView works with no host at all — the values still move, nothing is
 * written and no action runs. That is also exactly what a screen gets when a host member is missing, rather
 * than a throw.
 */
export interface GestureHost {
  /**
   * The gesture has ended: write these numbers into the screen store under `ui.<into>.*`. Must be synchronous,
   * because `test` is asked straight afterwards and the condition reads what was just written.
   */
  setUi?(into: string, values: Readonly<Record<string, number>>): void;
  /** Run one of the server's actions (`do`, `onCommit`, `onCancel`, `onLeft` …). */
  dispatch?(action: unknown, value?: unknown): void;
  /** Ask a server condition (`commitIf`), after the end values have been written. */
  test?(cond: unknown): boolean;
  /** Read a value by path, for a host that wants to hand one back. */
  read?(path: string): unknown;
  /** Anything in the node's gestures that could not be read, for the handshake's `sdui.bad`. */
  bad?(notes: readonly string[], node?: unknown): void;
}

/**
 * Every default, as the server has it right now. Each is a knob, so the feel of every gesture in the app can
 * be retuned from the console without a release; the numbers in gestureCore are only what holds before the
 * first bootstrap has ever arrived.
 */
export function gestureDefaults(): GestureDefaults {
  const d = GESTURE_DEFAULTS;
  return {
    doubleTapMs: num("gesture.doubleTapMs", d.doubleTapMs),
    longPressMs: num("gesture.longPressMs", d.longPressMs),
    slopPx: num("gesture.slopPx", d.slopPx),
    swipeDistance: num("gesture.swipeDistance", d.swipeDistance),
    swipeVelocity: num("gesture.swipeVelocity", d.swipeVelocity),
    projectMs: num("gesture.projectMs", d.projectMs),
    springK: num("gesture.springK", d.springK),
    springDamp: num("gesture.springDamp", d.springDamp),
    rubberPx: num("gesture.rubberPx", d.rubberPx),
  };
}

/**
 * A node's gestures are compiled once: a screen's JSON is parsed once, so the array keeps its identity. The
 * defaults are part of the key, so a new bootstrap with a new feel is picked up rather than cached over.
 */
const compiled = new WeakMap<object, { key: string; made: { list: Gesture[]; bad: string[] } }>();

export function compiledGestures(raw: unknown): { list: Gesture[]; bad: string[] } {
  if (!raw || typeof raw !== "object") return { list: [], bad: [] };
  const d = gestureDefaults();
  const key = Object.values(d).join(",");
  const had = compiled.get(raw as object);
  if (had && had.key === key) return had.made;
  const made = compileGestures(raw, d);
  compiled.set(raw as object, { key, made });
  return made;
}

/** True when this node asks for the gesture block at all. */
export function usesGesture(node: unknown): boolean {
  const g = (node as { gestures?: unknown } | null)?.gestures;
  if (!Array.isArray(g) || g.length === 0) return false;
  return compiledGestures(g).list.length > 0;
}

/** The four numbers a gesture keeps, by the names expressions read them under. */
interface Values { x: SharedValue<number>; y: SharedValue<number>; scale: SharedValue<number>; progress: SharedValue<number> }

function valuesFor(into: string): Values | null {
  const x = valueFor(`${into}.x`), y = valueFor(`${into}.y`);
  const scale = valueFor(`${into}.scale`), progress = valueFor(`${into}.progress`);
  if (!x || !y || !scale || !progress) return null;
  return { x, y, scale, progress };
}

/** The four names one `into` takes on the value bus, in the order valuesFor asks for them. */
function namesOf(into: string): string[] {
  return [`${into}.x`, `${into}.y`, `${into}.scale`, `${into}.progress`];
}

/**
 * HOW MANY GESTURES ARE LIVE, against SPEC 5.1's 12 per screen. One count for the launch: the limit is about
 * how many handlers the native side is asked to arbitrate between, and there is one of those.
 *
 * Past the cap a node draws, exactly as it drew before, and takes no finger. A whole node's worth is taken or
 * none of it, because half a node's gestures is a control that half works.
 */
const liveGestures = new LiveCount(GESTURE_LIMITS.perScreen);

/** How many gestures are live. For the handshake and for the tests. */
export function liveGestureCount(): number { return liveGestures.live; }

/** Forget the count: a sign-out, safe mode, a test. */
export function resetGestureCount(): void { liveGestures.reset(); }

export interface GestureViewProps {
  /** The node's `gestures`, as the server sent it. Compiled here, once. */
  gestures: unknown;
  host?: GestureHost;
  style?: ViewStyle | ViewStyle[] | null;
  children?: React.ReactNode;
}

/**
 * One box that takes fingers, around whatever the node draws.
 *
 * Children come back untouched when there is nothing to listen for, when safe mode has switched gestures off,
 * or when this binary has no gesture-handler under it — so putting this in the renderer's path costs a screen
 * without gestures nothing.
 */
export function GestureView({ gestures, host, style, children }: GestureViewProps): React.ReactElement {
  const { list, bad } = compiledGestures(gestures);
  const G = gestureLib();

  // The host is V1's, and V1 may well build it inline on every render. Kept in a ref so that nothing below
  // depends on its identity: otherwise every store change would rebuild every gesture on the node, which
  // re-attaches the detector's handlers and cancels a drag that is in the air.
  const hostRef = useRef(host);
  hostRef.current = host;

  const told = useRef(false);
  if (!told.current && bad.length && hostRef.current?.bad) { told.current = true; hostRef.current.bad(bad, gestures); }

  // The values each gesture writes, asked for once. Null when the value bus is full, and then this gesture
  // moves nothing and decides nothing — see `ended`.
  const vals = useMemo(() => list.map((g) => (g.into ? valuesFor(g.into) : null)), [list]);

  // A FRESH MOUNT STARTS WHERE THE FIRST ONE DID. The values are module-level numbers, so without this the
  // second visit to a screen opens with the last visit's ending: a slide-to-confirm already at its end, a
  // drawer already open. Put back during the first render rather than from an effect, because an effect is
  // after the first frame has been drawn and that frame would show the old place.
  const placed = useRef<unknown>(null);
  if (placed.current !== list) {
    placed.current = list;
    list.forEach((g, i) => {
      const v = vals[i];
      if (!v) return;
      const rest = restUi(g.fields, g.min, g.max);
      if (rest.x !== undefined) v.x.value = rest.x;
      if (rest.y !== undefined) v.y.value = rest.y;
      if (rest.scale !== undefined) v.scale.value = rest.scale;
      if (rest.progress !== undefined) v.progress.value = rest.progress;
    });
  }

  // The names are held while this node is mounted, so the value bus does not sweep one from under a finger.
  useEffect(() => {
    const names: string[] = [];
    list.forEach((g, i) => { if (g.into && vals[i]) names.push(...namesOf(g.into)); });
    for (const n of names) holdValue(n);
    return () => { for (const n of names) releaseValue(n); };
  }, [list, vals]);

  // SPEC 5.1: at most 12 live gestures per screen. Reserved on mount, so a render React throws away cannot
  // leak places in the count.
  const want = Math.min(list.length, GESTURE_LIMITS.perNode);
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    const got = liveGestures.take(want);
    if (!got) {
      setCapped(true);
      hostRef.current?.bad?.([`gestures: at most ${GESTURE_LIMITS.perScreen} live on one screen`], gestures);
    }
    return () => { if (got) liveGestures.give(want); };
  }, [want, gestures]);

  // The JS-thread half: everything that happens once, when a finger lifts.
  const ended = useCallback((i: number, x: number, y: number, scale: number, progress: number, swipe: number) => {
    const g = list[i];
    if (!g) return;
    const h = hostRef.current;
    const run = (a: unknown) => { if (a != null && h?.dispatch) h.dispatch(a, { x, y, scale, progress }); };
    // A gesture that asked for values and could not have them knows nothing about where it is. Its own action
    // still runs — a tap is a tap — but nothing is written and nothing is decided from numbers that never moved.
    const lost = g.into !== "" && !vals[i];
    if (lost) h?.bad?.([`gestures: no room for the ui.${g.into} values`], gestures);
    if (!lost && g.into && h?.setUi) h.setUi(g.into, pickUi(g.fields, x, y, scale, progress));
    if (g.kind === "swipe") {
      run(swipe === SWIPE_LEFT ? g.onLeft : swipe === SWIPE_RIGHT ? g.onRight
        : swipe === SWIPE_UP ? g.onUp : swipe === SWIPE_DOWN ? g.onDown : null);
      if (swipe !== SWIPE_NONE) run(g.do);
      return;
    }
    run(g.do);
    if (g.commitIf == null && g.onCommit == null && g.onCancel == null && g.cancelTo === null) return;
    if (lost) return;
    // No way to ask the condition is not "commit anyway": a slide-to-confirm must never fire on a host that
    // cannot answer. Only a gesture with no condition at all commits by itself.
    const ok = g.commitIf == null ? true : h?.test ? !!h.test(g.commitIf) : false;
    if (ok) { run(g.onCommit); return; }
    if (g.cancelTo === null) { run(g.onCancel); return; }
    // `onCancel: { kind: "spring", to }`: the value goes back where the server says, on the axis that was
    // dragged, and the store is told where it ended up — so an expression reading `ui.*` sees the place it
    // settled and not the place it was let go of, and a pull-down does not quietly put `x` somewhere instead.
    if (g.into) {
      const p = progressOf(g.cancelTo, g.min, g.max);
      springValueTo(g.into, g.cancelTo, g.springK, g.springDamp, g.axis, p);
      if (h?.setUi) h.setUi(g.into, cancelUi(g.axis, g.cancelTo, p));
    }
  }, [list, vals, gestures]);

  const live = gesturesOn();
  const composed = useMemo(() => {
    if (!G || list.length === 0 || !live || capped) return null;
    // Alone or alongside, in the order claimOrder put them: in an Exclusive chain the earlier gesture has the
    // say, so one that asked to run `after:<id>` simply comes after the one it named.
    const alone: unknown[] = [], together: unknown[] = [];
    for (let i = 0; i < Math.min(list.length, GESTURE_LIMITS.perNode); i++) {
      const g = list[i];
      (g.claim === CLAIM_SIMULTANEOUS ? together : alone).push(buildOne(G, g, i, ended, vals[i]));
    }
    const chain = alone.length > 1 ? G.Gesture.Exclusive(...(alone as never[])) : alone[0];
    if (together.length === 0) return chain ?? null;
    const sim = together.length > 1 ? G.Gesture.Simultaneous(...(together as never[])) : together[0];
    return chain ? G.Gesture.Simultaneous(chain as never, sim as never) : sim;
  }, [G, list, live, ended, vals, capped]);

  if (!composed || !G) return <View style={style as ViewStyle}>{children}</View>;
  // THE ROOT VIEW IS NOT OPTIONAL. A GestureDetector with no GestureHandlerRootView above it throws in a
  // development build and, worse, is quietly not recognised at all on Android in a release one. The app has
  // exactly one root view today and it is inside PullBot, so a node with gestures on an ordinary screen would
  // have neither. Nesting is safe: the Android view turns itself off when it finds a root view above it
  // (RNGestureHandlerRootView.onAttachedToWindow), and on iOS it is a plain View with a context around it.
  return (
    <G.GestureHandlerRootView style={(style as ViewStyle) ?? NO_STYLE}>
      <G.GestureDetector gesture={composed as never}>
        <View style={FILL} collapsable={false}>{children}</View>
      </G.GestureDetector>
    </G.GestureHandlerRootView>
  );
}

/** The root view's own default is `flex: 1`, which a node that is not a screen must not take. */
const NO_STYLE: ViewStyle = {};

/**
 * The box inside the root view: it fills a node whose style gave it a size, and is its content's size when the
 * style did not, so the extra layer the root view adds does not change where anything sits.
 */
const FILL: ViewStyle = { flex: 1 };

type Ended = (i: number, x: number, y: number, scale: number, progress: number, swipe: number) => void;

/** One gesture, built. Returns null for a kind this platform cannot take. */
function buildOne(
  G: NonNullable<ReturnType<typeof gestureLib>>, g: Gesture, i: number, ended: Ended, v: Values | null,
): unknown {
  const min = g.min, max = g.max, axis = g.axis, rub = g.rubber, snaps = g.snaps, projectMs = g.projectMs;
  const stiff = g.springK, damp = springDamping(g.springK, g.springDamp);

  if (g.kind === "tap" || g.kind === "doubleTap") {
    return G.Gesture.Tap()
      .numberOfTaps(g.taps)
      .maxDistance(g.slop)
      .maxDelay(g.windowMs)
      .onEnd((e, ok) => {
        "worklet";
        if (!ok) return;
        // The scale is read, not assumed: a pinch sharing this `into` owns it, and reporting 1 here would
        // tell the store the picture is back at its own size while it sits zoomed in.
        const s = v ? v.scale.value : 1;
        if (v) { v.x.value = e.x; v.y.value = e.y; v.progress.value = 1; }
        runOnJS(ended)(i, e.x, e.y, s, 1, SWIPE_NONE);
      });
  }

  if (g.kind === "longPress") {
    return G.Gesture.LongPress()
      .minDuration(g.holdMs)
      .maxDistance(g.slop)
      .onStart((e) => {
        "worklet";
        const s = v ? v.scale.value : 1;
        if (v) { v.x.value = e.x; v.y.value = e.y; v.progress.value = 1; }
        runOnJS(ended)(i, e.x, e.y, s, 1, SWIPE_NONE);
      });
  }

  if (g.kind === "pinch") {
    const start = makeMutable(1);
    if (v) v.scale.value = v.scale.value || 1;
    return G.Gesture.Pinch()
      .onBegin(() => { "worklet"; start.value = v ? (v.scale.value || 1) : 1; })
      .onUpdate((e) => {
        "worklet";
        const s = start.value * e.scale;
        const held = s < g.minScale ? g.minScale : s > g.maxScale ? g.maxScale : s;
        if (v) v.scale.value = held;
      })
      .onEnd(() => {
        "worklet";
        // A pinch owns the scale and nothing else. The other three are read and handed on as they are, so a
        // pan sharing this `into` does not find its x and y put back to nothing by a zoom.
        const s = v ? v.scale.value : 1;
        const x = v ? v.x.value : 0, y = v ? v.y.value : 0, p = v ? v.progress.value : 0;
        runOnJS(ended)(i, x, y, s, p, SWIPE_NONE);
      });
  }

  if (g.kind === "swipe") {
    const pan = G.Gesture.Pan();
    if (axis === AXIS_X) pan.activeOffsetX([-8, 8]).failOffsetY([-24, 24]);
    else if (axis === AXIS_Y) pan.activeOffsetY([-8, 8]).failOffsetX([-24, 24]);
    return pan
      .onUpdate((e) => {
        "worklet";
        if (!v) return;
        v.x.value = e.translationX;
        v.y.value = e.translationY;
        v.progress.value = progressOf(axis === AXIS_Y ? e.translationY : e.translationX, min, max);
      })
      .onEnd((e) => {
        "worklet";
        const dir = swipeOf(e.translationX, e.translationY, e.velocityX, e.velocityY, axis, g.distance, g.velocity);
        const p = v ? v.progress.value : 0;
        const s = v ? v.scale.value : 1;
        if (v) { v.x.value = withSpring(0, { stiffness: stiff, damping: damp, mass: 1 }); v.y.value = withSpring(0, { stiffness: stiff, damping: damp, mass: 1 }); }
        runOnJS(ended)(i, e.translationX, e.translationY, s, p, dir);
      });
  }

  if (g.kind === "hover") {
    // A hover only ever happens where there is a pointer: a trackpad, a stylus, the desktop. On a phone it
    // simply never fires, which is the right answer, not a missing feature.
    return G.Gesture.Hover()
      .onBegin((e) => {
        "worklet";
        if (v) { v.x.value = e.x; v.y.value = e.y; v.progress.value = 1; }
      })
      .onEnd((e) => {
        "worklet";
        const s = v ? v.scale.value : 1;
        if (v) v.progress.value = 0;
        runOnJS(ended)(i, e.x, e.y, s, 0, SWIPE_NONE);
      });
  }

  // drag and pan: the same gesture, with a drag locked to one axis and held inside its run.
  const begX = makeMutable(0), begY = makeMutable(0);
  const pan = G.Gesture.Pan();
  if (g.kind === "drag" && axis === AXIS_X) pan.activeOffsetX([-6, 6]).failOffsetY([-24, 24]);
  else if (g.kind === "drag" && axis === AXIS_Y) pan.activeOffsetY([-6, 6]).failOffsetX([-24, 24]);
  return pan
    .onBegin(() => {
      "worklet";
      begX.value = v ? v.x.value : 0;
      begY.value = v ? v.y.value : 0;
    })
    .onUpdate((e) => {
      "worklet";
      if (!v) return;
      if (axis !== AXIS_Y) v.x.value = bounded(begX.value + e.translationX, min, max, rub);
      if (axis !== AXIS_X) v.y.value = bounded(begY.value + e.translationY, min, max, rub);
      v.progress.value = progressOf(axis === AXIS_Y ? v.y.value : v.x.value, min, max);
    })
    .onEnd((e) => {
      "worklet";
      const nowX = v ? v.x.value : 0, nowY = v ? v.y.value : 0;
      const s = v ? v.scale.value : 1;
      const toX = axis === AXIS_Y ? nowX : settle(nowX, e.velocityX, min, max, snaps, projectMs);
      const toY = axis === AXIS_X ? nowY : settle(nowY, e.velocityY, min, max, snaps, projectMs);
      const p = progressOf(axis === AXIS_Y ? toY : toX, min, max);
      if (v) {
        if (axis !== AXIS_Y) v.x.value = withSpring(toX, { stiffness: stiff, damping: damp, mass: 1 });
        if (axis !== AXIS_X) v.y.value = withSpring(toY, { stiffness: stiff, damping: damp, mass: 1 });
        v.progress.value = p;
      }
      runOnJS(ended)(i, toX, toY, s, p, SWIPE_NONE);
    });
}

/**
 * `onCancel: { kind: "spring", to }` — the one answer a gesture gives itself, because it is a value move and
 * not a server action. Called by the host's owner (V1) after `ended`, or by a screen that wants to put a value
 * back where it was.
 *
 * THE AXIS MATTERS. A pull-down to confirm is a drag on `y`, and springing `x` back would leave the thing
 * where the finger let go of it while the store was told it had gone home. `progress` moves with it, on the
 * UI thread as well as in the store, so `motion.drive` and an expression never disagree about where it is.
 */
export function springValueTo(
  into: string, to: number, k = 220, damp = 0.85, axis: number = AXIS_X, progress?: number,
): void {
  const cfg = { stiffness: k, damping: springDamping(k, damp), mass: 1 };
  if (axis !== AXIS_Y) { const sv = valueFor(`${into}.x`); if (sv) sv.value = withSpring(to, cfg); }
  if (axis !== AXIS_X) { const sv = valueFor(`${into}.y`); if (sv) sv.value = withSpring(to, cfg); }
  if (progress !== undefined && Number.isFinite(progress)) {
    const sv = valueFor(`${into}.progress`);
    if (sv) sv.value = withSpring(progress, cfg);
  }
}
