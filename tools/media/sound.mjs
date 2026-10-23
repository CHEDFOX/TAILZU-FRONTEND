/**
 * The sounds of a film, made here: clicks, keys, the pill's two notes, a
 * landing, a send, a notification, the freeze of a lesson, and a quiet bed
 * under it all. A film lists its cues ([{ at, kind, gain?, dur? }], in
 * seconds) and this writes a WAV the renderer muxes in.
 *
 *   node sound.mjs cues.json out.wav [seconds]
 */
import fs from "node:fs";

const SR = 48000;
const env = (i, sr, a, tau) => { const t = i / sr; return (t < a ? t / a : 1) * Math.exp(-Math.max(0, t - a) / tau); };
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
/** Noise through a one-pole lowpass, under an envelope. */
function noise(sr, seconds, alpha, a, tau) { const n = Math.ceil(seconds * sr), o = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { y += alpha * (rnd() - y); o[i] = y * env(i, sr, a, tau); } return o; }
/** A soft bell: a sine with two quiet overtones. */
function tone(sr, f, seconds, a, tau, glide = 1) { const n = Math.ceil(seconds * sr), o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const k = i / n, fr = f * (1 + (glide - 1) * k); ph += TAU * fr / sr; o[i] = (Math.sin(ph) + .28 * Math.sin(2 * ph) + .08 * Math.sin(3 * ph)) * env(i, sr, a, tau); } return o; }
const TAU = Math.PI * 2;
function mixInto(buf, at, s, gain) { const i0 = Math.round(at * SR); for (let i = 0; i < s.length; i++) { const j = i0 + i; if (j >= 0 && j < buf.length) buf[j] += s[i] * gain; } }
/** A whoosh: noise whose colour opens over its length. */
function whoosh(sr, seconds, up) { const n = Math.ceil(seconds * sr), o = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { const k = i / n, al = up ? .03 + .4 * k : .43 - .4 * k; y += al * (rnd() - y); o[i] = y * Math.sin(Math.PI * k) ** 2; } return o; }

