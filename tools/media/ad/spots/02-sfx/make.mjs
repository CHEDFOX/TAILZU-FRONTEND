#!/usr/bin/env node
/**
 * Spot 02 (Pahunch gaye?): the sounds sound.mjs has no kind for, synthesised here on a seeded generator so the same run
 * gives the same files. 16-bit PCM mono 48 kHz WAVs beside this file, which 02.js plays as `sample` cues:
 *
 *   pen1..pen4.wav   a dip-pen scratch, one per handwritten word (four takes so a line never repeats one)
 *   tape.wav         a strip of tape torn off the roll (the rip before each card lands)
 *   rail.wav         a rail joint: the front bogie's clack and the rear's, 0.11 s apart (the 96 bpm pulse)
 *   street.wav       night street at the kerb: low traffic air and one scooter pulling away (3.05 s, stops dead)
 *   cabin.wav        an airliner cabin: the dark steady roar (2.55 s, stops dead on the freeze)
 *   rain.wav         rain on a bus window: the patter on the glass and a soft hiss (3.05 s)
 *   taxi.wav         a back seat: road rumble, tyre hiss and the street lights' air going by (2.55 s)
 *   hush.wav         the same car, quieter and darker, a child asleep (3.05 s, fading)
 *   night.wav        the city far off under the towers (4.2 s, fading into the warm freeze)
 *
 *   node tools/media/ad/spots/02-sfx/make.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000, TAU = Math.PI * 2;
let seed = 202;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const smooth = (v) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c); };

function bandpass(x, f, q) {
  const w = TAU * f / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w), b0 = a, b2 = -a, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
function lowpass(x, f) { const k = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; } return x; }
function highpass(x, f) { const k = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] -= y; } return x; }
function normalise(x, peak) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); const g = m > 0 ? peak / m : 1; for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
/** In over a, out over r (seconds): the beds start on the cut's first sample and stop dead on the next (5 ms edges, no click). */
function edges(x, a = 0.005, r = 0.005) { const n = x.length; for (let i = 0; i < n; i++) { const t = i / SR, T = n / SR; x[i] *= smooth(t / a) * smooth((T - t) / r); } return x; }
function write(name, x) {
  const out = Buffer.alloc(44 + x.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + x.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path.join(here, name), out);
  console.log(`${name}  ${(x.length / SR).toFixed(2)} s`);
}
/** A noise bed: white noise through a one-pole lowpass (k), then a second (k2), for dark air. */
function air(n, k, k2 = 1) { const x = new Float32Array(n); let y = 0, z = 0; for (let i = 0; i < n; i++) { y += k * (rnd() - y); z += k2 * (y - z); x[i] = z; } return x; }

/** A pen scratch: two or three short strokes of bright gritty noise (the nib on cotton paper). */
function pen(take) {
  seed = 1200 + take * 53;
  const dur = 0.15 + 0.04 * (take % 2), n = Math.round(dur * SR), x = new Float32Array(n), env = new Float32Array(n);
  const strokes = 2 + ((take + 1) % 2);
  for (let s = 0; s < strokes; s++) {
    const t0 = (s / strokes) * dur * 0.85 + 0.003 * take, len = dur / strokes * (0.8 + 0.2 * Math.abs(rnd()));
    for (let i = 0; i < n; i++) { const t = i / SR - t0; if (t < 0 || t > len) continue; const k = t / len; env[i] = Math.max(env[i], Math.sin(Math.PI * Math.min(1, k * 1.4)) ** 0.7 * (1 - 0.4 * k)); }
  }
  for (let i = 0; i < n; i++) x[i] = rnd() * env[i] * (0.75 + 0.25 * Math.sin(TAU * i / SR * (85 + 23 * take)));
  bandpass(x, 3300 + 450 * take, 0.9); highpass(x, 1400);
  for (let i = 0; i < n; i++) if (Math.abs(rnd()) > 0.9966) for (let j = 0; j < 40 && i + j < n; j++) x[i + j] += rnd() * 0.5 * Math.exp(-j / 6) * env[i];
  return normalise(x, 0.55);
}

