/**
 * AuroraOrb — an audio-reactive sphere of drifting nebula bands, in amber.
 *
 * A Skia runtime shader (SKSL) on the GPU. The whole orb is one fragment
 * program: two noise fields drifting against each other make the bands, a
 * fake z-height makes the sphere, and a fresnel term makes the rim brighten
 * when the voice does. There is no geometry and no per-frame work on the JS
 * thread — the clock and the level are shared values the shader reads.
 *
 * IT REPLACES VoiceBubble, which built its outline from a sum of sines and
 * drew five blurred lobes on top. That reads as a soft blob; this reads as an
 * object with light on it. VoiceBubble stays in the registry as the fallback
 * for bundles too old to know this node.
 *
 * ── WHAT THE BACKEND CAN CHANGE ──────────────────────────────────────────────
 * Everything the original hard-coded is a uniform here — shimmer, radius, rim
 * gain, the three colours — so the look is tuned from the catalog rather than
 * from a build. The shader is compiled ONCE at module load whatever those
 * values are, because they are inputs to it rather than text spliced into it.
 *
 * Bindings (both optional, both server-authored):
 *   bind.level   0..1 loudness. Smoothed here, so a coarse source still moves
 *                the orb smoothly.
 *   bind.state   "idle" | "listening" | "thinking" | "speaking". Sets the
 *                resting level when there is nothing measured to follow.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Canvas, Fill, Shader, Skia } from "@shopify/react-native-skia";
import { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import type { CompProps } from "./components";

/**
 * The palette, as a FALLBACK ONLY — the backend sends all three, and these are
 * what draws if a bootstrap predates them.
 *
 * Two colours under lighting is the whole object; the third is the top of the
 * shimmer ramp. That third one is a light amber rather than a cream: the
 * shimmer washes over the bands and is the brightest part of the orb, so a
 * peach there is what the eye names the colour by, and the object stops
 * reading as one material lit and starts reading as amber with a cream sheen.
 */
const AMBER = "#E8A23C";
const DEEP = "#4A1D08";
const GOLD = "#F8C879";

/**
 * Resting level per state — what the orb does when nothing is driving it.
 * `listening` sits low so an incoming level has somewhere to rise from;
 * `speaking` sits high and steady, because the app talking is continuous
 * rather than a series of peaks.
 */
const REST: Record<string, number> = {
  idle: 0.06,
  listening: 0.18,
  thinking: 0.12,
  speaking: 0.46,
};

/** How fast the drawn level chases the target, per frame at 60fps. */
const CHASE = 0.09;

const SOURCE = `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_amp;
uniform float  u_radius;    // sphere radius in normalised units
uniform float  u_shimmer;   // how strongly the warm shimmer reads over the bands
uniform float  u_rim;       // rim gain at full volume
uniform float3 u_c1;        // AMBER — highlight and rim
uniform float3 u_c2;        // DEEP  — trough
uniform float3 u_c3;        // GOLD  — shimmer top

float hash(float2 p){ p = fract(p*float2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }

float vnoise(float2 p){
  float2 i = floor(p); float2 f = fract(p);
  float a = hash(i), b = hash(i+float2(1.0,0.0)), c = hash(i+float2(0.0,1.0)), d = hash(i+float2(1.0,1.0));
  float2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

// Five octaves. Four is visibly banded on a sphere this size; six costs a fifth
// more per pixel for a difference nobody sees at arm's length.
float fbm(float2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p=p*2.02; a*=0.5; } return v; }

half4 main(float2 fragCoord){
  // Normalise on HEIGHT, not width, so the sphere stays circular in a
  // non-square canvas instead of stretching with it.
  float2 uv = (fragCoord - 0.5*u_resolution) / u_resolution.y;
  float r = length(uv);
  float t = u_time * 0.1;
  float amp = clamp(u_amp, 0.0, 1.0);
  float rad = max(u_radius, 0.0001);

  // TWO NOISE FIELDS, the second fed by the first. Drifting one against the
  // other is what stops the bands looking like a scrolling texture: they curl.
  float2 p = uv * 1.6;
  float f1 = fbm(p + float2(t, -t*0.6));
  float f2 = fbm(p*1.7 + float2(-t*0.8, t) + f1);

  float bands = 0.5 + 0.5*sin((uv.y*3.0 + f1*3.0 + f2*2.0 + t*1.5) * 3.1416);
  float3 col = mix(u_c2, u_c1, bands);

  // WARM SHIMMER. Ramped between the deep and a pale gold rather than around
  // the hue circle: a full cosine iridescence sweeps about a third of its cycle
  // through blue-green, which is exactly the wrong third for an amber object.
  float3 shimmer = mix(u_c2, u_c3, clamp(f2 + amp*0.35, 0.0, 1.0));
  col = mix(col, shimmer, u_shimmer);

  // Fake the sphere: z is the height of the ball above the screen at this
  // pixel, which gives a normal, which gives ordinary lambert shading. Cheaper
  // than any geometry and indistinguishable at this scale.
  float z = sqrt(max(0.0, rad*rad - r*r));
  float3 nrm = normalize(float3(uv, z/rad));
  col *= 0.5 + 0.75*clamp(dot(nrm, normalize(float3(-0.3,-0.5,0.85))), 0.0, 1.0);

  // Rim light, and the one place loudness is unmistakable: the edge brightens
  // when the voice does. The gain is lower than a violet original's would be —
  // amber carries far more red and green, so the same additive rim clips both
  // channels sooner and the edge goes yellow-white, eating the band structure.
  float fres = pow(1.0 - clamp(z/rad, 0.0, 1.0), 2.0);
  col += fres * u_c1 * (0.35 + amp*u_rim);

  // A feather instead of a hard cut — an aliased edge on a dark ground is the
  // one thing that makes a shader orb look cheap. No outer glow: it would read
  // as a light source rather than an object.
  float a = smoothstep(rad, rad - 0.05, r);
  return half4(col*a, a);
}`;

