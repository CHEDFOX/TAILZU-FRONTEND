// Cute Blip app icon family (final).   node gen.mjs [outdir]
//   icon.svg       master: peach ground, sleepy lid, smile with a buck tooth
//   alt.svg        the dark (plum) ground, with a paper die-cut edge
//   listening.svg  lid up, eye up at the ball, brow up, antenna sending
//   done.svg       happy closed eye under a raised brow, big grin, sparkles
// Every pale dot is a whole dot. The rim and every feature get one hugging row
// of dots; the rest is a hex lattice relaxed into those rows, so there is no
// clip, no sliver and no crowding seam.
import fs from "node:fs";
import path from "node:path";
import { contours } from "./contour.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] || path.resolve(HERE, "..");
const ENV = process.env;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const PI = Math.PI, S = 24;

export const P = {
  C: [500, 578], rx: 295, ry: 270, tilt: -0.085,
  ear: { y: 4, out: +(ENV.EAR_OUT || 48), h: 84, r: 36, cols: 2, rows: +(ENV.EAR_ROWS || 2) },
  eye: { x: -24, y: -12, R: 150, ring: 26, pr: 91 },
  brow: { gap: 32, w: 25, wEnd: 12, drop: +(ENV.BDROP || 14), chord: 0.76 },
  smile: { x: 82, y: 204, r: 60, a0: 0.18, a1: 0.8, w: 23, toothA: 0.42, tw: 24, th: 24 },
  grin: { x: 72, y: 166, w: 132, h: 62, rot: -0.06 },
  arch: { dy: 40, r: 140, a0: 1.13, a1: 1.87, w: 40 },
  cheeks: [[-198, 114, 62, 47], [196, 100, 60, 45]],
  freckles: [[146, 52], [172, 70], [146, 84]],
  stalk: { B: [-96, -246], K: [-136, -424], A: 34, turns: 1 },
  wire: [[90, -246], [114, -298], [130, -334], [140, -346], [154, -348], [214, -334]],
};

