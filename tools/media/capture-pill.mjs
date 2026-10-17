#!/usr/bin/env node
/**
 * Capture the desktop's REAL pill, frame by frame, from the desktop app's own
 * pill.html (TAILZU-DESKTOP), for the films that show it over a window.
 *
 *   PW_ROOT=<dir with playwright> node tools/media/capture-pill.mjs <path/to/pill.html> [outDir] [--w=720] [--fps=30] [--seconds=9.6]
 *
 * pill.html?demo&capture&bare runs the app's own scripted demo on a virtual
 * clock (rest → hover → listening → writing → done → rest) over a transparent
 * page, and window.__step(ms) draws the next frame. Each frame is the canvas,
 * alpha kept, at 2× — so what the film shows is the pill as pill.js draws it,
 * not a drawing of it. meta.json records the clock, so a film can map its own
 * time onto the demo's.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");

const pillHtml = process.argv[2];
if (!pillHtml || !fs.existsSync(pillHtml)) { console.error("usage: capture-pill.mjs <path/to/pill.html> [outDir] [--w=720] [--fps=30] [--seconds=9.6]"); process.exit(1); }
const out = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : path.join(here, "pill");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.slice(k.length + 3)) : d; };
const W = arg("w", 720), FPS = arg("fps", 30), SECONDS = arg("seconds", 9.6), H = 132, DPR = 2;

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^f\d{4}\.png$/.test(f)) fs.unlinkSync(path.join(out, f));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--headless=new", "--no-sandbox"], ignoreDefaultArgs: ["--headless=old"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
page.on("pageerror", (e) => { console.error("pill page error:", e.message); process.exitCode = 1; });
await page.goto("file://" + path.resolve(pillHtml) + "?demo&capture&bare");
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
// The pill's face is the OS's; on this machine the closest to SF/Segoe is Inter.
await page.evaluate(() => { window.TailzuKnobs.setKnobs({ labels: {}, flags: { "desktop.pill.font": 'Inter, "Segoe UI", system-ui, sans-serif' } }); });
await page.waitForTimeout(200);

const n = Math.round(SECONDS * FPS);
for (let i = 0; i < n; i++) {
  await page.evaluate((ms) => window.__step(ms), i === 0 ? 0 : 1000 / FPS);
  await page.locator("canvas").screenshot({ path: path.join(out, `f${String(i).padStart(4, "0")}.png`), omitBackground: true });
}
const meta = {
  w: W, h: H, dpr: DPR, fps: FPS, frames: n, seconds: SECONDS,
  // The demo's own script (pill.js): when each state begins, on the virtual clock.
  script: { rest: 0, hover: 1.1, listening: 2.2, speechFrom: 2.6, pluck: 4.8, speechTo: 6.6, writing: 6.9, done: 7.9, rest2: 9.4 },
};
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
// social.html reads this as a script: a file: page cannot fetch() its neighbour.
fs.writeFileSync(path.join(out, "meta.js"), `window.TZ_PILL_META = ${JSON.stringify(meta)};\n`);
console.log(`${n} frames, ${W}x${H} @${DPR}x → ${out}`);
await browser.close();
