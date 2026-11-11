/* 09 UNCLE IS RIGHT (the Humanist; India; trust). The fox, Prof. Lomri (retd.), in his armchair, a dubbed-interview
 * look: 'Bots? Let them find my train. But paisa?' On 'paisa?' the film freezes on his raised paw and goes cold; the hero
 * swings down from the top edge on his clay bar, looks at the fox, then at us, and nods; Travel's ticket is taped on with
 * a drawn 'Pay' right above the paw ('only you press this'); a strip writes the rule. The film unfreezes (take B):
 * 'Hmm... Sahi hai.' The hero blinks. The last frame freezes WARM (he agreed); the hero lifts out; the headline
 * 'Uncle is right / You press pay'. The campaign's end card.
 *
 * Everything is a pure function of t. Footage: footage-fox/ (520 frames, 72 fps): take A src 0 -> 4.278 (the raised-paw
 * frame, s0309) at 1x, held; take B picks up on that frame, src 4.278 -> 7.208 (the clip's last frame) at 0.835x, held.
 * The cold freeze pushes in to 1.25 and the warm one to 1.30, anchored low, so the face rises clear of the paper and the
 * paw meets the card's 'Pay'. Voice: en-IN Prabhat at -10%
 * (voice/09-1, a 0.5 s breath cut out of the 'Bots?' pause; voice/09-2). Sound: a 60 bpm wall clock that stops on the
 * cold freeze and resumes on the unfreeze, a drone in A, the sea bell (A4), one warm A major chord, the end card in A.
 */
