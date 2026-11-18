// Renders structure/structure.html and the bare marks to PNG.   PW_ROOT=$(npm root -g)/.. node structure-render.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 2240, height: 1290 }, deviceScaleFactor: 2 });
await p.goto("file://" + path.join(here, "structure", "structure.html"));
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(here, "structure", "blip-icon-structure.png") });
for (const c of ["white", "black"]) {
  const q = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  const svg = fs.readFileSync(path.join(here, `mark-${c}.svg`)).toString("base64");
  await q.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${svg}" width="1024" height="1024"></body></html>`);
  await q.waitForTimeout(200);
  await q.screenshot({ path: path.join(here, "structure", `blip-mark-${c}.png`), omitBackground: true });
}
await b.close();
