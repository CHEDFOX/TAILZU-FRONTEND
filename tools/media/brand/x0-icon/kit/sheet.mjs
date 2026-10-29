// (copied from ../../blip-icon/kit) node sheet.mjs out.png a.svg[=Label] b.svg[=Label] ...
// One row per icon: the master at 360, then the icon as a phone shows it
// (squircle mask) at 120/60/40/29 points on a dark and a light wallpaper, at 3x,
// and a 1x 29 px worst case. Icons are full-bleed squares (any viewBox).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const [out, ...items] = process.argv.slice(2);
const rows = items.map((it) => { const [f, label] = it.split("="); return { svg: fs.readFileSync(f, "utf8"), label: label || f.split("/").pop() }; });
const icon = (svg, s, extra = "") => `<div class="ic" style="width:${s}px;height:${s}px;border-radius:${(s * .2237).toFixed(1)}px;${extra}">${svg}</div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#F2EFE9;font:500 15px/1.3 -apple-system,system-ui,sans-serif;color:#1C1A17}
.row{display:flex;gap:28px;align-items:center;padding:24px 28px;border-bottom:1px solid #0001}
.ic{overflow:hidden;flex:none;box-shadow:0 1px 2px #0003}.ic svg{width:100%;height:100%;display:block}
.wall{display:flex;gap:22px;align-items:flex-end;padding:22px;border-radius:22px}
.dark{background:linear-gradient(160deg,#24345A,#101A30 55%,#3A2440)}
.light{background:linear-gradient(160deg,#EDE7DC,#C9D3E2)}
.lab{width:150px;flex:none}.cap{font-size:11px;text-align:center;margin-top:5px;color:#fff}.light .cap{color:#222}
.x1{image-rendering:pixelated}
</style></head><body>
${rows.map((r) => `<div class="row"><div class="lab">${r.label}</div>${icon(r.svg, 360)}
<div class="wall dark">${[120, 60, 40, 29].map((s) => `<div>${icon(r.svg, s)}<div class="cap">${s}</div></div>`).join("")}</div>
<div class="wall light">${[60, 40].map((s) => `<div>${icon(r.svg, s)}<div class="cap">${s}</div></div>`).join("")}</div>
<div><canvas class="x1" data-i="${rows.indexOf(r)}" width="29" height="29" style="width:87px;height:87px;border-radius:19px"></canvas><div class="cap" style="color:#555">29px at 1x, enlarged</div></div>
</div>`).join("")}
<script>
window.svgs = ${JSON.stringify(rows.map((r) => r.svg))};
Promise.all([...document.querySelectorAll("canvas.x1")].map((c) => new Promise((ok) => {
  const img = new Image(); img.onload = () => { c.getContext("2d").drawImage(img, 0, 0, 29, 29); ok(); }; img.onerror = ok;
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(window.svgs[+c.dataset.i]);
}))).then(() => { window.ready = true; });
</script></body></html>`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1320, height: 400 }, deviceScaleFactor: 3 });
p.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
await p.setContent(html);
await p.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
await p.waitForTimeout(150);
await p.screenshot({ path: out, fullPage: true, scale: "css" });
await b.close();
console.log("wrote", out);
