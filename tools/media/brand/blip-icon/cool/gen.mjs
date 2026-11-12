// The COOL Blip icon: Blip's own head (the super-ellipse dotted head with the ink sticker edge, the ears, the two
// antennae, the green light) in two cool takes.   node gen.mjs [outDir]  ->  shades.svg  look.svg
//   shades: a single wraparound visor across his one eye, a glint on it, a smirk; on the brand's clay.
//   mono:   the shades in white on black: no mouth, no outline; the dots alone draw him, and his antennae and ears
//           are dots too.
//   look:   his big eye half-lidded and glancing aside, one brow up, a smirk; on ink, with a green rim light.
// 1000 x 1000, full bleed, self-contained (no images, text or styles); every id carries a prefix unique to its file.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] || here;
const TAU = Math.PI * 2, f1 = (v) => (Math.round(v * 10) / 10).toString(), hyp = Math.hypot, clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const INK = "#0E0D0C", CREAM = "#F4EADB", CLAY = "#C9683F", LIGHT = "#5CF08A";

function build(kind) {
  const P = kind[0] + "c-", mono = kind === "mono", shades = kind === "shades" || mono;
  const FG = mono ? "#FFFFFF" : CREAM, LT = mono ? "#FFFFFF" : LIGHT, STALK = mono ? "#FFFFFF" : INK;
  const H = mono ? { x: 500, y: 600, rx: 344, ry: 310, n: 2.3 } : { x: 500, y: 590, rx: 318, ry: 286, n: 2.3 };   // a touch bigger than the refined head: the face is the icon
  const tilt = kind === "look" ? -0.06 : mono ? 0 : 0.035;
  const hasMouth = !mono;
  const head = (t, off = 0) => {
    const c = Math.cos(t), s = Math.sin(t), e = 2 / H.n;
    const x = Math.sign(c) * Math.abs(c) ** e * (H.rx + off), y = Math.sign(s) * Math.abs(s) ** e * (H.ry + off);
    return [x, y];
  };
  const headPath = (off = 0) => Array.from({ length: 240 }, (_, i) => { const p = head((i / 240) * TAU, off); return (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1]); }).join("") + "Z";
  const inHead = (x, y, m = 0) => Math.abs(x / (H.rx - m)) ** H.n + Math.abs(y / (H.ry - m)) ** H.n < 1;
  // features, in head-local coordinates (origin at the head's centre, before the tilt)
  const eye = kind === "look" ? { x: -6, y: -14, r: 152 } : null;
  const visor = shades ? { x0: -232, x1: 232, y0: -108, y1: 22 } : null;
  const inVisor = (x, y, m = 0) => visor && x > visor.x0 - m && x < visor.x1 + m && y > visor.y0 - m + Math.abs(x) * 0.12 * 0 && y < visor.y1 + m + (1 - (x / visor.x1) ** 2) * 26;
  const mouth = kind === "look" ? [[60, 172], [118, 190], [168, 160]] : [[40, 168], [104, 186], [160, 150]];
  const nearMouth = (x, y, m) => { for (let i = 1; i < mouth.length; i++) { const a = mouth[i - 1], b = mouth[i], vx = b[0] - a[0], vy = b[1] - a[1]; const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)); if (hyp(x - a[0] - vx * t, y - a[1] - vy * t) < m) return true; } return false; };
  const nearBrow = (x, y, m) => kind === "look" && hyp(x - 30, y + 186) < 150 && Math.abs(hyp(x - 30, y + 30) - 190) < m && y < -120;
  // the dots: whole dots on a square grid, sized by a soft light from the top left; dropped (never clipped) near the edge or a feature
  const C = 27, dots = [];
  if (mono) {
    const Lv = [-0.32, -0.42, 0.85], Ln = Math.hypot(...Lv), Lx = Lv[0] / Ln, Ly = Lv[1] / Ln, Lz = Lv[2] / Ln;
    const row = C * 0.866;
    for (let j = -Math.ceil(H.ry / row); j <= Math.ceil(H.ry / row); j++) for (let i = -Math.ceil(H.rx / C) - 1; i <= Math.ceil(H.rx / C) + 1; i++) {
      const x = i * C + ((j & 1) ? C / 2 : 0), y = j * row;
      const nx = x / H.rx, ny = y / H.ry, q = 1 - nx * nx - ny * ny; if (q <= 0) continue;
      const nz = Math.sqrt(q), shade = 0.3 + 0.7 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);   // a soft fill so the far side holds
      const r = 3.6 + 7.0 * Math.pow(shade, 1.1);
      if (!inHead(x, y, r + 6)) continue;
      if (inVisor(x, y, 14 + r * 0.5)) continue;
      if (r < 3.8) continue;
      dots.push([x, y, r]);
    }
  }
  for (let gy = mono ? 1e9 : -H.ry; gy <= H.ry; gy += C) for (let gx = -H.rx; gx <= H.rx; gx += C) {
    const x = gx + ((Math.round(gy / C) & 1) ? C / 2 : 0), y = gy;
    if (!inHead(x, y, mono ? 16 : 30)) continue;
    if (eye && hyp(x - eye.x, y - eye.y) < eye.r + 26) continue;
    if (inVisor(x, y, 18)) continue;
    if (hasMouth && nearMouth(x, y, 26)) continue;
    if (nearBrow(x, y, 24)) continue;
    const light = clamp(1 - (hyp(x + 170, y + 190) / 640));
    dots.push([x, y, 6.2 + 5.2 * light]);
  }
  const dotPath = dots.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join("");
  const mouthPath = `M${mouth[0][0]} ${mouth[0][1]}Q${mouth[1][0]} ${mouth[1][1] + 8} ${mouth[2][0]} ${mouth[2][1]}`;
  // the antennae: the left short with a ball, the right bent with the light
  const ant = (side) => {
    const a0 = head(side < 0 ? -2.05 : -1.12, -10), up = side < 0 ? [a0[0] - 34, a0[1] - 118] : [a0[0] + 60, a0[1] - 112], tip = side < 0 ? [up[0] - 8, up[1] - 14] : [up[0] + 72, up[1] - 18];
    return { d: side < 0 ? `M${f1(a0[0])} ${f1(a0[1])}L${f1(up[0])} ${f1(up[1])}` : `M${f1(a0[0])} ${f1(a0[1])}Q${f1(up[0])} ${f1(up[1] + 30)} ${f1(up[0] + 8)} ${f1(up[1])}L${f1(tip[0])} ${f1(tip[1])}`, tip: side < 0 ? up : tip };
  };
  const L = ant(-1), R = ant(1);
  const ear = (side) => { const x = side * (H.rx + 18), w = 52, h = 120; return `<rect x="${f1(x - w / 2)}" y="${f1(-h / 2 + 10)}" width="${w}" height="${h}" rx="22" fill="${INK}"${mono ? ` stroke="#FFFFFF" stroke-width="9"` : ""}/>` + [ -36, -6, 24, 54].map((dy) => `<circle cx="${f1(x)}" cy="${f1(dy - 10)}" r="8" fill="${FG}" opacity="0.92"/>`).join(""); };
  let ground, rim = "", edge;
  if (mono) {
    ground = `<radialGradient id="${P}g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#1A1A1A"/><stop offset="1" stop-color="#000000"/></radialGradient><rect width="1000" height="1000" fill="url(#${P}g)"/>`;
    edge = "";   // no outline: the dots alone draw him
  } else if (kind === "shades") {
    ground = `<radialGradient id="${P}g" cx="0.42" cy="0.36" r="0.8"><stop offset="0" stop-color="#DE7D52"/><stop offset="0.7" stop-color="${CLAY}"/><stop offset="1" stop-color="#9E4F31"/></radialGradient><rect width="1000" height="1000" fill="url(#${P}g)"/>`;
    edge = `<path d="${headPath(34)}" fill="${CREAM}"/>`;   // the die-cut paper edge, so the ink head lifts off the clay
  } else {
    ground = `<radialGradient id="${P}g" cx="0.5" cy="0.42" r="0.78"><stop offset="0" stop-color="#26241F"/><stop offset="1" stop-color="#0A0908"/></radialGradient><rect width="1000" height="1000" fill="url(#${P}g)"/>`;
    edge = "";
    rim = `<path d="${headPath(10)}" fill="none" stroke="${LIGHT}" stroke-opacity="0.55" stroke-width="7" stroke-dasharray="560 2000" stroke-dashoffset="-1180" filter="url(#${P}blur)"/>`;
  }
  const glow = (p) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="70" fill="url(#${P}glow)"/><circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="27" fill="${LT}"/><circle cx="${f1(p[0] - 8)}" cy="${f1(p[1] - 9)}" r="8" fill="#FFFFFF" opacity="0.85"/>`;
  function monoParts() {
    // the antennae: thin solid white stems with a gentle curve, from the crown; the left short with a small ball, the
    // right longer, sweeping out, with a glowing orb. The ears: three tight dots each, close to the head.
    let out = "";
    // the left: short, straight, a slight lean, a solid ball. The right: long, up, then a sharp elbow out to the side and
    // a small open ring for a tip (Blip's bent antenna, made odd enough to know him by at a glance). No glow.
    const L0 = head(-2.0, -8), Lt = [L0[0] - 30, L0[1] - 112];
    out += `<path d="M${f1(L0[0])} ${f1(L0[1])}L${f1(Lt[0])} ${f1(Lt[1])}" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>`;
    out += `<circle cx="${f1(Lt[0])}" cy="${f1(Lt[1])}" r="17" fill="#FFFFFF"/>`;
    const R0 = head(-1.14, -8), elbow = [R0[0] + 22, R0[1] - 150], R1 = [elbow[0] + 92, elbow[1] - 22], ringR = 17;
    const dx = R1[0] - elbow[0], dy = R1[1] - elbow[1], dl = Math.hypot(dx, dy), end = [R1[0] - dx / dl * ringR, R1[1] - dy / dl * ringR];
    out += `<path d="M${f1(R0[0])} ${f1(R0[1])}Q${f1(R0[0] + 2)} ${f1(R0[1] - 90)} ${f1(elbow[0])} ${f1(elbow[1])}L${f1(end[0])} ${f1(end[1])}" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
    out += `<circle cx="${f1(R1[0])}" cy="${f1(R1[1])}" r="${ringR}" fill="none" stroke="#FFFFFF" stroke-width="10"/>`;
    for (const side of [-1, 1]) for (const dy of [-22, 4, 30]) out += `<circle cx="${f1(side * (H.rx + 20))}" cy="${f1(dy - 6)}" r="8" fill="#FFFFFF" opacity="${side < 0 ? 0.95 : 0.8}"/>`;
    return out;
  }
  let face = "";
  if (eye) {
    face += `<circle cx="${eye.x}" cy="${eye.y}" r="${eye.r}" fill="${INK}"/><circle cx="${eye.x}" cy="${eye.y}" r="${eye.r - 20}" fill="#FBF7F0"/>`;
    face += `<circle cx="${eye.x + 52}" cy="${eye.y + 14}" r="60" fill="${INK}"/><circle cx="${eye.x + 36}" cy="${eye.y - 4}" r="15" fill="#FFFFFF"/>`;   // the pupil, glancing right
    // the lid: down over the top 45 %, a flat confident line, ink edge
    face += `<clipPath id="${P}eye"><circle cx="${eye.x}" cy="${eye.y}" r="${eye.r - 20}"/></clipPath><g clip-path="url(#${P}eye)"><path d="M${eye.x - 160} ${eye.y - 160}H${eye.x + 160}V${eye.y - 22}Q${eye.x} ${eye.y - 4} ${eye.x - 160} ${eye.y - 30}Z" fill="#CFC3B1"/><path d="M${eye.x - 160} ${eye.y - 30}Q${eye.x} ${eye.y - 4} ${eye.x + 160} ${eye.y - 22}" fill="none" stroke="${INK}" stroke-width="16"/></g>`;
    face += `<path d="M${eye.x - 96} ${eye.y - 196}Q${eye.x + 30} ${eye.y - 244} ${eye.x + 136} ${eye.y - 186}" fill="none" stroke="${CREAM}" stroke-width="26" stroke-linecap="round"/>`;   // the brow, up on one side
  }
  if (visor) {
    const v = visor, d = `M${v.x0} ${v.y0 + 6}Q${v.x0} ${v.y0 - 6} ${v.x0 + 30} ${v.y0 - 4}H${v.x1 - 30}Q${v.x1} ${v.y0 - 6} ${v.x1} ${v.y0 + 6}V${v.y1 - 10}Q${v.x1 - 6} ${v.y1 + 34} ${v.x1 - 80} ${v.y1 + 40}Q0 ${v.y1 + 62} ${v.x0 + 80} ${v.y1 + 40}Q${v.x0 + 6} ${v.y1 + 34} ${v.x0} ${v.y1 - 10}Z`;
    face += mono ? `<linearGradient id="${P}vis" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141416"/><stop offset="1" stop-color="#000000"/></linearGradient>` : `<linearGradient id="${P}vis" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A30"/><stop offset="0.55" stop-color="#0B0B0D"/><stop offset="1" stop-color="#000000"/></linearGradient>`;
    face += (mono ? `<path d="${d}" fill="url(#${P}vis)"/>` : `<path d="${d}" fill="url(#${P}vis)" stroke="${INK}" stroke-width="14"/>`);
    face += `<clipPath id="${P}vc"><path d="${d}"/></clipPath><g clip-path="url(#${P}vc)" opacity="0.9"><path d="M-120 120L20 -160H90L-50 120Z" fill="#FFFFFF" opacity="0.22"/><path d="M-30 120L110 -160H136L-4 120Z" fill="#FFFFFF" opacity="0.16"/>${mono ? "" : `<path d="M${v.x0} ${v.y0 + 18}H${v.x1}" stroke="${LT}" stroke-opacity="0.35" stroke-width="5"/>`}</g>`;
    if (!mono) face += `<path d="M${v.x0 + 40} ${v.y0 + 14}H${v.x1 - 40}" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="6" stroke-linecap="round"/>`;
  }
  if (hasMouth) face += `<path d="${mouthPath}" fill="none" stroke="${CREAM}" stroke-width="22" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<defs><radialGradient id="${P}glow"><stop offset="0" stop-color="${LT}" stop-opacity="${mono ? 0.55 : 0.75}"/><stop offset="1" stop-color="${LT}" stop-opacity="0"/></radialGradient><filter id="${P}blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter><filter id="${P}shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000" flood-opacity="0.35"/></filter></defs>
${ground}
<g transform="translate(${H.x} ${H.y}) rotate(${f1(tilt * 180 / Math.PI)})">
${mono ? monoParts() : `<g filter="url(#${P}shadow)">${edge}
<path d="${L.d}" fill="none" stroke="${STALK}" stroke-width="22" stroke-linecap="round"/><path d="${R.d}" fill="none" stroke="${STALK}" stroke-width="22" stroke-linecap="round"/>
${ear(-1)}${ear(1)}
<path d="${headPath(0)}" fill="${INK}"/></g>`}
<path d="${dotPath}" fill="${FG}"/>
${face}
${rim}
${mono ? "" : `<circle cx="${f1(L.tip[0])}" cy="${f1(L.tip[1])}" r="24" fill="${STALK}"/><circle cx="${f1(L.tip[0] - 6)}" cy="${f1(L.tip[1] - 7)}" r="7" fill="${CREAM}" opacity="0.7"/>
${glow(R.tip)}`}
</g></svg>`;
  fs.writeFileSync(path.join(OUT, `${kind}.svg`), svg);
  return svg.length;
}
for (const k of ["shades", "look", "mono"]) console.log(k, build(k), "bytes");
