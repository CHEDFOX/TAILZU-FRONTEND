/**
 * The trailer's sound, made here, without a note of anyone else's music: a low bed, a heartbeat, risers, a boom, the
 * brand's own small sounds (clicks, keys, the pill's bells, a send), and a final chord. The page lists its cues
 * ([{ at, kind, gain?, dur?, f?, file? }], in seconds) and this writes a WAV the renderer muxes in.
 *
 *   node sound.mjs cues.json out.wav [seconds]
 *
 * Everything is additive synthesis and filtered noise on one seeded generator, so the same cues give the same track.
 */
import fs from "node:fs";
import path from "node:path";

const SR = 48000, TAU = Math.PI * 2;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Attack a seconds, then an exponential decay with time constant tau. */
const env = (i, a, tau) => { const t = i / SR; return (t < a ? t / a : 1) * Math.exp(-Math.max(0, t - a) / tau); };
/** A smooth window: in over `a`, out over `r`, within `n` samples. */
const win = (i, n, a, r) => { const t = i / SR, T = n / SR; const x = t < a ? t / a : 1, y = T - t < r ? (T - t) / r : 1; return clamp(Math.min(x, y), 0, 1) ** 2 * (3 - 2 * clamp(Math.min(x, y), 0, 1)); };

/** A sparse random trigger (about 14 a second) on the seeded stream, for crackle. */
const hashBit = (i) => (i % 97 === 0) && (rnd() > .86);
function mixInto(buf, at, s, gain) { const i0 = Math.round(at * SR); for (let i = 0; i < s.length; i++) { const j = i0 + i; if (j >= 0 && j < buf.length) buf[j] += s[i] * gain; } }

/** Noise through a one-pole lowpass (alpha: 0 dark, 1 white), under an attack/decay envelope. */
function noise(seconds, alpha, a, tau) { const n = Math.ceil(seconds * SR), o = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { y += alpha * (rnd() - y); o[i] = y * env(i, a, tau); } return o; }
/** A soft bell: a sine with two quiet overtones, gliding to f * glide. */
function tone(f, seconds, a, tau, glide = 1) { const n = Math.ceil(seconds * SR), o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const k = i / n, fr = f * (1 + (glide - 1) * k); ph += TAU * fr / SR; o[i] = (Math.sin(ph) + .28 * Math.sin(2 * ph) + .08 * Math.sin(3 * ph)) * env(i, a, tau); } return o; }
/** A whoosh: noise whose colour opens (up) or closes over its length, under a sine window. */
function whoosh(seconds, up) { const n = Math.ceil(seconds * SR), o = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { const k = i / n, al = up ? .03 + .4 * k : .43 - .4 * k; y += al * (rnd() - y); o[i] = y * Math.sin(Math.PI * k) ** 2; } return o; }
/** A low drone: three detuned sines an octave apart, breathing slowly; in and out smoothly. */
function drone(f, seconds, a, r) {
  const n = Math.ceil(seconds * SR), o = new Float32Array(n); let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, breathe = .8 + .2 * Math.sin(TAU * t / 6.5);
    p1 += TAU * f / SR; p2 += TAU * f * 1.003 / SR; p3 += TAU * f * 2 / SR; p4 += TAU * f * 1.5 * 1.002 / SR;
    o[i] = (Math.sin(p1) + .6 * Math.sin(p2) + .22 * Math.sin(p3) + .14 * Math.sin(p4)) * breathe * win(i, n, a, r) / 2;
  }
  return o;
}
/** A pad: a filtered saw-ish stack with a slow attack, for a swell under the end. */
function pad(f, seconds, a, r) {
  const n = Math.ceil(seconds * SR), o = new Float32Array(n), H = 7; let y = 0; const ph = new Float64Array(H);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let h = 1; h <= H; h++) { ph[h - 1] += TAU * f * h * (1 + (h - 1) * .0007) / SR; s += Math.sin(ph[h - 1]) / h; }
    const k = i / n, al = .035 + .12 * k;   // the filter opens as it swells
    y += al * (s - y);
    o[i] = y * win(i, n, a, r) * .6;
  }
  return o;
}
/** A riser: noise brightening and a sine gliding up an octave, swelling to its end, which is the hit. */
function riser(seconds) {
  const n = Math.ceil(seconds * SR), o = new Float32Array(n); let y = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n, al = .02 + .5 * k * k; y += al * (rnd() - y); ph += TAU * (110 * (1 + k)) / SR;
    o[i] = (y * .7 + Math.sin(ph) * .18 * k) * (k * k) * (1 - Math.max(0, (k - .97) / .03));
  }
  return o;
}
/** A boom: a sub sine dropping with a quick noise front, long decay. */
function boom(seconds, f0 = 62, f1 = 36) {
  const n = Math.ceil(seconds * SR), o = new Float32Array(n); let ph = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = i / n, f = f1 + (f0 - f1) * Math.exp(-t * 7); ph += TAU * f / SR;
    y += .35 * (rnd() - y);
    o[i] = Math.sin(ph) * Math.exp(-t * 2.2) * (t < .004 ? t / .004 : 1) + y * Math.exp(-t * 40) * .5 + Math.sin(ph * 2) * .15 * Math.exp(-t * 6);
    o[i] *= 1 - Math.max(0, (k - .9) / .1);
  }
  return o;
}
/** One heartbeat: lub, then a softer dub. */
function heart(gain) { return (b, at) => { mixInto(b, at, tone(58, .32, .006, .07, .82), .9 * gain); mixInto(b, at + .22, tone(52, .3, .006, .06, .85), .62 * gain); }; }

