#!/usr/bin/env node
/* GO LIVE (spot 07): the sounds it needs beyond sound.mjs's kinds, made here so the page plays them as `sample`s.
 *
 *   node spots/07-sound.mjs      -> spots/07-sfx/*.wav
 *
 *   tick, tock   the wall clock's escapement (60 bpm from the lift to the stamp)
 *   room         the night room under the typing, 2.6 s, cut dead on the freeze
 *   pad          wind across the pad and the vent's hiss, 1.6 s (4.4-6.0), hard in on the cut, dead on the freeze
 *   tape         a tape strip torn and pressed (every card)
 *   slide        paper sliding on paper (the question card)
 *   pen-yes      a dip pen writing 'yes' across the button, 0.7 s;  pen-hand  the headline's 'yes', 0.5 s
 *   thunk        the rubber stamp: a dry knock on the desk under the paper (the sub is sound.mjs's boom)
 *   chairs       a room of chairs pushed back as the firing room stands
 *   rumble       the long low roar of the climb, 4.9 s, into the end card
 *   sine         the thin high sine from 10.0, 3.0 s, cut dead by the stamp
 *
 * Everything is seeded, so the same run gives the same files. The lengths follow spots/07.js's timeline.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(here, "07-sfx");
const SR = 48000, TAU = Math.PI * 2;
fs.mkdirSync(OUT, { recursive: true });

let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const buf = (sec) => new Float32Array(Math.round(sec * SR));
function writeWav(name, s) {
  const out = Buffer.alloc(44 + s.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + s.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, name + ".wav"), out);
  let pk = 0; for (const v of s) pk = Math.max(pk, Math.abs(v));
  console.log(`${name}.wav  ${(s.length / SR).toFixed(2)} s  peak ${pk.toFixed(2)}`);
}
function norm(o, peak) { let m = 0; for (const v of o) m = Math.max(m, Math.abs(v)); const k = peak / (m || 1); for (let i = 0; i < o.length; i++) o[i] *= k; return o; }
/** A damped resonance at f, decaying with tau, struck at i0. */
function ring(o, i0, f, tau, g) { for (let i = 0; i + i0 < o.length; i++) { const t = i / SR, e = Math.exp(-t / tau); if (e < 1e-4) break; o[i0 + i] += Math.sin(TAU * f * t) * e * g; } }
/** A noise burst through a band (one-pole low-pass al minus a slower one hp), attack a, decay tau. */
function burst(o, i0, a, tau, g, al = 0.6, hp = 0.05) { let y = 0, z = 0; for (let i = 0; i + i0 < o.length; i++) { const t = i / SR, e = (t < a ? t / a : 1) * Math.exp(-Math.max(0, t - a) / tau); if (t > a && e < 1e-4) break; const r = rnd(); y += al * (r - y); z += hp * (y - z); o[i0 + i] += (y - z) * e * g; } }
/** A two-pole resonant band-pass (state-variable filter) over a signal, centre f(i), damping q. */
function svf(x, fOf, q = 0.2) { const o = new Float32Array(x.length); let lo = 0, bp = 0; for (let i = 0; i < x.length; i++) { const f = 2 * Math.sin(Math.PI * Math.min(0.24, fOf(i) / SR)); const hi = x[i] - lo - q * bp; bp += f * hi; lo += f * bp; o[i] = bp; } return o; }
/** In over a, out over r (seconds), a smooth window over n samples. */
const win = (i, n, a, r) => { const t = i / SR, T = n / SR, x = Math.min(a > 0 ? t / a : 1, r > 0 ? (T - t) / r : 1, 1); return x <= 0 ? 0 : x * x * (3 - 2 * x); };

// ------------------------------------------------------------------------------------------------ the clock
seed = 31;
{ const o = buf(0.12); burst(o, 0, 0.0004, 0.0035, 1, 0.9, 0.22); ring(o, 0, 2780, 0.011, 0.5); ring(o, 0, 4300, 0.006, 0.28); ring(o, 0, 1240, 0.018, 0.22); writeWav("tick", norm(o, 0.5)); }
{ const o = buf(0.14); burst(o, 0, 0.0005, 0.0045, 1, 0.8, 0.16); ring(o, 0, 1960, 0.015, 0.5); ring(o, 0, 3350, 0.008, 0.24); ring(o, 0, 860, 0.024, 0.3); writeWav("tock", norm(o, 0.5)); }

