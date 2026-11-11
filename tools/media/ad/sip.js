/* "Take a sip": the clip plays, freezes at 6.0 s on the man at his desk, and while everything else holds still the steam
 * off his cup keeps rising (footage-sip/ is the plate from sip-tools/plate.py: frames 1-144 as shot, then the frozen
 * frame with the clip's own steam laid back in above the cup, aligned and cross-faded).
 * Graded and laid out as the kitchen ad ("Hands full", kitchen.js), on the ad kit: the same contrast / saturation /
 * brightness and vignette, the slow push-in through the ad, the freeze that goes cold and dim with one pale shutter frame,
 * the hour written in his hand at the open, the white X0 mark top right, the top scrim under a white heavy headline with
 * one hand word (red here, over a red brush underline) and one small bold red line, then the campaign's end card.
 * Render at the footage's 24 fps:  render.mjs out --page ad/sip.html --ratio 9x16 --fps 24 --name sip */
(() => {
  const { E } = X0, { F, fr } = AD;
  const N = 252, FREEZE = 6.0, END = 10.0, DURATION = END + AD.END_S;
  const RED = "#FF3B2F";
  const T = { l1: 6.3, hand: 6.55, ul: 6.85, l2: 7.45, per: 0.04 };
  const HEAD = { x: 80, base: 430, size: 112 }, SMALL = { y: 530, size: 46 };
  const L2 = "X0 will handle the rest.";
  /** How deep in the freeze we are at t: 0 moving, 1 frozen (in over 5 f, as the kitchen ad). */
  const freezeK = (t) => (t < FREEZE - F(1) ? 0 : E.o3(fr(t, FREEZE - F(1), F(5))));

  function headline(S, t) {
    const { ctx } = S; if (t < T.l1) return;
    const { x, base, size } = HEAD;
    const line = X0.layout(ctx, [{ text: "Take" }, { text: "a" }, { text: "sip", hand: true, handWeight: 700, scale: 1.18, color: RED }], { x, y: base, size, weight: 900, color: "#FFFFFF" });
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
    const k = E.o3(fr(t, T.l1, F(7)));
    ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base - size * 1.3, (line.w + 40) * k, size * 1.7); ctx.clip(); X0.drawLine(ctx, line, (i, w) => ({ a: w.hand ? 0 : 1 })); ctx.restore();
    const hw = line.words[2];
    if (t >= T.hand) { const kh = E.o3(fr(t, T.hand, F(8))); ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, base - size * 1.4, (hw.w + 30) * kh, size * 1.9); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore(); }
    ctx.restore();
    if (t >= T.ul) { const ul = S.ulRed, uw = hw.w * 1.12, uh = Math.max(24, uw * ul.height / ul.width * 1.2); X0.reveal(ctx, ul, hw.x - (uw - hw.w) / 2 + 8, hw.y + size * 0.13, uw, uh, E.o3(fr(t, T.ul, F(9))), "x", { rot: -0.015, rag: 10, seed: 2 }); }
    const shown = Math.floor(Math.max(0, t - T.l2) / T.per);
    if (shown > 0) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2; X0.text(ctx, L2.slice(0, shown), x + 4, SMALL.y, X0.font(800, SMALL.size), RED); ctx.restore(); }
  }

  AD.start({
    footage: { sip: { dir: "footage-sip/", frames: N, fps: 24 } },
    duration: DURATION,
    frame(t, S) {
      const { ctx } = S;
      if (!S.ulRed) S.ulRed = X0.tint(S.A["ul-ink"], RED);
      ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, 1080, 1920);
      if (t < END + F(14)) {
        // the footage: the plate's own clock (it holds the freeze itself), a slow push-in through the ad, a little more
        // inside the freeze; cold and dim while frozen (the kitchen ad's numbers)
        const fz = freezeK(t), zoom = 1 + 0.05 * (t / DURATION) + 0.03 * fz;
        ctx.save(); ctx.filter = `contrast(${1.06 + 0.06 * fz}) saturate(${0.92 - 0.45 * fz}) brightness(${0.98 - 0.2 * fz})`;
        X0.cover(ctx, S.foot("sip", Math.min(t, (N - 1) / 24)), 0, 0, 1080, 1920, { zoom });
        ctx.restore();
        X0.vignette(ctx, 1080, 1920, 0.22 + 0.3 * fz);
        // the shutter: one pale frame as the film freezes
        if (t >= FREEZE && t < FREEZE + 1 / 24) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(0, 0, 1080, 1920); }
        // the scrim at the top under the headline (a little deeper than the kitchen's: the window behind is pale)
        if (t >= T.l1 - 0.3) { const g = ctx.createLinearGradient(0, 0, 0, 760), a = 0.55 * E.io(fr(t, T.l1 - 0.3, 0.5)); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 760); }
        // the opening: the hour, in his hand, at the headline's margin
        if (t > 0.2 && t < 2.8) AD.onFilm(S, "11:48 pm", 80, 340, X0.font(700, 60, "Caveat"), "rgba(255,255,255,0.88)", "left", Math.min(fr(t, 0.2, 0.25), 1 - fr(t, 2.5, 0.3)));
        // the mark, top right, from the first second
        const ma = Math.min(fr(t, 0.6, 0.4), 1 - fr(t, END - 0.2, 0.3)); if (ma > 0) { const mh = 52, mw = mh * S.A.mark.width / S.A.mark.height; AD.cornerMark(S, 1000 - mw, 296, mh, 0.82 * ma); }
        headline(S, t);
      }
      AD.endCard(S, t, END);
    },
    cues() {
      const c = [{ at: 0, kind: "sample", file: "sip-sfx/bed.wav", gain: 1 }, { at: FREEZE, kind: "freeze", gain: 0.7 },
        { at: T.l1, kind: "whoosh", dur: 0.22, up: true, gain: 0.2 }, { at: T.hand, kind: "sample", file: "spots/10-sfx/scratch-1.wav", gain: 0.5 },
        { at: T.ul, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 }, { at: T.ul + 0.05, kind: "bell", f: 293.66, dur: 1.4, gain: 0.35 }];
      for (let i = 1; i <= L2.length; i++) if (L2[i - 1] !== " ") c.push({ at: +(T.l2 + i * T.per).toFixed(3), kind: "tick", gain: 0.3 });
      return c.concat(AD.endCues(END));
    },
  });
})();
