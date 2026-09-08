/**
 * VoiceBubble — the thing you talk to.
 *
 * A soft blob that reacts while you speak and breathes slowly while it answers,
 * so the state of a voice conversation is legible without a word for it. It is
 * the only visual on the realtime screen, which is the point: there is nothing
 * to read, so there has to be something to watch.
 *
 * Skia, on the UI thread. The outline is rebuilt every frame from a sum of
 * sines — 72 points around a circle, three offset layers — and that is far too
 * much per-frame geometry to send across the bridge as animated views. Same
 * reason ParticleMark is Skia: one path, one draw call, whatever the shape.
 *
 * Nothing here is native. Skia already ships in the binary (ParticleMark has
 * been importing it since the kitchen-sink build), so this component reaches
 * installed apps over the air.
 *
 * Bindings (both optional, both server-authored):
 *   bind.level   0..1 loudness. Smoothed here, so a coarse or jumpy source
 *                still moves the bubble smoothly.
 *   bind.state   "idle" | "listening" | "thinking" | "speaking". Sets the
 *                resting behaviour when there is no level to follow.
 *
 * Props:
 *   size         px, square (default 190)
 *   tint         hex (default the brand amber)
 *   background   fill behind the blob (default transparent)
 *   points       outline resolution (default 72)
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { BlurMask, Canvas, Path, RadialGradient, Skia, vec, type SkPath } from "@shopify/react-native-skia";
import { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import type { CompProps } from "./components";

/** How fast the drawn level chases the target. Per-frame, at 60fps. */
const CHASE = 0.09;

/**
 * Resting amplitude per state — what the bubble does when nothing is driving
 * it. `listening` sits low so an incoming level has somewhere to rise from;
 * `speaking` sits high and steady, because the app talking is a continuous
 * thing rather than a series of peaks.
 */
const REST: Record<string, number> = {
  idle: 0.06,
  listening: 0.18,
  thinking: 0.12,
  speaking: 0.46,
};

/**
 * THE ORB IS NOT ONE GRADIENT. That is the whole difference between a sphere
 * that looks solid and one that looks alive.
 *
 * A single radial ramp — however many stops it has — is perfectly symmetrical
 * about its centre, and the eye reads that instantly as a rendered object: a
 * flat disc with a soft edge and a hue that only ever changes with distance.
 * Real light in a real volume does not do that. Colour pools, it collects on
 * one side, it leaves a cold lobe where nothing is lit.
 *
 * So the body is built the way the reference is: several soft colour fields,
 * each its own hue, overlapping at DIFFERENT centres. Nothing draws an edge —
 * every lobe fades to nothing on its own — and their union is the ball. Where
 * two lobes overlap you get a hue neither one contains, which is where the
 * depth comes from, and no two directions out of the centre look the same.
 *
 * And they DRIFT. Each lobe travels its own slow ellipse at its own rate, on
 * periods that do not divide into each other, so the field never repeats and
 * never settles. That is the "alive": not the outline moving, which reads as a
 * pulsing blob, but the colour inside turning over while the silhouette stays
 * calm.
 *
 * `orbit` is how far a lobe wanders as a share of the radius; `speed` is in
 * turns per second; `phase` offsets it so they do not set off together.
 */
/** Hooks are called this many times regardless; extra lobes are ignored. */
const MAX_LOBES = 6;

export type Lobe = {
  color: string;
  /** Resting centre, as a share of the radius from the middle. */
  x: number;
  y: number;
  /** Size, as a share of the radius. */
  r: number;
  orbit: number;
  speed: number;
  phase: number;
  opacity: number;
};

const LOBES: Lobe[] = [
  // The warm body. Largest, nearly centred, barely moves — it is what the orb
  // IS, and the others are weather on top of it.
  { color: "#F2612C", x: 0.02, y: 0.06, r: 0.92, orbit: 0.05, speed: 0.031, phase: 0.0, opacity: 1 },
  // The brand, where the light lands. Up and left, because a hot spot dead
  // centre reads as a ring.
  { color: "#E8A23C", x: -0.26, y: -0.30, r: 0.60, orbit: 0.10, speed: 0.047, phase: 1.7, opacity: 0.95 },
  // Magenta pooling into the lower right, the first step out of the light.
  { color: "#C0388A", x: 0.34, y: 0.30, r: 0.68, orbit: 0.12, speed: 0.039, phase: 3.1, opacity: 0.9 },
  // The cold lobe. Upper left in the reference — the bite of violet that stops
  // the whole thing reading as a sunset gradient.
  { color: "#5E2E9E", x: -0.40, y: -0.10, r: 0.44, orbit: 0.14, speed: 0.053, phase: 4.4, opacity: 0.8 },
  // Deep shadow, bottom right, holding the sphere down.
  { color: "#3F1E78", x: 0.30, y: 0.44, r: 0.50, orbit: 0.09, speed: 0.029, phase: 5.6, opacity: 0.7 },
];

