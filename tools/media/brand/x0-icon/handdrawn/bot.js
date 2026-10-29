/* X0 Bot, hand-drawn icons: the Peek-a-bot, peeking over a ledge.
 *
 * The bot is the keyboard mic key's Peek-a-bot (PeekBotView.swift / peek-bot reference): a soft
 * cream shell, a dark visor with two glowing eyes, clay ear-cups, one antenna with a clay ball, and
 * two paws gripping the edge it peeks over. Proportions follow the key (head 1.12 x 0.86, visor
 * 0.84 x 0.46 a little above centre); the antenna, ball and eyes are a little larger here so they
 * hold up at 29 px.
 *
 * HD.icon(art, spec) draws one icon. Each version (versions.js) sets the pose and the feeling
 * (eyes, look, tilt, antenna swing, motion marks) and the media of each part, and paints its own
 * ground. Units: the 1000 x 1000 icon square.
 */
(function () {
  "use strict";
  const { G, M, rgb, mix, clamp, smooth, rng } = HD;

  const PAL = {
    ink: "#1E1A17", visor: "#1D1C1B", cream: "#FBF0DE", cream2: "#E9D0A8", tan: "#CFA978", glow: "#FFF1D6",
    clay: "#C9683F", clayDeep: "#9E4A2A", white: "#FFFCF4",
  };

  HD.PAL = PAL;

  HD.icon = function (art, S) {
    const r = rng(S.seed * 31 + 7), n = art.noise;
    const B = S.bot, F = B.face || {}, A = B.antenna || {}, LG = S.ledge;
    const sc = B.scale ?? 1, cx = B.x ?? 500, ly = LG.y ?? 712;
    const hw = 290 * sc, hh = 222 * sc;                     // head half-size (key: 1.12 x 0.86)
    const headCY = ly - (B.rise ?? 58) * sc;                 // how far the head is up over the edge
    const piv = [cx, ly + 160 * sc], tilt = B.tilt || 0;     // the head leans from below the edge
    const W = (pts) => G.xf(pts.map(([x, y]) => [cx + x, headCY + y]), tilt, piv[0], piv[1]);
    const Wp = (x, y) => W([[x, y]])[0];
    const ledgeAt = (x) => ly + (LG.slope || 0) * (x - 500);

    // ---- media helpers -------------------------------------------------------------------------
    const ph = () => r() * 100;
    /** An ink-like line. closed: an outline drawn in one go (overshoot); open: a stroke with taper. */
    const line = (pts, pen, closed = false) => {
      if (!pen) return;
      art.mark(pen.color, { tooth: pen.tooth ?? 0.3, soft: pen.soft ?? 0.2, opacity: pen.opacity ?? 1, paper: pen.paper || "fine", blend: pen.blend, gain: pen.gain, density: pen.density },
        (c) => {
          if (pen.shift) c.translate(pen.shift[0], pen.shift[1]);
          if (closed) M.outline(c, pts, { w: pen.w, noise: n, phase: ph(), amp: pen.amp ?? 3, wl: pen.wl ?? 70, over: pen.over ?? 0.06, drift: pen.drift ?? 5, start: pen.start ?? r(), jit: pen.jit, taper: pen.taper, weight: pen.weight });
          else M.ink(c, G.wobble(pts, false, pen.amp ?? 1.6, pen.wl ?? 60, n, ph()), { w: pen.w, noise: n, phase: ph(), taper: pen.taper || [10, 26], jit: pen.jit });
        });
    };
    /** A filled shape. f: color (hex or fn), p (pressure), tooth, paper, amp (edge wobble), hatch (crayon strokes), shift, blend. */
    const fill = (pts, f) => {
      if (!f) return;
      const shape = f.amp ? G.wobble(pts, true, f.amp, f.wl ?? 90, n, ph()) : pts;
      if (f.base) fill(shape, { color: f.base === true ? f.color : f.base, p: 1, tooth: 0.04, shift: f.base === true ? f.shift : null, clip: f.clip, blend: f.base === true ? f.blend : f.baseBlend });
      art.mark(f.color, { tooth: f.tooth ?? 0.2, soft: f.soft ?? 0.2, paper: f.paper || "fine", opacity: f.opacity ?? 1, blend: f.blend, gain: f.gain, density: f.density },
        (c) => {
          if (f.shift) c.translate(f.shift[0], f.shift[1]);
          if (f.clip) { G.path(c, f.clip); c.clip(); }
          c.globalAlpha = f.p ?? 1; G.path(c, shape); c.fill(); c.globalAlpha = 1;
          if (f.hatch) M.hatch(c, shape, { r, noise: n, ...f.hatch });
          if (f.crescent) { // keep only the shadow side: cut away the shape moved toward the light
            const [dx, dy, blur] = f.crescent;
            c.setTransform(art.k, 0, 0, art.k, 0, 0); if (f.shift) c.translate(f.shift[0], f.shift[1]);
            c.globalCompositeOperation = "destination-out"; c.filter = `blur(${(blur ?? 6) * art.k}px)`;
            c.translate(dx, dy); G.path(c, shape); c.fill(); c.filter = "none"; c.globalCompositeOperation = "source-over";
          }
          if (f.fade) { // pressure fades along a direction: fade = [x0, y0, x1, y1, a0, a1]
            const [x0, y0, x1, y1, a0, a1] = f.fade, g = c.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0, `rgba(255,255,255,${a0})`); g.addColorStop(1, `rgba(255,255,255,${Math.min(1, a1)})`);
            c.setTransform(art.k, 0, 0, art.k, 0, 0); c.globalCompositeOperation = "destination-in"; c.fillStyle = g; c.fillRect(-50, -50, 1100, 1100);
          }
        });
    };
    const K = { art, S, r, n, G, M, PAL, line, fill, mark: (col, o, fn) => art.mark(col, o, fn), ly, ledgeAt, cx, sc, W, Wp, headCY, hw, hh, tilt, rgb, mix, clamp, smooth };

    // ---- ground ------------------------------------------------------------------------------------
    S.ground(K);

    // ---- geometry (local: head centre at 0,0) ------------------------------------------------------
    const shellL = G.squircle(0, 0, hw, hh, B.shellN ?? 2.75);
    const shell = W(shellL);
    const vy = (B.visorY ?? -20) * sc, vw = (B.visorW ?? 208) * sc, vh = (B.visorH ?? 116) * sc;   // visor (key: 0.84 x 0.46 at -0.05)
    const visor = W(G.squircle(0, vy, vw, vh, 3.1));
    const base = [0, -hh + 16 * sc], len = (A.len ?? 170) * sc, a = A.angle ?? 0, curl = A.curl ?? 0.35, ballR = (A.ball ?? 47) * sc;
    const tipL = [base[0] + Math.sin(a) * len, base[1] - Math.cos(a) * len];
    const ctrlL = [base[0] + Math.sin(a) * len * curl, base[1] - len * 0.62];
    const tip = Wp(tipL[0], tipL[1]), baseW = Wp(base[0], base[1]);
    const stalk = W(G.quad(base, ctrlL, tipL, 120));
    const geo = { shell, visor, tip, baseW, ballR, stalk, vy, vw, vh };
    K.geo = geo;
    const st = typeof S.style === "function" ? S.style(K) : S.style;
    K.st = st;

    // ---- antenna (behind the head) -----------------------------------------------------------------
    if (A.glow) glowAt(K, tip, ballR * (A.glowR ?? 2.8), A.glowColor || PAL.clay, A.glow);
    if (st.stalkUnder) line(stalk, st.stalkUnder);
    line(stalk, st.stalk);
    const ball = G.ellipse(tip[0], tip[1], ballR, ballR);
    fill(ball, st.ball);
    line(ball, st.ballLine, true);
    if (st.ballShine) fill(G.ellipse(tip[0] - ballR * 0.36, tip[1] - ballR * 0.38, ballR * 0.26, ballR * 0.2), st.ballShine);

    // ---- ears (clay cups behind the shell) ---------------------------------------------------------
    for (const s of [-1, 1]) {
      const ear = W(G.squircle(s * (hw + 6 * sc), 6 * sc, 44 * sc, 60 * sc, 2.4));
      fill(ear, st.ear); line(ear, st.earLine, true);
    }

    // ---- shell -------------------------------------------------------------------------------------
    fill(shell, st.shell);
    if (st.shade) fill(shell, st.shade.crescent ? st.shade : { ...st.shade, fade: st.shade.fade || fadeAcross(-0.15) });
    if (st.shellShine) {
      const sh = W(G.arc(0, 0, hw - 40 * sc, hh - 34 * sc, Math.PI * 1.13, Math.PI * 1.34, 60));
      line(sh, st.shellShine);
    }
    line(shell, st.shellLine, true);

    // ---- visor and face ----------------------------------------------------------------------------
    fill(visor, st.visor);
    if (st.visorLine) line(visor, st.visorLine, true);
    face(K, F, st, visor);
    if (st.visorGlint) line(W(G.arc(0, vy, vw - 26 * sc, vh - 22 * sc, Math.PI * 1.2, Math.PI * 1.36, 50)), st.visorGlint);

    // ---- the ledge ---------------------------------------------------------------------------------
    if (S.beforeLedge) S.beforeLedge(K);
    S.ledgeDraw ? S.ledgeDraw(K) : ledge(K, LG);

    // ---- paws on the edge --------------------------------------------------------------------------
    const pawSides = B.paws === "left" ? [-1] : B.paws === "right" ? [1] : B.paws === "none" ? [] : [-1, 1];
    for (const s of pawSides) {
      const at = Wp(s * hw * (B.pawSpread ?? 0.66), 0)[0] + (B.pawNudge || 0) * s;
      const py = ledgeAt(at) + (B.pawDrop ?? 4) * sc, pw = 60 * sc, phh = 44 * sc;
      const paw = G.squircle(at, py, pw, phh, 2.5);
      if (st.pawShadow) fill(G.ellipse(at + 8 * sc, py + phh + 4 * sc, pw * 0.95, 11 * sc), st.pawShadow);
      fill(paw, st.paw);
      if (st.pawShade) fill(paw, st.pawShade.crescent ? st.pawShade : { ...st.pawShade, fade: [at, py - phh, at, py + phh, 0, 1] });
      line(paw, st.pawLine, true);
      if (st.finger) for (const fx of [-0.3, 0.3]) {
        const x = at + fx * pw * 0.95;
        line(G.quad([x, py + phh * 0.2], [x + 2 * sc, py + phh * 0.6], [x - 1 * sc, py + phh * 0.92], 30), st.finger);
      }
    }

    // ---- motion marks and extras --------------------------------------------------------------------
    marks(K, B, A, geo, st);
    if (S.after) S.after(K);

    function fadeAcross(k) { // shading darker toward the lower right of the head
      const p0 = Wp(-hw * 0.7, -hh * 0.9), p1 = Wp(hw * 0.9, hh * 0.6);
      return [p0[0], p0[1], p1[0], p1[1], 0, 1 + k];
    }
  };

  /** A soft radial glow (pastel rubbed into the paper). */
  function glowAt(K, p, R, color, opacity) {
    K.art.mark(color, { tooth: 0.45, opacity, paper: "coarse" }, (c) => {
      const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R);
    });
  }
  HD.glowAt = glowAt;

  // ---- the face: only the eyes (and maybe a tiny mouth or blush) ----------------------------------
  function face(K, F, st, visor) {
    const { G, W, sc, fill, line, PAL, art, r } = K, vy = K.geo.vy;
    const lx = (F.look ? F.look[0] : 0) * sc, lyk = (F.look ? F.look[1] : 0) * sc;
    const ex = (F.spread ?? 96) * sc, ew = (F.w ?? 72) * sc, eh = (F.h ?? 112) * sc, eyY = vy + lyk;
    const glow = st.eye.color || PAL.glow;
    // soft light around the eyes on the visor glass
    if (st.eyeHalo) {
      art.mark(st.eyeHalo.color || glow, { tooth: st.eyeHalo.tooth ?? 0.5, opacity: st.eyeHalo.opacity ?? 0.3, paper: "coarse" }, (c) => {
        G.path(c, visor); c.clip();
        for (const s of [-1, 1]) {
          const p = W([[s * ex + lx, eyY]])[0], g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], 88 * sc);
          g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.5, "rgba(255,255,255,0.4)"); g.addColorStop(1, "rgba(255,255,255,0)");
          c.fillStyle = g; c.fillRect(p[0] - 130 * sc, p[1] - 130 * sc, 260 * sc, 260 * sc);
        }
      });
    }
    const eyeFill = { ...st.eye, color: glow };
    const pen = { color: glow, w: (F.stroke ?? 30) * sc, tooth: st.eye.tooth ?? 0.25, amp: 1.2, taper: [6, 6], jit: 0.08, paper: st.eye.paper };
    const pill = (s, opts = {}) => {
      const x = s * ex + lx + (opts.dx || 0) * sc, y = eyY + (opts.dy || 0) * sc, w = ew * (opts.ws || 1), h = eh * (opts.hs || 1);
      let pts = G.rrect(x, y, w, h, w / 2);
      if (opts.lid) { // a lid: cut the top of the eye along a slanted line
        const [depth, slant] = opts.lid, top = y - h / 2 + depth * h;
        pts = pts.map(([px, py]) => { const cut = top + slant * s * (px - x); return [px, Math.max(py, cut)]; });
      }
      if (opts.low) { // a lower lid (a smiling eye): cut the bottom along an upward curve
        const bot = y + h / 2 - opts.low * h;
        pts = pts.map(([px, py]) => { const cut = bot + Math.pow((px - x) / (w / 2), 2) * opts.low * h * 0.9; return [px, Math.min(py, cut)]; });
      }
      fill(W(pts), eyeFill);
    };
    const closed = (s, opts = {}) => { // a happy closed eye: an upward arc (^)
      const x = s * ex + lx + (opts.dx || 0) * sc, y = eyY + 16 * sc + (opts.dy || 0) * sc, rx = (opts.rx ?? 46) * sc, ry = (opts.ry ?? 40) * sc;
      line(W(G.arc(x, y, rx, ry, Math.PI * 1.1 + (opts.rot || 0), Math.PI * 1.9 + (opts.rot || 0), 60)), { ...pen, w: (opts.w ?? F.stroke ?? 30) * sc });
    };
    const kind = F.eyes || "pill";
    if (kind === "pill") { pill(-1, F.left || {}); pill(1, F.right || {}); }
    else if (kind === "happy") { closed(-1, F.left || {}); closed(1, F.right || {}); }
    else if (kind === "wink") { pill(-1, F.left || {}); closed(1, F.right || {}); }
    else if (kind === "winkL") { closed(-1, F.left || {}); pill(1, F.right || {}); }
    else if (kind === "star") { // starry-eyed: two four-point sparkles
      const asp = F.starAspect ?? 1.1;
      for (const s of [-1, 1]) {
        const p = [s * ex + lx, eyY], star = M.sparkle(0, 0, (F.starR ?? 66) * sc, s * 0.06, F.pinch ?? 0.3).map(([x, y]) => [p[0] + x / Math.sqrt(asp), p[1] + y * Math.sqrt(asp)]);
        fill(W(star), eyeFill);
      }
    }
    else if (kind === "round") { for (const s of [-1, 1]) fill(W(G.ellipse(s * ex + lx, eyY, ew * 0.62, ew * 0.66)), eyeFill); }
    // a tiny mouth
    const mx = lx * 0.55 + (F.mouthX ?? 0) * sc, my = eyY + (F.mouthY ?? 74) * sc;
    if (F.mouth === "smile") line(W(G.arc(mx, my - 22 * sc, (F.mouthW ?? 30) * sc, 22 * sc, Math.PI * 0.18, Math.PI * 0.82, 40)), { ...pen, w: 13 * sc });
    if (F.mouth === "smirk") line(W(G.arc(mx, my - 26 * sc, 30 * sc, 20 * sc, Math.PI * 0.1, Math.PI * 0.62, 40)), { ...pen, w: 13 * sc });
    if (F.mouth === "o") { const mr = (F.mouthR ?? 16) * sc; fill(W(G.ellipse(mx, my, mr * 0.85, mr)), eyeFill); }
    if (F.blush) for (const s of [-1, 1]) {
      fill(W(G.ellipse(s * (ex + (F.blushX ?? 40) * sc) + lx * 0.4, eyY + (F.blushY ?? 66) * sc, 30 * sc, 14 * sc)), { color: F.blush, p: 0.9, tooth: 0.5, paper: "coarse", opacity: F.blushOpacity ?? 0.75, clip: visor });
    }
  }

  // ---- the ledge: an edge to peek over ------------------------------------------------------------
  function ledge(K, LG) {
    const { G, n, r, fill, line, sc, ledgeAt } = K;
    const top = [];
    for (let x = -40; x <= 1040; x += 4) top.push([x, ledgeAt(x) + n.fbm(x / 150 + 3.3, 1.7, 2) * (LG.wave ?? 3)]);
    const face = top.concat([[1040, 1060], [-40, 1060]]);
    K.ledgeTop = top;
    fill(face, LG.face);
    if (LG.lip) fill(face, { ...LG.lip, fade: [500, ledgeAt(500), 500, ledgeAt(500) + (LG.lip.depth ?? 70), 1, 0] });
    if (LG.face2) fill(face, LG.face2);
    if (LG.ticks) for (const [x, k] of LG.ticks.at) { // a few hatch strokes in the shadow under the edge
      const y = ledgeAt(x) + 16, L = (LG.ticks.len ?? 40) * (k ?? 1), a = LG.ticks.angle ?? 2.05;
      line(G.line([x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L]), { taper: [8, 16], ...LG.ticks.pen });
    }
    if (LG.line) {
      line(top.filter(([x]) => x >= (LG.lineFrom ?? -40) && x <= (LG.lineTo ?? 1040)), { taper: [30, 40], ...LG.line });
      if (LG.line2) line(top.filter(([x]) => x >= LG.line2.from && x <= LG.line2.to).map(([x, y]) => [x, y + (LG.line2.dy ?? 4)]), { taper: [40, 40], ...LG.line, ...LG.line2 });
    }
  }

  // ---- motion marks -------------------------------------------------------------------------------
  function marks(K, B, A, geo, st) {
    const { G, line, sc, tilt } = K, pen = st.marks;
    if (!pen || !A.marks) return;
    const { tip, baseW, ballR } = geo, L = Math.hypot(tip[0] - baseW[0], tip[1] - baseW[1]);
    const lean = Math.atan2(tip[0] - baseW[0], baseW[1] - tip[1]);        // from vertical, + = right
    if (A.marks === "swing") {                                          // arcs on the side it swung from
      const side = lean >= 0 ? -1 : 1, R0 = L + ballR * 0.2;
      for (const [k, dr] of [[0, 0], [1, 1]]) {
        const a0 = lean + side * (0.36 + 0.1 * k), a1 = lean + side * (0.62 + 0.12 * k), R = R0 + (dr ? 2 : -4) * sc;
        const pts = G.resample([...Array(41)].map((_, i) => { const t = a0 + ((a1 - a0) * i) / 40; return [baseW[0] + Math.sin(t) * (R + k * 0), baseW[1] - Math.cos(t) * (R + k * 0)]; }), 1, false);
        if (k === 0) line(pts, { ...pen, taper: [14, 14] });
        else line(G.resample(pts.map(([x, y]) => [baseW[0] + (x - baseW[0]) * 0.8, baseW[1] + (y - baseW[1]) * 0.8]), 1, false), { ...pen, taper: [12, 12], w: pen.w * 0.85 });
      }
    }
    if (A.marks === "bob" || A.marks === "pop") {                       // short ticks around the ball
      const angs = A.marks === "bob" ? [-1.0, 0, 1.0] : [-0.75, 0.75];
      for (const t of angs) {
        const d = lean + t, r0 = ballR + 22 * sc, r1 = ballR + (t === 0 ? 52 : 46) * sc;
        line(G.line([tip[0] + Math.sin(d) * r0, tip[1] - Math.cos(d) * r0], [tip[0] + Math.sin(d) * r1, tip[1] - Math.cos(d) * r1]), { ...pen, taper: [6, 10] });
      }
    }
  }
})();
