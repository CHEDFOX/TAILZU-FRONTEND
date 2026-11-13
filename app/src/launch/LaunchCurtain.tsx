/**
 * THE LAUNCH, DRAWN: the splash's picture, then the bot pulls himself up over his bar, his hands come back and grab
 * its middle, from above and below, it is pulled in to them as they twist, and the app is there (launchCore.ts says how it fits together, and has every number).
 *
 * LaunchCurtain sits over the whole app from its first render. It draws the native splash's own frame (the same art,
 * size, place and ground), and once that is on screen it lifts the native splash from under it, so the join is one
 * picture replacing itself. Then the motion plays, all of it on the native driver. The curtain ends on the app's white
 * and lets go once the motion is over and the app has lifted the launch (liftLaunch, from SduiApp when there is a
 * screen), whichever comes later. Reduce Motion: the still, then the fade.
 *
 * The layers, back to front: his head (behind the bar, shown only below its top edge), the bar (whole, then in strips
 * for the pull-in), his gloves (in front, each its own half: gripping, slipping behind the bar after him, grabbing its
 * middle again, from above and below, and twisting as the bar is pulled in to them).
 *
 * WHAT EACH LAYER DOES IS THE SERVER'S (launchMotion.ts): the motion is data the server sends, so a new launch
 * reaches every phone without an app update. It always starts on the splash's own frame, and it never holds the app
 * shut: a launch that will not compile is not played (the copy the build carries is), and whatever it says, the app
 * opens by app.splash.maxHoldMs. This file only draws the layers and keys them; where a part moves is the launch's.
 * The curtain draws behind a boundary of its own (the default export, at the end), because it sits outside the app's:
 * a launch that still found a way to throw costs the launch and nothing else.
 *
 * LaunchStill is the same picture standing still: the boot view between the launch and a first screen.
 */
