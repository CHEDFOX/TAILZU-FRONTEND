/* WHAT THE BEATS SHARE: the headline system, the stage cards, the heap and its physics, the hero at a layout
 * transform, small motion helpers. Everything is a pure function of the frame, so any beat can draw what persists.
 *
 * Frames and easing: fr(f, f0, n) is 0..1 over n frames from f0 (clamped); use X0.E.* on it.
 */
window.CM = (() => {
  "use strict";
  const { E, K, clamp, C, lerp } = X0;
  const fr = (f, f0, n) => clamp((f - f0) / n);
  /** A gravity fall: how far (px) something has fallen `fr` of the way through an 18-frame drop (v0 1600 px/s, g 2400 px/s^2 lands 1390 px in 0.6 s). */
  const FALL_F = 18, FALL_PX = 1390;
  function fallY(f, fLand) { const t = clamp((f - (fLand - FALL_F)) / FALL_F) * 0.6; return (1600 * t + 0.5 * 2400 * t * t) - FALL_PX; }   // 0 at landing, -1390 at the start
  /** The 2-frame landing squash: scaleY 1.06 then 0.94 then 1. */
  function squash(f, fLand) { const d = f - fLand; return d === 0 ? { sx: 0.95, sy: 1.06 } : d === 1 ? { sx: 1.04, sy: 0.94 } : { sx: 1, sy: 1 }; }
  /** A tumble: from a0 to a1 degrees over the fall, linear. */
  const tumble = (f, fLand, a0, a1) => lerp(a0, a1, clamp((f - (fLand - FALL_F)) / FALL_F));
  /** A pop: E.back over n frames from f0 (0 before, 1 after). */
  const pop = (f, f0, n = 9, s = 1.35) => f < f0 ? 0 : E.back(s)(fr(f, f0, n));

  // ------------------------------------------------------------------------------------------------ type
  /**
   * The headline system: heavy Geist, left at L.textX, two lines, no full stop, one word written by hand (Caveat) with a
   * brush underline in the owning bot's colour. Each line writes on as a left-to-right wipe over 6 f from its frame;
   * the hand word writes over 6 f from its frame; the underline brushes in over 8 f from its frame with a ragged edge.
   *   headline(S, f, { lines: ["Say it", "Keybot writes it"], hand: { line: 1, word: "writes" }, ul: S.A["ul-keybot"],
   *                   at: { l1: 256, l2: 376, hand: 379, ul: 384 }, size: 96, handSize: 110, base: [370, 480], x: 72,
   *                   strike: { f: 168, img } (optional), out: { f, n } (optional: the whole block wipes out to the left) })
   * Returns the laid-out lines (for a strike or a measurement).
   */
  function headline(S, f, o) {
    const { ctx, L, u } = S, size = o.size ?? L.headSize, hs = o.handSize ?? (size * 1.15), x = o.x ?? L.textX, base = o.base ?? L.headBase;
    const out = o.out && f >= o.out.f ? E.i2(fr(f, o.out.f, o.out.n ?? 8)) : 0;
    if (out >= 1) return null;
    const lines = o.lines.map((text, i) => {
      const words = text.split(" ").map((w) => ({ text: w, hand: o.hand && o.hand.line === i && w === o.hand.word, scale: hs / size / 1.22 * 1.22 }));
      return X0.layout(ctx, words.map((w) => w.hand ? { ...w, handWeight: 700, scale: hs / size } : w), { x, y: base[i], size, weight: 900, color: C.ink, gap: 0.24 });
    });
    ctx.save();
    if (out > 0) { ctx.beginPath(); ctx.rect(x - 40 - out * 1400, base[0] - size * 1.4, 1400, (base[1] - base[0]) + size * 2); ctx.clip(); }
    lines.forEach((line, i) => {
      const f0 = i === 0 ? o.at.l1 : o.at.l2; if (f0 == null || f < f0) return;
      const k = E.o3(fr(f, f0, 6));
      // the plain words wipe on left to right; the hand word waits for its own frame
      ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base[i] - size * 1.3, (line.w + 40) * k, size * 1.75); ctx.clip();
      X0.drawLine(ctx, line, (j, w) => (w.hand ? { a: 0 } : { a: 1 }));
      ctx.restore();
      const hw = line.words.find((w) => w.hand);
      if (hw && o.at.hand != null && f >= o.at.hand) {
        const kh = E.o3(fr(f, o.at.hand, 6));
        ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, base[i] - hs, (hw.w + 30) * kh, hs * 1.6); ctx.clip();
        X0.drawLine(ctx, { words: [hw] }); ctx.restore();
        if (o.ul && o.at.ul != null && f >= o.at.ul) underline(S, hw, o.ul, E.o3(fr(f, o.at.ul, 8)), size);
      }
    });
    if (o.strike && f >= o.strike.f) {
      // The strike runs through the WHOLE line, Geist word and hand word alike: centred between the Geist x-height centre
      // (base - 0.36 em) and the Caveat body centre (base - 0.15 hand-em) when the line has a hand word, nearly flat
      // (-1.3 deg) so its right end does not climb off the lower-sitting hand word, 12 % wider than the line with its start
      // pulled left so the stroke's baked right taper lands past the hand word, and 1.3x thick (thickness only).
      const li = o.strike.line ?? 1, line = lines[li], k = E.o3(fr(f, o.strike.f, 8)), hw = line.words.find((w) => w.hand);
      const w = line.w * 1.12, h = w * o.strike.img.height / o.strike.img.width * 1.3, cy = base[li] - (hw ? (size * 0.36 + hs * 0.15) / 2 : size * 0.36);
      X0.reveal(ctx, o.strike.img, line.x - line.w * 0.045, cy - h / 2, w, h, k, "x", { rot: -0.022, rag: 10, seed: 5 });
    }
    ctx.restore();
    return lines;
  }
  /**
   * The brush underline under a hand word: at least 22 px of INK tall, a little wider than the word, brushed in with a
   * ragged edge. The floor is about the ink, not the image box: the brush assets carry ink in only ~64 % of their rows
   * (the stroke wobbles inside the box), so a 22 px box gave 14 px of ink under every word. inkShare() measures each
   * asset once (the median per-column ink height over its height) and the box is sized so the ink itself is >= 22 px.
   */
  const inkShares = new Map();
  function inkShare(img) {
    let v = inkShares.get(img); if (v != null) return v;
    v = 0.64;
    try {
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
      const c = cv.getContext("2d", { willReadFrequently: true }); c.drawImage(img, 0, 0);
      const d = c.getImageData(0, 0, img.width, img.height).data, cols = [];
      for (let x = 0; x < img.width; x++) { let n = 0; for (let y = 0; y < img.height; y++) if (d[(y * img.width + x) * 4 + 3] > 100) n++; if (n) cols.push(n); }
      if (cols.length) { cols.sort((a, b) => a - b); v = clamp(cols[cols.length >> 1] / img.height, 0.2, 1); }
    } catch (e) { /* a tainted canvas: keep the estimate */ }
    inkShares.set(img, v); return v;
  }
  function underline(S, word, img, k, size) {
    const { ctx } = S, wide = word.text.length <= 3 ? 1.3 : 1.12, w = word.w * wide, h = Math.max(22 / inkShare(img), w * img.height / img.width * 1.15);
    X0.reveal(ctx, img, word.x - (w - word.w) / 2, word.y + size * 0.1, w, h, k, "x", { rot: -0.012, rag: 9, seed: 2 });
  }
  /** Plain Geist text that wipes on left to right over n frames from f0. */
  function wipeText(S, f, text, x, y, f0, font, color = C.ink, n = 6, align = "left") {
    if (f < f0) return 0; const { ctx } = S, k = E.o3(fr(f, f0, n)), w = X0.width(ctx, text, font);
    ctx.save(); ctx.beginPath(); const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x; ctx.rect(x0 - 6, y - 200, (w + 12) * k, 300); ctx.clip();
    X0.text(ctx, text, x, y, font, color, align); ctx.restore(); return k;
  }
  /** Handwriting (Caveat) with a seeded jitter per glyph, written on glyph by glyph to k (0..1). */
  function scrawl(S, text, x, y, size, color, k = 1, seed = 1, weight = 700, family = "Caveat") {
    const { ctx } = S; ctx.save(); ctx.font = X0.font(weight, size, family); ctx.fillStyle = color; ctx.textBaseline = "alphabetic";
    const n = Math.ceil(text.length * clamp(k)); let cx = x;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], w = ctx.measureText(ch).width;
      if (i < n) { ctx.save(); ctx.translate(cx + w / 2, y + (X0.hash(seed * 97 + i) - 0.5) * 3); ctx.rotate((X0.hash(seed * 31 + i * 7) - 0.5) * 0.035); ctx.fillText(ch, -w / 2, 0); ctx.restore(); }
      cx += w;
    }
    ctx.restore(); return cx - x;
  }

  // ------------------------------------------------------------------------------------------------ cards
  /** A stage card: white, the app's hairline, the pencil shadow. */
  function stageCard(S, x, y, w, h, o = {}) {
    const { ctx, A, u } = S, r = o.r ?? 28;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    if (o.rot) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(o.rot); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    if (o.sx != null || o.sy != null) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(o.sx ?? 1, o.sy ?? 1); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    X0.hatchShadow(ctx, A.hatch, x, y, w, h, r, 1, { alpha: o.shadow ?? 0.5 });
    ctx.fillStyle = o.fill ?? "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
    ctx.restore();
  }
  /** The app's grey bubble (from them) or ink bubble (from you): one or two lines of Geist 500. Returns { w, h }. */
  function bubble(S, lines, x, y, size, mine = false, o = {}) {
    const { ctx } = S, f = X0.font(500, size), pad = size * 0.65, lh = size * 1.25;
    let w = 0; for (const l of lines) w = Math.max(w, X0.width(ctx, l, f));
    const bw = w + 2 * pad, bh = lines.length * lh + pad * 1.1, bx = mine ? x - bw : x;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.fillStyle = mine ? C.ink : C.surface; X0.rrect(ctx, bx, y, bw, bh, Math.min(bh / 2, size * 0.9)); ctx.fill();
    lines.forEach((l, i) => X0.text(ctx, l, bx + pad, y + pad * 0.55 + size * 0.95 + i * lh, f, mine ? "#FFFFFF" : C.ink));
    ctx.restore(); return { w: bw, h: bh, x: bx };
  }
  /**
   * The app's send control, the same on every card: an ink disc `d` across with the white up-arrow. The arrow's stem,
   * head and stroke scale with the disc (the stage card's is 88 px with a 4 px stroke; a small disc keeps a 2.5 px
   * stroke so the arrow survives phone scale). Every composer in the film draws its send circle through this.
   */
  function sendButton(S, cx, cy, d = 88, o = {}) {
    const { ctx } = S, k = d / 88;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.fillStyle = o.fill ?? C.ink; ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = o.arrow ?? "#FFFFFF"; ctx.lineWidth = Math.max(2.5, 4 * k); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
    ctx.moveTo(cx, cy + 16 * k); ctx.lineTo(cx, cy - 16 * k); ctx.moveTo(cx - 13 * k, cy - 3 * k); ctx.lineTo(cx, cy - 16 * k); ctx.lineTo(cx + 13 * k, cy - 3 * k); ctx.stroke();
    ctx.restore();
  }
  /** A black pill button with white Geist 600 text, centred at (cx, cy). */
  function pill(S, text, cx, cy, w, h, o = {}) {
    const { ctx } = S; ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    if (o.scale) { ctx.translate(cx, cy); ctx.scale(o.scale, o.scale); ctx.translate(-cx, -cy); }
    ctx.fillStyle = o.fill ?? C.ink; X0.rrect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2); ctx.fill();
    X0.text(ctx, text, cx, cy + (o.size ?? 44) * 0.36, X0.font(600, o.size ?? 44), o.color ?? "#FFFFFF", "center"); ctx.restore();
  }
  /** A torn scrap component drawn with its pencil shadow: centred at (cx, cy), `w` wide, turned by rot (radians). */
  function scrapAt(S, name, cx, cy, w, rot = 0, o = {}) {
    const { ctx, A } = S, im = A[name], h = w * im.height / im.width;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.translate(cx, cy); ctx.rotate(rot); if (o.sx != null || o.sy != null) ctx.scale(o.sx ?? 1, o.sy ?? 1);
    X0.hatchShadow(ctx, A.hatch, -w / 2 + w * 0.04, -h / 2 + h * 0.06, w * 0.92, h * 0.88, 10, 1, { alpha: o.shadow ?? 0.45 });
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    if (o.draw) o.draw(ctx, w, h);
    ctx.restore(); return { w, h };
  }

  // ------------------------------------------------------------------------------------------------ the heap
  /**
   * The pile-up's items, in landing order, with their landing frames and resting places (relative to L.heap.land, the
   * chat card's centre). Each is drawn by drawHeapItem. From f128 the heap is complete; episodes show its tail below the
   * stage card: 3 items under Keybot, 2 under Plan, 1 under Travel, 0 under Code (the loop closing).
   */
  // Resting offsets from L.heap.land for each cut: p (9:16: the column x 600-1070, the heap's top near y 920) and
  // l (16:9: x 1150-1900, the top near y 450); a0 -> a1 the tumble (degrees). The ring card lands last, on top.
  // The first three landings keep Mom's words readable through the headline: the dentist note lands on the card's input
  // pill / send-circle corner (its raised right end stays below the bubble), the first scrap drops onto the note and the
  // pill (lower right of the card, not the bubble), and the ticket sits above the bubble; the pile then buries the card
  // from f112 (blank2, stay, the ring card), after the title has written. The same card-relative anchors in both cuts.
  // (16:9: the whole heap sits 90 px higher than L.heap.land so the chat card's pill and torn edge land clear of an embed's
  // control bar: card centre y 810, pill bottom ~945, shadow <= 995.)
  const HEAP = [
    // (9:16: the chat card sits 40 px left of L.heap.land so Mom's words end before the Reels rail at x 950)
    { id: "chat",    land: 48,  p: [-40, 0],     l: [0, -90],      a0: 18,  a1: -6 },
    { id: "note",    land: 64,  p: [40, 100],    l: [80, 10],      a0: 30,  a1: -9 },
    { id: "blank1",  land: 80,  p: [20, 130],    l: [60, 20],      a0: -20, a1: -5 },
    { id: "ticket",  land: 96,  p: [105, -240],  l: [145, -330],   a0: 25,  a1: -3 },
    { id: "sun",     land: 104, p: [-200, -330], l: [-230, -490],  a0: 40,  a1: 10 },
    { id: "blank2",  land: 112, p: [90, -20],    l: [240, -370],   a0: -30, a1: -5 },
    { id: "stay",    land: 116, p: [110, -140],  l: [100, -100],   a0: 15,  a1: 4, pa1: 18 },   // askew in 9:16: it shows past the ring card
    { id: "packing", land: 120, p: [90, -300],   l: [280, -470],   a0: -25, a1: 12 },
    { id: "blank3",  land: 124, p: [135, -215],  l: [-100, -470],  a0: 20,  a1: -8 },
    { id: "ring",    land: 128, p: [-10, -205],  l: [50, -390],    a0: -15, a1: 3 },
  ];
  /** The items' drawn sizes (px at u 1): the cards' boxes, the scraps' widths. */
  const ITEM = {
    chat: { w: 460, h: 300 }, note: { w: 330 }, blank1: { w: 380 }, blank2: { w: 360 }, blank3: { w: 390 }, packing: { w: 300 },
    ticket: { w: 420, h: 200 }, stay: { w: 420, h: 120 }, sun: { w: 220 }, ring: { w: 480, h: 270 },
  };
  /** The scrap items' component images (their heights come from the image's ratio). */
  const SCRAP = { note: "scrap-note", blank1: "scrap-blank-1", blank2: "scrap-blank-2", blank3: "scrap-blank-3", packing: "scrap-packing", sun: "ink-sun" };
  /** An item's drawn box (px at u 1): the cards' boxes, the scraps' widths with heights from their images. */
  function itemBox(S, id) { const I = ITEM[id], im = SCRAP[id] && S.A[SCRAP[id]]; return { w: I.w, h: I.h ?? (im ? I.w * im.height / im.width : 0) }; }
  /** The heap at frame f: every item that has entered, with its centre, angle, squash and jostle. */
  function heap(S, f) {
    const { L } = S, base = L.heap.land, out = [];
    for (const it of HEAP) {
      if (f < it.land - FALL_F) continue;
      const [dx, dy] = S.portrait ? it.p : it.l, rest = { x: base.x + dx, y: base.y + dy }, a1 = S.portrait && it.pa1 != null ? it.pa1 : it.a1;
      const falling = f < it.land, y = rest.y + (falling ? fallY(f, it.land) : 0), rot = X0.deg(falling ? tumble(f, it.land, it.a0, a1) : a1);
      // a jostle: items under a landing one dip 6 px for 3 frames
      let jostle = 0; for (const other of HEAP) if (other !== it && other.land > it.land && f >= other.land && f < other.land + 3) jostle = 6;
      const sq = squash(f, it.land);
      out.push({ ...it, x: rest.x, y: y + jostle, rot, sx: sq.sx, sy: sq.sy, falling });
    }
    return out;
  }
  /** The hook's chat card: Mom's bubble and an empty input pill with the black send circle. Centred at (cx, cy), w x h. */
  function chatCard(S, cx, cy, w, h, o = {}) {
    const { ctx } = S; const x = cx - w / 2, y = cy - h / 2, k = w / 460;
    ctx.save(); if (o.rot) { ctx.translate(cx, cy); ctx.rotate(o.rot); ctx.translate(-cx, -cy); }
    if (o.sx != null || o.sy != null) { ctx.translate(cx, cy); ctx.scale(o.sx ?? 1, o.sy ?? 1); ctx.translate(-cx, -cy); }
    stageCard(S, x, y, w, h, { r: 28 });
    // Mom's words and the time at the readable floor (Geist 500 44 at 460 wide), the real screen's text; the bubble's
    // pad is a little tighter than the app's so the second line ends inside the 9:16 rail line
    const size = 44 * k, fnt = X0.font(500, size), lines = ["Dinner at 8,", "everyone home?"], pad = size * 0.5, lh = size * 1.2;
    let bw = 0; for (const l of lines) bw = Math.max(bw, X0.width(ctx, l, fnt)); bw += 2 * pad;
    const bx = x + 22 * k, by = y + 24 * k, bh = lines.length * lh + size * 0.9;
    ctx.fillStyle = C.surface; X0.rrect(ctx, bx, by, bw, bh, size * 0.8); ctx.fill();
    lines.forEach((l, i) => X0.text(ctx, l, bx + pad, by + size * 0.45 + size * 0.95 + i * lh, fnt, C.ink));
    X0.text(ctx, "7:28 pm", x + 28 * k, by + bh + 40 * k, fnt, C.grey);
    // the empty input pill with the send circle: the same control as the stage card's (sendButton), scaled from the pill's
    // height but never under 44 px, so the arrow still reads at phone scale (a 37 px bare disc read as a blob)
    const ph = 58 * k, py = y + h - ph - 18 * k;
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x + 24 * k, py, w - 48 * k, ph, ph / 2); ctx.stroke();
    sendButton(S, x + w - 24 * k - ph / 2, py + ph / 2, Math.max(44, ph * 0.73));
    ctx.restore();
  }
  /** The torn dentist note with its handwriting: centred, `w` wide, turned by rot; `k` writes the words on (1 = all). */
  function dentistNote(S, cx, cy, w, rot = 0, o = {}) {
    const { ctx } = S;
    return scrapAt(S, "scrap-note", cx, cy, w, rot, { ...o, draw: (c, ww, hh) => {
      const size = ww * 0.158; // Caveat 52 at 330 wide
      scrawl(S, "dentist", -ww * 0.36, -hh * 0.06, size, C.ink, o.k ?? 1, 91);
      scrawl(S, "Friday 5 pm", -ww * 0.36, hh * 0.3, size, C.ink, o.k ?? 1, 92);
    } });
  }
  /** One heap item, by id: cards in the app's look (wordless after the hook), scraps, the sun, the ring card with the beetle. */
  function drawHeapItem(S, it, o = {}) {
    const { ctx, A } = S, sc = o.scale ?? 1, I = ITEM[it.id], rot = it.rot + (it.id === "ring" ? (o.ringRot ?? 0) : 0);
    ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(rot); ctx.scale(it.sx * sc, it.sy * sc);
    switch (it.id) {
      case "chat": chatCard(S, 0, 0, I.w, I.h); break;
      case "note": dentistNote(S, 0, 0, I.w, 0, { k: o.noteK ?? 1 }); break;
      case "blank1": scrapAt(S, "scrap-blank-1", 0, 0, I.w); break;
      case "blank2": scrapAt(S, "scrap-blank-2", 0, 0, I.w); break;
      case "blank3": scrapAt(S, "scrap-blank-3", 0, 0, I.w); break;
      case "packing": scrapAt(S, "scrap-packing", 0, 0, I.w); break;
      case "ticket": {   // a blank ticket: the ink perforation across its middle, no words
        stageCard(S, -I.w / 2, -I.h / 2, I.w, I.h, { r: 22 });
        const d = A["ink-dashes-ink"], dw = I.w - 60, dh = dw * d.height / d.width; ctx.drawImage(d, -dw / 2, -dh / 2, dw, dh); break;
      }
      case "stay": stageCard(S, -I.w / 2, -I.h / 2, I.w, I.h, { r: 22 }); break;
      case "sun": { const s = A["ink-sun"], sh = I.w * s.height / s.width; ctx.drawImage(s, -I.w / 2, -sh / 2, I.w, sh); break; }
      case "ring": {     // the ring card: the wide loose ring across its middle, the eyeless beetle on the ring's top-right
        // o.tail = { h, ring, ringDy }: the heap tail's shorter box (its blank lower paper trimmed), the ring scaled by
        // `ring` and moved down `ringDy` into the visible band; the beetle keeps its size and rides the ring
        const T = o.tail, ch = T ? T.h : I.h, rs = T ? T.ring : 1, rdy = T ? T.ringDy : 0;
        stageCard(S, -I.w / 2, -ch / 2, I.w, ch, { r: 24 });
        const r = A["ring-ink-wide"], rw = 420 * rs, rh = rw * r.height / r.width; ctx.drawImage(r, -rw / 2, rdy - rh / 2, rw, rh);
        const b = A[o.beetleB ? "beetle-b" : "beetle-a"], bw = 56, bh = bw * b.height / b.width, bx = rw * 0.32;
        const ringY = -rh / 2 * Math.sqrt(Math.max(0, 1 - Math.pow((bx + bw / 2) / (rw / 2), 2)));   // the ring's top edge under the beetle
        ctx.drawImage(b, bx, rdy + ringY - bh * 0.92, bw, bh);
        break;
      }
    }
    ctx.restore();
  }
  /** The whole heap at f, back to front (landing order), the note's words writing on with the hook; o.ringRot wobbles the top card. */
  function drawHeap(S, f, o = {}) { for (const it of heap(S, f)) drawHeapItem(S, it, o); }
  /**
   * The heap's tail under a stage card during the episodes: the top `n` items of the finished heap, peeking up from
   * below the card's bottom edge (y = L.heap.tailY), opaque (a face at 90 % let its own hatch shadow through and read as
   * lined paper), clipped to the frame. In 9:16 nothing in the tail reaches below tailY + TAIL_BAND (y 1390, above the
   * 1400 safe line): the ring card is drawn as a shorter box there (its blank lower paper trimmed; the loop at 0.75 and
   * the beetle moved down into the visible band, the beetle full size), and the scraps sit higher so only their torn
   * lower edges show. In 16:9 the frame's edge crops the tail, as designed, and the slots are as they were.
   */
  const TAIL_SLOT = { ring: { fx: 0.72, dy: 0, rot: -3 }, blank3: { fx: 0.45, dy: 8, rot: 5 }, packing: { fx: 0.24, dy: 16, rot: -8 } };
  const TAIL_BAND = 120, TAIL_RING = { h: 150, ring: 0.75, ringDy: 22 };
  function heapTail(S, n, o = {}) {
    if (n <= 0) return; const { ctx, L } = S, items = heap(S, 128).slice(-n), tailY = L.heap.tailY;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.beginPath(); ctx.rect(0, tailY, L.W, L.H - tailY); ctx.clip();
    // each item has ONE slot whatever n is, so the ring card keeps its spot as the tail shrinks 3 -> 2 -> 1 across the cuts
    items.forEach((it, i) => {
      const s = TAIL_SLOT[it.id] || { fx: 0.3 + 0.2 * i, dy: i * 10, rot: 0 };
      let y = tailY + 90 + s.dy, rot = s.rot, tail = null;
      if (S.portrait) {   // the item's lowest corner (and its 9 px hatch shadow) at or above tailY + TAIL_BAND
        if (it.id === "ring") { tail = TAIL_RING; rot = 0; y = tailY + TAIL_BAND - 11 - tail.h / 2; }
        else { const { w, h } = itemBox(S, it.id), a = Math.abs(X0.deg(rot)); y = tailY + TAIL_BAND - 6 - (h / 2 * Math.cos(a) + w / 2 * Math.sin(a)); }
      }
      drawHeapItem(S, { ...it, x: L.stage.x + L.stage.w * s.fx + (o.dx ?? 0), y: y + (o.dy ?? 0), rot: X0.deg(rot), sx: 1, sy: 1 }, { tail });
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the hero
  /** The hero at one of the layout's transforms ("hero" or "heroPlan"), with hang()'s options; returns its geometry. */
  function hero(S, which, t, o = {}) { const T = S.L[which]; return X0.hang(S.ctx, S.A, T.x + (o.dx ?? 0), T.y + (o.dy ?? 0), T.size, t, o); }
  /** The eyes looking at a point on screen (px), as hang()'s eyes { dx, dy } in art px, clamped to +-max. */
  function gazeAt(S, which, px, py, max = 16, o = {}) {
    const T = S.L[which], s = T.size / X0.hang.ART, ex = T.x + X0.hang.EYES.c.cx * s, ey = T.y + X0.hang.EYES.c.cy * s;
    const dx = (px - ex) / s, dy = (py - ey) / s, len = Math.hypot(dx, dy) || 1, k = Math.min(max, len * 0.08) / len;
    // he hangs upside down: a thing to his right on screen is to his right in the art too (x), but down on screen is down in the art (the art is drawn turned already)
    return { dx: dx * k + (o.dx ?? 0), dy: dy * k + (o.dy ?? 0) };
  }
  /** His breathing: a slow +-3 px bob with a 64-frame period (one bar), frozen when `still`. */
  const bob = (f, still = false) => still ? 0 : Math.sin(f / 64 * Math.PI * 2) * 3;

  // ------------------------------------------------------------------------------------------------ motion
  /** A paper flip about a vertical centre line: scaleX 1 -> 0 -> 1 over n frames from f0; returns { sx, second } (second: the back side). */
  function flip(f, f0, n) { const k = fr(f, f0, n); return { sx: Math.abs(Math.cos(k * Math.PI)), second: k >= 0.5, k }; }
  /** A tap ring blooming at (cx, cy): 8 f, scale 0.6 -> 1.2, fading. */
  function tapRing(S, f, f0, cx, cy, r = 60) { if (f < f0 || f >= f0 + 8) return; const { ctx, A } = S, k = fr(f, f0, 8), s = 0.6 + 0.6 * k; X0.img(ctx, A["tap-ring"], cx, cy, r * 2 * s, { alpha: 1 - k }); }
  /** A quadratic arc from a to b bulging toward c, at k. */
  const arc = (a, c, b, k) => { const u = 1 - k; return [u * u * a[0] + 2 * u * k * c[0] + k * k * b[0], u * u * a[1] + 2 * u * k * c[1] + k * k * b[1]]; };

  return { fr, FALL_F, fallY, squash, tumble, pop, headline, underline, wipeText, scrawl, stageCard, bubble, pill, sendButton, scrapAt, HEAP, ITEM, SCRAP, itemBox, heap, chatCard, dentistNote, drawHeapItem, drawHeap, heapTail, TAIL_BAND, hero, gazeAt, bob, flip, tapRing, arc };
})();
