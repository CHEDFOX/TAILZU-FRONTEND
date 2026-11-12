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

// ---------------------------------------------------------------- the feelers: where they grow, how they hang
// He hangs upside down, so the top of his head is at the BOTTOM of the picture, and his feelers hang down from there,
// splayed out (in the head's own frame, before the cock). They are part of the head: they go up behind the bar with it.
const ROOTS = { L: sup(Math.PI / 2 + 0.5, 12), R: sup(Math.PI / 2 - 0.5, 12) };
const L1 = { L: 54, R: 58 }, L2 = { L: 50, R: 54 };   // link lengths, art px
// Physics, in points and seconds (launchCore.ts reads these): gravity, each link's spring toward its rest angle (per
// s^2, as an angular frequency squared), and damping (per s). Angles are CSS rotations of a link drawn hanging down:
// +ve turns it toward the LEFT, so the left feeler rests at +ve angles and the right at -ve.
const PHYS = { g: 2600, k1: 110, k2: 70, c1: 3.2, c2: 3.6 };   // gravity does most of it: soft springs keep them splayed, light damping lets them swing   // springy enough to stand up against gravity, and wobble
const REST = { L: { a1: 50, a2: 6 }, R: { a1: -54, a2: -6 } };   // link 1 from straight down (180 = straight up); link 2 relative to link 1
// The rest pose under gravity (where the springs and gravity balance), by Newton: k (r - a) = (g / L) sin a, per link.
function settle(r, k, L) { let a = r; for (let i = 0; i < 40; i++) { const f = k * (r - a) - (PHYS.g / L) * Math.sin(a), df = -k - (PHYS.g / L) * Math.cos(a); a -= f / df; } return a; }
const EQ = {};
for (const s of ["L", "R"]) {
  // link 1 rests at REST + the head's cock (it grows from the cocked head; the app turns it inside the head's own frame,
  // which carries only the head's sway); link 2 rests relative to link 1. Gravity pulls both toward straight down.
  const a1 = settle(rad(REST[s].a1 + TILT), PHYS.k1, L1[s] * U), w1 = a1, a2w = settle(w1 + rad(REST[s].a2), PHYS.k2, L2[s] * U);
  EQ[s] = { a1: a1 * 180 / Math.PI, a2: (a2w - w1) * 180 / Math.PI };
}
// a link: a tapering tube hanging straight down from (x, y), round at both ends; the second link ends in a teardrop
function link(x, y, len, w0, w1, tip) {
  const NN = 40, pts = [];
  for (let i = 0; i <= NN; i++) { const t = i / NN, w = (w0 + (w1 - w0) * t) / 2; pts.push([x + w, y + len * t]); }
  const left = pts.map(([px, py]) => [2 * x - px, py]).reverse();
  let o = `<path d="${pts.concat(left).map((q, i) => (i ? "L" : "M") + f1(q[0]) + " " + f1(q[1])).join("")}Z" fill="${INK}"/>`;
  o += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(w0 / 2)}" fill="${INK}"/><circle cx="${f1(x)}" cy="${f1(y + len)}" r="${f1(w1 / 2)}" fill="${INK}"/>`;
  if (tip) o += `<ellipse cx="${f1(x)}" cy="${f1(y + len + tip * 0.75)}" rx="${f1(tip)}" ry="${f1(tip * 1.3)}" fill="${INK}"/>`;
  return o;
}
const root = { L: toArt(ROOTS.L), R: toArt(ROOTS.R) };
const feelerSvgs = {};
for (const s of ["L", "R"]) {
  const [x, y] = root[s];
  feelerSvgs[`feeler${s}1.svg`] = link(x, y, L1[s], 12, 7, 0);
  feelerSvgs[`feeler${s}2.svg`] = link(x, y + L1[s], L2[s], 7, 3.8, 8.5);
}
const feelersAtRest = ["L", "R"].map((s) => {
  const [x, y] = root[s], e = EQ[s];
  return `<g transform="rotate(${f1(e.a1)} ${f1(x)} ${f1(y)})">${feelerSvgs[`feeler${s}1.svg`]}<g transform="rotate(${f1(e.a2)} ${f1(x)} ${f1(y + L1[s])})">${feelerSvgs[`feeler${s}2.svg`]}</g></g>`;
}).join("");

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
const art = { roots: { L: root.L.map((v) => +v.toFixed(2)), R: root.R.map((v) => +v.toFixed(2)) }, L1, L2, rest: REST, tilt: TILT, phys: PHYS,
  eq: { L: { a1: +EQ.L.a1.toFixed(3), a2: +EQ.L.a2.toFixed(3) }, R: { a1: +EQ.R.a1.toFixed(3), a2: +EQ.R.a2.toFixed(3) } } };
if (APP) {
  fs.writeFileSync(path.join(APP, "src/launch/feelerArt.ts"), `/**
 * GENERATED by tools/media/brand/blip-icon/launch/gen.mjs: do not edit; change the generator and run it again.
 * Blip's feelers in the launch art (assets/launch/feeler*.png): each link's pivot (art px, the 544 frame), length (art
 * px), rest angle (degrees, a CSS rotation of the link drawn hanging down: link 1 from straight down, relative to the
 * head; link 2 relative to link 1), the head's cock in the art, the physics (points, seconds), and the rest pose under
 * gravity the splash is drawn in (eq), which the motion starts from.
 */
export const FEELER_ART = ${JSON.stringify(art, null, 2)} as const;
`);
}
console.log(Object.keys(files).join(" "), dots.length, "dots; rest", JSON.stringify(art.eq));
