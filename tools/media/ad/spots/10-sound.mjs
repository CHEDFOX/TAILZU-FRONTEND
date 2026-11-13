#!/usr/bin/env node
/* THE WITNESS (spot 10): the sound it needs beyond sound.mjs's kinds, made here so the page can play it as `sample`s.
 *
 *   node spots/10-sound.mjs voice   the recorded lines (voice/10-N.wav, one voice.mjs call each) cut into their phrases at
 *                                   the sentence pauses, de-essed, with a 0.4 s room: voice/10-N<a|b|..>.wav + .json (word
 *                                   times relative to the phrase file, moved onto the audio's real onsets)
 *   node spots/10-sound.mjs sfx     the one-shots: a wall clock (tick, tock), pen scratches, the typewriter carriage, the
 *                                   ruler slam, the tape start  -> spots/10-sfx/*.wav
 *   node spots/10-sound.mjs bed     the tape hiss and the library room tone, gated by the film's own timeline (spots/10.js
 *                                   exports it): room tone only on the witness, hard cuts to hiss on every question card,
 *                                   nothing but the clock in the two holds  -> spots/10-sfx/bed.wav
 *
 * Everything is seeded, so the same inputs give the same files.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const AD_DIR = path.resolve(here, ".."), VOICE = path.join(AD_DIR, "voice"), SFX = path.join(here, "10-sfx");
const SR = 48000, TAU = Math.PI * 2;
fs.mkdirSync(SFX, { recursive: true });

// ------------------------------------------------------------------------------------------------ wav i/o
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
const db = (x) => Math.pow(10, x / 20);

// ------------------------------------------------------------------------------------------------ a small FFT (for the room)
function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], xr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, xi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + xr; im[i + k] = ui + xi; re[i + k + len / 2] = ur - xr; im[i + k + len / 2] = ui - xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
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
/** A small panelled room, 0.4 s: a few early reflections, then a darkening diffuse tail (RT60 0.4 s). */
function roomIR() {
  seed = 11; const n = Math.round(0.42 * SR), h = new Float32Array(n), tau = 0.4 / 6.91; let y = 0;
  for (let i = Math.round(0.007 * SR); i < n; i++) { const t = i / SR, al = 0.5 - 0.35 * (t / 0.42); y += al * (rnd() - y); h[i] = y * Math.exp(-t / tau); }
  for (const [ms, g] of [[11, 0.5], [17, -0.38], [23, 0.3], [31, -0.24], [43, 0.18]]) h[Math.round(ms * SR / 1000)] += g;
  let e = 0; for (const v of h) e += v * v; const k = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) h[i] *= k; return h;
}

