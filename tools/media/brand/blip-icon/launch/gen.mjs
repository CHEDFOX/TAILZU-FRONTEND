// THE LAUNCH ART, Blip: the new icon's Blip in ink on the splash's white, for the splash and the launch motion. Same
// frame, bar and glove places as before (app/src/launch/launchCore.ts: BAR, GLOVES), so the motion is unchanged; the
// bot is new, and his feelers are layers of their own that hang and swing with physics (launchCore.ts: feelers).
//   node gen.mjs [outDir] [--app <app dir>]
// Writes, 544 px square (4x the splash's 136 pt), all in one frame so they stack exactly:
//   head.svg         his dotted head, cocked, peeking from behind the bar; the shades, the dot ears (no feelers)
//   bar.svg          the piece of bar, in ink
//   hands.svg        two robot hands gripping the bar's lower edge (each centred on its GLOVES place)
//   blink.svg        the shades' glint, flashed where the old bot blinked
//   feelerL1.svg feelerL2.svg feelerR1.svg feelerR2.svg
//                    each feeler's two links, drawn HANGING STRAIGHT DOWN from their pivots (the root; the joint, with
//                    the first link hanging straight down), so the app turns each about its pivot
//   splash.svg       feelers at rest (behind the head), head, bar, hands: the native splash and the motion's first frame
// and, with --app, <app>/src/launch/feelerArt.ts: the feelers' pivots, lengths, rest angles and physics, from here.
// Render each with ../kit/png.mjs at 544.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2), OUT = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--app") || here;
const APP = args.includes("--app") ? args[args.indexOf("--app") + 1] : null;
const f1 = (v) => (Math.round(v * 10) / 10).toString(), rad = (d) => d * Math.PI / 180;
const INK = "#0E0D0C", N = 544, U = 136 / 544;
const BAR = { x0: 48, y0: 138, x1: 495, y1: 195 };
const GL = [{ cx: 159, half: 36 }, { cx: 385.5, half: 36.5 }];
const H = { x: 272, y: 284, rx: 150, ry: 122, n: 2.3 }, TILT = 6;   // the head, cocked as the old bot's was
const rot = ([x, y], d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [x * c - y * s, x * s + y * c]; };
const toArt = (p) => { const q = rot(p, TILT); return [H.x + q[0], H.y + q[1]]; };
const inHead = (x, y, m = 0) => Math.abs(x / (H.rx - m)) ** H.n + Math.abs(y / (H.ry - m)) ** H.n < 1;
const sup = (t, m = 0) => { const c = Math.cos(t), s = Math.sin(t), e = 2 / H.n; return [Math.sign(c) * Math.abs(c) ** e * (H.rx - m), Math.sign(s) * Math.abs(s) ** e * (H.ry - m)]; };
const V = { x0: -104, x1: 104, y0: -34, y1: 15 };
const inVisor = (x, y, m = 0) => x > V.x0 - m && x < V.x1 + m && y > V.y0 - m && y < V.y1 + m + (1 - (x / V.x1) ** 2) * 13;
const visorPath = () => { const v = V; return `M${v.x0} ${v.y0 + 4}Q${v.x0} ${v.y0 - 3} ${v.x0 + 15} ${v.y0 - 2}H${v.x1 - 15}Q${v.x1} ${v.y0 - 3} ${v.x1} ${v.y0 + 4}V${v.y1 - 5}Q${v.x1 - 3} ${v.y1 + 17} ${v.x1 - 40} ${v.y1 + 20}Q0 ${v.y1 + 31} ${v.x0 + 40} ${v.y1 + 20}Q${v.x0 + 3} ${v.y1 + 17} ${v.x0} ${v.y1 - 5}Z`; };

