// The trailer's handcrafted components: what lift.mjs paints with the brand's hand (the paper's tooth, dip-pen ink,
// dry gouache, pencil, faceted cuts) and lifts off the paper as RGBA PNGs. See lift.mjs for the job shape; every
// `draw` runs in the page with HD (handdrawn-v2/draw.js) and paints in the 1000 square. A `$NAME` in a recipe is one
// of the constants below, pasted in as a JSON value (the recipes are stringified, so they cannot close over them).
const V = {
  CLAY: "#C9683F", INK: "#0A0A0A", CREAM: "#FBF2E2", MOSS: "#4F7A3A", KEYCLAY: "#A9573A", OCHRE: "#8F6A1F", SEA: "#3E6E8E",
  PAPER_GREY: "#ECE9E3", PAPER_GREY2: "#D9D5CD", PENCIL: "#7A7A7A",
};

/** A dry gouache swash: one heavy stroke with the brush's bristle streaks trailing it. */
const swash = (color, seed, o = {}) => ({ name: `swash-${o.name}`, N: 1600, out: 900, seed, draw: `(art, bg, HD, seed) => {
  const { G, M } = HD, n = art.noise, r = HD.rng(seed);
  const pts = G.wobble(G.cubic([110, 520], [360, ${o.lift ?? 440}], [640, ${o.dip ?? 600}], [900, 500]), false, ${o.wob ?? 6}, 90, n);
  art.mark(${JSON.stringify(color)}, { tooth: 0.55, soft: 0.2, gain: 1.1, paper: "coarse" }, (c) => {
    M.ink(c, pts, { w: ${o.w ?? 58}, jit: 0.3, taper: [60, 140], noise: n, phase: 2.1 + seed, profile: (k) => 0.75 + 0.5 * Math.sin(k * Math.PI) });
    for (let i = 0; i < 6; i++) { const off = (i - 2.5) * ${(o.w ?? 58) / 6.5}; M.ink(c, pts.map(([x, y]) => [x, y + off]), { w: 7, jit: 0.6, taper: [120, 200], noise: n, phase: 3 + i + seed, p: 0.35 }); }
  });
}` });

/** A torn paper scrap: a wobbled rectangle with notches, a fibre rim and a faint edge, in one paper tone. */
const scrap = (name, tone, seed, o = {}) => ({ name, N: 1600, out: 1000, seed, draw: `(art, bg, HD, seed) => {
  const { G } = HD, n = art.noise, r = HD.rng(seed);
  let pts = G.wobble(G.rrect(500, 500, ${o.w ?? 760}, ${o.h ?? 260}, 10), true, 9, 22, n);
  for (let k = 0; k < ${o.notches ?? 3}; k++) { const i0 = Math.floor(r() * pts.length), len = 10 + Math.floor(r() * 10), d = 12 + r() * 13;
    const nr = G.normals(pts, true); for (let j = 0; j < len; j++) { const i = (i0 + j) % pts.length, f = Math.sin(j / len * Math.PI); pts[i] = [pts[i][0] - nr[i][0] * d * f, pts[i][1] - nr[i][1] * d * f]; } }
  art.mark(${JSON.stringify(tone)}, { tooth: 0.25, soft: 0.3, gain: 1.2 }, (c) => { G.path(c, pts); c.fill(); });
  // the torn rim: lit fibres just outside, a faint grey edge just inside
  art.mark("#FFFFFF", { tooth: 0.8, soft: 0.2, opacity: 0.55, paper: "coarse" }, (c) => { c.lineWidth = 5; G.path(c, G.offset(pts, 3)); c.stroke(); });
  art.mark(${JSON.stringify(o.edge ?? "#CFCAC2")}, { tooth: 0.7, soft: 0.25, opacity: 0.55, paper: "coarse" }, (c) => { c.lineWidth = 3.5; G.path(c, G.offset(pts, -1)); c.stroke(); });
}` });

/** A dip-pen outline of a rounded rectangle: wobbling, overshooting where the pen closes; optionally a flat fill under it. */
const penFrame = (name, w, h, r, seed, o = {}) => ({ name, N: 1600, out: 1000, seed, draw: `(art, bg, HD, seed) => {
  const { G, M } = HD, n = art.noise;
  const box = G.rrect(500, 500, ${w}, ${h}, ${r});
  ${o.fill ? `art.mark(${JSON.stringify(o.fill)}, { tooth: 0.3, soft: 0.25, gain: 1.15 }, (c) => { G.path(c, G.wobble(box, true, 2, 60, n, 9)); c.fill(); });` : ""}
  art.mark($INK, { tooth: 0.35, soft: 0.22 }, (c) => M.outline(c, box, { amp: ${o.amp ?? 2.4}, wl: 60, w: ${o.w ?? 5}, over: 0.04, drift: 5, start: 0.12, noise: n, phase: 1.7 + seed, jit: 0.25, taper: [12, 40] }));
  ${o.double ? `art.mark($INK, { tooth: 0.6, soft: 0.25, opacity: 0.35 }, (c) => M.outline(c, box, { amp: 3.2, wl: 50, w: 3.5, over: 0.03, drift: 4, start: 0.3, noise: n, phase: 4.1 + seed, jit: 0.3, taper: [12, 40] }));` : ""}
}` });

