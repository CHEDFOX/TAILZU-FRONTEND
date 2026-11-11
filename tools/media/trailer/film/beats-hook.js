/* THE HOOK (f0-f64), THE PILE-UP (f64-f128), THE LOOK AND THE STRIKE (f128-f176), UP AND OVER (f176-f256).
 *
 * One hero transform (L.hero) opens the film: he hangs asleep, breathing, eyes two cream slits; the eyes snap open at
 * f10; the first thing falls at f30 and lands at f48; by f128 a wordless heap towers at the right behind him while the
 * headline 'It all / piles up' writes bottom-left; he looks, holds, blinks, narrows, strikes the words out at f168;
 * then the app's own launch motion plays whole but tight (the Plan exit's recipe: gather f176-f180 and pull f180-f190 at
 * the app's own speed, a 4 f spring, the come-back at 1.5x: gloves f194/f195, pinch f201, suck f203-f208, gone f208) and
 * he pops from behind the heap's top card at f209, is up by f218 and holds on you to the cut, with a blink-dip or two.
 * (The page has no face only f186-f209, 0.75 s; the bar alone, doing nothing a phone can see, only f190-f194.)
 *
 * Everything is a pure function of the frame. The heap (its table, physics and items) lives in common.js so the
 * episodes can show its tail; this file owns the eyes, the gaze, the headline timings, the launch clock and the peek.
 */
