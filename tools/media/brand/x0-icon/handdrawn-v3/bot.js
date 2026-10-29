/* X0 Bot, hand-drawn icons v3 (Curious colourways): the Peek-a-bot, big and bold, peeking over one drawn line.
 * v3 adds: eye glow and catchlights aimed along the gaze (F.gaze), a "boing" wobble in the antenna
 * stalk (A.boing), and a below-the-edge tint with any blend (E.belowBlend).
 *
 * Same bot as the keyboard mic key (PeekBotView.swift): cream shell, dark visor, clay ear-cups, one
 * antenna with a clay ball, little hands on the edge. For the icon it is cropped tight (the head is
 * ~70% of the width), the eyes are the hero (big, glowing, with catchlights, lids, cheeks and brows
 * on the visor), the edge is a single confident brush line with the ground continuing below it, and
 * the hands grip that line with three fingers over it.
 *
 * Media: clean brush-ink lines with weight on the shadow side, flat fills with a soft gradient and a
 * cel-shaded shadow, grain kept to the paper and a few warm places.
 *
 * HD.icon(art, spec). Units: the 1000 x 1000 icon square. Local head coordinates have the head centre
 * at 0,0; the head leans (tilt) from a pivot below the edge.
 */
(function () {
  "use strict";
  const { G, M, rgb, mix, clamp, smooth, rng } = HD;

  const PAL = {
    ink: "#1F1A16", visor: "#1D1C1B", visorTop: "#2E2925", cream: "#FBF0DE", cream2: "#ECD5B0", shade: "#DDB98A",
    glow: "#FFF1D6", eyeTop: "#FFF8EA", eyeBot: "#FFD9A3", clay: "#C9683F", clayLight: "#DE8659", clayDeep: "#9F4C2B",
    white: "#FFFDF7", blush: "#F2876A",
  };
  HD.PAL = PAL;
  const vgrad = (a, b, y0, y1) => { const A = rgb(a), B = rgb(b); return (x, y) => mix(A, B, smooth(y0, y1, y)); };
  HD.vgrad = vgrad;

  HD.icon = function (art, S) {
    const r = rng(S.seed * 31 + 7), n = art.noise, B = S.bot, E = S.edge, F = B.face || {}, A = B.antenna || {};
    const cx = B.x ?? 500, hw = B.hw ?? 340, hh = B.hh ?? 262;
    const headCY = E.y - B.rise, tilt = B.tilt || 0, piv = [cx, E.y + 240];
    const W = (pts) => G.xf(pts.map(([x, y]) => [cx + x, headCY + y]), tilt, piv[0], piv[1]);
    const Wp = (x, y) => W([[x, y]])[0];
    const edgeAt = (x) => E.y + (E.slope || 0) * (x - 500) + n.fbm(x / 170 + 3.3, 1.7, 2) * (E.wave ?? 2.2);
    const edgePts = [];
    for (let x = -40; x <= 1040; x += 3) edgePts.push([x, edgeAt(x)]);
    const above = edgePts.concat([[1040, -60], [-40, -60]]);
    const below = edgePts.concat([[1040, 1060], [-40, 1060]]);
    const ph = () => r() * 100;
    let clipNow = null;

    // ---- media helpers ---------------------------------------------------------------------------
    const line = (pts, pen, closed = false) => {
      if (!pen) return;
      const clip = pen.clip === undefined ? clipNow : pen.clip;
      art.mark(pen.color, { tooth: pen.tooth ?? 0.1, soft: pen.soft ?? 0.2, opacity: pen.opacity ?? 1, paper: pen.paper || "fine", blend: pen.blend, gain: pen.gain }, (c) => {
        if (clip) { G.path(c, clip); c.clip(); }
        if (pen.within) { G.path(c, pen.within); c.clip(); }
        if (pen.blur) c.filter = `blur(${pen.blur * art.k}px)`;
        if (closed) M.outline(c, pts, { w: pen.w, noise: n, phase: ph(), amp: pen.amp ?? 1.8, wl: pen.wl ?? 90, over: pen.over ?? 0.05, drift: pen.drift ?? 4, start: pen.start ?? r(), jit: pen.jit ?? 0.07, taper: pen.taper, weight: pen.weight ?? 0 });
        else M.ink(c, pen.amp === 0 ? pts : G.wobble(pts, false, pen.amp ?? 1, pen.wl ?? 80, n, ph()), { w: pen.w, noise: n, phase: ph(), taper: pen.taper || [10, 24], jit: pen.jit ?? 0.07, profile: pen.profile });
      });
    };
    const fill = (pts, f) => {
      if (!f) return;
      const clip = f.clip === undefined ? clipNow : f.clip;
      const shape = f.amp ? G.wobble(pts, true, f.amp, f.wl ?? 90, n, ph()) : pts;
      art.mark(f.color, { tooth: f.tooth ?? 0.05, soft: f.soft ?? 0.2, paper: f.paper || "fine", opacity: f.opacity ?? 1, blend: f.blend, gain: f.gain }, (c) => {
        if (clip) { G.path(c, clip); c.clip(); }
        if (f.within) { G.path(c, f.within); c.clip(); }
        if (f.blur) c.filter = `blur(${f.blur * art.k}px)`;
        c.globalAlpha = f.p ?? 1; G.path(c, shape); c.fill(); c.globalAlpha = 1; c.filter = "none";
        if (f.crescent) { // keep the shadow side only: cut away the shape moved toward the light
          const [dx, dy, bl] = f.crescent;
          c.globalCompositeOperation = "destination-out"; c.filter = `blur(${(bl ?? 3) * art.k}px)`;
          c.translate(dx, dy); G.path(c, shape); c.fill(); c.translate(-dx, -dy);
          c.filter = "none"; c.globalCompositeOperation = "source-over";
        }
      });
    };
    /** A soft radial light. */
    const glow = (p, R, color, opacity, o = {}) => {
      const clip = o.clip === undefined ? clipNow : o.clip;
      art.mark(color, { tooth: o.tooth ?? 0.15, opacity, paper: "coarse", blend: o.blend }, (c) => {
        if (clip) { G.path(c, clip); c.clip(); }
        if (o.within) { G.path(c, o.within); c.clip(); }
        const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(o.mid ?? 0.4, `rgba(255,255,255,${o.midA ?? 0.55})`); g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g; c.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R);
      });
    };
    const K = { art, S, r, n, G, M, PAL, line, fill, glow, cx, hw, hh, headCY, tilt, W, Wp, edgeAt, edgePts, above, below, rgb, mix, vgrad, smooth };

    // ---- ground -----------------------------------------------------------------------------------
    S.ground(K);
    if (E.belowTint) fill(below, { color: E.belowTint, p: 1, blend: E.belowBlend || "multiply", opacity: E.belowOpacity ?? 1, clip: null });

    // ---- geometry ---------------------------------------------------------------------------------
    const shell = W(G.squircle(0, 0, hw, hh, B.shellN ?? 2.6));
    const vy = (B.visorY ?? -0.02) * hh, vw = (B.visorW ?? 0.7) * hw, vh = (B.visorH ?? 0.56) * hh;
    const visor = W(G.squircle(0, vy, vw, vh, B.visorN ?? 2.6));
    const base = [0, -hh + 16], L = A.len ?? 190, a = A.angle ?? 0;
    let stalkL;
    if (A.path) { const P = A.path.map(([x, y]) => [base[0] + x * L, base[1] + y * L]); stalkL = G.cubic(base, P[0], P[1], P[2], 240); }
    else {
      const t = [base[0] + Math.sin(a) * L, base[1] - Math.cos(a) * L], c = [base[0] + Math.sin(a) * L * (A.curl ?? 0.3), base[1] - L * 0.6];
      stalkL = G.quad(base, c, t, 180);
    }
    if (A.boing) { // it just boinged: a small damped wiggle along the stalk, growing toward the ball
      const nr = G.normals(stalkL, false), N = stalkL.length - 1, { amp, waves = 1.6, phase = 0 } = A.boing;
      stalkL = stalkL.map((p, i) => { const t = i / N, d = amp * Math.sin(Math.PI * 2 * waves * t + phase) * Math.pow(t, 0.8) * (1 - 0.35 * t) * Math.min(1, (1 - t) * 6);
        return [p[0] + nr[i][0] * d, p[1] + nr[i][1] * d]; });
    }
    const stalk = W(stalkL), tip = stalk[stalk.length - 1], ballR = A.ball ?? 54;
    K.geo = { shell, visor, tip, ballR, stalk, vy, vw, vh, base: Wp(base[0], base[1]) };
    const st = S.style(K);
    K.st = st;

    clipNow = above;
    // ---- antenna ----------------------------------------------------------------------------------
    if (A.glow) glow(tip, ballR * (A.glowR ?? 3), A.glowColor || PAL.clay, A.glow, { clip: null });
    line(stalk, { ...st.stalk, profile: st.stalk.profile || ((t) => 1.25 - 0.5 * t), taper: st.stalk.taper || [0, 6] });
    const ball = G.ellipse(tip[0], tip[1], ballR, ballR);
    fill(ball, st.ball);
    if (st.ballShade) fill(ball, st.ballShade);
    if (st.ballLine) line(ball, st.ballLine, true);
    if (st.ballShine) fill(G.ellipse(tip[0] - ballR * 0.38, tip[1] - ballR * 0.4, ballR * 0.24, ballR * 0.17), st.ballShine);

    // ---- ears -------------------------------------------------------------------------------------
    for (const s of [-1, 1]) {
      const ear = W(G.squircle(s * (hw + 2), 6, 40, 68, 2.4));
      fill(ear, st.ear); if (st.earShade) fill(ear, st.earShade); line(ear, st.earLine, true);
    }

    // ---- shell ------------------------------------------------------------------------------------
    fill(shell, st.shell);
    if (st.shade) fill(shell, st.shade);
    if (st.shellShine) line(W(G.arc(0, 0, hw - 42, hh - 36, Math.PI * 1.13, Math.PI * 1.33, 60)), st.shellShine);
    line(shell, st.shellLine, true);

    // ---- face -------------------------------------------------------------------------------------
    if (B.visor !== false) {
      fill(visor, st.visor);
      if (st.visorSheen) glow(Wp(-vw * 0.45, vy - vh * 0.55), vw * 0.9, st.visorSheen.color, st.visorSheen.opacity, { within: visor });
      if (st.visorLine) line(visor, st.visorLine, true);
    }
    face(K, F, st, B.visor !== false ? visor : null);
    if (B.visor !== false && st.visorGlint) line(W(G.arc(0, vy, vw - 24, vh - 22, Math.PI * 1.08, Math.PI * 1.2, 40)), { ...st.visorGlint, within: visor });

    clipNow = null;
    // ---- the edge and the hands -------------------------------------------------------------------
    const hands = [];
    for (const s of B.hands || [-1, 1]) {
      const hx = Wp(s * hw * (B.handSpread ?? 0.62), 0)[0] + (B.handNudge || 0) * s;
      hands.push({ s, hx, hy: edgeAt(hx) });
    }
    const hs = B.handScale ?? 1;
    const handGeo = hands.map(({ s, hx, hy }) => handShape(hx, hy, 142 * hs, 56 * hs, 46 * hs, s * (B.handRot ?? 0.05)));
    if (st.handShadow) for (const h of handGeo) fill(G.xf(h.tips, 0, 0, 0, 7, 9), { ...st.handShadow, clip: below });
    if (S.beforeEdge) S.beforeEdge(K);
    if (E.line) {
      const L1 = edgePts.filter(([x]) => x <= (E.split ?? 560)), L2 = edgePts.filter(([x]) => x >= (E.split ?? 560) - 40).map(([x, y]) => [x, y + (E.splitDy ?? 1.5)]);
      if (E.oneStroke) line(edgePts, { taper: [40, 40], ...E.line });
      else { line(L1, { taper: [40, 50], ...E.line }); line(L2, { taper: [70, 40], ...E.line }); }
    }
    for (const h of handGeo) {
      fill(h.outline, st.hand);
      if (st.handShade) fill(h.outline, st.handShade);
      line(h.outline, st.handLine, true);
      for (const sm of h.seams) line(sm, st.seam);
    }

    if (S.after) S.after(K);
  };

  /** A little hand gripping the edge: the back of the hand above the line, three fingers hooked over it. */
  function handShape(hx, hy, Wd, Hb, Lf, rot) {
    const pts = [], yb = -2, fw = Wd / 3, lens = [0.9, 1.05, 0.95], tips = [], slot = Lf * 0.3, rr = (fw / 2) * 0.86;
    for (let i = 0; i <= 40; i++) { const a = Math.PI + (Math.PI * i) / 40; pts.push([(Wd / 2) * Math.cos(a), yb + Hb * Math.sin(a)]); }
    for (let f = 0; f < 3; f++) {
      const fx = Wd / 2 - fw * (f + 0.5) - (f - 1) * fw * 0.04, L = Lf * lens[f], cyf = L - rr;
      if (f === 0) pts.push([fx + rr + 2, yb + 4]);
      pts.push([fx + rr, cyf]);
      for (let i = 1; i < 20; i++) { const a = (Math.PI * i) / 20; const p = [fx + rr * Math.cos(a), cyf + rr * Math.sin(a)]; pts.push(p); tips.push(p); }
      pts.push([fx - rr, cyf]);
      if (f < 2) { // the slot between this finger and the next: up to a small rounded top
        const nx = Wd / 2 - fw * (f + 1.5) - (f) * fw * 0.04 + rr, mid = (fx - rr + nx) / 2, gap = (fx - rr - nx) / 2;
        pts.push([fx - rr, slot]);
        for (let i = 1; i < 8; i++) { const a = (Math.PI * i) / 8; pts.push([mid + gap * Math.cos(a), slot - Math.max(2, gap) * Math.sin(a)]); }
        pts.push([nx, slot]);
      } else pts.push([fx - rr - 2, yb + 4]);
    }
    const place = (p) => G.xf(p, rot, 0, 0, hx, hy);
    return { outline: place(G.resample(pts, 1, true)), tips: place([[Wd / 2 - 6, 0]].concat(tips, [[-Wd / 2 + 6, 0]])), seams: [] };
  }

  // ---- the face: eyes (the hero), brows, cheeks ---------------------------------------------------
  /** One eye in local coordinates: a soft superellipse; lid cuts the top, cheek pushes the bottom up (1 = a thin arc). */
  function eyePts(x, y, w, h, o) {
    const N = 90, nn = o.n ?? 2.25, top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N, s = Math.pow(1 - Math.pow(Math.abs(u), nn), 1 / nn), px = x + (u * w) / 2;
      let yt = y - (h / 2) * s;
      if (o.lid) yt = Math.max(yt, y - h / 2 + o.lid[0] * h + o.lid[1] * (px - x));
      let yb = y + (h / 2) * (1 - 2 * (o.cheek ?? 0)) * s;
      if (o.cheek && o.cheek > 0.5) yb -= (o.lift ?? 0) * h * s;
      top.push([px, yt]); bot.push([px, Math.max(yb, yt)]);
    }
    return top.concat(bot.reverse());
  }
  HD.eyePts = eyePts;

  function face(K, F, st, visor) {
    const { G, W, Wp, fill, line, glow, PAL } = K, { vy, vw, vh } = K.geo;
    const look = F.look || [0, 0];
    const ex = (F.spread ?? 0.48) * vw, ew = F.w ?? 124, eh = F.h ?? 176, ey = vy + (F.y ?? 0.12) * vh + look[1];
    const ink = !visor; // eyes drawn straight on the face plate, in ink
    const eyes = F.eyes || [{}, {}];
    eyes.forEach((e, i) => {
      const s = i === 0 ? -1 : 1, x = s * ex + look[0] + (e.dx || 0), y = ey + (e.dy || 0), w = ew * (e.ws ?? 1), h = eh * (e.hs ?? 1);
      const gz = F.gaze || null;
      let eyeCol = st.eye.color || vgrad(PAL.eyeTop, PAL.eyeBot, Wp(x, y - h / 2)[1], Wp(x, y + h / 2)[1]);
      if (!st.eye.color && gz) { // the glow's hot spot sits toward where it looks
        const hs = Wp(x + gz[0] * 0.24 * w, y + gz[1] * 0.26 * h), R = Math.max(w, h) * 0.78, A0 = rgb(PAL.eyeTop), A1 = rgb(PAL.eyeBot);
        eyeCol = (px, py) => mix(A0, A1, smooth(0.12, 1.0, Math.hypot(px - hs[0], py - hs[1]) / R));
      }
      if (e.arc) { // a closed, smiling eye: one thick arch stroke (the cheek pushes it up)
        const a = e.arc, rx = (a.rx ?? 0.44) * w, ry = (a.ry ?? 0.3) * h, yc = y + (a.dy ?? 0.08) * h, o = a.open ?? 0.06, rt = (a.rot || 0) * s;
        line(W(G.arc(x, yc, rx, ry, Math.PI * (1 + o) + rt, Math.PI * (2 - o) + rt, 70)), { color: eyeCol, w: a.w ?? 40, taper: [14, 14], amp: 0.3, jit: 0.04, within: visor || undefined, profile: (t) => 0.72 + 0.4 * Math.sin(Math.PI * t) });
      }
      const shape = e.arc ? null : W(eyePts(x, y, w, h, e)), open = !e.arc && !(e.cheek > 0.5) && !(e.lid && e.lid[0] > 0.55);
      if (!ink && st.eyeHalo && open) glow(Wp(x, y), Math.max(w, h) * 0.85, st.eyeHalo.color || PAL.glow, st.eyeHalo.opacity ?? 0.2, { within: visor, mid: 0.45, midA: 0.35 });
      if (shape) fill(shape, { ...st.eye, color: eyeCol, within: visor || undefined });
      if (e.catch !== false && open && st.catchlight) {
        const g = gz || [-0.7, -0.75], cr = e.catchR ?? 1;
        const c1 = Wp(x + g[0] * 0.27 * w + (e.cx || 0), y + g[1] * 0.28 * h), c2 = Wp(x - g[0] * 0.2 * w + (e.cx || 0), y - g[1] * 0.2 * h);
        fill(G.xf(G.ellipse(c1[0], c1[1], w * 0.17 * cr, h * 0.12 * cr), Math.atan2(g[1], g[0]) + Math.PI / 2 + K.tilt, c1[0], c1[1]), st.catchlight);
        fill(G.ellipse(c2[0], c2[1], w * 0.065, w * 0.065), { ...st.catchlight, opacity: (st.catchlight.opacity ?? 1) * 0.8 });
      }
      if (e.brow && st.brow) { // a brow line on the visor (or the face), above this eye
        const b = e.brow, bx = x + (b.dx || 0), by = y - h / 2 - (b.gap ?? 28), Lb = (b.len ?? 0.5) * w, rot = (b.rot ?? 0) * s;
        const p0 = [-Lb, 0], p1 = [0, -(b.bend ?? 14)], p2 = [Lb, 0];
        const pts = G.quad(p0, p1, p2, 40).map(([px, py]) => { const c = Math.cos(rot), sn = Math.sin(rot); return [bx + px * c - py * sn, by + px * sn + py * c]; });
        line(W(pts), { ...st.brow, w: b.w ?? st.brow.w, within: visor || undefined, taper: [14, 14], profile: (t) => 0.75 + 0.5 * Math.sin(Math.PI * t) });
      }
    });
    if (F.blush) for (const s of [-1, 1]) {
      const p = Wp(s * (ex + (F.blushX ?? 52)) + look[0] * 0.5, ey + (F.blushY ?? 34));
      fill(G.ellipse(p[0], p[1], F.blushW ?? 40, F.blushH ?? 20), { color: F.blush, p: 1, opacity: F.blushOpacity ?? 0.85, blur: 5, within: visor || undefined, tooth: 0.25, paper: "coarse" });
    }
    if (F.mouth) {
      const mx = look[0] * 0.6 + (F.mouthX || 0), my = ey + (F.mouthY ?? 92);
      const pen = { ...(st.mouth || st.brow), within: visor || undefined };
      if (F.mouth === "smile") line(W(G.arc(mx, my - 18, F.mouthW ?? 26, 18, Math.PI * 0.15, Math.PI * 0.85, 40)), { ...pen, w: 12, taper: [8, 8] });
      if (F.mouth === "smirk") line(W(G.arc(mx, my - 22, 28, 18, Math.PI * 0.08, Math.PI * 0.6, 40)), { ...pen, w: 12, taper: [8, 10] });
      if (F.mouth === "o") fill(W(G.ellipse(mx, my, F.mouthR ? F.mouthR * 0.85 : 15, F.mouthR ?? 18)), { ...(st.mouthFill || st.eye), color: (st.mouthFill || {}).color || PAL.ink, within: visor || undefined });
    }
  }
})();