(() => {
  "use strict";
  const { E, C } = X0;
  const { F, fr, lerp } = AD;
  const W = 1080, H = 1920, X = 86;   // the type's left edge: 0.08w

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    vo1: 0.12,                 // 09-1: Bots +0.11 ... But +3.90, paisa +4.14..4.69
    lt0: 0.30, lt1: 3.62,      // the lower-third in, out
    fz1: 128 / 30,             // the cold freeze on the raised paw (the bible's 4.0, slipped 0.27 s so 'paisa?' lands on it)
    heroIn: 4.40, nod: 5.05, card: 5.40, strip: 7.30, write: 7.40, cardOut: 8.90,
    cut: 9.19,                 // the unfreeze: take B
    vo2: 9.45,                 // 09-2: Hmm +0.11, Sahi +1.38, hai +1.78..2.10
    stripOut: 10.55, capOut: 12.3,   // the strip held into take B, gone before 'Sahi' (10.83) and the blink
    fz2: 12.7, heroOut: 12.75, l1: 13.0, l2: 13.3, hand: 13.6, ul: 14.2, s1: 13.9,
    end: 17.5,                 // the end card (4.9 s as built; the bible counts 4.5)
  };
  // Take B picks up on the held frame (no replay of the paw lift the viewer has just seen frozen) and plays to the
  // clip's last frame at 0.835x, so the voice keeps the bible's times ('Hmm.' 9.5, 'Sahi hai.' 11.0).
  const SRC = { fz1: 4.278, b1: 7.208 };
  const src = AD.map([[0, 0], [T.fz1, SRC.fz1], [T.cut, SRC.fz1], [T.fz2, SRC.b1], [T.end + 1, SRC.b1]]);

  /** The camera: locked on the moving takes; on each freeze a push to 1.25 (1.05 s) anchored low, then a slow creep. */
  function cam(t) {
    if (t >= T.fz1 && t < T.cut) { const z = 1 + 0.25 * E.io(fr(t, T.fz1 + F(1), 1.05)); return { z, dy: -960 * (z - 1) * 0.92 }; }   // the paw stays put under 'Pay'
    if (t >= T.fz2) { const z = 1 + 0.3 * E.io(fr(t, T.fz2 + F(1), 1.0)) + 0.025 * fr(t, T.fz2 + 1.05, T.end - T.fz2 - 1.05); return { z, dy: -960 * (z - 1) }; }
    return { z: 1, dy: 0 };
  }
  /** The cold freeze (in over 6 f, out over 6 f on the unfreeze) and the warm one (in over 6 f). */
  const coldK = (t) => (t >= T.fz1 && t < T.cut ? E.o3(fr(t, T.fz1, F(6))) : t >= T.cut && t < T.cut + F(7) ? 1 - E.io(fr(t, T.cut, F(6))) : 0);
  const warmK = (t) => (t >= T.fz2 ? E.o3(fr(t, T.fz2, F(6))) : 0);

  // ------------------------------------------------------------------------------------------------ the film
  /** One documentary grade for all the footage (contrast up, saturation -28%, blacks lifted a touch, soft vignette);
   *  the cold freeze takes a third of the saturation off and cools; the warm one warms a notch. */
  function footage(t, S) {
    const { ctx } = S, c = coldK(t), w = warmK(t), { z, dy } = cam(t);
    const grade = `contrast(${1.08 + 0.05 * c}) saturate(${0.72 * (1 - c / 3)}) brightness(${0.98 - 0.06 * c + 0.015 * w})`;   // the warm freeze keeps the one grade: warmth only, from the amber layer
    AD.film(S, S.foot("fox", src(t)), { zoom: z, dy, grade, vignette: false });
    ctx.save();
    ctx.globalCompositeOperation = "screen"; ctx.fillStyle = "rgb(17,15,13)"; ctx.fillRect(0, 0, W, H);
    if (c > 0) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = `rgba(70,125,200,${0.16 * c})`; ctx.fillRect(0, 0, W, H); }
    if (w > 0) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = `rgba(255,160,80,${0.2 * w})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    X0.vignette(ctx, W, H, 0.24 + 0.1 * c);
    if (t >= T.fz1 && t < T.fz1 + F(1)) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(0, 0, W, H); }   // the shutter
    if (t >= T.fz2 && t < T.fz2 + F(1)) { ctx.fillStyle = "rgba(255,244,228,0.08)"; ctx.fillRect(0, 0, W, H); }
  }
  /** The ink gradient under the white type (the cream sweater is far brighter than 60% grey): 0 -> 42% over 140 px, then
   *  50% at the subtitle line, 62% at the foot; it rises with the warm push so the headline block sits on it. */
  function band(t, S) {
    const kw = t >= T.fz2 ? E.io(fr(t, T.fz2, 1.0)) : 0, { ctx } = S, y0 = lerp(1120, 960, kw), span = H - y0;
    const m = 1 - 0.55 * Math.min(E.io(fr(t, 5.25, 0.45)), 1 - E.io(fr(t, T.cut, 0.3)));   // no white type under the card: the paw comes back
    const g = ctx.createLinearGradient(0, y0, 0, H), a = (v) => `rgba(10,10,10,${(v * m).toFixed(3)})`;
    // on the warm freeze the stop at y 1100 deepens to 50%: the pale neck ruff behind the small claim lines
    g.addColorStop(0, a(0)); g.addColorStop(70 / span, a(0.2)); g.addColorStop(140 / span, a(0.42 + 0.08 * kw));
    g.addColorStop(420 / span, a(0.5)); g.addColorStop(1, a(0.62));
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, span);
  }
  const BAR = 64;   // thin ink letterbox
  function bars(S) { const { ctx } = S; ctx.fillStyle = "#0A0A0A"; ctx.fillRect(0, 0, W, BAR); ctx.fillRect(0, H - BAR, W, BAR); }

  // ------------------------------------------------------------------------------------------------ what he says
  /** The interview super: a thin clay rule drawn on, then the name and the line, small white Geist (44 px, the readable floor), at 0.70h. */
  function lowerThird(t, S) {
    if (t < T.lt0 || t > T.lt1 + 0.35) return;
    const { ctx } = S, y = 1258, f1 = X0.font(500, 44), f2 = X0.font(400, 44), out = 1 - E.io(fr(t, T.lt1, 0.3));
    const rw = Math.max(X0.width(ctx, "Prof. Lomri (retd.)", f1), X0.width(ctx, "Keeps his own wallet", f2));
    ctx.save(); ctx.globalAlpha *= out; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8; ctx.fillStyle = "#C9683F"; ctx.fillRect(X, y, rw * E.o3(fr(t, T.lt0, 0.35)), 3); ctx.restore();
    const a1 = E.o3(fr(t, T.lt0 + 0.1, 0.3)) * out, a2 = E.o3(fr(t, T.lt0 + 0.25, 0.3)) * out, rise = (1 - E.o3(fr(t, T.lt0 + 0.1, 0.35))) * 10;
    AD.onFilm(S, "Prof. Lomri (retd.)", X, y + 54 + rise, f1, "rgba(255,255,255,0.96)", "left", a1);
    AD.onFilm(S, "Keeps his own wallet", X, y + 108 + rise, f2, "rgba(255,255,255,0.86)", "left", a2);
  }
  /** His words in white Caveat 0.065w on the voice's word times at 0.76h, in pages; the last page leaves before paper lands. */
  const CAP = { size: 70, x: X, y: 1459, maxW: 864 };
  function captions(t, S) {
    const { ctx } = S;
    const run = (voice, t0, pages, tOut) => { const a = 1 - E.io(fr(t, tOut, F(6))); if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; AD.caption(S, voice, t0, t, { ...CAP, pages }); ctx.restore(); };
    if (t < T.card) run(S.V["09-1"], T.vo1, [[0, 6], [6, 8]], 5.05);
    if (t >= T.vo2 - 0.2 && t < T.fz2) run(S.V["09-2"], T.vo2, [[0, 1], [1, 3]], T.capOut);
  }

  // ------------------------------------------------------------------------------------------------ the hero
  const HERO = { x: 560, y: -69, size: 500 };   // the bar's top on the letterbox's edge (y 64), upper right of the fox
  const HS = HERO.size / X0.hang.ART, PIVOT = { x: HERO.x + X0.hang.MID * HS, y: -300 };
  /** His eyes toward a point on screen, as hang()'s { dx, dy } in art px, `max` long. */
  function gaze(px, py, max = 22) {
    const ex = HERO.x + X0.hang.EYES.c.cx * HS, ey = HERO.y + X0.hang.EYES.c.cy * HS, dx = px - ex, dy = py - ey, len = Math.hypot(dx, dy) || 1;
    return { dx: dx / len * max, dy: dy / len * max };
  }
  const US = { dx: 0, dy: 0 };
  const LOOKS = [[T.heroIn, { dx: 0, dy: 5 }], [4.74, gaze(565, 860)], [4.98, US], [6.25, gaze(500, 1300)], [7.42, gaze(380, 440)], [8.5, US], [9.4, gaze(560, 1060)], [10.62, US]];
  function eyesAt(t) {
    let cur = LOOKS[0][1];
    for (let i = 1; i < LOOKS.length; i++) { const [tk, v] = LOOKS[i]; if (t < tk) break; const k = E.io(fr(t, tk, F(5))); cur = { dx: lerp(cur.dx, v.dx, k), dy: lerp(cur.dy, v.dy, k) }; }
    return cur;
  }
  /** He swings down from the top edge on his bar (a drop, the head swinging down from behind the bar, a damped pendulum
   *  about a point above the frame), looks at the fox, at us, nods twice, slowly; blinks once on 'Sahi'; lifts out on the
   *  warm freeze (the launch's gather and pull, the bar rising out of the frame). */
  function hero(t, S) {
    if (t < T.heroIn) return;
    const { ctx } = S, te = t - T.heroIn;
    let tm = null, rigDy = -420 * (1 - E.back(1.25)(fr(t, T.heroIn, F(10)))), drop = fr(t, T.heroIn + F(2), F(12));
    const ang = te < 3.5 ? X0.deg(7) * Math.exp(-te * 2.3) * Math.cos(te * Math.PI * 2 / 1.2) : 0;
    if (t >= T.heroOut) { const k = fr(t, T.heroOut, F(8)); tm = lerp(420, 900, k); rigDy = -470 * E.i3(fr(t, T.heroOut + F(4), F(7))); drop = 1; if (rigDy <= -469) return; }
    // two slow nods (0.5 s each) that move the whole hero: he dips on his bar, the head lengthens, the eyes drop and the
    // lids come half down at the bottom of each one (about 55 px of travel for the eyes: it reads on a phone)
    const nod = E.bump(fr(t, T.nod, 0.5)) + 0.75 * E.bump(fr(t, T.nod + 0.55, 0.5));
    rigDy += 18 * nod;
    const tb = T.vo2 + S.V["09-2"].words[1].t0;
    const blink = t >= tb && t < tb + F(6) ? (t < tb + F(2) ? fr(t, tb, F(2)) : t < tb + F(3) ? 1 : 1 - fr(t, tb + F(3), F(3))) : 0;
    const ey = eyesAt(t);   // the eyes half-close by narrowing (the lid layers sit on the eyes' rest box, which the dip leaves)
    const o = { eyes: { dx: ey.dx, dy: ey.dy + 20 * nod, sy: 1 - 0.45 * nod }, blink, sq: 1 + 0.14 * nod, bob: tm == null ? Math.sin(t * 2.6) * 3 : 0 };
    if (drop < 1) o.drop = drop;
    ctx.save(); ctx.translate(PIVOT.x, PIVOT.y); ctx.rotate(ang); ctx.translate(-PIVOT.x, -PIVOT.y); ctx.translate(0, rigDy);
    X0.hang(ctx, S.A, HERO.x, HERO.y, HERO.size, tm, o);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ paper on the freeze
  /** White paper with its shadow, cotton grain and hairline (the kit's card body). */
  function sheet(S, x, y, w, h, r) {
    const { ctx, A } = S;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, r); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
  }
  function tape(S, cx, cy, tw, rot) { const { ctx, A } = S, th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore(); }
  /** Travel's ticket: sized to its longest row (the two drawn buttons) plus 0.04w each side; 'Pay' sits over the paw. */
  const CARD = (() => {
    const g = { pad: 43, head: 64, payW: 260, notW: 220, gap: 22 };
    g.payH = g.payW * 382 / 1005; g.notH = g.notW * 382 / 1005;
    g.l1 = 30 + g.head + 56; g.l2 = g.l1 + 60; g.btn = g.l2 + 28; g.note = g.btn + g.payH + 44; g.h = g.note + 44;
    g.w = g.notW + g.gap + g.payW + 2 * g.pad;
    g.x = 225; g.y = 1108;   // Pay's centre on the paw (x 640 at the 1.25 push); the card between his chin and the paw's fingers
    return g;
  })();
  function card(t, S) {
    const k = fr(t, T.card, F(6)), out = t >= T.cardOut ? E.i2(fr(t, T.cardOut, F(8))) : 0; if (k <= 0 || out >= 1) return;
    const { ctx, A } = S, g = CARD, { x, y, w, h, pad } = g, cx = x + w / 2, cy = y + h / 2;
    ctx.save(); ctx.translate(cx, cy + out * 14); ctx.rotate(-0.022);
    const press = (1.14 - 0.14 * E.o5(k)) * (1 - 0.07 * out); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2) * (1 - out);
    sheet(S, x, y, w, h, 26);
    ctx.drawImage(A["head-travel"], x + pad, y + 30, g.head, g.head);
    X0.text(ctx, "Travel", x + pad + g.head + 16, y + 30 + g.head * 0.72, X0.font(600, 44), C.sea);
    X0.text(ctx, "Pune, Fri 17:40", x + pad, y + g.l1, X0.font(500, 48.6), C.ink);
    X0.text(ctx, "Seat 23, window", x + pad, y + g.l2, X0.font(500, 48.6), C.ink);
    const by = y + g.btn, mid = by + g.payH / 2, nx = x + pad, px = nx + g.notW + g.gap;
    ctx.drawImage(A["pen-pill"], nx, mid - g.notH / 2, g.notW, g.notH); X0.text(ctx, "Not now", nx + g.notW / 2, mid + 15.5, X0.font(500, 44), "#333333", "center");
    ctx.drawImage(A["pen-pill"], px, by, g.payW, g.payH); X0.text(ctx, "Pay", px + g.payW / 2, mid + 20, X0.font(600, 56), C.ink, "center");
    X0.text(ctx, "only you press this", x + w - pad, y + g.note, X0.font(400, 44), C.ink, "right");
    tape(S, x + 30, y + 18, 170, -0.75); tape(S, x + w - 70, y + 6, 150, 0.12);   // the left tape across the corner, on the ruff, off his chin
    ctx.restore();
  }
  /** The rule on a white strip, ink Geist 44 px (0.04w) in two lines, typed a letter at a time (settled type: a tick per
   *  letter), at the small lines' 40 letters a second. The copy says exactly the rule: bots find and ask, you press pay. */
  const STRIP = { x: X, y: 352, lines: ["Bots find and ask.", "Only you pay."], size: 44, padX: 43, padY: 26, pitch: 60 };
  const stripAt = (() => { let t0 = T.write; return STRIP.lines.map((l) => { const a = t0; t0 += l.length / 40 + 0.15; return a; }); })();
  function strip(t, S) {
    const k = fr(t, T.strip, F(5)), out = t >= T.stripOut ? E.i2(fr(t, T.stripOut, F(8))) : 0; if (k <= 0 || out >= 1) return;
    const { ctx } = S, s = STRIP, f = X0.font(400, s.size), wmax = Math.max(...s.lines.map((l) => X0.width(ctx, l, f)));
    const w = wmax + 2 * s.padX, h = s.padY * 2 + 32 + s.pitch + 8, x = s.x, y = s.y, cx = x + w / 2, cy = y + h / 2;
    ctx.save(); ctx.translate(cx, cy + out * 10); ctx.rotate(0.012);
    const press = (1.1 - 0.1 * E.o5(k)) * (1 - 0.05 * out); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2) * (1 - out);
    sheet(S, x, y, w, h, 8);
    s.lines.forEach((ln, i) => {
      const n = Math.floor((t - stripAt[i]) * 40) + 1; if (n <= 0) return;
      X0.text(ctx, ln.slice(0, Math.min(n, ln.length)), x + s.padX, y + s.padY + 32 + i * s.pitch, f, C.ink);
    });
    tape(S, x + 8, cy, 120, -1.42);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the headline
  const HL = { lines: ["Uncle is right", "You press pay"], hand: { line: 1, word: "pay" }, ul: "ul-bar", x: X, base: [1341, 1481], size: 122, at: { l1: T.l1, l2: T.l2, hand: T.hand, ul: T.ul } };
  const SMALL = [{ text: "Nothing is booked or paid till you say yes.", y: 1136 }, { text: "You always press pay.", y: 1192 }], CPS = 40, SMALL_F = X0.font(400, 44);
  const smallAt = (() => { let t0 = T.s1; return SMALL.map((l) => { const a = t0; t0 += l.text.length / CPS + 0.15; return a; }); })();
  /** The two small lines above the headline: white Geist 44 px (they carry the claim; 0.035w would be under the
   *  readable floor), the bible's two lines (the first ends at 916 px, left of 0.88w), typed a letter at a time. */
  function smallLines(t, S) {
    SMALL.forEach((l, i) => { const n = Math.floor((t - smallAt[i]) * CPS) + 1; if (n > 0) AD.onFilm(S, l.text.slice(0, Math.min(n, l.text.length)), X, l.y, SMALL_F, "rgba(255,255,255,0.96)"); });
  }
  /** Measure the type with the real fonts before anything is drawn: the headline lines against 1026 px and the 0.88w edge. */
  let checked = false;
  function check(S) {
    if (checked) return; checked = true;
    const { ctx } = S, bad = [], seen = [];
    HL.lines.forEach((ln, i) => {
      const words = ln.split(" ").map((w) => (HL.hand.line === i && w === HL.hand.word ? { text: w, hand: true, handWeight: 700, scale: 1.15 } : { text: w }));
      const L = X0.layout(ctx, words, { x: HL.x, y: HL.base[i], size: HL.size, weight: 900 });
      seen.push(`headline "${ln}" ${L.w.toFixed(0)} px`);
      if (L.w > 1026 || HL.x + L.w > 0.88 * W) bad.push(`headline "${ln}" ${L.w.toFixed(0)} px`);
      if (HL.base[i] > 0.78 * H) bad.push(`headline baseline ${HL.base[i]} below 0.78h`);
    });
    ctx.save(); ctx.font = X0.font(900, HL.size); const cap = ctx.measureText("H").actualBoundingBoxAscent / W; ctx.restore();
    if (cap < 0.08 || cap > 0.085) bad.push(`headline cap ${cap.toFixed(4)}w`);
    for (const l of SMALL) { const r = X + X0.width(ctx, l.text, SMALL_F); seen.push(`small "${l.text}" ends ${r.toFixed(0)}`); if (r > 0.88 * W) bad.push(`small "${l.text}"`); }
    for (const l of STRIP.lines) { const r = STRIP.x + STRIP.padX + X0.width(ctx, l, X0.font(400, STRIP.size)); seen.push(`strip "${l}" ends ${r.toFixed(0)}`); if (r > 0.88 * W) bad.push(`strip "${l}"`); }
    if (CARD.x + CARD.w - CARD.pad > 0.88 * W) bad.push("card text past 0.88w");
    if (bad.length) console.error("09 type check: " + bad.join("; "));
    if (S.q.get("measure")) console.warn("09 measure: cap " + cap.toFixed(4) + "w; " + seen.join("; "));
  }

  // ------------------------------------------------------------------------------------------------ the end card's mark
  /** The kit's markPaint draws the whole mark under the 0's 0.74 squeeze and clips in screen space at 0.52, so the tips
   *  of the X's right arms (source 0.436..0.456) land as a sliver between the X and the 0 ('X|0'). The kit is shared, so
   *  here the gap is painted back to the end card's paper: the X's ink ends at source 0.456 (x 290), the narrowed 0's
   *  starts at 0.570 (x 342); x 296..336 holds nothing but that sliver. Same paper call as endCard, so it is seamless. */
  const MARK = { x: 80, y: 740, w: 460 };
  function markGap(t, S) {
    const te = t - T.end; if (te < F(36)) return;   // the 0's stroke starts at +36 f, the sheet is up by +14 f
    const { ctx, A } = S, mh = MARK.w * A.mark.height / A.mark.width;
    ctx.save(); ctx.beginPath(); ctx.rect(MARK.x + MARK.w * 0.47, MARK.y - 4, MARK.w * 0.087, mh + 8); ctx.clip();
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H); X0.cover(ctx, A.paper, 0, 0, W, H, { alpha: 0.9 });
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the page
  AD.start({
    footage: { fox: { dir: "../footage-fox/", frames: 520, fps: 72 } },
    voices: { "09-1": "../voice/09-1.json", "09-2": "../voice/09-2.json" },
    scripts: { "09-1": "Bots? Let them find my train. But paisa?", "09-2": "Hmm. Sahi hai." },
    duration: T.end + AD.END_S,
    frame(t, S) {
      check(S);
      if (t < T.end + F(14)) {
        footage(t, S); band(t, S);
        const type = !S.q.get("notype");   // ?notype=1: the picture without the white type, to measure the bands behind it
        if (type) { lowerThird(t, S); captions(t, S); }
        strip(t, S); card(t, S);
        hero(t, S);
        bars(S);
        if (type) { AD.headline(S, t, HL); smallLines(t, S); }
      }
      AD.endCard(S, t, T.end); markGap(t, S);
      X0.grain(S.ctx, W, H, t, t >= T.end + F(14) ? 0.03 : 0.07 + 0.04 * coldK(t), 1);
      if (S.q.get("hud")) X0.text(S.ctx, `src ${src(t).toFixed(3)} z ${cam(t).z.toFixed(3)} cold ${coldK(t).toFixed(2)} warm ${warmK(t).toFixed(2)}`, 16, 1868, X0.font(500, 24, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const c = [], V1 = S.V["09-1"], V2 = S.V["09-2"];
      c.push({ at: 0, kind: "fan", dur: T.end + 0.6, gain: 0.3 });   // the wood room's tone
      // the wall clock at 60 bpm, tick and tock: it stops on the cold freeze, comes back on the unfreeze, ticks under the headline
      const clock = (a, b) => { for (let s = a, i = 0; s < b - 0.01; s += 1, i++) c.push(i % 2 ? { at: s, kind: "click", gain: 0.5 } : { at: s, kind: "tick", gain: 0.55 }); };
      clock(0, T.fz1); clock(9.2, T.end);
      const scratch = (at) => c.push({ at, kind: "whoosh", dur: 0.09, up: true, gain: 0.2 });   // a pen scratch per handwritten word
      c.push({ at: T.vo1, kind: "sample", file: "../voice/09-1.wav", gain: 1 }); for (const w of V1.words) scratch(T.vo1 + w.t0 + 0.02);
      // the cold freeze: the thud, the drone in A
      c.push({ at: T.fz1, kind: "freeze", gain: 0.7 }, { at: T.fz1, kind: "drone", f: 55, dur: T.cut - T.fz1 + 0.6, a: 0.5, r: 0.7, gain: 0.45 });
      // the hero swings in: air, the swing's creak, the bar settling
      const creak = (at, g) => { for (let i = 0; i < 9; i++) c.push({ at: at + i * 0.022 + X0.hash(i * 31 + Math.round(at * 100)) * 0.008, kind: "click", gain: 0.16 * g * (0.6 + 0.4 * Math.sin(i / 8 * Math.PI)) }); };
      c.push({ at: T.heroIn, kind: "whoosh", dur: 0.3, up: false, gain: 0.3 }, { at: T.heroIn + F(9), kind: "land", gain: 0.3 });
      creak(T.heroIn + 0.22, 1); creak(T.heroIn + 0.82, 0.6); creak(T.heroIn + 1.42, 0.35);
      // the ticket: the tape rip, the paper landing, Travel's sea bell (A4)
      c.push({ at: T.card - 0.05, kind: "whoosh", dur: 0.14, up: true, gain: 0.45 }, { at: T.card + F(5), kind: "paper-thud", gain: 0.6 }, { at: T.card + F(5), kind: "land", gain: 0.4 }, { at: T.card + F(8), kind: "bell", f: 440, dur: 1.4, gain: 0.45 });
      // the strip: a smaller rip, then the rule typed, a tick per letter
      c.push({ at: T.strip - 0.04, kind: "whoosh", dur: 0.12, up: true, gain: 0.3 }, { at: T.strip + F(4), kind: "paper-thud", gain: 0.35 });
      STRIP.lines.forEach((l, i) => { for (let j = 0; j < l.length; j++) if (l[j] !== " ") c.push({ at: stripAt[i] + j / 40, kind: "tick", gain: 0.1 }); });
      // paper off, a short riser into the release
      c.push({ at: T.cardOut, kind: "whoosh", dur: 0.28, up: true, gain: 0.3 }, { at: T.cut - 0.4, kind: "riser", dur: 0.41, gain: 0.22 }, { at: T.stripOut, kind: "whoosh", dur: 0.25, up: true, gain: 0.2 });
      // his two words, almost dry
      c.push({ at: T.vo2, kind: "sample", file: "../voice/09-2.wav", gain: 1 }); for (const w of V2.words) scratch(T.vo2 + w.t0 + 0.02);
      // the warm freeze (no thud), the hero lifting out
      c.push({ at: T.fz2, kind: "land", gain: 0.22 }, { at: T.heroOut, kind: "boing", gain: 0.3 }, { at: T.heroOut + F(4), kind: "whoosh", dur: 0.3, up: true, gain: 0.25 });
      // the headline over one warm A major chord: a tick per line, the hand word, the brush swish; the small lines typed
      c.push({ at: T.l1, kind: "chord", f: 110, dur: 4.6, gain: 0.42 }, { at: T.l1, kind: "tick", gain: 0.3 }, { at: T.l2, kind: "tick", gain: 0.3 }, { at: T.hand, kind: "write", gain: 0.35 }, { at: T.ul, kind: "whoosh", dur: 0.3, up: false, gain: 0.35 });
      SMALL.forEach((l, i) => { for (let j = 0; j < l.text.length; j++) if (l.text[j] !== " ") c.push({ at: smallAt[i] + j / CPS, kind: "tick", gain: 0.1 }); });
      // the campaign's end card, its chord and bells moved from D to this spot's A
      for (const e of AD.endCues(T.end)) c.push(e.kind === "chord" || e.kind === "bell" ? { ...e, f: e.f * 0.7492 } : e);
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
