/**
 * AuthBlob — the iridescent blob on the auth screen, with real physics.
 *
 * Not a looping animation. A mass-spring rim: 96 points around a closed loop,
 * each with its own radial position and velocity, each pulled home by a spring
 * and coupled to its two neighbours. A poke pushes the points nearest the touch
 * outward; the coupling carries that push around the rim as a travelling wave
 * and the damping eats it. Nothing is keyframed, so nothing ever looks looped.
 *
 * WHY IT CANNOT BE OVERWHELMED BY FAST TOUCHES
 *
 * Every input path only ever ADDS to a shared value. There is no queue, no
 * timer, no animation object to construct and no React state to set — so
 * twenty taps in a second sum into the same accumulator that one tap writes to,
 * and cost the same. The integrator runs on the UI thread at frame rate,
 * independent of how often anyone touches it.
 *
 * Three guards keep that stable no matter what arrives:
 *   - dt is clamped (a backgrounded screen returning with a 2s frame would
 *     otherwise fling every point through the wall)
 *   - the step is substepped, so a stiff spring integrates accurately instead
 *     of exploding at low frame rates
 *   - impulse and velocity are both clamped per point
 *
 * Skia because this rebuilds a 96-point path every frame. The same work as
 * animated views crossing the bridge would not hold 60fps, and the whole point
 * of the screen is that it feels alive under your finger.
 *
 * The blob is drawn as one path filled with an iridescent gradient, plus a few
 * blurred colour blooms clipped inside it — white core, magenta and cyan
 * fringes — over near-black.
 */
import React, { useMemo } from "react";
import {
  Blur,
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  Skia,
  vec,
  type SkPath,
} from "@shopify/react-native-skia";
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

// ── tuning ───────────────────────────────────────────────────────────────────
// These are the numbers that decide how it FEELS. Everything else is plumbing.

/** Rim resolution. 96 is smooth at any size we draw; 48 visibly facets. */
const N = 96;
/** Pull home. Higher = tighter, quicker to settle, less liquid. */
const K_HOME = 34;
/** Damping. Higher = deader. Below ~3 it wobbles for an uncomfortably long time. */
const C_DAMP = 3.4;
/** Neighbour coupling — this is what makes a poke travel instead of denting. */
const K_LINK = 118;
/** Angular width of a poke, in radians. Wider = softer, more whole-body. */
const POKE_SIGMA = 0.72;
/** Ceilings. A clamp is cheaper than a crash. */
const V_MAX = 900;
const R_MAX = 0.42;
/** Fixed-timestep substeps per frame. 3 holds K_LINK stable down to ~30fps. */
const SUBSTEPS = 3;
const MAX_DT = 1 / 30;

/** Whole-body drift: a 2D spring so the blob leans toward what you touched. */
const K_BODY = 26;
const C_BODY = 6.2;
const BODY_MAX = 0.16; // of size, so it never leaves its box

/** Idle life. Added to the REST radius, never to velocity — a moving target
 *  the springs chase, which stays stable however long the screen is open. */
const IDLE_AMP = 0.028;
const IDLE_SPEED = 0.34;

/**
 * The resting SHAPE. Without this the blob relaxes to a circle, and a circle
 * reads as a ball rather than as something soft — the reference is lobed even
 * when nothing is touching it. Three static harmonics at unrelated frequencies
 * give a rest state with no symmetry to notice, and because it is added to the
 * rest position rather than to velocity it costs the physics nothing.
 */
const SHAPE_AMP = 0.13;
function restShape(i: number): number {
  "worklet";
  const a = (i / N) * Math.PI * 2;
  return (
    SHAPE_AMP *
    (Math.sin(a * 2 + 0.9) * 0.52 +
      Math.sin(a * 3 - 2.1) * 0.34 +
      Math.sin(a * 5 + 1.4) * 0.18)
  );
}

export type BlobController = {
  /** Radial offset and velocity per rim point, flattened [r0..rN, v0..vN]. */
  rim: SharedValue<number[]>;
  /** Body offset + velocity: [x, y, vx, vy], in fractions of size. */
  body: SharedValue<number[]>;
  /** Seconds since mount. Drives the idle wander. */
  clock: SharedValue<number>;
  /** Bumped every frame so derived paths rebuild. */
  tick: SharedValue<number>;
  /** Overall energy 0..1, for anything that wants to react to the blob. */
  energy: SharedValue<number>;
  /**
   * Push the rim outward near a point, in the blob's own normalised space
   * (-1..1 on both axes, 0,0 at the centre). Safe to call at any rate, from
   * either thread. Cheap: one loop over 96 floats, no allocation.
   */
  poke: (nx: number, ny: number, strength: number) => void;
  /** A poke with no position — a uniform breath. Used on send / on arrival. */
  pulse: (strength: number) => void;
};

