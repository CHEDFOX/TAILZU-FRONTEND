/* THE AD KIT: what every film on footage shares, so a new spot is only its own beats.
 *
 *   AD.start({ footage, voices, duration, frame(t, S), cues(S) }) wires the page for render.mjs (window.__frame, __cues,
 *   __ready, TRAILER.duration). Everything draws in a 1080 x 1920 space (S.ctx is pre-scaled), as a pure function of t.
 *
 *   footage: { name: { dir: "footage-x/", frames: 721, fps: 72 } ... }  frames are s0001.jpg … (prep.mjs makes them)
 *   voices:  { name: "voice/x.json" ... }  edge-tts word times (voice.mjs makes them, with the matching WAV)
 *
 *   S (the scene): { ctx, W, H, u, A (assets), V (voices: { name: { words:[{w,text,t0,t1}], dur } }),
 *                    foot(name, srcTime) -> Image, t }
 *
 *   AD.map(keys)                      a piecewise-linear clock: [[t, src], …] -> f(t) (slow motion, freezes, ramps)
 *   AD.film(S, img, { zoom, cold, grade })   the footage covered on the frame with the campaign grade (cold = frozen look)
 *   AD.bars(S, h)                     cinema bars
 *   AD.onFilm(S, text, x, y, font, color, align, alpha)   white type with the deep shadow, drawn twice
 *   AD.caption(S, voice, t0, t, o)    the spoken words as handwriting at their times (pages of up to two lines)
 *   AD.dots(S, voice, t0, t, color)   the three listening dots, blooming per word
 *   AD.card(S, o)                     a taped paper card: { x, y, w, h, rot, k (0..1 press-in), out (0..1 leave), head, name, color, lines, bubble, pill, note }
 *   AD.headline(S, t, o)              two white Geist lines, one hand word, a brush underline: { lines: ["Hands full","Day sorted"], hand: {line, word}, ul, at:{l1,l2,hand,ul}, x, base, size }
 *   AD.slam(S, word, x, y, size, k)   a word slammed in (scale 1.3 -> 1)
 *   AD.markPaint(S, mx, my, mw, s1, s2, s3)   the painted X0 in three strokes (the 0 narrowed)
 *   AD.endCard(S, t, t0, o)           the campaign end card: sheet, hero, mark, line, stamp (4.9 s)
 *   AD.endCues(t0)                    its sounds
 *   AD.fr, AD.F, AD.lerp, X0.E        easing helpers (X0 is the trailer's engine, loaded before this file)
 */
