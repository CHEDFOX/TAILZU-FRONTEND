/* BEATS 5-7: Keybot (say it, the flick, 'late' lands late; sent, and the first colour) and Plan (he drops in and hangs the
 * note on 5 pm). Frames 256-576. Everything here is a pure function of the frame: seeded jitter, no clocks.
 *
 *   keybot-say   f256-f368  the chat stage card, the mic in the pill and the scrawl, the flick, the words dropping into the pill
 *   keybot-sent  f368-f416  the send, the ink bubble, 'Keybot writes it' with the clay underline, the ta-da, the look, the exit
 *   plan         f416-f576  the day card, the drop-in, the reach, the pendulum (f464-f480), the flip to a clean card (f488),
 *                           the launch exit (pull f492, gone f520), the ochre leave-by line (f520-f534), 'Your day / planned
 *                           for you' (f520-f544, held to the cut), the page flip out (f571-f576)
 */
(() => {
  "use strict";
  const { E, K, clamp, C, lerp } = X0;
  const { fr } = CM;
  const D = X0.deg;
  const HANG = X0.hang;

  // ================================================================================================ copy
  /** The three cuts of the copy: the scrawl (spoken), the typed words with their landing frames, the scrawl twin each
   *  typed word replaces (index into scrawl), and the 'late' word that slides in late. Frame timing is the brief's. */
  const COPY = {
    hi: {
      scrawl: ["umm", "thoda", "late", "ho", "raha", "hoon", "start", "kar", "do"], per: 4,
      lines: [[["Thoda", 320, 1], ["late", 340, 2, true], ["ho", 328, 3], ["raha", 332, 4], ["hoon", 336, 5]], [["start", 348, 6], ["kar", 352, 7], ["do", 356, 8]]],
      comma: 344, stop: 360,
    },
    en: {
      scrawl: ["umm", "running", "late", "start", "without", "me"], per: 6,
      lines: [[["Running", 320, 1], ["late", 340, 2, true]], [["start", 328, 3], ["without", 332, 4], ["me", 336, 5]]],
      comma: 344, stop: 348,
    },
    dv: {
      scrawl: ["उम्म", "थोड़ा", "लेट", "हो", "रहा", "हूँ", "शुरू", "कर", "दो"], per: 4, whole: true, family: "Devanagari", weight: 400, typedWeight: 400,
      lines: [[["थोड़ा", 320, 1], ["लेट", 340, 2, true], ["हो", 328, 3], ["रहा", 332, 4], ["हूँ", 336, 5]], [["शुरू", 348, 6], ["कर", 352, 7], ["दो", 356, 8]]],
      comma: 344, stop: 360, stopGlyph: "।",
    },
  };
  const copyOf = (S) => COPY[S.lang] || (/deva|^dv$/i.test(S.lang || "") ? COPY.dv : COPY.hi);
  const scrawlFont = (cp) => X0.font(cp.weight ?? 700, 68, cp.family ?? "Caveat");
  const typedFont = (cp) => X0.font(cp.typedWeight ?? 500, 46, cp.family ?? "Geist");

  // ================================================================================================ layout caches
  const cache = new Map();
  const memo = (S, key, make) => { const k = `${S.W}x${S.H}|${S.lang}|${key}`; if (!cache.has(k)) cache.set(k, make()); return cache.get(k); };

  /** The scrawl's words laid out in the side column: ragged left, at most two words per line (three in 16:9). */
  function scrawlWords(S) {
    return memo(S, "scrawl", () => {
      const { ctx, L } = S, cp = copyOf(S), col = L.side, font = scrawlFont(cp), pitch = S.portrait ? 72 : 60, maxPer = S.portrait ? 2 : 3;
      const space = X0.width(ctx, " ", font) * 1.35, out = [];
      let line = 0, lx = 0, n = 0, x0 = col.x + (X0.hash(701) - 0.5) * 14;
      cp.scrawl.forEach((text, i) => {
        const w = X0.width(ctx, text, font);
        if (n > 0 && (n >= maxPer || lx + space + w > col.w - 8)) { line++; lx = 0; n = 0; x0 = col.x + (X0.hash(701 + line) - 0.5) * 18; }
        out.push({ text, i, line, x: x0 + lx, y: col.y + (S.portrait ? 90 : 84) + line * pitch, w, size: 68, f0: 256 + i * cp.per });
        lx += w + space; n++;
      });
      return { words: out, font, lines: line + 1, cp };
    });
  }
  /** The chat card's boxes: the input pill (two lines tall) and the send circle. */
  function chatGeo(S) {
    const st = S.L.stage, pill = { x: st.x + 24, y: st.y + st.h - 24 - 120, w: st.w - 48, h: 120 };
    return { x: st.x, y: st.y, w: st.w, h: st.h, pill, send: { cx: pill.x + pill.w - 60, cy: pill.y + 60, r: 44 } };
  }
  /** The typed words' places in the pill (two lines at 52 px pitch), the comma and the full stop after their words. */
  function pillLayout(S) {
    return memo(S, "pill", () => {
      const { ctx } = S, cp = copyOf(S), g = chatGeo(S), font = typedFont(cp), sp = X0.width(ctx, " ", font);
      const lines = cp.lines.map((ws, li) => { let x = g.pill.x + 36; const y = g.pill.y + 46 + li * 52; return ws.map(([text, f0, twin, late]) => { const w = X0.width(ctx, text, font); const o = { text, f0, twin, late: !!late, x, y, w }; x += w + sp; return o; }); });
      const l0 = lines[0][lines[0].length - 1], l1 = lines[1][lines[1].length - 1];
      return { font, lines, comma: { x: l0.x + l0.w + 1, y: l0.y, f0: cp.comma }, stop: { x: l1.x + l1.w + 3, y: l1.y, f0: cp.stop, glyph: cp.stopGlyph },
        text: [cp.lines[0].map((w) => w[0]).join(" ") + ",", cp.lines[1].map((w) => w[0]).join(" ") + (cp.stopGlyph ?? ".")] };
    });
  }
  /** The day card's rows and rail (the look of screens/plan.pop.png): Fri, five times, a 2 px rail, cards right of it.
   *  9:16 rows are 96 px apart on a 540 px card (not 76 on 430): the hooked note, 330 x 141 at its 22 deg arrival, reaches
   *  1290 from the 5 pm hook at 1036, so the 8 pm card (top 1295) is clear of it on every swing. */
  function dayGeo(S) {
    const { L } = S, st = L.stage, p = S.portrait, x = st.x, y = st.y, w = st.w, h = p ? 540 : st.h;
    // (9:16: the time column 12 px further left, so the hanging note's torn edge at 22 deg clears the 'm' of '6 pm')
    const rail = x + (p ? 168 : 270), rows = [0, 1, 2, 3, 4].map((i) => y + (p ? 90 : 100) + (p ? 96 : 100) * i), tx = x + (p ? 28 : 40);
    return { x, y, w, h, fri: { x: tx, y: y + 46 }, timeX: tx, rail, cardX: rail + 40, rows, dinnerW: p ? 620 : x + w - 40 - (rail + 40), dentistW: 480, cardH: 58 };
  }
  /** Where the dentist note waits on the heap's tail (Keybot) before it flies to L.planNote: tucked under the stage card so
   *  that only a blank torn wedge of its lower edge shows below the card (its handwriting, the darkest text on the page, would
   *  compete with the grey scrawl, and in 16:9 the frame's bottom cut 'Friday 5 pm' in half). At -10 deg the lowest point of
   *  'Friday 5 pm' (its left end, descenders in) is 74 px below the note's centre; the paper's corner 98 px. 16:9 also keeps
   *  the whole note left of the card's right edge (x 1800), so nothing of it peeks out beside the card. */
  const tailNote = (S) => S.portrait ? { x: S.L.stage.x + S.L.stage.w * 0.5, y: S.L.heap.tailY - 74 } : { x: 1625, y: S.L.heap.tailY - 74 };
  const tailDx = (S) => S.portrait ? 0 : 520;   // 16:9: the heap's tail sits in the bottom-right corner

  // ================================================================================================ small helpers
  /** The corner-pivot of a rotated box: the centre of a w x h note whose local point (ax, ay) sits at (px, py), turned by rot. */
  function centreFromPivot(px, py, ax, ay, w, h, rot) {
    const lx = w / 2 - ax, ly = h / 2 - ay, c = Math.cos(rot), s = Math.sin(rot);
    return [px + lx * c - ly * s, py + lx * s + ly * c];
  }
  /** Text popping in: on its frame at scale 1.08 and half alpha, settled in n frames. */
  function popText(S, text, x, y, font, color, f, f0, n = 3, o = {}) {
    if (f < f0) return; const { ctx } = S, k = fr(f, f0, n), e = E.o3(k), s = 1.08 - 0.08 * e, w = X0.width(ctx, text, font);
    ctx.save(); ctx.globalAlpha *= (o.alpha ?? 1) * (0.5 + 0.5 * e);
    ctx.translate(x + w / 2 + (o.dx ?? 0), y - 16 + (o.dy ?? 0)); ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y - 16));
    X0.text(ctx, text, x, y, font, color); ctx.restore();
  }
  /** An ink bubble (from you): right edge at rx, two lines of the given font, white on ink, radius 28. */
  function inkBubble(S, lines, rx, y, size, font, alpha = 1) {
    const { ctx } = S, pad = size * 0.65, lh = size * 1.25; let w = 0; for (const l of lines) w = Math.max(w, X0.width(ctx, l, font));
    const bw = w + 2 * pad, bh = lines.length * lh + pad * 1.1, bx = rx - bw;
    ctx.save(); ctx.globalAlpha *= clamp(alpha); ctx.fillStyle = C.ink; X0.rrect(ctx, bx, y, bw, bh, 28); ctx.fill();
    lines.forEach((l, i) => X0.text(ctx, l, bx + pad, y + pad * 0.55 + size * 0.95 + i * lh, font, "#FFFFFF")); ctx.restore(); return bh;
  }
  const bubbleH = (size, n = 2) => n * size * 1.25 + size * 0.65 * 1.1;
  /** A small app card inside the day: white, hairline, a light pencil shadow, one line of Geist 500 46 ink. */
  function miniCard(S, x, y, w, h, text, o = {}) {
    const { ctx } = S; ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    if (o.sx != null || o.sy != null) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(o.sx ?? 1, o.sy ?? 1); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    CM.stageCard(S, x, y, w, h, { r: 16, shadow: 0.35 });
    if (text) X0.text(ctx, text, x + 24, y + h / 2 + 16, X0.font(500, 46), C.ink);
    ctx.restore();
  }

  // ================================================================================================ Keybot: the chat card
  /** The stage card as the real chat: Mom's bubble and time (scrolling up with the send), the two-line input pill with the
   *  send circle, the typed words landing in the pill, the sent ink bubble rising. `dy` moves the whole card (the exit). */
  function chatCard(S, f, dy = 0) {
    const { ctx } = S, g = chatGeo(S), lay = pillLayout(S), x = g.x, y = g.y + dy, w = g.w, h = g.h;
    CM.stageCard(S, x, y, w, h);
    ctx.save(); ctx.translate(0, dy);
    X0.rrect(ctx, g.x, g.y, w, h, 28); ctx.clip();
    // the chat: Mom's bubble and its time, scrolling up as the message is sent (clipping at the card's top as a chat does;
    // in 9:16 it scrolls 160 so the time clears his fingers hanging over the edge and the bubble stops in its bottom padding:
    // a clean grey sliver at the card's edge, no glyph bottoms)
    const ks = f >= 368 ? E.o3(fr(f, 368, 11)) : 0, scroll = (S.portrait ? 160 : 70) * ks, top = g.y + (S.portrait ? 28 : 90);
    const b = CM.bubble(S, ["Dinner at 8,", "everyone home?"], g.x + 28, top - scroll, 44), timeY = top + b.h + 46 - scroll;
    // 9:16: the time fades out as it scrolls (f366-f374): scrolled 160 it lands under his left glove for the whole
    // look-at-you hold (f376-f412), and the sent bubble carries the beat
    const timeA = S.portrait ? 1 - fr(f, 366, 8) : 1;
    if (timeA > 0) { ctx.save(); ctx.globalAlpha *= timeA; X0.text(ctx, "7:28 pm", g.x + 32, timeY, X0.font(500, 44), C.grey); ctx.restore(); }
    // the input pill: two lines tall, hairline, the black send circle with its arrow (the one shared control)
    const p = g.pill; ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, p.x, p.y, p.w, p.h, 40); ctx.stroke();
    CM.sendButton(S, g.send.cx, g.send.cy, 2 * g.send.r);
    // the typed words (they slide up out of the pill with the send)
    if (ks < 1) {
      ctx.save(); X0.rrect(ctx, p.x + 2, p.y + 2, p.w - 4, p.h - 4, 38); ctx.clip(); ctx.globalAlpha *= 1 - ks; ctx.translate(0, -70 * ks);
      pillWords(S, f, lay); ctx.restore();
    }
    // the sent bubble: rises from the pill to its place under the time, fading in
    if (f >= 368) {
      const bh = bubbleH(46), y1 = Math.min(p.y - 16 - bh, timeY + 36), y0 = p.y + (p.h - bh) / 2;
      inkBubble(S, lay.text, g.x + w - 28, lerp(y0, y1, ks), 46, lay.font, K(ks, 0, 0.5));
    }
    ctx.restore();
    // the card's hairline again, over the chat: the scrolled bubble is cut by a visible edge (a chat's top), not floating past it
    ctx.save(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, 28); ctx.stroke(); ctx.restore();
    return g;
  }
  /** The clean words dropping into the pill on 16ths; the 'late' slot stays a hole until 'late' drops into it from above
   *  with two ghosts; the dip-pen comma and the full stop fall in. */
  function pillWords(S, f, lay) {
    const { ctx, A } = S, font = lay.font, late = [];
    for (const line of lay.lines) for (const w of line) {
      if (f < w.f0) continue;
      if (w.late) late.push(w);
      else popText(S, w.text, w.x, w.y, font, C.ink, f, w.f0, 3, { dy: -8 * (1 - E.o3(fr(f, w.f0, 3))) });
    }
    // 'late' drops into its hole from above (6 f): 12 px right of the hole and 56 px up, x easing in, y on a back-ease that
    // overshoots ~6 px below the baseline and settles; its two ghosts are 1 and 2 frames behind on the same path, up into
    // the pill's top padding (the pill's clip cuts them), so nothing ever crosses the landed words to its right
    for (const w of late) {
      const at = (kk) => [w.x + 12 * (1 - E.o3(kk)), w.y - 56 * (1 - E.back(1.7)(kk))];
      for (const [g, a] of [[2, 0.12], [1, 0.25]]) { if (f - g < w.f0) continue; const kg = fr(f - g, w.f0, 6); if (kg < 1) { const [gx, gy] = at(kg); X0.text(ctx, w.text, gx, gy, font, C.ink, "left", { alpha: a }); } }
      const k = fr(f, w.f0, 6), [x, y] = at(k), sq = f === w.f0 + 3 ? 0.92 : 1;   // the one-frame squash at the bottom of the overshoot
      ctx.save(); ctx.globalAlpha *= 0.35 + 0.65 * k;
      if (sq !== 1) { ctx.translate(0, w.y); ctx.scale(1, sq); ctx.translate(0, -w.y); }
      X0.text(ctx, w.text, x, y, font, C.ink); ctx.restore();
    }
    // the dip-pen comma: the same short drop (4 f from 40 px up, the back-ease, one ghost a frame behind), then the 2 f
    // squash; small, right after its word, hanging under the baseline
    if (f >= lay.comma.f0) {
      const c = lay.comma, im = A["ink-comma"], h = 22, w = h * im.width / im.height, at = (kk) => c.y + 9 - 40 * (1 - E.back(1.7)(kk));
      const draw = (kk, a, sq) => { ctx.save(); ctx.globalAlpha *= a; ctx.translate(c.x + w / 2, at(kk)); ctx.scale(sq.sx, sq.sy); ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore(); };
      if (f - 1 >= c.f0 && fr(f - 1, c.f0, 4) < 1) draw(fr(f - 1, c.f0, 4), 0.25, { sx: 1, sy: 1 });
      const kk = fr(f, c.f0, 4); draw(kk, 0.3 + 0.7 * kk, CM.squash(f, c.f0 + 4));
    }
    // the full stop (the ink dot; the danda in Devanagari): the same fall, onto the baseline
    if (f >= lay.stop.f0) {
      const s = lay.stop, kk = fr(f, s.f0, 4), k = E.i2(kk), sq = CM.squash(f, s.f0 + 4);
      ctx.save(); ctx.globalAlpha *= 0.3 + 0.7 * kk; ctx.translate(s.x + 7, s.y - 36 * (1 - k)); ctx.scale(sq.sx, sq.sy);
      if (s.glyph) X0.text(ctx, s.glyph, -7, 0, font, C.ink); else { const im = A["ink-dot"], d = 13; ctx.drawImage(im, -d / 2, -d * im.height / im.width, d, d * im.height / im.width); }
      ctx.restore();
    }
  }

  // ================================================================================================ Keybot: the voice
  /** The listening state where a phone viewer expects it, in the input pill's left end: a 44 px ink mic with three bars
   *  that pulse as each spoken word lands (bars mean listening; dots over a character's head mean HE is typing, which is
   *  what the old clay dots beside his head said). It fades as his hand lifts for the flick (f304), so the pill then reads
   *  'now typing'. */
  function listenMic(S, f, sw) {
    if (f < 256 || f >= 312) return; const { ctx } = S, p = chatGeo(S).pill, fade = f >= 304 ? 1 - fr(f, 304, 8) : 1, cx = p.x + 48, cy = p.y + p.h / 2;
    let amp = 0; for (const w of sw.words) if (f >= w.f0) { const k = f - w.f0; amp = k < 3 ? E.o3(k / 3) : Math.max(0, 1 - E.io((k - 3) / 9)); }
    ctx.save(); ctx.globalAlpha *= fade; ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineCap = "round"; ctx.lineJoin = "round";
    // the mic: a capsule head, the cradle arc, the stem and its foot
    X0.rrect(ctx, cx - 8, cy - 22, 16, 28, 8); ctx.fill();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy - 4, 14, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + 20); ctx.moveTo(cx - 8, cy + 20); ctx.lineTo(cx + 8, cy + 20); ctx.stroke();
    // the three bars: 6 / 12 / 8 px at rest, up to 16 / 28 / 20 on a word, each with its own small jitter
    ctx.lineWidth = 4;
    [[6, 16], [12, 28], [8, 20]].forEach(([h0, h1], i) => {
      const h = lerp(h0, h1, amp * (0.85 + 0.15 * X0.hash(f * 7 + i * 13))), bx = cx + 36 + i * 11;
      ctx.beginPath(); ctx.moveTo(bx, cy - h / 2); ctx.lineTo(bx, cy + h / 2); ctx.stroke();
    });
    ctx.restore();
  }
  /** One scrawled word written on left to right to k, at alpha (the Devanagari cut jitters whole words, not glyphs). */
  function scrawlWord(S, w, k, alpha, sw) {
    if (k <= 0 || alpha <= 0) return; const { ctx } = S, cp = sw.cp;
    ctx.save(); ctx.globalAlpha *= clamp(alpha);
    if (k < 1) { ctx.beginPath(); ctx.rect(w.x - 8, w.y - w.size, (w.w + 16) * k, w.size * 1.5); ctx.clip(); }
    if (cp.whole) { ctx.translate(w.x + w.w / 2, w.y + (X0.hash(97 * w.i + 5) - 0.5) * 3); ctx.rotate((X0.hash(31 * w.i + 7) - 0.5) * 0.035); X0.text(ctx, w.text, -w.w / 2, 0, sw.font, C.grey); }
    else CM.scrawl(S, w.text, w.x, w.y, w.size, C.grey, 1, 11 + w.i * 3, cp.weight ?? 700, cp.family ?? "Caveat");
    ctx.restore();
  }
  /** The scrawl as he listens: one word per 16th (English: 6 f), each a 3-frame write-on; each fades as its typed twin
   *  lands; 'umm' is gone once it is torn off (f313). */
  function scrawl(S, f, sw) {
    const lay = pillLayout(S), twinF = new Map(); for (const line of lay.lines) for (const w of line) twinF.set(w.twin, w.f0);
    for (const w of sw.words) {
      if (f < w.f0) continue;
      if (w.i === 0 && f >= 313) continue;
      const tf = twinF.get(w.i), alpha = tf != null && f >= tf ? 1 - fr(f, tf, 3) : 1;
      scrawlWord(S, w, E.o3(fr(f, w.f0, 3)), alpha, sw);
    }
  }
  /** 'umm' torn off as a scrap (the word masked by the torn paper's alpha) spinning off the top-right corner, f313-f325. */
  function ummScrap(S, f, sw) {
    const k = fr(f, 313, 12); if (f < 313 || k >= 1) return;
    const { ctx, A, L } = S, w0 = sw.words[0], im = A["scrap-tiny"], bw = w0.w + 48, bh = bw * im.height / im.width;
    const cx0 = w0.x + w0.w / 2, cy0 = w0.y - 14, kk = E.i2(k), cx = lerp(cx0, L.W + 240, kk), cy = lerp(cy0, -240, kk), rot = D(400) * k;
    const cv = X0.offscreen(bw, bh), c = cv.getContext("2d");
    c.drawImage(im, 0, 0, bw, bh);
    if (sw.cp.whole) { c.save(); c.font = sw.font; c.fillStyle = C.grey; c.textBaseline = "alphabetic"; c.fillText(w0.text, bw / 2 - w0.w / 2, bh / 2 + 14); c.restore(); }
    else CM.scrawl({ ctx: c }, w0.text, bw / 2 - w0.w / 2, bh / 2 + 14, w0.size, C.grey, 1, 11, sw.cp.weight ?? 700, sw.cp.family ?? "Caveat");
    c.save(); c.globalCompositeOperation = "destination-in"; c.drawImage(im, 0, 0, bw, bh); c.restore();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    X0.hatchShadow(ctx, A.hatch, -bw / 2 + 6, -bh / 2 + 6, bw - 12, bh - 12, 8, 1, { alpha: 0.35 * (1 - k) });
    ctx.drawImage(cv, -bw / 2, -bh / 2); ctx.restore(); X0.release(cv);
  }

  // ================================================================================================ Keybot: the peek
  /** The glove sprites' resting centres for a peek (the rig's own arithmetic), in screen px at rise 1. */
  function peekGloves(S, pose, x, y, w) {
    const R = S.R, fm = R.meta[`bot-${pose}-nohands`], s = w / fm.w, up = fm.ledge * s;
    return ["glove-L", "glove-R"].map((n) => { const gm = R.meta[n], gx = (gm.x0 - fm.x0) * s, gy = (gm.y0 - fm.y0) * s, gw = gm.w * s, gh = gm.h * s; return { cx: x - w / 2 + gx + gw / 2, cy: y - up + gy + gh / 2, w: gw, h: gh }; });
  }
  /** THE FLICK: the right glove lifts off the ledge, arcs to 'umm' (8 f, -20 deg), snaps +25 deg in 3 f, returns in 9 f. */
  function flickGlove(S, f, rest, umm, faceDx, faceDy) {
    if (f < 304 || f >= 324) return {};
    const tip = [umm.x + umm.w * 0.45, umm.y - 14], tg = [tip[0], tip[1] - rest.h / 2], r0 = [rest.cx, rest.cy];
    let p, rot;
    if (f < 312) { const k = E.io(fr(f, 304, 8)); p = CM.arc(r0, [(r0[0] + tg[0]) / 2 + 120, (r0[1] + tg[1]) / 2 + 20], tg, k); rot = -20 * k; }
    else if (f < 315) { const k = E.o3(fr(f, 312, 3)); p = [tg[0] + 16 * k, tg[1] - 4 * k]; rot = -20 + 25 * k; }
    else { const k = E.io(fr(f, 315, 9)); p = CM.arc([tg[0] + 16, tg[1] - 4], [(r0[0] + tg[0]) / 2 + 80, (r0[1] + tg[1]) / 2 + 50], r0, k); rot = 5 * (1 - k); }
    return { dx: p[0] - rest.cx - faceDx, dy: p[1] - rest.cy - faceDy, rot: D(rot) };
  }
  /** The glove sprites drawn as peekRig lays them (each about its own centre: translate, rotate, flip, scale), but from
   *  here: always at the CURIOUS frame's places (the sprites were cut from that frame; peek.json has one glove entry, and
   *  the happy frame's x0 is 59 against curious's 157, so laying them from the happy frame slid them 66 px right at the
   *  swap), and outside the face's lean. `dx, dy` are the face's glance; `rise` fades and lowers them as peekRig does. */
  function peekGlovesDraw(S, f, x, ledgeY, w, rise, dx, dy, gloves) {
    const { ctx, R } = S, r = clamp(rise); if (r <= 0.6) return;
    const fm = R.meta["bot-curious-nohands"], up = fm.ledge * (w / fm.w), gl = peekGloves(S, "curious", x, ledgeY, w);
    ["glove-L", "glove-R"].forEach((n, i) => {
      const g = gloves[i] || {}, p = gl[i]; if (g.hide) return;
      ctx.save(); ctx.globalAlpha *= K(r, 0.6, 1);
      ctx.translate(p.cx + dx + (g.dx ?? 0), p.cy + dy + (1 - r) * (up + 6) + (g.dy ?? 0)); ctx.rotate(g.rot ?? 0); if (g.flip) ctx.scale(1, -1); if (g.scale) ctx.scale(g.scale, g.scale);
      ctx.drawImage(R.img[n], -p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
  }
  /** His face through Keybot: curious, leaning to the words as he listens, then following the flick and the pill; happy for
   *  the ta-da (f384-f394); curious again, eyes open at you, for the look (f394-f408); the duck at f408. `ledgeY` is the
   *  card's top edge (it rides up with the card at the exit). */
  function keybotPeek(S, f, ledgeY, sw) {
    const { ctx, R, L } = S, pose = f >= 384 && f < 394 ? "happy" : "curious", x = L.peekX, w = L.peekW;
    const rise = f >= 408 ? 1 - E.i2(fr(f, 408, 6)) : 1;
    // the gaze: a translation of the whole face; while he listens (f256-f298) a 16 px slide toward the column and a 2.5 deg
    // lean to it, in over f256-f262, out over f292-f298 so he is square for the flick; the dy tracks the line being written
    let dx = 0, dy = 0, lean = 0;
    if (f < 298) { const cur = sw.words.filter((w) => f >= w.f0).pop() || sw.words[0], nl = Math.max(1, sw.lines - 1), k = E.o3(fr(f, 256, 6)) * (f >= 292 ? 1 - E.io(fr(f, 292, 6)) : 1); dx = 16 * k; dy = (-6 + 8 * cur.line / nl) * k; lean = D(2.5) * k; }
    else if (f >= 304 && f < 324) { const k = E.bump(fr(f, 304, 20)); dx = 6 * k; dy = -6 * k; }
    else if (f >= 324 && f < 368) dy = 5 * E.io(fr(f, 324, 6));
    else if (f >= 368 && f < 382) dy = 5 * (1 - E.io(fr(f, 372, 8)));
    // the dip that hides the swap to happy (f382-f385), the ta-da hop (f386-f391), the 2 f landing dip that hides the swap
    // back to the open-eyed curious face (f392-f393), then still, eyes on you, for the look (f394-f407)
    let hop = 0;
    if (f >= 382 && f < 386) hop = [10, 20, 20, 10][f - 382];
    else if (f >= 386 && f < 392) { const k = fr(f, 386, 9); hop = -24 * (k < 0.4 ? E.o3(k / 0.4) : 1 - E.back(1.5)(K(k, 0.4, 1))); }
    else if (f >= 392 && f < 394) hop = 20;
    const bob = f >= 394 && f < 408 ? 0 : CM.bob(f) * 0.5, dyT = dy + hop + bob;
    const gl = peekGloves(S, "curious", x, ledgeY, w), umm = sw.words[0];
    const gloves = [
      { dy: f >= 368 && f < 374 ? -40 * E.bump(fr(f, 368, 6)) : 0 },   // the left glove taps the send
      flickGlove(S, f, gl[1], umm, dx, dyT),
    ];
    // the face alone (its gloves hidden, drawn after, unleaned). The lean turns about the LEFT end of the face's cut line,
    // so the rig's own cut line only dips below the card's edge (never above it, which would open a wedge of paper between
    // him and the card), and an outer clip at the edge cuts him square there
    ctx.save();
    if (lean) { ctx.beginPath(); ctx.rect(0, -L.H, L.W, L.H + ledgeY); ctx.clip(); }
    const px = lean ? x - w / 2 : x, geo = X0.peekRig(ctx, R, pose, px, ledgeY, w, rise, { lean, dx: dx + (x - px), dy: dyT, gloves: [{ hide: true }, { hide: true }] });
    ctx.restore();
    peekGlovesDraw(S, f, x, ledgeY, w, rise, dx, dyT, gloves);
    return geo;
  }
  /** The heap's tail under the stage card (3 items) with the dentist note resting on top, tucked under the card, until it
   *  lifts off at f408. */
  function keybotTail(S, f) {
    // 16:9: the tail's corner is clean from the moment the note flies out (only a bare arc of the ring would stay)
    const { ctx, L } = S; if (S.portrait || f < 410) CM.heapTail(S, 3, { dx: tailDx(S) });
    if (f < 408) { const p = tailNote(S); ctx.save(); ctx.globalAlpha *= 0.9; CM.dentistNote(S, p.x, p.y, 330, D(-10)); ctx.restore(); }
  }
  /** The note lifting off the heap and flying up-right to where he will hang next (f408-f416, E.o3). Its first two frames
   *  are drawn UNDER the stage card (it starts tucked beneath it, and at f409 it is wholly behind it), so it comes out from
   *  behind the card's top edge at f410 rather than popping whole over the card's pill at f408. */
  const NOTE_OUT = 410;   // the first frame the flying note is in front of the card
  function flyingNote(S, f) {
    if (f < 408) return; const k = E.o3(fr(f, 408, 8)), a = tailNote(S), b = S.L.planNote;
    // 9:16 bulges right, round his head; 16:9 rises almost straight (its words stay under the card while it is behind it)
    const p = CM.arc([a.x, a.y], [(a.x + b.x) / 2 + (S.portrait ? 140 : -20), (a.y + b.y) / 2 + 40], [b.x, b.y], k);
    CM.dentistNote(S, p[0], p[1], 330, D(lerp(-10, -12, k)), { alpha: 0.9 + 0.1 * k });
  }
  /** The headline size: the layout's in 9:16; in 16:9 the left column ends at the stage card (x 800), so 90 px keeps
   *  'Keybot writes it' and 'planned for you' clear of its edge. */
  const headSize = (S) => S.portrait ? S.L.headSize : Math.min(S.L.headSize, 90);
  const keybotHeadline = (S, f) => CM.headline(S, f, { lines: ["Say it", "Keybot writes it"], hand: { line: 1, word: "writes" }, ul: S.A["ul-keybot"], at: { l1: 256, l2: 376, hand: 379, ul: 384 }, size: headSize(S), handSize: headSize(S) * 110 / 96 });

  // ================================================================================================ the Keybot beats
  FILM.register({
    name: "keybot-say", f0: 256, f1: 368,
    draw(S, f) {
      const sw = scrawlWords(S);
      keybotTail(S, f);
      chatCard(S, f, 0);
      listenMic(S, f, sw);
      scrawl(S, f, sw);
      keybotPeek(S, f, S.L.stage.y, sw);
      ummScrap(S, f, sw);
      keybotHeadline(S, f);
    },
    cues(S) {
      const cp = copyOf(S), c = [{ f: 256, kind: "listen", gain: 0.5 }, { f: 256, kind: "tick", gain: 0.3 }];
      cp.scrawl.forEach((_, i) => c.push({ f: 256 + i * cp.per, kind: "tick", gain: 0.2 }));
      c.push({ f: 304, kind: "whoosh", dur: 0.25, up: true, gain: 0.5 });
      for (const line of cp.lines) for (const [, f0, , late] of line) { if (late) { c.push({ f: f0, kind: "key", gain: 0.6 }, { f: f0, kind: "land", gain: 0.4 }); } else c.push({ f: f0, kind: "key", gain: 0.5 }); }
      c.push({ f: cp.comma, kind: "land", gain: 0.4 }, { f: cp.stop, kind: "click", gain: 0.5 });
      return c;
    },
  });

  FILM.register({
    name: "keybot-sent", f0: 368, f1: 416,
    draw(S, f) {
      const sw = scrawlWords(S), g = chatGeo(S);
      const dy = f >= 408 ? -1500 * E.i3(fr(f, 408, 8)) : 0;   // the card flies up and off the top
      keybotTail(S, f);
      if (f < NOTE_OUT) flyingNote(S, f);
      chatCard(S, f, dy);
      CM.tapRing(S, f, 368, g.send.cx, g.send.cy + dy, 60);
      keybotPeek(S, f, g.y + dy, sw);
      if (f >= NOTE_OUT) flyingNote(S, f);
      keybotHeadline(S, f);
    },
    cues() {
      return [
        { f: 368, kind: "send", gain: 0.6 }, { f: 376, kind: "tick", gain: 0.3 }, { f: 379, kind: "write", gain: 0.4 },
        { f: 384, kind: "notify", gain: 0.35 }, { at: 384 / 30, kind: "bell", f: 293.66, dur: 1.2, gain: 0.4 },
        { f: 384, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 }, { f: 408, kind: "whoosh", dur: 0.3, up: true, gain: 0.45 },
      ];
    },
  });

  // ================================================================================================ Plan: the note's path
  const NOTE_W = 330, NOTE_H = 330 * 546 / 1281, NOTE_REST = D(-12), HOOK_ROT = D(22);
  const HANG_REST = 10, SWING = 12;   // degrees: where the hooked note settles, and the first swing's amplitude (it arrives at 22)
  /** Where his flipped right glove's fingertip rests (screen px): the glove's centre x at the bar's bottom, plus the
   *  fingers' length below it once flipped. */
  function gloveTipRest(S) { const T = S.L.heroPlan, s = T.size / HANG.ART; return { x: T.x + HANG.GLOVES[1].cx * s, y: T.y + (HANG.GLOVE_CY + 26.4) * s, s }; }
  /** The grab point on the note: 9:16 grabs the top edge where it shows past his ear; 16:9 grabs the corner itself. */
  const grabLocal = (S) => S.portrait ? [94, 0] : [0, 0];
  function noteRestCorner(S) { const n = S.L.planNote, c = Math.cos(NOTE_REST), s = Math.sin(NOTE_REST), lx = -NOTE_W / 2, ly = -NOTE_H / 2; return [n.x + lx * c - ly * s, n.y + lx * s + ly * c]; }
  function grabPoint(S) { const [cx, cy] = noteRestCorner(S), [ax, ay] = grabLocal(S), c = Math.cos(NOTE_REST), s = Math.sin(NOTE_REST); return [cx + ax * c - ay * s, cy + ax * s + ay * c]; }
  const hookPoint = (S) => { const g = dayGeo(S); return [g.rail + 4, g.rows[1]]; };
  /** Where the carry ends and how the glove holds the note there. 9:16: the pinch is 36 px in from the note's corner along its
   *  top edge and the glove turned +40 deg (its fingers coming in from his body's side, the right), so the glove sits right
   *  of the rail (x ~248-358), clear of the '4 pm' / '5 pm' labels, while the corner itself still lands on the hook; 16:9
   *  pinches the corner at -30 deg (its labels are 125 px clear of the rail). */
  const carryEnd = (S) => { const hook = hookPoint(S), ax = S.portrait ? 36 : 0; return { ax, p: [hook[0] + ax * Math.cos(HOOK_ROT), hook[1] + ax * Math.sin(HOOK_ROT)] }; };
  const carryRot = (S) => S.portrait ? D(40) : D(-30);
  /** The pendulum once hooked: it arrives swung to 22 deg and settles toward 10, damped, extremes on the 8ths (f472, f480). */
  const swingDeg = (f) => SWING * Math.cos(Math.PI * (f - 464) / 8) * Math.exp(-(f - 464) / 24);
  const hookDeg = (f) => HANG_REST + swingDeg(f);
  const FLIP_AT = 480, CARD_AT = 488;   // the snap-and-flip to the clean card, and its landing (the notify)
  /**
   * The note at frame f (Plan): { mode, cx, cy, rot, w, h, pivot, local } where mode is rest | pinch | carry | hooked | flip | card.
   * The glove's fingertip is the pivot while it is held; the hook on the rail after.
   */
  function noteState(S, f) {
    const n = S.L.planNote, gp = grabPoint(S), [ax0, ay0] = grabLocal(S), tip = gloveTipRest(S), hook = hookPoint(S);
    if (f < 448) return { mode: "rest", cx: n.x, cy: n.y, rot: NOTE_REST, w: NOTE_W, h: NOTE_H };
    if (f < 456) {   // the pinch: it swings to hang from the fingertip
      const k = E.o3(fr(f, 448, 6)), rot = lerp(NOTE_REST, HOOK_ROT, k), [cx, cy] = centreFromPivot(gp[0], gp[1], ax0, ay0, NOTE_W, NOTE_H, rot);
      return { mode: "pinch", cx, cy, rot, w: NOTE_W, h: NOTE_H, pivot: gp, local: [ax0, ay0] };
    }
    if (f < 464) {   // the carry, down and left under his chin, the paper slipping along its top edge; the body swings ahead at the end
      const ce = carryEnd(S), k = E.io(fr(f, 456, 8)), p = CM.arc(gp, [(gp[0] + ce.p[0]) / 2, (gp[1] + ce.p[1]) / 2 + 150], ce.p, k);
      const ax = lerp(ax0, ce.ax, k), ay = 0, rot = HOOK_ROT, [cx, cy] = centreFromPivot(p[0], p[1], ax, ay, NOTE_W, NOTE_H, rot);
      return { mode: "carry", cx, cy, rot, w: NOTE_W, h: NOTE_H, pivot: p, local: [ax, ay] };
    }
    if (f < FLIP_AT) {   // hooked on the rail, swinging: two swing ends (f472, f480)
      const rot = D(hookDeg(f)), [cx, cy] = centreFromPivot(hook[0], hook[1], 0, 0, NOTE_W, NOTE_H, rot);
      return { mode: "hooked", cx, cy, rot, w: NOTE_W, h: NOTE_H, pivot: hook, local: [0, 0], swing: swingDeg(f) };
    }
    const g = dayGeo(S), card = { cx: g.cardX + g.dentistW / 2, cy: g.rows[1], w: g.dentistW, h: g.cardH };
    if (f < CARD_AT) {   // the flip: snaps flat, turns about its centre line, comes back as the clean card
      const fl = CM.flip(f, FLIP_AT, 8), k = fl.k, rot0 = D(hookDeg(FLIP_AT)), [cx0, cy0] = centreFromPivot(hook[0], hook[1], 0, 0, NOTE_W, NOTE_H, rot0);
      const rot = rot0 * (1 - E.o3(Math.min(1, k * 2))), e = E.io(k);
      return { mode: "flip", cx: lerp(cx0, card.cx, e), cy: lerp(cy0, card.cy, e), rot, w: lerp(NOTE_W, card.w, e), h: lerp(NOTE_H, card.h, e), sx: fl.sx, second: fl.second };
    }
    return { mode: "card", cx: card.cx, cy: card.cy, rot: 0, w: card.w, h: card.h };
  }
  /** Draw the note in its state: the torn paper with its handwriting, or the clean 'Dentist · 5:00 pm' card. */
  function drawNote(S, f, st) {
    const { ctx } = S;
    if (st.mode === "card") { const sq = CM.squash(f, CARD_AT); miniCard(S, st.cx - st.w / 2, st.cy - st.h / 2, st.w, st.h, "Dentist · 5:00 pm", { sx: sq.sx, sy: sq.sy }); return; }
    if (st.mode === "flip") {
      ctx.save(); ctx.translate(st.cx, st.cy); ctx.scale(Math.max(0.02, st.sx), 1); ctx.translate(-st.cx, -st.cy);
      if (st.second) miniCard(S, st.cx - st.w / 2, st.cy - st.h / 2, st.w, st.h, "Dentist · 5:00 pm");
      else CM.dentistNote(S, st.cx, st.cy, st.w, st.rot);
      ctx.restore(); return;
    }
    CM.dentistNote(S, st.cx, st.cy, st.w, st.rot);
  }

  // ================================================================================================ Plan: the hero
  /** The launch clock for the exit: the gather f488-f492 (420 -> 560 ms), the pull f492-f502 (560 -> 900), a short spring
   *  f502-f506 (900 -> 1250), the come-back at 1.5x f506-f520 (1400 -> 2120: gloves f506/f507, pinch f513, suck f515, gone
   *  f520). 16 f earlier than it was, so the ochre line and the headline have the stage from f520 to the flip at f571. */
  const LAUNCH_AT = 488;
  function planClock(f) {
    const g = f - LAUNCH_AT;
    if (g < 0) return null;
    if (g < 4) return 420 + g * 35;
    if (g < 14) return 560 + (g - 4) * 34;
    if (g < 18) return 900 + (g - 14) * 87.5;
    if (g < 32) return 1400 + (g - 18) * (720 / 14);
    return HANG.GONE_AT + 10;
  }
  // The launch's glove numbers (engine.js hang(): LET_GO_MS 140, COME_BACK_MS 200, CLOSE_MS 150), so the come-back gloves can
  // be drawn here, from the come-back to the end, with the bar in front of them.
  const CB = { MS: 200, CLOSE_MS: 150, FINGERS: 29, SLIDE: HANG.GLOVE_CY - HANG.BAR_MID };
  const heldAt = (side) => side ? HANG.MID + HANG.GLOVES[1].half + 1 : HANG.MID - HANG.GLOVES[0].half - 1;
  /** hang()'s glove(side, t) once it is coming back, except `lift`: the glove starts fully behind the bar (its centre on the
   *  bar's middle) and slides to its hold, instead of flying in from a quarter of the art away, fading in. */
  function cbGlove(side, t) {
    const c = HANG.COME_BACK[side], landed = c + CB.MS, back = E.o3(K(t, c, landed));
    const close = E.smooth(K(t, HANG.GONE_AT - CB.CLOSE_MS, HANG.GONE_AT)), wring = K(t, HANG.SUCK_AT, HANG.GONE_AT), x = heldAt(side);
    return { landed, lift: (1 - back) * CB.SLIDE * (side ? -1 : 1), flip: side ? 1 : -1, gx: x + (HANG.MID - x) * close - HANG.GLOVES[side].cx,
      grip: E.smooth(K(t, 560, 680)) * 0.22 + Math.sin(K(t, landed - 30, landed + 110) * Math.PI) * 0.12, turn: Math.sin(wring * Math.PI * 2) * (1 - close) * 10 * (side ? 1 : -1), size: 1 - close };
  }
  /**
   * The gloves of the come-back (t 1400 -> 2120), drawn here rather than by hang(): opaque, with the free glove's ink line
   * (they are on white paper once the head is gone), never faded. Each slides out from behind the bar to its hold, the palm
   * emerging past the bar's edge (the left over the top, flipped; the right under the bottom), then its fingers wrap over
   * the bar's face. The `behind` pass draws each whole glove under the bar; the `front` pass draws it over the bar clipped
   * from the bar's edge across the fingers, growing with the wrap (1 = the whole glove in front, as hang() holds it), so
   * there is no z-order pop; then the pinch and the suck as hang() has them (the close to the middle, the wring, the shrink).
   */
  function comeBackGloves(S, t, pass, which = "heroPlan") {
    const { ctx, A, L } = S, T = L[which], s = T.size / HANG.ART, { ART, MID, BAR, BAR_MID, GLOVES } = HANG;
    const bar = HANG.COME_BACK.reduce((k, c, side) => k + Math.sin(K(t, c + CB.MS - 20, c + CB.MS + 70) * Math.PI) * (side ? -0.9 : 0.9), 0) * 4;   // hang()'s grab dip
    const ink = X0.tint(A.hands, C.ink), r = 3 / s;
    // the wrap's clip edge snapped to a device pixel: the glove is nine draws (the ink ring and the cream), and a fractional
    // clip edge would composite its anti-aliased row nine times into a seam across the glove
    const snap = (ya) => (Math.round(S.u * (T.y + s * (bar + ya))) / S.u - T.y) / s - bar;
    ctx.save(); ctx.translate(T.x, T.y); ctx.scale(s, s); ctx.translate(0, bar);
    for (const side of [0, 1]) {
      if (t < HANG.COME_BACK[side]) continue;
      const g = cbGlove(side, t), kw = E.o3(K(t, g.landed - 50, g.landed + 110)), cx = GLOVES[side].cx;
      if (pass === "behind" && kw >= 1) continue;   // wrapped: the front pass is the whole glove
      ctx.save(); ctx.beginPath();
      // this glove's half of the hands layer (4 px past the middle so its ink line is whole), and in front only the wrap,
      // from 3 px inside the bar's edge (so the clip's edge sits under the bar until the wrap begins)
      if (pass === "behind") ctx.rect(side ? MID - 4 : -ART, -ART, side ? ART * 2 : MID + 4 + ART, ART * 3);
      else if (side) { const e = snap(BAR.y1 - 3 - CB.FINGERS * kw); ctx.rect(MID - 4, e, ART * 2, ART * 3); }
      else { const e = snap(BAR.y0 + 3 + CB.FINGERS * kw); ctx.rect(-ART, -ART, MID + 4 + ART, ART + e); }
      ctx.clip();
      ctx.translate(cx, BAR_MID); ctx.translate(g.gx, g.lift); ctx.rotate(D(g.turn)); ctx.scale(g.size, g.size); ctx.translate(-cx, -BAR_MID);
      ctx.translate(0, BAR_MID); ctx.scale(1, g.flip); ctx.translate(0, -BAR_MID);
      ctx.translate(0, BAR.y1); ctx.scale(1, 1 - g.grip); ctx.translate(0, -BAR.y1);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.drawImage(ink, Math.cos(a) * r, Math.sin(a) * r, ART, ART); }
      ctx.drawImage(A.hands, 0, 0, ART, ART);
      ctx.restore();
    }
    ctx.restore();
  }
  /** His right glove once it has let go: the hang's hands layer, right half, flipped (fingers down), its centre carried
   *  to `c` (screen px), turned by rot (radians) about its centre, scaleY `sy` (-1 flipped ... 1 gripping). */
  function freeGlove(S, c, rot, sy = -1) {
    const { ctx, A, L } = S, T = L.heroPlan, s = T.size / HANG.ART, gx = HANG.GLOVES[1].cx, gy = HANG.GLOVE_CY;
    ctx.save(); ctx.translate(T.x, T.y); ctx.scale(s, s);
    ctx.translate((c.x - T.x) / s, (c.y - T.y) / s); ctx.rotate(rot); ctx.scale(1, Math.abs(sy) < 0.04 ? 0.04 : sy); ctx.translate(-gx, -gy);
    ctx.beginPath(); ctx.rect(HANG.MID, -HANG.ART, HANG.MID, HANG.ART * 3); ctx.clip();
    // away from his body the cream glove is on white paper, so it carries the ink line the peek gloves have (3 px)
    const ink = X0.tint(A.hands, C.ink), r = 3 / s;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.drawImage(ink, Math.cos(a) * r, Math.sin(a) * r, HANG.ART, HANG.ART); }
    ctx.drawImage(A.hands, 0, 0, HANG.ART, HANG.ART); ctx.restore();
  }
  const TIP_L = 26.4;   // art px from the glove's centre to its fingertips
  /** The free glove f440-f472: the reach to the note (8 f), the pinch, the carry down-left, the return to the bar, turning
   *  back over (fingers up) in its last 3 f so the engine's glove takes over at f472 without a jump. { tip, centre, rot, sy } */
  function gloveAt(S, f) {
    const rest = gloveTipRest(S), s = rest.s, r0 = [rest.x, rest.y], gp = grabPoint(S), hook = hookPoint(S), L = TIP_L * s;
    const fromTip = (p, rot) => ({ x: p[0] + L * Math.sin(rot), y: p[1] - L * Math.cos(rot) });   // flipped: the tip hangs below the centre
    if (f < 448) { const k = E.io(fr(f, 440, 8)), rot = D(-20) * k, p = CM.arc(r0, [(r0[0] + gp[0]) / 2 + 120, (r0[1] + gp[1]) / 2 - 10], gp, k); return { tip: p, centre: fromTip(p, rot), rot, sy: -1 }; }
    if (f < 456) { const rot = D(-20); return { tip: gp, centre: fromTip(gp, rot), rot, sy: -1 }; }
    const cr = carryRot(S), ce = carryEnd(S);
    if (f < 464) { const st = noteState(S, f), rot = lerp(D(-20), cr, E.io(fr(f, 456, 8))); return { tip: st.pivot, centre: fromTip(st.pivot, rot), rot, sy: -1 }; }
    // the return: from the hold at the hook (9:16: right of the rail, so it rises up-right over the blank card) back to the bar
    const c0 = fromTip(ce.p, cr), c1 = { x: r0[0], y: r0[1] - L }, k = E.io(fr(f, 464, 8));
    const p = CM.arc([c0.x, c0.y], [(c0.x + c1.x) / 2 + 60, (c0.y + c1.y) / 2 + 90], [c1.x, c1.y], k);
    return { tip: p, centre: { x: p[0], y: p[1] }, rot: cr * (1 - k), sy: f >= 469 ? -Math.cos(Math.PI * fr(f, 469, 3)) : -1 };
  }
  /** His eyes on the pendulum: the swinging note's centre against where it will settle, as eye dx in art px (+-12). */
  function swingEyeDx(S, f) {
    const hook = hookPoint(S), st = noteState(S, Math.max(464, Math.min(FLIP_AT - 1, f))), [rx] = centreFromPivot(hook[0], hook[1], 0, 0, NOTE_W, NOTE_H, D(HANG_REST));
    return clamp((st.cx - rx) / 1.5, -12, 12);
  }
  /** The hero through Plan: the drop-in (f424), the look at the note, the reach (his right glove free f440-f472), the
   *  eye-follow and head sway with the pendulum, the look at the clean card, the launch exit from f488. Returns hang()'s geometry. */
  FILM.comeBackGloves = comeBackGloves;   // the hook's launch (beats-hook.js) comes back the same way, on its own hero
  function planHero(S, f) {
    if (f < 424) return null;
    const t = planClock(f), drop = -700 * (1 - E.back(1.2)(fr(f, 424, 9)));
    // the eyes: a look at the note at f432, then on his glove and the note, then on the pendulum, then the card
    let eyes = { dx: 0, dy: 0 }, sway = 0, blink = 0;
    const lag = Math.max(424, f - 2), cardSt = noteState(S, CARD_AT - 1);
    if (f >= 432 && f < 440) { const k = E.io(fr(f, 432, 5)); eyes = { dx: 12 * k, dy: 10 * k }; }
    else if (f >= 440 && f < 464) { const tp = gloveAt(S, lag).tip; eyes = CM.gazeAt(S, "heroPlan", tp[0], tp[1], 16); if (f < 446) { const k = E.io(fr(f, 440, 6)); eyes = { dx: lerp(12, eyes.dx, k), dy: lerp(10, eyes.dy, k) }; } }
    else if (f >= 464 && f < FLIP_AT) { eyes = { dx: swingEyeDx(S, lag), dy: 14 }; sway = 2 * swingDeg(f) / SWING; }
    else if (f >= FLIP_AT && f < FLIP_AT + 10) { const g = CM.gazeAt(S, "heroPlan", cardSt.cx, cardSt.cy, 16), k = E.io(fr(f, FLIP_AT, 4)); eyes = { dx: lerp(swingEyeDx(S, FLIP_AT - 2), g.dx, k), dy: lerp(14, g.dy, k) }; }
    else if (f >= FLIP_AT + 10 && f < FLIP_AT + 16) { const g = CM.gazeAt(S, "heroPlan", cardSt.cx, cardSt.cy, 16), k = E.io(fr(f, FLIP_AT + 10, 5)); eyes = { dx: g.dx * (1 - k), dy: g.dy * (1 - k) }; }
    if (f >= 452 && f < 454) blink = 1;
    const free = f >= 440 && f < 472, cb = t != null && t >= HANG.COME_BACK[0] && t < HANG.GONE_AT;
    const o = { dy: drop, eyes, sway, blink, bob: CM.bob(f), reach: free ? [null, { hide: true }] : cb ? [{ hide: true }, { hide: true }] : null, grip: f >= 472 && f < 475 ? 0.12 : 0 };
    if (cb) comeBackGloves(S, t, "behind");
    const geo = CM.hero(S, "heroPlan", t, o);
    if (cb) comeBackGloves(S, t, "front");
    S.__planGlove = free ? gloveAt(S, f) : null;
    return geo;
  }

  // ================================================================================================ Plan: the day card
  /** The day in the app's look: Fri, the times, the rail, Dinner with Mom on 8 pm; the Dentist card once flipped in; the
   *  ochre dashes climbing the rail and 'Leave by 4:30' after the bar is gone. `dy` lands it; `sx` flips it out. */
  function dayCard(S, f, dy, sx) {
    const { ctx, A } = S, g = dayGeo(S);
    ctx.save(); ctx.translate(0, dy);
    if (sx !== 1) { ctx.translate(g.x + g.w / 2, 0); ctx.scale(Math.max(0.01, sx), 1); ctx.translate(-(g.x + g.w / 2), 0); }
    if (f === 424) { ctx.translate(0, g.y + g.h); ctx.scale(1, 0.99); ctx.translate(0, -(g.y + g.h)); }   // the one-frame settle
    CM.stageCard(S, g.x, g.y, g.w, g.h);
    ctx.save(); X0.rrect(ctx, g.x, g.y, g.w, g.h, 28); ctx.clip();
    X0.text(ctx, "Fri", g.fri.x, g.fri.y, X0.font(600, 44), C.grey);
    ["4 pm", "5 pm", "6 pm", "7 pm", "8 pm"].forEach((t, i) => X0.text(ctx, t, g.timeX, g.rows[i] + 15, X0.font(500, 44), C.grey));
    ctx.fillStyle = C.line; ctx.fillRect(g.rail - 1, g.rows[0] - 36, 2, g.rows[4] - g.rows[0] + 72);
    miniCard(S, g.cardX, g.rows[4] - g.cardH / 2, g.dinnerW, g.cardH, "Dinner with Mom · 8:00 pm");
    // the clean Dentist card lives in the day once it has landed (the flip draws it on its way in)
    const st = noteState(S, f); if (st.mode === "card") drawNote(S, f, st);
    // ochre, only after the clay bar is gone: the dashes climb the rail from the card's top (f520-f528), the line writes (f524-f534)
    if (f >= OCHRE_AT) {
      const top = g.rows[1] - g.cardH / 2, to = g.y + 68, len = top - to, k = E.o3(fr(f, OCHRE_AT, 8)), im = A["ink-dashes-ochre"], L0 = 190;
      ctx.save(); ctx.translate(g.rail, top); ctx.rotate(-Math.PI / 2); ctx.beginPath(); ctx.rect(0, -14, len, 28); ctx.clip();
      X0.reveal(ctx, im, 0, -8, L0, 16, k * len / L0, "x", { rag: 3, seed: 8 }); ctx.restore();
      CM.wipeText(S, f, "Leave by 4:30", g.cardX, top - 15, OCHRE_AT + 4, X0.font(500, 44), C.ochre, 10);
    }
    ctx.restore(); ctx.restore();
  }
  const OCHRE_AT = 512;   // the ochre writes on the card while the bar is sucked out at the top (it is gone at f520), so it is done before 'planned for you' writes at f528 and the two write-ons never start together
  /** 'Your day' the frame the bar is gone, 'planned for you' on the beat after, the ochre underline brushed by f544 (the
   *  pulse), so the finished line holds f544-f571 (27 f) before the page flip and to f576 (32 f) before the cut: the same
   *  band as Keybot's and Travel's holds. It used to finish at f568 and hold 8 f. */
  const PLAN_HEAD = { l1: 520, l2: 528, hand: 530, ul: 536 };
  const planHeadline = (S, f) => CM.headline(S, f, { lines: ["Your day", "planned for you"], hand: { line: 1, word: "planned" }, ul: S.A["ul-plan"], at: PLAN_HEAD, size: headSize(S), handSize: headSize(S) * 110 / 96 });

  FILM.register({
    name: "plan", f0: 416, f1: 576,
    draw(S, f) {
      const landDy = f < 424 ? 1100 * (1 - E.o3(fr(f, 416, 8))) : 0, sx = f >= 571 ? 1 - E.i2(fr(f, 571, 5)) : 1;
      // no heap tail from here on, in either cut: the 540 px day card would cover its whole band in 9:16, and in 16:9 it
      // showed only a bare arc of the ring. The ring and its beetle come back on the code card.
      dayCard(S, f, landDy, sx);
      const st = noteState(S, f);
      // the note: behind him while it rests half tucked behind his ear and as it comes out; in front once it is clear of his chin
      const behind = f < 459;
      if (behind && st.mode !== "card") drawNote(S, f, st);
      planHero(S, f);
      if (!behind && st.mode !== "card") drawNote(S, f, st);
      const gl = S.__planGlove; if (gl) freeGlove(S, gl.centre, gl.rot, gl.sy);
      planHeadline(S, f);
    },
    cues() {
      // the launch's sounds sit on planClock's frames: the pull's whoosh at 560 ms, the gloves' two lands at the come-backs
      // (f506/f507), the pinch's click (f513), the suck's whoosh (f515); the bell rings as the ochre underline completes (f544,
      // on the pulse), the brush 'shh' sits under the brush stroke (f536)
      const L0 = LAUNCH_AT, c = [
        { f: 416, kind: "land", gain: 0.5 }, { f: 416, kind: "whoosh", dur: 0.2, up: true, gain: 0.3 },
        { f: 424, kind: "whoosh", dur: 0.3, up: false, gain: 0.4 }, { f: 433, kind: "land", gain: 0.4 },
        { f: 440, kind: "whoosh", dur: 0.2, up: true, gain: 0.3 }, { f: 448, kind: "tick", gain: 0.25 },
        { f: 464, kind: "land", gain: 0.5 },
        { f: CARD_AT, kind: "notify", gain: 0.35 }, { f: CARD_AT, kind: "land", gain: 0.4 },
        { f: L0 + 4, kind: "whoosh", dur: 0.35, up: true, gain: 0.45 }, { f: L0 + 18, kind: "land", gain: 0.3 }, { f: L0 + 19, kind: "land", gain: 0.3 },
        { f: L0 + 25, kind: "click", gain: 0.3 }, { f: L0 + 27, kind: "whoosh", dur: 0.2, up: false, gain: 0.3 },
        { f: OCHRE_AT + 4, kind: "write", gain: 0.4 },
        { at: (PLAN_HEAD.ul + 8) / 30, kind: "bell", f: 369.99, dur: 1.2, gain: 0.4 }, { f: PLAN_HEAD.ul, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 },
        { f: 571, kind: "open", gain: 0.5 },
      ];
      for (const f of [472, 480]) c.push({ f, kind: "tick", gain: 0.2 });
      return c;
    },
  });
})();
