/* BEATS 8-10: Travel (the tray of trip scraps, the sweep that turns handwriting into type, the hand that stops short of
 * 'Open to book' and slides it to you), Code (the ring card as a code file, the safe copy peeled off with its grey
 * 'copy' tape, the fix, the moss tick, the flick coming back) and Go live (the dip-pen question, the held breath with
 * no pulse, your tap on Yes, 'till you say yes'). Frames 576-864. Everything is a pure function of the frame.
 *
 *   travel  f576-f704  the tray flips in, bot-starry pops, the sea sparkle, THE SWEEP (f592-f612), the trip card snaps
 *                      tidy (f616), the pill (f624), the reach that STOPS (f640) as 'Your trip, sorted' lands, shy, the
 *                      slide to you (f644) under 'you press pay' (f648, the hand word f652, its underline f660; the line
 *                      holds complete f668-f697), the tray slides off as the code card pushes in
 *   code    f704-f784  the code card, bot-curious, the beetle twitches, THE COPY peels (f728) and the same glove goes on
 *                      to THE FLICK (f744): the beetle leaves as the copy's ring fades, line 2 re-writes (f748), the moss
 *                      tick and 'Tests pass' (f760)
 *   golive  f784-f864  the question card rises, the inhale (f788-f816) with the pulse absent, the blink-dip (f800),
 *                      the tap on Yes (f816), happy and the bounce (f820), 'Nothing goes live / till you say yes' (it
 *                      stays complete and still through f864: the team beat carries it on and wipes it, FILM.goliveHeadline),
 *                      the cards fall out of the frame (f856)
 */
