/* X0 Bot: the hand-drawn Curious, hanging upside down. It reuses ../handdrawn-v2 (draw.js, bot.js,
 * versions.js): each version is drawn the right way up, gripping a ledge, then turned 180 degrees, so
 * the ledge becomes a bar along the top that the bot hangs from by its hands, head down, peeking at you.
 * flipLight puts every light on the far side while drawing, so once turned the light comes from the top left. */
(function () {
  "use strict";
  const { PAL, M, vgrad } = HD;
  const cur = HD.VERSIONS.find((v) => v.id === "3-curious");
  // no antenna; the eyes on you (drawn upright a touch up, so once turned they look a touch down, at you).
  // x pulls the head back to the middle (the tilt swings it sideways); shine is where it lands once turned.
  const bot = (o = {}) => ({ ...cur.bot, antenna: false, flipLight: true, x: 444, tilt: 0.16, rise: 134, hw: 368, hh: 282,
    shine: [0.94, 1.12], ...o, face: { ...cur.bot.face, look: [0, -10], ...(o.face || {}) } });
  const bar = (o = {}) => ({ y: 748, slope: -0.006, line: { color: PAL.ink, w: 14, amp: 0.8 }, belowTint: "#E4E0D8", ...o });

  /** The black head: charcoal shell lit from the top, a glossy black visor, warm glowing eyes, white gloves. */
  function black(K, o = {}) {
    const { headCY, hh } = K;
    return HD.brush(K, {
      shell: { color: vgrad("#121110", "#47423C", headCY - hh, headCY + hh * 0.45), p: 1 },
      shade: { color: "#000000", p: 1, opacity: 0.45, crescent: [58, 66, 7] },
      shellShine: { color: "#FFFFFF", w: 20, opacity: 0.5, taper: [24, 30], amp: 0.5, profile: (t) => 0.5 + 0.7 * Math.sin(Math.PI * t) },
      shellLine: { color: "#0B0A09", w: 14, weight: 0.45, amp: 1.4, start: 0.62 },
      visor: { color: vgrad("#000000", "#0D0C0B", headCY - hh * 0.6, headCY + hh * 0.4), p: 1 },
      visorSheen: { color: "#FFFFFF", opacity: 0.07 },
      visorGlint: { color: "#FFFFFF", w: 9, opacity: 0.6, taper: [10, 16], amp: 0.5 },
      visorLine: { color: "#6A5F54", w: 4, opacity: 0.45, amp: 0.4 },   // a faint rim, so the visor reads on the black
      eyeHalo: { color: "#FFB46A", opacity: 0.3 },
      ear: { color: vgrad(PAL.clay, PAL.clayLight, headCY - 60, headCY + 60), p: 1 },
      earShade: { color: PAL.clayDeep, p: 1, opacity: 0.55, crescent: [14, 16, 4] },
      hand: { color: vgrad("#EFE7DA", "#FFFDF8", K.S.edge.y - 50, K.S.edge.y + 40), p: 1 },
      dropShadow: { color: "#2A2018", p: 1, opacity: 0.16, blur: 16, offset: [12, 20] },
      ...o,
    });
  }

  const V = [];

  V.push({ id: "1-black", name: "1 · Black, refined", seed: 1101,
    ground: (K) => K.art.paper({ color: "#FCFBF8", mottle: 0.012, grain: 0.03, vignette: 0.02 }),
    edge: bar(), bot: bot(), style: (K) => black(K),
    note: "Centred, lit from the top left (catchlights, gloss, a soft shadow on the wall), a cleaner glossy visor and white gloves." });

  // Hand-crafted: gouache and ink on cotton paper. The paper's tooth shows through the paint, the black is laid
  // in visible dry-brush strokes, the ink line wobbles like a dip pen, the bar's band is pencil-hatched, and two
  // little brush ticks say it is swinging.
  V.push({ id: "2-crafted", name: "2 · Hand-crafted", seed: 2611,
    ground(K) {
      K.art.paper({ color: "#F4EDE0", mottle: 0.05, grain: 0.1, warm: 0.03, vignette: 0.06, scale: 190 });
      K.art.mark("#8C8378", { tooth: 0.55, paper: "coarse", opacity: 0.55 }, (c) => M.hatch(c, K.below, { r: K.r, noise: K.n, angle: -0.95, gap: 8, w: 2.6, p: 0.8, wave: 3, ragged: 30 }));
    },
    edge: bar({ belowTint: "#EDE6DA", line: { color: "#1A1512", w: 16, amp: 2.4, wl: 70, tooth: 0.28, paper: "coarse", jit: 0.18 } }),
    bot: bot({ x: 448 }),
    style: (K) => black(K, {
      shell: { color: vgrad("#141210", "#3E3934", K.headCY - K.hh, K.headCY + K.hh * 0.45), p: 1, tooth: 0.3, paper: "coarse", amp: 1.2 },
      shade: { color: "#000000", p: 1, opacity: 0.4, crescent: [58, 66, 10], tooth: 0.4, paper: "coarse" },
      shellShine: { color: "#F7EFE2", w: 18, opacity: 0.55, taper: [20, 34], amp: 1.6, tooth: 0.45, paper: "coarse" },
      shellLine: { color: "#14100D", w: 16, weight: 0.5, amp: 3.0, wl: 60, jit: 0.18, start: 0.62, tooth: 0.2, paper: "coarse" },
      visor: { color: vgrad("#050505", "#14110F", K.headCY - K.hh * 0.6, K.headCY + K.hh * 0.4), p: 1, tooth: 0.22, paper: "coarse", amp: 1.4 },
      visorGlint: { color: "#F7EFE2", w: 10, opacity: 0.6, taper: [10, 18], amp: 1.2, tooth: 0.4, paper: "coarse" },
      eye: { p: 1, tooth: 0.32, paper: "coarse", amp: 1.4 },
      catchlight: { color: "#FFFFFF", p: 1, tooth: 0.2, paper: "coarse" },
      ear: { color: vgrad(PAL.clay, PAL.clayLight, K.headCY - 60, K.headCY + 60), p: 0.95, tooth: 0.45, paper: "coarse", amp: 1.6 },
      earLine: { color: "#14100D", w: 12, weight: 0.45, amp: 2.4, wl: 50, jit: 0.16 },
      hand: { color: vgrad("#EADFCD", "#FBF5EA", K.S.edge.y - 50, K.S.edge.y + 40), p: 1, tooth: 0.3, paper: "coarse", amp: 1.2 },
      handLine: { color: "#14100D", w: 12, weight: 0.45, amp: 2.2, wl: 45, jit: 0.16, start: 0.25 },
      dropShadow: { color: "#3A2C20", p: 1, opacity: 0.14, blur: 18, offset: [12, 20], tooth: 0.3, paper: "coarse" },
    }),
    afterShell(K) { // dry-brush streaks in the black, following the head's curve
      K.art.mark("#5A534B", { tooth: 0.62, paper: "coarse", opacity: 0.45 }, (c) => {
        G_clip(c, K.above); G_clip(c, K.geo.shell);
        M.hatch(c, K.geo.shell, { r: K.r, noise: K.n, angle: 0.5, gap: 13, w: 5, p: 0.5, wave: 11, pjit: 0.6, ragged: 40 });
      });
    },
    after(K) { // two swing marks: short arcs round the swing's pivot, just past the crown (once turned: trailing it, bottom left)
      const { cx, S } = K, piv = [cx, S.edge.y + 240];
      for (const [R, a0, a1, w] of [[668, 0.66, 0.84, 12], [716, 0.7, 0.84, 9]]) {
        const pts = [];
        for (let i = 0; i <= 30; i++) { const t = a0 + ((a1 - a0) * i) / 30; pts.push([piv[0] + Math.sin(t) * R, piv[1] - Math.cos(t) * R]); }
        K.line(pts, { color: "#14100D", w, taper: [16, 22], amp: 1.2, tooth: 0.25, paper: "coarse", clip: null });
      }
    },
  });

  // A hidden x0. Drawn upright, so the eye and ear on the drawing's right end up on the left once turned:
  // the left eye's glint is a little x-shaped sparkle and the right one's a ring (x 0); on the ears, a
  // cross-head screw and a round rivet. From a distance they're just a glint and a screw.
  const eyesX0 = cur.bot.face.eyes.map((e, i) => ({ ...e, glint: i === 0 ? "o" : "x" }));
  V.push({ id: "3-x0-eyes", name: "3 · x0 in the eyes", seed: 1101,
    ground: (K) => K.art.paper({ color: "#FCFBF8", mottle: 0.012, grain: 0.03, vignette: 0.02 }),
    edge: bar(), bot: bot({ face: { eyes: eyesX0 } }), style: (K) => black(K),
    note: "The refined black, with a hidden x0: the left eye's glint is a little x-shaped sparkle, the right eye's a ring." });
  V.push({ id: "4-x0-ears", name: "4 · x0 on the ears", seed: 1101,
    ground: (K) => K.art.paper({ color: "#FCFBF8", mottle: 0.012, grain: 0.03, vignette: 0.02 }),
    edge: bar(), bot: bot({ earMarks: ["o", "x"] }), style: (K) => black(K, { earMark: { color: "#5E2A16", w: 7, amp: 0.3, taper: [3, 3] } }),
    note: "The refined black, with a hidden x0 on the ear pods: a cross-head screw on the left, a round rivet on the right." });
  V.push({ id: "5-x0-both", name: "5 · x0, eyes and ears", seed: 1101,
    ground: (K) => K.art.paper({ color: "#FCFBF8", mottle: 0.012, grain: 0.03, vignette: 0.02 }),
    edge: bar(), bot: bot({ earMarks: ["o", "x"], face: { eyes: eyesX0 } }), style: (K) => black(K, { earMark: { color: "#5E2A16", w: 7, amp: 0.3, taper: [3, 3] } }),
    note: "Both: x0 in the glints and on the ears. Still quiet, but it rewards a second look." });

  // Painted, the way the Claude mark is: flat colour only (no outlines, gradients, highlights or shadows), every
  // edge cut in short, slightly uneven straight facets. Our colours: a black bot on warm white, clay ears.
  function painted(K, c) {
    const cut = (len, jit) => ({ len, jit });
    return {
      ear: { color: c.ear, p: 1, facet: cut(20, 2.5) }, earShade: null, earLine: null,
      shell: { color: c.head, p: 1, facet: cut(42, 4.5) }, shade: null, shellShine: null, shellLine: null,
      visor: c.visor ? { color: c.visor, p: 1, facet: cut(36, 3.5) } : { color: c.head, p: 0 }, visorSheen: null, visorGlint: null, visorLine: null,
      eye: { color: c.eye, p: 1, facet: cut(24, 3) }, eyeHalo: null, catchlight: null, brow: null,
      hand: { color: c.hand, p: 1, facet: cut(16, 1.5) }, handShade: null, handLine: null, seam: null, handShadow: null,
      dropShadow: null,
    };
  }
  const paintedVersion = (id, name, c, note, o = {}) => V.push({ id, name, seed: 3131, note,
    ground(K) {
      K.art.paper({ color: c.ground, mottle: 0, grain: 0, vignette: 0 });
      K.fill([[-20, -20], [1020, -20], [1020, 1020], [-20, 1020]], { color: vgrad(c.ground, c.ground2 || c.ground, 0, 1000), p: 1, clip: null });
      K.fill(K.below, { color: c.bar, p: 1, clip: null, facet: { len: 46, jit: 3.5 } });
    },
    edge: bar({ line: null, belowTint: null, wave: 0.8 }), bot: bot(o), style: (K) => painted(K, c) });
  const INK = "#151311", CREAM = "#FBF2E2", CLAY = "#C9683F";
  paintedVersion("6-painted", "6 · Painted", { ground: "#F7F3EC", ground2: "#EFE9DF", bar: "#D8D0C3", head: INK, visor: "#2C2825", eye: CREAM, hand: CREAM, ear: CLAY },
    "Painted like the Claude mark: flat colour, no lines, every edge cut in short uneven facets. Black bot on warm white, a stone-grey bar.");
  paintedVersion("7-painted-ink-bar", "7 · Painted, black bar", { ground: "#F7F3EC", ground2: "#EFE9DF", bar: INK, head: INK, visor: "#2C2825", eye: CREAM, hand: CREAM, ear: CLAY },
    "The bar painted black too, so the bot and the bar are one shape: just the gloves, the eyes and the ears break it.");
  paintedVersion("8-painted-clay-bar", "8 · Painted, clay bar", { ground: "#F7F3EC", ground2: "#EFE9DF", bar: CLAY, head: INK, visor: "#2C2825", eye: CREAM, hand: CREAM, ear: CLAY },
    "A clay bar, the same clay as the ears.");
  paintedVersion("9-painted-no-visor", "9 · Painted, no visor", { ground: "#F7F3EC", ground2: "#EFE9DF", bar: "#D8D0C3", head: INK, visor: null, eye: CREAM, hand: CREAM, ear: CLAY },
    "The simplest: one black head, two cream eyes, cream gloves, clay ears.");

  // Colour studies of the painted clay-bar version (same shapes, same cut): pal-<name>. Not part of the ranked set.
  const PALETTES = [
    ["clay", "Clay (now)", { bar: CLAY, ear: CLAY }],
    ["tomato", "Tomato", { bar: "#FF5A3C", ear: "#FF5A3C" }],
    ["butter", "Butter", { bar: "#F4C445", ear: "#F4C445", ground: "#F8F5EE" }],
    ["lime", "Acid lime", { bar: "#CDEB4E", ear: "#CDEB4E", ground: "#F6F5EF", ground2: "#EEEDE4" }],
    ["forest", "Forest", { bar: "#1F4A38", ear: "#E9785A", ground: "#F3F0E8" }],
    ["cobalt", "Cobalt", { bar: "#2F4CF0", ear: "#FF8A5C", ground: "#F4F2EE" }],
    ["sky", "Sky", { bar: "#8DC3EC", ear: "#F28A6B", ground: "#F5F4F0" }],
    ["lilac", "Lilac", { bar: "#B7A3EE", ear: "#F2B53D", ground: "#F6F3F6", ground2: "#EEE9EF" }],
    ["night", "Night", { ground: "#1D1B18", ground2: "#141210", bar: CLAY, head: "#F1E8D8", visor: "#DCCFBC", eye: "#151311", hand: "#F1E8D8", ear: CLAY }],
  ];
  for (const [k, label, c] of PALETTES)
    paintedVersion("pal-" + k, label, { ground: "#F7F3EC", ground2: "#EFE9DF", head: INK, visor: "#2C2825", eye: CREAM, hand: CREAM, ...c }, "A colour study of the painted clay-bar version.");

  // Monkey and bot in one. The bot's black box head, its eyes now dark camera lenses with a glowing dot; the
  // monkey's light face plate (round round the eyes, with a muzzle), big round ears with a light inner ear,
  // and a curly tail hooked over the bar. Painted flat. The features are placed in final coordinates (as seen,
  // after the turn): u right, v down from the head's centre; U maps them back to the upright drawing.
  function monkey(id, name, c, note, o = {}) {
    const U = (K) => (u, v) => K.Wp(-u, -v);
    const oval = (K, cu, cv, ru, rv, n = 120) => { const P = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; P.push(U(K)(cu + ru * Math.cos(a), cv + rv * Math.sin(a))); } return P; };
    const cut = (len, jit) => ({ len, jit });
    /** A thick painted stroke along a polyline (final coordinates in the tile), tapering to tip. */
    const strokePoly = (pts, w0, w1) => {
      const L = [], R = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
        const w = w0 + (w1 - w0) * (i / (pts.length - 1)), nx = -dy / d, ny = dx / d;
        L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); R.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
      }
      const end = pts[pts.length - 1], cap = [];
      for (let k = 1; k < 12; k++) { const t = Math.PI * (k / 12), a0 = Math.atan2(L[L.length - 1][1] - end[1], L[L.length - 1][0] - end[0]); cap.push([end[0] + Math.cos(a0 - t) * w1, end[1] + Math.sin(a0 - t) * w1]); }
      return L.concat(cap, R.reverse());
    };
    const F = ([x, y]) => [1000 - x, 1000 - y];   // a point as seen (after the turn) -> the upright drawing
    V.push({ id, name, seed: 3131, note,
      ground(K) {
        K.art.paper({ color: c.ground, mottle: 0, grain: 0, vignette: 0 });
        K.fill([[-20, -20], [1020, -20], [1020, 1020], [-20, 1020]], { color: vgrad(c.ground, c.ground2 || c.ground, 0, 1000), p: 1, clip: null });
        K.fill(K.below, { color: c.bar, p: 1, clip: null, facet: { len: 46, jit: 3.5 } });
      },
      edge: bar({ line: null, belowTint: null, wave: 0.8 }),
      bot: bot({ ...o }),
      style: (K) => ({ ...painted(K, { head: c.fur, visor: null, eye: c.fur, hand: c.hand, ear: c.ear }), ear: { color: c.ear, p: 0 }, eye: { color: c.fur, p: 0 } }),
      beforeShell(K) { // big round monkey ears, behind the head, with a light inner ear and a little bolt (the bot)
        const { hw } = K;
        for (const s of [-1, 1]) {
          K.fill(oval(K, s * (hw + 6), 8, 96, 100), { color: c.ear, p: 1, facet: cut(22, 2.5) });
          K.fill(oval(K, s * (hw + 22), 10, 52, 58), { color: c.inner, p: 1, facet: cut(16, 2) });
          K.fill(oval(K, s * (hw + 30), 12, 11, 11, 40), { color: c.fur, p: 1, facet: cut(8, 1) });
        }
      },
      afterShell(K) { // the monkey's face plate, its muzzle, and the bot's lens eyes
        const fp = { color: c.face, p: 1, facet: cut(30, 3) };
        K.fill(oval(K, -118, -6, 112, 118), fp); K.fill(oval(K, 118, -6, 118, 124), fp);
        K.fill(oval(K, 0, 150, 168, 104), fp);
        K.fill(oval(K, 0, 160, 128, 78), { color: c.muzzle, p: 1, facet: cut(26, 2.5) });
        for (const s of [-1, 1]) K.fill(oval(K, s * 26, 132, 12, 15, 40), { color: c.fur, p: 1, facet: cut(8, 1) });
        // a small smile: a crescent (the bottom of one oval less the top of a higher one)
        const smile = [];
        for (let i = 0; i <= 30; i++) { const t = Math.PI * (0.12 + 0.76 * (i / 30)); smile.push(U(K)(Math.cos(t) * 54, 168 + Math.sin(t) * 34)); }
        for (let i = 30; i >= 0; i--) { const t = Math.PI * (0.12 + 0.76 * (i / 30)); smile.push(U(K)(Math.cos(t) * 54 * 0.92, 168 + Math.sin(t) * 34 - 13)); }
        K.fill(smile, { color: c.fur, p: 1, facet: cut(9, 1) });
        for (const [s, r] of [[-1, 58], [1, 64]]) {
          K.fill(oval(K, s * 118, 2, r, r * 1.12), { color: c.lens, p: 1, facet: cut(22, 2.5) });
          K.fill(oval(K, s * 118 - r * 0.25, 2 - r * 0.32, r * 0.3, r * 0.3, 60), { color: c.glow, p: 1, facet: cut(12, 1.5) });
        }
      },
      after(K) { // a curly tail from behind the head, hooked over the bar
        const pts = [], base = [842, 372], top = [880, 186];
        for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([base[0] + (top[0] - base[0]) * t + 34 * Math.sin(t * Math.PI), base[1] + (top[1] - base[1]) * t]); }
        for (let i = 1; i <= 50; i++) { const t = (i / 50) * Math.PI * 1.55, R = 64 * (1 - 0.42 * (i / 50)); pts.push([top[0] - R + Math.cos(t) * R + 0, top[1] - Math.sin(t) * R * 0.95]); }
        K.fill(strokePoly(pts, 24, 15).map(F), { color: c.fur, p: 1, clip: null, facet: cut(18, 2) });
      },
    });
  }
  monkey("m1-monkey", "Monkey-bot", { ground: "#F7F3EC", ground2: "#EFE9DF", bar: CLAY, fur: INK, face: "#E3C9A2", muzzle: "#F1DFC2", lens: "#151311", glow: "#FFF1D6", ear: CLAY, inner: "#E3C9A2", hand: CREAM },
    "The bot and a monkey in one: black box head, lens eyes with a glow, a monkey's face plate and muzzle, big round ears, and a curly tail hooked over the bar.");
  monkey("m2-monkey-brown", "Monkey-bot, brown", { ground: "#F7F3EC", ground2: "#EFE9DF", bar: "#2F4CF0", fur: "#4A2E22", face: "#E8C9A0", muzzle: "#F4E2C4", lens: "#1A1210", glow: "#FFF1D6", ear: "#4A2E22", inner: "#E8C9A0", hand: "#E8C9A0" },
    "The same in warm monkey brown, on a cobalt bar.");

  function G_clip(c, pts) { HD.G.path(c, pts); c.clip(); }

  HD.HANG = V;
})();
