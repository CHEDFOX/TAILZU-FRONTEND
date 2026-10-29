// THE STORE SCREENSHOTS: one command re-renders everything.
//
//   node tools/media/store/build.mjs                 # screens (from the server's builders) + every store frame + the sheet
//   node tools/media/store/build.mjs --no-screens    # only re-compose, from the screens already in out/screens
//   node tools/media/store/build.mjs --only plan     # one frame (a regex on its key)
//   node tools/media/store/build.mjs --sheet /path/sheet.png   # also write the contact sheet there
//
// The look: a full-bleed warm photograph (photos/, graded here so the set reads as one shoot), a serif headline in two short
// lines, and the app as a light card cut from a real screen, with one part of it lifted out. Other shapes: `voice` (the photo,
// the words at the foot and the keyboard's Peek-a-bot mic key, peekbot.js) and `tiles` (the marks of the apps it works with, icons/).
//
// What it makes, in tools/media/store/out/ (all RGB PNG, no alpha, sRGB):
//   ios-6.9/NN-<key>.png      1320 x 2868   App Store, iPhone 6.9" (the size App Store Connect asks for first)
//   ios-6.7/NN-<key>.png      1290 x 2796   App Store, iPhone 6.7" / 6.5"
//   play-phone/NN-<key>.png   1080 x 1920   Google Play, phone (its own set: frames with `play: false` are left out)
//   play-feature.png          1024 x 500    Google Play feature graphic
//   sheet.png                 every frame on one page, to review
//   screens/                  the app screens, as drawn by the app's own renderer (screens.mts), and report.json
//
// The frames, their words, photos and screens are data: frames.mjs. A new bot's frame is one entry there.
// Fonts: fonts/ (Newsreader for the headlines, Geist; both SIL OFL). Photos and marks: photos/CREDITS.md.
// Needs: TAILZU-BACKEND next to TAILZU-FRONTEND (or X0_BACKEND=<path to tulmi>), its node_modules, and Playwright's Chromium.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(process.env.X0_BACKEND ?? path.join(HERE, "../../../../TAILZU-BACKEND/tulmi"));
const OUT = path.join(HERE, "out");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (k) => args.includes(`--${k}`);
const only = opt("only") ? new RegExp(opt("only")) : null;

const { FRAMES, FEATURE, BRAND, ICON, SIZES, APPS } = await import(pathToFileURL(path.join(HERE, "frames.mjs")).href);

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
const ROOTS = [HERE, TULMI, path.resolve(HERE, "../brand")];
async function serve(page) {
  await page.route("https://store.local/**", (r) => {
    const f = decodeURIComponent(new URL(r.request().url()).pathname);
    if (!ROOTS.some((root) => f.startsWith(root + path.sep)) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
    const type = f.endsWith(".png") ? "image/png" : f.endsWith(".ttf") ? "font/ttf" : f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
    return r.fulfill({ body: fs.readFileSync(f), contentType: type });
  });
}
const url = (f) => `https://store.local${f.split(path.sep).map(encodeURIComponent).join("/")}`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A headline: "\n" breaks a line; *word* is set in the serif italic. */
const rich = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\n/g, "<br>");

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
  @font-face{font-family:"Newsreader";font-weight:200 800;font-style:normal;src:url(${url(path.join(F, "Newsreader[opsz,wght].ttf"))}) format("truetype")}
  @font-face{font-family:"Geist";font-weight:400;src:url(${url(path.join(F, "Geist-Regular.ttf"))})}
  @font-face{font-family:"Geist";font-weight:500;src:url(${url(path.join(F, "Geist-Medium.ttf"))})}
  @font-face{font-family:"Geist";font-weight:600;src:url(${url(path.join(F, "Geist-SemiBold.ttf"))})}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#140b06}
  body{position:relative;font-family:Geist,sans-serif;color:#fff8ef;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  `;
}

