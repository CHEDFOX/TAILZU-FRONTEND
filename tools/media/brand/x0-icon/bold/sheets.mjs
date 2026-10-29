// Review sheet and home-screen mock for the bold X0 Bot icons.
//
//   node sheets.mjs sheet <out.png> [id ...]   large icons, then 60/40/29 pt on dark and light walls, 29 px at 1x
//   node sheets.mjs home  <out.png> [id ...]   each icon in a row of a mock iPhone home screen, among plain
//                                              neutral apps and among colourful apps, dark and light walls
//
// ids are folders next to this file holding icon-1024.png; titles and lines come from sheets.json.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node-tools/node_modules/")("playwright")); }
const here = path.dirname(fileURLToPath(import.meta.url));
const [mode, out, ...idArgs] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(here, "sheets.json"), "utf8"));
const root = process.env.ICON_DIR || here;
const ids = idArgs.length ? idArgs : meta.order;
const icons = ids.map((id) => ({
  id, ...(meta.icons[id] || { title: id, line: "" }),
  src: "data:image/png;base64," + fs.readFileSync(path.join(root, id, "icon-1024.png")).toString("base64"),
}));

const common = `
<style>
*{box-sizing:border-box}
body{margin:0;background:#ECE9E4;color:#161616;font-family:Inter,-apple-system,"Helvetica Neue",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
canvas.ic{display:block}
</style>
<script>
// iOS continuous-corner icon mask: a superellipse (n = 5) is within a pixel of Apple's shape at these sizes.
function squircle(ctx, s) { const n = 5, r = s / 2; ctx.beginPath();
  for (let i = 0; i <= 360; i++) { const t = i / 360 * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    const x = r + r * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), y = r + r * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); }
// Downscale in halving steps (what the system does when it rasterises an icon), then mask.
function iconCanvas(img, css, dpr) { const px = Math.round(css * dpr); let c = document.createElement("canvas"), w = img.naturalWidth;
  c.width = c.height = w; c.getContext("2d").drawImage(img, 0, 0);
  while (w / 2 >= px * 1.5) { const d = document.createElement("canvas"); d.width = d.height = Math.round(w / 2);
    const x = d.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, d.width, d.height); c = d; w = d.width; }
  const o = document.createElement("canvas"); o.width = o.height = px; const x = o.getContext("2d");
  squircle(x, px); x.clip(); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, px, px);
  o.className = "ic"; o.style.width = o.style.height = css + "px"; return o; }
function loadAll(list) { return Promise.all(list.map((it) => new Promise((ok) => { const im = new Image(); im.onload = () => ok({ ...it, im }); im.src = it.src; }))); }
</script>`;

