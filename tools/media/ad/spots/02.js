/* 02 PAHUNCH GAYE? (the Humanist; India; awareness). A refrain film you read: six arrivals by night on six strangers'
 * clips cut like one roll, the same question in a mother's hand over each, a typed reply from someone else each time.
 * A scooter pulls away in light rain ('Pahunch gaye?' in her voice, 'Haan.' typed); the frame freezes cold and Plan's
 * card is taped on. A plane's wing at dusk ('Landed?' / 'Haan Papa.'); cold again, Travel's card. Rain on a bus window
 * ('Pahunch gayi beta?' / 'Bas 10 minute.'). A street from a back seat ('Reached?' / 'Yes yes.'). A dark back seat with
 * nothing written: the one person who does not have to answer. A window in a dark block lights up: 'Pahunch gaye.' in her
 * voice, no question mark, no reply. The film slows to 20% and freezes WARM; the headline answers: 'Pahunch gaye? /
 * Haan'. The campaign's end card.
 *
 * Everything is a pure function of t. Footage (prep.mjs, all at the clip's own speed, 30 fps, no interpolation, except
 * the last shot's ramp tail at 72 fps interpolated): footage-02-a (Mixkit 6754 src 12.6-16.2, crop x0.30), -b (Mixkit
 * 4204 0-3, x0.28), -c (Mixkit 2846 0-3.4, x0.22), -d (Mixkit 42037 3-6, x0.42), -e (Mixkit 39532 6.5-9.6, x0.60), -f and
 * -g (Mixkit 40734 5.9-9.2 and 8.9-9.9, a wide strip x0.03-0.63 contained, so the page tracks the tower as the camera
 * pans: the 9:16 crop's left edge slides from x0.313 to x0.035 on keys measured by template match, and one dark window
 * lights up with a lit pane of the same tower cloned onto it, so the light has the footage's own grain). Voice: en-IN
 * Neerja at -15% (voice/02-1 'Pahunch gaye?', voice/02-2 'Pahunch gaye.'). Sound: a drone in G from 0.4 that never
 * leaves, a 96 bpm rail-joint pulse with hats that cuts on each cold freeze, pen scratches, typewriter ticks, tape rips,
 * the ochre and sea bells, one room tone per shot (spots/02-sfx/make.mjs), a riser into one warm G major chord at 20.0,
 * the end card in G.
 */