/** The noise that keeps the dark gradients from banding, and makes the photos read as one shoot. */
const GRAIN = `<svg class="grain" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .6 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

const svgFile = (f) => path.join(HERE, "icons", `${f}.svg`);
const photoFile = (p) => path.join(HERE, "photos", p.file);

/**
 * The photograph, full bleed, and the grade every frame shares: lifted blacks and a warm cast (amber, terracotta, deep
 * brown), a vignette, and the shade the headline sits on (`head`: "top" or "bottom"). The photo's place is set by the page
 * (window.place) from its own size: centred on (x, y), zoomed, never showing an edge.
 */
function photoLayer(p, u, head) {
  const light = p.light ?? 0.55, warm = p.warm ?? 0.5, blur = (p.blur ?? 0) * u;
  const filter = `brightness(${(0.56 + light * 0.5).toFixed(3)}) contrast(1.08) saturate(0.96) sepia(${(warm * 0.18).toFixed(3)})${blur ? ` blur(${blur}px)` : ""}`;
  const shade = head === "none" ? "none" : head === "bottom"
    ? "linear-gradient(0deg, rgba(18,9,4,.86) 0%, rgba(18,9,4,.62) 24%, rgba(18,9,4,.18) 46%, rgba(18,9,4,0) 60%)"
    : "linear-gradient(180deg, rgba(18,9,4,.72) 0%, rgba(18,9,4,.42) 14%, rgba(18,9,4,.08) 28%, rgba(18,9,4,0) 38%)";
  return `
    <img id="photo" src="${url(photoFile(p))}" style="position:absolute;filter:${filter};${blur ? "transform:scale(1.04);" : ""}">
    <div style="position:absolute;inset:0;background:rgb(190,92,36);mix-blend-mode:soft-light;opacity:${(0.35 + warm * 0.45).toFixed(3)}"></div>
    <div style="position:absolute;inset:0;background:rgba(40,16,4,${(0.06 + warm * 0.1).toFixed(3)});mix-blend-mode:multiply"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 125% 95% at 50% 46%, rgba(10,5,2,0) 55%, rgba(10,5,2,.5) 100%)"></div>
    <div style="position:absolute;inset:0;background:${shade}"></div>
    ${GRAIN}`;
}

/** The headline: Newsreader, white, sentence case, two lines, centred. */
function headline(title, u, o) {
  return `<h1 style="position:absolute;left:${70 * u}px;right:${70 * u}px;${o.top !== undefined ? `top:${o.top}px` : `bottom:${o.bottom}px`};text-align:center;
    font-family:Newsreader,serif;font-weight:${o.weight ?? 400};font-variation-settings:'opsz' 60;font-size:${o.size}px;line-height:1.07;letter-spacing:-.012em;color:#fff8ef;
    text-shadow:0 ${2 * u}px ${36 * u}px rgba(10,5,2,.35)">${esc(title).replace(/\n/g, "<br>")}</h1>`;
}

/** The page script: places the photo (cover, focus, zoom), never showing an edge. */
const PLACE = `
window.place = () => {
  const P = window.PHOTO, img = document.getElementById("photo");
  if (!img || !img.naturalWidth) return;
  const W = innerWidth, H = innerHeight, iw = img.naturalWidth, ih = img.naturalHeight;
  const s = Math.max(W / iw, H / ih) * (P.zoom || 1), dw = iw * s, dh = ih * s;
  let left = W / 2 - (P.x ?? .5) * dw, top = H / 2 - (P.y ?? .5) * dh;
  left = Math.min(0, Math.max(W - dw, left)); top = Math.min(0, Math.max(H - dh, top));
  Object.assign(img.style, { left: left + "px", top: top + "px", width: dw + "px", height: dh + "px" });
};
window.place();
`;

