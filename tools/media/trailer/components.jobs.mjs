// The trailer's handcrafted components: what lift.mjs paints with the brand's hand (the paper's tooth, dip-pen ink,
// dry gouache, pencil, faceted cuts) and lifts off the paper as RGBA PNGs. See lift.mjs for the job shape; every
// `draw` runs in the page with HD (handdrawn-v2/draw.js) and paints in the 1000 square.
const CLAY = "#C9683F", INK = "#0A0A0A", CREAM = "#FBF2E2";
const BOTS = { moss: "#4F7A3A", clay: "#A9573A", ochre: "#8F6A1F", sea: "#3E6E8E" };

/** A dry gouache swash: one heavy stroke with the brush's bristle streaks trailing it. */
const swash = (color, seed, o = {}) => ({ name: `swash-${o.name}`, N: 1600, out: 900, seed, draw: new Function("art", "bg", "HD", "seed", `
  const { G, M } = HD, n = art.noise, r = HD.rng(seed);
  const pts = G.wobble(G.cubic([110, 520], [360, ${o.lift ?? 440}], [640, ${o.dip ?? 600}], [900, 500]), false, ${o.wob ?? 6}, 90, n);
  art.mark("${color}", { tooth: 0.55, soft: 0.2, gain: 1.1, paper: "coarse" }, (c) => {
    M.ink(c, pts, { w: ${o.w ?? 58}, jit: 0.3, taper: [60, 140], noise: n, phase: 2.1 + seed, profile: (k) => 0.75 + 0.5 * Math.sin(k * Math.PI) });
    for (let i = 0; i < 6; i++) { const off = (i - 2.5) * ${(o.w ?? 58) / 6.5}; M.ink(c, pts.map(([x, y]) => [x, y + off]), { w: 7, jit: 0.6, taper: [120, 200], noise: n, phase: 3 + i + seed, p: 0.35 }); }
  });`) });

