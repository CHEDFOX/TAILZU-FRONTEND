/* X0 Bot, hand-drawn icons v3: "Curious" in six colourways.
 * One drawing (v2 Curious, made more hand-drawn), six ground / ring colour combinations. Seeds make
 * them repeatable; the same seed is used for every colourway so only the colour changes. */
(function () {
  "use strict";
  const { PAL, G, M, vgrad } = HD;

  /** The house style (as v2), with a slightly drier, less even line. */
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
      hand: { color: vgrad(PAL.cream, PAL.cream2, ly - 50, ly + 40), p: 1 },
      handLine: pen(11, { amp: 0.9, start: 0.25 }),
      seam: { color: ink, w: 6.5, taper: [3, 9], amp: 0.3 },
      handShadow: { color: "#000000", p: 1, opacity: 0.13, blur: 5 },
      marks: { color: o.marks || ink, w: 8, jit: 0.15, tooth: 0.2, paper: "coarse" },
      ...o.over,
    };
  }

  /**
   * An ensō drawn as one real stroke: the brush lands (a slightly fat, rounded start), travels round,
   * thins, and runs dry (the end splits into bristle streaks). The gap between start and end shows.
   */
  function enso(K, cx, cy, R, color, o = {}) {
    const N = 720, a0 = o.start ?? -0.3, sweep = o.sweep ?? Math.PI * 2 - 0.42, w = o.w ?? 54, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = a0 + sweep * t, rr = R * (1 + 0.022 * Math.sin(t * 6.3 + 1.2) - 0.018 * t);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a) * (o.squash ?? 1), a]);
    }
    const P = pts.map(([x, y]) => [x, y]), cut = 0.9, main = P.slice(0, Math.round(N * cut));
    const prof = (t) => (1 + 0.32 * Math.exp(-Math.pow(t / 0.035, 2)) + 0.06 * Math.sin(t * 13)) * (1 - 0.42 * Math.pow(t, 2.2));
    const common = { color, clip: K.above, opacity: o.opacity ?? 1 };
    K.line(main, { ...common, w, profile: prof, taper: [6, 26], tooth: 0.3, paper: "coarse", amp: 1.4, wl: 170, jit: 0.1 });
    // the dry end: bristle streaks fanning out of the stroke, each running out at its own point
    const n = 7;
    for (let k = 0; k < n; k++) {
      const off = ((k - (n - 1) / 2) / ((n - 1) / 2)) * w * 0.3, i0 = Math.round(N * (0.8 + 0.03 * K.r())), i1 = Math.round(N * (0.93 + 0.07 * K.r()));
      const strand = pts.slice(i0, i1).map(([x, y, a]) => [x + Math.cos(a) * off * (1 + 0.25 * K.r()), y + Math.sin(a) * off]);
      if (strand.length > 4) K.line(strand, { ...common, w: w * (0.11 + 0.08 * K.r()), taper: [14, 40], tooth: 0.55, paper: "coarse", amp: 0.8, jit: 0.25 });
    }
    // a few hairline gaps in the body of the stroke where the bristles part (ground colour)
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * w * 0.22 + K.r.pm(3), i0 = Math.round(N * (0.4 + 0.12 * k)), i1 = Math.round(N * cut);
      const streak = pts.slice(i0, i1).map(([x, y, a]) => [x + Math.cos(a) * off, y + Math.sin(a) * off]);
      K.line(streak, { color: o.ground, clip: K.above, w: 2.2 + K.r() * 1.5, taper: [30, 30], tooth: 0.6, paper: "coarse", amp: 0.6, opacity: 0.55 });
    }
  }

  /** "It just boinged": two short wobble arcs hugging the ball on the side it swung from. */
  function ballWobble(K) {
    const { tip, ballR, base } = K.geo, lean = Math.atan2(tip[0] - base[0], base[1] - tip[1]);
    const side = lean < 0 ? 1 : -1, mid = side > 0 ? -0.15 : Math.PI + 0.15;
    for (const [k, gap, span] of [[0, 17, 0.5], [1, 33, 0.3]]) {
      const pts = G.arc(tip[0], tip[1], ballR + gap, ballR + gap, mid - span, mid + span, 30);
      K.line(pts, { ...K.st.marks, w: K.st.marks.w * (k ? 0.85 : 1), taper: [8, 8], clip: null });
    }
  }

  /** One Curious, in a colourway C. */
  function curious(id, name, note, C) {
    return {
      id, name, note, seed: 1101,
      ground(K) {
        K.art.paper({ color: C.ground, mottle: C.dark ? 0.04 : 0.025, grain: C.dark ? 0.06 : 0.04, warm: 0.02, vignette: 0.04, scale: 240 });
        if (C.light) K.glow([480, 430], 520, C.light, C.lightOpacity ?? 0.35, { clip: null, tooth: 0.1 });
        enso(K, 500, 522, 394, C.ring, { ground: C.ground, opacity: C.ringOpacity ?? 1, w: 54 });
      },
      edge: { y: 800, slope: -0.01, line: { color: C.edge, w: 13, amp: 1, jit: 0.16, tooth: 0.24, paper: "coarse" },
        belowTint: C.below, belowBlend: C.belowBlend, belowOpacity: C.belowOpacity },
      bot: {
        tilt: 0.19, rise: 124,
        face: {
          y: 0.08, look: [-30, -18], gaze: [-0.62, -0.84], h: 168,
          eyes: [
            { hs: 1.08, ws: 1.05, brow: { gap: 9, len: 0.36, bend: 16, rot: 0.16, w: 12, dx: 14 } },
            { hs: 0.92, ws: 0.95, dy: 8 },
          ],
        },
        antenna: { angle: -0.66, curl: 0.62, len: 190, ball: 52, boing: { amp: 10, waves: 1.3, phase: 0.5 }, glow: C.ballGlow },
      },
      style: (K) => brush(K, { ink: C.ink, stalkColor: C.stalk, marks: C.marks }),
      after(K) { ballWobble(K); },
    };
  }

  const V = [
    curious("1-ink", "1 · Ink + clay", "Deep warm ink ground, clay ring, chalk-cream edge.",
      { ground: "#1F1C1A", ring: "#C9683F", edge: "#EAD7BA", dark: true, light: "#4B3527", lightOpacity: 0.45, stalk: "#EAD7BA", marks: "#EAD7BA", ink: "#0E0C0B", ballGlow: 0.3 }),
    curious("2-sage", "2 · Sage + cream", "Sage-olive ground, cream ring, ink edge.",
      { ground: "#9AA486", ring: "#F3E7D1", edge: "#1F1A16", below: "#E3E6DA", light: "#B9C1A6", lightOpacity: 0.4 }),
    curious("3-night", "3 · Night + amber", "Dusty night-blue ground, warm amber ring, cream edge.",
      { ground: "#353F66", ring: "#E8A24B", edge: "#EFDDC2", dark: true, light: "#4D5A86", lightOpacity: 0.4, stalk: "#EFDDC2", marks: "#EFDDC2", ink: "#0F1220", ballGlow: 0.28 }),
    curious("4-clay", "4 · Clay + cream", "Clay ground, cream ring, ink edge.",
      { ground: "#C66941", ring: "#F4E4CB", edge: "#26170F", below: "#E9D1C3", light: "#E08C62", lightOpacity: 0.45 }),
    curious("5-butter", "5 · Butter + ink", "Butter-yellow ground, ink ring, ink edge.",
      { ground: "#F0D387", ring: "#211C18", edge: "#1F1A16", below: "#EEE2C8", light: "#F7E3A6", lightOpacity: 0.5, ringOpacity: 0.95 }),
    curious("6-blush", "6 · Blush + clay", "Soft blush-peach ground, clay ring, ink edge.",
      { ground: "#F1C7B3", ring: "#C9683F", edge: "#1F1A16", below: "#F2E2D9", light: "#F8DCCD", lightOpacity: 0.45 }),
  ];
  HD.VERSIONS = V;
})();