// ------------------------------------------------------------------------------------------------ the beds
seed = 41;
{ // the night room: dark air, the laptop's faint fan, a far hum; in quickly, out in 4 ms (a cut is a cut)
  const n = Math.round(2.6 * SR), o = new Float32Array(n); let a1 = 0, a2 = 0, f1 = 0, f2 = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, w = rnd(); a1 += 0.02 * (w - a1); a2 += 0.004 * (rnd() - a2); f1 += 0.35 * (rnd() - f1); f2 += 0.08 * (f1 - f2);
    const fan = (f1 - f2) * 0.05 * (1 + 0.15 * Math.sin(TAU * 3.1 * t)), hum = (Math.sin(TAU * 50 * t) * 0.5 + Math.sin(TAU * 100 * t) * 0.3) * 0.004;
    o[i] = (a1 * 0.5 + a2 * 1.4 + fan + hum) * win(i, n, 0.06, 0.004); }
  writeWav("room", norm(o, 0.16));
}
{ // the pad: wind in gusts (dark, moving) and the vent's steady hiss (a narrow bright band, fluttering), cut both ends
  const n = Math.round(1.6 * SR), w = new Float32Array(n), hs = new Float32Array(n); let a = 0, b = 0, g = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; a += 0.012 * (rnd() - a); b += 0.0025 * (rnd() - b); g += 0.00004 * (rnd() - g); w[i] = (a * 1.3 + b * 2.2) * (0.75 + 0.25 * Math.sin(TAU * t / 1.3 + 0.8) + 3 * g); hs[i] = rnd(); }
  const hiss = svf(hs, (i) => 5200 + 400 * Math.sin(TAU * 7 * i / SR), 0.35);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (w[i] * 0.9 + hiss[i] * 0.07 * (1 + 0.12 * Math.sin(TAU * 23 * i / SR))) * win(i, n, 0.004, 0.004);
  writeWav("pad", norm(o, 0.32));
}
{ // the paper world's air: almost nothing (a still room, far under the clock), 6.8-13.3, so the silence is a room, not a dropout
  const n = Math.round(6.5 * SR), o = new Float32Array(n); let a = 0, b = 0;
  for (let i = 0; i < n; i++) { a += 0.015 * (rnd() - a); b += 0.003 * (rnd() - b); o[i] = (a * 0.6 + b * 1.6) * win(i, n, 0.004, 0.004); }
  writeWav("air", norm(o, 0.012));
}

// ------------------------------------------------------------------------------------------------ paper
seed = 51;
{ // tape: the strip pulled off the roll (a crackling tear, stick-slip), then pressed down (a soft pat)
  const o = buf(0.42), n = Math.round(0.24 * SR); let y = 0, z = 0, slip = 0;
  for (let i = 0; i < n; i++) { const k = i / n; if (rnd() > 0.93 - 0.05 * k) slip = 1; slip *= 0.985; const r = rnd(); y += 0.55 * (r - y); z += 0.07 * (y - z); o[i] += (y - z) * (0.25 + 0.75 * slip) * Math.sin(Math.PI * Math.min(1, k * 1.1)) ** 0.7; }
  const i1 = Math.round(0.3 * SR); burst(o, i1, 0.002, 0.02, 0.6, 0.15, 0.02); ring(o, i1, 160, 0.03, 0.12);
  writeWav("tape", norm(o, 0.5));
}
{ // paper on paper: a soft, breathy slide with a little friction in it
  const n = Math.round(0.4 * SR), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rnd();
  const b = svf(x, (i) => 1800 + 1400 * (i / n), 0.6), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const k = i / n; o[i] = b[i] * Math.sin(Math.PI * k) ** 1.4 * (0.85 + 0.15 * Math.sin(TAU * 47 * i / SR)); }
  writeWav("slide", norm(o, 0.3));
}
/** A dip pen writing a word: strokes of fine scratch (a bright band, grainy), with lifts between. */
function pen(strokes, len) {
  const o = buf(len);
  for (const [at, d, f] of strokes) {
    const i0 = Math.round(at * SR), n = Math.round(d * SR), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rnd();
    const b = svf(x, (i) => f * (1 + 0.25 * Math.sin(TAU * (6 + 3 * Math.abs(rnd())) * i / SR)), 0.5);
    for (let i = 0; i < n && i0 + i < o.length; i++) { const k = i / n, grain = 0.7 + 0.3 * Math.sin(TAU * 38 * i / SR) * Math.sin(TAU * 11 * i / SR); o[i0 + i] += b[i] * Math.sin(Math.PI * k) ** 1.2 * grain; }
  }
  return o;
}
seed = 61;
writeWav("pen-yes", norm(pen([[0.0, 0.17, 3400], [0.2, 0.1, 3900], [0.31, 0.14, 3600], [0.47, 0.19, 3200]], 0.72), 0.34));
writeWav("pen-hand", norm(pen([[0.0, 0.12, 3500], [0.14, 0.08, 4000], [0.24, 0.1, 3700], [0.36, 0.13, 3300]], 0.52), 0.34));
{ // the stamp: rubber on paper on a wooden desk, very dry
  const o = buf(0.32); burst(o, 0, 0.0004, 0.006, 1.0, 0.5, 0.08); burst(o, 0, 0.001, 0.025, 0.5, 0.12, 0.01);
  ring(o, 0, 182, 0.05, 1.0); ring(o, 0, 430, 0.03, 0.5); ring(o, 0, 1250, 0.01, 0.25); ring(o, 0, 74, 0.07, 0.6);
  writeWav("thunk", norm(o, 0.85));
}

