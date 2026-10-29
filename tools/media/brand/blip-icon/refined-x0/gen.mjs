// X0 Bot variants of the REFINED master (icon A).   node gen.mjs  ->  <variant>/icon.svg for x0, neon, warm, bold
// A sibling of ../refined/gen.mjs (left untouched): the same engine, with per-variant options added.
// Every new option defaults to the refined behaviour, so `ONLY=a0 OUT=/tmp/x node gen.mjs` writes
// a0/icon.svg, identical to ../refined/icon.svg (prefix rfi-) — the parity check for this copy.
//   x0    the antennae cross into an X; the eye ring is a tall 0 with the pupil as its dot
//   neon  the listening rim light, held back, on a deep ink ground with a vignette and grain
//   warm  the antenna light and glow in cream and clay instead of neon green
//   bold  fewer, bigger dots, a heavier ink edge and fewer details, for 29-40 pt
// Ids are prefixed x<variant initial>-.  PNG=1 also exports <variant>/icon-1024.png (Playwright).
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT || here;

const TAU = Math.PI * 2, PI = Math.PI;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const hyp = Math.hypot;
const lerp = (a, b, t) => a + (b - a) * t;
const ENV = (k, d) => (process.env[k] !== undefined ? +process.env[k] : d);

// ---------- the grid and the head ----------
// The head is a touch taller than the first pass (RY 254 -> 274) so that the brow gets its own
// band of two dot rows with a full row of dots under it (between brow and eye) and one above it.
const G0 = { C: 26, HX: 500, HY: 557, RX: 300, RY: 274, N: 2.2 };
const G = {};
let HEADPTS = [];
// each variant may move or resize the head (and the dot grid with it)
function setHead(o = {}) {
  Object.assign(G, G0, o);
  G.R = G.RX / 1.1;
  HEADPTS = Array.from({ length: 2880 }, (_, i) => headPt((i / 2880) * TAU));
}

function headPt(t, off = 0) {
  const c = Math.cos(t), s = Math.sin(t), e = 2 / G.N;
  const x = Math.sign(c) * Math.abs(c) ** e * G.RX, y = Math.sign(s) * Math.abs(s) ** e * G.RY;
  if (!off) return [G.HX + x, G.HY + y];
  const nx = Math.sign(x) * Math.abs(x / G.RX) ** (G.N - 1) / G.RX, ny = Math.sign(y) * Math.abs(y / G.RY) ** (G.N - 1) / G.RY;
  const l = hyp(nx, ny) || 1;
  return [G.HX + x + nx / l * off, G.HY + y + ny / l * off];
}
function sdHead(x, y) {
  const v = Math.abs((x - G.HX) / G.RX) ** G.N + Math.abs((y - G.HY) / G.RY) ** G.N;
  let d = Infinity;
  for (const p of HEADPTS) { const q = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (q < d) d = q; }
  return v < 1 ? -Math.sqrt(d) : Math.sqrt(d);
}
const headPath = (off = 0, n = 240) => Array.from({ length: n }, (_, i) => { const p = headPt((i / n) * TAU, off); return (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1]); }).join("") + "Z";
const sdCircle = (x, y, cx, cy, r) => hyp(x - cx, y - cy) - r;
// an ellipse's signed distance, good close to its edge (where the dots are decided)
function sdEllipse(x, y, cx, cy, rx, ry) {
  const dx = x - cx, dy = y - cy, k0 = hyp(dx / rx, dy / ry), k1 = hyp(dx / (rx * rx), dy / (ry * ry));
  return k1 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry);
}
function sdRRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return hyp(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function segDist(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = x - a[0], wy = y - a[1];
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1));
  return hyp(wx - vx * t, wy - vy * t);
}
const polyDist = (x, y, pts) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1], pts[i])); return d; };
const arcPts = (cx, cy, r, a0, a1, n = 48) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const quadPts = (p0, c, p1, n = 60) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; });
const ptsPath = (pts, close = false) => pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("") + (close ? "Z" : "");
const dotsPath = (pts) => pts.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
const polyLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
// n points evenly spaced along an open polyline, both ends included
function evenly(pts, n) {
  const L = polyLen(pts), out = [];
  for (let q = 0; q < n; q++) {
    let target = n === 1 ? 0 : (L * q) / (n - 1), acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], s = hyp(b[0] - a[0], b[1] - a[1]);
      if (acc + s >= target - 1e-6 || i === pts.length - 1) { const t = s ? clamp((target - acc) / s) : 0; out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); break; }
      acc += s;
    }
  }
  return out;
}
// a four-point sparkle with concave sides
const star = (cx, cy, R, k = 0.16) => {
  const q = R * k;
  return `M${f1(cx)} ${f1(cy - R)}Q${f1(cx + q)} ${f1(cy - q)} ${f1(cx + R)} ${f1(cy)}Q${f1(cx + q)} ${f1(cy + q)} ${f1(cx)} ${f1(cy + R)}Q${f1(cx - q)} ${f1(cy + q)} ${f1(cx - R)} ${f1(cy)}Q${f1(cx - q)} ${f1(cy - q)} ${f1(cx)} ${f1(cy - R)}Z`;
};
// colours
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("").toUpperCase();
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const mixS = (a, b, k) => toHex(hex(a).map((v, i) => lerp(v, hex(b)[i], k)));
const mixLin = (a, b, k) => toHex(hex(a).map((v, i) => unlin(lerp(lin(v), lin(hex(b)[i]), k))));
function gradAt(stops, t) { // stops: [[offset, "#hex"]...]
  t = clamp(t);
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [o0, c0] = stops[i - 1], [o1, c1] = stops[i]; const k = (t - o0) / (o1 - o0 || 1); return toHex(hex(c0).map((v, j) => lerp(v, hex(c1)[j], k))); }
  return stops[stops.length - 1][1];
}