// ---------------------------------------------------------------- the feelers: the icon's, hanging, with physics
// The icon's own feelers (cool/gen.mjs, mono: a flared root, a smooth taper, a teardrop tip; the left short with an S,
// the right long, arching, its tip curling back) hung upside down: he hangs upside down, so the top of his head is the
// bottom of the picture and they hang from there. Each is cut in two along its own curve and drawn in its resting
// shape; the app turns each piece about its pivot (the root; the cut) by how far the physics has moved it from rest.
// The springs are set so that rest under gravity IS the icon's shape (launchCore.ts works them out from eq).
const SC = H.rx / 344 * 1.12;   // the icon's head is 344 wide (half), this one 150; a touch longer, to hold the icon's proportion
// Upside down is the icon turned half round: each feeler's root goes to the opposite side of the head, its shape turns
// with it. So the icon's long arching feeler hangs on the LEFT here, the short S on the right.
const ROOTS = { L: sup(-1.13 + Math.PI, 10), R: sup(-2.02 + Math.PI, 10) };
const CURVES = {
  L: (b) => [b, [b[0] - 8 * SC, b[1] + 132 * SC], [b[0] - 150 * SC, b[1] + 206 * SC], [b[0] - 166 * SC, b[1] + 138 * SC]],
  R: (b) => [b, [b[0] + 2 * SC, b[1] + 64 * SC], [b[0] + 66 * SC, b[1] + 74 * SC], [b[0] + 58 * SC, b[1] + 136 * SC]],
};
const WID = { L: { w0: 32 * SC * 1.15, w1: 8 * SC * 1.15, tip: 16 * SC * 1.1 }, R: { w0: 30 * SC * 1.15, w1: 9 * SC * 1.15, tip: 15 * SC * 1.1 } };
const CUT = { L: 0.46, R: 0.5 };            // where each is cut in two, as a fraction of its curve
// Physics, in points and seconds (launchCore.ts reads these): gravity, each piece's spring (per s^2) and damping (per s).
// Gravity does most of it; soft springs hold the shape, light damping lets them swing.
const PHYS = { g: 2600, k1: 140, k2: 110, c1: 3.4, c2: 3.8 };
const cub = (P, t) => { const u = 1 - t; return [0, 1].map((i) => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); };
/** The whole feeler at rest, as the icon draws it (one outline along the curve, a round root, a teardrop tip). */
function wholeFeeler(P, w) {
  const NN = 240, pts = [], nm = [];
  for (let i = 0; i <= NN; i++) pts.push(cub(P, i / NN));
  for (let i = 0; i <= NN; i++) { const a = pts[Math.max(0, i - 1)], c = pts[Math.min(NN, i + 1)], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1; nm.push([-dy / l, dx / l]); }
  const W = (i) => (w.w1 + (w.w0 - w.w1) * Math.pow(1 - i / NN, 2.2)) / 2;
  const sd = (g) => pts.map((p, i) => [p[0] + nm[i][0] * W(i) * g, p[1] + nm[i][1] * W(i) * g]);
  let o = `<path d="${sd(1).concat(sd(-1).reverse()).map((q, i) => (i ? "L" : "M") + f1(q[0]) + " " + f1(q[1])).join("")}Z" fill="${INK}"/>`;
  o += `<circle cx="${f1(pts[0][0])}" cy="${f1(pts[0][1])}" r="${f1(W(0))}" fill="${INK}"/>`;
  const e = pts[NN], pv = pts[NN - 10], ang = Math.atan2(e[1] - pv[1], e[0] - pv[0]), cx = e[0] + Math.cos(ang) * w.tip * 0.55, cy = e[1] + Math.sin(ang) * w.tip * 0.55;
  o += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(w.tip * 1.3)}" ry="${f1(w.tip)}" transform="rotate(${f1(ang * 180 / Math.PI)} ${f1(cx)} ${f1(cy)})" fill="${INK}"/>`;
  return { body: o, width: (t) => (w.w1 + (w.w0 - w.w1) * Math.pow(1 - t, 2.2)) / 2 };
}
/**
 * One piece of a feeler: the whole feeler, clipped to one side of a cut straight across the stalk at t (the line
 * through the curve's point there, square to it), with a round cap at the cut so the two pieces stay one feeler as
 * they bend.
 */
function piece(P, w, t, side, id) {
  const j = cub(P, t), a = cub(P, Math.max(0, t - 0.01)), c = cub(P, Math.min(1, t + 0.01)), l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
  const tx = (c[0] - a[0]) / l, ty = (c[1] - a[1]) / l, nx = -ty, ny = tx, R = 400, sg = side === "root" ? -1 : 1;
  const poly = [[j[0] + nx * R, j[1] + ny * R], [j[0] - nx * R, j[1] - ny * R], [j[0] - nx * R + sg * tx * R, j[1] - ny * R + sg * ty * R], [j[0] + nx * R + sg * tx * R, j[1] + ny * R + sg * ty * R]];
  const F = wholeFeeler(P, w);
  return `<defs><clipPath id="${id}"><path d="${poly.map((q, i) => (i ? "L" : "M") + f1(q[0]) + " " + f1(q[1])).join("")}Z"/></clipPath></defs>`
    + `<g clip-path="url(#${id})">${F.body}</g><circle cx="${f1(j[0])}" cy="${f1(j[1])}" r="${f1(F.width(t))}" fill="${INK}"/>`;
}
const cssAngle = (a, b) => Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180 / Math.PI;   // a piece's chord as a CSS turn of "straight down"
const feelerSvgs = {}, geo = {};
for (const s of ["L", "R"]) {
  const P = CURVES[s](ROOTS[s]).map(toArt);   // into the art's frame (the head is cocked)
  const j = cub(P, CUT[s]), e = cub(P, 1);
  feelerSvgs[`feeler${s}1.svg`] = piece(P, WID[s], CUT[s], "root", `c${s}1`);
  feelerSvgs[`feeler${s}2.svg`] = piece(P, WID[s], CUT[s], "tip", `c${s}2`);
  geo[s] = { root: P[0], joint: j, tip: e, L1: Math.hypot(j[0] - P[0][0], j[1] - P[0][1]), L2: Math.hypot(e[0] - j[0], e[1] - j[1]), a1: cssAngle(P[0], j), a2: cssAngle(j, e) };
}
const feelersAtRest = Object.values(feelerSvgs).join("");

