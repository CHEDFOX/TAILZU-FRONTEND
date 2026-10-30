/**
 * BotCard — a card with the tiny bot playing on his fabric across its top, and its steps below (types.ts
 * BotCardProps, capability "BotsMotion"). The first-arrival permission card (over Home) and Keybot's are this.
 *
 * The steps are the node's children, each shown by its own visibleIf (the server words them: the microphone, then
 * the keyboard). When the step changes the words cross-fade in and the bot gives a little hop; he never restarts
 * (he is kept by the card's key for the life of the app, so even a rebuilt screen finds him where he was).
 *
 *   overlay   centred over the screen, which is blurred behind it (a real blur: expo-blur on a phone, a CSS
 *             backdrop-filter on the web) under a light white veil; it comes in with a soft scale and fade
 *             (Reduce Motion: no scale) and goes the same way, the blur clearing with it.
 *   readyWhen nothing is drawn until this holds (the app's own readings of the microphone and the keyboard).
 *   doneWhen  when this holds: the bot's happy moment, then on.onComplete (after doneDelayMs). Already true when the
 *             card would first show: it never shows, and on.onComplete runs quietly.
 *   closeWhen when this holds the card goes. `once`: it is remembered on this device and never drawn again.
 *
 * LOOKS AND MOMENTS (BotMoments): `avatar` is the bot's look (an id or a spec; none: his kind's), `moment` a recipe he
 * plays once the card is open (`momentMode` "once" or "loop").
 *
 *   { type: "BotCard", props: { color, stageHeight, overlay, width, readyWhen, doneWhen, closeWhen, once, avatar?, moment?,
 *     momentMode? }, on: { onComplete }, children: [step, step, step] }
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Modal, Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CompProps } from "./components";
import { evalCondition } from "./actions";
import { BotTile, type BotKind } from "../botTiles/core";
import { playMoment } from "./sounds";
import { TileSurface, useReducedMotion, useTileLoop, type Painter } from "../botTiles/TileSurface";
import { useLooks } from "../botTiles/looks";

const WEB = Platform.OS === "web";
const LINE = "#e6e6e6", PAPER = "#ffffff";
const ONCE_KEY = "tz.botcard.once.";

/** Cards closed on this device ("once"), and the bots of the cards, for the life of the app. */
const CLOSED = new Set<string>();
const LIVES = new Map<string, BotTile>();

class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BotCard] stopped:", error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export const BotCard = (p: CompProps): React.ReactElement => (
  <Guard fallback={<Card {...p} bots={false} />}><Card {...p} bots /></Guard>
);

type Phase = "wait" | "open" | "closing" | "gone";