const JOBS = [
  // The paper: warm white cotton with its tooth and a soft mottle, no vignette. Covered, not tiled.
  { name: "paper", N: 2048, out: 2048, seed: 3, opaque: true, draw: `(art) => { art.paper({ color: "#FFFFFF", mottle: 0.028, grain: 0.07, warm: 0.012, vignette: 0, scale: 300 }); }` },

  // Brush swashes, one per bot colour and the icon's clay and ink.
  swash(V.CLAY, 11, { name: "bar" }), swash(V.INK, 12, { name: "ink" }),
  swash(V.MOSS, 13, { name: "moss", lift: 460, dip: 580 }), swash(V.KEYCLAY, 14, { name: "clay", lift: 420, dip: 620 }),
  swash(V.OCHRE, 15, { name: "ochre", lift: 470, dip: 560 }), swash(V.SEA, 16, { name: "sea", lift: 430, dip: 590 }),

  // A wide swash to sit behind a whole line of type, clay.
  { name: "band-bar", N: 2000, out: 1400, seed: 21, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    const pts = G.wobble(G.cubic([40, 500], [330, 486], [660, 514], [960, 500]), false, 4, 120, n);
    art.mark($CLAY, { tooth: 0.5, soft: 0.22, gain: 1.15, paper: "coarse" }, (c) => {
      M.ink(c, pts, { w: 150, jit: 0.12, taper: [30, 50], noise: n, phase: 5.5, profile: (k) => 0.9 + 0.1 * Math.sin(k * Math.PI) });
      for (let i = 0; i < 10; i++) { const off = (i - 4.5) * 16; M.ink(c, pts.map(([x, y]) => [x + 10, y + off]), { w: 8, jit: 0.7, taper: [160, 260], noise: n, phase: 9 + i, p: 0.3 }); }
    });
  }` },

  // The mark, painted: "X0" in flat ink, every edge cut in short uneven facets like the icon's bot.
  { name: "mark-x0-ink", N: 2000, out: 1200, seed: 31, draw: `(art, bg, HD, seed) => {
    const { G } = HD, n = art.noise, r = HD.rng(seed);
    const facet = (pts, len, jit) => { const P = G.resample(pts, 1, true), out = []; for (let i = 0; i < P.length; i += Math.max(2, Math.round(len * (0.6 + 0.8 * r())))) { const [x, y] = P[i], q = P[(i + 1) % P.length], tx = q[0] - x, ty = q[1] - y, tl = Math.hypot(tx, ty) || 1, d = (r() * 2 - 1) * jit; out.push([x - (ty / tl) * d, y + (tx / tl) * d]); } return out; };
    const bar = (a, b, w) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * w / 2, ny = dx / L * w / 2; return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; };
    const paint = (pts) => art.mark($INK, { tooth: 0.12, soft: 0.1, gain: 1.2 }, (c) => { G.path(c, facet(G.wobble(pts, true, 2.5, 60, n), 22, 2.6)); c.fill(); });
    paint(bar([150, 300], [430, 700], 96)); paint(bar([430, 300], [150, 700], 84));
    const outer = G.ellipse(690, 500, 190, 228, 360), inner = G.ellipse(690, 500, 98, 140, 300);
    paint(outer);
    art.mark(bg, { tooth: 0.08, soft: 0.1, gain: 1.3 }, (c) => { G.path(c, facet(G.wobble(inner, true, 2, 50, n, 3), 18, 2)); c.fill(); });
  }` },

  // Masking tape in paper grey (the "copy" label's ground): a translucent strip with torn ends and fine streaks.
  { name: "tape-grey", N: 1200, out: 700, seed: 41, draw: `(art, bg, HD, seed) => {
    const { G } = HD, n = art.noise, r = HD.rng(seed);
    const tear = (x, dir) => { const pts = []; for (let y = 400; y <= 600; y += 6) pts.push([x + dir * (n.fbm(y / 18, x / 7, 2) * 14 + (r() - 0.5) * 6), y]); return pts; };
    const L = tear(200, -1), R = tear(800, 1).reverse(), shape = [...L, ...R];
    art.mark($PAPER_GREY, { tooth: 0.3, soft: 0.25, gain: 1.2 }, (c) => { G.path(c, G.wobble(shape, true, 1.2, 80, n)); c.fill(); });
    art.mark("#D5D0C6", { tooth: 0.9, soft: 0.15, opacity: 0.4, paper: "coarse" }, (c) => { for (let y = 410; y < 600; y += 7) { c.lineWidth = 2; G.path(c, [[210, y + n.fbm(y, 1, 2) * 3], [790, y + n.fbm(y, 2, 2) * 3]], false); c.stroke(); } });
  }` },

  // Torn paper scraps: the dentist note and the packing scrap (words are written live on the page), and three blanks.
  scrap("scrap-note", "#FBFAF7", 91, { w: 760, h: 300 }),
  scrap("scrap-packing", "#FBF8F2", 92, { w: 700, h: 420, notches: 4 }),
  scrap("scrap-blank-1", V.PAPER_GREY, 94, { w: 760, h: 440, notches: 4, edge: "#C9C4BB" }),
  scrap("scrap-blank-2", V.PAPER_GREY2, 95, { w: 720, h: 380, notches: 3, edge: "#B9B4AB" }),
  scrap("scrap-blank-3", "#FBFAF7", 96, { w: 800, h: 340, notches: 5 }),
  // a tiny note for the hand-off, the same recipe
  scrap("scrap-tiny", "#FBFAF7", 97, { w: 760, h: 290, notches: 2 }),

  // The strike-through: one ink brush stroke, fat in the middle, dry at its start.
  { name: "strike-ink", N: 2000, out: 1000, seed: 101, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    const pts = G.wobble(G.line([20, 500], [980, 500]), false, 4, 90, n, 2);
    art.mark($INK, { tooth: 0.5, soft: 0.22, gain: 1.1, paper: "coarse" }, (c) => M.ink(c, pts, { w: 26, jit: 0.3, taper: [40, 110], noise: n, phase: 3.3, p: 0.95, profile: (k) => 1 + 0.35 * Math.sin(Math.PI * k) }));
  }` },

  // The clay dot: the bar's seed, a tiny faceted blob of the bar's own clay.
  { name: "clay-dot", N: 800, out: 200, seed: 111, draw: `(art, bg, HD, seed) => {
    const { G } = HD, n = art.noise, r = HD.rng(seed);
    const P = G.resample(G.wobble(G.ellipse(500, 500, 60, 60, 120), true, 8, 40, n), 1, true), pts = [];
    for (let i = 0; i < 9; i++) pts.push(P[Math.floor(i / 9 * P.length)]);
    art.mark($CLAY, { tooth: 0.3, soft: 0.2, gain: 1.2 }, (c) => { G.path(c, pts); c.fill(); });
  }` },

  // The bar painting itself: a dry-brush strip of clay the page clips to the bar's own silhouette.
  { name: "bar-stroke", N: 2000, out: 2000, seed: 121, pad: 0, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise, r = HD.rng(seed);
    const band = [[-20, 420], [1020, 420], [1020, 580], [-20, 580]];
    art.mark($CLAY, { tooth: 0.6, soft: 0.3, gain: 1.1, paper: "coarse" }, (c) => M.hatch(c, band, { r, noise: n, angle: 0, gap: 3, w: 9, p: 0.95, pjit: 0.3, ragged: 60, wave: 1.5 }));
  }` },

  // An ink sun with a small cloud: dip-pen outlines.
  { name: "ink-sun", N: 1600, out: 1000, seed: 131, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise, r = HD.rng(seed);
    const ink = (pts, o) => art.mark($INK, { tooth: 0.35, soft: 0.22 }, (c) => M.ink(c, pts, { noise: n, jit: 0.3, ...o }));
    const cx = 380, cy = 480, R = 150;
    art.mark($INK, { tooth: 0.35, soft: 0.22 }, (c) => M.outline(c, G.ellipse(cx, cy, R, R, 240), { amp: 3.5, wl: 70, w: 16, over: 0.1, drift: 8, noise: n, phase: 2, jit: 0.3, taper: [20, 60] }));
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2, r0 = R + 40 + r() * 15, r1 = r0 + 70 + r() * 40;
      ink(G.wobble(G.line([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]), false, 2, 40, n, i), { w: 18, taper: [14, 40] }); }
    // the cloud: three loose bumps joined, outlined
    const cloud = [...G.arc(640, 640, 70, 60, Math.PI, Math.PI * 2, 60), ...G.arc(740, 620, 90, 80, Math.PI * 1.1, Math.PI * 2.05, 80), ...G.arc(840, 650, 60, 55, Math.PI * 1.2, Math.PI * 2.1, 50), [900, 700], [580, 700]];
    art.mark($INK, { tooth: 0.35, soft: 0.22 }, (c) => M.outline(c, cloud, { amp: 2.5, wl: 60, w: 14, over: 0.06, drift: 6, noise: n, phase: 5, jit: 0.3, taper: [20, 50] }));
  }` },

  // Dashes: a ticket's perforation (ink) and the leave-by line that climbs a rail (ochre). Ten ragged segments in a row.
  ...[["ink-dashes-ink", V.INK], ["ink-dashes-ochre", V.OCHRE]].map(([name, col]) => ({ name, N: 1600, out: 1000, seed: 141, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise, r = HD.rng(seed);
    art.mark(${JSON.stringify(col)}, { tooth: 0.35, soft: 0.22 }, (c) => { for (let i = 0; i < 10; i++) { const x0 = 40 + i * 94 + r() * 6, x1 = x0 + 58 + r() * 14, y = 500 + (r() - 0.5) * 6;
      M.ink(c, G.wobble(G.line([x0, y], [x1, y]), false, 1.5, 30, n, i), { w: 16, jit: 0.4, taper: [4, 4], noise: n, phase: i }); } });
  }` })),

  // Punctuation that falls in: a dip-pen comma and a full stop.
  { name: "ink-comma", N: 800, out: 300, seed: 151, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    const pts = G.wobble(G.cubic([520, 380], [560, 460], [520, 560], [420, 640]), false, 2, 50, n);
    art.mark($INK, { tooth: 0.3, soft: 0.2 }, (c) => M.ink(c, pts, { w: 110, jit: 0.2, taper: [10, 170], noise: n, phase: 1, profile: (k) => 1 - 0.75 * k }));
  }` },
  { name: "ink-dot", N: 600, out: 200, seed: 161, draw: `(art, bg, HD, seed) => {
    const { G } = HD, n = art.noise;
    art.mark($INK, { tooth: 0.3, soft: 0.2 }, (c) => { G.path(c, G.wobble(G.ellipse(500, 500, 110, 100, 120), true, 8, 40, n)); c.fill(); });
  }` },
  // The tick, moss: a short stroke down, a long one up, the pen overshooting at the join.
  { name: "ink-tick", N: 1200, out: 600, seed: 171, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    const a = G.wobble(G.line([300, 520], [450, 680]), false, 2.5, 50, n, 1), b = G.wobble(G.line([430, 690], [720, 320]), false, 3, 60, n, 2);
    art.mark($MOSS, { tooth: 0.3, soft: 0.2, gain: 1.15 }, (c) => { M.ink(c, a, { w: 46, jit: 0.25, taper: [20, 10], noise: n, phase: 1 }); M.ink(c, b, { w: 46, jit: 0.25, taper: [10, 80], noise: n, phase: 2 }); });
  }` },

  // The bug: an eyeless faceted ink blob with six dip-pen legs; frame B has the legs turned a little.
  ...[["beetle-a", 0], ["beetle-b", 12]].map(([name, legRot]) => ({ name, N: 1200, out: 600, seed: 181, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise, r = HD.rng(seed);
    const P = G.resample(G.wobble(G.ellipse(500, 500, 190, 135, 200), true, 10, 50, n), 1, true), body = []; for (let i = 0; i < 11; i++) body.push(P[Math.floor(i / 11 * P.length)]);
    const rot = ${legRot} * Math.PI / 180;
    art.mark($INK, { tooth: 0.3, soft: 0.2 }, (c) => { for (let i = 0; i < 6; i++) { const s = i < 3 ? -1 : 1, k = (i % 3) - 1, a0 = (s > 0 ? 0 : Math.PI) + k * 0.55 + s * rot * (k === 0 ? 1 : k), x0 = 500 + Math.cos(a0) * 150, y0 = 500 + Math.sin(a0) * 110;
      const knee = [x0 + Math.cos(a0) * 70, y0 + Math.sin(a0) * 60 - 40], foot = [knee[0] + Math.cos(a0) * 30 + s * 20, knee[1] + 90];
      M.ink(c, G.wobble([...G.line([x0, y0], knee), ...G.line(knee, foot)], false, 1.5, 30, n, i), { w: 14, jit: 0.3, taper: [4, 20], noise: n, phase: i }); } });
    art.mark($INK, { tooth: 0.15, soft: 0.12, gain: 1.2 }, (c) => { G.path(c, body); c.fill(); });
  }` })),

  // Dip-pen frames: the question card's frame, its two pills (and the Yes filled moss), the Coming soon stamp.
  penFrame("pen-frame", 920, 363, 34, 191),
  penFrame("pen-pill", 600, 210, 105, 192, { amp: 2, w: 6 }),
  penFrame("pen-pill-yes", 600, 210, 105, 193, { amp: 2, w: 6, fill: V.MOSS }),
  penFrame("pen-stamp", 900, 241, 22, 194, { amp: 2.8, w: 6, double: true }),

  // A tap: a loose ink ring that blooms and fades.
  { name: "tap-ring", N: 1000, out: 400, seed: 201, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    art.mark($INK, { tooth: 0.35, soft: 0.22 }, (c) => M.outline(c, G.ellipse(500, 500, 300, 300, 240), { amp: 6, wl: 60, w: 24, over: 0.1, drift: 10, noise: n, phase: 3, jit: 0.3, taper: [30, 80] }));
  }` },

  // A sparkle in sea, two frames turned 22 degrees apart.
  ...[["sparkle-sea-a", 0], ["sparkle-sea-b", 22]].map(([name, rot]) => ({ name, N: 800, out: 300, seed: 211, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    art.mark($SEA, { tooth: 0.2, soft: 0.15, gain: 1.2 }, (c) => { G.path(c, G.wobble(M.sparkle(500, 500, 320, ${rot} * Math.PI / 180, 0.26), true, 3, 30, n)); c.fill(); });
  }` })),

  // A pencil ring, dashed, grey: the "yours" slot. Nine arcs with gaps, in pen order.
  { name: "pencil-ring", N: 1000, out: 400, seed: 221, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise, r = HD.rng(seed);
    art.mark($PENCIL, { tooth: 0.75, soft: 0.25, paper: "coarse" }, (c) => { for (let i = 0; i < 9; i++) { const a0 = -Math.PI / 2 + i / 9 * Math.PI * 2 + 0.08, a1 = a0 + Math.PI * 2 / 9 - 0.16;
      M.ink(c, G.wobble(G.arc(500, 500, 300, 300, a0, a1, 40), false, 3, 40, n, i), { w: 22, jit: 0.4, taper: [10, 10], noise: n, phase: i, p: 0.6 }); } });
  }` },

  // A wide loose ink ring, the bug's scribble round a line of code, painted at its own ratio.
  { name: "ring-ink-wide", N: 1600, out: 1000, seed: 231, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise;
    const loop = G.overshoot(G.wobble(G.ellipse(500, 500, 450, 122, 360, -2.3), true, 7, 60, n), 0.14, 10);
    art.mark($INK, { tooth: 0.45, soft: 0.2, gain: 1.1 }, (c) => M.ink(c, loop, { w: 17, jit: 0.35, taper: [40, 90], noise: n, phase: 1.3 }));
  }` },

  // A pencil hatch block: graphite texture for the cards' shadows (drawn at one scale, clipped).
  { name: "hatch", N: 1200, out: 600, seed: 71, draw: `(art, bg, HD, seed) => {
    const { G, M } = HD, n = art.noise, r = HD.rng(seed);
    const box = G.rrect(500, 500, 600, 300, 10);
    art.mark("#6A6560", { tooth: 0.85, soft: 0.2, gain: 0.95, paper: "coarse" }, (c) => M.hatch(c, box, { r, noise: n, angle: -0.65, gap: 11, w: 9, p: 0.6, ragged: 30 }));
  }` },

  // Dots in a ring: the keyboard's "listening", painted cream-on-clay dots (recoloured on the page).
  { name: "listen-dots", N: 1200, out: 600, seed: 81, draw: `(art, bg, HD, seed) => {
    const { G } = HD, r = HD.rng(seed);
    art.mark($CLAY, { tooth: 0.2, soft: 0.15, gain: 1.1 }, (c) => { for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, R = 300 + (r() - 0.5) * 20, x = 500 + Math.cos(a) * R, y = 500 + Math.sin(a) * R, rr = 16 + r() * 10; G.path(c, G.wobble(G.ellipse(x, y, rr, rr, 60), true, 1.5, 20, art.noise, i)); c.fill(); } });
  }` },
];

export default JOBS.map((j) => ({ ...j, draw: j.draw.replace(/\$([A-Z_0-9]+)/g, (m, k) => { if (!(k in V)) throw new Error(`components: no constant ${k}`); return JSON.stringify(V[k]); }) }));
