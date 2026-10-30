// THE ART on the store frames: the bot peeking over the card, and the clay brush marks (an underline, a loose ring, an
// arrow). The bot is the app icon's: the painted black bot (cream eyes and gloves, clay ears, no antenna), cut flat the
// way the icon is, by the same drawing code (tools/media/brand/x0-icon/handdrawn-v2: draw.js, bot.js, versions.js; the
// icon is curious-hang/8-painted-clay-bar). On the cards it is the right way up, peeking over the edge; on the icon it
// hangs under the bar. Same character, same hand.
//
// That code paints opaque pixels on paper. To lift a drawing off its paper, each one is drawn twice, on black and on white,
// and the two are matted: alpha = 1 - (white - black), colour = black / alpha. What comes out is an RGBA PNG, trimmed to
// the drawing, with the line it peeks over (`ledge`) given in its own pixels.
//
//   renderArt(browser, jobs, outDir) -> { <name>: { file, w, h, ledge } }
//   jobs: [{ name, kind: "bot", pose }, { name, kind: "underline" | "ring" | "arrow", seed, color? }]
//   pose: one of POSES below, a version of the hand-drawn icons (its pose and face), drawn in one house style
//   color: a mark's colour (default the clay); on the white frames a mark takes its frame's bot's colour, or ink
//
//   renderHang(browser, outDir, size) -> { head, bar, hands, splash, blink: file, size, barBox: { x0, y0, x1, y1 } }
//   the launch's own layers (the icon's bot hanging under a piece of its clay bar: app/assets/launch), drawn bigger by
//   the brand's launch.mjs page code itself, for the frames where the bot is the picture and for the App Preview.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAND = path.resolve(HERE, "../brand/x0-icon");

/** The poses: how the head tilts and what the eyes do. */
export const POSES = {
  curious: { tilt: 0.16, look: [16, -14] },                                   // head cocked, eyes up at the headline
  happy: { tilt: -0.1, eyes: [{ arc: { w: 44, rx: 0.5, ry: 0.32 } }, { arc: { w: 44, rx: 0.5, ry: 0.32 } }] },   // a happy squint
  wink: { tilt: 0.12, look: [8, -6], eyes: [{ arc: { w: 42, rx: 0.48, ry: 0.3, rot: 0.06 } }, { hs: 1.04, ws: 1.02 }] },
  shy: { tilt: -0.14, rise: 116, look: [-28, -2], eyes: [{ hs: 0.94, ws: 0.94 }, { hs: 0.94, ws: 0.94 }] },  // peeks lower, glances away
  starry: { tilt: 0.06, look: [0, -10], eyes: [{ hs: 1.14, ws: 1.08 }, { hs: 1.08, ws: 1.04 }] },             // wide eyes
  hello: { tilt: 0.08, look: [-6, -8] },                                     // a straight, friendly look
};

/** The drawing code: handdrawn-v2 (the icon's). Set X0_ART_DIR to force another. */
export function artDir() {
  if (process.env.X0_ART_DIR) return path.resolve(process.env.X0_ART_DIR);
  return path.join(BRAND, "handdrawn-v2");
}

const CLAY = "#D2703F";

