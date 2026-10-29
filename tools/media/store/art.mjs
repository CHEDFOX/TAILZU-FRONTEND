// THE HAND-DRAWN ART on the store frames: the Peek-a-bot peeking over the card, and the clay brush marks (an underline,
// a loose ring, an arrow). Drawn by the brand's own hand-drawn drawing code (tools/media/brand/x0-icon/handdrawn: draw.js,
// bot.js, versions.js), the same code that draws the hand-drawn icons, so the screenshots and the icon are one hand.
//
// That code paints opaque pixels on paper. To lift a drawing off its paper, each one is drawn twice, on black and on white,
// and the two are matted: alpha = 1 - (white - black), colour = black / alpha. What comes out is an RGBA PNG, trimmed to
// the drawing, with the line it peeks over (`ledge`) given in its own pixels.
//
//   renderArt(browser, jobs, outDir) -> { <name>: { file, w, h, ledge } }
//   jobs: [{ name, kind: "bot", pose }, { name, kind: "underline" | "ring" | "arrow", seed }]
//   pose: one of POSES below, a version of the hand-drawn icons (its pose and face), drawn in one house style
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAND = path.resolve(HERE, "../brand/x0-icon");

/** The faces, by the hand-drawn icon version each is taken from. */
export const POSES = {
  curious: "1-curious",   // looks up at its own antenna, one eye wider
  happy: "2-happy",       // happy squint, a blush, the antenna bobbing
  wink: "3-wink",         // a wink and a smirk, a sparkle
  shy: "4-shy",           // peeks lower, one paw, a sideways glance, a blush
  starry: "5-riso",       // sparkles for eyes, the antenna pinging
  hello: "6-hello",       // a small smile, one paw up in a wave
};

/**
 * Which drawing code: `handdrawn-v2` once it is finished (it has a README, as the first set does) and speaks the same
 * spec, else `handdrawn`. Set X0_ART_DIR to force one.
 */
export function artDir() {
  if (process.env.X0_ART_DIR) return path.resolve(process.env.X0_ART_DIR);
  const v2 = path.join(BRAND, "handdrawn-v2");
  if (fs.existsSync(path.join(v2, "README.md")) && fs.readFileSync(path.join(v2, "bot.js"), "utf8").includes("ledgeDraw")) return v2;
  return path.join(BRAND, "handdrawn");
}

const CLAY = "#D2703F";

// Runs in the page, after draw.js, bot.js and versions.js. Returns { png (data URL), w, h, ledge }.
const PAGE = String.raw`
window.X0ART = (() => {
  const { G, M, Art } = HD;
  const POSES = __POSES__;
  const CLAY = __CLAY__;
  const base = HD.VERSIONS.find((v) => v.id === "1-curious");

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

  /** The Peek-a-bot in one pose, in the first set's inked house style, over a straight edge, with nothing below it. */
  function bot(pose, out) {
    const v = HD.VERSIONS.find((x) => x.id === POSES[pose]);
    if (!v) throw new Error("no pose " + pose);
    const ly = 716;
    const spec = {
      ...base, seed: v.seed, bot: v.bot, ledge: { ...v.ledge, y: ly, slope: 0, wave: 0 },
      beforeLedge: v.beforeLedge, after: v.after,
      ground: null, ledgeDraw: null,
    };
    return lift(2048, v.seed, out, (art, bg) => {
      spec.ground = (K) => K.art.paper({ color: bg, mottle: 0, grain: 0, warm: 0, vignette: 0 });
      // the edge it peeks over is the card's: below it, nothing (the paws are drawn after, over it)
      spec.ledgeDraw = (K) => K.mark(bg, { tooth: 0, soft: 0.01 }, (c) => c.fillRect(-60, K.ly, 1120, 1200));
      HD.icon(art, spec);
    }, ly);
  }

  /** Clay brush marks: an underline, a loose ring, a little arrow (its tip is the anchor). */
  function mark(kind, seed, out) {
    const TIP = [770, 900];
    return lift(1024, seed, out, (art, bg) => {
      art.paper({ color: bg, mottle: 0, grain: 0, warm: 0, vignette: 0 });
      const n = art.noise, r = art.r;
      const ink = (pts, w, taper) => art.mark(CLAY, { tooth: 0.14, soft: 0.25, paper: "fine" }, (c) =>
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
      const r = await page.evaluate(`(${j.kind === "bot" ? `X0ART.bot(${JSON.stringify(j.pose)}, 1024)` : `X0ART.mark(${JSON.stringify(j.kind)}, ${j.seed ?? 7}, 768)`})`);
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
