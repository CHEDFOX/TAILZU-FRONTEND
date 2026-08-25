/**
 * ParticleMark — the brand mark bursting into particles and re-forming, on a
 * loop.
 *
 * This is the keyboard's recording visual (MicParticleView, SDUIRenderer.swift)
 * ported to the app. That one is Swift inside the keyboard extension and cannot
 * be reached from React Native, so the motion existed in exactly one place and
 * nowhere else in the product could use it.
 *
 * The physics and the numbers are the same, deliberately — dots seeded on the
 * mark's own opaque pixels, an outward burst, elastic wall and pairwise
 * collisions, drag with a high speed floor so the swarm never settles, a damped
 * spring home, then a handoff to the crisp artwork. The ONLY difference is what
 * drives it: the keyboard switches modes when recording starts and stops, while
 * here the same round trip runs on a loop with no input at all.
 *
 * Skia, not react-native-svg: this draws every dot into ONE path on the UI
 * thread each frame. The same work as N animated SVG circles crossing the
 * bridge would not hold 60fps.
 *
 * Props (all backend-authored):
 *   size          px, square (default 128)
 *   count         dots (default 90)
 *   dotRadius     px (default 1.6)
 *   color         hex (default the brand amber)
 *   speed         multiplier on the whole cycle (default 1; >1 = faster)
 *   circular      clip to a circle (default true)
 *   background    fill behind the dots (default transparent)
 *   holdMark      show the CRISP mark during the hold beat instead of the dots
 *                 sitting in its shape (default true). This is what the
 *                 keyboard does — the dots reassemble and then hand off to the
 *                 real artwork — and it is the difference between "the mark"
 *                 and "a dotted approximation of the mark".
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  Canvas,
  Image as SkiaImage,
  Path,
  Skia,
  useImage,
  type SkImage,
  type SkPath,
} from "@shopify/react-native-skia";
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import type { CompProps } from "./components";

const MARK = require("../../assets/tailzu-mark.png");

// Cycle timings at speed 1, in seconds — burst, wander, spring home, a beat on
// the formed mark, repeat. Leave `speed` at 1 to match the keyboard exactly;
// anything faster stops being the same animation.
const T_WANDER = 1.15;
const T_ASSEMBLE = 0.55;
const T_HOLD = 0.45;

// Physics, carried over from MicParticleView so the two read as one motion.
const BURST_MIN = 55;
const BURST_MAX = 110;
const DRAG = 0.99;
const MIN_SPEED = 24;
const STIFFNESS = 26;
const DAMPING = 0.8;

/**
 * Sample up to `want` points from the mark's opaque area, mapped into a
 * `size`-square box. Straight port of the Swift markPoints(): a 44×44 grid is
 * plenty to trace the shape and keeps this to one small readPixels at mount.
 */
function markPoints(image: SkImage, want: number, size: number): number[] {
  const W = 44;
  const INSET = 6;
  const surface = Skia.Surface.MakeOffscreen(W, W);
  if (!surface) return [];
  const canvas = surface.getCanvas();
  const box = W - INSET * 2;
  const scale = Math.min(box / image.width(), box / image.height());
  const dw = image.width() * scale;
  const dh = image.height() * scale;
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect((W - dw) / 2, (W - dh) / 2, dw, dh),
    Skia.Paint(),
  );
  const px = surface.makeImageSnapshot().readPixels() as Uint8Array | null;
  if (!px) return [];

  const hits: number[] = [];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      // Alpha over the same threshold the keyboard uses → part of the mark.
      if (px[(y * W + x) * 4 + 3] > 90) {
        hits.push(((x + 0.5) / W) * size, ((y + 0.5) / W) * size);
      }
    }
  }
  const total = hits.length / 2;
  if (total <= want) return hits;
  // Even stride, so a thinned sample still traces the whole shape rather than
  // clustering in whichever corner got scanned first.
  const out: number[] = [];
  const step = total / want;
  for (let i = 0; out.length / 2 < want && Math.floor(i) < total; i += step) {
    const k = Math.floor(i) * 2;
    out.push(hits[k], hits[k + 1]);
  }
  return out;
}