// ---------------------------------------------------------------- maths
const [TC, TS] = [Math.cos(P.tilt), Math.sin(P.tilt)];
const W = ([x, y]) => [P.C[0] + x * TC - y * TS, P.C[1] + x * TS + y * TC];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1));
  return Math.hypot(wx - t * vx, wy - t * vy);
}
const polyDist = (p, pts) => { let m = 1e9; for (let i = 1; i < pts.length; i++) m = Math.min(m, segDist(p, pts[i - 1], pts[i])); return m; };
const arcPts = (cx, cy, r, a0, a1, n = 48) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const pathD = (pts, close) => "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L") + (close ? "Z" : "");
const polyLen = (pts, closed) => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s + (closed ? dist(pts[pts.length - 1], pts[0]) : 0); };
function evenly(pts, n, closed, phase = 0) {
  const ring = closed ? [...pts, pts[0]] : pts, len = polyLen(pts, closed), stepL = closed ? len / n : len / Math.max(1, n - 1);
  const out = []; let target = closed ? (phase % 1) * stepL : 0, acc = 0;
  for (let i = 1; i < ring.length && out.length < n; i++) {
    const a = ring[i - 1], b = ring[i], seg = dist(a, b);
    while (acc + seg >= target - 1e-9 && out.length < n) { const t = seg ? (target - acc) / seg : 0; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); target += stepL; }
    acc += seg;
  }
  return out;
}
function resample(pts, step) {
  const o = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i]; let seg = dist(a, b);
    while (acc + seg >= step) { const t = (step - acc) / seg; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; o.push(a); seg = dist(a, b); acc = 0; }
    acc += seg;
  }
  return o;
}
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, k) => "#" + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k).toString(16).padStart(2, "0")).join("").toUpperCase();
const dotsD = (pts) => pts.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
function insidePoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function ellD(x, y, rx, ry) {               // signed distance to an axis-aligned ellipse (negative inside)
  const px = Math.abs(x), py = Math.abs(y);
  let t = Math.atan2(py * rx, px * ry);
  for (let i = 0; i < 8; i++) {
    const ct = Math.cos(t), st = Math.sin(t);
    const dx = px - rx * ct, dy = py - ry * st, fx = -rx * st, fy = ry * ct;
    const g = dx * fx + dy * fy, h = fx * fx + fy * fy - dx * rx * ct - dy * ry * st;
    t = clamp(t + g / (h || 1), 0, PI / 2);
  }
  const d = Math.hypot(px - rx * Math.cos(t), py - ry * Math.sin(t));
  return (px * px) / (rx * rx) + (py * py) / (ry * ry) <= 1 ? -d : d;
}
function rrD(x, y, cx, cy, w, h, r) {
  const qx = Math.abs(x - cx) - (w / 2 - r), qy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const headIn = (q) => -ellD(q[0], q[1], P.rx, P.ry);   // positive inside the head

// ---------------------------------------------------------------- features (local coords; head centre = 0,0)
const E = P.eye, RO = E.R + E.ring / 2, RI = E.R - E.ring / 2;
function brow(raise = 0, lower = 0, drop = P.brow.drop, chord = P.brow.chord) {
  // a tapered ink arc: thick in the middle, round thin ends. Its circle sits below the
  // eye's centre, so it is flatter than the ring and its ends lift away from it.
  const B = P.brow, T = RO + B.gap + B.w / 2 + raise - lower, cy = E.y + drop, rb = T + drop;
  const h = Math.asin(clamp(chord * RO / rb, 0, 0.95)), n = 40, s = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = -PI / 2 - h + 2 * h * t, w = B.wEnd + (B.w - B.wEnd) * Math.sin(PI * t);
    s.push([E.x + Math.cos(a) * rb, cy + Math.sin(a) * rb, w / 2, a]);
  }
  const outer = s.map(([, , hw, a]) => [E.x + Math.cos(a) * (rb + hw), cy + Math.sin(a) * (rb + hw)]);
  const inner = s.map(([, , hw, a]) => [E.x + Math.cos(a) * (rb - hw), cy + Math.sin(a) * (rb - hw)]).reverse();
  const e0 = s[0], e1 = s[n];
  const capArc = (c, from, to) => { const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]); return arcPts(c[0], c[1], c[2], a0, a0 + PI, 10).slice(1); };
  const poly = [...outer, ...capArc(e1, outer[n], inner[0]), ...inner, ...capArc(e0, inner[n], outer[0])];
  const sd = (q) => { let m = 1e9; for (const [x, y, hw] of s) m = Math.min(m, Math.hypot(q[0] - x, q[1] - y) - hw); return m; };
  return { poly, sd };
}
function smile() {
  const M = P.smile, c = [M.x, M.y - M.r];
  const pts = arcPts(c[0], c[1], M.r, PI * M.a0, PI * M.a1, 30);
  const ta = PI * M.toothA, td = M.r + M.w / 2 + M.th / 2 - 7;
  const tooth = [c[0] + Math.cos(ta) * td, c[1] + Math.sin(ta) * td, ta - PI / 2];
  const sd = (q) => Math.min(polyDist(q, pts) - M.w / 2, toothSd(q, tooth) - 2.5);
  return { pts, tooth, sd };
}
function toothSd(q, [x, y, rot]) {
  const c = Math.cos(-rot), s = Math.sin(-rot), dx = q[0] - x, dy = q[1] - y;
  return rrD(dx * c - dy * s, dx * s + dy * c, 0, 0, P.smile.tw, P.smile.th, 6);
}
function grin() {
  const M = P.grin, c = Math.cos(M.rot), s = Math.sin(M.rot);
  const top = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return [(t - 0.5) * M.w, 6 * Math.sin(t * PI) - 4]; });
  const bot = arcPts(0, 0, 1, 0, PI, 30).map(([x, y]) => [x * M.w / 2, -4 + y * M.h]);
  const T = ([x, y]) => [M.x + x * c - y * s, M.y + x * s + y * c];
  const poly = [...top, ...bot.slice(1, -1).reverse()].map(T);
  const tongue = bot.filter(([, y]) => y > M.h * 0.45 - 4).map(([x, y]) => [x * 0.88, y]).map(T);
  const tooth = [...T([12, 2]), M.rot];
  const sd = (q) => (insidePoly(q, poly) ? -1 : 1) * polyDist(q, [...poly, poly[0]]);
  return { poly, tongue, tooth, sd };
}
const archPts = () => arcPts(E.x, E.y + P.arch.dy, P.arch.r, PI * P.arch.a0, PI * P.arch.a1, 48);

