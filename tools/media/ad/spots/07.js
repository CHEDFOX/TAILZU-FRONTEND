/* GO LIVE (spot 07, The Precisionist, second film). A countdown that never counts.
 *
 *    0.0- 2.6  hands on a laptop at night, lit by the screen; they stop (2.0), one last key, they lift (2.4); FREEZE on
 *              the lifted hands (2.6). The wall clock starts the instant they lift and runs to the stamp.
 *    2.6- 3.8  HOLD 1: the frozen hands go cold; Code bot's card tapes on at 0.5h: "Safe copy made".
 *    3.8- 6.5  HOLD 2: archive, the Saturn V on its pad at night, floodlit, venting; slowed 10 % with a slow push-in;
 *              both stop dead in the cold freeze at 5.4, and the card lands in the same place: "Tests passed".
 *    6.5-13.0  PAPER: the two cards tiled small at the top, a larger card slides up: "Go live?", a dip-pen 'Yes' and a
 *              smaller 'Not now'. THE WAIT: the hero lowers in on his clay bar, looks down at the button, looks at us,
 *              blinks; "Nothing is live." types on. A hand writes 'yes' across 'Yes'; his eyes follow the pen;
 *              "You answered." types on; the moss 'Live' stamp slams down (12.7) and strikes "Nothing is live."; his
 *              eyes go wide for one frame; the clock stops.
 *   13.0-14.0  RELEASE: hard cut, the firing room on its feet at the windows, binoculars up (archive, 1.0x).
 *   14.0-14.7  ignition: the engines light (0.75x).
 *   14.7-18.0  the Saturn V climbs (0.75x); ONE slam for both lines on the cut: "You say yes / It goes live", 'yes' by
 *              hand, Code bot's moss brush under it, and on the moss bell the small line above it.
 *   18.0-22.9  the campaign's end card (AD.endCard as built, 4.9 s), the hero looking and waiting: no wink.
 *
 * Everything after the frozen hands runs 0.3 s ahead of the bible's clock (and hold 1 is 0.6 s shorter), so the claim
 * line holds 2.3 s before the end card covers it; hold 2 keeps the pad sound's 1.6 s.
 *
 * Footage (prep.mjs, real frames, no interpolation; blended here between neighbours, at 1.0x too, so 24/25 fps runs
 * smooth at 30): footage-07-a Mixkit 17450 (34.4-37.8 s, crop 0.46,0,0.316,1, 25 fps); footage-07-b Moonwalk One reel 1,
 * Apollo 11 on pad 39A before dawn (reel 477.1-479.4 s, crop 0.398,0,0.2594,0.82: above the S-IC lettering);
 * footage-07-c Moonwalk One reel 2, the firing room (reel 396.43-397.7 s, crop 0.466,0,0.2875,0.909); footage-07-e
 * Moonwalk One reel 1, the first fire in the flame trench (reel 1014.3-1015.7 s, crop 0.665,0.05,0.275,0.87); footage-07-d Moonwalk One
 * reel 2, the climb (reel 161-164.8 s, crop 0.39,0.13,0.275,0.87). One grade: contrast up, colour down (the hands' cold
 * blue at -40 %, the archive taken to brand greys), two degrees cool, soft vignette, heavy fine grain, thin ink bars on
 * all footage. Sound: sound.mjs kinds plus spots/07-sfx/*.wav (made by spots/07-sound.mjs). No voice. Drone and chord in E.
 * Everything is a pure function of t.
 */
