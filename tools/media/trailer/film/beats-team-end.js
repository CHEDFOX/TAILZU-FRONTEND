/* BEATS 11-13: THE TEAM (f864-f984), THE RETURN AND THE MARK PAINTED (f984-f1088), COMING SOON AND THE WINK (f1088-f1184).
 *
 *   team    the Code thesis ('Nothing goes live / till you say yes') stays on the page from the beat before and wipes out
 *           left over f896-f904; the done cards slide in as a tidy deck at the bottom; the hero rises behind its edge
 *           (bot-hello) with his face LIFT px above the deck so his eyes stand clear of the heads, his shell continuing down
 *           to the edge, one glove raised beside his cheek; four dotted heads pop up in front of him on the 8ths, each with
 *           its name; a pencil-dashed 'yours' slot; 'Your team / of bots' with the icon's clay underline; the wave, the
 *           heads turning to him, the little bob wave, the ducks, the exit (over f976-f984).
 *   return  one clay dot holds an 8th; the bar dry-brushes itself from the dot in its own silhouette; two gloves slap on;
 *           he swings down from behind it eyes shut, settles, opens his eyes on you; the X0 mark paints in three strokes,
 *           the 0 closing on the loudest beat with a press and ink specks.
 *   end     the end card: the hero at the opening's transform, the mark, 'Your team of bots', the dip-pen stamp frame with
 *           'Coming soon' and 'x0bot.com'; a blink, a look at the frame, back at you, the wink; then dead still, so the loop
 *           back to frame 0 is a quiet cut.
 *
 * Everything is a pure function of the frame (seeded specks, no clocks). Layout px (S.L); both cuts from one timeline.
 */
