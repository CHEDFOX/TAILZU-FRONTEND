/**
 * PULL-A-BOT ON THE PHONE: the Screen's scroll view with a bot in its pull to refresh (types.ts PullBotSpec; capability
 * PULL_BOT_CAPABILITY). The physics and the rules are pullBotCore.ts's, the drawing pullBotDraw.ts's; this file gives
 * them a list, a finger, a canvas, a pill and a refresh.
 *
 *   The server turns it on per screen (ScreenResponse.pullBot: `top`, `bottom`, the list's `items`, where new ones land,
 *   which bot), only for a build that declares the capability; ScreenHost hands the screen's spec down (PullBotContext)
 *   and the Screen (components.tsx) draws its scroll view through PullBotScroll when it has one.
 *
 * ONE WAY ON BOTH PLATFORMS. The pull is taken over rather than read from the scroll view's own bounce: iOS's bounce
 * cannot spring back the prototype's way (a quick snap with one small bounce, rate 17, damping 0.58) or carry the bot to
 * the moment the list passes its rest, and Android has no bounce at all. So a pan (react-native-gesture-handler),
 * simultaneous with the scroll view's own, watches the finger; at an edge, moving outward, it pulls the content itself
 * (a transform on the content, the prototype's rubber band) while the scroll view is held at that edge (scrollTo on the
 * UI thread, in the same event, so it never shows). Mid-list, the scroll view is untouched; a fling that reaches the end
 * still bounces natively on iOS (Android: no overscroll stretch on these screens, the pull is the overscroll).
 *
 * ALL ON THE UI THREAD. The finger (the pan's worklets), the scroll (an animated scroll handler), the frame (a frame
 * callback, running only while something moves) and the drawing (one Skia picture recorded per frame from the state
 * array: paints, shapes and the recorder made once) never wait on JavaScript. JavaScript hears four things: the tick
 * (a haptic and its sound), the release past the line (the refresh), the throw (its sound) and that nothing moves any
 * more (the frame callback stops). The sounds (sounds.ts) are readied when a finger comes down and never hold up a frame:
 * the chime or the "hmm" comes with the pill's answer.
 *
 * THE BOT is drawn over the list in a canvas from the top of the window to the bottom of the list's viewport: in the gap
 * while it is pulled (feet first from the top, head first from the bottom), over everything above the list as he flies
 * off the top of the screen, and cut off at the viewport's bottom edge, so from the bottom he drops away behind whatever
 * is under the list (the tab bar, a footer) and never over it. His look is the prototype's ("x0") unless the server says
 * another (pullBotCore lookOf: knob pullBot.avatar, pullBot.looks, or the screen's `avatar`). The looks catalog's avatars
 * (botTiles/core.ts) are Blip's body, a different drawing on the JS thread, so they do not dress this bot.
 *
 * THE REFRESH is the live updates' quiet reload (live.ts, through nav.refreshQuietly): the screen fetched again and
 * swapped in with its Store kept (what is typed, what is open), no spinner. The pill says "Checking", then how many are
 * new (countNew: the screen's `items` before and after) or "You're up to date"; from the other end, where they are
 * ("2 new at the top"), and a tap goes there. New things at the top while you are down the list do not push what you
 * are looking at away (the scroll follows the growth above it); new things at the end (a chat's `newAt: "bottom"`),
 * pulled from the end, are scrolled into view.
 *
 * Knobs (the prototype's values): pullBot.threshold 60, pullBot.rubber 300, pullBot.springRate 17, pullBot.springDamping
 * 0.58, pullBot.throwSpeed 1750, pullBot.throwBoost 2.6, pullBot.gravity 2600, pullBot.scale 0.5, pullBot.avatar "x0",
 * pullBot.looks {}, pullBot.checkMinMs 900, pullBot.pillMs 2200, pullBot.giveUpMs 15000, pullBot.pill.*; app.haptics.pullBot
 * "light". Labels:
 * pullBot.checking, pullBot.fresh, pullBot.freshTop, pullBot.freshBottom, pullBot.upToDate, pullBot.failed.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo, NativeModules, Platform, Pressable, Text, TurboModuleRegistry, View, type ScrollView, type ScrollViewProps, type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation, Easing, runOnJS, runOnUI, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue,
  useFrameCallback, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue,
} from "react-native-reanimated";
import { BlurStyle, Canvas, ClipOp, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, TileMode, vec } from "@shopify/react-native-skia";
import {
  advance, busy, C_SCALE, configFrom, countNew, drag, EV_THROW, EV_TICK, grab, listOffset, lookOf, newPullState, pillFor, release,
  S_EV, S_IDLE, S_P, S_PE, S_TOUCH, type Edge, type Pill, type PillWords,
} from "./pullBotCore";
import { drawScene, makeKit, type SkiaLike } from "./pullBotDraw";
import { runAction, type Ctx } from "./actions";
import { color, num, obj, str, txt } from "./knobs";
import { haptic } from "./haptic";
import { playPull, warmPull } from "./sounds";
import type { PullBotSpec, ScreenResponse } from "./types";

// ===================================================================== the screen's spec

/** The screen on show's pull-a-bot (ScreenHost provides it; a Screen inside a Screen gets none). */
export const PullBotContext = createContext<PullBotSpec | null>(null);

