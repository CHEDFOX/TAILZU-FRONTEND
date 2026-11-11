/* GO LIVE (spot 07, The Precisionist, second film). A countdown that never counts.
 *
 *    0.0- 2.6  hands on a laptop at night, lit by the screen; they stop (2.0), one last key, they lift (2.4); FREEZE on
 *              the lifted hands (2.6). The wall clock starts the instant they lift and runs to the stamp.
 *    2.6- 4.4  HOLD 1: the frozen hands go cold; Code bot's card tapes on at 0.5h: "Safe copy made".
 *    4.4- 6.8  HOLD 2: archive, the shuttle on its pad at night, floodlit, venting; slowed 10 %; freeze at 6.0 and the
 *              card in the same place: "Tests passed".
 *    6.8-13.3  PAPER: the two cards tiled small at the top, a larger card slides up: "Go live?", a dip-pen 'Yes' and a
 *              smaller 'Not now'. THE WAIT: the hero lowers in on his clay bar, looks down at the button, looks at us,
 *              blinks; "Nothing is live." types on. A hand writes 'yes' across 'Yes'; his eyes follow the pen; the moss
 *              'Live' stamp slams down (13.0); his eyes go wide for one frame; the clock stops.
 *   13.3-14.3  RELEASE: hard cut, the firing room, an arm thrown out at the windows (archive, 1.0x).
 *   14.3-18.0  the Saturn V climbs (0.75x); ONE slam for both lines at 15.0: "You say yes / It goes live", 'yes' by
 *              hand, Code bot's moss brush under it; the small line above it.
 *   18.0-22.9  the campaign's end card (AD.endCard as built, 4.9 s), the hero looking and waiting: no wink.
 *
 * Footage (prep.mjs, real frames, no interpolation; blended here between neighbours where the film runs slower than
 * the clip): footage-07-a Mixkit 17450 (34.4-37.8 s, crop 0.46,0,0.316,1, 25 fps); footage-07-b NASA STS-123 post-flight
 * presentation, Endeavour on pad 39A (58.7-60.7 s, crop 0.35,0.04,0.326,0.87); footage-07-c Moonwalk One reel 2, the
 * KSC firing room (reel 397.6-400.6 s, crop 0.10,0,0.316,1); footage-07-d Moonwalk One reel 2, the climb (reel
 * 161-164.8 s, crop 0.39,0.13,0.275,0.87). One grade: contrast up, colour down (the hands' cold blue at -40 %, the
 * archive taken to brand greys), two degrees cool, soft vignette, heavy fine grain, thin ink bars on all footage.
 * Sound: sound.mjs kinds plus spots/07-sfx/*.wav (made by spots/07-sound.mjs). No voice. Drone and chord in E.
 * Everything is a pure function of t.
 */
