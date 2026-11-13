#!/usr/bin/env node
/* LEAVE AT 4:40 (spot 05): the sounds it needs beyond sound.mjs's kinds, made here so the page plays them as `sample`s.
 *
 *   node spots/05-sound.mjs     -> spots/05-sfx/*.wav
 *
 *   room.wav       shot 1's bed (5.0 s): a quiet room and a distant street (one car going by far off); cut hard at 5.0
 *   platform.wav   shot 2's bed (10.5 s): the air of a big underground hall, its ventilation; in hard on the cut, out hard
 *   train.wav      the train rolling out (8.6 s from the cut): already moving, gathering speed, passing, then gone down
 *                  the tunnel as its tail clears the frame (about 7 s in); no rail joints (no pulse in this film)
 *   sigh.wav       the brakes letting go: a pneumatic sigh in the hall
 *   chime.wav      the doors' chime, no words: two soft notes, E then C sharp (in A), in the hall
 *   tape.wav       a strip of tape: the peel, then the press
 *   pen-1..4.wav   her pen on the card, one per handwritten word, as long as the word takes to write
 *   pen-when.wav   the pen on the headline's 'when'
 *
 * Everything is seeded additive synthesis and filtered noise, so the same script gives the same files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(here, "05-sfx");
const SR = 48000, TAU = Math.PI * 2;
fs.mkdirSync(OUT, { recursive: true });

let seed = 5;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const N = (s) => Math.ceil(s * SR);
function writeWav(name, s, peak) {
  let m = 0; for (const v of s) m = Math.max(m, Math.abs(v)); const k = peak / (m || 1);
  const out = Buffer.alloc(44 + s.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + s.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * k * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, name), out);
  console.log(`${name.padEnd(14)} ${(s.length / SR).toFixed(2)} s  peak ${peak}`);
}

// ------------------------------------------------------------------------------------------------ filters
/** One-pole lowpass at fc Hz (fc may be a function of the sample index). */
function lp(x, fc) { const o = new Float32Array(x.length); let y = 0; for (let i = 0; i < x.length; i++) { const f = typeof fc === "function" ? fc(i) : fc, a = 1 - Math.exp(-TAU * f / SR); y += a * (x[i] - y); o[i] = y; } return o; }
function hp(x, fc) { const l = lp(x, fc), o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] - l[i]; return o; }
/** A resonant bandpass (biquad, RBJ) at f Hz with quality q (f may be a function of the sample index). */
function bp(x, f, q) {
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof f === "function" ? f(i) : f, w = TAU * fc / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y;
  }
  return o;
}
const white = (n) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = rnd(); return o; };
const mix = (n, ...parts) => { const o = new Float32Array(n); for (const [s, g = 1, at = 0] of parts) { const i0 = Math.round(at * SR); for (let i = 0; i < s.length && i0 + i < n; i++) if (i0 + i >= 0) o[i0 + i] += s[i] * g; } return o; };
const shape = (x, f) => { for (let i = 0; i < x.length; i++) x[i] *= f(i / SR); return x; };
const fade = (x, a, r) => shape(x, (t) => Math.min(1, a > 0 ? t / a : 1, r > 0 ? (x.length / SR - t) / r : 1));
const smooth = (k) => { const c = Math.max(0, Math.min(1, k)); return c * c * (3 - 2 * c); };

// ------------------------------------------------------------------------------------------------ a hall (FFT convolution)
function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr; re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function convolve(x, h) {
  let n = 1; while (n < x.length + h.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(h); fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] - ai[i] * bi[i], m = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true); return Float32Array.from(ar.subarray(0, x.length + h.length - 1));
}
/** An underground hall: tiled, long, RT60 about 2.2 s, darkening as it decays; a few hard early reflections off the tiles. */
function hallIR(rt = 2.2) {
  const n = N(rt * 1.1), h = new Float32Array(n), tau = rt / 6.91; let y = 0;
  for (let i = N(0.012); i < n; i++) { const t = i / SR, al = 0.55 - 0.45 * Math.min(1, t / rt); y += al * (rnd() - y); h[i] = y * Math.exp(-t / tau); }
  for (const [ms, g] of [[19, 0.45], [31, -0.33], [47, 0.28], [66, -0.2], [93, 0.15]]) h[N(ms / 1000)] += g;
  let e = 0; for (const v of h) e += v * v; const k = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) h[i] *= k; return h;
}
function inHall(dry, wet, rt = 2.2, len) { const w = convolve(dry, hallIR(rt)), n = len ? N(len) : w.length, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (i < dry.length ? dry[i] : 0) * (1 - wet) + (w[i] ?? 0) * wet * 0.5; return o; }