/** Tape off the roll: a fast tearing crackle that thickens and stops with the strip's release, then a faint flap. */
function tape() {
  seed = 4242;
  const dur = 0.3, n = Math.round(dur * SR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = t / 0.22, on = t < 0.22 ? 1 : 0;
    const dens = on * (0.01 + 0.07 * smooth(k));   // the glue letting go, faster and faster
    if (Math.abs(rnd()) < dens) { const a = 0.3 + 0.7 * Math.abs(rnd()); for (let j = 0; j < 60 && i + j < n; j++) x[i + j] += rnd() * a * Math.exp(-j / 9); }
    x[i] += rnd() * 0.18 * on * smooth(k * 1.5) * (0.6 + 0.4 * Math.sin(TAU * 31 * t));
  }
  highpass(x, 900); bandpass(x, 3000, 0.5);
  const r = Math.round(0.222 * SR); for (let j = 0; j < 2400 && r + j < n; j++) x[r + j] += rnd() * Math.exp(-j / 500) * 0.25;   // the flap of the free end
  return normalise(x, 0.6);
}

/** A rail joint: two clacks (front bogie, rear bogie), a short metallic ring and a woody knock under each. */
function rail() {
  seed = 96;
  const dur = 0.42, n = Math.round(dur * SR), x = new Float32Array(n);
  const hit = (at, g) => {
    const i0 = Math.round(at * SR);
    for (let j = 0; j + i0 < n; j++) {
      const t = j / SR;
      const click = rnd() * Math.exp(-t / 0.004);
      const ring = Math.sin(TAU * 1870 * t) * Math.exp(-t / 0.035) * 0.25 + Math.sin(TAU * 2930 * t) * Math.exp(-t / 0.02) * 0.12;
      const knock = Math.sin(TAU * (95 + 40 * Math.exp(-t * 60)) * t) * Math.exp(-t / 0.05) * 0.9;
      x[i0 + j] += (click * 0.8 + ring + knock) * g;
    }
  };
  hit(0.0, 1); hit(0.112, 0.72);
  lowpass(x, 5200);
  return normalise(x, 0.55);
}

/** The kerb at night: dark traffic air, a far horn-less hum, and one scooter close by pulling away (a two-stroke buzz
 *  rising in pitch as it goes, its level falling, the tyres' hiss on the wet road). */
