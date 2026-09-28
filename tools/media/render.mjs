#!/usr/bin/env node
/**
 * Render thread.html into the files the app is served.
 *
 *   node tools/media/render.mjs <outDir> [--only intro,mic,keys,posters] [--stills]
 *
 * Films are captured frame by frame from the page's own draw function at a
 * fixed clock, so the MP4 is exactly the preview; posters are one capture
 * each. Needs Chromium (Playwright) and ffmpeg. Frames go to a temp dir and
 * are removed after each encode.
 *
 * --stills writes a few labelled frames per film to <outDir>/stills instead
 * of encoding, for a look before the long render.
 *
 * PW_ROOT: a directory whose node_modules holds playwright, when this repo's
 * own does not (the desktop's does not; a scratch install is enough).
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
if (!out) { console.error("usage: render.mjs <outDir> [--only a,b] [--stills]"); process.exit(1); }
const only = (process.argv.find((a) => a.startsWith("--only=")) || "--only=auth,intro,mic,keys,posters").slice(7).split(",");
const stills = process.argv.includes("--stills");
const FPS = 30;

const FILMS = [
  // `present` is what the registry stores beside the file: how the slot shows it.
  { id: "auth", w: 1080, h: 2340, file: "auth.mp4", key: "hero.auth", present: { fit: "cover", background: "#0A0908", loop: true } },
  { id: "auth", w: 1600, h: 1000, file: "auth-desktop.mp4", key: "hero.auth.desktop", present: { fit: "cover", background: "#0A0908", loop: true } },
  { id: "intro", w: 1080, h: 2340, file: "intro.mp4", key: "intro", present: { shape: "full", fit: "cover", holdMs: 2800, loop: false, background: "#0F0D0B" } },
  { id: "intro", w: 1440, h: 1000, file: "intro-desktop.mp4", key: "intro.desktop", present: { shape: "full", fit: "cover", holdMs: 2800, loop: false, background: "#0F0D0B" } },
  // Phones only: a window never asks for the mic or the keyboard. Their black is the screen's, so no box shows.
  { id: "mic", w: 1080, h: 1200, file: "mic.mp4", key: "onboarding.hero", present: { shape: "full", aspectRatio: 0.9, radius: 28, fit: "cover", loop: true, background: "#000000" } },
  { id: "keys", w: 1200, h: 900, file: "keys.mp4", key: "hero.onboarding_keyboard", present: { fit: "cover", loop: true, background: "#000000" } },
];
const VOICES = ["signature", "professional", "friendly", "witty", "concise", "gentle", "playful", "romantic", "concise-boss", "explainer", "excited", "poetic", "bard", "pirate", "trailer", "noir"];
const POSTERS = [
  ...VOICES.map((id) => ({ id, w: 1200, h: 560, file: `you-voice-${id}.png`, key: `you.voice.${id}` })),
  { id: "train", w: 1200, h: 720, file: "you-train.png", key: "you.train" },
];

fs.mkdirSync(out, { recursive: true });
const page_url = "file://" + path.join(here, "thread.html");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--headless=new", "--no-sandbox"], ignoreDefaultArgs: ["--headless=old"],
});

async function open(kind, id, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.route("**/*", (r) => r.request().url().startsWith("file:") ? r.continue() : r.abort());
  page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
  await page.goto(`${page_url}?render=${kind}&id=${id}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__ready === true);
  return page;
}

const manifest = [];
for (const f of FILMS) {
  if (!only.includes(f.id)) continue;
  const page = await open("film", f.id, f.w, f.h);
  const duration = await page.evaluate((id) => window.TZ.FILMS[id].duration, f.id);
  const loop = await page.evaluate((id) => window.TZ.FILMS[id].loop, f.id);
  const n = Math.round(duration * FPS);
  if (stills) {
    const dir = path.join(out, "stills"); fs.mkdirSync(dir, { recursive: true });
    for (const t of [0.2, 1.2, 2.4, 3.6, 4.8, 6, 7.5, 9].filter((x) => x < duration)) {
      await page.evaluate((t) => window.__frame(t), t);
      await page.screenshot({ path: path.join(dir, `${f.file.replace(".mp4", "")}-${t.toFixed(2)}s.png`) });
    }
  } else {
    const dir = fs.mkdtempSync(path.join(out, ".frames-"));
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.__frame(t), i / FPS);
      await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
    }
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium", "-movflags", "+faststart", "-an", path.join(out, f.file)]);
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.status !== 0) { console.error(r.stderr.toString()); process.exit(1); }
    console.log(`${f.file}  ${f.w}x${f.h}  ${n} frames  ${(fs.statSync(path.join(out, f.file)).size / 1e6).toFixed(2)} MB`);
  }
  manifest.push({ file: f.file, key: f.key, contentType: "video/mp4", loop, durationMs: Math.round(duration * 1000), present: f.present });
  await page.close();
}
if (only.includes("posters")) {
  for (const p of POSTERS) {
    const page = await open("poster", p.id, p.w, p.h);
    await page.screenshot({ path: path.join(out, stills ? path.join("stills", p.file) : p.file) });
    if (!stills) console.log(`${p.file}  ${p.w}x${p.h}  ${(fs.statSync(path.join(out, p.file)).size / 1e3).toFixed(0)} KB`);
    manifest.push({ file: p.file, key: p.key, contentType: "image/png", present: { fit: "cover" } });
    await page.close();
  }
}
await browser.close();
if (!stills) {
  const mf = path.join(out, "manifest.json");
  const prev = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")) : [];
  // Files rendered by an earlier run keep their entry, so a partial render never drops a key.
  const known = [...FILMS.map((f) => ({ file: f.file, key: f.key, contentType: "video/mp4", present: f.present })), ...POSTERS.map((p) => ({ file: p.file, key: p.key, contentType: "image/png", present: { fit: "cover" } }))];
  const merged = [...manifest, ...prev.filter((e) => !manifest.some((m) => m.key === e.key)), ...known.filter((e) => !manifest.some((m) => m.key === e.key) && !prev.some((m) => m.key === e.key))]
    .filter((e) => fs.existsSync(path.join(out, e.file)));
  fs.writeFileSync(mf, JSON.stringify(merged, null, 2) + "\n");
}