const sheetHtml = `<!doctype html><meta charset="utf-8">${common}
<style>
.wrap{padding:56px 64px 64px;width:${Math.max(3, icons.length) * 330 + 128}px}
h1{font-size:40px;letter-spacing:-1px;margin:0 0 8px;font-weight:700}
.sub{color:#5b5b5b;font-size:17px;margin:0 0 40px;max-width:900px;line-height:1.45}
.row{display:grid;grid-template-columns:repeat(${icons.length},300px);gap:30px}
.card{background:#fff;border-radius:28px;padding:28px 30px 26px;display:flex;flex-direction:column;gap:16px}
.card .hero{display:flex;justify-content:center;padding:4px 0 6px}
.card .hero canvas{filter:drop-shadow(0 10px 22px rgba(0,0,0,.18))}
.k{display:flex;align-items:baseline;gap:10px}.k b{font-size:13px;color:#C9683F;font-weight:700;letter-spacing:.5px;white-space:nowrap}.k span{font-size:21px;font-weight:700;letter-spacing:-.3px}
.line{font-size:14px;color:#555;line-height:1.45;min-height:60px}
.walls{display:grid;grid-template-columns:repeat(${icons.length},300px);gap:30px;margin-top:30px}
.wall{border-radius:24px;padding:22px 20px 18px;display:flex;flex-direction:column;gap:14px}
.wall.dark{background:radial-gradient(120% 90% at 20% 0%,#3B4C86 0%,#1B2246 50%,#120F24 100%)}
.wall.light{background:radial-gradient(120% 90% at 80% 0%,#FFE7D6 0%,#E8E2F4 50%,#CFDDF0 100%)}
.sizes{display:flex;align-items:flex-end;gap:22px;justify-content:center}
.sizes div{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px}
.dark .sizes div{color:#fff}.light .sizes div{color:#222}
.label{font-size:11px;letter-spacing:.8px;text-transform:uppercase;font-weight:600}.dark .label{color:#ffffffb0}.light .label{color:#0008}
.px{display:flex;gap:30px;margin-top:30px}
.pxc{display:grid;grid-template-columns:repeat(${icons.length},300px);gap:30px}
.pxi{display:flex;gap:18px;align-items:center;justify-content:center;background:#fff;border-radius:22px;padding:18px}
.pxi canvas{image-rendering:pixelated}
.pxi small{font-size:12px;color:#666;max-width:90px;line-height:1.35}
h2{font-size:20px;margin:44px 0 0;letter-spacing:-.3px}
</style>
<div class="wrap">
<h1>X0 Bot: bold icons</h1>
<p class="sub">${meta.subtitle}</p>
<div class="row" id="cards"></div>
<h2>On the home screen, at 60, 40 and 29 pt</h2>
<div class="walls" id="dark"></div>
<div class="walls" id="light"></div>
<h2>The harshest test: 29 px at 1x, enlarged</h2>
<div class="pxc" id="px" style="margin-top:16px"></div>
</div>
<script>
const ICONS = ${JSON.stringify(icons)};
loadAll(ICONS).then((list) => {
  list.forEach((it, i) => {
    const c = document.createElement("div"); c.className = "card";
    const h = document.createElement("div"); h.className = "hero"; h.appendChild(iconCanvas(it.im, 240, 2)); c.appendChild(h);
    c.insertAdjacentHTML("beforeend", '<div class="k"><b>' + it.tag + '</b><span>' + it.title + '</span></div><div class="line">' + it.line + '</div>');
    document.getElementById("cards").appendChild(c);
    for (const w of ["dark", "light"]) {
      const d = document.createElement("div"); d.className = "wall " + w;
      d.insertAdjacentHTML("beforeend", '<div class="label">' + it.tag + ' · ' + w + ' wallpaper</div>');
      const s = document.createElement("div"); s.className = "sizes";
      for (const z of [60, 40, 29]) { const b = document.createElement("div"); b.appendChild(iconCanvas(it.im, z, 2)); b.insertAdjacentHTML("beforeend", "<span>" + z + "</span>"); s.appendChild(b); }
      d.appendChild(s); document.getElementById(w).appendChild(d);
    }
    const p = document.createElement("div"); p.className = "pxi";
    const one = iconCanvas(it.im, 29, 1); const big = document.createElement("canvas"); big.width = big.height = 29;
    big.getContext("2d").drawImage(one, 0, 0); big.style.width = big.style.height = "116px"; big.className = "ic";
    p.appendChild(big); p.insertAdjacentHTML("beforeend", "<small>" + it.tag + " · " + it.title + "<br>29 px, 1x, shown 4x</small>");
    document.getElementById("px").appendChild(p);
  });
  window.ready = true;
});
</script>`;

