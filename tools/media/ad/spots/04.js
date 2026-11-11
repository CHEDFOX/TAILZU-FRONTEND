/* KHAANA KHAYA? Spot 04 of the campaign (Keybot; The Humanist). 9:16, 24.4 s (the bible's 24 s plus the end card's
 * extra 0.4 s).
 *
 *   0.0-13.0   Jaipur, 9:47 pm. A pair of hands holds a phone by a window (Coverr stock, slowed to about half speed and
 *              motion-interpolated). She speaks, Hinglish as spoken, "woh" and all; her words write on in white Caveat
 *              on the voice's word times, in a three-line window that scrolls up as she goes. She stops: a clay bell,
 *              the hero's gloves come over the top edge of the film and he lowers in. The whole sentence re-flows; his
 *              glove flicks "Woh..." off it like a sticker and it tumbles out of the frame; the words slide together;
 *              Keybot's punctuation stamps in (comma, question mark, full stop) with ink thuds; a clay brush line under
 *              "Bunty" (the name kept); the handwriting snaps to settled white Geist type with a small paper "ready"
 *              tick. He nods. Nothing is sent on screen.
 *   13.0-15.4  HARD CUT. Bengaluru, 9:48 pm: our cook (clip 1), back to camera, steam under the hood light. A white
 *              paper card slides straight up from the bottom (no freeze, no tape): Keybot's head and name, the
 *              settled message in ink. The steam keeps rising.
 *   15.4-19.5  The card rises and widens into the whole page (Keybot's head and name stay top-left, at 0.12h: the page is
 *              his card); the headline types on ("Maa ne bola" / "Keybot ne likha", "bola" by hand with Keybot's clay
 *              underline) and two small ink lines above it.
 *   19.5-24.4  The campaign end card (AD.endCard): the hero winks.
 *
 * Grammar: what she SAYS is Caveat on her word times with a pen scratch per word; what Keybot DID is Geist (the
 * stamped marks, the snap, the card, the headline's type), typed with a tick per letter. One grade on both clips
 * (contrast up, saturation down a third, warm, grain, vignette). Everything is a pure function of t.
 *
 * Sound: a ceiling fan and the room (04-sfx/ceiling.wav) and a far cooker whistle, her voice (en-IN Neerja, -10%),
 * pen scratches; the clay bell (Keybot's D) at 11.0 and 17.6, a peel, three ink thuds, a brush dab, a paper tap; the
 * hood's hum from the cut's first sample; a warm drone in F from 15.4; the end card's cues moved into F.
 * 04-sfx/make.mjs makes the sound files sound.mjs has no kind for.
 *
 * Measured against the system: the headline's widest line is fitted to 0.88w (110 px, cap 0.072w, 869 px wide); her
 * re-flowed lines end by 914 px; the band behind "Jaipur · 9:47 pm" is 58-64% grey, so it sits on a 40%+ ink gradient;
 * her words' band is 31-33% grey (a light floor anyway); Bengaluru's top band is black. Small lines are 44 px (the
 * readable floor at 1080), card text 49 px (0.045w). The card is sized to its longest line plus 0.04w a side (673 px)
 * and the settled message runs five phrase lines (three would not fit at these sizes).
 *
 * Render: PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs out --page spots/04.html --ratio 9x16
 *         ?subs=1 adds the optional English viewer subtitle in Bengaluru (off by default: India placements);
 *         ?probe=1 draws the graded footage alone (to measure the bands behind white type); ?hud=1 the clocks.
 */
