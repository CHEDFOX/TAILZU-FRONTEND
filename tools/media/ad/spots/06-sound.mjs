#!/usr/bin/env node
/* THE HOLD (spot 06): the sounds it needs beyond sound.mjs's kinds, made here so the page can play them as `sample`s.
 *
 *   node spots/06-sound.mjs        -> spots/06-sfx/*.wav (48 kHz mono 16-bit)
 *
 *   tick, tock     the wall clock at 60 bpm: dry, close, wooden (the bed to the stamp)
 *   amb-track      HOLD 1: a stadium hush and one breath, cut dead on the freeze (1.4 s)
 *   amb-room       HOLD 2: a quiet room and a chair creak, dead on the freeze (1.4 s)
 *   amb-platform   HOLD 3: the platform hum and a far two-note tone, no words, dead on the freeze (1.4 s)
 *   amb-wind       HOLD 4: wind and water far below, dead on the freeze (1.4 s)
 *   tape           a tape rip (every card)
 *   pen-yes        a dip pen writing one word, 0.7 s (the yes); pen-word: 0.5 s (the headline's hand word)
 *   stamp          the stamp: a dry thunk with a sub hit
 *   spikes         RELEASE 1: spikes on the track, three strides
 *   piece          RELEASE 2: a wooden piece set down on the board
 *   splash         RELEASE 3: a splash far below
 *   chime          RELEASE 4: a door chime (two notes) and the pull of the train
 *   train          the train pulling away under the headline, fading (6 s)
 *   sine           the thin high sine that joins the wait at 11.3 (G6, 3.2 s, cut dead)
 *
 * Everything is seeded noise and sines, so the same script gives the same files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(here, "06-sfx");
const SR = 48000, TAU = Math.PI * 2;
fs.mkdirSync(OUT, { recursive: true });
let seed = 6;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const N = (s) => Math.round(s * SR);
const buf = (s) => new Float32Array(N(s));
function write(name, s, peak = 0.9) {
  let m = 0; for (const v of s) m = Math.max(m, Math.abs(v)); const k = m > 0 ? peak / m : 1;
  const out = Buffer.alloc(44 + s.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + s.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * k * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, name + ".wav"), out); console.log(`${name}.wav  ${(s.length / SR).toFixed(2)} s`);
}
/** A two-pole resonant bandpass (RBJ), applied in place. */
function bandpass(s, f, q) {
  const w = TAU * f / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < s.length; i++) { const x = s[i], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; s[i] = y; } return s;
}
function lowpass(s, f) { const a = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < s.length; i++) { y += a * (s[i] - y); s[i] = y; } return s; }
function highpass(s, f) { const a = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < s.length; i++) { y += a * (s[i] - y); s[i] -= y; } return s; }
const noise = (s) => { const b = buf(s); for (let i = 0; i < b.length; i++) b[i] = rnd(); return b; };
const add = (dst, src, at = 0, g = 1) => { const i0 = N(at); for (let i = 0; i < src.length && i0 + i < dst.length; i++) if (i0 + i >= 0) dst[i0 + i] += src[i] * g; return dst; };
const env = (s, fn) => { for (let i = 0; i < s.length; i++) s[i] *= fn(i / SR, i / s.length); return s; };
const sine = (f, s, ph = 0) => { const b = buf(s); for (let i = 0; i < b.length; i++) b[i] = Math.sin(TAU * f * i / SR + ph); return b; };
/** The last few ms faded so a dead cut does not click. */
const deadEnd = (s, ms = 4) => { const n = N(ms / 1000); for (let i = 0; i < n; i++) s[s.length - 1 - i] *= i / n; return s; };
/** A tiny room (a few reflections) for the far sounds. */
function room(s, size = 1, mix = 0.35) {
  const out = Float32Array.from(s);
  for (const [ms, g] of [[23, 0.5], [37, 0.42], [53, 0.33], [71, 0.27], [97, 0.2], [131, 0.15], [173, 0.1], [229, 0.07]]) add(out, lowpass(Float32Array.from(s), 3000), ms * size / 1000, g * mix);
  return out;
}

