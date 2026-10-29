/**
 * BotBuddy — a bot's own tiny bot on its pages (types.ts BotBuddyProps, component "BotBuddy" with BotsMotion).
 *
 * The same physics core as Home's tiles (src/botTiles/core.ts): his colour, his kind's play (Code juggles 0s and 1s,
 * Keybot hops keys…), on a small stage of his own that never covers words or controls (the server gives it its own
 * place: a page's header, the top of a Code bot setup step). His mood follows the bot (working: busier; needs: he
 * stops and faces the person); `act` is the moment the page asks for (wave, survey, read, settle; BuddyAct); while
 * `thinkWhen` holds (an answer is on its way) he thinks; `lookTo` is where the page's ask field is, and he glances at it.
 *
 * He is kept by `life` for the life of the app (like the cards' bots), so the next screen with the same life finds
 * him where he was: the Code bot's setup steps are one bot, carrying on from step to step, with a little hop when the
 * step changes. He has no fabric under him (a tile's cloth would read as a box on a page). The first frame is painted before the screen shows, so a new screen never flashes an empty stage.
 * Reduce Motion: a still pose. A fault in the drawing leaves the empty stage.
 *
 * CARRYING (act "carry", component "BotBuddyCarry"): the stage is a lane under a message on its way, and he hauls it as a
 * bag, trip after trip, heavier each trip (core.ts carrying). While `doneWhen` holds the answer is here: he sets the bag
 * down and walks off, and once he is gone the lane folds away (at once when he was off stage). A new ask (doneWhen false
 * again) starts a new haul. Reduce Motion: he stands still with the bag, and `label` is written beside him.
 *
 * LOOKS AND MOMENTS (BotMoments; the server's catalog, botTiles/looks.ts): `avatar` is his look (an id in the catalog, or
 * a spec of its own; none: the one his kind wears); `moment` a recipe he plays (`momentMode` "once", then back to his act,
 * or "loop"), `momentEndWhen` its end (deliver: a loop's `end` plays, then it is over). A moment this build cannot play
 * is the recipe's plain act instead. Reduce Motion: the moment's still pose.
 *
 *   { type: "BotBuddy", props: { kind, color, life, width?, height, size?, state, act?, thinkWhen?, doneWhen?, lookTo?, label?,
 *     avatar?, moment?, momentMode?, momentEndWhen? } }
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LayoutAnimation, Text, View } from "react-native";
import type { CompProps } from "./components";
import { evalCondition } from "./actions";
import { BotTile, kindOf, type BotKind, type BotMood, type BuddyAct } from "../botTiles/core";
import { TileSurface, useReducedMotion, useTileLoop, type Painter } from "../botTiles/TileSurface";
import { useLooks } from "../botTiles/looks";

/** The bots of the pages, by life, for the life of the app. */
const LIVES = new Map<string, BotTile>();

function lifeOf(life: string, kind: BotKind, color: string, size: number): BotTile {
  const key = `${life}|${kind}|${color}`;
  let b = LIVES.get(key);
  if (!b) {
    let seed = 17;
    for (let k = 0; k < life.length; k++) seed = (seed * 31 + life.charCodeAt(k)) >>> 0;
    b = new BotTile({ kind, color, mood: "idle", seed, size });
    // No cloth under him: on a page he stands among the words, not on a patch of fabric.
    b.cloth = 0;
    if (LIVES.size > 24) LIVES.clear();
    LIVES.set(key, b);
  }
  return b;
}

class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BotBuddy] stopped:", error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const stageStyle = (w: number, h: number) => (w > 0 ? { width: w, height: h, flexShrink: 0 } : { alignSelf: "stretch" as const, height: h });

export const BotBuddy = (p: CompProps): React.ReactElement => (
  <Guard fallback={<View style={stageStyle(Number(p.props?.width) || 0, Number(p.props?.height) || 48)} />}><Buddy {...p} /></Guard>
);

