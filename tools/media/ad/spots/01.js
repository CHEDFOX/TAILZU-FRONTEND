/* 01 · HE HAD A TEAM (the Trickster). White cotton paper; a tear opens in it from the centre into a 4:3 window, and
 * through the hole we watch old office films (Prelinger, public domain) of the people who once ran one man's day.
 * The hero hangs from the torn top edge inside every room; the room cuts five times behind him, he never cuts. Each
 * job gets a small taped card in the lower margin (Keybot, Plan, Travel, Notes), then a strip: Ask any bot. On the
 * switchboard plug the film freezes and goes cold; the headline slams in ink on the paper above the evidence; he
 * lets go of the edge and drops out; the campaign's end card slides up.
 *
 * Everything is a pure function of t. Footage: footage-01-<shot>/ (prep.mjs, contained 4:3 inside the 1080 x 1920
 * frame, so the picture is the band y 555..1365), drawn into the torn window through AD.film with one grade for the
 * spot (brand greys, contrast up, fine grain, soft vignette), slowed to 0.9x with held frames, a little gate weave,
 * flicker, dust and a scratch (all of it stops on the freeze). Voice: six Prabhat reads (voice/01-1..6), whose word
 * times drive the handwritten narration in the top margin and land the cards.
 *
 * Render: PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs out --page spots/01.html --ratio 9x16
 */