/** One store frame at W x H, by its layout. */
function framePage(f, W, H) {
  const u = W / 1320, tall = H / W > 2;
  const layout = f.layout ?? "card";
  const head = layout === "voice" ? "bottom" : "top";
  const size = (tall ? 108 : 100) * u;
  let body = "";
  if (layout === "card") body = cardLayer(f, W, H, u, tall);
  else if (layout === "tiles") body = tilesLayer(W, H, u, tall);
  else if (layout === "voice") body = voiceIcon(f, W, H, u, tall);
  const words = head === "top"
    ? headline(f.title, u, { top: (tall ? 150 : 96) * u, size })
    : headline(f.title, u, { bottom: H - voiceKey(f, W, H, tall).top + (tall ? 90 : 56) * u, size });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}
    .grain{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;pointer-events:none}
  </style></head><body>
    ${photoLayer(f.photo, u, head)}
    ${body}
    ${words}
    <script>window.PHOTO = ${JSON.stringify(f.photo)};${PLACE}</script>
  </body></html>`;
}

/** The light card: the top of the real screen in a rounded panel, and the part of it lifted out (`pop`). */
function cardLayer(f, W, H, u, tall) {
  const cw = Math.round(0.775 * W), cl = Math.round((W - cw) / 2);
  const ct = Math.round((tall ? 0.205 : 0.215) * H);
  const cb = tall ? Math.round(0.928 * H) : H + 40;
  const r = 0.072 * W;
  const shot = path.join(OUT, "screens", `${f.key}.png`);
  let pop = "";
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
    if (f.pop.side === "left") left = Math.min(left, 0.03 * W) - (wide ? 0 : 0.0 * W);
    if (f.pop.side === "right") left = Math.max(left, W - boxW - 0.03 * W);
    left = Math.max(-0.08 * W, Math.min(W - boxW + 0.08 * W, left));
    const top = (f.pop.at !== undefined ? f.pop.at * H - boxH / 2 : ey + eh / 2 - boxH / 2) + (f.pop.nudge ?? 0) * H;
    const pr = padded ? 0.06 * W : Math.max(p.radius * k * ps, 0.04 * W);
    pop = `<div style="position:absolute;left:${left}px;top:${top}px;width:${boxW}px;height:${boxH}px;padding:${pad}px;border-radius:${pr}px;background:#fff;overflow:hidden;
      box-shadow:0 ${46 * u}px ${110 * u}px rgba(12,6,2,.5),0 ${10 * u}px ${30 * u}px rgba(12,6,2,.22)">
      <img src="${url(shot.replace(/\.png$/, ".pop.png"))}" style="display:block;width:${pw}px;height:${ph}px">
    </div>`;
  }
  return `<div style="position:absolute;left:${cl}px;top:${ct}px;width:${cw}px;height:${cb - ct}px;border-radius:${r}px;overflow:hidden;background:#fff;
      box-shadow:0 ${60 * u}px ${150 * u}px rgba(12,6,2,.55),0 ${12 * u}px ${40 * u}px rgba(12,6,2,.25)">
      <img src="${url(shot)}" style="display:block;width:${cw}px">
      ${tall && f.fade ? `<div style="position:absolute;left:0;right:0;bottom:0;height:${0.075 * H}px;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.92) 70%,#fff)"></div>` : ""}
    </div>${pop}`;
}

/** The apps it works with: their marks on white tiles, a loose grid running off both sides. */
function tilesLayer(W, H, u, tall) {
  const T = (tall ? 0.25 : 0.235) * W, G = 0.105 * W, rad = 0.225 * T;
  const rows = tall ? [0.395, 0.555, 0.715] : [0.375, 0.575, 0.775];
  const starts = [0.096 * W, -0.07 * W, 0.096 * W];
  let html = "";
  APPS.forEach((slug, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    if (row >= rows.length) return;
    const x = starts[row] + col * (T + G), y = rows[row] * H - T / 2;
    html += `<div style="position:absolute;left:${x}px;top:${y}px;width:${T}px;height:${T}px;border-radius:${rad}px;background:#fff;display:flex;align-items:center;justify-content:center;
      box-shadow:0 ${28 * u}px ${70 * u}px rgba(10,5,2,.45),0 ${6 * u}px ${18 * u}px rgba(10,5,2,.2)">
      <img src="${url(svgFile(slug))}" style="width:${0.5 * T}px;height:${0.5 * T}px"></div>`;
  });
  return html;
}

/**
 * The mark under a `voice` frame's words: the keyboard's own mic key, the Peek-a-bot (peekbot.js, the reference drawing code
 * the native keys follow), held in one moment (frames.mjs `keyArt`: mode "listen" popped up with ears and antenna lit, or "idle"
 * peeking over the rim), drawn at 600 px on a canvas, with a soft shadow.
 */
/** Where the mic key sits: centred, its foot a fixed share above the frame's foot; the words go above it. */
function voiceKey(f, W, H, tall) {
  const k = { mode: "listen", level: 0.6, size: 0.22, ...(f.keyArt ?? {}) };
  const d = (tall ? k.size : k.size * 0.9) * W, bottom = (tall ? 0.94 : 0.925) * H;
  return { ...k, d, top: bottom - d };
}

function voiceIcon(f, W, H, u, tall) {
  const k = voiceKey(f, W, H, tall), d = k.d;
  return `<canvas id="peekkey" width="600" height="600" style="position:absolute;left:${(W - d) / 2}px;top:${k.top}px;width:${d}px;height:${d}px;border-radius:50%;
      box-shadow:0 ${24 * u}px ${60 * u}px rgba(8,4,2,.55),0 ${6 * u}px ${16 * u}px rgba(8,4,2,.35),0 0 0 ${2 * u}px rgba(255,240,220,.07)"></canvas>
    <script src="${url(path.join(HERE, "peekbot.js"))}"></script>
    <script>PeekBot.still(document.getElementById("peekkey"), ${JSON.stringify({ mode: k.mode, level: k.level, seconds: k.seconds })});</script>`;
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
    return { clipped, lines, placed };
  } finally {
    await page.close();
  }
}

// ------------------------------------------------------------------ the command

function renderScreens() {
  const cli = ["tsx", path.join(HERE, "screens.mts"), "--out", path.join(OUT, "screens"), ...(only ? ["--only", only.source] : [])];
  console.log(`screens: npx ${cli.join(" ")}   (in ${TULMI})`);
  const r = spawnSync("npx", cli, { cwd: TULMI, stdio: "inherit" });
  if (r.status !== 0) throw new Error("screens.mts failed");
}

/** The Play feature graphic: the first frame's photo, its words on the left, its screen as a card on the right. */
function featurePage(W, H) {
  const f = FRAMES.find((x) => x.key === FEATURE.frame) ?? FRAMES[0];
  const u = W / 1024;
  const shot = path.join(OUT, "screens", `${f.key}.png`);
  const iconPath = iconFile();
  const cw = 300 * u, cl = W - cw - 92 * u, ct = 62 * u;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}
    .grain{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;pointer-events:none}
  </style></head><body>
    ${photoLayer({ ...f.photo, ...(FEATURE.photo ?? {}) }, u, "none")}
    <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(18,9,4,.82) 0%, rgba(18,9,4,.55) 38%, rgba(18,9,4,0) 70%)"></div>
    <div style="position:absolute;left:${74 * u}px;top:0;bottom:0;width:${560 * u}px;display:flex;flex-direction:column;justify-content:center;gap:${22 * u}px">
      <div style="display:flex;align-items:center;gap:${12 * u}px;font:500 ${16 * u}px Geist;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,248,239,.75)">
        ${iconPath ? `<img src="${url(iconPath)}" style="width:${44 * u}px;height:${44 * u}px;border-radius:${10 * u}px">` : ""}${esc(BRAND.name)}</div>
      <h1 style="font-family:Newsreader,serif;font-weight:400;font-variation-settings:'opsz' 60;font-size:${62 * u}px;line-height:1.06;letter-spacing:-.012em;color:#fff8ef">${esc(FEATURE.title).replace(/\n/g, "<br>")}</h1>
    </div>
    <div style="position:absolute;left:${cl}px;top:${ct}px;width:${cw}px;height:${H - ct + 30}px;border-radius:${28 * u}px;overflow:hidden;background:#fff;
      box-shadow:0 ${30 * u}px ${70 * u}px rgba(12,6,2,.55)"><img src="${url(shot)}" style="display:block;width:${cw}px"></div>
    <script>window.PHOTO = ${JSON.stringify({ ...f.photo, ...(FEATURE.photo ?? {}) })};${PLACE}</script>
  </body></html>`;
}

