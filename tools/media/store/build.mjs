// THE STORE SCREENSHOTS: one command re-renders everything.
//
//   node tools/media/store/build.mjs                 # screens (from the server's builders) + every store frame + the sheet
//   node tools/media/store/build.mjs --no-screens    # only re-compose, from the screens already in out/screens
//   node tools/media/store/build.mjs --only plan     # one frame (a regex on its key)
//   node tools/media/store/build.mjs --sheet /path/sheet.png   # also write the contact sheet there
//   node tools/media/store/build.mjs --set india     # the India set (frames.mjs SETS), for Google Play's English (India) and
//                                                    # Hindi listings: the same, written to out/india/
//
// The look is the app's: white paper, ink and greys, colour only where it is a bot's; a heavy Geist headline, left aligned,
// one word handwritten (Caveat) with a brush underline in the frame's bot's colour; the painted black bot of the icon.
// The first three frames are one panorama (frames.mjs `pano`): the icon's clay bar runs across all three, and from it hang
// the bot (art.mjs renderHang: the launch's own layers, drawn big), the X0 widget and a phone (surfaces.mjs). The rest are
// the app as a white card cut from a real screen, a thin hand-drawn outline round it, one part lifted out and an arrow at
// it, and the bot peeking over the card's edge (art.mjs). `voice` is Keybot: a chat with the Keybot keyboard up.
//
// What it makes, in tools/media/store/out/ (all RGB PNG, no alpha, sRGB):
//   ios-6.9/NN-<key>.png      1320 x 2868   App Store, iPhone 6.9" (the size App Store Connect asks for first)
//   ios-6.5/NN-<key>.png      1284 x 2778   App Store, iPhone 6.5"
//   play-phone/NN-<key>.png   1080 x 1920   Google Play, phone (its own set: frames with `play: false` are left out)
//   play-feature.png          1024 x 500    Google Play feature graphic
//   search-mock.png           the first three as App Store search shows them, in a results row, to judge them at that size
//   sheet.png                 every frame on one page, to review
//   screens/                  the app screens, as drawn by the app's own renderer (screens.mts), and report.json
//
// The frames, their words and screens are data: frames.mjs. A new bot's frame is one entry there.
// Fonts: fonts/ (Geist for the headlines, Caveat for the handwritten word, Roboto on Android's widget; all SIL OFL).
// Needs: TAILZU-BACKEND next to TAILZU-FRONTEND (or X0_BACKEND=<path to tulmi>), its node_modules, and Playwright's Chromium.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderArt, renderHang } from "./art.mjs";
import { surfaces, surfaceFonts, CLAY as BAR_CLAY } from "./surfaces.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(process.env.X0_BACKEND ?? path.join(HERE, "../../../../TAILZU-BACKEND/tulmi"));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (k) => args.includes(`--${k}`);
const only = opt("only") ? new RegExp(opt("only")) : null;

const { framesFor, SETS, DEFAULT_SET, FEATURE, BRAND, ICON, SIZES, APPS, COLORS, DICTATION } = await import(pathToFileURL(path.join(HERE, "frames.mjs")).href);
/** Which set (frames.mjs SETS): --set global (the default, written to out/) or --set india (out/india/). */
const SET = opt("set") ?? DEFAULT_SET;
const FRAMES = framesFor(SET);
const OUT = path.join(HERE, "out", SETS[SET].out);

function playwright() {
  const req = createRequire(import.meta.url);
  for (const p of ["playwright", "/opt/node-tools/node_modules/playwright", path.join(TULMI, "node_modules/playwright")]) {
    try { return req(p); } catch { /* next */ }
  }
  throw new Error("Playwright not found");
}

// ------------------------------------------------------------------ PNG: Chromium's RGBA in, RGB with an sRGB chunk out

function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** 8-bit, non-interlaced RGB or RGBA PNG to { w, h, rgb }. */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") {
      w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9];
      if (d[8] !== 8 || d[12] !== 0 || (type !== 2 && type !== 6)) throw new Error(`png: unsupported (depth ${d[8]}, type ${type}, interlace ${d[12]})`);
    } else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 0xff;
    }
  }
  if (bpp === 3) return { w, h, rgb: px };
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  return { w, h, rgb };
}
function encodeRgb({ w, h, rgb }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("sRGB", Buffer.from([0])), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const toStorePng = (shot) => encodeRgb(decodePng(shot));

// ------------------------------------------------------------------ the page

/** Files the page may load, served from disk at https://store.local/<abs path>. */
const ROOTS = [HERE, TULMI, path.resolve(HERE, "../brand"), path.resolve(HERE, "../../../app/targets"), OUT];
async function serve(page) {
  await page.route("https://store.local/**", (r) => {
    const f = decodeURIComponent(new URL(r.request().url()).pathname);
    if (!ROOTS.some((root) => f.startsWith(root + path.sep)) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
    const type = f.endsWith(".png") ? "image/png" : f.endsWith(".ttf") ? "font/ttf" : f.endsWith(".otf") ? "font/otf" : f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".jpg") ? "image/jpeg" : f.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    return r.fulfill({ body: fs.readFileSync(f), contentType: type });
  });
}
const url = (f) => `https://store.local${f.split(path.sep).map(encodeURIComponent).join("/")}`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The icon, once the brand helper has rendered it (frames.mjs ICON): ICON.file if set; else the icon-1024.png the folder's
 * README names on a line that says "pick"; else the only icon-1024.png in the folder (or its variants' folders). Null until then:
 * the frames are drawn without it, and the run says so.
 */
let iconSaid = false;
function iconFile() {
  const dir = path.resolve(HERE, ICON.dir);
  const say = (m) => { if (!iconSaid) console.log(`icon: ${m}`); iconSaid = true; };
  if (ICON.file) { const p = path.resolve(HERE, ICON.file); if (fs.existsSync(p)) { say(p); return p; } }
  if (!fs.existsSync(dir)) { say(`no ${dir} yet; drawn without the icon`); return null; }
  const found = [];
  const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 2) walk(p, depth + 1); else if (e.name === "icon-1024.png") found.push(p); } };
  walk(dir, 0);
  const readme = ["README.md", "readme.md"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (readme && found.length) {
    const lines = fs.readFileSync(readme, "utf8").split("\n").filter((l) => /pick/i.test(l));
    for (const l of lines) {
      const hit = found.find((f) => { const rel = path.relative(dir, f), v = path.basename(path.dirname(f)); return l.includes(rel) || new RegExp(`\\b${v.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`).test(l); });
      if (hit) { say(`${hit} (the README's pick)`); return hit; }
    }
  }
  if (found.length === 1) { say(`${found[0]} (the only one)`); return found[0]; }
  say(found.length ? `${found.length} icons in ${dir} and no pick named; set ICON.file in frames.mjs. Drawn without it` : `none in ${dir} yet (ICON slot empty); drawn without it`);
  return null;
}