function street() {
  seed = 11;
  const dur = 3.05, n = Math.round(dur * SR), x = air(n, 0.03, 0.4);
  for (let i = 0; i < n; i++) x[i] *= 4.5;
  const hiss = air(n, 0.6); highpass(hiss, 2500); for (let i = 0; i < n; i++) { const t = i / SR; x[i] += hiss[i] * 0.06 * (0.6 + 0.4 * Math.exp(-t / 1.2)); }
  // the scooter: a pulse train at the engine's firing rate (rising as it accelerates away), filtered, fading with distance
  const eng = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 38 + 22 * smooth(t / 2.2) + 1.5 * Math.sin(TAU * 7 * t); ph += f / SR; const p = ph % 1; eng[i] = (p < 0.18 ? Math.sin(Math.PI * p / 0.18) : 0) + rnd() * 0.15; }
  bandpass(eng, 420, 0.7); lowpass(eng, 1600);
  for (let i = 0; i < n; i++) { const t = i / SR, g = 0.55 * Math.exp(-t / 1.1) * smooth(t / 0.15) + 0.05; x[i] += eng[i] * g * 2.2; }
  const tyre = air(n, 0.5); bandpass(tyre, 1200, 0.6); for (let i = 0; i < n; i++) { const t = i / SR; x[i] += tyre[i] * 0.5 * Math.exp(-t / 0.9) * smooth(t / 0.1); }
  return edges(normalise(x, 0.42));
}
/** The cabin: a dark, steady roar with a faint engine tone, the air a touch brighter at the top. */
function cabin() {
  seed = 22;
  const dur = 2.55, n = Math.round(dur * SR), x = air(n, 0.05, 0.3);
  const top = air(n, 0.5); bandpass(top, 900, 0.5);
  let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * 117 / SR; x[i] = x[i] * 5 + top[i] * 0.08 + Math.sin(ph) * 0.012 * (1 + 0.2 * Math.sin(TAU * 0.4 * t)); }
  return edges(normalise(x, 0.36));
}
/** Rain on the glass: drops (tiny ticks with a short glassy ring) at about 70 a second, a few heavier ones, a soft hiss. */
function rain() {
  seed = 33;
  const dur = 3.05, n = Math.round(dur * SR), x = air(n, 0.25); highpass(x, 800); for (let i = 0; i < n; i++) x[i] *= 0.12;
  const drops = new Float32Array(n);
  for (let i = 0; i < n; i++) if (Math.abs(rnd()) < 70 / SR) {
    const a = 0.2 + 0.8 * Math.abs(rnd()) ** 2, f = 2200 + 3800 * Math.abs(rnd());
    for (let j = 0; j < 900 && i + j < n; j++) { const t = j / SR; drops[i + j] += (rnd() * Math.exp(-t / 0.0015) * 0.7 + Math.sin(TAU * f * t) * Math.exp(-t / 0.006) * 0.35) * a; }
  }
  highpass(drops, 1200);
  const rumble = air(n, 0.02, 0.5); for (let i = 0; i < n; i++) x[i] += drops[i] * 0.55 + rumble[i] * 3.0;   // the bus under it
  return edges(normalise(x, 0.4));
}
/** The back seat: road rumble, the tyres' hiss, and the air of three street lights going by. */
function taxi() {
  seed = 44;
  const dur = 2.55, n = Math.round(dur * SR), x = air(n, 0.012, 0.5);
  const tyre = air(n, 0.4); bandpass(tyre, 700, 0.5);
  for (let i = 0; i < n; i++) { const t = i / SR, pass = Math.max(...[0.35, 1.2, 1.95].map((c) => Math.exp(-(((t - c) / 0.18) ** 2)))); x[i] = x[i] * 7 + tyre[i] * (0.09 + 0.08 * pass); }
  return edges(normalise(x, 0.4));
}
/** The same car, darker and quieter: the rumble alone, a slow sway in it, fading out over the last second. */
function hush() {
  seed = 55;
  const dur = 3.05, n = Math.round(dur * SR), x = air(n, 0.008, 0.4);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= 8 * (0.85 + 0.15 * Math.sin(TAU * 0.5 * t)) * (t < 1.8 ? 1 : Math.exp(-(t - 1.8) / 0.5)); }
  return edges(normalise(x, 0.32), 0.005, 0.2);
}
/** The city far off: a low, wide hum with a faint high wash, swelling a touch, then letting go into the freeze. */
function night() {
  seed = 66;
  const dur = 4.2, n = Math.round(dur * SR), x = air(n, 0.01, 0.5);
  const wash = air(n, 0.3); bandpass(wash, 1500, 0.4);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] = (x[i] * 6 + wash[i] * 0.05) * (0.9 + 0.1 * Math.sin(TAU * 0.3 * t)) * (t < 3.0 ? 1 : Math.exp(-(t - 3.0) / 0.4)); }
  return edges(normalise(x, 0.3), 0.005, 0.3);
}

for (let k = 1; k <= 4; k++) write(`pen${k}.wav`, pen(k));
write("tape.wav", tape());
write("rail.wav", rail());
write("street.wav", street());
write("cabin.wav", cabin());
write("rain.wav", rain());
write("taxi.wav", taxi());
write("hush.wav", hush());
write("night.wav", night());