(() => {
  "use strict";
  const { C, E, clamp } = X0;
  const { F, fr, lerp } = AD;
  const W = 1080, H = 1920;
  const KEY = AD.BOT.keybot;                       // clay #A9573A, its head, its brush underline, its bell (D4)
  const q = new URLSearchParams(location.search);
  const SUBS = q.get("subs") === "1";

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = {
    stamp: 0.3,                // "Jaipur · 9:47 pm" types in
    vo: 0.5,                   // her voice note (the first word lands at 0.6, the last ends at 10.94)
    bell: 11.0,                // she stops; the clay bell; his gloves over the top edge
    flick: 11.4,               // the glove flicks "Woh..."
    slide: 11.5,               // the words slide together
    stamps: [11.8, 12.0, 12.2],
    ul: 12.4,                  // the clay line under "Bunty"
    snap: 12.8,                // handwriting -> settled type; the "ready" tick
    cut: 13.0,                 // HARD CUT to Bengaluru
    cityB: 13.12,              // "Bengaluru · 9:48 pm" types in
    card: 13.6,                // the card slides up (10 frames)
    grow: 15.4,                // the card becomes the page (12 frames)
    head: 16.0,                // the headline types on (16.0-17.0)
    ulH: 17.2,                 // its underline (17.2-17.6)
    bell2: 17.6,
    small: 17.35,              // the two small lines above it
    end: 19.5,                 // the end card
  };
  const DURATION = +(T.end + AD.END_S).toFixed(2);

  // ------------------------------------------------------------------------------------------------ her words
  // The voice note as she says it (fillers, her ellipses, her own question mark and breath comma; no full stops: she
  // runs on). `stamp` is the mark Keybot adds, `peel` the filler it lifts off, `keep` the name it keeps.
  const TOK = [
    { w: "Beta", tail: "...", stamp: ",", at: T.stamps[0] }, { w: "khaana" }, { w: "khaya", tail: "?" },
    { w: "Woh", tail: "...", peel: true }, { w: "Papa" }, { w: "bol" }, { w: "rahe" }, { w: "the", tail: "," },
    { w: "Sunday" }, { w: "aa" }, { w: "rahe" }, { w: "ho" }, { w: "na", stamp: "?", at: T.stamps[1] },
    { w: "Bunty", keep: true }, { w: "ka" }, { w: "phone" }, { w: "aaya" }, { w: "tha", stamp: ".", at: T.stamps[2] },
    { w: "kha" }, { w: "lena" },
  ];
  const WOH = 3, BUNTY = 13;
  const SCRIPT = TOK.map((k) => k.w + (k.tail || "")).join(" ");
  const SPEECH_LINES = [0, 3, 8, 13, 18];          // where her pauses fall: each thought starts a line
  // the settled message, as Keybot hands it back (the white type at 12.8, the card, the same five lines)
  const SETTLED = ["Beta, khaana khaya?", "Papa bol rahe the,", "Sunday aa rahe ho na?", "Bunty ka phone aaya tha.", "Kha lena."];

  // ------------------------------------------------------------------------------------------------ type
  const CAV = (s) => X0.font(700, s, "Caveat");
  const GEO = (w, s) => X0.font(w, s);
  const SAY = 70;                                   // her handwriting, 0.065w
  const FLOW = 65;                                  // the re-flowed sentence for the hero's beat, 0.06w
  const SET = 59;                                   // the settled white type, 0.055w
  const SMALL = 44;                                 // small lines (0.041w: the readable floor at 1080)
  const LEFT = 80, RIGHT = 950;                     // type sits right of 0.074w and left of 0.88w
  const SAY_Y = 1135, SAY_P = 100;                  // the three-line window, 0.56h-0.74h
  const FLOW_Y = [1135, 1227, 1319];
  const SET_Y = [1110, 1182, 1254, 1326, 1398];
  const WHITE = "rgba(255,255,255,0.94)";

  // ------------------------------------------------------------------------------------------------ the footage clocks
  // the hands: footage-04-a holds source 3.2-9.0 s of the Coverr clip (72 fps, interpolated). About 0.48x through
  // her voice note, then almost still while the hero works (she has stopped).
  const handsSrc = AD.map([[0, 0.05], [T.bell, 5.35], [T.cut, 5.55]]);
  // the cook: clip 1 at real speed from its 1.0 s (he is in frame, working), until the page covers him.
  const cookSrc = (t) => 1.0 + clamp(t - T.cut, 0, 3.0);

  // ------------------------------------------------------------------------------------------------ layouts (made once the fonts are in)
  let L = null;
  function layouts(S) {
    const { ctx } = S, mw = (s, f) => X0.width(ctx, s, f);
    const out = {};
    // her lines while she speaks: each spoken line laid from the left margin
    const fS = CAV(SAY), spS = mw(" ", fS);
    out.say = TOK.map(() => ({}));
    for (let li = 0; li < SPEECH_LINES.length; li++) {
      const a = SPEECH_LINES[li], b = SPEECH_LINES[li + 1] ?? TOK.length; let x = LEFT;
      for (let i = a; i < b; i++) { const k = TOK[i]; out.say[i] = { x, line: li, wb: mw(k.w, fS), wt: k.tail ? mw(k.tail, fS) : 0 }; x += out.say[i].wb + out.say[i].wt + spS; }
    }
    // the re-flowed sentence: five states (all words; Woh gone; then each stamp in) at 65 px. The first is wrapped to
    // the measure; the others keep its lines and only close up or open within them, so no word jumps a line.
    const fF = CAV(FLOW), spF = mw(" ", fF), fStamp = GEO(800, FLOW * 0.92);
    let lines = null;
    const flow = (omit, tailGone, stamped) => {
      const pos = []; let x = LEFT, line = 0;
      TOK.forEach((k, i) => {
        if (omit.includes(i)) { pos.push(null); return; }
        const wb = mw(k.w, fF), wt = k.tail && !tailGone.includes(i) ? mw(k.tail, fF) : 0, ws = k.stamp && stamped.includes(i) ? mw(k.stamp, fStamp) + 2 : 0, w = wb + wt + ws;
        if (lines ? lines[i] !== line : x + w > RIGHT - 48 && x > LEFT) { line = lines ? lines[i] : line + 1; x = LEFT; }
        pos.push({ x, y: FLOW_Y[Math.min(line, 2)], line, wb, wt, ws, right: x + w }); x += w + spF;
      });
      return pos;
    };
    const flow0 = flow([], [], []); lines = flow0.map((p) => p.line);
    out.flow = [flow0, flow([WOH], [], []), flow([WOH], [0], [0]), flow([WOH], [0], [0, 12]), flow([WOH], [0], [0, 12, 17])];
    out.flowLines = Math.max(...lines) + 1;
    out.flowRight = Math.max(...out.flow.flat().filter(Boolean).map((p) => p.right));
    // the settled type and the "ready" tick
    const fSet = GEO(600, SET);
    out.set = SETTLED.map((s, i) => ({ s, y: SET_Y[i], w: mw(s, fSet) }));
    out.buntySet = { x: LEFT, y: SET_Y[3], w: mw("Bunty", fSet) };
    out.setW = Math.max(...out.set.map((r) => r.w));
    // the card: sized to its longest line plus 0.04w a side
    const fCard = GEO(600, 49), fName = GEO(600, SMALL), pad = Math.round(0.04 * W), hs = 84;
    const lw = SETTLED.map((s) => mw(s, fCard)), head = hs + 20 + mw(KEY.name, fName);
    const cw = Math.round(Math.max(...lw, head) + 2 * pad), first = pad + hs + 74, pitch = 70, ch = Math.round(first + pitch * (SETTLED.length - 1) + 22 + pad);
    out.card = { w: cw, h: ch, x: Math.round((W - cw) / 2), y: Math.round(960 - ch / 2), pad, hs, first, pitch, bunty: mw("Bunty", fCard) };
    // the headline: heavy Geist, the named exception (15 characters at 0.075w cap height), fitted to 0.88w
    const capRatio = (() => { ctx.save(); ctx.font = GEO(900, 100); const m = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore(); return m; })();
    let size = Math.floor(0.075 * W / capRatio);
    const measure = (sz) => {
      const l1 = X0.layout(ctx, [{ text: "Maa" }, { text: "ne" }, { text: "bola", hand: true, handWeight: 700, scale: 1.3 }], { x: LEFT, y: 0, size: sz, weight: 900, color: C.ink });
      const l2 = X0.layout(ctx, [{ text: "Keybot" }, { text: "ne" }, { text: "likha" }], { x: LEFT, y: 0, size: sz, weight: 900, color: C.ink });
      return Math.max(l1.w, l2.w);
    };
    while (LEFT + measure(size) > RIGHT) size -= 1;
    out.hl = { size, cap: size * capRatio / W, w: measure(size), capRatio };
    // the small lines above the headline
    out.small = ["Speak in any app. Keybot writes. You send.", "Hindi, Hinglish and 50+ languages."].map((s) => ({ s, w: mw(s, GEO(400, SMALL)) }));
    out.city = { a: mw("Jaipur · 9:47 pm", GEO(500, SMALL)), b: mw("Bengaluru · 9:48 pm", GEO(500, SMALL)) };
    return out;
  }

  // ------------------------------------------------------------------------------------------------ helpers
  // contrast up, saturation -30%, warm (a multiply in lamp light), a soft vignette; grain is laid over the whole frame
  const GRADE = { f: "contrast(1.28) saturate(0.7) brightness(0.9)", warm: "rgb(255,220,178)", vig: 0.36 };
  /** The one grade, on both clips: contrast up, a third less colour, warm (a multiply in lamp light), the vignette. */
  function shoot(S, img, zoom) {
    const { ctx } = S, g = GRADE;
    AD.film(S, img, { zoom, grade: g.f, vig: g.vig });
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = g.warm; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  /** An ink gradient rising from the bottom: clear at y0, `a` at y1 and below. */
  function floor(S, y0, y1, a) {
    const { ctx } = S, g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "rgba(10,8,6,0)"); g.addColorStop(1, `rgba(10,8,6,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0); ctx.fillStyle = `rgba(10,8,6,${a})`; ctx.fillRect(0, y1, W, H - y1);
  }
  /** Settled small type on film, typed a letter at a time (a tick each): white Geist with the deep shadow. */
  function typedOnFilm(S, s, x, y, t0, per, t, alpha = 1) {
    const n = Math.floor((t - t0) / per) + 1; if (n <= 0 || alpha <= 0) return;
    AD.onFilm(S, s.slice(0, Math.min(n, s.length)), x, y, GEO(500, SMALL), WHITE, "left", alpha);
  }
  const ticksFor = (s, t0, per, gain) => [...s].map((ch, i) => (ch === " " ? null : { at: +(t0 + i * per).toFixed(3), kind: "tick", gain })).filter(Boolean);

  // ------------------------------------------------------------------------------------------------ her words on screen
  /** Lines scrolled away by t: the top line slides up and fades when a fourth begins (6 frames, ease-out). */
  function scroll(S, t) {
    let s = 0; for (let li = 3; li < SPEECH_LINES.length; li++) { const ts = T.vo + S.V.maa.words[SPEECH_LINES[li]].t0 - F(5); s += E.o3(fr(t, ts, F(6))); }
    return s;
  }
  /** Where token i is at t (x, baseline y, size, alpha), through the speech window and the five flow states. */
  function tokPos(S, i, t) {
    const sayAt = (tt) => { const p = L.say[i], row = p.line - scroll(S, tt); return { x: p.x, y: SAY_Y + row * SAY_P, size: SAY, a: clamp(1 + row) }; };
    if (t < T.bell) return sayAt(t);
    const P = [sayAt(T.bell), ...L.flow.map((f) => (f[i] ? { x: f[i].x, y: f[i].y, size: FLOW, a: 1 } : null))];
    if (P[0].a < 0.5 && P[1]) P[0] = { ...P[1], y: P[1].y - 26, a: 0 };   // words scrolled away come back in place, not across the others
    const SEG = [[T.bell, F(8), 0, 1, E.io], [T.slide, F(8), 1, 2, E.io], [T.stamps[0], F(3), 2, 3, E.o3], [T.stamps[1], F(3), 3, 4, E.o3], [T.stamps[2], F(3), 4, 5, E.o3]];
    let cur = P[0];
    for (const [t0, d, a, b, ease] of SEG) {
      if (t < t0) break;
      const from = P[a] ?? cur, to = P[b]; if (!to) { cur = from; continue; }
      const k = ease(fr(t, t0, d)); cur = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), size: lerp(from.size, to.size, k), a: lerp(from.a, to.a, k) };
    }
    return cur;
  }
  /** Her handwriting: each word writes on over its own spoken length (a nib's pace), from her word times. */
  function words(S, t) {
    const { ctx } = S, V = S.V.maa;
    if (t >= T.snap) return;
    TOK.forEach((k, i) => {
      if (k.peel && t >= T.flick) return;           // lifted off: drawn by peel()
      const wd = V.words[i], tw = T.vo + wd.t0; if (t < tw - 0.04) return;
      const p = tokPos(S, i, t); if (p.a <= 0.004) return;
      const f = CAV(p.size), wb = X0.width(ctx, k.w, f), wt = k.tail ? X0.width(ctx, k.tail, f) : 0;
      const dur = clamp(wd.t1 - wd.t0, F(4), F(10)), kw = E.o2(fr(t, tw - 0.04, dur));
      const jy = (X0.hash(i * 131 + 7) - 0.5) * 4, rot = (X0.hash(i * 977 + 3) - 0.5) * 0.03;
      ctx.save(); ctx.globalAlpha *= p.a;
      ctx.beginPath(); ctx.rect(p.x - 10, p.y - p.size * 1.1, (wb + wt + 24) * kw, p.size * 1.7); ctx.clip();
      ctx.translate(p.x, p.y + jy); ctx.rotate(rot);
      AD.onFilm(S, k.w, 0, 0, f, WHITE);
      if (k.tail) { const ta = k.stamp ? 1 - fr(t, k.at, F(2)) : 1; if (ta > 0) AD.onFilm(S, k.tail, wb, 0, f, WHITE, "left", ta); }
      ctx.restore();
      // Keybot's mark, stamped in (Geist: the bot's, not hers), slammed 1.3 -> 1 over 3 frames
      if (k.stamp && t >= k.at) {
        const ks = fr(t, k.at, F(3)), sc = 1.3 - 0.3 * E.o3(ks), fs = GEO(800, p.size * 0.92);
        ctx.save(); ctx.translate(p.x + wb + 2, p.y + jy); ctx.scale(sc, sc);
        AD.onFilm(S, k.stamp, 0, 0, fs, WHITE); ctx.restore();
      }
      // the name kept: Keybot's clay brush line under "Bunty"
      if (k.keep && t >= T.ul) {
        const im = S.A[KEY.ul], uw = wb * 1.12, uh = Math.max(20, uw * im.height / im.width * 1.25);
        X0.reveal(ctx, im, p.x - (uw - wb) / 2, p.y + p.size * 0.16, uw, uh, E.o3(fr(t, T.ul, F(9))), "x", { rot: -0.012, rag: 8, seed: 5 });
      }
    });
  }
  /** "Woh..." peeled off by the glove: its far end lifts, then it tumbles out of the bottom of the frame. */
  function peel(S, t) {
    if (t < T.flick || t > T.flick + 0.9) return;
    // flicked up off the line (4 frames, its far end lifting first), then it falls with gravity, drifting and turning
    const { ctx } = S, p = L.flow[0][WOH], f = CAV(FLOW);
    const pop = E.o3(fr(t, T.flick, F(4))), dt = Math.max(0, t - (T.flick + F(4))), apex = p.y - 120;
    const g = 2 * (H + 160 - apex) / (0.5 * 0.5);
    const x = p.x + 46 * pop + 170 * dt, y = p.y - 120 * pop + 0.5 * g * dt * dt, rot = -0.38 * pop + 4.4 * dt, sc = 1 + 0.12 * pop;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
    ctx.shadowColor = "rgba(0,0,0,0.75)"; ctx.shadowBlur = 18 + 18 * pop; ctx.shadowOffsetY = 3 + 16 * pop;
    X0.text(ctx, "Woh...", 0, 0, f, WHITE); X0.text(ctx, "Woh...", 0, 0, f, WHITE);
    ctx.restore();
  }
  /** The settled message: white Geist in one frame, five lines, the clay line kept under "Bunty", the "ready" tick. */
  function settled(S, t) {
    if (t < T.snap || t >= T.cut) return;
    const { ctx, A } = S, f = GEO(600, SET);
    for (const r of L.set) AD.onFilm(S, r.s, LEFT, r.y, f, WHITE);
    const b = L.buntySet, im = A[KEY.ul], uw = b.w * 1.12, uh = Math.max(20, uw * im.height / im.width * 1.25);
    X0.reveal(ctx, im, b.x - (uw - b.w) / 2, b.y + SET * 0.16, uw, uh, 1, "x", { rot: -0.012, rag: 8, seed: 5 });
    // the tick: a small paper scrap with an ink tick and "ready", pressed on beside the last line
    const k = fr(t, T.snap, F(4)), sw = 250, sh = sw * A["scrap-tiny"].height / A["scrap-tiny"].width;
    const last = L.set[L.set.length - 1], sx = LEFT + last.w + 40, sy = last.y - sh * 0.72, sc = 1.15 - 0.15 * E.o5(k);
    ctx.save(); ctx.globalAlpha *= Math.min(1, k * 3); ctx.translate(sx + sw / 2, sy + sh / 2); ctx.rotate(-0.035); ctx.scale(sc, sc); ctx.translate(-sw / 2, -sh / 2);
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6; ctx.drawImage(A["scrap-tiny"], 0, 0, sw, sh); ctx.shadowColor = "transparent";
    const tk = X0.tint(A["ink-tick"], C.ink), th = 46, tw = th * A["ink-tick"].width / A["ink-tick"].height;
    ctx.drawImage(tk, 30, sh / 2 - th / 2 - 2, tw, th);
    X0.text(ctx, "ready", 30 + tw + 14, sh / 2 + 15, GEO(500, SMALL), C.ink);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the hero
  const HS = 760, HSC = HS / X0.hang.ART, HX = 600 - X0.hang.MID * HSC, HY = -X0.hang.BAR_TOP * HSC;
  const GLOVE0 = { x: HX + X0.hang.GLOVES[0].cx * HSC, y: HY + X0.hang.GLOVE_CY * HSC };
  /** A smoothed walk through [t, value] keys (each change eased over `d`). */
  function keyed(keys, t, d = F(5)) { let v = keys[0][1]; for (let i = 1; i < keys.length; i++) { const [tk, vk] = keys[i]; if (t < tk) break; v = lerp(v, vk, E.io(fr(t, tk, d))); } return v; }
  function hero(S, t) {
    if (t < T.bell || t >= T.cut) return;
    const { ctx, A } = S;
    const grip = E.o3(fr(t, T.bell, F(3))), drop = fr(t, T.bell + F(1), F(10));
    // where he looks: at the sentence, at the falling filler, at each mark as it lands, at the name, then at you
    const at = (i, s = 0) => { const p = L.flow[s][i]; return p ? [p.x + p.wb / 2, p.y] : [540, 1200]; };
    const look = (xy) => [clamp((xy[0] - 600) / 38, -14, 14), clamp((xy[1] - 280) / 80, 3, 14)];
    const LK = [[T.bell, [-2, 4]], [T.bell + F(6), look(at(WOH, 0))], [T.flick + F(3), [2, 14]], [T.stamps[0] - F(3), look(at(0, 2))], [T.stamps[1] - F(3), look(at(12, 3))], [T.stamps[2] - F(3), look(at(17, 4))], [T.ul - F(2), look(at(BUNTY, 4))], [T.snap - F(2), [0, 2]]];
    const ex = keyed(LK.map(([tk, v]) => [tk, v[0]]), t), ey = keyed(LK.map(([tk, v]) => [tk, v[1]]), t);
    const blink = Math.max(t > T.ul + 0.12 && t < T.ul + 0.12 + F(4) ? E.bump(fr(t, T.ul + 0.12, F(4))) : 0, 1 - E.o3(fr(t, T.bell + F(6), F(3))));
    const nod = 16 * E.bump(fr(t, T.snap - F(1), F(7)));
    // glove 0 (his left, our left) goes for "Woh...": down to its far end, flicks it up off the line (the sticker's
    // corner lifting with it, the same 4 frames as peel()), lets go, and goes back to the edge
    const wohP = L.flow[0][WOH], tgt = { x: wohP.x + (wohP.wb + wohP.wt) * 0.74, y: wohP.y - 66 };
    const go = E.o3(fr(t, T.flick - F(5), F(5))), pop = E.o3(fr(t, T.flick, F(4))), back = E.io(fr(t, T.flick + F(5), F(9)));
    const away = go * (1 - back), gx = tgt.x + 46 * pop, gy = tgt.y - 120 * pop;
    const r0 = { dx: (gx - GLOVE0.x) / HSC * away, dy: (gy - GLOVE0.y) / HSC * away - (1 - grip) * 70, rot: (-18 + 34 * pop) * away, grip: 0.16 * pop * (1 - back) };
    const r1 = { dy: -(1 - grip) * 70 };
    X0.hang(ctx, A, HX, HY, HS, null, { show: { bar: false }, drop, eyes: { dx: ex, dy: ey }, blink, bob: nod, reach: [r0, r1] });
  }

  // ------------------------------------------------------------------------------------------------ Bengaluru: the card
  function drawCardBody(S, x, y, w, h, r, contentA) {
    const { ctx, A } = S, c = L.card;
    ctx.save(); ctx.shadowColor = `rgba(0,0,0,${0.55 * contentA})`; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, r); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    if (contentA <= 0) return;
    ctx.save(); ctx.globalAlpha *= contentA;
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
    const f = GEO(600, 49);
    SETTLED.forEach((s, i) => X0.text(ctx, s, x + c.pad, y + c.first + i * c.pitch, f, C.ink));
    const im = A[KEY.ul], uw = c.bunty * 1.1, uh = Math.max(18, uw * im.height / im.width * 1.15), by = y + c.first + 3 * c.pitch;
    X0.reveal(ctx, im, x + c.pad - (uw - c.bunty) / 2, by + 49 * 0.18, uw, uh, 1, "x", { rot: -0.012, rag: 8, seed: 4 });
    ctx.restore();
  }
  /** Keybot's dotted head and name: top-left on the card, and kept top-left (at 0.12h) when the card becomes the page. */
  function keyHead(S, k, cardY) {
    const { ctx, A } = S, c = L.card, e = k, hs = lerp(c.hs, 100, e), x = lerp(c.x + c.pad, LEFT, e), y = lerp(cardY + c.pad, 236, e);
    ctx.drawImage(A[KEY.head], x, y, hs, hs);
    X0.text(ctx, KEY.name, x + hs + lerp(20, 24, e), y + hs * 0.68, GEO(600, lerp(SMALL, 50, e)), KEY.color);
  }
  function card(S, t) {
    if (t < T.card) return;
    const c = L.card, ks = E.o3(fr(t, T.card, F(10))), y0 = c.y + (1 - ks) * (H - c.y + 60);
    const kg = E.io(fr(t, T.grow, F(12)));
    const x = lerp(c.x, 0, kg), y = lerp(y0, 0, kg), w = lerp(c.w, W, kg), h = lerp(c.h, H, kg), r = lerp(26, 0, kg);
    drawCardBody(S, x, y, w, h, r, 1 - fr(t, T.grow, F(5)));
    if (t < T.grow + F(12)) keyHead(S, kg, y0);
  }

  // ------------------------------------------------------------------------------------------------ the page: the headline
  function page(S, t) {
    const { ctx, A } = S;
    if (t < T.grow + F(12)) return;
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H); X0.cover(ctx, A.paper, 0, 0, W, H, { alpha: 0.8 });
    keyHead(S, 1, L.card.y);
    const size = L.hl.size, base = [1344 - Math.round(size * 1.3), 1344];
    const l1 = X0.layout(ctx, [{ text: "Maa" }, { text: "ne" }, { text: "bola", hand: true, handWeight: 700, scale: 1.3 }], { x: LEFT, y: base[0], size, weight: 900, color: C.ink });
    const l2 = X0.layout(ctx, [{ text: "Keybot" }, { text: "ne" }, { text: "likha" }], { x: LEFT, y: base[1], size, weight: 900, color: C.ink });
    // typed a letter at a time (a tick each); "bola" written by hand
    const typeWords = (line, t0, per) => { let n = 0; for (const w of line.words) { if (w.hand) continue; for (let c = 1; c <= w.text.length; c++, n++) { const a = fr(t, t0 + n * per, F(2)); if (a <= 0) return; const prev = X0.width(ctx, w.text.slice(0, c - 1), w.font); X0.text(ctx, w.text[c - 1], w.x + prev, w.y, w.font, w.color, "left", { alpha: a }); } } };
    typeWords(l1, T.head, 0.04);
    typeWords(l2, T.head + 0.6, 0.028);
    const hw = l1.words[2], kh = E.io(fr(t, T.head + 0.25, 0.35));
    if (kh > 0) { ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 10, hw.y - size * 1.3, (hw.w + 30) * kh, size * 1.9); ctx.clip(); X0.drawLine(ctx, { words: [hw] }); ctx.restore(); }
    const ku = E.o3(fr(t, T.ulH, 0.4));
    if (ku > 0) { const im = A[KEY.ul], uw = hw.w * 1.12, uh = Math.max(26, uw * im.height / im.width * 1.2); X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 6, hw.y + size * 0.08, uw, uh, ku, "x", { rot: -0.014, rag: 10, seed: 2 }); }
    // the two small lines above it (claims: ink), typed
    L.small.forEach((r, i) => { const t0 = T.small + i * 0.15, n = Math.floor((t - t0) / 0.02) + 1; if (n > 0) X0.text(ctx, r.s.slice(0, Math.min(n, r.s.length)), LEFT, 1010 + i * 58, GEO(400, SMALL), C.ink); });
  }

  // ------------------------------------------------------------------------------------------------ the frame
  AD.start({
    footage: { hands: { dir: "../footage-04-a/", frames: 417, fps: 72 }, cook: { dir: "../footage/", frames: 358, fps: 72 } },
    voices: { maa: "../voice/04-1.json" }, scripts: { maa: SCRIPT },
    duration: DURATION,
    timeline(S) { L = layouts(S); if (S.V.maa.words.length !== TOK.length) console.warn(`voice 04-1: ${S.V.maa.words.length} words, ${TOK.length} tokens`); return { ...T, L }; },
    frame(t, S) {
      const { ctx } = S;
      if (S.q.get("probe")) {   // the graded footage alone, to measure the bands behind the white type
        shoot(S, t < T.cut ? S.foot("hands", handsSrc(t)) : S.foot("cook", cookSrc(t)), t < T.cut ? 1 + 0.05 * t / T.cut : 1.03); return;
      }
      if (t < T.cut) {
        // JAIPUR: the hands, the room, her words
        shoot(S, S.foot("hands", handsSrc(t)), 1 + 0.05 * t / T.cut);
        // the window behind her is bright day-blur (58-64% grey at 0.12h, measured): a 40%+ ink gradient under the place
        // and hour, which also takes the window down towards evening; thinner once they go, so the hero reads on it
        AD.scrim(S, 0, 860, lerp(0.58, 0.42, fr(t, 4.4, 0.8)));
        floor(S, 980, 1480, 0.3);                                              // her words' band is 31-33% grey (90th pct 56%): a light floor
        typedOnFilm(S, "Jaipur · 9:47 pm", LEFT, 268, T.stamp, 0.04, t, 1 - fr(t, 4.4, 0.5));
        words(S, t); settled(S, t); hero(S, t); peel(S, t);
      } else if (t < T.grow + F(12)) {
        // BENGALURU: the cook, the steam, the card
        shoot(S, S.foot("cook", cookSrc(t)), 1.03);
        typedOnFilm(S, "Bengaluru · 9:48 pm", LEFT, 268, T.cityB, 0.03, t, 1 - fr(t, T.grow, F(4)));
        if (SUBS) ["Did you eat, beta? Papa asks, are you", "coming Sunday? Bunty called. Eat."].forEach((s, i) => AD.onFilm(S, s, LEFT, 1440 + i * 57, GEO(400, SMALL), WHITE, "left", Math.min(fr(t, T.card + F(10), F(6)), 1 - fr(t, T.grow, F(4)))));
        card(S, t);
      }
      page(S, t);
      AD.endCard(S, t, T.end);
      X0.grain(ctx, W, H, t, t < T.grow + F(12) ? 0.075 : 0.03, 1);
      if (S.q.get("hud")) X0.text(ctx, `src ${t < T.cut ? "hands " + handsSrc(t).toFixed(2) : "cook " + cookSrc(t).toFixed(2)}  hl ${L.hl.size}px cap ${L.hl.cap.toFixed(4)}w w${L.hl.w.toFixed(0)}  card ${L.card.w}x${L.card.h} flowR ${L.flowRight.toFixed(0)}`, 16, 1866, X0.font(500, 22, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const V = S.V.maa, c = [];
      // Jaipur: the room, a far cooker whistle, the hour typed, her voice, a pen scratch per word
      c.push({ at: 0, kind: "sample", file: "04-sfx/ceiling.wav", gain: 0.72 }, { at: 0.05, kind: "sample", file: "04-sfx/whistle.wav", gain: 0.2 });
      c.push(...ticksFor("Jaipur · 9:47 pm", T.stamp, 0.04, 0.28));
      c.push({ at: T.vo, kind: "sample", file: "../voice/04-1.wav", gain: 1.35 });
      V.words.forEach((w, i) => c.push({ at: +(T.vo + w.t0).toFixed(3), kind: "sample", file: `04-sfx/pen${1 + (i * 3) % 4}.wav`, gain: 0.28 }));
      // the hero's beat
      c.push({ at: T.bell, kind: "bell", f: KEY.note, dur: 1.8, gain: 0.62 }, { at: T.bell + F(3), kind: "land", gain: 0.16 }, { at: T.bell + F(11), kind: "land", gain: 0.2 });
      c.push({ at: T.flick - F(5), kind: "whoosh", dur: 0.16, up: true, gain: 0.18 }, { at: T.flick, kind: "sample", file: "04-sfx/peel.wav", gain: 0.72 }, { at: T.flick + 0.62, kind: "land", gain: 0.13 });
      c.push({ at: T.slide, kind: "whoosh", dur: 0.26, up: false, gain: 0.14 });
      for (const s of T.stamps) c.push({ at: s, kind: "paper-thud", gain: 0.9 }, { at: s, kind: "boom", f0: 72, f1: 44, dur: 0.45, gain: 0.2 });
      c.push({ at: T.ul, kind: "whoosh", dur: 0.22, up: false, gain: 0.4 });
      c.push({ at: T.snap, kind: "click", gain: 0.45 }, { at: T.snap, kind: "paper-thud", gain: 0.32 });
      // Bengaluru: the hood from the cut's first sample, the hour, the card's paper slide
      c.push({ at: T.cut, kind: "sample", file: "04-sfx/hood.wav", gain: 1.0 }, { at: T.cut, kind: "sizzle", dur: 2.9, gain: 0.7 });
      c.push(...ticksFor("Bengaluru · 9:48 pm", T.cityB, 0.03, 0.26));
      c.push({ at: T.card, kind: "whoosh", dur: 0.34, up: true, gain: 0.42 }, { at: T.card + F(10), kind: "paper-thud", gain: 0.42 });
      // the page: the drone in F, the headline typed and written, its brush, the clay bell once more, a chord
      c.push({ at: T.grow - 0.4, kind: "drone", f: 87.31, dur: T.end - T.grow + 1.6, a: 1.2, r: 1.2, gain: 0.6 });
      c.push({ at: T.grow, kind: "whoosh", dur: 0.4, up: true, gain: 0.3 });
      c.push(...ticksFor("Maane", T.head, 0.04, 0.32), { at: T.head + 0.25, kind: "sample", file: "04-sfx/pen2.wav", gain: 0.38 }, { at: T.head + 0.42, kind: "sample", file: "04-sfx/pen3.wav", gain: 0.38 });
      c.push(...ticksFor("Keybotnelikha", T.head + 0.6, 0.028, 0.3));
      c.push({ at: T.ulH, kind: "whoosh", dur: 0.4, up: false, gain: 0.46 });
      c.push({ at: T.bell2, kind: "bell", f: KEY.note, dur: 2.2, gain: 0.62 }, { at: T.bell2, kind: "chord", f: 174.61, dur: 1.9, gain: 0.28 });
      c.push(...ticksFor("Speak in any app. Keybot writes. You send.", T.small, 0.02, 0.13));
      // the end card's cues, moved from D into the spot's key (F)
      const up = 174.61 / 146.83;
      c.push(...AD.endCues(T.end).map((e) => (e.kind === "chord" || e.kind === "bell" ? { ...e, f: +(e.f * up).toFixed(2) } : e)));
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