function css(W, H) {
  const F = path.join(HERE, "fonts");
  return `
  @font-face{font-family:"Geist";font-weight:100 900;src:url(${url(path.join(F, "Geist[wght].ttf"))}) format("truetype")}
  @font-face{font-family:"Caveat";font-weight:700;src:url(${url(path.join(F, "Caveat-Bold.woff2"))}) format("woff2")}
  @font-face{font-family:"Caveat";font-weight:600;src:url(${url(path.join(F, "Caveat-SemiBold.woff2"))}) format("woff2")}
  ${surfaceFonts(url)}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${PAPER}}
  body{position:relative;font-family:Geist,sans-serif;color:${INK};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  `;
}

/** The app's colours (backend palette.ts): white paper, ink, greys. Colour on a frame is a bot's, or the icon's clay bar. */
const PAPER = "#FFFFFF", INK = "#0A0A0A", LINE = "#E6E6E6";
const S = surfaces({ url, name: SETS[SET].user.name.split(" ")[0] });
const BOT_COLOR = { code: COLORS.code, keybot: COLORS.keybot, plan: COLORS.plan, travel: COLORS.travel };

const svgFile = (f) => path.join(HERE, "icons", `${f}.svg`);
/** The art's key for a mark in a colour: underline-0a0a0a, arrow-c9683f. */
const markKey = (kind, color) => `${kind}-${(color ?? INK).replace("#", "").toLowerCase()}`;

/**
 * The headline: Geist, heavy, left aligned at the top left, ink; the *word* between stars is written by hand (Caveat) with a
 * brush underline under it in the frame's colour.
 */
function headline(title, u, o, art, color) {
  const ul = art[markKey("underline", color)];
  const words = esc(title).replace(/\n/g, "<br>").replace(/\*([^*]+)\*/g, (_, w) =>
    `<span class="hand">${w}${ul ? `<img class="ul" src="${url(ul.file)}">` : ""}</span>`);
  return `<h1 style="position:absolute;left:${o.left}px;right:${o.right}px;${o.top !== undefined ? `top:${o.top}px` : `bottom:${o.bottom}px`};text-align:left;
    font-family:Geist,sans-serif;font-weight:800;font-size:${o.size}px;line-height:1.02;letter-spacing:-.045em;color:${INK}">${words}</h1>
    <style>
      h1 .hand{position:relative;display:inline-block;font-family:Caveat,cursive;font-weight:700;font-size:1.34em;line-height:.7;letter-spacing:-.005em;
        transform:rotate(-2.5deg) translateY(.02em);margin:0 .02em;color:${INK}}
      h1 .ul{position:absolute;left:-6%;width:112%;bottom:-.2em;height:.28em;object-fit:fill;pointer-events:none}
    </style>`;
}

/** The page script: keeps the bot clear of the words (slides it along its edge toward the free side). */
const PLACE = `
window.place = () => {
  const bot = document.getElementById("mascot"), h1 = document.querySelector("h1");
  window.overlap = 0;
  if (bot && h1) {
    const r = document.createRange(); r.selectNodeContents(h1);
    const lines = [...r.getClientRects()], gap = innerWidth * 0.018;
    const hits = () => { const b = bot.getBoundingClientRect(); return lines.some((l) => l.right + gap > b.left && l.left - gap < b.right && l.bottom + gap > b.top && l.top - gap < b.bottom); };
    const lim = +bot.dataset.max, step = innerWidth * 0.01;
    while (hits() && parseFloat(bot.style.left) + step <= lim) bot.style.left = (parseFloat(bot.style.left) + step) + "px";
    window.overlap = hits() ? 1 : 0;
  }
};
window.place();
`;

/** A thin hand-drawn line around a rounded box, a little outside it (the card's outline), as an SVG path. */
function roughBox(x, y, w, h, r, seed, o = 8) {
  const pts = [], N = 220, rnd = (k) => Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453 % 1;
  const X = x - o, Y = y - o, Wd = w + 2 * o, Ht = h + 2 * o, R = r + o;
  const per = 2 * (Wd + Ht - 4 * R) + 2 * Math.PI * R;
  const at = (s) => { // a point at distance s along the rounded rect, from the top-left corner's end, clockwise
    const segs = [[Wd - 2 * R, (t) => [X + R + t, Y]], [Math.PI * R / 2, (t) => { const a = -Math.PI / 2 + t / R; return [X + Wd - R + R * Math.cos(a), Y + R + R * Math.sin(a)]; }],
      [Ht - 2 * R, (t) => [X + Wd, Y + R + t]], [Math.PI * R / 2, (t) => { const a = t / R; return [X + Wd - R + R * Math.cos(a), Y + Ht - R + R * Math.sin(a)]; }],
      [Wd - 2 * R, (t) => [X + Wd - R - t, Y + Ht]], [Math.PI * R / 2, (t) => { const a = Math.PI / 2 + t / R; return [X + R + R * Math.cos(a), Y + Ht - R + R * Math.sin(a)]; }],
      [Ht - 2 * R, (t) => [X, Y + Ht - R - t]], [Math.PI * R / 2, (t) => { const a = Math.PI + t / R; return [X + R + R * Math.cos(a), Y + R + R * Math.sin(a)]; }]];
    for (const [len, f] of segs) { if (s <= len) return f(s); s -= len; }
    return [X + R, Y];
  };
  for (let i = 0; i <= N * 1.04; i++) {
    const s = (i / N) * per % per, [px, py] = at(s), wob = 2.2 * Math.sin(i * 0.21 + seed) + 1.3 * Math.sin(i * 0.067 + seed * 2) + (rnd(i) - 0.5) * 0.8;
    const drift = i / N * 3;   // the end overshoots the start a little, as a pen does
    pts.push([px + wob * 0.6, py + wob + drift]);
  }
  return "M" + pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L");
}