// ------------------------------------------------------------------------------------------------ the release
seed = 71;
{ // a room of chairs: a dozen scrapes and knocks in the first 0.8 s, near and far, then the room settling
  const o = buf(1.6);
  for (let c = 0; c < 13; c++) {
    const at = 0.02 + 0.75 * Math.abs(rnd()) ** 1.4, d = 0.18 + 0.28 * Math.abs(rnd()), far = 0.35 + 0.65 * Math.abs(rnd()), f0 = 380 + 700 * Math.abs(rnd()), glide = 1 + 0.5 * rnd();
    const i0 = Math.round(at * SR), n = Math.round(d * SR), x = new Float32Array(n), rate = 35 + 55 * Math.abs(rnd());
    let slip = 0; for (let i = 0; i < n; i++) { if (((i * rate / SR) % 1) < rate / SR) slip = 1; slip *= 0.9993; x[i] = rnd() * (0.3 + 0.7 * slip); }
    const b = svf(x, (i) => f0 * (1 + (glide - 1) * i / n), 0.18);
    for (let i = 0; i < n && i0 + i < o.length; i++) o[i0 + i] += b[i] * Math.sin(Math.PI * i / n) ** 0.8 * far * 0.6;
    if (Math.abs(rnd()) > 0.45) { const ik = i0 + n - Math.round(0.01 * SR); burst(o, ik, 0.0006, 0.012, 0.5 * far, 0.4, 0.05); ring(o, ik, 140 + 90 * Math.abs(rnd()), 0.04, 0.35 * far); }
  }
  { let a = 0; for (let i = 0; i < o.length; i++) { a += 0.01 * (rnd() - a); o[i] += a * 0.25 * win(i, o.length, 0.05, 0.9); } }   // the room's air, moving
  writeWav("chairs", norm(o, 0.7));
}
{ // the climb: a deep roar (brown noise, swelling), its crackle (sparse bright cracks), a slow beat in it; 0.25 s in, out over the end card
  const n = Math.round(4.9 * SR), o = new Float32Array(n); let b1 = 0, b2 = 0, b3 = 0, cr = 0, ce = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, w = rnd(); b1 += 0.02 * (w - b1); b2 += 0.004 * (b1 - b2); b3 += 0.1 * (w - b3);
    if (rnd() > 0.9965) ce = 0.6 + 0.4 * Math.abs(rnd()); ce *= 0.9975; cr += 0.45 * (rnd() - cr);
    const swell = 0.8 + 0.2 * Math.sin(TAU * t / 2.7) * Math.sin(TAU * t / 1.1 + 0.4);
    o[i] = (b2 * 9 + b1 * 1.6 + b3 * 0.1 + cr * ce * 0.22) * swell * win(i, n, 0.25, 1.25);
  }
  writeWav("rumble", norm(o, 0.75));
}
{ // the thin high sine: E6, in over 1.6 s, cut dead (4 ms) on the stamp
  const n = Math.round(3.0 * SR), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; o[i] = (Math.sin(TAU * 1318.51 * t) + 0.04 * Math.sin(TAU * 2637.02 * t)) * win(i, n, 1.6, 0.004); }
  writeWav("sine", norm(o, 0.12));
}
