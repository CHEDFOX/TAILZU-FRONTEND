// Renders the soft-3D X0 Bot icons. See README.md.
//   THREE_DIR=/path/to/node_modules/three node render.mjs [variant ...] [--size 2048] [--samples 40] [--out dir]
// Writes <out>/<variant>/icon-1024.png and play-512.png (RGB, no alpha). --size is the supersampled
// render size; the icon is size/2 and the Play icon size/4 (so --size 2048 gives 1024 and 512).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node-tools/node_modules/")("playwright")); }

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const over = JSON.parse(opt("--set", "{}"));
const size = +opt("--size", 2048), samples = +opt("--samples", 40), outDir = path.resolve(opt("--out", here));
const threeDir = process.env.THREE_DIR || [path.join(here, "node_modules/three"), path.join(here, "../../../node_modules/three")].find((d) => fs.existsSync(d));
if (!threeDir || !fs.existsSync(path.join(threeDir, "build/three.module.js"))) {
  console.error("three.js not found: npm i three@0.169.0 somewhere and set THREE_DIR=<that>/node_modules/three");
  process.exit(1);
}

// ---- tiny RGB PNG writer (no alpha channel)
function crc32(buf) { return zlib.crc32 ? zlib.crc32(buf) : (() => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; })(); }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function pngRGB(w, h, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"http://peek.local/three/build/three.module.js","three/addons/":"http://peek.local/three/examples/jsm/"}}</script>
<script type="module">import * as S from "http://peek.local/scene.js"; window.S = S; window.ready = true;</script>`;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !/GL Driver Message/.test(m.text())) console.log("[page]", m.text()); });
page.on("pageerror", (e) => console.log("[page error]", e.message));
await page.route("http://peek.local/**", async (route) => {
  const u = new URL(route.request().url()).pathname;
  if (u === "/" || u === "/index.html") return route.fulfill({ contentType: "text/html", body: html });
  const file = u.startsWith("/three/") ? path.join(threeDir, u.slice(7)) : path.join(here, u.slice(1));
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
  route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(file) });
});
await page.goto("http://peek.local/index.html");
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
const all = await page.evaluate(() => Object.keys(window.S.VARIANTS));
const want = args.length ? args : all;
for (const name of want) {
  if (!all.includes(name)) { console.error("unknown variant", name, "— have", all.join(", ")); continue; }
  const r = await page.evaluate(async ({ name, size, samples, over }) => {
    const S = window.S, V = S.VARIANTS[name]();
    for (const [k, v] of Object.entries(over)) V[k] = typeof v === "object" && !Array.isArray(v) && V[k] ? { ...V[k], ...v } : v;
    return S.renderIcon(V, { size, samples });
  }, { name, size, samples, over });
  const dir = path.join(outDir, name); fs.mkdirSync(dir, { recursive: true });
  const n1 = r.w1 === 1024 ? "icon-1024.png" : `icon-${r.w1}.png`, n2 = r.w2 === 512 ? "play-512.png" : `play-${r.w2}.png`;
  fs.writeFileSync(path.join(dir, n1), pngRGB(r.w1, r.w1, Buffer.from(r.img1, "base64")));
  fs.writeFileSync(path.join(dir, n2), pngRGB(r.w2, r.w2, Buffer.from(r.img2, "base64")));
  console.log(`${name}: ${dir}/${n1} + ${n2} (${(r.ms / 1000).toFixed(1)}s)`);
}
await browser.close();
