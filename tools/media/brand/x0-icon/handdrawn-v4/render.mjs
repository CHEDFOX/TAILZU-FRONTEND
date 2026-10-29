// Render the hand-drawn X0 Bot icons.
//
//   node render.mjs                         all versions -> <version>/icon-1024.png (2048 master, averaged to 1024)
//   node render.mjs 1-curious 3-wink        just these
//   node render.mjs --size 1024 --out /tmp/prev   quick preview (1024 master -> 512 PNGs) into another folder
//
// Runs the drawing code (draw.js, bot.js, versions.js) in headless Chromium through Playwright, and
// writes 8-bit RGB PNGs (no alpha, full bleed: the OS rounds the corners).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const size = +opt("--size", "2048");
const set = opt("--set", "versions");                  // versions | shapes (the neutral shape grid)
const outDir = opt("--out", set === "shapes" ? path.join(here, "shapes") : here);
const only = args;

/** Minimal PNG encoder: 8-bit RGB, filter "sub" on every row. */
function png(w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), s = y * stride;
    raw[o] = 1;
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (rgb[s + x] - (x >= 3 ? rgb[s + x - 3] : 0)) & 255;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(here, f) });

const ids = await page.evaluate((set) => (set === "shapes" ? HD.SHAPES : HD.VERSIONS).map((v) => v.id), set);
const todo = only.length ? ids.filter((id) => only.some((o) => id === o || id.startsWith(o + "-") || id.split("-")[0] === o)) : ids;
for (const id of todo) {
  const t0 = Date.now();
  const out = size / 2;
  const b64 = await page.evaluate(({ id, size, out }) => {
    const spec = HD.VERSIONS.concat(HD.SHAPES || []).find((v) => v.id === id);
    const art = new HD.Art(size, spec.seed);
    HD.icon(art, spec);
    const px = art.rgb8(out);
    let s = "";
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return btoa(s);
  }, { id, size, out });
  const dir = path.join(outDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, out === 1024 ? "icon-1024.png" : `icon-${out}.png`);
  fs.writeFileSync(file, png(out, out, Buffer.from(b64, "base64")));
  console.log(`${id}: ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
await browser.close();
