// Final REFINED Blip icon family.   node gen.mjs  ->  ../icon.svg ../alt.svg ../listening.svg ../done.svg
// Grown from d/refined-graphic/work/gen.mjs. Everything is computed on one square dot grid.
// Every dot is WHOLE: a dot that cannot keep (almost) its full size next to the outline or a
// feature is dropped, never squeezed or clipped. Ids are prefixed rf<file initial>-.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT || path.resolve(here, "..");

const TAU = Math.PI * 2, PI = Math.PI;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const hyp = Math.hypot;
const lerp = (a, b, t) => a + (b - a) * t;
const ENV = (k, d) => (process.env[k] !== undefined ? +process.env[k] : d);

// ---------- the grid and the head ----------
// The head is a touch taller than the first pass (RY 254 -> 274) so that the brow gets its own
// band of two dot rows with a full row of dots under it (between brow and eye) and one above it.
const G = { C: 26, HX: 500, HY: ENV("HY", 557), RX: 300, RY: ENV("RY", 274), N: 2.2 };
G.R = G.RX / 1.1;

function headPt(t, off = 0) {
  const c = Math.cos(t), s = Math.sin(t), e = 2 / G.N;
  const x = Math.sign(c) * Math.abs(c) ** e * G.RX, y = Math.sign(s) * Math.abs(s) ** e * G.RY;
  if (!off) return [G.HX + x, G.HY + y];
  const nx = Math.sign(x) * Math.abs(x / G.RX) ** (G.N - 1) / G.RX, ny = Math.sign(y) * Math.abs(y / G.RY) ** (G.N - 1) / G.RY;
  const l = hyp(nx, ny) || 1;
  return [G.HX + x + nx / l * off, G.HY + y + ny / l * off];
}
const HEADPTS = Array.from({ length: 2880 }, (_, i) => headPt((i / 2880) * TAU));
function sdHead(x, y) {
  const v = Math.abs((x - G.HX) / G.RX) ** G.N + Math.abs((y - G.HY) / G.RY) ** G.N;
  let d = Infinity;
  for (const p of HEADPTS) { const q = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (q < d) d = q; }
  return v < 1 ? -Math.sqrt(d) : Math.sqrt(d);
}
const headPath = (off = 0, n = 240) => Array.from({ length: n }, (_, i) => { const p = headPt((i / n) * TAU, off); return (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1]); }).join("") + "Z";
const sdCircle = (x, y, cx, cy, r) => hyp(x - cx, y - cy) - r;
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
  const { C, HX, HY, R } = G;
  const P = v.pre;
  const { ink, cream, white, rust, neon } = PAL;
  const deep = v.paper ? "#151311" : "#0D0C0A";
  const S = v.paper ? 16 : 20; // sticker margin beyond the head outline
  const id = (s) => `${P}${s}`;
  const dtC = [HX - 0.42 * G.RX, HY - 0.5 * G.RY], dtR = 1.75 * G.RX;
  const dotColAt = (x, y) => gradAt(PAL.dt, hyp(x - dtC[0], y - dtC[1]) / dtR);

  // ----- face features -----
  const E = [HX + v.eye.dx, HY + v.eye.dy], Ri = v.eye.r, Ro = Ri + v.eye.ring;
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
    // grin: the lower half of a tilted ellipse, filled
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
  // the buck tooth: white with an ink edge, hanging from under the smile (or from the grin's top lip)
  const T = v.tooth, TO = 4.5;
  let tooth = null;
  if (T) {
    const tx = M.kind === "smile" ? mouth.bottom[0] + T.dx - T.w / 2 : HX + T.x, ty = M.kind === "smile" ? mouth.bottom[1] + T.dy : HY + T.y;
    tooth = { x: tx, y: ty, w: T.w, h: T.h, rx: T.rx };
    tooth.sd = (x, y) => sdRRect(x, y, tx + T.w / 2, ty + T.h / 2, T.w / 2 + TO / 2, T.h / 2 + TO / 2, T.rx + TO / 2);
  }
  const gap = v.gap; // empty space between a feature (incl. its keyline) and the nearest dot
  const sdFeat = (x, y) => Math.min(
    sdCircle(x, y, E[0], E[1], Ro + KE) - gap,
    brow.sd(x, y, v.browClear),
    mouth.sd(x, y) - KM - gap,
    tooth ? tooth.sd(x, y) - KM - gap : Infinity,
  );

  // ears: two small tabs of dots on the grid
  const ear = { cx: 325, hw: 28, hh: 41, r: 20 };
  const sdEar = (x, y) => Math.min(sdRRect(x, y, HX - ear.cx, HY, ear.hw, ear.hh, ear.r), sdRRect(x, y, HX + ear.cx, HY, ear.hw, ear.hh, ear.r));

  // ----- antennae -----
  const ball = [HX + v.ball.dx, HY + v.ball.dy], br = v.ball.r;
  // the left stalk: a circular arc from the head up into the ball, bowed out to the left
  const stalkL = (() => {
    const b0 = [HX + v.stalk.x0, HY - 0.93 * R], b1 = [ball[0] + v.stalk.x1, ball[1] + br * 0.8];
    const dx = b1[0] - b0[0], dy = b1[1] - b0[1], c = hyp(dx, dy) / 2, nx = dy / (2 * c), ny = -dx / (2 * c); // left of b0->b1
    const s = v.stalk.bow, Rr = (c * c + s * s) / (2 * s), mid = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
    const cen = [mid[0] + nx * (s - Rr), mid[1] + ny * (s - Rr)];
    let a0 = Math.atan2(b0[1] - cen[1], b0[0] - cen[0]), a1 = Math.atan2(b1[1] - cen[1], b1[0] - cen[0]);
    const am = Math.atan2(mid[1] + ny * s - cen[1], mid[0] + nx * s - cen[0]);
    // go the way that passes through the bowed apex
    const within = (a, lo, hi) => { const t = (a - lo + 4 * TAU) % TAU, e = (hi - lo + 4 * TAU) % TAU; return t <= e; };
    if (within(am, a0, a1)) { while (a1 < a0) a1 += TAU; } else { while (a1 > a0) a1 -= TAU; }
    return arcPts(cen[0], cen[1], Rr, a0, a1, 60);
  })();
  const stalkR = [[HX + 0.33 * R, HY - 0.9 * R], [HX + 0.55 * R, HY - 1.2 * R], [HX + 0.83 * R, HY - 1.13 * R]];

  // ----- the dots -----
  const L = [-0.5, -0.62, 0.6]; { const l = hyp(...L); L[0] /= l; L[1] /= l; L[2] /= l; }
  const freck = new Set(v.freckles.map(([k, j]) => k + "," + j));
  const dots = [], freckles = [], earDots = [];
  const keepK = v.keepK; // a dot keeps at least this share of its size, or it is dropped
  const avail = (x, y, inHead) => Math.min(inHead ? -sdHead(x, y) : -sdEar(x, y) - 2, sdFeat(x, y));
  let dropped = 0, nudged = 0;
  for (let j = -12; j <= 12; j++) for (let k = -14; k <= 14; k++) {
    const x = HX + k * C, y = HY + j * C;
    const dh = sdHead(x, y), de = sdEar(x, y);
    if (dh > 0 && de > 0) continue;
    const inHead = dh <= 0, isF = freck.has(k + "," + j);
    let r0;
    if (isF) r0 = C * v.freckR;
    else if (inHead) {
      const nx = (x - HX) / G.RX, ny = (y - HY) / G.RY, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      r0 = C * (v.rLo + (v.rHi - v.rLo) * clamp(nx * L[0] + ny * L[1] + nz * L[2]));
    } else r0 = C * 0.38;
    let px = x, py = y, r = r0;
    const a = avail(x, y, inHead);
    if (a < r0) {
      // a small nudge (never more than v.nudge) away from what crowds it, then keep or drop
      const h = 0.5, gx = avail(x + h, y, inHead) - avail(x - h, y, inHead), gy = avail(x, y + h, inHead) - avail(x, y - h, inHead);
      const gl = hyp(gx, gy) || 1, t = Math.min(v.nudge, Math.max(0, r0 - a));
      px = x + gx / gl * t; py = y + gy / gl * t;
      r = Math.min(r0, avail(px, py, inHead));
      if (r < keepK * r0) { dropped++; continue; }
      nudged++;
    }
    (isF ? freckles : inHead ? dots : earDots).push([px, py, r]);
  }
  // strays: a cluster of one or two head dots cut off from the rest reads as dirt; drop it
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
  // beads on the stalks: whole cream dots in an ink casing, the same dot language as the head
  const beadR = v.beadR, pitch = v.beadPitch;
  const headDots = dots.concat(freckles);
  const clearOfHead = ([x, y]) => headDots.every(([dx, dy, dr]) => hyp(x - dx, y - dy) >= dr + beadR + 3) && sdHead(x, y) > 2;
  const beadsL = (() => {
    // from the ball down; stop where the stalk enters the head
    const pts = stalkL.slice().reverse();
    const L0 = polyLen(pts), n = Math.round(L0 / pitch) + 1, ev = evenly(pts, n);
    return ev.filter((p) => hyp(p[0] - ball[0], p[1] - ball[1]) >= br + 4 + beadR && clearOfHead(p));
  })();
  const beadsR = (() => {
    const out = [];
    for (let i = stalkR.length - 1; i > 0; i--) {
      const a = stalkR[i], b = stalkR[i - 1], n = Math.max(1, Math.round(hyp(b[0] - a[0], b[1] - a[1]) / pitch));
      for (let q = (i === stalkR.length - 1 ? 0 : 1); q <= n; q++) out.push([lerp(a[0], b[0], q / n), lerp(a[1], b[1], q / n)]);
    }
    return out.filter(clearOfHead);
  })();

  // ----- the neon rim light: the head dots nearest the lit ball catch a thin neon crescent on the side facing it -----
  const rim = v.rim, rimD = [];
  if (rim) {
    for (const [x, y, r] of dots) {
      const depth = -sdHead(x, y) - r, dB = hyp(x - ball[0], y - ball[1]);
      const ux = (x - HX) / G.RX, uy = (y - HY) / G.RY;
      let nx = Math.sign(ux) * Math.abs(ux) ** (G.N - 1) / G.RX, ny = Math.sign(uy) * Math.abs(uy) ** (G.N - 1) / G.RY; const nl = hyp(nx, ny) || 1; nx /= nl; ny /= nl;
      const tx = (ball[0] - x) / dB, ty = (ball[1] - y) / dB, face = clamp(tx * nx + ty * ny);
      const w = rim.mix * clamp((rim.far - dB) / (rim.far - rim.near)) * clamp(1.15 - depth / (rim.rows * C)) * clamp((face - 0.2) / 0.5);
      if (w < 0.04) continue;
      // crescent = this dot minus a copy shifted away from the ball by d
      const d = Math.min(0.9, w * 2.2) * r, mx = x - tx * d / 2, my = y - ty * d / 2, h = Math.sqrt(r * r - (d / 2) ** 2);
      const p1 = [mx - ty * h, my + tx * h], p2 = [mx + ty * h, my - tx * h];
      // outer arc on the dot (through the point facing the ball), inner arc on the shifted copy
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
  } else {
    o.push(`<radialGradient id="${id("gr")}" cx="${HX - 30}" cy="${HY - 80}" r="740" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3B342C"/><stop offset=".36" stop-color="#25211C"/><stop offset=".7" stop-color="#171513"/><stop offset="1" stop-color="#0E0D0B"/></radialGradient>`);
  }
  // the glow: a tight bright core and a faint wide bloom, both easing out
  const glowStops = (a) => [[0, 1], [0.2, 0.82], [0.42, 0.46], [0.66, 0.16], [0.85, 0.04], [1, 0]].map(([o2, k]) => `<stop offset="${o2}" stop-color="${neon}" stop-opacity="${(a * k).toFixed(3)}"/>`).join("");
  o.push(`<radialGradient id="${id("gb")}" cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.bloom}" gradientUnits="userSpaceOnUse">${glowStops(v.glow.bloomA)}</radialGradient>`);
  o.push(`<radialGradient id="${id("gc")}" cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.core}" gradientUnits="userSpaceOnUse">${glowStops(v.glow.coreA)}</radialGradient>`);
  o.push(`<radialGradient id="${id("bl")}" cx="${f1(ball[0] - br * .35)}" cy="${f1(ball[1] - br * .4)}" r="${f1(br * 1.5)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${v.ballHot ? "#F4FFEE" : "#D8FFC8"}"/><stop offset="${v.ballHot ? .46 : .4}" stop-color="${neon}"/><stop offset="1" stop-color="#1FA80A"/></radialGradient>`);
  o.push(`<radialGradient id="${id("ey")}" cx="${f1(E[0] - Ri * .3)}" cy="${f1(E[1] - Ri * .3)}" r="${f1(Ri * 1.5)}" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="${white}"/><stop offset="1" stop-color="#E2DBD0"/></radialGradient>`);
  o.push(`<linearGradient id="${id("ld")}" x1="0" y1="${f1(E[1] - Ri)}" x2="0" y2="${f1(E[1] + (v.lidGradTo || 0) * Ri)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${v.lidCols ? v.lidCols[0] : "#CDBB9C"}"/><stop offset="1" stop-color="${v.lidCols ? v.lidCols[1] : "#A48E70"}"/></linearGradient>`);
  const radial = (name, stops) => `<radialGradient id="${id(name)}" cx="${f1(dtC[0])}" cy="${f1(dtC[1])}" r="${f1(dtR)}" gradientUnits="userSpaceOnUse">${stops.map(([o2, c]) => `<stop offset="${o2}" stop-color="${c}"/>`).join("")}</radialGradient>`;
  o.push(radial("dt", PAL.dt), radial("kl", PAL.kl));
  o.push(`<radialGradient id="${id("hb")}" cx="${f1(HX - 0.4 * G.RX)}" cy="${f1(HY - 0.45 * G.RY)}" r="${f1(1.6 * G.RX)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${v.base[0]}"/><stop offset="1" stop-color="${v.base[1]}"/></radialGradient>`);
  o.push(`</defs>`);
  o.push(`<rect width="1000" height="1000" fill="url(#${id("gr")})"/>`);
  if (v.paper) o.push(`<rect width="1000" height="1000" fill="url(#${id("sh")})"/>`);
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.bloom}" fill="url(#${id("gb")})"/>`);
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${v.glow.core}" fill="url(#${id("gc")})"/>`);
  if (v.waves) o.push(v.waves(ball, br));
  // the ink sticker: head, ears, ball casing, stalk casings
  const casing = v.casingW;
  o.push(`<g fill="none" stroke="${deep}" stroke-width="${casing}" stroke-linecap="round" stroke-linejoin="round"><path d="${ptsPath(stalkL)}"/><path d="${ptsPath(stalkR)}"/></g>`);
  if (v.scallop) o.push(scallopSticker({ deep, ear, HX, HY, ...v.scallop }));
  else o.push(`<g fill="${deep}"><path d="${headPath(S)}"/>` + [-1, 1].map((s) => `<rect x="${HX + s * ear.cx - ear.hw - S}" y="${HY - ear.hh - S}" width="${2 * (ear.hw + S)}" height="${2 * (ear.hh + S)}" rx="${ear.r + S}"/>`).join("") + `</g>`);
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${br + v.ballCase}" fill="${deep}"/>`);
  // a faint lit base under the dots, so the head reads light and round when the dots blur together
  o.push(`<path d="${headPath(-2)}" fill="url(#${id("hb")})"/>`);
  // dots
  o.push(`<path fill="url(#${id("dt")})" d="${dotsPath(dots)}"/>`);
  if (rimD.length) o.push(`<path fill="${neon}" d="${rimD.join("")}"/>`);
  o.push(`<path fill="#CDB18B" d="${dotsPath(earDots)}"/>`);
  o.push(`<path fill="${rust}" d="${dotsPath(freckles)}"/>`);
  o.push(`<path fill="url(#${id("dt")})" d="${dotsPath([...beadsL, ...beadsR].map(([x, y]) => [x, y, beadR]))}"/>`);
  // keylines (eye ring, mouth, tooth) in the dots' own light, one step down
  o.push(`<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ro + KE}" fill="url(#${id("kl")})"/>`);
  if (v.browKey) o.push(`<path d="${brow.d}" fill="url(#${id("kl")})" stroke="url(#${id("kl")})" stroke-width="${2 * v.browKey}" stroke-linejoin="round"/>`);
  o.push(mouth.key);
  if (tooth) o.push(`<rect x="${f1(tooth.x - KM - TO / 2)}" y="${f1(tooth.y - KM - TO / 2)}" width="${f1(tooth.w + 2 * KM + TO)}" height="${f1(tooth.h + 2 * KM + TO)}" rx="${f1(tooth.rx + KM)}" fill="url(#${id("kl")})"/>`);
  // eye
  o.push(`<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ro}" fill="${deep}"/>`);
  o.push(v.eyeDraw({ E, Ri, Ro, ink, white, id }));
  o.push(`<path d="${brow.d}" fill="${ink}"/>`);
  if (tooth) o.push(`<rect x="${f1(tooth.x)}" y="${f1(tooth.y)}" width="${tooth.w}" height="${tooth.h}" rx="${tooth.rx}" fill="${white}" stroke="${ink}" stroke-width="${TO}"/>`);
  o.push(mouth.ink);
  if (v.grinTooth) o.push(v.grinTooth({ HX, HY, white, ink }));
  // ball
  o.push(`<circle cx="${f1(ball[0])}" cy="${f1(ball[1])}" r="${br}" fill="url(#${id("bl")})"/>`);
  o.push(`<circle cx="${f1(ball[0] - br * .36)}" cy="${f1(ball[1] - br * .38)}" r="${f1(br * .2)}" fill="#F6FFF2"/>`);
  if (v.extra) o.push(v.extra({ E, Ri, Ro, ball, neon, cream, white, ink, HX, HY }));
  o.push(`</svg>`);
  const svg = o.join("\n");
  return { svg, stats: { dots: dots.length, rim: rimD.length, ears: earDots.length, freckles: freckles.length, beads: beadsL.length + beadsR.length, dropped, nudged, bytes: svg.length } };
}

// ---------- eye moods ----------
function eyeOpen({ lid, look, pupil = 0.46, glint = 0.13 }) {
  return ({ E, Ri, ink, white, id }) => {
    const px = E[0] + look[0] * Ri, py = E[1] + look[1] * Ri, pr = Ri * pupil;
    const s = [`<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ri}" fill="url(#${id("ey")})"/>`,
      `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(pr)}" fill="${ink}"/>`,
      `<circle cx="${f1(px - pr * .36)}" cy="${f1(py - pr * .38)}" r="${f1(Ri * glint)}" fill="${white}"/>`];
    // upper lid: the cap of the eyeball above the chord y = E.y - lid*Ri, with a crisp ink lid line
    const yc = E[1] - lid * Ri, hx = Math.sqrt(Ri * Ri - (lid * Ri) ** 2);
    s.push(`<path d="M${f1(E[0] - hx)} ${f1(yc)}A${Ri} ${Ri} 0 0 1 ${f1(E[0] + hx)} ${f1(yc)}Z" fill="url(#${id("ld")})"/>`);
    // the lid's soft shadow on the eyeball, then its crisp edge
    s.push(`<linearGradient id="${id("ls")}" x1="0" y1="${f1(yc)}" x2="0" y2="${f1(yc + 26)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3A2E22" stop-opacity=".22"/><stop offset="1" stop-color="#3A2E22" stop-opacity="0"/></linearGradient>`);
    const y2 = yc + 26, hx2 = Math.sqrt(Math.max(0, Ri * Ri - (E[1] - y2) ** 2));
    s.push(`<path d="M${f1(E[0] - hx)} ${f1(yc)}H${f1(E[0] + hx)}L${f1(E[0] + hx2)} ${f1(y2)}H${f1(E[0] - hx2)}Z" fill="url(#${id("ls")})"/>`);
    s.push(`<path d="M${f1(E[0] - hx)} ${f1(yc)}H${f1(E[0] + hx)}" stroke="${ink}" stroke-width="11"/>`);
    return s.join("");
  };
}
// closed and happy: a light lid, crossed ring to ring by one bold lash line curving down (a smile-shaped lid edge)
function eyeHappy({ w = 28, span = 0.97, endY = 0.0, dip = 0.4 }) {
  return ({ E, Ri, ink, id }) => {
    const c = span * Ri, s = dip * Ri, Rr = (c * c + s * s) / (2 * s), cy = E[1] + endY * Ri + s - Rr;
    const half = Math.asin(c / Rr);
    const arc = arcPts(E[0], cy, Rr, PI / 2 + half, PI / 2 - half, 48);
    // under the lash, the cheek: the same light one step warmer, clipped to the eyeball
    const below = ptsPath(arc) + `L${f1(E[0] + Ri)} ${f1(E[1] + Ri)}L${f1(E[0] - Ri)} ${f1(E[1] + Ri)}Z`;
    return `<circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ri}" fill="url(#${id("ld")})"/>` +
      `<clipPath id="${id("ec")}"><circle cx="${f1(E[0])}" cy="${f1(E[1])}" r="${Ri}"/></clipPath>` +
      `<path clip-path="url(#${id("ec")})" d="${below}" fill="#E2BF92"/>` +
      `<path d="${ptsPath(arc)}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
}

// ---------- the base design ----------
const base = {
  rLo: 0.40, rHi: 0.47, keepK: ENV("KEEPK", 0.94), nudge: ENV("NUDGE", 2.5),
  base: ["#6A5848", "#1E1914"],
  eye: { dx: -13, dy: -13, r: 120, ring: 26 },
  eyeKey: 4, gap: 4.5,
  brow: { dx: 0, dy: ENV("BDY", 92), r: ENV("BR", 300), span: ENV("BSPAN", 0.41), w: 28, end: 0.35, tilt: 0, lift: 0 },
  browClear: ENV("BCLEAR", 9), browKey: 0,
  mouth: { kind: "smile", x: 70, y: 106, r: 74, a0: 0.2, a1: 0.77, w: ENV("MW", 27), wEnd: ENV("MWE", 21) },
  mouthKey: ENV("MKEY", 5),
  tooth: { dx: 6, dy: -2, w: 29, h: 33, rx: 5 },
  freckles: [[6, 3], [5, 4], [7, 4]], freckR: 0.5,
  ball: { dx: ENV("BX", -130), dy: ENV("BY", -393), r: 41 }, stalk: { x0: ENV("SX0", -64), x1: 4, bow: ENV("BOW", 40) }, ballCase: 15,
  glow: { core: 86, coreA: 0.62, bloom: 165, bloomA: 0.2 },
  casingW: 46, beadR: 9.5, beadPitch: ENV("PITCH", 22.5),
  rim: { mix: ENV("RIM", 0.2), near: 95, far: 190, rows: 1.1 },
  eyeDraw: eyeOpen({ lid: 0.3, look: [0.04, 0.12] }),
};

const waves = (ball, br) => {
  // he is sending: two arcs either side of the lit ball
  const arc = (r, a0, a1) => ptsPath(arcPts(ball[0], ball[1], r, a0, a1, 24));
  const r1 = br + 46, r2 = br + 80, s1 = 0.19, s2 = 0.13;
  return `<g fill="none" stroke="${PAL.neon}" stroke-linecap="round">` +
    `<path d="${arc(r1, PI * (1 - s1), PI * (1 + s1))}" stroke-width="18"/><path d="${arc(r1, -PI * s1, PI * s1)}" stroke-width="18"/>` +
    `<path d="${arc(r2, PI * (1 - s2), PI * (1 + s2))}" stroke-width="15" opacity=".6"/><path d="${arc(r2, -PI * s2, PI * s2)}" stroke-width="15" opacity=".6"/></g>`;
};

const variants = {
  icon: { ...base, pre: "rfi-", rim: null }, // the rim light is for listening only: on the still icon it read as stray green dots
  alt: { ...base, pre: "rfa-", paper: true, scallop: { off: ENV("SCOFF", 13), rr: ENV("SCR", 12.5), pitch: ENV("SCP", 26) }, shadow: [0.18, 0.056], glow: { core: 80, coreA: 0.42, bloom: 150, bloomA: 0.14 }, rim: null },
  listening: {
    ...base, pre: "rfl-", ballHot: true, glow: { core: 92, coreA: 0.8, bloom: 170, bloomA: 0.26 }, waves,
    eyeDraw: eyeOpen({ lid: 0.62, look: [-0.22, -0.26], pupil: 0.47 }),
    brow: { ...base.brow, tilt: ENV("LTILT", 0.2), lift: ENV("LLIFT", 16) },
    rim: { mix: ENV("LRIM", 0.4), near: 100, far: 265, rows: 2.1 },
  },
  done: {
    ...base, pre: "rfd-", rim: null, lidGradTo: 1, lidCols: ["#F3E2C6", "#E9CBA2"],
    eyeDraw: eyeHappy({ w: 28 }),
    brow: { ...base.brow, lift: ENV("DLIFT", 7), r: ENV("DBR", 240), span: ENV("DSPAN", 0.5), dy: ENV("DBR", 240) - 208 },
    mouth: { kind: "grin", x: 70, y: 148, rx: 61, ry: 43, rot: -0.12 },
    tooth: null,
    grinTooth: ({ HX, HY, white }) => `<rect x="${HX + 44}" y="${HY + 145}" width="24" height="20" rx="4" fill="${white}"/>`,
    extra: ({ HX, HY, cream, neon }) => `<path d="${star(HX + 312, HY - 352, 44)}" fill="${cream}"/><path d="${star(HX + 344, HY - 270, 19)}" fill="${neon}"/>`,
  },
};

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
for (const [name, v] of Object.entries(variants)) {
  if (only && !only.includes(name)) continue;
  const r = build(v);
  fs.writeFileSync(path.join(OUT, name + ".svg"), r.svg);
  console.log(name.padEnd(10), JSON.stringify(r.stats));
}
