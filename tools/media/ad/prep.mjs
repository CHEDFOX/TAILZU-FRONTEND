#!/usr/bin/env node
/**
 * Footage for a film: a clip's frames at 1080 x 1920, motion-interpolated to 72 fps so slow motion stays smooth.
 *
 *   node tools/media/ad/prep.mjs <clip.mp4> <outDir> [--fps 72] [--crop x,y,w,h (fractions)] [--from s] [--to s] [--fit cover|contain] [--no-interp]
 *
 * A landscape clip is covered into the vertical frame (its centre kept) unless --crop says which part; --fit contain
 * letterboxes it instead. Writes <outDir>/s0001.jpg … and <outDir>/footage.json ({ frames, fps, src, dur }).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2), pos = argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || ["--no-interp"].includes(argv[i - 1])));
const [clip, out] = pos; if (!clip || !out) { console.error("usage: prep.mjs <clip.mp4> <outDir> [--fps 72] [--crop x,y,w,h] [--from s] [--to s] [--fit cover|contain] [--no-interp]"); process.exit(1); }
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FPS = Number(opt("fps", "72")), crop = opt("crop", null), from = opt("from", null), to = opt("to", null), fit = opt("fit", "cover"), interp = !argv.includes("--no-interp");
fs.mkdirSync(out, { recursive: true });
const vf = [];
if (crop) { const [x, y, w, h] = crop.split(",").map(Number); vf.push(`crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`); }
if (fit === "contain") vf.push("scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos", "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black");
else vf.push("scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos", "crop=1080:1920");
if (interp) vf.push(`minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`); else vf.push(`fps=${FPS}`);
const args = ["-v", "error", "-y"]; if (from) args.push("-ss", from); args.push("-i", clip); if (to) args.push("-to", String(Number(to) - (from ? Number(from) : 0)));
args.push("-vf", vf.join(","), "-q:v", "2", path.join(out, "s%04d.jpg"));
const t0 = Date.now(); const r = spawnSync("ffmpeg", args, { stdio: "inherit" }); if (r.status !== 0) process.exit(r.status);
const frames = fs.readdirSync(out).filter((f) => /^s\d{4}\.jpg$/.test(f)).length;
fs.writeFileSync(path.join(out, "footage.json"), JSON.stringify({ frames, fps: FPS, src: path.resolve(clip), dur: frames / FPS, crop, from, to, fit }, null, 1));
console.log(`${frames} frames at ${FPS} fps (${(frames / FPS).toFixed(2)} s) in ${out}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
