/* GREAT AT ONE THING (spot 03), the Symmetrist: a deadpan census. Five portraits mounted on white paper like
 * photographs, each centred and level, each with a taped paper tag (Great at bread / clay / hair / this / dinner); on the
 * cook the frame freezes cold and four more tags stack up over him (Less great at typing / plans / trips / code). The
 * hero swings down from the top edge, settles, looks, lets one glove go and flicks the stack: the tags and the frozen
 * frame come apart into paper scraps and slide off the bottom, leaving the page. Then the team portrait under him: four
 * dotted heads pop into their places on the narrator's nouns, the centre place stays open until a grey pencil outline
 * draws itself there; the headline (Each great at / one thing) with the one small line he says; a wink; the end card.
 *
 * Footage (one grade: contrast up, saturation -34 %, fine grain, soft vignette; a cold freeze on the cook):
 *   ../footage-03-a/  bread   Mixkit 42468, 3.95-5.2 s, crop 0.29,0,0.316,1 (30 fps, no interpolation), played at 0.8x
 *                     (the sharpest press of the fist in the kneading clips; zoomed 1.06 and lifted so the fingers clear the tag)
 *   ../footage-03-b/  clay    Mixkit 32085, 10.9-12.6 s, crop 0.37,0,0.316,1
 *   ../footage-03-c/  hair    Mixkit 43243, 7.3-9.0 s, crop 0.3,0,0.6,0.6 (the cape's print is below the crop)
 *   ../footage-03-d/  clip 2 (the dancer), its frames 325-485 = 4.5-6.72 s (72 fps); its corner mark patched as dance.js does
 *   ../footage-03-e/  clip 1 (the cook), its frames 1-140 = 0-1.93 s (72 fps)
 * Voice: en-IN Prabhat at -10 %, six voice.mjs reads (../voice/03-1..6); the portrait line 03-5 is cut at its sentence
 * pauses into 03-5a..f so its full stops can be set to 0.3 s; the timeline below is laid out from the reads. 03-5 was
 * re-read with 'Code bot builds.' (the copy rules: Code bot works on a safe copy, nothing goes live till you say yes);
 * its cut table is P5 below (03-sfx.py's SEG still holds the old read's e/f times: update it before re-running it).
 * Sound: sound.mjs kinds plus 03-sfx/ (creak, rustle, pencil, pen, tock), made by 03-sfx.py.
 *
 * Render: PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs <out> --page spots/03.html --ratio 9x16
 */
