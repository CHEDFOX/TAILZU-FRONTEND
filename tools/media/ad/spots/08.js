/* IN ONE SENTENCE (spot 08): make your own bot; the team grows.
 *
 * Night. A hallway door, dark until the lamp clicks on at 0.3 and the hour types itself. Cut to running shoes on the
 * floor, laces loose, held still: she says, in one tired plain sentence, the bot she wishes someone would build her, and
 * her words write themselves on the dark floor (Caveat on her word times, a pen scratch a word). At 8.4 the handwriting
 * lifts off the footage, the frame bleaches to white paper and the sentence settles at the top in ink over a dip-pen
 * rule. Below it a pencil traces a dotted head, it fills ink, two cream eyes open: Coach, yours. The team slides in from
 * the left with the centre seat empty (labels alternate above and below the row so they never touch), Coach glides up
 * into it, 'yours' becomes 'reminds'; the hero lowers in on his bar, looks along the row to the new one and nods. Coach's
 * first note tapes on, typed: Tonight / Tomorrow. Hard cut to a runner at dawn, small, from behind: 'Your own bot /
 * in a sentence', 'a' by hand, the clay underline under 'a sentence'. The campaign's end card; the hero winks.
 *
 * Footage (prep.mjs, real speed, no interpolation; one warm-grey grade for all three: contrast up, colour down, and a
 * "color" layer that puts every shot on the same low-chroma warm grey, the lamp's pool and the dawn horizon left warm):
 *   ../footage-08-a/  Coverr 9667, 12.0-13.6 s, the empty hallway and open door (30 fps); one frame held (locked), and
 *                     the shoe below keyed out and laid twice on the corridor floor outside the door: shoes by the door
 *   ../footage-08-b/  Coverr 5259, 0.4-1.4 s, the shoe, letterboxed (--fit contain) so the whole shoe fits; one frame held,
 *                     punched in 115 % on the laces
 *   ../footage-08-g/  Coverr 6949, 13.2-15.8 s, the runner on the salt flat at dawn, letterboxed wide (--fit contain) and
 *                     opened to full height (its sky and ground carried out) so the figure stays small; two far walkers
 *                     on the horizon covered with the ground beside them (30 fps)
 * Voice: en-IN Neerja at -5 % (voice/08-1.wav), its beat after "calendar" opened to 0.55 s by spots/08-sound.mjs
 * (voice/08-1p.wav + .json). Sound: sound.mjs kinds plus spots/08-sfx/ (`node spots/08-sound.mjs sfx`).
 */
