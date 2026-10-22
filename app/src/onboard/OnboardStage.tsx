/**
 * OnboardStage — the container for a run of onboarding steps, and the glide
 * between them.
 *
 * WHY IT IS A STAGE AND NOT A PAGER. Onboarding is one character walking
 * through a handful of steps while only the words and buttons change. A Pager
 * is a free horizontal swipe, so a person could swipe past an unanswered step;
 * and a screen per step would wait on a fetch each time, which is a visible
 * gap exactly where the content should glide. A stage keeps every step of its
 * run in one tree, shows one, and moves between them the way the approved
 * design does: the old step fades and slides ~26 px away over 230 ms, the new
 * one arrives from the other side over 320 ms after a 60 ms beat, ~380 ms in
 * all, native-driven.
 *
 * The stage draws only what is its own: the paper, the steps, the glide. Blip,
 * the progress bar and the bubble are NOT in here (they would be rebuilt when
 * the tree is, and the whole point is that he is not); the stage tells the
 * overlay (BlipHost) about itself through stageBus and lets each step's
 * BlipSpot say where to stand.
 *
 * Two stages exist: the sign-in run (hello, sign in, the code), served in the
 * auth gate before there is a session, and the rest of onboarding, served as
 * a screen. Sign-in's `phaseStep` maps the sign-in flow's phase onto a step,
 * so the code step shows itself when a code has been sent, and "Change it"
 * glides back.
 *
 * `keepCase` (the server asks the tree to be left exactly as written) needs
 * nothing here: this renderer has no capitalising pass to opt out of.
 */
import React, { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, ScrollView, StatusBar, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CompProps } from "../sdui/components";
import { useAuthFlow } from "../auth/AuthFlowContext";
import { EASE } from "./blipMotion";
import * as bus from "./stageBus";

/** What a step's spots need to know about the step they are in. */
export interface StepContext {
  stageId: string;
  /** Unique to this showing of this step; scroll offsets are kept by it. */
  layer: string;
  /** False for a step on its way out, whose spots must not register. */
  current: boolean;
  /** The view inside the scroll content that spots measure against. */
  contentRef: React.RefObject<View | null>;
  /** Bumped when the step's content changes size, so spots measure again. */
  tick: number;
}

export const StepCtx = createContext<StepContext | null>(null);

interface LayerState {
  key: number;
  idx: number;
  out: boolean;
  enter: boolean;
  enterDir: number;
  exitDir: number;
}

interface ViewState {
  idx: number;
  seq: number;
  layers: LayerState[];
}

const FILL = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } as const;

export const OnboardStage = ({ node, props, children, style, store }: CompProps): React.ReactElement => {
  const id = String(props?.id ?? "onboard");
  const bindPath = node.bind?.step ?? "";
  const kids = React.Children.toArray(children);
  const first = Number(props?.first) || 0;
  const of = Number(props?.of) || kids.length;
  const phaseStep = (props?.phaseStep ?? null) as Record<string, number> | null;
  const flow = useAuthFlow();
  const insets = useSafeAreaInsets();

  // The look is read from props that keep their identity while the node does,
  // so a re-render for some unrelated state does not rebuild it.
  const look = useMemo(
    () => bus.readLook(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props?.ground, props?.progress, props?.bubble, props?.blip, props?.glide],
  );
  const reduced = bus.snapshot().reduced;
  const glide = reduced ? bus.REDUCED_GLIDE : look.glide;

  // THE STEP. Never backward: a refetch makes a new store with the step back
  // at zero, so whenever the store is a new one the step is raised to the
  // furthest this stage has been. The raise is written back below, so the
  // screen's own actions (SET) carry on from where the person is.
  const stored = Number(props?.step) || 0;
  const storeRef = useRef(store);
  const floorRef = useRef(bus.remembered(id));
  if (storeRef.current !== store) {
    storeRef.current = store;
    floorRef.current = bus.remembered(id);
  }
  const { idx, fromPhase } = bus.resolveStep({
    stored, floor: floorRef.current, phase: flow?.phase ?? null, phaseStep, count: kids.length,
  });

  useLayoutEffect(() => {
    if (!bindPath || fromPhase) return;
    if ((Number(store.get(bindPath)) || 0) !== idx) store.set(bindPath, idx);
    floorRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, idx, fromPhase, bindPath]);

  useEffect(() => {
    if (!fromPhase) bus.remember(id, idx);
  }, [id, idx, fromPhase]);

  // THE LAYERS. The step on screen, and any step still gliding out. Adjusting
  // state while rendering is React's own pattern for "this changed, so that
  // follows": it re-renders before anything is drawn, so there is no frame
  // with the new step missing.
  const [vs, setVs] = useState<ViewState>(() => ({
    idx, seq: 1,
    layers: [{ key: 1, idx, out: false, enter: false, enterDir: 1, exitDir: 1 }],
  }));
  if (vs.idx !== idx) {
    const dir = idx > vs.idx ? 1 : -1;
    const seq = vs.seq + 1;
    setVs({
      idx, seq,
      layers: [
        ...vs.layers.map((l) => (l.out ? l : { ...l, out: true, exitDir: dir })),
        { key: seq, idx, out: false, enter: true, enterDir: dir, exitDir: dir },
      ],
    });
  }
  useEffect(() => {
    if (!vs.layers.some((l) => l.out)) return;
    const t = setTimeout(
      () => setVs((v) => ({ ...v, layers: v.layers.filter((l) => !l.out) })),
      glide.outMs + 120,
    );
    return () => clearTimeout(t);
  }, [vs.layers, glide.outMs]);

  // TELL THE OVERLAY. Mounted once for the stage's life, updated as it moves.
  useEffect(() => {
    bus.mountStage({ id, first, of, step: idx, look, origin: null });
    return () => bus.unmountStage(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    bus.updateStage(id, { first, of, step: idx, look });
  }, [id, first, of, idx, look]);

  // Where the stage's corner is in the window, which is what the spots'
  // positions inside it are added to. Measured on layout, and again shortly
  // after: a parent still settling (the gate fades in) can move it.
  const rootRef = useRef<View>(null);
  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) bus.updateStage(id, { origin: { x, y } });
    });
  }, [id]);
  useEffect(() => {
    const a = setTimeout(measure, 120), b = setTimeout(measure, 480);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [measure]);

  return (
    <View ref={rootRef} collapsable={false} onLayout={measure} style={[{ flex: 1, backgroundColor: look.ground }, style]}>
      {/* The app is dark, so its status bar draws light icons; on paper they
          would be invisible. Dark ones, for as long as the stage is up (the
          overlay says the same while the app swaps trees, so it never flips). */}
      <StatusBar barStyle="dark-content" />
      {vs.layers.map((l) => (
        <Layer
          key={l.key}
          stageId={id}
          layer={`${id}#${l.key}`}
          state={l}
          glide={glide}
          topInset={insets.top}
          bottomInset={insets.bottom}
        >
          {kids[l.idx] ?? null}
        </Layer>
      ))}
    </View>
  );
};

