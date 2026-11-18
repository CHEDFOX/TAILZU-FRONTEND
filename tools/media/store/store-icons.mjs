// THE STORE ICONS AND THE PLAY FEATURE GRAPHIC, made from the icon the app actually ships.
//
//   node tools/media/store/store-icons.mjs
//
// Why this exists. The icon files under out/icons/ used to come from tools/media/brand/x0-icon (the painted black
// bot). On 13 Nov the app's icon became the dotted Blip, from tools/media/brand/blip-icon/cool, and nothing
// regenerated out/icons/ — so the file an owner uploaded to Play was a character the app no longer has. There is
// only one way that cannot happen again: the store icons are DERIVED FROM app/assets/icon.png, the same file the
// binary ships, and from blip-icon/cool/adaptive-fg.svg, the figure alone that the adaptive layer is cut from.
// Change the app icon and run this; nothing to remember, nothing to keep in step by hand.
//
// What it writes, all in out/icons/:
//   play-512.png             512 x 512     Google Play's app icon, written as a 32-bit PNG whose alpha is all 255.
//                                          Play's field asks for 32-bit and Play forbids transparency in an icon, so
//                                          the only file that satisfies both readings is one with an opaque alpha.
//   app-store-1024.png      1024 x 1024    App Store Connect. RGB, no alpha (Apple rejects an alpha channel).
//   google-oauth-120.png     120 x 120     the Google sign-in consent screen.
//   play-feature.png        1024 x 500     Play's feature graphic: the Blip and the wordmark on the icon's own black.
//
// The feature graphic here SUPERSEDES build.mjs's out/play-feature.png, which art.mjs still draws with the old
// painted bot. build.mjs's phone screenshots are still that old character too; porting art.mjs to the Blip is its
// own job, and until it is done the screenshots are the one part of the Play listing that is off-brand.
//
// Needs Playwright's Chromium (the same one build.mjs uses) and nothing else: the resampling and the PNG encoding
// are the browser's, so this adds no image dependency to the repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../../app");
const BLIP = path.resolve(HERE, "../brand/blip-icon/cool");
const OUT = path.join(HERE, "out", "icons");
const FONT = path.join(HERE, "fonts", "Geist[wght].ttf");
const ICON = path.join(APP, "assets", "icon.png");
const FIGURE = path.join(BLIP, "adaptive-fg.svg");

/** The wordmark beside the Blip, the same two lines the frames use (frames.mjs FEATURE). */
const FEATURE = { mark: "X0", line: "Your team of bots" };

const require = createRequire(path.join(APP, "package.json"));
const { chromium } = require("playwright");

const url = (p) => "data:" + (p.endsWith(".svg") ? "image/svg+xml" : "image/png") + ";base64," + fs.readFileSync(p).toString("base64");

// ---------------------------------------------------------------- 24-bit -> 32-bit
// Chromium drops the alpha channel when a page is wholly opaque, which is right for Apple (it rejects an alpha
// channel) and arguable for Play. Play's icon field says "32-bit PNG", so that one file is widened back to RGBA
// with every pixel opaque. A tiny encoder rather than an image library: this tool must not add a dependency.

const crc32 = (buf) => {
  if (zlib.crc32) return zlib.crc32(buf);
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Read a PNG's pixels. Only what Chromium writes: 8-bit RGB or RGBA, no interlace, no palette. */
function decodePng(buf) {
  let i = 8, w = 0, h = 0, type = 0, idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), tag = buf.toString("latin1", i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (tag === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error("unexpected PNG: not 8-bit, non-interlaced");
      if (type !== 2 && type !== 6) throw new Error(`unexpected PNG colour type ${type}`);
    } else if (tag === "IDAT") idat.push(data);
    else if (tag === "IEND") break;
    i += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 0xFF;
    }
  }
  return { w, h, bpp, pix: out };
}

/** Write 8-bit RGBA, one filter-0 row at a time. */
function encodeRgba({ w, h, rgba }) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("sRGB", Buffer.from([0])),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Rewrite a file as 32-bit, every pixel opaque. A file that is already RGBA is made opaque and left otherwise alone. */
function widenToOpaqueRgba(file) {
  const { w, h, bpp, pix } = decodePng(fs.readFileSync(file));
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    rgba[i * 4] = pix[i * bpp]; rgba[i * 4 + 1] = pix[i * bpp + 1]; rgba[i * 4 + 2] = pix[i * bpp + 2];
    rgba[i * 4 + 3] = 255;
  }
  fs.writeFileSync(file, encodeRgba({ w, h, rgba }));
  return fs.statSync(file).size;
}

/** One shot at an exact pixel size: no device scaling, so the file is the size asked for. */
async function shot(browser, html, w, h, file) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: "png" });
  await page.close();
  fs.writeFileSync(file, buf);
  return buf.length;
}

/** The square icon at one size. Chromium screenshots have an alpha channel; `opaque` is about what we PROMISE. */
const square = (src, n) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${n}px;height:${n}px;overflow:hidden;background:#000}
  img{display:block;width:${n}px;height:${n}px}</style><img src="${src}">`;

const feature = (fig, font) => `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:Geist;src:url("${font}")format("truetype");font-weight:100 900}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1024px;height:500px;overflow:hidden}
  .g{width:1024px;height:500px;display:flex;align-items:center;justify-content:center;gap:30px;
     background:radial-gradient(120% 120% at 50% 40%, #1A1A1A 0%, #000 100%)}
  .blip{flex:0 0 500px;width:500px;height:500px;display:block;margin-left:-40px}
  .mark{font-family:Geist;font-weight:800;font-size:158px;line-height:.86;letter-spacing:-8px;color:#fff}
  .line{font-family:Geist;font-weight:600;font-size:37px;letter-spacing:-1.1px;color:#fff;opacity:.84;margin-top:16px}
  </style><div class="g"><img class="blip" src="${fig}"><div>
  <div class="mark">${FEATURE.mark}</div><div class="line">${FEATURE.line}</div></div></div>`;

for (const f of [ICON, FIGURE, FONT]) if (!fs.existsSync(f)) throw new Error(`missing: ${path.relative(HERE, f)}`);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const icon = url(ICON);
  const jobs = [
    ["play-512.png", 512, 512, square(icon, 512)],
    ["app-store-1024.png", 1024, 1024, square(icon, 1024)],
    ["google-oauth-120.png", 120, 120, square(icon, 120)],
    ["play-feature.png", 1024, 500, feature(url(FIGURE), url(FONT))],
  ];
  for (const [name, w, h, html] of jobs) {
    const file = path.join(OUT, name);
    let bytes = await shot(browser, html, w, h, file);
    // Play's icon alone: 32-bit, opaque. The rest stay as Chromium wrote them — Apple rejects an alpha channel,
    // and the feature graphic and the OAuth logo have no reason to carry one.
    if (name === "play-512.png") bytes = widenToOpaqueRgba(file);
    console.log(`${name.padEnd(22)} ${w} x ${h}   ${(bytes / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
console.log(`\nfrom app/assets/icon.png — re-run after any icon change.`);
