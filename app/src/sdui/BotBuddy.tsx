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
 *   { type: "BotBuddy", props: { kind, color, life, width?, height, size?, state, act?, thinkWhen?, lookTo?, label? } }
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { CompProps } from "./components";
import { evalCondition } from "./actions";
import { BotTile, kindOf, type BotKind, type BotMood, type BuddyAct } from "../botTiles/core";
import { TileSurface, useReducedMotion, useTileLoop, type Painter } from "../botTiles/TileSurface";

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

  // What he does: thinking while an answer comes, else the page's moment; his mood; where the ask field is.
  const thinking = props?.thinkWhen ? evalCondition(props.thinkWhen, ctx) : false;
  const act = (thinking ? "think" : props?.act || "play") as BuddyAct;
  const mood = (props?.state || "idle") as BotMood;
  bot.setLookTo(String(props?.lookTo ?? ""));
  if (bot.mood !== mood) bot.setMood(mood);
  useEffect(() => {
    if (bot.moment === act) return;
    const was = bot.moment;
    bot.setAct(act);
    // A new step: a little hop (not for thinking, which comes and goes with each answer).
    if (reduced === false && was !== "think" && act !== "think") bot.cheer();
  }, [bot, act, reduced]);

  // The stage, the pose under Reduce Motion, and a first frame painted before the screen shows.
  const painter = useRef<Painter | null>(null);
  const host = useRef<View>(null);
  useLayoutEffect(() => {
    if (W <= 0) return;
    bot.resize(W, H, H - 2);
    if (reduced !== null) bot.settle(!!reduced);
    painter.current?.paint(bot);
  }, [bot, W, H, reduced, act]);

  useTileLoop({
    frame: (dt) => { bot.step(dt); painter.current?.paint(bot); },
    still: () => painter.current?.paint(bot),
  }, reduced === false && W > 0, host);

  return (
    <View
      ref={host}
      pointerEvents="none"
      accessible={!!props?.label}
      accessibilityLabel={props?.label}
      onLayout={fixedW ? undefined : (e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== W) setW(w); }}
      style={stageStyle(fixedW, H)}
    >
      {W > 0 && <TileSurface ref={(r) => { painter.current = r; if (r && W > 0) r.paint(bot); }} w={W} h={H} />}
    </View>
  );
}