/** The Peek-a-bot over an edge at (x, edgeY): its feet on the edge, `width` its drawn width. `max`: how far right it may slide. */
function mascotAt(art, pose, x, edgeY, width, max) {
  const a = art[`bot-${pose}`];
  if (!a) return "";
  const s = width / a.w, h = a.h * s;
  return `<img id="mascot" src="${url(a.file)}" data-max="${max - width / 2}" style="position:absolute;left:${x - width / 2}px;top:${edgeY - a.ledge * s}px;width:${width}px;height:${h}px;
    filter:drop-shadow(0 ${0.008 * width}px ${0.02 * width}px rgba(10,10,10,.14))">`;
}

/** An arrow, drawn by hand in the frame's colour, coming down and hooking in, its tip at (x, y); `flip` mirrors it. */
function arrowAt(art, color, x, y, width, flip) {
  const a = art[markKey("arrow", color)];
  if (!a) return "";
  const s = width / a.w, h = a.h * s, tx = (flip ? a.w - a.anchor[0] : a.anchor[0]) * s, ty = a.anchor[1] * s;
  return `<img src="${url(a.file)}" style="position:absolute;left:${x - tx}px;top:${y - ty}px;width:${width}px;height:${h}px;${flip ? "transform:scaleX(-1);" : ""}">`;
}

/** The headline's place and size on a frame: the first three's is bigger, for App Store search. */
function headBox(W, H, u, tall, pano) {
  if (pano) return tall ? { top: 0.058 * H, left: 92 * u, right: 60 * u, size: 0.152 * W } : { top: 0.062 * H, left: 80 * u, right: 50 * u, size: 0.128 * W };
  return { top: (tall ? 150 : 92) * u, left: (tall ? 84 : 72) * u, right: (tall ? 150 : 110) * u, size: (tall ? 104 : 96) * u };
}

