/* THE HOLD (spot 06): Travel, and the value: it finds, you always press pay. The Precisionist: the camera never gets
 * excited, the cut does; a wall clock under everything; tension held one beat past comfort, released by the smallest sound.
 *
 * Four held things, each frozen a frame before it goes (a sprinter set, a hand over a chess piece, a train at a night
 * platform, bare feet on a pool's edge), each freeze going cold with a Travel card taped on; then white paper: the four
 * cards small along the top, the question card ('Pay for / 2 tickets?') with a dip-pen 'Yes' and a smaller 'Not now';
 * the hero lowers in on his bar, looks at the button, looks at us, blinks, and waits five seconds without touching it; a
 * hand writes 'yes', a stamp says Paid, the clock stops, and the whole held world moves at once: four hard cuts, then the
 * train pulling away at half speed under the headline 'It finds / You press pay'. The campaign's end card, the hero
 * looking and waiting.
 *
 * Footage (one grade: contrast up, saturation -40 to -55 %, cool, heavy grain, vignette, thin ink letterbox bars; each
 * clip white-balanced into it, LOOK):
 *   a  ../footage-06-a/  Mixkit 588, a sprint start, 8.2-10.6 s, crop 0.47,0,0.316,1, 24 fps (no interpolation). The
 *                        release shows a clothing wordmark on her left thigh: it is masked frame by frame (LOGO_A), and
 *                        the leg's outer edge is redrawn over the patches (legEdge).
 *   b  ../footage-06-b/  Mixkit 5338, a hand over a chess piece, 3.5-6.5 s, crop 0.66,0,0.316,1, 24 fps.
 *   c  ../footage-06-c/  Coverr 'blue subway departing' (native 9:16), 8.4-12.6 s, motion-interpolated to 72 fps (the
 *                        hold and the tail run at 0.5x). Cleaned in cleanC: the livery is graded out (yellow to the
 *                        body's grey, blue to grey), the cab's emblem and car number are painted out on tracked patches,
 *                        and the far wall's poster and station name are replaced by the wall's own tiles from a clean
 *                        plate, revealed only right of the departing train's rear edge.
 *   e  ../footage-06-e/  Mixkit 23078, bare feet on a pool's edge, then the push-off, 0-3.6 s, crop 0.405,0,0.3164,1,
 *                        25 fps (real speed, no interpolation). It replaces the 1951 archive diver (NARA 111-LC-46063,
 *                        use restriction 'Copyright: Restricted - Possibly'); footage-06-d is no longer used.
 * Sound: sound.mjs kinds plus spots/06-sfx/ (node spots/06-sound.mjs): the clock, four ambiences (their last second,
 * amb-*-1s.wav, so each cuts dead on its freeze), tape, pen, stamp, the four releases, the train, the thin sine. No
 * voice: the film is built to be mute.
 */
