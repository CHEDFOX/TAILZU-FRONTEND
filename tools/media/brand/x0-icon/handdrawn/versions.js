/* X0 Bot, hand-drawn icons: the versions. Each one sets a ground, the bot's pose and feeling, and
 * the media of each part. Seeds make them repeatable. */
(function () {
  "use strict";
  const { PAL, rgb, mix, smooth, G, M } = HD;
  const INK = PAL.ink;
  /** Vertical two-colour gradient as a colour function. */
  const vgrad = (a, b, y0, y1) => { const A = rgb(a), B = rgb(b); return (x, y) => mix(A, B, smooth(y0, y1, y)); };

  /** Everything drawn: brush-ink outlines, crayon-textured fills. o overrides any part. */
  function inked(K, o = {}) {
    const y0 = K.headCY - K.hh, y1 = K.headCY + K.hh, ink = o.ink || INK;
    return {
      stalk: { color: ink, w: 16, tooth: 0.25, amp: 1.5, taper: [4, 10] },
      ball: { color: PAL.clay, base: true, p: 0.9, tooth: 0.45, paper: "coarse", amp: 1.5, hatch: { angle: -0.8, gap: 8, p: 0.5 } },
      ballLine: { color: ink, w: 11, amp: 1.4, over: 0.08, weight: 0.4 },
      ballShine: { color: "#F8DCC4", tooth: 0.3, opacity: 0.85 },
      ear: { color: PAL.clay, base: true, tooth: 0.4, paper: "coarse", amp: 1.5, hatch: { angle: -0.9, gap: 8, p: 0.4 } },
      earLine: { color: ink, w: 11, amp: 1.5, weight: 0.4 },
      shell: { color: vgrad(PAL.cream, PAL.cream2, y0, y1), base: true, p: 0.85, tooth: 0.3, paper: "coarse", amp: 2, hatch: { angle: -0.7, gap: 10, p: 0.45 } },
      shade: { color: PAL.tan, p: 0.45, tooth: 0.6, paper: "coarse", opacity: 0.9, hatch: { angle: -0.78, gap: 9, p: 0.55, w: 10 }, crescent: [-46, -52, 12] },
      shellShine: { color: PAL.white, w: 18, tooth: 0.45, opacity: 0.95, taper: [16, 22] },
      shellLine: { color: ink, w: 13, amp: 3, start: 0.62, weight: 0.38 },
      visor: { color: PAL.visor, base: true, p: 1, tooth: 0.15, amp: 1.5 },
      visorGlint: { color: PAL.white, w: 11, tooth: 0.5, opacity: 0.4, taper: [10, 16] },
      eye: { color: PAL.glow, p: 1, tooth: 0.1, amp: 1.2 },
      eyeHalo: { opacity: 0.22 },
      paw: { color: vgrad(PAL.cream, PAL.cream2, K.ly - 40, K.ly + 50), base: true, p: 0.9, tooth: 0.3, paper: "coarse", amp: 1.5 },
      pawShade: { color: PAL.tan, p: 0.7, tooth: 0.6, paper: "coarse", opacity: 0.85, crescent: [-12, -24, 5] },
      pawLine: { color: ink, w: 11, amp: 1.5, start: 0.15, weight: 0.4 },
      finger: { color: ink, w: 8, taper: [4, 8] },
      marks: { color: ink, w: 10, amp: 1 },
      ...o,
    };
  }

  /** Painted bot: no outline, soft gouache-like fills with crayon shading. */
  function painted(K, o = {}) {
    const y0 = K.headCY - K.hh, y1 = K.headCY + K.hh;
    return {
      stalk: { color: PAL.cream2, w: 24, tooth: 0.2, amp: 1.2, taper: [2, 4] },
      ball: { color: PAL.clay, base: true, p: 0.9, tooth: 0.35, paper: "coarse", amp: 1.2, hatch: { angle: -0.8, gap: 8, p: 0.4 } },
      ballShine: { color: "#F3C9AE", tooth: 0.3, opacity: 0.9 },
      ear: { color: PAL.clay, base: true, tooth: 0.35, paper: "coarse", amp: 1.2 },
      shell: { color: vgrad(PAL.cream, PAL.cream2, y0, y1), base: true, p: 0.9, tooth: 0.25, paper: "coarse", amp: 1.6, hatch: { angle: -0.7, gap: 11, p: 0.4 } },
      shade: { color: "#D5AE82", p: 0.5, tooth: 0.5, paper: "coarse", opacity: 0.95, hatch: { angle: -0.78, gap: 9, p: 0.6, w: 12 }, crescent: [-46, -52, 14] },
      shellShine: { color: PAL.white, w: 20, tooth: 0.35, opacity: 0.95, taper: [16, 22] },
      visor: { color: PAL.visor, base: true, p: 1, tooth: 0.12, amp: 1.2 },
      visorGlint: { color: PAL.white, w: 11, tooth: 0.5, opacity: 0.35, taper: [10, 16] },
      eye: { color: PAL.glow, p: 1, tooth: 0.08, amp: 1 },
      eyeHalo: { opacity: 0.26 },
      paw: { color: vgrad(PAL.cream, PAL.cream2, K.ly - 40, K.ly + 50), base: true, p: 0.9, tooth: 0.25, paper: "coarse", amp: 1.2 },
      pawShade: { color: "#D5AE82", p: 0.75, tooth: 0.5, paper: "coarse", opacity: 0.85, crescent: [-12, -24, 6] },
      finger: { color: "#B48C60", w: 8, taper: [4, 8] },
      marks: { color: PAL.cream, w: 10, amp: 1, tooth: 0.6 },
      ...o,
    };
  }

  /** A crayon ground: light paper, then a colour laid over in broad strokes, flecks of paper left. */
  function crayonGround(K, paperColor, color, o = {}) {
    K.art.paper({ color: paperColor, mottle: 0.03, grain: 0.06, vignette: 0.0 });
    K.mark(color, { tooth: o.tooth ?? 0.55, paper: "coarse", gain: o.gain ?? 1.1 }, (c) => {
      c.globalAlpha = o.p ?? 0.82; c.fillRect(-50, -50, 1100, 1100); c.globalAlpha = 1;
      M.hatch(c, null, { r: K.r, noise: K.n, angle: o.angle ?? -0.55, gap: 15, p: 0.45, w: 22, wave: 4 });
    });
    if (o.over) K.mark(o.over, { tooth: 0.7, paper: "coarse", opacity: o.overOpacity ?? 0.35 }, (c) =>
      M.hatch(c, null, { r: K.r, noise: K.n, angle: (o.angle ?? -0.55) + 0.12, gap: 26, p: 0.5, pjit: 0.6, w: 18, wave: 6 }));
  }

  const V = [];

  // 1 · Curious: cream paper, everything inked with a brush pen, a scribbled clay sun behind.
  V.push({
    id: "1-curious", name: "1 · Curious", note: "Cream paper, brush ink, crayon fills. Looks up at its swinging antenna, one eye wider.",
    seed: 1101,
    ground(K) {
      K.art.paper({ color: "#F3E6D0", mottle: 0.035, grain: 0.07, warm: 0.04, vignette: 0.05 });
      K.mark("#E7A783", { tooth: 0.7, paper: "coarse", opacity: 0.66 }, (c) => M.scribbleDisc(c, 506, 418, 300, { r: K.r, angle: -0.62, gap: 12, p: 0.75, ragged: 16, w: 17 }));
    },
    ledge: {
      y: 716, slope: -0.012, wave: 3,
      face: { color: PAL.clay, base: true, p: 0.8, tooth: 0.5, paper: "coarse", hatch: { angle: 0.12, gap: 9, p: 0.5, w: 13 } },
      lip: { color: PAL.clayDeep, p: 1, tooth: 0.55, paper: "coarse", depth: 64, opacity: 0.55, hatch: { angle: -0.9, gap: 10, p: 0.6 } },
      line: { color: INK, w: 15, amp: 1.2 },
      ticks: { pen: { color: PAL.clayDeep, w: 8, amp: 0.8, tooth: 0.4 }, len: 42,
        at: [[40, 0.8], [72, 1], [104, 0.9], [136, 0.7], [866, 0.8], [898, 1], [930, 0.9], [962, 0.75]] },
    },
    bot: {
      tilt: 0.1, rise: 64,
      face: { eyes: "pill", look: [-44, -38], h: 114, left: { hs: 1.12, ws: 1.04 }, right: { hs: 0.88, dy: 4 } },
      antenna: { angle: -0.62, curl: 0.3, len: 176, ball: 48, marks: "swing" },
    },
    style: (K) => inked(K, { pawShadow: { color: PAL.clayDeep, p: 0.9, tooth: 0.6, paper: "coarse", opacity: 0.5 } }),
  });

  // 2 · Happy: clay crayon ground, charcoal ledge, a happy squint and a bob of the antenna.
  V.push({
    id: "2-happy", name: "2 · Happy", note: "Clay crayon ground, charcoal ledge, inked bot. Happy squint, a blush, the antenna bobbing.",
    seed: 2202,
    ground(K) {
      crayonGround(K, "#EDC2A6", PAL.clay, { over: "#B5532F", overOpacity: 0.3 });
      K.mark(PAL.cream, { tooth: 0.75, paper: "coarse", opacity: 0.16 }, (c) => M.scribbleDisc(c, 500, 410, 300, { r: K.r, angle: 0.7, gap: 13, p: 0.8, ragged: 18, w: 16 }));
    },
    ledge: {
      y: 716, slope: 0.01, wave: 3,
      face: { color: "#2A2420", base: true, p: 0.85, tooth: 0.5, paper: "coarse", hatch: { angle: -0.08, gap: 10, p: 0.5, w: 14 } },
      face2: { color: "#4A3F37", p: 0, tooth: 0.75, paper: "coarse", opacity: 0.5, hatch: { angle: 0.6, gap: 16, p: 0.5, w: 10 } },
      line: { color: "#E9C8A6", w: 7, amp: 1, tooth: 0.75, opacity: 0.55 }, lineFrom: 60, lineTo: 940,
    },
    bot: {
      tilt: -0.05, rise: 70,
      face: { eyes: "happy", look: [0, 4], stroke: 32, blush: "#E2765A", blushOpacity: 0.8 },
      antenna: { angle: 0.14, curl: -0.25, len: 172, ball: 48, marks: "bob" },
    },
    style: (K) => inked(K, { ball: { color: "#E07548", base: true, p: 0.9, tooth: 0.45, paper: "coarse", amp: 1.5, hatch: { angle: -0.8, gap: 8, p: 0.5 } },
      ear: { color: "#9E4A2A", base: true, tooth: 0.4, paper: "coarse", amp: 1.5 }, marks: { color: INK, w: 11, amp: 1 } }),
  });

  // 3 · Wink: chalkboard ground; the ledge and the antenna drawn in chalk, the bot painted.
  V.push({
    id: "3-wink", name: "3 · Wink", note: "Ink-black ground, chalk ledge and chalk antenna, painted bot. A cheeky wink, a chalk sparkle.",
    seed: 3303,
    ground(K) {
      K.art.paper({ color: "#25211E", mottle: 0.06, grain: 0.16, vignette: 0.0, scale: 200 });
      K.mark(PAL.cream, { tooth: 0.85, paper: "coarse", opacity: 0.1 }, (c) => M.scribbleDisc(c, 500, 420, 310, { r: K.r, angle: -0.5, gap: 12, p: 0.7, ragged: 20, w: 18 }));
      K.mark(PAL.cream, { tooth: 0.95, paper: "coarse", opacity: 0.05 }, (c) => { c.globalAlpha = 0.5; c.fillRect(-50, -50, 1100, 1100); });
    },
    ledge: {
      y: 716, slope: -0.01, wave: 3,
      face: { color: "#2D2824", base: true, p: 0.7, tooth: 0.6, paper: "coarse" },
      face2: { color: PAL.cream, p: 0, tooth: 0.85, paper: "coarse", opacity: 0.32, hatch: { angle: -0.85, gap: 22, p: 0.75, w: 7, wave: 1.5 },
        fade: [500, 716, 500, 900, 1, 0.15] },
      line: { color: PAL.cream, w: 13, amp: 1.4, tooth: 0.72, gain: 1.1 },
      line2: { from: 520, to: 1040, dy: 5, w: 8, opacity: 0.6 },
    },
    bot: {
      tilt: -0.1, rise: 66,
      face: { eyes: "wink", look: [-8, -4], left: { hs: 1.05 }, right: { rx: 44, ry: 36, rot: -0.12 }, mouth: "smirk", mouthX: 14, mouthY: 70 },
      antenna: { angle: 0.32, curl: 0.0, len: 168, ball: 46, glow: 0.5, glowR: 2.6 },
    },
    style: (K) => painted(K, {
      stalk: { color: PAL.cream, w: 15, tooth: 0.7, amp: 2, taper: [3, 12], paper: "coarse", gain: 1.15 },
      finger: { color: "#8E6B48", w: 8, taper: [4, 8] },
      pawShadow: { color: "#000000", p: 0.9, tooth: 0.3, opacity: 0.35 },
    }),
    after(K) { // a chalk sparkle by the wink
      const { tip, ballR } = K.geo, sp = M.sparkle(tip[0] + 118, tip[1] + 86, 30, 0.12, 0.2);
      K.fill(sp, { color: PAL.cream, p: 1, tooth: 0.6, paper: "coarse", gain: 1.1 });
      K.fill(M.sparkle(tip[0] + 170, tip[1] + 40, 14, 0.3, 0.22), { color: PAL.cream, p: 1, tooth: 0.6, paper: "coarse", opacity: 0.8 });
    },
  });

  // 4 · Shy: kraft card, a torn sheet of paper as the edge, pencil line. One paw, a sideways glance.
  V.push({
    id: "4-shy", name: "4 · Shy", note: "Kraft card and a torn paper edge, pencil line. Peeks lower, one paw, a shy sideways glance and a blush.",
    seed: 4404,
    ground(K) {
      K.art.paper({ color: "#CDA77C", mottle: 0.05, grain: 0.09, warm: 0.03, vignette: 0.06 });
      // kraft fibres
      K.mark("#A9845B", { tooth: 0.5, paper: "fine", opacity: 0.35 }, (c) => {
        for (let i = 0; i < 260; i++) {
          const x = K.r() * 1000, y = K.r() * 1000, a = K.r() * Math.PI, L = 6 + K.r() * 22;
          c.globalAlpha = 0.3 + K.r() * 0.5; c.lineWidth = 0.8 + K.r() * 1.2;
          c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + K.r.pm(4), y + Math.sin(a) * L * 0.5 + K.r.pm(4), x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke();
        }
      });
      // a white-pencil glow scribbled behind the head
      K.mark("#F6E9D6", { tooth: 0.75, paper: "coarse", opacity: 0.4 }, (c) => M.scribbleDisc(c, 486, 470, 290, { r: K.r, angle: -0.7, gap: 12, p: 0.75, ragged: 18, w: 15 }));
    },
    ledge: { y: 726, slope: 0.018 },
    ledgeDraw: tornPaper,
    bot: {
      tilt: 0.15, rise: 54, x: 488, paws: "right", pawSpread: 0.56,
      face: { eyes: "pill", look: [-52, 10], ws: 0.9, left: { hs: 0.88, ws: 0.92 }, right: { hs: 0.88, ws: 0.92 }, blush: "#F08A72", blushOpacity: 0.95, blushX: 30, blushY: 58 },
      antenna: { angle: -0.78, curl: 0.95, len: 158, ball: 45 },
    },
    style: (K) => inked(K, {
      ink: "#3A2E26",
      stalk: { color: "#3A2E26", w: 14, tooth: 0.55, amp: 1.5, taper: [4, 14], paper: "fine" },
      shellLine: { color: "#3A2E26", w: 11, amp: 3.4, start: 0.62, tooth: 0.55, over: 0.08, drift: 7 },
      ballLine: { color: "#3A2E26", w: 10, amp: 1.4, over: 0.1, tooth: 0.55 },
      earLine: { color: "#3A2E26", w: 10, amp: 1.5, tooth: 0.55 },
      pawLine: { color: "#3A2E26", w: 10, amp: 1.5, start: 0.15, tooth: 0.55 },
      finger: { color: "#3A2E26", w: 7, taper: [4, 8], tooth: 0.5 },
      shade: { color: "#C59C6C", p: 0, tooth: 0.65, paper: "coarse", opacity: 0.8, hatch: { angle: -0.78, gap: 9, p: 0.65, w: 9 } },
    }),
  });

  // 5 · Riso: a two-colour risograph print (clay + black), slightly off register. "Oh, hi!"
  const RISO_CLAY = "#D2643C", RISO_INK = "#24211F";
  V.push({
    id: "5-riso", name: "5 · Starry-eyed", note: "Two-colour risograph print, clay and black, a little off register. Sparkles for eyes, the antenna pinging.",
    seed: 5505,
    ground(K) {
      K.art.paper({ color: "#F2EBDD", mottle: 0.025, grain: 0.05, vignette: 0.03 });
      // a clay tint, screened (sparse grain), as a halo
      K.mark(RISO_CLAY, { tooth: 0.95, soft: 0.1, paper: "fine", blend: "multiply", opacity: 0.9 }, (c) => {
        c.translate(7, -5); c.globalAlpha = 0.3; G.path(c, G.wobble(G.ellipse(500, 430, 318, 318), true, 6, 120, K.n, 3)); c.fill();
      });
    },
    ledge: {
      y: 714, slope: 0, wave: 2.5,
      face: { color: RISO_CLAY, base: "#F2EBDD", p: 0.93, tooth: 0.45, soft: 0.14, paper: "fine", blend: "multiply", shift: [7, -5] },
      line: { color: RISO_INK, w: 13, amp: 1, tooth: 0.3, blend: "multiply" },
    },
    bot: {
      tilt: -0.04, rise: 62,
      face: { eyes: "star", look: [0, -8], spread: 100, starR: 64, pinch: 0.3, starAspect: 1.18 },
      antenna: { angle: 0.1, curl: -0.4, len: 174, ball: 47, marks: "bob" },
    },
    style: (K) => {
      const m = { blend: "multiply" }, pr = { color: "#F2EBDD", p: 1, tooth: 0.05 };
      const sh = [7, -5];
      return {
        stalk: { color: RISO_INK, w: 15, tooth: 0.3, amp: 1.2, taper: [3, 8], ...m },
        ball: { color: RISO_CLAY, base: "#F2EBDD", p: 0.95, tooth: 0.4, soft: 0.14, amp: 1, shift: sh, ...m },
        ballLine: { color: RISO_INK, w: 11, amp: 1.2, over: 0.07, ...m },
        ear: { color: RISO_CLAY, p: 0.95, tooth: 0.4, soft: 0.14, amp: 1, shift: sh, ...m },
        earLine: { color: RISO_INK, w: 11, amp: 1.2, ...m },
        shell: { ...pr, amp: 1.5 },                                    // the shell is the bare paper
        shade: { color: RISO_CLAY, p: 0.4, tooth: 0.95, soft: 0.1, opacity: 1, crescent: [-44, -50, 10], shift: sh, ...m },   // a screened clay tint
        shellLine: { color: RISO_INK, w: 13, amp: 2.5, start: 0.62, weight: 0.3, shift: [-2, 2], ...m },
        visor: { color: RISO_INK, p: 0.95, tooth: 0.45, soft: 0.14, amp: 1.2, density: 0.18, ...m },
        eye: { color: "#F2EBDD", p: 1, tooth: 0.04, amp: 1 },             // knocked out of the black
        paw: { ...pr, amp: 1.2 },
        pawShade: { color: RISO_CLAY, p: 0.35, tooth: 0.95, soft: 0.1, shift: sh, ...m },
        pawLine: { color: RISO_INK, w: 11, amp: 1.2, start: 0.15, ...m },
        finger: { color: RISO_INK, w: 7, taper: [4, 8], ...m },
        marks: { color: RISO_INK, w: 10, amp: 1, ...m },
      };
    },
  });

  // 6 · Hello: only the ground is hand-made (apricot crayon, charcoal ledge); the bot is painted clean. A wave.
  V.push({
    id: "6-hello", name: "6 · Hello", note: "Apricot crayon ground and charcoal ledge; the bot painted clean, no line. A small smile, one paw up in a wave.",
    seed: 6606,
    ground(K) {
      crayonGround(K, "#F1D2BC", "#E39468", { over: "#CF7650", overOpacity: 0.3, angle: -0.4, p: 0.78 });
      K.mark("#CB653E", { tooth: 0.7, paper: "coarse", opacity: 0.45 }, (c) => M.scribbleDisc(c, 470, 430, 290, { r: K.r, angle: 0.65, gap: 12, p: 0.75, ragged: 16, w: 17 }));
    },
    ledge: {
      y: 720, slope: -0.008, wave: 3,
      face: { color: "#2A2420", base: true, p: 0.85, tooth: 0.5, paper: "coarse", hatch: { angle: 0.05, gap: 10, p: 0.5, w: 14 } },
      face2: { color: "#4A3F37", p: 0, tooth: 0.75, paper: "coarse", opacity: 0.45, hatch: { angle: -0.6, gap: 16, p: 0.5, w: 10 } },
    },
    bot: {
      tilt: -0.06, rise: 64, x: 462, paws: "left", scale: 0.97,
      face: { eyes: "pill", look: [12, -4], mouth: "smile", mouthW: 28, mouthY: 72, mouthX: 4 },
      antenna: { angle: 0.26, curl: -0.3, len: 166, ball: 47, marks: "swing" },
    },
    style: (K) => painted(K, { marks: { color: "#2A2420", w: 10, amp: 1 }, ear: { color: "#8E3F22", base: true, tooth: 0.35, paper: "coarse", amp: 1.2 } }),
    beforeLedge(K) { waveHand(K); },
    after(K) { waveMarks(K); },
  });

  /** A torn sheet of paper as the edge: deckled edge, white torn fibres, a hint of shadow. */
  function tornPaper(K) {
    const { G, n, r, ly, ledgeAt, art } = K, edge = [];
    for (let x = -40; x <= 1040; x += 2) {
      const y = ledgeAt(x) + n.fbm(x / 210 + 1.1, 4.2, 3) * 10 + n(x / 9 + 30, 7.7) * 2.6 + n(x / 3.1, 2.2) * 0.9;
      edge.push([x, y]);
    }
    K.ledgeTop = edge;
    const sheet = edge.concat([[1040, 1060], [-40, 1060]]);
    // a soft shadow just above the edge (the sheet lifts a little off what is behind it)
    art.mark("#3B2A1C", { tooth: 0.15, opacity: 0.45 }, (c) => { c.filter = `blur(${7 * art.k}px)`; c.translate(0, -4); G.path(c, sheet); c.fill(); });
    // the sheet, then its torn rim: whiter, with fibres
    K.fill(sheet, { color: "#EFE4D1", base: true, p: 0.6, tooth: 0.5, paper: "fine" });
    art.mark("#E9DFCF", { tooth: 0.6, paper: "coarse", opacity: 0.5 }, (c) => { G.path(c, sheet); c.clip(); M.hatch(c, null, { r, noise: n, angle: 0.02, gap: 30, p: 0.3, w: 20, wave: 4 }); });
    art.mark("#FFFFFF", { tooth: 0.35, opacity: 0.95 }, (c) => {
      G.path(c, sheet); c.clip();
      c.lineWidth = 9; G.path(c, edge, false); c.stroke();
    });
    art.mark("#FFFFFF", { tooth: 0.2, opacity: 0.85 }, (c) => {
      for (let i = 0; i < 520; i++) {
        const k = Math.floor(r() * edge.length), [x, y] = edge[k], a = -Math.PI / 2 + r.pm(1.1), L = 2 + r() * 7;
        c.lineWidth = 0.5 + r() * 0.9; c.globalAlpha = 0.4 + r() * 0.6;
        c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke();
      }
    });
  }

  /** The waving paw (version 6): a stubby forearm up from behind the edge and a mitten. */
  function handAt(K) { const { sc, ly, hw, Wp } = K; return [Wp(hw, 0)[0] + 62 * sc, ly - 132 * sc]; }
  function waveHand(K) {
    const { sc, ly, fill, line, st } = K, [hx, hy] = handAt(K), rot = 0.32;
    const arm = G.quad([hx - 30 * sc, ly + 50], [hx - 18 * sc, ly - 30 * sc], [hx - 2 * sc, hy + 36 * sc], 60);
    line(arm, { color: "#E6CCA3", w: 62 * sc, tooth: 0.2, amp: 0.8, taper: [0, 0], jit: 0.03 });
    line(arm.slice(0, Math.floor(arm.length * 0.85)), { color: "#CDA97A", w: 16 * sc, tooth: 0.5, opacity: 0.55, amp: 0.8, taper: [0, 24], jit: 0.05, shift: [20 * sc, 0] });
    const mitt = G.xf(G.squircle(hx, hy, 64 * sc, 70 * sc, 2.5), rot, hx, hy);
    fill(mitt, st.paw); fill(mitt, { ...st.pawShade, crescent: [-16, -22, 6] });
    for (const fx of [-0.3, 0.3]) {
      const p0 = G.xf([[hx + fx * 64 * sc, hy - 66 * sc]], rot, hx, hy)[0], p1 = G.xf([[hx + fx * 64 * sc, hy - 32 * sc]], rot, hx, hy)[0];
      line(G.line(p0, p1), st.finger);
    }
  }
  function waveMarks(K) {
    const { sc, line } = K, [hx, hy] = handAt(K);
    for (const [k, R] of [[0, 100], [1, 128]]) line(G.arc(hx - 4, hy + 20, R * sc, R * sc, -1.16 - k * 0.04, -0.52 + k * 0.05, 40), { color: "#2A2420", w: 10, amp: 1, taper: [12, 12] });
  }

  HD.VERSIONS = V;
})();
