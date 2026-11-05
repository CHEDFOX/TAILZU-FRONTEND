/**
 * BotCrowd — a box of tiny bots playing with the real physics (types.ts BotCrowdProps, component "BotCrowd"; section 3i):
 * the first Spaces screen's crowd. One canvas, one BotTilesWorld (core.ts): each bot on a patch of his own, in two
 * staggered rows along the box's floor, with lots of empty space; no cloth, no toys; the catalog's moments now and then
 * (`surprises`), and the bots near him answer.
 *
 * grownWhen: the box grows to `grownHeight` (600 ms) and its bots ride its floor down. cheerWhen: every bot hops, one after
 * another, again every 1.6 s for at most 6 s while it holds. The node's children are drawn over the bots at the top of the
 * box (Call Your People's fields), the bots keeping the floor. Kept per `life` for the life of the app. Reduce Motion: the
 * bots in still poses, the box at its size at once. A fault in the drawing leaves the box and its children.
 *
 *   { type: "BotCrowd", props: { life, bots: [{ kind, color, avatar? }], size, height?, grownWhen?, grownHeight?, cheerWhen?,
 *     surprises?, label }, children: [...] }
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import type { CompProps } from "../components/props";
import { evalCondition } from "../actions";
import * as K from "../knobs";
import { BotTile, BotTilesWorld, kindOf, type BotKind, type Moment } from "../../botTiles/core";
import { TileSurface, useReducedMotion, useTileLoop, type Drawable, type Painter } from "../../botTiles/TileSurface";
import { useLooks } from "../../botTiles/looks";

const LINE = "#e6e6e6", PAPER = "#ffffff";

interface CrowdSpec { kind: BotKind; color: string; avatar?: unknown }

/** The crowds, by life and by who is in them, for the life of the app. */
const CROWDS = new Map<string, { world: BotTilesWorld; cheerUntil: number }>();

function crowdOf(life: string, bots: CrowdSpec[], size: number) {
  const key = `${life}|${size}|${bots.map((b) => `${b.kind}:${b.color}`).join(",")}`;
  let c = CROWDS.get(key);
  if (!c) {
    const world = new BotTilesWorld();
    bots.forEach((b, i) => {
      let seed = 31 + i * 97;
      for (let k = 0; k < life.length; k++) seed = (seed * 31 + life.charCodeAt(k)) >>> 0;
      const t = new BotTile({ kind: b.kind, color: b.color, mood: "idle", seed, size, toys: false });
      // No cloth, and no moment sounds: a box of them surprising every few seconds would be noise.
      t.cloth = 0;
      world.add(t);
    });
    world.release();
    if (CROWDS.size > 8) CROWDS.clear();
    c = { world, cheerUntil: 0 };
    CROWDS.set(key, c);
  }
  return c;
}

/**
 * Each bot's patch (its region in the canvas): two staggered rows along the floor, the lower row one more than the upper,
 * each patch a pitch wide less some air, the upper row set between the lower one's. Anchored to the canvas's bottom.
 */
export function crowdPatches(n: number, w: number, canvasH: number, restH: number, size: number): Array<{ x: number; y: number; w: number; h: number; floor: number }> {
  const lower = Math.ceil(n / 2), upper = n - lower;
  const inset = Math.max(8, w * 0.03);
  const pitch = (w - 2 * inset) / Math.max(1, lower);
  const pw = Math.max(size * 1.6, pitch - 8);
  // The rows share the lower 55% of the box at rest.
  const rowH = Math.max(size * 2.2, (restH * 0.55) / 2);
  const out: Array<{ x: number; y: number; w: number; h: number; floor: number }> = [];
  for (let i = 0; i < n; i++) {
    const low = i >= upper;
    const col = low ? i - upper : i;
    const x = inset + (low ? col * pitch : (col + 0.5) * pitch) + (pitch - pw) / 2;
    const y = canvasH - (low ? rowH : 2 * rowH);
    out.push({ x, y, w: pw, h: rowH, floor: rowH - (low ? 10 : 6) });
  }
  return out;
}

class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][BotCrowd] stopped:", error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export const BotCrowd = (p: CompProps): React.ReactElement => (
  <Guard fallback={<Crowd {...p} bots={false} />}><Crowd {...p} bots /></Guard>
);

