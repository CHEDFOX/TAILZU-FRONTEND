/* THE WITNESS (spot 10): a deposition. Every question is heavy white type slammed onto black; every answer is a fox's
 * handwriting under him, on his own word times, a pen scratch a word. The team assembles in colour as he names it (the
 * only colour in the film), the lone "No." holds in a freeze, the clock never stops, and on his last word the warmth
 * drains out of him and the headline lands: They ask / You decide. Then the campaign's end card, the hero looking, waiting.
 *
 * Footage: clip 3 (Prof. Lomri in the armchair, ../footage-fox/, 72 fps) through the bible's segments, one grade (the
 * deposition: contrast up, blacks crushed to ink, colour only in his face and sweater, heavy vignette, grain).
 * Voice: en-GB Ryan at -5 %, one voice.mjs call per answer (voice/10-N.wav), cut by spots/10-sound.mjs at its sentence
 * pauses into phrase files (voice/10-N<a..>.wav, de-essed, a 0.4 s room) so the read's 0.9 s pauses can be set to the
 * bible's 0.3 s a full stop; the timeline below is laid out from those files' word times.
 * Sound: sound.mjs kinds plus spots/10-sfx/ (clock, pen, carriage, ruler, tape start, and bed.wav: the hiss and the room,
 * gated by this timeline; rebuild with `node spots/10-sound.mjs bed` after changing it).
 *
 * This file is also a CommonJS module (the timeline only), so 10-sound.mjs computes the bed from the same numbers.
 */