/** One store frame at W x H, by its layout. */
function framePage(f, W, H, art) {
  const u = W / 1320, tall = H / W > 2;
  const layout = f.layout ?? "card";
  let body = "";
  if (layout === "card") body = cardLayer(f, W, H, u, tall, art);
  else if (layout === "tiles") body = tilesLayer(f, W, H, u, tall, art);
  else if (layout === "voice") body = voiceLayer(f, W, H, u, tall, art);
  else if (layout === "pano") body = panoLayer(f, W, H, u, tall, art);
  const words = headline(f.title, u, headBox(W, H, u, tall, layout === "pano"), art, f.accent);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}</style></head><body>
    ${body}
    ${words}
    <script>${PLACE}</script>
  </body></html>`;
}

/** A hairline on the inside of a white panel, so white sits on white. */
function paperEdge(r) {
  return `<div style="position:absolute;inset:0;border-radius:${r}px;pointer-events:none;box-shadow:inset 0 0 0 1.5px ${LINE}"></div>`;
}
const cardShadow = (u) => `0 ${50 * u}px ${130 * u}px rgba(10,10,10,.11),0 ${10 * u}px ${30 * u}px rgba(10,10,10,.06)`;
const popShadow = (u) => `0 ${40 * u}px ${100 * u}px rgba(10,10,10,.17),0 ${8 * u}px ${24 * u}px rgba(10,10,10,.08)`;

/** The card's frame on the page: where it sits, and its hand-drawn outline. */
function cardBox(f, W, H, u, tall) {
  const cw = Math.round(0.775 * W), cl = Math.round((W - cw) / 2);
  const ct = Math.round((f.cardTop ? (tall ? f.cardTop : f.cardTop + 0.02) : tall ? 0.215 : 0.235) * H);
  const cb = tall ? Math.round(0.928 * H) : H + 40;
  const r = 0.072 * W;
  const outline = `<svg style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none" viewBox="0 0 ${W} ${H}">
      <path d="${roughBox(cl, ct, cw, (tall ? cb : H + 200) - ct, r, f.key.length, 9 * u)}" fill="none" stroke="rgba(10,10,10,.22)" stroke-width="${2.2 * u}" stroke-linecap="round"/></svg>`;
  return { cw, cl, ct, cb, r, outline };
}

/** The white card: the top of the real screen in a rounded panel, the part of it lifted out (`pop`), the bot and the arrow. */
function cardLayer(f, W, H, u, tall, art) {
  const { cw, cl, ct, cb, r, outline } = cardBox(f, W, H, u, tall);
  const shot = path.join(OUT, "screens", `${f.key}.png`);
  let pop = "", arrow = "";
  const pj = path.join(OUT, "screens", `${f.key}.pop.json`);
  if (f.pop && fs.existsSync(pj)) {
    const p = JSON.parse(fs.readFileSync(pj, "utf8"));
    const k = cw / p.screen.w;
    const ex = cl + p.x * k, ey = ct + p.y * k, ew = p.width * k, eh = p.height * k;
    const wide = ew > 0.8 * cw;
    const pw = wide ? 0.89 * W : Math.min(0.9 * W, ew * 1.2);
    const ps = pw / ew, ph = eh * ps;
    const padded = !f.pop.card;
    const pad = padded ? 0.026 * W : 0;
    const boxW = pw + 2 * pad, boxH = ph + 2 * pad;
    let left = wide ? (W - boxW) / 2 : ex + ew / 2 - boxW / 2;
    if (f.pop.side === "left") left = Math.min(left, 0.03 * W);
    if (f.pop.side === "right") left = Math.max(left, W - boxW - 0.03 * W);
    left = Math.max(-0.08 * W, Math.min(W - boxW + 0.08 * W, left));
    const top = (f.pop.at !== undefined ? f.pop.at * H - boxH / 2 : ey + eh / 2 - boxH / 2) + (f.pop.nudge ?? 0) * H;
    const pr = padded ? 0.06 * W : Math.max(p.radius * k * ps, 0.04 * W);
    pop = `<div style="position:absolute;left:${left}px;top:${top}px;width:${boxW}px;height:${boxH}px;padding:${pad}px;border-radius:${pr}px;background:${PAPER};overflow:hidden;box-shadow:${popShadow(u)}">
      <img src="${url(shot.replace(/\.png$/, ".pop.png"))}" style="display:block;width:${pw}px;height:${ph}px">
      ${paperEdge(pr)}
    </div>`;
    const flip = (f.arrow ?? (f.pop.side === "right" ? "right" : "left")) === "right";
    // Its tail is in the gutter beside the card, its tip lands just inside the lifted part's top corner.
    const aw = 0.062 * W, tipY = top + 0.03 * W;
    arrow = f.arrow === false ? "" : flip ? arrowAt(art, f.accent, left + boxW - 0.05 * W, tipY, aw, true) : arrowAt(art, f.accent, left + 0.05 * W, tipY, aw, false);
  }
  const m = f.mascot ?? {};
  const bw = (m.size ?? 0.25) * W;
  const bot = mascotAt(art, m.pose ?? "happy", cl + cw * (m.x ?? 0.78), ct + 2 * u, bw, cl + cw - 0.03 * W);
  return `${outline}
    <div style="position:absolute;left:${cl}px;top:${ct}px;width:${cw}px;height:${cb - ct}px;border-radius:${r}px;overflow:hidden;background:${PAPER};box-shadow:${cardShadow(u)}">
      <img src="${url(shot)}" style="display:block;width:${cw}px">
      ${tall && f.fade ? `<div style="position:absolute;left:0;right:0;bottom:0;height:${0.075 * H}px;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.92) 70%,#fff)"></div>` : ""}
      ${paperEdge(r)}
    </div>${pop}${bot}${arrow}`;
}

/**
 * Keybot: the card holds the foot of X0's own family chat (the screen, its composer holding what Keybot wrote) and under it
 * the Keybot keyboard (surfaces.mjs), its mic key the Peek-a-bot (peekbot.js) held in `keyArt`'s moment. The arrow points
 * at the key.
 */
function voiceLayer(f, W, H, u, tall, art) {
  const { cw, cl, ct, cb, r, outline } = cardBox(f, W, H, u, tall);
  const shot = path.join(OUT, "screens", `${f.key}.png`);
  const vw = f.screen?.viewport?.w ?? SIZES.phone.w, z = cw / vw;
  const kbH = (8 + 44 + 10 + 4 * 44 + 3 * 10 + 20) * z, screenH = (cb - ct) - kbH;   // surfaces.mjs keyboard(), its foot 20 pt
  const k = { mode: "listen", level: 0.6, ...(f.keyArt ?? {}) };
  const wave = Array.from({ length: 18 }, (_, i) => 4 + 13 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))).map((h) => `<span style="display:inline-block;width:3px;height:${h.toFixed(1)}px;border-radius:2px;background:#6b6b70;margin:0 1.5px"></span>`).join("");
  const kb = S.keyboard({ w: vw, canvasId: "peekkey", suggestion: `<span style="display:flex;align-items:center">${wave}</span><span>Listening…</span>`, home: 20 });
  const m = f.mascot ?? {};
  const bw = (m.size ?? 0.25) * W;
  const bot = mascotAt(art, m.pose ?? "happy", cl + cw * (m.x ?? 0.78), ct + 2 * u, bw, cl + cw - 0.03 * W);
  const keyX = cl + (3 + 4 + 21) * z, keyY = ct + screenH + (8 + 1 + 21) * z;
  return `${outline}
    <div style="position:absolute;left:${cl}px;top:${ct}px;width:${cw}px;height:${cb - ct}px;border-radius:${r}px;overflow:hidden;background:${PAPER};box-shadow:${cardShadow(u)}">
      <div style="position:relative;height:${screenH}px;overflow:hidden"><img src="${url(shot)}" style="position:absolute;left:0;bottom:0;width:${cw}px"></div>
      <div style="zoom:${z}">${kb}</div>
      ${paperEdge(r)}
    </div>${bot}
    ${arrowAt(art, f.accent, keyX - 0.035 * W, keyY - 0.02 * W, 0.075 * W, false)}
    <script src="${url(path.join(HERE, "peekbot.js"))}"></script>
    <script>PeekBot.still(document.getElementById("peekkey"), ${JSON.stringify({ mode: k.mode, level: k.level, seconds: k.seconds })});</script>`;
}

/** The apps it works with: their marks on white tiles, a loose grid running off both sides; the bot peeks over one. */
function tilesLayer(f, W, H, u, tall, art) {
  const T = (tall ? 0.25 : 0.235) * W, G = 0.105 * W, rad = 0.225 * T;
  const rows = tall ? [0.415, 0.575, 0.735] : [0.4, 0.6, 0.8];
  const starts = [0.096 * W, -0.07 * W, 0.096 * W];
  let html = "", over = null;
  const m = f.mascot ?? {}, at = m.tile ?? 1, centres = [];
  APPS.forEach((slug, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    if (row >= rows.length) return;
    const x = starts[row] + col * (T + G), y = rows[row] * H - T / 2;
    centres.push({ x: x + T / 2, y: y + T / 2, row });
    if (i === at) over = { x: x + T / 2, y };
    html += `<div style="position:absolute;left:${x}px;top:${y}px;width:${T}px;height:${T}px;border-radius:${rad}px;background:${PAPER};display:flex;align-items:center;justify-content:center;box-shadow:${cardShadow(u)}">
      <img src="${url(svgFile(slug))}" style="width:${0.5 * T}px;height:${0.5 * T}px">${paperEdge(rad)}</div>`;
  });
  const bw = (m.size ?? 0.24) * W;
  return strings(centres, T + G, u) + html + (over ? mascotAt(art, m.pose ?? "starry", over.x, over.y + 2 * u, bw, over.x) : "");
}

/** Hand-drawn strings tying every app to its neighbours: ink twine, sagging, wobbling like a line drawn by hand, behind the tiles. */
function strings(centres, step, u) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pairs = [];
  centres.forEach((a, i) => centres.forEach((b, j) => {
    if (j <= i) return;
    const dx = Math.abs(a.x - b.x), same = a.row === b.row, next = b.row === a.row + 1;
    if ((same && dx < step * 1.2) || (next && dx < step * 0.8)) pairs.push([a, b]);
  }));
  const paths = pairs.map(([a, b]) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y), sag = len * (0.16 + 0.1 * rnd()), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + sag;
    const ph = rnd() * 9, pts = [];
    for (let k = 0; k <= 64; k++) {
      const t = k / 64, x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
      const tx = 2 * (1 - t) * (cx - a.x) + 2 * t * (b.x - cx), ty = 2 * (1 - t) * (cy - a.y) + 2 * t * (b.y - cy), tl = Math.hypot(tx, ty) || 1;
      const wob = (2.6 * Math.sin(t * 9.3 + ph) + 1.4 * Math.sin(t * 23.1 + ph * 2)) * u;
      pts.push([x - (ty / tl) * wob, y + (tx / tl) * wob]);
    }
    const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L");
    return `<path d="${d}" stroke="${INK}" stroke-width="${4.5 * u}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
  });
  return `<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${paths.join("")}</svg>`;
}

