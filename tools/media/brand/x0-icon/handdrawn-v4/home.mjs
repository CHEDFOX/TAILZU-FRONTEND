// The icons on a mock iPhone home screen, among plain neutral placeholder apps, on a dark and a
// light wallpaper (two phones side by side).
//
//   node home.mjs out.png [dir=.] [ids,comma,separated]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, dirArg, idsArg] = process.argv.slice(2);
const dir = dirArg || here;
const ids = idsArg ? idsArg.split(",") : fs.readdirSync(dir).filter((d) => /^\d-/.test(d) && fs.existsSync(path.join(dir, d, "icon-1024.png"))).sort();
const icons = ids.map((id) => ({ id, src: "data:image/png;base64," + fs.readFileSync(path.join(dir, id, "icon-1024.png")).toString("base64") }));

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#E9E6E1;font-family:-apple-system,"Helvetica Neue",system-ui,sans-serif}
.wrap{display:flex;gap:48px;padding:40px 48px;align-items:flex-start}
.phone{width:390px;height:844px;border-radius:56px;padding:12px;background:#111;box-shadow:0 20px 50px #0004}
.screen{position:relative;width:100%;height:100%;border-radius:46px;overflow:hidden}
.dark .screen{background:radial-gradient(120% 80% at 20% 10%,#3B4C86 0%,#1B2246 45%,#120F24 100%)}
.light .screen{background:radial-gradient(120% 80% at 80% 0%,#FFE7D6 0%,#E8E2F4 45%,#CFDDF0 100%)}
.status{display:flex;justify-content:space-between;padding:18px 34px 0;font-weight:600;font-size:16px}
.dark .status{color:#fff}.light .status{color:#111}
.grid{display:grid;grid-template-columns:repeat(4,64px);justify-content:space-between;row-gap:22px;padding:34px 26px 0}
.app{display:flex;flex-direction:column;align-items:center;gap:6px}
.ic{width:64px;height:64px;border-radius:14.3px;overflow:hidden;position:relative}
.ic canvas{display:block;width:100%;height:100%}
.lab{font-size:11.5px;letter-spacing:.1px;white-space:nowrap}
.dark .lab{color:#fff;text-shadow:0 1px 2px #0006}.light .lab{color:#1b1b1f}
.ph{display:flex;align-items:center;justify-content:center}
.dock{position:absolute;left:12px;right:12px;bottom:12px;height:94px;border-radius:34px;display:grid;grid-template-columns:repeat(4,64px);justify-content:space-between;align-items:center;padding:0 18px}
.dark .dock{background:#ffffff26;backdrop-filter:blur(20px)}.light .dock{background:#ffffff8c}
.dots{position:absolute;bottom:120px;left:0;right:0;display:flex;justify-content:center;gap:8px}
.dots i{width:7px;height:7px;border-radius:50%;background:#fff8}.dots i:first-child{background:#fff}
.light .dots i{background:#0003}.light .dots i:first-child{background:#000a}
.title{font:600 15px -apple-system,system-ui,sans-serif;color:#333;margin:0 0 10px 6px}
</style>
<div class="wrap"><div><div class="title">Dark wallpaper</div><div class="phone dark"><div class="screen" id="d"></div></div></div>
<div><div class="title">Light wallpaper</div><div class="phone light"><div class="screen" id="l"></div></div></div></div>
<script>
const ICONS = ${JSON.stringify(icons)}, NAMES = ${JSON.stringify(Object.fromEntries(ids.map((id) => [id, id])))};
// neutral placeholders: plain grey tiles with a simple white or grey glyph
const PH = [["#FFFFFF","#C9C9CE","circle","Mail"],["#8E8E93","#FFFFFF","bars","Notes"],["#3A3A3C","#AEAEB2","ring","Clock"],["#D1D1D6","#FFFFFF","square","Photos"],
  ["#636366","#E5E5EA","grid","Files"],["#F2F2F7","#8E8E93","dot","Maps"],["#48484A","#D1D1D6","bars","Music"],["#AEAEB2","#FFFFFF","ring","Camera"],
  ["#E5E5EA","#636366","square","Wallet"],["#1C1C1E","#8E8E93","circle","Weather"],["#C7C7CC","#FFFFFF","grid","Health"],["#7C7C80","#F2F2F7","dot","Books"],
  ["#FFFFFF","#AEAEB2","bars","News"],["#545458","#E5E5EA","circle","Home"],["#D8D8DC","#8E8E93","ring","Shop"]];
function glyph(c, kind, col) { const x = c.getContext("2d"), s = c.width; x.fillStyle = col; x.strokeStyle = col; x.lineWidth = s * 0.08;
  if (kind === "circle") { x.beginPath(); x.arc(s/2, s/2, s*0.24, 0, 7); x.fill(); }
  if (kind === "ring") { x.beginPath(); x.arc(s/2, s/2, s*0.24, 0, 7); x.stroke(); }
  if (kind === "square") { x.beginPath(); x.roundRect(s*0.28, s*0.28, s*0.44, s*0.44, s*0.08); x.fill(); }
  if (kind === "dot") { x.beginPath(); x.arc(s/2, s/2, s*0.12, 0, 7); x.fill(); }
  if (kind === "bars") { for (let i = 0; i < 3; i++) { x.beginPath(); x.roundRect(s*0.26, s*(0.3 + i*0.16), s*0.48, s*0.07, s*0.035); x.fill(); } }
  if (kind === "grid") { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.beginPath(); x.roundRect(s*(0.28 + i*0.24), s*(0.28 + j*0.24), s*0.2, s*0.2, s*0.05); x.fill(); } } }
function down(img, px) { let c = document.createElement("canvas"), w = img.naturalWidth; c.width = c.height = w; c.getContext("2d").drawImage(img, 0, 0);
  while (w / 2 >= px * 1.5) { const d = document.createElement("canvas"); d.width = d.height = Math.round(w / 2); const x = d.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, d.width, d.height); c = d; w = d.width; }
  const d = document.createElement("canvas"); d.width = d.height = px; const x = d.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, px, px); return d; }
function app(tile, label) { const a = document.createElement("div"); a.className = "app"; const ic = document.createElement("div"); ic.className = "ic"; ic.appendChild(tile);
  a.appendChild(ic); a.insertAdjacentHTML("beforeend", '<div class="lab">' + label + "</div>"); return a; }
function placeholder(i) { const [bg, fg, kind, name] = PH[i % PH.length], c = document.createElement("canvas"); c.width = c.height = 192;
  const x = c.getContext("2d"); x.fillStyle = bg; x.fillRect(0, 0, 192, 192); glyph(c, kind, fg); return app(c, name); }
Promise.all(ICONS.map((it) => new Promise((ok) => { const im = new Image(); im.onload = () => ok({ ...it, im }); im.src = it.src; }))).then((list) => {
  for (const id of ["d", "l"]) {
    const sc = document.getElementById(id);
    sc.insertAdjacentHTML("beforeend", '<div class="status"><span>9:41</span><span>●●● ▮</span></div>');
    const g = document.createElement("div"); g.className = "grid"; sc.appendChild(g);
    // row 1: placeholders; rows 2-3(+): the X0 icons; then placeholders to fill six rows
    let p = 0; for (let i = 0; i < 4; i++) g.appendChild(placeholder(p++));
    list.forEach((it, k) => g.appendChild(app(down(it.im, 192), "X0 " + (k + 1))));
    while (g.children.length < 24) g.appendChild(placeholder(p++));
    sc.insertAdjacentHTML("beforeend", '<div class="dots"><i></i><i></i><i></i></div>');
    const dock = document.createElement("div"); dock.className = "dock"; for (let i = 0; i < 4; i++) dock.appendChild(placeholder(p++).firstChild); sc.appendChild(dock);
  }
  window.ready = true;
});
</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 960 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await page.setContent(html);
await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote", out);