// A tapered arc (brow, smile): thick in the middle, round thin ends. xf transforms points
// (used to tilt the brow about its own middle). Returns outline path + SDF.
function taperArc(cx, cy, r, a0, a1, wMid, wEnd, xf = (p) => p, n = 48) {
  const S = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + (a1 - a0) * t, w = wEnd + (wMid - wEnd) * Math.sin(PI * t) ** 0.8;
    S.push({ c: [cx + Math.cos(a) * r, cy + Math.sin(a) * r], h: w / 2, a });
  }
  const outer = S.map(({ h, a }) => xf([cx + Math.cos(a) * (r + h), cy + Math.sin(a) * (r + h)]));
  const inner = S.map(({ h, a }) => xf([cx + Math.cos(a) * (r - h), cy + Math.sin(a) * (r - h)])).reverse();
  const e0 = S[0], e1 = S[n];
  const d = ptsPath(outer) + `A${f1(e1.h)} ${f1(e1.h)} 0 0 1 ${f1(inner[0][0])} ${f1(inner[0][1])}` + ptsPath(inner).replace(/^M/, "L") + `A${f1(e0.h)} ${f1(e0.h)} 0 0 1 ${f1(outer[0][0])} ${f1(outer[0][1])}Z`;
  const C = S.map(({ c, h }) => [...xf(c), h]);
  const hMid = wMid / 2;
  const sd = (x, y, clr = 0) => { let m = Infinity; for (const [sx, sy, h] of C) m = Math.min(m, hyp(x - sx, y - sy) - h - clr * (0.4 + 0.6 * h / hMid)); return m; };
  return { d, sd, C };
}

// ---------- palette ----------
const PAL = {
  ink: "#151311", cream: "#F3E2C6", white: "#FCFBF8", rust: "#C77A3A", neon: "#39FF14", tan: "#E9CBA2",
  // the dots' light, upper left to lower right
  dt: [[0, "#FFF6E6"], [0.38, "#F3E2C6"], [0.78, "#E2C59C"], [1, "#C9A67A"]],
  // the keylines: the same light, one step down, so they sit IN the dots instead of glowing
  kl: [[0, "#F2E2C8"], [0.38, "#E6CFAA"], [0.78, "#D3B48A"], [1, "#BB976B"]],
};

// ---------- the die-cut sticker with a scalloped edge of whole ink dots (paper alt) ----------
function scallopSticker({ deep, ear, off, rr, pitch, HX, HY }) {
  const ears = [-1, 1].map((s) => [HX + s * ear.cx, HY]);
  const sdEarG = (x, y) => Math.min(...ears.map(([cx, cy]) => sdRRect(x, y, cx, cy, ear.hw + off, ear.hh + off, ear.r + off)));
  const k = 26; // fillet size where the ears meet the head
  const smin = (p, q) => { const h = Math.max(k - Math.abs(p - q), 0) / k; return Math.min(p, q) - h * h * k / 4; };
  const f = (x, y) => smin(sdHead(x, y) - off, sdEarG(x, y));
  const loop = [];
  for (let i = 0; i < 540; i++) {
    const a = (i / 540) * TAU - PI, dx = Math.cos(a), dy = Math.sin(a);
    let lo = 150, hi = 480;
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (f(HX + dx * m, HY + dy * m) < 0) lo = m; else hi = m; }
    loop.push([HX + dx * lo, HY + dy * lo]);
  }
  const closed = loop.concat([loop[0]]);
  const L = polyLen(closed), n = Math.round(L / pitch);
  // even spacing on the closed loop; start at the bottom centre so the pattern is symmetric
  const start = closed.reduce((bi, p, i) => (Math.abs(p[0] - HX) + (p[1] < HY ? 1e4 : 0) < Math.abs(closed[bi][0] - HX) + (closed[bi][1] < HY ? 1e4 : 0) ? i : bi), 0);
  const rot = closed.slice(start, closed.length - 1).concat(closed.slice(0, start + 1));
  const beads = evenly(rot, n + 1).slice(0, n);
  return `<g fill="${deep}"><path d="${ptsPath(loop, true)}"/><path d="${dotsPath(beads.map(([x, y]) => [x, y, rr]))}"/></g>`;
}

