#!/usr/bin/env node
/**
 * Spot 04 (Khaana khaya?): the few room and paper sounds sound.mjs has no kind for, synthesised here on a seeded
 * generator so the same run gives the same files. Writes 16-bit PCM mono 48 kHz WAVs beside this file, which 04.js
 * plays as `sample` cues:
 *
 *   pen1..pen4.wav   a dip-pen scratch (one per handwritten word, four takes so a sentence never repeats one)
 *   peel.wav         a sticker peeling off: crackle that thickens, then a release
 *   whistle.wav      a pressure-cooker whistle in a flat across the street (far, soft, a little room on it)
 *   ceiling.wav      a ceiling fan and the room's tone, 13.0 s, stopping dead on the hard cut
 *   hood.wav         a kitchen hood's hum, on from the cut's first sample, thinning out from 2.4 s
 *
 *   node tools/media/ad/spots/04-sfx/make.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000, TAU = Math.PI * 2;
let seed = 4404;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

/** A biquad band-pass (RBJ), applied in place. */
function bandpass(x, f, q) {
  const w = TAU * f / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w), b0 = a, b2 = -a, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
function lowpass(x, f) { const k = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; } return x; }
function highpass(x, f) { const k = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] -= y; } return x; }
const smooth = (v) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c); };
function normalise(x, peak) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); const g = m > 0 ? peak / m : 1; for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
function write(name, x) {
  const out = Buffer.alloc(44 + x.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + x.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(here, name), out);
  console.log(`${name}  ${(x.length / SR).toFixed(2)} s`);
}

/** A pen scratch: two or three short strokes of bright, gritty noise (the nib on cotton paper). */
function pen(take) {
  seed = 900 + take * 37;
  const dur = 0.16 + 0.04 * (take % 2), n = Math.round(dur * SR), x = new Float32Array(n);
  const strokes = 2 + (take % 2), env = new Float32Array(n);
  for (let s = 0; s < strokes; s++) {
    const t0 = (s / strokes) * dur * 0.85 + 0.004 * take, len = dur / strokes * (0.8 + 0.2 * Math.abs(rnd()));
    for (let i = 0; i < n; i++) { const t = i / SR - t0; if (t < 0 || t > len) continue; const k = t / len; env[i] = Math.max(env[i], Math.sin(Math.PI * Math.min(1, k * 1.4)) ** 0.7 * (1 - 0.4 * k)); }
  }
  for (let i = 0; i < n; i++) x[i] = rnd() * env[i] * (0.75 + 0.25 * Math.sin(TAU * i / SR * (90 + 20 * take)));   // the fibres: a fast flutter
  bandpass(x, 3600 + 500 * take, 0.9); highpass(x, 1500);
  for (let i = 0; i < n; i += 1) if (Math.abs(rnd()) > 0.9965) for (let j = 0; j < 40 && i + j < n; j++) x[i + j] += rnd() * 0.5 * Math.exp(-j / 6) * env[i];   // grit
  return normalise(x, 0.55);
}

/** A peel: sparse crackle growing denser, under a rising hiss, then the release (a soft tk). */
function peel() {
  seed = 77;
  const dur = 0.34, n = Math.round(dur * SR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i / n, dens = 0.002 + 0.03 * k * k;
    if (Math.abs(rnd()) < dens) { const a = 0.4 + 0.6 * Math.abs(rnd()); for (let j = 0; j < 90 && i + j < n; j++) x[i + j] += rnd() * a * Math.exp(-j / 14); }
    x[i] += rnd() * 0.12 * smooth(k / 0.8) * (k < 0.85 ? 1 : (1 - k) / 0.15);
  }
  highpass(x, 1200); bandpass(x, 4200, 0.6);
  const r = Math.round(0.86 * n); for (let j = 0; j < 400 && r + j < n; j++) x[r + j] += Math.sin(TAU * 1900 * j / SR) * Math.exp(-j / 60) * 0.35;   // the release
  return normalise(x, 0.6);
}

/** A cooker whistle across the street: a breathy pitched whistle that rises to its note, holds and dies; far (dark), with a little room. */
function whistle() {
  seed = 1234;
  const dur = 2.6, n = Math.round(dur * SR), x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, rise = smooth(t / 0.35), f = 1500 + 330 * rise + 14 * Math.sin(TAU * 5.3 * t) + 6 * rnd();
    ph += TAU * f / SR;
    const a = smooth(t / 0.3) * (t < 1.15 ? 1 : Math.exp(-(t - 1.15) / 0.22)) * (0.85 + 0.15 * Math.sin(TAU * 2.1 * t));
    x[i] = (Math.sin(ph) * 0.55 + Math.sin(2 * ph) * 0.08) * a;
  }
  const steam = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; steam[i] = rnd() * smooth(t / 0.25) * (t < 1.2 ? 1 : Math.exp(-(t - 1.2) / 0.3)); }
  bandpass(steam, 1800, 2.2); for (let i = 0; i < n; i++) x[i] += steam[i] * 0.9;
  lowpass(x, 2600); lowpass(x, 3200);
  const y = Float32Array.from(x); for (const [d, g] of [[0.031, 0.35], [0.057, 0.25], [0.089, 0.18], [0.13, 0.12], [0.19, 0.08]]) { const o = Math.round(d * SR); for (let i = o; i < n; i++) y[i] += x[i - o] * g; }   // the street between
  return normalise(y, 0.5);
}

/** A ceiling fan in a Jaipur kitchen: dark moving air with the blades' slow swish (about three a second), the motor's
 *  faint hum and the room's own tone. It is there from the first frame and stops dead on the hard cut (13.0 s). */
function ceiling() {
  seed = 55;
  const dur = 13.0, n = Math.round(dur * SR), x = new Float32Array(n);
  let y = 0, y2 = 0, r = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; y += 0.02 * (rnd() - y); y2 += 0.25 * (y - y2); r += 0.004 * (rnd() - r);
    const blade = 0.72 + 0.28 * Math.sin(TAU * 3.15 * t) ** 2, ramp = smooth(t / 0.04) * smooth((dur - t) / 0.012);
    ph += TAU * 98 / SR;
    x[i] = (y2 * 5 * blade + r * 9 + Math.sin(ph) * 0.012 + Math.sin(2 * ph) * 0.006) * ramp;
  }
  return normalise(x, 0.4);
}

/** A kitchen hood in Bengaluru: a motor hum with dark rushing air, on from the cut's first sample; it holds, then
 *  thins away from 2.4 s as the drone in F takes the bed (15.4 s in the film). */
function hood() {
  seed = 66;
  const dur = 4.4, n = Math.round(dur * SR), x = new Float32Array(n);
  let y = 0, y2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; y += 0.035 * (rnd() - y); y2 += 0.3 * (y - y2);
    ph += TAU * 118 / SR;
    const ramp = smooth(t / 0.012) * (t < 2.4 ? 1 : Math.exp(-(t - 2.4) / 0.55));
    x[i] = (y2 * 4.2 + Math.sin(ph) * 0.05 + Math.sin(2 * ph) * 0.025 + Math.sin(3 * ph) * 0.01) * ramp * (1 + 0.05 * Math.sin(TAU * 0.7 * t));
  }
  return normalise(x, 0.45);
}

for (let k = 1; k <= 4; k++) write(`pen${k}.wav`, pen(k));
write("peel.wav", peel());
write("whistle.wav", whistle());
write("ceiling.wav", ceiling());
write("hood.wav", hood());