const KINDS = {
  click(b, at, g) { mixInto(b, at, noise(SR, .03, .35, .0005, .004), .6 * g); mixInto(b, at, tone(SR, 170, .04, .001, .012), .3 * g); },
  key(b, at, g) { const v = 1 + (rnd() * .08); mixInto(b, at, noise(SR, .04, .5, .0005, .006), .5 * g); mixInto(b, at, tone(SR, 1300 * v, .02, .0005, .004), .12 * g); mixInto(b, at, tone(SR, 210 * v, .05, .001, .018), .3 * g); },
  open(b, at, g) { mixInto(b, at, whoosh(SR, .26, true), .22 * g); },
  listen(b, at, g) { mixInto(b, at, tone(SR, 659.25, .5, .012, .17), .3 * g); mixInto(b, at + .15, tone(SR, 880, .6, .012, .2), .3 * g); },
  stop(b, at, g) { mixInto(b, at, tone(SR, 880, .45, .012, .15), .24 * g); mixInto(b, at + .15, tone(SR, 659.25, .55, .012, .18), .24 * g); },
  land(b, at, g) { mixInto(b, at, tone(SR, 540, .12, .002, .05, .5), .42 * g); mixInto(b, at, noise(SR, .012, .5, .0003, .003), .2 * g); },
  send(b, at, g) { mixInto(b, at, whoosh(SR, .24, true), .3 * g); mixInto(b, at + .17, tone(SR, 1760, .12, .001, .02), .14 * g); },
  notify(b, at, g) { mixInto(b, at, tone(SR, 1318.5, .5, .004, .16), .2 * g); mixInto(b, at + .09, tone(SR, 1760, .6, .004, .22), .18 * g); },
  freeze(b, at, g) { mixInto(b, at, tone(SR, 110, .3, .002, .12, .55), .55 * g); mixInto(b, at, noise(SR, .01, .3, .0003, .003), .14 * g); mixInto(b, at, tone(SR, 2400, .03, .0005, .006), .1 * g); },
  /** The keyboard writing: a soft shimmer rising, between the stop and the landing. */
  write(b, at, g) { mixInto(b, at, tone(SR, 440, .55, .06, .2, 2), .11 * g); mixInto(b, at + .14, tone(SR, 659.25, .5, .06, .2, 1.5), .09 * g); },
  /** A recording from a file (voice/…): 16-bit PCM WAV, mono, resampled to 48 kHz if it is not. */
  sample(b, at, g, dur, c) {
    const wav = fs.readFileSync(new URL(c.file, import.meta.url));
    let p = 12, rate = SR, ch = 1, bits = 16, data = null;
    while (p + 8 <= wav.length) { const id = wav.toString("ascii", p, p + 4), n = wav.readUInt32LE(p + 4); if (id === "fmt ") { ch = wav.readUInt16LE(p + 10); rate = wav.readUInt32LE(p + 12); bits = wav.readUInt16LE(p + 22); } else if (id === "data") { data = wav.subarray(p + 8, p + 8 + n); break; } p += 8 + n + (n & 1); }
    if (!data || bits !== 16) throw new Error(`${c.file}: expected 16-bit PCM WAV`);
    const frames = data.length / 2 / ch, mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { let v = 0; for (let k = 0; k < ch; k++) v += data.readInt16LE((i * ch + k) * 2); mono[i] = v / ch / 32768; }
    const n = Math.ceil(frames * SR / rate), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * rate / SR, j = Math.floor(x), f = x - j; s[i] = mono[j] * (1 - f) + (mono[j + 1] ?? mono[j]) * f; }
    mixInto(b, at, s, g);
  },
  /** Where she is: a metro platform heard by a phone's mic, from the mic opening to its closing. Rumble under a crowd's murmur, faded in and out. */
  metro(b, at, g, dur) {
    const n = Math.ceil(dur * SR), i0 = Math.round(at * SR); let lo = 0, mid = 0, mid2 = 0, br = 0;
    const p1 = rnd() * 3, p2 = rnd() * 3, p3 = rnd() * 3;
    for (let i = 0; i < n; i++) {
      const t = i / SR, fade = Math.min(1, t / .5, (dur - t) / .6); if (fade <= 0) continue;
      const w = rnd();
      br = .995 * br + .02 * w; lo += .012 * (br - lo);                              // the rumble: brown noise, low
      mid += .22 * (w - mid); mid2 += .04 * (mid - mid2);                             // the murmur: a band of hiss
      const rumble = lo * (1 + .5 * Math.sin(TAU * .07 * t + p1)) * 1.4;
      const crowd = (mid - mid2) * (.55 + .25 * Math.sin(TAU * .31 * t + p2) + .2 * Math.sin(TAU * .9 * t + p3));
      const j = i0 + i; if (j >= 0 && j < b.length) b[j] += (rumble * .9 + crowd * .5) * .055 * fade * g;
    }
  },
  /**
   * A word glitching in (social.html signOff): a digital stutter for each of
   * its bursts (c.hits, [start, length] in seconds, the same list the picture
   * uses), each one noise held at a low rate under a square stepping in
   * pitch, softened; then the settle, a low soft thump and a bright tick.
   */
  glitch(b, at, g, dur, c) {
    const hits = c.hits || [[0, .045], [.07, .03], [.12, .06], [.2, .025], [.24, .05], [.33, .03], [.38, .07]], settle = c.settle ?? .5;
    hits.forEach(([dt, d], k) => {
      const f = [420, 880, 260, 1320, 520, 990, 330][k % 7], n = Math.ceil(d * SR), o = new Float32Array(n), hold = Math.max(1, Math.round(SR / (f * 3)));
      let v = 0, y = 0;
      for (let i = 0; i < n; i++) { if (i % hold === 0) v = rnd(); const sq = Math.sin(TAU * f * i / SR) > 0 ? 1 : -1; y += .45 * ((v * .55 + sq * .45) - y); o[i] = y * Math.min(1, i / 60) * (1 - i / n) ** .6; }
      mixInto(b, at + dt, o, .13 * g);
    });
    mixInto(b, at + settle, tone(SR, 96, .3, .002, .1, .7), .42 * g);
    mixInto(b, at + settle, noise(SR, .012, .5, .0003, .003), .12 * g);
    mixInto(b, at + settle + .01, tone(SR, 2900, .06, .0005, .014), .07 * g);
  },
  resume(b, at, g) { mixInto(b, at, noise(SR, .02, .6, .0005, .005), .28 * g); mixInto(b, at, tone(SR, 900, .05, .001, .02), .14 * g); },
  bed(b, at, g, dur) {
    // Five voices of a chord, each three slightly detuned sines, breathing slowly, from `at`.
    const n = Math.ceil(dur * SR), i0 = Math.round(at * SR), notes = [[110, 1], [164.81, .7], [220, .5], [277.18, .35], [329.63, .25]], ph = notes.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const t = i / SR, fade = Math.min(1, t / 1.6, (dur - t) / 1.6), lfo = 1 + .15 * Math.sin(TAU * .05 * t), vib = 1 + .002 * Math.sin(TAU * .3 * t);
      let v = 0;
      notes.forEach(([f, a], k) => { [-.004, 0, .004].forEach((d, m) => { ph[k][m] += TAU * f * (1 + d) * vib / SR; v += a * Math.sin(ph[k][m]) / 3; }); });
      if (i0 + i < b.length) b[i0 + i] += v * .035 * fade * lfo * g;
    }
  },
};

export function render(cues, seconds) {
  const b = new Float32Array(Math.ceil(seconds * SR));
  for (const c of cues) { const k = KINDS[c.kind]; if (!k) continue; k(b, c.at, c.gain ?? 1, c.dur ?? 0, c); }
  let peak = 0; for (const v of b) peak = Math.max(peak, Math.abs(v));
  const g = peak > .85 ? .85 / peak : 1;
  const out = Buffer.alloc(44 + b.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + b.length * 2, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(b.length * 2, 40);
  for (let i = 0; i < b.length; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b[i] * g * 32767))), 44 + i * 2);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("sound.mjs") && process.argv[2]) {
  const cues = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const seconds = Number(process.argv[4]) || Math.max(...cues.map((c) => c.at + (c.dur || 1)));
  fs.writeFileSync(process.argv[3], render(cues, seconds));
  console.log(`${process.argv[3]}  ${seconds.toFixed(1)} s  ${cues.length} cues`);
}
