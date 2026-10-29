// node sheet.mjs out.png dir1[=Label] dir2[=Label] ...   (each dir holds an icon-1024.png)
// The variants large (220 pt, iOS corner radius 22.37%), then each at 60/40/29 pt on a dark and a
// light wallpaper (2x), and 29 px at 1x enlarged (the worst case).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node-tools/node_modules/")("playwright")); }
const [out, ...items] = process.argv.slice(2);
const list = items.map((it) => { const [d, label] = it.split("="); return { src: "data:image/png;base64," + fs.readFileSync(d.replace(/\/$/, "") + "/" + (fs.readdirSync(d).find((f) => /^icon-\d+\.png$/.test(f)) || "icon-1024.png")).toString("base64"), label: label || d.split("/").filter(Boolean).pop() }; });
const icon = (src, s) => `<img src="${src}" style="width:${s}px;height:${s}px;border-radius:${(s * 0.2237).toFixed(2)}px">`;
const wall = (cls) => `<div class="wall ${cls}">${list.map((v) => `<div class="cell"><div class="sizes">${[60, 40, 29].map((s) => icon(v.src, s)).join("")}</div><div class="cap">${v.label}</div></div>`).join("")}</div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#E9E6E0;font:500 14px/1.3 Inter,system-ui,sans-serif;color:#1C1A17;padding:28px;width:${list.length * 268 + 30}px}
.big{display:flex;gap:48px;padding:6px 8px 26px}
.big>div{display:flex;flex-direction:column;align-items:center;gap:12px}
img{display:block;flex:none}
.big img{box-shadow:0 10px 30px #0004}
.wall{display:flex;gap:36px;padding:22px 26px;border-radius:24px;margin-bottom:18px}
.dark{background:radial-gradient(120% 140% at 20% 0%,#2E3F6B,#141C33 55%,#2D1E38)}
.light{background:linear-gradient(160deg,#F1ECE3,#CCD6E4)}
.cell{width:220px}.sizes{display:flex;gap:22px;align-items:flex-end}
.sizes img{box-shadow:0 1px 2px #0003}
.cap{font-size:12px;margin-top:9px;color:#fff;opacity:.85}.light .cap{color:#222}
.x1{display:flex;gap:36px;padding:8px 26px}
.x1 canvas{width:87px;height:87px;image-rendering:pixelated;border-radius:19px}
</style></head><body>
<div class="big">${list.map((v) => `<div>${icon(v.src, 220)}<b>${v.label}</b></div>`).join("")}</div>
${wall("dark")}${wall("light")}
<div class="x1">${list.map((v, i) => `<div style="width:220px"><canvas data-i="${i}" width="29" height="29"></canvas><div style="font-size:11px;color:#555;margin-top:5px">29 px at 1x, enlarged</div></div>`).join("")}</div>
<script>
const srcs = ${JSON.stringify(list.map((v) => v.src))};
Promise.all([...document.querySelectorAll(".x1 canvas")].map((c) => new Promise((ok) => {
  const img = new Image(); img.onload = () => { const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, 29, 29); ok(); }; img.src = srcs[+c.dataset.i];
}))).then(() => { window.ready = true; });
</script></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: list.length * 268 + 86, height: 600 }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
await p.waitForTimeout(200);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log("wrote", out);
