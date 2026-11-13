// The Blip icon's structure: a construction sheet drawn from the same numbers as gen.mjs (mono), plus the bare mark.
//   node structure.mjs   ->  structure.html (the sheet)  mark-white.svg  mark-black.svg
// Render the PNGs with structure-render.mjs (Playwright).
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const f1 = (v) => (Math.round(v * 10) / 10).toString();

// ---- the icon's numbers (gen.mjs, kind "mono") ----
const H = { x: 500, y: 600, rx: 344, ry: 310, n: 2.3 };
const head = (t, off = 0) => { const c = Math.cos(t), s = Math.sin(t), e = 2 / H.n; return [Math.sign(c) * Math.abs(c) ** e * (H.rx + off), Math.sign(s) * Math.abs(s) ** e * (H.ry + off)]; };
const headPath = (off = 0) => Array.from({ length: 240 }, (_, i) => { const p = head((i / 240) * Math.PI * 2, off); return (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1]); }).join("") + "Z";
const visor = { x0: -232, x1: 232, y0: -108, y1: 22 };
const C = 27, ROW = C * 0.866;
const RL = head(-2.0, -30), RR = head(-1.14, -30);
const FL = { pts: [RL, [RL[0] - 2, RL[1] - 64], [RL[0] - 66, RL[1] - 74], [RL[0] - 58, RL[1] - 136]], w0: 30, w1: 9, tip: 15 };
const FR = { pts: [RR, [RR[0] + 8, RR[1] - 132], [RR[0] + 150, RR[1] - 206], [RR[0] + 166, RR[1] - 138]], w0: 32, w1: 8, tip: 16 };
const EARS = [-22, 4, 30].map((dy) => dy - 6), EAR_X = H.rx + 20;