(function () {
  "use strict";
  const FPS = 30, F = (n) => n / FPS, snap = (t) => Math.round(t * FPS) / FPS;

  /** The phrase files and their words as written (edge-tts drops punctuation; the tokens zip by index). */
  const SAY = {
    "1a": "Bots.", "1b": "A team.", "1c": "Each great at one thing.",
    "2a": "Writes.", "2b": "Plans.", "2c": "Trips.", "2d": "Code.", "2e": "Notes.",
    "3a": "Any.", "4a": "No.",
    "5a": "They ask.", "5b": "I say yes.",
    "6a": "No one.", "6b": "Not for sale.",
    "7a": "I don’t.", "7b": "I don’t have to.",
  };
  const Q = ["What are they?", "Which things?", "Which one do you ask?", "They act without you?", "Never?", "Who buys your data?", "Why trust them?"];

  /**
   * The film's clock, from the phrases' word times (V: { key: { words: [{ t0, t1 }] } }, times relative to each file).
   * The wall clock ticks once a second and must put two ticks inside the "No." hold AND one in the middle of the beat
   * between "I don't." and "I don't have to."; what lies between the two (the hold, the tails of shots 6 and 7, his
   * pause before "I don't.") is nudged, by the least it takes, so both land.
   */
  function timeline(V) {
    const NOM = { hold: 1.1, tail6: 0.1, tail7: 0.1, lead8: 0.4 };
    let best = null;
    for (let h = 0; h <= 6; h++) for (let a = -1; a <= 9; a++) for (let b = -1; b <= 9; b++) for (let l = -3; l <= 24; l++) {
      const P = { hold: NOM.hold + F(h), tail6: NOM.tail6 + F(a), tail7: NOM.tail7 + F(b), lead8: NOM.lead8 + F(l) };
      const cost = 1.0 * F(h) + Math.abs(F(a)) + Math.abs(F(b)) + 0.6 * Math.abs(F(l));   // keep the bible's 1.1 s hold; his pause before "I don't." gives first
      if (best && cost >= best.cost) continue;
      const T = build(V, P); if (T.ok) best = { cost, T };
    }
    return best.T;
  }
  function build(V, P) {
    const T = { say: [], shots: [], P };
    const end = (k) => V[k].words[V[k].words.length - 1].t1, on = (k, i = 0) => V[k].words[i].t0;
    const place = (k, at) => { at = snap(at); T.say.push({ k, at }); return at + end(k); };
    const q = (a, len, text, i) => { const s = { kind: "q", a, b: snap(a + len), at: a, text, i }; T.shots.push(s); return s.b; };
    const PAUSE = 0.3;    // between his sentences: the read's own 0.9 s cut to the bible's 0.3 s a full stop
    let t, e;
    // 1 · black; the first question slams in at 0.4
    T.shots.push({ kind: "q", a: 0, b: 1.2, at: 0.4, text: Q[0], i: 0 }); t = 1.2;
    // 2 · the witness, 1.0x through 0.0-3.4 (stretched to his three sentences)
    const w2 = { kind: "w", n: 2, a: t, zoom: 1.0, ans: [["1a", "1b"], ["1c"]] };
    e = place("1a", t + 0.12); e = place("1b", e + PAUSE); e = place("1c", e + PAUSE);
    w2.b = snap(Math.max(t + 3.4, e + 0.22)); w2.src = [[w2.a, 0.0], [w2.b, 3.4]]; T.shots.push(w2);
    // 3 · Q2, then the five things: a head joins the row on each noun
    t = q(w2.b, 0.8, Q[1], 1);
    const w3 = { kind: "w", n: 3, a: t, zoom: 1.08, ans: [["2a", "2b", "2c"], ["2d", "2e"]] };
    const NOUN_GAP = 0.1;    // a staccato list: tighter than a full stop's 0.3, never run together
    T.nouns = []; e = t + 0.1 - NOUN_GAP;
    for (const k of ["2a", "2b", "2c", "2d", "2e"]) { const at = snap(e + NOUN_GAP); T.nouns.push(+(at + on(k)).toFixed(4)); e = place(k, at); }
    w3.b = snap(Math.max(t + 3.2, e + 0.15)); w3.src = [[w3.a, 3.4], [w3.b, 6.6]]; T.shots.push(w3);
    // 4 · Q3, "Any." at 0.5x; one head lifts ten pixels on his look
    t = q(w3.b, 0.8, Q[2], 2);
    const w4 = { kind: "w", n: 4, a: t, b: snap(t + 2.0), zoom: 1.0, ans: [["3a"]], src: [[t, 6.3], [snap(t + 2.0), 7.3]] };
    place("3a", t + 0.2); T.lift = snap(t + 0.62); T.shots.push(w4);
    // 5 · Q4, "No.": the frame stops on the word and holds 1.1 s, two ticks of the clock in it
    t = q(w4.b, 0.8, Q[3], 3);
    T.fz5 = snap(t + 0.5);
    const w5 = { kind: "w", n: 5, a: t, b: snap(T.fz5 + P.hold), zoom: 1.15, ans: [["4a"]], src: [[t, 1.0], [T.fz5, 1.5]], roomEnd: T.fz5 };
    place("4a", T.fz5 - 0.16 - on("4a")); T.shots.push(w5);
    // 6 · the accelerando: Q5 0.6 s; the drone creeps in under "ask"
    t = q(w5.b, 0.6, Q[4], 4);
    const w6 = { kind: "w", n: 6, a: t, zoom: 1.08, ans: [["5a"], ["5b"]] };   // 108 %: framed apart from shot 2's 100 % on the same frames
    e = place("5a", t + 0.1); T.ask = +(T.say[T.say.length - 1].at + on("5a", 1)).toFixed(4); e = place("5b", e + PAUSE);
    w6.b = snap(Math.max(t + 2.2, e + P.tail6)); w6.src = [[w6.a, 2.0], [w6.b, 4.2]]; T.shots.push(w6);
    // 7 · Q6 0.5 s
    t = q(w6.b, 0.5, Q[5], 5);
    const w7 = { kind: "w", n: 7, a: t, zoom: 1.15, ans: [["6a"], ["6b"]] };
    e = place("6a", t + 0.1); e = place("6b", e + PAUSE);
    w7.b = snap(Math.max(t + 2.0, e + P.tail7)); w7.src = [[w7.a, 4.8], [w7.b, 6.8]]; T.shots.push(w7);
    // 8 · Q7 0.4 s; "I don't." / a 0.5 s beat with one tick in it / "I don't have to." and the frame freezes on "to"
    t = q(w7.b, 0.4, Q[6], 6);
    const at7a = snap(t + P.lead8 - on("7a")); place("7a", at7a);
    const tick = at7a + end("7a") + 0.2;
    const at7b = snap(tick + 0.3 - on("7b")); place("7b", at7b);
    T.beatTick = +tick.toFixed(4);
    // the wall clock, 60 bpm, phased on that tick; it must also put two ticks inside the "No." hold
    const ph = ((tick % 1) + 1) % 1, d5 = (((ph - T.fz5) % 1) + 1) % 1;
    T.ok = d5 >= 0.03 && d5 + 1 <= P.hold - 0.03;
    T.fz8 = snap(at7b + on("7b", 3));
    const w8 = { kind: "w", n: 8, a: t, zoom: 1.08, ans: [["7a"], ["7b"]], src: [[t, 5.8], [T.fz8, 5.8 + 0.6 * (T.fz8 - t)]], roomEnd: T.fz8, last: true };
    // 9 · the headline over the cold, frozen witness: "I don't have to." stays whole on the cold frame first (about 0.8 s,
    //     so it reads with the sound off), clears under the first slam; then two slams, the hand word, the brush
    T.h1 = snap(T.fz8 + 0.9); T.h2 = snap(T.fz8 + 1.3); T.hw0 = snap(T.fz8 + 1.5); T.hw1 = snap(T.fz8 + 2.0); T.ul0 = T.hw1; T.ul1 = snap(T.fz8 + 2.3);
    T.capOut = snap(T.h1 - F(2));
    T.rowOut = snap(T.h2 - F(4));
    // 10 · the end card at the bible's t0 (its 4.5 s), run as built (4.9 s)
    T.end0 = snap(T.fz8 + 3.5); w8.b = T.end0; T.shots.push(w8);
    T.duration = snap(T.end0 + 4.9);
    T.ticks = []; for (let k = Math.ceil(0.3 - ph); ph + k < T.end0 - 0.05; k++) T.ticks.push(+(ph + k).toFixed(4));
    T.sayAt = Object.fromEntries(T.say.map((s) => [s.k, s.at]));
    return T;
  }
  /** Tape hiss: from the tape start to the last freeze, out in the "No." hold (the clock, nothing else). */
  const hissIntervals = (T) => [[0.05, T.fz5], [T.shots.find((s) => s.n === 5).b, T.fz8]];
  /** Room tone: only on the witness, cut hard on every question card and on both freezes. */
  const roomIntervals = (T) => T.shots.filter((s) => s.kind === "w").map((s) => [s.a, s.roomEnd ?? s.b]);

  if (typeof module !== "undefined" && module.exports) { module.exports = { SAY, Q, timeline, hissIntervals, roomIntervals }; return; }

  // ================================================================================================ the page
  const { C, E } = X0, fr = AD.fr, lerp = AD.lerp;
  const X = 86, MAXW = 950 - 86;                    // the left axis (0.08w) and the safe right edge (0.88w)
  const CAP = { size: 74, y: 1330, pitch: 80 };     // his answers: Caveat, first baseline 0.69h; line 2's descenders clear the row
  const ROW = { y: 1498, r: 46, gap: 24 };          // the team, 0.78h
  const HEADS = ["head-keybot", "head-plan", "head-travel", "head-code", null];   // Writes, Plans, Trips, Code, Notes (ink)
  const NOTES = [293.66, 369.99, 440, 493.88, 220];                              // each bot's bell; Notes the low ink bell (as in spot 01)
  /** Notes' dotted head in ink (as spot 01 draws it): the coloured dots go ink, the white dots and the eye stay white. */
  let inkHeadCv = null;
  function inkHead(S) {
    if (inkHeadCv) return inkHeadCv;
    const im = S.A["head-keybot"], cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height;
    const c = cv.getContext("2d"); c.drawImage(im, 0, 0); const d = c.getImageData(0, 0, cv.width, cv.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 3, k = X0.clamp((l - 105) / 150), v = Math.round(10 + 245 * k); p[i] = p[i + 1] = p[i + 2] = v; }
    c.putImageData(d, 0, 0); return (inkHeadCv = cv);
  }
  const LIFT = 2;                                   // the head that lifts on "Any."
  let L = null;

  /** Measure once the fonts are in: sizes from cap heights, Q line breaks, the headline against 1026 px. */
  function measure(S) {
    const { ctx } = S;
    ctx.save(); ctx.font = X0.font(900, 100); const gCap = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    const qSize = Math.round(0.06 * 1080 / gCap), hSize = Math.round(0.09 * 1080 / gCap), qf = X0.font(900, qSize);
    const qLines = Q.map((s) => {
      if (X0.width(ctx, s, qf) <= MAXW) return [s];
      const w = s.split(" "); let best = null;
      for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(" "), b = w.slice(i).join(" "), m = Math.max(X0.width(ctx, a, qf), X0.width(ctx, b, qf)); if (!best || m < best.m) best = { a, b, m }; }
      if (best.m > MAXW) console.warn(`Q too wide: ${s} ${best.m.toFixed(0)} px`);
      return [best.a, best.b];
    });
    const hBase = [0, Math.round(0.76 * 1920)]; hBase[0] = hBase[1] - Math.round(hSize * 1.16);
    const hLines = [["They", "ask"], ["You", "decide"]].map((ws, i) => X0.layout(ctx, ws.map((w) => (i === 1 && w === "You" ? { text: w, hand: true, handWeight: 700, scale: 1.15 } : { text: w })), { x: X, y: hBase[i], size: hSize, weight: 900, color: "#FFFFFF" }));
    // the hand word's advance is short of a Geist word gap ("Youdecide" at phone size): open it to line 1's gap, measured by ink
    const ink = (w) => { ctx.save(); ctx.font = w.font; const m = ctx.measureText(w.text); ctx.restore(); return { l: w.x - m.actualBoundingBoxLeft, r: w.x + m.actualBoundingBoxRight }; };
    const gap1 = ink(hLines[0].words[1]).l - ink(hLines[0].words[0]).r, gap2 = ink(hLines[1].words[1]).l - ink(hLines[1].words[0]).r, open = Math.max(0, Math.round(gap1 - gap2));
    hLines[1].words[1].x += open; hLines[1].w += open;
    hLines.forEach((l, i) => { if (l.w > 1026) console.warn(`headline line ${i + 1} ${l.w.toFixed(0)} px > 1026`); });
    const cf = X0.font(700, CAP.size, "Caveat");
    L = { gCap, qSize, hSize, qLines, hBase, hLines, cf, report: `cap ${gCap.toFixed(3)} Q ${qSize}px (${qLines.map((l) => l.map((s) => X0.width(ctx, s, qf).toFixed(0)).join("+")).join(" ")}) H ${hSize}px (${hLines.map((l) => l.w.toFixed(0)).join(", ")}; word gaps ${gap1.toFixed(0)} / ${gap2.toFixed(0)} +${open})` };
    if (S.q.get("hud")) console.warn("measure: " + L.report);
    return L;
  }
  /** Each witness shot's answer as lines of words at their absolute times, with their widths. */
  function tokens(S, T) {
    const { ctx } = S;
    for (const s of T.shots) if (s.kind === "w") {
      s.map = AD.map(s.src);
      s.lines = s.ans.map((keys) => { let x = X; return keys.flatMap((k) => S.V[k].words.map((w) => { const ww = X0.width(ctx, w.text + " ", L.cf), o = { text: w.text, t0: T.sayAt[k] + w.t0, t1: T.sayAt[k] + w.t1, x }; x += ww; o.w = ww; return o; })); });
      s.lines.forEach((ln) => { const r = ln[ln.length - 1]; const right = r.x + X0.width(ctx, r.text, L.cf); if (right > 950) console.warn(`answer too wide in shot ${s.n}: ${right.toFixed(0)}`); });
    }
  }

  // ------------------------------------------------------------------------------------------------ the deposition grade
  const GRADE = (sat, cold) => `brightness(1.02) contrast(1.75) brightness(${(0.86 - 0.08 * cold).toFixed(3)}) saturate(${sat.toFixed(3)})`;
  const SAT0 = 0.07;   // the room: books, brass, leather and panelling all but grey, so the team row is the colour
  /**
   * Where the warmth stays: his face (an ellipse about his head) and his cream sweater (an ellipse about his chest, and only
   * where it is pale, so the tan leather beside his shoulder stays grey), and in either only the warm hues (reds to
   * yellows), so the blue spines and the green wall behind his ears stay grey. Positions in source px, mapped by zoom/dy.
   */
  const KEEP = { face: { x: 520, y: 1050, rx: 262, ry: 238 }, sweater: { x: 490, y: 1590, rx: 400, ry: 330 } };
  const WARM = {};     // its own canvas, read back every frame
  const soft = (r, a, b) => (r <= a ? 1 : r >= b ? 0 : 1 - E.io((r - a) / (b - a)));
  function warmthMask(c, z, dy) {
    const im = c.getImageData(0, 0, 1080, 1920), p = im.data, to = (v, axis) => (axis ? 960 + (v - 960) * z + dy : 540 + (v - 540) * z);
    const f = KEEP.face, w = KEEP.sweater, fx = to(f.x, 0), fy = to(f.y, 1), frx = f.rx * z, fry = f.ry * z, wx = to(w.x, 0), wy = to(w.y, 1), wrx = w.rx * z, wry = w.ry * z;
    for (let y = 0; y < 1920; y++) {
      const dyf = (y - fy) / fry, dyw = (y - wy) / wry;
      if (Math.abs(dyf) >= 1.15 && Math.abs(dyw) >= 1.05) { for (let x = 0; x < 1080; x++) p[(y * 1080 + x) * 4 + 3] = 0; continue; }
      for (let x = 0; x < 1080; x++) {
        const i = (y * 1080 + x) * 4, dxf = (x - fx) / frx, dxw = (x - wx) / wrx;
        const kf = soft(Math.sqrt(dxf * dxf + dyf * dyf), 0.8, 1.15), kw = soft(Math.sqrt(dxw * dxw + dyw * dyw), 0.72, 1.05);
        if (kf <= 0 && kw <= 0) { p[i + 3] = 0; continue; }
        const r = p[i], g = p[i + 1], b = p[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, sat = mx ? d / mx : 0;
        let hue = 0; if (d > 0) { hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue *= 60; if (hue < 0) hue += 360; }
        const warm = d < 6 ? 1 : hue <= 52 || hue >= 345 ? 1 : hue < 72 ? 1 - (hue - 52) / 20 : hue > 320 ? (hue - 320) / 25 : 0;
        const pale = sat <= 0.36 ? 1 : sat >= 0.56 ? 0 : 1 - (sat - 0.36) / 0.2;
        p[i + 3] = Math.round(255 * warm * Math.max(kf, kw * pale));
      }
    }
    c.putImageData(im, 0, 0);
  }
  function witness(S, t, s, T) {
    const { ctx } = S, src = s.map(t), img = S.foot("fox", src);
    const cold = s.last ? E.io(fr(t, T.fz8, 0.3)) : 0;
    // on the last freeze the frame pushes in and up as it goes cold, so his chin clears the headline's first line
    const z = lerp(s.zoom, 1.2, cold), dy = lerp(-140 * (s.zoom - 1), -170, cold);
    AD.film(S, img, { zoom: z, dy, grade: GRADE(SAT0 * (1 - cold), cold), vignette: false });
    // the warmth kept only in his face and sweater: a fuller-colour pass through the warm mask
    if (cold < 1) {
      if (!WARM.c) { WARM.cv = document.createElement("canvas"); WARM.cv.width = 1080; WARM.cv.height = 1920; WARM.c = WARM.cv.getContext("2d", { willReadFrequently: true }); }
      const c = WARM.c; c.clearRect(0, 0, 1080, 1920);
      c.filter = GRADE(0.95 * (1 - cold), cold); X0.cover(c, img, 0, 0, 1080, 1920, { zoom: z, dy }); c.filter = "none";
      warmthMask(c, z, dy);
      ctx.drawImage(WARM.cv, 0, 0, 1080, 1920);
    }
    // gone cold: two degrees cooler as the colour leaves
    if (cold > 0) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = `rgba(222,233,255,${cold.toFixed(3)})`; ctx.fillRect(0, 0, 1080, 1920); ctx.restore(); }
    X0.vignette(ctx, 1080, 1920, 0.58 + 0.17 * cold);
    // the ink under his answers (and deeper under the headline): a 40 % gradient so white never sits on the bright sweater bare
    const deep = s.last ? E.io(fr(t, T.fz8, 0.4)) : 0, g0 = lerp(1110, 1070, deep), g1 = lerp(1290, 1195, deep);
    const lg = ctx.createLinearGradient(0, g0, 0, 1920); lg.addColorStop(0, "rgba(0,0,0,0)"); lg.addColorStop((g1 - g0) / (1920 - g0), `rgba(0,0,0,${(0.44 + 0.06 * deep).toFixed(3)})`); lg.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = lg; ctx.fillRect(0, g0, 1080, 1920 - g0);
    return { src, cold };
  }
  /** The deposition's running timecode, tiny and grey, at 0.12h: it never stops, not even on a freeze. */
  function timecode(S, t) {
    const tot = 41 * 60 + 7 + t, p = (n) => String(n).padStart(2, "0");
    const s = `00:${p(Math.floor(tot / 60))}:${p(Math.floor(tot % 60))}:${p(Math.floor((tot % 1) * FPS + 1e-6))}`;
    AD.onFilm(S, s, X, 264, X0.font(500, 44, "GeistMono"), "rgba(196,196,196,0.72)");
  }
  /** His answer: Caveat, word by word on the voice's times, wiped on like a pen. */
  function answer(S, t, s, alpha = 1) {
    const { ctx } = S; if (alpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    s.lines.forEach((ln, li) => {
      const y = CAP.y + li * CAP.pitch;
      for (const wd of ln) {
        const k = fr(t, wd.t0 - 0.05, F(4)); if (k <= 0) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(wd.x - 8, y - CAP.size, (wd.w + 16) * E.o3(k), CAP.size * 1.6); ctx.clip();
        ctx.translate(wd.x, y + (X0.hash((wd.t0 * 1000) | 0) - 0.5) * 3); ctx.rotate((X0.hash((wd.t1 * 977) | 0) - 0.5) * 0.03);
        AD.onFilm(S, wd.text, 0, 0, L.cf); ctx.restore();
      }
    });
    ctx.restore();
  }
  /** The team: five dotted heads on paper discs, each joining on its noun; one lifts on "Any." */
  function row(S, t, T, alpha) {
    const { ctx, A } = S; if (alpha <= 0) return;
    for (let i = 0; i < 5; i++) {
      const at = T.nouns[i] - 0.03; if (t < at) continue;
      const k = fr(t, at, F(5)), sc = 1.22 - 0.22 * E.o5(k), r = ROW.r;
      const lift = t >= T.lift && i === LIFT ? (t < T.lift + 0.2 ? E.o3(fr(t, T.lift, 0.2)) : 1 - E.io(fr(t, T.lift + 0.33, 0.45))) : 0;
      // the bible's ten pixels, with a small pop of the disc on the rise so it reads on a phone with the sound off
      const pop = 1 + 0.12 * lift, cx = X + r + i * (2 * r + ROW.gap), cy = ROW.y - 10 * lift;
      ctx.save(); ctx.globalAlpha *= alpha * Math.min(1, k * 2.5); ctx.translate(cx, cy); ctx.scale(sc * pop, sc * pop);
      ctx.save(); ctx.shadowColor = `rgba(0,0,0,${(0.6 + 0.25 * lift).toFixed(3)})`; ctx.shadowBlur = 18 + 10 * lift; ctx.shadowOffsetY = 6 + 6 * lift; ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip(); X0.cover(ctx, A.paper, -r, -r, 2 * r, 2 * r, { alpha: 0.8 }); ctx.restore();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      const im = HEADS[i] ? A[HEADS[i]] : inkHead(S), hs = 70; ctx.drawImage(im, -hs / 2, -hs / 2 - 1, hs, hs);
      ctx.restore();
    }
  }
  /** A question: a small grey Q over heavy white Geist on black, slammed in one frame (1.08 -> 1.00 over 3 f), last baseline 0.72h. */
  function qcard(S, t, s) {
    if (t < s.at) return;
    const { ctx } = S, lines = L.qLines[s.i], sz = L.qSize, pitch = Math.round(sz * 1.1), f = X0.font(900, sz);
    const base = Math.round(0.72 * 1920), b0 = base - (lines.length - 1) * pitch, top = b0 - L.gCap * sz;
    const k = fr(t, s.at, F(3)), sc = 1.08 - 0.08 * E.o3(k), wmax = Math.max(...lines.map((l) => X0.width(ctx, l, f)));
    const cx = X + wmax / 2, cy = (top - 60 + base) / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
    X0.text(ctx, "Q", X, top - 40, X0.font(600, 44), "#8C8C8C");
    lines.forEach((l, i) => X0.text(ctx, l, X, b0 + i * pitch, f, "#FFFFFF"));
    ctx.restore();
  }
  /** The headline over the cold witness: "They ask" slams, "decide" slams, "You" is written in, the clay brush under it. */
  function headline(S, t, T) {
    if (t < T.h1) return;
    const { ctx, A } = S, size = L.hSize, lines = L.hLines, hw = lines[1].words.find((w) => w.hand);
    const shadow = () => { ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3; };
    lines.forEach((line, i) => {
      const at = i ? T.h2 : T.h1; if (t < at) return;
      const k = fr(t, at, F(3)), sc = 1.08 - 0.08 * E.o3(k), cx = X + line.w / 2, cy = L.hBase[i] - size * 0.36;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); shadow();
      for (let r = 0; r < 2; r++) X0.drawLine(ctx, line, (j, w) => (w.hand ? { a: 0 } : { a: 1 }));
      ctx.restore();
    });
    if (t >= T.hw0) {
      const kh = E.io(fr(t, T.hw0, T.hw1 - T.hw0));
      ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 12, L.hBase[1] - size * 1.3, (hw.w + 30) * kh, size * 1.8); ctx.clip(); shadow();
      for (let r = 0; r < 2; r++) X0.drawLine(ctx, { words: [hw] }); ctx.restore();
    }
    if (t >= T.ul0) { const im = A["ul-bar"], uw = hw.w * 1.1, uh = Math.max(24, uw * im.height / im.width * 1.15);
      X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 10, hw.y + size * 0.12, uw, uh, E.o3(fr(t, T.ul0, T.ul1 - T.ul0)), "x", { rot: -0.012, rag: 10, seed: 2 }); }
  }
  /** The campaign end card as built, the hero looking and waiting: the kit has no option for it, so his wink is held shut
   *  here, page-locally, by holding both lids open and the sway still while AD.endCard draws him. */
  function endCard(S, t, t0) {
    if (t < t0) return;
    const hang = X0.hang;
    X0.hang = (ctx, Ls, x, y, size, tm, o = {}) => hang(ctx, Ls, x, y, size, tm, { ...o, lids: [0, 0], sway: 0 });
    try { AD.endCard(S, t, t0); } finally { X0.hang = hang; }
    // The kit's markPaint clips the 0 at 0.52 of the mark AFTER squeezing it, so the tip of the X's right arm (source
    // 0.436-0.457) is drawn a second time as a thin sliver at 0.52-0.536 (x 319-327). Between the X's ink (ends 0.457)
    // and the squeezed 0's (starts 0.570) there is only paper, so that band is re-laid with the sheet's own paper, in the
    // sheet's own transform (it slides with it). Page-local; the kit itself is not touched.
    const { ctx, A } = S, kin = E.o5(fr(t, t0, F(14))), dy = (1 - kin) * 1920, mx = 80, my = 740, mw = 460, mh = mw * A.mark.height / A.mark.width;
    ctx.save(); ctx.translate(0, dy); ctx.beginPath(); ctx.rect(mx + mw * 0.49, my - 12, mw * (0.562 - 0.49), mh + 24); ctx.clip();
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920); X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the film
  const voices = {}; for (const k of Object.keys(SAY)) voices[k] = `../voice/10-${k}.json`;
  AD.start({
    footage: { fox: { dir: "../footage-fox/", frames: 520, fps: 72 } },
    voices, scripts: SAY,
    timeline(S) { const T = timeline(S.V); measure(S); tokens(S, T); return T; },
    duration: (S) => S.T.duration,
    frame(t, S) {
      const T = S.T, { ctx } = S; let info = "";
      if (t < T.end0 + F(14)) {
        const s = T.shots.find((x) => t >= x.a && t < x.b) || T.shots[T.shots.length - 1];
        if (s.kind === "q") { qcard(S, t, s); info = `Q${s.i + 1}`; }
        else {
          const w = witness(S, t, s, T);
          timecode(S, t);
          answer(S, t, s, s.last ? 1 - E.io(fr(t, T.capOut, F(3))) : 1);
          if (s.n >= 3) row(S, t, T, 1 - E.io(fr(t, T.rowOut, F(4))));
          headline(S, t, T);
          X0.grain(ctx, 1080, 1920, t, 0.1 + 0.06 * w.cold, 1);
          info = `W${s.n} src ${w.src.toFixed(2)} z${s.zoom}${w.cold ? " cold " + w.cold.toFixed(2) : ""}`;
        }
      }
      endCard(S, t, T.end0);
      if (S.q.get("hud")) X0.text(ctx, info, 360, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const T = S.T, c = [], smp = (at, file, gain) => c.push({ at, kind: "sample", file, gain });
      smp(0, "10-sfx/tape.wav", 0.8);
      smp(0, "10-sfx/bed.wav", 1);
      T.ticks.forEach((at, i) => smp(at, i % 2 ? "10-sfx/tock.wav" : "10-sfx/tick.wav", 0.42));
      for (const s of T.shots) if (s.kind === "q") smp(s.at, "10-sfx/carriage.wav", 0.75);
      for (const s of T.say) smp(s.at, `../voice/10-${s.k}.wav`, 1);
      let n = 0; for (const s of T.shots) if (s.kind === "w") for (const ln of s.lines) for (const wd of ln) smp(wd.t0 - 0.02, `10-sfx/scratch-${1 + (n++ % 3)}.wav`, 0.42);
      T.nouns.forEach((at, i) => c.push({ at, kind: "bell", f: NOTES[i], dur: i === 4 ? 1.8 : 1.3, gain: i === 4 ? 0.6 : 0.42 }));
      c.push({ at: T.ask, kind: "drone", f: 65.41, dur: T.fz8 - T.ask, a: T.shots.find((s) => s.n === 7).b - T.ask, r: 0.006, gain: 0.46 });
      smp(T.h1, "10-sfx/ruler.wav", 0.9); smp(T.h2, "10-sfx/ruler.wav", 0.9);
      smp(T.hw0, "10-sfx/scratch-1.wav", 0.45); smp(T.hw0 + 0.2, "10-sfx/scratch-3.wav", 0.4);
      c.push({ at: T.ul0, kind: "whoosh", dur: 0.3, up: false, gain: 0.32 });
      // the end card's sounds as built, in this spot's key (C major, the drone's), and without the wink's bell
      const toC = { 146.83: 130.81, 293.66: 261.63, 369.99: 329.63, 440: 392.0, 493.88: 440.0, 587.33: 523.25 };
      for (const e of AD.endCues(T.end0)) {
        if (e.kind === "bell" && Math.abs(e.at - (T.end0 + F(104))) < 1e-6) continue;
        c.push(e.f && toC[e.f] ? { ...e, f: toC[e.f] } : e);
      }
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
