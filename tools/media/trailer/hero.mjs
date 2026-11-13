#!/usr/bin/env node
/**
 * The hero's extra layers for the trailer: his face without the eyes, and the eyes alone, so the eyes can move (look at
 * you, glance at a word) while the rest of him is the launch's own art, facet for facet. Drawn by the brand's launch.mjs
 * page code (tools/media/brand/x0-icon/curious-hang), the same way store/art.mjs renderHang draws the big launch layers:
 * the same seed, pose and cuts, in the same 1632 px frame as store/out/art/hang-*-1632.png, so every layer stacks.
 *
 *   PW_ROOT=<dir with playwright> node tools/media/trailer/hero.mjs [--size 1632] [--out hero]
 *
 * Writes hero/hang-face-<size>.png and hero/hang-eyes-<size>.png (plus the other layers again, to check the stack).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SIZE = Number(opt("size", "1632")), OUT = path.resolve(here, opt("out", "hero"));
const BRAND = path.resolve(here, "../brand/x0-icon"), HANG = path.join(BRAND, "curious-hang"), LIB = path.join(BRAND, "handdrawn-v2");

const src = fs.readFileSync(path.join(HANG, "launch.mjs"), "utf8");
const m = src.match(/const PAGE = String\.raw`([\s\S]*?)`;\n/);
if (!m || !/const OUT = 544, SS = 3/.test(m[1]) || !/const KEEP = \{ all: \(\) => true, head: \(k\) => k !== "hand", hands: \(k\) => k === "hand", bar: \(\) => false, blink: \(\) => false \};/.test(m[1]))
  throw new Error("hero: launch.mjs's page code has changed shape; update hero.mjs");
const code = m[1]
  .replace("const OUT = 544, SS = 3", `const OUT = ${SIZE}, SS = 2`)
  // two more layers: the face (everything but the gloves and the eyes: the visor fills where the eyes were) and the eyes
  .replace(`const KEEP = { all: () => true, head: (k) => k !== "hand", hands: (k) => k === "hand", bar: () => false, blink: () => false };`,
    `const KEEP = { all: () => true, head: (k) => k !== "hand", hands: (k) => k === "hand", bar: () => false, blink: () => false, face: (k) => k !== "hand" && k !== "eye", eyes: (k) => k === "eye" };`)
  .replace(`blink: layer("blink", N, crop, {}) };`, `blink: layer("blink", N, crop, {}), face: layer("face", N, crop, {}), eyes: layer("eyes", N, crop, {}) };`)
  .replace(`hands: png(L.hands), blink: png(L.blink) },`, `hands: png(L.hands), blink: png(L.blink), face: png(L.face), eyes: png(L.eyes) },`);
if (!/face: png\(L\.face\)/.test(code) || !/face: layer\("face"/.test(code)) throw new Error("hero: could not patch launch.mjs's page code");

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.error("PAGE ERROR", e.message); process.exitCode = 1; });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(LIB, f) });
  await page.addScriptTag({ path: path.join(HANG, "versions.js") });
  await page.addScriptTag({ content: code });
  const r = await page.evaluate(() => window.LAUNCH.run());
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of Object.entries(r.files)) fs.writeFileSync(path.join(OUT, `hang-${name}-${SIZE}.png`), Buffer.from(url.split(",")[1], "base64"));
  console.log(`wrote ${OUT}/hang-{${Object.keys(r.files).join(",")}}-${SIZE}.png  pivot ${r.pivot.map((v) => v.toFixed(4)).join(", ")}`);
} finally {
  await browser.close();
}