export const ParticleMark = ({ props, style }: CompProps): React.ReactElement | null => {
  const size = Number(props?.size) || 128;
  const count = Math.max(2, Number(props?.count) || 90);
  const dotRadius = Number(props?.dotRadius) || 1.6;
  const color = String(props?.color ?? "#E8A23C");
  const speed = Number(props?.speed) > 0 ? Number(props.speed) : 1;
  const circular = props?.circular !== false;
  const holdMark = props?.holdMark !== false;
  const background = props?.background ? String(props.background) : "transparent";

  const image = useImage(MARK);
  const [home, setHome] = useState<number[] | null>(null);

  useEffect(() => {
    if (!image) return;
    const pts = markPoints(image, count, size);
    setHome(pts.length >= 2 ? pts : []);
  }, [image, count, size]);

  // Flat [x, y, vx, vy] per dot. One array mutated in place on the UI thread —
  // allocating per frame is what makes particle fields stutter.
  const dots = useSharedValue<number[]>([]);
  const phase = useSharedValue(0);   // 0 wander · 1 assemble · 2 hold
  // Mirrored to React state: the crisp mark is a Skia <Image>, which only the
  // render tree can swap in, so the worklet has to hand the phase across.
  const [holding, setHolding] = useState(false);
  const clock = useSharedValue(0);
  const tick = useSharedValue(0);
  const targets = useSharedValue<number[]>([]);

  const seeded = useMemo(() => {
    if (home == null) return null;
    const c = size / 2;
    const r = Math.max(1, size / 2 - dotRadius);
    const arr: number[] = [];
    for (let i = 0; i < count; i++) {
      let x: number;
      let y: number;
      if (i * 2 + 1 < home.length) {
        x = home[i * 2];
        y = home[i * 2 + 1];
      } else {
        // No mark to sample (or fewer points than dots) — uniform in the disc.
        const a = Math.random() * Math.PI * 2;
        const rad = r * Math.sqrt(Math.random());
        x = c + Math.cos(a) * rad;
        y = c + Math.sin(a) * rad;
      }
      arr.push(x, y, 0, 0);
    }
    return arr;
  }, [home, count, size, dotRadius]);

  useEffect(() => {
    if (!seeded) return;
    dots.value = seeded.slice();
    targets.value = seeded.slice();
    phase.value = 0;
    clock.value = 0;
    // Kick them apart immediately so the very first frame is already moving.
    burst(dots.value, size, dotRadius);
    tick.value = tick.value + 1;
  }, [seeded, size, dotRadius, dots, targets, phase, clock, tick]);

  useFrameCallback((frame) => {
    "worklet";
    const d = dots.value;
    if (d.length === 0) return;
    // Clamp long frames the way the keyboard does — a backgrounded tab
    // returning with a 2s delta would fling every dot through the wall.
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16) / 1000, 1 / 30) * speed;
    clock.value += dt;

    const c = size / 2;
    const wall = Math.max(0, size / 2 - dotRadius);

    if (phase.value === 0) {
      for (let i = 0; i < d.length; i += 4) {
        d[i] += d[i + 2] * dt;
        d[i + 1] += d[i + 3] * dt;
        const dx = d[i] - c;
        const dy = d[i + 1] - c;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > wall && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          d[i] = c + nx * wall;
          d[i + 1] = c + ny * wall;
          const vn = d[i + 2] * nx + d[i + 3] * ny;
          d[i + 2] -= 2 * vn * nx;
          d[i + 3] -= 2 * vn * ny;
        }
      }
      // Pairwise elastic collisions. O(n²), and at ~90 dots that is 4k checks a
      // frame — nothing on the UI thread, and it is what makes the swarm read
      // as matter rather than as drifting sparks.
      const minD = dotRadius * 2;
      for (let a = 0; a < d.length; a += 4) {
        for (let b = a + 4; b < d.length; b += 4) {
          const dx = d[b] - d[a];
          const dy = d[b + 1] - d[a + 1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= minD || dist <= 0.0001) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = (minD - dist) / 2;
          d[a] -= nx * overlap;
          d[a + 1] -= ny * overlap;
          d[b] += nx * overlap;
          d[b + 1] += ny * overlap;
          const rvn = (d[b + 2] - d[a + 2]) * nx + (d[b + 3] - d[a + 3]) * ny;
          if (rvn < 0) {
            d[a + 2] += rvn * nx;
            d[a + 3] += rvn * ny;
            d[b + 2] -= rvn * nx;
            d[b + 3] -= rvn * ny;
          }
        }
      }
      // Bleed the burst off, but floor the speed high so the swarm keeps
      // zipping instead of drifting to a near-stop before the cycle turns.
      for (let i = 0; i < d.length; i += 4) {
        d[i + 2] *= DRAG;
        d[i + 3] *= DRAG;
        const s = Math.sqrt(d[i + 2] * d[i + 2] + d[i + 3] * d[i + 3]);
        if (s > 0.001 && s < MIN_SPEED) {
          const k = MIN_SPEED / s;
          d[i + 2] *= k;
          d[i + 3] *= k;
        }
      }
      if (clock.value >= T_WANDER) {
        phase.value = 1;
        clock.value = 0;
      }
    } else if (phase.value === 1) {
      const t = targets.value;
      let maxDist = 0;
      for (let i = 0; i < d.length; i += 4) {
        const tx = t[i % t.length];
        const ty = t[(i % t.length) + 1];
        const toX = tx - d[i];
        const toY = ty - d[i + 1];
        d[i + 2] = (d[i + 2] + toX * STIFFNESS * dt) * DAMPING;
        d[i + 3] = (d[i + 3] + toY * STIFFNESS * dt) * DAMPING;
        d[i] += d[i + 2] * dt;
        d[i + 1] += d[i + 3] * dt;
        const dist = Math.sqrt(toX * toX + toY * toY);
        if (dist > maxDist) maxDist = dist;
      }
      if (maxDist < 0.8 || clock.value >= T_ASSEMBLE) {
        // Snap home, so the held frame is exactly the mark and not a near-miss.
        for (let i = 0; i < d.length; i += 4) {
          d[i] = t[i % t.length];
          d[i + 1] = t[(i % t.length) + 1];
          d[i + 2] = 0;
          d[i + 3] = 0;
        }
        phase.value = 2;
        clock.value = 0;
        if (holdMark) runOnJS(setHolding)(true);
      }
    } else if (clock.value >= T_HOLD) {
      burst(d, size, dotRadius);
      phase.value = 0;
      clock.value = 0;
      if (holdMark) runOnJS(setHolding)(false);
    }

    tick.value += 1;
  }, true);

  // Reading tick makes this rebuild every frame; one path means one draw call
  // however many dots there are.
  const path = useDerivedValue<SkPath>(() => {
    tick.value;
    const p = Skia.Path.Make();
    const d = dots.value;
    for (let i = 0; i < d.length; i += 4) p.addCircle(d[i], d[i + 1], dotRadius);
    return p;
  }, [dotRadius]);

  // The mark is sampled inset by 6/44 of the box (see markPoints), so the
  // crisp artwork has to land on exactly that rect or it would jump on handoff.
  const inset = (6 / 44) * size;
  const inner = size - inset * 2;

  if (home == null) {
    // Hold the space while the mark decodes, so the layout doesn't jump.
    return <View style={[{ width: size, height: size }, style]} />;
  }

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: circular ? size / 2 : 0,
          backgroundColor: background,
          overflow: "hidden",
        },
        style,
      ]}
      pointerEvents="none"
    >
      <Canvas style={{ width: size, height: size }}>
        {holding && image ? (
          // The reassembled frame IS the mark, so show the real artwork rather
          // than a ring of dots tracing it. Same handoff the keyboard makes.
          <SkiaImage image={image} x={inset} y={inset} width={inner} height={inner} fit="contain" />
        ) : (
          <Path path={path} color={color} />
        )}
      </Canvas>
    </View>
  );
};

/**
 * An outward kick from the centre through each dot, so the mark visibly bursts
 * apart rather than dissolving. The angular jitter stops dots at the same
 * radius moving in lockstep, which would read as a ring rather than a scatter.
 */
function burst(d: number[], size: number, dotRadius: number): void {
  "worklet";
  const c = size / 2;
  for (let i = 0; i < d.length; i += 4) {
    let dx = d[i] - c;
    let dy = d[i + 1] - c;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.5) {
      dx /= len;
      dy /= len;
    } else {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const j = Math.random() - 0.5;
    const rx = dx * Math.cos(j) - dy * Math.sin(j);
    const ry = dx * Math.sin(j) + dy * Math.cos(j);
    const b = BURST_MIN + Math.random() * (BURST_MAX - BURST_MIN);
    d[i + 2] = rx * b;
    d[i + 3] = ry * b;
  }
}
