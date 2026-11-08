/* THE TRAILER'S DRAWING KIT. Loaded by trailer.html; everything draws into one 2D context, frame by frame, as a
 * function of time, so render.mjs can ask for any moment.
 *
 * Space: `u` is one pixel at a 1080-px short side (1080 x 1920 or 1920 x 1080), so sizes written once fit both cuts
 * and a half-size preview. `portrait` says which cut this is.
 *
 * In here: easing; the assets (PNG layers, the brand's fonts); the paper; the headline system (heavy Geist, one word
 * written by hand in Caveat with a brush underline in the bot's colour, words that arrive one by one); the hero bot
 * (the app icon's bot hanging from his clay bar, with the app's own launch motion ported number for number from
 * app/src/launch/launchCore.ts and LaunchCurtain.tsx); the bot peeking over an edge; film grain and a vignette.
 */
window.X0 = (() => {
  "use strict";
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  /** Progress 0..1 of t between a and b, clamped. */
  const K = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    lin: (x) => clamp(x),
    smooth: (x) => { const c = clamp(x); return c * c * (3 - 2 * c); },
    io: (x) => { const c = clamp(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; },
    i2: (x) => { const c = clamp(x); return c * c; },
    i3: (x) => { const c = clamp(x); return c * c * c; },
    o2: (x) => 1 - Math.pow(1 - clamp(x), 2),
    o3: (x) => 1 - Math.pow(1 - clamp(x), 3),
    o5: (x) => 1 - Math.pow(1 - clamp(x), 5),
    oExpo: (x) => { const c = clamp(x); return c >= 1 ? 1 : 1 - Math.pow(2, -10 * c); },
    iExpo: (x) => { const c = clamp(x); return c <= 0 ? 0 : Math.pow(2, 10 * c - 10); },
    /** Overshoots and settles, s = how much (1.7 is a lively landing). */
    back: (s = 1.7) => (x) => { const c = clamp(x), k = s + 1; return 1 + k * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2); },
    /** A quick in, a soft long out: a film cut's "snap". */
    snap: (x) => { const c = clamp(x); return 1 - Math.pow(1 - c, 4); },
    /** Up and back down over 0..1 (for a bump). */
    bump: (x) => Math.sin(clamp(x) * Math.PI),
  };
  /** A seeded random stream (the same every render). */
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** Deterministic noise in 0..1 from an integer key. */
  const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

  // ------------------------------------------------------------------------------------------------ the brand's colours
  const C = {
    paper: "#FFFFFF", ink: "#0A0A0A", grey: "#5C5C5C", line: "#E6E6E6", surface: "#F5F5F5",
    moss: "#4F7A3A", clay: "#A9573A", ochre: "#8F6A1F", sea: "#3E6E8E",
    bar: "#C9683F", cream: "#FBF2E2",
  };

  // ------------------------------------------------------------------------------------------------ assets
  const here = (() => { const s = document.currentScript && document.currentScript.src; return s ? s.slice(0, s.lastIndexOf("/") + 1) : "./"; })();
  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("image: " + url)); im.src = url; });
  }
  /** { name: url } -> { name: HTMLImageElement } (urls relative to engine.js unless absolute). */
  async function load(map) {
    const out = {};
    await Promise.all(Object.entries(map).map(async ([k, u]) => { out[k] = await loadImage(/^[a-z]+:/.test(u) ? u : here + u); }));
    return out;
  }
  /** The brand's faces (fonts/ beside this file), as @font-face rules, loaded before the first frame. */
  async function fonts() {
    const F = (f) => `url(${here}fonts/${f})`;
    const css = `
      @font-face{font-family:Geist;font-weight:100 900;src:${F("Geist[wght].ttf")} format("truetype")}
      @font-face{font-family:Caveat;font-weight:600;src:${F("Caveat-SemiBold.woff2")} format("woff2")}
      @font-face{font-family:Caveat;font-weight:700;src:${F("Caveat-Bold.woff2")} format("woff2")}
      @font-face{font-family:Bricolage;font-weight:400;src:${F("bricolage-grotesque-latin-400-normal.woff2")} format("woff2")}
      @font-face{font-family:Bricolage;font-weight:500;src:${F("bricolage-grotesque-latin-500-normal.woff2")} format("woff2")}
      @font-face{font-family:Bricolage;font-weight:600;src:${F("bricolage-grotesque-latin-600-normal.woff2")} format("woff2")}
      @font-face{font-family:Bricolage;font-weight:800;src:${F("bricolage-grotesque-latin-800-normal.woff2")} format("woff2")}
      @font-face{font-family:GeistMono;font-weight:400;src:${F("geist-mono-400.woff2")} format("woff2")}
      @font-face{font-family:GeistMono;font-weight:500;src:${F("geist-mono-500.woff2")} format("woff2")}
      @font-face{font-family:Newsreader;font-weight:300;src:${F("newsreader-latin-300-normal.woff2")} format("woff2")}
      @font-face{font-family:Newsreader;font-weight:400;src:${F("newsreader-latin-400-normal.woff2")} format("woff2")}
      @font-face{font-family:Newsreader;font-weight:400;font-style:italic;src:${F("newsreader-latin-400-italic.woff2")} format("woff2")}
      @font-face{font-family:Kalam;font-weight:400;src:${F("kalam-latin-400-normal.woff2")} format("woff2")}
      @font-face{font-family:Devanagari;font-weight:400;src:${F("noto-sans-devanagari-devanagari-400-normal.woff2")} format("woff2")}
    `;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const faces = ["800 40px Geist", "500 40px Geist", "700 40px Caveat", "600 40px Caveat", "500 40px Bricolage", "800 40px Bricolage", "400 40px GeistMono", "400 40px Newsreader", "italic 400 40px Newsreader", "400 40px Kalam", "400 40px Devanagari"];
    await Promise.all(faces.map((f) => document.fonts.load(f, "X0 Bot your team देखो")));
    await document.fonts.ready;
  }

  // ------------------------------------------------------------------------------------------------ drawing helpers
  /** Draw an image centred at (cx, cy), `w` wide (height from its ratio unless given), turned by rot radians, at alpha. */
  function img(ctx, im, cx, cy, w, o = {}) {
    const h = o.h ?? w * im.height / im.width;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.translate(cx, cy); if (o.rot) ctx.rotate(o.rot); if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  /** Cover a rect with an image (cropping, keeping its ratio). */
  function cover(ctx, im, x, y, w, h, o = {}) {
    const s = Math.max(w / im.width, h / im.height) * (o.zoom ?? 1), dw = im.width * s, dh = im.height * s;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.drawImage(im, x + (w - dw) / 2 + (o.dx ?? 0), y + (h - dh) / 2 + (o.dy ?? 0), dw, dh);
    ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /** Film grain: two noise tiles made once, laid over the frame with a wandering offset at a low alpha. */
  const grainTiles = [];
  function makeGrain(size = 512, seed = 5) {
    const r = rng(seed);
    for (let n = 0; n < 2; n++) {
      const cv = document.createElement("canvas"); cv.width = cv.height = size;
      const c = cv.getContext("2d"), d = c.createImageData(size, size);
      for (let i = 0; i < size * size; i++) { const v = 118 + (r() + r() - 1) * 150; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
      c.putImageData(d, 0, 0); grainTiles.push(cv);
    }
  }
  function grain(ctx, W, H, t, amount = 0.07, scale = 1) {
    if (!grainTiles.length) makeGrain();
    const f = Math.floor(t * 24), tile = grainTiles[f % 2], s = 512 * scale;
    const ox = -Math.floor(hash(f * 3 + 1) * s), oy = -Math.floor(hash(f * 3 + 2) * s);
    ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = amount;
    for (let y = oy; y < H; y += s) for (let x = ox; x < W; x += s) ctx.drawImage(tile, x, y, s, s);
    ctx.restore();
  }
  function vignette(ctx, W, H, strength = 0.12, colour = "0,0,0") {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, `rgba(${colour},0)`); g.addColorStop(1, `rgba(${colour},${strength})`);
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ type
  const font = (weight, size, family = "Geist", style = "") => `${style ? style + " " : ""}${weight} ${size}px ${family}`;
  function width(ctx, text, f) { ctx.save(); ctx.font = f; const w = ctx.measureText(text).width; ctx.restore(); return w; }
  /**
   * One line made of words, laid out left to right, each word its own font and colour, returned with positions so a
   * caller can reveal them one by one. `hand` words (Caveat) sit a little lower and larger than the Geist beside them.
   *   words: [{ text, hand?, color?, font? }]  o: { x, y (baseline), size, weight, color, gap (word gap, em), align }
   */
  function layout(ctx, words, o) {
    const size = o.size, gap = (o.gap ?? 0.26) * size, out = [];
    let x = 0;
    for (const w of words) {
      const f = w.font ?? (w.hand ? font(w.handWeight ?? 700, size * (w.scale ?? 1.22), "Caveat") : font(o.weight ?? 800, size));
      const ww = width(ctx, w.text, f);
      out.push({ ...w, font: f, x, w: ww, dy: w.hand ? size * 0.04 : 0, color: w.color ?? o.color ?? C.ink });
      x += ww + gap;
    }
    const total = x - gap, ox = o.align === "center" ? o.x - total / 2 : o.align === "right" ? o.x - total : o.x;
    for (const w of out) { w.x += ox; w.y = o.y + w.dy; }
    return { words: out, w: total, x: ox, y: o.y };
  }
  /** Draw a laid-out line; `reveal(i, word)` may return { a, dx, dy, sy } for word i (1 = in place). */
  function drawLine(ctx, line, reveal) {
    ctx.save(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    line.words.forEach((w, i) => {
      const r = reveal ? reveal(i, w) : null;
      if (r && r.a <= 0) return;
      ctx.save();
      if (r) { ctx.globalAlpha *= clamp(r.a ?? 1); ctx.translate(w.x + (r.dx ?? 0), w.y + (r.dy ?? 0)); if (r.sy != null || r.sx != null) ctx.scale(r.sx ?? 1, r.sy ?? 1); }
      else ctx.translate(w.x, w.y);
      ctx.font = w.font; ctx.fillStyle = w.color; ctx.fillText(w.text, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }
  /**
   * The brush underline under a word: the brand's lifted brush mark (store/out/art/underline-<hex>.png), a little wider
   * than the word, drawn on from the left to `k` (0..1), with a slight tilt as a hand would leave it.
   */
  function underline(ctx, im, word, k = 1, o = {}) {
    if (k <= 0) return;
    const w = word.w * (o.wide ?? 1.12), h = w * im.height / im.width * (o.thick ?? 1), x = word.x - (w - word.w) / 2, y = word.y + (o.below ?? 0.1) * (o.size ?? 100);
    ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot ?? -0.012);
    ctx.beginPath(); ctx.rect(-4, -h, w * clamp(k) + 4, h * 2.2); ctx.clip();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.drawImage(im, 0, 0, w, h); ctx.restore();
  }
  /** Plain text at a point (baseline), with font and colour; `align` left/center/right. */
  function text(ctx, s, x, y, f, color, align = "left", o = {}) {
    ctx.save(); ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = o.baseline ?? "alphabetic";
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    if (o.spacing) ctx.letterSpacing = `${o.spacing}px`;
    ctx.fillText(s, x, y); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the hero bot
  // The launch's numbers (launchCore.ts), in the art's own pixels (544 square; the app's points x 4).
  const ART = 544, P = 4;
  const BAR = { x0: 48, y0: 138, x1: 495, y1: 195 };
  const BAR_TOP = BAR.y0 + ART * 0.012, BAR_MID = (BAR.y0 + BAR.y1) / 2, MID = ART / 2;
  const LAUNCH_MS = 2200, STRIPS = 48, LET_GO = [690, 740], LET_GO_MS = 140, COME_BACK = [1400, 1450], COME_BACK_MS = 200;
  const PINCH_AT = 1730, SUCK_AT = 1810, GONE_AT = 2120, CLOSE_MS = 150;
  const SLIP = BAR.y1 - BAR_TOP, FROM = ART * 0.25, OPEN = ART * 0.45;
  const GLOVES = [{ cx: 159, half: 36 }, { cx: 385.5, half: 36.5 }];
  /** The eyes' centre in the art (hero.mjs's eyes layer: its box at 1632 px is 536..1096 x 630..958). */
  const EYES = { cx: (536 + 1096) / 2 / 3, cy: (630 + 958) / 2 / 3 };
  const ease = E.smooth, out = E.o3, inOut = E.io;
  function barDy(t) {
    const gather = K(t, 420, 560), pull = K(t, 560, 900), free = K(t, 900, 1250);
    const sag = t < 560 ? ease(gather) * 1.6 : t < 900 ? 1.6 + Math.sin(pull * Math.PI) * 1.4 : 0;
    const spring = t >= 900 ? -Math.sin(free * Math.PI * 2.5) * (1 - free) * 3.2 : 0;
    const kick = -LET_GO.reduce((k, go) => k + Math.sin(K(t, go, go + 60) * Math.PI), 0) * 1.2;
    const grab = COME_BACK.reduce((k, c, side) => k + Math.sin(K(t, c + COME_BACK_MS - 20, c + COME_BACK_MS + 70) * Math.PI) * (side ? -0.9 : 0.9), 0);
    return (sag + spring + kick + grab) * P;
  }
  function head(t) {
    const gather = K(t, 420, 560), pull = K(t, 560, 900);
    const dip = ease(gather) * 3.5 * P * (1 - ease(K(t, 560, 640)));
    return { dy: dip - inOut(pull) * ART * 0.47, sway: Math.sin(pull * Math.PI) * -2.5, sq: t >= 560 && t < 900 ? 1 - Math.sin(pull * Math.PI) * 0.04 : 1,
      shut: (t > 200 && t < 280) || (t > 600 && t < 660) ? 1 : 0, shown: t < 900 ? 1 : 0 };
  }
  function pulled(x, t) { const d = Math.min(1, Math.abs(x - MID) / ((BAR.x1 - BAR.x0) / 2)); return Math.pow(K(K(t, SUCK_AT, GONE_AT), d * 0.22, d * 0.22 + 0.78), 2.6); }
  const heldAt = (side) => (side ? MID + GLOVES[1].half + 1 : MID - GLOVES[0].half - 1);
  function gloveX(side, t) { if (t < COME_BACK[side]) return GLOVES[side].cx; const x = heldAt(side); return x + (MID - x) * ease(K(t, GONE_AT - CLOSE_MS, GONE_AT)); }
  function glove(side, t) {
    const away = ease(K(t, LET_GO[side], LET_GO[side] + LET_GO_MS));
    const c = COME_BACK[side], landed = c + COME_BACK_MS, back = out(K(t, c, landed));
    const close = ease(K(t, GONE_AT - CLOSE_MS, GONE_AT)), wring = K(t, SUCK_AT, GONE_AT);
    const coming = t >= c, gone = t >= LET_GO[side] + LET_GO_MS;
    return {
      grip: ease(K(t, 560, 680)) * 0.22 + Math.sin(K(t, landed - 30, landed + 110) * Math.PI) * 0.12,
      dy: coming ? 0 : -away * ART * 0.06,
      edge: coming ? (side ? 0 : -OPEN) : away * SLIP,
      lift: coming ? (1 - back) * FROM * (side ? 1 : -1) : 0,
      flip: coming && !side ? -1 : 1,
      gx: gloveX(side, t) - GLOVES[side].cx,
      turn: Math.sin(wring * Math.PI * 2) * (1 - close) * 10 * (side ? 1 : -1),
      size: 1 - close,
      shown: t >= GONE_AT ? 0 : !gone ? 1 : !coming ? 0 : K(t, c, c + COME_BACK_MS * 0.5),
    };
  }
  function strip(i, n, t) {
    const w = BAR.x1 - BAR.x0, x = BAR.x0 + w * (i + 0.5) / n, d = Math.abs(x - MID) / (w / 2);
    const k = pulled(x, t), near = Math.exp(-d * d * 9);
    return { dx: -(x - MID) * k, sx: 1 + k * 2.2, sy: (1 - ease(K(t, PINCH_AT, SUCK_AT)) * 0.38 * near) * (1 - k * 0.85), shown: k >= 0.995 ? 0 : 1 };
  }
  const deg = (d) => d * Math.PI / 180;
  /**
   * The hero: the icon's bot hanging under a piece of his clay bar, drawn from the launch's layers
   * { head, bar, hands, blink } (any size; square; the same frame), with the art's 544 square filling `size` px and
   * its top-left at (x, y). `t` is ms into the launch motion (0 = still, hanging; 2200 = gone), or null for the still.
   * Extras for the trailer: blink (0..1, shuts the eyes over the still), bob (px, a gentle swing of head and gloves
   * together), sway (degrees, the head), alpha. Returns the bar's top edge and the grip in screen px.
   */
  function hang(ctx, L, x, y, size, t = null, o = {}) {
    const s = size / ART, tm = t == null ? 0 : t;
    if (tm >= GONE_AT + 1) return { barTop: y + (BAR_TOP) * s, barMid: y + BAR_MID * s, mid: x + MID * s };
    const bar = barDy(tm), hd = head(tm), WIDE = 60;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    const bob = o.bob ?? 0;
    // his head, behind the bar: only below the bar's top edge, which rides the bar
    if (hd.shown > 0) {
      ctx.save(); ctx.globalAlpha *= hd.shown;
      ctx.beginPath(); ctx.rect(-WIDE, BAR_TOP + bar, ART + 2 * WIDE, ART * 1.5); ctx.clip();
      ctx.translate(0, bar); ctx.translate(MID, BAR_TOP); ctx.rotate(deg(hd.sway + (o.sway ?? 0))); ctx.scale(1, hd.sq); ctx.translate(0, hd.dy + bob); ctx.translate(-MID, -BAR_TOP);
      if (o.eyes && L.face && L.eyes) {
        // his eyes as their own layer: moved by (dx, dy) art px (a look), squeezed by sy (a squint), about their centre
        ctx.drawImage(L.face, 0, 0, ART, ART);
        const e = o.eyes, ex = EYES.cx + (e.dx ?? 0), ey = EYES.cy + (e.dy ?? 0);
        ctx.save(); ctx.translate(ex, ey); ctx.scale(e.sx ?? 1, e.sy ?? 1); ctx.translate(-EYES.cx, -EYES.cy); ctx.drawImage(L.eyes, 0, 0, ART, ART); ctx.restore();
      } else ctx.drawImage(L.head, 0, 0, ART, ART);
      const shut = Math.max(hd.shut, o.blink ?? 0);
      if (shut > 0) { ctx.globalAlpha *= shut; ctx.drawImage(L.blink, 0, 0, ART, ART); }
      ctx.restore();
    }
    // the bar: whole until it pinches, then in strips pulled in to the middle
    if (tm < PINCH_AT) { ctx.save(); ctx.translate(0, bar); ctx.drawImage(L.bar, 0, 0, ART, ART); ctx.restore(); }
    else {
      const barH = BAR.y1 - BAR.y0, sw = (BAR.x1 - BAR.x0) / STRIPS;
      for (let i = 0; i < STRIPS; i++) {
        const st = strip(i, STRIPS, tm); if (st.shown <= 0) continue;
        const left = BAR.x0 + i * sw, cx = left + sw / 2, cy = BAR.y0 + barH / 2;
        ctx.save(); ctx.translate(0, bar); ctx.translate(cx + st.dx, cy); ctx.scale(st.sx, st.sy); ctx.translate(-cx, -cy);
        ctx.beginPath(); ctx.rect(left, BAR.y0, sw + 0.6, barH); ctx.clip(); ctx.drawImage(L.bar, 0, 0, ART, ART); ctx.restore();
      }
    }
    // his gloves, in front, each its own half
    for (const side of [0, 1]) {
      const g = glove(side, tm); if (g.shown <= 0) continue;
      ctx.save(); ctx.globalAlpha *= g.shown; ctx.translate(0, bar);
      ctx.beginPath(); ctx.rect(side * MID, BAR_TOP + g.edge, MID, ART * 1.5); ctx.clip();
      const cx = GLOVES[side].cx;
      ctx.translate(cx, BAR_MID); ctx.translate(g.gx, g.lift); ctx.rotate(deg(g.turn)); ctx.scale(g.size, g.size); ctx.translate(-cx, -BAR_MID);
      ctx.translate(0, BAR_MID); ctx.scale(1, g.flip); ctx.translate(0, -BAR_MID);
      ctx.translate(0, BAR.y1); ctx.scale(1, 1 - g.grip); ctx.translate(0, -BAR.y1);
      ctx.drawImage(L.hands, 0, g.dy + (tm < COME_BACK[side] ? bob : 0), ART, ART);
      ctx.restore();
    }
    ctx.restore();
    return { barTop: y + (BAR_TOP + bar) * s, barMid: y + (BAR_MID + bar) * s, barBottom: y + (BAR.y1 + bar) * s, mid: x + MID * s, barX0: x + BAR.x0 * s, barX1: x + BAR.x1 * s };
  }
  hang.LAUNCH_MS = LAUNCH_MS; hang.GONE_AT = GONE_AT; hang.BAR = BAR; hang.ART = ART; hang.BAR_TOP = BAR_TOP;

  /**
   * The bot peeking over an edge (store/out/art/bot-<pose>.png, `ledge` = the y in the PNG that sits on the edge):
   * drawn `w` wide with its ledge on y at x (centre), risen `rise` (0 = all below the edge, 1 = up), clipped below the
   * edge so only what has come up shows. `lean` turns him a little about the edge.
   */
  function peek(ctx, im, ledge, x, y, w, rise = 1, o = {}) {
    const h = w * im.height / im.width, k = h / im.height, up = ledge * k, below = h - up, r = clamp(rise);
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.translate(x, y); if (o.lean) ctx.rotate(o.lean);
    // what is above the edge: the head rising behind it
    ctx.save(); ctx.beginPath(); ctx.rect(-w, -2 * h, 2 * w, 2 * h); ctx.clip();
    ctx.drawImage(im, -w / 2, -up + (1 - r) * (up + 6), w, h); ctx.restore();
    // what hangs over it in front (his fingers), once he has come up
    if (r > 0.6 && below > 0) { ctx.globalAlpha *= K(r, 0.6, 1); ctx.drawImage(im, 0, ledge, im.width, im.height - ledge, -w / 2, 0, w, below); }
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ cards and screens
  /** A white card with the app's hairline and a soft shadow (the store frames' card). */
  function card(ctx, x, y, w, h, r = 28, o = {}) {
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    if (o.shadow !== false) { ctx.shadowColor = `rgba(0,0,0,${o.shadowAlpha ?? 0.14})`; ctx.shadowBlur = o.shadowBlur ?? 40; ctx.shadowOffsetY = o.shadowDy ?? 18; }
    ctx.fillStyle = o.fill ?? "#FFFFFF"; rrect(ctx, x, y, w, h, r); ctx.fill();
    ctx.shadowColor = "transparent";
    if (o.border !== false) { ctx.strokeStyle = o.border ?? C.line; ctx.lineWidth = o.lineWidth ?? 2; rrect(ctx, x, y, w, h, r); ctx.stroke(); }
    ctx.restore();
  }
  /**
   * A real app screen (a tall PNG) shown in a rounded window `w` wide and `h` tall at (x, y), scrolled to `scroll`
   * (px of the screen, in the window's scale), with the screen's own ratio kept.
   */
  function screen(ctx, im, x, y, w, h, r = 36, o = {}) {
    const s = w / im.width, scroll = (o.scroll ?? 0) * s;
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(x, y, w, h);
    ctx.drawImage(im, x, y - scroll, w, im.height * s);
    ctx.restore();
  }
  /** Draw an image revealed by a wipe: `k` 0..1 from the left (dir "x"), the top ("y"), or by alpha ("a"). */
  function wipe(ctx, im, x, y, w, h, k, dir = "x", o = {}) {
    k = clamp(k); if (k <= 0) return;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    if (dir === "a") ctx.globalAlpha *= k;
    else { ctx.beginPath(); if (dir === "x") ctx.rect(x - 2, y - h, w * k + 2, 3 * h); else ctx.rect(x - w, y - 2, 3 * w, h * k + 2); ctx.clip(); }
    ctx.drawImage(im, x, y, w, h); ctx.restore();
  }
  /** A camera: zoom about (cx, cy) with a drift (dx, dy); call before drawing a shot's content, restore after. */
  function camera(ctx, zoom, cx, cy, dx = 0, dy = 0) { ctx.translate(cx + dx, cy + dy); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy); }
  /** Break text into lines no wider than maxW in font f. */
  function wrap(ctx, s, maxW, f) {
    ctx.save(); ctx.font = f; const words = s.split(" "), lines = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); ctx.restore(); return lines;
  }
  /** A chat bubble (the app's): grey from them, ink from you, text wrapped inside. Returns its height. */
  function bubble(ctx, s, x, y, maxW, size, mine = false, o = {}) {
    const f = font(400, size, "Bricolage"), pad = size * 0.75, lines = wrap(ctx, s, maxW - 2 * pad, f), lh = size * 1.3;
    let w = 0; ctx.save(); ctx.font = f; for (const l of lines) w = Math.max(w, ctx.measureText(l).width); ctx.restore();
    const bw = w + 2 * pad, bh = lines.length * lh + pad * 1.4, bx = mine ? x - bw : x;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha);
    ctx.fillStyle = mine ? C.ink : C.surface; rrect(ctx, bx, y, bw, bh, Math.min(bh / 2, size * 1.1)); ctx.fill();
    ctx.fillStyle = mine ? "#FFFFFF" : C.ink; ctx.font = f; ctx.textBaseline = "alphabetic";
    lines.forEach((l, i) => ctx.fillText(l, bx + pad, y + pad * 0.7 + size + i * lh));
    ctx.restore(); return bh;
  }

  // ------------------------------------------------------------------------------------------------ frame helpers
  /** The safe area for words on a vertical short: clear of the platform's own UI at the bottom and the right. */
  function safe(W, H, portrait) {
    return portrait ? { x: W * 0.07, y: H * 0.11, w: W * 0.86, h: H * 0.66 } : { x: W * 0.06, y: H * 0.1, w: W * 0.88, h: H * 0.8 };
  }
  /** A beat: local progress k (0..1) and seconds since t0, or null outside [t0, t1). */
  function beat(t, t0, t1) { return t >= t0 && t < t1 ? { k: (t - t0) / (t1 - t0), s: t - t0, left: t1 - t } : null; }
  /** Breath: a slow 1-centred swell. */
  const breathe = (t, period = 3.2, amp = 0.012) => 1 + Math.sin(t * Math.PI * 2 / period) * amp;

  return { clamp, K, lerp, E, rng, hash, C, load, fonts, img, cover, rrect, grain, vignette, font, width, layout, drawLine, underline, text, hang, peek, card, screen, wipe, camera, wrap, bubble, safe, beat, breathe, deg };
})();