// ---------- one icon ----------
function build(v) {
  setHead(v.head);
  const { C, HX, HY, R } = G;
  const P = v.pre;
  const { ink, cream, white, rust, neon } = PAL;
  const deep = v.deep || (v.paper ? "#151311" : "#0D0C0A");
  const S = v.S ?? (v.paper ? 16 : 20); // sticker margin beyond the head outline
  const id = (s) => `${P}${s}`;
  const dtC = [HX - 0.42 * G.RX, HY - 0.5 * G.RY], dtR = 1.75 * G.RX;
  // the signal: the antenna light, its glow and (with rim) the light it throws on the head
  const sig = { hot: v.ballHot ? "#F4FFEE" : "#D8FFC8", hotAt: v.ballHot ? 0.46 : 0.4, mid: neon, edge: "#1FA80A", glow: neon, glint: "#F6FFF2", rim: neon, ...(v.sig || {}) };

  // ----- face features -----
  const E = [HX + v.eye.dx, HY + v.eye.dy], Ri = v.eye.r, Ro = Ri + v.eye.ring;
  const esx = v.eye.sx || 1, esy = v.eye.sy || 1, oval = esx !== 1 || esy !== 1; // an oval eye: the 0
  const eyeG = (s) => (oval ? `<g transform="translate(${f1(E[0])} ${f1(E[1])}) scale(${esx} ${esy}) translate(${f1(-E[0])} ${f1(-E[1])})">${s}</g>` : s);
  const KE = v.eyeKey; // thin keyline round the eye ring
  const B = v.brow;
  const bMid = 1.5 * PI;
  const bc = [E[0] + B.dx, E[1] + B.dy];
  const pivot = [bc[0], bc[1] - B.r];
  const bxf = ([x, y]) => {
    const c = Math.cos(B.tilt || 0), s = Math.sin(B.tilt || 0), dx = x - pivot[0], dy = y - pivot[1];
    return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c - (B.lift || 0)];
  };
  const brow = taperArc(bc[0], bc[1], B.r, bMid - B.span, bMid + B.span, B.w, B.w * B.end, bxf);
  const M = v.mouth, KM = v.mouthKey;
  let mouth;
  if (M.kind === "smile") {
    const m = taperArc(HX + M.x, HY + M.y, M.r, PI * M.a0, PI * M.a1, M.w, M.wEnd);
    mouth = { sd: m.sd, ink: `<path d="${m.d}" fill="${ink}"/>`, key: `<path d="${m.d}" fill="url(#${id("kl")})" stroke="url(#${id("kl")})" stroke-width="${2 * KM}" stroke-linejoin="round"/>`, bottom: [HX + M.x + Math.cos(PI * (M.a0 + M.a1) / 2) * M.r, HY + M.y + Math.sin(PI * (M.a0 + M.a1) / 2) * M.r] };
  } else {
    const cx = HX + M.x, cy = HY + M.y, c = Math.cos(M.rot), s = Math.sin(M.rot);
    const pts = arcPts(0, 0, 1, 0, PI, 48).map(([ux, uy]) => [cx + (ux * M.rx) * c - (uy * M.ry) * s, cy + (ux * M.rx) * s + (uy * M.ry) * c]);
    const ring = pts.concat([pts[0]]);
    const sd = (x, y) => {
      const dx = x - cx, dy = y - cy, lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const inside = ly >= 0 && (lx / M.rx) ** 2 + (ly / M.ry) ** 2 <= 1;
      const d = polyDist(x, y, ring) - 4;
      return inside ? -d : d;
    };
    mouth = { sd, ink: `<path d="${ptsPath(pts, true)}" fill="${ink}" stroke="${ink}" stroke-width="8" stroke-linejoin="round"/>`, key: `<path d="${ptsPath(pts, true)}" fill="url(#${id("kl")})" stroke="url(#${id("kl")})" stroke-width="${8 + 2 * KM}" stroke-linejoin="round"/>`, M: { cx, cy, c, s } };
  }
  const T = v.tooth, TO = 4.5;
  let tooth = null;
  if (T) {
    const tx = M.kind === "smile" ? mouth.bottom[0] + T.dx - T.w / 2 : HX + T.x, ty = M.kind === "smile" ? mouth.bottom[1] + T.dy : HY + T.y;
    tooth = { x: tx, y: ty, w: T.w, h: T.h, rx: T.rx };
    tooth.sd = (x, y) => sdRRect(x, y, tx + T.w / 2, ty + T.h / 2, T.w / 2 + TO / 2, T.h / 2 + TO / 2, T.rx + TO / 2);
  }
  const gap = v.gap;
  const sdFeat = (x, y) => Math.min(
    oval ? sdEllipse(x, y, E[0], E[1], (Ro + KE) * esx, (Ro + KE) * esy) - gap : sdCircle(x, y, E[0], E[1], Ro + KE) - gap,
    brow.sd(x, y, v.browClear),
    mouth.sd(x, y) - KM - gap,
    tooth ? tooth.sd(x, y) - KM - gap : Infinity,
  );

  // ears: two small tabs on the sides
  const ear = { cx: G.RX + 25, hw: 28, hh: 41, r: 20, ...(v.ear || {}) };
  const sdEar = (x, y) => Math.min(sdRRect(x, y, HX - ear.cx, HY, ear.hw, ear.hh, ear.r), sdRRect(x, y, HX + ear.cx, HY, ear.hw, ear.hh, ear.r));

  // ----- antennae -----
  let ball = [HX + v.ball.dx, HY + v.ball.dy], stalkL, stalkR, X = null;
  const br = v.ball.r;
  if (v.xAnt) {
    // the X: two straight stalks that cross above the head. "\" rises from the right of the head to the
    // lit ball (upper left); "/" rises from the left of the head and stops in a plain round end (upper right).
    const a = v.xAnt, sx = Math.sin(a.ang), cy = Math.cos(a.ang), c = [HX + a.cx, HY + a.cy];
    ball = [c[0] - sx * a.up, c[1] - cy * a.up];
    stalkL = [[c[0] + sx * a.down, c[1] + cy * a.down], ball];
    stalkR = [[c[0] - sx * a.down, c[1] + cy * a.down], [c[0] + sx * a.upW, c[1] - cy * a.upW]];
    X = { c, arms: [[-sx, -cy, a.up], [sx, cy, a.down], [sx, -cy, a.upW], [-sx, cy, a.down]] };
  } else {
    stalkL = (() => {
      const b0 = [HX + v.stalk.x0, HY - 0.93 * R], b1 = [ball[0] + v.stalk.x1, ball[1] + br * 0.8];
      const dx = b1[0] - b0[0], dy = b1[1] - b0[1], c = hyp(dx, dy) / 2, nx = dy / (2 * c), ny = -dx / (2 * c);
      const s = v.stalk.bow, Rr = (c * c + s * s) / (2 * s), mid = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
      const cen = [mid[0] + nx * (s - Rr), mid[1] + ny * (s - Rr)];
      let a0 = Math.atan2(b0[1] - cen[1], b0[0] - cen[0]), a1 = Math.atan2(b1[1] - cen[1], b1[0] - cen[0]);
      const am = Math.atan2(mid[1] + ny * s - cen[1], mid[0] + nx * s - cen[0]);
      const within = (a, lo, hi) => { const t = (a - lo + 4 * TAU) % TAU, e = (hi - lo + 4 * TAU) % TAU; return t <= e; };
      if (within(am, a0, a1)) { while (a1 < a0) a1 += TAU; } else { while (a1 > a0) a1 -= TAU; }
      return arcPts(cen[0], cen[1], Rr, a0, a1, 60);
    })();
    stalkR = [[HX + 0.33 * R, HY - 0.9 * R], [HX + 0.55 * R, HY - 1.2 * R], [HX + 0.83 * R, HY - 1.13 * R]];
  }

  // ----- the dots -----
  const L = [-0.5, -0.62, 0.6]; { const l = hyp(...L); L[0] /= l; L[1] /= l; L[2] /= l; }
  const freck = new Set(v.freckles.map(([k, j]) => k + "," + j));
  const dots = [], freckles = [], earDots = [];
  const keepK = v.keepK;
  const avail = (x, y, inHead) => Math.min(inHead ? -sdHead(x, y) : -sdEar(x, y) - 2, sdFeat(x, y));
  let dropped = 0, nudged = 0;
  const JN = Math.ceil((G.RY + 60) / C), KN = Math.ceil((G.RX + 80) / C);
  for (let j = -JN; j <= JN; j++) for (let k = -KN; k <= KN; k++) {
    const x = HX + k * C, y = HY + j * C;
    const dh = sdHead(x, y), de = sdEar(x, y);
    if (dh > 0 && de > 0) continue;
    const inHead = dh <= 0, isF = freck.has(k + "," + j);
    let r0;
    if (isF) r0 = C * v.freckR;
    else if (inHead) {
      const nx = (x - HX) / G.RX, ny = (y - HY) / G.RY, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      r0 = C * (v.rLo + (v.rHi - v.rLo) * clamp(nx * L[0] + ny * L[1] + nz * L[2]));
    } else r0 = C * (v.earR || 0.38);
    let px = x, py = y, r = r0;
    const a = avail(x, y, inHead);
    if (a < r0) {
      const h = 0.5, gx = avail(x + h, y, inHead) - avail(x - h, y, inHead), gy = avail(x, y + h, inHead) - avail(x, y - h, inHead);
      const gl = hyp(gx, gy) || 1, t = Math.min(v.nudge, Math.max(0, r0 - a));
      px = x + gx / gl * t; py = y + gy / gl * t;
      r = Math.min(r0, avail(px, py, inHead));
      if (r < keepK * r0) { dropped++; continue; }
      nudged++;
    }
    (isF ? freckles : inHead ? dots : earDots).push([px, py, r]);
  }
  {
    const all = dots.concat(freckles), comp = new Array(all.length).fill(-1);
    let nc = 0;
    for (let i = 0; i < all.length; i++) {
      if (comp[i] >= 0) continue;
      const st = [i]; comp[i] = nc;
      while (st.length) { const q = st.pop(); for (let j = 0; j < all.length; j++) if (comp[j] < 0 && hyp(all[j][0] - all[q][0], all[j][1] - all[q][1]) < 1.45 * C) { comp[j] = nc; st.push(j); } }
      nc++;
    }
    const size = new Array(nc).fill(0); comp.forEach((c) => size[c]++);
    for (let i = dots.length - 1; i >= 0; i--) if (size[comp[i]] <= 2) { dots.splice(i, 1); dropped++; }
  }
  // beads on the stalks
  const beadR = v.beadR, pitch = v.beadPitch;
  const headDots = dots.concat(freckles);
  const clearOfHead = ([x, y]) => headDots.every(([dx, dy, dr]) => hyp(x - dx, y - dy) >= dr + beadR + 3) && sdHead(x, y) > 2;
  const clearOfBall = (p) => hyp(p[0] - ball[0], p[1] - ball[1]) >= br + 4 + beadR;
  let beadsL = [], beadsR = [];
  if (X) {
    // one bead on the crossing, then whole beads at an even pitch out along all four arms
    beadsL.push(X.c);
    for (const [dx, dy, len] of X.arms) for (let k = 1; k * pitch <= len + 0.5; k++) beadsL.push([X.c[0] + dx * k * pitch, X.c[1] + dy * k * pitch]);
    beadsL = beadsL.filter((p) => clearOfBall(p) && clearOfHead(p));
  } else {
    beadsL = (() => {
      const pts = stalkL.slice().reverse();
      const L0 = polyLen(pts), n = Math.round(L0 / pitch) + 1, ev = evenly(pts, n);
      return ev.filter((p) => clearOfBall(p) && clearOfHead(p));
    })();
    beadsR = (() => {
      const out = [];
      for (let i = stalkR.length - 1; i > 0; i--) {
        const a = stalkR[i], b = stalkR[i - 1], n = Math.max(1, Math.round(hyp(b[0] - a[0], b[1] - a[1]) / pitch));
        for (let q = (i === stalkR.length - 1 ? 0 : 1); q <= n; q++) out.push([lerp(a[0], b[0], q / n), lerp(a[1], b[1], q / n)]);
      }
      return out.filter(clearOfHead);
    })();
  }

  // ----- the rim light: the head dots nearest the lit ball catch a thin crescent on the side facing it -----
  const rim = v.rim, rimD = [];
  if (rim) {
    for (const [x, y, r] of dots) {
      const depth = -sdHead(x, y) - r, dB = hyp(x - ball[0], y - ball[1]);
      const ux = (x - HX) / G.RX, uy = (y - HY) / G.RY;
      let nx = Math.sign(ux) * Math.abs(ux) ** (G.N - 1) / G.RX, ny = Math.sign(uy) * Math.abs(uy) ** (G.N - 1) / G.RY; const nl = hyp(nx, ny) || 1; nx /= nl; ny /= nl;
      const tx = (ball[0] - x) / dB, ty = (ball[1] - y) / dB, face = clamp(tx * nx + ty * ny);
      const w = rim.mix * clamp((rim.far - dB) / (rim.far - rim.near)) * clamp(1.15 - depth / (rim.rows * C)) * clamp((face - 0.2) / 0.5);
      if (w < (rim.min ?? 0.04)) continue;
      const d = Math.min(0.9, w * 2.2) * r, mx = x - tx * d / 2, my = y - ty * d / 2, h = Math.sqrt(r * r - (d / 2) ** 2);
      const p1 = [mx - ty * h, my + tx * h], p2 = [mx + ty * h, my - tx * h];
      const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const far = [x + tx * r, y + ty * r], sw = cross(p1, far, p2) > 0 ? 1 : 0;
      rimD.push(`M${f1(p1[0])} ${f1(p1[1])}A${f1(r)} ${f1(r)} 0 1 ${sw} ${f1(p2[0])} ${f1(p2[1])}A${f1(r)} ${f1(r)} 0 0 ${1 - sw} ${f1(p1[0])} ${f1(p1[1])}Z`);
    }
  }

  // ----- write -----
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">`, `<defs>`);
  if (v.paper) {
    o.push(`<radialGradient id="${id("gr")}" cx="480" cy="430" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F6F4F0"/><stop offset=".55" stop-color="#EFEDE8"/><stop offset="1" stop-color="#E0DCD3"/></radialGradient>`);
    o.push(`<radialGradient id="${id("sh")}" cx="0" cy="0" r="1" gradientTransform="translate(${HX + 6} ${HY + 34}) scale(${G.RX + 92} ${G.RY + 84})" gradientUnits="userSpaceOnUse"><stop offset=".7" stop-color="#4A3B2A" stop-opacity="${v.shadow[0]}"/><stop offset=".86" stop-color="#4A3B2A" stop-opacity="${v.shadow[1]}"/><stop offset="1" stop-color="#4A3B2A" stop-opacity="0"/></radialGradient>`);
  } else if (v.bg) {
    const [bx, by, bR] = v.bg.at;
    o.push(`<radialGradient id="${id("gr")}" cx="${f1(bx)}" cy="${f1(by)}" r="${bR}" gradientUnits="userSpaceOnUse">${v.bg.stops.map(([o2, c]) => `<stop offset="${o2}" stop-color="${c}"/>`).join("")}</radialGradient>`);
  } else {
    o.push(`<radialGradient id="${id("gr")}" cx="${HX - 30}" cy="${HY - 80}" r="740" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3B342C"/><stop offset=".36" stop-color="#25211C"/><stop offset=".7" stop-color="#171513"/><stop offset="1" stop-color="#0E0D0B"/></radialGradient>`);
  }
  if (v.vignette) {
    // darker corners, so the light gathers on him
    const vg = v.vignette;
    o.push(`<radialGradient id="${id("vg")}" cx="${vg.cx ?? 500}" cy="${vg.cy ?? 500}" r="${vg.r ?? 720}" gradientUnits="userSpaceOnUse"><stop offset="${vg.from ?? 0.5}" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="${(vg.a * 0.55).toFixed(3)}"/><stop offset="1" stop-color="#000" stop-opacity="${vg.a}"/></radialGradient>`);
  }
  if (v.grain) {
    // a faint film grain on the ground: fractal noise, added to it with a fixed small amplitude (+-a/2)
    const g = v.grain;
    o.push(`<filter id="${id("gn")}" x="0" y="0" width="1000" height="1000" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${g.f}" numOctaves="2" seed="${g.seed ?? 7}" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="2 0 0 0 -.5 2 0 0 0 -.5 2 0 0 0 -.5 0 0 0 0 1" result="g"/><feComposite in="SourceGraphic" in2="g" operator="arithmetic" k1="0" k2="1" k3="${g.a}" k4="${-g.a / 2}"/></filter>`);
  }
  const glowStops = (a) => [[0, 1], [0.2, 0.82], [0.42, 0.46], [0.66, 0.16], [0.85, 0.04], [1, 0]].map(([o2, k]) => `<stop offset="${o2}" stop-color="${sig.glow}" stop-opacity="${(a * k).toFixed(3)}"/>`).join("");
  o.push(`<radialGradient id="${id("gb")}" cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.bloom}" gradientUnits="userSpaceOnUse">${glowStops(v.glow.bloomA)}</radialGradient>`);
  o.push(`<radialGradient id="${id("gc")}" cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.core}" gradientUnits="userSpaceOnUse">${glowStops(v.glow.coreA)}</radialGradient>`);
  // a glossy ball lit from the upper left, or (sig.emissive) a lamp: hottest in the middle, no specular glint
  o.push((sig.emissive
    ? `<radialGradient id="${id("bl")}" cx="${f1(ball[0] - br * .12)}" cy="${f1(ball[1] - br * .14)}" r="${f1(br * 1.08)}" gradientUnits="userSpaceOnUse">`
    : `<radialGradient id="${id("bl")}" cx="${f1(ball[0] - br * .35)}" cy="${f1(ball[1] - br * .4)}" r="${f1(br * 1.5)}" gradientUnits="userSpaceOnUse">`) +
    `<stop offset="0" stop-color="${sig.hot}"/><stop offset="${sig.hotAt}" stop-color="${sig.mid}"/><stop offset="1" stop-color="${sig.edge}"/></radialGradient>`);
  o.push(`<radialGradient id="${id("ey")}" cx="${f1(E[0] - Ri * .3)}" cy="${f1(E[1] - Ri * .3)}" r="${f1(Ri * 1.5)}" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="${white}"/><stop offset="1" stop-color="#E2DBD0"/></radialGradient>`);
  o.push(`<linearGradient id="${id("ld")}" x1="0" y1="${f1(E[1] - Ri)}" x2="0" y2="${f1(E[1] + (v.lidGradTo || 0) * Ri)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${v.lidCols ? v.lidCols[0] : "#CDBB9C"}"/><stop offset="1" stop-color="${v.lidCols ? v.lidCols[1] : "#A48E70"}"/></linearGradient>`);
  const radial = (name, stops) => `<radialGradient id="${id(name)}" cx="${f1(dtC[0])}" cy="${f1(dtC[1])}" r="${f1(dtR)}" gradientUnits="userSpaceOnUse">${stops.map(([o2, c]) => `<stop offset="${o2}" stop-color="${c}"/>`).join("")}</radialGradient>`;
  o.push(radial("dt", v.dt || PAL.dt), radial("kl", v.kl || PAL.kl));
  o.push(`<radialGradient id="${id("hb")}" cx="${f1(HX - 0.4 * G.RX)}" cy="${f1(HY - 0.45 * G.RY)}" r="${f1(1.6 * G.RX)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${v.base[0]}"/><stop offset="1" stop-color="${v.base[1]}"/></radialGradient>`);
  const re = v.rimEdge;
  if (re) {
    // the silhouette catches the light too: a thin line on the sticker's outer edge, fading away from the ball
    o.push(`<radialGradient id="${id("re")}" cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${re.far}" gradientUnits="userSpaceOnUse"><stop offset="${re.from ?? 0.25}" stop-color="${sig.rim}" stop-opacity="${re.a}"/><stop offset=".6" stop-color="${sig.rim}" stop-opacity="${(re.a * 0.4).toFixed(3)}"/><stop offset="1" stop-color="${sig.rim}" stop-opacity="0"/></radialGradient>`);
    if (re.blur) o.push(`<filter id="${id("rb")}" x="0" y="0" width="1000" height="1000" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="${re.blur}"/></filter>`);
  }
  o.push(`</defs>`);
  if (v.grain) o.push(`<g filter="url(#${id("gn")})">`);
  o.push(`<rect width="1000" height="1000" fill="url(#${id("gr")})"/>`);
  if (v.vignette) o.push(`<rect width="1000" height="1000" fill="url(#${id("vg")})"/>`);
  if (v.grain) o.push(`</g>`);
  if (v.paper) o.push(`<rect width="1000" height="1000" fill="url(#${id("sh")})"/>`);
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.bloom}" fill="url(#${id("gb")})"/>`);
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.core}" fill="url(#${id("gc")})"/>`);
  if (v.waves) o.push(v.waves(ball, br));
  // the ink sticker: head, ears, ball casing, stalk casings
  const casing = v.casingW;
  o.push(`<g fill="none" stroke="${deep}" stroke-width="${casing}" stroke-linecap="round" stroke-linejoin="round"><path d="${ptsPath(stalkL)}"/><path d="${ptsPath(stalkR)}"/></g>`);
  if (v.scallop) o.push(scallopSticker({ deep, ear, HX, HY, ...v.scallop }));
  else o.push(`<g fill="${deep}"><path d="${headPath(S)}"/>` + [-1, 1].map((s) => `<rect x="${HX + s * ear.cx - ear.hw - S}" y="${HY - ear.hh - S}" width="${2 * (ear.hw + S)}" height="${2 * (ear.hh + S)}" rx="${ear.r + S}"/>`).join("") + `</g>`);
  if (re) {
    const d = headPath(S - (re.inset ?? 0));
    if (re.blur) o.push(`<path d="${d}" fill="none" stroke="url(#${id("re")})" stroke-width="${re.w * 3}" filter="url(#${id("rb")})" opacity="${re.glowA ?? 0.6}"/>`);
    o.push(`<path d="${d}" fill="none" stroke="url(#${id("re")})" stroke-width="${re.w}"/>`);
  }
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${br + v.ballCase}" fill="${deep}"/>`);
  o.push(`<path d="${headPath(-2)}" fill="url(#${id("hb")})"/>`);
  o.push(`<path fill="url(#${id("dt")})" d="${dotsPath(dots)}"/>`);
  if (rimD.length) o.push(`<path fill="${sig.rim}" d="${rimD.join("")}"/>`);
  if (earDots.length && v.earDots !== false) o.push(`<path fill="${v.earCol || "#CDB18B"}" d="${dotsPath(earDots)}"/>`);
  if (freckles.length) o.push(`<path fill="${rust}" d="${dotsPath(freckles)}"/>`);
  o.push(`<path fill="url(#${id("dt")})" d="${dotsPath([...beadsL, ...beadsR].map(([x, y]) => [x, y, beadR]))}"/>`);
  o.push(eyeG(`<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ro + KE}" fill="url(#${id("kl")})"/>`));
  if (v.browKey) o.push(`<path d="${brow.d}" fill="url(#${id("kl")})" stroke="url(#${id("kl")})" stroke-width="${2 * v.browKey}" stroke-linejoin="round"/>`);
  o.push(mouth.key);
  if (tooth) o.push(`<rect x="${f1(tooth.x - KM - TO / 2)}" y="${f1(tooth.y - KM - TO / 2)}" width="${f1(tooth.w + 2 * KM + TO)}" height="${f1(tooth.h + 2 * KM + TO)}" rx="${f1(tooth.rx + KM)}" fill="url(#${id("kl")})"/>`);
  // eye
  o.push(eyeG(`<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ro}" fill="${deep}"/>` + (oval ? "" : "\n") + v.eyeDraw({ E, Ri, Ro, ink, white, id })));
  o.push(`<path d="${brow.d}" fill="${ink}"/>`);
  if (tooth) o.push(`<rect x="${f1(tooth.x)}" y="${f1(tooth.y)}" width="${tooth.w}" height="${tooth.h}" rx="${tooth.rx}" fill="${white}" stroke="${ink}" stroke-width="${TO}"/>`);
  o.push(mouth.ink);
  if (v.grinTooth) o.push(v.grinTooth({ HX, HY, white, ink }));
  // ball
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${br}" fill="url(#${id("bl")})"/>`);
  if (sig.glint) o.push(`<circle cx="${f1(ball[0] - br * .36)}" cy="${f1(ball[1] - br * .38)}" r="${f1(br * .2)}" fill="${sig.glint}"/>`);
  if (v.extra) o.push(v.extra({ E, Ri, Ro, ball, neon, cream, white, ink, HX, HY }));
  o.push(`</svg>`);
  const svg = o.join("\n");
  return { svg, stats: { dots: dots.length, rim: rimD.length, ears: earDots.length, freckles: freckles.length, beads: beadsL.length + beadsR.length, dropped, nudged, bytes: svg.length } };
}

// ---------- eye moods ----------
function eyeOpen({ lid, look, pupil = 0.46, glint = 0.13, lidLine = 11 }) {
  return ({ E, Ri, ink, white, id }) => {
    const px = E[0] + look[0] * Ri, py = E[1] + look[1] * Ri, pr = Ri * pupil;
    const s = [`<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ri}" fill="url(#${id("ey")})"/>`,
      `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(pr)}" fill="${ink}"/>`,
      `<circle cx="${f1(px - pr * .36)}" cy="${f1(py - pr * .38)}" r="${f1(Ri * glint)}" fill="${white}"/>`];
    const yc = E[1] - lid * Ri, hx = Math.sqrt(Ri * Ri - (lid * Ri) ** 2);
    s.push(`<path d="M${f1(E[0] - hx)} ${f1(yc)}A${Ri} ${Ri} 0 0 1 ${f1(E[0] + hx)} ${f1(yc)}Z" fill="url(#${id("ld")})"/>`);
    s.push(`<linearGradient id="${id("ls")}" x1="0" y1="${f1(yc)}" x2="0" y2="${f1(yc + 26)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3A2E22" stop-opacity=".22"/><stop offset="1" stop-color="#3A2E22" stop-opacity="0"/></linearGradient>`);
    const y2 = yc + 26, hx2 = Math.sqrt(Math.max(0, Ri * Ri - (E[1] - y2) ** 2));
    s.push(`<path d="M${f1(E[0] - hx)} ${f1(yc)}H${f1(E[0] + hx)}L${f1(E[0] + hx2)} ${f1(y2)}H${f1(E[0] - hx2)}Z" fill="url(#${id("ls")})"/>`);
    s.push(`<path d="M${f1(E[0] - hx)} ${f1(yc)}H${f1(E[0] + hx)}" stroke="${ink}" stroke-width="${lidLine}"/>`);
    return s.join("");
  };
}

// ---------- the refined master (A0), exactly as ../refined/gen.mjs draws icon.svg ----------
const base = {
  rLo: 0.40, rHi: 0.47, keepK: 0.94, nudge: 2.5,
  base: ["#6A5848", "#1E1914"],
  eye: { dx: -13, dy: -13, r: 120, ring: 26 },
  eyeKey: 4, gap: 4.5,
  brow: { dx: 0, dy: 92, r: 300, span: 0.41, w: 28, end: 0.35, tilt: 0, lift: 0 },
  browClear: 9, browKey: 0,
  mouth: { kind: "smile", x: 70, y: 106, r: 74, a0: 0.2, a1: 0.77, w: 27, wEnd: 21 },
  mouthKey: 5,
  tooth: { dx: 6, dy: -2, w: 29, h: 33, rx: 5 },
  freckles: [[6, 3], [5, 4], [7, 4]], freckR: 0.5,
  ball: { dx: -130, dy: -393, r: 41 }, stalk: { x0: -64, x1: 4, bow: 40 }, ballCase: 15,
  glow: { core: 86, coreA: 0.62, bloom: 165, bloomA: 0.2 },
  casingW: 46, beadR: 9.5, beadPitch: 22.5,
  rim: null,
  eyeDraw: eyeOpen({ lid: 0.3, look: [0.04, 0.12] }),
};

const variants = {
  // parity check only: written only when asked for (ONLY=a0); must equal ../refined/icon.svg
  a0: { ...base, pre: "rfi-" },
  x0: {
    ...base, pre: "xx-",
    head: { HY: 604, RX: 288, RY: 256 }, ear: { cx: 288 + 33, hw: 29 },
    eye: { dx: -13, dy: -10, r: 110, ring: 27, sx: 0.88, sy: 1.1 },
    eyeDraw: eyeOpen({ lid: 0.3, look: [0, 0.06] }),
    mouth: { ...base.mouth, y: 112 },
    xAnt: { cx: -26, cy: -352, ang: 0.64, up: 112, down: 160, upW: 4 * 25 },
    ball: { r: 39 }, casingW: 52, beadR: 11, beadPitch: 25,
  },
  neon: {
    ...base, pre: "xn-", ballHot: true,
    bg: { at: [470, 420, 760], stops: [[0, "#1D1A17"], [0.4, "#121110"], [0.75, "#0A0908"], [1, "#050505"]] },
    vignette: { a: 0.5 }, grain: { a: 0.05, f: 0.8 },
    deep: "#050404",
    glow: { core: 100, coreA: 0.8, bloom: 270, bloomA: 0.22 },
    rim: { mix: 0.15, near: 100, far: 270, rows: 1.2, min: 0.05 },
    rimEdge: { w: 4, a: 0.95, far: 340, blur: 7, glowA: 0.7 },
  },
  warm: {
    ...base, pre: "xw-",
    sig: { emissive: true, hot: "#FFFDF7", hotAt: 0.45, mid: "#F7DDB6", edge: "#C9773D", glow: "#EC9A62", glint: null },
    glow: { core: 96, coreA: 0.78, bloom: 200, bloomA: 0.24 },
  },
  bold: {
    ...base, pre: "xb-",
    head: { C: 34, HY: 566, RX: 314, RY: 286 },
    rLo: 0.45, rHi: 0.495, keepK: 0.82, nudge: 4,
    base: ["#AD9070", "#5E4A37"],
    S: 34, casingW: 62, ballCase: 20, ball: { dx: -134, dy: -384, r: 52 }, stalk: { x0: -66, x1: 4, bow: 36 },
    eye: { dx: -13, dy: -4, r: 124, ring: 36 },
    eyeDraw: eyeOpen({ lid: 0.3, look: [0.04, 0.12], lidLine: 16, glint: 0.15, pupil: 0.48 }),
    brow: { ...base.brow, dy: 84, w: 36, span: 0.3 },
    mouth: { ...base.mouth, x: 74, y: 118, r: 80, w: 38, wEnd: 30 },
    tooth: null, freckles: [[5, 2], [4, 3], [6, 3]], freckR: 0.5,
    ear: { cx: 314 + 23, hh: 52, hw: 28 }, earR: 0.42,
    beadR: 14, beadPitch: 31,
    glow: { core: 104, coreA: 0.72, bloom: 200, bloomA: 0.24 },
  },
};

const only = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(variants).filter((k) => k !== "a0");
const written = [];
for (const [name, v] of Object.entries(variants)) {
  if (!only.includes(name)) continue;
  const r = build(v);
  fs.mkdirSync(path.join(OUT, name), { recursive: true });
  const f = path.join(OUT, name, "icon.svg");
  fs.writeFileSync(f, r.svg);
  written.push(f);
  console.log(name.padEnd(6), JSON.stringify(r.stats));
}
// PNG=1: the 1024 px store master next to each SVG (no corner mask; the OS adds it)
if (process.env.PNG) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire("/opt/node-tools/node_modules/")("playwright");
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  for (const f of written) {
    await p.setContent(`<!doctype html><body style="margin:0">${fs.readFileSync(f, "utf8").replace("<svg", '<svg width="1024" height="1024" style="display:block"')}</body>`);
    await p.waitForTimeout(80);
    const png = f.replace(/icon\.svg$/, "icon-1024.png");
    await p.screenshot({ path: png, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
    console.log("wrote", png);
  }
  await b.close();
}