(() => {
  "use strict";
  const { C, E, clamp } = X0;
  const { F, fr, lerp } = AD;
  const MOSS = C.moss, X = 86, RIGHT = 950, BAR_H = 84, LABEL = 44;

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    stop: 2.0, lift: 2.4, fz1: 2.6, card1: 2.8,
    b0: 3.8, fz2: 5.4, card2: 5.5,
    p0: 6.5, slideD: F(10),
    in0: 7.0, in1: 7.5, lookDown: 8.0, lookUs: 8.7, blinks: [9.5, 11.1], nothing: 9.6, nothingD: 0.3,
    pen0: 12.0, pen1: 12.7, answered: 12.5, answeredD: 0.2, stamp: 12.7,
    c0: 13.0, e0: 14.0, d0: 14.7, slam: 14.7, hand0: 15.0, hand1: 15.5, ul0: 15.5, ul1: 15.8, small: 15.8,
    drone: 7.7, sine: 9.7,
    end0: 18.0,   // the bible's 17.5 + 0.5 s, so the claim line holds 2.3 s before the sheet
  };
  T.land = T.stamp + F(2);
  T.duration = +(T.end0 + AD.END_S).toFixed(3);
  T.ticks = []; for (let at = T.lift; at < T.stamp - 0.05; at += 1) T.ticks.push(+at.toFixed(3));

  // ------------------------------------------------------------------------------------------------ the footage
  const FOOT = {
    a: { dir: "../footage-07-a/", frames: 85, fps: 25 },
    b: { dir: "../footage-07-b/", frames: 57, fps: 23.976 },
    c: { dir: "../footage-07-c/", frames: 31, fps: 23.976 },
    e: { dir: "../footage-07-e/", frames: 34, fps: 23.976 },
    d: { dir: "../footage-07-d/", frames: 91, fps: 23.976 },
  };
  // a: 1.0x (frame 69 hovering at 2.0, the last key on 76-78, the lift on 79 at 2.4), then the lift stepped into frame 80
  const mapA = AD.map([[0, 0.72], [T.lift, 3.12], [T.fz1, 3.16]]);
  // b: 0.91x (the bible's 10 % slower) from frame 3 to frame 38, held there from 5.4: the freeze lands on a real frame
  const mapB = AD.map([[T.b0, 2 / 23.976], [T.fz2, 37 / 23.976]]);
  const mapC = AD.map([[T.c0, 0], [T.e0, T.e0 - T.c0]]);                                     // 1.0x: binoculars up
  const mapE = AD.map([[T.e0, 0.65], [T.d0, 0.65 + (T.d0 - T.e0) * 0.75]]);                  // 0.75x: the engines light
  const mapD = AD.map([[T.d0, 1 / 23.976], [T.end0 + 1, 1 / 23.976 + (T.end0 + 1 - T.d0) * 0.75]]);   // 0.75x
  let blendCv = null;
  /** The frame at a source time: "mix" the two neighbours by the fraction (a 24/25 fps clip runs even at 30, and a slowed
   *  one smooth), or "step" to the nearest real frame (a slowed move that must not double). */
  function footFrame(S, name, s, mode = "mix") {
    const f0 = FOOT[name], f = clamp(s * f0.fps, 0, f0.frames - 1);
    if (mode === "step") return S.A[`${name}#${Math.round(f) + 1}`];
    const i = Math.floor(f), a = f - i, im0 = S.A[`${name}#${i + 1}`];
    if (a < 0.04 || i + 2 > f0.frames) return im0;
    const im1 = S.A[`${name}#${i + 2}`]; if (a > 0.96) return im1;
    if (!blendCv) { blendCv = document.createElement("canvas"); blendCv.width = 1080; blendCv.height = 1920; }
    const c = blendCv.getContext("2d"); c.globalAlpha = 1; c.drawImage(im0, 0, 0, 1080, 1920); c.globalAlpha = a; c.drawImage(im1, 0, 0, 1080, 1920); c.globalAlpha = 1;
    return blendCv;
  }

  // ------------------------------------------------------------------------------------------------ the one grade
  /** Contrast up, colour down (sat), two degrees cool, the vignette; `cold` 0..1 is the freeze going cold: saturation
   *  down a third, the cast cooler and a touch of blue lifted into it (a chill, not a dim: exposure moves by `drop`
   *  only), the vignette and the grain (in frame()) up. */
  function grade(S, img, o) {
    const { ctx } = S, cold = o.cold || 0, sat = o.sat * (1 - cold / 3);
    ctx.save();
    ctx.filter = `brightness(${(o.pre ?? 1).toFixed(3)}) contrast(${((o.contrast ?? 1.22) + 0.04 * cold).toFixed(3)}) saturate(${sat.toFixed(3)}) brightness(${((o.bright ?? 1) * (1 - (o.drop ?? 0.03) * cold)).toFixed(3)})`;
    X0.cover(ctx, img, 0, 0, 1080, 1920, { zoom: o.zoom ?? 1, dx: o.dx ?? 0, dy: o.dy ?? 0 });
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgb(${Math.round(lerp(238, 224, cold))},${Math.round(lerp(242, 238, cold))},${Math.round(lerp(250, 255, cold))})`; ctx.fillRect(0, 0, 1080, 1920);
    if (cold > 0) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = `rgb(0,${Math.round(2 * cold)},${Math.round(7 * cold)})`; ctx.fillRect(0, 0, 1080, 1920); }
    ctx.restore();
    X0.vignette(ctx, 1080, 1920, (o.vig ?? 0.42) + 0.06 * cold);
  }
  /** Archive flicker: the gate's light breathing a couple of per cent, frame by frame. */
  const flicker = (t, amt = 0.025) => 1 + amt * (X0.hash(Math.floor(t * 24) * 13 + 5) - 0.5);
  /** Hold 2's push-in: 100 % to 108 % from the cut to the freeze, about the rocket (x 605), stopping dead with the frame. */
  const ROCKET_X = 605;
  const push = (t) => { const z = 1 + 0.08 * clamp((t - T.b0) / (T.fz2 - T.b0)); return { zoom: z, dx: -(ROCKET_X - 540) * (z - 1), dy: 0 }; };

  // ------------------------------------------------------------------------------------------------ type and layout (measured)
  let L = null;
  function measure(S) {
    const { ctx } = S, bad = [];
    ctx.save(); ctx.font = X0.font(900, 100); const cap = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    // the hold cards: Code bot's head and name (44 px), one ink Geist line at 0.045w; sized to the line plus 0.04w a side
    const cardSize = Math.round(0.045 * 1080), cardF = X0.font(600, cardSize);
    const headRow = 36 + 84 + 20 + X0.width(ctx, "Code bot", X0.font(600, LABEL));
    const cards = ["Safe copy made", "Tests passed"].map((text) => { const tw = X0.width(ctx, text, cardF); return { text, tw, w: Math.round(Math.max(tw + 36, headRow) + 43), h: 232 }; });
    const cardW = Math.max(...cards.map((c) => c.w));   // both cards one size: the second lands where the first did
    cards.forEach((c) => { c.w = cardW; c.x = Math.round((1080 - cardW) / 2); c.y = Math.round(960 - c.h / 2); });
    // the tiles: the same cards scaled so their line is 44 px (the name drawn larger to stay 44 px too), askew at the top right
    const tileS = 44 / cardSize;
    const tiles = [{ cy: 300, rot: -0.045, left: 558 }, { cy: 512, rot: 0.035, left: 548 }];
    tiles.forEach((tl) => { tl.cx = Math.round(tl.left + (cardW * tileS) / 2); tl.s = tileS; });
    // the big card: head and name, "Go live?" heavy at 0.07w cap height, the dip-pen Yes (0.3w) and Not now, two ink lines at 44 px
    const askSize = Math.round(0.07 * 1080 / cap), askF = X0.font(900, askSize), lineF = X0.font(400, 44);
    const LINES = ["It asked one thing. You answered.", "Nothing is live."], ASKED = "It asked one thing.";
    const lineW = Math.max(...LINES.map((s) => X0.width(ctx, s, lineF))), yesW = Math.round(0.3 * 1080), noW = Math.round(0.2 * 1080), gap = 40;
    const innerW = Math.max(lineW, yesW + gap + noW, X0.width(ctx, "Go live?", askF));
    const big = { w: Math.round(innerW + 43 * 2), pad: 43, askedW: X0.width(ctx, ASKED + " ", lineF), nothingW: X0.width(ctx, LINES[1], lineF) };
    const fr0 = S.A["pen-frame"], yesH = Math.round(yesW * fr0.height / fr0.width), noH = Math.round(noW * fr0.height / fr0.width);
    big.headY = 36; big.askBase = big.headY + 84 + 70 + Math.round(cap * askSize); big.btnY = big.askBase + 52; big.line0 = big.btnY + yesH + 70; big.line1 = big.line0 + 60;
    big.h = big.line1 + 46; big.x = Math.round((1080 - big.w) / 2); big.y = Math.round(985 - big.h / 2);
    Object.assign(big, { askSize, askF, lineF, LINES, ASKED, yesW, yesH, noW, noH, gap });
    if (big.x + big.pad + innerW > RIGHT) bad.push(`big card text past 0.88w (${(big.x + big.pad + innerW).toFixed(0)})`);
    // the 'Live' stamp: the campaign's hand-drawn stamp (0.3w), in the card's top-right corner beside the head, as in The Hold
    const stamp = { w: Math.round(0.3 * 1080) }; stamp.h = Math.round(stamp.w * S.A.stamp.height / S.A.stamp.width * 1.25);
    stamp.cx = big.x + big.w - big.pad - stamp.w / 2 + 6; stamp.dy = big.headY + 50;
    if (stamp.cx + stamp.w / 2 > RIGHT) bad.push(`stamp past 0.88w (${(stamp.cx + stamp.w / 2).toFixed(0)})`);
    // the hero: over the Yes button (52 px to its left, clear of the tiles), his head clear of the card
    const hs = 500, s = hs / 544, yesCx = big.x + big.pad + yesW / 2;
    const hero = { size: hs, s, x: Math.round(yesCx - 271 * s) - 52, y: Math.round(big.y - 84 - 405 * s) };
    hero.eye = { x: hero.x + 271 * s, y: hero.y + 262 * s };
    // the handwritten yes (0.09w Caveat) across the printed Yes
    const handF = X0.font(700, 150, "Caveat"), handW = X0.width(ctx, "yes", handF);
    // the headline: 0.09w cap height, two lines, 'yes' by hand; measured against 1026 px and the 0.88w edge; line 2 at 0.775h
    const hSize = Math.round(0.09 * 1080 / cap), hBase = [0, Math.round(0.775 * 1920)]; hBase[0] = hBase[1] - Math.round(hSize * 1.16);
    const hLines = [["You", "say", "yes"], ["It", "goes", "live"]].map((ws, i) => X0.layout(ctx, ws.map((w) => (i === 0 && w === "yes" ? { text: w, hand: true, handWeight: 700, scale: 1.3 } : { text: w })), { x: X, y: hBase[i], size: hSize, weight: 900, color: "#FFFFFF" }));
    hLines.forEach((l, i) => { if (l.w > 1026 || X + l.w > RIGHT) bad.push(`headline line ${i + 1} ${l.w.toFixed(0)} px`); });
    if (hBase[1] > 0.78 * 1920) bad.push("headline baseline below 0.78h");
    const SMALL = ["A safe copy. The tests.", "A question when it needs you."], smallF = X0.font(400, 44), smallBase = [Math.round(0.60 * 1920) - 58, Math.round(0.60 * 1920)];
    SMALL.forEach((s2) => { if (X + X0.width(ctx, s2, smallF) > RIGHT) bad.push(`small "${s2}"`); });
    cards.forEach((c) => { if (c.x + 36 + c.tw > RIGHT) bad.push(`card "${c.text}"`); });
    tiles.forEach((tl) => { const right = tl.cx - (cardW * tl.s) / 2 + (36 + cards[0].tw) * tl.s + 8; if (right > RIGHT) bad.push(`tile text to ${right.toFixed(0)}`); });
    L = { cap, cardSize, cardF, cards, tiles, big, stamp, hero, handF, handW, hSize, hBase, hLines, SMALL, smallF, smallBase };
    if (bad.length) console.error("07 type check: " + bad.join("; "));
    if (S.q.get("hud")) console.warn(`07 measure: cap ${cap.toFixed(3)} card ${cardW} big ${big.w}x${big.h} at ${big.x},${big.y} ask ${askSize}px hero ${hero.x},${hero.y} H ${hSize}px (${hLines.map((l) => l.w.toFixed(0)).join(", ")}) tiles ${tiles.map((tl) => tl.cx).join(",")} stamp ${stamp.cx}`);
    return L;
  }

  // ------------------------------------------------------------------------------------------------ the cards
  /** A taped card as the kit draws it (AD.card), with the bot's name at `label` px (the kit's is 38, under the 44 floor). */
  function paperCard(S, o) {
    const { ctx, A } = S, k = clamp(o.k ?? 1); if (k <= 0) return;
    const { w, h, x, y } = o, cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(o.rot ?? -0.04); const press = 1.14 - 0.14 * E.o5(k); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, 26); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, 26); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, 26); ctx.stroke();
    const hs = 84; ctx.drawImage(A["head-code"], x + 36, y + 30, hs, hs); X0.text(ctx, "Code bot", x + 36 + hs + 20, y + 30 + hs * 0.68, X0.font(600, o.label ?? LABEL), MOSS);
    X0.text(ctx, o.text, x + 36, y + 30 + hs + 64, L.cardF, C.ink);
    const tw = 230, th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx + (o.tapeDx ?? 0), y + 2); ctx.rotate(o.tapeRot ?? -0.07); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore();
    ctx.restore();
  }
  const holdCard = (S, i, k) => { const c = L.cards[i]; paperCard(S, { x: c.x, y: c.y, w: c.w, h: c.h, rot: i ? 0.022 : -0.03, k, text: c.text, tapeDx: i ? 70 : -60, tapeRot: i ? -0.04 : -0.08 }); };
  function tile(S, i) {
    const { ctx } = S, c = L.cards[i], tl = L.tiles[i];
    ctx.save(); ctx.translate(tl.cx, tl.cy); ctx.rotate(tl.rot); ctx.scale(tl.s, tl.s); ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
    paperCard(S, { x: c.x, y: c.y, w: c.w, h: c.h, rot: 0, k: 1, text: c.text, label: Math.round(LABEL / tl.s), tapeDx: i ? 70 : -60, tapeRot: i ? -0.04 : -0.08 });
    ctx.restore();
  }
  /** Letters typed evenly over [t0, t0 + d]: how many show at t. */
  function typedN(t, t0, d, s) { if (t < t0) return 0; return Math.min(s.length, 1 + Math.floor((t - t0) / d * s.length)); }
  /** The big card: slides up (10 f), the question, the buttons, the lines; "Nothing is live." typed at 9.6, "You answered."
   *  as the pen finishes, and "Nothing is live." struck through with one ink hairline as the stamp lands. */
  function bigCard(S, t) {
    const { ctx, A } = S, b = L.big, ks = E.o3(fr(t, T.p0, T.slideD)), dy = (1 - ks) * 1180;
    const x = b.x, y = b.y + dy;
    ctx.save();
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, b.w, b.h, 26); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, b.w, b.h, 26); ctx.clip(); X0.cover(ctx, A.paper, x, y, b.w, b.h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, b.w, b.h, 26); ctx.stroke();
    const px = x + b.pad;
    ctx.drawImage(A["head-code"], px, y + b.headY, 84, 84); X0.text(ctx, "Code bot", px + 84 + 20, y + b.headY + 84 * 0.68, X0.font(600, LABEL), MOSS);
    X0.text(ctx, "Go live?", px, y + b.askBase, b.askF, C.ink);
    // the dip-pen buttons: 'Yes', and the smaller 'Not now' beside it; the printed Yes gives way to the ink as the hand writes
    const yb = y + b.btnY, im = A["pen-frame"];
    const give = 1 - E.io(fr(t, T.pen0, 0.2));
    ctx.drawImage(im, px, yb, b.yesW, b.yesH); if (give > 0) X0.text(ctx, "Yes", px + b.yesW / 2, yb + b.yesH / 2 + 20, X0.font(600, 56), C.ink, "center", { alpha: give });
    const nx = px + b.yesW + b.gap, ny = yb + (b.yesH - b.noH) / 2;
    ctx.drawImage(im, nx, ny, b.noW, b.noH); X0.text(ctx, "Not now", nx + b.noW / 2, ny + b.noH / 2 + 15, X0.font(500, 44), "#333333", "center");
    X0.text(ctx, b.ASKED, px, y + b.line0, b.lineF, C.ink);
    const ans = b.LINES[0].slice(b.ASKED.length + 1), na = typedN(t, T.answered, T.answeredD, ans);
    if (na > 0) X0.text(ctx, ans.slice(0, na), px + b.askedW, y + b.line0, b.lineF, C.ink);
    const n = typedN(t, T.nothing, T.nothingD, b.LINES[1]); if (n > 0) X0.text(ctx, b.LINES[1].slice(0, n), px, y + b.line1, b.lineF, C.ink);
    if (t >= T.land) {   // the strike: one ink hairline, drawn across in 3 frames
      const k = E.o3(fr(t, T.land, F(3))), ly = y + b.line1 - 15, x0 = px - 8, x1 = px + b.nothingW + 10;
      ctx.save(); ctx.strokeStyle = C.ink; ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x0, ly + 3); ctx.lineTo(lerp(x0, x1, k), ly + 3 - 6 * k); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    return { px, yb, y };
  }
  /** The handwritten 'yes' across the printed Yes (12.0-12.7); returns the pen's front. */
  function handYes(S, t, at) {
    if (t < T.pen0) return null;
    const { ctx } = S, b = L.big, k = E.io(fr(t, T.pen0, T.pen1 - T.pen0));
    const x0 = at.px + b.yesW / 2 - L.handW / 2 + 10, base = at.yb + b.yesH / 2 + 22;
    ctx.save(); ctx.translate(x0, base); ctx.rotate(-0.08);
    ctx.beginPath(); ctx.rect(-20, -170, (L.handW + 40) * k, 260); ctx.clip();
    X0.text(ctx, "yes", 0, 0, L.handF, C.ink); ctx.restore();
    return { x: x0 + L.handW * k, y: base - 40, k, x0 };
  }
  /** The campaign's hand-drawn stamp, inked in moss with 'Live': lands 1.3 -> 1.0 in 2 f in the card's top-right corner. */
  let stampCv = null;
  function liveStamp(S, t, at) {
    if (t < T.stamp) return;
    const { ctx, A } = S, st = L.stamp, k = fr(t, T.stamp, F(2)), sc = 1.3 - 0.3 * E.o3(k), w = st.w, h = st.h;
    if (!stampCv) {
      stampCv = document.createElement("canvas"); stampCv.width = w + 40; stampCv.height = h + 40;
      const c = stampCv.getContext("2d"); c.translate(20, 20);
      const ti = X0.tint(A.stamp, MOSS);
      for (const [ox, oy] of [[0, 0], [1.5, 1], [-1, 1.5]]) c.drawImage(ti, ox, oy, w, h);   // the rule, inked a little heavy
      c.font = X0.font(800, Math.round(h * 0.56)); c.fillStyle = MOSS; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillText("Live", w / 2, h / 2 + h * 0.2);
      // the ink's bite: a seeded speckle taken out of it, heavier at one edge, as a rubber stamp leaves it
      c.globalCompositeOperation = "destination-out"; const r = X0.rng(77);
      for (let i = 0; i < 1400; i++) { const px = r() * (w + 20) - 10, py = r() * (h + 20) - 10, rr = 0.6 + r() * 1.8; c.globalAlpha = 0.25 + 0.6 * r() * (0.4 + 0.6 * px / w); c.beginPath(); c.arc(px, py, rr, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
    }
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = Math.min(1, 0.45 + k) * 0.94;
    ctx.translate(st.cx, at.y + st.dy); ctx.rotate(-0.11); ctx.scale(sc, sc); ctx.drawImage(stampCv, -(w + 40) / 2, -(h + 40) / 2); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the hero
  /** A blink as a lid: the eyes' height 1 -> 0.1 in 2 f, shut 1 f, open in 3 f. */
  const blinkK = (t) => { for (const b of T.blinks) { if (t >= b && t < b + F(6)) { const u = t - b; return u < F(2) ? u / F(2) : u < F(3) ? 1 : 1 - (u - F(3)) / F(3); } } return 0; };
  function hero(S, t, pen) {
    if (t < T.in0) return;
    const { ctx, A } = S, H = L.hero;
    const kin = fr(t, T.in0, T.in1 - T.in0), y = H.y - (1 - E.back(0.9)(kin)) * 760;
    const settle = Math.max(0, t - T.in1);
    let sway = 0.9 * Math.sin(settle * 2.5) * Math.exp(-settle * 0.9) + 0.35 * Math.sin(t * 1.3 + 0.7);
    const bob = 1.6 * Math.sin(t * 1.9);
    // the eyes (art px; 1 art px = 0.92 screen px): at us; down at the button 8.0-8.7 (a 20 px drop); after the pen's
    // front 12.0-12.7 (a 28 px sweep, the head tipping 2.5 degrees with it); wide for one frame on the stamp, then to it
    let dx = 0, dy = 0;
    const kd = E.io(fr(t, T.lookDown, F(6))) * (1 - E.io(fr(t, T.lookUs, F(6))));
    dx += -3 * kd; dy += 21 * kd;
    if (t >= T.pen0 - F(5)) {
      const kp = E.io(fr(t, T.pen0 - F(5), F(5))) * (1 - E.io(fr(t, T.land + F(1), F(4))));
      const kx = pen ? clamp((pen.x - pen.x0) / L.handW) : 0;
      dx = lerp(dx, lerp(-15, 15, kx), kp); dy = lerp(dy, 19, kp); sway += lerp(2.5, -2.5, kx) * kp;
    }
    // the stamp lands (f+2): his eyes go wide for that one frame, then turn to it (right, a little down)
    const wide = t >= T.land && t < T.land + F(1) ? 1.3 : 1;
    if (t >= T.land + F(1)) { const kg = E.io(fr(t, T.land + F(1), F(4))); dx = lerp(dx, 16, kg); dy = lerp(dy, 10, kg); }
    const lid = 1 - 0.9 * blinkK(t);
    X0.hang(ctx, A, H.x, y, H.size, null, { eyes: { dx, dy, sx: wide, sy: wide * lid }, bob, sway });
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
    // the small line above it: settled, in one frame on the moss bell (the film's one slam stays the headline's)
    if (t >= T.small) L.SMALL.forEach((s, i) => AD.onFilm(S, s, X, L.smallBase[i], L.smallF, "rgba(255,255,255,0.96)"));
  }

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
          grade(S, footFrame(S, "a", sa, t > T.lift ? "step" : "mix"), { sat: 0.6, cold, contrast: 1.2, bright: 1.0, drop: 0.04 });
          AD.bars(S, BAR_H);
          if (!notype && t >= T.card1) holdCard(S, 0, fr(t, T.card1, F(6)));
          X0.grain(ctx, 1080, 1920, t, 0.11 + 0.06 * cold, 1);
          info = `A src ${sa.toFixed(2)} f${(sa * 25 + 1).toFixed(2)}${cold ? " cold " + cold.toFixed(2) : ""}`;
        } else {
          const cold = E.o3(fr(t, T.fz2, F(6))), sb = mapB(t);
          grade(S, footFrame(S, "b", sb), { sat: 0.12, cold, contrast: 1.18, bright: 1.04 * flicker(t > T.fz2 ? T.fz2 : t), drop: 0.13, ...push(t) });
          AD.bars(S, BAR_H);
          if (!notype && t >= T.card2) holdCard(S, 1, fr(t, T.card2, F(6)));
          X0.grain(ctx, 1080, 1920, t, 0.12 + 0.08 * cold, 1);
          info = `B src ${sb.toFixed(2)} f${(sb * 23.976 + 1).toFixed(2)}${cold ? " cold " + cold.toFixed(2) : ""}`;
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
      } else if (t < T.e0) {
        const sc = mapC(t);
        // levels for the room: its flat, lifted print brought to the pad's and the climb's black and white points
        grade(S, footFrame(S, "c", sc), { sat: 0.12, contrast: 1.42, bright: 1.2 * flicker(t), pre: 0.9 });
        AD.bars(S, BAR_H);
        X0.grain(ctx, 1080, 1920, t, 0.11, 1);
        info = `C src ${sc.toFixed(2)}`;
      } else if (t < T.d0) {
        const se = mapE(t);
        grade(S, footFrame(S, "e", se), { sat: 0.05, contrast: 1.35, pre: 2.2, bright: 1.0 * flicker(t) });
        AD.bars(S, BAR_H);
        X0.grain(ctx, 1080, 1920, t, 0.11, 1);
        info = `E src ${se.toFixed(2)}`;
      } else if (t < T.end0 + F(14)) {
        const sd = mapD(t);
        grade(S, footFrame(S, "d", sd), { sat: 0.12, contrast: 1.2, bright: 0.96 * flicker(t) });
        // the ink under the type: a 40 % (and more) gradient over the lower third, there from the cut
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
      smp(T.card1, "tape", 0.75); c.push({ at: T.card1 + F(5), kind: "paper-thud", gain: 0.5 }, { at: T.card1 + F(8), kind: "bell", f: 493.88, dur: 1.0, gain: 0.4 });
      // hold 2: wind and the vent's hiss (its 1.6 s, hard in on the cut, dead on the freeze); the tape
      smp(T.b0, "pad", 1);
      smp(T.card2, "tape", 0.72); c.push({ at: T.card2 + F(5), kind: "paper-thud", gain: 0.5 });
      // paper: the card's slide; the drone on E from 7.7, the high sine from 9.7, both cut by the stamp
      smp(T.p0, "slide", 0.55);
      smp(T.p0, "air", 1);
      c.push({ at: T.drone, kind: "drone", f: 82.41, dur: T.stamp - T.drone, a: 3.2, r: 0.008, gain: 0.42 });
      for (let i = 0; i < L.big.LINES[1].length; i++) if (L.big.LINES[1][i] !== " ") c.push({ at: +(T.nothing + i * T.nothingD / L.big.LINES[1].length).toFixed(4), kind: "tick", gain: 0.22 });
      smp(T.sine, "sine", 0.3);
      smp(T.pen0, "pen-yes", 0.7);
      { const ans = L.big.LINES[0].slice(L.big.ASKED.length + 1); for (let i = 0; i < ans.length; i++) if (ans[i] !== " ") c.push({ at: +(T.answered + i * T.answeredD / ans.length).toFixed(4), kind: "tick", gain: 0.2 }); }
      smp(T.stamp, "thunk", 0.95); c.push({ at: T.stamp, kind: "boom", f0: 56, f1: 32, dur: 0.9, gain: 0.5 });
      c.push({ at: T.land, kind: "tick", gain: 0.3 });   // the pen's tick on the strike
      // the release: one boom, a room of chairs, a riser into the slam; the engines and the long rumble
      c.push({ at: T.c0, kind: "boom", gain: 0.85 }); smp(T.c0, "chairs", 0.9); c.push({ at: T.c0, kind: "riser", dur: T.slam - T.c0, gain: 0.55 });
      smp(T.e0, "rumble", 1);
      c.push({ at: T.slam, kind: "boom", gain: 0.75 });
      smp(T.hand0, "pen-hand", 0.6); c.push({ at: T.ul0, kind: "whoosh", dur: 0.3, up: false, gain: 0.34 }, { at: T.ul1, kind: "bell", f: 493.88, dur: 1.6, gain: 0.42 });
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
