#!/usr/bin/env node
/**
 * Render social.html into files to post.
 *
 *   PW_ROOT=<dir with playwright> node tools/media/render-social.mjs <outDir> [--only=river,tones,...] [--stills] [--posters]
 *
 * Films are captured frame by frame from the page's own draw function at a
 * fixed clock, so the MP4 is the design exactly; H.264, 30fps, faststart,
 * silent (music is added where it is posted), a few MB each. Posters are one capture each.
 * --stills writes a handful of frames per film to <outDir>/stills instead.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");

const out = process.argv[2];
if (!out) { console.error("usage: render-social.mjs <outDir> [--only=a,b] [--stills] [--posters]"); process.exit(1); }
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",") : null;
const stills = process.argv.includes("--stills");
const postersOnly = process.argv.includes("--posters");
const FPS = 30;

const FILMS = [
  { id: "river", file: "tailzu-heard-9x16.mp4" },
  { id: "cleanup", file: "tailzu-said-written-9x16.mp4" },
  { id: "keyless", file: "tailzu-keyless-9x16.mp4" },
  { id: "tones", file: "tailzu-your-tone-1x1.mp4" },
  { id: "languages", file: "tailzu-22-languages-1x1.mp4" },
];
const POSTERS = ["talk", "hinglish", "keyless", "tones", "languages", "desktop"];

fs.mkdirSync(out, { recursive: true });
const url = "file://" + path.join(here, "social.html");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--headless=new", "--no-sandbox"], ignoreDefaultArgs: ["--headless=old"],
});
async function open(kind, id) {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  await page.route("**/*", (r) => r.request().url().startsWith("file:") ? r.continue() : r.abort());
  page.on("pageerror", (e) => { console.error(`${id}: page error:`, e.message); process.exitCode = 1; });
  await page.goto(`${url}?render=${kind}&id=${id}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const size = await page.evaluate(() => { const c = document.querySelector("canvas"); return { w: c.width, h: c.height }; });
  await page.setViewportSize({ width: size.w, height: size.h });
  return { page, ...size };
}

if (!postersOnly) for (const F of FILMS) {
  if (only && !only.includes(F.id)) continue;
  const { page, w, h } = await open("film", F.id);
  const duration = await page.evaluate((id) => window.TZ.FILMS[id].duration, F.id);
  if (stills) {
    const dir = path.join(out, "stills"); fs.mkdirSync(dir, { recursive: true });
    const at = process.env.AT ? process.env.AT.split(",").map(Number) : [.8, 2, 3.5, 5, 7, 9, 11, duration - .8];
    for (const t of at.filter((x) => x < duration)) {
      await page.evaluate((t) => window.__frame(t), t);
      await page.locator("canvas").screenshot({ path: path.join(dir, `${F.id}-${t.toFixed(1)}s.png`) });
    }
    console.log(`${F.id}: stills`);
  } else {
    const dir = fs.mkdtempSync(path.join(out, ".frames-"));
    const n = Math.round(duration * FPS);
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.__frame(t), i / FPS);
      await page.locator("canvas").screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
    }
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"),
      // The grain is drawn fresh every frame, which at a high quality setting
      // makes an 80 MB file that every platform then re-compresses into
      // blotches. A light temporal denoise keeps the look and lands at a few MB.
      "-vf", "hqdn3d=4:3:8:6",
      "-c:v", "libx264", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow",
      "-movflags", "+faststart", "-an", path.join(out, F.file)]);
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1); }
    console.log(`${F.file}  ${w}x${h}  ${n} frames  ${(fs.statSync(path.join(out, F.file)).size / 1e6).toFixed(1)} MB`);
  }
  await page.close();
}
if (!stills || postersOnly) for (const id of POSTERS) {
  if (only && !only.includes(id) && !postersOnly) continue;
  const { page, w, h } = await open("poster", id);
  const file = `tailzu-${id}-4x5.png`;
  await page.locator("canvas").screenshot({ path: path.join(out, file) });
  console.log(`${file}  ${w}x${h}`);
  await page.close();
}
await browser.close();
