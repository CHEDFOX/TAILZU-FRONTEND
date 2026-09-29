#!/usr/bin/env node
/**
 * Render the site's pictures into tailzu-web: the link card and the icons.
 *
 *   PW_ROOT=<dir with playwright> node tools/media/render-site.mjs <tailzu-web>
 *
 *   og.png                1200 × 630   og.html, the card a shared link unfurls into
 *   favicon.ico           48/32/16     the site's favicon.svg, for crawlers and
 *                                      the browsers that want a raster
 *   apple-touch-icon.png  180 × 180
 *   icon-512.png          512 × 512    the logo in the site's structured data
 *
 * favicon.svg is the source of the icons and lives in the site itself.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");

const site = process.argv[2];
if (!site || !fs.existsSync(path.join(site, "favicon.svg"))) {
  console.error("usage: render-site.mjs <tailzu-web dir, holding favicon.svg>");
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--headless=new", "--no-sandbox"], ignoreDefaultArgs: ["--headless=old"],
});
async function shot(url, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.route("**/*", (r) => r.request().url().startsWith("file:") ? r.continue() : r.abort());
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  await page.close();
}

await shot("file://" + path.join(here, "og.html"), 1200, 630, path.join(site, "og.png"));
const svg = "file://" + path.resolve(site, "favicon.svg");
const tmp = fs.mkdtempSync(path.join(site, ".icons-"));
for (const s of [16, 32, 48, 180, 512]) {
  const html = path.join(tmp, `i${s}.html`);
  fs.writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:#0F0D0B}img{display:block;width:${s}px;height:${s}px}</style><img src="${svg}">`);
  await shot("file://" + html, s, s, path.join(tmp, `${s}.png`));
}
await browser.close();
fs.copyFileSync(path.join(tmp, "180.png"), path.join(site, "apple-touch-icon.png"));
fs.copyFileSync(path.join(tmp, "512.png"), path.join(site, "icon-512.png"));
// One .ico holding 48, 32 and 16: ffmpeg writes a single size, so stitch the
// three PNGs into the ICO container by hand (PNG-in-ICO is valid since Vista).
const imgs = [48, 32, 16].map((s) => ({ s, buf: fs.readFileSync(path.join(tmp, `${s}.png`)) }));
const head = Buffer.alloc(6 + 16 * imgs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
let offset = head.length;
imgs.forEach(({ s, buf }, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += buf.length;
});
fs.writeFileSync(path.join(site, "favicon.ico"), Buffer.concat([head, ...imgs.map((i) => i.buf)]));
fs.rmSync(tmp, { recursive: true, force: true });
// The card is a photograph of flat colour and type; a palette PNG holds it.
spawnSync("python3", ["-c", `from PIL import Image; im=Image.open(${JSON.stringify(path.join(site, "og.png"))}).convert("RGB"); im.save(${JSON.stringify(path.join(site, "og.png"))}, optimize=True)`]);
for (const f of ["og.png", "favicon.ico", "apple-touch-icon.png", "icon-512.png"]) {
  console.log(`${f}  ${(fs.statSync(path.join(site, f)).size / 1e3).toFixed(0)} KB`);
}