// ---------------------------------------------------------------- the head's dots: a hex grid, sized by a lit dome
const C = 12.6, row = C * 0.866, dots = [];
const Lv = [-0.32, -0.42, 0.85], Ln = Math.hypot(...Lv);
const nearRoot = () => false;
for (let j = -Math.ceil(H.ry / row); j <= Math.ceil(H.ry / row); j++) for (let i = -Math.ceil(H.rx / C) - 1; i <= Math.ceil(H.rx / C) + 1; i++) {
  const x = i * C + ((j & 1) ? C / 2 : 0), y = j * row, nx = x / H.rx, ny = y / H.ry, q = 1 - nx * nx - ny * ny; if (q <= 0) continue;
  const light = Math.max(0, (nx * Lv[0] + ny * Lv[1] + Math.sqrt(q) * Lv[2]) / Ln);
  const r = 1.9 + 3.5 * Math.pow(0.3 + 0.7 * (1 - light * 0.75), 1.1);
  if (!inHead(x, y, r + 3) || inVisor(x, y, 7 + r * 0.5) || nearRoot(x, y) || r < 2) continue;
  dots.push([x, y, r]);
}
const dotPath = dots.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
const ears = [-1, 1].map((sd) => [-11, 2, 15].map((dy) => `<circle cx="${f1(sd * (H.rx + 10))}" cy="${dy}" r="4.2" fill="${INK}"/>`).join("")).join("");
const lensDefs = `<linearGradient id="ll" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26262A"/><stop offset="0.55" stop-color="#0B0B0D"/><stop offset="1" stop-color="#000"/></linearGradient><clipPath id="lc"><path d="${visorPath()}"/></clipPath>`;
const glints = (o1, o2, dx = 0) => `<g clip-path="url(#lc)"><path d="M${-62 + dx} 60L${10 + dx} -80H${44 + dx}L${-28 + dx} 60Z" fill="#FFFFFF" opacity="${o1}"/><path d="M${-16 + dx} 60L${56 + dx} -80H${68 + dx}L${-4 + dx} 60Z" fill="#FFFFFF" opacity="${o2}"/></g>`;
const headBody = `<g transform="translate(${H.x} ${H.y}) rotate(${TILT})"><path d="${dotPath}" fill="${INK}"/>${ears}<path d="${visorPath()}" fill="url(#ll)"/>${glints(0.2, 0.14)}</g>`;
const blinkBody = `<g transform="translate(${H.x} ${H.y}) rotate(${TILT})"><path d="${visorPath()}" fill="url(#ll)"/>${glints(0.85, 0.5, 70)}</g>`;
const barBody = `<rect x="${BAR.x0}" y="${BAR.y0}" width="${BAR.x1 - BAR.x0}" height="${BAR.y1 - BAR.y0}" rx="14" fill="${INK}"/>`;

