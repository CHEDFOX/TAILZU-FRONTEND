/* 02 PAHUNCH GAYE? (the Humanist; India; awareness). A refrain film you read: six arrivals by night on six strangers'
 * clips cut like one roll, the same question in a mother's hand over each, a typed reply from someone else each time.
 * A scooter pulls away in light rain ('Pahunch gaye?' in her voice, 'Haan.' typed); the frame freezes cold and Plan's
 * card is taped on. A plane's wing at dusk ('Landed?' / 'Haan Papa.'); cold again, Travel's card. Rain on a bus window
 * ('Pahunch gayi beta?' / 'Bas 10 minute.'). A street from a back seat ('Reached?' / 'Yes yes.'). A dark back seat with
 * nothing written: the one person who does not have to answer. A window in a dark block lights up: 'Pahunch gaye.' in her
 * voice, no question mark, no reply. The film slows to 20% and freezes WARM; the headline answers: 'Pahunch gaye? /
 * Haan'. The campaign's end card.
 *
 * Everything is a pure function of t. Footage (prep.mjs, no interpolation except the last shot's ramp tail):
 * footage-02-a (Mixkit 6754 src 12.6-16.2, crop x0.30, 30 fps), -b (Mixkit 4204 0-3, x0.28, 30 fps), -c (Mixkit 2846
 * 0-3.4, x0.22, 30 fps), -d (Mixkit 42037 src 5.06-8.20, x0.42, its own 24 fps frames played one per output frame, so
 * 1.25x with no repeated or skipped frame, and clear of the clip's two exposure flashes), -e (Mixkit 39532 6.5-9.6,
 * x0.60, 30 fps), -f (Mixkit 40734 src 5.297-9.05, its own 24 fps frames, a contained strip x0.08-0.69) and -g (Mixkit
 * 40734 8.9-9.9, strip x0.03-0.63, interpolated to 72 fps for the ramp). The tower is locked by a per-frame table: the
 * tower's right block was template-matched on every prepped frame of -f and -g (x and y, in source pixels, lightly
 * smoothed), and the crop is taken from the frame actually shown, so the block holds still and the cloned window rides
 * its facade. Voice: en-IN Neerja at -15% (voice/02-1 'Pahunch gaye?', voice/02-2 'Pahunch gaye.'). Sound: a drone in G
 * from 0.4 that never leaves, a 96 bpm rail-joint pulse with hats that cuts on each cold freeze, pen scratches,
 * typewriter ticks, tape rips, the ochre and sea bells, one room tone per shot (spots/02-sfx/make.mjs), a riser into one
 * warm G major chord at 20.0, the end card in G.
 */
