/**
 * PersonBot — a person, as their own tiny bot (types.ts PersonBotProps, component "PersonBot"; section 3j). Wherever Spaces shows
 * a person (a space's people, an invitation, a request to join, the spaces list, Work in space, the "@" list), never their
 * initials: a full tiny bot standing in a size x size box, his feet on its floor, drawn by the bots' engine (botTiles/core.ts)
 * with the avatar the server gave him from the catalog (botTiles/looks.ts) and the person's colour. No cloth, no toys.
 *
 * He idles (personBotCore.ts PersonIdle): looks about, sways a little, blinks, and rarely makes a small gesture from the catalog,
 * each on his own seed (the person's id, and a second of the same person on screen another), so a list never moves in step and
 * two never gesture at once. Every PersonBot shares ONE animation frame loop (personBotCore.ts SharedLoop): only the ones on
 * screen step (each measured twice a second), and nothing runs in the background. Reduce Motion, or `live` false: his standing
 * pose, still. A fault in the drawing leaves a plain circle in his colour (what a build without PersonBot is sent).
 *
 *   { type: "PersonBot", props: { seed, avatar, color, size?, live?, label? } }
 *
 * PersonBotView is the same bot for a component that draws people from data (MentionField's "@" list).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AppState, Dimensions, View, type StyleProp, type ViewStyle } from "react-native";
import type { CompProps } from "../components/props";
import * as K from "../knobs";
import type { Moment, TileCtx } from "../../botTiles/core";
import { TileSurface, useReducedMotion, type Drawable, type Painter } from "../../botTiles/TileSurface";
import { useLooks } from "../../botTiles/looks";
import {
  GestureGate, PERSON, PersonIdle, SharedLoop, freeSalt, idleOptions, personTile, readPersonBot, seedOf, stageOf, type LoopMember,
  type PersonBotSpec,
} from "./personBotCore";

// ------------------------------------------------------------------ the one loop, for every PersonBot

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const LOOP = new SharedLoop({ raf: (cb) => requestAnimationFrame(cb), caf: (h) => cancelAnimationFrame(h as number), now });
LOOP.onDrop = (_m, e) => {
  // eslint-disable-next-line no-console
  console.warn("[Tailzu][PersonBot] frame failed:", e);
};
/** The screen's say on gestures: never two bots within the gap. */
const GATE = new GestureGate(PERSON.gap);
/** Each member's view, measured for "on screen". */
const HOSTS = new Map<LoopMember, React.RefObject<View | null>>();
let poll: ReturnType<typeof setInterval> | null = null;
let appSub = false;

/** On screen: some of the box inside the window. Not laid out (no size) is not on screen. */
function measure(m: LoopMember, host: React.RefObject<View | null>): void {
  const v = host.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
  if (!v?.measureInWindow) return;
  v.measureInWindow((x, y, w, h) => {
    const win = Dimensions.get("window");
    LOOP.setSeen(m, w > 0 && h > 0 && y + h > 0 && y < win.height && x + w > 0 && x < win.width);
  });
}

function join(m: LoopMember, host: React.RefObject<View | null>): () => void {
  // Read when a bot joins, not at import: the bootstrap's knobs come after this module loads.
  LOOP.fps = K.num("ui.PersonBot.fps", 30);
  GATE.gap = K.num("ui.PersonBot.gapS", 2.5);
  if (!appSub) {
    appSub = true;
    AppState.addEventListener("change", (s) => LOOP.setActive(s === "active"));
  }
  LOOP.setActive(AppState.currentState === "active" || AppState.currentState == null);
  HOSTS.set(m, host);
  LOOP.add(m);
  measure(m, host);
  if (!poll) poll = setInterval(() => HOSTS.forEach((h, k) => measure(k, h)), K.num("ui.PersonBot.seenMs", 500));
  return () => {
    HOSTS.delete(m);
    LOOP.remove(m);
    if (!HOSTS.size && poll) { clearInterval(poll); poll = null; }
  };
}

// ------------------------------------------------------------------ the same person twice on one screen

/** The salts of each person's bots mounted now (personBotCore.ts seedOf). */
const SALTS = new Map<string, Set<number>>();

function claim(seed: string): number {
  const used = SALTS.get(seed) ?? new Set<number>();
  const s = freeSalt(used);
  used.add(s);
  SALTS.set(seed, used);
  return s;
}

