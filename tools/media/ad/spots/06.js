/* THE HOLD (spot 06): Travel, and the value: it finds, you always press pay. The Precisionist: the camera never gets
 * excited, the cut does; a wall clock under everything; tension held one beat past comfort, released by the smallest sound.
 *
 * Four held things, each frozen a frame before it goes (a sprinter set, a hand over a chess piece, a train at a night
 * platform, a diver on the edge), each freeze going cold with a Travel card taped on; then white paper: the four cards
 * small along the top, the question card ('Pay for / 2 tickets?') with a dip-pen 'Yes' and a smaller 'Not now'; the
 * hero lowers in on his bar, looks at the button, looks at us, blinks, and waits five seconds without touching it; a hand
 * writes 'yes', a stamp says Paid, the clock stops, and the whole held world moves at once: four hard cuts, then the
 * train pulling away at half speed under the headline 'It finds / You press pay'. The campaign's end card, the hero
 * looking and waiting.
 *
 * Footage (one grade: contrast up, saturation -40 %, cool, heavy grain, vignette, thin ink letterbox bars):
 *   a  ../footage-06-a/  Mixkit 588, a sprint start, 8.2-10.6 s, crop 0.47,0,0.316,1, 24 fps (no interpolation). The
 *                        release shows a clothing wordmark on her left thigh: it is masked frame by frame (LOGO_A).
 *   b  ../footage-06-b/  Mixkit 5338, a hand over a chess piece, 3.5-6.5 s, crop 0.66,0,0.316,1, 24 fps.
 *   c  ../footage-06-c/  Coverr 'blue subway departing' (native 9:16), 8.4-12.6 s, motion-interpolated to 72 fps (the
 *                        hold and the tail run at 0.5x). The far wall's poster and the LED clock are graded out.
 *   d  ../footage-06-d/  Internet Archive gov.archives.arc.28759 (public domain), the platform dive at 25.4-26.7 s:
 *                        deinterlaced (yadif), 720x480 SAR 8:9 scaled to 640x480 square pixels, crop 0.29,0,0.42,1,
 *                        motion-interpolated to 72 fps (the still beat runs at 0.25x).
 * Sound: sound.mjs kinds plus spots/06-sfx/ (node spots/06-sound.mjs): the clock, four ambiences cut dead on the freezes,
 * tape, pen, stamp, the four releases, the train, the thin sine. No voice: the film is built to be mute.
 */
