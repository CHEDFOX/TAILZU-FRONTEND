#!/usr/bin/env node
/**
 * The peek rig: the bot's peeking faces WITHOUT their gloves, and the gloves as their own sprites, so a glove can let
 * go of the edge, reach, flick, tap and wave while the face stays put. Drawn by store/art.mjs's own page code (the
 * icon's painter, seed 3131, the same poses), patched so a bot can be drawn with no hands, or hands only; every part
 * is cut exactly as the store frames' faces are. Also regenerates Code bot's underline in the one true moss (#4F7A3A;
 * the store's underline-2f5d50 is the brief's old moss).
 *
 *   PW_ROOT=<dir with playwright> node tools/media/trailer/peek.mjs [--out peek]
 *
 * Writes peek/bot-<pose>-nohands.png (curious, happy, shy, starry, hello, wink), peek/glove-L.png, peek/glove-R.png,
 * peek/underline-4f7a3a.png and peek/peek.json: for each file its size, its ledge (the y of the edge in the PNG) and
 * its box (where it sits in the common 1024 frame), so the face and its gloves line up again on the page.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");
const STORE = path.resolve(here, "../store");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(here, opt("out", "peek"));
fs.mkdirSync(OUT, { recursive: true });

const art = await import(pathToFileURL(path.join(STORE, "art.mjs")).href);
const src = fs.readFileSync(path.join(STORE, "art.mjs"), "utf8");
const m = src.match(/const PAGE = String\.raw`([\s\S]*?)`;\n/);
if (!m) throw new Error("peek: art.mjs's page code has changed shape");
let code = m[1];
const patch = (from, to) => { if (!code.includes(from)) throw new Error(`peek: art.mjs's page code has changed shape (${from.slice(0, 40)})`); code = code.replace(from, to); };
// the trim box comes back too, so parts cut from one frame can be laid together again
patch(`return { png: cv.toDataURL("image/png"), w, h, ledge: ledgeY === undefined ? null : (ledgeY * out) / 1000 - y0,`,
  `return { png: cv.toDataURL("image/png"), w, h, x0, y0, out, ledge: ledgeY === undefined ? null : (ledgeY * out) / 1000 - y0,`);
// a bot with no hands, or hands only (the other parts painted at p 0 so the cuts' seeded sequence is unchanged)
patch(`function bot(pose, out) {`, `function bot(pose, out, o = {}) {`);
patch(`bot: { ...base.bot, antenna: false, tilt: P.tilt ?? 0, rise: P.rise ?? 128, hw: 350, hh: 270, face },`,
  `bot: { ...base.bot, antenna: false, tilt: P.tilt ?? 0, rise: P.rise ?? 128, hw: 350, hh: 270, face, hands: o.hands ?? [-1, 1] },`);
patch(`    return lift(2048, 3131, out, (art, bg) => {`,
  `    if (o.only) { const st = spec.style; spec.style = (K) => { const s = st(K); for (const k of Object.keys(s)) { if (!s[k]) continue;
        const isHand = k === "hand" || k === "handLine"; if ((o.only === "hands") !== isHand) { if (k === "halo" || k === "handLine") s[k] = null; else s[k] = { ...s[k], p: 0 }; } } return s; }; }
    return lift(2048, 3131, out, (art, bg) => {`);
code = code.replace("__POSES__", JSON.stringify(art.POSES)).replace("__CLAY__", JSON.stringify("#D2703F"));

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const meta = {};
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.error("PAGE ERROR", e.message); process.exitCode = 1; });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(art.artDir(), f) });
  await page.addScriptTag({ content: code });
  const save = (name, r) => {
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.png.split(",")[1], "base64"));
    meta[name] = { file: `${name}.png`, w: r.w, h: r.h, x0: r.x0, y0: r.y0, frame: r.out, ledge: r.ledge };
    console.log(`${name}  ${r.w}x${r.h}  at ${r.x0},${r.y0}  ledge ${r.ledge == null ? "-" : r.ledge.toFixed(1)}`);
  };
  for (const pose of Object.keys(art.POSES)) {
    save(`bot-${pose}-nohands`, await page.evaluate((p) => X0ART.bot(p, 1024, { hands: [] }), pose));
    save(`bot-${pose}`, await page.evaluate((p) => X0ART.bot(p, 1024), pose));   // the full face again, in this frame, to check the stack
  }
  save("glove-L", await page.evaluate(() => X0ART.bot("curious", 1024, { hands: [-1], only: "hands" })));
  save("glove-R", await page.evaluate(() => X0ART.bot("curious", 1024, { hands: [1], only: "hands" })));
  await page.close();
  const ul = await art.renderArt(browser, [{ name: "underline-4f7a3a", kind: "underline", seed: 7, color: "#4F7A3A" }], OUT);
  meta["underline-4f7a3a"] = { file: "underline-4f7a3a.png", w: ul["underline-4f7a3a"].w, h: ul["underline-4f7a3a"].h };
  fs.rmSync(path.join(OUT, "art.json"), { force: true });
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, "peek.json"), JSON.stringify(meta, null, 1));
console.log(`wrote ${OUT}/peek.json`);