// the mark itself, from gen.mjs's output
const mono = fs.readFileSync(path.join(here, "mono.svg"), "utf8");
const ground = mono.match(/<radialGradient id="mc-g"[\s\S]*?<rect width="1000" height="1000" fill="url\(#mc-g\)"\/>/)[0];
const bare = mono.replace(ground, "");
fs.writeFileSync(path.join(here, "mark-white.svg"), bare);
fs.writeFileSync(path.join(here, "mark-black.svg"), bare.replace(/#FFFFFF/g, "#0A0A0A").replace(/id="mc-/g, 'id="mk-').replace(/#mc-/g, "#mk-"));
const inner = (svg, pre) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/id="mc-/g, `id="${pre}-`).replace(/#mc-/g, `#${pre}-`);

// ---- drawing helpers (head-local coordinates) ----
const CLAY = "#E07A4C", GUIDE = "rgba(255,255,255,0.55)", FAINT = "rgba(255,255,255,0.22)";
const line = (a, b, c = GUIDE, w = 2, dash = "") => `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const dot = (p, r, c) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}" fill="${c}"/>`;
const ring = (p, r, c, w = 2) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
const txt = (p, s, o = {}) => `<text x="${f1(p[0])}" y="${f1(p[1])}" fill="${o.c || "#FFFFFF"}" font-size="${o.size || 22}" font-weight="${o.w || 500}" text-anchor="${o.a || "middle"}" dominant-baseline="middle"${o.op ? ` opacity="${o.op}"` : ""}>${s}</text>`;
const badge = (p, n) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="22" fill="${CLAY}"/>` + txt([p[0], p[1] + 1], n, { size: 24, w: 700 });
const callout = (from, to, n) => line(from, to, CLAY, 2.5) + dot(from, 6, CLAY) + badge(to, n);
const skeleton = (F) => { const [p0, p1, p2, p3] = F.pts; return line(p0, p1, CLAY, 2, "6 6") + line(p3, p2, CLAY, 2, "6 6") + `<path d="M${p0}C${p1} ${p2} ${p3}" fill="none" stroke="${CLAY}" stroke-width="3"/>` + [p1, p2].map((p) => `<rect x="${f1(p[0] - 7)}" y="${f1(p[1] - 7)}" width="14" height="14" fill="#000" stroke="${CLAY}" stroke-width="2.5"/>`).join("") + [p0, p3].map((p) => dot(p, 8, CLAY)).join(""); };
const dim = (a, b, label, side, off) => {   // a dimension line with end ticks and a label
  const ax = side === "h" ? [a[0], a[1] + off] : [a[0] + off, a[1]], bx = side === "h" ? [b[0], b[1] + off] : [b[0] + off, b[1]];
  const tick = (p) => side === "h" ? line([p[0], p[1] - 12], [p[0], p[1] + 12], GUIDE, 2) : line([p[0] - 12, p[1]], [p[0] + 12, p[1]], GUIDE, 2);
  const mid = [(ax[0] + bx[0]) / 2, (ax[1] + bx[1]) / 2];
  const lab = side === "h" ? txt([mid[0], mid[1] - 20], label, { size: 20, op: 0.85 }) : `<g transform="translate(${f1(mid[0] - 22)} ${f1(mid[1])}) rotate(-90)">${txt([0, 0], label, { size: 20, op: 0.85 })}</g>`;
  return line(ax, bx, GUIDE, 1.5) + tick(ax) + tick(bx) + lab;
};

// ---- the big view: the icon with its construction ----
const big = `<svg viewBox="-90 -90 1180 1180" width="1080" height="1080" xmlns="http://www.w3.org/2000/svg" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">
<defs><clipPath id="mask"><rect width="1000" height="1000" rx="224"/></clipPath></defs>
<g clip-path="url(#mask)">${inner(mono, "bg")}</g>
<rect width="1000" height="1000" rx="224" fill="none" stroke="${FAINT}" stroke-width="2" stroke-dasharray="10 8"/>
${line([500, 0], [500, 1000], FAINT, 1.5, "4 8")}${line([0, 600], [1000, 600], FAINT, 1.5, "4 8")}
<g transform="translate(${H.x} ${H.y})">
  <path d="${headPath(0)}" fill="none" stroke="${CLAY}" stroke-width="3" stroke-dasharray="14 8"/>
  ${line([-H.rx, 0], [0, 0], GUIDE, 1.5)}${line([0, -H.ry], [0, 0], GUIDE, 1.5)}${ring([0, 0], 9, CLAY, 3)}
  <rect x="${-H.rx / 2 - 46}" y="6" width="92" height="32" rx="16" fill="#000"/>${txt([-H.rx / 2, 23], "rx 344", { size: 20 })}
  <rect x="-46" y="${-H.ry + 40}" width="92" height="32" rx="16" fill="#000"/>${txt([0, -H.ry + 57], "ry 310", { size: 20 })}
  <rect x="${visor.x0}" y="${visor.y0}" width="${visor.x1 - visor.x0}" height="${visor.y1 - visor.y0 + 26}" fill="none" stroke="${GUIDE}" stroke-width="2" stroke-dasharray="8 6"/>
  ${badge([0, -44], 3)}
  ${skeleton(FL)}${skeleton(FR)}
  ${[-1, 1].map((s) => `<rect x="${f1(s * EAR_X - 16)}" y="${EARS[0] - 16}" width="32" height="${EARS[2] - EARS[0] + 32}" rx="16" fill="none" stroke="${GUIDE}" stroke-width="2"/>`).join("")}
  ${callout([-250, 150], [-430, 250], 1)}
  ${callout([150, 190], [330, 300], 2)}
  ${callout([FL.pts[3][0] - 8, FL.pts[3][1] - 20], [FL.pts[3][0] - 90, FL.pts[3][1] - 70], 4)}
  ${callout([FR.pts[3][0] + 14, FR.pts[3][1] + 12], [FR.pts[3][0] + 110, FR.pts[3][1] + 40], 5)}
  ${callout([EAR_X + 18, EARS[2] + 14], [EAR_X + 70, EARS[2] + 120], 6)}
</g>
${dim([0, 0], [1000, 0], "1000", "h", -34)}${dim([0, 0], [0, 1000], "1000", "v", -34)}
</svg>`;

// visor badge (3) sits inside the visor, centred
const bigFixed = big;

// ---- the dot skin detail: three rows, enlarged, with the pitch marked ----
const skinSvg = (() => {
  // draw three rows big, with the pitch marked
  const pts = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) pts.push([i * C + ((j & 1) ? C / 2 : 0), j * ROW, [10.2, 9.1, 7.8][j] - i * 0.35]);
  const S = 3.2, ox = 40, oy = 40;
  const P = (p) => [ox + p[0] * S, oy + p[1] * S];
  let o = pts.map((p) => dot(P(p), f1(p[2] * S), "#FFFFFF")).join("");
  o += line([P(pts[0])[0], oy - 26], [P(pts[1])[0], oy - 26], CLAY, 2) + txt([(P(pts[0])[0] + P(pts[1])[0]) / 2, oy - 46], "27", { size: 22, c: CLAY, w: 700 });
  o += line([ox + 4.6 * C * S + 26, P(pts[0])[1]], [ox + 4.6 * C * S + 26, P(pts[5])[1]], CLAY, 2) + txt([ox + 4.6 * C * S + 60, (P(pts[0])[1] + P(pts[5])[1]) / 2], "23.4", { size: 22, c: CLAY, w: 700 });
  return `<svg viewBox="0 -20 520 260" width="100%" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">${o}</svg>`;
})();

// ---- the feelers, alone, with their skeleton and taper ----
const feelersSvg = (() => {
  const g = "<g>";
  const art = inner(mono, "fe").match(/<g transform="translate\(500 600\)[^>]*>([\s\S]*?)<path d="M[-\d.]+ [-\d.]+a/)[1];   // monoParts(): the feelers and ears
  const feelersOnly = art.split(/<circle cx="[-\d.]+" cy="[-\d.]+" r="8"/)[0];
  return `<svg viewBox="-300 -480 680 290" width="100%" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">${g}${feelersOnly}${skeleton(FL)}${skeleton(FR)}
  ${txt([FL.pts[0][0] - 50, FL.pts[0][1] + 34], "root 30", { size: 19, op: 0.8 })}${txt([FL.pts[3][0] - 10, FL.pts[3][1] - 44], "tip 9 + bead 15", { size: 19, op: 0.8 })}
  ${txt([FR.pts[0][0] + 62, FR.pts[0][1] + 34], "root 32", { size: 19, op: 0.8 })}${txt([FR.pts[3][0] - 30, FR.pts[3][1] + 56], "tip 8 + bead 16", { size: 19, op: 0.8 })}</g></svg>`;
})();

