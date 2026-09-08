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
 * The default body: a lit sphere rather than a coloured disc.
 *
 * Five stops, not the two a single tint gives you. A one-hue radial fades a
 * colour toward its own transparency, which reads as a flat circle with a soft
 * edge; a sphere reads as a sphere because the hue TRAVELS as it falls off —
 * hot and pale where the light lands, deepening through the brand amber into
 * red, then magenta, then violet in the shadow. That hue shift is the whole
 * illusion, and it is why this cannot be expressed as one colour plus an alpha
 * ramp.
 *
 * The amber is the second stop, which is where the eye reads the object's
 * colour: the brand sits in the body of the thing rather than on its edge.
 */
const BODY = ["#FFE6C2", "#E8A23C", "#F2612C", "#C0388A", "#5E2E9E"];
const BODY_STOPS = [0, 0.3, 0.52, 0.76, 1];

export const VoiceBubble = ({ node, props, style, store }: CompProps): React.ReactElement => {
  const size = Number(props?.size) || 190;
  const tint = String(props?.tint ?? "#E8A23C");
  const background = props?.background ? String(props.background) : "transparent";
  const points = Math.max(24, Math.min(180, Number(props?.points) || 72));
  // Full palette control from the server. `colors` wins; a bare `tint` still
  // means what it always did — one hue, pale core to transparent rim — so the
  // screens that pass a tint and nothing else are unchanged; and with neither,
  // the sphere above.
  const given: string[] | null =
    Array.isArray(props?.colors) && props.colors.length >= 2 ? props.colors.map(String) : null;
  const colors: string[] = given ?? (props?.tint ? ["#FFFFFF", tint, `${tint}0D`] : BODY);
  const positions: number[] | undefined =
    Array.isArray(props?.positions) && props.positions.length === colors.length
      ? props.positions.map(Number)
      : given
        ? undefined
        : props?.tint
          ? [0, 0.55, 1]
          : BODY_STOPS;
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
        {/* The halo. Drawn first and blurred hard, so the orb sits IN the
            screen rather than on top of it — light spilling past the body is
            most of what makes the reference read as premium rather than as a
            sticker. */}
        {glow > 0 ? (
          <Path path={outer} opacity={glow}>
            <RadialGradient
              c={vec(c, c)}
              r={base * 1.9}
              colors={[colors[Math.min(2, colors.length - 1)], "#00000000"]}
              positions={[0, 1]}
            />
            <BlurMask blur={softness * 2.2} style="normal" />
          </Path>
        ) : null}
        {/* The body. The light source sits up and to the left — off centre on
            both axes, because a highlight dead centre reads as a flat ring and
            an off-centre one reads as a lit ball. */}
        <Path path={core}>
          <RadialGradient
            c={vec(c - base * 0.22, c - base * 0.34)}
            r={base * 1.62}
            colors={colors}
            positions={positions}
          />
          <BlurMask blur={softness} style="normal" />
        </Path>
        {/* The specular — a small, soft, pale highlight where the light lands.
            One stop of white falling to nothing; it is what tells the eye the
            surface is glossy rather than matte. */}
        <Path path={mid} opacity={0.5}>
          <RadialGradient
            c={vec(c - base * 0.34, c - base * 0.46)}
            r={base * 0.62}
            colors={["#FFFFFFCC", "#FFFFFF00"]}
            positions={[0, 1]}
          />
          <BlurMask blur={softness * 0.8} style="normal" />
        </Path>
      </Canvas>
    </View>
  );
};
