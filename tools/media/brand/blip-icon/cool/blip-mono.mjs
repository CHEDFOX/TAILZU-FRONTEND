// An alternative white-on-black Blip (mono-rings.svg): the face on contour rings. The chosen mono.svg is gen.mjs's.   node blip-mono.mjs [outDir]
// The head is drawn only by white dots laid on rings that follow its outline (so the silhouette and the shades' edge are
// smooth), each dot sized by soft shading of a dome lit from the top left. The shades are one wraparound lens, deep black,
// with two fine glints and a faint sheen. The antennae are flat white living feelers in the same graphic language: grown
// from a root, tapering, two small joint swellings, a teardrop tip; the left short with an S, the right long and arching.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] || here;
const f1 = (v) => (Math.round(v * 10) / 10).toString(), TAU = Math.PI * 2, P = "bm-";
const H = { x: 500, y: 600, rx: 336, ry: 300, n: 2.4 };
const sup = (t, a, b) => { const c = Math.cos(t), s = Math.sin(t), e = 2 / H.n; return [Math.sign(c) * Math.abs(c) ** e * a, Math.sign(s) * Math.abs(s) ** e * b]; };
// the lens: x in +-252; top edge arches up a little, bottom swoops down at the middle (it wraps round the face)
const LX = 258, lensTop = (x) => -124 - 12 * (1 - (x / LX) ** 2), lensBot = (x) => -10 + 24 * (1 - (x / LX) ** 2) ** 1.3;
function inLens(x, y, m) {
  const ax = Math.abs(x); if (ax > LX + m) return false;
  const k = ax > LX - 40 ? Math.sqrt(Math.max(0, 1 - ((ax - (LX - 40)) / 40) ** 2)) : 1;   // round the ends
  const top = lensTop(Math.min(ax, LX)), bot = lensBot(Math.min(ax, LX)), mid = (top + bot) / 2, half = (bot - top) / 2 * k;
  return Math.abs(y - mid) < half + m;
}
const lensPath = () => {
  const N = 80, up = [], dn = [];
  for (let i = 0; i <= N; i++) { const x = -LX + 2 * LX * i / N; up.push([x, lensTop(x)]); dn.push([x, lensBot(x)]); }
  // rounded ends: a half ellipse joining top and bottom at each side
  const cap = (sx) => { const pts = [], top = lensTop(sx * LX), bot = lensBot(sx * LX), mid = (top + bot) / 2, h = (bot - top) / 2; for (let i = 1; i < 16; i++) { const a = -Math.PI / 2 + Math.PI * i / 16; pts.push([sx * (LX + Math.cos(a) * 22), mid + Math.sin(a) * h * sx]); } return pts; };
  const pts = up.concat(cap(1), dn.reverse(), cap(-1));
  return pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("") + "Z";
};
const top = (t) => sup(t, H.rx - 22, H.ry - 22);
const L0 = top(-2.02), R0 = top(-1.13);
const nearRoot = (x, y) => Math.hypot(x - L0[0], y - L0[1]) < 30 || Math.hypot(x - R0[0], y - R0[1]) < 32;
// the dots: rings that follow the outline inward, every C, dots spaced C along each ring
const C = 27, dots = [];
const Lv = [-0.32, -0.42, 0.85], Ln = Math.hypot(...Lv);
for (let k = 0; ; k++) {
  const a = H.rx - 18 - k * C, b = H.ry - 18 - k * C; if (b < C * 0.4) break;
  const M = 900, pts = Array.from({ length: M }, (_, i) => sup((i / M) * TAU, a, b)); let L = 0; const cum = [0];
  for (let i = 1; i <= M; i++) { const p = pts[i % M], q = pts[i - 1]; L += Math.hypot(p[0] - q[0], p[1] - q[1]); cum.push(L); }
  const n = Math.max(1, Math.round(L / C)), off = (k % 2) * 0.5;   // alternate rings half a step, so the pattern knits
  for (let j = 0; j < n; j++) {
    const target = ((j + off) / n) * L; let i = 1; while (cum[i] < target) i++;
    const p = pts[(i - 1) % M], q = pts[i % M], f = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), x = p[0] + (q[0] - p[0]) * f, y = p[1] + (q[1] - p[1]) * f;
    const nx = x / H.rx, ny = y / H.ry, qq = Math.max(0, 1 - nx * nx - ny * ny), nz = Math.sqrt(qq);
    const shade = 0.32 + 0.68 * Math.max(0, (nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / Ln);
    const r = 3.6 + 7.2 * Math.pow(shade, 1.1);
    if (inLens(x, y, 12 + r * 0.6) || nearRoot(x, y)) continue;
    dots.push([x, y, r]);
  }
}
const dotPath = dots.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
// the feelers
const cub = (p0, p1, p2, p3, t) => { const u = 1 - t; return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]); };
function feeler(pts, w0, w1, tipR, joints) {
  const N = 240, Pp = [], Nm = [];
  for (let i = 0; i <= N; i++) Pp.push(cub(...pts, i / N));
  for (let i = 0; i <= N; i++) { const a = Pp[Math.max(0, i - 1)], c = Pp[Math.min(N, i + 1)], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1; Nm.push([-dy / l, dx / l]); }
  const W = (i) => { const t = i / N; return (w1 + (w0 - w1) * Math.pow(1 - t, 2.2)) / 2; };   // flared at the root, fine for most of its length
  const side = (s) => Pp.map((p, i) => [p[0] + Nm[i][0] * W(i) * s, p[1] + Nm[i][1] * W(i) * s]);
  const pts2 = side(1).concat(side(-1).reverse());
  let o = `<path d="${pts2.map((q, i) => (i ? "L" : "M") + f1(q[0]) + " " + f1(q[1])).join("")}Z" fill="#FFFFFF"/>`;
  const r0 = Pp[0]; o += `<circle cx="${f1(r0[0])}" cy="${f1(r0[1])}" r="${f1(W(0))}" fill="#FFFFFF"/>`;   // a rounded root
  const tip = Pp[N], prev = Pp[N - 10], ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
  const cx = tip[0] + Math.cos(ang) * tipR * 0.55, cy = tip[1] + Math.sin(ang) * tipR * 0.55;
  o += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(tipR * 1.3)}" ry="${f1(tipR)}" transform="rotate(${f1(ang * 180 / Math.PI)} ${f1(cx)} ${f1(cy)})" fill="#FFFFFF"/>`;   // the teardrop tip
  return o;
}
const feelers = feeler([L0, [L0[0] - 2, L0[1] - 64], [L0[0] - 66, L0[1] - 74], [L0[0] - 58, L0[1] - 136]], 30, 9, 15, [])
  + feeler([R0, [R0[0] + 8, R0[1] - 132], [R0[0] + 150, R0[1] - 206], [R0[0] + 166, R0[1] - 138]], 32, 8, 16, []);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<defs>
<radialGradient id="${P}g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#191919"/><stop offset="1" stop-color="#000000"/></radialGradient>
<linearGradient id="${P}lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101012"/><stop offset="1" stop-color="#000000"/></linearGradient>
<linearGradient id="${P}sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.07"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<clipPath id="${P}lc"><path d="${lensPath()}"/></clipPath>
</defs>
<rect width="1000" height="1000" fill="url(#${P}g)"/>
<g transform="translate(${H.x} ${H.y})">
${feelers}
<path d="${dotPath}" fill="#FFFFFF"/>
<path d="${lensPath()}" fill="url(#${P}lens)"/>
<g clip-path="url(#${P}lc)">
<path d="${lensPath()}" fill="url(#${P}sheen)"/>
<path d="M-60 60L64 -170" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="9" stroke-linecap="round"/>
<path d="M-18 60L106 -170" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="3.5" stroke-linecap="round"/>
</g>
</g></svg>`;
fs.writeFileSync(path.join(OUT, "mono-rings.svg"), svg);
console.log("mono-rings.svg", svg.length, "bytes,", dots.length, "dots");