(() => {
  "use strict";
  const { E, K, clamp, C, lerp } = X0;
  const { fr } = CM;
  const D = X0.deg;
  const HANG = X0.hang;

  // ------------------------------------------------------------------------------------------------ caches
  const cache = new Map();
  const memo = (S, key, make) => { const k = `${S.W}x${S.H}|${key}`; if (!cache.has(k)) cache.set(k, make()); return cache.get(k); };
  const poly = (c, pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); };

  // ================================================================================================ BEAT 11: the team
  const TF = {
    in: 864, pops: [872, 880, 888, 896, 904],
    l1: 912, l2: 920, hand: 924, ul: 936, wave: 936, turn: 944, you: 948,
    bobs: [952, 956, 960, 964], ducks: [980, 976, 972, 968], ringOut: 968, heroDuck: 980, headOut: 974, deckOut: 976,
  };
  const NAMES = ["Keybot", "Plan", "Travel", "Code bot"], HEADS = ["head-keybot", "head-plan", "head-travel", "head-code"], NAME_DX = [-4, 0, -10, 10];
  /** The face's ledge sits this far above the deck edge: his eyes (16 px above the sprite's ledge) then clear the heads' antenna tips. */
  const LIFT = 120;

  // ---------------------------------------------------------------------------- the Code thesis, carried over from the golive beat
  /** The golive headline as beats-travel-code.js sets it (its headFit: 96 in 9:16; in 16:9 the widest line fitted to the left column,
   *  x 96 .. the stage card), redrawn here from f864 so the thesis holds while the deck slides in, then wiped left over f896-f904. */
  const GOLIVE = { lines: ["Nothing goes live", "till you say yes"], hand: { line: 1, word: "yes" }, at: { l1: 820, l2: 828, hand: 832, ul: 840 }, out: { f: 896, n: 8 } };
  function headFit(S, lines, hand) {
    return memo(S, "head|" + lines.join("|"), () => {
      const { ctx, L } = S; let size = L.headSize, hs = L.handSize;
      if (!S.portrait) {
        const maxW = L.stage.x - 28 - L.textX; let w = 0;
        lines.forEach((text, i) => {
          const words = text.split(" ").map((t) => (i === hand.line && t === hand.word ? { text: t, hand: true, handWeight: 700, scale: hs / size } : { text: t }));
          w = Math.max(w, X0.layout(ctx, words, { x: 0, y: 0, size, weight: 900, gap: 0.24 }).w);
        });
        if (w > maxW) { size = Math.floor(size * maxW / w); hs = Math.round(size * L.handSize / L.headSize); }
      }
      return { size, handSize: hs };
    });
  }
  const goliveCarry = (S, f) => { if (f >= GOLIVE.out.f + GOLIVE.out.n) return; CM.headline(S, f, { ...GOLIVE, ul: S.A["ul-code"], ...headFit(S, GOLIVE.lines, GOLIVE.hand) }); };

  function teamGeo(S) {
    const { L } = S, t = L.team;
    // the deck's top card has every other card's geometry: the stage card's left edge, its right edge at the copy card's (+17)
    const deckX = L.stage.x, deckW = L.stage.w + 17;
    return { ...t, deckX, deckW, top: t.deckTop, H: L.H, W: L.W };
  }
  /** The deck's top edge at f: in from the bottom (E.o3, 9 f) at f864; off the bottom (E.i3, 8 f) from f976. Everyone rides it. */
  function deckTop(S, f) {
    const g = teamGeo(S);
    if (f < TF.in + 9) return g.top + (g.H + 60 - g.top) * (1 - E.o3(fr(f, TF.in, 9)));
    if (f >= TF.deckOut) return g.top + (g.H + 80 - g.top) * E.i3(fr(f, TF.deckOut, 8));
    return g.top;
  }
  /** The four done cards as a tidy deck: stacked with 14 px offsets, the top card's edge at `top`, running off the bottom.
   *  One pencil shadow for the whole deck (the back-most card's); the front cards are white edges with hairlines between. */
  function drawDeck(S, top) {
    const g = teamGeo(S); if (top >= g.H) return;
    for (let i = 3; i >= 0; i--) CM.stageCard(S, g.deckX + 14 * i, top + 14 * i, g.deckW, g.H + 140 - top, { r: 28, shadow: i === 3 ? 0.5 : 0 });
  }
  /** His rise behind the deck's edge: E.back(1.3) over 10 f from f864 (> 1 is the overshoot); the duck at f980 (E.i2, 4 f). */
  function heroRise(f) {
    if (f < TF.in) return 0;
    let r = E.back(1.3)(fr(f, TF.in, 10));
    if (f >= TF.heroDuck) r = Math.min(r, 1) * (1 - E.i2(fr(f, TF.heroDuck, 4)));
    return r;
  }
  /** The peek rig's glove sprites at their resting places for a face `w` wide with its ledge at (x, y): the rig's own arithmetic. */
  function rigGloves(S, pose, x, y, w) {
    const R = S.R, fm = R.meta[`bot-${pose}-nohands`], s = w / fm.w, up = fm.ledge * s;
    return { s, up, h: fm.h * s, gloves: ["glove-L", "glove-R"].map((n) => { const gm = R.meta[n], gx = (gm.x0 - fm.x0) * s, gy = (gm.y0 - fm.y0) * s, gw = gm.w * s, gh = gm.h * s; return { img: R.img[n], cx: x - w / 2 + gx + gw / 2, cy: y - up + gy + gh / 2, w: gw, h: gh }; }) };
  }
  /** His face follows each pop: 6 px toward the head over 4 f, back over the next 4 (Travel, right under him: a 5 px nod); f948 he looks at you. */
  function faceFollow(S, f) {
    const g = teamGeo(S); let dx = 0, dy = 0;
    TF.pops.forEach((fp, i) => {
      if (f < fp || f >= fp + 8) return;
      const k = f < fp + 4 ? E.io(fr(f, fp, 4)) : 1 - E.io(fr(f, fp + 4, 4)), d = g.slots[i] - g.heroX, dir = Math.abs(d) < 40 ? 0 : Math.sign(d);
      dx += 6 * dir * k; dy += (dir === 0 ? 5 : 2) * k;
    });
    if (f >= TF.you) dy -= 4 * E.o3(fr(f, TF.you, 4));
    return { dx, dy };
  }
  /** The raised glove's wave about its wrist (radians): two swings over 16 f from f936, eased in and out. */
  function waveRot(f) {
    if (f < TF.wave || f >= TF.wave + 16) return 0;
    const k = fr(f, TF.wave, 16); return D(12) * Math.sin(k * Math.PI * 4) * Math.pow(Math.sin(Math.PI * k), 0.3);
  }
  /** One dotted head's offsets at f: the pop (+140 -> 0, E.back 1.4, 8 f), the wobble, the turn to him at f944, the little bob
   *  wave on 16ths, the duck (E.i2, 5 f, behind the deck). Null before its pop. */
  function headState(S, f, i) {
    const g = teamGeo(S), fp = TF.pops[i]; if (f < fp) return null;
    let dy = 140 * (1 - E.back(1.4)(fr(f, fp, 8))), dx = 0, rot = 0;
    if (f >= fp + 8 && f < fp + 17) { const k = fr(f, fp + 8, 9); rot = D(3) * Math.sin(k * Math.PI * 4) * (1 - k); }
    if (f >= TF.turn) { const d = g.slots[i] - g.heroX, k = E.io(fr(f, TF.turn, 4)); if (Math.abs(d) > 40) dx = -6 * Math.sign(d) * k; else dy -= 4 * k; }
    const fb = TF.bobs[i], fd = TF.ducks[i];
    if (fb < fd && f >= fb && f < fb + 4) dy -= 6 * E.bump(fr(f, fb, 4));
    if (f >= fd) dy += 140 * E.i2(fr(f, fd, 5));
    return { dx, dy, rot };
  }
  /**
   * The hero in the team row: bot-hello (no gloves) rising behind the deck's edge, clipped at the edge, with his face's ledge
   * LIFT px above the deck so his eyes stand clear of the heads; under the face his shell continues to the deck edge (the
   * sprite is cut flat at its ledge: its last opaque rows stretched down, inside the same clip). His right glove hangs over
   * the deck edge itself; his left glove is raised beside his cheek (the glove sprite, fingers up, turned about its wrist for
   * the wave). The rise and the duck travel the whole way (up + LIFT), so he is fully below the edge at r = 0. The heads are
   * drawn after (they occlude his chin and gloves by design).
   */
  function teamHero(S, f, top) {
    const { ctx, R } = S, g = teamGeo(S), r = heroRise(f); if (r <= 0) return null;
    const rig = rigGloves(S, "hello", g.heroX, top, g.heroW), fol = faceFollow(S, f), fm = R.meta["bot-hello-nohands"], face = R.img["bot-hello-nohands"];
    const travel = rig.up + 6 + LIFT, over = Math.max(0, r - 1) * travel, riseOff = (1 - Math.min(1, r)) * travel - over;
    const ledgeY = top - LIFT;
    ctx.save(); ctx.beginPath(); ctx.rect(0, -20, g.W, top + 20); ctx.clip();   // behind the deck's edge
    // peekRig adds its own (1 - r) * (up + 6) to dy, so the extra LIFT share of the travel goes in here
    X0.peekRig(ctx, R, "hello", g.heroX, ledgeY, g.heroW, Math.min(1, r), { dx: fol.dx, dy: fol.dy - over + (1 - Math.min(1, r)) * LIFT, gloves: [{ hide: true }, { hide: true }] });
    const y0 = ledgeY + riseOff + fol.dy - 1, rows = 4;   // the shell under the face: the sprite's last 4 opaque rows, down to the clip
    if (top + 20 > y0) ctx.drawImage(face, 0, Math.floor(fm.ledge) - rows, fm.w, rows, g.heroX - g.heroW / 2 + fol.dx, y0, g.heroW, top + 20 - y0);
    ctx.restore();
    const a = K(r, 0.6, 1);
    if (a <= 0) return { rig, fol, over, top, r, a };
    // the right glove hanging over the deck edge, in front of the deck
    const gR = rig.gloves[1]; ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(gR.img, gR.cx - gR.w / 2 + fol.dx, gR.cy - gR.h / 2 + fol.dy - over, gR.w, gR.h); ctx.restore();
    // the raised left glove: its wrist beside his left cheek, fingers up, riding the face
    const gL = rig.gloves[0], wrist = { x: g.heroX - g.heroW / 2 - 18 + fol.dx, y: ledgeY - 112 + riseOff + fol.dy };
    ctx.save(); ctx.beginPath(); ctx.rect(0, -20, g.W, top + 20); ctx.clip(); ctx.globalAlpha *= a;
    ctx.translate(wrist.x, wrist.y); ctx.rotate(waveRot(f)); ctx.scale(1, -1); ctx.drawImage(gL.img, -gL.w / 2, 0, gL.w, gL.h);
    ctx.restore();
    return { rig, fol, over, top, r, a };
  }
  /** The four heads (in front of him, behind the deck's edge while they rise), their names setting in 2 f later on the deck. */
  function heads(S, f, top) {
    const { ctx, A } = S, g = teamGeo(S), rideY = top - g.top;
    ctx.save(); ctx.beginPath(); ctx.rect(0, -20, g.W, top + 21); ctx.clip();
    for (let i = 0; i < 4; i++) {
      const h = headState(S, f, i); if (!h) continue;
      X0.img(ctx, A[HEADS[i]], g.slots[i] + h.dx, top - g.head / 2 + h.dy, g.head, { rot: h.rot });
    }
    ctx.restore();
    // the names, centred under their heads (Travel and Code bot nudged 10 px apart so the two never read as one phrase)
    for (let i = 0; i < 4; i++) {
      const fp = TF.pops[i] + 2; if (f < fp) continue;
      const k = E.o3(fr(f, fp, 2));
      X0.text(ctx, NAMES[i], g.slots[i] + NAME_DX[i], g.nameBase + rideY + 6 * (1 - k), X0.font(500, 44), C.ink, "center", { alpha: k });
    }
  }
  /** The fifth slot: the pencil-dashed grey ring drawing itself in pen order (8 f) with 'yours' written beneath; fades with Code bot. */
  function yoursSlot(S, f, top) {
    if (f < TF.pops[4]) return; const { ctx, A } = S, g = teamGeo(S), fp = TF.pops[4], rideY = top - g.top;
    const alpha = f >= TF.ringOut ? 1 - fr(f, TF.ringOut, 5) : 1; if (alpha <= 0) return;
    const cx = g.slots[4], cy = top - g.head / 2, d = 134;
    X0.reveal(ctx, A["pencil-ring"], cx - d / 2, cy - d / 2, d, d, E.lin(fr(f, fp, 8)), "conic", { rag: 4, seed: 9, period: 20, alpha });
    if (f >= fp + 2) {
      const font = X0.font(600, 52, "Caveat"), w = X0.width(ctx, "yours", font);
      ctx.save(); ctx.globalAlpha *= alpha; CM.scrawl(S, "yours", cx + 6 - w / 2, g.nameBase + rideY, 52, "#6B6B6B", E.lin(fr(f, fp + 2, 6)), 17, 600); ctx.restore();
    }
  }
  const teamHeadline = (S, f) => { const P = S.L.payoffHead; return CM.headline(S, f, { lines: ["Your team", "of bots"], hand: { line: 1, word: "bots" }, ul: S.A["ul-bar"], at: { l1: TF.l1, l2: TF.l2, hand: TF.hand, ul: TF.ul }, size: P.size, handSize: P.hand, base: P.base, x: S.L.textX, out: { f: TF.headOut, n: 8 } }); };

  FILM.register({
    name: "team", f0: 864, f1: 984,
    draw(S, f) {
      const top = deckTop(S, f);
      drawDeck(S, top);
      teamHero(S, f, top);
      heads(S, f, top);
      yoursSlot(S, f, top);
      teamHeadline(S, f);
      goliveCarry(S, f);   // the thesis from the beat before, held over the deck's arrival, wiped left f896-f904
    },
    cues() {
      const c = [{ f: TF.in, kind: "notify", gain: 0.5 }, { f: TF.in, kind: "whoosh", dur: 0.3, up: true, gain: 0.3 }];
      const bells = [293.66, 369.99, 440, 493.88];
      TF.pops.slice(0, 4).forEach((f, i) => c.push({ at: f / 30, kind: "bell", f: bells[i], dur: 1.0, gain: 0.35 }, { f, kind: "land", gain: 0.3 }));
      c.push({ at: TF.pops[4] / 30, kind: "bell", f: 659.25, dur: 0.6, gain: 0.3 });
      c.push({ f: TF.l1, kind: "tick", gain: 0.3 }, { f: TF.l2, kind: "tick", gain: 0.3 }, { f: TF.hand, kind: "write", gain: 0.4 });
      for (const hz of [...bells, 587.33]) c.push({ at: TF.ul / 30, kind: "bell", f: hz, dur: 1.6, gain: 0.3 });
      c.push({ at: TF.ul / 30, kind: "pad", f: 146.83, dur: 1.6, a: 0.3, r: 0.6, gain: 0.4 }, { f: TF.ul, kind: "whoosh", dur: 0.3, up: false, gain: 0.25 });
      TF.bobs.forEach((f, i) => { if (f < TF.ducks[i]) c.push({ f, kind: "tick", gain: 0.15 }); });   // a tick per bob that happens (headState's rule)
      for (const f of TF.ducks) c.push({ f, kind: "tick", gain: 0.12 });
      c.push({ f: TF.deckOut, kind: "whoosh", dur: 0.3, up: false, gain: 0.3 });
      return c;
    },
  });

  // ================================================================================================ BEAT 12: the return
  const RF = { dot: 984, stroke: 992, bar: 1008, slapL: 1016, slapR: 1020, drop: 1032, settle: 1048, eyes: 1056, x1: 1060, x2: 1068, zero: 1072, close: 1088 };

  /** The bar's dry-brush stroke already cut to the bar's silhouette, in the hero's frame: an offscreen the bar's box (plus a
   *  margin), the stroke laid along the bar and clipped by hang-bar's own alpha, its right quarter running dry. Cached per cut. */
  function barStroke(S) {
    return memo(S, "bar-stroke", () => {
      const { A, L } = S, T = L.hero, s = T.size / HANG.ART, m = 24;
      const bx0 = T.x + (147 / 3) * s - m, bx1 = T.x + (1485 / 3) * s + m, by0 = T.y + (416 / 3) * s - m, by1 = T.y + (585 / 3) * s + m;
      const cw = Math.ceil(bx1 - bx0), ch = Math.ceil(by1 - by0), cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      const c = cv.getContext("2d"), st = A["bar-stroke"], sw = cw, sh = sw * st.height / st.width;
      c.drawImage(st, 0, ch / 2 - sh / 2, sw, sh);
      c.globalCompositeOperation = "destination-in"; c.drawImage(A.bar, T.x - bx0, T.y - by0, T.size, T.size);
      c.globalCompositeOperation = "destination-out";
      const gr = c.createLinearGradient(m + (cw - 2 * m) * 0.72, 0, cw - m, 0); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.38)");
      c.fillStyle = gr; c.fillRect(0, 0, cw, ch);
      return { cv, x: bx0, y: by0, w: cw, h: ch, m };
    });
  }
  /** The hero through the return: the bar (hang's own) from f1008, the glove slaps, the swing-down with eyes shut, the eyes opening. */
  function returnHero(S, f) {
    if (f < RF.bar) return;
    const drop = fr(f, RF.drop, 16);
    let blink = 1; const eyes = { dx: 0, dy: 0, sx: 1, sy: 1 };
    if (f >= RF.eyes) { blink = 0; eyes.sy = [0.35, 0.9, 1.03, 1][Math.min(3, f - RF.eyes)]; }
    const bob = f >= RF.settle ? CM.bob(f) * E.io(fr(f, RF.settle, 16)) : 0;
    let reach = null, barDy = 0; const show = { head: true, bar: true, hands: f >= RF.slapL };
    if (f < RF.slapR + 8) {
      reach = [RF.slapL, RF.slapR].map((fs) => { if (f < fs) return { hide: true }; const k = E.o3(fr(f, fs, 3)); return { dy: -80 * (1 - k), grip: f >= fs + 3 && f < fs + 6 ? 0.12 : 0 }; });
      for (const fs of [RF.slapL, RF.slapR]) if (f >= fs + 3 && f < fs + 7) barDy += 0.9 * 4 * E.bump(fr(f, fs + 3, 4));
    }
    return CM.hero(S, "hero", null, { drop, blink, eyes, bob, reach, barDy, show });
  }

  // the mark: region canvases (the X cut to a band along slash 1; the whole X; the 0 alone) at its drawn size, 460 px wide
  const MARK = { w: 460, h: 460 * 958 / 1583, sc: 460 / 1583, xEnd: 760, zero: { x0: 790, x1: 1570, y0: 14, y1: 946 } };
  function band(p0, p1, hw, ext) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const a = [p0[0] - ux * ext, p0[1] - uy * ext], b = [p1[0] + ux * ext, p1[1] + uy * ext];
    return [[a[0] + nx * hw, a[1] + ny * hw], [b[0] + nx * hw, b[1] + ny * hw], [b[0] - nx * hw, b[1] - ny * hw], [a[0] - nx * hw, a[1] - ny * hw]];
  }
  /** The half-plane beyond one edge (side +1 / -1) of a band `hw` wide along p0 -> p1, as a far-reaching quad. */
  function halfPlane(p0, p1, hw, side, far = 4000) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = -uy * side, ny = ux * side;
    const a = [p0[0] - ux * far, p0[1] - uy * far], b = [p1[0] + ux * far, p1[1] + uy * far];
    return [[a[0] + nx * hw, a[1] + ny * hw], [b[0] + nx * hw, b[1] + ny * hw], [b[0] + nx * far, b[1] + ny * far], [a[0] + nx * far, a[1] + ny * far]];
  }
  function markRegions(S) {
    return memo(S, "mark", () => {
      const im = S.A["mark-x0-ink"], { w, h, sc } = MARK, P = (p) => [p[0] * sc, p[1] * sc];
      // the two strokes' centre lines, measured from the PNG (x = 62 + 0.675 y and x = 708 - 0.69 y); slash 1 alone is the X inside a
      // band a little wider than its ~95 px half-stroke, with stroke 2's ink erased where it crosses (stroke 2 covers that later).
      // The erase follows slash 1's own measured ink edges (~102 px on its screen-left side, ~93 on its right) inside a band just
      // wider than slash 2's ~86 px half-stroke, so the crossing section keeps the same ragged silhouette as the arms above and
      // below it and no clip edge crosses an ink margin (a flat 88 px cut left a notch and a hairline for the 10 f slash 1 is alone).
      const S1 = [P([89, 40]), P([669, 900])], S2 = [P([680, 40]), P([87, 900])];
      const b1 = band(S1[0], S1[1], 118 * sc, 70 * sc), b2 = band(S2[0], S2[1], 118 * sc, 70 * sc), b2t = band(S2[0], S2[1], 92 * sc, 70 * sc);
      const mk = (cw, ch) => { const cv = document.createElement("canvas"); cv.width = Math.ceil(cw); cv.height = Math.ceil(ch); return cv; };
      // (the erase runs with the b1 clip lifted: an anti-aliased clip edge applied to both the draw and the erase leaves a
      // partial-alpha hairline along b1 where slash 2's ink crosses it; without b1 nothing is beyond it to protect)
      const x1 = mk(w, h), c1 = x1.getContext("2d");
      c1.save(); c1.beginPath(); c1.rect(0, 0, MARK.xEnd * sc, h); c1.clip(); poly(c1, b1); c1.clip(); c1.drawImage(im, 0, 0, w, h); c1.restore();
      c1.save(); c1.globalCompositeOperation = "destination-out"; poly(c1, b2t); c1.clip();
      poly(c1, halfPlane(S1[0], S1[1], 102 * sc, 1)); c1.fill();    // +1: the screen-left edge of slash 1
      poly(c1, halfPlane(S1[0], S1[1], 93 * sc, -1)); c1.fill();
      c1.restore();
      const x2 = mk(w, h), c2 = x2.getContext("2d"); c2.beginPath(); c2.rect(0, 0, MARK.xEnd * sc, h); c2.clip(); c2.drawImage(im, 0, 0, w, h);
      const z = MARK.zero, zx0 = z.x0 * sc, zy = z.y0 * sc, zw0 = (z.x1 - z.x0) * sc, zh = (z.y1 - z.y0) * sc, zeroFull = mk(zw0, zh); zeroFull.getContext("2d").drawImage(im, -zx0, -zy, w, h);
      // the 0 is a digit, not an O: narrowed to 0.74 of its painted width about its own centre (the marks' brief: "a short x and a tall 0")
      const SQ = 0.74, zw = zw0 * SQ, zx = zx0 + (zw0 - zw) / 2, zero = mk(zw, zh); zero.getContext("2d").drawImage(zeroFull, 0, 0, zw, zh);
      const full = mk(w, h), cf = full.getContext("2d"); cf.drawImage(x2, 0, 0); cf.drawImage(zero, zx, zy);
      const len = w + h, s1 = b1.map((p) => p[0] + p[1]), s2 = b2.map((p) => w - (p[0] - p[1]));
      return { x1, x2, zero, zx, zy, zw, zh, k1: [Math.min(...s1) / len, Math.max(...s1) / len], k2: [Math.min(...s2) / len, Math.max(...s2) / len], full };
    });
  }
  /** The mark painting itself: slash 1 (diag, 6 f), slash 2 (-diag, 6 f), the 0 (conic from 12 o'clock, 16 f, E.io); the press
   *  as it closes; then whole. The ink specks thrown off the closing point persist. */
  function drawMark(S, f) {
    if (f < RF.x1) return; const { ctx, L } = S, R = markRegions(S), mx = L.mark.x, my = L.mark.y, { w, h } = MARK;
    ctx.save();
    if (f >= RF.close && f < RF.close + 2) { const s = f === RF.close ? 1.03 : 1.012; ctx.translate(mx + w / 2, my + h / 2); ctx.scale(s, s); ctx.translate(-(mx + w / 2), -(my + h / 2)); }
    if (f >= RF.close + 2) ctx.drawImage(R.full, mx, my, w, h);
    else {
      X0.reveal(ctx, R.x1, mx, my, w, h, lerp(R.k1[0] - 0.02, R.k1[1] + 0.03, E.o3(fr(f, RF.x1, 6))), "diag", { rag: 10, seed: 11, period: 26 });
      if (f >= RF.x2) X0.reveal(ctx, R.x2, mx, my, w, h, lerp(R.k2[0] - 0.02, R.k2[1] + 0.03, E.o3(fr(f, RF.x2, 6))), "-diag", { rag: 10, seed: 12, period: 26 });
      if (f >= RF.zero) X0.reveal(ctx, R.zero, mx + R.zx, my + R.zy, R.zw, R.zh, E.io(fr(f, RF.zero, 16)), "conic", { rag: 14, seed: 13, period: 30 });
    }
    ctx.restore();
    specks(S, f);
  }
  function specks(S, f) {
    if (f < RF.close) return; const { ctx, L } = S, R = markRegions(S), cx = L.mark.x + R.zx + R.zw / 2, cy = L.mark.y + R.zy + 4, r = X0.rng(1088);
    ctx.save(); ctx.fillStyle = C.ink; ctx.globalAlpha *= 0.9;
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.6, d = 16 + r() * 24, px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d, rad = 1 + r() * 1.5, n = 6 + Math.floor(r() * 3);
      ctx.beginPath(); for (let j = 0; j < n; j++) { const t = j / n * Math.PI * 2, rr = rad * (0.8 + 0.4 * r()); ctx.lineTo(px + Math.cos(t) * rr, py + Math.sin(t) * rr); } ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  FILM.register({
    name: "return", f0: 984, f1: 1088,
    draw(S, f) {
      const { ctx, A, L } = S;
      // the clay dot at the bar's left end, held an 8th (the frame the deck clears), then under the stroke
      if (f < RF.bar) X0.img(ctx, A["clay-dot"], L.dot.x, L.dot.y, 36);
      // the bar: hang() draws its own from f1008 (the stroke fades over it for 3 f)
      returnHero(S, f);
      if (f >= RF.stroke && f < RF.bar + 3) {
        const st = barStroke(S), k0 = (L.dot.x - st.x) / st.w, k = lerp(k0, 1, E.o3(fr(f, RF.stroke, 16)));
        X0.reveal(ctx, st.cv, st.x, st.y, st.w, st.h, k, "x", { rag: 18, seed: 4, period: 22, alpha: 1 - fr(f, RF.bar, 3) });
      }
      drawMark(S, f);
    },
    cues() {
      const c = [
        { f: RF.dot, kind: "tick", gain: 0.25 },
        { f: RF.stroke, kind: "whoosh", dur: 0.5, up: false, gain: 0.5 },
        { f: RF.slapL, kind: "land", gain: 0.5 }, { f: RF.slapR, kind: "land", gain: 0.5 },
        { f: RF.drop, kind: "whoosh", dur: 0.4, up: false, gain: 0.4 },
        { f: RF.settle, kind: "boom", gain: 0.3, f0: 62, f1: 36, dur: 1.0 },
        { f: RF.eyes, kind: "listen", gain: 0.3 },
        { f: RF.x1, kind: "write", gain: 0.4 }, { f: RF.x2, kind: "write", gain: 0.4 }, { f: RF.x2, kind: "land", gain: 0.4 },
        { f: RF.zero, kind: "whoosh", dur: 0.5, up: true, gain: 0.35 },
        { f: RF.close, kind: "boom", gain: 0.8, f0: 62, f1: 36, dur: 1.6 },
        { at: RF.close / 30, kind: "chord", f: 146.83, dur: 2.5, gain: 0.6 },
      ];
      for (const hz of [293.66, 369.99, 440, 493.88, 587.33]) c.push({ at: RF.close / 30, kind: "bell", f: hz, dur: 2.4, gain: 0.25 });
      return c;
    },
  });

  // ================================================================================================ BEAT 13: the end card
  const EF = { line: 1096, stamp: 1112, blink: 1128, look: 1136, back: 1148, wink: 1152, lift: 1160, still: 1164 };

  /** The hero on the end card: a blink, the look at the frame and back, the wink (lid-L, a -3 deg sway), then dead still. */
  function endHero(S, f) {
    const st = S.L.stamp, g = CM.gazeAt(S, "hero", st.x + st.w / 2, st.y + st.h / 2, 14);
    let k = 0; if (f >= EF.back) k = 1 - E.io(fr(f, EF.back, 6)); else if (f >= EF.look) k = E.io(fr(f, EF.look, 8));
    const eyes = { dx: g.dx * k, dy: g.dy * k, sx: 1, sy: 1 }, blink = f >= EF.blink && f < EF.blink + 2 ? 1 : 0;
    let lidL = 0, sway = 0;
    if (f >= EF.wink && f < EF.lift) { lidL = fr(f, EF.wink, 4); sway = -3 * E.io(fr(f, EF.wink, 4)); }
    else if (f >= EF.lift && f < EF.still) { const kk = E.io(fr(f, EF.lift, 4)); lidL = 1 - kk; sway = -3 * (1 - kk); }
    const bob = f < EF.still ? CM.bob(f) * (1 - E.io(fr(f, EF.wink, 12))) : 0;
    return CM.hero(S, "hero", null, { eyes, blink, bob, sway, lids: [lidL, 0] });
  }
  /** 'Your team of bots' (wipe, 9 f) and the dip-pen stamp frame pressing in with 'Coming soon' and 'x0bot.com'. */
  function endCard(S, f) {
    const { ctx, L, A } = S, el = L.endLine, st = L.stamp;
    CM.wipeText(S, f, "Your team of bots", el.x, el.base, EF.line, X0.font(600, el.size), C.ink, 9);
    if (f < EF.stamp) return;
    const im = A["pen-stamp"], w = st.w, h = w * im.height / im.width, cx = st.x + w / 2, cy = st.y + st.h / 2, press = 1 + 0.08 * (1 - E.o5(fr(f, EF.stamp, 4)));
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(D(-3)); ctx.scale(press, press); ctx.translate(-cx, -cy);
    if (f === EF.stamp) { ctx.save(); ctx.globalAlpha *= 0.7; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, cx - w / 2 + 8, cy - h / 2 + 8, w - 16, h - 16, 24); ctx.fill(); ctx.restore(); }
    ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
    X0.text(ctx, "Coming soon", st.x + 32, st.y + 65, X0.font(700, 52), C.ink);
    // the url, in ink a half-step under 'Coming soon', with Geist's SLASHED zero (stylistic set ss09; the "zero" feature does
    // nothing in Geist): canvas text takes font features from the canvas ELEMENT's style, and X0.text re-assigns ctx.font, which
    // is what makes the toggled setting take effect for this one run; restored right after so nothing else is affected
    const cv = ctx.canvas, prevFF = cv.style.fontFeatureSettings; cv.style.fontFeatureSettings = '"ss09"';
    X0.text(ctx, "x0bot.com", st.x + 32, st.y + 123, X0.font(600, 52), C.ink);
    cv.style.fontFeatureSettings = prevFF;
    ctx.restore();
  }

  FILM.register({
    name: "end", f0: 1088, f1: 1184,
    draw(S, f) {
      endHero(S, f);
      drawMark(S, Math.max(f, RF.close + 2));
      endCard(S, f);
    },
    cues() {
      return [
        { f: EF.line, kind: "write", gain: 0.35 },
        { f: EF.stamp, kind: "land", gain: 0.4 }, { f: EF.stamp, kind: "click", gain: 0.3 },
        { f: EF.blink, kind: "click", gain: 0.25 },
        { at: EF.wink / 30, kind: "bell", f: 587.33, dur: 0.5, gain: 0.35 }, { f: EF.wink, kind: "tick", gain: 0.2 },
      ];
    },
  });
})();