function Crowd({ props, ctx, children, bots }: CompProps & { bots: boolean }): React.ReactElement {
  const reduced = useReducedMotion();
  const still = reduced === true;
  const life = String(props?.life || "crowd");
  const size = Math.max(10, Number(props?.size) || 22);
  const specs: CrowdSpec[] = useMemo(() => (Array.isArray(props?.bots) ? props.bots : [])
    .slice(0, 9)
    .map((b: any) => ({ kind: (b?.kind || kindOf(String(b?.kind ?? ""))) as BotKind, color: String(b?.color || "#0a0a0a"), avatar: b?.avatar })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [JSON.stringify(props?.bots ?? [])]);
  const crowd = useMemo(() => crowdOf(life, specs, size), [life, specs, size]);
  const world = crowd.world;

  // Looks: each bot's own, else his kind's; the surprises from the catalog.
  const L = useLooks();
  world.tiles.forEach((t, i) => t.setAvatar(L.avatar(t.kind, specs[i]?.avatar)));
  const surprises = props?.surprises && typeof props.surprises === "object" ? (props.surprises as { moments?: unknown; every?: number; chance?: number }) : null;
  const surpriseKey = surprises ? JSON.stringify(surprises) : "";
  useEffect(() => {
    const list = surprises && Array.isArray(surprises.moments) ? surprises.moments.map((id) => L.moment(String(id))).filter((m): m is Moment => !!m) : [];
    world.surprise(list, Number(surprises?.every) || 3, Number(surprises?.chance) || 0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, L, surpriseKey]);

  // ---- the box's size: square at rest (or `height`), `grownHeight` while grownWhen holds
  const [W, setW] = useState(0);
  const restH = Number(props?.height) > 0 ? Number(props.height) : W;
  const grownH = Math.max(restH, Number(props?.grownHeight) || restH);
  const grown = props?.grownWhen ? evalCondition(props.grownWhen, ctx) : false;
  const target = grown ? grownH : restH;
  const h = useRef(new Animated.Value(target)).current;
  // The canvas is as tall as the box will be (bottom-anchored, so the bots ride the floor as the box moves).
  const [canvasH, setCanvasH] = useState(target);
  const first = useRef(true);
  useEffect(() => {
    if (W <= 0) return;
    if (first.current || still) { first.current = false; h.setValue(target); setCanvasH(target); return; }
    setCanvasH((c) => Math.max(c, target));
    Animated.timing(h, { toValue: target, duration: K.num("ui.BotCrowd.growMs", 600), easing: Easing.bezier(0.3, 1.06, 0.45, 1), useNativeDriver: false })
      .start(({ finished }) => { if (finished) setCanvasH(target); });
  }, [target, W, still, h]);

  // Each bot on his patch (again when the canvas changes size: they keep their place over the floor).
  const painter = useRef<Painter | null>(null);
  // One canvas for all of them: each bot drawn at his patch's place (the world keeps where each is).
  const scene = useMemo<Drawable>(() => ({
    draw: (g) => world.tiles.forEach((t, i) => { g.save(); g.translate(world.rx[i] ?? 0, world.ry[i] ?? 0); t.draw(g); g.restore(); }),
  }), [world]);
  useEffect(() => {
    if (W <= 0 || canvasH <= 0) return;
    const patches = crowdPatches(world.tiles.length, W - 2, canvasH, restH, size);
    patches.forEach((p, i) => world.place(i, p.x, p.y, p.w, p.h, p.floor));
    if (reduced !== null) world.settle(still);
    painter.current?.paint(scene);
  }, [W, canvasH, restH, size, world, reduced, still, scene]);

  // ---- every bot cheers while cheerWhen holds: one after another, again every 1.6 s, for 6 s at most
  const cheering = props?.cheerWhen ? evalCondition(props.cheerWhen, ctx) : false;
  useEffect(() => {
    if (!cheering || still) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const round = () => {
      world.tiles.forEach((t, i) => timers.push(setTimeout(() => { if (t.mo) t.stopMoment(); t.cheer(); }, i * K.num("ui.BotCrowd.cheerStaggerMs", 70))));
    };
    round();
    const every = setInterval(round, K.num("ui.BotCrowd.cheerEveryMs", 1600));
    const stop = setTimeout(() => clearInterval(every), K.num("ui.BotCrowd.cheerForMs", 6000));
    return () => { clearInterval(every); clearTimeout(stop); timers.forEach(clearTimeout); };
  }, [cheering, still, world]);

  const host = useRef<View>(null);
  useTileLoop({
    frame: (dt) => { world.step(dt); painter.current?.paint(scene); },
    still: () => painter.current?.paint(scene),
  }, bots && reduced === false && W > 0, host);

  return (
    <Animated.View
      ref={host}
      accessibilityLabel={typeof props?.label === "string" ? props.label : undefined}
      onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== W) setW(w); }}
      style={{ alignSelf: "stretch", height: W > 0 ? h : undefined, aspectRatio: W > 0 ? undefined : 1, borderRadius: 24, borderWidth: 1, borderColor: LINE, backgroundColor: PAPER, overflow: "hidden" }}
    >
      {bots && W > 0 && canvasH > 0 && (
        <TileSurface ref={(r) => { painter.current = r; if (r) r.paint(scene); }} w={W - 2} h={canvasH} style={{ position: "absolute", left: 0, bottom: 0 }} />
      )}
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, padding: 20 }}>{children}</View>
    </Animated.View>
  );
}