const KINDS = {
  // the bed. Every low cue also carries a small body above 130 Hz, so the rhythm exists on a phone speaker and the sub
  // is kept for headphones.
  drone(b, at, g, dur, c) { mixInto(b, at, drone(c.f ?? 55, dur || 8, c.a ?? 1.2, c.r ?? 1.5), .5 * g); mixInto(b, at, drone((c.f ?? 55) * 3, dur || 8, c.a ?? 1.2, c.r ?? 1.5), .1 * g); mixInto(b, at, drone((c.f ?? 55) * 4, dur || 8, c.a ?? 1.2, c.r ?? 1.5), .06 * g); },
  pad(b, at, g, dur, c) { mixInto(b, at, pad(c.f ?? 110, dur || 4, c.a ?? 1.5, c.r ?? 1.2), .35 * g); },
  heart(b, at, g) { heart(g)(b, at); mixInto(b, at, tone(150, .14, .004, .04, .93), .45 * g); mixInto(b, at + .22, tone(140, .12, .004, .035, .93), .3 * g); },
  riser(b, at, g, dur) { mixInto(b, at, riser(dur || 2), .55 * g); },
  boom(b, at, g, dur, c) { mixInto(b, at, boom(dur || 1.6, c.f0, c.f1), .9 * g); mixInto(b, at, tone(110, .5, .003, .14, .82), .4 * g); mixInto(b, at, noise(.03, .7, .0005, .008), .35 * g); },
  /** A soft pulse on the beat: a muted low thump with a woody knock and a click, so a phone hears it. */
  pulse(b, at, g) { mixInto(b, at, tone(70, .18, .003, .045, .8), .5 * g); mixInto(b, at, tone(220, .06, .002, .018, .82), .28 * g); mixInto(b, at, noise(.02, .5, .0004, .005), .18 * g); },
  /** A soft paper landing with a knock. */
  "paper-thud"(b, at, g) { mixInto(b, at, noise(.08, .08, .002, .03), .5 * g); mixInto(b, at, tone(70, .1, .002, .03), .5 * g); mixInto(b, at, tone(190, .05, .001, .02), .5 * g); },
  /** The bar springing: a tone gliding up. */
  boing(b, at, g) { mixInto(b, at, tone(180, .25, .003, .08, 1.45), .5 * g); },
  /** A freeze: a low thud, a paper click and a tiny tick (the repo's lesson-freeze sound). */
  freeze(b, at, g) { mixInto(b, at, tone(110, .3, .002, .12, .55), .55 * g); mixInto(b, at, noise(.01, .3, .0003, .003), .14 * g); mixInto(b, at, tone(2400, .03, .0005, .006), .1 * g); },
  /** A room: a kitchen hood's fan, steady dark noise with a slow swell, `dur` long. */
  fan(b, at, g, dur) { const n = Math.ceil((dur || 10) * SR), o = new Float32Array(n); let y = 0, y2 = 0; for (let i = 0; i < n; i++) { y += .012 * (rnd() - y); y2 += .18 * (y - y2); o[i] = (y2 * 6 + y * .8) * win(i, n, 1.5, 1.5) * (1 + .08 * Math.sin(TAU * i / SR / 7)); } mixInto(b, at, o, .35 * g); },
  /** A pan's sizzle: crackling high noise, breathing, `dur` long. */
  sizzle(b, at, g, dur) { const n = Math.ceil((dur || 10) * SR), o = new Float32Array(n); let y = 0, env2 = 0; for (let i = 0; i < n; i++) { const r = rnd(); y += .7 * (r - y); if (hashBit(i)) env2 = 1; env2 *= .9993; o[i] = (r - y) * (.35 + .65 * env2) * win(i, n, 1.2, 1.5) * (.8 + .2 * Math.sin(TAU * i / SR / 2.3)); } mixInto(b, at, o, .07 * g); },
  silence() {},
  tick(b, at, g) { mixInto(b, at, noise(.02, .6, .0003, .003), .35 * g); mixInto(b, at, tone(2400, .02, .0003, .004), .08 * g); },
  // the brand's small sounds (as tools/media/sound.mjs has them)
  click(b, at, g) { mixInto(b, at, noise(.03, .35, .0005, .004), .6 * g); mixInto(b, at, tone(170, .04, .001, .012), .3 * g); },
  key(b, at, g) { const v = 1 + (rnd() * .08); mixInto(b, at, noise(.04, .5, .0005, .006), .5 * g); mixInto(b, at, tone(1300 * v, .02, .0005, .004), .12 * g); mixInto(b, at, tone(210 * v, .05, .001, .018), .3 * g); },
  open(b, at, g) { mixInto(b, at, whoosh(.26, true), .22 * g); },
  whoosh(b, at, g, dur, c) { mixInto(b, at, whoosh(dur || .4, c.up ?? true), .3 * g); },
  listen(b, at, g) { mixInto(b, at, tone(659.25, .5, .012, .17), .3 * g); mixInto(b, at + .15, tone(880, .6, .012, .2), .3 * g); },
  stop(b, at, g) { mixInto(b, at, tone(880, .45, .012, .15), .24 * g); mixInto(b, at + .15, tone(659.25, .55, .012, .18), .24 * g); },
  land(b, at, g) { mixInto(b, at, tone(540, .12, .002, .05, .5), .42 * g); mixInto(b, at, noise(.012, .5, .0003, .003), .2 * g); },
  send(b, at, g) { mixInto(b, at, whoosh(.24, true), .3 * g); mixInto(b, at + .17, tone(1760, .12, .001, .02), .14 * g); },
  notify(b, at, g) { mixInto(b, at, tone(1318.5, .5, .004, .16), .2 * g); mixInto(b, at + .09, tone(1760, .6, .004, .22), .18 * g); },
  write(b, at, g) { mixInto(b, at, tone(440, .55, .06, .2, 2), .11 * g); mixInto(b, at + .14, tone(659.25, .5, .06, .2, 1.5), .09 * g); },
  /** A bell at any pitch (f, Hz). */
  bell(b, at, g, dur, c) { mixInto(b, at, tone(c.f ?? 880, dur || .8, .005, (dur || .8) / 3), .3 * g); },
  /** The final chord: a warm major triad swelling in and ringing out. */
  chord(b, at, g, dur, c) { const f = c.f ?? 220; for (const [m, v] of [[1, 1], [1.25, .7], [1.5, .6], [2, .35]]) mixInto(b, at, pad(f * m, dur || 3.5, .25, 1.6), .3 * v * g); },
  /** A recording from a file (16-bit PCM WAV, mono or stereo, any rate: resampled). */
  sample(b, at, g, dur, c, base) {
    const wav = fs.readFileSync(path.resolve(base, c.file));
    let p = 12, rate = SR, ch = 1, bits = 16, data = null;
    while (p + 8 <= wav.length) { const id = wav.toString("ascii", p, p + 4), n = wav.readUInt32LE(p + 4); if (id === "fmt ") { ch = wav.readUInt16LE(p + 10); rate = wav.readUInt32LE(p + 12); bits = wav.readUInt16LE(p + 22); } else if (id === "data") { data = wav.subarray(p + 8, p + 8 + n); break; } p += 8 + n + (n & 1); }
    if (!data || bits !== 16) throw new Error(`${c.file}: expected 16-bit PCM WAV`);
    const frames = data.length / (2 * ch), n = Math.ceil(frames * SR / rate), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * rate / SR, j = Math.min(frames - 1, x | 0), f = x - j, k = Math.min(frames - 1, j + 1); let a = 0, c2 = 0; for (let q = 0; q < ch; q++) { a += data.readInt16LE((j * ch + q) * 2); c2 += data.readInt16LE((k * ch + q) * 2); } s[i] = ((a + (c2 - a) * f) / ch) / 32768; }
    mixInto(b, at, s, g);
  },
};