import { Component, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from "react-native";
import { num } from "../sdui/knobs";
import {
  BAR, BAR_MID, BAR_TOP, BUILT_IN, GLOVES, GRIP_AT, GROUND, SPLASH_PT, STRIPS, U,
  asDeg, feeler, feelerWindow, feelersShown, hideNativeSplash, isLifted, keys, launchWindow, liftLaunch, onLift, partKeys, playMs, type Launch,
} from "./launchCore";
import { launchNow } from "./launchMotion";
import { FEELER_ART } from "./feelerArt";

/* eslint-disable @typescript-eslint/no-require-imports */
const ART = {
  splash: require("../../assets/launch/splash.png"),
  head: require("../../assets/launch/head.png"),
  bar: require("../../assets/launch/bar.png"),
  hands: require("../../assets/launch/hands.png"),
  blink: require("../../assets/launch/blink.png"),
  feelerL1: require("../../assets/launch/feelerL1.png"),
  feelerL2: require("../../assets/launch/feelerL2.png"),
  feelerR1: require("../../assets/launch/feelerR1.png"),
  feelerR2: require("../../assets/launch/feelerR2.png"),
};
/** The art the motion waits for before it starts: head, blink, bar, a glove, and the four pieces of Blip's feelers. */
const ART_TO_LOAD = 8;
/* eslint-enable @typescript-eslint/no-require-imports */

const Z = SPLASH_PT;
/** The head's clip reaches past the art on both sides: his sway may take an ear over its edge. */
const WIDE = 60;

/**
 * Every key the curtain draws with, sampled once from the launch that is playing (launchMotion.ts): the server's
 * motion, or the copy this build carries. A part is sampled over the whole launch and the flat stretches are
 * trimmed away (launchCore keys), because where a part moves is the launch's business, not this file's. The bar is
 * sampled up to the pinch and the strips from it: until then the bar is drawn whole.
 */
function tracks(L: Launch) {
  const { end, pinch } = launchWindow(L);
  const feelers = feelerWindow(L).end;
  const h = partKeys((t) => L.head(t), 0, end);
  return {
    bar: keys((t) => L.bar(t), 0, pinch),
    head: { dy: h.dy, sway: asDeg(h.sway), sq: h.sq, shut: h.shut, shown: h.shown },
    // Blip's feelers: each piece's turn from rest (the physics, launchCore feelerTrack), and how much of them shows
    feelers: {
      L: [asDeg(keys((t) => feeler("l1", t, L), 0, feelers)), asDeg(keys((t) => feeler("l2", t, L), 0, feelers))],
      R: [asDeg(keys((t) => feeler("r1", t, L), 0, feelers)), asDeg(keys((t) => feeler("r2", t, L), 0, feelers))],
      shown: keys((t) => feelersShown(t, L), 0, feelers),
    },
    gloves: ([0, 1] as const).map((s) => {
      const g = partKeys((t) => L.glove(s, t), 0, end);
      return { ...g, turn: asDeg(g.turn) };
    }),
    whole: { inputRange: [0, pinch - 1, pinch], outputRange: [1, 1, 0] },
    showStrips: { inputRange: [0, pinch - 1, pinch], outputRange: [0, 0, 1] },
    strips: Array.from({ length: STRIPS }, (_, i) => partKeys((t) => L.strip(i, STRIPS, t), pinch, end)),
  };
}

/** The splash's picture, still, where the splash has it. */
export function LaunchStill() {
  return (
    <View style={styles.ground} pointerEvents="none">
      <Image source={ART.splash} style={styles.art} />
    </View>
  );
}

function Curtain() {
  const [gone, setGone] = useState(isLifted);
  // The launch the server sent, or the copy this build carries: worked out and keyed once, before the first frame.
  // Keying is the first thing that reads what the server sent at every moment rather than at one, so a launch that
  // gets past launchMotion and still cannot be keyed drops to the motion this build was cut with, here and now.
  const { L, K } = useMemo(() => {
    try { const picked = launchNow(); return { L: picked, K: tracks(picked) }; }
    catch { return { L: BUILT_IN, K: tracks(BUILT_IN) }; }
  }, []);
  // When the app opens whatever the launch is doing: a broken or endless launch never holds it.
  const capMs = num("app.splash.maxHoldMs", 7000);
  const t = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const loads = useRef(0);
  const started = useRef(false);
  // It lets go when both are true: the motion is over (or will not play) and the app has lifted the launch.
  const over = useRef(false);
  const up = useRef(false);
  const letGo = useRef(() => {
    if (!over.current || !up.current) return;
    Animated.timing(fade, { toValue: 0, duration: L.fade, useNativeDriver: true }).start(() => setGone(true));
  }).current;

  // The art is on screen: the native splash can go, and the bot can move.
  const start = useRef(() => {
    if (started.current) return;
    started.current = true;
    requestAnimationFrame(() => {
      hideNativeSplash();
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((still) => {
        if (still || isLifted()) { over.current = true; letGo(); return; }
        // Never longer than the moment the app opens whatever happens: a launch the server made too long plays
        // as much of itself as fits, and the cap below lifts it.
        const ms = playMs(L, capMs);
        Animated.timing(t, { toValue: ms, duration: ms, easing: Easing.linear, useNativeDriver: true })
          .start(() => { over.current = true; letGo(); });
      });
    });
  }).current;
  const loaded = () => { if (++loads.current >= ART_TO_LOAD) start(); };

  useEffect(() => {
    if (gone) return;
    const late = setTimeout(start, 500);   // art that never says it loaded still lets the native splash go
    // Nothing holds the launch forever: the app's own floor (SduiApp) lifts it, and so does this, should the app
    // never get that far.
    const cap = setTimeout(() => { over.current = true; liftLaunch(); }, capMs);
    const off = onLift(() => { up.current = true; letGo(); });
    return () => { clearTimeout(late); clearTimeout(cap); off(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;
  const at = (k: { inputRange: number[]; outputRange: number[] | string[] }) => t.interpolate({ ...k, extrapolate: "clamp" } as never);
  const bar = at(K.bar);
  const barH = (BAR.y1 - BAR.y0) * U, stripW = (BAR.x1 - BAR.x0) * U / STRIPS;
  return (
    <Animated.View style={[styles.ground, { opacity: fade }]} pointerEvents="none">
      <View style={styles.art}>
        {/* His head, behind the bar: only what is below the bar's top edge shows, and the edge rides the bar. */}
        <Animated.View style={[styles.below, { left: -WIDE, width: Z + 2 * WIDE, transform: [{ translateY: bar }] }]}>
          <Animated.View style={[styles.piece, { left: WIDE, opacity: at(K.head.shown), transformOrigin: "50% 0%",
            transform: [{ rotate: at(K.head.sway) }, { scaleY: at(K.head.sq) }, { translateY: at(K.head.dy) }] }]}>
            {/* His feelers, behind his head: he hangs upside down, so they hang from the top of his head, at the bottom.
                Each is two pieces drawn at rest, each turned about its pivot (the root; the cut) by the physics. */}
            <Animated.View style={[styles.piece, { opacity: at(K.feelers.shown) }]}>
              {(["L", "R"] as const).map((s) => {
                const [rx, ry] = FEELER_ART.roots[s], [jx, jy] = FEELER_ART.joints[s];
                return (
                  <Animated.View key={s} style={[styles.piece, { transformOrigin: `${rx * U}px ${ry * U - BAR_TOP}px`, transform: [{ rotate: at(K.feelers[s][0]) }] }]}>
                    <Image source={s === "L" ? ART.feelerL1 : ART.feelerR1} style={styles.lifted} onLoad={loaded} />
                    <Animated.View style={[styles.piece, { transformOrigin: `${jx * U}px ${jy * U - BAR_TOP}px`, transform: [{ rotate: at(K.feelers[s][1]) }] }]}>
                      <Image source={s === "L" ? ART.feelerL2 : ART.feelerR2} style={styles.lifted} onLoad={loaded} />
                    </Animated.View>
                  </Animated.View>
                );
              })}
            </Animated.View>
            <Image source={ART.head} style={styles.lifted} onLoad={loaded} />
            <Animated.Image source={ART.blink} style={[styles.lifted, { opacity: at(K.head.shut) }]} onLoad={loaded} />
          </Animated.View>
        </Animated.View>
        {/* The bar: whole, until it pinches; then in strips, each pulled in to the middle. */}
        <Animated.Image source={ART.bar} style={[styles.layer, { opacity: at(K.whole), transform: [{ translateY: bar }] }]} onLoad={loaded} />
        <Animated.View style={[styles.layer, { opacity: at(K.showStrips), transform: [{ translateY: bar }] }]}>
          {K.strips.map((s, i) => {
            const left = BAR.x0 * U + i * stripW;
            return (
              <Animated.View key={i} style={{ position: "absolute", overflow: "hidden", left, top: BAR.y0 * U, width: stripW + 0.6, height: barH,
                opacity: at(s.shown), transform: [{ translateX: at(s.dx) }, { scaleX: at(s.sx) }, { scaleY: at(s.sy) }] }}>
                <Image source={ART.bar} style={{ position: "absolute", left: -left, top: -BAR.y0 * U, width: Z, height: Z }} />
              </Animated.View>
            );
          })}
        </Animated.View>
        {/* His gloves, in front: each its own half, squeezed toward the bar as they grip. Going, the edge each is
            clipped at moves down the bar's face as the glove goes up into its lower edge. Coming back, to the bar's
            middle: the left in from above, turned over to grip its top; the right in from below. Then they twist
            against each other as the bar is pulled in to them, and close on the middle. */}
        {K.gloves.map((g, side) => {
          const edge = at(g.edge);
          const barMid = BAR_MID - BAR_TOP;
          return (
            <Animated.View key={side} style={[styles.below, { left: side * Z / 2, width: Z / 2, opacity: at(g.shown), transform: [{ translateY: bar }, { translateY: edge }] }]}>
              <Animated.View style={[styles.piece, { transform: [{ translateY: Animated.multiply(edge, -1) }] }]}>
                <Animated.View style={[styles.piece, { transformOrigin: `${GLOVES[side].cx - side * Z / 2}px ${barMid}px`,
                  transform: [{ translateX: at(g.gx) }, { translateY: at(g.lift) }, { rotate: at(g.turn) }, { scale: at(g.size) }] }]}>
                  <Animated.View style={[styles.piece, { transformOrigin: `50% ${barMid}px`, transform: [{ scaleY: at(g.flip) }] }]}>
                    <Animated.View style={[styles.piece, { transformOrigin: `50% ${GRIP_AT * 100}%`, transform: [{ scaleY: t.interpolate({ ...g.grip, outputRange: g.grip.outputRange.map((v) => 1 - v), extrapolate: "clamp" }) }] }]}>
                      <Animated.Image source={ART.hands} style={[styles.lifted, { left: -side * Z / 2, transform: [{ translateY: at(g.dy) }] }]} onLoad={side ? undefined : loaded} />
                    </Animated.View>
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            </Animated.View>
          );
        })}
      </View>
    </Animated.View>
  );
}

/**
 * The curtain, behind a boundary of its own.
 *
 * It is drawn over the whole app and OUTSIDE the app's ErrorBoundary (App.tsx), from the very first render, before
 * any effect has run and before the app has fetched anything. A throw while it draws would take the root down with
 * nothing to catch it — and because the launch that caused it is kept on the device, it would do so again at every
 * start. So whatever goes wrong in here, the launch is lifted and the curtain simply draws nothing: the app opens.
 */
export default class LaunchCurtain extends Component<Record<string, never>, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(e: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu] the launch could not be drawn:", e);
    liftLaunch();   // nothing else would: the native splash is still up under this.
  }

  render() {
    return this.state.failed ? null : <Curtain />;
  }
}

const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;
const styles = StyleSheet.create({
  ground: { ...fill, backgroundColor: GROUND, alignItems: "center", justifyContent: "center" },
  art: { width: Z, height: Z },
  layer: { position: "absolute", top: 0, left: 0, width: Z, height: Z },
  // A clip from the bar's top edge down: nothing above the ledge shows.
  below: { position: "absolute", top: BAR_TOP, height: Z, overflow: "hidden" },
  // The art's own square, laid from that edge.
  piece: { position: "absolute", top: 0, left: 0, width: Z, height: Z },
  lifted: { position: "absolute", top: -BAR_TOP, left: 0, width: Z, height: Z },
});