type GestureLib = typeof import("react-native-gesture-handler");
let gestureLib: GestureLib | null | undefined;

/**
 * react-native-gesture-handler, when this binary has its native half; else null. A JS update can reach a build made
 * before it was linked (the runtime version is a fixed string, app.config.ts), and the library's own import throws there,
 * so it is only required once its native module answers. Without it a Screen scrolls as it always did.
 */
function gestures(): GestureLib | null {
  if (gestureLib !== undefined) return gestureLib;
  try {
    const native = TurboModuleRegistry.get("RNGestureHandlerModule") ?? (NativeModules as Record<string, unknown>).RNGestureHandlerModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    gestureLib = native ? (require("react-native-gesture-handler") as GestureLib) : null;
  } catch {
    gestureLib = null;
  }
  return gestureLib;
}

/** The spec when this Screen should pull a bot: on a phone that can, with an edge turned on. */
export function usePullBot(): PullBotSpec | null {
  const spec = useContext(PullBotContext);
  if (Platform.OS === "web" || !spec || typeof spec !== "object") return null;
  if (spec.top !== true && spec.bottom !== true) return null;
  return gestures() ? spec : null;
}

// ===================================================================== the pill

interface PillState { p: Pill; edge: Edge; key: number; shown: boolean }

const POP = Easing.bezier(0.34, 1.56, 0.64, 1);

function HopDot({ hop, delay, tint }: { hop: SharedValue<number>; delay: number; tint: string }): React.ReactElement {
  const st = useAnimatedStyle(() => {
    let u = (hop.value * 0.9 - delay) / 0.9;
    u -= Math.floor(u);
    const k = u < 0.3 ? u / 0.3 : u < 0.6 ? 1 - (u - 0.3) / 0.3 : 0;
    const e = k * k * (3 - 2 * k);
    return { opacity: 0.55 + 0.45 * e, transform: [{ translateY: -3 * e }] };
  }, [delay]);
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: tint }, st]} />;
}

