/**
 * BotTiles — Home's grid of living bot tiles (types.ts BotTilesProps, capability "BotsMotion").
 *
 * Each tile is a card with its words at the bottom (name, and its line: working in the bot's colour, "Needs you" in
 * ink) and, behind them, a tiny Blip in the bot's colour playing on a faint fabric (src/botTiles/core.ts: physics,
 * one core with the window). He plays above the words and passes behind them at most.
 *
 * The tap: the tile presses in (a spring), the cloth is drawn in under the finger and its bot perks up; every other
 * bot stops and turns its head to the tapped tile, and the other tiles' words fade to 35 %; about 450 ms later the
 * tile's action runs. If the screen is still here a moment later (an action that stays), everything comes back. The
 * look never outlives its moment: leaving Home lets it go, and so does coming back to it (a new grid's world starts
 * released) or the app coming back to the front, so every bot is at its own play again at once.
 * Reduce Motion: every bot rests in a pose, nothing moves, and a tap runs the action at once.
 *
 * The bots live on across a return to Home (they are kept by slug for the life of the app). A fault in the drawing
 * takes the bots away and leaves the tiles working.
 *
 *   { type: "BotTiles", props: { tiles: [{ slug, name, sub, color, kind, state, action }], columns, height, padding,
 *     gap, faces: { regular, medium, semibold }, strip?, stripHeight?, stage?, subLines?, nameGap? } }
 *
 * `stage` (capability "BotTilesStage"): the bot plays in the top `stage` px of each tile and its words start under it,
 * so a taller tile gives the words room instead of the bot; `subLines` is how many lines the idle line may take (2),
 * `nameGap` the room between the name and the line (7). The name is in capitals and bold, the line semibold, and both
 * sit on a veil: the fabric under them blurred and washed pale, fading in from above (Veil).
 *
 * `strip` (capability "BotTilesStrip"): one more tile as a full-width row under the grid (Notes), its bot on a stage of
 * its own at the left and its name and line on the right. It is the last bot of the same world, so its tap is the
 * tiles' moment (the others look at it, their words fade) and a tile's tap turns its head too.
 *
 * LOOKS AND MOMENTS (BotMoments; the server's catalog, botTiles/looks.ts): a tile's `avatar` is its bot's look (an id or
 * a spec; none: its kind's), its `moment` a recipe he plays (`momentMode` "once" or "loop"). `surprises`: Home's rare idle
 * moments ({ every, chance, moments }: every `every` seconds, with `chance`, one idle bot plays one of them; the bots
 * near him answer, as a moment's recipe asks). Moments this build cannot play are left out.
 *
 * DOUBLE TAP (DoubleTap): a tile's `doubleTap` runs on a second tap within 260 ms; the first tap's moment and action are
 * dropped (its fades come back at once). The first tap's action already waits longer than that, so a single tap is as it was.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Platform, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { CompProps } from "../components/props";
import { runAction } from "../actions";
import type { BotTileSpec } from "../types";
import { BotTile, TAP, gridWorld, kindOf, type BotKind, type BotMood, type Looks, type Moment } from "../../botTiles/core";
import { playMoment } from "../../media/sounds";
import { TileSurface, useReducedMotion, useTileLoop, type Painter } from "../../botTiles/TileSurface";
import { noteScenes, useLooks } from "../../botTiles/looks";
import { voiceLevel } from "../voice/voiceBus";
import * as K from "../knobs";

const INK = "#0a0a0a", META = "#5c5c5c", LINE = "#e6e6e6", DASHED = "#c9c9c9", PAPER = "#ffffff";

/** How far above its name the bot stands (place: the floor is the words' top less this). */
const FEET_GAP = 10;
/**
 * The veil's fade: it starts VEIL_LIFT above the words, where the bot's feet are, so he stands on its edge, and it
 * is fully in VEIL_FADE further down. How white it is once in.
 */
const VEIL_LIFT = FEET_GAP, VEIL_FADE = 14, VEIL_WHITE = 0.74;
const WEB = Platform.OS === "web";