(function () {
  "use strict";
  const { C, E, clamp } = X0;
  const { F, fr, lerp } = AD;

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    lamp: 0.3, time: 0.6, cut: 1.2, vo: 1.2,
    lift: 8.4, rule: 8.74,
    coach: 9.0, fill: 10.22, eyes: 10.5, label: 10.78,
    shrink: 11.5, row: 12.0, glide: 12.62, relabel: 12.92, hero: 12.78, look: 13.3, nod: 14.06,   // Coach has stepped down clear of the row's band before it slides in
    card: 14.5, type1: 14.68, type2: 14.68 + 28 / 30,   // typing starts as the tape settles; 2 frames between the lines
    run: 17.5, l1: 17.7, l2: 18.1, hand: 18.3, ul: 18.6,
    end: 19.5,
  };
  const DUR = T.end + AD.END_S;   // 24.4: the bible's 24 s with the kit's 4.9 s card from 19.5
  const COACH_BLINKS = [11.62, 14.46, 16.4];
  const HERO_BLINKS = [13.16, 15.72, 17.0];

  const SCRIPT = "A bot that plans my workouts around my calendar and reminds me the night before.";
  const LINES = [[0, 6], [6, 9], [9, 12], [12, 15]];            // four lines, broken where she breathes
  const CAP = { size: 65, x: 86, base: [1166, 1250, 1334, 1418] }; // white on the floor, 0.58h-0.78h
  const PAPER = { cx: 540, base: [338, 414, 490, 566] };           // ink on paper, the top band from 0.15h (under the hero, clear of the platform's top bar)

  // the row: five seats symmetric about the centre, 162 apart, heads 136; Plan's and Travel's labels sit above the row,
  // Keybot's, Coach's and Code bot's below (at 0.035w, 'remembers' beside 'reminds' would touch at any pitch that keeps
  // 'Code bot' left of 0.88w)
  const ROW = { y: 980, size: 136, xs: [216, 378, 540, 702, 864] };
  const TEAM = [
    { key: "keybot", seat: 0, name: "Keybot", verb: "writes", above: false, note: 293.66 },
    { key: "plan", seat: 1, name: "Plan", verb: "remembers", above: true, note: 369.99 },
    { key: "travel", seat: 3, name: "Travel", verb: "finds", above: true, note: 440 },
    { key: "code", seat: 4, name: "Code bot", verb: "ships", above: false, note: 493.88 },
  ];
  TEAM.forEach((b, j) => { b.hop = T.row + F(12) + j * F(3); });   // the row slides in as one; then each bot hops once, on its bell, in roster order
  const LABEL = { name: X0.font(600, 38), verb: X0.font(400, 38) };  // 0.035w, ink

  // the hero hangs lower and a little smaller: his bar's top at y 92 and his eyes near 0.09h, below the platforms' top tabs
  const HERO = { size: 350, x: 540 - 175, y: -1 };
  const CARD = { w: 761, h: 288, y: 1212, pad: 43, size: 44 };      // 0.705w: the longer line at 44 px + 0.04w a side
  const CARD_LINES = ["Tonight: shoes by the door", "Tomorrow 7:00, before your 9:00"];
  const HEAD = { size: 122, x: 86, base: [1328, 1459] };            // 0.08w cap height, baseline 0.76h

  // ------------------------------------------------------------------------------------------------ the grade (one, all footage)
  const GRADE = (b, sat = 0.64) => `contrast(1.12) saturate(${sat}) brightness(${b.toFixed(3)})`;
  /** The spot's one warm grey: a "color" layer that keeps each pixel's lightness and gives it this low-chroma warm hue
   *  (hue about 30 deg). `g` is a gradient (or colour) whose alpha says how much: the lamp's pool and the dawn sky keep
   *  their warmth, everything else lands on the same grey. */
  const WARM_GREY = [126, 120, 114];
  const wg = (a) => `rgba(${WARM_GREY.join(",")},${a.toFixed(3)})`;
  function tone(S, fill) { const { ctx } = S; ctx.save(); ctx.globalCompositeOperation = "color"; ctx.fillStyle = fill; ctx.fillRect(0, 0, 1080, 1920); ctx.restore(); }
  /** The footage with the spot's warm-grey grade: contrast up, a third of the colour out, a warm paper tone, a soft warm light. */
  function shot(S, img, o = {}) {
    const { ctx } = S;
    AD.film(S, img, { grade: GRADE(o.bright ?? 1, o.sat), zoom: o.zoom ?? 1, dx: o.dx ?? 0, dy: o.dy ?? 0, vignette: false });
    if (o.extend) {   // a letterboxed frame opened to the full height: its top row carried up into sky, its bottom row down into ground
      const [a, b] = o.extend, ext = (sy, y0, y1, fade0, fade1) => {   // a row stretched over y0..y1, faded out across the join
        const h = y1 - y0, cv = X0.offscreen(1080, h), c = cv.getContext("2d");
        c.filter = "blur(10px)"; c.drawImage(img, 0, sy, 1080, 3, -30, -30, 1140, h + 60); c.filter = "none";
        const g = c.createLinearGradient(0, fade0 - y0, 0, fade1 - y0); g.addColorStop(0, "#000"); g.addColorStop(1, "rgba(0,0,0,0)");
        c.globalCompositeOperation = "destination-in"; c.fillStyle = g; c.fillRect(0, 0, 1080, h);
        ctx.save(); ctx.filter = GRADE(o.bright ?? 1, o.sat); ctx.drawImage(cv, 0, y0); ctx.restore(); X0.release(cv);
      };
      ext(a + 3, 0, a + 40, a, a + 40); ext(b - 6, b - 40, 1920, b, b - 40);
    }
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgb(255,241,226)"; ctx.fillRect(0, 0, 1080, 1920);
    ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = `rgba(255,168,104,${o.warm ?? 0.14})`; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
  }
  function glow(S, x, y, r, rgba, mode = "screen") {
    const { ctx } = S, g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba); g.addColorStop(1, rgba.replace(/[\d.]+\)$/, "0)"));
    ctx.save(); ctx.globalCompositeOperation = mode; ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
  }
  /** Darkness everywhere but a pool around (x, y): the light falls off as a lamp's does. */
  function pool(S, x, y, r0, r1, a, sy = 1) {
    const { ctx } = S; ctx.save(); ctx.translate(x, y); ctx.scale(1, sy);
    const g = ctx.createRadialGradient(0, 0, r0, 0, 0, r1); g.addColorStop(0, "rgba(6,5,4,0)"); g.addColorStop(0.55, `rgba(6,5,4,${a * 0.6})`); g.addColorStop(1, `rgba(6,5,4,${a})`);
    ctx.fillStyle = g; ctx.fillRect(-1200, -1200 / sy, 2400, 2400 / sy); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the night: door, then shoes
  const SHOE = { frame: 22, zoom: 1.12, dx: 6, dy: -295, px: (x) => -58.8 + x * 1.12, py: (y) => -15.4 + y * 1.12, punch: { x: 700, y: 560, s: 1.15 } };
  const DOOR = { src: 0.6 };   // one frame of the doorway held for the whole 1.2 s (the plate's handheld creep is gone); the lamp is the only move
  // the same pair of shoes left outside the open door, on the corridor floor in the lamp's pool (back shoe first)
  const PAIR = [{ x: 500, y: 1622, w: 280, b: 0.36 }, { x: 330, y: 1652, w: 310, b: 0.42 }];
  let CUT = null;
  /** The shoe keyed out of footage-08-b's held frame: its body and sole inside a feathered ellipse, the trouser above
   *  faded off, the heel's stripe painted down. Its pale floor is matched to the corridor's by exposure, so the edge melts. */
  function shoeCut(S) {
    if (CUT) return CUT;
    const src = S.foot("shoe", SHOE.frame / 25), w = 980, h = 440, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d"); c.drawImage(src, 40, 860, w, h, 0, 0, w, h);
    c.save(); c.filter = "blur(12px)"; c.fillStyle = "rgb(30,29,32)"; c.beginPath(); c.ellipse(842, 120, 52, 96, 0, 0, Math.PI * 2); c.fill(); c.restore();
    // a key: the pale floor (lightness above ~0.5) goes clear, except inside the white sole's band, which is the shoe
    const d = c.getImageData(0, 0, w, h), px = d.data, m = document.createElement("canvas"); m.width = w; m.height = h;
    const mc = m.getContext("2d"), md = mc.createImageData(w, h);
    for (let i = 0, n = w * h; i < n; i++) {
      const X = (i % w) + 40, Y = ((i / w) | 0) + 860, L = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
      md.data[i * 4 + 3] = 255 * (X > 380 && X < 900 && Y > 1100 && Y < 1246 ? 1 : clamp((155 - L) / 30));
    }
    mc.putImageData(md, 0, 0);
    // and the shoe's own outline (source px): the collar where the trouser starts at y 885, the toe and its loose lace at left, the heel at x 925, the sole's dark edge at y 1258
    const OUT = [[300, 894], [420, 886], [560, 882], [650, 892], [720, 914], [780, 932], [840, 922], [888, 900], [914, 904], [928, 950], [926, 1100], [912, 1122], [876, 1160], [866, 1200], [832, 1234], [798, 1256], [84, 1256], [62, 1214], [76, 1150], [118, 1062], [156, 1012], [180, 994], [202, 964], [226, 934], [250, 906]];
    mc.globalCompositeOperation = "destination-in"; mc.filter = "blur(9px)"; mc.fillStyle = "#000"; mc.beginPath();
    OUT.forEach(([x, y], i) => (i ? mc.lineTo(x - 40, y - 860) : mc.moveTo(x - 40, y - 860))); mc.closePath(); mc.fill();
    c.globalCompositeOperation = "destination-in"; c.filter = "blur(1.5px)"; c.drawImage(m, 0, 0); c.filter = "none";
    return (CUT = { cv, w, h });
  }
  function shoesByDoor(S, bright) {
    const { ctx } = S, cut = shoeCut(S);
    for (const p of PAIR) {
      const h = p.w * cut.h / cut.w;
      ctx.save(); ctx.filter = "blur(12px)"; ctx.fillStyle = `rgba(4,3,2,${0.75 * bright})`; ctx.beginPath(); ctx.ellipse(p.x + p.w * 0.47, p.y + h * 0.9, p.w * 0.52, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.save(); ctx.filter = `${GRADE(bright * p.b, 0.5)} sepia(0.35) blur(2px)`; ctx.drawImage(cut.cv, p.x, p.y, p.w, h); ctx.restore();
    }
  }
  function night(S, t) {
    const { ctx } = S;
    if (t < T.cut) {
      // the hallway: near-dark, then the lamp clicks on (exposure up over 4 frames). The lamp sits out of frame low left;
      // its warm pool falls on the open door and the shoes outside it, and only there: the rest is the spot's warm grey.
      const k = fr(t, T.lamp, F(4)), bright = lerp(0.3, 0.94, k);
      shot(S, S.foot("door", DOOR.src), { bright, sat: 0.38, warm: 0.06 + 0.04 * k });
      shoesByDoor(S, bright);
      const tg = ctx.createRadialGradient(470, 1660, 160, 470, 1660, 640); tg.addColorStop(0, wg(0.3 + 0.5 * (1 - k))); tg.addColorStop(1, wg(0.92)); tone(S, tg);
      if (k > 0) glow(S, 470, 1690, 560, `rgba(255,176,104,${(0.2 * k).toFixed(3)})`);
      pool(S, 470, 1240, 420, 1300, 0.45 + 0.35 * (1 - k), 1.15);
    } else {
      // the shoes, held, punched in 115 % on the laces: the whole shoe from a letterboxed frame, the brand's stripe painted down, a lamp's pool
      const P = SHOE.punch;
      ctx.save(); ctx.translate(P.x, P.y); ctx.scale(P.s, P.s); ctx.translate(-P.x, -P.y);
      shot(S, S.foot("shoe", SHOE.frame / 25), { zoom: SHOE.zoom, dx: SHOE.dx, dy: SHOE.dy, bright: 0.86, warm: 0.2 });
      ctx.save(); ctx.filter = "blur(16px)"; ctx.fillStyle = "rgba(26,25,26,0.92)";
      ctx.beginPath(); ctx.ellipse(SHOE.px(872), SHOE.py(612), 96, 168, -0.12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(SHOE.px(930), SHOE.py(560), 50, 90, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      glow(S, 1010, 300, 640, "rgba(255,172,100,0.2)");
      glow(S, 560, 820, 420, "rgba(255,206,160,0.10)");   // the lamp's light on the shoe itself, so it is the thing you see
      pool(S, 560, 720, 240, 900, 0.94, 1.1);
      ctx.restore();
      // the pale wall and the trouser's edge top left burned down by half, so the sole is the brightest thing in the frame
      ctx.save(); ctx.translate(170, 400); ctx.scale(1, 1.6); const gb = ctx.createRadialGradient(0, 0, 80, 0, 0, 470);
      gb.addColorStop(0, "rgba(6,5,4,0.8)"); gb.addColorStop(0.6, "rgba(6,5,4,0.66)"); gb.addColorStop(1, "rgba(6,5,4,0)"); ctx.fillStyle = gb; ctx.fillRect(-500, -500, 1000, 1000); ctx.restore();
      tone(S, wg(0.35));
      AD.scrim(S, 0, 460, 0.55);
      // the floor runs out into the dark below the shoe (the letterboxed frame's edge is never seen), so her words sit on black-brown
      const g = ctx.createLinearGradient(0, 1050, 0, 1300); g.addColorStop(0, "rgba(6,5,4,0)"); g.addColorStop(0.45, "rgba(6,5,4,0.62)"); g.addColorStop(1, "rgba(6,5,4,1)");
      ctx.fillStyle = g; ctx.fillRect(0, 1050, 1080, 281); ctx.fillStyle = "rgb(6,5,4)"; ctx.fillRect(0, 1330, 1080, 600);
    }
    X0.vignette(ctx, 1080, 1920, 0.32);
  }
  /** The hour, typed (a tick a letter), small white Geist at 0.12h; it stays through the night. */
  function hour(S, t, alpha) {
    const s = "10:52 pm", n = Math.min(s.length, Math.floor((t - T.time) * 30) + 1); if (n <= 0 || alpha <= 0) return;
    AD.onFilm(S, s.slice(0, n), CAP.x, 262, X0.font(400, 38), "rgba(255,255,255,0.9)", "left", alpha);   // 0.035w
  }

  // ------------------------------------------------------------------------------------------------ her sentence
  let LAY = null;
  function layout(S) {
    if (LAY) return LAY;
    const { ctx } = S, f = X0.font(700, CAP.size, "Caveat"), words = S.V.vo.words;
    ctx.save(); ctx.font = f; const sp = ctx.measureText(" ").width;
    const out = [];
    LINES.forEach(([a, b], li) => {
      let w = 0; const ws = [];
      for (let i = a; i < b; i++) { const ww = ctx.measureText(words[i].text).width; ws.push([i, ww]); w += ww + (i < b - 1 ? sp : 0); }
      let fx = CAP.x, px = PAPER.cx - w / 2;
      for (const [i, ww] of ws) { out[i] = { i, text: words[i].text, ww, fx, fy: CAP.base[li], px, py: PAPER.base[li], t0: words[i].t0, jy: (X0.hash((words[i].t0 * 1000) | 0) - 0.5) * 3, rot: (X0.hash((words[i].t1 * 977) | 0) - 0.5) * 0.03 }; fx += ww + sp; px += ww + sp; }
    });
    ctx.restore();
    return (LAY = { f, words: out });
  }
  /** The sentence: written on the floor on her word times; at 8.4 each word lifts, travels to the paper and turns ink. */
  function sentence(S, t, paperK) {
    const { ctx } = S, L = layout(S), size = CAP.size;
    for (const w of L.words) {
      const ts = T.vo + w.t0 - 0.05; if (t < ts) continue;
      const kw = E.o3(fr(t, ts, F(4)));
      const kl = E.o3(fr(t, T.lift + w.i * F(0.3), F(12))), bump = E.bump(kl);
      const x = lerp(w.fx, w.px, kl), y = lerp(w.fy, w.py, kl) - 22 * bump + w.jy, sc = 1 + 0.06 * bump;
      const ink = clamp((paperK - 0.4) / 0.25);
      ctx.save(); ctx.beginPath(); ctx.rect(x - 10, y - size * 1.1, (w.ww + 20) * kw * sc, size * 1.7); ctx.clip();
      ctx.translate(x, y); ctx.rotate(w.rot); ctx.scale(sc, sc);
      if (ink < 1) AD.onFilm(S, w.text, 0, 0, L.f, "rgba(255,255,255,0.94)", "left", 1 - ink);
      if (ink > 0) { ctx.save(); ctx.globalAlpha *= ink; ctx.shadowColor = `rgba(0,0,0,${0.22 * bump})`; ctx.shadowBlur = 14; ctx.shadowOffsetY = 8 * bump; X0.text(ctx, w.text, 0, 0, L.f, C.ink); ctx.restore(); }
      ctx.restore();
    }
  }
  /** The dip-pen hairline under the sentence, drawn left to right, swelling where the nib pressed. */
  function rule(S, t) {
    const k = E.io(fr(t, T.rule, F(9))); if (k <= 0) return;
    const { ctx } = S, x0 = 380, x1 = 700, y = 624, xe = lerp(x0, x1, k), top = [], bot = [];
    for (let x = x0; x <= xe + 0.1; x += 3) { const u = (x - x0) / (x1 - x0), w = 0.7 + 1.1 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7 + 0.25 * X0.noise1(x / 26, 5), yy = y + 1.2 * X0.noise1(x / 110, 9); top.push([x, yy - w / 2]); bot.push([x, yy + w / 2]); }
    ctx.save(); ctx.fillStyle = C.ink; ctx.beginPath(); top.forEach(([x, yy], i) => (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy))); for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ Coach, the new one
  let ART = null;
  /** Coach's pictures, made once from a bot's dotted head: the ink head (the colour to ink, the white dots to the hero's
   *  dark face grey) and its pencil outline (the silhouette grown by a few px, the silhouette cut out, grained). */
  function coachArt(S) {
    if (ART) return ART;
    const n = 576, pad = 24, src = S.A["head-plan"];
    const ink = X0.offscreen(n, n); const c = ink.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(src, 0, 0, n, n);
    const d = c.getImageData(0, 0, n, n), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const m = Math.min(p[i], p[i + 1], p[i + 2]), wv = clamp((m - 70) / 150); p[i] = lerp(12, 58, wv); p[i + 1] = lerp(11, 55, wv); p[i + 2] = lerp(10, 52, wv); }
    c.putImageData(d, 0, 0);
    const inkC = document.createElement("canvas"); inkC.width = inkC.height = n; inkC.getContext("2d").drawImage(ink, 0, 0); X0.release(ink);
    const sil = X0.tint(src, "#000000"), o = document.createElement("canvas"); o.width = o.height = n + 2 * pad;
    const oc = o.getContext("2d"); oc.imageSmoothingEnabled = false;
    const gray = X0.tint(src, "#7C7A76");
    for (let a = 0; a < 16; a++) oc.drawImage(gray, pad + Math.cos(a / 16 * Math.PI * 2) * 8, pad + Math.sin(a / 16 * Math.PI * 2) * 8, n, n);
    oc.globalCompositeOperation = "destination-out"; oc.drawImage(sil, pad - 1, pad - 1, n + 2, n + 2);
    const r = X0.rng(31); for (let i = 0; i < 2600; i++) { oc.globalAlpha = 0.35 + 0.4 * r(); oc.fillRect(r() * (n + 2 * pad), r() * (n + 2 * pad), 2 + 3 * r(), 1.5); }
    return (ART = { ink: inkC, outline: o, n, pad });
  }
  /** Coach at (cx, cy), `size` px: pencil outline (k), the ink fill (k, bottom up), the hero's cream eyes (sx, sy, look). */
  function drawCoach(S, cx, cy, size, o = {}) {
    const { ctx, A } = S, art = coachArt(S), x = cx - size / 2, y = cy - size / 2, s = size / art.n;
    if ((o.outline ?? 1) > 0 && (o.outlineA ?? 1) > 0) X0.reveal(ctx, art.outline, x - art.pad * s, y - art.pad * s, (art.n + 2 * art.pad) * s, (art.n + 2 * art.pad) * s, o.outline ?? 1, "conic", { rag: 6, seed: 3, alpha: o.outlineA ?? 1 });
    const fk = o.fill ?? 1; if (fk > 0) { ctx.save(); ctx.imageSmoothingQuality = "high"; X0.reveal(ctx, art.ink, x, y, size, size, fk, "-y", { rag: size * 0.04, seed: 8 }); ctx.restore(); }
    if (o.eyes) {
      const ew = size * 0.36, eh = ew * 328 / 558, ex = cx - size * 0.04 + (o.eyes.dx ?? 0) * size, ey = cy + size * 0.05 + (o.eyes.dy ?? 0) * size;
      ctx.save(); ctx.translate(ex, ey); ctx.scale(o.eyes.sx ?? 1, Math.max(0.06, o.eyes.sy ?? 1));
      ctx.drawImage(A.eyes, 536, 630, 558, 328, -ew / 2, -eh / 2, ew, eh); ctx.restore();
    }
  }
  function coachEyes(t) {
    if (t < T.eyes) return null;
    const d = Math.min(4, Math.floor((t - T.eyes) * 30 + 1e-6));
    let sy = [0.22, 1.24, 0.84, 1.05, 1][d]; const sx = [1.14, 0.9, 1.1, 0.98, 1][d];
    for (const b of COACH_BLINKS) if (t >= b && t < b + F(5)) sy *= 1 - 0.92 * E.bump(fr(t, b, F(5)));
    const up = E.bump(fr(t, T.nod + F(4), F(16)));   // after the hero's nod, Coach looks up at him
    return { sx, sy, dy: -0.06 * up };
  }
  function coachPose(t) {
    const k1 = E.io(fr(t, T.shrink, F(10))), k2 = E.o3(fr(t, T.glide, F(8)));
    const size = lerp(330, ROW.size, k1), cy = lerp(lerp(1020, 1240, k1), ROW.y, k2);   // steps down below the row's labels (top 1172 > 1152), then glides up
    return { cx: 540, cy: cy + (t < T.shrink ? 2 * Math.sin((t - T.eyes) * 2.4) * fr(t, T.eyes, 0.5) : 0), size };
  }
  /** Typed text: the first n letters, n from a start time at `per` frames a letter. */
  const typed = (s, t, t0, per = 1) => s.slice(0, clamp(Math.floor((t - t0) / F(per)) + 1, 0, s.length));
  function coachLabel(t) {
    const name = typed("Coach", t, T.label, 1.2), y0 = T.label + F(1.2 * 5 + 3);
    let verb = typed("yours", t, y0, 1.2);
    if (t >= T.relabel) { const del = Math.floor((t - T.relabel) / F(1)) + 1; verb = del < 5 ? "yours".slice(0, 5 - del) : typed("reminds", t, T.relabel + F(6), 1); }
    return { name, verb };
  }
  function coach(S, t) {
    const { ctx } = S, P = coachPose(t);
    const outline = E.io(fr(t, T.coach, 1.2)), fill = fr(t, T.fill, F(6));
    drawCoach(S, P.cx, P.cy, P.size, { outline, outlineA: 1 - fr(t, T.fill + F(6), F(4)), fill, eyes: coachEyes(t) });   // the pencil goes under the ink: no grey ring
    const L = coachLabel(t), nb = P.cy + P.size / 2 + 50;
    if (t >= T.label) { X0.text(ctx, L.name, 540, nb, LABEL.name, C.ink, "center"); X0.text(ctx, L.verb, 540, nb + 46, LABEL.verb, C.ink, "center"); }
    return P;
  }

  // ------------------------------------------------------------------------------------------------ the team
  function team(S, t) {
    const { ctx, A } = S;
    for (const b of TEAM) {
      const k = E.o3(fr(t, T.row, F(13))); if (k <= 0) continue;
      const sx = ROW.xs[b.seat], x = sx - 1150 * (1 - k), y = ROW.y - 12 * E.bump(fr(t, b.hop, F(6))), h = ROW.size;
      ctx.save(); ctx.imageSmoothingQuality = "high"; ctx.drawImage(A[AD.BOT[b.key].head], x - h / 2, y - h / 2, h, h); ctx.restore();
      if (b.above) { X0.text(ctx, b.name, x, y - h / 2 - 74, LABEL.name, C.ink, "center"); X0.text(ctx, b.verb, x, y - h / 2 - 28, LABEL.verb, C.ink, "center"); }
      else { X0.text(ctx, b.name, x, y + h / 2 + 50, LABEL.name, C.ink, "center"); X0.text(ctx, b.verb, x, y + h / 2 + 96, LABEL.verb, C.ink, "center"); }
    }
  }
  /** The hero lowers in on his bar at top centre, looks along the row to the new one, nods once. */
  function hero(S, t) {
    if (t < T.hero) return;
    const k = fr(t, T.hero, F(13)), y = lerp(-480, HERO.y, E.back(1.25)(k));
    const kL = E.io(fr(t, T.look, F(6))), kS = E.io(fr(t, T.look + F(8), F(14))), kC = E.io(fr(t, T.look + F(23), F(6)));
    const dx = -30 * kL + 60 * kS - 30 * kC, dy = 4 + 14 * kL + 6 * kC;   // down to the row's left end, along it, back to the centre seat
    const nod = E.bump(fr(t, T.nod, F(10)));
    let blink = 0; for (const b of HERO_BLINKS) if (t >= b && t < b + F(5)) blink = E.bump(fr(t, b, F(5)));
    const idle = Math.sin((t - T.hero) * 2.1) * 2.5 * fr(t, T.nod + F(10), 0.6);
    X0.hang(S.ctx, S.A, HERO.x, y, HERO.size, null, { eyes: { dx, dy: dy + 7 * nod }, blink, bob: 9 * nod + idle, barDy: 5 * E.bump(fr(t, T.hero + F(8), F(8))) });
  }
  /** Coach's first note, taped on and typed. */
  function card(S, t) {
    const k = fr(t, T.card, F(6)); if (k <= 0) return;
    const { ctx, A } = S, { w, h, y, pad, size } = CARD, x = (1080 - w) / 2, cx = x + w / 2, cy = y + h / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.012); const ps = 1.1 - 0.1 * E.o5(k); ctx.scale(ps, ps); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2);
    ctx.save(); ctx.shadowColor = "rgba(30,20,10,0.2)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, 22); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, 22); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.5 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, 22); ctx.stroke();
    const hs = 64; drawCoach(S, x + pad + hs / 2, y + 30 + hs / 2, hs, { outlineA: 0, eyes: { sx: 1, sy: 1 } });
    X0.text(ctx, "Coach", x + pad + hs + 16, y + 30 + hs * 0.7, LABEL.name, C.ink);
    const f = X0.font(500, size), ly = [y + 30 + hs + 72, y + 30 + hs + 72 + 66];
    const s1 = typed(CARD_LINES[0], t, T.type1), s2 = t >= T.type2 ? typed(CARD_LINES[1], t, T.type2) : "";
    if (t >= T.type1) X0.text(ctx, s1, x + pad, ly[0], f, C.ink);
    if (s2) X0.text(ctx, s2, x + pad, ly[1], f, C.ink);
    const typing = (t >= T.type1 && s1.length < CARD_LINES[0].length) ? [s1, 0] : (t >= T.type2 && s2.length < CARD_LINES[1].length) ? [s2, 1] : (t >= T.type1 + F(CARD_LINES[0].length) && t < T.type2) ? [s1, 0] : null;
    if (typing && Math.floor(t * 4) % 2 === 0) { const cxr = x + pad + X0.width(ctx, typing[0], f) + 4; ctx.fillStyle = C.ink; ctx.fillRect(cxr, ly[typing[1]] - size * 0.74, 3, size * 0.86); }
    const tape = (tx, ty, rot, tw) => { const th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(tx, ty); ctx.rotate(rot); ctx.globalAlpha *= 0.9; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore(); };
    tape(cx - 40, y + 2, -0.06, 220); tape(x + w - 18, y + h - 14, -0.72, 150);
    ctx.restore();
  }
  function paper(S, t) {
    const { ctx, A } = S, p = E.io(fr(t, T.lift, F(9)));
    ctx.save(); ctx.globalAlpha = p; ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920); X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); ctx.restore();
    return p;
  }

  // ------------------------------------------------------------------------------------------------ dawn and the headline
  // two tiny walkers on the horizon left of the runner (x 358-382): covered with the ground just left of them (x 260-340,
  // the runner never comes near it), sheared in thin slices so its horizon runs from the left neighbour's row (y 1002) to
  // the right neighbour's (y 999) with no step, and feathered 12 px all round so no box shows
  const PATCH = { x: 340, y: 950, w: 80, h: 70, dyL: 0, dyR: 3, feather: 12, slices: 10 };
  function patchWalkers(S) {
    if (S.q.get("nopatch")) return;
    const { ctx } = S, u = S.u, P = PATCH, cv = ctx.canvas, W = Math.round(P.w * u), H = Math.round(P.h * u), f = P.feather * u;
    const a = X0.offscreen(W, H), ca = a.getContext("2d"), sw = P.w / P.slices;
    for (let i = 0; i < P.slices; i++) {
      const dy = lerp(P.dyL, P.dyR, (i + 0.5) / P.slices), x = i * sw;
      ca.drawImage(cv, (P.x - P.w + x) * u, (P.y + dy) * u, sw * u + 1, H, x * u, 0, sw * u + 1, H);
    }
    ca.globalCompositeOperation = "destination-in";
    const fx = ca.createLinearGradient(0, 0, W, 0); fx.addColorStop(0, "rgba(0,0,0,0)"); fx.addColorStop(f / W, "#000"); fx.addColorStop(1 - f / W, "#000"); fx.addColorStop(1, "rgba(0,0,0,0)");
    ca.fillStyle = fx; ca.fillRect(0, 0, W, H);
    const fy = ca.createLinearGradient(0, 0, 0, H); fy.addColorStop(0, "rgba(0,0,0,0)"); fy.addColorStop(f / H, "#000"); fy.addColorStop(1 - f / H, "#000"); fy.addColorStop(1, "rgba(0,0,0,0)");
    ca.fillStyle = fy; ca.fillRect(0, 0, W, H);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(a, P.x * u, P.y * u); ctx.restore();
    X0.release(a);
  }
  function dawn(S, t) {
    const { ctx } = S, src = 0.1 + (t - T.run);
    shot(S, S.foot("run", src), { bright: 0.94, warm: lerp(0.12, 0.26, fr(t, T.run, 2.2)), extend: [352, 1565] });
    patchWalkers(S);
    // the same warm grey as the night: the teal mountains and the green-grey salt flat land on it; the peach sky keeps its warmth
    const tg = ctx.createLinearGradient(0, 790, 0, 900); tg.addColorStop(0, wg(0)); tg.addColorStop(1, wg(0.9)); tone(S, tg);
    glow(S, 540, 880, 760, `rgba(255,186,136,${(0.05 + 0.1 * fr(t, T.run, 2.0)).toFixed(3)})`);   // and the warmth rises at the horizon
    AD.scrim(S, 1920, 1120, 0.5);   // a 40-50 % ink gradient under the headline band: the salt flat runs light at dawn
    X0.vignette(ctx, 1080, 1920, 0.3);
    if (!S.q.get("notype")) headline(S, t);
  }
  let HL = null;
  function headline(S, t) {
    if (t < T.l1) return;
    const { ctx, A } = S, { size, x, base } = HEAD;
    if (!HL) HL = [X0.layout(ctx, [{ text: "Your" }, { text: "own" }, { text: "bot" }], { x, y: base[0], size, weight: 900, color: "#FFFFFF" }),
      X0.layout(ctx, [{ text: "in" }, { text: "a", hand: true, handWeight: 700, scale: 1.4 }, { text: "sentence" }], { x, y: base[1], size, weight: 900, color: "#FFFFFF" })];
    if (!HL.spaced) { HL[1].words[1].x -= 12; HL.spaced = true; }   // Caveat's side bearings: the 'a' moved 12 px left so 'in a' and 'a sentence' read as even gaps
    const slamLine = (line, t0, i) => {
      if (t < t0) return; const s = 1.08 - 0.08 * E.o3(fr(t, t0, F(3))), cx = line.x + line.w / 2, cy = base[i] - size * 0.35;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
      for (let n = 0; n < 2; n++) X0.drawLine(ctx, line, (j, w) => (w.hand ? { a: 0 } : { a: 1 }));
      ctx.restore();
    };
    slamLine(HL[0], T.l1, 0); slamLine(HL[1], T.l2, 1);
    const hw = HL[1].words[1], sw = HL[1].words[2];
    if (t >= T.hand) {   // 'a', written by hand on its frames: ink from the first frame (linear), revealed through a 30 px feathered edge so its shadow never ends on a hard line
      const kh = fr(t, T.hand, 0.3), u = S.u, pad = 60, w = hw.w + 2 * pad, h = size * 2.4, x0 = hw.x - pad, y0 = base[1] - size * 1.6;
      const cv = X0.offscreen(w * u, h * u), c = cv.getContext("2d");
      c.scale(u, u); c.translate(-x0, -y0); c.shadowColor = "rgba(0,0,0,0.7)"; c.shadowBlur = 24 * u; c.shadowOffsetY = 3 * u;
      for (let n = 0; n < 2; n++) X0.drawLine(c, { words: [hw] });
      c.setTransform(1, 0, 0, 1, 0, 0); c.shadowColor = "transparent"; c.globalCompositeOperation = "destination-in";
      const lead = lerp(pad - 14, pad + hw.w + 44, kh) * u, g = c.createLinearGradient(lead - 30 * u, 0, lead, 0); g.addColorStop(0, "#000"); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, w * u, h * u);
      ctx.drawImage(cv, x0, y0, w, h); X0.release(cv);
    }
    if (t >= T.ul) {     // the clay brush under 'a sentence'
      const im = A["ul-bar"], x0 = hw.x - 8, ww = sw.x + sw.w - hw.x + 22, uh = Math.max(30, ww * im.height / im.width * 1.25);
      X0.reveal(ctx, im, x0, base[1] + size * 0.13, ww, uh, E.o3(fr(t, T.ul, 0.4)), "x", { rot: -0.01, rag: 10, seed: 2 });
    }
  }

  // ------------------------------------------------------------------------------------------------ the frame
  function frame(t, S) {
    const { ctx } = S;
    if (t < T.lift + F(10)) night(S, t);
    if (t < T.run) {
      const p = t >= T.lift ? paper(S, t) : 0;
      if (t < T.lift + F(10)) hour(S, t, 1 - E.io(fr(t, T.lift, F(6))));
      sentence(S, t, p);
      if (t >= T.lift) {
        rule(S, t);
        if (t >= T.coach) coach(S, t);
        team(S, t); hero(S, t); card(S, t);
      }
      X0.grain(ctx, 1080, 1920, t, t >= T.lift + F(9) ? 0.035 : 0.075, 1);
    } else if (t < T.end + F(14)) { dawn(S, t); X0.grain(ctx, 1080, 1920, t, 0.075, 1); }
    AD.endCard(S, t, T.end); markGap(S, t);
    if (t >= T.end + F(14)) X0.grain(ctx, 1080, 1920, t, 0.03, 1);
    if (S.q.get("hud")) X0.text(ctx, `t ${t.toFixed(2)} f${Math.round(t * 30)}`, 16, 1860, X0.font(500, 24, "GeistMono"), "#ff6060");
  }

  /** The kit's markPaint clips the 0 at 0.52 of the mark AFTER squeezing the whole mark by 0.74, so the tips of the X's
   *  right arms (source 0.436-0.457) come back as a black sliver at x 319-327 between the X and the 0 ('X|0'). adkit.js is
   *  shared and not edited from a spot, so (as spots 05 and 09 do) the gap is laid back with the end card's own paper:
   *  the X's ink ends at source 0.457 (x 290), the narrowed 0's starts at 0.570 (x 342), and x 296-336 holds only the sliver. */
  const MARK = { x: 80, y: 740, w: 460 };
  function markGap(S, t) {
    const te = t - T.end; if (te < F(36)) return;   // the 0's stroke starts at +36 f; the sheet is up from +14 f
    const { ctx, A } = S, mh = MARK.w * A.mark.height / A.mark.width;
    ctx.save(); ctx.beginPath(); ctx.rect(MARK.x + MARK.w * 0.47, MARK.y - 4, MARK.w * 0.087, mh + 8); ctx.clip();
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920); X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the sound
  const E_UP = Math.pow(2, 2 / 12);   // the card's chord and bells, moved from D to the spot's E
  function cues(S) {
    const c = [], sfx = (name, at, gain = 1) => c.push({ at, kind: "sample", file: `08-sfx/${name}.wav`, gain });
    // the night: the hallway and the fridge, the switch, the hour, her voice, a pen scratch on each word
    sfx("room", 0, 0.22); sfx("lamp", T.lamp, 0.9);
    c.push({ at: 0, kind: "drone", f: 82.41, dur: T.end + 0.6, gain: 0.3, a: 1.6, r: 1.2 });
    [..."10:52 pm"].forEach((ch, i) => { if (ch !== " ") c.push({ at: T.time + F(i), kind: "tick", gain: 0.22 }); });
    c.push({ at: T.vo, kind: "sample", file: "../voice/08-1p.wav", gain: 1.1 });
    S.V.vo.words.forEach((w, i) => sfx(`pen-${(i % 4) + 1}`, T.vo + w.t0 - 0.03, 0.32));
    // paper: the slide, the nib's rule, the pencil, the grey bell, the eyes, the label
    sfx("slide", T.lift - 0.04, 0.8); sfx("nib", T.rule, 0.55);
    sfx("pencil", T.coach, 0.55);
    c.push({ at: T.fill + F(4), kind: "bell", f: 659.25, dur: 1.6, gain: 0.26 }, { at: T.fill + F(4), kind: "bell", f: 329.63, dur: 1.8, gain: 0.14 });
    sfx("squeak", T.eyes + F(1), 0.5); sfx("squeak", COACH_BLINKS[0] + F(2), 0.28);
    for (let i = 0; i < 5; i++) c.push({ at: T.label + F(1.2 * i), kind: "tick", gain: 0.2 });
    for (let i = 0; i < 5; i++) c.push({ at: T.label + F(1.2 * 5 + 3) + F(1.2 * i), kind: "tick", gain: 0.2 });
    // the team: Coach steps back, four heads slide in, four bells; Coach glides up; 'yours' -> 'reminds'
    c.push({ at: T.shrink, kind: "whoosh", dur: 0.3, up: false, gain: 0.18 }, { at: T.row, kind: "whoosh", dur: 0.5, up: true, gain: 0.25 });
    for (const b of TEAM) c.push({ at: b.hop, kind: "bell", f: b.note, dur: 1.1, gain: 0.36 });
    c.push({ at: T.glide, kind: "whoosh", dur: 0.26, up: true, gain: 0.2 });
    for (let i = 0; i < 5; i++) c.push({ at: T.relabel + F(i), kind: "tick", gain: 0.16 });
    for (let i = 0; i < 7; i++) c.push({ at: T.relabel + F(6 + i), kind: "tick", gain: 0.2 });
    // the hero: down on his bar, the creak, the nod
    c.push({ at: T.hero, kind: "whoosh", dur: 0.35, up: false, gain: 0.2 }); sfx("creak", T.hero + F(8), 0.7); sfx("creak", T.nod + F(2), 0.25);
    sfx("squeak", COACH_BLINKS[1] + F(2), 0.22);
    // the note: tape, the press, the grey bell, the drone opens (its third comes in), a tick a letter
    sfx("tape", T.card - 0.3, 0.8); c.push({ at: T.card + F(4), kind: "paper-thud", gain: 0.5 });
    c.push({ at: T.card + F(8), kind: "bell", f: 659.25, dur: 1.4, gain: 0.22 }, { at: T.card + F(8), kind: "bell", f: 329.63, dur: 1.6, gain: 0.12 });
    c.push({ at: T.card, kind: "pad", f: 164.81, dur: T.run - T.card + 0.3, gain: 0.32, a: 0.9, r: 0.5 }, { at: T.card + 0.4, kind: "pad", f: 207.65, dur: T.run - T.card - 0.1, gain: 0.22, a: 1.2, r: 0.5 });
    [[CARD_LINES[0], T.type1], [CARD_LINES[1], T.type2]].forEach(([s, t0]) => [...s].forEach((ch, i) => { if (ch !== " ") c.push({ at: t0 + F(i), kind: "tick", gain: 0.17 }); }));
    // dawn: air and far footfalls, two soft slams, the hand's scratch, the brush, the drone resolves
    sfx("air", T.run, 0.45);
    for (const at of [T.l1, T.l2]) c.push({ at, kind: "boom", gain: 0.3, f0: 72, f1: 40, dur: 0.9 }, { at, kind: "paper-thud", gain: 0.35 });
    sfx("pen-2", T.hand, 0.4); sfx("pen-4", T.hand + 0.14, 0.3); sfx("brush", T.ul, 0.55);
    c.push({ at: T.l2, kind: "chord", f: 164.81, dur: 2.2, gain: 0.3 });
    // the end card, as built, in E
    for (const q of AD.endCues(T.end)) c.push(q.f && (q.kind === "chord" || q.kind === "bell") ? { ...q, f: +(q.f * E_UP).toFixed(2) } : q);
    return c;
  }

  AD.start({
    footage: { door: { dir: "../footage-08-a/", frames: 48, fps: 30 }, shoe: { dir: "../footage-08-b/", frames: 25, fps: 25 }, run: { dir: "../footage-08-g/", frames: 77, fps: 30 } },
    voices: { vo: "../voice/08-1p.json" }, scripts: { vo: SCRIPT },
    duration: DUR, frame, cues,
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
