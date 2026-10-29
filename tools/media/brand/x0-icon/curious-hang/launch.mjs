// THE LAUNCH ART: the app icon's bot (8-painted-clay-bar), small, on a short piece of its clay bar, for the splash
// and the launch animation that starts from it.
//
//   node launch.mjs [--app ../../../../../app] [--blip <dir>]
//
// Draws with the icon's own code and spec (../handdrawn-v2 + versions.js): the same seed, pose and cut, so the bot is
// the icon's bot facet for facet. Only the ground changes: transparent instead of cream, and the full-width bar becomes
// a piece of it (the icon's own bar, trimmed). Each layer is drawn on black and on white and the two are matted into
// RGBA, the way tools/media/store/art.mjs lifts its art.
//
// Writes (all 544 px square, 4x the splash's 136 pt, the same frame, so they stack exactly):
//   <app>/assets/launch/splash.png   head, bar, gloves: the native splash (expo-splash-screen) and the launch's first frame
//   <app>/assets/launch/head.png     the head, ears and eyes (they swing about PIVOT, behind the bar)
//   <app>/assets/launch/bar.png      the bar piece (it stays still)
//   <app>/assets/launch/hands.png    the gloves (they swing with the head, in front of the bar)
//   <app>/assets/launch/blink.png    the eyes shut: drawn over head.png for a blink
//   <blip>/x0-hang.png               splash.png again, for the server's screens (served at /blip/bots/)
// and prints PIVOT, the point on the bar the bot swings about, as a fraction of the frame (app/src/launch/art.ts).
//
// The frame is centred on the drawing, and the drawing stays inside the frame's inscribed circle: on Android 12+ the
// system splash shows only a circle, 192 dp across, of an image no wider than that.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url)), lib = path.join(here, "../handdrawn-v2");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const appDir = path.resolve(opt("--app", path.join(here, "../../../../../app")));
const blipDir = opt("--blip", null);

