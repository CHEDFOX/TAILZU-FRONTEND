/* LEAVE AT 4:40 (spot 05, The Minimalist). Two frames and one cut.
 *
 *   0.0-5.0   a front door from inside, keys hanging in the lock, afternoon light raking across it from a window off the
 *             left. Plan's bell; a white card tapes on: what she told Plan, in her hand ("Dentist Fri 5 pm"), then what
 *             Plan did, typed ("leave by 4:40"). Hold.
 *   5.0-15.5  HARD CUT, the event: a vast, dark underground platform; the doors have just shut (the chime) and the train
 *             pulls out from near standstill, gathering speed, until the platform is empty (she is aboard). The shot-1
 *             card echoed at the top, right of the clock. The one line of type, late: "You knew / when to leave", 'when'
 *             by hand, Plan's ochre brush under it.
 *   15.5-20.4 the campaign's end card (AD.endCard, 4.9 s), into silence.
 *
 * Footage:
 *   footage-05-a/  Mixkit 21812 (a door with keys in the lock), 8.6-14.2 s, crop 0.52,0,0.316,1, 24 fps (blended here)
 *   footage-05-c/  Mixkit 1622 (an underground platform, a train running out), clip frames 151-, crop 0.28,0,0.316,1,
 *                  motion-interpolated to 120 fps at the crop's own size, then scaled by prep.mjs (the pull-out)
 *   footage-05-d/  the same, from clip frame 194 to the end, interpolated to 30 fps (real time, a frame per frame)
 *   (footage-05-b/, the first 24 fps prep of 1622, is no longer drawn; the clock's track keeps its frame numbers)
 * Sound: sound.mjs kinds plus spots/05-sfx/*.wav (made by spots/05-sound.mjs: the room, the platform air, the train,
 * the brake sigh, the door chime, the tape, the pen). No pulse anywhere. Everything is a pure function of t.
 */