/**
 * THE VEIL UNDER A TILE'S WORDS: the fabric behind the name and line, blurred and washed pale, fading in from above so
 * there is no edge. Without it the words sat straight on the pattern and lost to it. It is a child of the words'
 * own box, stretched to the tile's sides and down to its bottom (the tile clips it), so it follows the words wherever
 * they sit and fades with them on a tap.
 *
 * The web has a real masked blur (backdrop-filter under a mask); a phone's blur has no mask, so a gradient of the same
 * white fades in over the top of it and hides its edge.
 */
function Veil({ pad }: { pad: number }): React.ReactElement {
  const box = { position: "absolute" as const, left: -pad, right: -pad, top: -VEIL_LIFT, bottom: -400 };
  if (WEB) {
    return (
      <View
        style={box}
        ref={(el) => {
          const st = (el as unknown as { style?: Record<string, string> } | null)?.style;
          if (!st) return;
          const mask = `linear-gradient(to bottom, transparent 0, #000 ${VEIL_FADE}px)`;
          Object.assign(st, {
            backdropFilter: "blur(6px)", webkitBackdropFilter: "blur(6px)", maskImage: mask, webkitMaskImage: mask,
            backgroundColor: `rgba(255,255,255,${VEIL_WHITE})`,
          });
        }}
      />
    );
  }
  // Required here, not at the top: the web bundle never touches the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BlurView } = require("expo-blur") as typeof import("expo-blur");
  return (
    <View style={box}>
      <View style={{ position: "absolute", left: 0, right: 0, top: VEIL_FADE * 0.6, bottom: 0 }}>
        <BlurView intensity={14} tint="light" style={{ flex: 1 }} />
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: `rgba(255,255,255,${VEIL_WHITE})` }} />
      </View>
      <Svg width="100%" height={VEIL_FADE} style={{ position: "absolute", left: 0, top: 0 }}>
        <Defs>
          <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={PAPER} stopOpacity={0} />
            <Stop offset="1" stopColor={PAPER} stopOpacity={VEIL_WHITE} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={VEIL_FADE} fill="url(#veil)" />
      </Svg>
    </View>
  );
}

/** The bots, by slug, for the life of the app: Home comes back to them where they were. */
const LIVES = new Map<string, BotTile>();

function lifeFor(t: BotTileSpec, i: number): BotTile {
  const kind = (t.kind || kindOf(t.slug)) as BotKind;
  const key = `${t.slug}|${kind}|${t.color}`;
  let b = LIVES.get(key);
  if (!b) {
    let seed = 7 + i * 131;
    for (let k = 0; k < t.slug.length; k++) seed = (seed * 31 + t.slug.charCodeAt(k)) >>> 0;
    b = new BotTile({ kind, color: t.color, mood: t.state as BotMood, seed });
    // A moment's sound (a sneeze, a clap) plays from the bots' pack (sounds.ts).
    b.onSound = playMoment;
    if (LIVES.size > 24) LIVES.clear();
    LIVES.set(key, b);
  }
  b.setMood(t.state as BotMood);
  return b;
}

/** Each tile's look (its own, else its kind's), and its moment once it stands on its stage (again when it changes). */
function dressAndPlay(world: { tiles: BotTile[] }, specs: BotTileSpec[], L: Looks, started: string[]): void {
  specs.forEach((t, i) => {
    const b = world.tiles[i];
    if (!b) return;
    b.setAvatar(L.avatar(b.kind, t.avatar));
    const m = t.moment ? L.moment(t.moment) : null;
    const key = m ? `${m.id}|${t.momentMode ?? ""}` : "";
    if (!b.placed || started[i] === key) return;
    started[i] = key;
    if (m) b.playMoment(m, t.momentMode === "loop" ? "loop" : t.momentMode === "once" ? "once" : undefined);
    else if (b.mo) b.stopMoment();
  });
}

class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BotTiles] stopped:", error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export const BotTiles = (p: CompProps): React.ReactElement => (
  <Guard fallback={<Grid {...p} bots={false} />}><Grid {...p} bots /></Guard>
);