/** The small pill: "Checking" with hopping dots, then the answer; pops in from its own edge (the prototype's curve). */
function PullPill({ pill, font, still, onGo }: { pill: PillState | null; font?: string; still: boolean; onGo: (e: Edge) => void }): React.ReactElement | null {
  const appear = useSharedValue(0), fade = useSharedValue(0), hop = useSharedValue(0);
  const busyNow = !!pill?.shown && !!pill.p.busy;
  useEffect(() => {
    if (!pill) return;
    if (pill.shown) {
      appear.value = 0; fade.value = 0;
      appear.value = still ? 1 : withTiming(1, { duration: 550, easing: POP });
      fade.value = withTiming(1, { duration: 200 });
    } else {
      appear.value = still ? 0 : withTiming(0, { duration: 550, easing: POP });
      fade.value = withTiming(0, { duration: 200 });
    }
  }, [pill?.key, pill?.shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (busyNow && !still) { hop.value = 0; hop.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false); }
    else { cancelAnimation(hop); hop.value = 0; }
  }, [busyNow, still]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = pill?.edge === "bottom" ? 12 : -12;
  const st = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: from * (1 - appear.value) }, { scale: 0.86 + 0.14 * appear.value }],
  }), [from]);
  if (!pill) return null;
  const { p, edge, shown } = pill;
  const inset = num("pullBot.pill.inset", 10);
  const ink = color("pullBot.pill.color", "#f3f4f3");
  const link = shown && !!p.goTo;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center", ...(edge === "top" ? { top: inset } : { bottom: inset }) }}>
      <Animated.View style={st} pointerEvents={link ? "auto" : "none"}>
        <Pressable
          disabled={!link}
          onPress={() => p.goTo && onGo(p.goTo)}
          accessibilityRole={link ? "button" : "text"}
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
            backgroundColor: color("pullBot.pill.background", "#141615"),
          }}
        >
          {p.busy ? (
            <View style={{ flexDirection: "row", gap: 3 }}>
              {[0, 0.12, 0.24].map((d) => <HopDot key={d} hop={hop} delay={d} tint={color("pullBot.pill.dots", "#f3e2c6")} />)}
            </View>
          ) : null}
          {p.fresh ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color("pullBot.pill.fresh", "#C9683F") }} /> : null}
          <Text
            numberOfLines={1}
            style={{
              color: ink, fontSize: num("pullBot.pill.size", 12.5), lineHeight: Math.round(num("pullBot.pill.size", 12.5) * 1.3),
              ...(font ? { fontFamily: font, fontWeight: "normal" as const } : { fontWeight: "600" as const }),
            }}
          >
            {p.text}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ===================================================================== the scroll view

export interface PullBotScrollProps {
  spec: PullBotSpec;
  /** The Screen's scroll view props (its style, layout, touches, keyboard); its onScroll is `onScrollY`. */
  scroll: Omit<ScrollViewProps, "onScroll" | "contentContainerStyle" | "children">;
  /** The Screen's content container style: it moves onto the content that is pulled. */
  contentStyle: StyleProp<ViewStyle>;
  /** Where the page is scrolled, as the Screen's own onScroll heard it. */
  onScrollY?: (y: number) => void;
  /** The Screen's ref to its scroll view (the keyboard scrolls a field into view with it). */
  scrollRef?: React.MutableRefObject<ScrollView | null>;
  ctx: Ctx;
  children: React.ReactNode;
}

const FLEX = { flex: 1 } as const;
/** This build's Skia, as the drawing takes it (pullBotDraw.ts). */
const SKIA: SkiaLike = { Skia, PaintStyle, StrokeCap, StrokeJoin, BlurStyle, TileMode, ClipOp, vec };
const GROW = { flexGrow: 1 } as const;

const words = (): PillWords => ({
  checking: txt("pullBot.checking", "Checking"),
  fresh: txt("pullBot.fresh", "{n} new"),
  freshTop: txt("pullBot.freshTop", "{n} new at the top"),
  freshBottom: txt("pullBot.freshBottom", "{n} new at the bottom"),
  upToDate: txt("pullBot.upToDate", "You're up to date"),
  failed: txt("pullBot.failed", "Couldn't check. Try again."),
});

