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

  function G_clip(c, pts) { HD.G.path(c, pts); c.clip(); }

  HD.HANG = V;
})();