const sizes = [180, 120, 76, 40].map((s) => `<div class="sz"><div class="ic" style="width:${s}px;height:${s}px;border-radius:${s * 0.2237}px"><img src="../icon-mono-1024.png" width="${s}" height="${s}"></div><span>${s}</span></div>`).join("");

const parts = [
  ["Head", "Super-ellipse, exponent 2.3. rx 344, ry 310, centred at 500, 600, so the crown leaves room for the feelers. Never drawn: no outline."],
  ["Dot skin", "Whole dots on a hex grid (27 pitch, 23.4 rows), radius 3.6 to 10.6 from a soft light at the upper left. Dots are dropped near the edge, never clipped."],
  ["Visor", "A band 464 wide where the dots stop, so his eyes are the dark. The smooth bottom curve is the only expression; there is no mouth."],
  ["Short feeler", "Left. A cubic S from the crown at −115°, flaring to a 30 root and tapering to 9, with a teardrop bead of 15."],
  ["Long feeler", "Right, the longer one. An arch from −65° that curls down, from a 32 root to 8, with a bead of 16."],
  ["Ears", "Three dots each, radius 8, 20 outside the head. The right side sits a step back, at 80% opacity."],
].map(([h, p], i) => `<li><b class="n">${i + 1}</b><div><h4>${h}</h4><p>${p}</p></div></li>`).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Blip icon structure</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:2240px;height:1290px;background:#F3F0EA;color:#111;font-family:Inter,'Helvetica Neue',Arial,sans-serif;display:grid;grid-template-columns:1160px 1fr;}
.left{background:#000;display:flex;align-items:center;justify-content:center;position:relative}
.left .cap{position:absolute;left:44px;top:34px;color:#fff;opacity:.6;font-size:18px;letter-spacing:.14em;text-transform:uppercase}
.left .key{position:absolute;left:44px;bottom:30px;color:#fff;opacity:.6;font-size:16px;display:flex;gap:26px}
.left .key i{display:inline-block;width:26px;height:0;border-top:3px dashed #E07A4C;vertical-align:middle;margin-right:8px}
.left .key i.g{border-color:rgba(255,255,255,.6)}
.right{padding:46px 52px;display:flex;flex-direction:column;gap:26px}
h1{font-size:40px;letter-spacing:-.01em} h1 span{color:#9a948a;font-weight:500}
h3{font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#8a847a;margin-bottom:12px}
ol{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:14px 26px}
li{display:flex;gap:14px} .n{flex:none;width:34px;height:34px;border-radius:50%;background:#E07A4C;color:#fff;display:grid;place-items:center;font-size:17px}
h4{font-size:19px;margin:4px 0 4px} p{font-size:15px;line-height:1.42;color:#3b3833}
.row{display:flex;gap:22px} .row>section{flex:1;min-width:0}
.card{background:#000;border-radius:18px;padding:18px;color:#fff}
.sizes{display:flex;align-items:flex-end;gap:22px}
.sz{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:14px;color:#8a847a}
.ic{overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.18)} .ic img{display:block}
.sw{display:flex;gap:14px} .s{display:flex;flex-direction:column;gap:6px;font-size:14px;color:#3b3833}
.s b{display:block;width:96px;height:56px;border-radius:12px;border:1px solid #d8d2c8}
</style></head><body>
<div class="left"><div class="cap">Blip · app icon · 1000 × 1000</div>${bigFixed}
<div class="key"><span><i></i>head and feeler curves</span><span><i class="g"></i>visor, ears, centre lines</span><span><i class="g" style="border-top-style:dotted"></i>iOS mask</span></div></div>
<div class="right">
<h1>Blip icon <span>structure</span></h1>
<section><h3>Parts</h3><ol>${parts}</ol></section>
<div class="row">
<section><h3>Dot skin</h3><div class="card">${skinSvg}</div></section>
<section><h3>Feelers</h3><div class="card">${feelersSvg}</div></section>
</div>
<div class="row" style="gap:46px;align-items:flex-start">
<section><h3>Sizes</h3><div class="sizes">${sizes}</div></section>
<section><h3>Colour</h3><div class="sw">
<div class="s"><b style="background:#FFFFFF"></b>Mark #FFFFFF</div>
<div class="s"><b style="background:radial-gradient(circle at 50% 40%,#1A1A1A,#000)"></b>Ground #1A1A1A → #000</div>
<div class="s"><b style="background:#0A0A0A"></b>Android bg #0A0A0A</div></div></section>
</div></div></body></html>`;
fs.mkdirSync(path.join(here, "structure"), { recursive: true });
fs.writeFileSync(path.join(here, "structure", "structure.html"), html);
console.log("RL", RL.map(f1), "RR", RR.map(f1));
