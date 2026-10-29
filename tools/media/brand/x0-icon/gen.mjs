// X0 Bot app icon concepts: six directions, each drawn from scratch as paths (no fonts, no images).
//
//   node gen.mjs              writes <concept>/icon.svg for every concept
//   node gen.mjs --proto DIR  writes the concepts plus the VARIANTS below to DIR, for trying changes
//   node build.mjs            also exports the PNGs and the comparison/context sheets (see build.mjs)
//
// Every SVG is a full-bleed 1000 x 1000 square (the OS adds its corner mask) and every id in a file starts with that
// concept's own prefix, so the files can be inlined side by side.
import fs from "node:fs";
import path from "node:path";
import { P, ring, circle, circles, capsule, diag, rrect, squircle, curveBand, svg } from "./lib.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);

// Palette. TERRA is the brand clay lifted for screens: #A9573A sinks to brown when it is a mark on ink, so marks on dark
// use TERRA; the clay ground keeps a #B8613F to #9C4C31 gradient around the brand clay.
export const INK = "#0a0a0a", CREAM = "#F3E2C6", PAPER = "#F4F1EA", CLAY = "#A9573A", TERRA = "#C8643F", AMBER = "#E8A23C";

const lin = (id, stops) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
const rect = (fill) => `<rect width="1000" height="1000" fill="${fill}"/>`;
const ground = (p, g) => (Array.isArray(g) ? { fill: `url(#${p}g)`, defs: lin(`${p}g`, g) } : { fill: g, defs: "" });
const xStrokes = (cx, cy, sx, sy, r) => capsule([cx - sx, cy - sy], [cx + sx, cy + sy], r) + capsule([cx + sx, cy - sy], [cx - sx, cy + sy], r);

// ---------------------------------------------------------------- 1. wink: the name is the face
// x is a winking eye, 0 an open one, and a smile under them. One stroke weight for all three.
function wink(o = {}) {
  const p = o.p || "xw-", G = ground(p, o.ground || [[0, "#B8613F"], [1, "#9C4C31"]]), ink = o.ink || CREAM;
  const r = o.r ?? 42, ey = o.ey ?? 420;
  const X = xStrokes(o.xc ?? 330, ey, o.s ?? 92, o.s ?? 92, r);
  const O = ring(o.oc ?? 662, ey, o.oa ?? 124, o.ob ?? 160, 2 * r, 2.2);
  const [a, c, b] = o.smile || [[352, 650], [508, 788], [664, 650]];
  const S = curveBand(a, c, b, r);
  return svg(`${rect(G.fill)}<path d="${X}${S}" fill="${ink}"/><path d="${O}" fill="${ink}" fill-rule="evenodd"/>`, G.defs);
}

// ---------------------------------------------------------------- 2. power: x⁰
// A typographic X with the 0 raised into its upper-right corner, biting into the X's tip (the X is cut by the 0 grown
// by g, through a mask, so there are no clip seams). x to the power zero is one: one bot for everything.
function power(o = {}) {
  const p = o.p || "xp-", g = o.g ?? 26, gnd = o.gnd || INK, xcol = o.xcol || CREAM, ocol = o.ocol || TERRA;
  const [xcx, xcy] = o.xc || [378, 600], hw = o.hw ?? 160, hh = o.hh ?? 180, w = o.w ?? 116;
  const T = xcy - hh, B = xcy + hh, L = xcx - hw, R = xcx + hw;
  const X = diag(L + w / 2, T, R - w / 2, B, w) + diag(R - w / 2, T, L + w / 2, B, w);
  const [oc, oy] = o.oc || [612, 410];
  const O = ring(oc, oy, o.oa ?? 160, o.ob ?? 188, o.t ?? 90, 2.4);
  const ev = ` fill-rule="evenodd"`;
  return svg(
    `${rect(gnd)}<path d="${X}" fill="${xcol}" mask="url(#${p}m)"/><path d="${O}" fill="${ocol}"${ev}/>`,
    `<mask id="${p}m" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000"><rect width="1000" height="1000" fill="#fff"/><path d="${O}" fill="#000" stroke="#000" stroke-width="${2 * g}" stroke-linejoin="round"${ev}/></mask>`,
  );
}

