/* X0 Bot, hand-drawn icons v2: the versions. Each sets a ground, the pose and the feeling, and the
 * media of each part. Seeds make them repeatable. */
(function () {
  "use strict";
  const { PAL, G, M, vgrad } = HD;

  /** The house style: clean brush-ink line with weight, flat fills with a soft gradient, cel shadows. */
  function brush(K, o = {}) {
    const { headCY, hh } = K, { tip, ballR } = K.geo, ink = o.ink || PAL.ink, ly = K.S.edge.y;
    return {
      stalk: { color: ink, w: 16, amp: 0.8 },
      ball: { color: vgrad(PAL.clayLight, PAL.clay, tip[1] - ballR, tip[1] + ballR * 0.4), p: 1 },
      ballShade: { color: PAL.clayDeep, p: 1, opacity: 0.6, crescent: [-16, -18, 4] },
      ballLine: { color: ink, w: 11, weight: 0.5, amp: 0.8 },
      ballShine: { color: "#FCE6D4", p: 1 },
      ear: { color: PAL.clay, p: 1 },
      earShade: { color: PAL.clayDeep, p: 1, opacity: 0.55, crescent: [-14, -16, 4] },
      earLine: { color: ink, w: 11, weight: 0.45, amp: 0.8 },
      shell: { color: vgrad(PAL.cream, PAL.cream2, headCY - hh, headCY + hh * 0.5), p: 1 },
      shade: { color: PAL.shade, p: 1, opacity: 0.85, tooth: 0.22, paper: "coarse", crescent: [-58, -66, 5] },
      shellShine: { color: PAL.white, w: 22, opacity: 0.95, taper: [20, 26], amp: 0.6 },
      shellLine: { color: ink, w: 14, weight: 0.45, amp: 1.6, start: 0.62 },
      visor: { color: vgrad(PAL.visorTop, PAL.visor, headCY - hh * 0.6, headCY + hh * 0.4), p: 1 },
      visorSheen: { color: "#FFFFFF", opacity: 0.05 },
      visorGlint: { color: PAL.white, w: 10, opacity: 0.5, taper: [10, 16], amp: 0.5 },
      eye: { p: 1 },
      eyeHalo: { opacity: 0.2 },
      catchlight: { color: "#FFFFFF", p: 1 },
      brow: { color: PAL.glow, w: 15, amp: 0.4 },
      hand: { color: vgrad(PAL.cream, PAL.cream2, ly - 50, ly + 40), p: 1 },
      handShade: null,
      handLine: { color: ink, w: 11, weight: 0.45, amp: 0.8, start: 0.25 },
      seam: { color: ink, w: 6.5, taper: [3, 9], amp: 0.3 },
      handShadow: { color: "#000000", p: 1, opacity: 0.12, blur: 5 },
      ...o,
    };
  }

  /** One confident open brush ring (an ensō): thick where the brush lands, thinning and drying out. */
  function enso(K, cx, cy, R, color, o = {}) {
    const a0 = o.start ?? -2.2, sweep = o.sweep ?? 5.75, pts = [];
    for (let i = 0; i <= 400; i++) {
      const t = i / 400, a = a0 + sweep * t, rr = R * (1 + 0.025 * Math.sin(t * 7.1) - 0.02 * t);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a) * (o.squash ?? 1)]);
    }
    const prof = o.profile || ((t) => (0.75 + 0.55 * Math.exp(-Math.pow((t - 0.05) / 0.06, 2)) + 0.12 * Math.sin(t * 9)) * (1 - 0.6 * Math.pow(t, 1.4)));
    K.line(pts, { color, w: o.w ?? 40, profile: prof, taper: [30, 90], tooth: 0.32, paper: "coarse", amp: 2, wl: 140, clip: K.above, opacity: o.opacity ?? 1, jit: 0.1 });
    // the dry tail: a few bristle streaks
    for (let k = 0; k < 4; k++) {
      const off = (k - 1.5) * 7, tail = pts.slice(300 + k * 8, 400 - k * 6).map(([x, y]) => { const a = Math.atan2(y - cy, x - cx); return [x + Math.cos(a) * off, y + Math.sin(a) * off]; });
      K.line(tail, { color, w: 4 + K.r() * 3, taper: [20, 40], tooth: 0.55, paper: "coarse", amp: 1, clip: K.above, opacity: (o.opacity ?? 1) * 0.8 });
    }
  }

  const V = [];

  // 1 · Happy: clay ground, warm light behind, happy squint with lifted cheeks and a blush.
  V.push({
    id: "1-happy", name: "1 · Happy", note: "Clay ground with warm light. A happy squint with lifted cheeks, a blush, head tilted, antenna bouncing.",
    seed: 2202,
    ground(K) {
      K.art.paper({ color: "#C86A42", mottle: 0.03, grain: 0.04, vignette: 0.05 });
      K.glow([500, 470], 540, "#F3A57B", 0.55, { clip: null, tooth: 0.1 });
    },
    edge: { y: 800, slope: -0.008, line: { color: "#2A1A12", w: 13, amp: 0.8 }, belowTint: "#EBD2C2" },
    bot: {
      tilt: -0.14, rise: 106,
      face: { y: 0.02, eyes: [{ arc: { w: 50, rx: 0.5, ry: 0.32, rot: 0.04 } }, { arc: { w: 50, rx: 0.5, ry: 0.32, rot: 0.04 } }], blush: PAL.blush, blushY: 40, blushX: 36, blushW: 48, blushH: 25 },
      antenna: { angle: 0.24, curl: -0.4, len: 180, ball: 54 },
    },
    style: (K) => brush(K),
    after(K) { // two short bounce marks by the ball
      const { tip, ballR } = K.geo;
      for (const [a, k] of [[0.5, 1], [0.95, 0.8]]) {
        const r0 = ballR + 20, r1 = ballR + 20 + 30 * k;
        K.line(G.line([tip[0] + Math.sin(a) * r0, tip[1] - Math.cos(a) * r0], [tip[0] + Math.sin(a) * r1, tip[1] - Math.cos(a) * r1]), { color: "#2A1A12", w: 10, taper: [4, 10], clip: null });
      }
    },
  });

  // 2 · Wink: ink-dark ground, the antenna's warm glow, a wink and a raised brow on the visor.
  V.push({
    id: "2-wink", name: "2 · Wink", note: "Ink-dark ground, chalky edge, warm glow off the antenna. A wink, the other brow cocked high, head tilted.",
    seed: 3303,
    ground(K) {
      K.art.paper({ color: "#221E1B", mottle: 0.05, grain: 0.07, vignette: 0.0, scale: 220 });
      K.glow([500, 560], 470, "#5B3B2A", 0.5, { clip: null, tooth: 0.1 });
    },
    edge: { y: 800, slope: 0.01, line: { color: "#EFDCC0", w: 11, tooth: 0.35, paper: "coarse", amp: 0.8 } },
    bot: {
      tilt: 0.15, rise: 124,
      face: {
        y: 0.17, look: [8, -4],
        eyes: [
          { hs: 1.0, brow: { gap: 22, len: 0.5, bend: 58, rot: -0.12, w: 17, dx: 4 } },
          { arc: { w: 38, ry: 0.24, dy: 0.14, rot: -0.06 }, brow: { gap: 10, len: 0.48, bend: 10, rot: -0.3, w: 15, dx: -8 } },
        ],
      },
      antenna: { angle: 0.3, curl: 0.15, len: 182, ball: 52, glow: 0.4, glowR: 2.8 },
    },
    style: (K) => brush(K, { stalk: { color: "#EFDCC0", w: 16, amp: 0.8, tooth: 0.2 }, ink: "#120F0D" }),
    after(K) { // one sparkle
      const { tip } = K.geo;
      K.fill(M.sparkle(tip[0] + 112, tip[1] + 58, 30, 0.1, 0.22), { color: "#F6E4C8", p: 1, clip: null });
    },
  });

  // 3 · Curious: cream paper, one clay ensō behind, wide eyes up at the antenna, head cocked hard.
  V.push({
    id: "3-curious", name: "3 · Curious", note: "Cream paper and one clay brush ring. Wide eyes looking up at its own antenna, head cocked hard.",
    seed: 1101,
    ground(K) {
      K.art.paper({ color: "#F4E8D5", mottle: 0.025, grain: 0.04, warm: 0.03, vignette: 0.04 });
      enso(K, 500, 522, 394, "#D47A52", { w: 58, start: 1.3, sweep: 5.25,
        profile: (t) => (0.45 + 0.85 * Math.exp(-Math.pow((t - 0.36) / 0.2, 2)) + 0.06 * Math.sin(t * 11)) * (1 - 0.35 * Math.pow(t, 2)) });
    },
    edge: { y: 800, slope: -0.01, line: { color: PAL.ink, w: 13, amp: 0.8 }, belowTint: "#F1E6D8" },
    bot: {
      tilt: 0.19, rise: 124,
      face: {
        y: 0.04, look: [-34, -22],
        eyes: [
          { hs: 1.08, ws: 1.02 },
          { hs: 0.96, ws: 0.96 },
        ],
      },
      antenna: { angle: -0.66, curl: 0.62, len: 190, ball: 52 },
    },
    style: (K) => brush(K),
    after(K) { // a little swing mark on the far side of the ball
      const { tip, ballR, base } = K.geo, lean = Math.atan2(tip[0] - base[0], base[1] - tip[1]);
      const R = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
      for (const k of [0, 1]) {
        const a0 = lean + 0.34 + k * 0.08, a1 = lean + 0.55 + k * 0.1, RR = R + (k ? -26 : 4);
        const pts = []; for (let i = 0; i <= 30; i++) { const t = a0 + ((a1 - a0) * i) / 30; pts.push([base[0] + Math.sin(t) * RR, base[1] - Math.cos(t) * RR]); }
        K.line(pts, { color: PAL.ink, w: k ? 8 : 9, taper: [10, 12], clip: null });
      }
      void ballR;
    },
  });

  // 4 · Peekaboo: new. Just the top of the head, the eyes and two hands over one line, Kilroy-style.
  V.push({
    id: "4-peekaboo", name: "4 · Peekaboo", note: "New: Kilroy-style, just the head, eyes and hands over a single line on sand card. A shy glance away, brows up, a blush.",
    seed: 4404,
    ground(K) {
      K.art.paper({ color: "#DDB993", mottle: 0.03, grain: 0.045, warm: 0.02, vignette: 0.04 });
    },
    edge: { y: 660, slope: 0, line: { color: PAL.ink, w: 14, amp: 0.6 }, oneStroke: true },
    bot: {
      hw: 352, hh: 272, tilt: -0.05, rise: 140, handSpread: 0.74, handScale: 1.08,
      face: {
        y: 0.1, look: [-40, 10],
        eyes: [
          { hs: 0.94, lid: [0.12, -0.3], brow: { gap: 26, len: 0.5, bend: 6, rot: 0.3, w: 14 } },
          { hs: 0.94, lid: [0.12, 0.3], brow: { gap: 26, len: 0.5, bend: 6, rot: 0.3, w: 14 } },
        ],
        blush: PAL.blush, blushY: 74, blushX: 46, blushW: 42, blushH: 20,
      },
      antenna: { len: 190, ball: 50, path: [[0.0, -0.6], [-0.2, -1.0], [-0.62, -0.86]] },
    },
    style: (K) => brush(K),
  });

  // 5 · Oh!: new. Brush-ink minimal, eyes straight on the face plate, the antenna one calligraphic stroke.
  V.push({
    id: "5-oh", name: "5 · Oh!", note: "New: brush-ink minimal. Ink eyes straight on the face plate, brows up, a little 'o'; the antenna is one whippy brush stroke.",
    seed: 5505,
    ground(K) {
      K.art.paper({ color: "#F3D0B6", mottle: 0.03, grain: 0.04, vignette: 0.04 });
    },
    edge: { y: 800, slope: 0.006, line: { color: PAL.ink, w: 13, amp: 0.8 }, belowTint: "#F4E4D8" },
    bot: {
      visor: false, tilt: -0.11, rise: 130,
      face: {
        y: -0.22, spread: 0.46, w: 88, h: 124,
        eyes: [
          { brow: { gap: 30, len: 0.62, bend: 18, rot: -0.14, w: 13 } },
          { brow: { gap: 34, len: 0.62, bend: 18, rot: 0.1, w: 13 } },
        ],
        mouth: "o", mouthY: 100, mouthR: 19, blush: PAL.blush, blushX: 44, blushY: 84, blushW: 36, blushH: 18, blushOpacity: 0.7,
      },
      antenna: { len: 200, ball: 50, path: [[0.5, -0.22], [-0.55, -0.6], [0.16, -1.0]] },
    },
    style: (K) => brush(K, {
      stalk: { color: PAL.ink, w: 15, amp: 0.4, profile: (t) => 0.55 + 1.1 * Math.pow(Math.sin(Math.PI * t), 0.8) * (1 - 0.35 * t), taper: [6, 10] },
      ballLine: null, ballShade: { color: PAL.clayDeep, p: 1, opacity: 0.35, crescent: [-14, -16, 4] },
      eye: { color: PAL.ink, p: 1 }, eyeHalo: null,
      catchlight: { color: "#FFFFFF", p: 1 },
      brow: { color: PAL.ink, w: 13, amp: 0.4 },
      mouthFill: { color: PAL.ink, p: 1 },
    }),
  });

  HD.VERSIONS = V;
})();
