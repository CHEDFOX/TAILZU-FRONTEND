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
 *     gap, faces: { regular, medium, semibold } } }
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Pressable, Text, View } from "react-native";
import type { CompProps } from "./components";
import { runAction } from "./actions";
import type { BotTileSpec } from "./types";
import { BotTile, TAP, gridWorld, kindOf, type BotKind, type BotMood } from "../botTiles/core";
import { TileSurface, useReducedMotion, useTileLoop, type Painter } from "../botTiles/TileSurface";

const INK = "#0a0a0a", META = "#5c5c5c", LINE = "#e6e6e6", DASHED = "#c9c9c9", PAPER = "#ffffff";

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
    if (LIVES.size > 24) LIVES.clear();
    LIVES.set(key, b);
  }
  b.setMood(t.state as BotMood);
  return b;
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

function Grid({ props, ctx, bots }: CompProps & { bots: boolean }): React.ReactElement {
  const tiles: BotTileSpec[] = Array.isArray(props?.tiles) ? props.tiles : [];
  const cols = Math.max(1, Number(props?.columns) || 2);
  const H = Number(props?.height) || 132;
  const pad = Number(props?.padding) || 16;
  const gap = Number(props?.gap) || 12;
  const faces = { regular: "Tailzu Geist", medium: "Tailzu Geist Medium", semibold: "Tailzu Geist SemiBold", ...(props?.faces ?? {}) };
  const reduced = useReducedMotion();

  const [W, setW] = useState(0);
  const tw = W > 0 ? (W - gap * (cols - 1)) / cols : 0;
  const host = useRef<View>(null);
  const key = tiles.map((t) => `${t.slug}:${t.kind}:${t.color}`).join(",");
  // Released as it is made: a look left from a tap before Home was left goes now (gridWorld).
  const world = useMemo(() => gridWorld(tiles.map(lifeFor)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
  useEffect(() => { tiles.forEach((t, i) => world.tiles[i]?.setMood(t.state as BotMood)); }, [tiles, world]);

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
    tiles.forEach((_t, i) => {
      const x = (i % cols) * (tw + gap), y = Math.floor(i / cols) * (H + gap);
      world.place(i, x, y, tw - 2, H - 2, floors.current[i] ? floors.current[i]! - 3 : H - pad - 46);
    });
    if (still.current && reduced !== null) { world.settle(true); paintAll(); }
  }, [tw, tiles, cols, gap, H, pad, world, reduced, paintAll]);
  useEffect(place, [place]);

  // Reduce Motion: a pose, painted once (again when the layout moves).
  useEffect(() => {
    if (reduced === null || !tw) return;
    world.settle(!!reduced);
    if (reduced) paintAll();
  }, [reduced, tw, world, paintAll]);

  useTileLoop({
    frame: (dt) => { world.step(dt); paintAll(); },
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
  const tap = (i: number, x: number, y: number) => {
    const t = tiles[i];
    if (!t?.action || busy.current) return;
    if (reduced || !bots) { void runAction(t.action, ctx); return; }
    busy.current = true;
    world.focus(i, x, y);
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
      {tw > 0 && tiles.map((t, i) => {
        const make = t.kind === "make";
        const bw = make ? 1.5 : 1;
        const mark = make ? null : t.state === "working" ? t.color : t.state === "needs" ? INK : null;
        const sub = t.state === "working"
          ? { color: t.color, fontFamily: faces.medium, lines: 1 }
          : t.state === "needs" ? { color: INK, fontFamily: faces.semibold, lines: 1 } : { color: META, fontFamily: faces.regular, lines: 2 };
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
                style={{ position: "absolute", left: pad, right: pad, bottom: pad, gap: 3, opacity: fades[i] }}
              >
                <Text style={{ fontFamily: faces.semibold, fontWeight: "normal", fontSize: 16, lineHeight: 21, color: INK }} numberOfLines={1}>{t.name}</Text>
                <Text style={{ fontFamily: sub.fontFamily, fontWeight: "normal", fontSize: 12, lineHeight: 16, color: sub.color }} numberOfLines={sub.lines}>{t.sub}</Text>
              </Animated.View>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}