function Grid({ props, ctx, store, bots }: CompProps & { bots: boolean }): React.ReactElement {
  const grid: BotTileSpec[] = Array.isArray(props?.tiles) ? props.tiles : [];
  const strip: BotTileSpec | null = props?.strip && typeof props.strip === "object" ? (props.strip as BotTileSpec) : null;
  // The strip is the world's last bot: its index is grid.length.
  const tiles: BotTileSpec[] = useMemo(() => (strip ? [...grid, strip] : grid), [grid, strip]);
  const SH = Number(props?.stripHeight) || 100;
  const cols = Math.max(1, Number(props?.columns) || 2);
  const H = Number(props?.height) || 132;
  const pad = Number(props?.padding) || 16;
  const gap = Number(props?.gap) || 12;
  // BotTilesStage: the bot's room at the top of each tile; its words start under it and the tile grows down for them.
  const stage = Number(props?.stage) > 0 ? Number(props.stage) : 0;
  const subLines = Math.max(1, Math.min(6, Number(props?.subLines) || 2));
  const nameGap = Math.max(0, Math.min(24, Number(props?.nameGap) || 7));
  const faces = { regular: "Tailzu Geist", medium: "Tailzu Geist Medium", semibold: "Tailzu Geist SemiBold", bold: "Tailzu Geist Bold", ...(props?.faces ?? {}) };
  // The name in capitals and bold, the line under it semibold whatever its state (its colour still says the state).
  const nameStyle = { fontFamily: faces.bold, fontWeight: "normal" as const, fontSize: 15, lineHeight: 20, letterSpacing: 0.6, color: INK, textTransform: "uppercase" as const };
  const reduced = useReducedMotion();

  const [W, setW] = useState(0);
  const tw = W > 0 ? (W - gap * (cols - 1)) / cols : 0;
  /** The strip's stage: the part left of its words. */
  const sw = Math.round(Math.min(220, Math.max(140, W * 0.34)));
  const host = useRef<View>(null);
  const key = tiles.map((t) => `${t.slug}:${t.kind}:${t.color}`).join(",");
  // Released as it is made: a look left from a tap before Home was left goes now (gridWorld).
  const world = useMemo(() => gridWorld(tiles.map(lifeFor)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
  useEffect(() => { tiles.forEach((t, i) => world.tiles[i]?.setMood(t.state as BotMood)); }, [tiles, world]);
  // Looks and moments: each tile's look now (a new catalog re-skins them), its moment once placed; Home's surprises.
  const L = useLooks();
  const started = useMemo<string[]>(() => [], [world]);
  dressAndPlay(world, tiles, L, started);
  const surprises = props?.surprises && typeof props.surprises === "object" ? (props.surprises as { every?: number; chance?: number; moments?: unknown }) : null;
  const surpriseKey = surprises ? JSON.stringify(surprises) : "";
  useEffect(() => {
    const list = surprises && Array.isArray(surprises.moments) ? surprises.moments.map((id) => L.moment(String(id))).filter((m): m is Moment => !!m) : [];
    world.surprise(list, Number(surprises?.every) || 30, Number(surprises?.chance) || 0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, L, surpriseKey]);

  // Painting.
  const painters = useRef<Array<Painter | null>>([]);
  const paintAll = useCallback(() => {
    world.tiles.forEach((t, i) => painters.current[i]?.paint(t));
  }, [world]);
  const still = useRef(false);
  still.current = !!reduced || !bots;

  // Where each tile's words start (its floor), once laid out. Still (Reduce Motion): the pose again, and paint.
  const floors = useRef<number[]>([]);
  const place = useCallback(() => {
    if (!tw) return;
    grid.forEach((_t, i) => {
      const x = (i % cols) * (tw + gap), y = Math.floor(i / cols) * (H + gap);
      world.place(i, x, y, tw - 2, H - 2, floors.current[i] ? floors.current[i]! - FEET_GAP : stage ? stage - FEET_GAP : H - pad - 46);
    });
    // The strip's bot stands near the foot of its stage.
    if (strip) world.place(grid.length, 0, Math.ceil(grid.length / cols) * (H + gap), sw, SH - 2, SH - 2 - pad * 0.7);
    dressAndPlay(world, tiles, L, started);
    if (still.current && reduced !== null) { world.settle(true); paintAll(); }
  }, [tw, sw, grid, strip, SH, cols, gap, H, pad, world, reduced, paintAll, tiles, L, started]);
  useEffect(place, [place]);

  // Reduce Motion: a pose, painted once (again when the layout moves).
  useEffect(() => {
    if (reduced === null || !tw) return;
    world.settle(!!reduced);
    if (reduced) paintAll();
  }, [reduced, tw, world, paintAll]);

  useTileLoop({
    frame: (dt) => {
      // A live scene may read `level` and `talk`: his voice, only while one is playing (SPEC 3.6).
      for (const t of world.tiles) if (t.scenesLive()) t.setLevel(voiceLevel(store));
      world.step(dt);
      // Home is where the idle surprises play, so this is where a slowed or broken scene is first seen (SPEC 3.9).
      for (const t of world.tiles) if (t.sceneBad.length || t.sceneSlow.length) noteScenes(t.sceneBad, t.sceneSlow);
      paintAll();
    },
    still: paintAll,
  }, bots && reduced === false && tw > 0, host);

  // The tap.
  const fades = useMemo(() => tiles.map(() => new Animated.Value(1)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const scales = useMemo(() => tiles.map(() => new Animated.Value(1)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = useRef(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const restore = useCallback((now?: boolean) => {
    world.release();
    fades.forEach((f) => (now ? f.setValue(1) : Animated.timing(f, { toValue: 1, duration: TAP.fadeMs, useNativeDriver: true }).start()));
    busy.current = false;
  }, [world, fades]);
  // Home left (the tapped tile's screen opened, or anything else): the look goes with it, never kept for the return.
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; world.release(); }, [world]);
  // Back to the front: whatever look was left is let go, the words at full strength.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active" && busy.current) restore(true);
    });
    return () => sub.remove();
  }, [restore]);
  // A tile with a double tap (DoubleTap: its bot talks to you): a second tap on it within doubleTapMs drops the first tap's
  // moment and its action, and runs the double instead. (The first tap's action already waits TAP.holdMs, longer than that.)
  const lastTap = useRef<{ i: number; at: number } | null>(null);
  const tap = (i: number, x: number, y: number) => {
    const t = tiles[i];
    const dbl = t?.doubleTap;
    const now = Date.now(), ms = K.num("ui.BotTiles.doubleTapMs", 260);
    if (dbl && lastTap.current && lastTap.current.i === i && now - lastTap.current.at <= ms) {
      lastTap.current = null;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      restore(true);
      void runAction(dbl, ctx);
      return;
    }
    if (!t?.action || busy.current) return;
    lastTap.current = dbl ? { i, at: now } : null;
    if (reduced || !bots) {
      if (dbl) { busy.current = true; timers.current.push(setTimeout(() => { busy.current = false; void runAction(t.action, ctx); }, ms)); }
      else void runAction(t.action, ctx);
      return;
    }
    busy.current = true;
    world.focus(i, strip && i === grid.length ? Math.min(x, sw) : x, y);
    paintAll();
    fades.forEach((f, j) => { if (j !== i) Animated.timing(f, { toValue: TAP.fadeTo, duration: TAP.fadeMs, useNativeDriver: true }).start(); });
    Animated.sequence([
      Animated.spring(scales[i]!, { toValue: TAP.pressScale, useNativeDriver: true, speed: 40, bounciness: 0 }),
      Animated.spring(scales[i]!, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
    ]).start();
    timers.current.push(setTimeout(() => { void runAction(t.action, ctx); }, TAP.holdMs));
    timers.current.push(setTimeout(() => restore(), TAP.holdMs + TAP.restoreMs));
  };

  return (
    <View
      ref={host}
      onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== W) setW(w); }}
      style={{ flexDirection: "row", flexWrap: "wrap", gap, alignSelf: "stretch" }}
    >
      {tw > 0 && grid.map((t, i) => {
        const make = t.kind === "make";
        const bw = make ? 1.5 : 1;
        const mark = make ? null : t.state === "working" ? t.color : t.state === "needs" ? INK : null;
        const sub = t.state === "working"
          ? { color: t.color, fontFamily: faces.semibold, lines: 1 }
          : t.state === "needs" ? { color: INK, fontFamily: faces.semibold, lines: 1 } : { color: META, fontFamily: faces.semibold, lines: subLines };
        return (
          <Animated.View key={`${t.slug}-${i}`} style={{ width: tw, height: H, transform: [{ scale: scales[i]! }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.label || `${t.name}. ${t.sub}`}
              onPress={(e) => tap(i, e.nativeEvent.locationX, e.nativeEvent.locationY)}
              style={{
                flex: 1, borderRadius: 20, borderWidth: bw, borderColor: make ? DASHED : LINE, borderStyle: make ? "dashed" : "solid",
                backgroundColor: PAPER, overflow: "hidden",
              }}
            >
              {bots && (
                <TileSurface
                  ref={(r) => { painters.current[i] = r; }}
                  w={tw - 2} h={H - 2}
                  style={{ position: "absolute", left: 0, top: 0 }}
                />
              )}
              {mark && (
                <View style={{ position: "absolute", top: pad, right: pad, width: 10, height: 10, borderRadius: 5, backgroundColor: mark }} />
              )}
              <Animated.View
                pointerEvents="none"
                onLayout={(e) => { const y = e.nativeEvent.layout.y; if (Math.abs((floors.current[i] ?? 0) - y) > 0.5) { floors.current[i] = y; place(); } }}
                style={{ position: "absolute", left: pad, right: pad, ...(stage ? { top: stage } : { bottom: pad }), gap: nameGap, opacity: fades[i] }}
              >
                {bots && <Veil pad={pad} />}
                <Text style={nameStyle} numberOfLines={1}>{t.name}</Text>
                <Text style={{ fontFamily: sub.fontFamily, fontWeight: "normal", fontSize: 12, lineHeight: 16, color: sub.color }} numberOfLines={sub.lines}>{t.sub}</Text>
              </Animated.View>
            </Pressable>
          </Animated.View>
        );
      })}
      {tw > 0 && strip && (() => {
        const i = grid.length, t = strip;
        const mark = t.state === "working" ? t.color : t.state === "needs" ? INK : null;
        const sub = t.state === "working" ? { color: t.color, fontFamily: faces.semibold }
          : t.state === "needs" ? { color: INK, fontFamily: faces.semibold } : { color: META, fontFamily: faces.semibold };
        return (
          <Animated.View key={`strip-${t.slug}`} style={{ width: W, height: SH, transform: [{ scale: scales[i]! }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.label || `${t.name}. ${t.sub}`}
              onPress={(e) => tap(i, e.nativeEvent.locationX, e.nativeEvent.locationY)}
              style={{ flex: 1, borderRadius: 20, borderWidth: 1, borderColor: LINE, backgroundColor: PAPER, overflow: "hidden" }}
            >
              {bots && (
                <TileSurface
                  ref={(r) => { painters.current[i] = r; }}
                  w={sw} h={SH - 2}
                  style={{ position: "absolute", left: 0, top: 0 }}
                />
              )}
              {mark && (
                <View style={{ position: "absolute", top: pad, right: pad, width: 10, height: 10, borderRadius: 5, backgroundColor: mark }} />
              )}
              <Animated.View
                pointerEvents="none"
                style={{ position: "absolute", left: sw, right: pad + (mark ? 16 : 0), top: 0, bottom: 0, justifyContent: "center", gap: nameGap, opacity: fades[i] }}
              >
                <Text style={nameStyle} numberOfLines={1}>{t.name}</Text>
                <Text style={{ fontFamily: sub.fontFamily, fontWeight: "normal", fontSize: 13, lineHeight: 17, color: sub.color }} numberOfLines={1}>{t.sub}</Text>
              </Animated.View>
            </Pressable>
          </Animated.View>
        );
      })()}
    </View>
  );
}
