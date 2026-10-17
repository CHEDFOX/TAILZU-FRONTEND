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
  resume(b, at, g) { mixInto(b, at, noise(SR, .02, .6, .0005, .005), .28 * g); mixInto(b, at, tone(SR, 900, .05, .001, .02), .14 * g); },
  bed(b, at, g, dur) {
    // Five voices of a chord, each three slightly detuned sines, breathing slowly.
    const n = Math.ceil(dur * SR), notes = [[110, 1], [164.81, .7], [220, .5], [277.18, .35], [329.63, .25]], ph = notes.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const t = i / SR, fade = Math.min(1, t / 1.6, (dur - t) / 1.6), lfo = 1 + .15 * Math.sin(TAU * .05 * t), vib = 1 + .002 * Math.sin(TAU * .3 * t);
      let v = 0;
      notes.forEach(([f, a], k) => { [-.004, 0, .004].forEach((d, m) => { ph[k][m] += TAU * f * (1 + d) * vib / SR; v += a * Math.sin(ph[k][m]) / 3; }); });
      b[i] += v * .035 * fade * lfo * g;
    }
  },
};

export function render(cues, seconds) {
  const b = new Float32Array(Math.ceil(seconds * SR));
  for (const c of cues) { const k = KINDS[c.kind]; if (!k) continue; k(b, c.at, c.gain ?? 1, c.dur ?? 0); }
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