function features(mood) {
  if (mood === "done") {
    const ap = archPts(), br = brow(0, +(ENV.DONE_BROW_LOWER || 14), +(ENV.DONE_BDROP || 90), +(ENV.DONE_CHORD || 0.66)), gr = grin();
    return { mood, brow: br, grin: gr, arch: ap, list: [(q) => polyDist(q, ap) - P.arch.w / 2, br.sd, gr.sd] };
  }
  const br = brow(mood === "listening" ? 8 : 0), sm = smile();
  return { mood, brow: br, smile: sm, list: [(q) => dist(q, [E.x, E.y]) - RO, br.sd, sm.sd] };
}

function stalk() {
  const { B, K, A, turns } = P.stalk, ax = K[0] - B[0], ay = K[1] - B[1], len = Math.hypot(ax, ay), n = [-ay / len, ax / len];
  const pts = Array.from({ length: 81 }, (_, i) => {
    const t = i / 80, w = A * Math.sin(t * PI * 2 * turns) * (0.55 + 0.45 * Math.sin(t * PI));
    return [B[0] + ax * t + n[0] * w, B[1] + ay * t + n[1] * w];
  });
  return { pts, bead: K };
}
function wire() {
  const pts = [], raw = P.wire;
  for (let i = 0; i < raw.length - 1; i++) { const a = raw[i], b = raw[i + 1]; for (let k = 0; k < 8; k++) pts.push([a[0] + (b[0] - a[0]) * k / 8, a[1] + (b[1] - a[1]) * k / 8]); }
  pts.push(raw[raw.length - 1]);
  return pts;
}

