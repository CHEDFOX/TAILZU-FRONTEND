/**
 * BotStage — a full tiny bot on a stage of his own, who can hold a thought (types.ts BotStageProps, component "BotStage";
 * section 3i). The person's own bot on Spaces, in a space's feed and under Home: he roams with the catalog's moments
 * (core.ts Roam), walks out at a side and back in (outWhen), hops (cheerWhen), thinks (thinkWhen) and listens (listenWhen:
 * still, eyes open, his head to his thought, his bubbles pulsing with the voice).
 *
 * HIS THOUGHT (`thought`) is a box joined to his head by three bubbles (core.ts thoughtTrail, drawn on his canvas: white,
 * an ink outline, faint rings for a shadow). At rest it is a small pill with `restText` that rides over him (core.ts
 * followStep); a tap on it writes `openPath` true. Its mode, in order: full (fullWhen), open (openPath), listening, rest
 * (stageCore.ts stageMode).
 *   - veil false (a space's composer): it opens inline. The stage grows by what the box grew (the feed above gets shorter),
 *     so the box stays inside the stage, where Android hands it touches, and never covers the newest message. The stage sits
 *     in the page's footer, which rises over the keyboard while a field in it has focus. Android's back closes it.
 *   - veil true (Spaces' top, Home): open and full are drawn over the whole window in a Modal: the screen behind blurred
 *     (white 35% and a blur, faded in), him drawn where he stood (the inline stage hides him meanwhile) and the box grown from
 *     the pill: a square over him, or (place "low") the stage moves down near the bottom and the box fills the space over
 *     him, or near the whole screen (full). A keyboard lifts it all. A tap on the veil, or back, closes it.
 *   Closing writes openPath false and runs on.onDismiss; from full the veil clears first and the box shrinks after. After a
 *   thought closes he stands a breath, then roams again.
 *
 * TAPS: only his body (a hit area that moves with him every frame) runs on.onPress, or the whole stage with hit "stage". With
 * on.onDoubleTap a single tap waits 260 ms for a second (stageCore.ts tapOn). Nothing in the box ever runs them.
 *
 * He is kept per `life` for the life of the app (a Map, with his roam, where his box was and how it followed him), so a
 * repaint or a quiet reload never restarts a walk or replays a grow. Reduce Motion: a still pose, no walk, no roam, the box
 * still over him, every change at once. A fault in the drawing takes him away and leaves the box working.
 *
 *   { type: "BotStage", props: { life, kind, color, avatar?, size, height, hit?, toys?, roam?, outWhen?, outSide?, cheerWhen?,
 *     thinkWhen?, listenWhen?, thought?, label }, on: { onPress?, onDoubleTap?, onDismiss? }, children: [the thought's content] }
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, LayoutAnimation, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CompProps } from "../components/props";
import { evalCondition } from "../actions";
import * as K from "../knobs";
import type { BotRoam, BotThoughtSpec, Condition } from "../types";
import { BotTile, INK, Roam, followStep, kindOf, thoughtTrail, trailRoom, type BotKind, type FollowState, type TileCtx, type TrailBubble } from "../../botTiles/core";
import { TileSurface, useReducedMotion, useTileLoop, type Drawable, type Painter } from "../../botTiles/TileSurface";
import { noteScenes, useLooks } from "../../botTiles/looks";
import { Blur } from "../components/blur";
import { DottedFrame } from "../components/dotted";
import { FooterField } from "../components/Screen";
import { voiceLevel } from "../voice/voiceBus";
import { ThoughtContext, type ThoughtControl } from "./thought";
import {
  STAGE, grownHeight, keyboardLift, listenRect, lowLayout, pillBottom, pillBounds, pillRect, restHeight, squareRect, fullRect, stageAct, stageMode, tapInStage, tapOn,
  walksLow,
  wideRect, type Rect, type StageMode, type Win,
} from "./stageCore";

/** The box's grow: a soft spring, a touch over (the prototype's curve). */
const GROW = Easing.bezier(0.3, 1.06, 0.45, 1);
const LINE = "#d4d4d4", PAPER = "#ffffff", REST_INK = "#8a8a8a";

/** His life, kept for the life of the app: the bot, his roam, the box's follow, his standing crown, what was last seen. */
interface Life {
  bot: BotTile;
  roam: Roam | null;
  follow: FollowState;
  /** His crown's height over his floor as he stands (measured once he is placed): the pill sits the trail's room over it. */
  crownH: number;
  mode: StageMode;
  cheer: boolean | null;
  out: boolean | null;
  /** The edge he walked out at: back in from the same one. */
  outAt: "left" | "right";
  /** After a thought closes he stands until then. */
  standUntil: number;
  /** The box's centre glides back over him after a thought (followStep's gliding). */
  glide: boolean;
}