export const VoiceBubble = ({ node, props, style, store }: CompProps): React.ReactElement => {
  const size = Number(props?.size) || 190;
  const tint = String(props?.tint ?? "#E8A23C");
  const background = props?.background ? String(props.background) : "transparent";
  const points = Math.max(24, Math.min(180, Number(props?.points) || 72));
  /**
   * The lobes, whole or in part, from the server.
   *
   * A bare `tint` still means what it always did — one hue — but it is now
   * expressed as a single lobe, so the screens that pass only a tint keep
   * working and get the softness for free.
   */
  const lobes: Lobe[] = Array.isArray(props?.lobes) && props.lobes.length
    ? (props.lobes as Partial<Lobe>[]).map((l, i) => ({ ...(LOBES[i] ?? LOBES[0]), ...l }) as Lobe)
    : props?.tint
      ? [{ color: tint, x: 0, y: 0, r: 0.95, orbit: 0.05, speed: 0.03, phase: 0, opacity: 1 }]
      : LOBES;
  const shown = lobes.slice(0, MAX_LOBES);
  /**
   * How soft the edge is, in px of blur.
   *
   * This is what separates the reference from a drawn shape. A hard-edged path
   * with a gradient in it is a disc; the same path with its edge blurred is a
   * body of light with no border anyone can point at. Scaled off `size` so an
   * orb drawn at any size is equally soft, rather than crisp when large.
   */
  const softness = props?.softness !== undefined ? Number(props.softness) : size * 0.11;
  /** The halo. 0 removes it. */
  const glow = props?.glow !== undefined ? Number(props.glow) : 0.5;

  const levelKey = node.bind?.level;
  const stateKey = node.bind?.state;

  // Re-read the store on every change. The two values this watches are the
  // whole input to the animation, and both are written by VoiceSession several
  // times a second, so a subscription is cheaper than polling.
  const [, force] = useState(0);
  useEffect(
    () => (levelKey || stateKey ? store.subscribe(() => force((n) => n + 1)) : undefined),
    [levelKey, stateKey, store],
  );

  const rawLevel = Number(store.get(levelKey ?? "") ?? props?.level ?? 0);
  const phase = String(store.get(stateKey ?? "") ?? props?.state ?? "idle");

  // The target the UI thread chases. Whichever is louder — the measured level
  // or the resting behaviour for this state — so a state with a floor never
  // goes flat between syllables, and a loud moment still reads as loud.
  const target = useSharedValue(0);
  useEffect(() => {
    const rest = REST[phase] ?? REST.idle;
    const measured = Number.isFinite(rawLevel) ? Math.max(0, Math.min(1, rawLevel)) : 0;
    target.value = Math.max(rest, measured);
  }, [rawLevel, phase, target]);

  const level = useSharedValue(0);
  const clock = useSharedValue(0);
  const tick = useSharedValue(0);

  useFrameCallback((frame) => {
    "worklet";
    // Clamp long frames: a screen returning from the background with a 2s
    // delta would otherwise jump the whole animation forward at once.
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, 1 / 30);
    clock.value += dt;
    level.value += (target.value - level.value) * CHASE;
    tick.value += 1;
  }, true);

  const c = size / 2;
  const base = size * 0.31;

  /**
   * One layer of the outline, built on the UI thread.
   *
   * `layer` offsets both the phase and the radius so the three do not trace
   * each other; the sum of three sines at unrelated frequencies is what keeps
   * it from reading as a pulsing circle. A worklet, so it can be called from
   * inside useDerivedValue without crossing the bridge.
   */
  function ringPath(layer: number, t: number, lv: number): SkPath {
    "worklet";
    const p = Skia.Path.Make();
    const step = (Math.PI * 2) / points;
    for (let i = 0; i <= points; i++) {
      const a = i * step;
      const wob =
        Math.sin(a * 3 + t * 2.7 + layer * 1.5) * 0.055 +
        Math.sin(a * 5 - t * 3.5 + layer) * 0.035 +
        Math.sin(a * 2 + t * 1.9) * 0.045;
      const r = base * (1 + wob * (0.6 + lv * 2.4) + lv * 0.3 + layer * 0.14);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.close();
    return p;
  }

  /**
   * A lobe's disc for this frame.
   *
   * The centre travels an ellipse — different radii on the two axes, and a
   * speed that is not a round number — so the path never closes on itself
   * visibly. `lv` swells every lobe together, which is what makes the whole
   * field bloom when someone speaks rather than just the outline moving.
   */
  function lobePath(l: Lobe, t: number, lv: number): SkPath {
    "worklet";
    const a = t * l.speed * Math.PI * 2 + l.phase;
    const cx = c + (l.x + Math.cos(a) * l.orbit) * base;
    const cy = c + (l.y + Math.sin(a * 1.37) * l.orbit * 0.8) * base;
    const p = Skia.Path.Make();
    p.addCircle(cx, cy, base * l.r * (1 + lv * 0.22));
    return p;
  }

  // A FIXED number of derived values, always called, however many lobes the
  // server actually sent. Deriving one per lobe would be a hook inside a loop
  // whose length is a prop — change the palette on a live screen and the hook
  // order changes under React, which is a crash rather than a re-render. The
  // slots past the end resolve to an empty path and are never drawn.
  const slots = Array.from({ length: MAX_LOBES }, (_, i) => i);
  const lobePaths = [
    useLobePath(slots[0]), useLobePath(slots[1]), useLobePath(slots[2]),
    useLobePath(slots[3]), useLobePath(slots[4]), useLobePath(slots[5]),
  ];
  function useLobePath(i: number) {
    return useDerivedValue<SkPath>(() => {
      tick.value;
      const l = lobes[i];
      if (!l) return Skia.Path.Make();
      return lobePath(l, clock.value, level.value);
    }, [base, c, lobes.length]);
  }

  // Reading tick makes each of these rebuild every frame.
  const core = useDerivedValue<SkPath>(() => {
    tick.value;
    return ringPath(0, clock.value, level.value);
  }, [points, base, c]);
  const mid = useDerivedValue<SkPath>(() => {
    tick.value;
    return ringPath(1, clock.value, level.value);
  }, [points, base, c]);
  const outer = useDerivedValue<SkPath>(() => {
    tick.value;
    return ringPath(2, clock.value, level.value);
  }, [points, base, c]);

  return (
    <View
      style={[{ width: size, height: size, backgroundColor: background }, style]}
      pointerEvents="none"
    >
      <Canvas style={{ width: size, height: size }}>
        {/* The halo. Drawn first and blurred hardest, so light spills past the
            body and the orb sits IN the screen rather than on top of it. */}
        {glow > 0 ? (
          <Path path={outer} opacity={glow}>
            <RadialGradient
              c={vec(c, c)}
              r={base * 1.9}
              colors={[lobes[0].color, "#00000000"]}
              positions={[0, 1]}
            />
            <BlurMask blur={softness * 2.4} style="normal" />
          </Path>
        ) : null}

        {/* THE BODY: the lobes, in order, each fading to nothing on its own.
            No lobe draws an edge, so the union of them is the sphere and there
            is no outline anywhere to give the drawing away. Where two overlap
            the eye gets a hue neither one contains — that is the depth, and it
            is why this is five soft discs rather than one ramp with five
            stops. */}
        {shown.map((l, i) => (
          <Path key={i} path={lobePaths[i]} color={l.color} opacity={l.opacity}>
            <BlurMask blur={softness * (1.5 + l.r)} style="normal" />
          </Path>
        ))}

        {/* The specular. A pale bloom where the light lands, small and soft —
            what tells the eye the surface is glossy rather than matte. */}
        <Path path={mid} opacity={0.42}>
          <RadialGradient
            c={vec(c - base * 0.34, c - base * 0.46)}
            r={base * 0.66}
            colors={["#FFF3DE", "#FFF3DE00"]}
            positions={[0, 1]}
          />
          <BlurMask blur={softness * 0.9} style="normal" />
        </Path>
      </Canvas>
    </View>
  );
};