/**
 * Create the physics state. The screen owns this and hands it to the blob, so
 * anything on the screen — a keystroke, a pill tap, a code arriving — can poke
 * it without the blob having to know those things exist.
 */
export function useBlobController(): BlobController {
  const rim = useSharedValue<number[]>(new Array(N * 2).fill(0));
  const body = useSharedValue<number[]>([0, 0, 0, 0]);
  const clock = useSharedValue(0);
  const tick = useSharedValue(0);
  const energy = useSharedValue(0);

  const poke = (nx: number, ny: number, strength: number) => {
    "worklet";
    const a = Math.atan2(ny, nx);
    // Distance from centre decides how much of this is rim and how much is
    // body: a poke at the edge deforms, a poke through the middle shoves.
    const d = Math.min(1, Math.sqrt(nx * nx + ny * ny));
    const s = Math.max(-1, Math.min(1, strength));
    const arr = rim.value;
    const step = (Math.PI * 2) / N;
    for (let i = 0; i < N; i++) {
      // Shortest angular distance, so the falloff wraps correctly at 0/2π.
      let dd = i * step - a;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      const w = Math.exp(-(dd * dd) / (2 * POKE_SIGMA * POKE_SIGMA));
      const vi = N + i;
      const nv = arr[vi] + s * w * 520 * (0.35 + 0.65 * d);
      arr[vi] = nv > V_MAX ? V_MAX : nv < -V_MAX ? -V_MAX : nv;
    }
    rim.value = arr;
    const b = body.value;
    b[2] += nx * s * 1.5;
    b[3] += ny * s * 1.5;
    body.value = b;
  };

  const pulse = (strength: number) => {
    "worklet";
    const s = Math.max(-1, Math.min(1, strength));
    const arr = rim.value;
    for (let i = 0; i < N; i++) {
      const vi = N + i;
      const nv = arr[vi] + s * 380;
      arr[vi] = nv > V_MAX ? V_MAX : nv < -V_MAX ? -V_MAX : nv;
    }
    rim.value = arr;
  };

  return { rim, body, clock, tick, energy, poke, pulse };
}