export function PullBotScroll(p: PullBotScrollProps): React.ReactElement {
  const { spec } = p;
  const still = useReducedMotion();

  // ---- the server's knobs and the screen's spec
  const cfgNow = configFrom({
    threshold: num("pullBot.threshold", 60),
    rubber: num("pullBot.rubber", 300),
    springRate: num("pullBot.springRate", 17),
    springDamping: num("pullBot.springDamping", 0.58),
    throwSpeed: num("pullBot.throwSpeed", 1750),
    throwBoost: num("pullBot.throwBoost", 2.6),
    gravity: num("pullBot.gravity", 2600),
    scale: num("pullBot.scale", 0.5),
  }, { still, top: spec.top === true, bottom: spec.bottom === true });
  const cfgKey = cfgNow.join(",");
  const look = lookOf(spec.avatar, str("pullBot.avatar", "x0"), obj("pullBot.looks", {}));
  const lookKey = JSON.stringify(look);
  const scale = cfgNow[C_SCALE]!;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kit = useMemo(() => makeKit(SKIA, look, scale), [lookKey, scale]);

  // ---- the UI thread's state
  const [first] = useState(newPullState);
  const S = useSharedValue<number[]>(first);
  const cfg = useSharedValue<number[]>(cfgNow);
  const geo = useSharedValue<number[]>([0, 0, 0]);
  const tick = useSharedValue(0);
  const listY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const maxY = useSharedValue(0);
  const refreshing = useSharedValue(0);
  useEffect(() => { cfg.value = cfgNow; }, [cfgKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- what the JS thread is told (stable functions, so the worklets that call them are made once)
  const latest = useRef(p);
  latest.current = p;
  const stillRef = useRef(still);
  stillRef.current = still;
  const loopRef = useRef<{ setActive: (on: boolean) => void } | null>(null);
  const refreshRef = useRef<(edge: Edge) => void>(() => {});
  // A finger on the list: the frame runs, and the sounds a pull may need are readied (sounds.ts).
  const startLoop = useCallback(() => { loopRef.current?.setActive(true); warmPull(); }, []);
  const stopLoop = useCallback(() => { loopRef.current?.setActive(false); }, []);
  const onTick = useCallback(() => { haptic(str("app.haptics.pullBot", "light")); playPull("tick"); }, []);
  const onThrow = useCallback(() => { playPull("throw"); }, []);
  const onRefresh = useCallback((code: number) => { refreshRef.current(code === 0 ? "top" : "bottom"); }, []);
  const scrolledTo = useRef(0);
  const onY = useCallback((y: number) => { scrolledTo.current = y; latest.current.onScrollY?.(y); }, []);

  // ---- the frame: only while something moves (a finger is down, the list is out, the bot or his dust is about)
  const loop = useFrameCallback((f) => {
    "worklet";
    const s = S.value;
    advance(s, cfg.value, geo.value, (f.timeSincePreviousFrame ?? 16) / 1000);
    const y = listOffset(s);
    if (y !== listY.value) listY.value = y;
    if (s[S_EV] !== 0) {
      const ev = s[S_EV];
      s[S_EV] = 0;
      if (ev & EV_TICK) runOnJS(onTick)();
      if (ev & EV_THROW) runOnJS(onThrow)();
    }
    if (busy(s)) { s[S_IDLE] = 0; tick.value = tick.value + 1; }
    else if (s[S_IDLE] === 0) { s[S_IDLE] = 1; tick.value = tick.value + 1; }   // the empty frame, once
    else if (s[S_IDLE] === 1 && s[S_TOUCH] === 0) { s[S_IDLE] = 2; runOnJS(stopLoop)(); }
  }, false);
  loopRef.current = loop;

  // ---- the scroll view: where it is, and held at its edge while a pull is on
  const aref = useAnimatedRef<Animated.ScrollView>();
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      "worklet";
      const y = e.contentOffset.y;
      // The end: what the scroll view can reach, with room it was given below (the keyboard's, on iOS).
      const max = Math.max(0, e.contentSize.height - e.layoutMeasurement.height + (e.contentInset ? e.contentInset.bottom : 0));
      scrollY.value = y;
      maxY.value = max;
      const s = S.value;
      if (s[S_P] === 1) {
        const edge = s[S_PE] === 1 ? max : 0;
        if (Math.abs(y - edge) > 0.5) scrollTo(aref, 0, edge, false);
      }
      runOnJS(onY)(y);
    },
    // A fling that would start under a pull (iOS lets go into momentum) is stopped where the pull holds it.
    onMomentumBegin: () => {
      "worklet";
      const s = S.value;
      if (s[S_P] === 1) scrollTo(aref, 0, s[S_PE] === 1 ? maxY.value : 0, false);
    },
  });

  // ---- the finger (usePullBot made sure the library is here)
  const G = gestures()!;
  const gesture = useMemo(() => {
    const pan = G.Gesture.Pan()
      .activeOffsetY([-6, 6])
      .failOffsetX([-24, 24])
      .cancelsTouchesInView(false)
      .onBegin(() => {
        "worklet";
        const s = S.value;
        s[S_IDLE] = 0;
        grab(s, cfg.value);
        runOnJS(startLoop)();
      })
      .onChange((e) => {
        "worklet";
        const s = S.value;
        const was = s[S_P];
        const hold = drag(s, cfg.value, e.changeY, scrollY.value, maxY.value, refreshing.value === 1);
        listY.value = listOffset(s);
        if (hold === 1) {
          const edge = s[S_PE] === 1 ? maxY.value : 0;
          if (Math.abs(scrollY.value - edge) > 0.5) scrollTo(aref, 0, edge, false);
        }
        if (was !== 1 && s[S_P] === 1) runOnJS(startLoop)();
      })
      .onFinalize(() => {
        "worklet";
        const r = release(S.value, cfg.value, refreshing.value === 1);
        if (r !== 0) { refreshing.value = 1; runOnJS(onRefresh)(r - 1); }
      });
    return G.Gesture.Simultaneous(G.Gesture.Native(), pan);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: listY.value }] }));

  // ---- where the list is on the screen: the overlay runs from the window's top to the list's bottom edge
  const frame = useRef<View>(null);
  const [box, setBox] = useState({ w: 0, h: 0, top: 0 });
  const measure = useCallback(() => {
    frame.current?.measureInWindow((_x, y, w, h) => {
      if (!(w > 0 && h > 0)) return;
      const top = Math.max(0, Math.round(y));
      geo.value = [w, top, top + h];
      setBox((b) => (b.w === w && b.h === h && b.top === top ? b : { w, h, top }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the drawing: one picture per frame that moves, recorded on the UI thread
  const rec = useMemo(() => Skia.PictureRecorder(), []);
  const bounds = useMemo(() => Skia.XYWHRect(0, 0, Math.max(1, box.w), Math.max(1, box.top + box.h)), [box.w, box.h, box.top]);
  const pic = useDerivedValue(() => {
    tick.value; // eslint-disable-line @typescript-eslint/no-unused-expressions
    const cv = rec.beginRecording(bounds);
    drawScene(cv, S.value, cfg.value, geo.value, kit);
    return rec.finishRecordingAsPicture();
  }, [kit, bounds, rec]);

  // ---- the refresh, the pill, and keeping what you look at still
  const [pill, setPill] = useState<PillState | null>(null);
  const alive = useRef(true);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => { alive.current = false; timers.current.forEach(clearTimeout); }, []);
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const contentH = useRef(0);
  /** Once the refreshed content has grown: "follow" keeps what you look at still, "end" shows the new things at the end. */
  const keep = useRef<{ mode: "follow" | "end"; h: number; y: number; at: number } | null>(null);
  const scrollJs = useRef<ScrollView | null>(null);
  const hideAt = useRef(0);
  const runs = useRef(0);

  const show = useCallback((p2: Pill, edge: Edge) => {
    setPill((old) => ({ p: p2, edge, key: (old?.key ?? 0) + 1, shown: true }));
    hideAt.current = 0;
  }, []);
  const hide = useCallback(() => setPill((old) => (old && old.shown ? { ...old, shown: false } : old)), []);

  const follow = (k: { mode: "follow" | "end"; h: number; y: number }, h: number) => {
    if (h <= k.h + 0.5) return;
    if (k.mode === "end") scrollJs.current?.scrollToEnd({ animated: !stillRef.current });
    else scrollJs.current?.scrollTo({ y: k.y + (h - k.h), animated: false });
  };

  refreshRef.current = (edge: Edge) => {
    const { spec: sp, ctx } = latest.current;
    const newAt: Edge = sp.newAt === "bottom" ? "bottom" : "top";
    const before = sp.items;
    const h0 = contentH.current;
    const run = ++runs.current;
    show(pillFor("checking", edge, newAt, words()), edge);
    const until = new Promise<void>((r) => later(Math.max(0, num("pullBot.checkMinMs", 900)), () => r()));
    // Once: the answer, or giving up on a fetch that never settles (so the next pull can refresh again).
    const done = (result: Pill, sound?: "new" | "uptodate") => {
      if (!alive.current || run !== runs.current) return;
      runs.current++;
      refreshing.value = 0;
      show(result, edge);
      if (sound) playPull(sound);
      if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(result.text);
      const at = Date.now();
      hideAt.current = at;
      later(Math.max(600, num("pullBot.pillMs", 2200)), () => { if (hideAt.current === at) hide(); });
    };
    later(Math.max(3000, num("pullBot.giveUpMs", 15000)), () => done(pillFor("failed", edge, newAt, words())));
    const reload = ctx.nav.refreshQuietly;
    if (!reload) {
      // A host without the quiet reload: the screen's plain refresh (it shows its own spinner), and nothing to count.
      void runAction({ kind: "refresh" }, ctx);
      void until.then(() => done(pillFor(0, edge, newAt, words()), "uptodate"));
      return;
    }
    reload(until).then(
      (next: ScreenResponse | null) => {
        if (!alive.current) return;
        const n = next ? countNew(before, next.pullBot?.items) : 0;
        // New things above while you are down the list: what you look at stays where it is. New things at the end, pulled
        // from the end: they are shown.
        const mode = n > 0 && newAt === "top" && scrolledTo.current > 1 ? "follow" : n > 0 && newAt === "bottom" && edge === "bottom" ? "end" : null;
        if (mode) {
          const k = { mode, h: h0, y: scrolledTo.current, at: Date.now() } as const;
          if (contentH.current > h0 + 0.5) follow(k, contentH.current);
          else keep.current = k;
        }
        done(pillFor(n, edge, newAt, words()), n > 0 ? "new" : "uptodate");
      },
      () => { void until.then(() => done(pillFor("failed", edge, newAt, words()))); },
    );
  };

  const onContent = useCallback((_w: number, h: number) => {
    const was = contentH.current;
    contentH.current = h;
    const k = keep.current;
    if (k && h !== was) {
      keep.current = null;
      if (Date.now() - k.at < 3000) follow(k, h);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = useCallback((edge: Edge) => {
    runOnUI((bottom: number) => {
      "worklet";
      scrollTo(aref, 0, bottom === 1 ? maxY.value : 0, true);
    })(edge === "bottom" ? 1 : 0);
    hide();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRef = useCallback((r: Animated.ScrollView | null) => {
    (aref as unknown as (x: unknown) => void)(r);
    const sv = r as unknown as ScrollView | null;
    scrollJs.current = sv;
    if (latest.current.scrollRef) latest.current.scrollRef.current = sv;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <G.GestureHandlerRootView style={FLEX}>
      <View ref={frame} style={FLEX} onLayout={measure} collapsable={false}>
        <G.GestureDetector gesture={gesture}>
          <Animated.ScrollView
            {...p.scroll}
            ref={setRef}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={onContent}
            overScrollMode={Platform.OS === "android" ? "never" : p.scroll.overScrollMode}
            contentContainerStyle={GROW}
          >
            <Animated.View style={[GROW, p.contentStyle, slide]}>
              <PullBotContext.Provider value={null}>{p.children}</PullBotContext.Provider>
            </Animated.View>
          </Animated.ScrollView>
        </G.GestureDetector>
        {box.w > 0 ? (
          <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: -box.top, width: box.w, height: box.top + box.h }}>
            <Picture picture={pic} />
          </Canvas>
        ) : null}
        <PullPill pill={pill} font={typeof spec.font === "string" ? spec.font : undefined} still={still} onGo={goTo} />
      </View>
    </G.GestureHandlerRootView>
  );
}