window.AD = (() => {
  "use strict";
  const { C, E, clamp } = X0;
  const FPS = 30, F = (n) => n / FPS, fr = (t, t0, dur) => clamp((t - t0) / dur), lerp = (a, b, k) => a + (b - a) * k;
  const abs = (p) => new URL(p, location.href).href;
  const json = (url) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", url); x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(e); } }; x.onerror = () => rej(new Error("json " + url)); x.send(); });

  const BASE = {   // the campaign's shared assets (relative to engine.js: the trailer folder)
    paper: "components/paper.jpg", tape: "components/tape-grey.png", mark: "components/mark-x0-ink.png", stamp: "components/pen-stamp.png", hatch: "components/hatch.png",
    "pen-frame": "components/pen-frame.png", "pen-pill": "components/pen-pill.png", "pen-pill-yes": "components/pen-pill-yes.png", "clay-dot": "components/clay-dot.png",
    "scrap-note": "components/scrap-note.png", "scrap-blank-1": "components/scrap-blank-1.png", "scrap-tiny": "components/scrap-tiny.png", "ink-tick": "components/ink-tick.png", "listen-dots": "components/listen-dots.png",
    head: "hero/hang-head-1632.png", bar: "hero/hang-bar-1632.png", hands: "hero/hang-hands-1632.png", blink: "hero/hang-blink-1632.png",
    face: "hero/hang-face-1632.png", eyes: "hero/hang-eyes-1632.png", lidL: "hero/hang-lidL-1632.png", lidR: "hero/hang-lidR-1632.png",
    "ul-bar": "../store/out/art/underline-c9683f.png", "ul-ink": "../store/out/art/underline-0a0a0a.png", "ul-plan": "../store/out/art/underline-8f6a1f.png", "ul-travel": "../store/out/art/underline-3e6e8e.png", "ul-keybot": "../store/out/art/underline-a9573a.png", "ul-code": "peek/underline-4f7a3a.png",
    "head-plan": "assets/head-plan.png", "head-travel": "assets/head-travel.png", "head-keybot": "assets/head-keybot.png", "head-code": "assets/head-code.png",
    "peek-curious": "peek/bot-curious-nohands.png", "peek-happy": "peek/bot-happy-nohands.png", "peek-wink": "peek/bot-wink-nohands.png", "peek-hello": "peek/bot-hello-nohands.png", "peek-shy": "peek/bot-shy-nohands.png", "peek-starry": "peek/bot-starry-nohands.png", "glove-L": "peek/glove-L.png", "glove-R": "peek/glove-R.png",
  };
  const BOT = { plan: { color: C.ochre, head: "head-plan", ul: "ul-plan", name: "Plan bot", note: 369.99 }, travel: { color: C.sea, head: "head-travel", ul: "ul-travel", name: "Travel bot", note: 440 },
    keybot: { color: C.clay, head: "head-keybot", ul: "ul-keybot", name: "Keybot", note: 293.66 }, code: { color: C.moss, head: "head-code", ul: "ul-code", name: "Code bot", note: 493.88 } };

  async function start(spec) {
    const q = new URLSearchParams(location.search);
    const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), u = W / 1080;
    const cv = document.getElementById("c"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    await X0.fonts();
    const man = { ...BASE, ...(spec.assets || {}) };
    const foot = {};
    for (const [name, f] of Object.entries(spec.footage || {})) { foot[name] = { ...f, fps: f.fps || 72 }; for (let i = 1; i <= f.frames; i++) man[`${name}#${i}`] = abs(`${f.dir}s${String(i).padStart(4, "0")}.jpg`); }
    const A = await X0.load(man);
    const V = {};
    for (const [name, file] of Object.entries(spec.voices || {})) { const words = await json(file); const script = (spec.scripts || {})[name]; const toks = script ? script.split(" ") : null; V[name] = { words: words.map((w, i) => ({ ...w, text: toks && toks[i] != null ? toks[i] : w.w })), dur: (words[words.length - 1]?.t1 ?? 0) + 0.12 }; }
    const S = { ctx, W, H, u, A, V, q, FPS, foot: (name, src) => { const f = foot[name]; if (!f) throw new Error("no footage " + name); return A[`${name}#${clamp(Math.round(src * f.fps) + 1, 1, f.frames)}`]; }, footLen: (name) => foot[name].frames / foot[name].fps };
    const T = spec.timeline ? spec.timeline(S) : {};
    S.T = T;
    const duration = typeof spec.duration === "function" ? spec.duration(S) : spec.duration;
    window.TRAILER = { duration, T };
    window.__frame = (t) => {
      ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none"; ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, 1920);
      S.t = t; spec.frame(t, S);
      if (q.get("hud")) X0.text(ctx, `t ${t.toFixed(2)} f${Math.round(t * FPS)}`, 16, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
    };
    window.__cues = () => (spec.cues ? spec.cues(S) : []);
    window.__ready = true;
    return S;
  }

  /** A piecewise-linear clock through [t, value] keys (held flat between equal values: a freeze). */
  function map(keys) {
    return (t) => {
      if (t <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * (b > a ? (t - a) / (b - a) : 1); }
      return keys[keys.length - 1][1];
    };
  }
  /** The footage on the frame: covered, with a zoom, the campaign grade, colder and dimmer by `cold` (a freeze), the vignette. */
  function film(S, img, o = {}) {
    const { ctx } = S, cold = o.cold ?? 0;
    ctx.save(); ctx.filter = o.grade ?? `contrast(${1.06 + 0.07 * cold}) saturate(${(o.sat ?? 0.92) - 0.45 * cold}) brightness(${(o.bright ?? 0.98) - 0.2 * cold})`;
    X0.cover(ctx, img, 0, 0, 1080, 1920, { zoom: o.zoom ?? 1, dx: o.dx ?? 0, dy: o.dy ?? 0 });
    ctx.restore();
    if (o.vignette !== false) X0.vignette(ctx, 1080, 1920, (o.vig ?? 0.22) + 0.3 * cold);
    if (o.flash) { ctx.fillStyle = `rgba(255,255,255,${o.flash})`; ctx.fillRect(0, 0, 1080, 1920); }
  }
  function bars(S, h = 112) { const { ctx } = S; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, h); ctx.fillRect(0, 1920 - h, 1080, h); }
  function scrim(S, y0, y1, a) { const { ctx } = S, g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, Math.min(y0, y1), 1080, Math.abs(y1 - y0)); }
  function onFilm(S, s, x, y, f, color = "rgba(255,255,255,0.93)", align = "left", alpha = 1) {
    const { ctx } = S; ctx.save(); ctx.globalAlpha *= alpha; ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3;
    X0.text(ctx, s, x, y, f, color, align); X0.text(ctx, s, x, y, f, color, align); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the voice on screen
  const CAP = { size: 70, x: 80, y: 1120, pitch: 78, maxW: 1080 - 80 - 90 };
  function capLayout(S, voice, o) {
    const key = `_cap_${o.size || 0}_${o.maxW || 0}`; if (voice[key]) return voice[key];
    const { ctx } = S, size = o.size ?? CAP.size, f = X0.font(700, size, "Caveat"), maxW = o.maxW ?? CAP.maxW, pages = o.pages || [[0, voice.words.length]];
    ctx.save(); ctx.font = f;
    const out = pages.map(([a, b]) => {
      const lines = [[]]; let w = 0;
      for (let i = a; i < b; i++) { const wd = voice.words[i], ww = ctx.measureText(wd.text + " ").width; if (w + ww > maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; } lines[lines.length - 1].push({ ...wd, i, ww }); w += ww; }
      return { a, b, lines, t0: voice.words[a].t0, t1: b < voice.words.length ? voice.words[b].t0 : Infinity };
    });
    ctx.restore(); return (voice[key] = out);
  }
  /** The spoken words as handwriting at their times: pages (word-index ranges) of up to two lines, top-anchored at y. */
  function caption(S, voice, t0, t, o = {}) {
    const { ctx } = S, te = t - t0, size = o.size ?? CAP.size, f = X0.font(700, size, "Caveat"), x0 = o.x ?? CAP.x, y0 = o.y ?? CAP.y, pitch = o.pitch ?? size * 1.12, color = o.color ?? "rgba(255,255,255,0.93)";
    for (const pg of capLayout(S, voice, o)) {
      if (te < pg.t0 - 0.06) continue;
      const out = pg.t1 === Infinity ? 0 : E.io(fr(te, pg.t1 - 0.1, F(4))); if (out >= 1) continue;
      ctx.save(); ctx.globalAlpha *= 1 - out;
      pg.lines.forEach((ln, li) => {
        let x = x0; const y = y0 + li * pitch;
        for (const wd of ln) {
          const k = fr(te, wd.t0 - 0.05, F(4));
          if (k > 0) { ctx.save(); ctx.beginPath(); ctx.rect(x - 8, y - size, (wd.ww + 16) * E.o3(k), size * 1.6); ctx.clip();
            ctx.translate(x, y + (X0.hash((wd.t0 * 1000) | 0) - 0.5) * 3); ctx.rotate((X0.hash((wd.t1 * 977) | 0) - 0.5) * 0.03); onFilm(S, wd.text, 0, 0, f, color); ctx.restore(); }
          x += wd.ww;
        }
      });
      ctx.restore();
    }
  }
  /** Three listening dots in a colour, blooming one by one on each spoken word; from t0 - 0.4 to the last word. */
  function dots(S, voice, t0, t, color, o = {}) {
    const { ctx } = S, words = voice.words; let said = 0; for (const wd of words) if (t >= t0 + wd.t0) said++;
    const end = t0 + voice.dur; if (!(t >= t0 - 0.4 && t < end + 0.1)) return;
    const a = Math.min(fr(t, t0 - 0.4, F(6)), 1 - fr(t, end - F(3), F(5))), x0 = o.x ?? CAP.x + 16, y = o.y ?? 1040;
    for (let i = 0; i < 3; i++) {
      const lit = said > 0 && (said - 1) % 3 === i, tw = said > 0 ? t0 + words[said - 1].t0 : -1;
      const bloom = lit ? 1 - 0.35 * fr(t, tw, F(8)) : said > 0 ? 0.45 : 0.6 + 0.15 * Math.sin(t * 3 + i * 1.3);
      const r = (12 + 7 * bloom) * (0.6 + 0.4 * a);
      ctx.save(); ctx.globalAlpha *= a * (0.55 + 0.45 * bloom); ctx.fillStyle = color; ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x0 + i * 44, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }

  // ------------------------------------------------------------------------------------------------ paper on film
  /**
   * A taped paper card pressed onto the frame. o: { x, y, w, h, rot, k (press-in 0..1), out (leaving 0..1), tapeDx, tapeRot,
   * bot ("plan"|"travel"|"keybot"|"code") or { head, name, color, ul }, lines: [{ text, size, weight, color, ulWord, ulK }],
   * bubble (a black chat bubble line), pill (an outline tag), pillNote, note (handwritten Caveat lines) }
   */
  function card(S, o) {
    const { ctx, A } = S, k = clamp(o.k ?? 1), out = clamp(o.out ?? 0); if (k <= 0 || out >= 1) return;
    const w = o.w ?? 760, h = o.h ?? 330, x = o.x ?? 150, y = o.y ?? 700, cx = x + w / 2, cy = y + h / 2, bot = typeof o.bot === "string" ? BOT[o.bot] : o.bot;
    ctx.save();
    ctx.translate(cx, cy + out * 14); ctx.rotate(o.rot ?? -0.04);
    const press = (1.14 - 0.14 * E.o5(k)) * (1 - 0.07 * out); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2) * (1 - out);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, 26); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, 26); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, 26); ctx.stroke();
    let ly = y + 30;
    if (bot) { const hs = 84; ctx.drawImage(A[bot.head], x + 36, y + 30, hs, hs); X0.text(ctx, bot.name, x + 36 + hs + 20, y + 30 + hs * 0.68, X0.font(600, 38), bot.color); ly = y + 30 + hs + 64; }
    else ly = y + 30 + 56;
    if (o.bubble) { const bf = X0.font(500, 42, "Bricolage"), bw = X0.width(ctx, o.bubble, bf) + 56; ctx.fillStyle = C.ink; X0.rrect(ctx, x + w - 36 - bw, ly - 48, bw, 76, 38); ctx.fill(); X0.text(ctx, o.bubble, x + w - 36 - bw + 28, ly + 2, bf, "#FFFFFF"); ly += 86; }
    for (const ln of o.lines || []) {
      const f = X0.font(ln.weight ?? 600, ln.size ?? 50); X0.text(ctx, ln.text, x + 36, ly, f, ln.color ?? C.ink);
      if (ln.ulWord && bot) {
        const i = ln.text.indexOf(ln.ulWord), pre = X0.width(ctx, ln.text.slice(0, i), f), ww = X0.width(ctx, ln.ulWord, f), im = A[bot.ul];
        const uw = ww * 1.1, uh = Math.max(18, uw * im.height / im.width * 1.1);
        X0.reveal(ctx, im, x + 36 + pre - (uw - ww) / 2, ly + (ln.size ?? 50) * 0.18, uw, uh, E.o3(ln.ulK ?? 1), "x", { rot: -0.012, rag: 8, seed: 4 });
      }
      ly += (ln.size ?? 50) * 1.45;
    }
    for (const n of o.note || []) { X0.text(ctx, n, x + 36, ly, X0.font(700, 52, "Caveat"), C.ink); ly += 60; }
    if (o.pill) { const pw = o.pillW ?? 300, ph = 72, px = x + w - 36 - pw, py = y + h - 36 - ph;
      ctx.strokeStyle = "#111111"; ctx.lineWidth = 2.5; X0.rrect(ctx, px, py, pw, ph, ph / 2); ctx.stroke(); X0.text(ctx, o.pill, px + pw / 2, py + ph / 2 + 14, X0.font(500, 38), "#111111", "center");
      if (o.pillNote) X0.text(ctx, o.pillNote, x + 36, py + ph / 2 + 14, X0.font(500, 42), "#333333"); }
    const tw = 230, th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx + (o.tapeDx ?? 0), y + 2); ctx.rotate(o.tapeRot ?? -0.07); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore();
    ctx.restore();
  }
  /** Two white Geist lines, one word by hand with a brush underline; each piece writes on from its frame in o.at. */
  function headline(S, t, o) {
    const { ctx, A } = S, size = o.size ?? 120, x = o.x ?? 80, base = o.base ?? [400, 538], at = o.at, hs = size * 1.15;
    if (t < at.l1) return; const out = o.out != null && t >= o.out ? E.i2(fr(t, o.out, F(10))) : 0; if (out >= 1) return;
    ctx.save(); ctx.globalAlpha *= 1 - out; ctx.shadowColor = "rgba(0,0,0,0.65)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
    const color = o.color ?? "#FFFFFF";
    const lines = o.lines.map((text, i) => X0.layout(ctx, text.split(" ").map((w) => (o.hand && o.hand.line === i && w === o.hand.word ? { text: w, hand: true, handWeight: 700, scale: hs / size } : { text: w })), { x, y: base[i], size, weight: 900, color }));
    lines.forEach((line, i) => {
      const f0 = i === 0 ? at.l1 : at.l2; if (f0 == null || t < f0) return;
      const k = E.o3(fr(t, f0, F(7)));
      ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base[i] - size * 1.3, (line.w + 40) * k, size * 1.7); ctx.clip(); X0.drawLine(ctx, line, (j, w) => (w.hand ? { a: 0 } : { a: 1 })); ctx.restore();
      const hw = line.words.find((w) => w.hand);
      if (hw && at.hand != null && t >= at.hand) {
        const kh = E.o3(fr(t, at.hand, F(7)));
        ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, base[i] - size * 1.3, (hw.w + 30) * kh, size * 1.8); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore();
        if (o.ul && at.ul != null && t >= at.ul) { const im = A[o.ul], uw = hw.w * 1.08, uh = Math.max(24, uw * im.height / im.width * 1.15); ctx.shadowColor = "transparent"; X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 12, hw.y + size * 0.12, uw, uh, E.o3(fr(t, at.ul, F(9))), "x", { rot: -0.012, rag: 10, seed: 2 }); }
      }
    });
    ctx.restore();
  }
  /** A word slammed in: scale 1.3 -> 1 over 3 f, centred at (x, y). */
  function slam(S, word, x, y, size, k, o = {}) {
    const { ctx } = S; if (k <= 0) return; const f = X0.font(o.weight ?? 900, size), s = 1.3 - 0.3 * E.o3(k);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); onFilm(S, word, 0, 0, f, o.color ?? "rgba(255,255,255,0.96)", o.align ?? "center", Math.min(1, k * 2)); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the mark and the end card
  /** The painted X0 in three strokes: the X's two slashes, then the 0 round (narrowed to a digit). */
  function markPaint(S, mx, my, mw, s1, s2, s3) {
    const { ctx, A } = S, mh = mw * A.mark.height / A.mark.width;
    // Each stroke is the slice of the mark from SOURCE x s0 to x1 (clipped after the squeeze, in the art's own space),
    // squeezed about the middle of x0..x1. Clipping before the squeeze let the tip of the X's right arm (source
    // 0.436-0.457) through the 0's stroke as a thin sliver at 0.52-0.536; the X's ink ends at 0.457 and the 0's starts
    // at 0.503, so the 0 is cut from 0.48.
    const region = (x0, x1, k, dir, squeeze = 1, s0 = x0) => {
      if (k <= 0) return; const cvs = X0.offscreen(mw, mh), c2 = cvs.getContext("2d");
      const cx = mw * (x0 + x1) / 2; c2.translate(cx, 0); c2.scale(squeeze, 1); c2.translate(-cx, 0);
      c2.beginPath(); c2.rect(mw * s0, 0, mw * (x1 - s0), mh); c2.clip(); c2.drawImage(A.mark, 0, 0, mw, mh);
      X0.reveal(ctx, cvs, mx, my, mw, mh, k, dir, { rag: 10, seed: 7 }); X0.release(cvs);
    };
    region(0, 0.495, E.o3(s1), "diag"); if (s2 > 0) region(0, 0.495, E.o3(s2), "-diag"); region(0.52, 1, s3, "conic", 0.74, 0.48);
    return mh;
  }
  /** The campaign end card from t0 (4.9 s): the white sheet slides up, the hero on his bar, the mark, the line, the stamp (address first), a wink, stillness. */
  function endCard(S, t, t0, o = {}) {
    if (t < t0) return; const { ctx, A } = S;
    const kin = E.o5(fr(t, t0, F(14))), dy = (1 - kin) * 1920;
    ctx.save(); ctx.translate(0, dy);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 60; ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920 + 40); ctx.restore();
    X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 });
    const te = t - t0;
    const open = E.o3(fr(te, F(18), F(4))), wink = te >= F(104) && te < F(118) ? (te < F(108) ? fr(te, F(104), F(4)) : te < F(114) ? 1 : 1 - fr(te, F(114), F(4))) : 0;
    const look = { dx: 0, dy: 4 * (1 - E.io(fr(te, F(40), F(10)))) };
    X0.hang(ctx, A, 8, 100, 816, null, { eyes: look, blink: 1 - open, lids: [wink, 0], bob: te < F(96) ? Math.sin(te * 2.2) * 3 * (1 - fr(te, F(84), F(12))) : 0, sway: -2.5 * wink });
    markPaint(S, 80, 740, 460, fr(te, F(24), F(6)), fr(te, F(30), F(6)), E.io(fr(te, F(36), F(16))));
    const kl = E.o3(fr(te, F(58), F(9))); if (kl > 0) { ctx.save(); ctx.beginPath(); ctx.rect(60, 1030, 1000 * kl, 100); ctx.clip(); X0.text(ctx, o.line ?? "Your team of bots", 80, 1095, X0.font(600, 60), C.ink); ctx.restore(); }
    const ks = fr(te, F(70), F(4)); if (ks > 0) { const sw = 560, sh = sw * A.stamp.height / A.stamp.width, sx = 80, sy = 1165 + (150 - sh) / 2;
      ctx.save(); ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(-0.045); const ps = 1.08 - 0.08 * E.o5(ks); ctx.scale(ps, ps); ctx.translate(-(sx + sw / 2), -(sy + sh / 2));
      ctx.drawImage(A.stamp, sx, sy, sw, sh);
      X0.text(ctx, o.stampTop ?? "Coming soon", sx + 40, sy + sh * 0.4, X0.font(500, 38), "#555555");
      const uf = X0.font(700, 58), ux = sx + 40, uy = sy + sh * 0.8; X0.text(ctx, "x0bot.com", ux, uy, uf, "#111111");
      const zx = ux + X0.width(ctx, "x", uf), zw = X0.width(ctx, "0", uf); ctx.strokeStyle = "#111111"; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(zx + zw * 0.72, uy - 58 * 0.66); ctx.lineTo(zx + zw * 0.28, uy - 58 * 0.06); ctx.stroke();
      ctx.restore(); }
    ctx.restore();
  }
  const END_S = 4.9;
  function endCues(t0) {
    const c = [{ at: t0, kind: "open", gain: 0.6 }, { at: t0 + F(14), kind: "land", gain: 0.5 }, { at: t0 + F(18), kind: "listen", gain: 0.3 },
      { at: t0 + F(24), kind: "write", gain: 0.35 }, { at: t0 + F(30), kind: "land", gain: 0.35 }, { at: t0 + F(36), kind: "whoosh", dur: 0.5, up: true, gain: 0.3 },
      { at: t0 + F(52), kind: "boom", gain: 0.7 }, { at: t0 + F(52), kind: "chord", f: 146.83, dur: 3, gain: 0.5 },
      { at: t0 + F(58), kind: "write", gain: 0.3 }, { at: t0 + F(70), kind: "land", gain: 0.4 }, { at: t0 + F(70), kind: "click", gain: 0.3 }, { at: t0 + F(104), kind: "bell", f: 587.33, dur: 0.5, gain: 0.3 }];
    for (const [f, g] of [[293.66, 0.22], [369.99, 0.22], [440, 0.22], [493.88, 0.22], [587.33, 0.25]]) c.push({ at: t0 + F(52), kind: "bell", f, dur: 2.4, gain: g });
    return c;
  }
  /** The small white mark (and a line) in a corner or a bar, for brand presence before the end card. */
  function cornerMark(S, x, y, h, alpha = 0.82, line) {
    const { ctx, A } = S, im = X0.tint(A.mark, "#FFFFFF"), mw = h * A.mark.width / A.mark.height;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10; ctx.drawImage(im, x, y, mw, h);
    if (line) X0.text(ctx, line, x + mw + 22, y + h * 0.78, X0.font(500, h * 0.85), "rgba(255,255,255,0.75)"); ctx.restore();
  }
  /** The hero peeking over an edge on film (a face without gloves + its gloves), see X0.peekRig. */
  const peekMeta = { cache: null };
  async function peekRig(S) { if (!peekMeta.cache) peekMeta.cache = await json(new URL("../trailer/peek/peek.json", location.href).href); return { img: Object.fromEntries(["curious", "happy", "wink", "hello", "shy", "starry"].map((p) => [`bot-${p}-nohands`, S.A[`peek-${p}`]]).concat([["glove-L", S.A["glove-L"]], ["glove-R", S.A["glove-R"]]])), meta: peekMeta.cache }; }

  return { start, map, film, bars, scrim, onFilm, caption, dots, card, headline, slam, markPaint, endCard, endCues, END_S, cornerMark, peekRig, BOT, F, fr, lerp, FPS };
})();