// ---------------------------------------------------------------- 3. caret: say it, it's typed
// The name as set type, with the text cursor still standing after it: the keyboard has just written it for you.
function caret(o = {}) {
  const p = o.p || "xc-", gnd = o.gnd || PAPER, ink = o.ink || INK, acc = o.acc || CLAY;
  const T = o.T ?? 330, B = o.B ?? 670, w = o.w ?? 104, L = o.L ?? 150, R = o.R ?? 440;
  const X = diag(L + w / 2, T, R - w / 2, B, w) + diag(R - w / 2, T, L + w / 2, B, w);
  const O = ring(o.oc ?? 618, 500, o.oa ?? 140, (B - T) / 2, o.t ?? 92, 2.6);
  const cx = o.cx ?? 838, ch = o.ch ?? 230, cw = o.cw ?? 30;
  const C = rrect(cx - cw, 500 - ch, 2 * cw, 2 * ch, 6);
  return svg(`${rect(gnd)}<path d="${X}" fill="${ink}"/><path d="${O}" fill="${ink}" fill-rule="evenodd"/><path d="${C}" fill="${acc}"/>`);
}

// ---------------------------------------------------------------- 3. listen: the 0 is the mic ring
// X0 as set type, and the 0's counter holds a voice: you talk, the 0 listens, X0 writes.
function listen(o = {}) {
  const p = o.p || "xl-", gnd = o.gnd || INK, ink = o.ink || CREAM, ocol = o.ocol || AMBER, bar = o.bar || CREAM;
  const T = o.T ?? 306, B = o.B ?? 694, w = o.w ?? 116, L = o.L ?? 128, R = o.R ?? 450;
  const X = diag(L + w / 2, T, R - w / 2, B, w) + diag(R - w / 2, T, L + w / 2, B, w);
  const oc = o.oc ?? 676, O = ring(oc, 500, o.oa ?? 196, (B - T) / 2, o.t ?? 84, 2.4);
  const bars = (o.bars || [[-64, 80], [0, 168], [64, 112]]).map(([dx, h]) => capsule([oc + dx, 500 - h / 2], [oc + dx, 500 + h / 2], o.br ?? 22)).join("");
  return svg(`${rect(gnd)}<path d="${X}" fill="${ink}"/><path d="${O}" fill="${ocol}" fill-rule="evenodd"/><path d="${bars}" fill="${bar}"/>`);
}

// ---------------------------------------------------------------- 4. butler: two shapes, one helper
// The 0 is the head and the X is a bow tie (an X closed at its outer ends, with a V cut in each). At your service.
function butler(o = {}) {
  const p = o.p || "xb-", gnd = o.gnd || CREAM, head = o.head || INK, tie = o.tie || "#B4532F";
  const H = ring(500, o.hy ?? 400, o.ha ?? 168, o.hb ?? 205, o.t ?? 92, 2.3);
  const ty = o.ty ?? 720, tw = o.tw ?? 175, th = o.th ?? 92, k = o.k ?? 36, nd = o.notch ?? 52;
  const T = P([[500 - tw, ty - th], [500 - k, ty - k * 0.55], [500 + k, ty - k * 0.55], [500 + tw, ty - th], [500 + tw - nd, ty],
    [500 + tw, ty + th], [500 + k, ty + k * 0.55], [500 - k, ty + k * 0.55], [500 - tw, ty + th], [500 - tw + nd, ty]]);
  const tilt = o.tilt ?? -6;
  return svg(`${rect(gnd)}<path d="${H}" fill="${head}" fill-rule="evenodd"/>` +
    `<path d="${T}" fill="${tie}" stroke="${tie}" stroke-width="34" stroke-linejoin="round"${tilt ? ` transform="rotate(${tilt} 500 ${ty})"` : ""}/>`);
}

