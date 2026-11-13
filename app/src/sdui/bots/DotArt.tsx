/**
 * DotArt — a picture made of dots that obey physics (types.ts DotArtProps, component "DotArt"). What a bot draws under its words
 * (a chart, a meter, a drawing: TAILZU-BACKEND src/show) comes as dots, monochrome, and this makes them live: they come in by
 * falling, growing or gathering, held by springs; a touch scatters the ones near it and the springs bring them back; a held finger
 * pushes them aside. The rules are dotArtCore.ts's, the same file the window runs.
 *
 *   { type: "DotArt", props: { w, h, d: [x, y, r, tone, group, ...], enter?, heat?, ink?, seed?, key?, label? } }
 *
 * Drawn on the tiles' surface (TileSurface: Skia here, a canvas on the web) with one call per radius and tone. Every DotArt shares
 * ONE frame loop, and a picture is on it only while something moves and it is on screen: a settled picture costs nothing. A picture
 * is kept by its key while the app runs, so a refresh of the chat does not bring it in again. Reduce Motion: drawn at home, still,
 * and a touch does nothing. A fault in the drawing leaves the box empty.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AppState, Dimensions, View, type GestureResponderEvent } from "react-native";
import type { CompProps } from "../components/props";
import type { TileCtx } from "../../botTiles/core";
import { TileSurface, useReducedMotion, type Drawable, type Painter } from "../../botTiles/TileSurface";
import { SharedLoop, type LoopMember } from "./personBotCore";
import { Kept, fieldFor, readDotArt, type DotField } from "./dotArtCore";

// ------------------------------------------------------------------ the one loop, and what is kept

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const LOOP = new SharedLoop({ raf: (cb) => requestAnimationFrame(cb), caf: (h) => cancelAnimationFrame(h as number), now }, 60);
LOOP.onDrop = (_m, e) => {
  // eslint-disable-next-line no-console
  console.warn("[Tailzu][DotArt] frame failed:", e);
};
const KEPT = new Kept();
const HOSTS = new Map<LoopMember, React.RefObject<View | null>>();
let poll: ReturnType<typeof setInterval> | null = null;
let appSub = false;

function measure(m: LoopMember, host: React.RefObject<View | null>): void {
  const v = host.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
  if (!v?.measureInWindow) return;
  v.measureInWindow((x, y, w, h) => {
    const win = Dimensions.get("window");
    LOOP.setSeen(m, w > 0 && h > 0 && y + h > 0 && y < win.height && x + w > 0 && x < win.width);
  });
}

function join(m: LoopMember, host: React.RefObject<View | null>): void {
  if (HOSTS.has(m)) return;
  if (!appSub) {
    appSub = true;
    AppState.addEventListener("change", (s) => LOOP.setActive(s === "active"));
  }
  LOOP.setActive(AppState.currentState === "active" || AppState.currentState == null);
  HOSTS.set(m, host);
  LOOP.add(m);
  measure(m, host);
  if (!poll) poll = setInterval(() => HOSTS.forEach((h, k) => measure(k, h)), 500);
}

function leave(m: LoopMember): void {
  if (!HOSTS.delete(m)) return;
  LOOP.remove(m);
  if (!HOSTS.size && poll) { clearInterval(poll); poll = null; }
}

// ------------------------------------------------------------------ the node

class Guard extends React.Component<{ children: React.ReactNode; w: number; h: number }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][DotArt] stopped:", error);
  }
  render() { return this.state.failed ? <View style={{ width: this.props.w, height: this.props.h }} /> : this.props.children; }
}

export const DotArt = ({ props, style }: CompProps): React.ReactElement | null => {
  const spec = useMemo(() => readDotArt(props), [props]);
  if (!spec) return null;
  return (
    <Guard w={spec.w} h={spec.h}>
      <Dots spec={spec} style={style} />
    </Guard>
  );
};

function Dots({ spec, style }: { spec: NonNullable<ReturnType<typeof readDotArt>>; style: CompProps["style"] }): React.ReactElement {
  const reduced = useReducedMotion();
  // Until the phone says whether Reduce Motion is on, the picture is drawn at home; then it comes in, if it is to.
  const motion = reduced === false;
  const field = useMemo<DotField>(() => fieldFor(KEPT, spec, { motion, entering: true }), [spec, motion]);
  const painter = useRef<Painter | null>(null);
  const drawable = useMemo<Drawable>(() => ({ draw: (g: TileCtx) => field.draw(g) }), [field]);
  const host = useRef<View>(null);

  // On the loop only while it moves.
  const member = useMemo<LoopMember>(() => ({
    frame: (dt) => {
      const moving = field.frame(dt);
      painter.current?.paint(drawable);
      if (!moving) leave(member);
    },
  }), [field, drawable]); // eslint-disable-line react-hooks/exhaustive-deps
  const wake = () => { if (field.awake) join(member, host); };

  useLayoutEffect(() => { painter.current?.paint(drawable); wake(); }, [drawable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => leave(member), [member]);

  // A touch: an impulse where it lands, a push while it stays; the scroll may take the gesture over at any time.
  const at = (e: GestureResponderEvent) => ({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
  const touch = motion
    ? {
      onStartShouldSetResponder: () => true,
      onResponderTerminationRequest: () => true,
      onResponderGrant: (e: GestureResponderEvent) => { const p = at(e); field.poke(p.x, p.y); field.press(p); wake(); },
      onResponderMove: (e: GestureResponderEvent) => { field.press(at(e)); wake(); },
      onResponderRelease: () => field.press(null),
      onResponderTerminate: () => field.press(null),
    }
    : {};

  const a11y = spec.label
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: spec.label }
    : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

  return (
    <View ref={host} {...a11y} {...touch} onLayout={() => { if (HOSTS.has(member)) measure(member, host); }}
      style={[style, { width: spec.w, height: spec.h, flexShrink: 0 }]}>
      <TileSurface ref={(r) => { painter.current = r; if (r) r.paint(drawable); }} w={spec.w} h={spec.h} />
    </View>
  );
}
