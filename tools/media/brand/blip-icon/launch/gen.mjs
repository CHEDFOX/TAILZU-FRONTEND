// THE LAUNCH ART, Blip: the new icon's Blip (cool/gen.mjs, mono) for the splash and the launch motion, in ink on the
// splash's white. Same frame, same bar and the same glove places as before (app/src/launch/launchCore.ts: BAR, GLOVES),
// so the motion is unchanged; only the bot is new.   node gen.mjs [outDir]  ->  splash.svg head.svg bar.svg hands.svg blink.svg
//   head   his dotted head, peeking from behind the bar (the crown and his feelers are behind it), the shades, the dot ears
//   bar    the piece of bar, in ink
//   hands  two white mitts with an ink line, fingers over the bar's lower edge (each centred on its GLOVES place)
//   blink  the shades' glint, flashed over the head where the old bot blinked
// All 544 px square (4x the splash's 136 pt), drawn so they stack exactly. Render with ../kit/png.mjs at 544.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] || here;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const INK = "#0E0D0C", N = 544;
const BAR = { x0: 48, y0: 138, x1: 495, y1: 195 };
const GL = [{ cx: 159, half: 36 }, { cx: 385.5, half: 36.5 }];
const H = { x: 272, y: 284, rx: 150, ry: 122, n: 2.3 };   // small enough to clear the bar on the rise, with room for the feelers
const TILT = 6;   // degrees: his head cocked, curious, as the old bot's was
const inHead = (x, y, m = 0) => Math.abs(x / (H.rx - m)) ** H.n + Math.abs(y / (H.ry - m)) ** H.n < 1;
// the shades, in head coordinates (the icon's proportions)
const V = { x0: -104, x1: 104, y0: -34, y1: 15 };
const inVisor = (x, y, m = 0) => x > V.x0 - m && x < V.x1 + m && y > V.y0 - m && y < V.y1 + m + (1 - (x / V.x1) ** 2) * 13;
const visorPath = () => { const v = V; return `M${v.x0} ${v.y0 + 4}Q${v.x0} ${v.y0 - 3} ${v.x0 + 15} ${v.y0 - 2}H${v.x1 - 15}Q${v.x1} ${v.y0 - 3} ${v.x1} ${v.y0 + 4}V${v.y1 - 5}Q${v.x1 - 3} ${v.y1 + 17} ${v.x1 - 40} ${v.y1 + 20}Q0 ${v.y1 + 31} ${v.x0 + 40} ${v.y1 + 20}Q${v.x0 + 3} ${v.y1 + 17} ${v.x0} ${v.y1 - 5}Z`; };
// the dots: a hex grid centred on the head, sized by the dome's shade; on white the SHADED side has the bigger dots
const C = 12.6, row = C * 0.866, dots = [];
const Lv = [-0.32, -0.42, 0.85], Ln = Math.hypot(...Lv);
for (let j = -Math.ceil(H.ry / row); j <= Math.ceil(H.ry / row); j++) for (let i = -Math.ceil(H.rx / C) - 1; i <= Math.ceil(H.rx / C) + 1; i++) {
  const x = i * C + ((j & 1) ? C / 2 : 0), y = j * row, nx = x / H.rx, ny = y / H.ry, q = 1 - nx * nx - ny * ny; if (q <= 0) continue;
  const light = Math.max(0, (nx * Lv[0] + ny * Lv[1] + Math.sqrt(q) * Lv[2]) / Ln);
  const r = 1.9 + 3.5 * Math.pow(0.3 + 0.7 * (1 - light * 0.75), 1.1);
  if (!inHead(x, y, r + 3) || inVisor(x, y, 7 + r * 0.5) || r < 2) continue;
  dots.push([x, y, r]);
}
const dotPath = dots.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
const cub = (p0, p1, p2, p3, t) => { const u = 1 - t; return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]); };
const sup = (t) => { const c = Math.cos(t), sn = Math.sin(t), e = 2 / H.n; return [Math.sign(c) * Math.abs(c) ** e * (H.rx - 6), Math.sign(sn) * Math.abs(sn) ** e * (H.ry - 6)]; };
function feeler(pts, w0, w1, tipR) {
  const NN = 160, P = [], Nm = [];
  for (let i = 0; i <= NN; i++) P.push(cub(...pts, i / NN));
  for (let i = 0; i <= NN; i++) { const a = P[Math.max(0, i - 1)], c = P[Math.min(NN, i + 1)], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1; Nm.push([-dy / l, dx / l]); }
  const W = (i) => (w1 + (w0 - w1) * Math.pow(1 - i / NN, 2.2)) / 2;
  const sd = (g) => P.map((p, i) => [p[0] + Nm[i][0] * W(i) * g, p[1] + Nm[i][1] * W(i) * g]);
  let o = `<path d="${sd(1).concat(sd(-1).reverse()).map((q, i) => (i ? "L" : "M") + f1(q[0]) + " " + f1(q[1])).join("")}Z" fill="${INK}"/>`;
  o += `<circle cx="${f1(P[0][0])}" cy="${f1(P[0][1])}" r="${f1(W(0))}" fill="${INK}"/>`;
  const tip = P[NN], pv = P[NN - 8], ang = Math.atan2(tip[1] - pv[1], tip[0] - pv[0]), cx = tip[0] + Math.cos(ang) * tipR * 0.55, cy = tip[1] + Math.sin(ang) * tipR * 0.55;
  return o + `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(tipR * 1.3)}" ry="${f1(tipR)}" transform="rotate(${f1(ang * 180 / Math.PI)} ${f1(cx)} ${f1(cy)})" fill="${INK}"/>`;
}
// The feelers grow from the head's upper sides and splay out UNDER the bar: the launch clips everything above the bar's
// top edge (that is how he vanishes over it), so a feeler going straight up would never be seen.
const FL = sup(Math.PI + 0.3), FR = sup(-0.62);   // the left lower down the side: the tilt lifts that side toward the bar
const feelers = feeler([FL, [FL[0] - 26, FL[1] - 22], [FL[0] - 44, FL[1] + 10], [FL[0] - 70, FL[1] - 4]], 15, 4.5, 8)
  + feeler([FR, [FR[0] + 18, FR[1] - 34], [FR[0] + 84, FR[1] - 40], [FR[0] + 104, FR[1] - 12]], 16, 4.5, 8.5);