// ---------------------------------------------------------------- 5. board: X0 in living dots
// X0 on a 5 x 7 dot board, amber like an Indian station display, unlit dots just visible. One dot of the 0 has hopped
// out (cream, with a short trail): the dots are alive, like the app's bots.
const GLYPHS = {
  "5x7": { X: ["1...1", "1...1", ".1.1.", "..1..", ".1.1.", "1...1", "1...1"], O: [".111.", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."] },
  "5x5": { X: ["1...1", ".1.1.", "..1..", ".1.1.", "1...1"], O: [".111.", "1...1", "1...1", "1...1", ".111."] },
  "4x6": { X: ["1..1", "1..1", ".11.", ".11.", "1..1", "1..1"], O: [".11.", "1..1", "1..1", "1..1", "1..1", ".11."] },
};
function board(o = {}) {
  const p = o.p || "xd-", gnd = o.gnd || INK, dot = o.dot || "#F2A93B", acc = o.acc || CREAM, dim = o.dim || "#15130f";
  const GLYPH = GLYPHS[o.font || "5x7"], gw = GLYPH.X[0].length, rows = GLYPH.X.length, cols = 2 * gw + 1;
  const cell = o.cell ?? 72, rr = (o.dr ?? 0.47) * cell;
  const x0 = 500 - ((cols - 1) * cell) / 2, y0 = 500 - ((rows - 1) * cell) / 2;
  const on = [], off = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const ch = i < gw ? GLYPH.X[j][i] : i === gw ? "." : GLYPH.O[j][i - gw - 1];
    (ch === "1" ? on : off).push([x0 + i * cell, y0 + j * cell, ch === "1" ? rr : rr * 0.62]);
  }
  const [hi, hj, dx, dy] = o.hop || [9, 0, 46, -118];
  const k = on.findIndex(([x, y]) => Math.abs(x - (x0 + hi * cell)) < 1 && Math.abs(y - (y0 + hj * cell)) < 1);
  const [hx, hy] = on[k];
  on.splice(k, 1);
  off.push([hx, hy, rr * 0.62]);
  const hop = circle(hx + dx, hy + dy, rr);
  const trail = [[0.33, 0.55], [0.66, 0.78]].map(([q, s]) => circle(hx + dx * q, hy + dy * q * (2 - q), rr * (0.1 + 0.32 * s))).join("");
  return svg(`${rect(gnd)}${o.grid === false ? "" : `<path d="${circles(off.filter(([x, y]) => x > 60 && x < 940 && y > 60 && y < 940))}" fill="${dim}"/>`}` +
    `<path d="${circles(on)}" fill="${dot}"/><path d="${trail}" fill="${acc}" opacity="0.45"/><path d="${hop}" fill="${acc}"/>`);
}

// ---------------------------------------------------------------- 6. key: the voice keyboard's one key
// A soft cream keycap (skirt, dished top, a blurred shadow) on amber, with x0 as its legend.
function key(o = {}) {
  const p = o.p || "xk-", G = ground(p, o.ground || [[0, "#F0AE48"], [1, "#DD962C"]]);
  const kcy = 512, kw = 300, kh = 318, lift = 66, yc = kcy - lift * 0.62;
  const skirt = squircle(500, kcy, kw, kh, 4.4), top = squircle(500, yc, kw - 46, kh - lift - 18, 4.4);
  const r = 30, s = 62;
  const mark = xStrokes(396, yc, s, s * 1.2, r) + ring(606, yc, 88, 106, 2 * r, 2.3);
  const defs = G.defs + lin(`${p}sk`, [[0, "#F1E4CB"], [0.55, "#DCC6A1"], [1, "#B99D76"]]) + lin(`${p}tp`, [[0, "#FFFBF2"], [1, "#F0E3CB"]]) +
    `<radialGradient id="${p}dish" cx="0.5" cy="0.4" r="0.62"><stop offset="0.5" stop-color="#7a5a35" stop-opacity="0"/><stop offset="1" stop-color="#7a5a35" stop-opacity="0.18"/></radialGradient>` +
    `<filter id="${p}sh" x="-0.3" y="-0.3" width="1.6" height="1.6"><feGaussianBlur stdDeviation="30"/></filter>`;
  const k = o.scale ?? 1.07;
  return svg(
    `${rect(G.fill)}<g transform="translate(500 ${kcy}) scale(${k}) translate(-500 -${kcy})"><path d="${squircle(500, kcy + 40, kw - 6, kh - 14, 4.4)}" fill="${o.shadow || "#5a3206"}" opacity="${o.shOp ?? 0.45}" filter="url(#${p}sh)"/>` +
      `<path d="${skirt}" fill="url(#${p}sk)"/><path d="${top}" fill="url(#${p}tp)"/><path d="${top}" fill="url(#${p}dish)"/>` +
      `<path d="${mark}" fill="${INK}" fill-rule="evenodd"/></g>`,
    defs,
  );
}

// ---------------------------------------------------------------- the six, in order
export const CONCEPTS = [
  { id: "wink", name: "Wink", idea: "The name is the face: x winks, 0 looks at you, and it smiles.", draw: wink },
  { id: "power", name: "x⁰", idea: "A bold monogram: the 0 rides up and bites into the X. x to the power zero is one: one bot for everything.", draw: power },
  { id: "listen", name: "Listen", idea: "The 0 is the mic ring: a voice stands in its counter. You talk, the 0 listens, X0 writes.", draw: listen },
  { id: "butler", name: "Butler", idea: "Two shapes, one helper: the 0 is the head, the X is its bow tie. At your service.", draw: butler },
  { id: "board", name: "Board", idea: "X0 in amber dots, like a station display; one dot has hopped out, alive like the app's bots.", draw: board },
  { id: "key", name: "Key", idea: "The voice keyboard's one key: a soft cream keycap with x0 pressed on it.", draw: key },
];

// Alternatives worth keeping in reach (not written by default).
export const VARIANTS = {
  "wink-ink": () => wink({ p: "xwi-", ground: [[0, "#151311"], [1, "#0a0a0a"]] }),
  "power-paper": () => power({ p: "xpp-", gnd: PAPER, xcol: INK, ocol: CLAY }),
  // killed: too close to the writing-app trope of letters plus a cursor
  "caret": () => caret(),
  "listen-clay": () => listen({ p: "xlc-", gnd: "#B8613F", ocol: CREAM, bar: INK }),
  "listen-cream0": () => listen({ p: "xlb-", ocol: CREAM, bar: AMBER }),
  "butler-ink": () => butler({ p: "xbi-", gnd: INK, head: CREAM, tie: TERRA }),
  "board-cream": () => board({ p: "xdc-", dot: CREAM, acc: AMBER, dim: "#14120f" }),
  "board-nogrid": () => board({ p: "xd1-", grid: false }),
  "board-55": () => board({ p: "xd2-", font: "5x5", cell: 74, hop: [9, 0, 50, -120] }),
  "key-ink": () => key({ p: "xki-", ground: [[0, "#1a1816"], [1, "#0a0a0a"]], shadow: "#000", shOp: 0.9 }),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "--proto") {
    const dir = args[1];
    fs.mkdirSync(dir, { recursive: true });
    for (const c of CONCEPTS) fs.writeFileSync(path.join(dir, c.id + ".svg"), c.draw());
    for (const [k, fn] of Object.entries(VARIANTS)) fs.writeFileSync(path.join(dir, k + ".svg"), fn());
    console.log("wrote", CONCEPTS.length + Object.keys(VARIANTS).length, "files to", dir);
  } else {
    for (const c of CONCEPTS) {
      fs.mkdirSync(path.join(here, c.id), { recursive: true });
      fs.writeFileSync(path.join(here, c.id, "icon.svg"), c.draw());
    }
    console.log("wrote", CONCEPTS.map((c) => c.id + "/icon.svg").join(", "));
  }
}