const LIVES = new Map<string, Life>();

function lifeOf(life: string, kind: BotKind, color: string, size: number, toys: boolean): Life {
  const key = `${life}|${kind}|${color}|${size}`;
  let l = LIVES.get(key);
  if (!l) {
    let seed = 23;
    for (let k = 0; k < life.length; k++) seed = (seed * 31 + life.charCodeAt(k)) >>> 0;
    const bot = new BotTile({ kind, color, mood: "idle", seed, size, toys });
    // No cloth under him (he stands among the page's words). No moment sounds: he roams with a moment every few
    // seconds on pages people sit on (Home, a space's feed), where a sneeze or a clap each time would be noise.
    bot.cloth = 0;
    if (LIVES.size > 24) LIVES.clear();
    l = { bot, roam: null, follow: { x: NaN, v: 0, target: NaN }, crownH: 0, mode: "rest", cheer: null, out: null, outAt: "right", standUntil: 0, glide: false };
    LIVES.set(key, l);
  }
  return l;
}

/** The trail on his canvas: white bubbles, an ink outline, and two faint rings under each for its shadow. */
function drawTrail(ctx: TileCtx, bubbles: TrailBubble[]): void {
  for (const b of bubbles) {
    if (b.alpha <= 0.01 || b.r <= 0.2) continue;
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = 0.045 * b.alpha;
    ctx.beginPath(); ctx.arc(b.x, b.y + 2, b.r + 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.06 * b.alpha;
    ctx.beginPath(); ctx.arc(b.x, b.y + 1.2, b.r + 1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = b.alpha;
    ctx.fillStyle = PAPER;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = b.stroke;
    ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(0.1, b.r - b.stroke / 2), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** What one canvas shows: him (at an offset: the Modal draws him at his place on the window), and his trail. */
class Scene implements Drawable {
  bot: BotTile | null = null;
  showBot = true;
  ox = 0;
  oy = 0;
  bubbles: TrailBubble[] = [];
  draw(ctx: TileCtx): void {
    if (this.bot && this.showBot) {
      ctx.save();
      ctx.translate(this.ox, this.oy);
      this.bot.draw(ctx);
      ctx.restore();
    }
    drawTrail(ctx, this.bubbles);
  }
}

/** A box's rect as four values that animate (left / top / width / height), and the numbers they are at. */
function useBoxAnim() {
  const v = useMemo(() => ({ x: new Animated.Value(0), y: new Animated.Value(0), w: new Animated.Value(0), h: new Animated.Value(0) }), []);
  const cur = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const moving = useRef(0);
  useEffect(() => {
    const ids = (["x", "y", "w", "h"] as const).map((k) => [k, v[k].addListener(({ value }) => { cur.current = { ...cur.current, [k]: value }; })] as const);
    return () => { for (const [k, id] of ids) v[k].removeListener(id); };
  }, [v]);
  // Only what moved is set (the pill follows him every frame; each value set is a native update).
  const set = useCallback((r: Rect) => {
    const c = cur.current;
    for (const k of ["x", "y", "w", "h"] as const) if (Math.abs(c[k] - r[k]) > 0.01) v[k].setValue(r[k]);
    cur.current = { ...r };
  }, [v]);
  const go = useCallback((to: Rect, ms: number, done?: () => void) => {
    const token = ++moving.current;
    if (ms <= 0) {
      for (const k of ["x", "y", "w", "h"] as const) v[k].stopAnimation();
      set(to);
      moving.current = 0;
      done?.();
      return;
    }
    Animated.parallel((["x", "y", "w", "h"] as const).map((k) => Animated.timing(v[k], { toValue: to[k], duration: ms, easing: GROW, useNativeDriver: false })))
      .start(({ finished }) => {
        if (token !== moving.current) return;
        moving.current = 0;
        if (finished) { cur.current = { ...to }; done?.(); }
      });
  }, [v, set]);
  return { v, cur, go, set, moving: () => moving.current !== 0 };
}

class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BotStage] stopped:", error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export const BotStage = (p: CompProps): React.ReactElement => (
  <Guard fallback={<Stage {...p} bots={false} />}><Stage {...p} bots /></Guard>
);

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const cond = (c: Condition | undefined, ctx: CompProps["ctx"]): boolean => (c ? evalCondition(c, ctx) : false);

function Stage({ node, props, ctx, store, children, fire, bots }: CompProps & { bots: boolean }): React.ReactElement {
  const reduced = useReducedMotion();
  // Reduce Motion: a still pose, every change at once. (Not yet known: no loop, no pose either.)
  const still = reduced === true;
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const W0: Win = { w: win.width, h: win.height, top: insets.top, bottom: insets.bottom };

  // ---- what the server asked for
  const lifeKey = String(props?.life || "stage");
  const kind = (props?.kind || kindOf(lifeKey)) as BotKind;
  const color = String(props?.color || INK);
  const size = Math.max(12, Number(props?.size) || 26);
  const toys = props?.toys !== false;
  const th: BotThoughtSpec | null = props?.thought && typeof props.thought === "object" && typeof props.thought.openPath === "string" ? (props.thought as BotThoughtSpec) : null;
  const restText = th && typeof th.restText === "string" ? th.restText : "";
  const veil = !!th?.veil;
  const low = th?.place === "low";
  const home = th?.style === "home";
  const hitStage = props?.hit === "stage";
  const hasDouble = !!node.on?.onDoubleTap;
  const outSide: "left" | "right" | null = props?.outSide === "left" || props?.outSide === "right" ? props.outSide : null;
  const roamSpec: BotRoam | null = props?.roam && typeof props.roam === "object" && Array.isArray(props.roam.moments) ? (props.roam as BotRoam) : null;

  const L = useLooks();
  const life = useMemo(() => lifeOf(lifeKey, kind, color, size, toys), [lifeKey, kind, color, size, toys]);
  const bot = life.bot;
  bot.setAvatar(L.avatar(kind, props?.avatar));

  // ---- the mode
  const open = !!(th && store.get(th.openPath));
  const full = !!th && cond(th.fullWhen, ctx);
  const listening = cond(props?.listenWhen, ctx);
  const thinking = cond(props?.thinkWhen, ctx);
  const out = cond(props?.outWhen, ctx);
  const cheering = cond(props?.cheerWhen, ctx);
  const mode = stageMode({ thought: !!th, full, open, listen: listening });
  const layered = veil && (mode === "open" || mode === "full");
  const inlineBox = !!th && !layered && (mode === "listen" || mode === "open");

  // ---- the stage's size
  const [W, setW] = useState(0);
  const restH = restHeight(Number(props?.height) || 0, size, !!restText);
  const [contentH, setContentH] = useState(0);
  const boxTarget = useRef<Rect | null>(null);
  const [inlineBoxH, setInlineBoxH] = useState(0);
  const stageH = inlineBox ? grownHeight(restH, inlineBoxH) : restH;
  const floor = stageH - STAGE.floorPad;
  if (!life.crownH) life.crownH = Math.round(size * 1.15);
  const bottomOff = STAGE.floorPad + life.crownH + trailRoom(1);
  const pillBot = pillBottom(floor, life.crownH);

  // The pill's width: its words measured once, the padding round them, never past the most.
  const [textW, setTextW] = useState(0);
  const pillW = Math.min(K.num("ui.BotStage.pillMax", 260), Math.ceil(textW) + 2 * STAGE.pillPad + 2, Math.max(0, W - 2 * STAGE.gutter));

  // ---- placing him
  useEffect(() => {
    if (W <= 0) return;
    const first = !bot.placed;
    bot.resize(W, stageH, floor);
    if (first || !life.crownH) life.crownH = Math.max(1, Math.round(floor - bot.crown().y));
    if (roamSpec) {
      if (!life.roam) life.roam = new Roam(bot, L, roamSpec, W, (bot.seed ^ 0x9e37) >>> 0);
      life.roam.spec = roamSpec;
      life.roam.looks = L;
      life.roam.w = W;
    } else life.roam = null;
    if (reduced !== null) bot.settle(still);
    paintAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, stageH, reduced, L]);

  // Out at a side while outWhen holds; back in when it stops. A screen first drawn with him gone has him gone at once.
  useEffect(() => {
    if (W <= 0) return;
    const was = life.out;
    life.out = out;
    if (out && was !== true) {
      // No side named: the nearer edge, as the prototype walks him off (a wide stage would be a long stroll the other way).
      life.outAt = outSide ?? (bot.placed && bot.x[2]! < W * 0.5 ? "left" : "right");
      if (was === null || still) bot.exit(life.outAt, { now: true }); else bot.exit(life.outAt);
    } else if (!out && was === true) {
      if (still) { bot.stopWalk(); bot.standAt(W * 0.5); } else bot.enter(life.outAt, W * 0.5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, W, still]);

  // A hop each time cheerWhen turns true (the first draw counts: there is news).
  useEffect(() => {
    if (W <= 0) return;
    const was = life.cheer;
    life.cheer = cheering;
    if (cheering && was !== true && !still) bot.cheer();
  }, [cheering, W, still, bot, life]);

  // What he does (stageAct): thinking, listening, standing (a thought open, a breath after it closes), or his own play.
  const [standTick, setStandTick] = useState(0);
  useEffect(() => {
    const standing = mode === "open" || mode === "full" || life.standUntil > nowMs();
    const act = stageAct({ thought: !!th, listening, thinking, standing });
    if (bot.moment !== act) bot.setAct(act);
    if (act !== "listen") { bot.setLevel(0); if (bot.focusX === bot.focusX) bot.lookAway(); }
    life.roam?.pause(act !== "play" || mode !== "rest");
    if (life.standUntil > nowMs()) {
      const t = setTimeout(() => setStandTick((n) => n + 1), life.standUntil - nowMs() + 20);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mode, listening, thinking, standTick, bot, life, th]);

  // ---- the box: the inline one (the pill, listening, open without a veil), and the veiled one (in the Modal)
  const box = useBoxAnim();
  const layer = useBoxAnim();
  const [shown, setShown] = useState<"none" | "in" | "out">("none");
  const veilA = useRef(new Animated.Value(0)).current;
  const stageY = useRef(new Animated.Value(0)).current;
  const stageYNow = useRef(0);
  useEffect(() => { const id = stageY.addListener(({ value }) => { stageYNow.current = value; }); return () => stageY.removeListener(id); }, [stageY]);
  const stageWin = useRef<{ x: number; y: number } | null>(null);
  const host = useRef<View>(null);
  const [kbTop, setKbTop] = useState<number | null>(null);
  // Whether a keyboard is up right now (the box's field or any other): read when a close starts, so the box waits for it.
  const kbUp = useRef(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => { kbUp.current = true; });
    const hide = Keyboard.addListener("keyboardDidHide", () => { kbUp.current = false; });
    return () => { show.remove(); hide.remove(); };
  }, []);
  /**
   * CLOSING IN TWO STEPS. The keyboard and the box going at once fought each other: the box shrank toward a spot the
   * keyboard was still moving, and it jumped at the end. So the keyboard goes first, and the box settles only once it has
   * gone (or after a short wait, if the system never says so).
   */
  const afterKeyboard = useCallback((run: () => void) => {
    if (still || !kbUp.current) { run(); return; }
    let done = false;
    const go = () => { if (done) return; done = true; sub.remove(); clearTimeout(timer); kbUp.current = false; run(); };
    const sub = Keyboard.addListener("keyboardDidHide", go);
    const timer = setTimeout(go, K.num("ui.BotStage.keyboardWaitMs", 450));
    Keyboard.dismiss();
  }, [still]);

  /** The pill's rect now (stage px), riding over him. */
  const restRect = useCallback((): Rect => {
    const cx = life.follow.x === life.follow.x ? life.follow.x : bot.placed ? bot.x[2]! : W / 2;
    return pillRect(cx, pillW, pillBot, W);
  }, [life, bot, pillW, pillBot, W]);

  /** The inline box's rect for a mode (stage px), its bottom where the pill's is. */
  const inlineRect = useCallback((m: StageMode, ch: number): Rect => {
    const p = restRect();
    if (m === "listen") return listenRect(p, W, ch, K.num("ui.BotStage.pillMax", 260));
    if (m === "open") return wideRect(W, pillBot, ch, W0.h);
    return p;
  }, [restRect, W, pillBot, W0.h]);

  /** The veiled box's rect for a mode (window px), with the stage where it is drawn in the Modal. */
  const layerLayout = useCallback((m: StageMode): { box: Rect; stageY: number } => {
    const sw = stageWin.current ?? { x: 0, y: W0.h - W0.bottom - stageH };
    const crown = bot.placed ? bot.crown() : { x: W / 2, y: floor - life.crownH };
    if (m === "full") {
      const lift = keyboardLift(sw.y + stageH, kbTop);
      return { box: fullRect(W0, { x: sw.x + crown.x, y: sw.y - lift + crown.y }), stageY: sw.y - lift };
    }
    if (low) {
      const l = lowLayout(W0, stageH, { x: crown.x, y: floor - life.crownH }, sw.x, kbTop ?? undefined);
      return { box: l.box, stageY: l.stageY };
    }
    const lift = keyboardLift(sw.y + stageH, kbTop);
    return { box: squareRect(W0, { x: sw.x + crown.x, y: sw.y - lift + floor - life.crownH }), stageY: sw.y - lift };
  }, [W0, W, stageH, floor, life, bot, low, kbTop]);

  /** The pill's rect on the window (where the veiled box grows from and shrinks back to). */
  const restOnWindow = useCallback((): Rect => {
    const sw = stageWin.current ?? { x: 0, y: 0 };
    const r = restText ? restRect() : (() => { const c = bot.placed ? bot.crown() : { x: W / 2, y: floor - life.crownH }; return { x: c.x - 20, y: c.y - 60, w: 40, h: 40 }; })();
    return { x: r.x + sw.x, y: r.y + sw.y, w: r.w, h: r.h };
  }, [restText, restRect, bot, W, floor, life]);

  // The mode changes: the box grows, shrinks or moves (from where it is: a repaint never replays it).
  const firstMode = useRef(true);
  useEffect(() => {
    if (W <= 0 || !th) return;
    const was = life.mode;
    const first = firstMode.current;
    firstMode.current = false;
    life.mode = mode;
    const ms = still ? 0 : mode === "full" ? STAGE.fullMs : STAGE.openMs;
    if (layered) {
      const openLayer = () => {
        // (Read from the ref: a measure answers after the render that asked for it.)
        const fresh = shownRef.current === "none";
        if (fresh) layer.set(restOnWindow());
        const t = layerLayout(mode);
        if (fresh) stageY.setValue(stageWin.current?.y ?? t.stageY);
        shownRef.current = "in";
        setShown("in");
        Animated.timing(veilA, { toValue: 1, duration: still ? 0 : STAGE.veilMs, useNativeDriver: true }).start();
        layer.go(t.box, first && !fresh ? 0 : ms);
        Animated.timing(stageY, { toValue: t.stageY, duration: still ? 0 : ms, easing: GROW, useNativeDriver: false }).start();
        // place "low": he walks to the middle of his stage while it moves down (walksLow: never while he is out)
        if (walksLow({ low, still, placed: bot.placed, out: life.out })) {
          const sw = stageWin.current?.x ?? 0;
          bot.walkTo(Math.min(W - size, Math.max(size, W0.w / 2 - sw)), { free: true });
        }
      };
      if (!stageWin.current || shownRef.current === "none") {
        const v = host.current as unknown as { measureInWindow?: (cb: (x: number, y: number) => void) => void } | null;
        if (v?.measureInWindow) v.measureInWindow((x, y) => { stageWin.current = { x, y }; openLayer(); });
        else openLayer();
      } else openLayer();
      return;
    }
    // Leaving the veiled box: the veil clears (first, from full) and the box shrinks back to the pill, then the Modal goes.
    if (shownRef.current === "in") {
      const fromFull = was === "full";
      shownRef.current = "out";
      setShown("out");
      const shrink = () => {
        layer.go(restOnWindow(), still ? 0 : STAGE.openMs, () => { if (shownRef.current === "out") { shownRef.current = "none"; setShown("none"); } });
        Animated.timing(stageY, { toValue: stageWin.current?.y ?? 0, duration: still ? 0 : STAGE.openMs, easing: GROW, useNativeDriver: false }).start();
      };
      // the keyboard first; then the veil clears and the box settles back to the pill
      afterKeyboard(() => {
        Animated.timing(veilA, { toValue: 0, duration: still ? 0 : STAGE.veilMs, useNativeDriver: true }).start();
        if (fromFull && !still) setTimeout(shrink, STAGE.unfullMs); else shrink();
      });
      life.standUntil = nowMs() + STAGE.standMs;
      life.glide = true;
      setStandTick((n) => n + 1);
      return;
    }
    // Inline: from the pill to the box and back.
    if (mode === "rest") {
      if (was !== "rest") {
        life.standUntil = nowMs() + STAGE.standMs;
        life.glide = true;
        setStandTick((n) => n + 1);
        if (!first) {
          // the keyboard first; then the box shrinks back to where the pill will be, and rides over him again
          afterKeyboard(() => {
            const to = restRect();
            box.go({ x: to.x, y: 0, w: to.w, h: STAGE.pillH }, ms);
            LayoutAnimation.configureNext(LayoutAnimation.create(ms || 1, "easeInEaseOut", "scaleY"));
          });
        }
      }
      return;
    }
    const r = inlineRect(mode, contentH);
    boxTarget.current = r;
    if (was === "rest" || first) { const p = restRect(); box.set({ x: p.x, y: 0, w: p.w, h: STAGE.pillH }); }
    box.go({ x: r.x, y: 0, w: r.w, h: r.h }, first ? 0 : ms);
    if (!still && !first) LayoutAnimation.configureNext(LayoutAnimation.create(ms, "easeInEaseOut", "scaleY"));
    setInlineBoxH(r.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, W, layered]);

  // The content's height changes (typing a long line, a list opening, the words heard): the box follows it.
  useEffect(() => {
    if (!inlineBox || W <= 0) return;
    const r = inlineRect(mode, contentH);
    const t = boxTarget.current;
    if (t && Math.abs(t.h - r.h) < 1 && Math.abs(t.w - r.w) < 1 && Math.abs(t.x - r.x) < 1) return;
    boxTarget.current = r;
    const ms = still ? 0 : 220;
    box.go({ x: r.x, y: 0, w: r.w, h: r.h }, ms);
    if (!still) LayoutAnimation.configureNext(LayoutAnimation.create(ms, "easeInEaseOut", "scaleY"));
    setInlineBoxH(r.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentH, inlineBox]);

  // A keyboard over the veiled box: it and he rise over it.
  useEffect(() => {
    if (!layered) return;
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => setKbTop(e?.endCoordinates?.screenY ?? null));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKbTop(null));
    return () => { show.remove(); hide.remove(); };
  }, [layered]);
  useEffect(() => {
    if (!layered || shown !== "in") return;
    const t = layerLayout(mode);
    layer.go(t.box, still ? 0 : 250);
    Animated.timing(stageY, { toValue: t.stageY, duration: still ? 0 : 250, easing: GROW, useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbTop]);

  // ---- closing, as the person does it (the veil, back, a field left empty)
  const dismiss = useCallback(() => {
    if (!th || !store.get(th.openPath)) return;
    store.set(th.openPath, false);
    fire("onDismiss");
  }, [th, store, fire]);
  const control = useMemo<ThoughtControl>(() => ({ close: dismiss }), [dismiss]);
  useEffect(() => {
    if (!inlineBox || mode !== "open") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { dismiss(); return true; });
    return () => sub.remove();
  }, [inlineBox, mode, dismiss]);

  // ---- taps on him
  /** Where placeHit last put his hit area, in the stage's own pixels (an Animated value cannot be read back). */
  const hitAt = useRef({ x: 0, y: 0 });
  /**
   * A tap that lands inside a live scene's box, on a scene that wants taps (looks format 2), goes to the scene
   * instead of the stage's own press: the pond rings where it was touched. Everything else presses as before, and
   * BotTiles never does this, because a tile's tap opens the bot's page.
   */
  const cueScene = useCallback((e: GestureResponderEvent | undefined, onHim = false): boolean => {
    const n = e?.nativeEvent;
    if (!n || typeof n.locationX !== "number") return false;
    // locationX/Y are the TOUCHED view's own (stageCore.ts tapInStage): his hit area is its own view, translated
    // onto his body, so its corner is added back. The scene's box is in the surface's pixels, and that is the stage.
    const at = tapInStage(n.locationX, n.locationY, onHim ? hitAt.current : null);
    try { return bot.cue("tap", at.x, at.y); } catch { return false; }
  }, [bot]);
  const pending = useRef<number | null>(null);
  const waitT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (waitT.current) clearTimeout(waitT.current); }, []);
  const tapHim = useCallback((e?: GestureResponderEvent) => {
    if (cueScene(e, true)) return;
    const ms = K.num("ui.BotStage.doubleTapMs", 260);
    const r = tapOn(pending.current, nowMs(), hasDouble, ms);
    pending.current = r.pending;
    if (r.run === "press") fire("onPress");
    else if (r.run === "double") {
      if (waitT.current) { clearTimeout(waitT.current); waitT.current = null; }
      fire("onDoubleTap");
    } else {
      if (waitT.current) clearTimeout(waitT.current);
      waitT.current = setTimeout(() => { waitT.current = null; pending.current = null; fire("onPress"); }, ms);
    }
  }, [hasDouble, fire, cueScene]);
  const tapStage = useCallback((e?: GestureResponderEvent) => { if (!cueScene(e)) fire("onPress"); }, [fire, cueScene]);
  const openBox = useCallback(() => { if (th) store.set(th.openPath, true); }, [th, store]);

  // ---- drawing: every frame he steps, the pill follows him, the hit area rides on him, the trail is drawn
  const inlineScene = useMemo(() => new Scene(), []);
  const layerScene = useMemo(() => new Scene(), []);
  const painter = useRef<Painter | null>(null);
  const layerPainter = useRef<Painter | null>(null);
  const hit = useRef(new Animated.ValueXY({ x: -999, y: -999 })).current;
  const t0 = useRef(nowMs());
  const hw = Math.round(size * 1.5), hh = Math.min(Math.round(size * 1.9), Math.round(life.crownH + 6));
  const hitOn = useRef(new Animated.Value(1)).current;
  /** His hit area over his body: kept inside the stage, and gone (scaled to nothing) while he is out past an edge. */
  const placeHit = () => {
    const x = Math.max(0, Math.min(W - hw, bot.x[2]! - hw / 2));
    const y = Math.max(0, Math.min(stageHRef.current - hh, bot.crown().y));
    hit.setValue({ x, y });
    hitAt.current.x = x;
    hitAt.current.y = y;
    const gone = bot.isOut || bot.x[2]! < 0 || bot.x[2]! > W;
    hitOn.setValue(gone ? 0 : 1);
  };

  const paintAll = () => {
    const S = inlineScene, Ls = layerScene;
    const layerOn = shownRef.current !== "none";
    S.bot = bots ? bot : null;
    S.showBot = !layerOn && !(still && bot.isOut);
    S.bubbles = [];
    const t = still ? 0 : (nowMs() - t0.current) / 1000;
    const level = listeningRef.current ? voiceLevel(store) : -1;
    const crown = bot.placed ? bot.crown() : null;
    if (crown && th && !layerOn) {
      const m = modeRef.current;
      // (At rest, once the pill's words are measured: no trail to a pill not yet drawn.)
      const r = m === "rest" ? (restTextRef.current && !bot.isOut && pillWRef.current > 2 * STAGE.pillPad + 2 ? restRect() : null) : (() => { const c = box.cur.current; return { x: c.x, y: stageHRef.current - bottomOffRef.current - c.h, w: c.w, h: c.h }; })();
      if (r && r.w > 0) S.bubbles = thoughtTrail(crown, r, t, level);
    }
    painter.current?.paint(S);
    if (layerOn) {
      const sw = stageWin.current ?? { x: 0, y: 0 };
      Ls.bot = bots ? bot : null;
      Ls.showBot = true;
      Ls.ox = sw.x;
      Ls.oy = stageYNow.current;
      const c = layer.cur.current;
      Ls.bubbles = crown && c.w > 0 ? thoughtTrail({ x: crown.x + sw.x, y: crown.y + stageYNow.current }, c, t, level) : [];
      layerPainter.current?.paint(Ls);
    }
  };
  /** At rest the box is the pill, over him (unless a change of mode is moving it). */
  const syncPill = () => {
    if (modeRef.current !== "rest" || W <= 0 || box.moving()) return;
    const r = restRect();
    box.set({ x: r.x, y: 0, w: r.w, h: STAGE.pillH });
  };
  /** A frame with nothing moving: the pill, his hit area, the canvas. */
  const stillFrame = () => {
    if (bot.placed) {
      syncPill();
      placeHit();
    }
    paintAll();
  };
  // What the frame reads, kept fresh without re-making the loop.
  // (The effects set it with the state, so a measure that answers late reads where the Modal is.)
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const modeRef = useRef(mode); modeRef.current = mode;
  const listeningRef = useRef(listening); listeningRef.current = listening;
  const restTextRef = useRef(restText); restTextRef.current = restText;
  const stageHRef = useRef(stageH); stageHRef.current = stageH;
  const bottomOffRef = useRef(bottomOff); bottomOffRef.current = bottomOff;
  const pillWRef = useRef(pillW); pillWRef.current = pillW;

  useTileLoop({
    frame: (dt) => {
      if (!bot.placed) return;
      bot.step(dt);
      life.roam?.step(dt);
      const m = modeRef.current;
      const headX = bot.x[2]!;
      // the pill follows him at rest (gliding back over him after a thought)
      if (m === "rest" && W > 0 && !box.moving()) {
        life.follow = followStep(life.follow, headX, dt, pillBounds(W, pillWRef.current), life.glide);
        if (life.glide && Math.abs(life.follow.x - life.follow.target) < 1.5 && Math.abs(life.follow.v) < 20) life.glide = false;
      }
      syncPill();
      // listening: his head to the box, his light with the voice
      if (listeningRef.current && th) {
        if (shownRef.current === "none") {
          const c = box.cur.current;
          bot.lookAt(c.x + c.w / 2, stageHRef.current - bottomOffRef.current - c.h / 2);
        } else {
          // over the window: the box's middle, in his stage's own px
          const c = layer.cur.current, sw = stageWin.current ?? { x: 0, y: 0 };
          bot.lookAt(c.x + c.w / 2 - sw.x, c.y + c.h / 2 - stageYNow.current);
        }
        bot.setLevel(voiceLevel(store));
      } else if (bot.scenesLive()) {
        // A live scene may read his voice (`level`, `talk`), so it is fed while one is playing too.
        bot.setLevel(voiceLevel(store));
      }
      if (bot.sceneBad.length || bot.sceneSlow.length) noteScenes(bot.sceneBad, bot.sceneSlow);
      placeHit();
      paintAll();
    },
    still: () => stillFrame(),
  }, bots && reduced === false && W > 0, host);
  // Still (Reduce Motion, or no drawing): the pill, his hit area and the canvas again whenever something changes.
  useEffect(() => { if (reduced !== false || !bots) stillFrame(); });

  // ---- the box's look: the frame (its border and soft shadow) outside, what is in it clipped to its corners inside (a view
  // that clips hides its own shadow on iOS)
  const radiusOf = (m: "rest" | "box") => (home ? 18 : m === "rest" ? 20 : 18);
  const look = (m: "rest" | "box") => ({
    backgroundColor: PAPER,
    borderRadius: radiusOf(m),
    ...(home ? {} : { borderWidth: 1, borderColor: LINE, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 3 }),
  });
  const clip = (m: "rest" | "box") => ({ flex: 1, borderRadius: radiusOf(m) - (home ? 0 : 1), overflow: "hidden" as const });
  const dotted = home ? <DottedFrame radius={18} width={2} color={INK} /> : null;
  const pillWords = (
    <Text numberOfLines={1} style={{ fontSize: STAGE.pillFont, lineHeight: 18, color: REST_INK, fontFamily: "Tailzu Geist", fontWeight: "normal" }}>{restText}</Text>
  );
  // Inline, a field in the box is the footer's (it lifts the footer over the keyboard); in the Modal it is nobody's.
  const thought = <ThoughtContext.Provider value={control}>{children}</ThoughtContext.Provider>;

  const label = typeof props?.label === "string" ? props.label : "";
  const restBox = !!th && !!restText && !layered && shown === "none" && !(still && bot.isOut) && W > 0 && textW > 0;
  const contentW = mode === "listen" ? Math.min(K.num("ui.BotStage.pillMax", 260), W - 2 * STAGE.gutter) : W - 2 * STAGE.gutter;

  return (
    <View
      ref={host}
      onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== W) setW(w); }}
      style={{ alignSelf: "stretch", height: stageH }}
    >
      {/* The pill's words, measured once, never drawn. */}
      {!!restText && <Text onLayout={(e) => { const w = e.nativeEvent.layout.width; if (Math.abs(w - textW) > 0.5) setTextW(w); }} style={{ position: "absolute", opacity: 0, fontSize: STAGE.pillFont, fontFamily: "Tailzu Geist", left: -9999 }} numberOfLines={1}>{restText}</Text>}
      {bots && W > 0 && <TileSurface ref={(r) => { painter.current = r; }} w={W} h={stageH} style={{ position: "absolute", left: 0, bottom: 0 }} />}
      {hitStage && (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={tapStage} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      )}
      {(restBox || (inlineBox && shown === "none")) && (
        <Animated.View
          style={[look(inlineBox ? "box" : "rest"), { position: "absolute", left: box.v.x, width: box.v.w, height: box.v.h, bottom: bottomOff }]}
        >
          <View style={clip(inlineBox ? "box" : "rest")}>
            {inlineBox ? (
              <View style={{ position: "absolute", left: 0, bottom: 0, width: contentW }}>
                <ScrollView
                  style={{ maxHeight: Math.round(W0.h * STAGE.wideMaxFrac) }}
                  keyboardShouldPersistTaps="handled"
                  onContentSizeChange={(_w, h) => { if (Math.abs(h - contentH) > 0.5) setContentH(h); }}
                >
                  {thought}
                </ScrollView>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={restText} onPress={openBox} style={{ flex: 1, justifyContent: "center", paddingHorizontal: STAGE.pillPad }}>
                {pillWords}
              </Pressable>
            )}
          </View>
          {dotted}
        </Animated.View>
      )}
      {/* His hit area: on his body, wherever he walks. */}
      <Animated.View style={{ position: "absolute", left: 0, top: 0, width: hw, height: hh, transform: [...hit.getTranslateTransform(), { scale: hitOn }] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={tapHim} style={{ flex: 1 }} />
      </Animated.View>
      {shown !== "none" && th && (
        <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
          <View style={{ flex: 1 }}>
            <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: veilA }}>
              <Blur />
              <Pressable accessibilityRole="button" accessibilityLabel={K.txt("ui.BotStage.closeLabel", "Close")} onPress={dismiss} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
            </Animated.View>
            {bots && <TileSurface ref={(r) => { layerPainter.current = r; }} w={W0.w} h={W0.h} style={{ position: "absolute", left: 0, top: 0 }} />}
            <Animated.View style={[look("box"), { position: "absolute", left: layer.v.x, top: layer.v.y, width: layer.v.w, height: layer.v.h }]}>
              <View style={clip("box")}>
                <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                  <FooterField.Provider value={null}>{thought}</FooterField.Provider>
                </ScrollView>
              </View>
              {dotted}
            </Animated.View>
            <Animated.View style={{ position: "absolute", left: 0, top: 0, width: hw, height: hh, transform: [{ translateX: Animated.add(hit.x, stageWin.current?.x ?? 0) }, { translateY: Animated.add(hit.y, stageY) }] }}>
              <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={tapHim} style={{ flex: 1 }} />
            </Animated.View>
          </View>
        </Modal>
      )}
    </View>
  );
}
