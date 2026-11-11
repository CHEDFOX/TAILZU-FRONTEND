/* HANDS FULL: the kitchen ad. A real clip (a man cooking at night, steam, a hood light; locked off, 5 s, no sound) and
 * the brand's paper world laid on it. He dictates three jobs to his bots while his hands are busy; on each last word
 * the film FREEZES, the frame goes cold and a paper card with the bot's answer is taped onto it; the frame breathes
 * again; a headline; then a white sheet slides up over the kitchen with the hero hanging from his bar, the mark and the
 * place to go.
 *
 * Everything is a function of t: the footage is 358 motion-interpolated frames (72 fps) of the 5 s clip in footage/,
 * played slow through a piecewise map (srcTime), held still on the freezes. The voice is three neural reads in voice/
 * (edge-tts, en-IN Prabhat), whose word times drive the handwritten captions ("said") that become type on the cards
 * ("written"). The timeline is laid out from the voice files' lengths, so a re-recorded line moves everything after it.
 *
 * Render: PW_ROOT=<playwright dir> node ../trailer/render.mjs out --page kitchen.html --ratio 9x16 [--stills ...]
 */
(async () => {
  "use strict";
  const { C, E, K, clamp } = X0;
  const q = new URLSearchParams(location.search);
  const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), u = W / 1080, FPS = 30;
  const cv = document.getElementById("c"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const abs = (p) => new URL(p, location.href).href;
  const json = (url) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", url); x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(e); } }; x.onerror = () => rej(new Error("json " + url)); x.send(); });

  await X0.fonts();
  // ------------------------------------------------------------------------------------------------ assets
  const FOOT_N = 358, FOOT_FPS = 72, FOOT_DIR = q.get("footage") || "footage/";
  const man = {
    paper: "components/paper.jpg", tape: "components/tape-grey.png", mark: "components/mark-x0-ink.png", stamp: "components/pen-stamp.png",
    head: "hero/hang-head-1632.png", bar: "hero/hang-bar-1632.png", hands: "hero/hang-hands-1632.png", blink: "hero/hang-blink-1632.png",
    face: "hero/hang-face-1632.png", eyes: "hero/hang-eyes-1632.png", lidL: "hero/hang-lidL-1632.png", lidR: "hero/hang-lidR-1632.png",
    "ul-plan": "../store/out/art/underline-8f6a1f.png", "ul-travel": "../store/out/art/underline-3e6e8e.png", "ul-keybot": "../store/out/art/underline-a9573a.png", "ul-bar": "../store/out/art/underline-c9683f.png",
    "head-plan": "assets/head-plan.png", "head-travel": "assets/head-travel.png", "head-keybot": "assets/head-keybot.png",
  };
  for (let i = 1; i <= FOOT_N; i++) man[`f${i}`] = abs(`${FOOT_DIR}s${String(i).padStart(4, "0")}.jpg`);
  const A = await X0.load(man);
  // The script as written (with its punctuation) and the voice's word times (edge-tts strips punctuation): zipped by index.
  const SCRIPT = {
    plan: "Plan... move dinner with Mom to eight thirty. And tell her.",
    travel: "Travel, the Lisbon train... umm, Saturday morning, not Friday. Two seats.",
    keybot: "Keybot, tell Leo: running late, start without me.",
  };
  const VO = {};
  for (const k of Object.keys(SCRIPT)) {
    const words = await json(`voice/${k}.json`), toks = SCRIPT[k].split(" ");
    if (toks.length !== words.length) console.warn(`voice ${k}: ${toks.length} tokens vs ${words.length} words`);
    VO[k] = { words: words.map((w, i) => ({ ...w, text: toks[i] ?? w.w })), dur: words[words.length - 1].t1 + 0.12 };
  }

  // ------------------------------------------------------------------------------------------------ the timeline (seconds)
  const snap = (s) => Math.round(s * FPS) / FPS;
  const F = (n) => n / FPS;   // frames to seconds
  const T = { intro: 1.8 };
  const EPISODES = [
    { key: "plan", color: C.ochre, head: "head-plan", name: "Plan bot", ul: "ul-plan", lines: [{ text: "Dinner with Mom · 8:30 pm", size: 50, weight: 600, ulWord: "8:30 pm" }, { text: "Told Mom", size: 42, weight: 500, color: "#333333" }], h: 330,
      rot: -0.045, tx: -40, tapeDx: -60, tapeRot: -0.07, pages: [[0, 11]] },
    { key: "travel", color: C.sea, head: "head-travel", name: "Travel bot", ul: "ul-travel", lines: [{ text: "Lisbon · Sat 7:40 · 2 seats", size: 50, weight: 600, ulWord: "Sat 7:40" }], pill: "Open to book", h: 380,
      rot: 0.026, tx: 40, tapeDx: 70, tapeRot: -0.03, pages: [[0, 5], [5, 11]] },
    { key: "keybot", color: C.clay, head: "head-keybot", name: "Keybot", ul: "ul-keybot", bubble: "Running late, start without me.", lines: [{ text: "Sent to Leo", size: 42, weight: 500, color: "#333333", ulWord: "Leo" }], h: 370,
      rot: -0.017, tx: -10, tapeDx: 20, tapeRot: -0.11, pages: [[0, 8]] },
  ];
  let t = T.intro;
  for (const ep of EPISODES) {
    ep.say0 = snap(t); ep.say1 = snap(ep.say0 + VO[ep.key].dur);
    ep.freeze0 = snap(ep.say1 + 0.1); ep.freeze1 = snap(ep.freeze0 + 1.9);
    t = ep.freeze1 + 0.32;
  }
  T.head0 = snap(EPISODES[2].freeze1 + 0.15); T.head1 = snap(T.head0 + 2.9);
  T.end0 = T.head1; T.end1 = snap(T.end0 + 4.9);
  const DURATION = T.end1;
  window.TRAILER = { duration: DURATION, T, EPISODES };

  /** The footage's own clock for the ad's: slow through the talking, still on the freezes, a last slow stretch under the headline. */
  const SRC_TOTAL = FOOT_N / FOOT_FPS;
  const keys = [[0, 0], [T.intro, 0.8]];
  { const talk = EPISODES.reduce((s, e) => s + (e.say1 - e.say0), 0), span = 3.55; let s = 0.8;
    for (const ep of EPISODES) { keys.push([ep.say0, s]); s += (ep.say1 - ep.say0) / talk * span; keys.push([ep.freeze0, s], [ep.freeze1, s]); }
    keys.push([T.head0, s + 0.1], [T.head1, SRC_TOTAL - 0.02]); }
  function srcTime(t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, sa] = keys[i - 1], [b, sb] = keys[i]; return sa + (sb - sa) * (b > a ? (t - a) / (b - a) : 1); }
    return keys[keys.length - 1][1];
  }
  const footage = (t) => A[`f${clamp(Math.round(srcTime(t) * FOOT_FPS) + 1, 1, FOOT_N)}`];

  // ------------------------------------------------------------------------------------------------ helpers
  const fr = (t, t0, dur) => clamp((t - t0) / dur);
  /** How deep in a freeze we are at t: 0 moving, 1 frozen (in over 5 f, out over 6 f). */
  function freezeK(t) { for (const ep of EPISODES) { if (t >= ep.freeze0 - F(1) && t < ep.freeze1 + F(6)) return t < ep.freeze1 ? E.o3(fr(t, ep.freeze0 - F(1), F(5))) : 1 - E.io(fr(t, ep.freeze1, F(6))); } return 0; }
  /** White type over the footage: drawn twice with a deep soft shadow so it holds over steam and the lit wall. */
  function onFilm(s, x, y, f, color = "rgba(255,255,255,0.93)", align = "left", alpha = 1) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3;
    X0.text(ctx, s, x, y, f, color, align); X0.text(ctx, s, x, y, f, color, align); ctx.restore();
  }
  /** The caption of what he is saying: the script's words at the voice's times, written on one by one, top-anchored at
   *  y 1120, at most two lines, in pages (a page clears when the next begins). */
  const CAP = { size: 70, x: 80, y: 1120, pitch: 78, maxW: 1080 - 80 - 90 };
  const capFont = X0.font(700, CAP.size, "Caveat");
  function captionLayout(ep) {
    if (ep._cap) return ep._cap;
    ctx.save(); ctx.font = capFont;
    const out = ep.pages.map(([a, b]) => {
      const lines = [[]]; let w = 0;
      for (let i = a; i < b; i++) { const wd = VO[ep.key].words[i], ww = ctx.measureText(wd.text + " ").width; if (w + ww > CAP.maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; } lines[lines.length - 1].push({ ...wd, i, ww }); w += ww; }
      return { a, b, lines, t0: VO[ep.key].words[a].t0, t1: b < VO[ep.key].words.length ? VO[ep.key].words[b].t0 : Infinity };
    });
    ctx.restore(); return (ep._cap = out);
  }
  function caption(ep, t) {
    const te = t - ep.say0;
    for (const pg of captionLayout(ep)) {
      if (te < pg.t0 - 0.06) continue;
      const out = pg.t1 === Infinity ? 0 : E.io(fr(te, pg.t1 - 0.1, F(4))); if (out >= 1) continue;
      ctx.save(); ctx.globalAlpha *= 1 - out;
      pg.lines.forEach((ln, li) => {
        let x = CAP.x; const y = CAP.y + li * CAP.pitch;
        for (const wd of ln) {
          const k = fr(te, wd.t0 - 0.05, F(4));
          if (k > 0) { ctx.save(); ctx.beginPath(); ctx.rect(x - 8, y - CAP.size, (wd.ww + 16) * E.o3(k), CAP.size * 1.6); ctx.clip();
            ctx.translate(x, y + (X0.hash((wd.t0 * 1000) | 0) - 0.5) * 3); ctx.rotate((X0.hash((wd.t1 * 977) | 0) - 0.5) * 0.03); onFilm(wd.text, 0, 0, capFont); ctx.restore(); }
          x += wd.ww;
        }
      });
      ctx.restore();
    }
  }
  /** Three listening dots in the bot's colour above the caption, blooming one by one on each word. */
  function listenDots(ep, t) {
    const words = VO[ep.key].words; let said = 0; for (const wd of words) if (t >= ep.say0 + wd.t0) said++;
    const on = t >= ep.say0 - 0.4 && t < ep.say1 + 0.1; if (!on) return;
    const a = Math.min(fr(t, ep.say0 - 0.4, F(6)), 1 - fr(t, ep.say1 - F(3), F(5)));
    for (let i = 0; i < 3; i++) {
      const lit = said > 0 && (said - 1) % 3 === i, tw = said > 0 ? ep.say0 + words[said - 1].t0 : -1;
      const bloom = lit ? 1 - 0.35 * fr(t, tw, F(8)) : said > 0 ? 0.45 : 0.6 + 0.3 * Math.sin((t * 3 + i * 1.3)) * 0.5;
      const r = (12 + 7 * bloom) * (0.6 + 0.4 * a);
      ctx.save(); ctx.globalAlpha *= a * (0.55 + 0.45 * bloom); ctx.fillStyle = ep.color; ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(CAP.x + 16 + i * 44, 1040, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  /** The bot's paper card, taped on: it lands printed; the one brush underline in its colour is brushed in after. */
  function card(ep, t) {
    const k = fr(t, ep.freeze0, F(6)), out = t >= ep.freeze1 ? E.i2(fr(t, ep.freeze1, F(8))) : 0;
    if (k <= 0 || out >= 1) return;
    const w = 760, h = ep.h, x = 150 + ep.tx, y = 700, cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    ctx.translate(cx, cy + out * 14); ctx.rotate(ep.rot);
    const press = (1.14 - 0.14 * E.o5(k)) * (1 - 0.07 * out); ctx.scale(press, press); ctx.translate(-cx, -cy);
    ctx.globalAlpha *= Math.min(1, k * 2) * (1 - out);
    // the paper, its shadow (deeper here: the card sits over a dark room), the hairline
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, 26); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, 26); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, 26); ctx.stroke();
    // the bot: his head (the app's own avatar) and his name
    const hs = 84; ctx.drawImage(A[ep.head], x + 36, y + 30, hs, hs);
    X0.text(ctx, ep.name, x + 36 + hs + 20, y + 30 + hs * 0.68, X0.font(600, 38), ep.color);
    // what he did, already printed when the card lands
    let ly = y + 30 + hs + 64;
    if (ep.bubble) { const bf = X0.font(500, 42, "Bricolage"), bw = X0.width(ctx, ep.bubble, bf) + 56; ctx.fillStyle = C.ink; X0.rrect(ctx, x + w - 36 - bw, ly - 48, bw, 76, 38); ctx.fill(); X0.text(ctx, ep.bubble, x + w - 36 - bw + 28, ly + 2, bf, "#FFFFFF"); ly += 86; }
    for (const ln of ep.lines) {
      const f = X0.font(ln.weight, ln.size); X0.text(ctx, ln.text, x + 36, ly, f, ln.color ?? C.ink);
      if (ln.ulWord) {
        const i = ln.text.indexOf(ln.ulWord), pre = X0.width(ctx, ln.text.slice(0, i), f), ww = X0.width(ctx, ln.ulWord, f), im = A[ep.ul];
        const uw = ww * 1.1, uh = Math.max(18, uw * im.height / im.width * 1.1);
        X0.reveal(ctx, im, x + 36 + pre - (uw - ww) / 2, ly + ln.size * 0.18, uw, uh, E.o3(fr(t, ep.freeze0 + F(8), F(8))), "x", { rot: -0.012, rag: 8, seed: 4 });
      }
      ly += ln.size * 1.45;
    }
    if (ep.pill) {   // an outline tag, not a button: what the app offers next, and who presses pay
      const pw = 300, ph = 72, px = x + w - 36 - pw, py = y + h - 36 - ph;
      ctx.strokeStyle = "#111111"; ctx.lineWidth = 2.5; X0.rrect(ctx, px, py, pw, ph, ph / 2); ctx.stroke(); X0.text(ctx, ep.pill, px + pw / 2, py + ph / 2 + 14, X0.font(500, 38), "#111111", "center");
      X0.text(ctx, "You press pay", x + 36, py + ph / 2 + 14, X0.font(500, 42), "#333333");
    }
    // the tape across the top edge
    const tw = 230, th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx + ep.tapeDx, y + 2); ctx.rotate(ep.tapeRot); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore();
    ctx.restore();
  }
  /** The headline: white heavy Geist on the dark top band, one handwritten word with the icon's clay underline. */
  function headline(t) {
    if (t < T.head0 || t >= T.end0) return;
    const size = 120, x = 80, base = [400, 538], l1 = fr(t, T.head0, F(7)), l2 = fr(t, T.head0 + F(6), F(7)), lh = fr(t, T.head0 + F(10), F(7)), lu = fr(t, T.head0 + F(16), F(9));
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
    const line1 = X0.layout(ctx, [{ text: "Hands" }, { text: "full" }], { x, y: base[0], size, weight: 900, color: "#FFFFFF" });
    const line2 = X0.layout(ctx, [{ text: "Day" }, { text: "sorted", hand: true, handWeight: 700, scale: 1.15 }], { x, y: base[1], size, weight: 900, color: "#FFFFFF" });
    ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base[0] - size * 1.3, (line1.w + 40) * E.o3(l1), size * 1.7); ctx.clip(); X0.drawLine(ctx, line1); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(x - 20, base[1] - size * 1.3, (line2.w + 40) * E.o3(l2), size * 1.7); ctx.clip(); X0.drawLine(ctx, line2, (i, w) => (w.hand ? { a: 0 } : { a: 1 })); ctx.restore();
    const hw = line2.words[1];
    ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, base[1] - size * 1.3, (hw.w + 30) * E.o3(lh), size * 1.8); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore();
    ctx.restore();
    if (lu > 0) { const im = A["ul-bar"], uw = hw.w * 1.08, uh = Math.max(24, uw * im.height / im.width * 1.15); X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 12, hw.y + 14, uw, uh, E.o3(lu), "x", { rot: -0.012, rag: 10, seed: 2 }); }
  }
  /** The small painted mark, white, in the top right from the first second: the brand is on the frame before the end card. */
  function cornerMark(t) {
    const a = Math.min(fr(t, 0.6, 0.4), 1 - fr(t, T.end0 - 0.2, 0.3)); if (a <= 0) return;
    const im = X0.tint(A.mark, "#FFFFFF"), mh = 52, mw = mh * A.mark.width / A.mark.height;
    ctx.save(); ctx.globalAlpha *= 0.82 * a; ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10; ctx.drawImage(im, 1000 - mw, 296, mw, mh); ctx.restore();
  }
  /** The painted mark drawn in three strokes, with the 0 narrowed to a digit's proportions. */
  function paintMark(mx, my, mw, s1, s2, s3) {
    const mh = mw * A.mark.height / A.mark.width;
    // each stroke is the art's slice from SOURCE x s0 to x1, clipped after the squeeze (as adkit.js markPaint): clipping
    // before it let the X's right arm tip through the narrowed 0 as a thin sliver
    const region = (x0, x1, k, dir, squeeze = 1, s0 = x0) => {
      if (k <= 0) return; const cvs = X0.offscreen(mw, mh), c2 = cvs.getContext("2d");
      const cx = mw * (x0 + x1) / 2; c2.translate(cx, 0); c2.scale(squeeze, 1); c2.translate(-cx, 0);
      c2.beginPath(); c2.rect(mw * s0, 0, mw * (x1 - s0), mh); c2.clip(); c2.drawImage(A.mark, 0, 0, mw, mh);
      X0.reveal(ctx, cvs, mx, my, mw, mh, k, dir, { rag: 10, seed: 7 }); X0.release(cvs);
    };
    // the X ends at ~0.48 of the picture (its bars' end caps), the 0 begins at ~0.51: the X's region runs to 0.495 so no tip is cut, the 0 is cut from source 0.48 and squeezed about the middle of 0.52-1
    region(0, 0.495, E.o3(s1), "diag"); if (s2 > 0) region(0, 0.495, E.o3(s2), "-diag"); region(0.52, 1, s3, "conic", 0.74, 0.48);
    return mh;
  }
  /** The end: a white sheet slides up over the kitchen; the hero on his bar, the mark painting itself, the line, the stamp with the address first. */
  function endCard(t) {
    if (t < T.end0) return;
    const kin = E.o5(fr(t, T.end0, F(14))), dy = (1 - kin) * 1920;
    ctx.save(); ctx.translate(0, dy);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 60; ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920 + 40); ctx.restore();
    X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 });
    const te = t - T.end0;
    // the hero on the left axis with the type: his bar starts at x 80. Eyes shut as the sheet arrives, open once it has landed; a wink after the stillness.
    const open = E.o3(fr(te, F(18), F(4))), wink = te >= F(104) && te < F(118) ? (te < F(108) ? fr(te, F(104), F(4)) : te < F(114) ? 1 : 1 - fr(te, F(114), F(4))) : 0;
    const look = { dx: 0, dy: 4 * (1 - E.io(fr(te, F(40), F(10)))) };
    X0.hang(ctx, A, 8, 100, 816, null, { eyes: look, blink: 1 - open, lids: [wink, 0], bob: te < F(96) ? Math.sin(te * 2.2) * 3 * (1 - fr(te, F(84), F(12))) : 0, sway: -2.5 * wink });
    // the mark, painted in three strokes: X slash, X slash, the 0 round (narrowed: it is a zero, not an O)
    paintMark(80, 740, 460, fr(te, F(24), F(6)), fr(te, F(30), F(6)), E.io(fr(te, F(36), F(16))));
    // the line and the stamp: the address is what to keep, so it leads
    const kl = E.o3(fr(te, F(58), F(9))); if (kl > 0) { ctx.save(); ctx.beginPath(); ctx.rect(60, 1030, 1000 * kl, 100); ctx.clip(); X0.text(ctx, "Your team of bots", 80, 1095, X0.font(600, 60), C.ink); ctx.restore(); }
    const ks = fr(te, F(70), F(4)); if (ks > 0) { const sw = 560, sh = sw * A.stamp.height / A.stamp.width, sx = 80, sy = 1165 + (150 - sh) / 2;
      ctx.save(); ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(-0.045); const ps = 1.08 - 0.08 * E.o5(ks); ctx.scale(ps, ps); ctx.translate(-(sx + sw / 2), -(sy + sh / 2));
      ctx.drawImage(A.stamp, sx, sy, sw, sh);
      X0.text(ctx, "Coming soon", sx + 40, sy + sh * 0.4, X0.font(500, 38), "#555555");
      const uf = X0.font(700, 58), ux = sx + 40, uy = sy + sh * 0.8; X0.text(ctx, "x0bot.com", ux, uy, uf, "#111111");
      // a slash through the zero, so no one types an O
      const zx = ux + X0.width(ctx, "x", uf), zw = X0.width(ctx, "0", uf); ctx.strokeStyle = "#111111"; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(zx + zw * 0.72, uy - 58 * 0.66); ctx.lineTo(zx + zw * 0.28, uy - 58 * 0.06); ctx.stroke();
      ctx.restore(); }
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the frame
  window.__frame = (t) => {
    ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
    ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, 1080, 1920);
    if (t < T.end0 + F(14)) {
      // the footage: a slow push-in through the ad, a little more inside each freeze; cold and dim while frozen
      const fz = freezeK(t), zoom = 1 + 0.05 * (t / DURATION) + 0.03 * fz;
      ctx.save(); ctx.filter = `contrast(${1.06 + 0.06 * fz}) saturate(${0.92 - 0.45 * fz}) brightness(${0.98 - 0.2 * fz})`;
      X0.cover(ctx, footage(t), 0, 0, 1080, 1920, { zoom });
      ctx.restore();
      X0.vignette(ctx, 1080, 1920, 0.22 + 0.3 * fz);
      // the shutter: one pale frame as the film freezes
      for (const ep of EPISODES) if (t >= ep.freeze0 && t < ep.freeze0 + F(1)) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(0, 0, 1080, 1920); }
      // a soft scrim at the top under the headline, so white type sits on dark
      if (t >= T.head0 - 0.3) { const g = ctx.createLinearGradient(0, 0, 0, 760); const a = 0.4 * E.io(fr(t, T.head0 - 0.3, 0.5)); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 760); }
      // the opening: the hour, in his hand, at the caption's margin
      if (t > 0.2 && t < T.intro + 0.3) onFilm("6:42 pm", 80, 340, X0.font(700, 60, "Caveat"), "rgba(255,255,255,0.88)", "left", Math.min(fr(t, 0.2, 0.25), 1 - fr(t, T.intro - 0.1, 0.3)));
      cornerMark(t);
      // each episode: the listening dots and the handwritten caption while he speaks, gone by the time the card lands
      for (const ep of EPISODES) {
        if (t < ep.say0 - 0.45 || t >= ep.freeze0 + F(5)) continue;
        const fade = 1 - E.io(fr(t, ep.freeze0, F(5)));
        ctx.save(); ctx.globalAlpha *= fade; listenDots(ep, t); caption(ep, t); ctx.restore();
      }
      for (const ep of EPISODES) card(ep, t);
      headline(t);
    }
    endCard(t);
    X0.grain(ctx, 1080, 1920, t, t >= T.end0 + F(14) ? 0.03 : 0.07, 1);
    if (q.get("hud")) X0.text(ctx, `t ${t.toFixed(2)} f${Math.round(t * FPS)} src ${srcTime(t).toFixed(2)} fz ${freezeK(t).toFixed(2)}`, 16, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
  };

  // ------------------------------------------------------------------------------------------------ the sound
  window.__cues = () => {
    const c = [];
    c.push({ at: 0, kind: "fan", dur: T.end0 + 0.4, gain: 0.8 }, { at: 0.2, kind: "sizzle", dur: T.end0 + 0.2, gain: 1 }, { at: 0, kind: "drone", dur: T.end0 + 0.5, f: 55, gain: 0.35, a: 2, r: 1 });
    c.push({ at: 0.25, kind: "tick", gain: 0.25 });
    const NOTE = { plan: 369.99, travel: 440, keybot: 293.66 };
    for (const ep of EPISODES) {
      c.push({ at: ep.say0 - 0.3, kind: "listen", gain: 0.35 });
      c.push({ at: ep.say0, kind: "sample", file: `voice/${ep.key}.wav`, gain: 1 });
      c.push({ at: ep.freeze0, kind: "freeze", gain: 0.7 }, { at: ep.freeze0 + F(5), kind: "land", gain: 0.5 }, { at: ep.freeze0 + F(5), kind: "paper-thud", gain: 0.6 });
      c.push({ at: ep.freeze0 + F(8), kind: "bell", f: NOTE[ep.key], dur: 1.2, gain: 0.4 }, { at: ep.freeze0 + F(8), kind: "whoosh", dur: 0.25, up: false, gain: 0.25 });
      if (ep.key === "keybot") c.push({ at: ep.freeze0 + F(6), kind: "send", gain: 0.5 });
      c.push({ at: ep.freeze1, kind: "whoosh", dur: 0.28, up: true, gain: 0.35 });
    }
    c.push({ at: T.head0, kind: "tick", gain: 0.3 }, { at: T.head0 + F(6), kind: "tick", gain: 0.3 }, { at: T.head0 + F(10), kind: "write", gain: 0.4 }, { at: T.head0 + F(16), kind: "whoosh", dur: 0.25, up: false, gain: 0.3 });
    c.push({ at: T.end0, kind: "open", gain: 0.6 }, { at: T.end0 + F(14), kind: "land", gain: 0.5 }, { at: T.end0 + F(18), kind: "listen", gain: 0.3 });
    c.push({ at: T.end0 + F(24), kind: "write", gain: 0.35 }, { at: T.end0 + F(30), kind: "land", gain: 0.35 }, { at: T.end0 + F(36), kind: "whoosh", dur: 0.5, up: true, gain: 0.3 });
    c.push({ at: T.end0 + F(52), kind: "boom", gain: 0.7 }, { at: T.end0 + F(52), kind: "chord", f: 146.83, dur: 3, gain: 0.5 });
    for (const [f, g] of [[293.66, 0.22], [369.99, 0.22], [440, 0.22], [493.88, 0.22], [587.33, 0.25]]) c.push({ at: T.end0 + F(52), kind: "bell", f, dur: 2.4, gain: g });
    c.push({ at: T.end0 + F(58), kind: "write", gain: 0.3 }, { at: T.end0 + F(70), kind: "land", gain: 0.4 }, { at: T.end0 + F(70), kind: "click", gain: 0.3 }, { at: T.end0 + F(104), kind: "bell", f: 587.33, dur: 0.5, gain: 0.3 });
    return c;
  };
  window.__ready = true;
})().catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