// Runs in the page, after draw.js, bot.js and versions.js. Returns { png (data URL), w, h, ledge }.
const PAGE = String.raw`
window.X0ART = (() => {
  const { G, M, Art } = HD;
  const POSES = __POSES__;
  const CLAY = __CLAY__;
  const base = HD.VERSIONS.find((v) => v.id === "3-curious");

  /** Draw fn(art, bg) on black and on white, matte the two, trim, and return a PNG data URL. */
  function lift(N, seed, out, draw, ledgeY, anchor) {
    const P = [];
    for (const bg of ["#000000", "#FFFFFF"]) { const art = new Art(N, seed); draw(art, bg); P.push(art.rgb); }
    const [B, Wt] = P, f = N / out, rgba = new Float32Array(out * out * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 3;
      let a = 1 - ((Wt[i] - B[i]) + (Wt[i + 1] - B[i + 1]) + (Wt[i + 2] - B[i + 2])) / 3;
      a = Math.max(0, Math.min(1, a));
      const o = ((Math.floor(y / f) * out) + Math.floor(x / f)) * 4;
      // premultiplied: black-pass colour is colour x alpha
      rgba[o] += Math.min(1, B[i]); rgba[o + 1] += Math.min(1, B[i + 1]); rgba[o + 2] += Math.min(1, B[i + 2]); rgba[o + 3] += a;
    }
    const k = 1 / (f * f);
    let x0 = out, y0 = out, x1 = -1, y1 = -1;
    for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
      const o = (y * out + x) * 4; if (rgba[o + 3] * k > 0.01) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(out - 1, x1 + 4); y1 = Math.min(out - 1, y1 + 4);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ((y + y0) * out + (x + x0)) * 4, q = (y * w + x) * 4, a = rgba[o + 3] * k;
      if (a <= 0.002) continue;
      img.data[q] = Math.round(Math.min(1, rgba[o] * k / a) * 255); img.data[q + 1] = Math.round(Math.min(1, rgba[o + 1] * k / a) * 255);
      img.data[q + 2] = Math.round(Math.min(1, rgba[o + 2] * k / a) * 255); img.data[q + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    return { png: cv.toDataURL("image/png"), w, h, ledge: ledgeY === undefined ? null : (ledgeY * out) / 1000 - y0,
      anchor: anchor ? [(anchor[0] * out) / 1000 - x0, (anchor[1] * out) / 1000 - y0] : null };
  }

  /** The bot in one pose, painted flat like the app icon, peeking over a straight edge with nothing below it. */
  function bot(pose, out) {
    const P = POSES[pose];
    if (!P) throw new Error("no pose " + pose);
    const ly = 716, INK = "#151311", CREAM = "#FBF2E2", EAR = "#C9683F";
    const cut = (len, jit) => ({ len, jit });
    const face = { ...base.bot.face, look: P.look ?? [0, -8], eyes: P.eyes ?? base.bot.face.eyes };
    const spec = {
      seed: 3131, edge: { y: ly, slope: 0, line: null, belowTint: null, wave: 0 },
      bot: { ...base.bot, antenna: false, tilt: P.tilt ?? 0, rise: P.rise ?? 128, hw: 350, hh: 270, face },
      style: () => ({
        ear: { color: EAR, p: 1, facet: cut(22, 2.2) }, earShade: null, earLine: null,
        shell: { color: INK, p: 1, facet: cut(46, 3.5) }, shade: null, shellShine: null, shellLine: null,
        visor: { color: "#2C2825", p: 1, facet: cut(40, 3) }, visorSheen: null, visorGlint: null, visorLine: null,
        eye: { color: CREAM, p: 1, facet: cut(24, 2.4) }, eyeHalo: null, catchlight: null, brow: null,
        hand: { color: CREAM, p: 1, facet: cut(12, 1) }, handShade: null, seam: null, handShadow: null,
        // the gloves sit on a white card: a fine ink line keeps them there. The head and ears get a border in the
        // paper's white, so where the bot crosses the card's outline it reads as cut out and laid on top.
        handLine: { color: INK, w: 7, amp: 0.4, taper: [2, 2] },
        halo: { color: "#FFFFFF", grow: 11 },
      }),
    };
    return lift(2048, 3131, out, (art, bg) => {
      spec.ground = (K) => K.art.paper({ color: bg, mottle: 0, grain: 0, warm: 0, vignette: 0 });
      HD.icon(art, spec);
    }, ly);
  }

  /** Brush marks: an underline, a loose ring, a little arrow (its tip is the anchor), in clay or the colour given. */
  function mark(kind, seed, out, color) {
    const INKC = color || CLAY;
    const TIP = [770, 900];
    return lift(1024, seed, out, (art, bg) => {
      art.paper({ color: bg, mottle: 0, grain: 0, warm: 0, vignette: 0 });
      const n = art.noise, r = art.r;
      const ink = (pts, w, taper) => art.mark(INKC, { tooth: 0.14, soft: 0.25, paper: "fine" }, (c) =>
        M.ink(c, G.wobble(pts, false, 2.2, 90, n, r() * 50), { w, noise: n, phase: r() * 50, taper, jit: 0.22 }));
      if (kind === "underline") {
        ink(G.cubic([40, 520], [300, 470], [640, 545], [962, 480], 300), 46, [60, 220]);
      } else if (kind === "ring") {
        const pts = [];
        for (let i = 0; i <= 260; i++) { const t = i / 260, a = -2.5 + t * 7.1; pts.push([500 + 440 * Math.cos(a) * (1 + 0.04 * t), 500 + 300 * Math.sin(a) * (1 - 0.05 * t)]); }
        ink(pts, 30, [40, 160]);
      } else if (kind === "arrow") {
        // down from above, then a hook to the right: it lives in a narrow margin and points at what is beside it
        const shaft = G.cubic([500, 40], [430, 470], [470, 790], TIP, 260);
        ink(shaft, 34, [50, 24]);
        ink(G.quad([TIP[0] - 118, TIP[1] - 134], [TIP[0] - 50, TIP[1] - 60], [TIP[0] + 4, TIP[1] + 2], 60), 32, [30, 8]);
        ink(G.quad([TIP[0] - 166, TIP[1] + 66], [TIP[0] - 76, TIP[1] + 34], [TIP[0] + 4, TIP[1] + 2], 60), 32, [30, 8]);
      }
    }, undefined, kind === "arrow" ? TIP : null);
  }
  return { bot, mark };
})();
`;