(() => {
  "use strict";
  const { E, C, clamp } = X0;
  const { F, fr, lerp } = AD;
  const W = 1080, H = 1920, X = 86;   // the type's left edge: 0.08w

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    vo1: 0.4,                         // 02-1 'Pahunch gaye?': Pahunch +0.10, gaye +0.60
    r1: 2.0,                          // 'Haan.' types, a letter a frame
    fzA: 3.0, cardA: 3.32, outA: 4.78,
    b0: 5.0, fzB: 7.5, cardB: 7.82, outB: 9.28,
    c0: 9.5, d0: 12.5, e0: 15.0, f0: 18.0,
    win: 18.22,                       // the window lights up
    vo2: 18.5,                        // 02-2 'Pahunch gaye.': Pahunch +0.10 (18.6), gaye +0.63
    chord: 20.0, ramp: 21.0, fzF: 22.0, bigOut: 21.62,
    l1: 21.95, hand: 22.3, ul: 22.72, s1: 22.95,   // the headline over the warm freeze, then the small lines
    end: 25.5,                        // the end card (4.9 s as built; the bible counts 4.5)
  };
  /** Unvoiced handwriting runs at 0.3 s a word, the typed reply 0.5 s after the last word. */
  const unvoiced = (t0, text) => { const words = text.split(" ").map((w, i) => ({ text: w, t0: t0 + 0.3 * i })); return { words, reply: t0 + 0.3 * words.length + 0.5 }; };
  const REFRAIN = [
    { from: 0, to: T.b0, q: null, reply: "Haan.", rAt: T.r1 },                                      // the voiced one (words from 02-1)
    { from: T.b0, to: T.c0, ...unvoiced(5.3, "Landed?"), rText: "Haan Papa." },
    { from: T.c0, to: T.d0, ...unvoiced(9.8, "Pahunch gayi beta?"), rText: "Bas 10 minute." },
    { from: T.d0, to: T.e0, ...unvoiced(12.8, "Reached?"), rText: "Yes yes." },
  ];

  // ------------------------------------------------------------------------------------------------ the footage
  /** The shots: which folder, the clip's own clock (seconds into the folder), the exposure match before the one grade. */
  const SHOT = [
    { id: "a", t0: 0, t1: T.b0, src: (t) => 0.9 * Math.min(t, T.fzA), m: { b: 0.9, c: 1.04, s: 1.0 }, zoom: (t) => 1 + 0.03 * fr(t, 0, T.fzA) + 0.025 * E.io(fr(t, T.fzA, 2)) },
    { id: "b", t0: T.b0, t1: T.c0, src: (t) => Math.min(t, T.fzB) - T.b0 + 0.1, m: { b: 0.6, c: 1.22, s: 0.7, wm: 0.14 }, zoom: (t) => 1.02 + 0.025 * fr(t, T.b0, 2.5) + 0.025 * E.io(fr(t, T.fzB, 2)) },
    { id: "c", t0: T.c0, t1: T.d0, src: (t) => t - T.c0 + 0.2, m: { b: 0.5, c: 1.3, s: 1.05 }, zoom: (t) => 1.04 + 0.03 * fr(t, T.c0, 3) },
    { id: "d", t0: T.d0, t1: T.e0, src: (t) => t - T.d0 + 0.05, m: { b: 0.92, c: 1.05, s: 1.0 }, zoom: (t) => 1.02 + 0.02 * fr(t, T.d0, 2.5) },
    { id: "e", t0: T.e0, t1: T.f0, src: (t) => 0.9 * (t - T.e0), m: { b: 1.3, c: 1.02, s: 1.0 }, zoom: (t) => 1.03 + 0.03 * fr(t, T.e0, 3) },
    { id: "f", t0: T.f0, t1: T.end + 1, src: null, m: { b: 1.22, c: 1.06, s: 0.9, wm: 0.08 }, zoom: (t) => 1.0 + 0.02 * fr(t, T.f0, 4) + 0.03 * E.io(fr(t, T.ramp, 4.5)) },
  ];
  const shotAt = (t) => SHOT.find((s) => t >= s.t0 && t < s.t1) || SHOT[SHOT.length - 1];
  /** The last shot's clock (seconds in the source clip): as shot from 5.95, then from 21.0 the speed falls linearly to
   *  20% and holds on src 9.55 from 22.0 (the warm freeze). */
  function srcF(t) {
    if (t < T.ramp) return 5.95 + (t - T.f0);
    const u = Math.min(1, t - T.ramp); return 8.95 + u - 0.4 * u * u;
  }
  /** The tracking crop: the 9:16 window's left edge in the source frame (fraction of its width), locked on the tower's
   *  right block as the camera pans (measured by template match on the clip, src 5.95 -> 9.55: it gathers pace). */
  const trackX = AD.map([[5.95, 0], [6.45, -0.0370], [6.95, -0.0730], [7.45, -0.1100], [7.95, -0.1470], [8.45, -0.1860], [8.95, -0.2282], [9.45, -0.2693], [9.55, -0.2775]].map(([s, d]) => [s, 0.3129 + d]));
  const STRIP = { x0: 0.03, w: 0.6 }, KS = W / (STRIP.w * 1920), SH = 1080 * KS, SW = SH * W / H, PAD_Y = (H - SH) / 2;   // the contained strip: scale, crop size, top pad

  /** The cold freezes (in over 6 f) and the warm one. */
  const coldK = (t) => (t >= T.fzA && t < T.b0 ? E.o3(fr(t, T.fzA, F(6))) : t >= T.fzB && t < T.c0 ? E.o3(fr(t, T.fzB, F(6))) : 0);
  const warmK = (t) => (t >= T.ramp ? E.io(fr(t, T.ramp + 0.4, 1.2)) : 0);

  /** One warm-grey grade for all six clips (contrast up, saturation -34%, warm lifted blacks, soft vignette); a shot's
   *  exposure match first. Cold: a third of the saturation off, two degrees cooler, grain up. Warm: a notch warmer. */
  function grade(S, s, t) {
    const c = coldK(t), w = warmK(t), m = s.m;
    return `brightness(${(m.b * (1 - 0.07 * c) * (1 + 0.03 * w)).toFixed(3)}) contrast(${(1.1 * m.c + 0.05 * c).toFixed(3)}) saturate(${(0.66 * m.s * (1 - c / 3) * (1 + 0.1 * w)).toFixed(3)})`;
  }
  function overlays(S, t, s) {
    const { ctx } = S, c = coldK(t), w = warmK(t);
    ctx.save();
    ctx.globalCompositeOperation = "screen"; ctx.fillStyle = "rgb(13,11,9)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = `rgba(255,176,118,${(0.16 + (s.m.wm || 0)).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
    if (c > 0) { ctx.fillStyle = `rgba(70,125,200,${0.2 * c})`; ctx.fillRect(0, 0, W, H); }
    if (w > 0) { ctx.fillStyle = `rgba(255,160,80,${0.14 * w})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    X0.vignette(ctx, W, H, 0.28 + 0.12 * c);
  }
  function footage(S, t) {
    const { ctx } = S, s = shotAt(t), z = s.zoom(t);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    if (s.id !== "f") {
      ctx.filter = grade(S, s, t); X0.cover(ctx, S.foot(s.id, s.src(t)), 0, 0, W, H); ctx.filter = "none";
      if (s.id === "a") rain(S, t);
      if (s.id === "e") sweeps(S, t);
    } else {
      const src = srcF(t), im = t < T.ramp ? S.foot("f", src - 5.9) : S.foot("g", src - 8.9);
      const sx = clamp((trackX(src) - STRIP.x0) * 1920 * KS, 0, 1080 - SW);
      ctx.filter = grade(S, s, t); ctx.drawImage(im, sx, PAD_Y, SW, SH, 0, 0, W, H);
      windowOn(S, t, im, sx); ctx.filter = "none";
    }
    ctx.restore();
    overlays(S, t, s);
    if ((t >= T.fzA && t < T.fzA + F(1)) || (t >= T.fzB && t < T.fzB + F(1))) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(0, 0, W, H); }   // the shutter
  }
  /** Light rain over the kerb shot: thin streaks falling at an angle, still on the freeze. */
  function rain(S, t) {
    const { ctx } = S, tt = Math.min(t, T.fzA), N = 110;
    ctx.save(); ctx.lineCap = "round";
    for (let i = 0; i < N; i++) {
      const h1 = X0.hash(i * 7 + 1), h2 = X0.hash(i * 7 + 2), h3 = X0.hash(i * 7 + 3), h4 = X0.hash(i * 7 + 4);
      const len = 40 + 80 * h3, sp = 2100 + 1300 * h4, y = ((h2 * (H + 300) + sp * tt) % (H + 300)) - 150, x = h1 * (W + 200) - 100 + 0.16 * (y + 150);
      ctx.strokeStyle = `rgba(214,222,236,${(0.07 + 0.13 * h3).toFixed(3)})`; ctx.lineWidth = 1 + 1.6 * h4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.16 * len, y + len); ctx.stroke();
    }
    ctx.restore();
  }
  /** Street lights crossing the back seat: three soft warm bands sliding over the dark, slow. */
  function sweeps(S, t) {
    const { ctx } = S;
    for (const [c, a] of [[15.25, 0.13], [16.45, 0.1], [17.45, 0.12]]) {
      const k = (t - c) / 0.9; if (k < 0 || k > 1) continue;
      const x = lerp(-500, W + 500, k);
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.translate(x, H * 0.45); ctx.rotate(0.38);
      const g = ctx.createLinearGradient(-260, 0, 260, 0); g.addColorStop(0, "rgba(255,170,96,0)"); g.addColorStop(0.5, `rgba(255,170,96,${a * E.bump(k)})`); g.addColorStop(1, "rgba(255,170,96,0)");
      ctx.fillStyle = g; ctx.fillRect(-260, -1500, 520, 3000); ctx.restore();
    }
  }
  /** The one window that lights up in the dark block: a lit pane of the same tower (its blinds, its frame, its grain)
   *  cloned onto a dark one in the same row, on the crop's tracked coordinates, so it rides the shot; it comes on in
   *  9 frames with one small catch, like a tube light finding itself, and spills a little warmth around it. */
  const LIT = { x: 897, y: 691, w: 92, h: 43 }, WIN = { x: 642, y: 686 };   // canvas px at the lock (the tracked block holds still)
  const winK = (t) => { if (t < T.win) return 0; const f = (t - T.win) * 30; return f < 2 ? 0.6 * f / 2 : f < 4 ? 0.6 - 0.35 * (f - 2) / 2 : clamp(0.25 + 0.75 * E.o3((f - 4) / 5)); };
  function windowOn(S, t, im, sx) {
    const a = winK(t); if (a <= 0) return;
    const { ctx } = S, kx = SW / W, ky = SH / H;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.filter = `${ctx.filter === "none" ? "" : ctx.filter} brightness(1.45) sepia(0.15)`;   // a touch warmer and brighter than its neighbours: the one we watch
    ctx.beginPath(); X0.rrect(ctx, WIN.x, WIN.y, LIT.w, LIT.h, 3); ctx.clip();
    ctx.drawImage(im, sx + LIT.x * kx, PAD_Y + LIT.y * ky, LIT.w * kx, LIT.h * ky, WIN.x, WIN.y, LIT.w, LIT.h);
    ctx.restore();
    ctx.save(); ctx.filter = "none"; ctx.globalCompositeOperation = "screen";
    const cx = WIN.x + LIT.w / 2, cy = WIN.y + LIT.h / 2; ctx.translate(cx, cy); ctx.scale(1.5, 1);
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 62); g.addColorStop(0, `rgba(255,178,96,${(0.14 * a).toFixed(3)})`); g.addColorStop(1, "rgba(255,178,96,0)");
    ctx.fillStyle = g; ctx.fillRect(-70, -70, 140, 140); ctx.restore();
  }
  /** The ink under the white type: a 0 -> 42% gradient from 0.52h to 0.80h, held to the foot. */
  function band(S, t) {
    const { ctx } = S, y0 = 1000, g = ctx.createLinearGradient(0, y0, 0, 1540);
    g.addColorStop(0, "rgba(10,10,10,0)"); g.addColorStop(1, "rgba(10,10,10,0.42)");
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, 540); ctx.fillStyle = "rgba(10,10,10,0.42)"; ctx.fillRect(0, 1540, W, H - 1540);
    // the last shot: the tower's lit floors run behind 0.5-0.57h, so the big handwriting gets a 40% ink band, and the
    // headline block (small lines from 0.54h down) a 50% ink gradient that rises with the warm freeze
    const kb = Math.min(fr(t, T.vo2 - 0.2, 0.3), 1 - fr(t, T.bigOut, F(8)));
    if (kb > 0) { const b = ctx.createLinearGradient(0, 840, 0, 1120); b.addColorStop(0, "rgba(10,10,10,0)"); b.addColorStop(0.32, `rgba(10,10,10,${0.4 * kb})`); b.addColorStop(0.7, `rgba(10,10,10,${0.4 * kb})`); b.addColorStop(1, "rgba(10,10,10,0)"); ctx.fillStyle = b; ctx.fillRect(0, 840, W, 280); }
    const kh = E.io(fr(t, T.fzF - 0.2, 0.4));
    if (kh > 0) { const h = ctx.createLinearGradient(0, 860, 0, 1000); h.addColorStop(0, "rgba(10,10,10,0)"); h.addColorStop(1, `rgba(10,10,10,${0.5 * kh})`); ctx.fillStyle = h; ctx.fillRect(0, 860, W, 140); ctx.fillStyle = `rgba(10,10,10,${0.5 * kh})`; ctx.fillRect(0, 1000, W, H - 1000); }
  }
  const BAR = 64;   // thin ink letterbox on every footage shot
  function bars(S) { const { ctx } = S; ctx.fillStyle = "#0A0A0A"; ctx.fillRect(0, 0, W, BAR); ctx.fillRect(0, H - BAR, W, BAR); }

  // ------------------------------------------------------------------------------------------------ the refrain
  const Q = { size: 97.2, y: 1360 }, R = { size: 54, y: 1462 };   // Caveat 0.09w at 0.70h; the reply Geist 0.05w at 0.76h
  /** Handwriting, centred on x, each word written on (a clip opening over 4 f) at its time, a little jitter per word. */
  function hand(S, words, t, size, y, cx = W / 2) {
    const { ctx } = S, f = X0.font(700, size, "Caveat");
    ctx.save(); ctx.font = f; const sp = ctx.measureText(" ").width, ws = words.map((w) => ctx.measureText(w.text).width); ctx.restore();
    const total = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
    let x = cx - total / 2;
    words.forEach((wd, i) => {
      const k = fr(t, wd.t0 - 0.05, F(4));
      if (k > 0) { ctx.save(); ctx.beginPath(); ctx.rect(x - 10, y - size * 1.05, (ws[i] + 20) * E.o3(k), size * 1.6); ctx.clip();
        ctx.translate(x, y + (X0.hash(i * 31 + Math.round(wd.t0 * 100)) - 0.5) * 4); ctx.rotate((X0.hash(i * 17 + Math.round(wd.t0 * 100)) - 0.5) * 0.03);
        AD.onFilm(S, wd.text, 0, 0, f, "rgba(255,255,255,0.95)"); ctx.restore(); }
      x += ws[i] + sp;
    });
    return total;
  }
  /** A typed reply: white Geist, laid out centred on its full width, one letter a frame from t0. */
  function typed(S, text, t0, t, size, y, cx = W / 2) {
    const n = Math.floor((t - t0) * 30 + 1e-6) + 1; if (n <= 0) return;
    const f = X0.font(500, size), w = X0.width(S.ctx, text, f);
    AD.onFilm(S, text.slice(0, Math.min(n, text.length)), cx - w / 2, y, f, "rgba(255,255,255,0.96)");
  }
  function refrain(S, t) {
    for (const r of REFRAIN) {
      if (t < r.from || t >= r.to) continue;
      if (r.q === null) { const V = S.V["02-1"]; hand(S, V.words.map((w) => ({ text: w.text, t0: T.vo1 + w.t0 })), t, Q.size, Q.y); typed(S, r.reply, r.rAt, t, R.size, R.y); }
      else { hand(S, r.words, t, Q.size, Q.y); typed(S, r.rText, r.reply, t, R.size, R.y); }
    }
    // the last one: larger, at 0.5h, on her word times, no question mark, no reply; it leaves before the headline
    if (t >= T.vo2 && t < T.bigOut + F(8)) {
      const V = S.V["02-2"], a = 1 - E.io(fr(t, T.bigOut, F(8)));
      S.ctx.save(); S.ctx.globalAlpha *= a; hand(S, V.words.map((w) => ({ text: w.text, t0: T.vo2 + w.t0 })), t, 129.6, 1000); S.ctx.restore();
    }
  }

  // ------------------------------------------------------------------------------------------------ the bots' cards
  /** White paper with its shadow, cotton grain and hairline. */
  function sheet(S, x, y, w, h, r) {
    const { ctx, A } = S;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, r); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
  }
  function tape(S, cx, cy, tw, rot) { const { ctx, A } = S, th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore(); }
  const CARD_F = { size: 48.6, pad: 43.2, head: 80, name: 38 };   // ink Geist 0.045w; 0.04w padding each side of the longest line
  const CARDS = [
    { bot: "plan", name: "Plan", color: C.ochre, head: "head-plan", ul: "ul-plan", lines: ["Dinner at Nani's, 9 pm", "leave by 8:10"], ulWord: [1, "8:10"], t0: T.cardA, out: T.outA, rot: -0.035, tapes: [[0.3, -0.07, 210], [0.86, 0.1, 140]] },
    { bot: "travel", name: "Travel", color: C.sea, head: "head-travel", ul: "ul-travel", lines: ["Seat 22A", "Pack a jacket, 11° there"], ulWord: [0, "22A"], t0: T.cardB, out: T.outB, rot: 0.028, tapes: [[0.62, 0.06, 220]] },
  ];
  function cardGeo(S, c) {
    if (c.g) return c.g;
    const f = X0.font(500, CARD_F.size), ww = Math.max(...c.lines.map((l) => X0.width(S.ctx, l, f)), CARD_F.head + 18 + X0.width(S.ctx, c.name, X0.font(600, CARD_F.name)));
    const w = Math.round(ww + 2 * CARD_F.pad), l1 = 34 + CARD_F.head + 70, l2 = l1 + 66, h = l2 + 50;
    return (c.g = { w, h, x: Math.round(W / 2 - w / 2), y: Math.round(H / 2 - h / 2), l1, l2, f });
  }
  function card(S, t, c) {
    const k = fr(t, c.t0, F(6)), out = t >= c.out ? E.i2(fr(t, c.out, F(6))) : 0; if (k <= 0 || out >= 1) return;
    const { ctx, A } = S, g = cardGeo(S, c), { x, y, w, h } = g, cx = x + w / 2, cy = y + h / 2, P = CARD_F.pad;
    ctx.save(); ctx.translate(cx, cy - out * 30); ctx.rotate(c.rot);
    const press = (1.14 - 0.14 * E.o5(k)) * (1 + 0.04 * out); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2) * (1 - out);
    sheet(S, x, y, w, h, 24);
    ctx.drawImage(A[c.head], x + P, y + 34, CARD_F.head, CARD_F.head);
    X0.text(ctx, c.name, x + P + CARD_F.head + 18, y + 34 + CARD_F.head * 0.66, X0.font(600, CARD_F.name), c.color);
    c.lines.forEach((ln, i) => {
      const by = y + (i ? g.l2 : g.l1); X0.text(ctx, ln, x + P, by, g.f, C.ink);
      if (c.ulWord && c.ulWord[0] === i) {
        const j = ln.indexOf(c.ulWord[1]), pre = X0.width(ctx, ln.slice(0, j), g.f), ww = X0.width(ctx, c.ulWord[1], g.f), im = A[c.ul];
        const uw = ww * 1.14, uh = Math.max(18, uw * im.height / im.width * 1.1);
        X0.reveal(ctx, im, x + P + pre - (uw - ww) / 2, by + CARD_F.size * 0.16, uw, uh, E.o3(fr(t, c.t0 + F(9), F(8))), "x", { rot: -0.012, rag: 8, seed: 4 });
      }
    });
    for (const [fx, rot, tw] of c.tapes) tape(S, x + w * fx, y + 3, tw, rot);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the headline
  /** 'Pahunch gaye?' is 13 wide letters: at the 0.08w cap (Geist Black 121.5 px) it sets 935 px, so from the 0.08w axis
   *  it would cross 0.88w. The block moves to the 0.05w axis and the line is tracked in by 0.026 em (894 px, right edge
   *  948): the cap height stays in the rule's band, the line inside the safe edge and the 1026 px measure. */
  const HL = { x: 54, size: 121.5, track: -0.026, base: [1316, 1459], line1: "Pahunch gaye?", hand: "Haan", handScale: 1.15 };
  function hlFont(S) { return X0.font(900, HL.size); }
  function hlWidth(S) { const { ctx } = S; ctx.save(); ctx.font = hlFont(S); ctx.letterSpacing = `${(HL.track * HL.size).toFixed(2)}px`; const w = ctx.measureText(HL.line1).width - HL.track * HL.size; ctx.restore(); return w; }
  /** The headline over the warm freeze: line one wipes on (7 f), 'Haan' is written in Caveat (7 f), the clay brush under it (9 f). */
  function headline(S, t) {
    if (t < T.l1) return;
    const { ctx, A } = S, size = HL.size, x = HL.x, b = HL.base, w1 = hlWidth(S);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.65)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
    const k1 = E.o3(fr(t, T.l1, F(7)));
    ctx.save(); ctx.beginPath(); ctx.rect(x - 20, b[0] - size * 1.3, (w1 + 40) * k1, size * 1.7); ctx.clip();
    ctx.font = hlFont(S); ctx.letterSpacing = `${(HL.track * size).toFixed(2)}px`; ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "alphabetic"; ctx.fillText(HL.line1, x, b[0]); ctx.restore();
    if (t >= T.hand) {
      const hf = X0.font(700, size * HL.handScale, "Caveat"), hw = X0.width(ctx, HL.hand, hf), hy = b[1] + size * 0.04, kh = E.o3(fr(t, T.hand, F(7)));
      ctx.save(); ctx.beginPath(); ctx.rect(x - 10, b[1] - size * 1.3, (hw + 30) * kh, size * 1.8); ctx.clip(); X0.text(ctx, HL.hand, x, hy, hf, "#FFFFFF"); ctx.restore();
      if (t >= T.ul) { const im = A["ul-bar"], uw = hw * 1.1, uh = Math.max(24, uw * im.height / im.width * 1.15); ctx.shadowColor = "transparent"; X0.reveal(ctx, im, x - (uw - hw) / 2 + 10, hy + size * 0.1, uw, uh, E.o3(fr(t, T.ul, F(9))), "x", { rot: -0.012, rag: 10, seed: 2 }); }
    }
    ctx.restore();
  }
  const SMALL = [{ text: "Reached? Yes", y: 1098 }, { text: "Plan knows when to leave. Travel keeps the tickets.", y: 1158 }], SMALL_F = 37.8, CPS = 48;
  const smallAt = (() => { let t0 = T.s1; return SMALL.map((l, i) => { const a = t0; t0 += l.text.length / CPS + (i === 0 ? 0.25 : 0.12); return a; }); })();
  function smallLines(S, t) {
    SMALL.forEach((l, i) => { const n = Math.floor((t - smallAt[i]) * CPS) + 1; if (n > 0) AD.onFilm(S, l.text.slice(0, Math.min(n, l.text.length)), HL.x, l.y, X0.font(400, SMALL_F), "rgba(255,255,255,0.96)"); });
  }

  /** Measure every line with the real fonts before anything is drawn: the headline against 1026 px and the 0.88w edge,
   *  its cap height, the handwriting and the replies, the cards' text, the small lines. */
  let report = null;
  function check(S) {
    if (report) return; const { ctx } = S, out = [], bad = [];
    { const w1 = hlWidth(S), wn = X0.width(ctx, HL.line1, hlFont(S)), w2 = X0.width(ctx, HL.hand, X0.font(700, HL.size * HL.handScale, "Caveat"));
      out.push(`HL "${HL.line1}" ${w1.toFixed(0)}px (untracked ${wn.toFixed(0)}) right ${(HL.x + w1).toFixed(0)} | HL "${HL.hand}" ${w2.toFixed(0)}px`);
      if (w1 > 1026 || HL.x + w1 > 0.88 * W) bad.push(`headline "${HL.line1}" ${w1.toFixed(0)} px`); }
    ctx.save(); ctx.font = X0.font(900, HL.size); const cap = ctx.measureText("H").actualBoundingBoxAscent / W; ctx.restore(); out.push(`cap ${cap.toFixed(4)}w`);
    if (cap < 0.08 || cap > 0.085) bad.push(`headline cap ${cap.toFixed(4)}w`);
    const qs = ["Pahunch gaye?", "Landed?", "Pahunch gayi beta?", "Reached?"].map((s) => [s, X0.width(ctx, s, X0.font(700, Q.size, "Caveat"))]).concat([["Pahunch gaye. (big)", X0.width(ctx, "Pahunch gaye.", X0.font(700, 129.6, "Caveat"))]]);
    for (const [s, w] of qs) { out.push(`Q "${s}" ${w.toFixed(0)}`); if (W / 2 + w / 2 > 0.88 * W) bad.push(`hand "${s}" past 0.88w`); }
    for (const s of ["Haan.", "Haan Papa.", "Bas 10 minute.", "Yes yes."]) { const w = X0.width(ctx, s, X0.font(500, R.size)); if (W / 2 + w / 2 > 0.88 * W) bad.push(`reply "${s}"`); }
    for (const c of CARDS) { const g = cardGeo(S, c); out.push(`card ${c.name} ${g.w}x${g.h} at ${g.x},${g.y}`); if (g.x + g.w - CARD_F.pad > 0.88 * W) bad.push(`card ${c.name} text past 0.88w`); }
    for (const l of SMALL) { const w = X0.width(ctx, l.text, X0.font(400, SMALL_F)); out.push(`small "${l.text}" right ${(HL.x + w).toFixed(0)}`); if (HL.x + w > 0.88 * W) bad.push(`small "${l.text}"`); }
    report = out.join(" | ");
    if (bad.length) console.error("02 type check: " + bad.join("; "));
    if (S.q.get("hud")) console.warn("02 measure: " + report);
  }

  // ------------------------------------------------------------------------------------------------ the page
  AD.start({
    footage: {
      a: { dir: "../footage-02-a/", frames: 108, fps: 30 }, b: { dir: "../footage-02-b/", frames: 90, fps: 30 }, c: { dir: "../footage-02-c/", frames: 102, fps: 30 },
      d: { dir: "../footage-02-d/", frames: 90, fps: 30 }, e: { dir: "../footage-02-e/", frames: 92, fps: 30 }, f: { dir: "../footage-02-f/", frames: 98, fps: 30 }, g: { dir: "../footage-02-g/", frames: 70, fps: 72 },
    },
    voices: { "02-1": "../voice/02-1.json", "02-2": "../voice/02-2.json" },
    scripts: { "02-1": "Pahunch gaye?", "02-2": "Pahunch gaye." },
    duration: T.end + AD.END_S,
    frame(t, S) {
      check(S);
      if (t < T.end + F(14)) {
        footage(S, t); band(S, t); bars(S);
        if (!S.q.get("notype")) {   // ?notype=1 draws the picture alone, to measure the band behind the white type
          refrain(S, t);
          for (const c of CARDS) card(S, t, c);
          headline(S, t); smallLines(S, t);
        }
      }
      AD.endCard(S, t, T.end);
      X0.grain(S.ctx, W, H, t, t >= T.end + F(14) ? 0.03 : 0.085 + 0.05 * coldK(t), 1);
      if (S.q.get("hud")) X0.text(S.ctx, `shot ${shotAt(t).id} cold ${coldK(t).toFixed(2)} warm ${warmK(t).toFixed(2)}${shotAt(t).id === "f" ? " src " + srcF(t).toFixed(3) : ""}`, 16, 1868, X0.font(500, 24, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const c = [], V1 = S.V["02-1"], V2 = S.V["02-2"], sfx = (f) => `02-sfx/${f}.wav`;
      let pen = 0; const scratch = (at) => c.push({ at, kind: "sample", file: sfx(`pen${(pen++ % 4) + 1}`), gain: 0.5 });
      const ticks = (t0, text, g = 0.2) => { for (let j = 0; j < text.length; j++) if (text[j] !== " ") c.push({ at: t0 + j / 30, kind: "tick", gain: g }); };
      // the drone in G from 0.4 that never leaves (under the end card too, where the chord takes the key)
      c.push({ at: 0.4, kind: "drone", f: 49, dur: T.end + AD.END_S - 0.4, a: 1.2, r: 2.0, gain: 0.5 });
      // one room per shot, each on its cut and stopping dead on the next cut or on the freeze
      c.push({ at: 0, kind: "sample", file: sfx("street"), gain: 0.7 }, { at: T.b0, kind: "sample", file: sfx("cabin"), gain: 0.55 }, { at: T.c0, kind: "sample", file: sfx("rain"), gain: 0.65 },
        { at: T.d0, kind: "sample", file: sfx("taxi"), gain: 0.65 }, { at: T.e0, kind: "sample", file: sfx("hush"), gain: 0.5 }, { at: T.f0, kind: "sample", file: sfx("night"), gain: 0.5 });
      // the 96 bpm pulse: a rail joint on the beat with a low thump, hats on the off-beats; from 3.0 under the first freeze,
      // cut at each tape; back on each unfreeze; the hats stop at 15.0 and the joints fade out by 17.5
      const B = 60 / 96, pulse = (a, b, hats = true, fade = null) => { for (let s = a; s < b - 0.01; s += B) { const g = fade ? 1 - fr(s, fade[0], fade[1]) : 1; if (g <= 0.02) break; c.push({ at: s, kind: "sample", file: sfx("rail"), gain: 0.55 * g }, { at: s, kind: "pulse", gain: 0.38 * g }); if (hats && s + B / 2 < b) c.push({ at: s + B / 2, kind: "tick", gain: 0.16 * g }); } };
      pulse(T.fzA, T.cardA - 0.12, false); pulse(T.b0, T.fzB); pulse(T.c0, T.e0); pulse(T.e0, 17.6, false, [T.e0, 2.4]);
      // her voice, a pen scratch per word; the replies typed, a tick per letter
      c.push({ at: T.vo1, kind: "sample", file: "../voice/02-1.wav", gain: 1.35 }); for (const w of V1.words) scratch(T.vo1 + w.t0 + 0.01);
      ticks(T.r1, "Haan.");
      for (const r of REFRAIN.slice(1)) { for (const w of r.words) scratch(w.t0 + 0.01); ticks(r.reply, r.rText); }
      // the cold freezes: the thud; the tape rip, the card landing, the bot's bell, the brush; the card lifting off
      for (const [fz, cd, out, bell] of [[T.fzA, T.cardA, T.outA, AD.BOT.plan.note], [T.fzB, T.cardB, T.outB, AD.BOT.travel.note]]) {
        c.push({ at: fz, kind: "freeze", gain: 0.6 }, { at: cd - 0.2, kind: "sample", file: sfx("tape"), gain: 0.5 }, { at: cd + F(5), kind: "paper-thud", gain: 0.6 }, { at: cd + F(5), kind: "land", gain: 0.3 });
        c.push({ at: cd + F(8), kind: "bell", f: bell, dur: 1.4, gain: 0.42 }, { at: cd + F(9), kind: "whoosh", dur: 0.25, up: false, gain: 0.25 }, { at: out, kind: "whoosh", dur: 0.22, up: true, gain: 0.28 });
      }
      // the window: a soft click of a switch far off; her last line; the riser into one warm G major chord at 20.0
      c.push({ at: T.win, kind: "click", gain: 0.18 });
      c.push({ at: T.vo2, kind: "sample", file: "../voice/02-2.wav", gain: 1.35 }); for (const w of V2.words) scratch(T.vo2 + w.t0 + 0.01);
      c.push({ at: T.chord - 1.3, kind: "riser", dur: 1.3, gain: 0.38 }, { at: T.chord, kind: "chord", f: 98, dur: 6.4, gain: 0.46 }, { at: T.chord, kind: "boom", gain: 0.3, f0: 55, f1: 38, dur: 1.4 });
      // the warm freeze lands soft; the headline: a tick per line, the hand word, the brush; the small lines typed; the
      // ochre and sea bells over the chord as Plan and Travel are named
      c.push({ at: T.fzF, kind: "land", gain: 0.18 });
      c.push({ at: T.l1, kind: "tick", gain: 0.3 }, { at: T.l1 + F(4), kind: "tick", gain: 0.22 }, { at: T.hand, kind: "sample", file: sfx("pen2"), gain: 0.45 }, { at: T.hand + 0.12, kind: "sample", file: sfx("pen3"), gain: 0.35 }, { at: T.ul, kind: "whoosh", dur: 0.3, up: false, gain: 0.34 });
      SMALL.forEach((l, i) => { for (let j = 0; j < l.text.length; j++) if (l.text[j] !== " ") c.push({ at: smallAt[i] + j / CPS, kind: "tick", gain: 0.09 }); });
      const travelAt = smallAt[1] + SMALL[1].text.indexOf("Travel") / CPS;
      c.push({ at: smallAt[1], kind: "bell", f: AD.BOT.plan.note, dur: 1.6, gain: 0.32 }, { at: travelAt, kind: "bell", f: AD.BOT.travel.note, dur: 1.6, gain: 0.32 });
      // the campaign's end card, its chord and bells moved from D to this spot's G (x 2/3: G2 chord, G B D E G bells)
      for (const e of AD.endCues(T.end)) c.push(e.kind === "chord" || e.kind === "bell" ? { ...e, f: e.f * (98 / 146.83) } : e);
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
