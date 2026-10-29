// Comparison sheet for the hand-drawn X0 Bot icons.
//
//   node sheet.mjs out.png [dir=.] [ids...]
//
// One row per version: the icon large (220 pt, iOS corner radius 22.37%), then 60 / 40 / 29 pt on a
// dark and a light wallpaper (rendered at 2x like a phone), and 29 px at 1x enlarged (the worst case).
// Small sizes are made from icon-1024.png by stepwise halving, as the OS does from the master.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, dirArg, ...only] = process.argv.slice(2);
const dir = dirArg || here;

// names and notes come from versions.js (evaluated in the page below)
const ids = fs.readdirSync(dir).filter((d) => /^\d-/.test(d) && fs.existsSync(path.join(dir, d)) &&
  fs.readdirSync(path.join(dir, d)).some((f) => /^icon-\d+\.png$/.test(f))).sort()
  .filter((id) => !only.length || only.some((o) => id.startsWith(o)));
const icons = ids.map((id) => {
  const f = fs.readdirSync(path.join(dir, id)).filter((f) => /^icon-\d+\.png$/.test(f)).sort((a, b) => parseInt(b.slice(5)) - parseInt(a.slice(5)))[0];
  return { id, src: "data:image/png;base64," + fs.readFileSync(path.join(dir, id, f)).toString("base64") };
});

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#EDEAE4;font:500 14px/1.35 -apple-system,"Helvetica Neue",system-ui,sans-serif;color:#1C1A17}
.wrap{padding:26px 28px 30px;display:flex;flex-direction:column;gap:18px}
.row{display:flex;gap:22px;align-items:center}
.lab{width:170px;flex:none}.lab b{display:block;font-size:17px;margin-bottom:4px}.lab span{color:#6a645c;font-size:12.5px}
.ic{flex:none;overflow:hidden;box-shadow:0 1px 3px #0003}
.ic canvas,.ic img{display:block;width:100%;height:100%}
.wall{display:flex;gap:18px;align-items:flex-end;padding:18px 20px;border-radius:20px;flex:none}
.dark{background:linear-gradient(160deg,#27355A,#121A2E 55%,#3B2643)}
.light{background:linear-gradient(160deg,#F1ECE3,#CBD5E3)}
.cap{font-size:10.5px;text-align:center;margin-top:5px;color:#fffc}.light .cap{color:#333c}
.x1{display:flex;gap:10px;align-items:flex-end}.x1 canvas{image-rendering:pixelated;width:58px;height:58px;border-radius:13px}
.x1 .cap{color:#555}
</style><div class="wrap" id="w"></div>
<script>
const ICONS = ${JSON.stringify(icons)};
const META = ${JSON.stringify(Object.fromEntries(ids.map((id) => [id, null])))};
function down(img, px) {           // stepwise halving, then the last step: a clean downscale
  let c = document.createElement("canvas"), w = img.naturalWidth; c.width = c.height = w; c.getContext("2d").drawImage(img, 0, 0);
  while (w / 2 >= px * 1.5) { const d = document.createElement("canvas"); d.width = d.height = Math.round(w / 2);
    const x = d.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, d.width, d.height); c = d; w = d.width; }
  const d = document.createElement("canvas"); d.width = d.height = px; const x = d.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, px, px); return d;
}
const R = 0.2237, DPR = 2;
function icon(img, pt) { const el = document.createElement("div"); el.className = "ic"; el.style.cssText = "width:" + pt + "px;height:" + pt + "px;border-radius:" + (pt * R).toFixed(2) + "px";
  el.appendChild(down(img, pt * DPR)); return el; }
Promise.all(ICONS.map((it) => new Promise((ok) => { const im = new Image(); im.onload = () => ok({ ...it, im }); im.src = it.src; }))).then((list) => {
  const w = document.getElementById("w");
  for (const it of list) {
    const v = (window.HDV || {})[it.id] || {};
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = '<div class="lab"><b>' + (v.name || it.id) + '</b><span>' + (v.note || "") + '</span></div>';
    row.appendChild(icon(it.im, 220));
    for (const cls of ["dark", "light"]) {
      const wall = document.createElement("div"); wall.className = "wall " + cls;
      for (const pt of [60, 40, 29]) { const b = document.createElement("div"); b.appendChild(icon(it.im, pt)); b.insertAdjacentHTML("beforeend", '<div class="cap">' + pt + '</div>'); wall.appendChild(b); }
      row.appendChild(wall);
    }
    const x1 = document.createElement("div"); x1.className = "x1";
    const c29 = down(it.im, 29); const b = document.createElement("div"); b.appendChild(c29); b.insertAdjacentHTML("beforeend", '<div class="cap">29 px at 1x</div>'); x1.appendChild(b);
    row.appendChild(x1);
    w.appendChild(row);
  }
  window.ready = true;
});
</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 400 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await page.setContent("<!doctype html><body></body>");
await page.addScriptTag({ path: path.join(here, "draw.js") });
await page.addScriptTag({ path: path.join(here, "bot.js") });
await page.addScriptTag({ path: path.join(here, "versions.js") });
if (fs.existsSync(path.join(dir, "versions.js")) && path.resolve(dir) !== here) await page.addScriptTag({ path: path.join(dir, "versions.js") });   // a set built on this one
const meta = await page.evaluate(() => Object.fromEntries(HD.VERSIONS.concat(HD.HANG || []).map((v) => [v.id, { name: v.name, note: v.note }])));
await page.setContent(html.replace("<script>", `<script>window.HDV = ${JSON.stringify(meta)};`));
await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote", out);