/** Every frame on one page, to review (and to judge at the size a store shows them). */
async function writeSheet(browser, groups, file) {
  const W = 3150;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, 100)}
    html,body{height:auto;overflow:visible;background:#1b1a19}
    body{padding:56px 60px 70px}
    h2{font-weight:500;font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:rgba(244,236,225,.6);margin:44px 0 18px}
    h2:first-child{margin-top:0}
    .row{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
    figure{margin:0}
    figcaption{font-size:15px;color:rgba(244,236,225,.5);margin-top:8px}
    img{display:block;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.08)}
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

async function main() {
  if (!has("no-screens")) renderScreens();
  const all = FRAMES.filter((f) => !f.off);
  if (!only) for (const t of SIZES.targets) fs.rmSync(path.join(OUT, t.dir), { recursive: true, force: true });
  const { chromium } = playwright();
  const browser = await chromium.launch();
  const made = {};
  try {
    for (const t of SIZES.targets) {
      made[t.dir] = [];
      // Each store's own set: Google Play takes 8, so a frame may say `play: false`.
      const frames = all.filter((f) => f[t.store] !== false);
      for (const f of frames.filter((x) => !only || only.test(x.key))) {
        const n = frames.indexOf(f) + 1;
        const file = path.join(OUT, t.dir, `${String(n).padStart(2, "0")}-${f.key}.png`);
        const r = await shoot(browser, framePage(f, t.w, t.h), t.w, t.h, file);
        made[t.dir].push(file);
        const bad = r.clipped.length || r.lines !== 2;
        console.log(`${bad ? "CHECK  " : "ok     "} ${t.dir}/${path.basename(file)}  ${t.w}x${t.h}  headline ${r.lines} line(s)${r.clipped.length ? "  clipped: " + r.clipped.join(" | ") : ""}`);
      }
      if (frames.length > t.max) console.warn(`  note: ${frames.length} frames; ${t.name} takes at most ${t.max}. The first ${t.max} are the ones to upload.`);
    }
    const feature = path.join(OUT, "play-feature.png");
    await shoot(browser, featurePage(1024, 500), 1024, 500, feature);
    console.log("ok      play-feature.png  1024x500");
    if (!only) {
      const sheet = path.join(OUT, "sheet.png");
      const ios = SIZES.targets[0], play = SIZES.targets.find((t) => t.dir.startsWith("play"));
      await writeSheet(browser, [
        { name: `App Store · ${ios.w} x ${ios.h} (also exported at 1290 x 2796)`, files: made[ios.dir], width: 312 },
        { name: `Google Play · phone ${play.w} x ${play.h}`, files: made[play.dir], width: 312 },
        { name: "Google Play · feature graphic 1024 x 500", files: [feature], width: 1024 },
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
