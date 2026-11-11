/* "Take a sip": the clip plays, freezes at 6.0 s on the man at his desk, and while everything else holds still the steam
 * off his cup keeps rising (footage-sip/ is the plate from sip-tools/plate.py: frames 1-144 as shot, then the frozen
 * frame with the clip's own steam laid back in above the cup, aligned and cross-faded).
 * Laid out as the kitchen ad ("Hands full"): the white X0 mark top right from the first second; on the freeze one pale
 * shutter frame, the frame goes a touch cold, a dark band comes down at the top, and the headline writes on there,
 * white heavy Geist with the hand word in red over a red brush underline; one small bold red line types under it.
 * Render at the footage's 24 fps:  render.mjs out --page ad/sip.html --ratio 9x16 --fps 24 --name sip */
(() => {
  const q = new URLSearchParams(location.search);
  const FPS = 24, N = 252, DUR = N / FPS, FREEZE = 6.0, f = (n) => n / 30;
  const RED = "#FF3B2F";
  const T = { l1: 6.3, hand: 6.55, ul: 6.85, l2: 7.45, per: 0.04 };
  const HEAD = { x: 80, base: 430, size: 112 }, SMALL = { y: 530, size: 46 };
  const L2 = "X0 will handle the rest.";
  const { E } = X0, clamp = (x) => Math.max(0, Math.min(1, x)), fr = (t, a, d) => clamp((t - a) / d);

  async function start() {
    const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), u = W / 1080;
    const cv = document.getElementById("c"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    await X0.fonts();
    const man = { mark: "components/mark-x0-ink.png", ul: "../store/out/art/underline-0a0a0a.png" };
    for (let i = 1; i <= N; i++) man[`f${i}`] = new URL(`footage-sip/s${String(i).padStart(4, "0")}.jpg`, location.href).href;
    const A = await X0.load(man);
    const ulRed = X0.tint(A.ul, RED), markW = X0.tint(A.mark, "#FFFFFF");
    window.TRAILER = { duration: DUR };
    const freezeK = (t) => E.o3(fr(t, FREEZE, f(5)));

    function headline(t) {
      if (t < T.l1) return;
      const { x, base, size } = HEAD;
      const line = X0.layout(ctx, [{ text: "Take" }, { text: "a" }, { text: "sip", hand: true, handWeight: 700, scale: 1.18, color: RED }], { x, y: base, size, weight: 900, color: "#FFFFFF" });
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
      const k = E.o3(fr(t, T.l1, f(7)));
      ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base - size * 1.3, (line.w + 40) * k, size * 1.7); ctx.clip(); X0.drawLine(ctx, line, (i, w) => ({ a: w.hand ? 0 : 1 })); ctx.restore();
      const hw = line.words[2];
      if (t >= T.hand) { const kh = E.o3(fr(t, T.hand, f(8))); ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, base - size * 1.4, (hw.w + 30) * kh, size * 1.9); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore(); }
      ctx.restore();
      if (t >= T.ul) { const uw = hw.w * 1.12, uh = Math.max(24, uw * A.ul.height / A.ul.width * 1.2); X0.reveal(ctx, ulRed, hw.x - (uw - hw.w) / 2 + 8, hw.y + size * 0.13, uw, uh, E.o3(fr(t, T.ul, f(9))), "x", { rot: -0.015, rag: 10, seed: 2 }); }
      // the small line: bold, red, typed a letter at a time
      const shown = Math.floor(Math.max(0, t - T.l2) / T.per);
      if (shown > 0) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2; X0.text(ctx, L2.slice(0, shown), x + 4, SMALL.y, X0.font(800, SMALL.size), RED); ctx.restore(); }
    }

    window.__frame = (t) => {
      ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
      const n = Math.min(N, Math.round(t * FPS) + 1), fz = freezeK(t);
      // the footage: a slow push-in from the freeze toward the cup, a touch cold and dim while frozen (the steam rides along)
      const z = 1 + 0.035 * E.io(fr(t, FREEZE, DUR - FREEZE)), cx = 780, cy = 1150;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx, -cy);
      if (fz > 0) ctx.filter = `saturate(${1 - 0.18 * fz}) brightness(${1 - 0.07 * fz})`;
      ctx.drawImage(A[`f${n}`], 0, 0, 1080, 1920); ctx.filter = "none";
      ctx.restore();
      // the shutter: one pale frame as the film freezes
      if (t >= FREEZE && t < FREEZE + 1 / FPS) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(0, 0, 1080, 1920); }
      // the dark band at the top for the headline
      if (fz > 0) { const g = ctx.createLinearGradient(0, 0, 0, 760); g.addColorStop(0, `rgba(0,0,0,${0.78 * fz})`); g.addColorStop(0.55, `rgba(0,0,0,${0.55 * fz})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 760); }
      // the mark, top right, from the first second
      const ma = fr(t, 0.6, 0.4); if (ma > 0) { const mh = 52, mw = mh * A.mark.width / A.mark.height; ctx.save(); ctx.globalAlpha *= 0.82 * ma; ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10; ctx.drawImage(markW, 1000 - mw, 296, mw, mh); ctx.restore(); }
      headline(t);
      if (q.get("hud")) X0.text(ctx, `t ${t.toFixed(2)} f${n}`, 16, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
    };
    window.__cues = () => {
      const c = [{ at: 0, kind: "sample", file: "sip-sfx/bed.wav", gain: 1 }, { at: FREEZE, kind: "freeze", gain: 0.6 },
        { at: T.l1, kind: "whoosh", dur: 0.22, up: true, gain: 0.2 }, { at: T.hand, kind: "sample", file: "spots/10-sfx/scratch-1.wav", gain: 0.5 },
        { at: T.ul, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 }, { at: T.ul + 0.05, kind: "bell", f: 293.66, dur: 1.4, gain: 0.35 }];
      for (let i = 1; i <= L2.length; i++) if (L2[i - 1] !== " ") c.push({ at: +(T.l2 + i * T.per).toFixed(3), kind: "tick", gain: 0.3 });
      return c;
    };
    window.__ready = true;
  }
  start();
})();