(() => {
  "use strict";
  const { C, E, clamp } = X0;
  const { F, fr, lerp } = AD;
  const MOSS = C.moss, X = 86, RIGHT = 950, BAR_H = 84;

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    stop: 2.0, lift: 2.4, fz1: 2.6, card1: 2.8,
    b0: 4.4, fz2: 6.0, card2: 6.1,
    p0: 6.8, slideD: F(10),
    in0: 7.3, in1: 7.8, lookDown: 8.3, lookUs: 9.0, blinks: [9.8, 11.4], nothing: 9.9, nothingD: 0.3,
    pen0: 12.3, pen1: 13.0, stamp: 13.0,
    c0: 13.3, d0: 14.3, slam: 15.0, hand0: 15.3, hand1: 15.8, ul0: 15.8, ul1: 16.1, small: 16.2, smallCps: 60,
    end0: 18.0,   // the bible's 17.5, +0.5 s so the small line can be read before the sheet
  };
  T.duration = +(T.end0 + AD.END_S).toFixed(3);
  T.ticks = []; for (let at = T.lift; at < T.stamp - 0.05; at += 1) T.ticks.push(+at.toFixed(3));

  // ------------------------------------------------------------------------------------------------ the footage
  const FOOT = {
    a: { dir: "../footage-07-a/", frames: 85, fps: 25 },
    b: { dir: "../footage-07-b/", frames: 60, fps: 29.97 },
    c: { dir: "../footage-07-c/", frames: 72, fps: 23.976 },
    d: { dir: "../footage-07-d/", frames: 91, fps: 23.976 },
  };
  // a: 1.0x (frame 69 hovering at 2.0, the last key on 76-78, the lift on 79 at 2.4), then the lift eased into frame 80
  const mapA = AD.map([[0, 0.72], [T.lift, 3.12], [T.fz1, 3.16]]);
  const mapB = AD.map([[T.b0, 0.05], [T.fz2, 0.05 + (T.fz2 - T.b0) * 0.9]]);          // slowed 10 %, held from 6.0
  const mapC = AD.map([[T.c0, 16 / 23.976], [T.d0, 16 / 23.976 + (T.d0 - T.c0)]]);      // 1.0x: the arm thrown out
  const mapD = AD.map([[T.d0, 1 / 23.976], [T.end0 + 1, 1 / 23.976 + (T.end0 + 1 - T.d0) * 0.75]]);   // 0.75x
  let blendCv = null;
  /** The frame at a source time: the nearest, or (blend) the two neighbours mixed, so a slowed clip runs smooth. */
  function footFrame(S, name, s, blend) {
    const f0 = FOOT[name], f = clamp(s * f0.fps, 0, f0.frames - 1);
    if (!blend) return S.A[`${name}#${Math.round(f) + 1}`];
    const i = Math.floor(f), a = f - i, im0 = S.A[`${name}#${i + 1}`];
    if (a < 0.04 || i + 2 > f0.frames) return im0;
    const im1 = S.A[`${name}#${i + 2}`]; if (a > 0.96) return im1;
    if (!blendCv) { blendCv = document.createElement("canvas"); blendCv.width = 1080; blendCv.height = 1920; }
    const c = blendCv.getContext("2d"); c.globalAlpha = 1; c.drawImage(im0, 0, 0, 1080, 1920); c.globalAlpha = a; c.drawImage(im1, 0, 0, 1080, 1920); c.globalAlpha = 1;
    return blendCv;
  }

  // ------------------------------------------------------------------------------------------------ the one grade
  /** Contrast up, colour down (sat), two degrees cool, the vignette; `cold` 0..1 is the freeze going cold:
   *  saturation down a third, cooler, darker at the edges (the grain goes up where the frame is finished). */
  function grade(S, img, o) {
    const { ctx } = S, cold = o.cold || 0, sat = o.sat * (1 - cold / 3);
    ctx.save();
    ctx.filter = `brightness(${(o.pre ?? 1).toFixed(3)}) contrast(${((o.contrast ?? 1.22) + 0.05 * cold).toFixed(3)}) saturate(${sat.toFixed(3)}) brightness(${((o.bright ?? 1) - 0.05 * cold).toFixed(3)})`;
    X0.cover(ctx, img, 0, 0, 1080, 1920, { zoom: o.zoom ?? 1, dx: o.dx ?? 0, dy: o.dy ?? 0 });
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgb(${Math.round(lerp(238, 220, cold))},${Math.round(lerp(242, 232, cold))},${Math.round(lerp(250, 255, cold))})`; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
    X0.vignette(ctx, 1080, 1920, (o.vig ?? 0.42) + 0.16 * cold);
  }
  /** Archive flicker: the gate's light breathing a couple of per cent, frame by frame. */
  const flicker = (t, amt = 0.025) => 1 + amt * (X0.hash(Math.floor(t * 24) * 13 + 5) - 0.5);

  // ------------------------------------------------------------------------------------------------ vapour off the vent arm
  /** Soft floodlit vapour drifting off the tank's vent hood (shot b, before the grade): puffs born on a fixed clock,
   *  carried down-wind and spreading, all from t, so the freeze holds them exactly. */
  function vapour(ctx, tv) {
    const SRC = { x: 470, y: 505 }, LIFE = 2.6, EVERY = 0.07;
    ctx.save(); ctx.globalCompositeOperation = "screen";
    const n0 = Math.floor((tv - LIFE) / EVERY), n1 = Math.floor(tv / EVERY);
    for (let n = n0; n <= n1; n++) {
      const born = n * EVERY, age = tv - born; if (age < 0 || age > LIFE) continue;
      const k = age / LIFE, h1 = X0.hash(n * 7 + 1), h2 = X0.hash(n * 7 + 2), h3 = X0.hash(n * 7 + 3);
      const x = SRC.x - 70 * age - 40 * h1 * age + 14 * Math.sin(age * 2.1 + h2 * 6), y = SRC.y + 26 * age + 30 * (h2 - 0.4) * age - 8 * age * age;
      const r = 16 + 70 * k + 20 * h3, a = 0.10 * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (0.6 + 0.4 * h1);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(235,238,240,${a.toFixed(4)})`); g.addColorStop(1, "rgba(235,238,240,0)");
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
  }
  let padCv = null;
  function padFrame(S, t) {
    const sb = mapB(t), img = footFrame(S, "b", sb, true);
    if (!padCv) { padCv = document.createElement("canvas"); padCv.width = 1080; padCv.height = 1920; }
    const c = padCv.getContext("2d"); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.drawImage(img, 0, 0, 1080, 1920);
    if (!S.q.get("novapour")) vapour(c, Math.min(t, T.fz2) - T.b0 + 3);
    return padCv;
  }

  // ------------------------------------------------------------------------------------------------ type and layout (measured)
  let L = null;
  function measure(S) {
    const { ctx } = S, bad = [];
    ctx.save(); ctx.font = X0.font(900, 100); const cap = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    // the hold cards: Code bot's head and name, one ink Geist line at 0.045w; sized to the line plus 0.04w a side
    const cardSize = Math.round(0.045 * 1080), cardF = X0.font(600, cardSize);
    const cards = ["Safe copy made", "Tests passed"].map((text) => { const tw = X0.width(ctx, text, cardF); return { text, tw, w: Math.round(Math.max(tw, 300) + 36 + 43), h: 232 }; });
    const cardW = Math.max(...cards.map((c) => c.w));   // both cards one size: the second lands where the first did
    cards.forEach((c) => { c.w = cardW; c.x = Math.round((1080 - cardW) / 2); c.y = Math.round(960 - c.h / 2); });
    // the tiles: the same cards at 0.776 (their line at 38 px, the 0.035w floor), askew at the top right
    const tileS = 38 / cardSize;
    const tiles = [{ cy: 296, rot: -0.045, left: 626 }, { cy: 500, rot: 0.035, left: 612 }];
    tiles.forEach((tl) => { tl.cx = Math.round(tl.left + (cardW * tileS) / 2); tl.s = tileS; });
    // the big card: head and name, "Go live?" heavy at 0.07w cap height, the dip-pen Yes (0.3w) and Not now, two ink lines at 44 px
    const askSize = Math.round(0.07 * 1080 / cap), askF = X0.font(900, askSize), lineF = X0.font(400, 44);
    const LINES = ["It asked one thing. You answered.", "Nothing is live."];
    const lineW = Math.max(...LINES.map((s) => X0.width(ctx, s, lineF))), yesW = Math.round(0.3 * 1080), noW = Math.round(0.2 * 1080), gap = 40;
    const innerW = Math.max(lineW, yesW + gap + noW, X0.width(ctx, "Go live?", askF));
    const big = { w: Math.round(innerW + 43 * 2), pad: 43 };
    const fr0 = S.A["pen-frame"], yesH = Math.round(yesW * fr0.height / fr0.width), noH = Math.round(noW * fr0.height / fr0.width);
    big.headY = 36; big.askBase = big.headY + 84 + 46 + Math.round(cap * askSize); big.btnY = big.askBase + 52; big.line0 = big.btnY + yesH + 70; big.line1 = big.line0 + 60;
    big.h = big.line1 + 46; big.x = Math.round((1080 - big.w) / 2); big.y = Math.round(960 - big.h / 2);
    Object.assign(big, { askSize, askF, lineF, LINES, yesW, yesH, noW, noH, gap });
    if (big.x + big.pad + innerW > RIGHT) bad.push(`big card text past 0.88w (${(big.x + big.pad + innerW).toFixed(0)})`);
    // the hero: over the Yes button, his head clear of the card
    const hs = 500, s = hs / 544, yesCx = big.x + big.pad + yesW / 2;
    const hero = { size: hs, s, x: Math.round(yesCx - 271 * s), y: Math.round(big.y - 84 - 405 * s) };
    hero.eye = { x: hero.x + 271 * s, y: hero.y + 262 * s };
    // the handwritten yes (0.09w Caveat) across the printed Yes
    const handF = X0.font(700, 150, "Caveat"), handW = X0.width(ctx, "yes", handF);
    // the headline: 0.09w cap height, two lines, 'yes' by hand; measured against 1026 px and the 0.88w edge
    const hSize = Math.round(0.09 * 1080 / cap), hBase = [0, Math.round(0.76 * 1920)]; hBase[0] = hBase[1] - Math.round(hSize * 1.16);
    const hLines = [["You", "say", "yes"], ["It", "goes", "live"]].map((ws, i) => X0.layout(ctx, ws.map((w) => (i === 0 && w === "yes" ? { text: w, hand: true, handWeight: 700, scale: 1.3 } : { text: w })), { x: X, y: hBase[i], size: hSize, weight: 900, color: "#FFFFFF" }));
    hLines.forEach((l, i) => { if (l.w > 1026 || X + l.w > RIGHT) bad.push(`headline line ${i + 1} ${l.w.toFixed(0)} px`); });
    const SMALL = ["A safe copy. The tests.", "A question when it needs you."], smallF = X0.font(400, 44), smallBase = [Math.round(0.60 * 1920) - 58, Math.round(0.60 * 1920)];
    SMALL.forEach((s2) => { if (X + X0.width(ctx, s2, smallF) > RIGHT) bad.push(`small "${s2}"`); });
    cards.forEach((c) => { if (c.x + 36 + c.tw > RIGHT) bad.push(`card "${c.text}"`); });
    tiles.forEach((tl) => { const right = tl.cx - (cardW * tl.s) / 2 + (36 + cards[0].tw) * tl.s; if (right > RIGHT) bad.push(`tile text to ${right.toFixed(0)}`); });
    L = { cap, cardSize, cardF, cards, tiles, big, hero, handF, handW, hSize, hBase, hLines, SMALL, smallF, smallBase };
    if (bad.length) console.error("07 type check: " + bad.join("; "));
    if (S.q.get("hud")) console.warn(`07 measure: cap ${cap.toFixed(3)} card ${cardW} big ${big.w}x${big.h} at ${big.x},${big.y} ask ${askSize}px hero ${hero.x},${hero.y} H ${hSize}px (${hLines.map((l) => l.w.toFixed(0)).join(", ")})`);
    return L;
  }

  // ------------------------------------------------------------------------------------------------ the cards
  const holdCard = (S, i, k) => { const c = L.cards[i]; AD.card(S, { x: c.x, y: c.y, w: c.w, h: c.h, rot: i ? 0.022 : -0.03, k, bot: "code", lines: [{ text: c.text, size: L.cardSize, weight: 600 }], tapeDx: i ? 70 : -60, tapeRot: i ? -0.04 : -0.08 }); };
  function tile(S, i) {
    const { ctx } = S, c = L.cards[i], tl = L.tiles[i];
    ctx.save(); ctx.translate(tl.cx, tl.cy); ctx.rotate(tl.rot); ctx.scale(tl.s, tl.s); ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
    AD.card(S, { x: c.x, y: c.y, w: c.w, h: c.h, rot: 0, k: 1, bot: "code", lines: [{ text: c.text, size: L.cardSize, weight: 600 }], tapeDx: i ? 70 : -60, tapeRot: i ? -0.04 : -0.08 });
    ctx.restore();
  }
  /** The big card: slides up (10 f), the question, the buttons, the lines; "Nothing is live." typed at 9.9. */
  function bigCard(S, t) {
    const { ctx, A } = S, b = L.big, ks = E.o3(fr(t, T.p0, T.slideD)), dy = (1 - ks) * 1180;
    const x = b.x, y = b.y + dy;
    ctx.save();
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, b.w, b.h, 26); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, b.w, b.h, 26); ctx.clip(); X0.cover(ctx, A.paper, x, y, b.w, b.h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, b.w, b.h, 26); ctx.stroke();
    const px = x + b.pad;
    ctx.drawImage(A["head-code"], px, y + b.headY, 84, 84); X0.text(ctx, "Code bot", px + 84 + 20, y + b.headY + 84 * 0.68, X0.font(600, 38), MOSS);
    X0.text(ctx, "Go live?", px, y + b.askBase, b.askF, C.ink);
    // the dip-pen buttons: 'Yes', and the smaller 'Not now' beside it
    const yb = y + b.btnY, im = A["pen-frame"];
    // the printed label gives way to the ink as the hand writes over it
    const give = 1 - 0.72 * E.io(fr(t, T.pen0, 0.3));
    ctx.drawImage(im, px, yb, b.yesW, b.yesH); X0.text(ctx, "Yes", px + b.yesW / 2, yb + b.yesH / 2 + 20, X0.font(600, 56), C.ink, "center", { alpha: give });
    const nx = px + b.yesW + b.gap, ny = yb + (b.yesH - b.noH) / 2;
    ctx.drawImage(im, nx, ny, b.noW, b.noH); X0.text(ctx, "Not now", nx + b.noW / 2, ny + b.noH / 2 + 15, X0.font(500, 44), "#333333", "center");
    X0.text(ctx, b.LINES[0], px, y + b.line0, b.lineF, C.ink);
    const n = typedN(t, T.nothing, T.nothingD, b.LINES[1]); if (n > 0) X0.text(ctx, b.LINES[1].slice(0, n), px, y + b.line1, b.lineF, C.ink);
    ctx.restore();
    return { px, yb, y };
  }
  /** Letters typed evenly over [t0, t0 + d]: how many show at t. */
  function typedN(t, t0, d, s) { if (t < t0) return 0; return Math.min(s.length, 1 + Math.floor((t - t0) / d * s.length)); }
  /** The handwritten 'yes' across the printed Yes (12.3-13.0); returns the pen's x. */
  function handYes(S, t, at) {
    if (t < T.pen0) return null;
    const { ctx } = S, b = L.big, k = E.io(fr(t, T.pen0, T.pen1 - T.pen0));
    const x0 = at.px + b.yesW / 2 - L.handW / 2 + 10, base = at.yb + b.yesH / 2 + 30;
    ctx.save(); ctx.translate(x0, base); ctx.rotate(-0.08);
    ctx.beginPath(); ctx.rect(-20, -170, (L.handW + 40) * k, 260); ctx.clip();
    X0.text(ctx, "yes", 0, 0, L.handF, C.ink); ctx.restore();
    return { x: x0 + L.handW * k, y: base - 40 };
  }
  /** The hand-drawn 'Live' stamp in moss: lands 1.3 -> 1.0 in 2 f beside the question, inked into the paper. */
  let stampCv = null;
  function liveStamp(S, t, at) {
    if (t < T.stamp) return;
    const { ctx, A } = S, b = L.big, k = fr(t, T.stamp, F(2)), sc = 1.3 - 0.3 * E.o3(k), w = Math.round(0.3 * 1080), im = A["pen-frame"], h = Math.round(w * im.height / im.width);
    if (!stampCv) {
      stampCv = document.createElement("canvas"); stampCv.width = w + 40; stampCv.height = h + 40;
      const c = stampCv.getContext("2d"); c.translate(20, 20);
      const ti = X0.tint(im, MOSS);
      for (const [ox, oy] of [[0, 0], [2, 1], [-1, 2], [1, -1]]) c.drawImage(ti, ox, oy, w, h);   // the outer rule, thick
      c.drawImage(ti, 13, 12, w - 26, h - 24);                                                    // and a thin inner one
      c.font = X0.font(900, Math.round(h * 0.62)); c.fillStyle = MOSS; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillText("Live", w / 2, h / 2 + h * 0.22);
      // the ink's bite: a seeded speckle taken out of it, heavier at one edge, as a rubber stamp leaves it
      c.globalCompositeOperation = "destination-out"; const r = X0.rng(77);
      for (let i = 0; i < 1400; i++) { const px = r() * (w + 20) - 10, py = r() * (h + 20) - 10, rr = 0.6 + r() * 1.8; c.globalAlpha = 0.25 + 0.6 * r() * (0.4 + 0.6 * px / w); c.beginPath(); c.arc(px, py, rr, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    }
    // across the card's right edge, between the question and the buttons, onto the sheet beneath
    const cx = b.x + b.w - 80, cy = at.y + Math.round((b.askBase + b.btnY) / 2) - 6;
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.92;
    ctx.translate(cx, cy); ctx.rotate(-0.11); ctx.scale(sc, sc); ctx.drawImage(stampCv, -(w + 40) / 2, -(h + 40) / 2); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the hero
  const blinkK = (t) => { for (const b of T.blinks) { if (t >= b && t < b + F(6)) { const u = t - b; return u < F(2) ? u / F(2) : u < F(3) ? 1 : 1 - (u - F(3)) / F(3); } } return 0; };
  function hero(S, t, pen) {
    if (t < T.in0) return;
    const { ctx, A } = S, H = L.hero;
    const kin = fr(t, T.in0, T.in1 - T.in0), y = H.y - (1 - E.back(0.9)(kin)) * 760;
    const settle = Math.max(0, t - T.in1);
    const sway = 0.9 * Math.sin(settle * 2.5) * Math.exp(-settle * 0.9) + 0.35 * Math.sin(t * 1.3 + 0.7);
    const bob = 1.6 * Math.sin(t * 1.9);
    // the eyes: ahead (at us), down at the button 8.3-9.0, then the pen's front 12.3-13.0, wide for one frame on the stamp
    let dx = 0, dy = 0;
    const kd = E.io(fr(t, T.lookDown, F(6))) * (1 - E.io(fr(t, T.lookUs, F(6))));
    dx += -2 * kd; dy += 13 * kd;
    if (pen || t >= T.pen0 - F(5)) {
      const kp = E.io(fr(t, T.pen0 - F(5), F(5))), target = pen ? pen.x : L.big.x + L.big.pad + 40;
      const pdx = clamp((target - H.eye.x) / 18, -10, 10);
      dx = lerp(dx, pdx, kp); dy = lerp(dy, 13, kp);
    }
    // the stamp lands (f+2): his eyes go wide for that one frame, then turn to it
    const wide = t >= T.stamp + F(2) && t < T.stamp + F(3) ? 1.3 : 1;
    if (t >= T.stamp + F(3)) { const kg = E.io(fr(t, T.stamp + F(3), F(5))); dx = lerp(dx, 10, kg); dy = lerp(dy, 6, kg); }
    X0.hang(ctx, A, H.x, y, H.size, null, { eyes: { dx, dy, sx: wide, sy: wide }, blink: blinkK(t), bob, sway });
  }

  // ------------------------------------------------------------------------------------------------ the headline
  function headline(S, t) {
    if (t < T.slam) return;
    const { ctx, A } = S, size = L.hSize, k = fr(t, T.slam, F(3)), sc = 1.08 - 0.08 * E.o3(k);
    const shadow = () => { ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3; };
    const top = L.hBase[0] - size * L.cap, cx = X + Math.max(L.hLines[0].w, L.hLines[1].w) / 2, cy = (top + L.hBase[1]) / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); shadow();
    for (let r = 0; r < 2; r++) L.hLines.forEach((line) => X0.drawLine(ctx, line, (j, w) => (w.hand ? { a: 0 } : { a: 1 })));
    ctx.restore();
    const hw = L.hLines[0].words.find((w) => w.hand);
    if (t >= T.hand0) {
      const kh = E.io(fr(t, T.hand0, T.hand1 - T.hand0));
      ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 12, L.hBase[0] - size * 1.3, (hw.w + 30) * kh, size * 1.8); ctx.clip(); shadow();
      for (let r = 0; r < 2; r++) X0.drawLine(ctx, { words: [hw] }); ctx.restore();
    }
    if (t >= T.ul0) { const im = A["ul-code"], uw = hw.w * 1.12, uh = Math.max(32, uw * im.height / im.width * 1.9);
      X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 10, hw.y + size * 0.14, uw, uh, E.o3(fr(t, T.ul0, T.ul1 - T.ul0)), "x", { rot: -0.012, rag: 10, seed: 2 }); }
    // the small line above it, typed a letter at a time
    let at = T.small;
    L.SMALL.forEach((s, i) => {
      const n = Math.floor((t - at) * T.smallCps) + 1; if (n > 0) AD.onFilm(S, s.slice(0, Math.min(n, s.length)), X, L.smallBase[i], L.smallF, "rgba(255,255,255,0.96)");
      at += s.length / T.smallCps + 0.06;
    });
  }
  const smallTimes = () => { const out = []; let at = T.small; for (const s of L.SMALL) { for (let i = 0; i < s.length; i++) if (s[i] !== " ") out.push(+(at + i / T.smallCps).toFixed(4)); at += s.length / T.smallCps + 0.06; } return out; };

  // ------------------------------------------------------------------------------------------------ the end card
  /** The campaign's card as built; after its last motion (the stamp, the bob, F(96)) it is held still, so the hero
   *  looks and waits and the wink at F(104) never comes. */
  const endCard = (S, t) => AD.endCard(S, Math.min(t, T.end0 + F(100)), T.end0);

  // ------------------------------------------------------------------------------------------------ the film
  AD.start({
    footage: FOOT,
    timeline(S) { measure(S); return T; },
    duration: T.duration,
    frame(t, S) {
      const { ctx } = S, notype = !!S.q.get("notype"); let info = "";
      if (t < T.p0) {
        if (t < T.b0) {
          const sa = mapA(t), cold = E.o3(fr(t, T.fz1, F(6)));
          grade(S, footFrame(S, "a", sa, t > T.lift && t < T.fz1 + F(1)), { sat: 0.6, cold, contrast: 1.2, bright: 1.0 });
          AD.bars(S, BAR_H);
          if (!notype && t >= T.card1) holdCard(S, 0, fr(t, T.card1, F(6)));
          X0.grain(ctx, 1080, 1920, t, 0.11 + 0.05 * cold, 1);
          info = `A src ${sa.toFixed(2)} f${Math.round(sa * 25) + 1}${cold ? " cold " + cold.toFixed(2) : ""}`;
        } else {
          const cold = E.o3(fr(t, T.fz2, F(6)));
          grade(S, padFrame(S, t), { sat: 0.12, cold, contrast: 1.18, bright: 1.04 * flicker(t), pre: 1.0 });
          AD.bars(S, BAR_H);
          if (!notype && t >= T.card2) holdCard(S, 1, fr(t, T.card2, F(6)));
          X0.grain(ctx, 1080, 1920, t, 0.12 + 0.05 * cold, 1);
          info = `B src ${mapB(t).toFixed(2)}${cold ? " cold " + cold.toFixed(2) : ""}`;
        }
      } else if (t < T.c0) {
        // paper: the record, the question, the wait, the yes, the stamp
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920); X0.cover(ctx, S.A.paper, 0, 0, 1080, 1920, { alpha: 0.9 });
        tile(S, 0); tile(S, 1);
        const at = bigCard(S, t), pen = handYes(S, t, at);
        liveStamp(S, t, at);
        hero(S, t, pen);
        X0.grain(ctx, 1080, 1920, t, 0.035, 1);
        info = "P";
      } else if (t < T.d0) {
        const sc = mapC(t);
        grade(S, footFrame(S, "c", sc, false), { sat: 0.12, contrast: 1.38, bright: 0.8 * flicker(t), pre: 0.94 });
        AD.bars(S, BAR_H);
        X0.grain(ctx, 1080, 1920, t, 0.11, 1);
        info = `C src ${sc.toFixed(2)}`;
      } else if (t < T.end0 + F(14)) {
        const sd = mapD(t);
        grade(S, footFrame(S, "d", sd, true), { sat: 0.12, contrast: 1.2, bright: 0.96 * flicker(t) });
        // the ink under the type: a 40 % (and more) gradient over the lower third, in before the slam
        const ka = E.io(fr(t, T.slam - 0.5, 0.45)), y0 = Math.round(0.47 * 1920);
        const g = ctx.createLinearGradient(0, y0, 0, 1920); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.22, `rgba(0,0,0,${(0.5 * ka).toFixed(3)})`); g.addColorStop(0.6, `rgba(0,0,0,${(0.58 * ka).toFixed(3)})`); g.addColorStop(1, `rgba(0,0,0,${(0.62 * ka).toFixed(3)})`);
        ctx.fillStyle = g; ctx.fillRect(0, y0, 1080, 1920 - y0);
        AD.bars(S, BAR_H);
        if (!notype) headline(S, t);
        X0.grain(ctx, 1080, 1920, t, 0.11, 1);
        info = `D src ${sd.toFixed(2)}`;
      }
      if (t >= T.end0) { endCard(S, t); X0.grain(ctx, 1080, 1920, t, 0.03, 1); }
      if (S.q.get("hud")) X0.text(ctx, info, 360, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const c = [], smp = (at, file, gain = 1) => c.push({ at, kind: "sample", file: `07-sfx/${file}.wav`, gain });
      // 1 · the room at night and the keys; nothing after the lift but the clock
      smp(0, "room", 0.9);
      { let at = 0.05, n = 0; while (at < 1.98) { c.push({ at: +at.toFixed(3), kind: "key", gain: 0.34 + 0.22 * X0.hash(n * 5 + 1) }); at += 0.075 + 0.12 * X0.hash(n * 5 + 2) + (X0.hash(n * 5 + 3) > 0.86 ? 0.12 : 0); n++; } }
      c.push({ at: 2.29, kind: "key", gain: 0.62 });   // the last key (frames 76-78)
      T.ticks.forEach((at, i) => smp(at, i % 2 ? "tock" : "tick", 0.5));
      // hold 1: the tape, the card, the moss bell
      smp(T.card1, "tape", 0.75); c.push({ at: T.card1 + F(5), kind: "paper-thud", gain: 0.5 }, { at: T.card1 + F(8), kind: "bell", f: 493.88, dur: 1.3, gain: 0.4 });
      // hold 2: wind and the vent's hiss, dead on the freeze; the tape
      smp(T.b0, "pad", 1);
      smp(T.card2, "tape", 0.72); c.push({ at: T.card2 + F(5), kind: "paper-thud", gain: 0.5 });
      // paper: the card's slide; the drone on E from 8.0, the high sine from 10.0, both cut by the stamp
      smp(T.p0, "slide", 0.55);
      smp(T.p0, "air", 1);
      c.push({ at: 8.0, kind: "drone", f: 82.41, dur: T.stamp - 8.0, a: 3.2, r: 0.008, gain: 0.42 });
      for (let i = 0; i < L.big.LINES[1].length; i++) if (L.big.LINES[1][i] !== " ") c.push({ at: +(T.nothing + i * T.nothingD / L.big.LINES[1].length).toFixed(4), kind: "tick", gain: 0.22 });
      smp(10.0, "sine", 0.3);
      smp(T.pen0, "pen-yes", 0.7);
      smp(T.stamp, "thunk", 0.95); c.push({ at: T.stamp, kind: "boom", f0: 56, f1: 32, dur: 0.9, gain: 0.5 });
      // the release: one boom, a room of chairs, a riser into the slam; the rumble
      c.push({ at: T.c0, kind: "boom", gain: 0.85 }); smp(T.c0, "chairs", 0.9); c.push({ at: T.c0, kind: "riser", dur: T.slam - T.c0, gain: 0.55 });
      smp(T.d0, "rumble", 1);
      c.push({ at: T.slam, kind: "boom", gain: 0.75 });
      smp(T.hand0, "pen-hand", 0.6); c.push({ at: T.ul0, kind: "whoosh", dur: 0.3, up: false, gain: 0.34 }, { at: T.ul1, kind: "bell", f: 493.88, dur: 1.6, gain: 0.42 });
      for (const at of smallTimes()) c.push({ at, kind: "tick", gain: 0.16 });
      // the end card's sounds as built, in E (the drone's key), without the wink's bell
      const up = Math.pow(2, 2 / 12);
      for (const e of AD.endCues(T.end0)) {
        if (e.kind === "bell" && Math.abs(e.at - (T.end0 + F(104))) < 1e-6) continue;
        c.push((e.kind === "chord" || e.kind === "bell") && e.f ? { ...e, f: +(e.f * up).toFixed(2) } : e);
      }
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