// ---------------------------------------------------------------- the hands: robot hands, gripping the bar's lower edge
// Three fingers of two segments each: the first rises from the knuckle at the bar's lower edge, the second (the tip,
// rounded) lies against the bar's face; round joints between. A squared palm with a seam and a bolt; a wrist joint.
// White with an ink line and a grey shade on the side away from the light, so they read on the ink bar and the white.
function hand(cx, half) {
  const w = half * 2 - 10, x0 = cx - w / 2, edge = BAR.y1, ln = `stroke="${INK}" stroke-width="3" stroke-linejoin="round"`;
  const fw = w * 0.27, gap = (w - 3 * fw) / 2, SH = "#C9C9C9";
  let o = "";
  // the palm (below the bar), its shade, its seam and bolt
  const py = edge - 2, ph = 19;
  o += `<rect x="${f1(x0 - 1)}" y="${f1(py)}" width="${f1(w + 2)}" height="${ph}" rx="7" fill="#FFFFFF" ${ln}/>`;
  o += `<path d="M${f1(x0 + w * 0.62)} ${f1(py + 1.6)}H${f1(x0 + w - 6)}Q${f1(x0 + w + 0.5)} ${f1(py + 1.6)} ${f1(x0 + w + 0.5)} ${f1(py + 8)}V${f1(py + ph - 6)}Q${f1(x0 + w + 0.5)} ${f1(py + ph - 1.6)} ${f1(x0 + w - 6)} ${f1(py + ph - 1.6)}H${f1(x0 + w * 0.62)}Z" fill="${SH}"/>`;
  o += `<line x1="${f1(x0 + 6)}" y1="${f1(py + ph * 0.55)}" x2="${f1(x0 + w * 0.45)}" y2="${f1(py + ph * 0.55)}" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`;
  o += `<circle cx="${f1(x0 + w * 0.72)}" cy="${f1(py + ph * 0.5)}" r="2.6" fill="${INK}"/>`;
  // the wrist: a short neck and a ball
  o += `<rect x="${f1(cx - 7)}" y="${f1(py + ph - 1)}" width="14" height="7" rx="2" fill="#FFFFFF" ${ln}/><circle cx="${f1(cx)}" cy="${f1(py + ph + 9)}" r="5" fill="#FFFFFF" ${ln}/>`;
  // the fingers, over the bar's lower edge
  for (let k = 0; k < 3; k++) {
    const fx = x0 + k * (fw + gap), up = k === 1 ? 3 : 0, kn = edge + 1, j = edge - 11 - up, tip = edge - 23 - up;
    o += `<rect x="${f1(fx)}" y="${f1(j)}" width="${f1(fw)}" height="${f1(kn - j)}" rx="2.5" fill="#FFFFFF" ${ln}/>`;          // the first segment
    o += `<rect x="${f1(fx + 0.5)}" y="${f1(tip)}" width="${f1(fw - 1)}" height="${f1(j - tip + 2)}" rx="${f1(fw / 2 - 0.5)}" fill="#FFFFFF" ${ln}/>`;   // the tip
    o += `<rect x="${f1(fx + fw * 0.62)}" y="${f1(tip + 4)}" width="${f1(fw * 0.26)}" height="${f1(kn - tip - 6)}" rx="1.5" fill="${SH}"/>`;   // shade
    o += `<circle cx="${f1(fx + fw / 2)}" cy="${f1(j + 1)}" r="2.1" fill="${INK}"/>`;                                          // the joint
  }
  return `<g>${o}</g>`;
}
const handsBody = GL.map((g) => hand(g.cx, g.half)).join("");

// ---------------------------------------------------------------- write
const svg = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N}" height="${N}"><defs>${defs}</defs>${body}</svg>`;
const files = {
  "head.svg": svg(headBody, lensDefs), "bar.svg": svg(barBody), "hands.svg": svg(handsBody), "blink.svg": svg(blinkBody, lensDefs),
  "splash.svg": svg(feelersAtRest + headBody + barBody + handsBody, lensDefs),
};
for (const [k, v] of Object.entries(feelerSvgs)) files[k] = svg(v);
for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(OUT, k), v);
const r2 = (p) => p.map((v) => +v.toFixed(2));
const art = {
  roots: { L: r2(geo.L.root), R: r2(geo.R.root) }, joints: { L: r2(geo.L.joint), R: r2(geo.R.joint) },
  L1: { L: +geo.L.L1.toFixed(2), R: +geo.R.L1.toFixed(2) }, L2: { L: +geo.L.L2.toFixed(2), R: +geo.R.L2.toFixed(2) },
  rest: { L: { a1: +geo.L.a1.toFixed(3), a2: +geo.L.a2.toFixed(3) }, R: { a1: +geo.R.a1.toFixed(3), a2: +geo.R.a2.toFixed(3) } },
  phys: PHYS,
};
if (APP) {
  fs.writeFileSync(path.join(APP, "src/launch/feelerArt.ts"), `/**
 * GENERATED by tools/media/brand/blip-icon/launch/gen.mjs: do not edit; change the generator and run it again.
 * Blip's feelers in the launch art (assets/launch/feeler*.png): the icon's feelers, hung from the top of his upside-down
 * head, each cut in two and drawn at rest. Per side: the pivots (root, and the cut between the pieces: art px in the
 * 544 frame), each piece's chord length (art px), each chord's angle at rest (degrees, as a CSS turn of "straight down",
 * in the art's frame), and the physics (points, seconds). The app turns each piece by how far it is from rest.
 */
export const FEELER_ART = ${JSON.stringify(art, null, 2)} as const;
`);
}
console.log(Object.keys(files).join(" "), dots.length, "dots; rest", JSON.stringify(art.rest));