export async function renderArt(browser, jobs, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const dir = artDir();
  const page = await browser.newPage();
  const done = {};
  try {
    page.on("pageerror", (e) => { throw e; });
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(dir, f) });
    await page.addScriptTag({ content: PAGE.replace("__POSES__", JSON.stringify(POSES)).replace("__CLAY__", JSON.stringify(CLAY)) });
    for (const j of jobs) {
      const r = await page.evaluate(`(${j.kind === "bot" ? `X0ART.bot(${JSON.stringify(j.pose)}, 1024)` : `X0ART.mark(${JSON.stringify(j.kind)}, ${j.seed ?? 7}, 768, ${JSON.stringify(j.color ?? null)})`})`);
      const file = path.join(outDir, `${j.name}.png`);
      fs.writeFileSync(file, Buffer.from(r.png.split(",")[1], "base64"));
      done[j.name] = { file, w: r.w, h: r.h, ledge: r.ledge, anchor: r.anchor };
    }
  } finally {
    await page.close();
  }
  fs.writeFileSync(path.join(outDir, "art.json"), JSON.stringify({ dir, art: done }, null, 1));
  return done;
}

/** The launch art's frame and bar at its own size (app/src/launch/launchCore.ts: 544 px, BAR in those pixels). */
export const LAUNCH = { size: 544, bar: { x0: 48, y0: 138, x1: 495, y1: 195 } };

/**
 * The launch's layers (head, bar, gloves, and all three stacked: the splash), `size` px square instead of 544: the brand's
 * own launch.mjs page code (tools/media/brand/x0-icon/curious-hang/launch.mjs), read from that file and run with a bigger
 * frame, so the bot is the icon's bot facet for facet and the layers stack exactly as the app's do. Cached in outDir.
 */
export async function renderHang(browser, outDir, size = 1632) {
  fs.mkdirSync(outDir, { recursive: true });
  const k = size / LAUNCH.size, B = LAUNCH.bar;
  const res = { size, barBox: { x0: B.x0 * k, y0: B.y0 * k, x1: B.x1 * k, y1: B.y1 * k } };
  for (const n of ["head", "bar", "hands", "splash", "blink"]) res[n] = path.join(outDir, `hang-${n}-${size}.png`);
  if (["head", "bar", "hands", "splash", "blink"].every((n) => fs.existsSync(res[n]))) return res;
  const hang = path.resolve(BRAND, "curious-hang"), src = fs.readFileSync(path.join(hang, "launch.mjs"), "utf8");
  const m = src.match(/const PAGE = String\.raw`([\s\S]*?)`;\n/);
  if (!m || !/const OUT = 544, SS = 3/.test(m[1])) throw new Error("art: launch.mjs's page code has changed shape; update renderHang");
  const code = m[1].replace("const OUT = 544, SS = 3", `const OUT = ${size}, SS = 2`);
  const page = await browser.newPage();
  try {
    page.on("pageerror", (e) => { throw e; });
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    for (const f of ["draw.js", "bot.js", "versions.js"]) await page.addScriptTag({ path: path.join(artDir(), f) });
    await page.addScriptTag({ path: path.join(hang, "versions.js") });
    await page.addScriptTag({ content: code });
    const r = await page.evaluate(() => window.LAUNCH.run());
    for (const [n, u] of Object.entries(r.files)) fs.writeFileSync(res[n], Buffer.from(u.split(",")[1], "base64"));
  } finally {
    await page.close();
  }
  return res;
}