// ------------------------------------------------------------------------------------------------ the clock
function knock(f1, f2, len, bright) {
  const s = buf(len), n = noise(len); highpass(n, 1500);
  for (let i = 0; i < s.length; i++) { const t = i / SR; s[i] = n[i] * Math.exp(-t / 0.0025) * bright + (Math.sin(TAU * f1 * t) * 0.8 + Math.sin(TAU * f2 * t) * 0.5) * Math.exp(-t / 0.012); }
  return s;
}
write("tick", knock(2350, 3900, 0.09, 0.9), 0.8);
write("tock", knock(1850, 3100, 0.09, 0.7), 0.75);

// ------------------------------------------------------------------------------------------------ the four ambiences (1.4 s each, cut dead)
{ // HOLD 1: a stadium far off, hushed (a low murmur), and one breath in, held to the freeze
  const L = 1.4, s = buf(L), crowd = noise(L); bandpass(crowd, 420, 0.7); lowpass(crowd, 900);
  env(crowd, (t) => 0.55 + 0.25 * Math.sin(TAU * t * 0.7) + 0.1 * Math.sin(TAU * t * 2.3));
  add(s, crowd, 0, 0.5);
  const air = noise(L); highpass(air, 2500); add(s, air, 0, 0.04);
  const br = noise(1.0); bandpass(br, 1300, 1.2); const br2 = noise(1.0); bandpass(br2, 2600, 2);
  for (let i = 0; i < br.length; i++) br[i] += br2[i] * 0.5;
  env(br, (t, k) => Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.15)), 1.6) * (k < 0.87 ? 1 : 0.4));   // the breath in, caught at the top
  add(s, br, 0.3, 0.9);
  write("amb-track", deadEnd(s), 0.7);
}
{ // HOLD 2: a quiet room; a chair creaks under someone leaning in
  const L = 1.4, s = buf(L), tone = noise(L); lowpass(tone, 500); add(s, tone, 0, 0.25);
  const creak = buf(0.42); let ph = 0;
  for (let i = 0; i < creak.length; i++) { const k = i / creak.length, rate = 38 + 34 * Math.sin(Math.PI * k) + 8 * Math.sin(TAU * k * 3); ph += rate / SR; if (ph >= 1) { ph -= 1; creak[i] = 1; } }
  const c1 = bandpass(Float32Array.from(creak), 620, 9), c2 = bandpass(Float32Array.from(creak), 1240, 12), c3 = bandpass(Float32Array.from(creak), 410, 7);
  const cr = buf(0.42); for (let i = 0; i < cr.length; i++) { const k = i / cr.length; cr[i] = (c1[i] + 0.6 * c2[i] + 0.7 * c3[i]) * Math.sin(Math.PI * k) ** 0.7; }
  add(s, room(cr, 0.7, 0.3), 0.45, 3.5);
  write("amb-room", deadEnd(s), 0.55);
}
{ // HOLD 3: the platform: a mains hum, the tunnel's rumble, and far off two notes (no words)
  const L = 1.4, s = buf(L);
  for (const [h, g] of [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2], [6, 0.12]]) add(s, sine(50 * h, L), 0, 0.12 * g);
  const rum = noise(L); lowpass(rum, 160); add(s, rum, 0, 0.9);
  const air = noise(L); bandpass(air, 900, 0.5); add(s, air, 0, 0.05);
  const ding = (f, len) => { const b = buf(len); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.01 * t) + 0.1 * Math.sin(TAU * f * 3.02 * t)) * (1 - Math.exp(-t / 0.01)) * Math.exp(-t / 0.35); } return b; };
  const two = buf(1.1); add(two, ding(783.99, 0.9), 0); add(two, ding(659.25, 0.9), 0.32);
  lowpass(two, 2200); add(s, room(two, 2.2, 0.8), 0.25, 0.22);
  write("amb-platform", deadEnd(s), 0.6);
}
{ // HOLD 4: wind across the platform, high up; water far below
  const L = 1.4, s = buf(L), w = noise(L), w2 = noise(L);
  bandpass(w, 520, 0.9); bandpass(w2, 1150, 1.6);
  env(w, (t) => 0.6 + 0.4 * Math.sin(TAU * t * 0.55 + 1)); env(w2, (t) => 0.3 + 0.3 * Math.sin(TAU * t * 0.9));
  add(s, w, 0, 0.8); add(s, w2, 0, 0.35);
  const water = noise(L); lowpass(water, 700); env(water, (t) => 0.25 + 0.2 * Math.max(0, Math.sin(TAU * t * 1.3)) ** 3); add(s, water, 0, 0.6);
  write("amb-wind", deadEnd(s), 0.6);
}

