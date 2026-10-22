/**
 * BlipHost — the one Blip, drawn above everything, for the life of the app.
 *
 * Mounted once in App.tsx beside the renderer, so it is never rebuilt when a
 * screen or the sign-in gate is. What it draws is only what must NOT change
 * when the tree under it does: the progress bar, Blip, his bubble, the
 * confetti, and, while the app swaps trees, a sheet of paper so the dark
 * loading ground never shows between "signed in" and "first screen".
 *
 * Where he stands comes from stageBus (the stages and spots in the trees say
 * so); how he moves is blipMotion; how he looks is blipFigure, drawn by Skia
 * (skiaCtx). This file is the glue, and the loop:
 *
 *   - ~30 frames a second at rest, ~60 while he walks, and none at all when
 *     nothing is visible. He is recorded on the JS thread and drawn on the UI
 *     thread: the Canvas shows a picture held in a shared value.
 *   - It never takes a touch (pointerEvents none), so it can sit over a button.
 *   - It is wrapped so that anything wrong in here removes Blip and nothing
 *     else. Sign-in is a tree under this one's sibling; a drawing fault must
 *     not be able to reach it.
 *
 * The rules for when he walks, hops, snaps or just changes pose are in
 * blipMotion.planArrival and are tested there.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, PixelRatio, StatusBar, Text, View, useWindowDimensions } from "react-native";
import { Canvas, Picture, type SkPicture } from "@shopify/react-native-skia";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { num } from "../sdui/knobs";
import { makeDither } from "./blipFigure";
import { BUBBLE, CONFETTI, EASE, boxOf, confettiPieces, type Piece } from "./blipMotion";
import { BlipEngine, type BubbleSpec } from "./blipEngine";
import { SkiaRaster, emptyPicture, recordBlip } from "./skiaCtx";
import * as bus from "./stageBus";

/** The tallest he is ever drawn. A spot asking for more is drawn at this. */
const HMAX = 220;
const BOX = boxOf(HMAX);
const FADE_MS = 200;

const ease = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

/** Anything that throws in here draws nothing, and leaves the rest of the app alone. */
class Guard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BlipHost] drawing stopped:", error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function BlipHost(): React.ReactElement {
  return <Guard><Host /></Guard>;
}

// --- What the loop tells React ----------------------------------------------

interface BurstSpec { id: number; x: number; y: number; pieces: Piece[] }

