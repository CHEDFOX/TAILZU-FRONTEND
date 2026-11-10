/* THE EVENING IS YOURS: the dance film. A clip of a cel-shaded dancer on a dark stage, a string of lights coming on
 * over him (10 s, 24 fps, no sound). The payoff of the kitchen ad: the bots took the day, he took the floor.
 *
 * The cut: black and a handwritten hour; a hard cut into the dance in slow motion on a beat; six words slammed on
 * screen on six beats, each with a two-frame freeze (Dinner. Moved. Train. Booked. Leo. Knows.); the headline over the
 * slow motion as the lights come on ("Your evening / is yours"); the speed ramps up to real time and he dances; a
 * last freeze on a pose; the white sheet slides up: the hero, the mark, the stamp.
 *
 * Footage: footage-dance/ holds the clip's frames, the watermark cropped off, upscaled to 1080 x 1920 and motion-
 * interpolated to 72 fps, so the slow motion stays smooth. Everything is a pure function of t; the rhythm is 112.5 bpm
 * (a beat every 16 frames at 30 fps), the same grid as the trailer, and the sound is the brand's own synth.
 *
 * Render: PW_ROOT=<playwright dir> node ../trailer/render.mjs out --page dance.html --ratio 9x16
 */
(async () => {
  "use strict";
  const { C, E, K, clamp } = X0;
  const q = new URLSearchParams(location.search);
  const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), u = W / 1080, FPS = 30, BEAT = 16 / FPS;
  const cv = document.getElementById("c"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const abs = (p) => new URL(p, location.href).href;
  await X0.fonts();

  // ------------------------------------------------------------------------------------------------ assets
  const FOOT_N = +(q.get("frames") || 726), FOOT_FPS = 72, FOOT_DIR = q.get("footage") || "footage-dance/";
  const man = {
    paper: "components/paper.jpg", mark: "components/mark-x0-ink.png", stamp: "components/pen-stamp.png",
    head: "hero/hang-head-1632.png", bar: "hero/hang-bar-1632.png", hands: "hero/hang-hands-1632.png", blink: "hero/hang-blink-1632.png",
    face: "hero/hang-face-1632.png", eyes: "hero/hang-eyes-1632.png", lidL: "hero/hang-lidL-1632.png", lidR: "hero/hang-lidR-1632.png",
    "ul-bar": "../store/out/art/underline-c9683f.png", "ul-plan": "../store/out/art/underline-8f6a1f.png", "ul-travel": "../store/out/art/underline-3e6e8e.png", "ul-keybot": "../store/out/art/underline-a9573a.png",
  };
  for (let i = 1; i <= FOOT_N; i++) man[`f${i}`] = abs(`${FOOT_DIR}s${String(i).padStart(4, "0")}.jpg`);
  const A = await X0.load(man);

  // ------------------------------------------------------------------------------------------------ the timeline (seconds)
  const F = (n) => n / FPS, fr = (t, t0, dur) => clamp((t - t0) / dur);
  const T = {};
  T.cut = 1.6;                                   // black, then the hard cut into the dance
  const HITS = [];                               // six words on six beats, each a 2-frame freeze
  const WORDS = [["Dinner", null], ["moved", "ul-plan"], ["Train", null], ["booked", "ul-travel"], ["Leo", null], ["knows", "ul-keybot"]];
  for (let i = 0; i < 6; i++) HITS.push({ t: T.cut + BEAT * (3 + i), word: WORDS[i][0], ul: WORDS[i][1], pair: Math.floor(i / 2) });
  T.hitsEnd = HITS[5].t + BEAT;
  T.head0 = T.hitsEnd + BEAT * 0.5; T.head1 = T.head0 + BEAT * 8;        // the headline over the slow motion, the lights coming on
  T.ramp0 = T.head1; T.ramp1 = T.ramp0 + BEAT * 3;                       // the speed ramps to real time
  T.dance1 = T.ramp1 + BEAT * 5;                                         // he dances
  T.freeze = T.dance1; T.freezeEnd = T.freeze + BEAT * 1.5;              // the last pose, held
  T.end0 = T.freezeEnd; T.end1 = T.end0 + 4.9;
  const DURATION = T.end1;
  window.TRAILER = { duration: DURATION, T, HITS };

  /** The footage's clock: slow (0.5x) through the hits, 0.45x under the headline, ramping to 1.0x, then held on the last pose. */
  const SRC_TOTAL = FOOT_N / FOOT_FPS;
  const keys = [[T.cut, 0.15]];
  { let s = 0.15, t = T.cut;
    for (const h of HITS) { s += (h.t - t) * 0.5; keys.push([h.t, s]); keys.push([h.t + F(2), s]); t = h.t + F(2); }   // a 2-frame hold on each word
    s += (T.head0 - t) * 0.5; keys.push([T.head0, s]);
    s += (T.head1 - T.head0) * 0.45; keys.push([T.head1, s]);
    s += (T.ramp1 - T.ramp0) * 0.72; keys.push([T.ramp1, s]);           // the ramp's average speed
    const left = SRC_TOTAL - 0.05 - s, need = (T.dance1 - T.ramp1) * 1.0; const sp = Math.min(1.0, left / need);
    s += (T.dance1 - T.ramp1) * sp; keys.push([T.dance1, s]); keys.push([T.end0 + 1, s]); }
  function srcTime(t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, sa] = keys[i - 1], [b, sb] = keys[i]; return sa + (sb - sa) * (b > a ? (t - a) / (b - a) : 1); }
    return keys[keys.length - 1][1];
  }
  const footage = (t) => A[`f${clamp(Math.round(srcTime(t) * FOOT_FPS) + 1, 1, FOOT_N)}`];

  // ------------------------------------------------------------------------------------------------ helpers
  const BAR_H = 112;   // the cinema bars, top and bottom
  function onFilm(s, x, y, f, color = "rgba(255,255,255,0.95)", align = "left", alpha = 1) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 3;
    X0.text(ctx, s, x, y, f, color, align); X0.text(ctx, s, x, y, f, color, align); ctx.restore();
  }
  /** Is t inside a hit's 2-frame hold? Returns the hit. */
  const hitAt = (t) => HITS.find((h) => t >= h.t && t < h.t + F(2));
  /** The six words: each slams on at its beat (scale 1.3 -> 1, 3 f) and holds for its pair; a pair shows as two words, the second with a brush underline. */
  function hitWords(t) {
    for (let p = 0; p < 3; p++) {
      const a = HITS[p * 2], b = HITS[p * 2 + 1], tEnd = p < 2 ? HITS[(p + 1) * 2].t : T.head0 - F(4);
      if (t < a.t || t >= tEnd) continue;
      const size = 150, y = 1000, f = X0.font(900, size);
      const wa = X0.width(ctx, a.word, f), wb = X0.width(ctx, b.word + ".", f), gap = 36, total = wa + gap + wb, x0 = 540 - total / 2;
      const ka = fr(t, a.t, F(3)), sa = 1.3 - 0.3 * E.o3(ka);
      ctx.save(); ctx.translate(x0 + wa / 2, y); ctx.scale(sa, sa); onFilm(a.word, 0, 0, f, "rgba(255,255,255,0.96)", "center", Math.min(1, ka * 2)); ctx.restore();
      if (t >= b.t) {
        const kb = fr(t, b.t, F(3)), sb = 1.3 - 0.3 * E.o3(kb);
        ctx.save(); ctx.translate(x0 + wa + gap + wb / 2, y); ctx.scale(sb, sb); onFilm(b.word + ".", 0, 0, f, "rgba(255,255,255,0.96)", "center", Math.min(1, kb * 2)); ctx.restore();
        const im = A[b.ul], ww = wb - X0.width(ctx, ".", f), uw = ww * 1.08, uh = Math.max(22, uw * im.height / im.width * 1.1);
        X0.reveal(ctx, im, x0 + wa + gap - (uw - ww) / 2, y + 22, uw, uh, E.o3(fr(t, b.t + F(3), F(6))), "x", { rot: -0.012, rag: 9, seed: 3 + p });
      }
    }
  }
  /** The headline: "Your evening / is yours", heavy white Geist, 'yours' by hand with the icon's clay underline. */
  function headline(t) {
    if (t < T.head0 || t >= T.ramp1) return;
    const size = 136, x = 80, base = [560, 716];
    const l1 = fr(t, T.head0, F(7)), l2 = fr(t, T.head0 + F(6), F(7)), lh = fr(t, T.head0 + F(12), F(7)), lu = fr(t, T.head0 + F(18), F(9));
    const out = t >= T.head1 ? E.i2(fr(t, T.head1, F(10))) : 0;
    ctx.save(); ctx.globalAlpha *= 1 - out; ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
    const line1 = X0.layout(ctx, [{ text: "Your" }, { text: "evening" }], { x, y: base[0], size, weight: 900, color: "#FFFFFF" });
    const line2 = X0.layout(ctx, [{ text: "is" }, { text: "yours", hand: true, handWeight: 700, scale: 1.15 }], { x, y: base[1], size, weight: 900, color: "#FFFFFF" });
    ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base[0] - size * 1.3, (line1.w + 40) * E.o3(l1), size * 1.7); ctx.clip(); X0.drawLine(ctx, line1); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base[1] - size * 1.3, (line2.w + 40) * E.o3(l2), size * 1.7); ctx.clip(); X0.drawLine(ctx, line2, (i, w) => (w.hand ? { a: 0 } : { a: 1 })); ctx.restore();
    const hw = line2.words[1];
    ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, base[1] - size * 1.3, (hw.w + 30) * E.o3(lh), size * 1.8); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore();
    ctx.restore();
    if (lu > 0 && out < 1) { const im = A["ul-bar"], uw = hw.w * 1.08, uh = Math.max(26, uw * im.height / im.width * 1.15); X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 12, hw.y + 16, uw, uh, E.o3(lu), "x", { rot: -0.012, rag: 10, seed: 2, alpha: 1 - out }); }
  }
  /** The painted mark drawn in three strokes, the 0 narrowed to a digit's proportions. */
  function paintMark(mx, my, mw, s1, s2, s3) {
    const mh = mw * A.mark.height / A.mark.width;
    const region = (x0, x1, k, dir, squeeze = 1) => {
      if (k <= 0) return; const cvs = X0.offscreen(mw, mh), c2 = cvs.getContext("2d");
      c2.beginPath(); c2.rect(mw * x0, 0, mw * (x1 - x0), mh); c2.clip();
      const cx = mw * (x0 + x1) / 2; c2.translate(cx, 0); c2.scale(squeeze, 1); c2.translate(-cx, 0); c2.drawImage(A.mark, 0, 0, mw, mh);
      X0.reveal(ctx, cvs, mx, my, mw, mh, k, dir, { rag: 10, seed: 7 }); X0.release(cvs);
    };
    region(0, 0.47, E.o3(s1), "diag"); if (s2 > 0) region(0, 0.47, E.o3(s2), "-diag"); region(0.52, 1, s3, "conic", 0.74);   // 0.52: the X's tip, squeezed inward, must stay out of the 0's region
  }
  /** The end card (the campaign's): the sheet, the hero on his bar, the mark, the line, the stamp with the address first. */
  function endCard(t) {
    if (t < T.end0) return;
    const kin = E.o5(fr(t, T.end0, F(14))), dy = (1 - kin) * 1920;
    ctx.save(); ctx.translate(0, dy);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 60; ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920 + 40); ctx.restore();
    X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 });
    const te = t - T.end0;
    const open = E.o3(fr(te, F(18), F(4))), wink = te >= F(104) && te < F(118) ? (te < F(108) ? fr(te, F(104), F(4)) : te < F(114) ? 1 : 1 - fr(te, F(114), F(4))) : 0;
    const look = { dx: 0, dy: 4 * (1 - E.io(fr(te, F(40), F(10)))) };
    X0.hang(ctx, A, 8, 100, 816, null, { eyes: look, blink: 1 - open, lids: [wink, 0], bob: te < F(96) ? Math.sin(te * 2.2) * 3 * (1 - fr(te, F(84), F(12))) : 0, sway: -2.5 * wink });
    paintMark(80, 740, 460, fr(te, F(24), F(6)), fr(te, F(30), F(6)), E.io(fr(te, F(36), F(16))));
    const kl = E.o3(fr(te, F(58), F(9))); if (kl > 0) { ctx.save(); ctx.beginPath(); ctx.rect(60, 1030, 1000 * kl, 100); ctx.clip(); X0.text(ctx, "Your team of bots", 80, 1095, X0.font(600, 60), C.ink); ctx.restore(); }
    const ks = fr(te, F(70), F(4)); if (ks > 0) { const sw = 560, sh = sw * A.stamp.height / A.stamp.width, sx = 80, sy = 1165 + (150 - sh) / 2;
      ctx.save(); ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(-0.045); const ps = 1.08 - 0.08 * E.o5(ks); ctx.scale(ps, ps); ctx.translate(-(sx + sw / 2), -(sy + sh / 2));
      ctx.drawImage(A.stamp, sx, sy, sw, sh);
      X0.text(ctx, "Coming soon", sx + 40, sy + sh * 0.4, X0.font(500, 38), "#555555");
      const uf = X0.font(700, 58), ux = sx + 40, uy = sy + sh * 0.8; X0.text(ctx, "x0bot.com", ux, uy, uf, "#111111");
      const zx = ux + X0.width(ctx, "x", uf), zw = X0.width(ctx, "0", uf); ctx.strokeStyle = "#111111"; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(zx + zw * 0.72, uy - 58 * 0.66); ctx.lineTo(zx + zw * 0.28, uy - 58 * 0.06); ctx.stroke();
      ctx.restore(); }
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the frame
  window.__frame = (t) => {
    ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, 1920);
    if (t < T.cut) {
      // black, the hour in his hand, and what got done (the kitchen's three jobs), small
      onFilm("9:30 pm", 80, 920, X0.font(700, 72, "Caveat"), "rgba(255,255,255,0.9)", "left", Math.min(fr(t, 0.2, 0.3), 1 - fr(t, T.cut - 0.2, 0.2)));
      const line = "Dinner moved. Train booked. Leo knows.", f = X0.font(500, 44), wds = line.split(" "); let x = 80;
      wds.forEach((w, i) => { const k = fr(t, 0.55 + i * 0.1, 0.2); if (k > 0) onFilm(w, x, 1000, f, "rgba(255,255,255,0.6)", "left", Math.min(k, 1 - fr(t, T.cut - 0.2, 0.2))); x += X0.width(ctx, w + " ", f); });
    } else if (t < T.end0 + F(14)) {
      const hit = hitAt(t), frozen = t >= T.freeze ? 1 : 0, cold = hit ? 1 : frozen * E.o3(fr(t, T.freeze, F(5)));
      // the footage: a slow push-in, harder as the dance quickens; cold on the holds
      const zoom = 1 + 0.04 * fr(t, T.cut, T.freeze - T.cut) + 0.02 * cold;
      ctx.save(); ctx.filter = `contrast(${1.08 + 0.08 * cold}) saturate(${0.9 - 0.5 * cold}) brightness(${1 - 0.18 * cold})`;
      X0.cover(ctx, footage(t), 0, 0, 1080, 1920, { zoom });
      ctx.restore();
      // the clip's own watermark sits at the left edge over the dark backdrop: a soft dark patch over it, under the vignette
      { const g = ctx.createRadialGradient(90, 1262, 10, 90, 1262, 230); g.addColorStop(0, "rgba(4,5,8,1)"); g.addColorStop(0.55, "rgba(4,5,8,0.96)"); g.addColorStop(1, "rgba(4,5,8,0)"); ctx.fillStyle = g; ctx.fillRect(-100, 1030, 420, 470); }
      X0.vignette(ctx, 1080, 1920, 0.25 + 0.3 * cold);
      if (hit && t < hit.t + F(1)) { ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(0, 0, 1080, 1920); }   // the shutter on a hit
      if (t >= T.freeze && t < T.freeze + F(1)) { ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(0, 0, 1080, 1920); }
      // the cinema bars
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, BAR_H); ctx.fillRect(0, 1920 - BAR_H, 1080, BAR_H);
      // the small brand line in the bottom bar from the cut
      const ka = Math.min(fr(t, T.cut + 0.3, 0.4), 1 - fr(t, T.end0 - 0.4, 0.3));
      if (ka > 0) { const im = X0.tint(A.mark, "#FFFFFF"), mh = 40, mw = mh * A.mark.width / A.mark.height; ctx.save(); ctx.globalAlpha *= 0.85 * ka; ctx.drawImage(im, 80, 1920 - BAR_H / 2 - mh / 2, mw, mh); X0.text(ctx, "Your team of bots", 80 + mw + 22, 1920 - BAR_H / 2 + 12, X0.font(500, 34), "rgba(255,255,255,0.7)"); ctx.restore(); }
      hitWords(t); headline(t);
    }
    endCard(t);
    X0.grain(ctx, 1080, 1920, t, t >= T.end0 + F(14) ? 0.03 : 0.08, 1);
    if (q.get("hud")) X0.text(ctx, `t ${t.toFixed(2)} f${Math.round(t * FPS)} src ${srcTime(t).toFixed(2)}`, 16, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
  };

  // ------------------------------------------------------------------------------------------------ the sound
  window.__cues = () => {
    const c = [];
    c.push({ at: 0, kind: "drone", dur: T.end0 + 0.5, f: 55, gain: 0.45, a: 1.5, r: 1 });
    c.push({ at: 0.2, kind: "tick", gain: 0.25 }, { at: 0.55, kind: "write", gain: 0.3 });
    c.push({ at: T.cut - 0.9, kind: "riser", dur: 0.9, gain: 0.5 }, { at: T.cut, kind: "boom", gain: 0.8 });
    // the beat: a thump on every beat from the cut to the last freeze, hats on the 8ths once the headline is up, doubled in the real-time dance
    for (let t = T.cut; t < T.freeze; t += BEAT) c.push({ at: t, kind: "pulse", gain: t >= T.ramp1 ? 0.7 : 0.5 });
    for (let t = T.head0; t < T.freeze; t += BEAT / 2) c.push({ at: t + BEAT / 4, kind: "tick", gain: t >= T.ramp1 ? 0.35 : 0.22 });
    for (let t = T.ramp1; t < T.freeze; t += BEAT / 4) c.push({ at: t + BEAT / 8, kind: "tick", gain: 0.18 });
    for (const h of HITS) { c.push({ at: h.t, kind: "freeze", gain: 0.6 }, { at: h.t, kind: "boom", gain: 0.3, f0: 70, f1: 40, dur: 0.6 }); if (h.ul) c.push({ at: h.t + F(3), kind: "bell", f: [369.99, 440, 293.66][h.pair], dur: 1.0, gain: 0.35 }, { at: h.t + F(3), kind: "whoosh", dur: 0.25, up: false, gain: 0.25 }); }
    c.push({ at: T.head0, kind: "tick", gain: 0.3 }, { at: T.head0 + F(6), kind: "tick", gain: 0.3 }, { at: T.head0 + F(12), kind: "write", gain: 0.4 }, { at: T.head0 + F(18), kind: "whoosh", dur: 0.3, up: false, gain: 0.35 });
    c.push({ at: T.head0 + BEAT * 2, kind: "pad", f: 110, dur: BEAT * 6, gain: 0.5, a: 1.5, r: 1.5 });
    c.push({ at: T.ramp0, kind: "riser", dur: T.ramp1 - T.ramp0, gain: 0.6 }, { at: T.ramp1, kind: "boom", gain: 0.6 });
    c.push({ at: T.freeze - 0.4, kind: "riser", dur: 0.4, gain: 0.4 }, { at: T.freeze, kind: "boom", gain: 0.9 }, { at: T.freeze, kind: "freeze", gain: 0.7 });
    c.push({ at: T.end0, kind: "open", gain: 0.6 }, { at: T.end0 + F(14), kind: "land", gain: 0.5 }, { at: T.end0 + F(18), kind: "listen", gain: 0.3 });
    c.push({ at: T.end0 + F(24), kind: "write", gain: 0.35 }, { at: T.end0 + F(30), kind: "land", gain: 0.35 }, { at: T.end0 + F(36), kind: "whoosh", dur: 0.5, up: true, gain: 0.3 });
    c.push({ at: T.end0 + F(52), kind: "boom", gain: 0.7 }, { at: T.end0 + F(52), kind: "chord", f: 146.83, dur: 3, gain: 0.5 });
    for (const [f, g] of [[293.66, 0.22], [369.99, 0.22], [440, 0.22], [493.88, 0.22], [587.33, 0.25]]) c.push({ at: T.end0 + F(52), kind: "bell", f, dur: 2.4, gain: g });
    c.push({ at: T.end0 + F(58), kind: "write", gain: 0.3 }, { at: T.end0 + F(70), kind: "land", gain: 0.4 }, { at: T.end0 + F(70), kind: "click", gain: 0.3 }, { at: T.end0 + F(104), kind: "bell", f: 587.33, dur: 0.5, gain: 0.3 });
    return c;
  };
  window.__ready = true;
})().catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