// ------------------------------------------------------------------------------------------------ paper, pen, stamp
{ // tape: a short sticky rip, crackling
  const L = 0.24, s = noise(L); highpass(s, 1800);
  let crack = 0; env(s, (t, k) => { if (rnd() > 0.985) crack = 1; crack *= 0.996; return (0.35 + 0.65 * crack) * Math.min(1, t / 0.006) * Math.exp(-Math.max(0, k - 0.55) * 7); });
  const body = noise(L); bandpass(body, 700, 1.2); env(body, (t) => Math.exp(-t / 0.05)); add(s, body, 0, 0.6);
  write("tape", s, 0.8);
}
/** A dip pen: strokes of scratchy noise (bright, gritty), each a small swell. */
function pen(len, strokes) {
  const s = buf(len), n = noise(len), g = noise(len); bandpass(n, 3800, 1.5); bandpass(g, 1900, 3);
  for (const [a, b] of strokes) { const i0 = N(a), i1 = N(b); for (let i = i0; i < i1 && i < s.length; i++) { const k = (i - i0) / (i1 - i0), grit = rnd() > 0.93 ? 1.6 : 1; s[i] += (n[i] + 0.6 * g[i]) * Math.sin(Math.PI * k) ** 0.6 * grit; } }
  return s;
}
write("pen-yes", pen(0.72, [[0.0, 0.1], [0.12, 0.26], [0.28, 0.44], [0.46, 0.6], [0.6, 0.7]]), 0.55);
write("pen-word", pen(0.55, [[0.0, 0.14], [0.16, 0.3], [0.32, 0.5]]), 0.55);
{ // the stamp: a dry wooden thunk on paper, and a sub hit under it
  const L = 0.7, s = buf(L);
  const slap = noise(0.06); bandpass(slap, 900, 0.8); env(slap, (t) => Math.exp(-t / 0.008)); add(s, slap, 0, 1.2);
  const knk = buf(0.2); for (let i = 0; i < knk.length; i++) { const t = i / SR; knk[i] = (Math.sin(TAU * 165 * t) + 0.5 * Math.sin(TAU * 310 * t)) * Math.exp(-t / 0.03); } add(s, knk, 0, 1);
  const sub = buf(0.7); let ph = 0; for (let i = 0; i < sub.length; i++) { const t = i / SR, f = 38 + 30 * Math.exp(-t * 18); ph += TAU * f / SR; sub[i] = Math.sin(ph) * Math.exp(-t / 0.22) * Math.min(1, t / 0.003); } add(s, sub, 0, 1.3);
  write("stamp", s, 0.95);
}