export default [
  // The paper: warm white cotton with its tooth and a soft mottle, no vignette (the frame adds its own). Covered, not tiled.
  { name: "paper", N: 2048, out: 2048, seed: 3, opaque: true, draw: (art) => {
      art.paper({ color: "#FFFFFF", mottle: 0.028, grain: 0.07, warm: 0.012, vignette: 0, scale: 300 });
  } },

  // Brush swashes, one per bot colour and the icon's clay and ink: for a word's ground or a wipe.
  swash(CLAY, 11, { name: "bar" }), swash(INK, 12, { name: "ink" }),
  swash(BOTS.moss, 13, { name: "moss", lift: 460, dip: 580 }), swash(BOTS.clay, 14, { name: "clay", lift: 420, dip: 620 }),
  swash(BOTS.ochre, 15, { name: "ochre", lift: 470, dip: 560 }), swash(BOTS.sea, 16, { name: "sea", lift: 430, dip: 590 }),

  // A wide swash to sit behind a whole line of type (a painted band), clay.
  { name: "band-bar", N: 2000, out: 1400, seed: 21, draw: (art, bg, HD, seed) => {
      const { G, M } = HD, n = art.noise;
      const pts = G.wobble(G.cubic([40, 500], [330, 486], [660, 514], [960, 500]), false, 4, 120, n);
      art.mark(CLAY_, { tooth: 0.5, soft: 0.22, gain: 1.15, paper: "coarse" }, (c) => {
        M.ink(c, pts, { w: 150, jit: 0.12, taper: [30, 50], noise: n, phase: 5.5, profile: (k) => 0.9 + 0.1 * Math.sin(k * Math.PI) });
        for (let i = 0; i < 10; i++) { const off = (i - 4.5) * 16; M.ink(c, pts.map(([x, y]) => [x + 10, y + off]), { w: 8, jit: 0.7, taper: [160, 260], noise: n, phase: 9 + i, p: 0.3 }); }
      });
  } },

  // The mark, painted: "X0" in flat ink, every edge cut in short uneven facets like the icon's bot. Two strokes of the X and
  // a loop for the 0, laid as thick painted bars so it reads at any size.
  { name: "mark-x0-ink", N: 2000, out: 1200, seed: 31, draw: (art, bg, HD, seed) => {
      const { G, M } = HD, n = art.noise, r = HD.rng(seed);
      const facet = (pts, len, jit) => { const P = G.resample(pts, 1, true), out = []; for (let i = 0; i < P.length; i += Math.max(2, Math.round(len * (0.6 + 0.8 * r())))) { const [x, y] = P[i], q = P[(i + 1) % P.length], tx = q[0] - x, ty = q[1] - y, tl = Math.hypot(tx, ty) || 1, d = (r() * 2 - 1) * jit; out.push([x - (ty / tl) * d, y + (tx / tl) * d]); } return out; };
      const bar = (a, b, w) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * w / 2, ny = dx / L * w / 2; return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; };
      const paint = (pts) => art.mark("#0A0A0A", { tooth: 0.12, soft: 0.1, gain: 1.2 }, (c) => { G.path(c, facet(G.wobble(pts, true, 2.5, 60, n), 22, 2.6)); c.fill(); });
      // X: two bars crossing, the down-stroke a touch heavier
      paint(bar([150, 300], [430, 700], 96)); paint(bar([430, 300], [150, 700], 84));
      // 0: a tall ring, drawn as an outer ellipse with the inner cut out (painted as two marks: ink then paper)
      const outer = G.ellipse(690, 500, 190, 228, 360), inner = G.ellipse(690, 500, 98, 140, 300);
      paint(outer);
      art.mark(bg, { tooth: 0.08, soft: 0.1, gain: 1.3 }, (c) => { G.path(c, facet(G.wobble(inner, true, 2, 50, n, 3), 18, 2)); c.fill(); });
  } },

  // Masking tape: a translucent cream strip with torn ends, a little paper tooth through it, for pinning a card to the frame.
  { name: "tape", N: 1200, out: 700, seed: 41, draw: (art, bg, HD, seed) => {
      const { G } = HD, n = art.noise, r = HD.rng(seed);
      const tear = (x, dir) => { const pts = []; for (let y = 400; y <= 600; y += 6) pts.push([x + dir * (n.fbm(y / 18, x / 7, 2) * 14 + (r() - 0.5) * 6), y]); return pts; };
      const L = tear(200, -1), R = tear(800, 1).reverse();
      const shape = [...L, ...R];
      art.mark("#EFE3C8", { tooth: 0.3, soft: 0.25, gain: 1, opacity: 0.82 }, (c) => { G.path(c, G.wobble(shape, true, 1.2, 80, n)); c.fill(); });
      // the tape's own fine streaks
      art.mark("#D8C7A4", { tooth: 0.9, soft: 0.15, opacity: 0.35, paper: "coarse" }, (c) => { for (let y = 410; y < 600; y += 7) { c.lineWidth = 2; G.path(c, [[210, y + n.fbm(y, 1, 2) * 3], [790, y + n.fbm(y, 2, 2) * 3]], false); c.stroke(); } });
  } },

  // A torn paper edge: the frame's paper, torn across, for a reveal from under it. Opaque white above a ragged edge, the
  // tear's fibres light; used as a mask-like layer (what is above the edge hides what is beneath).
  { name: "torn-edge", N: 2000, out: 2000, seed: 51, pad: 0, draw: (art, bg, HD, seed) => {
      const { G } = HD, n = art.noise;
      const edge = []; for (let x = -20; x <= 1020; x += 4) edge.push([x, 500 + n.fbm(x / 70, 3, 3) * 26 + n.fbm(x / 9, 7, 2) * 5]);
      const sheet = [[-20, -20], [1020, -20], ...edge.slice().reverse()];
      art.mark("#FFFFFF", { tooth: 0, soft: 0.1, gain: 1.5 }, (c) => { G.path(c, sheet); c.fill(); });
      // the tear: a soft grey shadow just under the edge and lit fibres along it
      art.mark("#B9B4AC", { tooth: 0.7, soft: 0.2, opacity: 0.5, paper: "coarse" }, (c) => { c.lineWidth = 7; G.path(c, edge.map(([x, y]) => [x, y + 3]), false); c.stroke(); });
      art.mark("#FFFFFF", { tooth: 0.9, soft: 0.1, opacity: 0.9, paper: "coarse" }, (c) => { c.lineWidth = 5; G.path(c, edge.map(([x, y]) => [x, y - 1]), false); c.stroke(); });
  } },

  // A pencil circle: a loose, scribbled ring to ring a word or a date, in ink.
  { name: "ring-ink", N: 1400, out: 700, seed: 61, draw: (art, bg, HD, seed) => {
      const { G, M } = HD, n = art.noise;
      const loop = G.overshoot(G.wobble(G.ellipse(500, 500, 330, 170, 400, -2.4), true, 7, 60, n), 0.18, 10);
      art.mark("#0A0A0A", { tooth: 0.45, soft: 0.2, gain: 1.1 }, (c) => M.ink(c, loop, { w: 13, jit: 0.35, taper: [40, 90], noise: n, phase: 1.3 }));
  } },

  // A pencil hatch block: graphite texture to hint at a card's shadow or a drawn ground, grey.
  { name: "hatch", N: 1200, out: 600, seed: 71, draw: (art, bg, HD, seed) => {
      const { G, M } = HD, n = art.noise, r = HD.rng(seed);
      const box = G.rrect(500, 500, 600, 300, 10);
      art.mark("#6A6560", { tooth: 0.85, soft: 0.2, gain: 0.95, paper: "coarse" }, (c) => M.hatch(c, box, { r, noise: n, angle: -0.65, gap: 11, w: 9, p: 0.6, ragged: 30 }));
  } },

  // Dots in a ring: the Peek-a-bot key's "listening" (the keyboard's), as painted cream dots for a listening halo.
  { name: "listen-dots", N: 1200, out: 600, seed: 81, draw: (art, bg, HD, seed) => {
      const { G } = HD, r = HD.rng(seed);
      art.mark(CLAY_, { tooth: 0.2, soft: 0.15, gain: 1.1 }, (c) => { for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, R = 300 + (r() - 0.5) * 20, x = 500 + Math.cos(a) * R, y = 500 + Math.sin(a) * R, rr = 16 + r() * 10; G.path(c, G.wobble(G.ellipse(x, y, rr, rr, 60), true, 1.5, 20, art.noise, i)); c.fill(); } });
  } },
].map((j) => ({ ...j, draw: typeof j.draw === "function" ? j.draw.toString().replace(/CLAY_/g, JSON.stringify(CLAY)) : j.draw }));