(() => {
  "use strict";
  const { C, E, clamp } = X0;
  const { F, fr } = AD;
  const OCHRE = C.ochre;   // Plan's colour, #8F6A1F

  // ------------------------------------------------------------------------------------------------ the timeline (s)
  const T = { cut: 5.0, end0: 15.5 };
  const DURATION = T.end0 + AD.END_S;   // the bible's 20 s, its 4.5 s card run as the kit's 4.9 s

  // shot 1: the card
  const CARD = { bell: 0.3, in: 0.4 };
  const HAND = [{ text: "Dentist", t0: 0.70, d: 0.32 }, { text: "Fri", t0: 1.06, d: 0.20 }, { text: "5", t0: 1.31, d: 0.12 }, { text: "pm", t0: 1.48, d: 0.22 }];
  const TYPED = "leave by 4:40", TYPE0 = 2.2, TYPE1 = 3.4;   // 0.5 s after the last handwritten word, a tick per letter
  const typeAt = (i) => Math.max(TYPE0, TYPE0 + (TYPE1 - TYPE0 - 0.12) * (i + 0.35 * (X0.hash(i * 31 + 7) - 0.5)) / (TYPED.length - 1));
  const typedN = (t) => { let n = 0; for (let i = 0; i < TYPED.length; i++) if (t >= typeAt(i)) n = i + 1; return n; };
  // shot 2: the line, late and once
  const HL = { l1: 11.0, l1D: F(9), hand: 11.75, handD: 0.5, l2: 12.5, l2D: 0.4, ul: 13.2, ulD: 0.5 };

  // ------------------------------------------------------------------------------------------------ the footage clocks
  // a: the door, 24 fps (locked off, so neighbours blend cleanly). c and d: the platform, motion-interpolated at the
  // clip's own crop size before scaling (c at 120 fps for the pull-out, so 0.25x is one clean frame per film frame;
  // d at 30 fps for real time, one frame per film frame), so the moving train never shows a crossfade.
  const FOOT = { a: { dir: "../footage-05-a/", frames: 134, fps: 24 }, c: { dir: "../footage-05-c/", frames: 246, fps: 120 }, d: { dir: "../footage-05-d/", frames: 236, fps: 30 } };
  const srcA = (t) => clamp(t, 0, 5.5);   // real time from the clip's 8.6 s: locked off, the keys still settling
  // Shot 2 runs on the clip's own clock (Mixkit 1622, 23.976 fps: frame k at k * 1001/24000 s). The doors have just shut:
  // the train starts from near standstill at the cut and pulls out, 0.25x to 1x over 3 s (a steady acceleration), then
  // real time. Its tail clears the frame at clip 12.86 s, film 12.6 s, with the train's sound (from 5.62) and the line.
  const B = { s0: 6.383, ramp: 3.0, v0: 0.25, c0: 151 * 1001 / 24000, d0: 194 * 1001 / 24000 };   // c0, d0: the first frame of c and d
  function clipB(t) {
    const u = Math.max(0, t - T.cut), a = (1 - B.v0) / B.ramp;
    return B.s0 + (u < B.ramp ? B.v0 * u + 0.5 * a * u * u : B.v0 * B.ramp + 0.5 * a * B.ramp * B.ramp + (u - B.ramp));
  }
  /**
   * The platform at film time t. Real time (d): exactly one interpolated frame per film frame, no blend. The pull-out
   * (c): its 120 fps frames are 1/120 s apart (a few px of the train's motion), so between two of them the picture is
   * their mix by the fraction: the steps stay even as the speed changes (nearest-frame would alternate 1 and 2 frames
   * at 0.375x), and a mix of frames that close reads as a touch of motion blur, never a double image.
   */
  let rampCv = null;
  function frameB(S, t) {
    const clip = clipB(t);
    if (t - T.cut >= B.ramp) return S.A[`d#${clamp(Math.round((clip - B.d0) * FOOT.d.fps) + 1, 1, FOOT.d.frames)}`];
    const f = clamp((clip - B.c0) * FOOT.c.fps, 0, FOOT.c.frames - 1), i = Math.floor(f), a = f - i, im0 = S.A[`c#${i + 1}`];
    if (a < 0.03 || i + 2 > FOOT.c.frames) return im0;
    const im1 = S.A[`c#${i + 2}`]; if (a > 0.97) return im1;
    if (!rampCv) { rampCv = document.createElement("canvas"); rampCv.width = 1080; rampCv.height = 1920; }
    const c = rampCv.getContext("2d"); c.globalAlpha = 1; c.drawImage(im0, 0, 0, 1080, 1920); c.globalAlpha = a; c.drawImage(im1, 0, 0, 1080, 1920); c.globalAlpha = 1;
    return rampCv;
  }
  /** The clip time as a frame of the first 24 fps prep (footage-05-b: frame i is clip frame 119 + i), the clock track's frames. */
  const trackFrame = (clip) => clip * 24000 / 1001 - 119;
  /** The frame at a source time, blended with its neighbour (24 fps footage in a 30 fps film: no judder). */
  let blendCv = null;
  function footFrame(S, name, src) {
    const f0 = FOOT[name], f = clamp(src * f0.fps, 0, f0.frames - 1), i = Math.floor(f), a = f - i;
    const im0 = S.A[`${name}#${i + 1}`];
    if (a < 0.04 || i + 2 > f0.frames) return im0;
    const im1 = S.A[`${name}#${i + 2}`];
    if (a > 0.96) return im1;
    if (!blendCv) { blendCv = document.createElement("canvas"); blendCv.width = 1080; blendCv.height = 1920; }
    const c = blendCv.getContext("2d"); c.globalAlpha = 1; c.drawImage(im0, 0, 0, 1080, 1920); c.globalAlpha = a; c.drawImage(im1, 0, 0, 1080, 1920); c.globalAlpha = 1;
    return blendCv;
  }

  /**
   * The platform's clock reads a quarter to twelve in the clip; in this film it reads 4:46 (she left at 4:40, the
   * dentist is at five: a calm walk, time in hand). Its old hands are painted out with the face's own colour, sampled
   * beside them each frame, the nine's index is laid back as a mirror of the three's, and new hands drawn, before the
   * grade, so they take the same light, softness and grain. The camera drifts about 20 px across the shot: the clock is
   * tracked (template match on the frames, every 12th kept: frame, dx, dy in px). The minute hand jumps once, as
   * station clocks do, 4:46 to 4:47.
   */
  const CLOCK = { c: [279.6, 581.6], jump: 9.6, m0: 46,
    track: [[1, 15.0, 1.8], [13, 15.1, 1.9], [25, 13.0, 1.8], [37, 12.2, 1.3], [49, 9.9, 1.1], [61, 8.2, 0.9], [73, 7.6, 0.8], [85, 5.6, 0.8], [97, 3.8, 0.0], [109, 3.4, 0.0], [121, 1.5, 0.2], [133, 0.8, -0.5],
      [145, 0.3, -0.5], [157, -0.1, -0.3], [169, -1.7, -0.9], [181, -2.3, -0.3], [193, -3.1, -0.7], [205, -3.4, -1.0], [217, -4.7, -0.8], [229, -5.2, -1.1], [241, -5.3, -1.0], [253, -5.5, -1.0], [264, -5.8, -1.2]] };
  function clockAt(frame) {
    const tr = CLOCK.track; let i = 1; while (i < tr.length - 1 && tr[i][0] < frame) i++;
    const [f0, x0, y0] = tr[i - 1], [f1, x1, y1] = tr[i], k = clamp((frame - f0) / (f1 - f0));
    return [CLOCK.c[0] + x0 + (x1 - x0) * k, CLOCK.c[1] + y0 + (y1 - y0) * k];
  }
  let bCv = null, idxCv = null;
  function footB(S, t) {
    const img = frameB(S, t);
    if (!bCv) { bCv = document.createElement("canvas"); bCv.width = 1080; bCv.height = 1920; }
    const c = bCv.getContext("2d", { willReadFrequently: true }); c.globalAlpha = 1; c.filter = "none"; c.drawImage(img, 0, 0, 1080, 1920);
    const [cx, cy] = clockAt(trackFrame(clipB(t))), rad = (deg) => deg * Math.PI / 180;
    const at = (deg, r) => [cx + Math.sin(rad(deg)) * r, cy - Math.cos(rad(deg)) * r];
    const px = (x, y) => { const d = c.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return `rgb(${r / n | 0},${g / n | 0},${b / n | 0})`; };
    // paint out a hand: a soft strip along `deg` from r0 to r1, filled with the face sampled on both sides of it
    const paint = (deg, r0, r1, w) => {
      const [ax, ay] = at(deg, r0), [bx, by] = at(deg, r1), side = (x, y) => [x + Math.cos(rad(deg)) * (w * 0.5 + 7), y + Math.sin(rad(deg)) * (w * 0.5 + 7)];
      const g = c.createLinearGradient(ax, ay, bx, by); g.addColorStop(0, px(...side(ax, ay))); g.addColorStop(1, px(...side(bx, by)));
      c.save(); c.filter = "blur(1.2px)"; c.strokeStyle = g; c.lineWidth = w; c.lineCap = "round"; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.restore();
    };
    paint(-6, -14, 44, 15);     // the old hour hand (11:45)
    paint(270, -20, 52, 14);    // the old minute hand, its tip too (it merged with the nine's index)
    // the nine's index, laid back as the three's mirrored across the face's vertical axis (sampled this frame), feathered
    const IX = { r0: 40, r1: 72, h: 22 }, iw = IX.r1 - IX.r0;
    if (!idxCv) { idxCv = document.createElement("canvas"); idxCv.width = iw; idxCv.height = IX.h; }
    const ic = idxCv.getContext("2d"); ic.globalCompositeOperation = "source-over"; ic.clearRect(0, 0, iw, IX.h);
    ic.save(); ic.translate(iw, 0); ic.scale(-1, 1); ic.drawImage(bCv, cx + IX.r0, cy - IX.h / 2, iw, IX.h, 0, 0, iw, IX.h); ic.restore();
    const fg = ic.createLinearGradient(0, 0, iw, 0); fg.addColorStop(0, "rgba(0,0,0,0)"); fg.addColorStop(0.18, "#000"); fg.addColorStop(0.82, "#000"); fg.addColorStop(1, "rgba(0,0,0,0)");
    ic.globalCompositeOperation = "destination-in"; ic.fillStyle = fg; ic.fillRect(0, 0, iw, IX.h);
    const fv = ic.createLinearGradient(0, 0, 0, IX.h); fv.addColorStop(0, "rgba(0,0,0,0)"); fv.addColorStop(0.25, "#000"); fv.addColorStop(0.75, "#000"); fv.addColorStop(1, "rgba(0,0,0,0)");
    ic.fillStyle = fv; ic.fillRect(0, 0, iw, IX.h); ic.globalCompositeOperation = "source-over";
    c.drawImage(idxCv, cx - IX.r1, cy - IX.h / 2);
    // the new hands: 4:46 until the jump
    const jm = E.back(2.2)(fr(t, CLOCK.jump, 0.14)), minute = CLOCK.m0 + jm, mdeg = minute * 6, hdeg = (4 + minute / 60) * 30;
    const hand = (deg, tail, len, w) => { const [ax, ay] = at(deg, -tail), [bx, by] = at(deg, len); c.save(); c.filter = "blur(0.7px)"; c.strokeStyle = "rgb(22,21,20)"; c.lineWidth = w; c.lineCap = "butt"; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.restore(); };
    hand(hdeg, 10, 39, 6.6); hand(mdeg, 16, 61, 4.2);
    c.save(); c.filter = "blur(0.6px)"; c.fillStyle = "rgb(22,21,20)"; c.beginPath(); c.arc(cx, cy, 4.2, 0, Math.PI * 2); c.fill(); c.restore();
    return bCv;
  }

  // ------------------------------------------------------------------------------------------------ the grade (one for the spot)
  // contrast up, saturation -32%, warm, fine grain, soft vignette; only the exposure is matched per shot
  const GRADE = (exp) => `contrast(1.1) saturate(0.68) brightness(${exp})`;
  function film(S, img, exp, o = {}) {
    const { ctx } = S;
    AD.film(S, img, { grade: GRADE(exp), vig: o.vig ?? 0.3 });
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgb(255,233,206)"; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
  }
  /**
   * Shot 1's light. The flat white door is graded down into a soft shade, then the same frame graded a little brighter
   * is let through a mask: the afternoon sun from a window off the left, four panes thrown long across the door by the
   * low sun, their glazing bars in shadow. Warm and low contrast, as the bible asks: the patch sits about 1.5:1 over the
   * shade, its warmth held near the grade's saturation. The camera is locked, so the mask is made once.
   */
  const LIGHT = { shade: 0.70, sun: 0.92, sunTint: "rgb(255,239,220)", shear: 0.36, blur: 20,
    panes: [[-380, 440, 310, 520], [-36, 440, 310, 520], [-380, 994, 310, 520], [-36, 994, 310, 520]] };
  let maskCv = null, sunCv = null;
  function lightMask() {
    if (maskCv) return maskCv;
    maskCv = document.createElement("canvas"); maskCv.width = 1080; maskCv.height = 1920;
    const c = maskCv.getContext("2d"); c.filter = `blur(${LIGHT.blur}px)`; c.fillStyle = "#fff"; c.transform(1, 0, LIGHT.shear, 1, 0, 0);
    for (const [x, y, w, h] of LIGHT.panes) c.fillRect(x, y, w, h);
    return maskCv;
  }
  function doorFilm(S, img) {
    const { ctx } = S;
    AD.film(S, img, { grade: GRADE(LIGHT.shade), vignette: false });
    if (!sunCv) { sunCv = document.createElement("canvas"); sunCv.width = 1080; sunCv.height = 1920; }
    const c = sunCv.getContext("2d"); c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, 1080, 1920);
    c.filter = GRADE(LIGHT.sun); X0.cover(c, img, 0, 0, 1080, 1920); c.filter = "none";
    c.globalCompositeOperation = "multiply"; c.fillStyle = LIGHT.sunTint; c.fillRect(0, 0, 1080, 1920);   // the sun is warmer than the room
    c.globalCompositeOperation = "destination-in"; c.drawImage(lightMask(), 0, 0);
    ctx.drawImage(sunCv, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgb(255,233,206)"; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
    // the room's falloff toward the hinge side and the floor
    const g = ctx.createLinearGradient(0, 1000, 0, 1920); g.addColorStop(0, "rgba(8,5,2,0)"); g.addColorStop(1, "rgba(8,5,2,0.4)"); ctx.fillStyle = g; ctx.fillRect(0, 1000, 1080, 920);
    X0.vignette(ctx, 1080, 1920, 0.4);
  }

  // ------------------------------------------------------------------------------------------------ the card
  const CF = { name: X0.font(500, 38), hand: X0.font(700, 54, "Caveat"), type: X0.font(600, 49) };   // the name in small Geist, 0.035w
  let M = null;
  /** The card's measure: sized to its longest line plus 0.04w each side. */
  function cardMeasure(ctx) {
    if (M) return M;
    const pad = Math.round(0.04 * 1080), hs = 76, words = []; let x = 0;
    for (const h of HAND) { const w = X0.width(ctx, h.text, CF.hand); words.push({ text: h.text, x, w }); x += X0.width(ctx, h.text + " ", CF.hand); }
    const wHand = words[words.length - 1].x + words[words.length - 1].w, wType = X0.width(ctx, TYPED, CF.type), wHead = hs + 18 + X0.width(ctx, "Plan", CF.name);
    const inner = Math.max(wHand, wType, wHead);
    M = { pad, hs, words, w: Math.ceil(inner + 2 * pad), h: 296, yName: 30 + hs * 0.68, y1: 30 + hs + 72, y2: 30 + hs + 72 + 74, wHand, wType, wHead };
    if (new URLSearchParams(location.search).get("measure")) console.warn(`card: hand ${wHand.toFixed(0)} type ${wType.toFixed(0)} head ${wHead.toFixed(0)} -> w ${M.w} (${(M.w / 1080).toFixed(3)}w)`);
    return M;
  }
  /**
   * The taped card. o: { cx, cy, rot, scale, k (press-in 0..1), hand(i) -> 0..1, typed (letters), caret (0..1), lit }
   * It presses on (scale 1.14 to 1.00), opaque from its first frame: paper, not a fade. `lit`: on the door it takes the
   * door's light, warmed, and the window's glazing-bar shadow crosses it (the card and its tape, darkened 20% in shade).
   */
  let cardCv = null, litCv = null, shadeCv = null;
  function drawCard(S, o) {
    const { ctx } = S, m = cardMeasure(ctx), w = m.w, h = m.h, k = clamp(o.k ?? 1); if (k <= 0) return;
    const sc = (1.14 - 0.14 * E.o5(k)) * (o.scale ?? 1), place = (c) => { c.translate(o.cx, o.cy); c.rotate(o.rot ?? -0.03); c.scale(sc, sc); c.translate(-w / 2, -h / 2); };
    // the drop shadow, on the frame
    ctx.save(); place(ctx);
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 36; ctx.shadowOffsetX = (o.shadowDx ?? 0) * (o.scale ?? 1); ctx.shadowOffsetY = 20 * (o.scale ?? 1); ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, 0, 0, w, h, 22); ctx.fill();
    ctx.restore();
    if (!o.lit) { ctx.save(); place(ctx); cardFace(S, ctx, o, m); ctx.restore(); return; }
    const mk = () => { const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1920; return cv; };
    if (!cardCv) { cardCv = mk(); litCv = mk(); shadeCv = mk(); const s = shadeCv.getContext("2d"); s.fillStyle = "rgb(204,204,204)"; s.fillRect(0, 0, 1080, 1920); s.drawImage(lightMask(), 0, 0); }
    const c = cardCv.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 1080, 1920); c.save(); place(c); cardFace(S, c, o, m); c.restore();
    const l = litCv.getContext("2d"); l.globalCompositeOperation = "source-over"; l.clearRect(0, 0, 1080, 1920); l.drawImage(cardCv, 0, 0);
    l.globalCompositeOperation = "multiply"; l.fillStyle = "rgb(255,240,220)"; l.fillRect(0, 0, 1080, 1920); l.drawImage(shadeCv, 0, 0);
    l.globalCompositeOperation = "destination-in"; l.drawImage(cardCv, 0, 0); l.globalCompositeOperation = "source-over";
    ctx.drawImage(litCv, 0, 0, 1080, 1920);
  }
  /** The card's face, in its own space (0, 0, w, h): paper, Plan's head and name, her words, Plan's typed line, the tape. */
  function cardFace(S, ctx, o, m) {
    const { A } = S, w = m.w, h = m.h;
    ctx.save(); ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, 0, 0, w, h, 22); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, 0, 0, w, h, 22); ctx.clip(); X0.cover(ctx, A.paper, 0, 0, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, 0, 0, w, h, 22); ctx.stroke();
    ctx.drawImage(A["head-plan"], m.pad, 30, m.hs, m.hs);
    X0.text(ctx, "Plan", m.pad + m.hs + 18, m.yName, CF.name, OCHRE);
    // what she told Plan: her hand, word by word
    m.words.forEach((wd, i) => {
      const kk = o.hand ? o.hand(i) : 1; if (kk <= 0) return;
      ctx.save(); ctx.beginPath(); ctx.rect(m.pad + wd.x - 8, m.y1 - 62, (wd.w + 16) * kk, 92); ctx.clip();
      ctx.translate(m.pad + wd.x, m.y1 + (X0.hash(i * 13 + 5) - 0.5) * 4); ctx.rotate((X0.hash(i * 7 + 2) - 0.5) * 0.035);
      X0.text(ctx, wd.text, 0, 0, CF.hand, C.ink); ctx.restore();
    });
    // what Plan did: typed
    const n = o.typed ?? TYPED.length;
    if (n > 0) X0.text(ctx, TYPED.slice(0, n), m.pad, m.y2, CF.type, C.ink);
    if (o.caret > 0) { const cx = m.pad + X0.width(ctx, TYPED.slice(0, n), CF.type) + 5; ctx.save(); ctx.globalAlpha *= o.caret; ctx.fillStyle = C.ink; ctx.fillRect(cx, m.y2 - 40, 4, 50); ctx.restore(); }
    // one strip of tape
    const tw = 196, th = tw * A.tape.height / A.tape.width; ctx.save(); ctx.translate(w / 2 - 10, 2); ctx.rotate(-0.06); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -tw / 2, -th / 2, tw, th); ctx.restore();
  }
  // where it sits: on the plain door below the lock, clear of the hanging keys
  const CARD_AT = { left: 0.08 * 1080, cy: 0.62 * 1920, rot: -0.028 };
  /**
   * The echo in shot 2: the same card, smaller, at 0.14h on the plain dark ceiling right of the clock (clear of its
   * rods, the lamps and the wire bracket), riding the plate's drift with the clock's track so it sits in the hall like
   * the clock does. Scale 0.9: every line on it stays at or above the system's floors (typed line 44 px, her hand
   * 49 px, 'Plan' 34 px), so it is 0.335w where the bible's sketch says 0.25w.
   */
  const ECHO = { left: 0.54 * 1080, top: 0.14 * 1920, sc: 0.9, rot: -0.028 };

  // ------------------------------------------------------------------------------------------------ the headline
  const HEAD = { x: 0.08 * 1080, base1: 0.76 * 1920 };
  let HLM = null;
  function hlLayout(S) {
    if (HLM) return HLM;
    const { ctx } = S;
    ctx.save(); ctx.font = X0.font(900, 100); const cap = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    let size = Math.round(0.085 * 1080 / cap);
    // line 2's baseline stays at the bible's 0.76h; the leading is tight (1.04: line 1 has no descenders) so line 1 sits
    // 14 px lower, clear of the yellow platform edge that ran tangent to the top of 'knew'
    const mk = (sz) => {
      const pitch = sz * 1.04, b = [HEAD.base1 - pitch, HEAD.base1];
      const l1 = X0.layout(ctx, [{ text: "You" }, { text: "knew" }], { x: HEAD.x, y: b[0], size: sz, weight: 900, color: "#FFFFFF" });
      const l2 = X0.layout(ctx, [{ text: "when", hand: true, handWeight: 700, scale: 1.2 }, { text: "to" }, { text: "leave" }], { x: HEAD.x, y: b[1], size: sz, weight: 900, color: "#FFFFFF" });
      return { size: sz, base: b, l1, l2 };
    };
    let L = mk(size);
    while (HEAD.x + L.l2.w > 0.88 * 1080 && size > 0.08 * 1080 / cap) L = mk(--size);
    // the hand word's first stroke on the same left edge as the 'Y' of 'You' (Caveat's side bearing is wider than Geist's);
    // 'to leave' stays where the layout put it; the underline starts on that edge too and runs the ink's width
    const hw = L.l2.words[0];
    ctx.save(); ctx.font = L.l1.words[0].font; const inkL = L.l1.words[0].x - ctx.measureText(L.l1.words[0].text).actualBoundingBoxLeft;
    ctx.font = hw.font; const mh = ctx.measureText(hw.text); ctx.restore();
    const shift = inkL - (hw.x - mh.actualBoundingBoxLeft); hw.x += shift; hw.inkX = inkL; hw.inkW = mh.actualBoundingBoxLeft + mh.actualBoundingBoxRight;
    HLM = { ...L, cap, capPx: cap * L.size, shift };
    if (S.q.get("measure")) console.warn(`headline: cap ratio ${cap.toFixed(3)} size ${L.size} cap ${(cap * L.size).toFixed(1)} px (${(cap * L.size / 1080).toFixed(4)}w); line 1 ${L.l1.w.toFixed(0)} px, line 2 ${L.l2.w.toFixed(0)} px (right edge ${(HEAD.x + L.l2.w).toFixed(0)} = ${((HEAD.x + L.l2.w) / 1080).toFixed(3)}w; vs 1026); baselines ${L.base.map((b) => b.toFixed(0)).join(", ")}; hand word shifted ${shift.toFixed(1)} px to ink at ${inkL.toFixed(1)}`);
    return HLM;
  }
  const word = (S, w, alpha = 1) => AD.onFilm(S, w.text, w.x, w.y, w.font, "rgba(255,255,255,0.96)", "left", alpha);
  function headline(S, t) {
    if (t < HL.l1) return;
    const { ctx, A } = S, H = hlLayout(S), sz = H.size;
    const k1 = E.o3(fr(t, HL.l1, HL.l1D));
    ctx.save(); ctx.beginPath(); ctx.rect(H.l1.x - 24, H.base[0] - sz * 1.3, (H.l1.w + 48) * k1, sz * 1.7); ctx.clip(); H.l1.words.forEach((w) => word(S, w)); ctx.restore();
    const hw = H.l2.words[0], kh = fr(t, HL.hand, HL.handD);
    if (kh > 0) { ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 14, H.base[1] - sz * 1.35, (hw.w + 34) * E.smooth(kh), sz * 1.85); ctx.clip(); word(S, hw); ctx.restore(); }
    const rest = H.l2.words.slice(1), rx = rest[0].x, rw = rest[rest.length - 1].x + rest[rest.length - 1].w - rx, k2 = E.o3(fr(t, HL.l2, HL.l2D));
    if (k2 > 0) { ctx.save(); ctx.beginPath(); ctx.rect(rx - 20, H.base[1] - sz * 1.3, (rw + 44) * k2, sz * 1.7); ctx.clip(); rest.forEach((w) => word(S, w)); ctx.restore(); }
    const ku = fr(t, HL.ul, HL.ulD);
    if (ku > 0) { const im = A["ul-plan"], uw = hw.inkW * 1.08, uh = Math.max(24, uw * im.height / im.width * 1.2); X0.reveal(ctx, im, hw.inkX - 4, hw.y + sz * 0.13, uw, uh, E.io(ku), "x", { rot: -0.012, rag: 10, seed: 2 }); }
  }

  // ------------------------------------------------------------------------------------------------ the frame
  function frame(t, S) {
    const { ctx } = S;
    if (t < T.cut) {
      doorFilm(S, footFrame(S, "a", srcA(t)));
      X0.grain(ctx, 1080, 1920, t, 0.06, 1);
      const kIn = fr(t, CARD.in, F(6));
      drawCard(S, { cx: CARD_AT.left + cardMeasure(ctx).w / 2, cy: CARD_AT.cy, rot: CARD_AT.rot, k: kIn, shadowDx: 12, lit: true, hand: (i) => fr(t, HAND[i].t0, HAND[i].d), typed: typedN(t), caret: t >= TYPE0 - 0.05 && t < TYPE1 + 0.45 ? (t < TYPE1 ? 1 : (Math.floor((t - TYPE1) / 0.22) % 2 ? 0 : 1)) : 0 });
    } else if (t < T.end0 + F(14)) {
      film(S, footB(S, t), 1.04, { vig: 0.34 });
      AD.scrim(S, 1920, 1120, 0.55);   // the vignette deepened on the lower third, so the line reads
      X0.grain(ctx, 1080, 1920, t, 0.07, 1);
      // the shot-1 card, echoed at the top: she is aboard. It rides the plate's drift (the clock's track since the cut).
      const m = cardMeasure(ctx), [x0, y0] = clockAt(trackFrame(clipB(T.cut))), [x1, y1] = clockAt(trackFrame(clipB(t)));
      drawCard(S, { cx: ECHO.left + m.w * ECHO.sc / 2 + (x1 - x0), cy: ECHO.top + m.h * ECHO.sc / 2 + (y1 - y0), rot: ECHO.rot, scale: ECHO.sc, k: 1, typed: TYPED.length });
      headline(S, t);
    }
    AD.endCard(S, t, T.end0); markGap(S, t);
    if (t >= T.end0 + F(14)) X0.grain(ctx, 1080, 1920, t, 0.03, 1);
    if (S.q.get("hud")) X0.text(ctx, `src ${t < T.cut ? "a " + srcA(t).toFixed(2) : "clip " + clipB(t).toFixed(3) + (t - T.cut < B.ramp ? " c" : " d")}`, 300, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
  }
  /**
   * The kit's markPaint clips the 0 at 0.52 of the mark AFTER squeezing it by 0.74, so the tips of the X's right arms
   * (source 0.436-0.457) are drawn a second time as a thin sliver at 0.52-0.536 (x 319-327), between the X and the 0
   * ('X:0'). Between the X's ink (ends 0.457) and the squeezed 0's (starts 0.570) there is only paper, so that band is
   * re-laid with the sheet's own paper, in the sheet's own transform. Page-local (as spots 09 and 10 do); adkit.js is
   * shared and is not edited here.
   */
  function markGap(S, t) {
    const t0 = T.end0; if (t < t0 + F(30)) return;   // the 0's stroke starts at +36 f; the sheet is up by +14 f
    const { ctx, A } = S, kin = E.o5(fr(t, t0, F(14))), dy = (1 - kin) * 1920, mx = 80, my = 740, mw = 460, mh = mw * A.mark.height / A.mark.width;
    ctx.save(); ctx.translate(0, dy); ctx.beginPath(); ctx.rect(mx + mw * 0.49, my - 12, mw * (0.562 - 0.49), mh + 24); ctx.clip();
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 1080, 1920); X0.cover(ctx, A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the sound
  const SFX = (n) => `05-sfx/${n}.wav`;
  /** The kit's end cues, its pitched bells and chord moved down a fourth into A major (the spot's key), and its paper
   *  slide ('open') 8 dB up: in this film it is the only sound after the cut to the sheet, so it has to be heard. */
  const endCuesInA = (t0) => AD.endCues(t0).map((c) => (c.kind === "bell" || c.kind === "chord") && c.f ? { ...c, f: c.f * 0.75 } : c.kind === "open" ? { ...c, gain: c.gain * 2.5 } : c);
  function cues() {
    const c = [];
    // shot 1: a room and a distant street, the drone in A, Plan's bell, the tape, her pen, Plan's keys
    c.push({ at: 0, kind: "sample", file: SFX("room"), gain: 1 });
    c.push({ at: 0, kind: "drone", f: 55, dur: T.end0, a: 0.9, r: 0.06, gain: 0.32 });
    c.push({ at: CARD.bell, kind: "bell", f: AD.BOT.plan.note, dur: 1.4, gain: 0.26 });
    c.push({ at: CARD.in, kind: "sample", file: SFX("tape"), gain: 0.9 });
    HAND.forEach((h, i) => c.push({ at: h.t0, kind: "sample", file: SFX(`pen-${i + 1}`), gain: 0.85 }));
    for (let i = 0; i < TYPED.length; i++) if (TYPED[i] !== " ") c.push({ at: typeAt(i), kind: "tick", gain: 0.34 });
    // the cut: the platform's air, the drone opening to a fifth, the doors' chime (they have just shut), the brakes
    // letting go, then the train pulling out (its sound's tail clears 7.0 s in: 12.62, with the picture's)
    c.push({ at: T.cut, kind: "sample", file: SFX("platform"), gain: 1 });
    c.push({ at: T.cut, kind: "drone", f: 82.41, dur: T.end0 - T.cut, a: 0.25, r: 0.06, gain: 0.24 });
    c.push({ at: T.cut + 0.08, kind: "sample", file: SFX("chime"), gain: 0.8 });
    c.push({ at: T.cut + 0.62, kind: "sample", file: SFX("sigh"), gain: 0.8 });
    c.push({ at: T.cut + 0.62, kind: "sample", file: SFX("train"), gain: 1 });
    // the line: a tick per line, her pen on 'when', the brush under it
    c.push({ at: HL.l1, kind: "tick", gain: 0.3 }, { at: HL.hand, kind: "sample", file: SFX("pen-when"), gain: 0.8 }, { at: HL.l2, kind: "tick", gain: 0.3 });
    c.push({ at: HL.ul, kind: "whoosh", dur: 0.45, up: false, gain: 0.32 });
    // everything stops but the paper slide; then the campaign's card, in A. Under it a room tone at about -60 dB, so the
    // stop is a chosen quiet and never digital zero (a phone hears zero as a dropout)
    c.push({ at: T.end0, kind: "sample", file: SFX("room"), gain: 0.03 });
    c.push(...endCuesInA(T.end0));
    return c;
  }

  AD.start({ footage: FOOT, duration: DURATION, timeline: () => T, frame, cues }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
