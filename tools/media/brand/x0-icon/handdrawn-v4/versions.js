/* X0 Bot, hand-drawn icons v4: eight faces, each on a ground that suits its mood.
 * The bot is the v3 Curious bot (hand-made line, the peek, the antenna that just boinged, the brush
 * stroke behind). Only the face, the pose and the colours change. Seeds make them repeatable. */
(function () {
  "use strict";
  const { PAL, G, M, vgrad, rgb, mix } = HD;

  // ---- the palette: grounds with their light, brush stroke and edge line --------------------------
  const C = {
    teal:     { ground: "#13585D", light: "#2C8389", ring: "#EE8F5E", edge: "#F2E2C6", dark: true },
    marigold: { ground: "#F2A433", light: "#FFCB64", ring: "#FFF2DA", edge: "#2A1A10" },
    coral:    { ground: "#EE7357", light: "#FF9C7E", ring: "#FFEBD5", edge: "#2A1712" },
    sky:      { ground: "#8CC4E8", light: "#C2E2F7", ring: "#EE6C4E", edge: "#1C2430" },
    plum:     { ground: "#48224A", light: "#6E3A6C", ring: "#F58F84", edge: "#F2DCCB", dark: true },
    charcoal: { ground: "#242120", light: "#5A3A26", ring: "#EDA34B", edge: "#EFDCC0", dark: true },
    mint:     { ground: "#A3DCC3", light: "#D0F2E2", ring: "#13585D", edge: "#1A2623" },
    cream:    { ground: "#F6EBD7", light: "#FFF9EE", ring: "#D45E36", edge: "#1F1A16" },
    lilac:    { ground: "#BFAEEB", light: "#DDD2FA", ring: "#F0805F", edge: "#211A2E" },
    neutral:  { ground: "#DEDAD3", light: "#F1EEE9", ring: "#A39C92", edge: "#1F1A16" },
  };

  /** The family's head and visor shapes (bot fields), used by the versions and the shape grid. */
  const SHAPE = {
    rounded: { head: "rounded" },
    bun:     { head: "dome", hw: 312, hh: 300, shellN: 1.9, antenna: { len: 176 } },
    square:  { head: "square", hw: 292, hh: 300, shellN: 4.2, antenna: { len: 166 } },
    capsule: { head: "capsule", hw: 372, hh: 222 },
    oval:    { head: "oval", hw: 366, hh: 236 },
  };
  const VISOR = {
    rounded: {},
    band:  { visorKind: "band" },
    round: { visorKind: "round", visorW: 0.6 },
    twin:  { visorKind: "twin", plateLine: true },
    none:  { visor: false, plate: true },
  };

  /** The house style (v3): a slightly dry, uneven brush-ink line; flat fills; cel shadows. */
  function brush(K, o = {}) {
    const { headCY, hh } = K, { tip, ballR } = K.geo, ink = o.ink || PAL.ink, ly = K.S.edge.y;
    const pen = (w, extra = {}) => ({ color: ink, w, weight: 0.5, amp: 1.8, jit: 0.15, tooth: 0.24, paper: "coarse", ...extra });
    return {
      stalk: { color: o.stalkColor || ink, w: 16, amp: 0.8, jit: 0.12, tooth: 0.2, paper: "coarse" },
      ball: { color: vgrad(PAL.clayLight, PAL.clay, tip[1] - ballR, tip[1] + ballR * 0.4), p: 1 },
      ballShade: { color: PAL.clayDeep, p: 1, opacity: 0.6, crescent: [-16, -18, 4] },
      ballLine: pen(11, { amp: 1, start: 0.1 }),
      ballShine: { color: "#FCE6D4", p: 1 },
      ear: { color: PAL.clay, p: 1 },
      earShade: { color: PAL.clayDeep, p: 1, opacity: 0.55, crescent: [-14, -16, 4] },
      earLine: pen(11, { amp: 1 }),
      shell: { color: vgrad(PAL.cream, PAL.cream2, headCY - hh, headCY + hh * 0.5), p: 1 },
      shade: { color: PAL.shade, p: 1, opacity: 0.85, tooth: 0.24, paper: "coarse", crescent: [-58, -66, 5] },
      shellShine: { color: PAL.white, w: 22, opacity: 0.95, taper: [20, 30], amp: 0.8, jit: 0.15 },
      shellLine: pen(14, { start: 0.6, over: 0.07, drift: 5 }),
      visor: { color: vgrad(PAL.visorTop, PAL.visor, headCY - hh * 0.6, headCY + hh * 0.4), p: 1 },
      visorSheen: { color: "#FFFFFF", opacity: 0.05 },
      visorGlint: { color: PAL.white, w: 10, opacity: 0.5, taper: [10, 16], amp: 0.5 },
      eye: { p: 1 },
      eyeHalo: { opacity: 0.22 },
      catchlight: { color: "#FFFFFF", p: 1 },
      brow: { color: PAL.glow, w: 12, amp: 0.4, jit: 0.1 },
      mouth: { color: PAL.glow, w: 12, amp: 0.4, jit: 0.1 },
      mouthFill: { color: PAL.glow, p: 1 },
      hand: { color: vgrad(PAL.cream, PAL.cream2, ly - 50, ly + 40), p: 1 },
      handLine: pen(11, { amp: 0.9, start: 0.25 }),
      seam: { color: ink, w: 6.5, taper: [3, 9], amp: 0.3 },
      handShadow: { color: "#000000", p: 1, opacity: 0.13, blur: 5 },
      marks: { color: o.marks || ink, w: 8, jit: 0.15, tooth: 0.2, paper: "coarse" },
      ...o.over,
    };
  }

  /** The brush stroke behind (v3): lands slightly fat, runs round, thins and runs dry into bristles. */
  function enso(K, cx, cy, R, color, o = {}) {
    const N = 720, a0 = o.start ?? -0.3, sweep = o.sweep ?? Math.PI * 2 - 0.42, w = o.w ?? 54, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = a0 + sweep * t, rr = R * (1 + 0.022 * Math.sin(t * 6.3 + 1.2) - 0.018 * t);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a), a]);
    }
    const P = pts.map(([x, y]) => [x, y]), cut = 0.9, main = P.slice(0, Math.round(N * cut));
    const prof = (t) => (1 + 0.32 * Math.exp(-Math.pow(t / 0.035, 2)) + 0.06 * Math.sin(t * 13)) * (1 - 0.42 * Math.pow(t, 2.2));
    const common = { color, clip: K.above, opacity: o.opacity ?? 1 };
    K.line(main, { ...common, w, profile: prof, taper: [6, 26], tooth: 0.3, paper: "coarse", amp: 1.4, wl: 170, jit: 0.1 });
    const n = 7;
    for (let k = 0; k < n; k++) {
      const off = ((k - (n - 1) / 2) / ((n - 1) / 2)) * w * 0.3, i0 = Math.round(N * (0.8 + 0.03 * K.r())), i1 = Math.round(N * (0.93 + 0.07 * K.r()));
      const strand = pts.slice(i0, i1).map(([x, y, a]) => [x + Math.cos(a) * off * (1 + 0.25 * K.r()), y + Math.sin(a) * off]);
      if (strand.length > 4) K.line(strand, { ...common, w: w * (0.11 + 0.08 * K.r()), taper: [14, 40], tooth: 0.55, paper: "coarse", amp: 0.8, jit: 0.25 });
    }
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * w * 0.22 + K.r.pm(3), i0 = Math.round(N * (0.4 + 0.12 * k)), i1 = Math.round(N * cut);
      const streak = pts.slice(i0, i1).map(([x, y, a]) => [x + Math.cos(a) * off, y + Math.sin(a) * off]);
      K.line(streak, { color: o.ground, clip: K.above, w: 2.2 + K.r() * 1.5, taper: [30, 30], tooth: 0.6, paper: "coarse", amp: 0.6, opacity: 0.55 });
    }
  }

  /** "It just boinged": two short wobble arcs by the ball, on the side it swung from. */
  function ballWobble(K) {
    const { tip, ballR, base } = K.geo, lean = Math.atan2(tip[0] - base[0], base[1] - tip[1]);
    const side = lean < 0 ? 1 : -1, mid = side > 0 ? -0.15 : Math.PI + 0.15;
    for (const [k, gap, span] of [[0, 17, 0.5], [1, 33, 0.3]]) {
      const pts = G.arc(tip[0], tip[1], ballR + gap, ballR + gap, mid - span, mid + span, 30);
      K.line(pts, { ...K.st.marks, w: K.st.marks.w * (k ? 0.85 : 1), taper: [8, 8], clip: null });
    }
  }
  /** A tiny "pop": a burst of three short ticks around the top of the ball. */
  function popTicks(K) {
    const { tip, ballR } = K.geo;
    for (const a of [-1.05, 0, 1.05]) {
      const r0 = ballR + 20, r1 = ballR + (a === 0 ? 48 : 42);
      K.line(G.line([tip[0] + Math.sin(a) * r0, tip[1] - Math.cos(a) * r0], [tip[0] + Math.sin(a) * r1, tip[1] - Math.cos(a) * r1]), { ...K.st.marks, w: 9, taper: [4, 8], clip: null });
    }
  }
  /** A small sleepy "z" drawn with the brush. */
  function zee(K, x, y, s) {
    const pts = G.resample([[x, y], [x + s, y - 2], [x + 2, y + s * 0.95], [x + s * 1.05, y + s * 0.9]], 1, false);
    K.line(pts, { ...K.st.marks, w: 8, taper: [6, 8], clip: null, amp: 0.4 });
  }

  /** One version: a colourway from the palette, a face and a pose. */
  function make(id, name, note, col, P) {
    const c = C[col], sh = SHAPE[P.shape || "rounded"], vs = VISOR[P.visor || "rounded"];
    return {
      id, name, note, seed: P.seed ?? 1101, palette: col,
      ground(K) {
        K.art.paper({ color: c.ground, mottle: 0.018, grain: c.dark ? 0.045 : 0.03, warm: 0, vignette: c.dark ? 0.1 : 0.08, scale: 260 });
        K.glow([500, 420], 560, c.light, c.lightOpacity ?? 0.55, { clip: null, tooth: 0.08, mid: 0.45, midA: 0.5 });
        enso(K, 500, 522, 394, c.ring, { ground: c.ground, w: 54, start: P.ringStart, sweep: P.ringSweep });
      },
      edge: { y: 800, slope: P.slope ?? -0.01, line: { color: c.edge, w: 13, amp: 1, jit: 0.16, tooth: 0.24, paper: "coarse" },
        belowTint: c.dark ? null : mix([1, 1, 1], rgb(c.ground), 0.16), belowBlend: "multiply" },
      bot: {
        tilt: P.tilt ?? 0, rise: P.rise ?? 124, ...sh, ...vs,
        face: vs.plate ? { browsOnPlate: true, ...P.face } : vs.plateLine ? { browsOnPlate: true, mouthOnPlate: true, ...P.face } : P.face,
        antenna: { angle: -0.66, curl: 0.62, len: 190, ball: 52, glow: c.dark ? 0.28 : 0, ...sh.antenna, ...P.antenna },
      },
      style: (K) => {
        const ink = c.dark ? "#100D0C" : PAL.ink;
        const over = {
          browPlate: { color: ink, w: 13, amp: 0.4, jit: 0.1 }, mouthPlate: { color: ink, w: 12, amp: 0.4, jit: 0.1 },
          ...(vs.plate ? { eye: { color: ink, p: 1 }, eyeHalo: null } : {}),
          ...(vs.plateLine ? { visorLine: { color: ink, w: 10, weight: 0.4, amp: 1.2, jit: 0.12, tooth: 0.2, paper: "coarse" } } : {}),
        };
        return brush(K, { stalkColor: c.dark ? c.edge : null, marks: c.edge, ink, over });
      },
      after(K) { if (P.after) P.after(K); },
    };
  }

  const blush = PAL.blush;
  const FACE = {
    curious: { y: 0.08, look: [-30, -18], gaze: [-0.62, -0.84], h: 168,
      eyes: [{ hs: 1.08, ws: 1.05, brow: { gap: 9, len: 0.36, bend: 16, rot: 0.16, w: 12, dx: 14 } }, { hs: 0.92, ws: 0.95, dy: 8 }] },
  };
  const V = [
    make("1-curious", "1 · Curious", "Wide rounded head, rounded visor. Deep teal, apricot stroke. Wide eyes up at the antenna, one brow lifted.", "teal", {
      tilt: 0.19, face: FACE.curious,
      antenna: { boing: { amp: 10, waves: 1.3, phase: 0.5 } }, after: ballWobble,
    }),
    make("2-happy", "2 · Happy", "Bun head, round screen. Marigold, cream stroke. A soft happy squint, rosy cheeks, the antenna bouncing.", "marigold", {
      shape: "bun", visor: "round", tilt: -0.12, rise: 158,
      face: { y: -0.12, spread: 0.46, eyes: [{ arc: { w: 38, rx: 0.48, ry: 0.3, rot: 0.04 } }, { arc: { w: 38, rx: 0.48, ry: 0.3, rot: 0.04 } }],
        blush, blushY: 44, blushX: 14, blushW: 38, blushH: 20, mouth: "smile", mouthY: 92, mouthW: 26, mouthH: 16 },
      antenna: { angle: 0.22, curl: -0.35, boing: { amp: 9, waves: 1.3 } }, after: ballWobble,
    }),
    make("3-smirk", "3 · Smirk", "Wide capsule head, rounded visor. Coral, cream stroke. Half-lidded and pleased with itself: one brow up, a lopsided smirk.", "coral", {
      shape: "capsule", tilt: 0.1, rise: 156,
      face: { y: -0.1, h: 146, look: [10, 0], spread: 0.48,
        eyes: [{ lid: [0.42, -0.05], catchDy: 0.3, brow: { gap: -52, len: 0.5, bend: 4, rot: -0.08, w: 12 } },
               { lid: [0.36, 0.05], catchDy: 0.26, brow: { gap: 12, len: 0.48, bend: 28, rot: 0.18, w: 13 } }],
        mouth: "smirk", mouthY: 100, mouthX: 18, mouthW: 30, mouthH: 16 },
      antenna: { angle: 0.36, curl: 0.25 },
    }),
    make("4-oh", "4 · Oh!", "Squashed oval, no visor: ink eyes on the face plate. Sky blue, coral stroke. Brows up, a tiny 'o'; the antenna pops.", "sky", {
      shape: "oval", visor: "none", tilt: -0.05, rise: 132,
      face: { y: -0.16, w: 86, h: 118, spread: 0.44,
        eyes: [{ n: 2.1, brow: { gap: 30, len: 0.56, bend: 24, rot: 0.1, w: 13 } }, { n: 2.1, brow: { gap: 30, len: 0.56, bend: 24, rot: 0.1, w: 13 } }],
        mouth: "o", mouthY: 96, mouthR: 17, blush, blushX: 30, blushY: 66, blushW: 36, blushH: 18, blushOpacity: 0.7 },
      antenna: { angle: 0.04, curl: 0, boing: { amp: 8, waves: 1.6 } }, after: popTicks,
    }),
    make("5-wink", "5 · Wink", "Tall rounded square, two eye windows, brows drawn on the face plate. Deep plum, coral stroke. A wink and a cocked brow.", "plum", {
      shape: "square", visor: "twin", tilt: 0.14, rise: 138,
      face: { y: 0.02, h: 150, w: 112, spread: 0.5,
        eyes: [{ hs: 1.0, brow: { gap: 40, len: 0.55, bend: 40, rot: -0.1, w: 15 } },
               { arc: { w: 34, ry: 0.24, dy: 0.12, rot: -0.06 }, brow: { gap: 28, len: 0.5, bend: 6, rot: -0.3, w: 14 } }],
        mouth: "smile", mouthY: 112, mouthX: 10, mouthW: 22, mouthH: 13 },
      antenna: { angle: 0.32, curl: 0.15 }, after: (K) => K.fill(M.sparkle(K.geo.tip[0] + 100, K.geo.tip[1] + 50, 26, 0.1, 0.22), { color: "#F6E4C8", p: 1, clip: null }),
    }),
    make("6-sleepy", "6 · Content", "Bun head, rounded visor. Warm charcoal with an amber glow and stroke. Eyes gently closed, cheeks, a 'z z'.", "charcoal", {
      shape: "bun", tilt: -0.16, rise: 128,
      face: { y: 0.04, eyes: [{ arc: { down: true, w: 32, rx: 0.46, ry: 0.24, dy: -0.06 } }, { arc: { down: true, w: 32, rx: 0.46, ry: 0.24, dy: -0.06 } }],
        blush, blushY: 46, blushX: 26, blushW: 40, blushH: 19, blushOpacity: 0.6 },
      antenna: { angle: -0.95, curl: 1.15, len: 180 },
      after: (K) => { zee(K, K.geo.tip[0] + 88, K.geo.tip[1] - 56, 30); zee(K, K.geo.tip[0] + 132, K.geo.tip[1] - 100, 20); },
    }),
    make("7-glance", "7 · Side-eye", "Wide rounded head, band visor, the brow drawn on the face plate. Fresh mint, teal stroke. A sideways glance: \"hmm?\"", "mint", {
      visor: "band", tilt: -0.1, rise: 128,
      face: { y: 0.04, look: [50, -2], gaze: [0.85, -0.35], h: 156, spread: 0.46, browsOnPlate: true,
        eyes: [{ hs: 0.96 }, { hs: 1.04, brow: { gap: 40, len: 0.46, bend: 26, rot: 0.2, w: 14, dx: -14 } }] },
      antenna: { angle: -0.4, curl: 0.4, boing: { amp: 8, waves: 1.3 } }, after: ballWobble,
    }),
    make("8-sparkle", "8 · Delighted", "Squashed oval, round screen. Clean cream, strong clay stroke. Sparkling star eyes, rosy cheeks, antenna boinging.", "cream", {
      shape: "oval", visor: "round", tilt: 0.06, rise: 126,
      face: { y: 0.02, spread: 0.46, eyes: [{ star: { R: 0.86, aspect: 1.18 } }, { star: { R: 0.86, aspect: 1.18 } }],
        blush, blushY: 52, blushX: 14, blushW: 38, blushH: 20 },
      antenna: { angle: 0.12, curl: -0.3, boing: { amp: 10, waves: 1.5 } }, after: ballWobble,
    }),
    make("9-curious-twin", "9 · Curious, windows", "Tall rounded square, two eye windows, a brow on the face plate. Lilac, coral stroke. Looking up at the antenna.", "lilac", {
      shape: "square", visor: "twin", tilt: 0.17, rise: 132,
      face: { y: 0.06, look: [-18, -16], gaze: [-0.62, -0.84], h: 150, w: 112, spread: 0.5,
        eyes: [{ hs: 1.06, ws: 1.04, brow: { gap: 36, len: 0.5, bend: 26, rot: 0.12, w: 14 } }, { hs: 0.94, dy: 6 }] },
      antenna: { angle: -0.6, curl: 0.6, boing: { amp: 9, waves: 1.3, phase: 0.5 } }, after: ballWobble,
    }),
  ];

  // The shape grid: the same face in one neutral colour. Row 1: head shapes (rounded visor). Row 2: visors.
  const shapeSpec = (id, name, shape, visor, face) => make(id, name, "", "neutral", {
    shape, visor, tilt: 0.12, rise: visor === "none" ? 132 : 128,
    face: face || (visor === "none"
      ? { y: -0.12, w: 86, h: 118, spread: 0.44, look: [-14, -10], eyes: [{ hs: 1.06, brow: { gap: 20, len: 0.5, bend: 16, rot: 0.1, w: 12 } }, { hs: 0.94 }] }
      : visor === "twin" ? { y: 0.06, look: [-14, -12], gaze: [-0.62, -0.84], h: 150, w: 112, spread: 0.5, eyes: [{ hs: 1.06 }, { hs: 0.94 }] }
      : { ...FACE.curious, look: [-24, -14], ...(visor === "round" ? { spread: 0.44, h: 150, w: 112 } : visor === "band" ? { h: 150, spread: 0.46 } : {}),
          eyes: [{ hs: 1.06, ws: 1.04 }, { hs: 0.94, dy: 6 }] }),
    antenna: { angle: -0.5, curl: 0.5 },
  });
  HD.SHAPES = [
    shapeSpec("h1-rounded", "Wide rounded", "rounded", "rounded"),
    shapeSpec("h2-bun", "Bun / dome", "bun", "rounded"),
    shapeSpec("h3-square", "Tall rounded square", "square", "rounded"),
    shapeSpec("h4-capsule", "Wide capsule", "capsule", "rounded"),
    shapeSpec("h5-oval", "Squashed oval", "oval", "rounded"),
    shapeSpec("v1-rounded", "Visor: rounded", "rounded", "rounded"),
    shapeSpec("v2-band", "Visor: wide band", "rounded", "band"),
    shapeSpec("v3-round", "Visor: round screen", "rounded", "round"),
    shapeSpec("v4-twin", "Visor: two windows", "rounded", "twin"),
    shapeSpec("v5-none", "No visor: face plate", "rounded", "none"),
  ];
  HD.VERSIONS = V;
  HD.PALETTE4 = C;
})();