const homeHtml = `<!doctype html><meta charset="utf-8">${common}
<style>
.wrap{display:flex;gap:40px;padding:46px 48px 50px;align-items:flex-start}
.col{display:flex;flex-direction:column;gap:12px}
.title{font:600 15px Inter,system-ui,sans-serif;color:#333;margin-left:6px}
.phone{width:390px;height:844px;border-radius:58px;padding:12px;background:#0d0d0d;box-shadow:0 22px 50px #0004}
.screen{position:relative;width:100%;height:100%;border-radius:47px;overflow:hidden}
.dark .screen{background:radial-gradient(120% 80% at 20% 10%,#3B4C86 0%,#1B2246 45%,#120F24 100%)}
.light .screen{background:radial-gradient(120% 80% at 80% 0%,#FFE7D6 0%,#E8E2F4 45%,#CFDDF0 100%)}
.status{display:flex;justify-content:space-between;padding:18px 34px 0;font-weight:600;font-size:16px}
.dark .status{color:#fff}.light .status{color:#111}
.grid{display:grid;grid-template-columns:repeat(4,64px);justify-content:space-between;row-gap:20px;padding:30px 26px 0}
.app{display:flex;flex-direction:column;align-items:center;gap:6px}
.lab{font-size:11.5px;letter-spacing:.1px;white-space:nowrap;font-family:-apple-system,"Helvetica Neue",Inter,sans-serif}
.dark .lab{color:#fff;text-shadow:0 1px 2px #0006}.light .lab{color:#1b1b1f}
.dock{position:absolute;left:12px;right:12px;bottom:12px;height:94px;border-radius:34px;display:grid;grid-template-columns:repeat(4,64px);justify-content:space-between;align-items:center;padding:0 18px}
.dark .dock{background:#ffffff26}.light .dock{background:#ffffff8c}
.dots{position:absolute;bottom:120px;left:0;right:0;display:flex;justify-content:center;gap:8px}
.dots i{width:7px;height:7px;border-radius:50%;background:#fff8}.dots i:first-child{background:#fff}
.light .dots i{background:#0003}.light .dots i:first-child{background:#000a}
</style>
<div class="wrap" id="w"></div>
<script>
const ICONS = ${JSON.stringify(icons)};
// plain neutral placeholders: grey tiles, simple glyphs
const NEU = [["#FFFFFF","#C9C9CE","circle"],["#8E8E93","#FFFFFF","bars"],["#3A3A3C","#AEAEB2","ring"],["#D1D1D6","#FFFFFF","square"],
  ["#636366","#E5E5EA","grid"],["#F2F2F7","#8E8E93","dot"],["#48484A","#D1D1D6","bars"],["#AEAEB2","#FFFFFF","ring"],
  ["#E5E5EA","#636366","square"],["#1C1C1E","#8E8E93","circle"],["#C7C7CC","#FFFFFF","grid"],["#7C7C80","#F2F2F7","dot"]];
// colourful placeholders: saturated gradient tiles like a real home screen (no real brands)
const COL = [["#34C759","#1F9D45","#fff","bubble"],["#0A84FF","#0060DF","#fff","ring"],["#FF9F0A","#FF6A00","#fff","sun"],["#FF375F","#D70040","#fff","heart"],
  ["#FFD60A","#F5B700","#5a3d00","bars"],["#BF5AF2","#7D2AE8","#fff","star"],["#64D2FF","#1E9BD7","#fff","drop"],["#FF6B6B","#FFB86B","#fff","square"],
  ["#30D158","#0A84FF","#fff","grid"],["#5E5CE6","#3634A3","#fff","dot"],["#FFFFFF","#EDEDED","#FF3B30","circle"],["#111111","#2a2a2a","#fff","bars"]];
const NAMES = ["Mail","Notes","Clock","Photos","Files","Maps","Music","Camera","Wallet","Weather","Health","Books","News","Home","Shop","Fitness","Podcasts","Stocks","Travel","Translate"];
function glyph(x, s, kind, col) { x.fillStyle = col; x.strokeStyle = col; x.lineWidth = s * 0.08; x.lineCap = "round"; x.lineJoin = "round";
  const P = (f) => { x.beginPath(); f(); };
  if (kind === "circle") { P(() => x.arc(s/2, s/2, s*0.24, 0, 7)); x.fill(); }
  if (kind === "ring") { P(() => x.arc(s/2, s/2, s*0.24, 0, 7)); x.stroke(); }
  if (kind === "square") { P(() => x.roundRect(s*0.28, s*0.28, s*0.44, s*0.44, s*0.08)); x.fill(); }
  if (kind === "dot") { P(() => x.arc(s/2, s/2, s*0.12, 0, 7)); x.fill(); }
  if (kind === "bars") { for (let i = 0; i < 3; i++) { P(() => x.roundRect(s*0.26, s*(0.3 + i*0.16), s*0.48, s*0.07, s*0.035)); x.fill(); } }
  if (kind === "grid") { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { P(() => x.roundRect(s*(0.28 + i*0.24), s*(0.28 + j*0.24), s*0.2, s*0.2, s*0.05)); x.fill(); } }
  if (kind === "bubble") { P(() => x.ellipse(s/2, s*0.47, s*0.27, s*0.22, 0, 0, 7)); x.fill(); P(() => { x.moveTo(s*0.33, s*0.6); x.lineTo(s*0.27, s*0.74); x.lineTo(s*0.45, s*0.66); }); x.fill(); }
  if (kind === "sun") { P(() => x.arc(s/2, s/2, s*0.14, 0, 7)); x.fill(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; P(() => { x.moveTo(s/2 + Math.cos(a)*s*0.22, s/2 + Math.sin(a)*s*0.22); x.lineTo(s/2 + Math.cos(a)*s*0.3, s/2 + Math.sin(a)*s*0.3); }); x.stroke(); } }
  if (kind === "heart") { P(() => { x.moveTo(s/2, s*0.72); x.bezierCurveTo(s*0.15, s*0.5, s*0.25, s*0.22, s/2, s*0.38); x.bezierCurveTo(s*0.75, s*0.22, s*0.85, s*0.5, s/2, s*0.72); }); x.fill(); }
  if (kind === "star") { P(() => { for (let i = 0; i < 10; i++) { const a = -Math.PI/2 + i * Math.PI / 5, r = i % 2 ? s*0.12 : s*0.28; x.lineTo(s/2 + Math.cos(a)*r, s*0.52 + Math.sin(a)*r); } x.closePath(); }); x.fill(); }
  if (kind === "drop") { P(() => { x.moveTo(s/2, s*0.22); x.bezierCurveTo(s*0.7, s*0.45, s*0.72, s*0.56, s*0.7, s*0.6); x.arc(s/2, s*0.6, s*0.2, 0, Math.PI); x.bezierCurveTo(s*0.28, s*0.56, s*0.3, s*0.45, s/2, s*0.22); }); x.fill(); } }
function tile(spec, colourful) { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  squircle(x, 128); x.clip();
  if (colourful) { const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, spec[0]); g.addColorStop(1, spec[1]); x.fillStyle = g; x.fillRect(0, 0, 128, 128); glyph(x, 128, spec[3], spec[2]); }
  else { x.fillStyle = spec[0]; x.fillRect(0, 0, 128, 128); glyph(x, 128, spec[2], spec[1]); }
  c.className = "ic"; c.style.width = c.style.height = "64px"; return c; }
function app(el, label) { const a = document.createElement("div"); a.className = "app"; a.appendChild(el); a.insertAdjacentHTML("beforeend", '<div class="lab">' + label + "</div>"); return a; }
loadAll(ICONS).then((list) => {
  const W = document.getElementById("w");
  for (const [wall, colourful, title] of [["dark", false, "Dark wallpaper, plain apps"], ["light", false, "Light wallpaper, plain apps"], ["dark", true, "Dark wallpaper, colourful apps"], ["light", true, "Light wallpaper, colourful apps"]]) {
    const col = document.createElement("div"); col.className = "col"; col.insertAdjacentHTML("beforeend", '<div class="title">' + title + "</div>");
    const ph = document.createElement("div"); ph.className = "phone " + wall; const sc = document.createElement("div"); sc.className = "screen"; ph.appendChild(sc); col.appendChild(ph); W.appendChild(col);
    sc.insertAdjacentHTML("beforeend", '<div class="status"><span>9:41</span><span>●●● ▮</span></div>');
    const g = document.createElement("div"); g.className = "grid"; sc.appendChild(g);
    const P = colourful ? COL : NEU; let p = 0, nm = 0;
    const ph1 = () => app(tile(P[p++ % P.length], colourful), NAMES[nm++ % NAMES.length]);
    for (let i = 0; i < 4; i++) g.appendChild(ph1());
    // one row per candidate: the candidate sits in a different column each row, among placeholders
    list.forEach((it, k) => { const at = [1, 2, 0, 3, 1, 2][k % 6];
      for (let c = 0; c < 4; c++) g.appendChild(c === at ? app(iconCanvas(it.im, 64, 2), "X0 " + it.tag) : ph1()); });
    while (g.children.length < 24) g.appendChild(ph1());
    sc.insertAdjacentHTML("beforeend", '<div class="dots"><i></i><i></i><i></i></div>');
    const dock = document.createElement("div"); dock.className = "dock"; for (let i = 0; i < 4; i++) dock.appendChild(tile(P[(p++ + 3) % P.length], colourful)); sc.appendChild(dock);
  }
  window.ready = true;
});
</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: mode === "home" ? 1860 : 1400, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await page.setContent(mode === "home" ? homeHtml : sheetHtml);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
if (mode === "sheet") {
  const w = await page.evaluate(() => document.querySelector(".wrap").scrollWidth);
  await page.setViewportSize({ width: w, height: 900 });
}
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote", out);
