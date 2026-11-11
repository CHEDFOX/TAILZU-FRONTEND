#!/usr/bin/env node
/**
 * Render the pre-launch trailer (trailer.html) into MP4s, frame by frame from the page's own clock, so the file is the
 * design exactly. Needs Chromium (Playwright) and ffmpeg.
 *
 *   PW_ROOT=<dir with playwright> node tools/media/trailer/render.mjs <outDir> [options]
 *
 *   --ratio 9x16|16x9|both   which cut (default both): 1080 x 1920 and 1920 x 1080
 *   --scale 0.5              draw smaller (a quick look); the file name says so
 *   --stills                 write a few frames and a contact sheet instead of a film (--at 0.5,2,4 picks the seconds)
 *   --every 1                with --stills: a still on every second (or every s seconds) from 0, named sNNN.png in
 *                            stills-<tag>/ so sNNN is EXACTLY t = (N - 1) s, frame 30 (N - 1); with --query hud=1 the
 *                            source frame number and timecode are burned top-left of each still (and so of the sheet).
 *                            Review note: the v1 review sheets were grabbed from the mp4 with ffmpeg's fps=1, which keeps
 *                            the LAST frame rounding to each second, so every v1 still was +14 frames (0.47 s) late.
 *   --range 3,9              render only these seconds (a look at one beat)
 *   --fps 30  --crf 17       the film's frame rate and quality
 *   --silent                 no sound track
 *   --poster 31.2            also write poster-<ratio>.png, the frame at that second
 *
 * The page (trailer.html?w=&h=) sets window.__ready, draws any moment with window.__frame(t) (seconds), says how long it
 * is in window.TRAILER.duration, and lists its sound cues in window.__cues() for sound.mjs to make the track.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { render as renderSound } from "./sound.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");

const argv = process.argv.slice(2);
const out = argv.find((a) => !a.startsWith("--")) ?? null;
if (!out) { console.error("usage: render.mjs <outDir> [--ratio 9x16|16x9|both] [--scale s] [--stills] [--at a,b] [--range a,b] [--fps n] [--crf n] [--silent] [--poster t]"); process.exit(1); }
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const RATIOS = { "9x16": [1080, 1920], "16x9": [1920, 1080] };
const ratios = opt("ratio", "both") === "both" ? Object.keys(RATIOS) : [opt("ratio")];
const SCALE = Number(opt("scale", "1")), FPS = Number(opt("fps", "30")), CRF = opt("crf", "17");
const stills = has("stills"), silent = has("silent");
const every = opt("every", null) != null ? Number(opt("every")) : null;
const burn = /(^|&)hud=1(&|$)/.test(opt("query", ""));   // with the page's hud on, the stills carry their frame number top-left
const range = opt("range", null)?.split(",").map(Number) ?? null;
const poster = opt("poster", null);
fs.mkdirSync(out, { recursive: true });

const url = pathToFileURL(path.resolve(opt("page", path.join(here, "trailer.html")))).href;   // --page another film's html
const NAME = opt("name", path.basename(opt("page", "x0-trailer.html"), ".html").replace(/^trailer$/, "x0-trailer"));
// The page's pictures are file: URLs, which would taint the canvas and bar toDataURL; this flag makes them its own.
const browser = await chromium.launch({ args: ["--no-sandbox", "--allow-file-access-from-files"] });

for (const ratio of ratios) {
  const [W, H] = RATIOS[ratio].map((v) => Math.round(v * SCALE));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.route("**/*", (r) => r.request().url().startsWith("file:") ? r.continue() : r.abort());
  page.on("pageerror", (e) => { console.error(`${ratio}: page error:`, e.message); process.exitCode = 1; });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`${ratio}: ${m.type()}: ${m.text()}`); });
  await page.goto(`${url}?w=${W}&h=${H}${opt("query", "") ? "&" + opt("query", "") : ""}`);   // --query "hud=1&chrome=all"
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const duration = await page.evaluate(() => window.TRAILER.duration);
  const tag = `${ratio}${SCALE !== 1 ? `-${Math.round(W)}w` : ""}`;
  const grab = async (t, file, label = false) => {
    await page.evaluate((t) => window.__frame(t), t);
    if (label) {   // the source frame number and timecode, top-left, in a white box (a still that documents itself)
      const f = Math.round(t * FPS), tc = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}.${String(f % FPS).padStart(2, "0")}`;
      await page.evaluate(([txt, sc]) => {
        const c = document.querySelector("canvas").getContext("2d"), fs_ = Math.max(20, Math.round(40 * sc)), pad = Math.round(16 * sc);
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
        c.font = `500 ${fs_}px GeistMono, monospace`; c.textBaseline = "middle"; c.textAlign = "left";
        const w = c.measureText(txt).width; c.fillStyle = "rgba(255,255,255,0.8)"; c.fillRect(pad, pad, w + fs_, fs_ * 1.4);
        c.fillStyle = "#000"; c.fillText(txt, pad + fs_ / 2, pad + fs_ * 0.7); c.restore();
      }, [`f${f}  ${tc}`, SCALE]);
    }
    const data = await page.evaluate(() => document.querySelector("canvas").toDataURL("image/png"));
    fs.writeFileSync(file, Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  };

  if (stills && every != null) {
    // a still on every `every` seconds from 0: stills-<tag>/sNNN.png is exactly t = (N - 1) * every, frame round(30 t)
    const dir = path.join(out, `stills-${tag}`); fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (let n = 0; n * every < duration; n++) {
      const t = +(n * every).toFixed(4), f = path.join(dir, `s${String(n + 1).padStart(3, "0")}.png`); await grab(t, f, burn); files.push(f);
    }
    sheet(files, path.join(out, `sheet-${tag}.png`), ratio === "9x16" ? 6 : 3);
    console.log(`${tag}: ${files.length} stills on the ${every === 1 ? "second" : every + " s"} in stills-${tag}/ (sNNN = ${every === 1 ? "N - 1 s" : "(N - 1) x " + every + " s"}, f = ${Math.round(FPS * every)} (N - 1))${burn ? ", frame numbers burned" : ""}, sheet-${tag}.png`);
  } else if (stills) {
    const dir = path.join(out, "stills"); fs.mkdirSync(dir, { recursive: true });
    const at = opt("at", null)?.split(",").map(Number) ?? Array.from({ length: 12 }, (_, i) => +((i + 0.5) * duration / 12).toFixed(2));
    const files = [];
    for (const t of at.filter((x) => x >= 0 && x < duration)) {
      const f = path.join(dir, `${tag}-${t.toFixed(2)}s.png`); await grab(t, f, burn); files.push(f);
    }
    sheet(files, path.join(out, `sheet-${tag}.png`), ratio === "9x16" ? 6 : 3);
    console.log(`${tag}: ${files.length} stills, sheet-${tag}.png`);
  } else {
    const t0 = range ? range[0] : 0, t1 = range ? Math.min(range[1], duration) : duration;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x0-trailer-"));
    const n = Math.round((t1 - t0) * FPS);
    const started = Date.now();
    for (let i = 0; i < n; i++) {
      await grab(t0 + i / FPS, path.join(dir, `f${String(i).padStart(5, "0")}.png`));
      if (i && i % 150 === 0) console.error(`${tag}: ${i}/${n} frames, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    const file = `${NAME}-${tag}${range ? `-${t0}-${t1}s` : ""}.mp4`, video = path.join(out, file);
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%05d.png"),
      "-c:v", "libx264", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-crf", CRF, "-preset", "slow",
      "-movflags", "+faststart", "-an", video]);
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1); }
    let sounds = 0;
    if (!silent) {
      const cues = (await page.evaluate(() => window.__cues ? window.__cues() : [])).filter((c) => c.at >= t0 - 1 && c.at < t1).map((c) => ({ ...c, at: c.at - t0 }));
      sounds = cues.length;
      if (cues.length) {
        const wav = path.join(out, "." + file + ".wav"), mute = path.join(out, "." + file);
        fs.writeFileSync(wav, renderSound(cues, t1 - t0, { base: path.dirname(fileURLToPath(url)) }));   // samples are named relative to the page
        fs.renameSync(video, mute);
        const m = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mute, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-shortest", "-movflags", "+faststart", video]);
        fs.rmSync(mute, { force: true }); fs.rmSync(wav, { force: true });
        if (m.status !== 0) { console.error(m.stderr.toString()); process.exit(1); }
      }
    }
    console.log(`${file}  ${W}x${H}  ${n} frames  ${sounds ? sounds + " sounds  " : "silent  "}${(fs.statSync(video).size / 1e6).toFixed(1)} MB`);
  }
  if (poster != null) { await grab(Number(poster), path.join(out, `poster-${tag}.png`)); console.log(`poster-${tag}.png at ${poster} s`); }
  await page.close();
}
await browser.close();

/** A contact sheet of the stills, `cols` across, with ffmpeg's tile filter. */
function sheet(files, to, cols) {
  if (!files.length) return;
  const list = path.join(path.dirname(to), ".sheet.txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const rows = Math.ceil(files.length / cols);
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `scale=iw/2:ih/2,tile=${cols}x${rows}:padding=8:margin=8:color=0xDDDDDD`, "-frames:v", "1", to]);
  fs.rmSync(list, { force: true });
  if (r.status !== 0) console.error(r.stderr.toString());
}