export function AuthBlob({
  controller,
  size,
  style,
}: {
  controller: BlobController;
  /** Box the blob draws into, in points. It never leaves this box. */
  size: number;
  style?: object;
}) {
  const { rim, body, clock, tick, energy } = controller;
  // Rest radius, leaving room for the largest excursion the clamps allow.
  const base = useMemo(() => size * 0.33, [size]);
  const c = size / 2;

  useFrameCallback((frame) => {
    "worklet";
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, MAX_DT);
    clock.value += dt;
    const h = dt / SUBSTEPS;
    const arr = rim.value;
    const b = body.value;
    const t = clock.value;

    for (let s = 0; s < SUBSTEPS; s++) {
      // Rim. Read positions first, then write velocities, so every point
      // integrates against the same state — updating in place would make the
      // wave travel faster one way around the loop than the other.
      for (let i = 0; i < N; i++) {
        const prev = arr[(i - 1 + N) % N];
        const next = arr[(i + 1) % N];
        const r = arr[i];
        // A slowly moving rest position keeps it alive while nobody touches it.
        const rest =
          IDLE_AMP *
            (Math.sin(i * 0.21 + t * IDLE_SPEED) * 0.6 +
              Math.sin(i * 0.09 - t * IDLE_SPEED * 0.7) * 0.4);
        const a =
          -K_HOME * (r - rest) - C_DAMP * arr[N + i] + K_LINK * ((prev + next) * 0.5 - r);
        let v = arr[N + i] + a * h;
        v = v > V_MAX ? V_MAX : v < -V_MAX ? -V_MAX : v;
        arr[N + i] = v;
      }
      let e = 0;
      for (let i = 0; i < N; i++) {
        let r = arr[i] + arr[N + i] * h * 0.001;
        r = r > R_MAX ? R_MAX : r < -R_MAX ? -R_MAX : r;
        arr[i] = r;
        e += r < 0 ? -r : r;
      }
      if (s === SUBSTEPS - 1) energy.value = Math.min(1, (e / N) * 14);

      // Body — a 2D spring back to centre.
      b[2] += (-K_BODY * b[0] - C_BODY * b[2]) * h;
      b[3] += (-K_BODY * b[1] - C_BODY * b[3]) * h;
      b[0] += b[2] * h;
      b[1] += b[3] * h;
      b[0] = b[0] > BODY_MAX ? BODY_MAX : b[0] < -BODY_MAX ? -BODY_MAX : b[0];
      b[1] = b[1] > BODY_MAX ? BODY_MAX : b[1] < -BODY_MAX ? -BODY_MAX : b[1];
    }

    rim.value = arr;
    body.value = b;
    tick.value += 1;
  }, true);

  const path = useDerivedValue<SkPath>(() => {
    tick.value;
    const arr = rim.value;
    const b = body.value;
    const ox = c + b[0] * size;
    const oy = c + b[1] * size;
    const p = Skia.Path.Make();
    const step = (Math.PI * 2) / N;
    // Catmull-Rom through the rim points, emitted as cubics: a polyline at 96
    // points still shows its corners against a bright fill at this size.
    const px: number[] = [];
    const py: number[] = [];
    for (let i = 0; i < N; i++) {
      // Shape is FORM and arr[i] is DEFORMATION, added here rather than fed to
      // the springs: K_LINK is a smoothing operator on the rim, so a lobed
      // spring target gets diffused back into a circle within a second. Kept
      // out of the physics, the lobes are permanent and the tuning is untouched.
      const r = base * (1 + restShape(i) + arr[i]);
      px.push(ox + Math.cos(i * step) * r);
      py.push(oy + Math.sin(i * step) * r * 0.96);
    }
    p.moveTo(px[0], py[0]);
    for (let i = 0; i < N; i++) {
      const p0x = px[(i - 1 + N) % N], p0y = py[(i - 1 + N) % N];
      const p1x = px[i], p1y = py[i];
      const p2x = px[(i + 1) % N], p2y = py[(i + 1) % N];
      const p3x = px[(i + 2) % N], p3y = py[(i + 2) % N];
      p.cubicTo(
        p1x + (p2x - p0x) / 6, p1y + (p2y - p0y) / 6,
        p2x - (p3x - p1x) / 6, p2y - (p3y - p1y) / 6,
        p2x, p2y,
      );
    }
    p.close();
    return p;
  }, [base, c, size]);

  // The blooms drift with the body so the light looks attached to the mass.
  // Written out rather than produced by a helper: a hook called from inside a
  // function is a rules-of-hooks trap even when the call order happens to be
  // stable, and three lines is a cheap price for not setting that trap.
  const b1 = useDerivedValue(() => {
    tick.value;
    const b = body.value;
    return vec(c + (-0.09 + b[0] * 0.6) * size, c + (-0.10 + b[1] * 0.6) * size);
  }, [c, size]);
  const b2 = useDerivedValue(() => {
    tick.value;
    const b = body.value;
    return vec(c + (0.10 + b[0] * 0.6) * size, c + (0.03 + b[1] * 0.6) * size);
  }, [c, size]);
  const b3 = useDerivedValue(() => {
    tick.value;
    const b = body.value;
    return vec(c + (-0.02 + b[0] * 0.6) * size, c + (0.12 + b[1] * 0.6) * size);
  }, [c, size]);

  return (
    <Canvas style={[{ width: size, height: size }, style]} pointerEvents="none">
      <Group clip={path}>
        {/* Ground, so the fringes have something to sit on. */}
        <Path path={path}>
          <RadialGradient
            c={vec(c, c - base * 0.35)}
            r={base * 1.7}
            colors={["#F4F6FF", "#8E7BE8", "#2B2450", "#0A0A12"]}
            positions={[0, 0.36, 0.74, 1]}
          />
        </Path>
        {/* Iridescence. Three blurred blooms in the hues the reference has —
            magenta, cyan, a warm green — with a white core over them. */}
        <Group>
          <Circle c={b1} r={base * 0.62} color="#FF4FD8" opacity={0.85} />
          <Circle c={b2} r={base * 0.55} color="#3BE8FF" opacity={0.8} />
          <Circle c={b3} r={base * 0.44} color="#8CFF6B" opacity={0.6} />
          <Blur blur={base * 0.28} />
        </Group>
        <Group>
          <Circle c={b1} r={base * 0.26} color="#FFFFFF" opacity={0.95} />
          <Circle c={b2} r={base * 0.2} color="#FFFFFF" opacity={0.9} />
          <Blur blur={base * 0.14} />
        </Group>
      </Group>
    </Canvas>
  );
}