(function () {
  "use strict";
  const { C, E, clamp } = X0;
  const FPS = 30, F = (n) => n / FPS, fr = AD.fr, lerp = AD.lerp;

  // ------------------------------------------------------------------------------------------------ the timeline (the bible's seconds)
  // Each hold freezes 1.0 s into its shot and its card tapes on 0.1 s later, so every card reads for 0.9 s before the cut.
  const T = {
    holds: [
      { key: "a", t0: 0.3, t1: 2.3, fz: 1.3, card: 1.4, text: "Flights found" },
      { key: "b", t0: 2.3, t1: 4.3, fz: 3.3, card: 3.4, text: "Stay found" },
      { key: "c", t0: 4.3, t1: 6.3, fz: 5.3, card: 5.4, text: "Weather checked" },
      { key: "e", t0: 6.3, t1: 8.3, fz: 7.3, card: 7.4, text: "Packing list made" },
    ],
    paper: 8.3, slide: F(10),
    heroIn: 8.8, heroDown: 9.3, lookDown: 9.8, lookUp: 10.5, blinks: [11.3, 12.9], waits: 11.7, waitsDur: 0.3,
    yes0: 13.8, yes1: 14.5, stamp: 14.5,
    rel: 14.8, cut: F(11), slow: 16.3,
    l1: 16.6, l2: 17.0, hand0: 17.2, hand1: 17.8, ul0: 17.8, ul1: 18.1,
    end0: 21.8,
  };
  T.cuts = [0, 1, 2, 3].map((i) => T.rel + i * T.cut);                  // 14.80, 15.17, 15.53, 15.90
  T.duration = T.end0 + AD.END_S;                                        // the kit's card runs 4.9 s: 0.4 s past the bible's 26.3

  // The footage's clocks (seconds into each folder). Holds: real time (the train 0.5x) into the freeze; releases: at speed.
  const SRC = {
    a: AD.map([[0.3, 0.5], [1.3, 1.5]]),                                 // 1.0x: hips up into the set, frozen on idx 37
    b: AD.map([[2.3, 0.25], [3.3, 1.25]]),                               // 1.0x: the hand comes down and hovers, frozen clear of the piece
    c: AD.map([[4.3, 0.79], [5.3, 1.29]]),                               // 0.5x: the last car slides, frozen at its doors
    e: AD.map([[6.3, 0.8], [7.3, 1.8]]),                                 // 1.0x: the feet still on the edge, frozen on a real frame (idx 46)
    ra: AD.map([[T.cuts[0], 1.709], [T.cuts[1], 2.07]]),                 // she leaves the line (frames 42-51)
    rb: AD.map([[T.cuts[1], 1.917], [T.cuts[2], 2.375]]),                // 1.25x: lift, carry, set down
    re: AD.map([[T.cuts[2], 2.42], [T.cuts[3], 2.86]]),                  // 1.2x: up on the toes, the push, the feet leave the edge
    rc: AD.map([[T.cuts[3], 1.29], [T.slow, 1.69], [T.slow + 6, 4.69]]), // the train pulls away, then 0.5x to the end card
  };
  // Each source framed, exposed and white-balanced into the one grade: mid-tones at R-B about -6 to -12, chroma 13-18.
  // tint is a multiply over the graded frame (cooler where R and G sit under B); sat is the grade's saturation.
  const LOOK = {
    a: { zoom: 1.04, dy: 38, bright: 0.66, con: 1.26, sat: 0.57, tint: [222, 233, 249] },    // daylight: a heavy dark grade
    b: { zoom: 1.16, dy: -150, bright: 1.48, con: 1.14, sat: 0.66, tint: [134, 196, 255] },  // the fingertip and the piece lifted clear of the card
    c: { zoom: 1.0, dy: 0, bright: 1.14, con: 1.12, sat: 0.5, tint: [194, 222, 255] },     // the hold: the (degraded) train fills the frame
    c2: { zoom: 1.0, dy: 0, bright: 1.42, con: 1.12, sat: 0.55, tint: [146, 199, 255] },      // the platform and its brown tiles, once the train has gone
    e: { zoom: 1.0, dy: -40, bright: 0.76, con: 1.22, sat: 0.5, tint: [203, 226, 255] },    // the feet clear of the card; the sun pulled down
  };
  /** Folder c white-balances from the train to the platform as the train pulls out (src 1.3 to 2.0), so the mid-tones
   *  stay put while the frame's content turns from grey car to brown wall. */
  const look = (key, src) => {
    if (key !== "c") return LOOK[key];
    const k = E.io(clamp((src - 1.3) / 0.9)), a = LOOK.c, b = LOOK.c2, m = (p, q) => lerp(p, q, k);
    return { zoom: 1, dy: 0, bright: m(a.bright, b.bright), con: a.con, sat: m(a.sat, b.sat), tint: a.tint.map((v, i) => m(v, b.tint[i])) };
  };

  /** The clothing wordmark on her left thigh in the release (folder a, frames 42-51): painted out by RGBA patches made
   *  by spots/06-mask.py (the fabric's own colour diffused over the letters), drawn over their frames. */
  const LOGO_A = [42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
  const MASK_ASSETS = Object.fromEntries(LOGO_A.map((i) => [`mask-a${i}`, new URL(`06-mask/a${i}.png`, location.href).href]));

  // ------------------------------------------------------------------------------------------------ the footage, cleaned and graded
  const canvas = (w = 1080, h = 1920) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const reset = (c) => { c.setTransform(1, 0, 0, 1, 0, 0); c.filter = "none"; c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; };
  let scratch = null;
  /** The frame of folder `key` at source time src, with its marks painted out, on a 1080 x 1920 canvas. */
  function clean(S, key, src) {
    const img = S.foot(key, src);
    if (key !== "a" && key !== "c") return img;
    if (!scratch) scratch = canvas();
    const c = scratch.getContext("2d", { willReadFrequently: true }); reset(c);
    c.drawImage(img, 0, 0, 1080, 1920);
    if (key === "a") {
      const idx = clamp(Math.round(src * 24) + 1, 1, 58), patch = S.A[`mask-a${idx}`];
      if (patch) { c.drawImage(patch, 0, 0, 1080, 1920); legEdge(c, S.A[`mask-a${idx}`]); }
    } else cleanC(S, c, src);
    return scratch;
  }

  /** Folder a: the wordmark patches left light chips and notches along her leg's outer edge (frames 44-51). Over each
   *  patch's box, the leg's outer edge (where her dark tights meet the light wall) is found row by row, a line is fitted
   *  through it (outliers out), and every light, cool pixel inside that line is set to the fabric: so a notch is filled
   *  to the silhouette and a chip goes dark, while her warm hand passing over the leg is left alone. */
  const patchBox = new Map();
  function boxOf(patch) {
    if (patchBox.has(patch)) return patchBox.get(patch);
    const c = canvas(), cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(patch, 0, 0, 1080, 1920);
    const d = cx.getImageData(500, 300, 320, 480).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < 480; y++) for (let x = 0; x < 320; x++) if (d[(y * 320 + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const box = x1 < 0 ? null : { x0: 500 + x0, y0: 300 + y0, x1: 500 + x1, y1: 300 + y1 };
    patchBox.set(patch, box); return box;
  }
  function legEdge(c, patch) {
    const bx = boxOf(patch); if (!bx) return;
    const x0 = bx.x0 - 16, x1 = Math.min(1080, bx.x1 + 40), y0 = bx.y0 - 10, y1 = bx.y1 + 10, w = x1 - x0, h = y1 - y0, id = c.getImageData(x0, y0, w, h), d = id.data;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // (raw frame values, before the grade: her tights about 80, the chips about 165, the wall about 245)
    const ys = [], es = [], fab = [];
    for (let y = 0; y < h; y++) {
      let run = 0, best = -1;
      for (let x = 0; x < w; x++) { const L = lum((y * w + x) * 4); if (L < 120) { run++; if (run >= 10) best = x; } else run = 0; }
      if (best > 0 && best < w - 8) { let light = 0; for (let k = 2; k <= 7; k++) if (lum((y * w + best + k) * 4) > 125) light++; if (light >= 4) { ys.push(y); es.push(best); const i = (y * w + best - 8) * 4; fab.push([d[i], d[i + 1], d[i + 2]]); } }
    }
    if (ys.length < 12) return;
    // a line x = a + b y through the outer edge, refitted without the rows more than 4 px inside it (the notches, the chips)
    const fit = (keep) => { let n = 0, sy = 0, sx = 0, syy = 0, sxy = 0; ys.forEach((y, i) => { if (!keep(i)) return; n++; sy += y; sx += es[i]; syy += y * y; sxy += y * es[i]; }); const bb = (n * sxy - sy * sx) / (n * syy - sy * sy || 1); return { a: (sx - bb * sy) / n, b: bb }; };
    let L1 = fit(() => true); for (let r = 0; r < 2; r++) { const L2 = fit((i) => es[i] > L1.a + L1.b * ys[i] - 4); if (isFinite(L2.a)) L1 = L2; }
    fab.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2])); const [fr_, fg, fb] = fab[fab.length >> 1];
    // only the rows where the leg's edge was seen (a sleeve crossing the leg has none): from the seen edge out to the line
    ys.forEach((y, j) => {
      const e = Math.round(L1.a + L1.b * y); if (e < 4 || e >= w || es[j] > e + 2) return;
      for (let x = Math.max(0, es[j] - 2); x <= e; x++) {
        const i = (y * w + x) * 4; if (lum(i) < 110 || d[i] - d[i + 2] > 12) continue;   // tights already, or warm (her hand)
        const k = x < e ? 1 : 0.5;
        d[i] = lerp(d[i], fr_, k); d[i + 1] = lerp(d[i + 1], fg, k); d[i + 2] = lerp(d[i + 2], fb, k);
      }
    });
    c.putImageData(id, x0, y0);
  }

  /** Folder c's marks, keyed on source time (measured on the raw frames at full size). */
  const key = (keys) => AD.map(keys);
  // the departing train's rear (right) edge: right of it is the wall
  const TRAIN_EDGE = key([[1.44, 1100], [1.5, 1090], [1.556, 880], [1.611, 828], [1.667, 748], [1.722, 668], [1.778, 614], [1.861, 554], [1.944, 504], [2.028, 464], [2.111, 424], [2.29, 396], [2.79, 312], [4.7, 300]]);
  // the cab's winged emblem (centre x, y, width) and its car number (centre x, y, width), from first sight to illegible
  const EMB = { x: key([[1.44, 1010], [1.5, 840], [1.597, 660], [1.611, 645], [1.667, 575], [1.694, 550], [1.722, 515], [1.778, 475], [1.861, 425], [2.04, 355], [2.29, 290], [2.54, 252], [2.79, 227], [3.0, 207], [3.25, 193], [3.7, 182]]),
    y: key([[1.44, 672], [1.5, 695], [1.597, 738], [1.611, 745], [1.667, 760], [1.694, 768], [1.722, 775], [1.778, 785], [1.861, 800], [2.04, 820], [2.29, 838], [2.54, 850], [2.79, 858], [3.0, 863], [3.25, 863], [3.7, 864]]),
    w: key([[1.44, 128], [1.5, 112], [1.597, 88], [1.694, 74], [1.861, 58], [2.04, 48], [2.29, 40], [2.54, 34], [2.79, 30], [3.0, 27], [3.25, 25], [3.7, 22]]), from: 1.42, to: 3.8 };
  const NUM = { x: key([[1.44, 735], [1.5, 615], [1.597, 475], [1.694, 395], [1.865, 310], [2.04, 258], [2.29, 217], [2.54, 195], [2.8, 182]]),
    y: key([[1.44, 1052], [1.5, 1030], [1.597, 995], [1.694, 975], [1.865, 955], [2.04, 943], [2.29, 932], [2.54, 925], [2.8, 920]]),
    w: key([[1.44, 66], [1.5, 58], [1.597, 48], [1.694, 42], [1.865, 34], [2.04, 28], [2.29, 24], [2.54, 20], [2.8, 18]]), from: 1.42, to: 2.85 };
  // the far wall in one-point perspective: its rows run to a vanishing point far left of the frame
  const VP = { x: -194, y: 894 };
  const POSTER = [[500, 796], [682, 790], [686, 1056], [503, 1016]];                 // the poster, 8 px over its frame line, down to the pit
  const LETTERS = [[688, 764], [1084, 708], [1084, 798], [688, 834]];                 // the station name high on the wall

  /** A polygon filled on a 2d context. */
  function poly(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
  /** `src` drawn into `dst` through a feathered polygon mask: c.transform maps src pixels to where they land; `fix`
   *  may adjust the transformed pixels before the mask. */
  function cloneInto(dst, src, pts, xf, feather, fix, filter = "none") {
    const tmp = canvas(), t = tmp.getContext("2d", { willReadFrequently: !!fix });
    t.save(); t.setTransform(...xf); t.filter = filter; t.drawImage(src, 0, 0); t.restore();
    if (fix) fix(t);
    const m = canvas(), mc = m.getContext("2d"); mc.filter = `blur(${feather}px)`; mc.fillStyle = "#fff"; poly(mc, pts); mc.fill();
    t.globalCompositeOperation = "destination-in"; t.drawImage(m, 0, 0);
    dst.drawImage(tmp, 0, 0);
  }
  /** Mean luminance of a box on a 2d context. */
  function meanLum(c, x, y, w, h) {
    const d = c.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / (d.length / 4);
  }
  /** The far wall without its poster or its station name, built once from a frame after the train has gone (src 4.0):
   *  the poster is replaced by the plain tiles left of it, scaled about the vanishing point (so the rows and the tile size
   *  carry on), and the station name by the tiles two rows below it, skewed to the rows' slope; where the tiles below hold
   *  the white tile pattern (x 770-900) the cleaned band carries on from its right, along the rows. */
  let plate = null;
  function wallPlate(S) {
    if (plate) return plate;
    const raw = S.foot("c", 4.0); plate = canvas(); const p = plate.getContext("2d", { willReadFrequently: true }); p.drawImage(raw, 0, 0, 1080, 1920);
    // the name: two tile rows down at x 690, more to the right (the rows open out away from the vanishing point)
    const sk = 56 / (690 - VP.x), band = canvas(), b = band.getContext("2d");
    b.drawImage(plate, 0, 0);
    cloneInto(b, plate, LETTERS, [1, -sk, 0, 1, 0, -sk * (-VP.x)], 0.1);
    // x 770-900: the band's own clean tiles from 130 px right, moved along the rows (slope about -0.14 here)
    const seg = canvas(), sc = seg.getContext("2d"); sc.drawImage(band, 0, 0);
    cloneInto(sc, band, [[764, 700], [906, 680], [906, 830], [764, 845]], [1, 0, 0, 1, -130, 18], 6);
    cloneInto(p, seg, LETTERS, [1, 0, 0, 1, 0, 0], 5);
    // the poster: its left half from the tiles left of it (x 370-450, scaled up about the vanishing point by 1.22), its
    // right half from the (now nameless) tiles right of the white pattern (x 880-1020, scaled down by 1.37), so the rows
    // and the tile size carry on; each half lifted or lowered to the wall beside it
    const top = (x) => 790 - 6 * (x - 494) / 194, bot = (x) => 1028 + 36 * (x - 497) / 195;
    const half = (x0, x1, k, ref, own, filter) => {
      const target = meanLum(p, ref, 830, 18, 160);
      cloneInto(p, plate, [[x0, top(x0)], [x1, top(x1)], [x1, bot(x1)], [x0, bot(x0)]], [k, 0, 0, k, VP.x * (1 - k), VP.y * (1 - k)], 8, (t) => {
        const g = clamp(target / meanLum(t, own, 830, 18, 160), 0.7, 1.4), id = t.getImageData(x0 - 12, 770, x1 - x0 + 24, 310), d = id.data;
        for (let i = 0; i < d.length; i += 4) { d[i] *= g; d[i + 1] *= g; d[i + 2] *= g; }
        t.putImageData(id, x0 - 12, 770);
      }, filter);
    };
    half(494, 608, 1.22, 476, 500, "contrast(1.12)");
    half(582, 692, 1 / 1.37, 698, 668, "none");
    // the wall's foot carried straight across (the track pit below it), then one exposure ramp over the whole patch from
    // the wall left of it to the wall right of it, column by column (smoothed over 31 px), weighted by the patch's mask
    const foot = (x) => 1000 + 0.227 * (x - 480), pit = p.getImageData(470, 1040, 20, 20).data; let pr = 0, pg = 0, pb = 0;
    for (let i = 0; i < pit.length; i += 4) { pr += pit[i]; pg += pit[i + 1]; pb += pit[i + 2]; }
    p.save(); p.filter = "blur(2px)"; p.fillStyle = `rgb(${(pr / 400) | 0},${(pg / 400) | 0},${(pb / 400) | 0})`; poly(p, [[486, foot(486) + 1], [700, foot(700) + 1], [700, 1100], [486, 1100]]); p.fill(); p.restore();
    const L0 = meanLum(p, 466, 830, 22, 150), L1 = meanLum(p, 700, 830, 22, 170), bx = 470, bw = 240, by = 770, bh = 300;
    const mk = canvas(), mkc = mk.getContext("2d", { willReadFrequently: true }); mkc.filter = "blur(5px)"; mkc.fillStyle = "#fff"; poly(mkc, [[494, top(494)], [692, top(692)], [692, foot(692)], [494, foot(494)]]); mkc.fill();
    const ma = mkc.getImageData(bx, by, bw, bh).data, id = p.getImageData(bx, by, bw, bh), d = id.data, col = new Float32Array(bw);
    for (let x = 0; x < bw; x++) { let sum = 0, n = 0; for (let y = 60; y < 220; y++) { const i = (y * bw + x) * 4; sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; } col[x] = sum / n; }
    for (let x = 0; x < bw; x++) {
      let sum = 0, n = 0; for (let k = -15; k <= 15; k++) { const q = x + k; if (q >= 0 && q < bw) { sum += col[q]; n++; } }
      const g = clamp(lerp(L0, L1, clamp((bx + x - 494) / 198)) / (sum / n), 0.6, 1.6);
      for (let y = 0; y < bh; y++) { const i = (y * bw + x) * 4, a = ma[i + 3] / 255, gg = lerp(1, g, a); d[i] *= gg; d[i + 1] *= gg; d[i + 2] *= gg; }
    }
    p.putImageData(id, bx, by);
    return plate;
  }
  function cleanC(S, c, src) {
    // the wall's poster and station name, from the clean plate, only right of the train's rear edge (soft over 14 px)
    const edge = TRAIN_EDGE(src) + 8;
    if (edge < 1080) {
      const pl = wallPlate(S);
      const tmp = canvas(), t = tmp.getContext("2d"), g = t.createLinearGradient(edge, 0, edge + 14, 0); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
      t.filter = "blur(4px)"; t.fillStyle = "#fff"; poly(t, POSTER.map(([x, y], i) => [x + (i === 0 || i === 3 ? -6 : 6), y + (i < 2 ? -6 : 6)])); t.fill(); poly(t, LETTERS); t.fill();
      t.filter = "none"; t.globalCompositeOperation = "source-in"; t.drawImage(pl, 0, 0);
      t.globalCompositeOperation = "destination-in"; t.fillStyle = g; t.fillRect(0, 0, 1080, 1920);
      // the camera's exposure drifts as the lit train leaves: the plate is matched to the live wall right of the train
      const rx = Math.max(Math.round(edge) + 20, 724), gain = rx < 1020 ? clamp(meanLum(c, rx, 850, 1060 - rx, 150) / meanLum(pl.getContext("2d"), rx, 850, 1060 - rx, 150), 0.6, 1.4) : 1;
      c.save(); c.filter = `brightness(${gain.toFixed(3)})`; c.drawImage(tmp, 0, 0); c.restore();
    }
    // the red LED clock over the tunnel mouth: down into the dark
    c.save(); c.filter = "blur(12px)"; c.fillStyle = "rgba(12,10,10,0.96)"; c.fillRect(70, 758, 250, 62); c.restore();
    // the cab's emblem and car number, each filled with the tone around it, feathered
    const patch = (o, fillAt) => {
      if (src < o.from || src > o.to) return;
      const x = o.x(src), y = o.y(src), w = o.w(src), h = w * (o === EMB ? 0.4 : 0.66);
      if (x - w / 2 > 1080) return;
      const [sx, sy] = fillAt(x, y, w, h), q = c.getImageData(clamp(Math.round(sx - 3), 0, 1074), clamp(Math.round(sy - 3), 0, 1914), 6, 6).data;
      let r = 0, gg = 0, bb = 0; for (let i = 0; i < q.length; i += 4) { r += q[i]; gg += q[i + 1]; bb += q[i + 2]; }
      c.save(); c.filter = "blur(3px)"; c.fillStyle = `rgb(${(r / 36) | 0},${(gg / 36) | 0},${(bb / 36) | 0})`;
      X0.rrect(c, x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, Math.min(8, h / 2)); c.fill(); c.restore();
    };
    patch(EMB, (x, y, w) => [x - w * 0.62 - 4, y]);        // the dark band the emblem sits on, just left of it
    patch(NUM, (x, y, w, h) => [x + w * 0.1, y - h * 0.95]); // the dark window above the number
    hueGrade(c);
  }
  /** The livery out: yellow (35-70 deg, saturated: not the tiles, which sit at 27 deg) to grey at the body's value; blue
   *  (195-235 deg) to 0.15 of its saturation. Both feathered 8 deg; the tail lights' red is kept. */
  function hueGrade(c) {
    const id = c.getImageData(0, 0, 1080, 1920), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
      if (ch < 10) continue;
      let h = mx === r ? ((g - b) / ch) % 6 : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4; h *= 60; if (h < 0) h += 360;
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      if (h > 27 && h < 78) {
        const w = clamp((h - 27) / 8) * clamp((78 - h) / 8) * clamp((ch / mx - 0.58) / 0.14); if (w <= 0) continue;
        const v = L * (1 - 0.62 * w);
        d[i] = lerp(r, v, w); d[i + 1] = lerp(g, v, w); d[i + 2] = lerp(b, v, w);
      } else if (h > 187 && h < 243) {
        const w = clamp((h - 187) / 8) * clamp((243 - h) / 8), s = 1 - 0.85 * w;
        d[i] = L + (r - L) * s; d[i + 1] = L + (g - L) * s; d[i + 2] = L + (b - L) * s;
      }
    }
    c.putImageData(id, 0, 0);
  }

  /** The one grade: contrast up, saturation down (a third more gone in a cold freeze), each clip's white balance, cooler
   *  and darker when cold, a soft vignette. */
  function film(S, key, src, cold = 0) {
    const L = look(key, src), ctx = S.ctx;
    AD.film(S, clean(S, key, src), { zoom: L.zoom, dy: L.dy, vig: 0.4 + 0.08 * cold,
      grade: `contrast(${(L.con * (1 + 0.05 * cold)).toFixed(3)}) saturate(${(L.sat * (1 - cold / 3)).toFixed(3)}) brightness(${(L.bright * (1 - 0.07 * cold)).toFixed(3)})` });
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = `rgb(${Math.round(L.tint[0] - 16 * cold)},${Math.round(L.tint[1] - 6 * cold)},${L.tint[2]})`; ctx.fillRect(0, 0, 1080, 1920); ctx.restore();
  }
  const BAR = 64;
  function bars(S) { const { ctx } = S; ctx.fillStyle = C.ink; ctx.fillRect(0, 0, 1080, BAR); ctx.fillRect(0, 1920 - BAR, 1080, BAR); }

  // ------------------------------------------------------------------------------------------------ the cards
  const PAD = 0.04 * 1080, HEAD = 84, NAME_F = X0.font(600, 38), LINE_F = X0.font(600, 49);   // ink Geist 0.045w
  const travel = AD.BOT.travel;
  function cardSize(S, text) {
    const headW = HEAD + 20 + X0.width(S.ctx, travel.name, NAME_F), textW = X0.width(S.ctx, text, LINE_F);
    return { w: Math.ceil(Math.max(headW, textW) + 2 * PAD), h: 222 };
  }
  /** A paper surface: shadow, cotton paper, hairline (on film the shadow is deep; on paper, soft). */
  function sheet(S, x, y, w, h, r, onPaper) {
    const { ctx, A } = S;
    ctx.save(); if (onPaper) { ctx.shadowColor = "rgba(0,0,0,0.16)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10; } else { ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24; }
    ctx.fillStyle = "#FFFFFF"; X0.rrect(ctx, x, y, w, h, r); ctx.fill(); ctx.restore();
    ctx.save(); X0.rrect(ctx, x, y, w, h, r); ctx.clip(); X0.cover(ctx, A.paper, x, y, w, h, { alpha: 0.8 }); ctx.restore();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; X0.rrect(ctx, x, y, w, h, r); ctx.stroke();
  }
  function tape(S, cx, y, rot, w = 230) { const { ctx, A } = S, th = w * A.tape.height / A.tape.width; ctx.save(); ctx.translate(cx, y); ctx.rotate(rot); ctx.globalAlpha *= 0.92; ctx.drawImage(A.tape, -w / 2, -th / 2, w, th); ctx.restore(); }
  /** A Travel card centred at (cx, cy): the sea head and name, one ink line; pressed in by k, opaque by a (2 frames). */
  function card(S, o) {
    const { ctx, A } = S, k = clamp(o.k ?? 1), a = clamp(o.a ?? 1); if (a <= 0) return;
    const { w, h } = cardSize(S, o.text), x = o.cx - w / 2, y = o.cy - h / 2;
    ctx.save(); ctx.translate(o.cx, o.cy); ctx.rotate(o.rot ?? 0);
    const press = 1.14 - 0.14 * E.o5(k); ctx.scale(press, press); ctx.translate(-o.cx, -o.cy);
    ctx.globalAlpha *= a;
    sheet(S, x, y, w, h, 26, false);
    ctx.drawImage(A[travel.head], x + PAD, y + 32, HEAD, HEAD);
    X0.text(ctx, travel.name, x + PAD + HEAD + 20, y + 32 + HEAD * 0.68, NAME_F, travel.color);
    X0.text(ctx, o.text, x + PAD, y + 182, LINE_F, C.ink);
    tape(S, o.cx + (o.tapeDx ?? 0), y + 2, o.tapeRot ?? -0.07);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the small cards on paper
  /** The four cards again, small, in a 2 x 2 grid along the top band (0.13-0.32h): each drawn at its own small size,
   *  never scaled below the floors (the line ink Geist 0.041w = 44 px, the name 0.035w = 38 px), sized to its longest
   *  line plus 0.04w, askew and taped. Columns read in order: Flights, Stay / Weather, Packing. */
  const SM = { head: 60, nameF: X0.font(600, 38), lineF: X0.font(600, 44), h: 168, gap: 24, top: 252 };
  const SMALL_ROT = [-0.045, 0.035, 0.03, -0.04], SMALL_TAPE = [[-20, -0.06], [16, 0.05], [-10, -0.1], [12, 0.04]];
  function smallSize(S, text) {
    const headW = SM.head + 14 + X0.width(S.ctx, travel.name, SM.nameF), textW = X0.width(S.ctx, text, SM.lineF);
    return { w: Math.ceil(Math.max(headW, textW) + 2 * PAD), h: SM.h, textW };
  }
  function smallLayout(S) {
    if (S._small) return S._small;
    const sz = T.holds.map((h) => smallSize(S, h.text)), [fl, st, we, pk] = sz;
    const x1 = 64, x2 = 64 + 22, r1 = SM.top, r2 = SM.top + SM.h + SM.gap;
    const place = [   // [Flights, Stay, Weather, Packing]
      { x: x1, y: r1 }, { x: x2, y: r2 }, { x: x1 + fl.w + SM.gap, y: r1 + 6 }, { x: x2 + st.w + SM.gap, y: r2 - 4 },
    ];
    const out = sz.map((s, i) => ({ ...place[i], w: s.w, h: s.h, rot: SMALL_ROT[i], tapeDx: SMALL_TAPE[i][0], tapeRot: SMALL_TAPE[i][1], textRight: place[i].x + PAD + s.textW }));
    console.warn(`06 small cards: ${out.map((o, i) => `${T.holds[i].text} ${o.w}x${o.h} text right ${o.textRight.toFixed(0)}`).join(", ")} (0.88w = 950); grid ${r1}-${r2 + SM.h} (0.12h = 230)`);
    return (S._small = out);
  }
  function smallCard(S, o, text) {
    const { ctx, A } = S, { x, y, w, h } = o, cx = x + w / 2, cy = y + h / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(o.rot); ctx.translate(-cx, -cy);
    sheet(S, x, y, w, h, 20, true);
    ctx.drawImage(A[travel.head], x + PAD, y + 22, SM.head, SM.head);
    X0.text(ctx, travel.name, x + PAD + SM.head + 14, y + 22 + SM.head * 0.72, SM.nameF, travel.color);
    X0.text(ctx, text, x + PAD, y + 136, SM.lineF, C.ink);
    tape(S, cx + o.tapeDx, y + 2, o.tapeRot, 170);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the question card
  // Centred at 0.63h, under the hero and the grid (the bottom of the frame was empty paper); 'It waits.' (ink Geist
  // 0.035w, the bible's size and the system's floor for a line that carries a claim) lands at 0.76h.
  const Q = { headF: X0.font(900, 76), yesF: X0.font(500, 48), notF: X0.font(500, 44), waitF: X0.font(500, 38), handF: X0.font(700, 128, "Caveat"), stampF: X0.font(800, 70), cy: 1210 };
  function qGeom(S) {
    if (S._q) return S._q;
    const ctx = S.ctx, yesW = 0.3 * 1080, yesH = 112, notW = 236, notH = 84, gap = 30;
    const rowW = yesW + gap + notW, headW = HEAD + 20 + X0.width(ctx, travel.name, NAME_F), textW = Math.max(X0.width(ctx, "Pay for", Q.headF), X0.width(ctx, "2 tickets?", Q.headF));
    const w = Math.ceil(Math.max(rowW, headW, textW) + 2 * PAD), h = 576, x = 540 - w / 2, y = Q.cy - h / 2;
    return (S._q = { w, h, x, y, yes: { x: x + PAD, y: y + 352, w: yesW, h: yesH }, not: { x: x + PAD + yesW + gap, y: y + 352 + (yesH - notH) / 2, w: notW, h: notH }, waitY: y + 526 });
  }
  /** The handwritten 'yes', drawn once to its own canvas so the pen can reveal it with a ragged edge. */
  function yesInk(S) {
    if (S._yes) return S._yes;
    const tw = X0.width(S.ctx, "yes", Q.handF), w = Math.ceil(tw) + 40, h = 200, cv = canvas(w, h);
    const c = cv.getContext("2d"); c.font = Q.handF; c.textBaseline = "alphabetic"; c.lineJoin = "round";
    c.strokeStyle = "#FBFBFA"; c.lineWidth = 11; c.strokeText("yes", 20, 130);   // the paper shows round the wet ink where it crosses the printed word
    c.fillStyle = C.ink; c.fillText("yes", 20, 130);
    return (S._yes = { cv, w, h, tw, base: 130 });
  }
  function qcard(S, t) {
    const { ctx, A } = S, g = qGeom(S), dy = (1 - E.o5(fr(t, T.paper, T.slide))) * 1400;
    ctx.save(); ctx.translate(0, dy);
    sheet(S, g.x, g.y, g.w, g.h, 30, true);
    ctx.drawImage(A[travel.head], g.x + PAD, g.y + 40, HEAD, HEAD);
    X0.text(ctx, travel.name, g.x + PAD + HEAD + 20, g.y + 40 + HEAD * 0.68, NAME_F, travel.color);
    X0.text(ctx, "Pay for", g.x + PAD, g.y + 222, Q.headF, C.ink);
    X0.text(ctx, "2 tickets?", g.x + PAD, g.y + 310, Q.headF, C.ink);
    // the dip-pen buttons: 'Yes' and, smaller, 'Not now'
    const pf = A["pen-frame"];
    ctx.drawImage(pf, g.yes.x, g.yes.y, g.yes.w, g.yes.h);
    X0.text(ctx, "Yes", g.yes.x + g.yes.w / 2, g.yes.y + g.yes.h / 2 + 17, Q.yesF, "#2A2A2A", "center");
    ctx.save(); ctx.globalAlpha *= 0.85; ctx.drawImage(pf, g.not.x, g.not.y, g.not.w, g.not.h); ctx.restore();
    X0.text(ctx, "Not now", g.not.x + g.not.w / 2, g.not.y + g.not.h / 2 + 15, Q.notF, "#333333", "center");
    // 'It waits.' typed under the buttons, a letter at a time
    const wt = "It waits.", n = Math.floor(clamp((t - T.waits) / T.waitsDur) * wt.length + 1e-6);
    if (t >= T.waits) X0.text(ctx, wt.slice(0, Math.max(1, n)), g.x + PAD, g.waitY, Q.waitF, C.ink);
    // the hand writes 'yes' across the button, left to right
    if (t >= T.yes0) { const y = yesInk(S), k = clamp((t - T.yes0) / (T.yes1 - T.yes0));
      ctx.save(); ctx.translate(g.yes.x + g.yes.w / 2 - y.tw / 2 + 6, g.yes.y + g.yes.h / 2 + 30); ctx.rotate(-0.07);
      X0.reveal(ctx, y.cv, -20, -y.base, y.w, y.h, E.io(k) * 0.96 + 0.04 * k, "x", { rag: 6, seed: 9 }); ctx.restore(); }
    // the stamp: 'Paid', hand-drawn, a slight angle, 1.3 -> 1.0 in 2 frames, 30 px right of the name so the slam frame leaves it
    if (t >= T.stamp) {
      const k = fr(t, T.stamp, F(2)), sc = 1.3 - 0.3 * k, sw = 0.3 * 1080, sh = sw * A.stamp.height / A.stamp.width * 1.25, cx = g.x + g.w - sw / 2 + 38, cy = g.y + 74;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.13); ctx.scale(sc, sc); ctx.globalAlpha *= Math.min(1, 0.4 + k);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(X0.tint(A.stamp, "#1a1a1a"), -sw / 2, -sh / 2, sw, sh);
      X0.text(ctx, "Paid", 0, 25, Q.stampF, "#141414", "center");
      ctx.restore();
    }
    ctx.restore();
    return g;
  }

  // ------------------------------------------------------------------------------------------------ the hero, waiting
  // His bar settles at 0.34h, below the grid of cards and clear above the question card.
  const HERO = { size: 500, x: 540 - 250, y: 520 };
  function hero(S, t) {
    const { ctx, A } = S, k = fr(t, T.heroIn, T.heroDown - T.heroIn), te = t - T.heroDown;
    let y = lerp(-HERO.size * 0.9, HERO.y, E.o3(k));
    if (te > 0) y += 5 * Math.exp(-te * 5) * Math.sin(te * 13);                       // the bar settles
    const sway = te > 0 ? 0.55 * Math.sin(Math.PI * 2 * 0.4 * te) * Math.min(1, te / 0.8) : 0;
    // where he looks (art px; 544 art px fill 500 screen px): at us; down at the button from 9.8, the lids a third down
    // and his body dipping 6 px; back up at us from 10.5 (a touch above level, lids open, a small rise); after the pen
    // from 13.8, across the button with it
    const DOWN = { dx: -12, dy: 32 }, UP = { dx: 0, dy: -6 }, kd = E.io(fr(t, T.lookDown, F(6))), ku = E.io(fr(t, T.lookUp, F(6)));
    let eyes = { dx: lerp(DOWN.dx * kd, UP.dx, ku), dy: lerp(DOWN.dy * kd, UP.dy, ku) }, lid = 0.13 * kd * (1 - ku);
    let dip = 6.5 * kd * (1 - ku) - 3 * Math.sin(Math.PI * fr(t, T.lookUp, F(12)));
    if (t >= T.yes0 - F(5)) {
      const kp = E.io(fr(t, T.yes0 - F(5), F(5))), kx = clamp((t - T.yes0) / (T.yes1 - T.yes0));
      eyes = { dx: lerp(UP.dx, lerp(-30, 30, E.io(kx)), kp), dy: lerp(UP.dy, 30, kp) }; lid = 0.13 * kp; dip = 6.5 * kp;
    }
    if (t >= T.stamp) {   // the eyes widen for one frame as the stamp lands, lids up; then back to us
      const kb = E.io(fr(t, T.stamp + F(8), F(6)));
      eyes = { dx: lerp(30, 0, kb), dy: lerp(30, 0, kb) }; lid = 0; dip = lerp(6.5, 0, E.io(fr(t, T.stamp, F(8))));
    }
    const wide = t >= T.stamp && t < T.stamp + F(1) ? 1.16 : t >= T.stamp + F(1) && t < T.stamp + F(3) ? 1.06 : 1;
    eyes.sx = eyes.sy = wide;
    let blink = 0; for (const b of T.blinks) if (t >= b && t < b + F(5)) blink = Math.sin(Math.PI * (t - b) / F(5)) ** 0.6;
    X0.hang(ctx, A, HERO.x, y, HERO.size, null, { eyes, blink, sway, lids: [lid, lid], barDy: dip });
  }

  // ------------------------------------------------------------------------------------------------ the headline
  /** 'It finds' / 'You press pay': white heavy Geist (cap 0.08w, 13 characters), 'You' by hand, a sea underline. */
  function headGeom(S) {
    if (S._h) return S._h;
    const ctx = S.ctx; ctx.save(); ctx.font = X0.font(900, 100); const cap = ctx.measureText("H").actualBoundingBoxAscent / 100; ctx.restore();
    const size = Math.round(0.08 * 1080 / cap), x = 80, base2 = Math.round(0.76 * 1920), base1 = Math.round(base2 - size * 1.1);
    const l1 = X0.layout(ctx, [{ text: "It" }, { text: "finds" }], { x, y: base1, size, weight: 900, color: "#FFFFFF" });
    const l2 = X0.layout(ctx, [{ text: "You", hand: true, handWeight: 700, scale: 1.15 }, { text: "press" }, { text: "pay" }], { x, y: base2, size, weight: 900, color: "#FFFFFF" });
    const g = { size, cap, x, base1, base2, l1, l2, right: Math.max(l1.x + l1.w, l2.x + l2.w) };
    console.warn(`06 headline: cap ${(cap * size).toFixed(1)} px (0.08w = 86.4), size ${size}, line 1 ${l1.w.toFixed(0)} px, line 2 ${l2.w.toFixed(0)} px, right edge ${g.right.toFixed(0)} (safe 950, 1026 measure), baseline ${base2} (0.78h = 1498)`);
    return (S._h = g);
  }
  function words(S, line, filter) { for (const w of line.words) if (filter(w)) AD.onFilm(S, w.text, w.x, w.y, w.font, "#FFFFFF"); }
  function headline(S, t) {
    if (t < T.l1) return; const { ctx, A } = S, g = headGeom(S);
    const slam = (t0, line, filter) => { if (t < t0) return; const k = fr(t, t0, F(3)), s = 1.08 - 0.08 * E.o3(k), cx = line.x + line.w / 2, cy = line.y - g.size * 0.35;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); words(S, line, filter); ctx.restore(); };
    slam(T.l1, g.l1, () => true);
    slam(T.l2, g.l2, (w) => !w.hand);
    const hw = g.l2.words[0];
    if (t >= T.hand0) { const k = E.io(fr(t, T.hand0, T.hand1 - T.hand0));
      ctx.save(); ctx.beginPath(); ctx.rect(hw.x - 14, hw.y - g.size * 1.3, (hw.w + 28) * k, g.size * 1.8); ctx.clip(); AD.onFilm(S, hw.text, hw.x, hw.y, hw.font, "#FFFFFF"); ctx.restore(); }
    if (t >= T.ul0) { const im = A[travel.ul], uw = hw.w * 1.12, uh = Math.max(26, uw * im.height / im.width * 1.15);
      X0.reveal(ctx, im, hw.x - (uw - hw.w) / 2 + 6, hw.y + g.size * 0.14, uw, uh, E.o3(fr(t, T.ul0, T.ul1 - T.ul0)), "x", { rot: -0.012, rag: 10, seed: 2 }); }
  }

  // ------------------------------------------------------------------------------------------------ the end card, the hero looking and waiting
  /** The campaign end card as built; the kit has no option for 'looks and waits', so his wink is held open here,
   *  page-locally (both lids open, the sway still) while AD.endCard draws him (as The Witness does). */
  function endCard(S, t) {
    if (t < T.end0) return;
    const hang = X0.hang;
    X0.hang = (ctx, Ls, x, y, size, tm, o = {}) => hang(ctx, Ls, x, y, size, tm, { ...o, lids: [0, 0], sway: 0 });
    try { AD.endCard(S, t, T.end0); } finally { X0.hang = hang; }
  }

  // ------------------------------------------------------------------------------------------------ the film
  AD.start({
    footage: {
      a: { dir: "../footage-06-a/", frames: 58, fps: 24 },
      b: { dir: "../footage-06-b/", frames: 72, fps: 24 },
      c: { dir: "../footage-06-c/", frames: 302, fps: 72 },
      e: { dir: "../footage-06-e/", frames: 90, fps: 25 },
    },
    assets: MASK_ASSETS,
    timeline: () => T,
    duration: T.duration,
    frame(t, S) {
      const { ctx } = S; let info = "", grain = 0;
      if (t < T.end0 + F(14)) {
        if (t < T.holds[0].t0) { info = "black"; }
        else if (t < T.paper) {
          // the four holds: each runs into its freeze, which goes cold over 6 frames; its card tapes on, opaque in 2 frames
          const i = T.holds.findIndex((x) => t >= x.t0 && t < x.t1), h = T.holds[i], src = SRC[h.key](t), cold = t >= h.fz ? E.o3(fr(t, h.fz, F(6))) : 0;
          film(S, h.key, src, cold); bars(S);
          if (t >= h.card) card(S, { text: h.text, cx: 540, cy: 960, k: fr(t, h.card, F(6)), a: fr(t, h.card, F(2)), rot: [-0.035, 0.028, -0.02, 0.032][i], tapeDx: [-30, 24, -12, 30][i], tapeRot: [-0.07, -0.03, -0.1, -0.05][i] });
          grain = 0.12 + 0.06 * cold; info = `hold ${h.key} src ${src.toFixed(3)}${cold ? " cold " + cold.toFixed(2) : ""}`;
        } else if (t < T.rel) {
          // paper: the four cards small along the top, the question, the hero who waits
          // the camera creeps in through the wait (3 %, about the middle of the type) and holds still from the stamp
          const push = 1 + 0.03 * E.io(fr(t, T.heroIn, T.stamp - T.heroIn));
          ctx.save(); X0.camera(ctx, push, 540, 860);
          ctx.fillStyle = "#FFFFFF"; ctx.fillRect(-40, -40, 1160, 2000); X0.cover(ctx, S.A.paper, -20, -20, 1120, 1960, { alpha: 0.9 });
          qcard(S, t);
          if (t >= T.heroIn) hero(S, t);                                                     // he comes down from behind the grid
          const sm = smallLayout(S); T.holds.forEach((h, i) => smallCard(S, sm[i], h.text));
          ctx.restore();
          grain = 0.035; info = "paper";
        } else if (t < T.cuts[3]) {
          // the release: three hard cuts at speed (the train is the fourth and runs on)
          const i = Math.floor((t - T.rel) / T.cut), key = ["a", "b", "e"][i], src = SRC["r" + key](t);
          film(S, key, src, 0); bars(S); grain = 0.12; info = `release ${key} src ${src.toFixed(3)}`;
        } else {
          const src = SRC.rc(t); film(S, "c", src, 0); bars(S); headline(S, t); grain = 0.12; info = `train src ${src.toFixed(3)}`;
        }
      }
      if (grain) X0.grain(ctx, 1080, 1920, t, grain, 1);
      endCard(S, t);
      if (t >= T.end0 + F(14)) X0.grain(ctx, 1080, 1920, t, 0.03, 1);
      if (S.q.get("hud")) X0.text(ctx, info, 360, 1900, X0.font(500, 24, "GeistMono"), "#ff6060");
    },
    cues(S) {
      const c = [], smp = (at, file, gain) => c.push({ at, kind: "sample", file: "06-sfx/" + file + ".wav", gain });
      // the wall clock, 60 bpm, from the first frame to the stamp
      for (let s = 0; s <= 14; s++) smp(s, s % 2 ? "tock" : "tick", 0.7);
      // the four ambiences, each 1.0 s from its cut and dead on its freeze; a tape rip on every card
      ["amb-track-1s", "amb-room-1s", "amb-platform-1s", "amb-wind-1s"].forEach((f, i) => smp(T.holds[i].t0, f, [0.36, 0.4, 0.36, 0.38][i]));
      for (const h of T.holds) smp(h.card + F(2), "tape", 0.6);
      // paper: the question slides up; the hero's bar comes down
      c.push({ at: T.paper, kind: "whoosh", dur: 0.32, up: false, gain: 0.22 });
      c.push({ at: T.heroIn, kind: "whoosh", dur: 0.5, up: false, gain: 0.12 }, { at: T.heroDown, kind: "land", gain: 0.12 });
      // the wait: a low drone on G creeping in from 9.3, a thin high sine from 11.3, both cut dead at the stamp
      c.push({ at: T.heroDown, kind: "drone", f: 49, dur: T.stamp - T.heroDown, a: 4.6, r: 0.006, gain: 0.55 });
      smp(11.3, "sine", 0.1);
      for (let i = 0; i < 9; i++) c.push({ at: T.waits + i * T.waitsDur / 9, kind: "tick", gain: 0.28 });   // 'It waits.' typed
      // the pen, the stamp
      smp(T.yes0, "pen-yes", 0.5);
      smp(T.stamp, "stamp", 0.95);
      // the release: one boom, a riser, each cut its own sound
      c.push({ at: T.rel, kind: "boom", gain: 0.85 }, { at: T.rel, kind: "riser", dur: 1.5, gain: 0.4 });
      smp(T.cuts[0], "spikes", 0.7);
      smp(T.cuts[1] + 0.33, "piece", 0.75);
      smp(T.cuts[2] + 0.2, "splash", 0.6);
      smp(T.cuts[3], "chime", 0.6);
      smp(T.slow, "train", 0.6);
      // the headline: two slams, the hand word, the brush, one Travel bell
      for (const at of [T.l1, T.l2]) c.push({ at, kind: "boom", gain: 0.4, f0: 70, f1: 40, dur: 0.8 }, { at, kind: "click", gain: 0.35 });
      smp(T.hand0, "pen-word", 0.4);
      c.push({ at: T.ul0, kind: "whoosh", dur: 0.3, up: false, gain: 0.32 });
      c.push({ at: T.ul1, kind: "bell", f: travel.note, dur: 1.6, gain: 0.45 });
      // the campaign's end card, its chord and bells moved up a fourth from D to this spot's G, without the wink's bell
      for (const e of AD.endCues(T.end0)) {
        if (e.kind === "bell" && Math.abs(e.at - (T.end0 + F(104))) < 1e-6) continue;
        c.push(e.kind === "chord" || e.kind === "bell" ? { ...e, f: e.f * 4 / 3 } : e);
      }
      return c;
    },
  }).catch((e) => { console.error(e); document.title = "ERROR " + e.message; });
})();
