// node png.mjs in.svg out.png [size=1024] [mask=0|1]   one icon as a PNG (mask=1 adds the squircle corners)
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const [inp, out, size = "1024", mask = "0"] = process.argv.slice(2);
const s = +size, svg = fs.readFileSync(inp, "utf8");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
await p.setContent(`<!doctype html><body style="margin:0;background:transparent"><div style="width:${s}px;height:${s}px;overflow:hidden;${+mask ? `border-radius:${s * .2237}px` : ""}">${svg.replace("<svg", '<svg width="100%" height="100%"')}</div></body>`);
await p.waitForTimeout(100);
await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
await b.close();
console.log("wrote", out);