(() => {
  "use strict";
  const { E, K, clamp, C, lerp } = X0;
  const { fr } = CM;
  const D = X0.deg;
  const GREY2 = "#6B6B6B";   // the code grey: no lighter than this anywhere
  // The code header is Geist Mono 500, a face X0.fonts() declares but does not preload (it awaits only the 400 face), so a
  // frame drawn before it arrives would fall back to the browser's serif. Ask for it as soon as the faces exist, and
  // until it is in, set the header in the loaded 400 face rather than in a fallback family.
  if (typeof document !== "undefined" && document.fonts) document.fonts.ready.then(() => document.fonts.load("500 44px GeistMono")).catch(() => {});
  const monoHead = () => X0.font(document.fonts && document.fonts.check("500 44px GeistMono") ? 500 : 400, 44, "GeistMono");

  // ================================================================================================ shared
  const cache = new Map();
  const memo = (S, key, make) => { const k = `${S.W}x${S.H}|${key}`; if (!cache.has(k)) cache.set(k, make()); return cache.get(k); };
  /** The stage box with its centre. */
  const stage = (S) => { const st = S.L.stage; return { x: st.x, y: st.y, w: st.w, h: st.h, cx: st.x + st.w / 2, cy: st.y + st.h / 2 }; };
  /** A cubic Bezier from a to d with the controls b and c, at k (a hooked path the quadratic CM.arc cannot make). */
  const cubic = (a, b, c, d, k) => { const u = 1 - k, w = [u * u * u, 3 * u * u * k, 3 * u * k * k, k * k * k]; return [0, 1].map((i) => w[0] * a[i] + w[1] * b[i] + w[2] * c[i] + w[3] * d[i]); };

  /** The glove sprites' resting centres for a pose peeking at (x, ledgeY, w), in screen px (the rig's own arithmetic);
   *  `tip` is how far below the centre the fingertips reach. */
  function gloveRest(S, pose, x, y, w) {
    const R = S.R, fm = R.meta[`bot-${pose}-nohands`], s = w / fm.w, up = fm.ledge * s;
    return ["glove-L", "glove-R"].map((n) => {
      const gm = R.meta[n], gx = (gm.x0 - fm.x0) * s, gy = (gm.y0 - fm.y0) * s, gw = gm.w * s, gh = gm.h * s;
      return { cx: x - w / 2 + gx + gw / 2, cy: y - up + gy + gh / 2, w: gw, h: gh, tip: gh * 0.46 };
    });
  }
  /** The rig offsets that put a glove's fingertip at p (screen px) turned by rot, given the face's own shift (fdx, fdy). */
  function gloveTo(rest, p, rot, fdx = 0, fdy = 0) {
    const cx = p[0] + Math.sin(rot) * rest.tip, cy = p[1] - Math.cos(rot) * rest.tip;
    return { dx: cx - rest.cx - fdx, dy: cy - rest.cy - fdy, rot };
  }
  /** The headline's size for this cut: 96 in 9:16; in 16:9 the widest line is fitted to the left column (x 96 .. the stage card). */
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
  /** The 4-frame dip that hides a face swap: 12, 20, 20, 12 px from f0 (the swap sits on the second frame). */
  const dip = (f, f0) => (f >= f0 && f < f0 + 4 ? [12, 20, 20, 12][f - f0] : 0);
  /**
   * The peek rig with the face clipped at the ledge line, so he rises from BEHIND the card he peeks over (X0.peekRig's own
   * clip rides the rise), and the glove sprites drawn after it in front, below the ledge, with the same offsets peekRig
   * takes (o.gloves[i] = { dx, dy, rot, hide } in face px; o.dx / o.dy / o.lean / o.scale as the rig).
   */
  function rig(S, pose, x, y, w, rise, o = {}) {
    const { ctx, R } = S, fm = R.meta[`bot-${pose}-nohands`], s = w / fm.w, h = fm.h * s, up = fm.ledge * s, r = clamp(rise), sc = o.scale ?? 1;
    const place = () => { ctx.translate(x, y); if (o.lean) ctx.rotate(o.lean); if (sc !== 1) ctx.scale(sc, sc); };
    ctx.save(); place(); ctx.beginPath(); ctx.rect(-2 * w, -4 * h, 4 * w, 4 * h); ctx.clip();
    if (sc !== 1) ctx.scale(1 / sc, 1 / sc); if (o.lean) ctx.rotate(-o.lean); ctx.translate(-x, -y);
    X0.peekRig(ctx, R, pose, x, y, w, rise, { ...o, gloves: [{ hide: true }, { hide: true }] });
    ctx.restore();
    if (r <= 0.6) return;
    ctx.save(); place(); ctx.translate(o.dx ?? 0, (o.dy ?? 0) + (1 - r) * (up + 6)); ctx.globalAlpha *= K(r, 0.6, 1);
    ["glove-L", "glove-R"].forEach((n, i) => {
      const g = (o.gloves && o.gloves[i]) || {}; if (g.hide) return;
      const gm = R.meta[n], gx = (gm.x0 - fm.x0) * s, gy = (gm.y0 - fm.y0) * s, gw = gm.w * s, gh = gm.h * s;
      ctx.save(); ctx.translate(-w / 2 + gx + gw / 2 + (g.dx ?? 0), -up + gy + gh / 2 + (g.dy ?? 0)); if (g.rot) ctx.rotate(g.rot);
      ctx.drawImage(R.img[n], -gw / 2, -gh / 2, gw, gh); ctx.restore();
    });
    ctx.restore();
  }

  // ================================================================================================ Travel: the tray
  /** The trip scraps on the tray: drawn width, their crooked places (dx, dy from the tray's centre, rot deg) in 9:16 (p)
   *  and 16:9 (l), and the sweep's frames (f0 -> f1, E.io). The blanks slip under; the packing scrap folds under. */
  const SCRAPS = [
    { id: "blank1", img: "scrap-blank-1", w: 300, p: [-315, -100, 15], l: [-385, -185, 14], f0: 592, f1: 604, under: true },
    { id: "blank2", img: "scrap-blank-2", w: 280, p: [325, 120, -18], l: [405, 215, -16], f0: 592, f1: 604, under: true },
    { id: "packing", img: "scrap-packing", w: 320, p: [-262, 98, -12], l: [-325, 185, -11], f0: 596, f1: 604, fold: true },
    { id: "stay", w: 580, h: 96, p: [110, 96, 4], l: [110, 190, 5], f0: 600, f1: 608 },   // 9:16: 25 px right of 'swimsuit' on the packing scrap
    { id: "ticket", w: 380, h: 140, p: [-118, -82, -7], l: [-160, -140, -8], f0: 604, f1: 612 },
    { id: "sun", w: 200, p: [280, -112, 8], l: [345, -205, 10], f0: 592, f1: 600 },
  ];
  /** The trip card, 760 x 300 centred on the tray (20 px up in 9:16 so the pill clears its last row), and its rows. */
  const TRIP = { w: 760, h: 300, pad: 36, title: 64, rows: [124, 186, 254], texts: ["Evening train · 2 seats", "Stay · 12 min to the wedding", "Sun, 21°"] };
  function tripBox(S) { const st = stage(S), cx = st.cx, cy = st.cy - (S.portrait ? 20 : 0); return { cx, cy, x: cx - TRIP.w / 2, y: cy - TRIP.h / 2, w: TRIP.w, h: TRIP.h }; }
  /** Where each scrap lands (its centre, screen px) so its own words sit on their Geist row. */
  function scrapTarget(S, id) {
    const t = tripBox(S), P = TRIP.pad;
    switch (id) {
      case "ticket": return [t.x + P + 160, t.y + TRIP.title + 22];
      case "stay": return [t.x + P + 260, t.y + TRIP.rows[1] - 16];
      case "sun": return [t.x + P + X0.width(S.ctx, TRIP.texts[2], X0.font(500, 46)) + 54, t.y + TRIP.rows[2] - 10];
      default: return [t.cx, t.cy];
    }
  }
  /** One scrap at f: crooked on the tray until its sweep, sliding to its target (E.io) with its tilt settling to 0. */
  function scrapState(S, sc, f) {
    const st = stage(S), [dx, dy, rot] = S.portrait ? sc.p : sc.l, to = scrapTarget(S, sc.id);
    const k = E.io(fr(f, sc.f0, sc.f1 - sc.f0));
    const o = { x: lerp(st.cx + dx, to[0], k), y: lerp(st.cy + dy, to[1], k), rot: D(rot) * (1 - k), k, sx: 1, sy: 1, alpha: 1, w: sc.w };
    if (sc.id === "sun") o.w = lerp(sc.w, 56, k);
    if (sc.under) { o.sx = o.sy = 1 - 0.4 * k; o.alpha = 1 - K(k, 0.6, 1); }
    if (sc.fold) { o.sy = 1 - E.i2(K(k, 0.55, 1)); o.alpha = 1 - K(k, 0.9, 1); }
    return o;
  }
  /** Draw a scrap in its state: the paper (gone into the trip card at f616), its handwriting (crossfading into type over
   *  4 f at its touchdown), or the ink sun. */
  function drawScrap(S, sc, f, o) {
    const { ctx, A } = S; if (o.alpha <= 0 || o.sy <= 0.01) return;
    const hk = 1 - fr(f, sc.f1, 4), paper = f >= 616 ? 1 - fr(f, 616, 3) : 1;
    ctx.save(); ctx.globalAlpha *= o.alpha; ctx.translate(o.x, o.y); ctx.rotate(o.rot); ctx.scale(o.sx, o.sy);
    switch (sc.id) {
      case "blank1": case "blank2":
        CM.scrapAt(S, sc.img, 0, 0, o.w); break;
      case "packing":
        CM.scrapAt(S, sc.img, 0, 0, o.w, 0, { draw: (c, ww, hh) => { ["charger", "gift", "swimsuit"].forEach((t, i) => CM.scrawl(S, t, -ww * 0.3, -hh * 0.2 + i * 48, 52, C.ink, 1, 120 + i)); } }); break;
      case "ticket":
        if (paper > 0) {
          ctx.save(); ctx.globalAlpha *= paper; CM.stageCard(S, -sc.w / 2, -sc.h / 2, sc.w, sc.h, { r: 22, shadow: 0.5 * paper * paper });
          const d = A["ink-dashes-ink"], dw = sc.w - 50, dh = dw * d.height / d.width; ctx.globalAlpha *= hk; ctx.drawImage(d, -dw / 2, 34 - dh / 2, dw, dh); ctx.restore();
        }
        if (hk > 0) { ctx.save(); ctx.globalAlpha *= hk; CM.scrawl(S, "Lisbon · 3 days", -160, -22, 52, C.ink, 1, 131); ctx.restore(); }
        break;
      case "stay":
        if (paper > 0) { ctx.save(); ctx.globalAlpha *= paper; CM.stageCard(S, -sc.w / 2, -sc.h / 2, sc.w, sc.h, { r: 22, shadow: 0.5 * paper * paper }); ctx.restore(); }
        if (hk > 0) { ctx.save(); ctx.globalAlpha *= hk; CM.scrawl(S, "Stay · 12 min to the wedding", -260, 16, 52, C.ink, 1, 141); ctx.restore(); }
        break;
      case "sun": { const s = A["ink-sun"], sh = o.w * s.height / s.width; ctx.drawImage(s, -o.w / 2, -sh / 2, o.w, sh); break; }
    }
    ctx.restore();
  }
  /** The trip card's type: the title and the rows, each fading in over 4 f as its scrap touches down (sun f600, stay
   *  f608, ticket f612: title and train row); '12 min' gets its short sea brush underline f616-f622. */
  function tripType(S, f, under) {
    const { ctx, A } = S, t = tripBox(S), P = TRIP.pad, ins = [612, 608, 600], fnt = X0.font(500, 46);
    // the weather row is born on the tray itself (under the scraps still sliding over it); the others on their papers
    if (under) { if (f >= 600) X0.text(ctx, TRIP.texts[2], t.x + P, t.y + TRIP.rows[2], fnt, C.ink, "left", { alpha: fr(f, 600, 4) }); return; }
    if (f >= 612) X0.text(ctx, "Lisbon · 3 days", t.x + P, t.y + TRIP.title, X0.font(600, 52), C.ink, "left", { alpha: fr(f, 612, 4) });
    TRIP.texts.forEach((txt, i) => { if (i < 2 && f >= ins[i]) X0.text(ctx, txt, t.x + P, t.y + TRIP.rows[i], fnt, C.ink, "left", { alpha: fr(f, ins[i], 4) }); });
    if (f >= 616) {
      const x0 = t.x + P + X0.width(ctx, "Stay · ", fnt), w0 = X0.width(ctx, "12 min", fnt), w = w0 * 1.12, img = A["ul-travel"], h = Math.max(22, w * img.height / img.width);
      X0.reveal(ctx, img, x0 - (w - w0) / 2, t.y + TRIP.rows[1] + 8, w, h, E.o3(fr(f, 616, 6)), "x", { rot: -0.012, rag: 6, seed: 4 });
    }
  }
  /** 'Open to book': rises at f624 (8 f, E.o3) to 60 px inside the tray's bottom edge in 16:9, and centred ON that edge in
   *  9:16 (y 1230-1310: the trip card runs to 1190 there, and the stopped glove needs the band between its last row and
   *  the pill); slid 40 px toward you f644-f653 (E.io), growing to 1.12 (it straddles the tray's edge: 'comes forward'). */
  function pillState(S, f) {
    const st = stage(S), cy0 = st.y + st.h - (S.portrait ? 0 : 60), kin = E.o3(fr(f, 624, 8)), ks = E.io(fr(f, 644, 9)), scale = 1 + 0.12 * ks;
    const cy = cy0 + 40 * (1 - kin) + 40 * ks;
    return { cx: st.cx, cy, scale, alpha: kin, w: 360, h: 80, top: cy - 40 * scale, top0: cy0 - 40 };
  }
  /** The tray and everything on it, shifted by dx (the exit) and flipped by sx (the page flip in). */
  function tray(S, f, dx, sx) {
    const { ctx } = S, st = stage(S);
    ctx.save(); ctx.translate(dx, 0);
    if (sx !== 1) { ctx.translate(st.cx, 0); ctx.scale(Math.max(0.01, sx), 1); ctx.translate(-st.cx, 0); }
    CM.stageCard(S, st.x, st.y, st.w, st.h);
    ctx.save(); X0.rrect(ctx, st.x, st.y, st.w, st.h, 28); ctx.clip();
    if (f >= 616) { const t = tripBox(S), k = E.o3(fr(f, 616, 3)); CM.stageCard(S, t.x, t.y, t.w, t.h, { r: 28, sx: 1.03 - 0.03 * k, sy: 0.97 + 0.03 * k }); }   // the snap: whole at once, a 1.03 squash
    SCRAPS.slice(0, 3).forEach((sc) => drawScrap(S, sc, f, scrapState(S, sc, f)));   // the blanks and the packing scrap
    tripType(S, f, true);
    SCRAPS.slice(3).forEach((sc) => drawScrap(S, sc, f, scrapState(S, sc, f)));      // the stay card, the ticket, the sun
    tripType(S, f, false);
    ctx.restore();
    const p = pillState(S, f); if (p.alpha > 0) CM.pill(S, "Open to book", p.cx, p.cy, p.w, p.h, { alpha: p.alpha, scale: p.scale });
    ctx.restore();
  }
  /** The heap's tail with its INK dimmed to (1 - 0.4 k) while its paper stays opaque: drawn off screen at full strength,
   *  then a white veil laid on its own pixels only (source-atop) and the result composited back. (A plain alpha on the
   *  tail let the card's hatch shadow through its face, which read as lined paper.) */
  function dimmedTail(S, n, dx, k) {
    if (k <= 0) { CM.heapTail(S, n, { dx }); return; }
    const { ctx, u } = S, oc = X0.offscreen(S.W, S.H), c2 = oc.getContext("2d");
    c2.setTransform(u, 0, 0, u, 0, 0);
    CM.heapTail({ ...S, ctx: c2 }, n, { dx });
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.globalCompositeOperation = "source-atop"; c2.globalAlpha = 0.4 * clamp(k); c2.fillStyle = "#FFFFFF"; c2.fillRect(0, 0, oc.width, oc.height);
    ctx.drawImage(oc, 0, 0, S.W / u, S.H / u); X0.release(oc);
  }
  /** The sea sparkle beside his head: 2 f on (A), 2 off, 2 on (B), from f588. */
  function sparkle(S, f) {
    if (f < 588 || f >= 594 || (f >= 590 && f < 592)) return;
    const { ctx, A, L } = S, p = S.portrait ? [870, 600] : [L.peekX2 + 330, 120];
    X0.img(ctx, A[f < 590 ? "sparkle-sea-a" : "sparkle-sea-b"], p[0], p[1], 100);
  }

  // ================================================================================================ Travel: the hero
  /** THE SWEEP: both gloves lift 18 px off the ledge and slide inward along the tray's top edge (12 f, E.io), fingers
   *  turned toward the centre, then come back (8 f): on the ledge again by f612. */
  function sweepGlove(f, side, rest, faceX) {
    if (f < 592 || f >= 612) return {};
    const k = f < 604 ? E.io(fr(f, 592, 12)) : 1 - E.io(fr(f, 604, 8));
    const lift = 18 * Math.min(E.o3(fr(f, 592, 3)), 1 - E.i2(fr(f, 608, 4)));
    return { dx: (faceX + (side ? 58 : -58) - rest.cx) * k, dy: -lift, rot: D(side ? -14 : 14) * k };
  }
  /** THE REACH: the right glove arcs to above the pill (8 f, -20 deg) and STOPS there with a 2-frame shudder; from f644 it
   *  pushes the pill 40 px toward you riding its top edge (9 f), then returns to the ledge (8 f).
   *  16:9: a quadratic arc straight down to 60 px above the pill, through the empty card right of 'Sun, 21°'.
   *  9:16: the trip card's words fill the column above the pill, so the glove goes DOWN THE CARD'S RIGHT MARGIN (its body
   *  at x >= ~770, clear of 'wedding', while it is level with the rows) and only then sweeps left along the empty right
   *  half of the 'Sun, 21°' row to its stop, 52 px above the pill (its ink spans y ~1092-1185: under row 3's glyphs
   *  (1082), right of the sea underline (ends x 435), 45 px short of the pill at 1230); it leaves the same way. */
  function reachGlove(S, f, rest, pill, fdx, fdy) {
    if (f < 632 || f >= 661) return null;
    const P = S.portrait, hover = P ? 52 : 60, st = stage(S), t = tripBox(S), R = st.x + st.w;
    const r0 = [rest.cx, rest.cy + rest.tip], stop = [pill.cx + 12, pill.top0 - hover];
    let tip, rot;
    if (f < 640) {
      const k = E.io(fr(f, 632, 8)); rot = D(-20) * k;
      tip = P ? cubic(r0, [R - 10, t.y + 150], [R + 30, st.y + st.h], stop, k) : CM.arc(r0, [(r0[0] + stop[0]) / 2 + 120, (r0[1] + stop[1]) / 2 + 20], stop, k);
    }
    else if (f < 644) { tip = [stop[0] + (f === 640 ? 3 : f === 641 ? -3 : 0), stop[1]]; rot = D(-20); }
    else if (f < 653) { const k = E.o3(fr(f, 644, 4)); tip = [stop[0], pill.top - 2 - hover * (1 - k)]; rot = D(-20) + D(12) * E.io(fr(f, 644, 9)); }
    else {
      const k = E.io(fr(f, 653, 8)), c0 = [stop[0], pill.top - 2]; rot = D(-8) * (1 - k);
      tip = P ? cubic(c0, [R + 40, st.y + st.h + 20], [R, t.y + 130], r0, k) : CM.arc(c0, [(c0[0] + r0[0]) / 2 + 80, (c0[1] + r0[1]) / 2 + 50], r0, k);
    }
    return gloveTo(rest, tip, rot, fdx, fdy);
  }
  /** Bot-starry popping at f584 behind the tray's top edge; the look down at the pill (f628); the swap to shy inside the
   *  dip at f641-f644; the duck at f696. The face rides the tray's exit (trayDx). */
  function travelPeek(S, f, trayDx) {
    if (f < 584) return;
    const { ctx, R, L } = S, st = stage(S), x = L.peekX2 + trayDx, w = L.peekW2, y = st.y;
    const pose = f >= 642 ? "shy" : "starry";
    const rise = f < 696 ? CM.pop(f, 584, 9) : 1 - E.i2(fr(f, 696, 6));
    let dx = 0, dy = 0;
    if (f >= 628 && f < 641) dy = 6 * E.io(fr(f, 628, 5));
    dy += dip(f, 641);
    const bob = CM.bob(f) * 0.5;
    const rest = gloveRest(S, pose, x, y, w), pill = pillState(S, f);
    pill.cx += trayDx;
    const gloves = [sweepGlove(f, 0, rest[0], x), sweepGlove(f, 1, rest[1], x)];
    const reach = reachGlove(S, f, rest[1], pill, dx, dy + bob); if (reach) gloves[1] = reach;
    rig(S, pose, x, y, w, rise, { dx, dy: dy + bob, gloves });
  }
  /** Line 1 lands on the glove's STOP (f640), line 2 on the pill's slide (f648), 'you' writes f652-f658, the underline
   *  f660-f668; complete and still f668-f697 (29 f), out with the tray. */
  const travelHeadline = (S, f) => CM.headline(S, f, { lines: ["Your trip, sorted", "you press pay"], hand: { line: 1, word: "you" }, ul: S.A["ul-travel"],
    at: { l1: 640, l2: 648, hand: 652, ul: 660 }, out: { f: 697, n: 7 }, ...headFit(S, ["Your trip, sorted", "you press pay"], { line: 1, word: "you" }) });

  // ================================================================================================ Code: the cards
  /** The code card's layout in the stage box: the header, the three lines, the ring around the buggy expression on line 2,
   *  the beetle on line 1's row in the card's top-right padding, the tests row under the code. */
  function codeGeo(S) {
    return memo(S, "code", () => {
      const st = stage(S), p = S.portrait, r = S.A["ring-ink-wide"], mono = X0.font(400, 44, "GeistMono"), W = (t) => X0.width(S.ctx, t, mono);
      // 9:16: the header 10 px higher and the pitch opened 76 -> 87 (the tick still ends ~11 px above the card's bottom) so
      // the ring has room between line 1's descenders and line 3; 16:9 keeps its 96
      const pitch = p ? 87 : 96, header = st.y + (p ? 50 : 70), lines = [1, 2, 3].map((i) => header + pitch * i), textX = st.x + 40;
      // the ring circles the buggy expression itself, 'items.length', at the heap's ring size (420 wide, UNIFORM scale: the
      // wide ring is never squashed). Its box starts 4 px after 'return' (so its stroke sits in the space before 'items' and
      // overshoots 'length' on the right, as a hand-drawn loop does) and its centre is 10 px above line 2's baseline: its
      // ink (+-59) clears line 1's descenders by ~6 px in 9:16 (16 in 16:9), its inner edge holds the 'i' dot, and line 3's
      // lone brace is far to its left
      const rw = 420, ring = { cx: textX + W("  return") + 4 + rw / 2, cy: lines[1] - 10, w: rw, h: rw * r.height / r.width };
      // the beetle stands 10 px under line 1's baseline in the card's top-right padding: 33 px inside the edge, ~70 px clear
      // of the brace, its back 20 px under the header's hairline (it rides the copy, so the same on both cards)
      return { ...st, textX, header, lines, ring, beetle: { cx: st.x + st.w - 78, foot: lines[0] + 10, w: 90 }, tests: { x: textX, top: lines[2] + 12, base: lines[2] + 74, tick: 96 } };
    });
  }
  /** One code file card with its top-left at (x, y): the header, the grey code, line 2 fixed from `fix` (the grey line
   *  fades as the ink one writes from fixF0), the ring at `ring` alpha, the grey 'copy' tape at `tape` alpha, the moss
   *  tick and 'Tests pass' from f760 when `tests`. */
  function codeCard(S, f, x, y, o = {}) {
    const { ctx, A } = S, g = codeGeo(S);
    ctx.save(); ctx.translate(x - g.x, y - g.y); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    CM.stageCard(S, g.x, g.y, g.w, g.h);
    ctx.save(); X0.rrect(ctx, g.x, g.y, g.w, g.h, 28); ctx.clip();
    X0.text(ctx, "cart/total.ts", g.textX, g.header, monoHead(), C.ink);
    ctx.fillStyle = C.line; ctx.fillRect(g.x + 24, g.header + 26, g.w - 48, 2);
    const mono = X0.font(400, 44, "GeistMono"), fix = o.fix ?? 0;
    X0.text(ctx, "function total(items) {", g.textX, g.lines[0], mono, GREY2);
    if (fix < 1) X0.text(ctx, "  return items.length", g.textX, g.lines[1], mono, GREY2, "left", { alpha: 1 - fix });
    if (o.fixF0 != null) CM.wipeText(S, f, "  return sum(items)", g.textX, g.lines[1], o.fixF0, mono, C.ink, 9);
    X0.text(ctx, "}", g.textX, g.lines[2], mono, GREY2);
    if ((o.ring ?? 1) > 0) X0.img(ctx, A["ring-ink-wide"], g.ring.cx, g.ring.cy, g.ring.w, { alpha: o.ring ?? 1 });
    if (o.tests && f >= 760) {
      const t = g.tests, im = A["ink-tick"], th = t.tick * im.height / im.width;
      X0.reveal(ctx, im, t.x, t.top, t.tick, th, E.o3(fr(f, 760, 4)), "x", { rag: 8, seed: 6 });
      CM.wipeText(S, f, "Tests pass", t.x + t.tick + 28, t.base, 760, mono, GREY2, 9);
    }
    ctx.restore();
    if (o.tape > 0) {   // the paper-grey tape across the top edge, 'copy' written on it by hand
      const tp = A["tape-grey"], tw = 220, th = tw * tp.height / tp.width, cx = g.x + g.w * 0.6, cy = g.y + 2;   // right of the header
      ctx.save(); ctx.globalAlpha *= clamp(o.tape); ctx.translate(cx, cy); ctx.rotate(D(-4));
      ctx.drawImage(tp, -tw / 2, -th / 2, tw, th);
      CM.scrawl(S, "copy", -X0.width(ctx, "copy", X0.font(700, 52, "Caveat")) / 2, 18, 52, C.ink, 1, 151);
      ctx.restore();
    }
    ctx.restore();
  }
  /** The question card: a white card inside the dip-pen frame (laid out 760 wide at the PNG's own ratio) over the copy
   *  card's middle; 'Go live?' and the two dip-pen pills. 16:9: full size, mid-card, code peeking above and below. 9:16:
   *  the whole frame at 0.9 (uniform, so the hand-drawn stroke keeps its proportions), centred in the COPY's body between
   *  its header hairline and its bottom edge (~28 px of air to each, a sliver of greyed code around it as in 16:9). */
  function qBox(S) {
    return memo(S, "q", () => {
      const st = stage(S), g = codeGeo(S), fr_ = S.A["pen-frame"], w = 760, h = w * fr_.height / fr_.width;
      return S.portrait ? { cx: st.cx + 18, cy: (g.header + 27 + 18 + g.y + g.h + 18) / 2, w, h, s: 0.9 } : { cx: 1380, cy: 660, w, h, s: 1 };
    });
  }
  function qPills(S) { const q = qBox(S), A = S.A, pw = 240, ph = pw * A["pen-pill"].height / A["pen-pill"].width, x0 = q.cx - q.w / 2, y0 = q.cy - q.h / 2; const yes = { cx: x0 + 56 + pw / 2, cy: y0 + 176 + ph / 2 }; return { pw, ph, yes, not: { cx: yes.cx + pw + 28, cy: yes.cy }, x0, y0 }; }
  /** A point of the 760-wide layout as drawn (the frame's own scale about its centre). */
  const qAt = (q, x, y) => [q.cx + (x - q.cx) * q.s, q.cy + (y - q.cy) * q.s];
  function questionCard(S, f) {
    if (f < 784) return; const { ctx, A } = S, q = qBox(S), P = qPills(S), k = CM.pop(f, 784, 9, 1.3), sc = (0.7 + 0.3 * k) * q.s;
    ctx.save(); ctx.globalAlpha *= K(k, 0, 0.35); ctx.translate(q.cx, q.cy + 80 * (1 - k)); ctx.scale(sc, sc); ctx.translate(-q.cx, -q.cy);
    X0.hatchShadow(ctx, A.hatch, q.cx - q.w / 2 + 10, q.cy - q.h / 2 + 10, q.w - 20, q.h - 20, 24, 1, { alpha: 0.5 });
    ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, q.cx - q.w / 2 + 8, q.cy - q.h / 2 + 8, q.w - 16, q.h - 16, 24); ctx.fill();
    X0.img(ctx, A["pen-frame"], q.cx, q.cy, q.w);
    X0.text(ctx, "Go live?", P.x0 + 56, P.y0 + 112, X0.font(600, 56), C.ink);
    const tap = f >= 816 ? fr(f, 816, 3) : 0, fnt = X0.font(600, 44);
    X0.img(ctx, A["pen-pill"], P.yes.cx, P.yes.cy, P.pw);
    if (tap > 0) X0.img(ctx, A["pen-pill-yes"], P.yes.cx, P.yes.cy, P.pw, { alpha: tap });
    if (tap < 1) X0.text(ctx, "Yes", P.yes.cx, P.yes.cy + 16, fnt, C.ink, "center", { alpha: 1 - tap });
    if (tap > 0) X0.text(ctx, "Yes", P.yes.cx, P.yes.cy + 16, fnt, "#FFFFFF", "center", { alpha: tap });
    X0.img(ctx, A["pen-pill"], P.not.cx, P.not.cy, P.pw);
    X0.text(ctx, "Not yet", P.not.cx, P.not.cy + 16, fnt, C.ink, "center");
    ctx.restore();
    const yes = qAt(q, P.yes.cx, P.yes.cy); CM.tapRing(S, f, 816, yes[0], yes[1], 60 * q.s);
  }
  /** The push-in (f700-f708, from the right in 9:16, from the left in 16:9) and the fall (f856-f864) that move the stack. */
  function cardsMove(S, f) {
    const st = stage(S), L = S.L, kin = E.o3(fr(f, 700, 8)), kf = f >= 856 ? E.i2(fr(f, 856, 8)) : 0;
    return { dx: (S.portrait ? L.W - st.x + 40 : -(st.x + st.w + 40)) * (1 - kin), fall: kf, fallDy: (L.H - st.y + 80) * kf, rot: D(-4) * kf };
  }
  const applyMove = (ctx, st, m) => { if (m.fall > 0) { ctx.translate(st.cx, st.cy); ctx.rotate(m.rot); ctx.translate(-st.cx, -st.cy); ctx.translate(0, m.fallDy); } ctx.translate(m.dx, 0); };
  /** The copy's slide out from under the original, +18/+18 over f728-f738 (E.o3). */
  const peelK = (f) => (f >= 728 ? E.o3(fr(f, 728, 10)) : 0);
  /** The stack at f: the original (dimming to 80 % behind from the peel), the copy sliding out +18/+18 (f728-f738,
   *  E.o3) with its tape, the ring fading as the beetle is flicked (f744), line 2 re-writing on the copy (f748), the tick
   *  (f760), the question (f784). */
  function codeCards(S, f) {
    const { ctx } = S, st = stage(S), m = cardsMove(S, f), peel = peelK(f);
    ctx.save(); applyMove(ctx, st, m);
    codeCard(S, f, st.x, st.y, { alpha: 1 - 0.2 * peel });
    if (f >= 728) codeCard(S, f, st.x + 18 * peel, st.y + 18 * peel, { ring: f >= 744 ? 1 - fr(f, 744, 6) : 1, fix: f >= 748 ? fr(f, 748, 6) : 0, fixF0: f >= 748 ? 748 : null, tests: true, tape: peel });
    questionCard(S, f);
    ctx.restore();
  }
  /** The eyeless beetle, frame A or B, drawn in the recipe's common frame (the components' boxes) so the legs twitch in
   *  place: `cx` its centre x, `foot` the y its legs stand on, `w` the whole beetle's width (frame A). */
  function drawBeetle(S, which, cx, foot, w, rot = 0) {
    const { ctx, A, meta } = S, name = which ? "beetle-b" : "beetle-a", im = A[name], bA = meta.components["beetle-a"].box, b = meta.components[name].box;
    const s = w / (bA.x1 - bA.x0), ox = cx - (bA.x0 + bA.x1) / 2 * s, oy = foot - bA.y1 * s, mx = cx, my = foot - (bA.y1 - bA.y0) / 2 * s;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(rot); ctx.translate(-mx, -my);
    ctx.drawImage(im, ox + b.x0 * s, oy + b.y0 * s, (b.x1 - b.x0) * s, (b.y1 - b.y0) * s); ctx.restore();
  }
  /** The beetle at f: on line 1's row (twitching f720-f727), riding the copy out (+18/+18 with the peel), tumbling off
   *  the frame's top-right from the flick at f744 (12 f, 400 deg, E.i2), gone at f756 as the copy's ring finishes fading. */
  function beetleAt(S, f) {
    if (f >= 756) return null; const b = codeGeo(S).beetle, p = 18 * peelK(f), cx = b.cx + p, foot = b.foot + p;
    if (f < 744) return { cx, foot, w: b.w, rot: 0, frame: f >= 720 && f < 728 && ((f - 720) >> 1) % 2 === 0 ? 1 : 0 };
    const k = fr(f, 744, 12), e = E.i2(k);
    return { cx: lerp(cx, S.L.W + 200, e), foot: lerp(foot, -200, e), w: b.w, rot: D(400) * k, frame: ((f - 744) >> 1) % 2 };
  }
  function beetleLayer(S, f) {
    const b = beetleAt(S, f); if (!b) return; const { ctx } = S, st = stage(S), m = cardsMove(S, f);
    ctx.save(); applyMove(ctx, st, m); drawBeetle(S, b.frame, b.cx, b.foot, b.w, b.rot); ctx.restore();
  }

  // ================================================================================================ Code and Go live: the hero
  /** THE PEEL AND THE FLICK, one continuous move of the right glove: it slides to the card's top-right corner (f722-f728),
   *  pinches and carries it +18/+18 with the copy (f728-f738), slides down from the copy's corner to the beetle's left
   *  (f738-f744, E.io, -20 deg), SNAPS +30 deg in 3 f at f744 (the callback: the beetle leaves with the copy's ring),
   *  and arcs back to the ledge in 9 f: at rest by f756. */
  function peelGlove(S, f, rest, fdx, fdy) {
    if (f < 722 || f >= 756) return null;
    const g = codeGeo(S), b = g.beetle, corner = [g.x + g.w - 16, g.y + 6], c0 = [corner[0] + 18, corner[1] + 18], r0 = [rest.cx, rest.cy + rest.tip];
    const tg = [b.cx + 18 - 34, b.foot + 18 - 10];   // the beetle as it sits on the copy
    let tip, rot;
    if (f < 728) { const k = E.io(fr(f, 722, 6)); tip = CM.arc(r0, [(r0[0] + corner[0]) / 2, r0[1] - 40], corner, k); rot = D(-12) * k; }
    else if (f < 738) { const k = E.o3(fr(f, 728, 10)); tip = [corner[0] + 18 * k, corner[1] + 18 * k]; rot = D(-12) + D(8) * k; }
    else if (f < 744) { const k = E.io(fr(f, 738, 6)); tip = [lerp(c0[0], tg[0], k), lerp(c0[1], tg[1], k)]; rot = D(-4) + D(-16) * k; }
    else if (f < 747) { const k = E.o3(fr(f, 744, 3)); tip = [tg[0] + 44 * k, tg[1] - 10 * k]; rot = D(-20) + D(30) * k; }
    else { const k = E.io(fr(f, 747, 9)); tip = CM.arc([tg[0] + 44, tg[1] - 10], [(r0[0] + tg[0]) / 2 + 60, (r0[1] + tg[1]) / 2 + 40], r0, k); rot = D(10) * (1 - k); }
    return gloveTo(rest, tip, rot, fdx, fdy);
  }
  /** Bot-curious from the pop at f712 through the copy, the flick and the fix; then the held breath (f788-f816, scale
   *  1.05 -> 1.08 about the ledge, +8 px, 2 deg toward Yes, the bob frozen), the blink-dip at f800, the release on the
   *  tap, the swap to happy inside the dip at f818-f821 and the bounce; the duck at f856. */
  function codePeek(S, f) {
    if (f < 712) return;
    const { ctx, R, L } = S, st = stage(S), g = codeGeo(S), x = L.peekX2, w = L.peekW2, y = st.y + cardsMove(S, f).fallDy;   // the ledge rides the falling cards
    const pose = f >= 820 ? "happy" : "curious";
    const rise = f < 856 ? CM.pop(f, 712, 9) : 1 - E.i2(fr(f, 856, 6));
    // the gaze: a shift of the whole face toward what he looks at (6 px): the beetle (f716), the copy as it peels (f728),
    // the beetle again for the flick (f738), line 2 as it re-writes (f747), then straight ahead (f760)
    const toward = (px, py) => { const vx = px - x, vy = py - y, len = Math.hypot(vx, vy) || 1; return [6 * vx / len, 6 * Math.max(0, vy) / len]; };
    let dx = 0, dy = 0, scale = 1, lean = 0;
    const bt = toward(g.beetle.cx, g.beetle.foot), cp = toward(st.cx + 200, st.cy + 60), ln = toward(g.textX + 250, g.lines[1]);
    if (f >= 716 && f < 728) { const k = E.io(fr(f, 716, 4)); dx = bt[0] * k; dy = bt[1] * k; }
    else if (f >= 728 && f < 738) { const k = E.io(fr(f, 728, 6)); dx = lerp(bt[0], cp[0], k); dy = lerp(bt[1], cp[1], k); }
    else if (f >= 738 && f < 747) { const k = E.io(fr(f, 738, 4)); dx = lerp(cp[0], bt[0], k); dy = lerp(cp[1], bt[1], k); }
    else if (f >= 747 && f < 760) { const k = E.io(fr(f, 747, 5)); dx = lerp(bt[0], ln[0], k); dy = lerp(bt[1], ln[1], k); }
    else if (f >= 760 && f < 784) { const back = E.io(fr(f, 760, 8)); dx = ln[0] * (1 - back); dy = ln[1] * (1 - back); }
    // the look at you and the breath
    if (f >= 784) {
      const kin = E.io(fr(f, 784, 4)), kb = E.io(fr(f, 788, 28)), rel = f >= 816 ? E.io(fr(f, 816, 4)) : 0;
      scale = lerp(1, 1.05, kin) + 0.03 * kb * (1 - rel);
      dy = -8 * kb * (1 - rel);
      lean = D(-2) * kb * (1 - rel);
      if (f >= 800 && f < 802) dy += 20;                         // the blink: the whole face dips 20 px for 2 f
    }
    // the swap dip (f818-f821) and the bounce from f821 (-28 px, E.back(1.5), 10 f)
    let hop = f >= 818 && f < 821 ? [12, 20, 20][f - 818] : 0;
    if (f >= 821 && f < 831) { const k = fr(f, 821, 10); hop = -28 * (k < 0.4 ? E.o3(k / 0.4) : 1 - E.back(1.5)(K(k, 0.4, 1))); }
    // the breathing bob, frozen through the held breath, eased back after the tap
    const bob0 = CM.bob(f) * 0.5, bob = f < 784 ? bob0 : f < 816 ? CM.bob(784) * 0.5 : lerp(CM.bob(784) * 0.5, bob0, E.io(fr(f, 816, 10)));
    const rest = gloveRest(S, pose, x, y, w), fd = dy + hop + bob;
    const gloves = [{}, peelGlove(S, f, rest[1], dx, fd) || {}];
    rig(S, pose, x, y, w, rise, { dx, dy: fd, scale, lean, gloves });
  }
  /** The thesis. It has NO out here: it stays complete and still through this beat's last frame (f863) while the cards
   *  fall, and the team beat keeps drawing it from f864 through FILM.goliveHeadline(S, f, out) (same lines, hand word,
   *  colour, frames and fit, so the redraw is seamless) until its own left wipe (out = { f, n }). */
  const goliveHeadline = (S, f, out) => CM.headline(S, f, { lines: ["Nothing goes live", "till you say yes"], hand: { line: 1, word: "yes" }, ul: S.A["ul-code"],
    at: { l1: 820, l2: 828, hand: 832, ul: 840 }, out, ...headFit(S, ["Nothing goes live", "till you say yes"], { line: 1, word: "yes" }) });
  FILM.goliveHeadline = goliveHeadline;

  // ================================================================================================ the beats
  FILM.register({
    name: "travel", f0: 576, f1: 704,
    draw(S, f) {
      const st = stage(S), sx = f < 582 ? E.o2(fr(f, 576, 6)) : 1, out = f >= 696 ? E.i3(fr(f, 696, 8)) : 0;
      const trayDx = (S.portrait ? -(st.x + st.w + 60) : (S.L.W - st.x + 60)) * out;   // off left in 9:16, off right in 16:9
      // the last item, the ring card, under the tray's bottom edge: receding to 60 % as the pill arrives over it (f624), slipping
      // off as the code card comes (f696). 9:16 only: in 16:9 the tail's corner showed a bare black arc of the ring with no card
      // edge (an ink smudge, not a cue), so the landscape cut carries the beat on the stage card alone
      if (S.portrait) dimmedTail(S, 1, 900 * E.i2(fr(f, 696, 8)), E.o3(fr(f, 624, 8)));
      if (f >= 700) { codeCards(S, f); }
      tray(S, f, trayDx, sx);
      travelPeek(S, f, trayDx);
      if (f >= 700) beetleLayer(S, f);
      sparkle(S, f);
      travelHeadline(S, f);
    },
    cues() {
      const c = [
        { f: 576, kind: "open", gain: 0.5 }, { f: 582, kind: "land", gain: 0.4 },
        { f: 584, kind: "notify", gain: 0.5 },
        { at: 588 / 30, kind: "bell", f: 1760, dur: 0.15, gain: 0.2 },
        { f: 592, kind: "whoosh", dur: 0.4, up: true, gain: 0.4 },
        { f: 616, kind: "land", gain: 0.6 },
        { f: 624, kind: "click", gain: 0.4 },
        { f: 632, kind: "whoosh", dur: 0.2, up: true, gain: 0.3 },
        { f: 640, kind: "stop", gain: 0.4 },
        { f: 644, kind: "whoosh", dur: 0.3, up: false, gain: 0.25 },
        { f: 640, kind: "tick", gain: 0.3 }, { f: 648, kind: "tick", gain: 0.3 }, { f: 652, kind: "write", gain: 0.4 },   // the headline: its lines, the hand word
        { at: 660 / 30, kind: "bell", f: 440, dur: 1.2, gain: 0.4 }, { f: 660, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 },   // its underline
        { f: 696, kind: "whoosh", dur: 0.25, up: false, gain: 0.4 },
      ];
      [600, 604, 608, 612].forEach((f, i) => c.push({ f, kind: "land", gain: +(0.3 + 0.2 * i / 3).toFixed(3) }));
      return c;
    },
  });

  FILM.register({
    name: "code", f0: 704, f1: 784,
    draw(S, f) {
      const st = stage(S);
      if (f < 708) { const out = E.i3(fr(f, 696, 8)); tray(S, f, (S.portrait ? -(st.x + st.w + 60) : (S.L.W - st.x + 60)) * out, 1); }   // the tray's last frames off the edge
      codeCards(S, f);
      codePeek(S, f);
      beetleLayer(S, f);
    },
    cues() {
      return [
        { f: 704, kind: "whoosh", dur: 0.25, up: true, gain: 0.4 }, { f: 708, kind: "land", gain: 0.4 },
        { f: 712, kind: "open", gain: 0.5 },
        { f: 720, kind: "tick", gain: 0.15 }, { f: 724, kind: "tick", gain: 0.15 },
        { f: 728, kind: "whoosh", dur: 0.3, up: true, gain: 0.35 }, { f: 736, kind: "land", gain: 0.4 },
        { f: 744, kind: "whoosh", dur: 0.25, up: true, gain: 0.5 },   // the flick
        { f: 748, kind: "write", gain: 0.4 },                          // line 2 re-writes
        { f: 760, kind: "key", gain: 0.5 }, { f: 760, kind: "land", gain: 0.35 },
      ];
    },
  });

  FILM.register({
    name: "golive", f0: 784, f1: 864,
    draw(S, f) {
      codeCards(S, f);
      codePeek(S, f);
      goliveHeadline(S, f);
    },
    cues() {
      return [
        { f: 784, kind: "open", gain: 0.5 },
        { f: 800, kind: "click", gain: 0.3 },
        { f: 816, kind: "click", gain: 0.7 }, { f: 816, kind: "land", gain: 0.5 },
        { f: 820, kind: "notify", gain: 0.35 }, { f: 820, kind: "tick", gain: 0.3 }, { f: 828, kind: "tick", gain: 0.3 }, { f: 832, kind: "write", gain: 0.4 },
        { at: 840 / 30, kind: "bell", f: 493.88, dur: 1.2, gain: 0.4 }, { f: 840, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 },
        { f: 856, kind: "whoosh", dur: 0.3, up: false, gain: 0.4 },
      ];
    },
  });
})();