(function () {
  "use strict";
  const { C, E, clamp, lerp } = X0;
  const FPS = 30, F = (n) => n / FPS, fr = AD.fr, snap = (t) => Math.round(t * FPS) / FPS;
  const M = 36, WIN = { x: M, y: M, w: 1080 - 2 * M, h: 1920 - 2 * M };   // the photograph inside its 36 px paper mount
  /** The spot's one grade, colder on the freeze (saturation down a third, a touch darker), with a per-clip exposure trim. */
  const GRADE = (cold, trim = 1) => `contrast(${(1.12 + 0.05 * cold).toFixed(3)}) saturate(${(0.66 * (1 - cold / 3)).toFixed(3)}) brightness(${((0.97 - 0.07 * cold) * trim).toFixed(3)})`;

  // ------------------------------------------------------------------------------------------------ the voice
  const SAY = {
    v1: "Nobody is great at everything.", v2: "Some people are great at one thing.", v3: "He is great at dinner.", v4: "Less so at the rest.",
    v5: "A team. Keybot writes. Plan remembers. Travel finds. Code bot builds. And one you make yourself.", v6: "None of them can cook.",
  };
  /** Each read's first word as heard and its last sound (energy, -42 dB) in its file: edge-tts puts first words ~0.06-0.1 s early. */
  const ON = { v1: 0.165, v2: 0.2, v3: 0.21, v4: 0.16, v6: 0.16 }, OFF = { v1: 2.445, v2: 2.86, v3: 1.95, v4: 1.885, v6: 1.685 };
  /** The portrait line's sentences (03-5a..f.wav): words [i0, i1), heard from `on` to `off` in 03-5.wav, each file cut 0.06 s before `on`. */
  const P5 = [{ k: "a", w: [0, 2], on: 0.16, off: 0.675 }, { k: "b", w: [2, 4], on: 1.69, off: 2.74 }, { k: "c", w: [4, 6], on: 3.735, off: 4.855 },
    { k: "d", w: [6, 8], on: 5.86, off: 6.865 }, { k: "e", w: [8, 11], on: 7.87, off: 9.055 }, { k: "f", w: [11, 16], on: 10.01, off: 11.8 }];
  const LEAD = 0.06, STOP = 0.3;   // a cut's lead-in; the pause a full stop gets (the system's 0.3 s)

  // ------------------------------------------------------------------------------------------------ the shots
  const SHOTS = [
    { foot: "a", a: 0, b: 1.3, src0: 0.0, speed: 0.8, zoom: 1.06, dy: -90, trim: 0.95, tag: "Great at bread" },   // the fist's fingers end above the tag
    { foot: "b", a: 1.3, b: 2.6, src0: 0.15, trim: 0.88, tag: "Great at clay" },
    { foot: "c", a: 2.6, b: 3.9, src0: 0.15, trim: 1.06, tag: "Great at hair", tagY: 0.2 },   // on the wall above his hair, never on his face
    { foot: "d", a: 3.9, b: 5.8, src0: 0.1, trim: 1.0, tag: "Great at this", tagY: 0.2, patch: true, dy: 70, feather: 60 },   // the tag on the dark stage under the bulbs; set 70 px down so its lights clear the mount, its top edge feathered into black   // clip 2 from 4.6 s; the lights come on 0.4 s in
    { foot: "e", a: 5.8, b: 7.6, src0: 0.0, trim: 1.0, tag: "Great at dinner" },                // clip 1 from 0.0 s; frozen at 1.8 s
  ];
  const LESS = ["Less great at typing", "Less great at plans", "Less great at trips", "Less great at code"];
  const ROW = [{ bot: "keybot", name: "Keybot", verb: "writes", nameW: [2, 2], verbW: [3, 3], above: false },
    { bot: "plan", name: "Plan", verb: "remembers", nameW: [4, 4], verbW: [5, 5], above: true },
    null,   // the centre place: yours
    { bot: "travel", name: "Travel", verb: "finds", nameW: [6, 6], verbW: [7, 7], above: true },
    { bot: "code", name: "Code bot", verb: "builds", nameW: [8, 9], verbW: [10, 10], above: false }];
  /** A head's outline (head-keybot.png's silhouette with its two antennae, traced; 0..1 of its 144 px box), for the pencil. */
  const OUTLINE = [[0.5052, 0.8942], [0.5694, 0.8832], [0.6389, 0.8595], [0.7153, 0.8183], [0.7853, 0.7517], [0.8173, 0.7014], [0.8234, 0.6615], [0.8341, 0.6285], [0.8325, 0.5538], [0.8127, 0.5191], [0.8014, 0.4878], [0.7587, 0.4222], [0.719, 0.3854], [0.6753, 0.3587], [0.664, 0.3438], [0.6684, 0.3322], [0.7049, 0.3237], [0.722, 0.3073], [0.7258, 0.2812], [0.7222, 0.2224], [0.7118, 0.2086], [0.6927, 0.2021], [0.5712, 0.2034], [0.5503, 0.2151], [0.5372, 0.2326], [0.5296, 0.2517], [0.5253, 0.2882], [0.5156, 0.3016], [0.4774, 0.3099], [0.4132, 0.3077], [0.3861, 0.2865], [0.3753, 0.2674], [0.3767, 0.2552], [0.393, 0.2309], [0.3984, 0.2135], [0.3989, 0.1597], [0.3935, 0.1354], [0.3698, 0.1077], [0.3542, 0.0966], [0.3021, 0.0919], [0.2622, 0.0977], [0.253, 0.1059], [0.247, 0.1215], [0.2457, 0.2882], [0.2576, 0.3299], [0.2568, 0.3385], [0.2448, 0.3554], [0.1944, 0.4056], [0.1806, 0.4158], [0.1545, 0.4252], [0.1424, 0.4372], [0.1331, 0.4896], [0.1168, 0.5139], [0.106, 0.5434], [0.0845, 0.5799], [0.0822, 0.6354], [0.0859, 0.6615], [0.1316, 0.717], [0.1399, 0.7691], [0.1538, 0.7899], [0.1997, 0.8296], [0.2778, 0.8676], [0.3264, 0.8834], [0.3733, 0.893]];

  // the hero: top centre, 700 px, his bar's top at ~0.06h
  const HS = 700, HSC = HS / X0.hang.ART, HX = 540 - X0.hang.MID * HSC, HY = -71;
  const PHOTO_DY = M - (HY + X0.hang.BAR_TOP * HSC);   // over the frozen photograph his bar's top sits on the photograph's top edge
  const YOURS_GAP = 0.34, YOURS_CPS = 32;              // 'in one sentence' types this long after 'Yours', at this rate
  // the team row
  const HD = 136, HOFF = 0.05 * HD, ROW_Y = 868, LBL = 44, RULE_Y = ROW_Y + HD / 2 + 14;

  let L = null;   // measured layout (fonts in): cap ratios, tag sizes, the stack, the row's pitch, the headline

  // ------------------------------------------------------------------------------------------------ the timeline
  function timeline(S) {
    const V = S.V, T = {};
    const heard = (k, i) => (i === 0 ? ON[k] : V[k].words[i].t0 - 0.028);   // when word i is heard, in its file
    T.v1 = 0.05; T.v2 = 2.55;                                   // over the bread and the barber
    T.v3 = snap(T.v2 + OFF.v2 + STOP - ON.v3);                  // under the tail of the dancer
    T.dinner = T.v3 + heard("v3", 4);
    T.fz = SHOTS[4].b;                                          // the cook frozen at clip 1.8 s
    T.v4 = snap(T.fz + 0.42 - ON.v4);
    T.stack = [0, 1, 2, 3].map((i) => snap(T.v4 + ON.v4 + 0.4 * i));   // four tags 0.4 s apart, from "Less"
    T.tagAt = [0.3, 1.6, 2.9, 4.3, snap(T.dinner)];
    T.hero = snap(Math.max(T.fz + 2.0, T.stack[3] + 0.3));      // he swings in on 'rest': the freeze holds the bible's 2.0 s
    T.flick = snap(T.hero + 0.7);
    T.fall = T.flick + F(2);                                    // the top tag kicks for two frames, then everything goes
    T.page = snap(T.fall + 0.47);                               // the scraps are gone, plain paper
    // the portrait line, a sentence at a time, each full stop 0.32 s
    T.p5 = []; T.w5 = []; let on = T.page + 0.12;
    for (const p of P5) {
      const file = on - LEAD, cut = p.on - LEAD; T.p5.push({ k: p.k, file, on, off: on + (p.off - p.on) });
      for (let i = p.w[0]; i < p.w[1]; i++) T.w5[i] = i === p.w[0] ? on : file + (V.v5.words[i].t0 - 0.028 - cut);
      on = on + (p.off - p.on) + STOP;
    }
    T.w5end = (i) => { const p = T.p5.find((q) => i >= P5.find((r) => r.k === q.k).w[0] && i < P5.find((r) => r.k === q.k).w[1]); return p.file + (V.v5.words[i].t1 - (P5.find((r) => r.k === p.k).on - LEAD)); };
    T.pop = [T.w5[2], T.w5[4], null, T.w5[6], T.w5[8]];
    T.lookDown = snap(T.pop[4] + 0.43);
    T.ol0 = T.w5[12]; T.ol1 = T.ol0 + 1.0;                      // the pencil outline, from "one"
    T.yours = T.ol1 + 0.08;
    T.lookBack = snap(T.p5[5].off - 0.1);                       // back to us as the read ends
    T.H = snap(T.p5[5].off + 0.15);                             // the headline writes on as soon as the narrator stops
    T.v6 = T.H + 0.6 - ON.v6;
    T.w6 = V.v6.words.map((w, i) => T.v6 + heard("v6", i));
    T.ul = T.H + 1.0; T.wink = T.H + 2.4;                        // the wink closes before he rides up out of the frame
    T.end = snap(T.H + 3.2);
    T.lift = T.end - F(9);                                      // he rides up out of frame, so the end card's hero is the only one
    T.dur = +(T.end + AD.END_S).toFixed(3);
    measure(S, T);
    return T;
  }

  /** Measure once the fonts are in: cap ratios, the tags, the stack, the row (its pitch kept left of 0.88w), the headline (against 1026 px). */
  function measure(S, T) {
    const { ctx } = S;
    const capOf = (w) => { ctx.save(); ctx.font = X0.font(w, 100); const c = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore(); return c; };
    const cap6 = capOf(600), cap9 = capOf(900);
    const tagG = (text, size) => { const f = X0.font(600, size), tw = X0.width(ctx, text, f); return { text, f, size, cap: cap6 * size, w: Math.round(tw + 2 * 0.04 * 1080), h: Math.round(cap6 * size + 2 * 30) }; };
    const tags = SHOTS.map((s) => tagG(s.tag, 49));                       // 0.045w
    const less = LESS.map((s) => tagG(s, 44));                            // 0.04w, floored at 44 px
    // the stack: 'Great at dinner' at 0.74h, the four straight above it
    const stack = [{ ...tags[4], cy: 0.74 * 1920 }];
    for (const g of less) { const p = stack[stack.length - 1]; stack.push({ ...g, cy: p.cy - p.h / 2 - g.h / 2 - 12 }); }
    // the row: five places, symmetric about the centre, the right-most label ending left of 0.88w
    const fN = X0.font(600, LBL), fV = X0.font(400, LBL);
    const lw = (r) => (r ? Math.max(X0.width(ctx, r.name, fN), X0.width(ctx, r.verb, fV)) : 0);
    const pitch = Math.min(170, Math.floor((0.88 * 1080 - 540 - lw(ROW[4]) / 2 - 4) / 2));
    const xs = [0, 1, 2, 3, 4].map((i) => 540 + (i - 2) * pitch);
    // the headline: two lines, 13 characters, at 0.08w cap (the floor for 13 characters, not the bible's 0.085w) so the centred line also ends left of 0.88w, where the platform's buttons sit;
    // its axis eases left by the few px the longer line still needs
    const hSize = Math.ceil(0.08 * 1080 / cap9), base = [1480 - Math.round(hSize * 1.02), 1480];
    const lay = (x) => [X0.layout(ctx, [{ text: "Each" }, { text: "great" }, { text: "at" }], { x, y: base[0], size: hSize, weight: 900, color: C.ink, align: "center" }),
      X0.layout(ctx, [{ text: "one", hand: true, handWeight: 700, scale: 1.15 }, { text: "thing" }], { x, y: base[1], size: hSize, weight: 900, color: C.ink, align: "center" })];
    let [h1, h2] = lay(540); const hx = Math.min(540, Math.floor(0.88 * 1080 - Math.max(h1.w, h2.w) / 2) - 2); if (hx !== 540) [h1, h2] = lay(hx);
    const fit = [h1.w, h2.w].every((w) => w <= 1026);
    if (!fit) console.warn("headline wider than 1026 px", h1.w, h2.w);
    const small = { f: X0.font(400, 44), y: 1206 };                     // 0.035w ink line, floored at 44 px, above the headline
    L = { cap6, cap9, tags, stack, fN, fV, pitch, xs, hSize, base, h1, h2, fit, small,
      report: `cap ${cap9.toFixed(3)} H ${hSize}px (${h1.w.toFixed(0)}, ${h2.w.toFixed(0)} of 1026, axis ${hx}, right ${(h1.x + h1.w).toFixed(0)}) pitch ${pitch} tags ${tags.map((g) => g.w).join(",")}` };
    T.report = L.report;
  }

  // ------------------------------------------------------------------------------------------------ paper and footage
  function page(S) { const { ctx, A } = S; ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920); X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); }
  /** The dip-pen hairline ruled round the photograph, 12 px out from it (a pen's wander, not a box). */
  function rule(S, a) {
    if (a <= 0) return; const { ctx } = S, r = M - 12, x0 = r, y0 = r, x1 = 1080 - r, y1 = 1920 - r;
    ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = C.ink; ctx.lineCap = "round";
    const side = (ax, ay, bx, by, seed) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 30); ctx.beginPath();
      for (let i = 0; i <= n; i++) { const k = i / n, w = X0.noise1(i * 0.37, seed) * 0.7; const x = lerp(ax, bx, k) + (ay === by ? 0 : w), y = lerp(ay, by, k) + (ay === by ? w : 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.lineWidth = 1.7 + 0.3 * X0.noise1(seed, 3); ctx.stroke(); };
    side(x0, y0, x1, y0, 1); side(x1, y0, x1, y1, 2); side(x1, y1, x0, y1, 3); side(x0, y1, x0, y0, 4);
    ctx.restore();
  }
  /** One shot's picture (footage + its tag), full frame, into ctx (the main one, or a wipe canvas). */
  function shot(S, ctx, i, t) {
    const s = SHOTS[i], S2 = ctx === S.ctx ? S : { ...S, ctx };
    const src = clamp((t - s.a) * (s.speed ?? 1) + s.src0, 0, S.footLen(s.foot) - 0.02);
    if (s.dy) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, 1920); }
    AD.film(S2, S.foot(s.foot, src), { grade: GRADE(0, s.trim), vignette: false, dy: s.dy ?? 0, zoom: s.zoom ?? 1 });
    if (s.feather) {   // the picture's top edge (set down on black) melts into the black over `feather` px: no seam through the bulbs
      const y0 = s.dy, g = ctx.createLinearGradient(0, y0, 0, y0 + s.feather);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.45, "rgba(0,0,0,0.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, y0 - 2, 1080, s.feather + 2);
    }
    if (s.patch) dancePatch(ctx, s.dy ?? 0);
    if (i < 4 && t >= S.T.tagAt[i]) tag(S2, L.tags[i], 540, (s.tagY ?? 0.74) * 1920, { k: fr(t, S.T.tagAt[i], F(3)) });
    if (i === 4 && t >= S.T.tagAt[4]) tag(S2, L.stack[0], 540, L.stack[0].cy, { k: fr(t, S.T.tagAt[4], F(3)) });
  }
  /** Clip 2 carries a small red mark at its left edge over the dark backdrop: a soft dark patch over it (as dance.js). */
  function dancePatch(ctx, dy) {
    const pw = 300, ph = 460, py = 860 + dy, cvs = X0.offscreen(pw, ph), c2 = cvs.getContext("2d");
    const g = c2.createLinearGradient(0, 0, pw, 0); g.addColorStop(0, "rgba(4,5,8,1)"); g.addColorStop(0.6, "rgba(4,5,8,0.97)"); g.addColorStop(1, "rgba(4,5,8,0)"); c2.fillStyle = g; c2.fillRect(0, 0, pw, ph);
    const v = c2.createLinearGradient(0, 0, 0, ph); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.18, "rgba(0,0,0,1)"); v.addColorStop(0.85, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)");
    c2.globalCompositeOperation = "destination-in"; c2.fillStyle = v; c2.fillRect(0, 0, pw, ph);
    ctx.drawImage(cvs, 0, py); X0.release(cvs);
  }
  /** The frozen cook, cold by `cold` (and two degrees bluer), with the window's vignette. */
  function frozen(S, ctx, cold) {
    const S2 = ctx === S.ctx ? S : { ...S, ctx };
    AD.film(S2, S.foot("e", 1.8), { grade: GRADE(cold), vignette: false });
    if (cold > 0) { ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = `rgba(70,110,170,${(0.32 * cold).toFixed(3)})`; ctx.fillRect(0, 0, 1080, 1920); ctx.restore(); }
    X0.vignette(ctx, 1080, 1920, 0.24 + 0.3 * cold);
  }
  const winClip = (ctx) => { ctx.beginPath(); ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h); ctx.clip(); };
  const canv = [];   // two full-frame canvases of our own for the wipes and the scraps
  function canvas(S, i) { const w = Math.round(1080 * S.u), h = Math.round(1920 * S.u); if (!canv[i]) canv[i] = document.createElement("canvas"); const c = canv[i]; if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } const x = c.getContext("2d"); x.setTransform(S.u, 0, 0, S.u, 0, 0); x.globalAlpha = 1; x.filter = "none"; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, 1080, 1920); return c; }
  /** A canvas drawn smeared along x (a whip pan's motion blur): copies every <= 7 px across `blur` px, averaged as they land. */
  function smear(ctx, cv, dx, blur) {
    const n = blur < 3 ? 1 : Math.min(48, Math.ceil(blur / 7) + 1);
    for (let j = 0; j < n; j++) { ctx.save(); ctx.globalAlpha = 1 / (j + 1); ctx.drawImage(cv, dx + (n > 1 ? (j / (n - 1) - 0.5) * blur : 0), 0, 1080, 1920); ctx.restore(); }
  }

  // ------------------------------------------------------------------------------------------------ paper on the film
  /** A paper tag: a torn white scrap sized to its line plus 0.04w a side, two bits of tape, ink Geist; slapped (1.08 -> 1 in 3 f). */
  function tag(S, g, cx, cy, o = {}) {
    const { ctx, A } = S, k = o.k ?? 1, s = 1.08 - 0.08 * E.o3(k);
    ctx.save(); ctx.translate(cx + (o.dx ?? 0), cy + (o.dy ?? 0)); ctx.rotate(o.rot ?? 0); ctx.scale(s, s);
    const x = -g.w / 2, y = -g.h / 2, dw = g.w / 0.975, dh = g.h / 0.942;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 9; ctx.drawImage(A.scrap, x - 0.012 * dw, y - 0.028 * dh, dw, dh); ctx.restore();
    X0.text(ctx, g.text, 0, Math.round(g.cap / 2), g.f, C.ink, "center");
    const tw = 92, th = tw * A.tape.height / A.tape.width;
    for (const sg of [-1, 1]) { ctx.save(); ctx.translate(sg * (g.w / 2 - 10), y + 8); ctx.rotate(sg * 0.5); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore(); }
    ctx.restore();
  }
  /** Torn paper pieces tiling the photograph (3 x 5, shared ragged edges), made once. */
  let PIECES = null;
  function pieces() {
    if (PIECES) return PIECES;
    const cols = 3, rows = 5, V = [];
    for (let r = 0; r <= rows; r++) { V[r] = []; for (let c = 0; c <= cols; c++) { const edgeX = c === 0 || c === cols, edgeY = r === 0 || r === rows;
      V[r][c] = [WIN.x + WIN.w * c / cols + (edgeX ? 0 : (X0.hash(r * 31 + c * 7) - 0.5) * 120), WIN.y + WIN.h * r / rows + (edgeY ? 0 : (X0.hash(r * 17 + c * 13 + 5) - 0.5) * 140)]; } }
    const edges = new Map();
    const edge = (a, b, border) => { const key = a.join() + "|" + b.join(), rk = b.join() + "|" + a.join(); if (edges.has(key)) return edges.get(key); if (edges.has(rk)) return edges.get(rk).slice().reverse();
      const n = 10, pts = []; const nx = -(b[1] - a[1]), ny = b[0] - a[0], nl = Math.hypot(nx, ny) || 1;
      for (let i = 0; i <= n; i++) { const k = i / n, j = border || i === 0 || i === n ? 0 : X0.noise1(i * 1.7 + a[0] * 0.01, (a[1] | 0) % 97) * 9 + (X0.hash(i * 97 + (a[0] | 0)) - 0.5) * 6; pts.push([lerp(a[0], b[0], k) + nx / nl * j, lerp(a[1], b[1], k) + ny / nl * j]); }
      edges.set(key, pts); return pts; };
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = V[r][c], b = V[r][c + 1], d = V[r + 1][c + 1], e = V[r + 1][c];
      const poly = [...edge(a, b, r === 0), ...edge(b, d, c === cols - 1).slice(1), ...edge(d, e, r === rows - 1).slice(1), ...edge(e, a, c === 0).slice(1, -1)];
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const j = r * cols + c;
      out.push({ poly, cx, cy, delay: 0.015 + 0.07 * X0.hash(j * 11 + 3), rot: (X0.hash(j * 5 + 1) - 0.5) * 0.7, dx: (X0.hash(j * 3 + 2) - 0.5) * 120 });
    }
    return (PIECES = out);
  }

  // ------------------------------------------------------------------------------------------------ the hero
  /** His height offset: on the photograph's top edge while it is there, easing to the page's place as the mount dissolves. */
  const heroLift = (T, t) => PHOTO_DY * (1 - E.io(fr(t, T.flick + 0.05, 0.4)));
  /** The right glove's path when it lets go: screen px from its rest, its turn, its grip and its size, at t. */
  function reachAt(T, t) {
    const top = L.stack[4], gx0 = HX + X0.hang.GLOVES[1].cx * HSC, gy0 = HY + heroLift(T, t) + X0.hang.GLOVE_CY * HSC;
    const tx = 540 + top.w / 2 - 34 - gx0, ty = top.cy - top.h * 0.55 - gy0;   // screen px from the glove's rest
    const g0 = T.flick - 0.24, g1 = T.flick - 0.04, g2 = T.flick + 0.07, g3 = T.flick + 0.36, g4 = T.flick + 0.46;
    if (t < g0 || t >= g4) return null;
    let x, y, r, grip = 0;
    if (t < g1) { const k = E.io(fr(t, g0, g1 - g0)); x = tx * k; y = ty * k; r = -28 * k; }
    else if (t < g2) { const k = E.o3(fr(t, g1, g2 - g1)); x = tx - 80 * k; y = ty + 34 * k; r = -28 + 88 * k; }
    else if (t < g3) { const k = E.io(fr(t, g2, g3 - g2)); x = (tx - 80) * (1 - k); y = (ty + 34) * (1 - k); r = 60 * (1 - k); }
    else { x = 0; y = 0; r = 0; grip = 0.16 * E.bump(fr(t, g3, g4 - g3)); }
    const scale = 1 + 0.5 * (t < g2 ? E.io(fr(t, g0, g1 - g0)) : 1 - E.io(fr(t, g2, g3 - g2)));   // 1.5x as it reaches, so it reads on a phone
    return { x, y, r, grip, scale, gx0, gy0, g0, g2, g3, g4 };
  }
  /** Two or three short ink speed lines left along the glove's path (behind it, fading), during the reach and the flick. */
  function speedLines(S, t) {
    const T = S.T, now = reachAt(T, t); if (!now || t > now.g2 + F(5)) return;
    const a = 0.85 * (1 - fr(t, now.g2, F(5))); if (a <= 0) return;
    const P = (tt) => { const q = reachAt(T, tt); return q ? [now.gx0 + q.x, now.gy0 + q.y] : [now.gx0, now.gy0]; };
    const p1 = P(t - F(1.2)), p0 = P(t - F(4)), dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy); if (len < 30) return;
    const nx = -dy / len, ny = dx / len, { ctx } = S;
    ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = C.ink; ctx.lineCap = "round"; ctx.lineWidth = 4;
    [[-20, 0.75], [0, 1], [20, 0.55]].forEach(([off, f]) => { ctx.beginPath(); ctx.moveTo(p1[0] + nx * off, p1[1] + ny * off); ctx.lineTo(p1[0] - dx * f + nx * off, p1[1] - dy * f + ny * off); ctx.stroke(); });
    ctx.restore();
  }
  function heroOpts(S, t) {
    const T = S.T, o = {}; let rot = 0, dy = heroLift(T, t);
    const tau = t - T.hero;
    if (tau < 2) {
      dy += -980 * (1 - E.o3(fr(tau, 0, 0.32)));                               // down from above the top edge
      rot = tau < 1.4 ? -0.3 * Math.cos(Math.PI * tau / 0.4) * Math.exp(-tau * 3.5) : 0;   // a pendulum, settled in one swing
      // his head hangs from the bar and lags the swing: it stays nearer the vertical, a beat late
      o.sway = tau < 1.4 ? 10 * Math.cos(Math.PI * (tau - 0.09) / 0.4) * Math.exp(-Math.max(0, tau - 0.09) * 3.5) : 0;
    }
    // where he looks: at the stack, at his glove, back to us; at the empty place; back to us
    let ex = 0, ey = 0;
    if (t < T.page) { const k = E.io(fr(t, T.hero + 0.42, F(5))); ey = 8 * k; ex = 2 * k; if (t > T.flick - 0.25) { const g = E.io(fr(t, T.flick - 0.25, F(4))); ey = lerp(ey, 11, g); ex = lerp(ex, 5, g); } }
    if (t >= T.flick + 0.2) { const k = E.io(fr(t, T.flick + 0.2, F(6))); ey = lerp(11, 0, k); ex = lerp(5, 0, k); }
    // he looks at each head as it arrives (eyes and a tilt of the whole head toward it), then down at the empty place
    // (eyes right down, the head lowered and tipped toward it), then back to us: big enough to read on a phone
    let sw = 0, peer = 0;
    if (t >= T.pop[0] - F(1) && t < T.lookDown + F(8)) { let px = 0, py = 0, ps = 0;
      for (const i of [0, 1, 3, 4]) { const k = E.io(fr(t, T.pop[i] - F(1), F(5))); if (k <= 0) break; const d = (L.xs[i] - 540) / 310; px = lerp(px, d * 30, k); py = lerp(py, 20, k); ps = lerp(ps, -4 * d, k); }
      ex = px; ey = py; sw = ps; }
    if (t >= T.lookDown) { const k = E.io(fr(t, T.lookDown, F(8))), b = E.io(fr(t, T.lookBack, F(7)));
      ex = lerp(ex, 0, k) * (1 - b); ey = lerp(ey, 34, k) * (1 - b); sw = lerp(sw, 0, k) * (1 - b); peer = k * (1 - b); }
    o.eyes = { dx: ex, dy: ey };
    o.sway = (o.sway || 0) + sw;
    if (peer > 0) o.sq = 1 - 0.035 * peer;
    // blinks (4 f) at moments of stillness
    const blinks = [T.hero + 1.0, T.p5[1].on + 0.5, T.p5[3].on + 0.6, T.H + 1.6];
    o.blink = 0; for (const b of blinks) if (t >= b && t < b + F(5)) o.blink = Math.max(o.blink, E.bump(fr(t, b, F(5))));
    // the wink
    const w = t >= T.wink && t < T.wink + F(14) ? (t < T.wink + F(4) ? fr(t, T.wink, F(4)) : t < T.wink + F(10) ? 1 : 1 - fr(t, T.wink + F(10), F(4))) : 0;
    o.lids = [w, 0]; o.sway = (o.sway || 0) - 2.5 * w;
    o.bob = (t >= T.page ? Math.sin((t - T.page) * 2.2) * 3 : 0) + 8 * peer;
    // the right glove lets go, flies down to the top tag (growing 1.5x), flicks it, comes back and grips
    const g = reachAt(T, t);
    if (g) {
      o.reach = [null, { dx: g.x / HSC, dy: g.y / HSC, rot: g.r, grip: g.grip, scale: g.scale }];
      if (t >= g.g3) o.barDy = 3 * E.bump(fr(t, g.g3, g.g4 - g.g3));
    }
    // the end: he rides up out of the frame before the sheet comes, so only the end card's hero is ever seen
    dy -= 820 * E.i2(fr(t, T.lift, T.end - T.lift));
    return { o, rot, dy };
  }
  function hero(S, t) {
    const T = S.T; if (t < T.hero) return;
    const { o, rot, dy } = heroOpts(S, t), { ctx, A } = S;
    ctx.save();
    const px = 540, py = HY - 900 + dy;   // the pendulum's pivot, high above the frame
    ctx.translate(px, py); ctx.rotate(rot); ctx.translate(-px, -py);
    X0.hang(ctx, A, HX, HY + dy, HS, null, o);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the portrait
  /** Text typed a letter at a time from t0 at cps, centred on cx (laid out from the whole line, so letters never shift). */
  function typed(S, s, cx, y, f, t, t0, cps, color = C.ink) {
    if (t < t0) return; const n = Math.min(s.length, Math.floor((t - t0) * cps) + 1), w = X0.width(S.ctx, s, f);
    X0.text(S.ctx, s.slice(0, n), cx - w / 2, y, f, color);
  }
  const cpsFor = (s, dur) => clamp(s.length / Math.max(dur, 0.05), 14, 30);
  function labelTimes(S, r) {
    const T = S.T, V = S.V.v5, n0 = T.w5[r.nameW[0]], n1 = T.w5end(r.nameW[1]), v0 = T.w5[r.verbW[0]], v1 = T.w5end(r.verbW[1]);
    return { n0, ncps: cpsFor(r.name, n1 - n0), v0, vcps: cpsFor(r.verb, v1 - v0) };
  }
  function headImg(S, im, cx, cy, s) { const { ctx } = S; ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.imageSmoothingQuality = "high"; ctx.drawImage(im, -HD / 2 + HOFF, -HD / 2, HD, HD); ctx.restore(); }
  /** The pencil outline of a head drawing itself (0..k of its length), graphite, two passes; once closed, a faint graphite fill. */
  function pencil(S, cx, cy, k, fill = 0) {
    if (k <= 0) return; const { ctx } = S;
    const pts = OUTLINE.map(([x, y], i) => [cx - HD / 2 + HOFF + x * HD + X0.noise1(i * 0.6, 5) * 1.1, cy - HD / 2 + y * HD + X0.noise1(i * 0.6, 9) * 1.1]);
    pts.push([pts[0][0] + 3, pts[0][1] - 1]);   // the line overruns its start a little, as a pencil does
    const seg = []; let Ltot = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); Ltot += d; }
    const upto = Ltot * clamp(k);
    const path = (ox, oy) => { ctx.beginPath(); ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy); let acc = 0; for (let i = 1; i < pts.length; i++) { if (acc + seg[i - 1] <= upto) { ctx.lineTo(pts[i][0] + ox, pts[i][1] + oy); acc += seg[i - 1]; } else { const f = (upto - acc) / seg[i - 1]; ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], f) + ox, lerp(pts[i - 1][1], pts[i][1], f) + oy); break; } } };
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (fill > 0) { path(0, 0); ctx.closePath(); ctx.fillStyle = `rgba(110,110,110,${(0.06 * clamp(fill)).toFixed(3)})`; ctx.fill(); }
    path(0, 0); ctx.strokeStyle = "#6E6E6E"; ctx.lineWidth = 6; ctx.stroke();
    path(1.2, 0.8); ctx.strokeStyle = "rgba(80,80,80,0.42)"; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }
  function portrait(S, t) {
    const T = S.T, { ctx, A } = S; if (t < T.p5[0].on - 0.05) return;
    // five places: a short dip-pen rule under each, drawn from the centre out on "A team"
    [2, 1, 3, 0, 4].forEach((i, n) => { const k = E.io(fr(t, T.p5[0].on + 0.05 + 0.09 * Math.ceil(n / 2), 0.28)); if (k <= 0) return;
      const w = 104, x0 = L.xs[i] - w / 2; ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x0, RULE_Y); ctx.lineTo(x0 + w * k, RULE_Y + 0.6 * k); ctx.stroke(); ctx.restore(); });
    // the four heads pop on their nouns, each label typed on its words
    ROW.forEach((r, i) => {
      if (!r) return; const at = T.pop[i]; if (t < at) return;
      const k = fr(t, at, F(5)), s = k < 0.4 ? lerp(0.35, 1.14, k / 0.4) : lerp(1.14, 1, (k - 0.4) / 0.6);
      const lt = labelTimes(S, r), cx = L.xs[i], hop = -9 * E.bump(fr(t, lt.v0, F(7)));   // a small hop on its verb
      headImg(S, A[AD.BOT[r.bot].head], L.xs[i], ROW_Y + hop, s);
      if (r.above) { typed(S, r.name, cx, ROW_Y - HD / 2 - 24 - 52, L.fN, t, lt.n0, lt.ncps); typed(S, r.verb, cx, ROW_Y - HD / 2 - 24, L.fV, t, lt.v0, lt.vcps); }
      else { typed(S, r.name, cx, RULE_Y + 50, L.fN, t, lt.n0, lt.ncps); typed(S, r.verb, cx, RULE_Y + 100, L.fV, t, lt.v0, lt.vcps); }
    });
    // the centre place: a pencil outline, then its label
    pencil(S, L.xs[2], ROW_Y, (t - T.ol0) / (T.ol1 - T.ol0), fr(t, T.ol1, F(8)));
    typed(S, "Yours", L.xs[2], RULE_Y + 50, L.fN, t, T.yours, 16);
    typed(S, "in one sentence", L.xs[2], RULE_Y + 100, L.fV, t, T.yours + YOURS_GAP, YOURS_CPS);
  }
  /** The headline in ink on the page, centred: Each great at / one thing, 'one' by hand with the clay underline; and the small line above it. */
  function headline(S, t) {
    const T = S.T, { ctx, A } = S; if (t < T.H) return;
    const size = L.hSize, lines = [L.h1, L.h2];
    lines.forEach((line, i) => {
      const f0 = T.H + i * F(6), k = E.o3(fr(t, f0, F(7))); if (k <= 0) return;
      ctx.save(); ctx.beginPath(); ctx.rect(line.x - 20, L.base[i] - size * 1.3, (line.w + 40) * k, size * 1.75); ctx.clip(); X0.drawLine(ctx, line, (j, w) => (w.hand ? { a: 0 } : { a: 1 })); ctx.restore();
    });
    const hw = L.h2.words[0], kh = E.o3(fr(t, T.H + F(12), F(8)));
    if (kh > 0) { ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, L.base[1] - size * 1.3, (hw.w + 30) * kh, size * 1.8); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore(); }
    const ku = fr(t, T.ul, 0.4);
    if (ku > 0) { const im = A["ul-bar"], uw = hw.w * 1.08, uh = Math.max(24, uw * im.height / im.width * 1.15); X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 10, hw.y + size * 0.1, uw, uh, E.o3(ku), "x", { rot: -0.012, rag: 10, seed: 2 }); }
    // "None of them can cook." typed on his words
    const words = SAY.v6.split(" "), f = L.small.f, full = X0.width(ctx, SAY.v6, f); let x = 540 - full / 2;
    words.forEach((w, i) => { const t0 = T.w6[i], cps = cpsFor(w, (S.V.v6.words[i].t1 - S.V.v6.words[i].t0)); if (t >= t0) X0.text(ctx, w.slice(0, Math.min(w.length, Math.floor((t - t0) * cps) + 1)), x, L.small.y, f, C.ink); x += X0.width(ctx, w + " ", f); });
  }

  // ------------------------------------------------------------------------------------------------ the frame
  function frame(t, S) {
    const T = S.T, { ctx } = S;
    page(S);
    let cold = 0;
    if (t < T.fz) {
      // the census: five mounted portraits, whip-wiped (5 frames, out to the left, in from the right)
      let wipe = null; for (let j = 1; j < SHOTS.length; j++) { const c = SHOTS[j].a; if (t >= c - F(2.5) && t < c + F(2.5)) wipe = j; }
      ctx.save(); winClip(ctx);
      if (wipe == null) { const i = SHOTS.findIndex((s) => t >= s.a && t < s.b); shot(S, ctx, i < 0 ? 0 : i, t); }
      else {
        const c = SHOTS[wipe].a, k = (t - (c - F(2.5))) / F(5), off = WIN.w * E.io(k), vel = WIN.w * (E.io(k + 0.05) - E.io(k - 0.05)) / 0.1 * 0.2;   // px a frame
        const a = canvas(S, 0), b = canvas(S, 1); shot(S, a.getContext("2d"), wipe - 1, t); shot(S, b.getContext("2d"), wipe, t);
        smear(ctx, a, -off, vel * 0.5);
        ctx.save(); ctx.beginPath(); ctx.rect(WIN.x + WIN.w - off - vel * 0.25, 0, 2200, 1920); ctx.clip(); smear(ctx, b, WIN.w - off, vel * 0.5); ctx.restore();
      }
      X0.vignette(ctx, 1080, 1920, 0.24);
      ctx.restore();
      rule(S, 1);
    } else if (t < T.page) {
      cold = E.o3(fr(t, T.fz, F(6)));
      const falling = t >= T.flick;
      ctx.save(); winClip(ctx);
      if (!falling) { frozen(S, ctx, cold); if (t < T.fz + F(1)) { ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(0, 0, 1080, 1920); } }
      ctx.restore();
      if (falling) {   // the frame comes apart into torn scraps that slide off the bottom
        const cv = canvas(S, 0), c2 = cv.getContext("2d"); c2.save(); winClip(c2); frozen(S, c2, 1); c2.restore();
        for (const p of pieces()) {
          const k = fr(t, T.fall + p.delay, 0.36), e = E.i2(k), dy = e * (2000 - p.cy + 200), rot = p.rot * e, dx = p.dx * e;
          if (dy > 2300) continue;
          ctx.save(); ctx.translate(p.cx + dx, p.cy + dy); ctx.rotate(rot); ctx.translate(-p.cx, -p.cy);
          ctx.beginPath(); p.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
          if (k > 0) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8; ctx.strokeStyle = "#FBFBF8"; ctx.lineWidth = 5; ctx.stroke(); ctx.restore(); }
          ctx.clip(); ctx.drawImage(cv, 0, 0, 1080, 1920); ctx.restore();
        }
      }
      // the stack: 'Great at dinner' and the four above it, 0.4 s apart; they go first when he flicks
      L.stack.forEach((g, i) => {
        const at = i === 0 ? T.tagAt[4] : T.stack[i - 1]; if (t < at) return;
        let dy = 0, rot = 0, dx = 0;
        if (i === 4 && falling) { const kk = E.o3(fr(t, T.flick, F(2))); rot += 0.14 * kk; dy -= 20 * kk; }   // his glove's kick: the top tag jumps (+8 deg, 20 px up) before the fall
        if (t >= T.fall) { const k = fr(t, T.fall + 0.03 * (4 - i), 0.36), e = E.i2(k); dy += e * (2100 - g.cy); rot += (i % 2 ? 1 : -1) * (0.15 + 0.08 * i) * e; dx = (i % 2 ? -1 : 1) * 40 * e; }
        tag(S, g, 540, g.cy, { k: fr(t, at, F(3)), dy, rot, dx });
      });
      rule(S, 1 - E.io(fr(t, T.flick + 0.05, 0.4)));
    }
    portrait(S, t);
    headline(S, t);
    speedLines(S, t);
    if (t < T.end) hero(S, t);   // he has ridden up out of frame by T.end: one hero, never two
    X0.grain(ctx, 1080, 1920, t, t < T.page ? 0.07 + 0.05 * cold : 0.03, 1);
    AD.endCard(S, t, T.end);
    markGap(S, t);
    if (S.q.get("hud")) { X0.text(ctx, L.report, 360, 1900, X0.font(500, 20, "GeistMono"), "#ff6060");
      X0.text(ctx, `hero ${T.hero.toFixed(2)} flick ${T.flick.toFixed(2)} page ${T.page.toFixed(2)} pops ${T.pop.filter((p) => p != null).map((p) => p.toFixed(2)).join(",")} look ${T.lookDown.toFixed(2)}-${T.lookBack.toFixed(2)} ol ${T.ol0.toFixed(2)} H ${T.H.toFixed(2)} wink ${T.wink.toFixed(2)} end ${T.end.toFixed(2)} dur ${T.dur}`, 16, 1872, X0.font(500, 18, "GeistMono"), "#ff6060"); }
  }
  /**
   * The end card's painted X0 (AD.markPaint, mark at 80,740, 460 wide) lets two slivers of the X's right tips into the 0's
   * region (it clips the 0 at 0.52 before squeezing it 0.74 about 0.76, which pulls source x 0.436-0.457 into x 319-327).
   * The X's ink ends at x 290 and the squeezed 0's starts at x 342, so the strip between is repainted with the sheet's own
   * paper, riding the sheet's slide. A local patch until the kit's markPaint clips after the squeeze.
   */
  function markGap(S, t) {
    const T = S.T; if (t < T.end) return; const { ctx, A } = S, sdy = (1 - E.o5(fr(t, T.end, F(14)))) * 1920;
    ctx.save(); ctx.translate(0, sdy); ctx.beginPath(); ctx.rect(296, 736, 42, 292); ctx.clip();
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(296, 736, 42, 292); X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 });
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the sound
  function cues(S) {
    const T = S.T, c = [];
    // the bed: a drone in C and the light pulse at 120 bpm with hats, both dead at the freeze
    c.push({ at: 0, kind: "drone", f: 65.41, dur: T.fz + 0.35, gain: 0.32, a: 0.6, r: 0.35 });
    for (let t = 0; t < T.fz - 0.01; t += 0.5) { c.push({ at: t, kind: "pulse", gain: 0.36 }); c.push({ at: t + 0.25, kind: "tick", gain: 0.16 }); }
    // the census: a swish on each wipe, a boom and a paper slap on each tag
    for (let j = 1; j < SHOTS.length; j++) c.push({ at: SHOTS[j].a - F(3), kind: "whoosh", dur: 0.22, up: true, gain: 0.42 });
    T.tagAt.forEach((at, i) => { c.push({ at, kind: "boom", gain: i === 3 ? 0.56 : 0.44, dur: 1.2 }, { at, kind: "paper-thud", gain: 0.5 }); });
    c.push({ at: SHOTS[4].a - 0.3, kind: "fan", dur: T.page + 0.25 - (SHOTS[4].a - 0.3), gain: 0.85 });   // the hood hum, under the cook, gone with the page
    // the freeze, and four dry smaller booms on the stack
    c.push({ at: T.fz, kind: "freeze", gain: 0.7 });
    for (const at of T.stack) c.push({ at, kind: "boom", gain: 0.3, dur: 0.5, f0: 78, f1: 46 }, { at, kind: "paper-thud", gain: 0.45 });
    // the hero: a creak as the bar takes him, one tiny bell; the glove's whoosh; the rustle of the scraps
    c.push({ at: T.hero + 0.26, kind: "sample", file: "03-sfx/creak.wav", gain: 0.55 }, { at: T.hero + 0.5, kind: "bell", f: 1318.5, dur: 0.6, gain: 0.16 });
    c.push({ at: T.flick - 0.24, kind: "whoosh", dur: 0.22, up: false, gain: 0.22 }, { at: T.flick, kind: "paper-thud", gain: 0.3 }, { at: T.fall, kind: "sample", file: "03-sfx/rustle.wav", gain: 0.8 }, { at: T.flick + 0.36, kind: "click", gain: 0.25 });
    // the portrait: silence but the narrator; a bell in each bot's note on its pop; a tick a typed letter; the grey bell and the pencil
    ROW.forEach((r, i) => { if (!r) return; c.push({ at: T.pop[i], kind: "bell", f: AD.BOT[r.bot].note, dur: 1.5, gain: 0.42 });
      const lt = labelTimes(S, r); for (let n = 0; n < r.name.length; n++) if (r.name[n] !== " ") c.push({ at: lt.n0 + n / lt.ncps, kind: "key", gain: 0.12 });
      for (let n = 0; n < r.verb.length; n++) c.push({ at: lt.v0 + n / lt.vcps, kind: "key", gain: 0.12 }); });
    c.push({ at: T.ol0, kind: "bell", f: 659.25, dur: 1.4, gain: 0.2 }, { at: T.ol0, kind: "sample", file: "03-sfx/pencil.wav", gain: 0.3 });
    for (let n = 0; n < 5; n++) c.push({ at: T.yours + n / 16, kind: "key", gain: 0.12 });
    for (let n = 0; n < 15; n++) if ("in one sentence"[n] !== " ") c.push({ at: T.yours + YOURS_GAP + n / YOURS_CPS, kind: "key", gain: 0.1 });
    // the headline: a warm chord in C from its first line; ticks as the lines write on; the pen on 'one'; the brush swish
    c.push({ at: T.H, kind: "chord", f: 130.81, dur: T.end - T.H + 1.2, gain: 0.42 });
    c.push({ at: T.H, kind: "tick", gain: 0.3 }, { at: T.H + F(6), kind: "tick", gain: 0.3 }, { at: T.H + F(12), kind: "sample", file: "03-sfx/pen.wav", gain: 0.35 }, { at: T.ul, kind: "whoosh", dur: 0.3, up: false, gain: 0.3 });
    SAY.v6.split(" ").forEach((w, i) => { const cps = cpsFor(w, S.V.v6.words[i].t1 - S.V.v6.words[i].t0); for (let n = 0; n < w.length; n++) if (/[a-z]/i.test(w[n])) c.push({ at: T.w6[i] + n / cps, kind: "key", gain: 0.1 }); });
    c.push({ at: T.wink, kind: "sample", file: "03-sfx/tock.wav", gain: 0.4 });
    c.push({ at: T.lift, kind: "sample", file: "03-sfx/creak.wav", gain: 0.4 }, { at: T.lift + 0.05, kind: "whoosh", dur: 0.3, up: true, gain: 0.18 });   // he rides up out of frame
    // the voice
    c.push({ at: T.v1, kind: "sample", file: "../voice/03-1.wav", gain: 1 }, { at: T.v2, kind: "sample", file: "../voice/03-2.wav", gain: 1 },
      { at: T.v3, kind: "sample", file: "../voice/03-3.wav", gain: 1 }, { at: T.v4, kind: "sample", file: "../voice/03-4.wav", gain: 1 });
    for (const p of T.p5) c.push({ at: p.file, kind: "sample", file: `../voice/03-5${p.k}.wav`, gain: 1 });
    c.push({ at: T.v6, kind: "sample", file: "../voice/03-6.wav", gain: 1 });
    // the end card's cues as built, moved down a whole step from D into this spot's C (its chord sustains in the spot's key)
    return [...c, ...AD.endCues(T.end).map((q) => (q.f ? { ...q, f: +(q.f * 130.81 / 146.83).toFixed(2) } : q))];
  }

  AD.start({
    footage: { a: { dir: "../footage-03-a/", frames: 38, fps: 30 }, b: { dir: "../footage-03-b/", frames: 51, fps: 30 }, c: { dir: "../footage-03-c/", frames: 50, fps: 30 },
      d: { dir: "../footage-03-d/", frames: 161, fps: 72 }, e: { dir: "../footage-03-e/", frames: 140, fps: 72 } },
    assets: { scrap: "components/scrap-blank-3.png" },
    voices: { v1: "../voice/03-1.json", v2: "../voice/03-2.json", v3: "../voice/03-3.json", v4: "../voice/03-4.json", v5: "../voice/03-5.json", v6: "../voice/03-6.json" },
    scripts: SAY,
    timeline, duration: (S) => S.T.dur, frame, cues,
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
