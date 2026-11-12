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
const H = { x: 272, y: 300, rx: 168, ry: 146, n: 2.3 };
const inHead = (x, y, m = 0) => Math.abs(x / (H.rx - m)) ** H.n + Math.abs(y / (H.ry - m)) ** H.n < 1;
// the shades, in head coordinates (the icon's proportions)
const V = { x0: -116, x1: 116, y0: -40, y1: 18 };
const inVisor = (x, y, m = 0) => x > V.x0 - m && x < V.x1 + m && y > V.y0 - m && y < V.y1 + m + (1 - (x / V.x1) ** 2) * 13;
const visorPath = () => { const v = V; return `M${v.x0} ${v.y0 + 4}Q${v.x0} ${v.y0 - 3} ${v.x0 + 15} ${v.y0 - 2}H${v.x1 - 15}Q${v.x1} ${v.y0 - 3} ${v.x1} ${v.y0 + 4}V${v.y1 - 5}Q${v.x1 - 3} ${v.y1 + 17} ${v.x1 - 40} ${v.y1 + 20}Q0 ${v.y1 + 31} ${v.x0 + 40} ${v.y1 + 20}Q${v.x0 + 3} ${v.y1 + 17} ${v.x0} ${v.y1 - 5}Z`; };
// the dots: a hex grid centred on the head, sized by the dome's shade; on white the SHADED side has the bigger dots
const C = 13.6, row = C * 0.866, dots = [];
const Lv = [-0.32, -0.42, 0.85], Ln = Math.hypot(...Lv);
for (let j = -Math.ceil(H.ry / row); j <= Math.ceil(H.ry / row); j++) for (let i = -Math.ceil(H.rx / C) - 1; i <= Math.ceil(H.rx / C) + 1; i++) {
  const x = i * C + ((j & 1) ? C / 2 : 0), y = j * row, nx = x / H.rx, ny = y / H.ry, q = 1 - nx * nx - ny * ny; if (q <= 0) continue;
  const light = Math.max(0, (nx * Lv[0] + ny * Lv[1] + Math.sqrt(q) * Lv[2]) / Ln);
  const r = 1.9 + 3.5 * Math.pow(0.3 + 0.7 * (1 - light * 0.75), 1.1);
  if (!inHead(x, y, r + 3) || inVisor(x, y, 7 + r * 0.5) || r < 2) continue;
  dots.push([x, y, r]);
}
const dotPath = dots.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
const ears = [-1, 1].map((s) => [-11, 2, 15].map((dy) => `<circle cx="${f1(s * (H.rx + 10))}" cy="${dy}" r="4.2" fill="${INK}"/>`).join("")).join("");
const svg = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N}" height="${N}"><defs>${defs}</defs>${body}</svg>`;
const lensDefs = `<linearGradient id="ll" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26262A"/><stop offset="0.55" stop-color="#0B0B0D"/><stop offset="1" stop-color="#000"/></linearGradient><clipPath id="lc"><path d="${visorPath()}"/></clipPath>`;
const glints = (o1, o2, dx = 0) => `<g clip-path="url(#lc)"><path d="M${-62 + dx} 60L${10 + dx} -80H${44 + dx}L${-28 + dx} 60Z" fill="#FFFFFF" opacity="${o1}"/><path d="M${-16 + dx} 60L${56 + dx} -80H${68 + dx}L${-4 + dx} 60Z" fill="#FFFFFF" opacity="${o2}"/></g>`;
const headBody = `<g transform="translate(${H.x} ${H.y})"><path d="${dotPath}" fill="${INK}"/>${ears}<path d="${visorPath()}" fill="url(#ll)"/>${glints(0.2, 0.14)}</g>`;
const barBody = `<rect x="${BAR.x0}" y="${BAR.y0}" width="${BAR.x1 - BAR.x0}" height="${BAR.y1 - BAR.y0}" rx="14" fill="${INK}"/>`;
// a mitt: palm below the bar's lower edge, three fingers curled up over it
const mitt = (cx, half) => {
  const w = half * 2 - 6, x0 = cx - w / 2, top = BAR.y1 - 22, bot = BAR.y1 + 26;
  const fingers = [-1, 0, 1].map((k) => `<ellipse cx="${f1(cx + k * w * 0.29)}" cy="${f1(top + 8)}" rx="${f1(w * 0.15)}" ry="11" fill="#FFFFFF" stroke="${INK}" stroke-width="4"/>`).join("");
  return `<g>${fingers}<rect x="${f1(x0)}" y="${f1(top + 10)}" width="${f1(w)}" height="${f1(bot - top - 10)}" rx="${f1(w * 0.42)}" fill="#FFFFFF" stroke="${INK}" stroke-width="4"/>${[-1, 0, 1].map((k) => `<ellipse cx="${f1(cx + k * w * 0.29)}" cy="${f1(top + 12)}" rx="${f1(w * 0.15 - 2)}" ry="8" fill="#FFFFFF"/>`).join("")}</g>`;
};
const handsBody = GL.map((g) => mitt(g.cx, g.half)).join("");
const blinkBody = `<g transform="translate(${H.x} ${H.y})"><path d="${visorPath()}" fill="url(#ll)"/>${glints(0.85, 0.5, 70)}</g>`;
const files = {
  "head.svg": svg(headBody, lensDefs), "bar.svg": svg(barBody), "hands.svg": svg(handsBody), "blink.svg": svg(blinkBody, lensDefs),
  "splash.svg": svg(headBody + barBody + handsBody, lensDefs),
};
for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(OUT, k), v);
console.log(Object.keys(files).join(" "), dots.length, "dots");