(() => {
  "use strict";
  const { C, E, clamp } = X0;
  const { F, fr, lerp } = AD;

  // ------------------------------------------------------------------------------------------------ the frame's geometry
  const WIN = { x: 54, y: 510, w: 972, h: 729 };                 // the torn window: 0.9w wide, 4:3
  WIN.cx = WIN.x + WIN.w / 2; WIN.cy = WIN.y + WIN.h / 2; WIN.b = WIN.y + WIN.h;
  const PIC = { y: 555, h: 810 };                                 // where prep.mjs --fit contain put the 4:3 picture
  const HERO = { size: 400, edge: 186 };                          // the art's y (of 544) that sits on the torn edge
  HERO.s = HERO.size / 544; HERO.x = WIN.cx - 272 * HERO.s; HERO.y = WIN.y - HERO.edge * HERO.s;
  const CARD = { w: 216, h: 172, y: 1258, cx: [196, 426, 656, 886], rot: [-0.035, 0.022, -0.014, 0.03], tapeRot: [-0.09, 0.07, -0.05, 0.1], tapeDx: [-12, 9, -5, 12] };
  const STRIP = { cy: 1508, h: 92 };
  const CAPTION = { size: 72, base: 410, cx: 536 };   // on the window's centre line, as far as the widest line stays left of 0.88w
  const SPEED = 0.9;                                              // the archive, slowed 10%

  // ------------------------------------------------------------------------------------------------ the cut (seconds)
  // src = s0 + 0.9 (t - t0), in the footage folder's own clock (local 0 = the source time in the comment).
  // pre / con / bright: per-shot levels folded into the one grade (pre-brightness, contrast about mid-grey, brightness),
  // so every room lands near p98 210: the washed-out paper shots get blacks back, the dark switchboard gets lifted.
  const SHOTS = [
    { key: "a1", t0: 0, t1: 2.5, s0: 0.0, z: 1.12, fx: 0.02, fy: 0.03 },      // Secretar1947 307.4: the executive dictates
    { key: "a2", t0: 2.5, t1: 3.8, s0: 1.30, z: 1.14, fx: -0.03, fy: 0.068 },  // 359.4: she writes it down
    { key: "b", t0: 3.8, t1: 6.2, s0: 1.70, z: 1.08, fx: 0.0, fy: 0.0, pre: 0.764, con: 1.859 },  // 252.0: the diary, a pen in the time slots
    { key: "c", t0: 6.2, t1: 8.8, s0: 0.80, z: 1.05, fx: 0.0, fy: 0.0 },      // passenger_train 659.6: the train pulls out
    { key: "d1", t0: 8.8, t1: 9.95, s0: 0.30, z: 1.10, fx: 0.02, fy: 0.03 },  // StoryWit1950 775.35: the meeting round the table
    { key: "d2", t0: 9.95, t1: 11.2, s0: 4.85, z: 1.12, fx: -0.02, fy: 0.02, pre: 0.816, con: 1.479, // Secretar1947 330.3: one of them writes it down (the pen moving)
      blank: [525, 749, 325, 26] },   // the cheque's printed bank name, blanked to the cheque's own paper grey
    { key: "e1", t0: 11.2, t1: 12.91, s0: 0.50, z: 1.20, fx: 0.0, fy: 0.095 }, // Speeding1950 96.0: the operator, headset
    { key: "e2", t0: 12.91, t1: Infinity, s0: 0.64, z: 1.25, fx: -0.11, fy: 0.08, con: 0.72, bright: 1.14, freeze: 13.8 }, // 526.2: the plug seated in the jack (frozen, s44); lit jack rows behind his head
  ];
  const FREEZE = 13.8, END0 = 19.5, DURATION = END0 + AD.END_S;
  const VO = [   // the narration: line, start, when its handwriting leaves
    { key: "v1", at: 1.0, out: 3.72 }, { key: "v2", at: 3.8, out: 6.12 }, { key: "v3", at: 6.2, out: 8.72 },
    { key: "v4", at: 8.8, out: 11.12 }, { key: "v5", at: 11.2, out: 14.3 },
  ];
  const HEAD_VO = { key: "v6", at: 15.5 };
  const SCRIPTS = { v1: "He had someone to write it down.", v2: "Someone to keep his day.", v3: "Someone to book his train.", v4: "Someone to take the notes.", v5: "And someone to put him through.", v6: "He had a team. Now you do." };
  const BOTS = [
    { name: "Keybot", head: "head-keybot", note: 293.66, vo: "v1" },
    { name: "Plan", head: "head-plan", note: 369.99, vo: "v2" },
    { name: "Travel", head: "head-travel", note: 440, vo: "v3" },
    { name: "Notes", head: "ink", note: 220, vo: "v4" },
  ];
  const STRIP_HEADS = ["head-keybot", "head-plan", "head-travel", "head-code", "ink"], STRIP_NOTES = [293.66, 369.99, 440, 493.88, 220];

  const shotAt = (t) => SHOTS.find((s) => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];
  const srcOf = (sh, t) => sh.s0 + SPEED * ((sh.freeze != null ? Math.min(t, sh.freeze) : t) - sh.t0);

  // ------------------------------------------------------------------------------------------------ the hero's performance
  // where his eyes go (art px; 0,0 is at the camera): [t, dx, dy, move seconds]
  const LOOK = [
    [0, 0, 10, 0], [2.02, -25, 12, 0.16], [2.56, -5, 21, 0.12], [3.1, 5, 22, 0.6],
    [3.86, -26, 19, 0.13], [4.97, 22, 14, 0.2], [5.5, 17, 17, 0.5],
    [6.26, 3, 16, 0.1], [7.2, 10, 12, 1.4],
    [8.86, -8, 19, 0.14], [10.0, 14, 23, 0.12], [10.35, 20, 22, 0.7],
    [11.26, -23, 19, 0.13], [12.97, -8, 20, 0.12], [13.4, -10, 23, 0.4],
    [14.05, 0, 0, 1.15], [15.74, 0, -13, 0.12], [16.45, 0, 0, 0.3],
  ];
  const BLINKS = [2.30, 4.55, 8.78, 10.62, 12.12, 15.18, 18.3];
  function look(t) {
    let x = LOOK[0][1], y = LOOK[0][2];
    for (let i = 1; i < LOOK.length; i++) { const [k, dx, dy, d] = LOOK[i]; if (t < k) break; const a = E.io(fr(t, k, d)); x = lerp(x, dx, a); y = lerp(y, dy, a); }
    return { x, y };
  }
  function blink(t) { let b = 0; for (const k of BLINKS) if (t >= k && t < k + F(6)) b = Math.max(b, t < k + F(2) ? fr(t, k, F(2)) : 1 - fr(t, k + F(3), F(3))); return b; }
  /** The hero's rig options for t, and how far he has fallen (px). */
  function hero(t) {
    const drop = fr(t, 1.55, 0.42);
    const ta = 1.97, pend = t > ta ? 9 * Math.exp(-(t - ta) / 0.55) * Math.sin(2 * Math.PI * (t - ta) / 0.74) : 0;
    const idle = (t < FREEZE ? 0.9 : 0.5) * Math.sin(2 * Math.PI * t / 3.4) * fr(t, 2.2, 1);
    const wide = 1 + 0.3 * E.back(2)(fr(t, 6.27, F(5))) * (1 - E.io(fr(t, 8.25, 0.45)));
    const e = look(t);
    const nod = 6 * E.bump(fr(t, 10.25, 0.32)) + 5 * E.bump(fr(t, 17.55, 0.3)) + 4 * E.io(fr(t, 18.82, 0.16)) * (t < 19.02 ? 1 : 0);
    const fall = E.i2(fr(t, 19.04, 0.36)) * (WIN.h + 300);
    return { drop, sway: pend + idle, eyes: { dx: e.x, dy: e.y, sx: wide, sy: wide }, blink: blink(t), nod, fall, wide };
  }
  /** One glove's reach (entry onto the edge, the let-go), or null when it simply holds. */
  function reach(t, side) {
    const g = side ? 1.47 : 1.40;
    if (t < g) return { hide: true };
    if (t < g + F(10)) { const k = fr(t, g, F(5)); return { dx: 0, dy: -42 * (1 - E.o3(k)), grip: 0.2 * E.bump(fr(t, g + F(4), F(5))) }; }
    if (t >= 19.0) { const k = fr(t, 19.0, F(4)); return { dx: (side ? 6 : -6) * k, dy: -12 * E.bump(k), rot: (side ? 9 : -9) * k }; }
    return null;
  }
  const gloveAlpha = (t, side) => fr(t, side ? 1.47 : 1.40, F(3));

  // ------------------------------------------------------------------------------------------------ the torn window
  /** The torn edge as points (window-local, from the centre) with their inward normals; the same every render. */
  const TEAR = (() => {
    const pts = [], hw = WIN.w / 2, hh = WIN.h / 2, step = 7;
    const edge = (x0, y0, x1, y1, nx, ny, seed) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step);
      for (let i = 0; i < n; i++) {
        const k = i / n, d = 4.5 * X0.noise1(i * step / 95, seed) + 2.6 * X0.noise1(i * step / 21, seed + 9) + 2.0 * (X0.hash(i * 977 + seed * 31) - 0.5);
        pts.push({ x: x0 + (x1 - x0) * k + nx * d, y: y0 + (y1 - y0) * k + ny * d, nx, ny, h: X0.hash(i * 131 + seed * 17), h2: X0.hash(i * 71 + seed * 5) });
      }
    };
    edge(-hw, -hh, hw, -hh, 0, 1, 1); edge(hw, -hh, hw, hh, -1, 0, 2); edge(hw, hh, -hw, hh, 0, -1, 3); edge(-hw, hh, -hw, -hh, 1, 0, 4);
    // a smooth lag round the perimeter (closed: it meets itself at the start), so the hole opens raggedly, not in teeth
    const N = pts.length, sm = (i, sd, per) => { const k = i / N; return 0.5 + 0.5 * (X0.noise1(i / per, sd) * (1 - k) + X0.noise1((i - N) / per, sd) * k); };
    pts.forEach((p, i) => { p.s = sm(i, 21, 38); p.s2 = sm(i, 33, 55); });
    return pts;
  })();
  /** The hole at t: a jagged slit that opens from the centre, wide first, then tall. The tear runs TEAR_LEAD ahead of
   *  the clock, so frame 0 (the feed's cover) already shows a slit with the executive behind it; open by 0.5 s. */
  const TEAR_LEAD = 0.1;
  function holePts(t) {
    t += TEAR_LEAD;
    if (t >= 0.6) return TEAR.map((p) => ({ ...p, x: WIN.cx + p.x, y: WIN.cy + p.y }));
    return TEAR.map((p) => {
      const kx = E.o3(fr(t, 0.07 * p.s, 0.36)), ky = E.o3(fr(t, 0.04 + 0.07 * p.s2, 0.48));
      const j = (p.h - 0.5) * 11 * E.bump(Math.min(kx, ky)) + (p.h2 - 0.5) * 5 * (1 - ky);   // fibres on the moving edge
      return { ...p, x: WIN.cx + p.x * kx + p.nx * j, y: WIN.cy + p.y * Math.max(ky, 0.03 * kx) + p.ny * j };
    });
  }
  function holePath(pts) { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath(); return p; }

  const cache = {};
  /** The paper with its hole: shadow into the hole, the cotton grain, the torn white rim. Cached once it has opened. */
  function paperLayer(S, t) {
    const done = t + TEAR_LEAD >= 0.6;
    if (done && cache.paper) return cache.paper;
    const cv = done ? document.createElement("canvas") : (cache.tmp ||= document.createElement("canvas"));
    cv.width = S.W; cv.height = S.H;
    const c = cv.getContext("2d"); c.setTransform(S.u, 0, 0, S.u, 0, 0);
    const pts = holePts(t), hole = holePath(pts), sheet = new Path2D(); sheet.rect(0, 0, 1080, 1920); sheet.addPath(hole);
    if (t + TEAR_LEAD > 0.001) {
      c.save(); c.shadowColor = "rgba(0,0,0,0.5)"; c.shadowBlur = 20; c.shadowOffsetX = 3; c.shadowOffsetY = 9; c.fillStyle = "#FFFFFF"; c.fill(sheet, "evenodd"); c.restore();
      c.save(); c.shadowColor = "rgba(0,0,0,0.32)"; c.shadowBlur = 3; c.shadowOffsetY = 2; c.fillStyle = "#FFFFFF"; c.fill(sheet, "evenodd"); c.restore();
      c.save(); c.clip(sheet, "evenodd"); X0.cover(c, S.A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); c.restore();
      // the torn edge: a white fibrous rim just inside the hole, short fibres, a faint grey line for the eye
      c.save(); c.strokeStyle = "rgba(0,0,0,0.13)"; c.lineWidth = 1; c.stroke(hole); c.restore();
      c.save(); c.beginPath(); pts.forEach((p, i) => { const r = 1.0 + 1.6 * p.h; (i ? c.lineTo : c.moveTo).call(c, p.x + p.nx * r, p.y + p.ny * r); }); c.closePath();
      c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = 2.6; c.stroke(); c.restore();
      c.save(); c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1.1;
      pts.forEach((p, i) => { if (i % 2) return; const L = 1.5 + 4.5 * p.h2 * p.h2, sk = (p.h - 0.5) * 0.9; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + (p.nx + sk * p.ny) * L, p.y + (p.ny + sk * p.nx) * L); c.stroke(); });
      c.restore();
    } else { c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, 1080, 1920); X0.cover(c, S.A.paper, 0, 0, 1080, 1920, { alpha: 0.9 }); }
    if (done) cache.paper = cv;
    return cv;
  }

  // ------------------------------------------------------------------------------------------------ the film in the window
  const DRUM = [[0.5, 519, 453, 63], [0.8, 546, 460, 55], [1.2, 574, 467, 45], [1.8, 605, 470, 36], [2.4, 623, 485, 28], [3.0, 644, 495, 24], [3.6, 652, 502, 20]];
  function drum(src) {   // the observation car's drumhead (a railroad herald), picture px: where to blur it
    if (src <= DRUM[0][0]) return DRUM[0].slice(1);
    for (let i = 1; i < DRUM.length; i++) if (src <= DRUM[i][0]) { const a = DRUM[i - 1], b = DRUM[i], k = (src - a[0]) / (b[0] - a[0]); return [1, 2, 3].map((j) => lerp(a[j], b[j], k)); }
    return DRUM[DRUM.length - 1].slice(1);
  }
  /** The drumhead's own mean grey (0..255) from the source frame, so the blank that covers it matches it. */
  function drumGrey(img, x, y, dia) {
    const cv = (cache.dg ||= document.createElement("canvas")); cv.width = cv.height = 12;
    const c = cv.getContext("2d", { willReadFrequently: true }), r = dia * 0.7;
    c.drawImage(img, x - r, y - r, 2 * r, 2 * r, 0, 0, 12, 12);
    const p = c.getImageData(0, 0, 12, 12).data; let sum = 0, n = 0;
    for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) { if ((i - 5.5) ** 2 + (j - 5.5) ** 2 > 36) continue; const k = (j * 12 + i) * 4; sum += (p[k] + p[k + 1] + p[k + 2]) / 3; n++; }
    return Math.round(sum / n);
  }
  /** The median grey of a rect of the source frame (the paper under a line of print). */
  function paperGrey(img, x, y, w, h) {
    const cv = (cache.pg ||= document.createElement("canvas")); cv.width = 24; cv.height = 6;
    const c = cv.getContext("2d", { willReadFrequently: true }); c.drawImage(img, x, y, w, h, 0, 0, 24, 6);
    const p = c.getImageData(0, 0, 24, 6).data, v = [];
    for (let k = 0; k < p.length; k += 4) v.push((p[k] + p[k + 1] + p[k + 2]) / 3);
    v.sort((a, b) => a - b); return Math.round(v[(v.length * 0.6) | 0]);
  }
  function film(S, t, hole) {
    const { ctx } = S, sh = shotAt(t), src = srcOf(sh, t), img = S.foot(sh.key, src);
    const live = t < FREEZE ? 1 : 0, cold = E.o3(fr(t, FREEZE, F(6))), ff = Math.floor(t * 24);
    const flick = 1 + live * 0.035 * (X0.hash(ff * 7 + 3) * 2 - 1);
    const wx = live * (X0.hash(ff * 13 + 1) - 0.5) * 2.6, wy = live * (X0.hash(ff * 17 + 5) - 0.5) * 2.6;
    // the one grade (brand greys, contrast up) with the shot's own levels; the freeze does not darken, so the black hero
    // still reads against the board (the cold is carried by the faint wash, the grain, the vignette, the stopped flicker)
    const con = (1.16 + 0.02 * cold) * (sh.con ?? 1), bri = 1.02 * (sh.bright ?? 1) * flick;
    const grade = `${sh.pre ? `brightness(${sh.pre}) ` : ""}contrast(${con.toFixed(3)}) saturate(0) brightness(${bri.toFixed(3)})`;
    // the reframe never uncovers the black pad round the contained 4:3 picture (10 px left for the gate weave and the jagged tear)
    const mx = (sh.z - 1) * 540 - 10, my = (sh.z - 1) * PIC.h / 2 - 10;
    const dx = clamp(sh.fx * 1080, -mx, mx) + wx, dy = clamp(sh.fy * PIC.h, -my, my) + wy, s = WIN.w / 1080;
    ctx.save(); ctx.clip(hole);
    ctx.fillStyle = "#111"; ctx.fillRect(WIN.x - 20, WIN.y - 20, WIN.w + 40, WIN.h + 40);
    ctx.save(); ctx.translate(WIN.x, WIN.y - PIC.y * s); ctx.scale(s, s);
    AD.film(S, img, { zoom: sh.z, dx, dy, vignette: false, grade });
    if (sh.key === "c") {   // mask the drumhead herald: a blank drumhead (its own mid-grey, feathered edge) that rides with it
      const [px, py, dia] = drum(src), X = 540 + (px - 540) * sh.z + dx, Y = 960 + (PIC.y + py - 960) * sh.z + dy;
      const m = drumGrey(img, px, PIC.y + py, dia), r0 = dia * 0.82 * sh.z, r1 = dia * 1.12 * sh.z;
      const g = ctx.createRadialGradient(X, Y, r0, X, Y, r1);
      g.addColorStop(0, `rgba(${m},${m},${m},1)`); g.addColorStop(1, `rgba(${m},${m},${m},0)`);
      ctx.save(); ctx.filter = grade; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (sh.blank) {          // printed lettering blanked to the paper it is printed on (a feathered fill of its median grey)
      const [bx, by, bw, bh] = sh.blank, m = paperGrey(img, bx, by, bw, bh), X = 540 + (bx - 540) * sh.z + dx, Y = 960 + (by - 960) * sh.z + dy;
      ctx.save(); ctx.filter = grade + " blur(4px)"; ctx.fillStyle = `rgb(${m},${m},${m})`; X0.rrect(ctx, X, Y, bw * sh.z, bh * sh.z, 8); ctx.fill(); ctx.restore();
    }
    ctx.restore();
    // the archive's own life: dust, a scratch that wanders for a few frames (stopped on the freeze)
    if (live) {
      for (let k = 0; k < 4; k++) { const h = X0.hash(ff * 31 + k * 7); if (h > 0.5) continue;
        const x = WIN.x + X0.hash(ff * 37 + k * 11) * WIN.w, y = WIN.y + X0.hash(ff * 41 + k * 13) * WIN.h, r = 0.8 + 2.4 * X0.hash(ff * 43 + k);
        ctx.fillStyle = X0.hash(ff * 47 + k) > 0.6 ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + 0.8 * h), h * 6, 0, Math.PI * 2); ctx.fill(); }
      const seg = Math.floor(ff / 9);
      if (X0.hash(seg * 11 + 2) < 0.42) { const x = WIN.x + 40 + X0.hash(seg * 5 + 1) * (WIN.w - 80) + (X0.hash(ff * 3) - 0.5) * 4, y0 = WIN.y + X0.hash(seg * 3 + 7) * WIN.h * 0.4, y1 = y0 + WIN.h * (0.3 + 0.6 * X0.hash(seg * 9));
        ctx.strokeStyle = `rgba(255,255,255,${(0.12 + 0.12 * X0.hash(ff * 5 + 1)).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + 2, y1); ctx.stroke(); }
    }
    // the cold: a faint breath of blue-grey over the frozen frame (still grey, just cooler), the vignette deepens a
    // little, the grain comes up
    if (cold > 0) { ctx.save(); ctx.globalCompositeOperation = "color"; ctx.fillStyle = `rgba(70,105,150,${(0.045 * cold).toFixed(3)})`; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h); ctx.restore(); }
    const g = ctx.createRadialGradient(WIN.cx, WIN.cy, WIN.h * 0.32, WIN.cx, WIN.cy, Math.hypot(WIN.w, WIN.h) * 0.56);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${(0.34 + 0.12 * cold).toFixed(3)})`); ctx.fillStyle = g; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    if (t >= FREEZE && t < FREEZE + F(1)) { ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h); }
    X0.grain(ctx, 1080, 1920, t, 0.1 + 0.07 * cold, 0.8);
    ctx.restore();
    return { sh, src };
  }

  // ------------------------------------------------------------------------------------------------ the hero in the window
  function drawHero(S, t, hole, layer) {
    const { ctx, A } = S, h = hero(t);
    if (h.fall > WIN.h + 290) return;
    const falling = t >= 19.04, y = HERO.y + h.fall;
    const base = { drop: h.drop, sway: h.sway, show: { bar: false } };
    if (layer === "back") {   // his head behind the paper's edge (and, once he has let go, all of him), clipped to the hole
      ctx.save(); ctx.clip(hole);
      X0.hang(ctx, A, HERO.x, y, HERO.size, null, { ...base, show: { bar: false, hands: false }, eyes: h.eyes, blink: h.blink, bob: h.nod });
      if (falling) X0.hang(ctx, A, HERO.x, y, HERO.size, null, { ...base, show: { bar: false, head: false }, reach: [reach(t, 0), reach(t, 1)] });
      ctx.restore();
    } else if (!falling) {    // his gloves over the edge, in front of the paper
      for (const side of [0, 1]) {
        const r = reach(t, side); if (r && r.hide) continue;
        const rr = [{ hide: true }, { hide: true }]; rr[side] = r;
        ctx.save(); ctx.globalAlpha *= gloveAlpha(t, side); ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = 7; ctx.shadowOffsetY = 3;
        X0.hang(ctx, A, HERO.x, y, HERO.size, null, { ...base, show: { bar: false, head: false }, reach: rr.map((q) => q === null ? undefined : q), grip: t >= 18.82 && t < 19.0 ? 0.12 * E.io(fr(t, 18.82, 0.12)) : 0 });
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ paper things
  /** A bot's dotted head recoloured to ink (Notes): the coloured dots go ink, the white dots stay white. */
  function inkHead(S) {
    if (cache.ink) return cache.ink;
    const im = S.A["head-keybot"], cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height;
    const c = cv.getContext("2d"); c.drawImage(im, 0, 0); const d = c.getImageData(0, 0, cv.width, cv.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 3, k = clamp((l - 105) / 150); const v = Math.round(74 + (255 - 74) * k); p[i] = p[i + 1] = p[i + 2] = v; }
    c.putImageData(d, 0, 0); return (cache.ink = cv);
  }
  /** A colour head with its coloured dots pulled toward the bot's own hex (a second pass of itself in multiply), so the
   *  four heads carry equal weight on the small cards: white dots stay white, clay reads clay, not salmon. */
  const HEAD_MULT = 0.5;
  function headImg(S, key) {
    if (key === "ink") return inkHead(S);
    const ck = "h_" + key; if (cache[ck]) return cache[ck];
    const im = S.A[key], cv = document.createElement("canvas"); cv.width = im.width; cv.height = im.height;
    const c = cv.getContext("2d"); c.drawImage(im, 0, 0); c.globalAlpha = HEAD_MULT; c.globalCompositeOperation = "multiply"; c.drawImage(im, 0, 0);
    return (cache[ck] = cv);
  }
  /** A head on a card or the strip; from the first slam the heads go ink grey over 6 f (the window goes cold with
   *  them), so the clay underline is the frame's one colour. */
  function drawHead(S, t, key, x, y, s) {
    const { ctx } = S, g = S.T.slam1 != null ? fr(t, S.T.slam1, F(6)) : 0;
    ctx.save(); if (g > 0) ctx.filter = `saturate(${(1 - g).toFixed(3)})`; ctx.imageSmoothingQuality = "high"; ctx.drawImage(headImg(S, key), x, y, s, s); ctx.restore();
  }
  function tape(S, cx, cy, w, rot) { const { ctx, A } = S, h = w * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -w / 2, -h / 2, w, h); ctx.restore(); }
  function paperCard(S, x, y, w, h, r) {
    const { ctx, A } = S;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.22)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6; ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, r); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.75 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
  }
  /** One of the four 0.2w cards: the bot's dotted head above its name, taped into the lower margin, pressed in over 6 f. */
  function botCard(S, t, i, at) {
    const k = fr(t, at, F(6)); if (k <= 0) return;
    const { ctx } = S, b = BOTS[i], w = CARD.w, h = CARD.h, cx = CARD.cx[i], x = cx - w / 2, y = CARD.y, cy = y + h / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(CARD.rot[i]); const ps = 1.14 - 0.14 * E.o5(k); ctx.scale(ps, ps); ctx.translate(-cx, -cy); ctx.globalAlpha *= Math.min(1, k * 2);
    paperCard(S, x, y, w, h, 16);
    const hs = 92; drawHead(S, t, b.head, cx - hs / 2, y + 14, hs);
    X0.text(ctx, b.name, cx, y + 150, X0.font(600, 44), C.ink, "center");
    tape(S, cx + CARD.tapeDx[i], y + 3, 118, CARD.tapeRot[i]);
    ctx.restore();
  }
  /** The strip beneath the cards: five small heads (clay, ochre, sea, moss, ink) and "Ask any bot". */
  function strip(S, t, at) {
    const k = fr(t, at, F(6)); if (k <= 0) return;
    const { ctx } = S, f = X0.font(600, 49), tw = X0.width(ctx, "Ask any bot", f), hs = 46, hg = 5, gap = 24, pad = 43;
    const cw = 5 * hs + 4 * hg + gap + tw, w = cw + 2 * pad, h = STRIP.h, x = 540 - w / 2, y = STRIP.cy - h / 2;
    ctx.save(); ctx.translate(540, STRIP.cy); ctx.rotate(0.012); const ps = 1.12 - 0.12 * E.o5(k); ctx.scale(ps, ps); ctx.translate(-540, -STRIP.cy); ctx.globalAlpha *= Math.min(1, k * 2);
    paperCard(S, x, y, w, h, 14);
    for (let j = 0; j < 5; j++) {
      const kj = E.back(2.2)(fr(t, at + 0.04 + j * 0.085, F(4))); if (kj <= 0) continue;
      const hx = x + pad + j * (hs + hg) + hs / 2, s = hs * kj; drawHead(S, t, STRIP_HEADS[j], hx - s / 2, STRIP.cy - s / 2, s);
    }
    X0.text(ctx, "Ask any bot", x + pad + 5 * hs + 4 * hg + gap, STRIP.cy + 17, f, C.ink);
    tape(S, x + 26, y + 6, 100, -0.5); tape(S, x + w - 26, y + 6, 100, 0.45);
    ctx.restore();
  }
  /** The narration, handwritten in ink in the top margin on the voice's word times (one centred line, a wipe per word). */
  function narration(S, t) {
    const { ctx } = S, f = X0.font(700, CAPTION.size, "Caveat");
    for (const line of VO) {
      const v = S.V[line.key]; if (t < line.at + v.words[0].t0 - 0.06 || t >= line.out + F(5)) continue;
      const out = E.io(fr(t, line.out, F(5)));
      if (!line._lay) { ctx.save(); ctx.font = f; const sp = ctx.measureText(" ").width; let x = 0; line._lay = v.words.map((w) => { const ww = ctx.measureText(w.text).width, o = { ...w, x, ww }; x += ww + sp; return o; }); line._w = x - sp; ctx.restore();
        if (CAPTION.cx + line._w / 2 > 950 || CAPTION.cx - line._w / 2 < 54) console.warn(`01 narration ${line.key} is ${line._w.toFixed(0)} px wide: outside the safe band`); }
      const x0 = CAPTION.cx - line._w / 2;
      ctx.save(); ctx.globalAlpha *= 1 - out;
      for (const w of line._lay) {
        const k = fr(t, line.at + w.t0 - 0.05, F(4)); if (k <= 0) continue;
        const x = x0 + w.x; ctx.save(); ctx.beginPath(); ctx.rect(x - 8, CAPTION.base - CAPTION.size, (w.ww + 16) * E.o3(k), CAPTION.size * 1.6); ctx.clip();
        ctx.translate(x, CAPTION.base + (X0.hash((w.t0 * 1000) | 0) - 0.5) * 4); ctx.rotate((X0.hash((w.t1 * 977) | 0) - 0.5) * 0.035);
        X0.text(ctx, w.text, 0, 0, f, C.ink); ctx.restore();
      }
      ctx.restore();
    }
  }
  /** The headline: heavy ink Geist, two centred lines slammed (1.08 -> 1.00 in 3 f), 'team' in Caveat, the clay brush underline. */
  // the 0.08w cap tier (13 characters), centred on the window (540): line 1 stays left of 0.88w, and the descenders
  // keep their distance from the torn edge and the gloves
  const HL = { cx: 540, lines: ["He had a team", "Now you do"], hand: "team", cap: 0.08 * 1080, top: 0.12 * 1920 + 3, right: 940 };   // right: 948 less the Caveat overhang (~7 px)
  function headlineLayout(S) {
    if (HL.lay) return HL.lay;
    const { ctx } = S; ctx.save(); ctx.font = X0.font(900, 100); const capR = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    const size = Math.round(HL.cap / capR), b1 = Math.round(HL.top + HL.cap), b2 = Math.round(b1 + size * 1.08);
    const lines = HL.lines.map((s, i) => X0.layout(ctx, s.split(" ").map((w) => (w === HL.hand ? { text: w, hand: true, handWeight: 700, scale: 1.15 } : { text: w })), { x: HL.cx, y: i ? b2 : b1, size, weight: 900, color: C.ink, align: "center" }));
    lines.forEach((l, i) => { if (l.w > 1026) console.warn(`01 headline line ${i + 1} is ${l.w.toFixed(0)} px (> 1026)`); });
    HL.lay = { size, base: [b1, b2], lines, capR };
    if (S.q.get("measure")) console.warn(`01 headline: size ${size}px (cap ${HL.cap.toFixed(1)}), widths ${lines.map((l) => l.w.toFixed(0) + " (x " + (HL.cx - l.w / 2).toFixed(0) + ".." + (HL.cx + l.w / 2).toFixed(0) + ")").join(" / ")}, baselines ${b1} ${b2}`);
    return HL.lay;
  }
  function headline(S, t, T) {
    if (t < T.slam1) return;
    const { ctx, A } = S, L = headlineLayout(S);
    L.lines.forEach((line, i) => {
      const at = i ? T.slam2 : T.slam1; if (t < at) return;
      // the slam scales about the line's centre, moved right just enough that the 1.08 frame stays left of 0.88w
      const s = 1.08 - 0.08 * E.o3(fr(t, at, F(3))), cy = L.base[i] - HL.cap / 2, R = line.x + line.w;
      const ax = s > 1 ? Math.max(HL.cx, (s * R - HL.right) / (s - 1)) : HL.cx;
      ctx.save(); ctx.translate(ax, cy); ctx.scale(s, s); ctx.translate(-ax, -cy); X0.drawLine(ctx, line); ctx.restore();
    });
    const hw = L.lines[0].words.find((w) => w.hand), im = A["ul-bar"], uw = Math.min(hw.w * 1.04, HL.right - (hw.x - hw.w * 0.02)), uh = Math.max(20, uw * im.height / im.width);
    X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2, hw.y + L.size * 0.045, uw, uh, E.io(fr(t, T.ul, 0.5)), "x", { rot: -0.014, rag: 10, seed: 2 });
  }

  /**
   * The campaign end card, AD.endCard exactly as built, with one repair: in AD.markPaint the 0's stroke is clipped at
   * 0.52 mw before its 0.74 squeeze, so the X's right tips (squeezed to ~0.536 mw) leak into it as a sliver and the mark
   * reads "X:0". While the card draws, the 0 stroke's layer is cleared left of 0.545 mw (the squeezed 0 starts at
   * ~0.571 mw) before it is revealed. Nothing else changes, and once the kit clips at 0.545 this is a no-op.
   */
  function endCard(S, t, t0) {
    if (t < t0) return;
    const rv = X0.reveal;
    X0.reveal = function (ctx, im, x, y, w, h, k, dir, o) {
      // putImageData ignores the layer's clip and transform, so its antialiased clip edge is cleared too
      if (dir === "conic" && im && im.getContext && Math.abs(w - im.width) < 2) im.getContext("2d").putImageData(new ImageData(Math.ceil(im.width * 0.545), im.height), 0, 0);
      return rv.apply(this, arguments);
    };
    try { AD.endCard(S, t, t0); } finally { X0.reveal = rv; }
  }

  // ------------------------------------------------------------------------------------------------ the page
  AD.start({
    footage: {
      a1: { dir: "../footage-01-a1/", frames: 92, fps: 24 }, a2: { dir: "../footage-01-a2/", frames: 77, fps: 24 }, b: { dir: "../footage-01-b/", frames: 132, fps: 24 },
      c: { dir: "../footage-01-c/", frames: 117, fps: 30 }, d1: { dir: "../footage-01-d1/", frames: 57, fps: 30 }, d2: { dir: "../footage-01-d2/", frames: 259, fps: 24 }, e1: { dir: "../footage-01-e1/", frames: 78, fps: 30 }, e2: { dir: "../footage-01-e2/", frames: 60, fps: 30 },
    },
    voices: Object.fromEntries(Object.keys(SCRIPTS).map((k) => [k, `../voice/01-${k.slice(1)}.json`])),
    scripts: SCRIPTS,
    duration: DURATION,
    timeline(S) {
      const T = { freeze: FREEZE, end0: END0 };
      const last = (k) => { const v = S.V[k]; return v.words[v.words.length - 1].t0; };
      T.cards = BOTS.map((b) => VO.find((l) => l.key === b.vo).at + last(b.vo));   // each card lands on the job's word
      T.strip = VO[4].at + last("v5");                                              // the strip on "through"
      const h = S.V[HEAD_VO.key].words; T.slam1 = HEAD_VO.at + h[0].t0 + 0.1; T.slam2 = HEAD_VO.at + h[4].t0 + 0.07; T.ul = T.slam2 + 0.3;
      return T;
    },
    frame(t, S) {
      const { ctx } = S, T = S.T;
      if (t < END0 + F(15)) {
        const hole = holePath(holePts(t));
        const info = film(S, t, hole); drawHero(S, t, hole, "back");
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(paperLayer(S, t), 0, 0); ctx.restore();
        drawHero(S, t, hole, "front");
        narration(S, t);
        BOTS.forEach((b, i) => botCard(S, t, i, T.cards[i]));
        strip(S, t, T.strip);
        headline(S, t, T);
        X0.grain(ctx, 1080, 1920, t, 0.035, 1);
        if (S.q.get("hud") && info) X0.text(ctx, `${info.sh.key} src ${info.src.toFixed(2)}`, 16, 1868, X0.font(500, 24, "GeistMono"), "#ff6060");
      }
      endCard(S, t, END0);
    },
    cues(S) {
      const T = S.T, c = [];
      // the paper tear: a ripping breath and the fibres giving, irregular (the tear runs TEAR_LEAD ahead: open by 0.5)
      c.push({ at: 0.0, kind: "whoosh", dur: 0.54, up: true, gain: 1.7 }, { at: 0.0, kind: "paper-thud", gain: 0.4 });
      for (let i = 0; i < 18; i++) { const at = 0.01 + 0.49 * Math.pow(i / 18, 0.85) + 0.01 * (X0.hash(i * 7 + 1) - 0.5); c.push({ at: Math.max(0, at), kind: i % 3 ? "tick" : "click", gain: 0.6 + 0.8 * X0.hash(i * 13 + 2) }); }
      // the bed: a drone in D, a projector gate on a dry hat at 96 bpm from 1.0, a faint motor; far bells with their own echo
      c.push({ at: 0, kind: "drone", f: 73.42, dur: END0 + 0.6, gain: 0.34, a: 1.4, r: 1.0 });
      c.push({ at: 1.0, kind: "fan", dur: FREEZE - 1.0 + 0.5, gain: 0.16 });
      for (let t = 1.0; t < FREEZE - 0.05; t += 60 / 96) { c.push({ at: t, kind: "tick", gain: 0.3 }); if (t + 30 / 96 < FREEZE) c.push({ at: t + 30 / 96, kind: "tick", gain: 0.1 }); }
      const FAR = [[1.6, 587.33], [3.4, 880], [5.3, 739.99], [7.0, 587.33], [8.9, 987.77], [10.6, 739.99], [12.3, 880]];
      for (const [at, f] of FAR) for (const [dt, g] of [[0, 0.055], [0.19, 0.032], [0.41, 0.02], [0.66, 0.012]]) c.push({ at: at + dt, kind: "bell", f, dur: 2.6, gain: g });
      // the station: a far whistle, two soft sines in the key, very low under the train
      c.push({ at: 6.42, kind: "drone", f: 293.66, dur: 1.5, gain: 0.07, a: 0.25, r: 0.9 }, { at: 6.42, kind: "drone", f: 369.99, dur: 1.5, gain: 0.05, a: 0.3, r: 0.9 });
      // the hero: a soft knock as each glove takes the edge, a breath as he swings down
      for (const g of [1.40, 1.47]) c.push({ at: g + F(3), kind: "click", gain: 0.45 }, { at: g + F(3), kind: "paper-thud", gain: 0.3 });
      c.push({ at: 1.55, kind: "whoosh", dur: 0.4, up: false, gain: 0.22 });
      // the voice, a pen scratch per handwritten word
      for (const l of VO) { c.push({ at: l.at, kind: "sample", file: `../voice/01-${l.key.slice(1)}.wav`, gain: 1.2 });
        for (const w of S.V[l.key].words) c.push({ at: l.at + w.t0, kind: "whoosh", dur: 0.08, up: true, gain: 0.16 }, { at: l.at + w.t0 + 0.02, kind: "tick", gain: 0.06 }); }
      c.push({ at: HEAD_VO.at, kind: "sample", file: "../voice/01-6.wav", gain: 1.2 });
      // the cards: a tape rip, the slap, the bot's bell; the strip: all five bells quickly in a row
      BOTS.forEach((b, i) => { const at = T.cards[i]; c.push({ at: at - 0.13, kind: "whoosh", dur: 0.13, up: true, gain: 0.4 }, { at, kind: "click", gain: 0.5 }, { at, kind: "paper-thud", gain: 0.5 }, { at: at + F(1), kind: "bell", f: b.note, dur: 1.4, gain: b.note < 250 ? 0.5 : 0.4 }); });
      c.push({ at: T.strip - 0.13, kind: "whoosh", dur: 0.13, up: true, gain: 0.4 }, { at: T.strip, kind: "click", gain: 0.5 }, { at: T.strip, kind: "paper-thud", gain: 0.5 });
      STRIP_NOTES.forEach((f, j) => c.push({ at: T.strip + 0.04 + j * 0.085, kind: "bell", f, dur: 1.2, gain: f < 250 ? 0.42 : 0.32 }));
      // the freeze: everything stops but the drone
      c.push({ at: FREEZE, kind: "freeze", gain: 0.65 });
      // the headline: two booms, a brush swish, the drone opens to a fifth
      c.push({ at: T.slam1, kind: "boom", gain: 0.7 }, { at: T.slam2, kind: "boom", gain: 0.7 }, { at: T.ul, kind: "whoosh", dur: 0.45, up: false, gain: 0.4 });
      c.push({ at: T.slam1 - 0.1, kind: "drone", f: 110, dur: END0 - T.slam1 + 0.7, gain: 0.24, a: 0.9, r: 0.8 });
      // he lets go and drops
      c.push({ at: 18.84, kind: "click", gain: 0.25 }, { at: 19.0, kind: "whoosh", dur: 0.42, up: false, gain: 0.5 });
      return c.concat(AD.endCues(END0));
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