// ---------------------------------------------------------------- the dot field
class Grid {
  constructor(c) { this.c = c; this.m = new Map(); }
  key(x, y) { return Math.floor(x / this.c) + "," + Math.floor(y / this.c); }
  add(d) { const k = this.key(d.q[0], d.q[1]); (this.m.get(k) || this.m.set(k, []).get(k)).push(d); }
  near(q, r) {
    const out = [], gx = Math.floor(q[0] / this.c), gy = Math.floor(q[1] / this.c), n = Math.ceil(r / this.c);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const d of this.m.get((gx + i) + "," + (gy + j)) || []) if (dist(d.q, q) < r) out.push(d);
    return out;
  }
}
const FIELDS = {};
function field(mood) {
  const key = mood === "done" ? "done" : mood;
  if (FIELDS[key]) return FIELDS[key];
  const F = features(mood);
  const featD = (q) => Math.min(...F.list.map((f) => f(q)));
  const RIM = S * 0.62, FEAT = S * 0.64, MINSP = S * 0.92;
  const valid = (q) => headIn(q) >= S * 0.5 && featD(q) >= S * 0.52;
  const acc = [], grid = new Grid(S);
  const tryAdd = (q, tag, minSp = MINSP) => {
    if (!valid(q)) return false;
    if (grid.near(q, minSp).length) return false;
    const d = { q, tag }; acc.push(d); grid.add(d); return true;
  };
  const box = [-P.rx - 30, -P.ry - 30, P.rx + 30, P.ry + 30];
  const ringOf = (fn, level, tag, phase = 0, bx = box) => {
    for (const c of contours((x, y) => fn([x, y]), ...bx, 2, level)) {
      const n = Math.max(1, Math.round(polyLen(c.pts, c.closed) / S));
      evenly(c.pts, n, c.closed, phase).forEach((q) => tryAdd(q, tag));
    }
  };
  // 1. the rim row: a clean silhouette of whole dots
  ringOf(headIn, RIM, "rim");
  // 2. one row hugging each feature
  for (const f of F.list) ringOf(f, FEAT, "feat");
  // 3. a second rim row
  ringOf(headIn, RIM + S * 0.94, "rim2", 0.5);
  // 4. the interior
  if ((ENV.FIELD || "rings") === "rings") {
    for (let k = 2; k < 14; k++) ringOf(headIn, RIM + S * 0.94 * k, "in", k * 0.37);
  } else {
    const dy = S * Math.sqrt(3) / 2;
    for (let j = -14; j <= 14; j++) for (let i = -16; i <= 16; i++) tryAdd([(i + (j & 1) * 0.5) * S + 6, j * dy - 4], "in");
  }
  // 5. relax the free dots into the fixed rows, fill holes, relax again
  const pinned = (d) => d.tag === "rim" || d.tag === "feat";
  const relax = (iters) => {
    for (let it = 0; it < iters; it++) {
      const g2 = new Grid(S); acc.forEach((d) => g2.add(d));
      for (const d of acc) {
        if (pinned(d)) continue;
        let mx = 0, my = 0;
        for (const o of g2.near(d.q, S * 1.12)) {
          if (o === d) continue;
          const dd = dist(o.q, d.q) || 1e-3, push = (S * 1.12 - dd) / dd * 0.22;
          mx += (d.q[0] - o.q[0]) * push; my += (d.q[1] - o.q[1]) * push;
        }
        const nq = [d.q[0] + clamp(mx, -4, 4), d.q[1] + clamp(my, -4, 4)];
        if (valid(nq)) d.q = nq;
      }
    }
  };
  const fill = (minNn) => {
    const g2 = new Grid(S); acc.forEach((d) => g2.add(d));
    const cand = [];
    for (let y = -P.ry; y <= P.ry; y += 4) for (let x = -P.rx; x <= P.rx; x += 4) {
      const q = [x, y]; if (!valid(q)) continue;
      const nb = g2.near(q, S * 2); let nn = S * 2; for (const o of nb) nn = Math.min(nn, dist(o.q, q));
      if (nn >= minNn) cand.push([nn, q]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    let added = 0;
    for (const [, q] of cand) if (!g2.near(q, minNn).length) { const d = { q, tag: "fill" }; acc.push(d); g2.add(d); added++; }
    return added;
  };
  relax(+(ENV.RELAX || 14));
  const added = fill(S * 0.98);
  relax(8);
  // 6. cull anything still crowded (the later, unpinned one yields)
  const keep = [], g3 = new Grid(S);
  for (const d of [...acc.filter(pinned), ...acc.filter((d) => !pinned(d))]) {
    if (g3.near(d.q, S * 0.86).length) continue;
    keep.push(d); g3.add(d);
  }
  for (const d of keep) {
    let nn = S * 2; for (const o of g3.near(d.q, S * 2)) if (o !== d) nn = Math.min(nn, dist(o.q, d.q));
    d.nn = nn; d.room = Math.min(headIn(d.q) - 3, featD(d.q) - 4);
  }
  return (FIELDS[key] = { dots: keep, F, added });
}

// ---------------------------------------------------------------- one icon
const LIGHT = (() => { const l = [-0.5, -0.62, 0.6], n = Math.hypot(...l); return l.map((v) => v / n); })();
const lit = (q) => {
  const u = q[0] / (P.rx * 1.02), v = q[1] / (P.ry * 1.02), z = Math.sqrt(Math.max(0, 1 - u * u - v * v));
  return clamp((u * LIGHT[0] + v * LIGHT[1] + z * LIGHT[2]) * 0.92 + 0.22);
};
const star = (cx, cy, R, k = 0.17) => {
  const q = R * k;
  return `M${f1(cx)} ${f1(cy - R)}Q${f1(cx + q)} ${f1(cy - q)} ${f1(cx + R)} ${f1(cy)}Q${f1(cx + q)} ${f1(cy + q)} ${f1(cx)} ${f1(cy + R)}Q${f1(cx - q)} ${f1(cy + q)} ${f1(cx - R)} ${f1(cy)}Q${f1(cx - q)} ${f1(cy - q)} ${f1(cx)} ${f1(cy - R)}Z`;
};

function build({ id, ground, mood }) {
  const dark = ground === "dark", listening = mood === "listening", done = mood === "done";
  const pal = dark
    ? { bg0: "#45333A", bg1: "#1D1619", ink: "#141110", edge: "#EFE6DA", hi: "#FFF8EB", mid: "#FAEACF", lo: "#F0D8B4",
      base: ["#F5DCB8", "#E2BC93", "#C99A70"], blush: "#F4A7B4", blushEdge: "#F6C9C4", freckle: "#B5643A", bead: "#F3E2C6" }
    : { bg0: "#FFF8EE", bg1: "#F7DCC9", ink: "#1C1A17", edge: null, hi: "#FFF8EA", mid: "#FAE9CD", lo: "#F0D8B3",
      base: ["#F5DCB8", "#E3BE96", "#CDA078"], blush: "#F4A7B4", blushEdge: "#F6C9C4", freckle: "#B5643A", bead: "#F3E2C6" };
  const FD = field(mood), F = FD.F;
  const st = stalk(), stalkW = st.pts.map(W), beadW = W(st.bead), wireW = wire().map(W);
  const eyeW = W([E.x, E.y]);
  const deg = (a) => f1(a * 180 / PI);
  const g = id;   // id prefix
  const o = [], defs = [];

  // --- pale dots, by tone
  const tiers = { hi: [], mid: [], lo: [], bk: [], be: [], fr: [], neon: [] };
  const frIdx = new Set(P.freckles.map((f) => { let bi = -1, bd = 1e9; FD.dots.forEach((d, i) => { const dd = dist(d.q, f); if (dd < bd) { bd = dd; bi = i; } }); return bi; }));
  const rimNeon = listening && ENV.RIMNEON === "1";
  const ballL = st.bead;
  for (const [i, d] of FD.dots.entries()) {
    const q = d.q, p = W(q), k = lit(q);
    const rFit = Math.min(d.nn * 0.46, d.room);
    if (frIdx.has(i)) { tiers.fr.push([p[0], p[1], Math.min(S * 0.33, rFit)]); continue; }
    let cheek = 0;
    for (const [cx, cy, ax, ay] of P.cheeks) cheek = Math.max(cheek, 1 - smooth(0.5, 1.06, Math.hypot((q[0] - cx) / ax, (q[1] - cy) / ay)));
    const r = Math.min(S * (0.33 + 0.15 * smooth(0.12, 0.95, k)), rFit);
    if (cheek > 0.42) { tiers.bk.push([p[0], p[1], Math.min(Math.max(r, S * 0.38), rFit)]); continue; }
    if (cheek > 0.12) { tiers.be.push([p[0], p[1], Math.min(Math.max(r, S * 0.36), rFit)]); continue; }
    if (rimNeon && (d.tag === "rim" || d.tag === "rim2")) {
      const dd = dist(q, ballL);
      if (d.tag === "rim" && dd < +(ENV.RIMR || 215)) { tiers.neon.push([p[0], p[1], r]); continue; }
    }
    (k >= 0.74 ? tiers.hi : k >= 0.47 ? tiers.mid : tiers.lo).push([p[0], p[1], r]);
  }

  // --- defs
  defs.push(`<radialGradient id="${g}bg" cx="500" cy="420" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${pal.bg0}"/><stop offset="1" stop-color="${pal.bg1}"/></radialGradient>`);
  const gA = listening ? 0.8 : (dark ? 0.72 : 0.72), gR = listening ? 160 : (dark ? 132 : 128);
  defs.push(`<radialGradient id="${g}glow"><stop offset="0" stop-color="#39FF14" stop-opacity="${gA}"/><stop offset="${(52 / gR).toFixed(2)}" stop-color="#39FF14" stop-opacity="${(gA * 0.85).toFixed(2)}"/><stop offset="${(80 / gR).toFixed(2)}" stop-color="#5BEA3A" stop-opacity="${(gA * 0.4).toFixed(2)}"/><stop offset="${(108 / gR).toFixed(2)}" stop-color="#5BEA3A" stop-opacity="${(gA * 0.12).toFixed(2)}"/><stop offset="1" stop-color="#5BEA3A" stop-opacity="0"/></radialGradient>`);
  const lc = W([-P.rx * 0.36, -P.ry * 0.46]);
  defs.push(`<radialGradient id="${g}base" cx="${f1(lc[0])}" cy="${f1(lc[1])}" r="${f1(P.rx * 1.45)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${pal.base[0]}"/><stop offset="0.6" stop-color="${pal.base[1]}"/><stop offset="1" stop-color="${pal.base[2]}"/></radialGradient>`);
  defs.push(`<radialGradient id="${g}rose"><stop offset="0" stop-color="${pal.blush}" stop-opacity="0.5"/><stop offset="0.65" stop-color="${pal.blush}" stop-opacity="0.2"/><stop offset="1" stop-color="${pal.blush}" stop-opacity="0"/></radialGradient>`);
  defs.push(`<radialGradient id="${g}pup" cx="0.5" cy="0.98" r="0.62"><stop offset="0" stop-color="#4A3428"/><stop offset="0.55" stop-color="#211915"/><stop offset="1" stop-color="#151311"/></radialGradient>`);
  defs.push(`<radialGradient id="${g}bead" cx="0.36" cy="0.32" r="0.72"><stop offset="0" stop-color="#E8FFDC"/><stop offset="0.3" stop-color="#7DFF5A"/><stop offset="0.62" stop-color="#39FF14"/><stop offset="1" stop-color="#2AC70E"/></radialGradient>`);
  if (!listening && !done) defs.push(`<linearGradient id="${g}lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9B48A"/><stop offset="1" stop-color="#E9CBA2"/></linearGradient>`);

  o.push(`<rect width="1000" height="1000" fill="url(#${g}bg)"/>`);
  o.push(`<circle cx="${f1(beadW[0])}" cy="${f1(beadW[1])}" r="${gR}" fill="url(#${g}glow)"/>`);

  // --- the sticker: head, ears, stalk casings (+ a paper die-cut edge on the dark ground)
  const headPts = arcPts(0, 0, 1, 0, PI * 2, 180).map(([x, y]) => W([x * P.rx, y * P.ry]));
  const EA = P.ear, earX0 = P.rx - 14, earX1 = P.rx + 18 + EA.out;
  const earRect = (sx, grow = 0) => {
    const cxL = sx * (earX0 + earX1) / 2, c = W([cxL, EA.y]), w = earX1 - earX0 + 2 * grow, h = EA.h + 2 * grow;
    return `<rect x="${f1(c[0] - w / 2)}" y="${f1(c[1] - h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="${f1(EA.r + grow)}" transform="rotate(${deg(P.tilt)} ${f1(c[0])} ${f1(c[1])})"/>`;
  };
  const casing = S * 1.6;
  if (pal.edge) {
    const e = 13;
    o.push(`<g fill="${pal.edge}" stroke="${pal.edge}" stroke-linejoin="round"><path stroke-width="${f1(S * 1.5 + 2 * e)}" d="${pathD(headPts, true)}"/>${earRect(-1, e)}${earRect(1, e)}<circle cx="${f1(beadW[0])}" cy="${f1(beadW[1])}" r="${50 + e}"/></g>`);
    o.push(`<g fill="none" stroke="${pal.edge}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${f1(casing + 2 * e)}"><path d="${pathD(stalkW)}"/><path d="${pathD(wireW)}"/></g>`);
  }
  o.push(`<g fill="${pal.ink}">${earRect(-1)}${earRect(1)}</g>`);
  o.push(`<path fill="${pal.ink}" stroke="${pal.ink}" stroke-width="${f1(S * 1.5)}" stroke-linejoin="round" d="${pathD(headPts, true)}"/>`);
  o.push(`<g fill="none" stroke="${pal.ink}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${f1(casing)}"><path d="${pathD(stalkW)}"/><path d="${pathD(wireW)}"/></g>`);
  const hb = arcPts(0, 0, 1, 0, PI * 2, 180).map(([x, y]) => W([x * (P.rx - 3), y * (P.ry - 3)]));
  o.push(`<path fill="url(#${g}base)" d="${pathD(hb, true)}"/>`);
  for (const [cx, cy, ax, ay] of P.cheeks) { const c = W([cx, cy]); o.push(`<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(ax * 1.2)}" ry="${f1(ay * 1.2)}" fill="url(#${g}rose)" transform="rotate(${deg(P.tilt)} ${f1(c[0])} ${f1(c[1])})"/>`); }

  // --- dots
  o.push(`<path fill="${pal.lo}" d="${dotsD(tiers.lo)}"/>`);
  o.push(`<path fill="${pal.mid}" d="${dotsD(tiers.mid)}"/>`);
  o.push(`<path fill="${pal.hi}" d="${dotsD(tiers.hi)}"/>`);
  if (tiers.neon.length) o.push(`<path fill="${mix(pal.hi, "#39FF14", +(ENV.NEONMIX || 0.22))}" d="${dotsD(tiers.neon)}"/>`);
  o.push(`<path fill="${pal.blushEdge}" d="${dotsD(tiers.be)}"/>`);
  o.push(`<path fill="${pal.blush}" d="${dotsD(tiers.bk)}"/>`);
  o.push(`<path fill="${pal.freckle}" d="${dotsD(tiers.fr)}"/>`);
  // beads on the antennae, and the ear grilles
  const stalkDots = resample(stalkW, S * 0.9).slice(1).filter((p) => dist(p, beadW) > 58);
  const wireDots = resample(wireW, S * 0.9).slice(1);
  o.push(`<path fill="${pal.bead}" d="${dotsD([...stalkDots, ...wireDots].map((p) => [p[0], p[1], S * 0.31]))}"/>`);
  const earDots = (sx) => {
    const out = [], x0 = P.rx + 18 + EA.out * 0.26, x1 = P.rx + 18 + EA.out * 0.7, pitchY = EA.rows === 3 ? 20 : 23;
    for (let r = 0; r < EA.rows; r++) for (const x of [x0, x1]) {
      const y = EA.y + (r - (EA.rows - 1) / 2) * pitchY, p = W([sx * x, y]);
      out.push([p[0], p[1], EA.rows === 3 ? 6.6 : 8.6]);
    }
    return out;
  };
  o.push(`<path fill="${pal.mid}" d="${dotsD(earDots(-1))}"/>`);
  o.push(`<path fill="${pal.lo}" d="${dotsD(earDots(1))}"/>`);

  // --- mouth
  if (F.smile) {
    const M = P.smile, sm = F.smile, [tx, ty, tr] = sm.tooth, tw = W([tx, ty]);
    o.push(`<rect x="${f1(tw[0] - M.tw / 2)}" y="${f1(tw[1] - M.th / 2)}" width="${M.tw}" height="${M.th}" rx="6" fill="#FFFFFF" stroke="${pal.ink}" stroke-width="5" transform="rotate(${deg(tr + P.tilt)} ${f1(tw[0])} ${f1(tw[1])})"/>`);
    o.push(`<path fill="none" stroke="${pal.ink}" stroke-width="${M.w}" stroke-linecap="round" d="${pathD(sm.pts.map(W))}"/>`);
  } else {
    const gr = F.grin, tw = W(gr.tooth);
    o.push(`<path fill="${pal.ink}" stroke="${pal.ink}" stroke-width="6" stroke-linejoin="round" d="${pathD(gr.poly.map(W), true)}"/>`);
    o.push(`<path fill="#F28DA2" d="${pathD(gr.tongue.map(W), true)}"/>`);
    o.push(`<rect x="${f1(tw[0] - 12)}" y="${f1(tw[1] - 4)}" width="24" height="21" rx="5" fill="#FFFFFF" transform="rotate(${deg(P.tilt + P.grin.rot)} ${f1(tw[0])} ${f1(tw[1])})"/>`);
  }

  // --- eye
  if (!done) {
    const look = listening ? [-14, -40] : [6, 8];
    const pcL = [E.x + look[0], E.y + look[1]], pc = W(pcL);
    o.push(`<circle cx="${f1(eyeW[0])}" cy="${f1(eyeW[1])}" r="${E.R}" fill="#FFFFFF" stroke="${pal.ink}" stroke-width="${E.ring}"/>`);
    if (!listening) {
      // sleepy lid: a tan cap over the top of the eyeball with a flat cut and an ink lid line
      const cutY = -RI + 2 * RI * +(ENV.LID || 0.15), half = Math.sqrt(RI * RI - cutY * cutY);
      const a0 = Math.atan2(cutY, -half), a1 = Math.atan2(cutY, half);
      const cap = arcPts(E.x, E.y, RI + 1, a0, a1 + (a1 < a0 ? 2 * PI : 0), 40);
      const capPts = cap.map(W);
      // pupil first so the lid sits on it
      const pr = E.pr, pcy = cutY + pr - 8;
      const pp = W([E.x + 6, E.y + pcy]);
      o.push(`<circle cx="${f1(pp[0])}" cy="${f1(pp[1])}" r="${pr}" fill="url(#${g}pup)"/>`);
      const gl1 = W([E.x + 6 - 32, E.y + cutY + 36]), gl2 = W([E.x + 6 + 40, E.y + pcy + 36]);
      o.push(`<circle cx="${f1(gl1[0])}" cy="${f1(gl1[1])}" r="27" fill="#FFFFFF"/>`);
      o.push(`<circle cx="${f1(gl2[0])}" cy="${f1(gl2[1])}" r="12" fill="#FFFFFF"/>`);
      o.push(`<path fill="url(#${g}lid)" d="${pathD(capPts, true)}"/>`);
      const l0 = W([E.x - half, E.y + cutY]), l1 = W([E.x + half, E.y + cutY]);
      o.push(`<path stroke="${pal.ink}" stroke-width="${ENV.LIDW || 7}" stroke-linecap="round" d="M${f1(l0[0])} ${f1(l0[1])}L${f1(l1[0])} ${f1(l1[1])}"/>`);
      o.push(`<circle cx="${f1(eyeW[0])}" cy="${f1(eyeW[1])}" r="${E.R}" fill="none" stroke="${pal.ink}" stroke-width="${E.ring}"/>`);
    } else {
      o.push(`<circle cx="${f1(pc[0])}" cy="${f1(pc[1])}" r="${E.pr}" fill="url(#${g}pup)"/>`);
      const gl1 = W([pcL[0] - 32, pcL[1] - 32]), gl2 = W([pcL[0] + 38, pcL[1] + 32]);
      o.push(`<circle cx="${f1(gl1[0])}" cy="${f1(gl1[1])}" r="27" fill="#FFFFFF"/>`);
      o.push(`<circle cx="${f1(gl2[0])}" cy="${f1(gl2[1])}" r="11" fill="#FFFFFF"/>`);
    }
  } else {
    o.push(`<path fill="none" stroke="${pal.ink}" stroke-width="${P.arch.w}" stroke-linecap="round" d="${pathD(F.arch.map(W))}"/>`);
  }
  // --- brow
  o.push(`<path fill="${pal.ink}" d="${pathD(F.brow.poly.map(W), true)}"/>`);

  // --- antenna sending: solid neon arcs in a thin ink casing
  if (listening) {
    const arcs = [];
    for (const [rr, span, sw] of [[100, 0.72, 17], [136, 0.58, 13]]) for (const mid of [PI + 0.14, -0.14]) arcs.push([arcPts(beadW[0], beadW[1], rr, mid - span / 2, mid + span / 2, 24), sw]);
    o.push(`<g fill="none" stroke="${pal.ink}" stroke-linecap="round">${arcs.map(([a, sw]) => `<path stroke-width="${sw + 11}" d="${pathD(a)}"/>`).join("")}</g>`);
    o.push(`<g fill="none" stroke-linecap="round">${arcs.map(([a, sw], i) => `<path stroke="#39FF14" stroke-width="${sw}" d="${pathD(a)}"/>`).join("")}</g>`);
  }
  // --- the ball
  o.push(`<circle cx="${f1(beadW[0])}" cy="${f1(beadW[1])}" r="${dark ? 50 : 55}" fill="${pal.ink}"/>`);
  o.push(`<circle cx="${f1(beadW[0])}" cy="${f1(beadW[1])}" r="44" fill="#1E8A0C"/>`);
  o.push(`<circle cx="${f1(beadW[0])}" cy="${f1(beadW[1])}" r="40" fill="url(#${g}bead)"/>`);
  o.push(`<circle cx="${f1(beadW[0] - 13)}" cy="${f1(beadW[1] - 14)}" r="11" fill="#F6FFF0"/>`);
  o.push(`<circle cx="${f1(beadW[0] + 15)}" cy="${f1(beadW[1] + 13)}" r="4.5" fill="#F6FFF0" opacity="0.8"/>`);
  // --- done: a cream four-point sparkle with an ink edge, and a tiny neon one
  if (done) {
    o.push(`<path fill="${pal.hi}" stroke="${pal.ink}" stroke-width="7" stroke-linejoin="round" d="${star(800, 304, 72)}"/>`);
    o.push(`<path fill="#39FF14" stroke="${pal.ink}" stroke-width="5.5" stroke-linejoin="round" d="${star(858, 402, 31)}"/>`);
  }
  return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">`, `<defs>`, ...defs, `</defs>`, ...o, `</svg>`].join("\n");
}

const files = [
  ["icon.svg", { id: "cui-", ground: "light", mood: "rest" }],
  ["alt.svg", { id: "cua-", ground: "dark", mood: "rest" }],
  ["listening.svg", { id: "cul-", ground: "light", mood: "listening" }],
  ["done.svg", { id: "cud-", ground: "light", mood: "done" }],
];
const ONLY = ENV.ONLY || "";
for (const [f, o] of files) {
  if (ONLY && !f.startsWith(ONLY)) continue;
  const s = build(o); fs.writeFileSync(path.join(OUT, f), s);
  const fd = FIELDS[o.mood === "done" ? "done" : o.mood];
  console.log(f, s.length, "dots", fd.dots.length, "filled", fd.added);
}
