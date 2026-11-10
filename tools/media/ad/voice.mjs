#!/usr/bin/env node
/**
 * A voice line for a film: a neural read (edge-tts, through the session's proxy) with its word times, trimmed, as WAV.
 *
 *   node tools/media/ad/voice.mjs <name> "<text>" [--voice en-IN-PrabhatNeural] [--rate +6%] [--out voice] [--cut a,b]
 *
 * Writes <out>/<name>.wav (48 kHz mono, trailing silence trimmed) and <out>/<name>.json ([{ w, t0, t1 }] seconds).
 * --cut a,b removes a stretch of dead air (seconds) and moves the words after it. Voices worth knowing: en-IN-PrabhatNeural
 * (male), en-IN-NeerjaNeural (female), hi-IN-MadhurNeural, hi-IN-SwaraNeural, en-US-GuyNeural, en-US-JennyNeural,
 * en-US-AriaNeural, en-GB-RyanNeural, en-GB-SoniaNeural, en-AU-WilliamNeural (edge-tts --list-voices for all).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), pos = argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
const [name, text] = pos; if (!name || !text) { console.error('usage: voice.mjs <name> "<text>" [--voice v] [--rate +6%] [--out voice] [--cut a,b]'); process.exit(1); }
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const voice = opt("voice", "en-IN-PrabhatNeural"), rate = opt("rate", "+6%"), out = path.resolve(opt("out", path.join(here, "voice"))), cut = opt("cut", null);
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, SSL_CERT_FILE: "/root/.ccr/ca-bundle.crt", REQUESTS_CA_BUNDLE: "/root/.ccr/ca-bundle.crt" };
const r = spawnSync("python3", [path.join(here, "voice", "say.py"), name, voice, rate, text], { cwd: out, env, encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr.slice(-800)); process.exit(1); }
let af = "";
if (cut) { const [a, b] = cut.split(",").map(Number); af = `aselect='not(between(t,${a},${b}))',asetpts=N/SR/TB,`; const w = JSON.parse(fs.readFileSync(path.join(out, `${name}.json`), "utf8")); for (const x of w) if (x.t0 >= b) { x.t0 -= b - a; x.t1 -= b - a; } fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(w)); }
const f = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(out, `${name}.mp3`), "-af", `${af}areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.1`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path.join(out, `${name}.wav`)], { encoding: "utf8" });
if (f.status !== 0) { console.error(f.stderr); process.exit(1); }
fs.rmSync(path.join(out, `${name}.mp3`), { force: true });
const words = JSON.parse(fs.readFileSync(path.join(out, `${name}.json`), "utf8"));
const dur = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(out, `${name}.wav`)], { encoding: "utf8" }).stdout.trim();
console.log(`${name}.wav ${Number(dur).toFixed(2)} s  ${words.length} words  ${words.map((w) => `${w.w}@${w.t0.toFixed(2)}`).join(" ")}`);