function Host(): React.ReactElement | null {
  const view = useSyncExternalStore(bus.subscribe, bus.viewSnapshot, bus.viewSnapshot);
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const rootRef = useRef<View>(null);
  const hostOrigin = useRef({ x: 0, y: 0 });

  // What is drawn. It lags the bus by one thing: when he is let go, the last
  // thing drawn stays up while it fades (200 ms) and only then goes.
  const [drawn, setDrawn] = useState<bus.View | null>(null);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (view.mode !== "off") {
      fade.stopAnimation();
      fade.setValue(1);
      setDrawn(view);
      return;
    }
    const run = Animated.timing(fade, { toValue: 0, duration: FADE_MS, easing: Easing.linear, useNativeDriver: true });
    run.start(({ finished }) => { if (finished) setDrawn(null); });
    return () => run.stop();
  }, [view, fade]);

  const [bubble, setBubble] = useState<BubbleSpec | null>(null);
  const [bursts, setBursts] = useState<BurstSpec[]>([]);
  const bubY = useRef(new Animated.Value(0)).current;

  // Blip himself: a picture, where to put it, and how visible.
  const blank = useMemo(() => emptyPicture(BOX.w, BOX.h), []);
  const pic = useSharedValue<SkPicture>(blank);
  const bx = useSharedValue(-1000);
  const by = useSharedValue(-1000);
  const alpha = useSharedValue(0);
  const botStyle = useAnimatedStyle(() => ({
    opacity: alpha.value,
    transform: [{ translateX: bx.value }, { translateY: by.value }],
  }));

  const measureHost = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) hostOrigin.current = { x, y };
    });
  }, []);

  // The loop. Everything it needs it reads from the bus and from refs, so it
  // is started once and never restarted. What it decides is the engine's
  // (blipEngine.ts, tested without a phone); what is here is the drawing.
  const live = useRef({ winW: win.width });
  live.current.winW = win.width;
  useEffect(() => {
    const dpr = PixelRatio.get();
    const raster = new SkiaRaster();
    const dither = makeDither();
    let raf = 0;
    let burstN = 0;
    let faults = 0;
    let dead = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const engine = new BlipEngine({
      say: (spec) => setBubble(spec),
      bubbleY: (y) => bubY.setValue(y),
      confetti: (x, y) => {
        const id = ++burstN;
        setBursts((b) => [...b, { id, x, y, pieces: confettiPieces() }]);
        const t = setTimeout(() => { timers.delete(t); setBursts((b) => b.filter((c) => c.id !== id)); }, CONFETTI.ms + 200);
        timers.add(t);
      },
      fade: (to) => {
        if (to === 1) alpha.value = 0;
        alpha.value = withTiming(to, { duration: FADE_MS });
      },
      release: () => bus.release(),
      later: (fn, ms) => {
        const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
        timers.add(t);
        return () => { clearTimeout(t); timers.delete(t); };
      },
      hostOrigin: () => hostOrigin.current,
      winW: () => live.current.winW,
      holdMaxMs: () => num("onboard.holdMaxMs", 12000),
      now: () => performance.now(),
      wall: () => Date.now(),
    }, { dpr, hmax: HMAX });
    const bot = engine.bot;

    const draw = (s: bus.Snapshot, dt: number) => {
      const look = s.stage?.look.blip ?? bus.DEFAULT_LOOK.blip;
      const still = s.reduced;
      const fr = bot.frame(dt, still);
      const cx = BOX.w / 2, cy = BOX.h - 2;
      const out = dither(raster, {
        H: bot.H, cell: bot.cell, x: cx, y: cy, sx: bot.fx, lift: bot.lift,
        padX: bot.H * .27, st: fr.st, t: fr.t, glow: fr.glow,
      });
      if (!out) return;
      pic.value = recordBlip(out, {
        w: BOX.w, h: BOX.h, cx, cy, squash: bot.sq, pose: bot.pose, H: bot.H, t: fr.t, still, look,
      });
      // At rest his feet are on whole pixels, so the dots stay crisp.
      const rest = !bot.tr;
      const px = rest ? Math.round(bot.x) : bot.x, py = rest ? Math.round(bot.y) : bot.y;
      bx.value = px - BOX.w / 2;
      by.value = py - BOX.h + 2;
    };

    const frame = () => {
      raf = 0;
      if (dead) return;
      const now = performance.now();
      const s = bus.snapshot();
      try {
        engine.sync(s, now);
        const step = engine.advance(now, s.reduced);
        if (step.draw) draw(s, step.dt);
        faults = 0;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[Tailzu][BlipHost] frame failed:", e);
        // Three in a row and he is taken away, rather than being retried at
        // thirty a second for as long as the app is open.
        if (++faults >= 3) { dead = true; alpha.value = 0; return; }
      }
      if (engine.active(now)) raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };

    const unsub = bus.subscribe(wake);
    wake();
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      engine.dispose();
      raster.dispose();
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage = drawn?.stage ?? null;
  const look = stage?.look ?? bus.DEFAULT_LOOK;
  const segments = Math.max(0, Math.min(30, Math.floor(stage?.of ?? 0)));
  const fill = stage ? bus.progressFill(stage) : 0;

  // The root is always there, because it is what knows where the window
  // starts; what is drawn inside it comes and goes with the fade.
  return (
    <View ref={rootRef} collapsable={false} onLayout={measureHost} pointerEvents="none" style={FILL}>
      {drawn && stage ? (
        <Animated.View pointerEvents="none" style={[FILL, { opacity: fade }]}>
          {/* Dark status icons for as long as anything of onboarding is up:
              the app is dark, and light icons on paper cannot be read. */}
          <StatusBar barStyle="dark-content" />
          {/* The paper, while the app changes trees. When a stage is on screen
              it paints its own, so this is only there for the gaps. */}
          {drawn.mode === "hold" ? <View style={[FILL, { backgroundColor: look.ground }]} /> : null}

          {/* The progress bar: the steps so far, filled. */}
          <View
            style={{
              position: "absolute", top: insets.top + 8, left: 20, right: 20,
              flexDirection: "row", gap: look.progress.gap,
            }}
          >
            {Array.from({ length: segments }, (_, i) => (
              <Segment key={i} on={i < fill} look={look.progress} />
            ))}
          </View>

          <Reanimated.View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[{ position: "absolute", left: 0, top: 0, width: BOX.w, height: BOX.h }, botStyle]}
          >
            <Canvas style={{ width: BOX.w, height: BOX.h }}>
              <Picture picture={pic} />
            </Canvas>
          </Reanimated.View>

          <Bubble spec={bubble} y={bubY} look={look.bubble} />

          {bursts.map((b) => (
            <Confetti key={b.id} burst={b} colors={[look.bubble.ink, look.blip.glow, look.blip.dot, "#8D8983"]} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const FILL = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } as const;

// --- The progress bar -------------------------------------------------------

/** One segment: the "off" colour with the "on" colour fading in over it. */
function Segment({ on, look }: { on: boolean; look: bus.StageLook["progress"] }) {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: 380, easing: ease, useNativeDriver: true }).start();
  }, [on, v]);
  return (
    <View style={{ flex: 1, height: look.height, borderRadius: look.height / 2, backgroundColor: look.off, overflow: "hidden" }}>
      <Animated.View style={[FILL, { backgroundColor: look.on, opacity: v }]} />
    </View>
  );
}

// --- His words ---------------------------------------------------------------

/**
 * The speech bubble. One element that follows him: it hides while he walks and
 * is said again where he lands. Tilted a degree and a half, grown from its
 * lower left corner, with its tail on the left.
 */
function Bubble({ spec, y, look }: { spec: BubbleSpec | null; y: Animated.Value; look: bus.StageLook["bubble"] }) {
  const o = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(BUBBLE.fromScale)).current;
  const rise = useRef(new Animated.Value(BUBBLE.rise)).current;
  // The last words stay up while the bubble fades, rather than blanking first.
  const keep = useRef<BubbleSpec | null>(null);
  const wasOn = useRef(false);
  if (spec) keep.current = spec;
  const shown = spec ?? keep.current;

  useEffect(() => {
    if (!spec) {
      wasOn.current = false;
      Animated.timing(o, { toValue: 0, duration: BUBBLE.fadeMs, useNativeDriver: true }).start();
      return;
    }
    if (wasOn.current && spec.resay) {
      // Already up: it is said again where it is, with a little pop.
      sc.setValue(BUBBLE.resayFrom);
      Animated.timing(sc, { toValue: 1, duration: BUBBLE.resayMs, easing: ease, useNativeDriver: true }).start();
    } else {
      o.setValue(0); sc.setValue(BUBBLE.fromScale); rise.setValue(BUBBLE.rise);
      Animated.parallel([
        Animated.timing(o, { toValue: 1, duration: BUBBLE.fadeMs, useNativeDriver: true }),
        Animated.timing(sc, { toValue: 1, duration: BUBBLE.growMs, easing: ease, useNativeDriver: true }),
        Animated.timing(rise, { toValue: 0, duration: BUBBLE.growMs, easing: ease, useNativeDriver: true }),
      ]).start();
    }
    wasOn.current = true;
  }, [spec?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const size = shown.big ? look.bigSize : look.size;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: "absolute", top: 0 },
        shown.anchor === "left" ? { left: shown.x } : { right: shown.x },
        { transform: [{ translateY: y }] },
      ]}
    >
      <Animated.View
        style={{
          maxWidth: 190,
          opacity: o,
          transformOrigin: "0% 100%",
          transform: [{ rotate: `${BUBBLE.tilt}deg` }, { scale: sc }, { translateY: rise }],
        }}
      >
        {/* the tail: a square turned a quarter, half hidden behind the body */}
        <View
          style={{
            position: "absolute", left: -7, bottom: 11, width: 11, height: 11,
            backgroundColor: look.background,
            borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: look.border,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <View
          style={{
            backgroundColor: look.background, borderColor: look.border, borderWidth: 1.5,
            borderRadius: 15, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 7,
          }}
        >
          <Text style={{ fontFamily: look.font, fontSize: size, lineHeight: Math.round(size * 1.15), color: look.ink }}>
            {shown.text}
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// --- Confetti ------------------------------------------------------------------

/** Twenty-two pieces thrown from him, turning as they go, gone in 1.2 s. */
function Confetti({ burst, colors }: { burst: BurstSpec; colors: string[] }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(p, {
      toValue: 1, duration: CONFETTI.ms,
      easing: Easing.bezier(CONFETTI.ease[0], CONFETTI.ease[1], CONFETTI.ease[2], CONFETTI.ease[3]),
      useNativeDriver: true,
    }).start();
  }, [p]);
  // Someone who asked for less motion gets none of this.
  if (bus.snapshot().reduced) return null;
  return (
    <>
      {burst.pieces.map((c, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute", left: burst.x - CONFETTI.w / 2, top: burst.y - CONFETTI.h / 2,
            width: CONFETTI.w, height: CONFETTI.h, borderRadius: 2,
            backgroundColor: colors[c.color % colors.length],
            opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [
              { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, c.dx] }) },
              { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, c.dy] }) },
              { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${c.rot}deg`] }) },
            ],
          }}
        />
      ))}
    </>
  );
}