(() => {
  "use strict";
  const { E, K, clamp, lerp, deg } = X0;
  const { fr } = CM;

  // ------------------------------------------------------------------------------------------------ frames
  const F = {
    snap: 10,            // the eyes snap open (6 f)
    lookR: 22,           // a glance right (4 f), back from 27
    card: 48, note: 64,  // the two landings of the hook
    l1: 88, l2: 96, hand: 100, ul: 104,   // the headline's write-on
    widen: 96, sway: 96, grip: 112,
    ring: 128,           // the last landing
    lookHeap: 128, lookYou: 136, hold: 144, blink: 160, narrow: 164, strike: 168, tilt: 175,
    launch: 176,         // t_launch = 420 ms here
    gone: 208, pop: 209, peekBlink: [226, 244],   // the peek's blink-dips (the second falls after the cut if it moves to f240)
  };
  /**
   * The launch clock (ms of the engine's launch motion), the Plan exit's recipe: the gather f176-f180 (420 -> 560) and
   * the pull f180-f190 (560 -> 900) at the app's own speed (let-go f184/f186), a short spring f190-f194 (900 -> 1250),
   * then the come-back at 1.5x f194-f208 (1400 -> 2120: gloves back f194/f195, pinch f201, suck f203, gone f208).
   */
  function tLaunch(f) {
    if (f < F.launch + 4) return 420 + (f - F.launch) * 35;
    if (f < F.launch + 14) return 560 + (f - F.launch - 4) * 34;
    if (f < F.launch + 18) return 900 + (f - F.launch - 14) * 87.5;
    if (f < F.gone) return 1400 + (f - F.launch - 18) * (720 / 14);
    return X0.hang.GONE_AT + 10;
  }

  // ------------------------------------------------------------------------------------------------ the eyes
  /** The eye snap, frame by frame from f10: slits to open with a 1.06 overshoot on the 4th frame. */
  const SNAP = [0.08, 0.46, 0.80, 0.98, 1.06, 1.02];
  /** The lids: sy (open-ness) and sx (width) of each eye, by frame. */
  function lids(f) {
    let sy = f < F.snap ? 0.08 : f < F.snap + SNAP.length ? SNAP[f - F.snap] : 1;
    const wide = 1 + 0.15 * E.io(fr(f, F.widen, 16));            // f96-f112: the eyes widen as the heap grows
    let sx = wide; sy *= wide;
    if (f >= F.blink && f < F.blink + 2) sy = 0.08;               // f160: one blink, 2 f shut, open on the 3rd
    if (f >= F.narrow) sy = lerp(wide, 0.72, E.io(fr(f, F.narrow, 4)));   // f164-f168: determination
    if (f >= F.launch) sy = lerp(0.72, 1, E.io(fr(f, F.launch, 4)));      // the gather: the lids relax before the pull
    return { sx, sy };
  }
  /**
   * What he is looking at while things fall: the latest heap item that had entered two frames ago (the lag), where it
   * was then; a new item takes the gaze over 3 f from the last one (or from the centre).
   */
  function trackTarget(S, f) {
    const g = f - 2, items = CM.heap(S, g);
    if (!items.length) return null;
    const cur = items[items.length - 1], since = g - (cur.land - CM.FALL_F);
    const to = { x: cur.x, y: cur.y };
    if (since >= 3) return to;
    const prev = items.length > 1 ? items[items.length - 2] : null, k = E.o3((since + 1) / 3);
    if (!prev) return { ...to, blend: k };
    return { x: lerp(prev.x, to.x, k), y: lerp(prev.y, to.y, k) };
  }
  /** The gaze as hang()'s eyes { dx, dy } in art px, by frame. */
  function gaze(S, f) {
    if (f >= F.hold) return { dx: 0, dy: 0 };                                   // straight at you, and through the launch
    if (f >= F.lookYou) { const k = E.io(fr(f, F.lookYou, 8)); return { dx: 16 * (1 - k), dy: 12 * (1 - k) }; }
    if (f >= F.lookHeap) {                                                        // down-right to the heap
      const from = trackGaze(S, F.lookHeap), k = E.io(fr(f, F.lookHeap, 8));
      return { dx: lerp(from.dx, 16, k), dy: lerp(from.dy, 12, k) };
    }
    if (f >= 32) return trackGaze(S, f);
    if (f >= F.lookR + 5) return { dx: 12 * (1 - E.io(fr(f, F.lookR + 5, 4))), dy: 0 };
    if (f >= F.lookR) return { dx: 12 * E.io(fr(f, F.lookR, 4)), dy: 0 };
    return { dx: 0, dy: 0 };
  }
  function trackGaze(S, f) {
    const t = trackTarget(S, f); if (!t) return { dx: 0, dy: 0 };
    const g = CM.gazeAt(S, "hero", t.x, t.y, 16);
    return t.blend != null ? { dx: g.dx * t.blend, dy: g.dy * t.blend } : g;
  }

  // ------------------------------------------------------------------------------------------------ the body
  /** His breathing: the shared bob, frozen through the comic hold (f144-f160) and eased back in over the blink. */
  function bob(f) {
    if (f < F.hold) return CM.bob(f);
    if (f < F.blink) return CM.bob(F.hold);
    return lerp(CM.bob(F.hold), CM.bob(f), E.io(fr(f, F.blink, 8)));
  }
  /** The head's lean (degrees): away from the heap from f96, a -3 tilt at f175 as the strike lands, fading in the pull. */
  function sway(f) {
    let s = 4 * E.io(fr(f, F.sway, 16));
    if (f >= F.tilt) s -= 3 * E.o3(fr(f, F.tilt, 3));
    if (f >= F.launch + 4) s *= 1 - E.io(fr(f, F.launch + 4, 6));
    return s;
  }
  /** hang()'s options for the hook, the pile and the strike (and the launch, where its own motion takes over). */
  function hangOpts(S, f) {
    const { sx, sy } = lids(f), { dx, dy } = gaze(S, f);
    const t = f >= F.launch ? tLaunch(f) : 0;
    // the gloves squeeze the bar from f112 (grip 0 -> 0.22 over 9 f); the launch's own grip replaces it from t 560
    const grip = 0.22 * E.o3(fr(f, F.grip, 9)) * (1 - E.smooth(K(t, 560, 680)));
    return {
      eyes: { dx, dy, each: [{ sx, sy }, { sx, sy }] },
      bob: bob(f),
      sway: sway(f),
      sq: 1 - 0.03 * Math.sin(Math.PI * fr(f, F.snap, 6)),   // the head squashes 1 -> 0.97 -> 1 with the snap
      grip,
    };
  }

  // ------------------------------------------------------------------------------------------------ the words
  /** 'It all / piles up' (Geist 900 120, 'up' in Caveat 138 with the ink underline), struck through from f168. */
  function headline(S, f) {
    const P = S.L.pileHead;
    return CM.headline(S, f, {
      lines: ["It all", "piles up"], hand: { line: 1, word: "up" }, ul: S.A["ul-ink"],
      at: { l1: F.l1, l2: F.l2, hand: F.hand, ul: F.ul }, size: P.size, handSize: P.hand, base: P.base, x: S.L.textX,
      strike: { f: F.strike, img: S.A["strike-ink"], line: 1 },
    });
  }
  /** The dentist note's handwriting writes on during its fall (f46-f58), so it is whole when it lands. */
  const noteK = (f) => E.o3(fr(f, F.note - CM.FALL_F, 12));

  // ------------------------------------------------------------------------------------------------ the peek
  /** The ring card's wobble (radians) as he pops from behind it: +-2 deg over 4 f from f209. */
  function wobble(f) { if (f < F.pop || f >= F.pop + 4) return 0; const k = fr(f, F.pop, 4); return deg(2) * Math.cos(k * Math.PI * 2) * (1 - k * 0.5); }
  /**
   * Bot-curious rising behind the heap's top card: the gloves slide up from behind its top edge first (fingers folding
   * over it) while the face pops (E.back 1.35, 9 f from f209: up by f218). The rig rides the card's tilt so the gloves
   * grip its real edge. Through the hold he blinks the way a peeking face blinks in this film (Travel's blink-dip): the
   * whole rig drops 20 px behind the card for 2 f. (The old 6 px glance did not survive phone scale and is gone.)
   */
  function peekFromHeap(S, f) {
    const { ctx, R } = S;
    const ring = CM.heap(S, F.ring).find((it) => it.id === "ring"), half = CM.ITEM.ring.h / 2;
    const ex = ring.x + Math.sin(ring.rot) * half, ey = ring.y - Math.cos(ring.rot) * half;   // the top edge's middle
    const w = 440, fm = R.meta["bot-curious-nohands"], s = w / fm.w, faceH = fm.h * s;
    const rise = f < F.pop ? 0 : E.back(1.35)(fr(f, F.pop, 9));
    const dip = F.peekBlink.some((b) => f >= b && f < b + 2) ? 20 : 0;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ring.rot);
    if (rise > 0) X0.peekRig(ctx, R, "curious", 0, 0, w, rise, { dy: dip, gloves: [{ hide: true }, { hide: true }] });
    ["glove-L", "glove-R"].forEach((n, i) => {
      const gm = R.meta[n], im = R.img[n];
      const gx = -w / 2 + (gm.x0 - fm.x0) * s, gy = -fm.ledge * s + (gm.y0 - fm.y0) * s, gw = gm.w * s, gh = gm.h * s, below = gh - gm.ledge * s;
      const up = E.o3(fr(f, F.pop + i, 4)), over = up >= 1 ? fr(f, F.pop + 4 + i, 2) : 0;
      ctx.save(); ctx.beginPath(); ctx.rect(-w, -3 * faceH, 2 * w, 3 * faceH + over * (below + 2)); ctx.clip();
      ctx.drawImage(im, gx, gy + (1 - up) * 60 + dip, gw, gh); ctx.restore();
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the beats
  FILM.register({
    name: "hook", f0: 0, f1: 64,
    draw(S, f) {
      CM.drawHeap(S, f, { noteK: noteK(f) });          // layer 5: the chat card from f30, the note from f46, behind him
      CM.hero(S, "hero", null, hangOpts(S, f));         // layer 6
    },
    cues() {
      return [
        { f: F.snap, kind: "tick", gain: 0.2 },
        { f: F.card, kind: "paper-thud", gain: 0.25 },
        { f: F.note, kind: "paper-thud", gain: 0.3 },
      ];
    },
  });

  FILM.register({
    name: "pile", f0: 64, f1: 128,
    draw(S, f) {
      CM.drawHeap(S, f);
      CM.hero(S, "hero", null, hangOpts(S, f));
      headline(S, f);
    },
    cues() {
      const lands = CM.HEAP.filter((it) => it.land > 64 && it.land < 128).map((it) => it.land);
      return [
        { f: 64, kind: "riser", dur: 64 / 30, gain: 0.5 },
        ...lands.map((f, i) => ({ f, kind: "paper-thud", gain: +(0.3 + 0.4 * i / (lands.length - 1)).toFixed(3) })),
        { f: F.l1, kind: "tick", gain: 0.3 }, { f: F.l2, kind: "tick", gain: 0.3 },
        { f: F.hand, kind: "write", gain: 0.4 },
        { f: F.ul, kind: "whoosh", dur: 0.25, up: false, gain: 0.25 },
      ];
    },
  });

  FILM.register({
    name: "strike", f0: 128, f1: 176,
    draw(S, f) {
      CM.drawHeap(S, f);
      CM.hero(S, "hero", null, hangOpts(S, f));
      headline(S, f);
    },
    cues() {
      return [
        { f: F.ring, kind: "boom", gain: 0.45, f0: 62, f1: 36 },
        { f: F.blink, kind: "click", gain: 0.5 },
        { f: F.strike, kind: "whoosh", dur: 0.25, up: false, gain: 0.45 },
      ];
    },
  });

  FILM.register({
    name: "launch", f0: 176, f1: 256,
    draw(S, f) {
      CM.drawHeap(S, f, { ringRot: wobble(f) });
      if (f < F.pop) CM.hero(S, "hero", tLaunch(f), hangOpts(S, f));
      else peekFromHeap(S, f);
      headline(S, f);   // the struck words hold to the cut
    },
    cues() {
      const L = F.launch;   // the cues ride the launch clock above: pull f180, spring f190, gloves f194/f195, pinch f201, suck f203
      return [
        { f: L + 4, kind: "whoosh", dur: 0.35, up: true, gain: 0.5 },
        { f: L + 14, kind: "boing", gain: 0.4 },
        { f: L + 18, kind: "land", gain: 0.3 }, { f: L + 19, kind: "land", gain: 0.3 },
        { f: L + 25, kind: "click", gain: 0.35 },
        { f: L + 27, kind: "whoosh", dur: 0.3, up: false, gain: 0.35 },
        { f: F.pop, kind: "open", gain: 0.6 }, { f: F.pop, kind: "land", gain: 0.5 },
        ...F.peekBlink.filter((b) => b < 256).map((b) => ({ f: b, kind: "tick", gain: 0.15 })),
      ];
    },
  });
})();