// ------------------------------------------------------------------------------------------------ the voice, in phrases
function voice() {
  const IR = roomIR(), lines = fs.readdirSync(VOICE).filter((f) => /^10-\d+\.json$/.test(f)).sort();
  for (const jf of lines) {
    const n = jf.match(/^10-(\d+)/)[1], words = JSON.parse(fs.readFileSync(path.join(VOICE, jf), "utf8"));
    // de-ess the whole line first (ffmpeg's deesser), then cut it up
    const tmp = path.join(SFX, `.de-${n}.wav`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(VOICE, `10-${n}.wav`), "-af", "deesser=i=0.55:m=0.5:f=0.45:s=o", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", tmp], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const s = readWav(tmp); fs.rmSync(tmp);
    const win = Math.round(0.005 * SR), rms = (i) => { let a = 0; for (let k = i; k < Math.min(s.length, i + win); k++) a += s[k] * s[k]; return 20 * Math.log10(Math.sqrt(a / win) + 1e-9); };
    // phrases: words split where the read pauses (a sentence)
    const groups = [[words[0]]]; for (let i = 1; i < words.length; i++) { if (words[i].t0 - words[i - 1].t1 > 0.3) groups.push([]); groups[groups.length - 1].push(words[i]); }
    const onsets = groups.map((g) => { let i = Math.max(0, Math.round((g[0].t0 - 0.05) * SR)); while (i < s.length && rms(i) < -40) i += win / 5 | 0; return i / SR; });
    groups.forEach((g, gi) => {
      const on = onsets[gi], start = Math.max(0, on - 0.035), cap = gi + 1 < groups.length ? onsets[gi + 1] - 0.06 : s.length / SR;
      let e = Math.round(g[g.length - 1].t1 * SR), quiet = 0; while (e < cap * SR && quiet < 0.06 * SR) { if (rms(e) < -54) quiet += win; else quiet = 0; e += win; }
      const end = Math.min(cap, e / SR - 0.03), a = Math.round(start * SR), b = Math.round(end * SR);
      const dry = s.slice(a, b); const fi = Math.round(0.004 * SR), fo = Math.round(0.03 * SR);
      for (let i = 0; i < fi; i++) dry[i] *= i / fi; for (let i = 0; i < fo; i++) dry[dry.length - 1 - i] *= i / fo;
      const wet = convolve(dry, IR), out = new Float32Array(wet.length);
      for (let i = 0; i < out.length; i++) out[i] = (i < dry.length ? dry[i] : 0) * 0.92 + wet[i] * 0.2;   // the room about 13 dB under the voice
      const lag = on - g[0].t0, name = `10-${n}${"abcdefgh"[gi]}`;
      writeWav(path.join(VOICE, `${name}.wav`), out);
      const rel = g.map((w) => ({ w: w.w, t0: +(w.t0 + lag - start).toFixed(4), t1: +(w.t1 + lag - start).toFixed(4) }));
      rel[rel.length - 1].t1 = +Math.min(rel[rel.length - 1].t1, end - start).toFixed(4);   // the last word ends where the sound does (the timeline lays out from it)
      fs.writeFileSync(path.join(VOICE, `${name}.json`), JSON.stringify(rel));
      console.log(`${name}.wav  ${(out.length / SR).toFixed(2)} s (speech ${(end - start).toFixed(2)} s)  lag ${lag.toFixed(3)}  ${rel.map((w) => `${w.w}@${w.t0.toFixed(2)}-${w.t1.toFixed(2)}`).join(" ")}`);
    });
  }
}

// ------------------------------------------------------------------------------------------------ the one-shots
const buf = (sec) => new Float32Array(Math.round(sec * SR));
/** Add a damped resonance (f Hz, decay tau s) excited at i0. */
function ring(o, i0, f, tau, g) { for (let i = 0; i + i0 < o.length; i++) { const t = i / SR, e = Math.exp(-t / tau); if (e < 1e-4) break; o[i0 + i] += Math.sin(TAU * f * t) * e * g; } }
/** Add a noise burst through a one-pole low-pass (al) minus a slower one (a band), attack a, decay tau. */
function burst(o, i0, a, tau, g, al = 0.6, hp = 0.05) { let y = 0, z = 0; for (let i = 0; i + i0 < o.length; i++) { const t = i / SR, e = (t < a ? t / a : 1) * Math.exp(-Math.max(0, t - a) / tau); if (t > a && e < 1e-4) break; const r = rnd(); y += al * (r - y); z += hp * (y - z); o[i0 + i] += (y - z) * e * g; } }
function norm(o, peak) { let m = 0; for (const v of o) m = Math.max(m, Math.abs(v)); const k = peak / (m || 1); for (let i = 0; i < o.length; i++) o[i] *= k; return o; }
function sfx() {
  seed = 21;
  // the wall clock: an escapement's tick (bright) and tock (darker), woody, dry
  { const o = buf(0.12); burst(o, 0, 0.0004, 0.004, 1, 0.9, 0.2); ring(o, 0, 2650, 0.012, 0.5); ring(o, 0, 4100, 0.006, 0.3); ring(o, 0, 1180, 0.02, 0.22); writeWav(path.join(SFX, "tick.wav"), norm(o, 0.5)); }
  { const o = buf(0.14); burst(o, 0, 0.0005, 0.005, 1, 0.8, 0.15); ring(o, 0, 1900, 0.016, 0.5); ring(o, 0, 3200, 0.008, 0.25); ring(o, 0, 820, 0.026, 0.3); writeWav(path.join(SFX, "tock.wav"), norm(o, 0.5)); }
  // a dip pen on paper: two or three short strokes of high band noise, each its own grain
  for (let v = 1; v <= 3; v++) {
    const o = buf(0.24), strokes = [[0, 0.055], [0.07 + 0.01 * v, 0.06], [0.15, 0.04 + 0.01 * v]].slice(0, v === 2 ? 2 : 3);
    for (const [at, len] of strokes) { let y = 0, z = 0; const i0 = Math.round(at * SR), n = Math.round(len * SR); for (let i = 0; i < n && i0 + i < o.length; i++) { const k = i / n, e = Math.sin(Math.PI * k) ** 1.5 * (0.75 + 0.25 * Math.sin(TAU * (31 + 7 * v) * i / SR)); const r = rnd(); y += 0.75 * (r - y); z += 0.18 * (y - z); o[i0 + i] += (y - z) * e; } }
    writeWav(path.join(SFX, `scratch-${v}.wav`), norm(o, 0.32));
  }
  // the typewriter carriage: a short ratchet, then the thunk of the stop
  { const o = buf(0.3); for (let k = 0; k < 6; k++) { const i0 = Math.round((k * 0.014) * SR); burst(o, i0, 0.0003, 0.003, 0.5 - 0.05 * k, 0.85, 0.25); ring(o, i0, 3000 + 150 * k, 0.004, 0.12); }
    const i1 = Math.round(0.095 * SR); burst(o, i1, 0.0004, 0.01, 1, 0.7, 0.08); ring(o, i1, 140, 0.05, 0.9); ring(o, i1, 610, 0.025, 0.35); ring(o, i1, 2300, 0.01, 0.2);
    writeWav(path.join(SFX, "carriage.wav"), norm(o, 0.6)); }
  // a ruler slammed flat on a desk: the crack, the wood under it, very dry
  { const o = buf(0.35); burst(o, 0, 0.0002, 0.012, 1.2, 0.95, 0.12); ring(o, 0, 175, 0.06, 1.0); ring(o, 0, 420, 0.035, 0.55); ring(o, 0, 1480, 0.012, 0.35); ring(o, 0, 63, 0.09, 0.6);
    writeWav(path.join(SFX, "ruler.wav"), norm(o, 0.85)); }
  // the tape starting: the key going down (a clunk), the capstan catching
  { const o = buf(0.45); burst(o, 0, 0.0004, 0.006, 0.8, 0.8, 0.2); ring(o, 0, 95, 0.07, 0.9); ring(o, 0, 1250, 0.012, 0.25);
    const i1 = Math.round(0.11 * SR); burst(o, i1, 0.0004, 0.004, 0.5, 0.85, 0.25); ring(o, i1, 2100, 0.008, 0.2);
    for (let i = Math.round(0.12 * SR); i < o.length; i++) { const t = i / SR - 0.12; o[i] += Math.sin(TAU * (48 + 12 * Math.min(1, t / 0.15)) * t) * 0.08 * Math.exp(-t / 0.12); }
    writeWav(path.join(SFX, "tape.wav"), norm(o, 0.55)); }
  console.log("sfx: tick, tock, scratch-1..3, carriage, ruler, tape");
}

// ------------------------------------------------------------------------------------------------ the bed: hiss and room, gated by the film
function bed() {
  const require = createRequire(import.meta.url);
  const SPOT = require("./10.js");
  const V = {}; for (const f of fs.readdirSync(VOICE).filter((f) => /^10-\d+[a-h]\.json$/.test(f))) V[f.replace(/^10-|\.json$/g, "")] = { words: JSON.parse(fs.readFileSync(path.join(VOICE, f), "utf8")) };
  const T = SPOT.timeline(V), L = Math.ceil((T.end0 + 0.5) * SR), o = new Float32Array(L);
  const on = (iv, t) => iv.some(([a, b]) => t >= a && t < b);
  const hissOn = SPOT.hissIntervals(T), roomOn = SPOT.roomIntervals(T);
  seed = 5;
  // tape hiss: thin and high (white noise minus its lows), about -46 dBFS; room: dark air, a radiator's low hum, a far street swelling
  let h1 = 0, r1 = 0, r2 = 0, st = 0; const fade = Math.round(0.004 * SR);
  const gate = (iv) => { const g = new Float32Array(L); for (let i = 0; i < L; i++) g[i] = on(iv, i / SR) ? 1 : 0; // 4 ms ramps only, so a cut is a cut
    const out = new Float32Array(L); let acc = 0; for (let i = 0; i < L; i++) { acc += (g[i] - acc) / fade; out[i] = Math.max(0, Math.min(1, acc)); } return out; };
  const gh = gate(hissOn), gr = gate(roomOn);
  for (let i = 0; i < L; i++) {
    const t = i / SR, w = rnd();
    h1 += 0.12 * (w - h1); const hiss = (w - h1) * db(-40);
    r1 += 0.02 * (rnd() - r1); r2 += 0.004 * (rnd() - r2);
    st += 0.0006 * (rnd() - st);
    const swell = 0.6 + 0.4 * Math.sin(TAU * t / 9.3) * Math.sin(TAU * t / 4.1 + 1);
    const room = r1 * db(-24) + r2 * db(-17) * swell + st * db(-12) + (Math.sin(TAU * 50 * t) * 0.6 + Math.sin(TAU * 100 * t) * 0.25) * db(-58);
    o[i] = hiss * gh[i] + room * gr[i];
  }
  writeWav(path.join(SFX, "bed.wav"), o);
  console.log(`bed.wav  ${(L / SR).toFixed(2)} s  hiss ${hissOn.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(" ")}  room ${roomOn.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(" ")}`);
}

const step = process.argv[2] || "all";
if (step === "voice" || step === "all") voice();
if (step === "sfx" || step === "all") sfx();
if (step === "bed" || step === "all") bed();