function Layer({ stageId, layer, state, glide, topInset, bottomInset, children }: {
  stageId: string;
  layer: string;
  state: LayerState;
  glide: { slide: number; outMs: number; inMs: number; inDelayMs: number };
  topInset: number;
  bottomInset: number;
  children: React.ReactNode;
}) {
  const opacity = useRef(new Animated.Value(state.enter ? 0 : 1)).current;
  const tx = useRef(new Animated.Value(state.enter ? state.enterDir * glide.slide : 0)).current;
  const contentRef = useRef<View>(null);
  const [tick, setTick] = useState(0);
  const easing = useMemo(() => Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]), []);

  // In: from one side, after a beat.
  useEffect(() => {
    if (!state.enter) return;
    const run = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: glide.inMs, delay: glide.inDelayMs, easing, useNativeDriver: true }),
      Animated.timing(tx, { toValue: 0, duration: glide.inMs, delay: glide.inDelayMs, easing, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Out: from wherever it had got to, to the other side. A step replaced
  // while still arriving leaves from where it is, not from the start.
  useEffect(() => {
    if (!state.out) return;
    opacity.stopAnimation();
    tx.stopAnimation();
    const run = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: glide.outMs, easing, useNativeDriver: true }),
      Animated.timing(tx, { toValue: -state.exitDir * glide.slide, duration: glide.outMs, easing, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.out]);

  useEffect(() => () => bus.forgetScroll(layer), [layer]);

  const ctx = useMemo<StepContext>(
    () => ({ stageId, layer, current: !state.out, contentRef, tick }),
    [stageId, layer, state.out, tick],
  );

  return (
    <Animated.View
      pointerEvents={state.out ? "none" : "auto"}
      accessibilityElementsHidden={state.out}
      importantForAccessibility={state.out ? "no-hide-descendants" : "auto"}
      style={[FILL, { opacity, transform: [{ translateX: tx }] }]}
    >
      <ScrollView
        style={FILL}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        // iOS: lifts the content over the keyboard and scrolls the field into
        // view, so the email and phone boxes are never typed blind.
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        scrollEventThrottle={16}
        onScroll={(e) => { if (!state.out) bus.setScroll(layer, e.nativeEvent.contentOffset.y); }}
      >
        {/* The padding is HERE and not on the scroll's content container, so a
            spot measured against this view counts it: window position is then
            the stage's corner plus the spot, less how far it has scrolled. */}
        <View
          ref={contentRef}
          collapsable={false}
          onLayout={() => setTick((n) => n + 1)}
          style={{ flexGrow: 1, paddingTop: topInset + 22, paddingBottom: bottomInset }}
        >
          <StepCtx.Provider value={ctx}>{children}</StepCtx.Provider>
        </View>
      </ScrollView>
    </Animated.View>
  );
}
