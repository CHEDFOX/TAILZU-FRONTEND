// Renders the x0 marks. See versions.js.
//   node render.mjs [id ...] [--size 2048] [--out dir]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url)), lib = path.join(here, "../handdrawn-v2");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const size = +opt("--size", "2048"), outDir = opt("--out", here);

function png(w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(lib, f) });
await page.addScriptTag({ path: path.join(here, "versions.js") });
const ids = await page.evaluate(() => HD.MARKS.map((v) => v.id));
for (const id of args.length ? ids.filter((i) => args.some((a) => i === a || i.split("-")[0] === a)) : ids) {
  const out = size / 2;
  const b64 = await page.evaluate(({ id, size, out }) => {
    const spec = HD.MARKS.find((v) => v.id === id), art = new HD.Art(size, spec.seed);
    spec.paint(art, HD.markRng(spec.seed));
    const t = art.rgb8(out);
    let s = ""; for (let i = 0; i < t.length; i += 0x8000) s += String.fromCharCode.apply(null, t.subarray(i, i + 0x8000));
    return btoa(s);
  }, { id, size, out });
  const dir = path.join(outDir, id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, out === 1024 ? "icon-1024.png" : `icon-${out}.png`), png(out, out, Buffer.from(b64, "base64")));
  console.log(id);
}
await browser.close();