(() => {
  "use strict";
  const { E, C, clamp } = X0;
  const { F, fr, lerp } = AD;
  const W = 1080, H = 1920;

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    vo1: 0.4,                         // 02-1 'Pahunch gaye?': Pahunch +0.10, gaye +0.60
    r1: 2.0,                          // 'Haan.' types, a letter a frame
    fzA: 3.0, cardA: 3.06, outA: 4.86,   // the card tapes on with the freeze and slides off into the next shot's first frames
    b0: 5.0, fzB: 7.5, cardB: 7.56, outB: 9.36,
    c0: 9.5, d0: 12.5, e0: 15.0, f0: 17.4,
    win: 18.0,                        // the window lights up, 0.6 s after the cut, 0.6 s before her line
    vo2: 18.5,                        // 02-2 'Pahunch gaye.': Pahunch +0.10 (18.6), gaye +0.63
    chord: 20.0, ramp: 21.0, fzF: 22.0, bigOut: 21.62,
    l1: 21.95, hand: 22.3, ul: 22.72, // the headline over the warm freeze (line one slammed)
    s1: 22.55, sA: 22.85, sB: 23.10,  // the small lines: 'Reached? Yes' typed, then the two claims slammed
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
  /** The shots: which folder, the clip's own clock (seconds into the folder), the exposure match before the one grade.
   *  Page moves stop dead on each freeze, so the stop reads. */
  const SHOT = [
    { id: "a", t0: 0, t1: T.b0, src: (t) => 0.9 * Math.min(t, T.fzA), m: { b: 0.9, c: 1.04, s: 1.0 }, zoom: (t) => 1 + 0.03 * fr(t, 0, T.fzA) },
    { id: "b", t0: T.b0, t1: T.c0, src: (t) => Math.min(t, T.fzB) - T.b0 + 0.1, m: { b: 0.69, c: 2.0, s: 0.5, wm: 0.3, sep: 0.28 }, zoom: (t) => 1.02 + 0.06 * fr(t, T.b0, T.fzB - T.b0) },
    { id: "c", t0: T.c0, t1: T.d0, src: (t) => t - T.c0 + 0.2, m: { b: 0.5, c: 1.3, s: 1.05 }, zoom: (t) => 1.04 + 0.03 * fr(t, T.c0, 3) },
    { id: "d", t0: T.d0, t1: T.e0, src: (t) => (t - T.d0) * 1.25, m: { b: 0.8, c: 1.05, s: 0.4 }, zoom: (t) => 1.02 + 0.02 * fr(t, T.d0, 2.5) },
    { id: "e", t0: T.e0, t1: T.f0, src: (t) => 0.9 * (t - T.e0), m: { b: 2.1, c: 0.96, s: 0.8, toe: true, blur: 2.5 }, zoom: (t) => 1.03 + 0.03 * fr(t, T.e0, T.f0 - T.e0) },
    { id: "f", t0: T.f0, t1: T.end + 1, src: null, m: { b: 1.22, c: 1.06, s: 0.9, wm: 0.08 }, zoom: (t) => 1 + 0.06 * towerP(t) },
  ];
  const shotAt = (t) => SHOT.find((s) => t >= s.t0 && t < s.t1) || SHOT[SHOT.length - 1];

  /** The tower (Mixkit 40734). Its right block, template-matched on every prepped frame (source px, relative to source
   *  frame 143 at 5.964 s): X is the block's horizontal shift (raw on -g, whose interpolated frames sit a third of a pixel off the line in a
   *  three-frame cycle), Y its vertical drift. -f frame j is source frame 127 + j;
   *  -g frame 0 is source frame 215 and runs on at 72 fps. */
  const TRK = {
    f: { x0: 0.08, w: 0.61, fps: 24,
      X: [94.4,88.5,82.7,76.8,70.9,65.1,59.2,53.4,47.5,41.7,35.9,30.0,24.2,18.3,12.5,6.7,0.8,-5.0,-10.9,-16.7,-22.6,-28.4,-34.2,-40.0,-45.8,-51.7,-57.5,-63.3,-69.2,-75.0,-80.9,-86.7,-92.5,-98.3,-104.2,-110.0,-115.9,-121.7,-127.6,-133.4,-139.2,-145.1,-150.9,-156.8,-162.6,-168.5,-174.4,-180.2,-186.1,-192.0,-198.0,-203.9,-209.8,-215.8,-221.7,-227.7,-233.7,-239.8,-245.8,-251.9,-258.0,-264.0,-270.1,-276.3,-282.4,-288.6,-294.7,-300.9,-307.1,-313.3,-319.6,-325.9,-332.2,-338.6,-344.9,-351.3,-357.7,-364.1,-370.6,-377.0,-383.4,-389.7,-396.0,-402.4,-408.8,-415.3,-421.9,-428.5,-435.1,-441.6],
      Y: [-4.3,-4.1,-3.9,-3.7,-3.5,-3.4,-3.2,-3.0,-2.8,-2.6,-2.4,-2.3,-2.1,-1.9,-1.8,-1.6,-1.5,-1.4,-1.2,-1.1,-1.0,-0.9,-0.8,-0.7,-0.6,-0.5,-0.4,-0.3,-0.3,-0.2,-0.1,-0.1,0.0,0.0,0.1,0.1,0.2,0.2,0.3,0.3,0.4,0.5,0.5,0.6,0.6,0.7,0.7,0.8,0.8,0.8,0.9,0.9,1.0,1.0,1.1,1.1,1.2,1.2,1.2,1.3,1.4,1.4,1.5,1.6,1.6,1.7,1.7,1.8,1.9,1.9,2.0,2.0,2.1,2.1,2.2,2.2,2.2,2.3,2.3,2.3,2.3,2.3,2.4,2.4,2.3,2.3,2.3,2.2,2.1,2.1] },
    g: { x0: 0.03, w: 0.6, fps: 72,
      X: [-428.8,-431.3,-433.9,-435.5,-438.0,-440.6,-442.1,-444.6,-447.3,-448.9,-451.2,-453.9,-455.4,-457.9,-460.5,-462.1,-464.6,-467.2,-468.7,-471.2,-473.9,-475.5,-478.0,-480.7,-482.2,-484.8,-487.4,-489.0,-491.6,-494.3,-495.9,-498.4,-501.0,-502.6,-505.1,-507.6,-509.1,-511.7,-514.4,-515.9,-518.5,-521.1,-522.7,-525.2,-527.9,-529.5,-532.1,-534.8,-536.4,-538.9],
      Y: [2.2,2.2,2.2,2.1,2.1,2.1,2.0,2.0,2.0,2.0,1.9,1.9,1.9,1.9,1.9,1.9,1.8,1.8,1.8,1.7,1.7,1.6,1.6,1.5,1.5,1.4,1.4,1.3,1.3,1.2,1.2,1.1,1.1,1.0,1.0,0.9,0.9,0.8,0.8,0.8,0.8,0.7,0.6,0.6,0.5,0.4,0.4,0.3,0.2,0.1] },
  };
  for (const tr of Object.values(TRK)) { tr.KS = W / (tr.w * 1920); tr.SH = 1080 * tr.KS; tr.SW = tr.SH * W / H; tr.PAD = (H - tr.SH) / 2; }   // strip scale, crop size, top pad
  const LOCK = { x: 600.8 - 0.8, y: -1.5 }, PX = H / 1080;   // the crop's left edge (source px) at the reference; source px -> canvas px
  /** The ramp's clock in -g seconds: from 21.0 the speed falls linearly from 1x to 20% and holds from 22.0 (the warm freeze). */
  const rampG = (t) => { const u = clamp(t - T.ramp); return u - 0.4 * u * u; };
  /** Which frame of the tower is on screen: -f one source frame at a time (so every displayed frame is its own content
   *  time), then -g through the ramp. */
  const towerAt = (t) => (t < T.ramp ? { name: "f", i: clamp(Math.round((t - T.f0) * 24) + 1, 0, 89) } : { name: "g", i: clamp(Math.round(rampG(t) * 72), 0, 49) });
  /** The shot's progress on the SOURCE clock (0 at the cut, 1 at the freeze): the push rides it, slows with the ramp and stops dead. */
  const towerP = (t) => (t < T.ramp ? Math.max(0, t - T.f0) : T.ramp - T.f0 + rampG(t)) / (T.ramp - T.f0 + 0.6);

  /** The cold freezes (in over 6 f) and the warm one. */
  const coldK = (t) => (t >= T.fzA && t < T.b0 ? E.o3(fr(t, T.fzA, F(6))) : t >= T.fzB && t < T.c0 ? E.o3(fr(t, T.fzB, F(6))) : 0);
  const warmK = (t) => (t >= T.ramp ? E.io(fr(t, T.ramp + 0.4, 1.2)) : 0);

  /** One warm-grey grade for all six clips (contrast up, saturation -34%, warm lifted blacks, soft vignette); a shot's
   *  exposure match first (the dark back seat gets a gamma toe so its shapes read). Cold: a third of the saturation off,
   *  two degrees cooler, grain up. Warm: a notch warmer. */
  function grade(S, s, t) {
    const c = coldK(t), w = warmK(t), m = s.m;
    return `${m.toe ? "url(#toe) " : ""}${m.blur ? `blur(${m.blur}px) ` : ""}brightness(${(m.b * (1 - 0.07 * c) * (1 + 0.03 * w)).toFixed(3)}) contrast(${(1.1 * m.c + 0.05 * c).toFixed(3)}) saturate(${(0.66 * m.s * (1 - c / 3) * (1 + 0.1 * w)).toFixed(3)})${m.sep ? ` sepia(${m.sep})` : ""}`;
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
      const { name, i } = towerAt(t), tr = TRK[name], im = S.A[`${name}#${i + 1}`];
      const sx = clamp((LOCK.x + tr.X[i] - tr.x0 * 1920) * tr.KS, 0, 1080 - tr.SW);
      ctx.translate(0, -(tr.Y[i] - LOCK.y) * PX);   // the block's slow vertical drift taken out too (hidden by the bars)
      ctx.filter = grade(S, s, t); ctx.drawImage(im, sx, tr.PAD, tr.SW, tr.SH, 0, 0, W, H);
      windowOn(S, t, im, sx, tr); ctx.filter = "none";
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
  /** Street lights crossing the back seat: a warm band about once a second, narrow enough to read as a light passing. */
  const SWEEPS = [[15.08, 0.85, 0.3], [16.0, 0.8, 0.3], [16.82, 0.62, 0.27]];   // [start, duration, alpha]
  function sweeps(S, t) {
    const { ctx } = S;
    for (const [s0, d, a] of SWEEPS) {
      const k = (t - s0) / d; if (k < 0 || k > 1) continue;
      const x = lerp(-420, W + 420, k);
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.translate(x, H * 0.45); ctx.rotate(0.38);
      const g = ctx.createLinearGradient(-160, 0, 160, 0); g.addColorStop(0, "rgba(255,170,96,0)"); g.addColorStop(0.5, `rgba(255,170,96,${(a * E.bump(k)).toFixed(3)})`); g.addColorStop(1, "rgba(255,170,96,0)");
      ctx.fillStyle = g; ctx.fillRect(-160, -1500, 320, 3000); ctx.restore();
    }
  }
  /** The one window that lights up in the dark block: a lit pane of the same tower (its blinds, its frame, its grain)
   *  cloned onto a dark one in the same row, on the locked coordinates, so it rides the shot; it comes on in 9 frames
   *  with one small catch, like a tube light finding itself, and spills a little warmth around it. */
  const LIT = { x: 897, y: 691, w: 92, h: 43 }, WIN = { x: 642, y: 686 };   // canvas px at the lock (the tracked block holds still)
  const winK = (t) => { if (t < T.win) return 0; const f = (t - T.win) * 30; return f < 2 ? 0.6 * f / 2 : f < 4 ? 0.6 - 0.35 * (f - 2) / 2 : clamp(0.25 + 0.75 * E.o3((f - 4) / 5)); };
  function windowOn(S, t, im, sx, tr) {
    const a = winK(t); if (a <= 0) return;
    const { ctx } = S, kx = tr.SW / W, ky = tr.SH / H;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.filter = `${ctx.filter === "none" ? "" : ctx.filter} brightness(1.8) sepia(0.15)`;   // warmer and brighter than its neighbours: the one we watch
    ctx.beginPath(); X0.rrect(ctx, WIN.x, WIN.y, LIT.w, LIT.h, 3); ctx.clip();
    ctx.drawImage(im, sx + LIT.x * kx, tr.PAD + LIT.y * ky, LIT.w * kx, LIT.h * ky, WIN.x, WIN.y, LIT.w, LIT.h);
    ctx.restore();
    ctx.save(); ctx.filter = "none"; ctx.globalCompositeOperation = "screen";
    const cx = WIN.x + LIT.w / 2, cy = WIN.y + LIT.h / 2; ctx.translate(cx, cy); ctx.scale(1.5, 1);
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 62); g.addColorStop(0, `rgba(255,178,96,${(0.22 * a).toFixed(3)})`); g.addColorStop(1, "rgba(255,178,96,0)");
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
  const CARD_F = { size: 48.6, pad: 43.2, head: 80, name: 44 };   // ink Geist 0.045w; 0.04w padding each side of the longest line
  const CARDS = [
    { bot: "plan", name: "Plan", color: C.ochre, head: "head-plan", lines: ["Dinner at Nani's, 9 pm", "leave by 8:10"], t0: T.cardA, out: T.outA, rot: -0.035, tapes: [[0.3, -0.07, 210], [0.86, 0.1, 140]] },
    { bot: "travel", name: "Travel", color: C.sea, head: "head-travel", lines: ["Seat 22A", "Pack a jacket, 11° there"], t0: T.cardB, out: T.outB, rot: 0.028, tapes: [[0.62, 0.06, 220]] },
  ];
  function cardGeo(S, c) {
    if (c.g) return c.g;
    const f = X0.font(500, CARD_F.size), ww = Math.max(...c.lines.map((l) => X0.width(S.ctx, l, f)), CARD_F.head + 18 + X0.width(S.ctx, c.name, X0.font(600, CARD_F.name)));
    const w = Math.round(ww + 2 * CARD_F.pad), l1 = 34 + CARD_F.head + 70, l2 = l1 + 66, h = l2 + 50;
    return (c.g = { w, h, x: Math.round(W / 2 - w / 2), y: Math.round(H / 2 - h / 2), l1, l2, f });
  }
  const cardIn = (t, c) => fr(t, c.t0, F(6)), cardOut = (t, c) => (t >= c.out ? E.i2(fr(t, c.out, F(6))) : 0);
  /** How much of a card is up (0..1): the refrain underneath falls to half while it is, so the card gets the read. */
  const cardUp = (t) => Math.max(0, ...CARDS.map((c) => cardIn(t, c) * (1 - cardOut(t, c))));
  function card(S, t, c) {
    const k = cardIn(t, c), out = cardOut(t, c); if (k <= 0 || out >= 1) return;
    const { ctx, A } = S, g = cardGeo(S, c), { x, y, w, h } = g, cx = x + w / 2, cy = y + h / 2, P = CARD_F.pad;
    ctx.save(); ctx.translate(cx, cy - out * 30); ctx.rotate(c.rot);
    const press = (1.14 - 0.14 * E.o5(k)) * (1 + 0.04 * out); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2) * (1 - out);
    sheet(S, x, y, w, h, 24);
    ctx.drawImage(A[c.head], x + P, y + 34, CARD_F.head, CARD_F.head);
    X0.text(ctx, c.name, x + P + CARD_F.head + 18, y + 34 + CARD_F.head * 0.68, X0.font(600, CARD_F.name), c.color);
    c.lines.forEach((ln, i) => X0.text(ctx, ln, x + P, y + (i ? g.l2 : g.l1), g.f, C.ink));
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
  /** The headline over the warm freeze: line one slammed in one frame (1.08 -> 1.00 over 3 f, about its centre), 'Haan'
   *  written in Caveat (7 f), the clay brush under it (9 f). */
  function headline(S, t) {
    if (t < T.l1) return;
    const { ctx, A } = S, size = HL.size, x = HL.x, b = HL.base, w1 = hlWidth(S);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.65)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
    const s1 = 1.08 - 0.08 * E.o3(fr(t, T.l1, F(3))), ax = x + w1 / 2, ay = b[0] - size * 0.36;
    ctx.save(); ctx.translate(ax, ay); ctx.scale(s1, s1); ctx.translate(-ax, -ay);
    ctx.font = hlFont(S); ctx.letterSpacing = `${(HL.track * size).toFixed(2)}px`; ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "alphabetic"; ctx.fillText(HL.line1, x, b[0]); ctx.restore();
    if (t >= T.hand) {
      const hf = X0.font(700, size * HL.handScale, "Caveat"), hw = X0.width(ctx, HL.hand, hf), hy = b[1] + size * 0.04, kh = E.o3(fr(t, T.hand, F(7)));
      ctx.save(); ctx.beginPath(); ctx.rect(x - 10, b[1] - size * 1.3, (hw + 30) * kh, size * 1.8); ctx.clip(); X0.text(ctx, HL.hand, x, hy, hf, "#FFFFFF"); ctx.restore();
      if (t >= T.ul) { const im = A["ul-bar"], uw = hw * 1.1, uh = Math.max(24, uw * im.height / im.width * 1.15); ctx.shadowColor = "transparent"; X0.reveal(ctx, im, x - (uw - hw) / 2 + 10, hy + size * 0.1, uw, uh, E.o3(fr(t, T.ul, F(9))), "x", { rot: -0.012, rag: 10, seed: 2 }); }
    }
    ctx.restore();
  }
  /** Above the headline: 'Reached? Yes' typed (a tick a letter), then the claim in two short lines, each slammed in one
   *  frame with its bot's bell, so it holds about 2.5 s before the end card. Geist 0.035w, white on the 50% ink. */
  const SMALL = [{ text: "Reached? Yes", y: 1040, at: T.s1, typed: true }, { text: "Plan knows when to leave.", y: 1102, at: T.sA, bot: "plan" }, { text: "Travel keeps the tickets.", y: 1156, at: T.sB, bot: "travel" }], SMALL_F = 37.8, CPS = 48;
  function smallLines(S, t) {
    const { ctx } = S, f = X0.font(400, SMALL_F);
    for (const l of SMALL) {
      if (t < l.at) continue;
      if (l.typed) { const n = Math.floor((t - l.at) * CPS) + 1; AD.onFilm(S, l.text.slice(0, Math.min(n, l.text.length)), HL.x, l.y, f, "rgba(255,255,255,0.96)"); continue; }
      const s = 1.08 - 0.08 * E.o3(fr(t, l.at, F(3))), w = X0.width(ctx, l.text, f), ax = HL.x + w / 2, ay = l.y - SMALL_F * 0.36;
      ctx.save(); ctx.translate(ax, ay); ctx.scale(s, s); ctx.translate(-ax, -ay); AD.onFilm(S, l.text, HL.x, l.y, f, "rgba(255,255,255,0.96)"); ctx.restore();
    }
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
      d: { dir: "../footage-02-d/", frames: 75, fps: 24 }, e: { dir: "../footage-02-e/", frames: 92, fps: 30 }, f: { dir: "../footage-02-f/", frames: 90, fps: 24 }, g: { dir: "../footage-02-g/", frames: 50, fps: 72 },
    },
    voices: { "02-1": "../voice/02-1.json", "02-2": "../voice/02-2.json" },
    scripts: { "02-1": "Pahunch gaye?", "02-2": "Pahunch gaye." },
    duration: T.end + AD.END_S,
    frame(t, S) {
      check(S);
      if (t < T.end + F(14)) {
        footage(S, t); band(S, t); bars(S);
        if (!S.q.get("notype")) {   // ?notype=1 draws the picture alone, to measure the band behind the white type
          S.ctx.save(); S.ctx.globalAlpha *= 1 - 0.5 * cardUp(t); refrain(S, t); S.ctx.restore();
          for (const c of CARDS) card(S, t, c);
          headline(S, t); smallLines(S, t);
        }
      }
      AD.endCard(S, t, T.end);
      X0.grain(S.ctx, W, H, t, t >= T.end + F(14) ? 0.03 : 0.085 + 0.05 * coldK(t), 1);
      if (S.q.get("hud")) { const s = shotAt(t), tw = s.id === "f" ? towerAt(t) : null; X0.text(S.ctx, `shot ${s.id} cold ${coldK(t).toFixed(2)} warm ${warmK(t).toFixed(2)}${tw ? ` ${tw.name}#${tw.i + 1}` : ""}`, 16, 1868, X0.font(500, 24, "GeistMono"), "#ff6060"); }
    },
    cues(S) {
      const c = [], V1 = S.V["02-1"], V2 = S.V["02-2"], sfx = (f) => `02-sfx/${f}.wav`;
      let pen = 0; const scratch = (at) => c.push({ at, kind: "sample", file: sfx(`pen${(pen++ % 4) + 1}`), gain: 0.5 });
      const ticks = (t0, text, g = 0.2, cps = 30) => { for (let j = 0; j < text.length; j++) if (text[j] !== " ") c.push({ at: t0 + j / cps, kind: "tick", gain: g }); };
      // the drone in G from 0.4 that never leaves (under the end card too, where the chord takes the key)
      c.push({ at: 0.4, kind: "drone", f: 49, dur: T.end + AD.END_S - 0.4, a: 1.2, r: 2.0, gain: 0.5 });
      // one room per shot, each on its cut (the back seat's hush fades out under the towers' far city)
      c.push({ at: 0, kind: "sample", file: sfx("street"), gain: 0.7 }, { at: T.b0, kind: "sample", file: sfx("cabin"), gain: 0.55 }, { at: T.c0, kind: "sample", file: sfx("rain"), gain: 0.65 },
        { at: T.d0, kind: "sample", file: sfx("taxi"), gain: 0.65 }, { at: T.e0, kind: "sample", file: sfx("hush"), gain: 0.45 }, { at: T.f0, kind: "sample", file: sfx("night"), gain: 0.5 });
      // the 96 bpm pulse: a rail joint on the beat with a low thump, hats on the off-beats; one joint at 3.0 under the
      // first freeze, cut by the tape; back on the unfreeze; out on the second freeze; the hats stop at 15.0 and the
      // joints fade out by the cut to the towers
      const B = 60 / 96, pulse = (a, b, hats = true, fade = null) => { for (let s = a; s < b - 0.01; s += B) { const g = fade ? 1 - fr(s, fade[0], fade[1]) : 1; if (g <= 0.02) break; c.push({ at: s, kind: "sample", file: sfx("rail"), gain: 0.55 * g }, { at: s, kind: "pulse", gain: 0.38 * g }); if (hats && s + B / 2 < b) c.push({ at: s + B / 2, kind: "tick", gain: 0.16 * g }); } };
      pulse(T.fzA, T.cardA - 0.02, false); pulse(T.b0, T.fzB); pulse(T.c0, T.e0); pulse(T.e0, T.f0, false, [T.e0, 2.2]);
      // her voice, a pen scratch per word; the replies typed, a tick per letter
      c.push({ at: T.vo1, kind: "sample", file: "../voice/02-1.wav", gain: 1.35 }); for (const w of V1.words) scratch(T.vo1 + w.t0 + 0.01);
      ticks(T.r1, "Haan.");
      for (const r of REFRAIN.slice(1)) { for (const w of r.words) scratch(w.t0 + 0.01); ticks(r.reply, r.rText); }
      // the cold freezes: the thud; the tape rip, the card landing, the bot's bell; the card sliding off into the next shot
      for (const [fz, cd, out, bell] of [[T.fzA, T.cardA, T.outA, AD.BOT.plan.note], [T.fzB, T.cardB, T.outB, AD.BOT.travel.note]]) {
        c.push({ at: fz, kind: "freeze", gain: 0.6 }, { at: cd - 0.04, kind: "sample", file: sfx("tape"), gain: 0.5 }, { at: cd + F(5), kind: "paper-thud", gain: 0.6 }, { at: cd + F(5), kind: "land", gain: 0.3 });
        c.push({ at: cd + F(8), kind: "bell", f: bell, dur: 1.4, gain: 0.42 }, { at: out, kind: "whoosh", dur: 0.22, up: true, gain: 0.28 });
      }
      // the window: a soft click of a switch far off; her last line; the riser into one warm G major chord at 20.0
      c.push({ at: T.win, kind: "click", gain: 0.2 });
      c.push({ at: T.vo2, kind: "sample", file: "../voice/02-2.wav", gain: 1.35 }); for (const w of V2.words) scratch(T.vo2 + w.t0 + 0.01);
      c.push({ at: T.chord - 1.3, kind: "riser", dur: 1.3, gain: 0.38 }, { at: T.chord, kind: "chord", f: 98, dur: 6.4, gain: 0.46 }, { at: T.chord, kind: "boom", gain: 0.3, f0: 55, f1: 38, dur: 1.4 });
      // the warm freeze lands soft; the headline: a boom on the slam, the pen on the hand word, the one brush in the film;
      // 'Reached? Yes' typed; the claims slammed with a soft boom each and the ochre and sea bells over the chord
      c.push({ at: T.fzF, kind: "land", gain: 0.18 });
      c.push({ at: T.l1, kind: "boom", gain: 0.34, dur: 1.1 }, { at: T.hand, kind: "sample", file: sfx("pen2"), gain: 0.45 }, { at: T.hand + 0.12, kind: "sample", file: sfx("pen3"), gain: 0.35 }, { at: T.ul, kind: "whoosh", dur: 0.3, up: false, gain: 0.34 });
      for (const l of SMALL) {
        if (l.typed) ticks(l.at, l.text, 0.09, CPS);
        else c.push({ at: l.at, kind: "boom", gain: 0.14, dur: 0.6 }, { at: l.at, kind: "bell", f: AD.BOT[l.bot].note, dur: 1.6, gain: 0.32 });
      }
      // the campaign's end card, its chord and bells moved from D to this spot's G (x 2/3: G2 chord, G B D E G bells)
      for (const e of AD.endCues(T.end)) c.push(e.kind === "chord" || e.kind === "bell" ? { ...e, f: e.f * (98 / 146.83) } : e);
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