// ------------------------------------------------------------------------------------------------ the four releases
{ // spikes on the track: three strides, gritty
  const L = 0.42, s = buf(L);
  for (const [at, g] of [[0.0, 1], [0.15, 0.85], [0.29, 0.75]]) {
    const c = noise(0.07); bandpass(c, 2600, 0.9); env(c, (t) => Math.exp(-t / 0.012) * (rnd() > 0.7 ? 1.4 : 1)); add(s, c, at, g);
    const th = buf(0.08); for (let i = 0; i < th.length; i++) { const t = i / SR; th[i] = Math.sin(TAU * 95 * t) * Math.exp(-t / 0.02); } add(s, th, at, 0.7 * g);
  }
  write("spikes", s, 0.8);
}
{ // a wooden piece set down: the click, the board's small thud
  const L = 0.3, s = buf(L);
  const ck = buf(0.12); for (let i = 0; i < ck.length; i++) { const t = i / SR; ck[i] = (Math.sin(TAU * 1850 * t) + 0.7 * Math.sin(TAU * 2930 * t) + 0.4 * Math.sin(TAU * 950 * t)) * Math.exp(-t / 0.009); }
  const nz = noise(0.02); highpass(nz, 2000); env(nz, (t) => Math.exp(-t / 0.002)); add(ck, nz, 0, 0.8);
  add(s, room(ck, 0.4, 0.25), 0, 1);
  const th = buf(0.1); for (let i = 0; i < th.length; i++) { const t = i / SR; th[i] = Math.sin(TAU * 140 * t) * Math.exp(-t / 0.025); } add(s, th, 0, 0.5);
  write("piece", s, 0.8);
}
{ // a splash, far below: a burst, a spray, a bubbling tail
  const L = 0.9, s = buf(L), b = noise(L); lowpass(b, 2400);
  env(b, (t) => Math.min(1, t / 0.012) * (Math.exp(-t / 0.12) * 0.9 + Math.exp(-t / 0.45) * 0.25));
  add(s, b, 0, 1);
  const sp = noise(L); highpass(sp, 3000); env(sp, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.2)); add(s, sp, 0, 0.35);
  const thump = buf(0.25); for (let i = 0; i < thump.length; i++) { const t = i / SR; thump[i] = Math.sin(TAU * 70 * t) * Math.exp(-t / 0.05); } add(s, thump, 0, 0.6);
  write("splash", room(s, 1.5, 0.4), 0.75);
}
{ // a door chime (two notes, down) and the train pulling: a rising rumble, two rail joints
  const L = 1.2, s = buf(L);
  const ding = (f, len) => { const b = buf(len); for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2 * t)) * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.22); } return b; };
  add(s, ding(1046.5, 0.6), 0, 0.5); add(s, ding(880, 0.6), 0.14, 0.45);
  const rum = noise(L); lowpass(rum, 220); env(rum, (t, k) => Math.min(1, k * 2.5)); add(s, rum, 0, 1.8);
  const whine = buf(L); let ph = 0; for (let i = 0; i < whine.length; i++) { const k = i / whine.length; ph += TAU * (300 + 500 * k) / SR; whine[i] = Math.sin(ph) * k * 0.6; } add(s, whine, 0, 0.12);
  for (const at of [0.18, 0.31]) { const j = buf(0.06); for (let i = 0; i < j.length; i++) { const t = i / SR; j[i] = (Math.sin(TAU * 120 * t) + rnd() * 0.4) * Math.exp(-t / 0.012); } add(s, j, at, 0.5); }
  write("chime", s, 0.8);
}
{ // the train under the headline: the rumble going away (lower, darker), a far squeal, gone
  const L = 6, s = buf(L), r = noise(L); lowpass(r, 260); env(r, (t) => Math.exp(-t / 1.4));
  add(s, r, 0, 1.6);
  const hum = buf(L); let ph = 0; for (let i = 0; i < hum.length; i++) { const t = i / SR; ph += TAU * (480 - 120 * Math.min(1, t / 3)) / SR; hum[i] = Math.sin(ph) * Math.exp(-t / 1.1); } add(s, hum, 0, 0.05);
  const air = noise(L); bandpass(air, 700, 0.6); env(air, (t) => Math.exp(-t / 2.2)); add(s, air, 0, 0.1);
  for (const at of [0.25, 0.55, 1.05, 1.6, 2.3]) { const j = buf(0.07); for (let i = 0; i < j.length; i++) { const t = i / SR; j[i] = (Math.sin(TAU * 105 * t) + rnd() * 0.3) * Math.exp(-t / 0.015); } lowpass(j, 600); add(s, j, at, 0.35 * Math.exp(-at / 1.2)); }
  env(s, (t, k) => (k > 0.85 ? (1 - k) / 0.15 : 1));
  write("train", s, 0.75);
}
{ // the thin high sine of the wait: G6, a breath of vibrato, swelling in, cut dead
  const L = 3.2, s = buf(L); let ph = 0;
  for (let i = 0; i < s.length; i++) { const t = i / SR; ph += TAU * 1567.98 * (1 + 0.0015 * Math.sin(TAU * 4.6 * t)) / SR; s[i] = Math.sin(ph) * Math.min(1, t / 1.6) ** 2; }
  write("sine", deadEnd(s, 3), 0.5);
}