// ------------------------------------------------------------------------------------------------ the sounds
function room() {
  seed = 21; const len = 5.0, n = N(len);
  const tone = lp(lp(white(n), 120), 160);                                   // the room itself: air, low
  const air = shape(hp(lp(white(n), 2400), 500), () => 0.12);                 // a faint upper air through the window
  // the street, far off: a broad low murmur, and one car passing between 1.2 and 4.4 s
  const murmur = shape(lp(bp(white(n), 260, 0.7), 700), (t) => 0.55 + 0.25 * Math.sin(TAU * t / 3.7));
  const car = shape(bp(white(n), (i) => 380 + 140 * Math.sin(Math.PI * Math.min(1, Math.max(0, (i / SR - 1.2) / 3.2))), 0.9), (t) => { const k = (t - 1.2) / 3.2; return k <= 0 || k >= 1 ? 0 : Math.pow(Math.sin(Math.PI * k), 2.2) * 1.2; });
  const s = mix(n, [tone, 2.2], [air, 1], [murmur, 0.5], [car, 0.55]);
  fade(s, 0.08, 0.012);
  writeWav("room.wav", s, 0.13);
}
function platform() {
  seed = 33; const len = 10.5, n = N(len);
  const vent = lp(lp(white(n), 90), 140);                                     // the ventilation, deep
  const hum = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; hum[i] = Math.sin(TAU * 50 * t) * 0.15 + Math.sin(TAU * 100 * t) * 0.08; }
  const hall = shape(lp(hp(white(n), 300), 2600), (t) => 0.5 + 0.18 * Math.sin(TAU * t / 5.3 + 1));   // the hall's own wash
  const s = mix(n, [vent, 2.4], [hum, 0.35], [hall, 0.16]);
  fade(s, 0.008, 0.03);
  writeWav("platform.wav", s, 0.16);
}
function train() {
  // film time from the cut: rolling from 0, gathering speed to about 2.5, passing loud, the tail clears at about 7.0,
  // then it goes down the tunnel and is gone by 8.4
  seed = 47; const len = 8.6, n = N(len);
  const lvl = (t) => (t < 2.6 ? 0.62 + 0.38 * smooth(t / 2.6) : t < 6.4 ? 1 : t < 7.1 ? 1 - 0.45 * smooth((t - 6.4) / 0.7) : 0.55 * Math.pow(Math.max(0, 1 - (t - 7.1) / 1.3), 1.6));
  const close = (i) => { const t = i / SR; return t < 6.6 ? 900 : 900 - 650 * smooth((t - 6.6) / 1.5); };   // the tunnel swallows the top
  const rumble = shape(lp(lp(white(n), 70), 110), (t) => lvl(t));
  const roll = shape(lp(bp(white(n), (i) => 520 + 120 * smooth(i / SR / 3), 0.6), close), (t) => lvl(t));
  // the motor's whine, rising with the speed, quiet
  const whine = new Float32Array(n); let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 240 + 230 * smooth(t / 3.2); ph += TAU * f / SR; ph2 += TAU * f * 2.01 / SR; whine[i] = (Math.sin(ph) + 0.4 * Math.sin(ph2)) * lvl(t) * (t < 7.1 ? 1 : Math.max(0, 1 - (t - 7.1) / 0.9)); }
  // no rail joints: a joint's knock is a pulse, and this film has none
  // a flange squeal as it takes the curve out
  const squeal = shape(bp(white(n), (i) => 2900 + 120 * Math.sin(i / SR * 3.1), 40), (t) => { const k = (t - 5.6) / 2.2; return k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k) * 0.9; });
  const dry = mix(n, [rumble, 2.6], [roll, 0.9], [whine, 0.05], [squeal, 0.5]);
  const s = inHall(dry, 0.42, 2.0, len);
  fade(s, 0.004, 0.3);
  writeWav("train.wav", s, 0.42);
}
function sigh() {
  seed = 59; const len = 2.6, d = N(1.1);
  const burst = shape(bp(white(d), (i) => 4200 - 1800 * (i / d), 1.1), (t) => (t < 0.012 ? t / 0.012 : 1) * Math.exp(-(t - 0.012) / 0.32));
  const body = shape(lp(white(d), 900), (t) => (t < 0.01 ? t / 0.01 : 1) * Math.exp(-t / 0.18) * 0.5);
  const s = inHall(mix(d, [burst, 1], [body, 0.6]), 0.5, 2.2, len);
  fade(s, 0, 0.2);
  writeWav("sigh.wav", s, 0.3);
}
function chime() {
  seed = 61; const len = 3.4, d = N(1.6);
  const note = (f) => { const o = new Float32Array(d); for (let i = 0; i < d; i++) { const t = i / SR, e = (t < 0.006 ? t / 0.006 : 1) * Math.exp(-t / 0.42); o[i] = (Math.sin(TAU * f * t) + 0.22 * Math.sin(TAU * f * 2 * t) * Math.exp(-t / 0.15) + 0.06 * Math.sin(TAU * f * 3.01 * t)) * e; } return o; };
  const dry = mix(N(2.2), [note(659.25), 1, 0], [note(554.37), 0.95, 0.42]);
  const s = inHall(dry, 0.45, 2.2, len);
  fade(s, 0, 0.25);
  writeWav("chime.wav", s, 0.26);
}
function tape() {
  seed = 71; const n = N(0.42);
  // the peel: a dry crackle, brightening
  const peel = new Float32Array(n);
  for (let i = 0; i < N(0.16); i++) { const t = i / SR; peel[i] = rnd() * (0.4 + 0.6 * (rnd() > 0.82 ? 1 : 0.25)) * (t / 0.16); }
  const crack = hp(peel, 1800);
  // the press: the card meeting the door, a soft knock
  const press = new Float32Array(n); for (let i = 0; i < N(0.08); i++) { const t = i / SR; press[i] = (Math.sin(TAU * 140 * t) * 0.6 + rnd() * 0.4) * Math.exp(-t / 0.02); }
  const s = mix(n, [crack, 0.7], [lp(press, 1400), 1, 0.19]);
  fade(s, 0.002, 0.05);
  writeWav("tape.wav", s, 0.36);
}
/** A pen nib on paper for `d` seconds: strokes of high, dry scratch, uneven, the way a hand writes. */
function pen(name, d, s0) {
  seed = s0; const n = N(d + 0.05), strokes = [];
  for (let t = 0.005; t < d - 0.02;) { const len = 0.035 + 0.05 * (rnd() * 0.5 + 0.5); strokes.push([t, len, 0.55 + 0.45 * (rnd() * 0.5 + 0.5)]); t += len * (0.75 + 0.3 * (rnd() * 0.5 + 0.5)); }
  const env = new Float32Array(n);
  for (const [t0, len, g] of strokes) for (let i = 0; i < N(len); i++) { const k = i / N(len); env[N(t0) + i] = Math.max(env[N(t0) + i], g * Math.sin(Math.PI * k) ** 0.7); }
  const nib = bp(hp(white(n), 2200), (i) => 4600 + 1500 * Math.sin(i / SR * 37), 0.8);
  const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = nib[i] * env[i];
  fade(s, 0.002, 0.02);
  writeWav(name, s, 0.2);
}

room(); platform(); train(); sigh(); chime(); tape();
[[0.32, 101], [0.20, 102], [0.12, 103], [0.22, 104]].forEach(([d, sd], i) => pen(`pen-${i + 1}.wav`, d, sd));
pen("pen-when.wav", 0.5, 105);