/**
 * Compiled once, at module load. A failed compile is a null we render around
 * rather than a crash — some older drivers refuse loops in fragment shaders.
 */
const EFFECT = (() => {
  try {
    return Skia?.RuntimeEffect ? Skia.RuntimeEffect.Make(SOURCE) : null;
  } catch {
    return null;
  }
})();

/** '#E8A23C' -> [0.91, 0.64, 0.24]. Accepts #abc as well as #aabbcc. */
function hexToVec(hex: unknown, fallback: number[]): number[] {
  const h = String(hex ?? "").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return v.some(Number.isNaN) ? fallback : v;
}

export const AuroraOrb = ({ node, props, store, style }: CompProps): React.ReactElement => {
  const size = Number(props?.size) || 240;
  /**
   * The sphere's radius in normalised units. The canvas is deliberately larger
   * than the ball so the rim has somewhere to fall off — at 0.32 the sphere is
   * about 64% of the canvas width. Unlike the blurred orb this replaced, there
   * is nothing here that can spill past the canvas and get clipped into a
   * visible rectangle: the shader fades to alpha 0 well inside its own bounds.
   */
  const radius = props?.radius !== undefined ? Number(props.radius) : 0.32;
  /** 0 is bands alone; past ~0.45 the shimmer washes the band structure out. */
  const shimmer = props?.shimmer !== undefined ? Number(props.shimmer) : 0.28;
  const rim = props?.rim !== undefined ? Number(props.rim) : 0.75;
  const chase = props?.chase !== undefined ? Number(props.chase) : CHASE;
  const rest: Record<string, number> = { ...REST, ...(props?.rest ?? {}) };

  const c1 = useMemo(() => hexToVec(props?.tint ?? AMBER, [0.91, 0.64, 0.24]), [props?.tint]);
  const c2 = useMemo(() => hexToVec(props?.deep ?? DEEP, [0.29, 0.11, 0.03]), [props?.deep]);
  const c3 = useMemo(() => hexToVec(props?.gold ?? GOLD, [0.97, 0.78, 0.47]), [props?.gold]);

  const levelKey = node.bind?.level;
  const stateKey = node.bind?.state;

  // Re-read the store on every change. Both values are written by VoiceSession
  // several times a second, so a subscription is cheaper than polling.
  const [, force] = useState(0);
  useEffect(
    () => (levelKey || stateKey ? store.subscribe(() => force((n) => n + 1)) : undefined),
    [levelKey, stateKey, store],
  );

  const rawLevel = Number(store.get(levelKey ?? "") ?? props?.level ?? 0);
  const phase = String(store.get(stateKey ?? "") ?? props?.state ?? "idle");

  // Whichever is louder — the measured level or the resting behaviour for this
  // state — so a state with a floor never goes flat between syllables, and a
  // loud moment still reads as loud.
  const target = useSharedValue(0);
  useEffect(() => {
    const restLevel = rest[phase] ?? rest.idle;
    const measured = Number.isFinite(rawLevel) ? Math.max(0, Math.min(1, rawLevel)) : 0;
    target.value = Math.max(restLevel, measured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLevel, phase, target, rest.idle, rest.listening, rest.thinking, rest.speaking]);

  const level = useSharedValue(0);
  const clock = useSharedValue(0);

  useFrameCallback((frame) => {
    "worklet";
    // Clamp long frames: a screen returning from the background with a 2s delta
    // would otherwise jump the whole animation forward at once.
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, 1 / 30);
    clock.value += dt;
    level.value += (target.value - level.value) * chase;
  }, true);

  const uniforms = useDerivedValue(() => ({
    u_resolution: [size, size],
    u_time: clock.value,
    u_amp: level.value,
    u_radius: radius,
    u_shimmer: shimmer,
    u_rim: rim,
    u_c1: c1,
    u_c2: c2,
    u_c3: c3,
  }), [size, radius, shimmer, rim, c1, c2, c3]);

  // No shader, no orb — but still the right shape and colour in the layout, so
  // a driver that refuses to compile it degrades to a plain sphere rather than
  // to a hole in the screen.
  if (!EFFECT) {
    return (
      <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
        <View style={{
          width: size * radius * 2,
          height: size * radius * 2,
          borderRadius: size * radius,
          backgroundColor: String(props?.tint ?? AMBER),
        }} />
      </View>
    );
  }

  return (
    <Canvas style={[{ width: size, height: size }, style]}>
      <Fill>
        <Shader source={EFFECT} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
};