const nearFeeler = (x, y) => Math.hypot(x - FL[0], y - FL[1]) < 15 || Math.hypot(x - FR[0], y - FR[1]) < 15;
const ears = [-1, 1].map((s) => [-11, 2, 15].map((dy) => `<circle cx="${f1(s * (H.rx + 10))}" cy="${dy}" r="4.2" fill="${INK}"/>`).join("")).join("");
const svg = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N}" height="${N}"><defs>${defs}</defs>${body}</svg>`;
const lensDefs = `<linearGradient id="ll" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26262A"/><stop offset="0.55" stop-color="#0B0B0D"/><stop offset="1" stop-color="#000"/></linearGradient><clipPath id="lc"><path d="${visorPath()}"/></clipPath>`;
const glints = (o1, o2, dx = 0) => `<g clip-path="url(#lc)"><path d="M${-62 + dx} 60L${10 + dx} -80H${44 + dx}L${-28 + dx} 60Z" fill="#FFFFFF" opacity="${o1}"/><path d="M${-16 + dx} 60L${56 + dx} -80H${68 + dx}L${-4 + dx} 60Z" fill="#FFFFFF" opacity="${o2}"/></g>`;
const dotPath2 = dots.filter(([x, y]) => !nearFeeler(x, y)).map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
const headBody = `<g transform="translate(${H.x} ${H.y}) rotate(${TILT})">${feelers}<path d="${dotPath2}" fill="${INK}"/>${ears}<path d="${visorPath()}" fill="url(#ll)"/>${glints(0.2, 0.14)}</g>`;
const barBody = `<rect x="${BAR.x0}" y="${BAR.y0}" width="${BAR.x1 - BAR.x0}" height="${BAR.y1 - BAR.y0}" rx="14" fill="${INK}"/>`;
// a robot gripper: three square-tipped fingers hooked over the bar's lower edge, each with a joint; a squared palm with a
// bolt; a ribbed cuff at the wrist. White with an ink line, so it reads on the ink bar and the white ground.
const mitt = (cx, half) => {
  const w = half * 2 - 8, x0 = cx - w / 2, edge = BAR.y1, st = `fill="#FFFFFF" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round"`;
  const fw = w * 0.26, gap = (w - 3 * fw) / 2;
  let o = "";
  for (let k = 0; k < 3; k++) {
    const fx = x0 + k * (fw + gap), top = edge - 22 + (k === 1 ? -3 : 0);
    o += `<rect x="${f1(fx)}" y="${f1(top)}" width="${f1(fw)}" height="${f1(edge + 6 - top)}" rx="3.5" ${st}/>`;
    o += `<line x1="${f1(fx + 2)}" y1="${f1(top + 10)}" x2="${f1(fx + fw - 2)}" y2="${f1(top + 10)}" stroke="${INK}" stroke-width="2.4"/>`;   // the knuckle joint
  }
  const py = edge + 2, ph = 20;
  o += `<rect x="${f1(x0 - 2)}" y="${f1(py)}" width="${f1(w + 4)}" height="${ph}" rx="6" ${st}/>`;
  o += `<circle cx="${f1(cx)}" cy="${f1(py + ph / 2)}" r="3.4" fill="${INK}"/>`;   // the bolt
  o += `<rect x="${f1(cx - w * 0.3)}" y="${f1(py + ph - 1)}" width="${f1(w * 0.6)}" height="9" rx="2.5" ${st}/>`;   // the cuff
  o += `<line x1="${f1(cx - w * 0.3 + 3)}" y1="${f1(py + ph + 3.5)}" x2="${f1(cx + w * 0.3 - 3)}" y2="${f1(py + ph + 3.5)}" stroke="${INK}" stroke-width="1.8"/>`;
  return `<g>${o}</g>`;
};
const handsBody = GL.map((g) => mitt(g.cx, g.half)).join("");
const blinkBody = `<g transform="translate(${H.x} ${H.y}) rotate(${TILT})"><path d="${visorPath()}" fill="url(#ll)"/>${glints(0.85, 0.5, 70)}</g>`;
const files = {
  "head.svg": svg(headBody, lensDefs), "bar.svg": svg(barBody), "hands.svg": svg(handsBody), "blink.svg": svg(blinkBody, lensDefs),
  "splash.svg": svg(headBody + barBody + handsBody, lensDefs),
};
for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(OUT, k), v);
console.log(Object.keys(files).join(" "), dots.length, "dots");