function Card({ node, props, ctx, children, fire, bots }: CompProps & { bots: boolean }): React.ReactElement | null {
  const overlay = !!props?.overlay;
  const stageH = Number(props?.stageHeight) || 128;
  const once = typeof props?.once === "string" ? props.once : "";
  const reduced = useReducedMotion();

  // Remembered as closed on this device?
  const [known, setKnown] = useState(!once || CLOSED.has(once));
  useEffect(() => {
    if (!once || CLOSED.has(once)) return;
    let live = true;
    Promise.resolve(AsyncStorage.getItem?.(ONCE_KEY + once)).then((v) => { if (v) CLOSED.add(once); }).catch(() => {}).finally(() => { if (live) setKnown(true); });
    return () => { live = false; };
  }, [once]);

  const ready = props?.readyWhen ? evalCondition(props.readyWhen, ctx) : true;
  const done = props?.doneWhen ? evalCondition(props.doneWhen, ctx) : false;
  const close = (props?.closeWhen ? evalCondition(props.closeWhen, ctx) : false) || (!!once && CLOSED.has(once));

  const [phase, setPhase] = useState<Phase>("wait");
  const completed = useRef(false);
  const complete = () => { if (!completed.current) { completed.current = true; fire("onComplete"); } };
  const remember = () => {
    if (!once || CLOSED.has(once)) return;
    CLOSED.add(once);
    Promise.resolve(AsyncStorage.setItem?.(ONCE_KEY + once, "1")).catch(() => {});
  };

  // Which step shows: the first child whose visibleIf holds.
  const step = (node.children ?? []).findIndex((c) => !c.visibleIf || evalCondition(c.visibleIf, ctx));

  // The bot.
  const winW = Dimensions.get("window").width;
  const [inlineW, setInlineW] = useState(0);
  const cardW = overlay ? Math.min(Number(props?.width) || 320, winW - 40) : inlineW;
  const bot = useMemo(() => {
    const key = `${once || "card"}|${props?.color}|${props?.kind ?? "custom"}`;
    let b = LIVES.get(key);
    if (!b) {
      // Sized to the stage: the card has room for a bigger bot than a tile.
      b = new BotTile({ kind: (props?.kind ?? "custom") as BotKind, color: String(props?.color || "#3d3d3d"), mood: "idle", seed: 29, size: Math.round(stageH * 0.4) });
      // A moment's sound plays from the bots' pack (sounds.ts).
      b.onSound = playMoment;
      LIVES.set(key, b);
    }
    return b;
  }, [once, props?.color, props?.kind]);
  useEffect(() => { if (cardW > 0) bot.resize(cardW - 2, stageH, stageH - 12); }, [bot, cardW, stageH]);
  // His look, and a moment once the card is open and he is on his stage.
  const L = useLooks();
  bot.setAvatar(L.avatar(bot.kind, props?.avatar));
  const recipe = typeof props?.moment === "string" ? L.moment(props.moment) : null;
  const momentMode = props?.momentMode === "loop" ? "loop" : props?.momentMode === "once" ? "once" : undefined;

  // wait → open (or never, when already done) → closing → gone.
  useEffect(() => {
    if (phase === "wait") {
      if (!known) return;
      if (close) { setPhase("gone"); return; }
      if (!ready) return;
      if (done) { complete(); setPhase("gone"); return; }
      setPhase("open");
    } else if (phase === "open" && close) {
      remember();
      setPhase("closing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, known, ready, done, close]);

  useEffect(() => {
    if (phase !== "open" || !recipe || !bot.placed || bot.mo === recipe) return;
    bot.playMoment(recipe, momentMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recipe, momentMode, cardW]);

  // Done: the happy moment (he keeps cheering, a hop each time the last one lands), then on.onComplete.
  useEffect(() => {
    if (phase !== "open" || !done) return;
    bot.cheer();
    const again = setInterval(() => bot.cheer(), 950);
    const t = setTimeout(complete, Number(props?.doneDelayMs) || 1300);
    return () => { clearTimeout(t); clearInterval(again); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, done]);

  // In and out: the veil (and its blur) and the card.
  const veil = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (phase === "open") {
      Animated.timing(veil, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      if (reduced) lift.setValue(1);
      else Animated.spring(lift, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 7 }).start();
    } else if (phase === "closing") {
      Animated.parallel([
        Animated.timing(veil, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(lift, { toValue: 0, duration: reduced ? 1 : 220, useNativeDriver: true }),
      ]).start(() => setPhase("gone"));
    }
  }, [phase, reduced, veil, lift]);

  // A new step: its words fade in, and the bot hops.
  const words = useRef(new Animated.Value(1)).current;
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    if (phase === "open" && !reduced) {
      words.setValue(0);
      Animated.timing(words, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      bot.cheer();
    }
  }, [step, phase, reduced, words, bot]);

  // Drawing.
  const painter = useRef<Painter | null>(null);
  const host = useRef<View>(null);
  const live = bots && phase !== "gone" && phase !== "wait" && cardW > 0;
  useEffect(() => {
    if (reduced === null || cardW <= 0) return;
    bot.settle(!!reduced);
    if (reduced) painter.current?.paint(bot);
  }, [reduced, cardW, bot, phase]);
  useTileLoop({
    frame: (dt) => { bot.step(dt); painter.current?.paint(bot); },
    still: () => painter.current?.paint(bot),
  }, live && reduced === false, host);

  if (phase === "wait" || phase === "gone") return null;

  const card = (
    <Animated.View
      ref={host}
      accessibilityLabel={props?.label}
      onLayout={overlay ? undefined : (e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== inlineW) setInlineW(w); }}
      style={{
        width: overlay ? cardW : undefined, alignSelf: overlay ? undefined : "stretch",
        borderRadius: 28, borderWidth: 1, borderColor: LINE, backgroundColor: PAPER, overflow: "hidden",
        opacity: lift,
        transform: reduced ? [] : [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }, { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        ...(overlay ? { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 } : {}),
      }}
    >
      <View style={{ height: stageH }} pointerEvents="none">
        {bots && cardW > 0 && <TileSurface ref={(r) => { painter.current = r; }} w={cardW - 2} h={stageH} />}
      </View>
      <Animated.View style={{ opacity: words, transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>
        {children}
      </Animated.View>
    </Animated.View>
  );

  if (!overlay) return card;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => { /* answered on the card */ }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: veil }}>
          <Blur />
        </Animated.View>
        {card}
      </View>
    </Modal>
  );
}

/** The screen behind, blurred, under a light white veil. */
function Blur(): React.ReactElement {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!WEB) return;
    // react-native-web: the view is a div; the blur is the browser's.
    const el = ref.current as unknown as { style?: Record<string, string> } | null;
    if (el?.style) {
      el.style.backdropFilter = "blur(10px) saturate(1.05)";
      el.style.webkitBackdropFilter = "blur(10px) saturate(1.05)";
    }
  }, []);
  if (WEB) return <View ref={ref} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.42)" }} />;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BlurView } = require("expo-blur") as typeof import("expo-blur");
  return (
    <View style={{ flex: 1 }}>
      <BlurView
        intensity={30}
        tint="light"
        // Android draws a real blur only with this method; without it, a translucent fill.
        experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.35)" }} />
    </View>
  );
}