/** Cues to a WAV buffer (16-bit PCM, mono, 48 kHz), `seconds` long, with a soft limiter and a fade at the very end. */
export function render(cues, seconds, { base = process.cwd() } = {}) {
  seed = 7;
  const b = new Float32Array(Math.ceil(seconds * SR));
  for (const c of cues) { const k = KINDS[c.kind]; if (!k) { console.error(`sound: unknown cue kind ${c.kind}`); continue; } k(b, c.at, c.gain ?? 1, c.dur ?? 0, c, base); }
  // a gentle high-pass against rumble, then a soft knee so the booms never clip
  let lp = 0; for (let i = 0; i < b.length; i++) { lp += .0025 * (b[i] - lp); b[i] -= lp; }
  for (let i = 0; i < b.length; i++) { const v = b[i]; b[i] = Math.abs(v) < .6 ? v : Math.sign(v) * (.6 + Math.tanh((Math.abs(v) - .6) / .35) * .35); }
  const tail = Math.round(.25 * SR); for (let i = 0; i < tail; i++) b[b.length - 1 - i] *= i / tail;
  const out = Buffer.alloc(44 + b.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + b.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(b.length * 2, 40);
  for (let i = 0; i < b.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b[i] * .95 * 32767))), 44 + i * 2);
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [cuesFile, outFile, secs] = process.argv.slice(2);
  if (!cuesFile || !outFile) { console.error("usage: sound.mjs cues.json out.wav [seconds]"); process.exit(1); }
  const cues = JSON.parse(fs.readFileSync(cuesFile, "utf8"));
  const seconds = Number(secs) || Math.max(...cues.map((c) => c.at + (c.dur || 1))) + 1;
  fs.writeFileSync(outFile, render(cues, seconds, { base: path.dirname(path.resolve(cuesFile)) }));
  console.log(`${outFile}  ${seconds.toFixed(1)} s  ${cues.length} cues`);
}