(function () {
  "use strict";
  const { C, E, clamp } = X0;
  const FPS = 30, F = (n) => n / FPS, fr = AD.fr, lerp = AD.lerp;

  // ------------------------------------------------------------------------------------------------ the timeline (the bible's seconds)
  const T = {
    holds: [
      { key: "a", t0: 0.3, t1: 2.3, fz: 1.7, card: 1.8, text: "Flights found" },
      { key: "b", t0: 2.3, t1: 4.3, fz: 3.7, card: 3.8, text: "Stay found" },
      { key: "c", t0: 4.3, t1: 6.3, fz: 5.7, card: 5.8, text: "Weather checked" },
      { key: "d", t0: 6.3, t1: 8.3, fz: 7.7, card: 7.8, text: "Packing list made" },
    ],
    paper: 8.3, slide: F(10),
    heroIn: 8.8, heroDown: 9.3, lookDown: 9.8, lookUp: 10.5, blinks: [11.3, 12.9], waits: 11.7, waitsDur: 0.3,
    yes0: 13.8, yes1: 14.5, stamp: 14.5,
    rel: 14.8, cut: F(11), slow: 16.3,
    l1: 16.6, l2: 17.0, hand0: 17.2, hand1: 17.8, ul0: 17.8, ul1: 18.1,
    end0: 21.8,
  };
  T.cuts = [0, 1, 2, 3].map((i) => T.rel + i * T.cut);                  // 14.80, 15.17, 15.53, 15.90
  T.duration = T.end0 + AD.END_S;                                        // the kit's card runs 4.9 s: 0.4 s past the bible's 26.3

  // The footage's clocks (seconds into each folder). Holds: slow or real time into the freeze; releases: at speed.
  const SRC = {
    a: AD.map([[0.3, 0.31], [1.7, 1.5]]),                                // 0.85x: hips up into the set, frozen on idx 37
    b: AD.map([[2.3, 0.06], [3.7, 1.25]]),                               // 0.85x: the hand comes down and hovers, frozen clear of the piece
    c: AD.map([[4.3, 0.59], [5.7, 1.29]]),                               // 0.5x: the last car slides, frozen at its doors
    d: AD.map([[6.3, 0.125], [7.7, 0.458]]),                             // 0.25x: the diver still on the edge, frozen
    ra: AD.map([[T.cuts[0], 1.709], [T.cuts[1], 2.07]]),                 // she leaves the line (frames 42-51)
    rb: AD.map([[T.cuts[1], 1.917], [T.cuts[2], 2.375]]),                // 1.25x: lift, carry, set down
    rd: AD.map([[T.cuts[2], 0.542], [T.cuts[3], 0.909]]),                // he leaves the platform
    rc: AD.map([[T.cuts[3], 1.29], [T.slow, 1.69], [T.slow + 6, 4.69]]), // the train pulls away, then 0.5x to the end card
  };
  // Each source framed and exposed into the one grade (the same filter, trimmed for exposure only).
  const LOOK = {
    a: { zoom: 1.04, dy: 38, bright: 0.66, con: 1.26 },   // daylight: a heavy dark grade
    b: { zoom: 1.16, dy: -150, bright: 0.96, con: 1.14 }, // the fingertip and the piece lifted clear of the card
    c: { zoom: 1.0, dy: 0, bright: 1.06, con: 1.12 },
    d: { zoom: 1.2, dy: -190, bright: 0.74, con: 1.45 },  // the diver lifted clear of the card; the archive's greys pulled apart
  };

  /** The clothing wordmark on her left thigh in the release (folder a, frames 42-51): painted out by RGBA patches made
   *  by spots/06-mask.py (the fabric's own colour diffused over the letters), drawn over their frames. */
  const LOGO_A = [42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
  const MASK_ASSETS = Object.fromEntries(LOGO_A.map((i) => [`mask-a${i}`, new URL(`06-mask/a${i}.png`, location.href).href]));

  // ------------------------------------------------------------------------------------------------ the footage, cleaned and graded
  let scratch = null;
  /** The frame of folder `key` at source time src, with its marks painted out, on a 1080 x 1920 canvas. */
  function clean(S, key, src) {
    const img = S.foot(key, src);
    if (key !== "a" && key !== "c") return img;
    if (!scratch) { scratch = document.createElement("canvas"); scratch.width = 1080; scratch.height = 1920; }
    const c = scratch.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.filter = "none"; c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    c.drawImage(img, 0, 0, 1080, 1920);
    if (key === "a") {
      const idx = clamp(Math.round(src * 24) + 1, 1, 58), patch = S.A[`mask-a${idx}`];
      if (patch) c.drawImage(patch, 0, 0, 1080, 1920);
    } else {
      // the far wall's poster (from 10.3 s of the clip, revealed as the train goes): toned into the tiles, soft
      const k = clamp((src - 1.35) / 0.3);
      if (k > 0) { c.save(); c.beginPath(); c.rect(0, 0, 1080, 1034); c.clip(); c.globalAlpha = k * 0.95; c.filter = "blur(14px)"; const gr = c.createLinearGradient(496, 0, 686, 0); gr.addColorStop(0, "rgb(64,40,24)"); gr.addColorStop(1, "rgb(90,58,32)");
        c.fillStyle = gr; c.beginPath(); c.moveTo(498, 796); c.lineTo(686, 788); c.lineTo(686, 1040); c.lineTo(494, 1036); c.closePath(); c.fill(); c.restore(); }
      // the red LED clock over the tunnel mouth and the faint lettering high on the wall: down into the dark
      c.save(); c.filter = "blur(12px)"; c.fillStyle = "rgba(12,10,10,0.96)"; c.fillRect(70, 758, 250, 62); c.restore();
      c.save(); c.filter = "blur(18px)"; c.fillStyle = "rgba(24,17,12,0.8)"; c.beginPath(); c.moveTo(690, 760); c.lineTo(1100, 712); c.lineTo(1100, 812); c.lineTo(690, 826); c.closePath(); c.fill(); c.restore();
    }
    return scratch;
  }
  /** The one grade: contrast up, saturation -40 % (a third more gone in a cold freeze), cool, a soft vignette. */
  function film(S, key, src, cold = 0) {
    const L = LOOK[key], ctx = S.ctx;
    AD.film(S, clean(S, key, src), { zoom: L.zoom, dy: L.dy, vig: 0.4 + 0.08 * cold,
      grade: `contrast(${(L.con * (1 + 0.05 * cold)).toFixed(3)}) saturate(${(0.6 * (1 - cold / 3)).toFixed(3)}) brightness(${(L.bright * (1 - 0.07 * cold)).toFixed(3)})` });
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = `rgb(${Math.round(224 - 16 * cold)},${Math.round(233 - 6 * cold)},247)`; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
  }
  const BAR = 64;
  function bars(S) { const { ctx } = S; ctx.fillStyle = C.ink; ctx.fillRect(0, 0, 1080, BAR); ctx.fillRect(0, 1920 - BAR, 1080, BAR); }

  // ------------------------------------------------------------------------------------------------ the cards
  const PAD = 0.04 * 1080, HEAD = 84, NAME_F = X0.font(600, 38), LINE_F = X0.font(600, 49);   // ink Geist 0.045w
  const travel = AD.BOT.travel;
  function cardSize(S, text) {
    const headW = HEAD + 20 + X0.width(S.ctx, travel.name, NAME_F), textW = X0.width(S.ctx, text, LINE_F);
    return { w: Math.ceil(Math.max(headW, textW) + 2 * PAD), h: 222 };
  }
  /** A paper surface: shadow, cotton paper, hairline (on film the shadow is deep; on paper, soft). */
  function sheet(S, x, y, w, h, r, onPaper) {
    const { ctx, A } = S;
    ctx.save(); if (onPaper) { ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10; } else { ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; }
    ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, r); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
  }
  function tape(S, cx, y, rot, w = 230) { const { ctx, A } = S, th = w * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx, y); ctx.rotate(rot); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -w / 2, -th / 2, w, th); ctx.restore(); }
  /** A Travel card centred at (cx, cy): the sea head and name, one ink line; pressed in by k, scaled by s. */
  function card(S, o) {
    const { ctx, A } = S, k = clamp(o.k ?? 1); if (k <= 0) return;
    const { w, h } = cardSize(S, o.text), s = o.s ?? 1, x = o.cx - w / 2, y = o.cy - h / 2;
    ctx.save(); ctx.translate(o.cx, o.cy); ctx.rotate(o.rot ?? 0);
    const press = (1.14 - 0.14 * E.o5(k)) * s; ctx.scale(press, press); ctx.translate(-o.cx, -o.cy);
    ctx.globalAlpha *= Math.min(1, k * 2);
    sheet(S, x, y, w, h, 26, o.onPaper);
    ctx.drawImage(A[travel.head], x + PAD, y + 32, HEAD, HEAD);
    X0.text(ctx, travel.name, x + PAD + HEAD + 20, y + 32 + HEAD * 0.68, NAME_F, travel.color);
    X0.text(ctx, o.text, x + PAD, y + 182, LINE_F, C.ink);
    tape(S, o.cx + (o.tapeDx ?? 0), y + 2, o.tapeRot ?? -0.07);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the question card
  const Q = { headF: X0.font(900, 76), yesF: X0.font(500, 48), notF: X0.font(500, 44), waitF: X0.font(500, 38), handF: X0.font(700, 128, "Caveat"), stampF: X0.font(800, 70) };
  function qGeom(S) {
    if (S._q) return S._q;
    const ctx = S.ctx, yesW = 0.3 * 1080, yesH = 112, notW = 236, notH = 84, gap = 30;
    const rowW = yesW + gap + notW, headW = HEAD + 20 + X0.width(ctx, travel.name, NAME_F), textW = Math.max(X0.width(ctx, "Pay for", Q.headF), X0.width(ctx, "2 tickets?", Q.headF));
    const w = Math.ceil(Math.max(rowW, headW, textW) + 2 * PAD), h = 572, x = 540 - w / 2, y = 960 - h / 2;
    return (S._q = { w, h, x, y, yes: { x: x + PAD, y: y + 352, w: yesW, h: yesH }, not: { x: x + PAD + yesW + gap, y: y + 352 + (yesH - notH) / 2, w: notW, h: notH }, waitY: y + 524 });
  }
  /** The handwritten 'yes', drawn once to its own canvas so the pen can reveal it with a ragged edge. */
  function yesInk(S) {
    if (S._yes) return S._yes;
    const tw = X0.width(S.ctx, "yes", Q.handF), w = Math.ceil(tw) + 40, h = 200, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d"); c.font = Q.handF; c.textBaseline = "alphabetic"; c.lineJoin = "round";
    c.strokeStyle = "#FBFBFA"; c.lineWidth = 11; c.strokeText("yes", 20, 130);   // the paper shows round the wet ink where it crosses the printed word
    c.fillStyle = C.ink; c.fillText("yes", 20, 130);
    return (S._yes = { cv, w, h, tw, base: 130 });
  }
  function qcard(S, t) {
    const { ctx, A } = S, g = qGeom(S), dy = (1 - E.o5(fr(t, T.paper, T.slide))) * 1400;
    ctx.save(); ctx.translate(0, dy);
    sheet(S, g.x, g.y, g.w, g.h, 30, true);
    ctx.drawImage(A[travel.head], g.x + PAD, g.y + 40, HEAD, HEAD);
    X0.text(ctx, travel.name, g.x + PAD + HEAD + 20, g.y + 40 + HEAD * 0.68, NAME_F, travel.color);
    X0.text(ctx, "Pay for", g.x + PAD, g.y + 222, Q.headF, C.ink);
    X0.text(ctx, "2 tickets?", g.x + PAD, g.y + 310, Q.headF, C.ink);
    // the dip-pen buttons: 'Yes' and, smaller, 'Not now'
    const pf = A["pen-frame"];
    ctx.drawImage(pf, g.yes.x, g.yes.y, g.yes.w, g.yes.h);
    X0.text(ctx, "Yes", g.yes.x + g.yes.w / 2, g.yes.y + g.yes.h / 2 + 17, Q.yesF, "#2A2A2A", "center");
    ctx.save(); ctx.globalAlpha *= 0.85; ctx.drawImage(pf, g.not.x, g.not.y, g.not.w, g.not.h); ctx.restore();
    X0.text(ctx, "Not now", g.not.x + g.not.w / 2, g.not.y + g.not.h / 2 + 15, Q.notF, "#333333", "center");
    // 'It waits.' typed under the buttons, a letter at a time
    const wt = "It waits.", n = Math.floor(clamp((t - T.waits) / T.waitsDur) * wt.length + 1e-6);
    if (t >= T.waits) X0.text(ctx, wt.slice(0, Math.max(1, n)), g.x + PAD, g.waitY, Q.waitF, C.ink);
    // the hand writes 'yes' across the button, left to right
    if (t >= T.yes0) { const y = yesInk(S), k = clamp((t - T.yes0) / (T.yes1 - T.yes0));
      ctx.save(); ctx.translate(g.yes.x + g.yes.w / 2 - y.tw / 2 + 6, g.yes.y + g.yes.h / 2 + 30); ctx.rotate(-0.07);
      X0.reveal(ctx, y.cv, -20, -y.base, y.w, y.h, E.io(k) * 0.96 + 0.04 * k, "x", { rag: 6, seed: 9 }); ctx.restore(); }
    // the stamp: 'Paid', hand-drawn, a slight angle, 1.3 -> 1.0 in 2 frames
    if (t >= T.stamp) {
      const k = fr(t, T.stamp, F(2)), sc = 1.3 - 0.3 * k, sw = 0.3 * 1080, sh = sw * A.stamp.height / A.stamp.width * 1.25, cx = g.x + g.w - sw / 2 + 8, cy = g.y + 74;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.13); ctx.scale(sc, sc); ctx.globalAlpha *= Math.min(1, 0.4 + k);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(X0.tint(A.stamp, "#1a1a1a"), -sw / 2, -sh / 2, sw, sh);
      X0.text(ctx, "Paid", 0, 25, Q.stampF, "#141414", "center");
      ctx.restore();
    }
    ctx.restore();
    return g;
  }

  // ------------------------------------------------------------------------------------------------ the hero, waiting
  const HERO = { size: 500, x: 540 - 250, y: 280 };
  function hero(S, t, g) {
    const { ctx, A } = S, k = fr(t, T.heroIn, T.heroDown - T.heroIn), te = t - T.heroDown;
    let y = lerp(-HERO.size * 0.76, HERO.y, E.o3(k));
    if (te > 0) y += 5 * Math.exp(-te * 5) * Math.sin(te * 13);                       // the bar settles
    const sway = te > 0 ? 0.55 * Math.sin(Math.PI * 2 * 0.4 * te) * Math.min(1, te / 0.8) : 0;
    // where he looks: at us; down at the button from 9.8; back at us from 10.5; after the pen from 13.8
    const DOWN = { dx: -7, dy: 9 }, kd = E.io(fr(t, T.lookDown, F(5))), ku = E.io(fr(t, T.lookUp, F(5)));
    let eyes = { dx: DOWN.dx * kd * (1 - ku), dy: DOWN.dy * kd * (1 - ku) };
    if (t >= T.yes0 - F(4)) { const kp = E.io(fr(t, T.yes0 - F(4), F(4))), kx = clamp((t - T.yes0) / (T.yes1 - T.yes0)); eyes = { dx: lerp(0, lerp(-10, 2, E.io(kx)), kp), dy: lerp(0, 9, kp) }; }
    if (t >= T.stamp) { const kb = E.io(fr(t, T.stamp + F(8), F(6))); eyes = { dx: lerp(2, 0, kb), dy: lerp(9, 0, kb) }; }
    // the eyes widen for one frame as the stamp lands, then settle
    const wide = t >= T.stamp && t < T.stamp + F(1) ? 1.16 : t >= T.stamp + F(1) && t < T.stamp + F(3) ? 1.06 : 1;
    eyes.sx = eyes.sy = wide;
    let blink = 0; for (const b of T.blinks) if (t >= b && t < b + F(5)) blink = Math.sin(Math.PI * (t - b) / F(5)) ** 0.6;
    X0.hang(ctx, A, HERO.x, y, HERO.size, null, { eyes, blink, sway });
  }

  // ------------------------------------------------------------------------------------------------ the headline
  /** 'It finds' / 'You press pay': white heavy Geist (cap 0.08w, 13 characters), 'You' by hand, a sea underline. */
  function headGeom(S) {
    if (S._h) return S._h;
    const ctx = S.ctx; ctx.save(); ctx.font = X0.font(900, 100); const cap = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    const size = Math.round(0.08 * 1080 / cap), x = 80, base2 = Math.round(0.76 * 1920), base1 = Math.round(base2 - size * 1.1);
    const l1 = X0.layout(ctx, [{ text: "It" }, { text: "finds" }], { x, y: base1, size, weight: 900, color: "#FFFFFF" });
    const l2 = X0.layout(ctx, [{ text: "You", hand: true, handWeight: 700, scale: 1.15 }, { text: "press" }, { text: "pay" }], { x, y: base2, size, weight: 900, color: "#FFFFFF" });
    const g = { size, cap, x, base1, base2, l1, l2, right: Math.max(l1.x + l1.w, l2.x + l2.w) };
    console.warn(`06 headline: cap ${(cap * size).toFixed(1)} px (0.08w = 86.4), size ${size}, line 1 ${l1.w.toFixed(0)} px, line 2 ${l2.w.toFixed(0)} px, right edge ${g.right.toFixed(0)} (safe 950, 1026 measure), baseline ${base2} (0.78h = 1498)`);
    return (S._h = g);
  }
  function words(S, line, filter) { for (const w of line.words) if (filter(w)) AD.onFilm(S, w.text, w.x, w.y, w.font, "#FFFFFF"); }
  function headline(S, t) {
    if (t < T.l1) return; const { ctx, A } = S, g = headGeom(S);
    const slam = (t0, line, filter) => { if (t < t0) return; const k = fr(t, t0, F(3)), s = 1.08 - 0.08 * E.o3(k), cx = line.x + line.w / 2, cy = line.y - g.size * 0.35;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); words(S, line, filter); ctx.restore(); };
    slam(T.l1, g.l1, () => true);
    slam(T.l2, g.l2, (w) => !w.hand);
    const hw = g.l2.words[0];
    if (t >= T.hand0) { const k = E.io(fr(t, T.hand0, T.hand1 - T.hand0));
      ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 14, hw.y - g.size * 1.3, (hw.w + 28) * k, g.size * 1.8); ctx.clip(); AD.onFilm(S, hw.text, hw.x, hw.y, hw.font, "#FFFFFF"); ctx.restore(); }
    if (t >= T.ul0) { const im = A[travel.ul], uw = hw.w * 1.12, uh = Math.max(26, uw * im.height / im.width * 1.15);
      X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 6, hw.y + g.size * 0.14, uw, uh, E.o3(fr(t, T.ul0, T.ul1 - T.ul0)), "x", { rot: -0.012, rag: 10, seed: 2 }); }
  }

  // ------------------------------------------------------------------------------------------------ the end card, the hero looking and waiting
  /** The campaign end card as built; the kit has no option for 'looks and waits', so his wink is held open here,
   *  page-locally (both lids open, the sway still) while AD.endCard draws him (as The Witness does). */
  function endCard(S, t) {
    if (t < T.end0) return;
    const hang = X0.hang;
    X0.hang = (ctx, Ls, x, y, size, tm, o = {}) => hang(ctx, Ls, x, y, size, tm, { ...o, lids: [0, 0], sway: 0 });
    try { AD.endCard(S, t, T.end0); } finally { X0.hang = hang; }
  }

  // ------------------------------------------------------------------------------------------------ the small cards on paper
  /** The four cards small along the top band (0.16h), askew and taped, laid side by side from their real widths at
   *  the largest scale that keeps every word uncovered and the last word left of 0.88w. */
  const SMALL_ROT = [-0.06, 0.04, -0.03, 0.05], SMALL_DY = [-8, 8, -10, 6], SMALL_TAPE = [[-20, -0.06], [16, 0.05], [-10, -0.1], [12, 0.04]];
  function smallLayout(S) {
    if (S._small) return S._small;
    const ws = T.holds.map((h) => cardSize(S, h.text).w), x0 = 30, lap = 0.3 * PAD;
    let s = 0.62; const fit = (s) => x0 + ws.reduce((a, w) => a + w * s, 0) - 3 * lap * s - PAD * s;
    while (fit(s) > 0.88 * 1080 - 6 && s > 0.3) s -= 0.005;
    let x = x0; const out = ws.map((w, i) => { const c = { cx: x + w * s / 2, cy: 0.16 * 1920 + SMALL_DY[i], rot: SMALL_ROT[i], tapeDx: SMALL_TAPE[i][0], tapeRot: SMALL_TAPE[i][1], s }; x += w * s - lap * s; return c; });
    console.warn(`06 small cards: scale ${s.toFixed(3)}, card text ${(49 * s).toFixed(1)} px, last word ends ${fit(s).toFixed(0)} (0.88w = 950)`);
    return (S._small = out);
  }

  // ------------------------------------------------------------------------------------------------ the film
  AD.start({
    footage: {
      a: { dir: "../footage-06-a/", frames: 58, fps: 24 },
      b: { dir: "../footage-06-b/", frames: 72, fps: 24 },
      c: { dir: "../footage-06-c/", frames: 302, fps: 72 },
      d: { dir: "../footage-06-d/", frames: 92, fps: 72 },
    },
    assets: MASK_ASSETS,
    timeline: () => T,
    duration: T.duration,
    frame(t, S) {
      const { ctx } = S; let info = "", grain = 0;
      if (t < T.end0 + F(14)) {
        if (t < T.holds[0].t0) { info = "black"; }
        else if (t < T.paper) {
          // the four holds: each runs into its freeze, which goes cold over 6 frames; its card tapes on
          const h = T.holds.find((x) => t >= x.t0 && t < x.t1), src = SRC[h.key](t), cold = t >= h.fz ? E.o3(fr(t, h.fz, F(6))) : 0;
          film(S, h.key, src, cold); bars(S);
          if (t >= h.card) card(S, { text: h.text, cx: 540, cy: 960, k: fr(t, h.card, F(6)), rot: [-0.035, 0.028, -0.02, 0.032][T.holds.indexOf(h)], tapeDx: [-30, 24, -12, 30][T.holds.indexOf(h)], tapeRot: [-0.07, -0.03, -0.1, -0.05][T.holds.indexOf(h)] });
          grain = 0.12 + 0.06 * cold; info = `hold ${h.key} src ${src.toFixed(3)}${cold ? " cold " + cold.toFixed(2) : ""}`;
        } else if (t < T.rel) {
          // paper: the four cards small along the top, the question, the hero who waits
          // the camera creeps in through the wait (3 %, about the top band) and holds still from the stamp
          const push = 1 + 0.03 * E.io(fr(t, T.heroIn, T.stamp - T.heroIn));
          ctx.save(); X0.camera(ctx, push, 540, 330);
          ctx.fillStyle = "#FFFFFF"; ctx.fillRect(-40, -40, 1160, 2000); X0.cover(ctx, S.A.paper, -20, -20, 1120, 1960, { alpha: 0.9 });
          const sm = smallLayout(S); T.holds.forEach((h, i) => card(S, { text: h.text, ...sm[i], onPaper: true }));
          const g = qcard(S, t);
          if (t >= T.heroIn) hero(S, t, g);
          ctx.restore();
          grain = 0.035; info = "paper";
        } else if (t < T.cuts[3]) {
          // the release: three hard cuts at speed (the train is the fourth and runs on)
          const i = Math.floor((t - T.rel) / T.cut), key = ["a", "b", "d"][i], src = SRC["r" + key](t);
          film(S, key, src, 0); bars(S); grain = 0.12; info = `release ${key} src ${src.toFixed(3)}`;
        } else {
          const src = SRC.rc(t); film(S, "c", src, 0); bars(S); headline(S, t); grain = 0.12; info = `train src ${src.toFixed(3)}`;
        }
      }
      if (grain) X0.grain(ctx, 1080, 1920, t, grain, 1);
      endCard(S, t);
      if (t >= T.end0 + F(14)) X0.grain(ctx, 1080, 1920, t, 0.03, 1);
      if (S.q.get("hud")) X0.text(ctx, info, 360, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const c = [], smp = (at, file, gain) => c.push({ at, kind: "sample", file: "06-sfx/" + file + ".wav", gain });
      // the wall clock, 60 bpm, from the first frame to the stamp
      for (let s = 0; s <= 14; s++) smp(s, s % 2 ? "tock" : "tick", 0.7);
      // the four ambiences, each cut dead on its freeze; a tape rip on every card
      ["amb-track", "amb-room", "amb-platform", "amb-wind"].forEach((f, i) => smp(T.holds[i].t0, f, [0.36, 0.4, 0.36, 0.38][i]));
      for (const h of T.holds) smp(h.card + F(2), "tape", 0.6);
      // paper: the question slides up; the hero's bar comes down
      c.push({ at: T.paper, kind: "whoosh", dur: 0.32, up: false, gain: 0.22 });
      c.push({ at: T.heroIn, kind: "whoosh", dur: 0.5, up: false, gain: 0.12 }, { at: T.heroDown, kind: "land", gain: 0.12 });
      // the wait: a low drone on G creeping in from 9.3, a thin high sine from 11.3, both cut dead at the stamp
      c.push({ at: T.heroDown, kind: "drone", f: 49, dur: T.stamp - T.heroDown, a: 4.6, r: 0.006, gain: 0.55 });
      smp(11.3, "sine", 0.1);
      for (let i = 0; i < 9; i++) c.push({ at: T.waits + i * T.waitsDur / 9, kind: "tick", gain: 0.28 });   // 'It waits.' typed
      // the pen, the stamp
      smp(T.yes0, "pen-yes", 0.5);
      smp(T.stamp, "stamp", 0.95);
      // the release: one boom, a riser, each cut its own sound
      c.push({ at: T.rel, kind: "boom", gain: 0.85 }, { at: T.rel, kind: "riser", dur: 1.5, gain: 0.4 });
      smp(T.cuts[0], "spikes", 0.7);
      smp(T.cuts[1] + 0.33, "piece", 0.75);
      smp(T.cuts[2], "splash", 0.6);
      smp(T.cuts[3], "chime", 0.6);
      smp(T.slow, "train", 0.6);
      // the headline: two slams, the hand word, the brush, one Travel bell
      for (const at of [T.l1, T.l2]) c.push({ at, kind: "boom", gain: 0.4, f0: 70, f1: 40, dur: 0.8 }, { at, kind: "click", gain: 0.35 });
      smp(T.hand0, "pen-word", 0.4);
      c.push({ at: T.ul0, kind: "whoosh", dur: 0.3, up: false, gain: 0.32 });
      c.push({ at: T.ul1, kind: "bell", f: travel.note, dur: 1.6, gain: 0.45 });
      // the campaign's end card, its chord and bells moved up a fourth from D to this spot's G, without the wink's bell
      for (const e of AD.endCues(T.end0)) {
        if (e.kind === "bell" && Math.abs(e.at - (T.end0 + F(104))) < 1e-6) continue;
        c.push(e.kind === "chord" || e.kind === "bell" ? { ...e, f: e.f * 4 / 3 } : e);
      }
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
