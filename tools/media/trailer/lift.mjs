#!/usr/bin/env node
/**
 * Handcrafted components for the trailer, painted with the brand's own hand (tools/media/brand/x0-icon/handdrawn-v2:
 * the paper's tooth, dip-pen ink, dry gouache, pencil hatching, faceted cuts) and lifted off the paper as RGBA PNGs,
 * the way store/art.mjs lifts its art: each one is drawn on black and on white and the two are matted
 * (alpha = 1 - (white - black), colour = black / alpha), then trimmed.
 *
 *   PW_ROOT=<dir with playwright> node tools/media/trailer/lift.mjs <jobs.mjs> <outDir> [name ...]
 *
 * jobs.mjs exports `default`: [{ name, N (drawing size, px, default 2000), out (longest side of the PNG, default N / 2),
 * pad (units of the 1000 square kept round the drawing, default 10), seed, draw }], where `draw` is the SOURCE of a
 * function (art, bg, HD, seed) that paints on `art` (an HD.Art already laid with paper of colour bg) in the 1000 square.
 * Writes <outDir>/<name>.png and <outDir>/components.json ({ name: { file, w, h, box (in the 1000 square) } }).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");
const LIB = path.resolve(here, "../brand/x0-icon");

const [jobsFile, outDir, ...only] = process.argv.slice(2);
if (!jobsFile || !outDir) { console.error("usage: lift.mjs <jobs.mjs> <outDir> [name ...]"); process.exit(1); }
const jobs = (await import(pathToFileURL(path.resolve(jobsFile)).href)).default.filter((j) => !only.length || only.includes(j.name));
fs.mkdirSync(outDir, { recursive: true });
const metaFile = path.join(outDir, "components.json");
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};

const PAGE = String.raw`
window.LIFT = (() => {
  /** Draw fn on black and on white, matte, trim to the drawing (plus pad units), average down, return a PNG data URL. */
  function lift(N, seed, outSide, pad, fn, opaque) {
    if (opaque) {   // a whole picture (paper, a full card): drawn once on white, kept opaque, averaged down, not trimmed
      const art = new HD.Art(N, seed); art.paper({ color: "#FFFFFF", mottle: 0, grain: 0, warm: 0, vignette: 0 });
      fn(art, "#FFFFFF", HD, seed);
      const SS = Math.max(1, Math.round(N / outSide)), o = Math.floor(N / SS), px = art.rgb8(o), img = new Uint8ClampedArray(o * o * 4);
      for (let i = 0; i < o * o; i++) { img[i * 4] = px[i * 3]; img[i * 4 + 1] = px[i * 3 + 1]; img[i * 4 + 2] = px[i * 3 + 2]; img[i * 4 + 3] = 255; }
      const cv = document.createElement("canvas"); cv.width = cv.height = o;
      const ctx = cv.getContext("2d"), im = ctx.createImageData(o, o); im.data.set(img); ctx.putImageData(im, 0, 0);
      return { png: cv.toDataURL("image/png"), w: o, h: o, box: { x0: 0, y0: 0, x1: 1000, y1: 1000 } };
    }
    const P = [];
    for (const bg of ["#000000", "#FFFFFF"]) {
      const art = new HD.Art(N, seed);
      art.paper({ color: bg, mottle: 0, grain: 0, warm: 0, vignette: 0 });
      fn(art, bg, HD, seed); P.push(art.rgb);
    }
    const [B, W] = P, A = new Float32Array(N * N);
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let i = 0; i < N * N; i++) {
      const j = i * 3, a = Math.max(0, Math.min(1, 1 - ((W[j] - B[j]) + (W[j + 1] - B[j + 1]) + (W[j + 2] - B[j + 2])) / 3));
      A[i] = a;
      if (a > 0.004) { const x = i % N, y = (i / N) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) throw new Error("nothing drawn");
    const k = N / 1000, padPx = Math.round(pad * k);
    x0 = Math.max(0, x0 - padPx); y0 = Math.max(0, y0 - padPx); x1 = Math.min(N - 1, x1 + padPx); y1 = Math.min(N - 1, y1 + padPx);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, SS = Math.max(1, Math.round(Math.max(cw, ch) / outSide));
    const ow = Math.ceil(cw / SS), oh = Math.ceil(ch / SS), px = new Uint8ClampedArray(ow * oh * 4);
    for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const x = x0 + ox * SS + i, y = y0 + oy * SS + j; if (x > x1 || y > y1) continue;
        const q = y * N + x; n++; a += A[q]; r += Math.min(1, B[q * 3]); g += Math.min(1, B[q * 3 + 1]); b += Math.min(1, B[q * 3 + 2]);
      }
      if (a <= 0.002 * n) continue;
      const o = (oy * ow + ox) * 4;
      px[o] = Math.round((r / a) * 255); px[o + 1] = Math.round((g / a) * 255); px[o + 2] = Math.round((b / a) * 255); px[o + 3] = Math.round((a / n) * 255);
    }
    const cv = document.createElement("canvas"); cv.width = ow; cv.height = oh;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(ow, oh); img.data.set(px); ctx.putImageData(img, 0, 0);
    return { png: cv.toDataURL("image/png"), w: ow, h: oh, box: { x0: x0 / k, y0: y0 / k, x1: (x1 + 1) / k, y1: (y1 + 1) / k } };
  }
  return { lift };
})();
`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
for (const f of ["handdrawn-v2/draw.js", "handdrawn-v2/bot.js", "handdrawn-v2/versions.js", "curious-hang/versions.js"]) await page.addScriptTag({ path: path.join(LIB, f) });
await page.addScriptTag({ content: PAGE });

for (const j of jobs) {
  const t0 = Date.now();
  const r = await page.evaluate(({ j }) => {
    const fn = (0, eval)(`(${j.draw})`);
    return window.LIFT.lift(j.N ?? 2000, j.seed ?? 1, j.out ?? Math.round((j.N ?? 2000) / 2), j.pad ?? 10, fn, !!j.opaque);
  }, { j: { ...j, draw: j.draw.toString() } });
  const file = path.join(outDir, `${j.name}.png`);
  fs.writeFileSync(file, Buffer.from(r.png.slice(r.png.indexOf(",") + 1), "base64"));
  meta[j.name] = { file: path.basename(file), w: r.w, h: r.h, box: r.box, ...(j.meta || {}) };
  console.log(`${j.name}  ${r.w}x${r.h}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
await browser.close();