const PAGE = String.raw`
window.LAUNCH = (() => {
  const { Art, G, rng } = HD;
  const icon = HD.HANG.find((v) => v.id === "8-painted-clay-bar");
  const CLAY = "#C9683F", VISOR = "#2C2825", CREAM = "#FBF2E2";
  const BAR = { len: 880, thick: 104, round: 16 };   // the piece of bar, in the 1000 square
  const OUT = 544, SS = 3, MARGIN = 0.94;             // 4x the splash's 136 pt, drawn at 3x that; the drawing fills 94% of the circle

  /** The icon's own facet cut (bot.js), on its own seed so it never shifts the icon's. */
  function cut(pts, len, jit, r) {
    const P = G.resample(pts, 1, true), out = [];
    for (let i = 0; i < P.length; i += Math.max(2, Math.round(len * (0.6 + 0.8 * r())))) {
      const [x, y] = P[i], q = P[(i + 1) % P.length], tx = q[0] - x, ty = q[1] - y, tl = Math.hypot(tx, ty) || 1, d = r.pm(jit);
      out.push([x - (ty / tl) * d, y + (tx / tl) * d]);
    }
    return out;
  }
  /** Where the hands grip, between them, on the bar's edge (upright, before the turn). */
  function grip(K) {
    const B = K.S.bot, xs = [-1, 1].map((s) => K.Wp(s * K.hw * (B.handSpread ?? 0.62), 0)[0] + (B.handNudge || 0) * s);
    const x = (xs[0] + xs[1]) / 2;
    return [x, K.edgeAt(x)];
  }
  /** The eyes shut: the open eye painted over in the visor's colour, and a thin cream lid line low in it (upright:
   *  the lid comes down from the top of the head, which once turned is the bottom of the screen). */
  function lids(K) {
    const B = K.S.bot, F = B.face, { vy, vw, vh } = K.geo, look = F.look || [0, 0];
    const ex = (F.spread ?? 0.48) * vw, ew = F.w ?? 124, eh = F.h ?? 176, ey = vy + (F.y ?? 0.12) * vh + look[1];
    F.eyes.forEach((e, i) => {
      const s = i === 0 ? -1 : 1, x = s * ex + look[0] + (e.dx || 0), y = ey + (e.dy || 0), w = ew * (e.ws ?? 1), h = eh * (e.hs ?? 1);
      K.fill(G.offset(K.W(HD.eyePts(x, y, w, h, e)), 7), { color: VISOR, p: 1, clip: null });
      K.fill(K.W(HD.eyePts(x, y + h * 0.2, w * 0.84, h * 0.15, {})), { color: CREAM, p: 1, clip: null, facet: { len: 14, jit: 1.2 } });
    });
  }
  /** The icon's own style with only the kept parts painted. The rest is cut and not drawn, so every part is cut exactly as the
   *  icon cuts it (the facets come from one seeded sequence, in drawing order). */
  const only = (keep) => (K) => Object.fromEntries(Object.entries(icon.style(K)).map(([k, v]) => [k, v && !keep(k) ? { ...v, p: 0 } : v]));
  const KEEP = { all: () => true, head: (k) => k !== "hand", hands: (k) => k === "hand", bar: () => false, blink: () => false };

  /** The icon's spec with a transparent ground; layer is "bar", "head", "hands", "blink" or "all". */
  function spec(layer, bg, out) {
    return { ...icon,
      ground(K) {
        K.art.paper({ color: bg, mottle: 0, grain: 0, warm: 0, vignette: 0 });
        // The icon's bar, cut exactly as the icon cuts it (the same draws from the same seed), so the bot after it
        // is cut the same too. Drawn only inside a piece BAR.len long, centred on the grip; invisible otherwise.
        const [gx, gy] = grip(K), piece = cut(G.rrect(gx, gy + BAR.thick / 2 - 30, BAR.len, BAR.thick + 60, BAR.round), 40, 2.5, rng(808));
        const show = layer === "bar" || layer === "all";
        K.fill(K.below, { color: CLAY, p: show ? 1 : 0, clip: null, within: piece, facet: { len: 46, jit: 3.5 } });
        if (out) out.grip = [gx, gy];
      },
      style: only(KEEP[layer]),
      after: layer === "blink" ? lids : undefined,
    };
  }

  /** Draw on black and on white; alpha = 1 - (white - black), premultiplied colour = the black pass. */
  function matte(layer, N, out) {
    const P = [];
    for (const bg of ["#000000", "#FFFFFF"]) { const art = new Art(N, icon.seed); HD.icon(art, spec(layer, bg, out)); P.push(art.rgb); }
    const [B, W] = P, A = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const j = i * 3;
      A[i] = Math.max(0, Math.min(1, 1 - ((W[j] - B[j]) + (W[j + 1] - B[j + 1]) + (W[j + 2] - B[j + 2])) / 3));
    }
    return { B, A };
  }

  /** The drawing's centre and the radius that holds all of it, in the 1000 square (upright). */
  function measure() {
    const N = 1000, { A } = matte("all", N, {});
    let x0 = N, y0 = N, x1 = 0, y1 = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (A[y * N + x] > 0.02) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
    let R = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (A[y * N + x] > 0.02) R = Math.max(R, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
    return { cx, cy, R, box: [x0, y0, x1 + 1, y1 + 1] };
  }

  /** One layer, cropped to the frame, averaged down SS x SS, turned 180 degrees: 8-bit RGBA. */
  function layer(name, N, crop, out) {
    const { B, A } = matte(name, N, out), side = OUT * SS, px = new Uint8ClampedArray(OUT * OUT * 4);
    for (let oy = 0; oy < OUT; oy++) for (let ox = 0; ox < OUT; ox++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const x = crop.x0 + ox * SS + i, y = crop.y0 + oy * SS + j;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const k = y * N + x;
        r += Math.min(1, B[k * 3]); g += Math.min(1, B[k * 3 + 1]); b += Math.min(1, B[k * 3 + 2]); a += A[k];
      }
      const q = ((OUT - 1 - oy) * OUT + (OUT - 1 - ox)) * 4;   // turned 180 degrees
      if (a <= 0.002 * SS * SS) continue;
      px[q] = Math.round((r / a) * 255); px[q + 1] = Math.round((g / a) * 255); px[q + 2] = Math.round((b / a) * 255); px[q + 3] = Math.round((a / (SS * SS)) * 255);
    }
    return px;
  }

  /** a over b, both 8-bit straight alpha. */
  function over(a, b) {
    const o = new Uint8ClampedArray(a.length);
    for (let i = 0; i < a.length; i += 4) {
      const aa = a[i + 3] / 255, ba = b[i + 3] / 255, oa = aa + ba * (1 - aa);
      if (oa <= 0) continue;
      for (let c = 0; c < 3; c++) o[i + c] = Math.round((a[i + c] * aa + b[i + c] * ba * (1 - aa)) / oa);
      o[i + 3] = Math.round(oa * 255);
    }
    return o;
  }
  function png(px) {
    const cv = document.createElement("canvas"); cv.width = cv.height = OUT;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(OUT, OUT); img.data.set(px); ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  function run() {
    const m = measure(), sideUnits = (2 * m.R) / MARGIN, N = Math.round((OUT * SS * 1000) / sideUnits);
    const k = N / 1000, crop = { x0: Math.round(m.cx * k - (OUT * SS) / 2), y0: Math.round(m.cy * k - (OUT * SS) / 2) };
    const info = {};
    const L = { head: layer("head", N, crop, {}), bar: layer("bar", N, crop, info), hands: layer("hands", N, crop, {}), blink: layer("blink", N, crop, {}) };
    // The grip, on the bar's middle line (what the hands hold), turned and as a fraction of the frame.
    const [gx, gy] = info.grip, pivot = [1 - (gx * k - crop.x0) / (OUT * SS), 1 - ((gy + BAR.thick / 2) * k - crop.y0) / (OUT * SS)];
    return {
      // Stacked as the curtain stacks them: the head behind the bar, the gloves in front of it.
      files: { splash: png(over(L.hands, over(L.bar, L.head))), head: png(L.head), bar: png(L.bar), hands: png(L.hands), blink: png(L.blink) },
      pivot, measure: m, N, sideUnits,
    };
  }
  return { run };
})();
`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.error("PAGE ERROR", e.message); process.exitCode = 1; });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(lib, f) });
  await page.addScriptTag({ path: path.join(here, "versions.js") });
  await page.addScriptTag({ content: PAGE });
  const r = await page.evaluate(() => LAUNCH.run());
  const dir = path.join(appDir, "assets/launch");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of Object.entries(r.files)) fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(url.split(",")[1], "base64"));
  if (blipDir) fs.copyFileSync(path.join(dir, "splash.png"), path.join(blipDir, "x0-hang.png"));
  const f = (v) => +v.toFixed(4);
  console.log(`wrote ${dir}/{splash,head,bar,hands,blink}.png${blipDir ? ` and ${blipDir}/x0-hang.png` : ""}`);
  console.log(`drawing: centre ${r.measure.cx.toFixed(1)},${r.measure.cy.toFixed(1)}  radius ${r.measure.R.toFixed(1)}  frame ${r.sideUnits.toFixed(1)} units (N ${r.N})`);
  console.log(`PIVOT = [${f(r.pivot[0])}, ${f(r.pivot[1])}]`);
} finally {
  await browser.close();
}
