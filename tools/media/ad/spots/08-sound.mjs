#!/usr/bin/env node
/* IN ONE SENTENCE (spot 08): the sound it needs beyond sound.mjs's kinds, made here so the page can play it as `sample`s.
 *
 *   node spots/08-sound.mjs voice   voice/08-1.wav (one voice.mjs call, Neerja -5 %) with the beat after "calendar..."
 *                                   opened from the read's 0.2 s to 0.55 s: voice/08-1p.wav + 08-1p.json (word times moved)
 *   node spots/08-sound.mjs sfx     the one-shots and beds -> spots/08-sfx/*.wav: the lamp switch, the hallway with the
 *                                   fridge, pen scratches (one a word), the pencil, the nib on the rule, the paper slide,
 *                                   the tape rip, the bar's creak, the blink's squeak, morning air with far footfalls,
 *                                   the brush swish
 *
 * Everything is seeded, so the same inputs give the same files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const AD_DIR = path.resolve(here, ".."), VOICE = path.join(AD_DIR, "voice"), SFX = path.join(here, "08-sfx");
const SR = 48000, TAU = Math.PI * 2;

function readWav(file) {
  const b = fs.readFileSync(file); let p = 12, rate = SR, ch = 1, data = null;
  while (p + 8 <= b.length) { const id = b.toString("ascii", p, p + 4), n = b.readUInt32LE(p + 4); if (id === "fmt ") { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); } else if (id === "data") { data = b.subarray(p + 8, p + 8 + n); break; } p += 8 + n + (n & 1); }
  const n = data.length / (2 * ch), s = new Float32Array(n); for (let i = 0; i < n; i++) { let a = 0; for (let q = 0; q < ch; q++) a += data.readInt16LE((i * ch + q) * 2); s[i] = a / ch / 32768; }
  if (rate !== SR) throw new Error(`${file}: ${rate} Hz`); return s;
}
function writeWav(file, s) {
  const out = Buffer.alloc(44 + s.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + s.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, out);
}
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const N = (sec) => Math.ceil(sec * SR);
/** One-pole filters, chained by hand. */
const lp = (s, a) => { let y = 0; const o = new Float32Array(s.length); for (let i = 0; i < s.length; i++) { y += a * (s[i] - y); o[i] = y; } return o; };
const hp = (s, a) => { const l = lp(s, a); return s.map((v, i) => v - l[i]); };
const bp = (s, lo, hi) => hp(lp(s, hi), lo);
/** A two-pole resonator (a body that rings at f with quality q). */
function reson(s, f, q) { const w = TAU * f / SR, r = Math.exp(-w / (2 * q)), a1 = 2 * r * Math.cos(w), a2 = -r * r; let y1 = 0, y2 = 0; const o = new Float32Array(s.length); for (let i = 0; i < s.length; i++) { const y = s[i] * (1 - r) + a1 * y1 + a2 * y2; o[i] = y; y2 = y1; y1 = y; } return o; }
const norm = (s, peak) => { let m = 0; for (const v of s) m = Math.max(m, Math.abs(v)); return m ? s.map((v) => v / m * peak) : s; };
const env = (n, a, r, i) => { const t = i / SR, T = n / SR; return Math.min(1, t / a, (T - t) / r); };
const mixAt = (dst, src, at, g = 1) => { const i0 = Math.round(at * SR); for (let i = 0; i < src.length && i0 + i < dst.length; i++) dst[i0 + i] += src[i] * g; };

// ------------------------------------------------------------------------------------------------ the voice, with its beat
function voice() {
  const s = readWav(path.join(VOICE, "08-1.wav")), words = JSON.parse(fs.readFileSync(path.join(VOICE, "08-1.json"), "utf8"));
  // the quietest 10 ms between "calendar" and "and" is the cut; 0.35 s of the read's own floor is laid in there
  const a = words[8].t1, b = words[9].t0; let best = a, bestE = Infinity;
  for (let t = a; t < b - 0.01; t += 0.002) { let e = 0; const i0 = Math.round(t * SR); for (let i = 0; i < 480; i++) e += s[i0 + i] ** 2; if (e < bestE) { bestE = e; best = t + 0.005; } }
  const cut = Math.round(best * SR), gap = Math.round(0.35 * SR), out = new Float32Array(s.length + gap);
  out.set(s.subarray(0, cut), 0); out.set(s.subarray(cut), cut + gap);
  writeWav(path.join(VOICE, "08-1p.wav"), out);
  const moved = words.map((w, i) => (i >= 9 ? { ...w, t0: +(w.t0 + 0.35).toFixed(4), t1: +(w.t1 + 0.35).toFixed(4) } : w));
  fs.writeFileSync(path.join(VOICE, "08-1p.json"), JSON.stringify(moved));
  console.log(`voice/08-1p.wav ${(out.length / SR).toFixed(2)} s, beat opened at ${best.toFixed(3)} s`);
}

