/* "Take a sip": the clip plays, freezes at 6.0 s on the man at his desk, and while everything else holds still the
 * steam off his cup keeps rising (footage-sip/ is the plate: frames 1-144 as shot, then the frozen frame with the
 * clip's own steam laid back in above the cup, aligned and cross-faded; see the session notes). A red hand-written
 * "take a sip." lands on the wall beside him with an arrow to the cup, then "X0 will handle it." types under it.
 * Render at 24 fps (the footage's own rate): render.mjs out --page ad/sip.html --ratio 9x16 --fps 24 --name sip */
(() => {
  const q = new URLSearchParams(location.search);
  const FPS = 24, N = 252, DUR = N / FPS, FREEZE = 6.0;
  const RED = "#E5352B";
  const T = { hand: 6.35, handDur: 0.55, arrow: 6.95, arrowDur: 0.3, type: 7.35, per: 0.035 };
  const L1 = { s: "take a sip.", x: 506, y: 1080, size: 66, rot: -0.07 };
  const L2 = { s: "X0 will handle it.", x: 510, y: 1130, size: 32 };
  const clamp = (x) => Math.max(0, Math.min(1, x)), fr = (t, a, d) => clamp((t - a) / d);

  async function start() {
    const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), u = W / 1080;
    const cv = document.getElementById("c"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    await X0.fonts();
    const man = {}; for (let i = 1; i <= N; i++) man[`f${i}`] = new URL(`footage-sip/s${String(i).padStart(4, "0")}.jpg`, location.href).href;
    const A = await X0.load(man);
    const F1 = X0.font(700, L1.size, "Caveat"), F2 = X0.font(800, L2.size);
    const w1 = X0.width(ctx, L1.s, F1);
    // line 1 drawn once, off screen, so it can be written on with a ragged pen edge
    const pad = 20, hand = X0.offscreen(w1 + 2 * pad, L1.size * 1.6), hc = hand.getContext("2d");
    hc.font = F1; hc.fillStyle = RED; hc.textBaseline = "alphabetic"; hc.fillText(L1.s, pad, L1.size * 1.15);
    window.TRAILER = { duration: DUR };

    window.__frame = (t) => {
      ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
      const n = Math.min(N, Math.round(t * FPS) + 1);
      // after the freeze a slow push-in toward the cup (1.00 -> 1.035), so the still frame breathes with the steam
      const z = t < FREEZE ? 1 : 1 + 0.035 * X0.E.io(fr(t, FREEZE, DUR - FREEZE)), cx = 780, cy = 1150;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx, -cy);
      ctx.drawImage(A[`f${n}`], 0, 0, 1080, 1920);
      ctx.restore();
      if (t < T.hand) return;
      ctx.save(); ctx.shadowColor = "rgba(10,14,22,0.35)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      // 1 'take a sip.' written on, tilted a touch
      ctx.save(); ctx.translate(L1.x, L1.y); ctx.rotate(L1.rot);
      X0.reveal(ctx, hand, -pad, -L1.size * 1.15, hand.width, hand.height, X0.E.io(fr(t, T.hand, T.handDur)), "x", { rag: 6, seed: 5 });
      ctx.restore();
      // 2 the arrow: from the end of the line, a loose curve down to the cup
      const k = X0.E.o3(fr(t, T.arrow, T.arrowDur));
      if (k > 0) {
        const p0 = [L1.x + w1 * 0.93 + 10, L1.y - 8], c1 = [p0[0] + 70, p0[1] + 10], c2 = [p0[0] + 60, p0[1] + 95], p1 = [p0[0] + 18, p0[1] + 125];
        const bez = (s) => [0, 1].map((i) => (1 - s) ** 3 * p0[i] + 3 * (1 - s) ** 2 * s * c1[i] + 3 * (1 - s) * s * s * c2[i] + s ** 3 * p1[i]);
        ctx.strokeStyle = RED; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        const steps = 40; for (let i = 0; i <= steps * k; i++) { const [x, y] = bez(i / steps); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        if (k >= 1) {   // the head, two quick strokes
          const [ax, ay] = bez(1), [bx, by] = bez(0.92), a = Math.atan2(ay - by, ax - bx), hl = 20;
          ctx.beginPath(); ctx.moveTo(ax - hl * Math.cos(a - 0.55), ay - hl * Math.sin(a - 0.55)); ctx.lineTo(ax, ay); ctx.lineTo(ax - hl * Math.cos(a + 0.5), ay - hl * Math.sin(a + 0.5)); ctx.stroke();
        }
      }
      // 3 'X0 will handle it.' typed, a tick per letter
      const shown = Math.floor(Math.max(0, t - T.type) / T.per);
      if (shown > 0) X0.text(ctx, L2.s.slice(0, shown), L2.x, L2.y, F2, RED);
      ctx.restore();
    };
    window.__cues = () => {
      const c = [{ at: 0, kind: "sample", file: "sip-sfx/bed.wav", gain: 1 }, { at: FREEZE, kind: "freeze", gain: 0.45 },
        { at: T.hand, kind: "sample", file: "spots/10-sfx/scratch-1.wav", gain: 0.5 }, { at: T.hand + 0.26, kind: "sample", file: "spots/10-sfx/scratch-2.wav", gain: 0.45 },
        { at: T.arrow, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 }];
      for (let i = 1; i <= L2.s.length; i++) if (L2.s[i - 1] !== " ") c.push({ at: +(T.type + i * T.per).toFixed(3), kind: "tick", gain: 0.35 });
      return c;
    };
    window.__ready = true;
  }
  start();
})();