// ------------------------------------------------------------------ the first three: one panorama

/** Where the bar runs on a frame of this shape, and how thick it is: the same on all three, so they join. */
function panoGeom(W, H, tall) {
  return tall ? { barY: 0.283 * H, barH: 0.138 * W, side: 0.072 * W } : { barY: 0.298 * H, barH: 0.118 * W, side: 0.075 * W };
}

/**
 * The icon's clay bar, painted the icon's way (flat, its edges cut in short uneven facets), one bar across all three
 * frames: drawn on a strip three frames wide and cut at this frame's third. It starts in the first and ends in the third.
 */
function panoBar(W, H, i, g) {
  let seed = 4242;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const x0 = 0.045 * W, x1 = 3 * W - 0.045 * W, top = g.barY - g.barH / 2, bot = g.barY + g.barH / 2, step = 0.04 * W, j = g.barH * 0.035;
  const upper = [], lower = [];
  for (let x = x0 + step * 0.6; x < x1 - step * 0.6; x += step * (0.6 + 0.8 * rnd())) upper.push([x, top + (rnd() - 0.5) * 2 * j]);
  for (let x = x1 - step * 0.6; x > x0 + step * 0.6; x -= step * (0.6 + 0.8 * rnd())) lower.push([x, bot + (rnd() - 0.5) * 2 * j]);
  const ends = [[x0 + j, top + j * 0.5], [x0 - j * 0.6, g.barY - g.barH * 0.15], [x0, bot - j]];
  const tail = [[x1 - j, bot - j * 0.4], [x1 + j * 0.8, g.barY + g.barH * 0.1], [x1 - j * 0.3, top + j]];
  const pts = [...ends.slice(0, 1), ...upper, ...tail.reverse(), ...lower, ...ends.slice(1).reverse()];
  const d = "M" + pts.map(([x, y]) => `${(x - i * W).toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
  return `<svg style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:visible" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="${BAR_CLAY}"/></svg>`;
}

/** One of the first three: the bar, and what hangs from it (frames.mjs `focus`). */
function panoLayer(f, W, H, u, tall, art) {
  const g = panoGeom(W, H, tall), focus = f.focus ?? {}, bar = panoBar(W, H, f.pano ?? 0, g);
  const under = g.barY - g.barH * 0.18;   // a panel hung from the bar starts just under its top edge
  if (focus.kind === "hang") {
    // The launch's own layers, drawn big: his head behind the bar, his gloves on it, in front.
    // He is drawn a little smaller than a bar this thick would make him (his own bar piece is not drawn: the long bar is his).
    const h = art.hang, bb = h.barBox, s = 0.86 * g.barH / (bb.y1 - bb.y0), size = h.size * s;
    const left = W / 2 - size / 2, top = g.barY - ((bb.y0 + bb.y1) / 2) * s;
    const layer = (file) => `<img src="${url(file)}" style="position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px">`;
    // Under him, his team: the four built-in bots, their faces in their own colours, centred in the room that is left.
    const headBottom = top + 0.745 * size;
    const crew = [["code", "Code bot", "Fixes your<br>code"], ["keybot", "Keybot", "Writes what<br>you say"], ["plan", "Plan bot", "Plans<br>your day"], ["travel", "Travel bot", "Sorts<br>your trips"]];
    const fs1 = (tall ? 0.044 : 0.038) * W, fs2 = (tall ? 0.033 : 0.03) * W, fz = (tall ? 0.205 : 0.15) * W;
    const block = fz + 0.012 * W + fs1 * 1.1 + fs2 * 2.4;
    const crewTop = headBottom + (tall ? 0.05 : 0.03) * H;
    const crewRow = `<div style="position:absolute;left:${g.side * 0.6}px;right:${g.side * 0.6}px;top:${crewTop}px;display:flex;justify-content:space-between">
      ${crew.map(([slug, name, does]) => `<div style="width:${(W - 1.2 * g.side) / 4}px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:${0.008 * W}px">
        <img src="${url(path.join(TULMI, "blip/bots", `head-${slug}.png`))}" style="width:${fz}px;height:${fz}px;margin-bottom:${0.004 * W}px">
        <div style="font:650 ${fs1}px/1.1 Geist;letter-spacing:-.02em;color:${INK};white-space:nowrap">${name}</div>
        <div style="font:500 ${fs2}px/1.2 Geist;letter-spacing:-.01em;color:${BOT_COLOR[slug]}">${does}</div></div>`).join("")}</div>`;
    // And where you reach them: Home's "Ask any bot…", with the keyboard's peek-bot key in it, where there is room for it.
    const ah = (tall ? 0.13 : 0.11) * W, askTop = H - (tall ? 0.085 : 0.06) * H - ah;
    const ask = askTop - (crewTop + block) < 0.03 * H ? "" : `<div style="position:absolute;left:${g.side}px;right:${g.side}px;top:${askTop}px;height:${ah}px;border-radius:${ah / 2}px;background:#F5F5F5;border:${2 * u}px solid ${LINE};display:flex;align-items:center;padding:0 ${0.012 * W}px 0 ${0.055 * W}px">
      <div style="flex:1;font:500 ${0.046 * W}px Geist;letter-spacing:-.015em;color:#5C5C5C">Ask any bot…</div>
      <img src="${url(path.resolve(HERE, "../../../app/targets/widgets/Assets.xcassets/X0Peek.imageset/x0-peek@3x.png"))}" style="width:${ah - 0.022 * W}px;height:${ah - 0.022 * W}px"></div>`;
    return `${layer(h.head)}${bar}${layer(h.hands)}${crewRow}${ask}`;
  }
  if (focus.kind === "widget" || focus.kind === "android-widget") {
    // A slice of the Home Screen hung from the bar: the X0 widget asking for Code bot, its first answer pointed at.
    const ios = focus.kind === "widget";
    const pw = W - 2 * g.side, pr = 0.085 * W, ptop = under, pbot = H - (tall ? 0.05 : 0.04) * H;
    const ww = ios ? 338 : 376, wh = ios ? 354 : 440, inset = (ios ? 0.04 : 0.05) * W, z = (pw - 2 * inset) / ww;
    const wtop = g.barY + g.barH / 2 + (tall ? 0.045 : 0.03) * H;
    const widget = ios ? S.iosLarge("needs") : S.androidLarge("needs");
    const label = ios ? `<div style="position:absolute;left:0;right:0;top:${wtop - ptop + wh * z + 0.012 * W}px;text-align:center;font:500 ${0.03 * W}px Inter,Geist;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.3)">X0</div>` : "";
    // The first answer's left edge and middle, in the widget's points (surfaces.mjs: its margin, the greeting and the week,
    // the card's border and padding, its header row, the question's two lines, the answers' row).
    const ax = g.side + inset + (ios ? 16 + 1 + 14 : 16 + 16) * z, ay = wtop + (ios ? 16 + 34.6 + 12 + 1 + 12 + 30 + 2 + 41 + 12 + 16 : 16 + 18 + 6 + 16 + 14 + 14 + 34 + 4 + 46 + 14 + 18) * z;
    return `<div style="position:absolute;left:${g.side}px;top:${ptop}px;width:${pw}px;height:${pbot - ptop}px;border-radius:${pr}px;overflow:hidden;background:${S.WALL[ios ? "ios" : "android"]};box-shadow:${cardShadow(u)}">
        <div style="position:absolute;left:${inset}px;top:${wtop - ptop}px"><div style="zoom:${z}">${widget}</div></div>${label}</div>
      ${bar}${arrowAt(art, INK, ax - 0.012 * W, ay, 0.085 * W, false)}`;
  }
  if (focus.kind === "lock" || focus.kind === "phone") {
    // A phone hung behind the bar: its Lock Screen with Bots at work (iOS), or the app's own job screen (Android).
    const ios = focus.kind === "lock";
    const sw = ios ? 440 : 412, sh = ios ? 956 : 892, bez = 14, z = (W - 2 * (tall ? 0.065 : 0.055) * W) / (sw + 2 * bez);
    // The Lock Screen's top (the island, the status bar) goes behind the bar; the app's screen shows from its header down.
    const top = ios ? g.barY - g.barH / 2 - 4 * z : g.barY + g.barH / 2 - (bez + 36) * z;
    const inner = ios
      ? S.iosLock({ activity: S.liveBanner("working"), bannerTop: 400 })
      : `<img src="${url(path.join(OUT, "screens", `${f.key}.png`))}" style="display:block;width:${sw}px;height:${sh}px">`;
    const ph = S.phone(inner, { w: sw, h: sh, platform: ios ? "ios" : "android", radius: ios ? 62 : 44 });
    return `<div style="position:absolute;left:${(W - (sw + 2 * bez) * z) / 2}px;top:${top}px;filter:drop-shadow(0 ${30 * u}px ${50 * u}px rgba(10,10,10,.16))"><div style="zoom:${z}">${ph}</div></div>${bar}`;
  }
  return bar;
}

async function shoot(browser, html, W, H, file) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  try {
    await serve(page);
    await page.route("https://store.local/frame.html", (r) => r.fulfill({ contentType: "text/html", body: html }));
    await page.goto("https://store.local/frame.html");
    await page.evaluate(`(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))); })()`);
    await page.evaluate("window.place && window.place()");
    const placed = await page.evaluate("window.placed || null");
    const overlap = await page.evaluate("window.overlap || 0");
    const clipped = await page.evaluate(`(() => [...document.querySelectorAll("h1,p.sub,.kicker")].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth).map((e) => e.textContent.slice(0, 40)))()`);
    const lines = await page.evaluate(`(() => {
      const h = document.querySelector("h1"); if (!h) return 0;
      const r = document.createRange(); r.selectNodeContents(h);
      const lh = parseFloat(getComputedStyle(h).lineHeight), tops = [];
      for (const b of r.getClientRects()) if (b.width > 1 && !tops.some((t) => Math.abs(t - b.top) < lh * 0.5)) tops.push(b.top);
      return tops.length;
    })()`);
    const shot = await page.screenshot({ type: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, toStorePng(shot));
    return { clipped, lines, placed, overlap };
  } finally {
    await page.close();
  }
}

// ------------------------------------------------------------------ the command

function renderScreens() {
  const cli = ["tsx", path.join(HERE, "screens.mts"), "--set", SET, "--out", path.join(OUT, "screens"), ...(only ? ["--only", only.source] : [])];
  console.log(`screens: npx ${cli.join(" ")}   (in ${TULMI})`);
  const r = spawnSync("npx", cli, { cwd: TULMI, stdio: "inherit" });
  if (r.status !== 0) throw new Error("screens.mts failed");
}

/**
 * The Play feature graphic: white, the icon's clay bar across it, the bot hanging from it (the launch's own layers), and the
 * mark and one line beside him. Everything that reads sits well inside the middle, away from the edges Play may crop.
 */
function featurePage(W, H, art) {
  const h = art.hang, bb = h.barBox, barY = 0.31 * H, barH = 0.088 * H, s = barH / (bb.y1 - bb.y0), size = h.size * s;
  const left = 0.33 * W - size / 2, top = barY - ((bb.y0 + bb.y1) / 2) * s;
  const layer = (file) => `<img src="${url(file)}" style="position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px">`;
  const bar = `<svg style="position:absolute;left:0;top:0;width:${W}px;height:${H}px" viewBox="0 0 ${W} ${H}"><path d="${(() => {
    let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const t = barY - barH / 2, b = barY + barH / 2, up = [], lo = [];
    for (let x = -10; x <= W + 10; x += 22 + 26 * rnd()) up.push(`${x.toFixed(1)},${(t + (rnd() - 0.5) * 3).toFixed(1)}`);
    for (let x = W + 10; x >= -10; x -= 22 + 26 * rnd()) lo.push(`${x.toFixed(1)},${(b + (rnd() - 0.5) * 3).toFixed(1)}`);
    return "M" + [...up, ...lo].join("L") + "Z";
  })()}" fill="${BAR_CLAY}"/></svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}</style></head><body>
    ${layer(h.head)}${bar}${layer(h.hands)}
    <div style="position:absolute;left:${0.53 * W}px;top:${0.44 * H}px;font:800 ${0.27 * H}px/0.9 Geist;letter-spacing:-.05em;color:${INK}">${esc(FEATURE.mark)}</div>
    <div style="position:absolute;left:${0.535 * W}px;top:${0.71 * H}px;font:600 ${0.075 * H}px/1.1 Geist;letter-spacing:-.025em;color:${INK}">${esc(FEATURE.line)}</div>
  </body></html>`;
}

/**
 * App Store search, as an iPhone shows it: the query, one result (the icon, the store name, the subtitle, Get) and its first
 * three screenshots side by side, the next result greyed out under it. To judge the first three at the size they are seen.
 */
function searchMockPage(shots, W, H) {
  const k = W / 440, icon = iconFile();
  const sw = (440 - 2 * 20 - 2 * 8) / 3, sh = sw * 2868 / 1320;
  const glass = `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="#8a8a8e" stroke-width="2.4"/><path d="M15.5 15.5 21 21" stroke="#8a8a8e" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  const tab = (label, on) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;color:${on ? "#0a84ff" : "#8a8a8e"};font:500 10px Inter,Geist">
    <div style="width:26px;height:24px;border-radius:7px;background:${on ? "#0a84ff" : "#b8b8bd"};opacity:${on ? 1 : 0.55}"></div>${label}</div>`;
  const row = (dim) => `<div style="display:flex;align-items:center;gap:12px;opacity:${dim ? 0.35 : 1}">
      ${dim ? `<div style="width:64px;height:64px;border-radius:15px;background:#d9d9de"></div>` : `<img src="${url(icon)}" style="width:64px;height:64px;border-radius:15px;box-shadow:0 0 0 .5px rgba(0,0,0,.12)">`}
      <div style="flex:1;min-width:0">${dim ? `<div style="width:150px;height:14px;border-radius:4px;background:#d9d9de"></div><div style="margin-top:7px;width:110px;height:11px;border-radius:4px;background:#e5e5ea"></div>`
        : `<div style="font:600 17px/21px Inter,Geist;letter-spacing:-.3px;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(SEARCH.name)}</div><div style="font:400 13px/17px Inter,Geist;color:#8a8a8e">${esc(SEARCH.subtitle)}</div>`}</div>
      <div style="width:74px;height:30px;border-radius:15px;background:#eef0f5;color:#0a84ff;font:700 15px/30px Inter,Geist;text-align:center">${dim ? "" : "Get"}</div></div>`;
  const shotsRow = (files) => `<div style="display:flex;gap:8px;margin-top:14px">${files.map((f) => f
    ? `<img src="${url(f)}" style="width:${sw}px;height:${sh}px;border-radius:12px;box-shadow:0 0 0 .5px rgba(0,0,0,.14)">`
    : `<div style="width:${sw}px;height:${sh}px;border-radius:12px;background:#ececf0"></div>`).join("")}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}body{background:#fff}</style></head><body>
    <div style="position:absolute;left:0;top:0;width:440px;height:956px;zoom:${k};font-family:Inter,Geist">
      <div style="position:relative;height:54px">${S.statusBar("#000", 440)}</div>
      <div style="display:flex;align-items:center;gap:10px;padding:6px 16px 0">
        <div style="flex:1;height:38px;border-radius:12px;background:#eeeef0;display:flex;align-items:center;gap:7px;padding:0 10px;font:400 17px Inter,Geist;color:#000">${glass}${esc(SEARCH.query)}</div>
        <div style="font:400 17px Inter,Geist;color:#0a84ff">Cancel</div></div>
      <div style="padding:22px 20px 0">${row(false)}${shotsRow(shots)}</div>
      <div style="height:.5px;background:#d1d1d6;margin:22px 20px 0"></div>
      <div style="padding:20px 20px 0">${row(true)}${shotsRow([null, null, null])}</div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:84px;background:rgba(249,249,251,.96);border-top:.5px solid #d1d1d6;display:flex;padding:8px 6px 0">
        ${tab("Today")}${tab("Games")}${tab("Apps")}${tab("Arcade")}${tab("Search", true)}</div>
    </div></body></html>`;
}
/** What the result row says: the store name and subtitle (docs/store-listing.md), and a query that finds it. */
const SEARCH = { name: "X0 Bot: Your AI Team", subtitle: "Players that make life easy", query: "x0 bot" };

/** Every frame on one page, to review (and to judge at the size a store shows them). */
async function writeSheet(browser, groups, file) {
  const W = Math.max(...groups.map((g) => 120 + Math.min(g.files.length, g.perRow ?? 99) * (g.width + 22)));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, 100)}
    html,body{height:auto;overflow:visible;background:#ECECEC}
    body{padding:56px 60px 70px}
    h2{font-weight:600;font-size:22px;letter-spacing:.06em;text-transform:uppercase;color:#5c5c5c;margin:44px 0 18px}
    h2:first-child{margin-top:0}
    .row{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
    figure{margin:0}
    figcaption{font-size:15px;color:#5c5c5c;margin-top:8px}
    img{display:block;border-radius:10px;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
  </style></head><body>
    ${groups.map((g) => `<h2>${esc(g.name)}</h2><div class="row">${g.files.map((f) => `<figure><img src="${url(f)}" style="width:${g.width}px"><figcaption>${esc(path.basename(f))}</figcaption></figure>`).join("")}</div>`).join("")}
  </body></html>`;
  const page = await browser.newPage({ viewport: { width: W, height: 1000 }, deviceScaleFactor: 1 });
  try {
    await serve(page);
    await page.route("https://store.local/sheet.html", (r) => r.fulfill({ contentType: "text/html", body: html }));
    await page.goto("https://store.local/sheet.html");
    await page.evaluate(`(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))); })()`);
    const shot = await page.screenshot({ type: "png", fullPage: true });
    fs.writeFileSync(file, toStorePng(shot));
  } finally {
    await page.close();
  }
}

/** Where the old name, or anything else a store would refuse, still shows in the screens (screens/report.json), per frame. */
function summarise(frames) {
  const f = path.join(OUT, "screens", "report.json");
  if (!fs.existsSync(f)) return;
  const rep = JSON.parse(fs.readFileSync(f, "utf8"));
  const lines = [];
  for (const fr of frames) {
    const r = rep[fr.key];
    if (!r) continue;
    const json = fs.existsSync(path.join(OUT, "screens", `${fr.key}.json`)) ? fs.readFileSync(path.join(OUT, "screens", `${fr.key}.json`), "utf8") : "";
    // Words a person can see or hear anywhere in the screen (labels, placeholders, toasts), not font names.
    const hidden = [...json.matchAll(/"(content|label|placeholder|message|title|accessibilityLabel|text)":\s*"([^"]*Tailzu[^"]*)"/gi)].map((m) => m[2]);
    for (const w of r.flags ?? []) lines.push(`  ${fr.key}: on screen: ${w}`);
    for (const w of [...new Set(hidden)]) if (!(r.text ?? "").includes(w)) lines.push(`  ${fr.key}: in the screen (not on show): ${JSON.stringify(w.slice(0, 90))}`);
  }
  console.log(lines.length ? `\nscreens: words to look at (old name, other names, money):\n${lines.join("\n")}` : "\nscreens: no old name, other company's name or amount on show in any frame.");
}

/** A frame as one store shows it: `ios` / `play` false leaves it out there; an object is that store's changes to it. */
function forStore(f, store) {
  const o = f[store];
  return o && typeof o === "object" ? { ...f, ...o } : f;
}

async function main() {
  if (!has("no-screens")) renderScreens();
  // A frame neither store takes is drawn by neither (frames.mjs `ios: false, play: false`), like one that is off.
  const all = FRAMES.filter((f) => !f.off && !(f.ios === false && f.play === false));
  if (!only) for (const t of SIZES.targets) fs.rmSync(path.join(OUT, t.dir), { recursive: true, force: true });
  if (!only) fs.rmSync(path.join(OUT, "ios-6.7"), { recursive: true, force: true });   // the earlier second iPhone size
  const { chromium } = playwright();
  const browser = await chromium.launch();
  const made = {};
  try {
    // The hand-drawn art: the bot in every pose a frame asks for, the brush marks in each frame's colour (art.mjs), and
    // the launch's layers drawn big (the hanging bot).
    const poses = new Set([...all.map((f) => f.mascot?.pose ?? (f.layout === "tiles" ? "starry" : "happy")), "hello"]);
    const colors = new Set([...all.map((f) => f.accent ?? COLORS.ink), COLORS.ink]);
    const art = await renderArt(browser, [
      ...[...poses].map((p) => ({ name: `bot-${p}`, kind: "bot", pose: p })),
      ...[...colors].flatMap((c) => [{ name: markKey("underline", c), kind: "underline", seed: 11, color: c }, { name: markKey("arrow", c), kind: "arrow", seed: 23, color: c }]),
    ], path.join(OUT, "art"));
    art.hang = await renderHang(browser, path.join(HERE, "out", "art"), 1632);
    for (const t of SIZES.targets) {
      made[t.dir] = [];
      // Each store's own set and order: Google Play takes 8, the App Store 10.
      const frames = all.filter((f) => f[t.store] !== false).map((f) => forStore(f, t.store));
      for (const f of frames.filter((x) => !only || only.test(x.key))) {
        const n = frames.indexOf(f) + 1;
        const file = path.join(OUT, t.dir, `${String(n).padStart(2, "0")}-${f.key}.png`);
        const r = await shoot(browser, framePage(f, t.w, t.h, art), t.w, t.h, file);
        made[t.dir].push(file);
        const bad = r.clipped.length || r.lines !== 2 || r.overlap;
        console.log(`${bad ? "CHECK  " : "ok     "} ${t.dir}/${path.basename(file)}  ${t.w}x${t.h}  headline ${r.lines} line(s)${r.clipped.length ? "  clipped: " + r.clipped.join(" | ") : ""}${r.overlap ? "  the bot touches the headline" : ""}`);
      }
      if (frames.length > t.max) console.warn(`  note: ${frames.length} frames; ${t.name} takes at most ${t.max}. The first ${t.max} are the ones to upload.`);
    }
    const feature = path.join(OUT, "play-feature.png");
    await shoot(browser, featurePage(1024, 500, art), 1024, 500, feature);
    console.log("ok      play-feature.png  1024x500");
    if (!only) {
      const ios = SIZES.targets[0], ios2 = SIZES.targets[1], play = SIZES.targets.find((t) => t.dir.startsWith("play"));
      const mock = path.join(OUT, "search-mock.png");
      await shoot(browser, searchMockPage(made[ios.dir].slice(0, 3), 1320, 2868), 1320, 2868, mock);
      console.log("ok      search-mock.png  1320x2868");
      const sheet = path.join(OUT, "sheet.png");
      await writeSheet(browser, [
        { name: `${SETS[SET].title} set · App Store · iPhone 6.9" ${ios.w} x ${ios.h}`, files: made[ios.dir], width: 300 },
        { name: `App Store · iPhone 6.5" ${ios2.w} x ${ios2.h}`, files: made[ios2.dir], width: 300 },
        { name: `Google Play · phone ${play.w} x ${play.h}`, files: made[play.dir], width: 300 },
        { name: "Google Play · feature graphic 1024 x 500", files: [feature], width: 1024 },
        { name: "App Store search, as an iPhone shows the first three", files: [mock], width: 600 },
      ], sheet);
      console.log(`sheet: ${sheet}`);
      if (opt("sheet")) { fs.copyFileSync(sheet, path.resolve(opt("sheet"))); console.log(`sheet: ${path.resolve(opt("sheet"))}`); }
    }
  } finally {
    await browser.close();
  }
  summarise(all);
}

await main();