// ------------------------------------------------------------------------------------------------ the one-shots
const SFXS = {
  /** A wall switch: the rocker's snap, its plastic body, a small thump in the wall. */
  lamp() { const n = N(0.16), o = new Float32Array(n);
    for (const [at, g] of [[0, 1], [0.022, 0.55]]) { const k = new Float32Array(N(0.05)); for (let i = 0; i < k.length; i++) k[i] = rnd() * Math.exp(-i / SR / 0.0016); mixAt(o, reson(k, 2300, 6), at, 2.2 * g); mixAt(o, bp(k, 0.2, 0.9), at, 0.5 * g); const th = new Float32Array(N(0.05)); for (let i = 0; i < th.length; i++) th[i] = Math.sin(TAU * 140 * i / SR) * Math.exp(-i / SR / 0.012); mixAt(o, th, at, 0.35 * g); }
    return norm(o, 0.8); },
  /** The hallway at night: a fridge in the next room (hum, its harmonics, a faint rattle) over a quiet room tone, gone as the paper comes (8.7 s). */
  room() { const n = N(8.7), o = new Float32Array(n); let ph = 0;
    const noise = lp(Float32Array.from({ length: n }, () => rnd()), 0.02), air = bp(Float32Array.from({ length: n }, () => rnd()), 0.01, 0.12);
    for (let i = 0; i < n; i++) { const t = i / SR, wob = 1 + 0.004 * Math.sin(TAU * 0.13 * t); ph += TAU * 50 * wob / SR;
      const hum = Math.sin(ph) * 0.5 + Math.sin(2 * ph) * 0.42 + Math.sin(3 * ph) * 0.22 + Math.sin(4 * ph) * 0.12 + Math.sin(6 * ph) * 0.06;
      const rattle = noise[i] * (0.5 + 0.5 * Math.sin(2 * ph)) * 0.9;
      o[i] = (hum * 0.55 + rattle * 0.5 + air[i] * 0.5) * env(n, 0.25, 0.32, i); }
    return norm(o, 0.35); },
  /** A pen scratch: a nib's stick-slip over paper, bright and short (four, so no two words sound the same). */
  pen(v) { const d = [0.15, 0.19, 0.13, 0.22][v], n = N(d), raw = new Float32Array(n);
    let grit = 0; for (let i = 0; i < n; i++) { const imp = rnd() > 0.93 ? rnd() * 2.5 : 0; grit = grit * 0.6 + imp; raw[i] = rnd() * 0.5 + grit; }
    const s = bp(raw, 0.25, 0.85), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = i / n, stroke = 0.55 + 0.45 * Math.sin(TAU * (2.2 + v * 0.7) * k + v); o[i] = s[i] * stroke * Math.min(1, k / 0.06) * Math.min(1, (1 - k) / 0.25); }
    return norm(o, 0.5); },
  /** The pencil drawing the new head: graphite, softer and lower than the pen, in strokes with lifts. 1.25 s. */
  pencil() { const n = N(1.25), raw = new Float32Array(n); let grit = 0;
    for (let i = 0; i < n; i++) { grit = grit * 0.75 + (rnd() > 0.9 ? rnd() * 1.6 : 0); raw[i] = rnd() * 0.6 + grit; }
    const s = bp(raw, 0.12, 0.6), o = new Float32Array(n), strokes = [0, 0.2, 0.42, 0.6, 0.8, 1.0];
    for (let i = 0; i < n; i++) { const t = i / SR; let g = 0; for (let j = 0; j < strokes.length - 1; j++) { const a = strokes[j], b = strokes[j + 1] - 0.03; if (t >= a && t < b) { const k = (t - a) / (b - a); g = Math.sin(Math.PI * k) ** 0.6; } } o[i] = s[i] * g * env(n, 0.02, 0.1, i); }
    return norm(o, 0.45); },
  /** The dip pen drawing the hairline rule: one long thin stroke with a faint squeal. 0.32 s. */
  nib() { const n = N(0.32), raw = new Float32Array(n); let grit = 0;
    for (let i = 0; i < n; i++) { grit = grit * 0.5 + (rnd() > 0.95 ? rnd() * 2 : 0); raw[i] = rnd() * 0.4 + grit; }
    const s = bp(raw, 0.35, 0.95), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = i / n; o[i] = (s[i] + Math.sin(TAU * 3150 * i / SR) * 0.05) * Math.min(1, k / 0.05) * Math.min(1, (1 - k) / 0.3); }
    return norm(o, 0.4); },
  /** The footage giving way to paper: a sheet sliding over a sheet. 0.55 s. */
  slide() { const n = N(0.55), raw = Float32Array.from({ length: n }, () => rnd()), body = lp(raw, 0.08), fib = bp(raw, 0.3, 0.8), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = i / n, sw = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 1.5; o[i] = (body[i] * 2.2 + fib[i] * 0.35) * sw; }
    return norm(o, 0.45); },
  /** Tape pulled off the roll and pressed down: a crackling rip that speeds up, then the press. 0.42 s. */
  tape() { const n = N(0.42), o = new Float32Array(n); const ripN = N(0.3);
    let t = 0; while (t < 0.3) { const rate = 0.004 + 0.012 * (1 - t / 0.3); const k = new Float32Array(N(0.006)); for (let i = 0; i < k.length; i++) k[i] = rnd() * Math.exp(-i / SR / 0.0009); mixAt(o, bp(k, 0.15, 0.8), t, 0.6 + 0.4 * Math.abs(rnd())); t += rate * (0.6 + 0.8 * Math.abs(rnd())); }
    const hiss = bp(Float32Array.from({ length: ripN }, () => rnd()), 0.2, 0.7); for (let i = 0; i < ripN; i++) o[i] += hiss[i] * 0.25 * Math.sin(Math.PI * i / ripN);
    const pat = new Float32Array(N(0.08)); for (let i = 0; i < pat.length; i++) pat[i] = (rnd() * 0.5 + Math.sin(TAU * 180 * i / SR)) * Math.exp(-i / SR / 0.012); mixAt(o, lp(pat, 0.3), 0.33, 0.9);
    return norm(o, 0.55); },
  /** The clay bar taking his weight: a short wooden creak (stick-slip pulses through two body modes). 0.45 s. */
  creak() { const n = N(0.45), pulses = new Float32Array(n); let t = 0.01;
    while (t < 0.4) { const i = Math.round(t * SR); if (i < n) pulses[i] = 1; const f = 38 + 50 * Math.sin(Math.PI * t / 0.4) + 6 * rnd(); t += 1 / f; }
    const s = reson(pulses, 620, 9), s2 = reson(pulses, 1180, 7), o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = (s[i] + 0.6 * s2[i]) * env(n, 0.03, 0.12, i);
    return norm(o, 0.5); },
  /** The new bot's blink: a tiny rubber squeak. 0.09 s. */
  squeak() { const n = N(0.09), o = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const k = i / n, f = 1700 + 1100 * k + 60 * Math.sin(TAU * 38 * i / SR); ph += TAU * f / SR; o[i] = (Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * Math.sin(Math.PI * k) ** 1.2; }
    return norm(o, 0.35); },
  /** Dawn on the salt flat: soft moving air, and far footfalls at a runner's cadence. 2.8 s. */
  air() { const n = N(2.8), raw = Float32Array.from({ length: n }, () => rnd()), wind = lp(lp(raw, 0.012), 0.05), hi = bp(raw, 0.05, 0.2), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR, sw = 0.7 + 0.3 * Math.sin(TAU * t / 2.3 + 1); o[i] = (wind[i] * 9 + hi[i] * 0.15) * sw * env(n, 0.05, 0.6, i); }
    for (let t = 0.12; t < 2.6; t += 1 / 2.85) { const k = new Float32Array(N(0.09)); for (let i = 0; i < k.length; i++) k[i] = (Math.sin(TAU * 95 * i / SR) * 0.8 + rnd() * 0.3) * Math.exp(-i / SR / 0.018); mixAt(o, lp(k, 0.08), t, 0.22); }
    return norm(o, 0.4); },
  /** A brush laying the underline: bristles dragged once, quick in, dry out. 0.4 s. */
  brush() { const n = N(0.4), raw = Float32Array.from({ length: n }, () => rnd()), s = bp(raw, 0.06, 0.45), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = i / n, sw = Math.min(1, k / 0.12) * Math.pow(1 - k, 1.6), bristle = 0.75 + 0.25 * Math.sin(TAU * 31 * i / SR); o[i] = s[i] * sw * bristle; }
    return norm(o, 0.45); },
};

const what = process.argv[2];
if (what === "voice") voice();
else if (what === "sfx") {
  fs.mkdirSync(SFX, { recursive: true });
  for (const [k, f] of Object.entries(SFXS)) {
    if (k === "pen") for (let v = 0; v < 4; v++) { seed = 11 + v; writeWav(path.join(SFX, `pen-${v + 1}.wav`), f(v)); }
    else { seed = 101 + k.length * 7; writeWav(path.join(SFX, `${k}.wav`), f()); }
  }
  console.log(`spots/08-sfx/: ${fs.readdirSync(SFX).join(" ")}`);
} else { console.error("usage: node spots/08-sound.mjs voice|sfx"); process.exit(1); }