function Buddy({ props, ctx }: CompProps): React.ReactElement {
  const H = Number(props?.height) || 48;
  const fixedW = Number(props?.width) || 0;
  const [W, setW] = useState(fixedW);
  const reduced = useReducedMotion();
  const life = String(props?.life || props?.kind || "buddy");
  const kind = (props?.kind || kindOf(life)) as BotKind;
  const color = String(props?.color || "#0a0a0a");
  const size = Number(props?.size) || Math.round(H * 0.6);
  const bot = useMemo(() => lifeOf(life, kind, color, size), [life, kind, color, size]);
  // His look: the node's (an id or a spec), else his kind's; a new catalog re-skins him where he stands.
  const L = useLooks();
  bot.setAvatar(L.avatar(kind, props?.avatar));
  // A moment from the catalog, where the page asks for one; one this build cannot play is its plain act.
  const momentId = typeof props?.moment === "string" ? props.moment : "";
  const momentMode = props?.momentMode === "loop" ? "loop" : props?.momentMode === "once" ? "once" : undefined;
  const recipe = momentId ? L.moment(momentId) : null;
  const momentEnd = !!recipe && !!props?.momentEndWhen && evalCondition(props.momentEndWhen, ctx);

  // What he does: thinking while an answer comes, else the page's moment; his mood; where the ask field is.
  const thinking = props?.thinkWhen ? evalCondition(props.thinkWhen, ctx) : false;
  const act = (thinking ? "think" : momentId && !recipe && L.moments.has(momentId) ? L.fallback(momentId) : props?.act || "play") as BuddyAct;
  const carry = act === "carry";
  // Carrying: the answer is here.
  const done = carry && !!props?.doneWhen && evalCondition(props.doneWhen, ctx);
  const mood = (props?.state || "idle") as BotMood;
  bot.setLookTo(String(props?.lookTo ?? ""));
  if (bot.mood !== mood) bot.setMood(mood);
  // Carrying, the lane folds away once he has delivered and gone (at once when it came while he was off stage).
  const [gone, setGone] = useState(() => carry && done);
  const fold = useRef(false);
  fold.current = gone;
  const folds = () => {
    if (fold.current) return;
    fold.current = true;
    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch { /* no animation, still folds */ }
    setGone(true);
  };
  useEffect(() => {
    if (carry) {
      // A new ask, after a delivery: a new haul. Then, the answer here: he sets it down.
      if (!done && (bot.moment !== "carry" || bot.delivered)) { bot.setAct("carry"); setGone(false); }
      else if (bot.moment !== "carry") bot.setAct("carry");
      if (done) { bot.deliver(); if (bot.carryDone()) folds(); }
      // Reduce Motion: the pose with the bag (the stage was settled before the bag was his).
      if (reduced) { bot.settle(true); painter.current?.paint(bot); }
      return;
    }
    if (bot.moment === act) return;
    const was = bot.moment;
    bot.setAct(act);
    // A new step: a little hop (not for thinking, which comes and goes with each answer).
    if (reduced === false && was !== "think" && act !== "think") bot.cheer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot, act, done, reduced]);

  // The stage, the pose under Reduce Motion, and a first frame painted before the screen shows.
  const painter = useRef<Painter | null>(null);
  const host = useRef<View>(null);
  useLayoutEffect(() => {
    if (W <= 0) return;
    bot.resize(W, H, H - 2);
    if (reduced !== null) bot.settle(!!reduced);
    painter.current?.paint(bot);
  }, [bot, W, H, reduced, act]);

  // The moment: started once he is on his stage (again when it changes; a loop again after thinking stopped it);
  // thinking or carrying stops it. Its end when momentEndWhen holds.
  const started = useRef("");
  useEffect(() => {
    if (!bot.placed) return;
    const key = recipe ? `${recipe.id}|${momentMode ?? ""}` : "";
    if (!recipe || carry || thinking) {
      if (bot.mo) bot.stopMoment();
      if (!recipe) started.current = "";
      return;
    }
    const loops = momentMode ? momentMode === "loop" : recipe.loop;
    if (started.current === key && (bot.mo === recipe || (bot.momentDone() && !loops))) return;
    started.current = key;
    bot.playMoment(recipe, momentMode);
    if (reduced) { bot.settle(true); painter.current?.paint(bot); }
  }, [bot, recipe, momentMode, carry, thinking, reduced, W]);
  useEffect(() => { if (momentEnd) bot.deliverMoment(); }, [bot, momentEnd]);

  useTileLoop({
    frame: (dt) => { bot.step(dt); painter.current?.paint(bot); if (carry && !fold.current && bot.carryDone()) folds(); },
    still: () => painter.current?.paint(bot),
  }, reduced === false && W > 0 && !gone, host);

  // Reduce Motion, carrying: still, with the bag, and the words beside him.
  const words = carry && reduced && props?.label ? String(props.label) : "";
  return (
    <View
      ref={host}
      pointerEvents="none"
      accessible={!!props?.label}
      accessibilityLabel={props?.label}
      onLayout={fixedW ? undefined : (e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== W) setW(w); }}
      style={[stageStyle(fixedW, gone ? 0 : H), gone ? { overflow: "hidden" as const } : null]}
    >
      {W > 0 && !gone && <TileSurface ref={(r) => { painter.current = r; if (r && W > 0) r.paint(bot); }} w={W} h={H} />}
      {!!words && !gone && (
        <Text numberOfLines={1} style={{ position: "absolute", left: Math.round(W * 0.3 + size * 0.75), right: 0, top: 0, bottom: 0, textAlignVertical: "center", lineHeight: H, fontSize: 13, color: "#5c5c5c", fontFamily: "Tailzu Geist" }}>
          {words}
        </Text>
      )}
    </View>
  );
}