function release(seed: string, salt: number): void {
  const used = SALTS.get(seed);
  used?.delete(salt);
  if (used && !used.size) SALTS.delete(seed);
}

/** This bot's salt: the lowest free one for his person while he is mounted (again if the node is handed another person). */
function useSalt(seed: string): number {
  const mine = useRef<{ seed: string; salt: number } | null>(null);
  if (!mine.current || mine.current.seed !== seed) {
    if (mine.current) release(mine.current.seed, mine.current.salt);
    mine.current = { seed, salt: claim(seed) };
  }
  useEffect(() => () => {
    if (mine.current) release(mine.current.seed, mine.current.salt);
    mine.current = null;
  }, []);
  return mine.current.salt;
}

// ------------------------------------------------------------------ the bot

class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][PersonBot] stopped:", error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

type ViewProps = PersonBotSpec & { style?: StyleProp<ViewStyle> };

const a11y = (label: string) => (label
  ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: label }
  : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const });

/** A person's bot from plain props (MentionField's rows). */
export function PersonBotView(p: ViewProps): React.ReactElement {
  const box = { width: p.size, height: p.size, flexShrink: 0 };
  return (
    <Guard fallback={<View {...a11y(p.label)} style={[p.style, box, { borderRadius: p.size / 2, backgroundColor: p.color }]} />}>
      <Person {...p} />
    </Guard>
  );
}

export const PersonBot = ({ props, style }: CompProps): React.ReactElement => <PersonBotView {...readPersonBot(props)} style={style} />;

function Person({ seed, avatar, color, size, live: liveProp, label, style }: ViewProps): React.ReactElement {
  const reduced = useReducedMotion();
  const live = liveProp && reduced === false;
  const L = useLooks();
  const salt = useSalt(seed);
  const st = useMemo(() => stageOf(size), [size]);
  const n = seedOf(seed, salt);
  // Made in his resting pose, on his spot; kept for as long as he is on this screen.
  const bot = useMemo(() => personTile({ seed: n, color, size, avatar: L.avatar("custom", avatar) }), [n, color, size]); // eslint-disable-line react-hooks/exhaustive-deps
  // His look: a new catalog re-skins him where he stands.
  bot.setAvatar(L.avatar("custom", avatar));
  const idle = useMemo(() => new PersonIdle(bot, st.w / 2, n, idleOptions(size, {
    every: K.list<number>("ui.PersonBot.everyS", [16, 36]) as [number, number],
    first: K.list<number>("ui.PersonBot.firstS", [4, 24]) as [number, number],
  })), [bot, st, n, size]);
  const gestures = useMemo(
    () => K.list<string>("ui.PersonBot.gestures", ["shrug", "react.look"]).map((id) => L.moment(id)).filter((m): m is Moment => !!m),
    [L],
  );

  // The box is the middle of his world: drawn from there.
  const painter = useRef<Painter | null>(null);
  const scene = useMemo<Drawable>(() => ({
    draw: (g: TileCtx) => { g.save(); g.translate(-st.boxX, 0); bot.draw(g); g.restore(); },
  }), [bot, st]);

  // Alive or still, painted before the screen shows (again when a new catalog re-skins him).
  useLayoutEffect(() => {
    if (live) idle.start(); else if (idle.live) idle.stop();
    painter.current?.paint(scene);
  }, [idle, live, scene, L]);

  // On the one loop while he lives.
  const host = useRef<View>(null);
  const member = useRef<LoopMember | null>(null);
  const gest = useRef(gestures);
  gest.current = gestures;
  useEffect(() => {
    if (!live) return;
    const m: LoopMember = {
      frame: (dt, t) => { idle.frame(dt, t, gest.current, GATE); painter.current?.paint(scene); },
    };
    member.current = m;
    const leave = join(m, host);
    return () => { member.current = null; leave(); };
  }, [live, idle, scene]);
  // Laid out (or moved by a layout): on screen or not, now rather than at the next look.
  const laidOut = () => { if (member.current) measure(member.current, host); };

  return (
    <View ref={host} pointerEvents="none" {...a11y(label)} onLayout={laidOut} style={[style, { width: size, height: size, flexShrink: 0 }]}>
      <TileSurface ref={(r) => { painter.current = r; if (r) r.paint(scene); }} w={size} h={size} />
    </View>
  );
}
