// THE STORE SCREENSHOTS: one command re-renders everything.
//
//   node tools/media/store/build.mjs                 # screens (from the server's builders) + every store frame + the sheet
//   node tools/media/store/build.mjs --no-screens    # only re-compose, from the screens already in out/screens
//   node tools/media/store/build.mjs --only plan     # one frame (a regex on its key)
//   node tools/media/store/build.mjs --sheet /path/sheet.png   # also write the contact sheet there
//
// What it makes, in tools/media/store/out/ (all RGB PNG, no alpha, sRGB):
//   ios-6.9/NN-<key>.png      1320 x 2868   App Store, iPhone 6.9" (the size App Store Connect asks for first)
//   ios-6.7/NN-<key>.png      1290 x 2796   App Store, iPhone 6.7" / 6.5"
//   play-phone/NN-<key>.png   1080 x 1920   Google Play, phone
//   play-feature.png          1024 x 500    Google Play feature graphic
//   sheet.png                 every frame on one page, to review
//   screens/                  the app screens, as drawn by the app's own renderer (screens.mts), and report.json
//
// The frames, their words and their screens are data: frames.mjs. A new bot's frame is one entry there.
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

const { FRAMES, FEATURE, BRAND, ICON, SIZES } = await import(pathToFileURL(path.join(HERE, "frames.mjs")).href);

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
    const type = f.endsWith(".png") ? "image/png" : f.endsWith(".ttf") ? "font/ttf" : f.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
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
  @font-face{font-family:"Geist";font-weight:400;src:url(${url(path.join(F, "Geist-Regular.ttf"))})}
  @font-face{font-family:"Geist";font-weight:500;src:url(${url(path.join(F, "Geist-Medium.ttf"))})}
  @font-face{font-family:"Geist";font-weight:600;src:url(${url(path.join(F, "Geist-SemiBold.ttf"))})}
  @font-face{font-family:"Geist";font-weight:700;src:url(${url(path.join(F, "Geist-Bold.ttf"))})}
  @font-face{font-family:"Instrument Serif";font-style:normal;src:url(${url(path.join(F, "InstrumentSerif-Regular.ttf"))})}
  @font-face{font-family:"Instrument Serif";font-style:italic;src:url(${url(path.join(F, "InstrumentSerif-Italic.ttf"))})}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#0a0908}
  body{font-family:Geist,sans-serif;color:#f4ece1;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  `;
}

/** The noise that keeps the dark gradients from banding. */
const GRAIN = `<svg class="grain" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

/** A phone, drawn here (no maker's marks): titanium band, black bezel, the screen, an island, side keys, the status bar. */
function phone(screenFile, P, o = {}) {
  const { w: SW, h: SH, top: TOP } = SIZES.phone;
  const band = P * 0.0105, bezel = P * 0.0185, inner = P - 2 * (band + bezel);
  const sh = inner * SH / SW, total = sh + 2 * (band + bezel);
  const r = P * 0.158, pt = inner / SW; // px per point
  const island = { w: 125 * pt, h: 36.5 * pt, top: 11.5 * pt };
  const sb = { y: (TOP - 5) * pt / 2 + 3 * pt, size: 17 * pt };
  const ear = (inner - island.w) / 2;
  const t = o.time ?? "7:40";
  const ink = o.statusInk ?? "#0a0a0a";
  const icons = `
    <svg viewBox="0 0 18 12" style="height:${11.5 * pt}px"><g fill="${ink}"><rect x="0" y="8" width="3" height="4" rx=".9"/><rect x="5" y="5.5" width="3" height="6.5" rx=".9"/><rect x="10" y="3" width="3" height="9" rx=".9"/><rect x="15" y="0" width="3" height="12" rx=".9"/></g></svg>
    <svg viewBox="0 0 16 12" style="height:${11.5 * pt}px"><g fill="${ink}"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.3-1.4A10.7 10.7 0 0 0 8 .3 10.7 10.7 0 0 0 .7 3.2L2 4.6a8.7 8.7 0 0 1 6-2.4z"/><path d="M8 5.6c1.4 0 2.6.5 3.6 1.4l1.3-1.4A7.2 7.2 0 0 0 8 3.7a7.2 7.2 0 0 0-4.9 1.9L4.4 7c1-.9 2.2-1.4 3.6-1.4z"/><path d="M8 9.1c.5 0 1 .2 1.3.5L8 11.9 6.7 9.6c.3-.3.8-.5 1.3-.5z"/></g></svg>
    <svg viewBox="0 0 27 13" style="height:${12.5 * pt}px"><rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="${ink}" stroke-opacity=".38"/><rect x="2" y="2" width="20" height="9" rx="2.3" fill="${ink}"/><path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill="${ink}" fill-opacity=".45"/></svg>`;
  const keys = [
    { side: "l", y: 0.165, h: 0.034 }, { side: "l", y: 0.235, h: 0.062 }, { side: "l", y: 0.315, h: 0.062 }, { side: "r", y: 0.265, h: 0.098 },
  ].map((k) => `<i class="key ${k.side}" style="top:${k.y * total}px;height:${k.h * total}px"></i>`).join("");
  return {
    height: total,
    html: `<div class="phone" style="width:${P}px;height:${total}px;border-radius:${r}px;padding:${band}px">
      ${keys}
      <div class="bezel" style="border-radius:${r - band}px;padding:${bezel}px">
        <div class="screen" style="width:${inner}px;height:${sh}px;border-radius:${r - band - bezel}px">
          <img src="${url(screenFile)}" style="width:${inner}px;height:${sh}px">
          <div class="status" style="height:${TOP * pt}px">
            <div class="ear" style="width:${ear}px;font-size:${sb.size}px;padding-top:${sb.y - sb.size / 2}px;color:${ink}"><b>${t}</b></div>
            <div style="width:${island.w}px"></div>
            <div class="ear icons" style="width:${ear}px;padding-top:${sb.y - 6 * pt}px;gap:${5.5 * pt}px">${icons}</div>
          </div>
          <div class="island" style="width:${island.w}px;height:${island.h}px;top:${island.top}px;left:${(inner - island.w) / 2}px"></div>
          <div class="glass"></div>
        </div>
      </div>
    </div>`,
  };
}

const PHONE_CSS = (u) => `
  .phone{position:relative;background:linear-gradient(140deg,#5b5751 0%,#2a2826 18%,#1a1918 45%,#34312e 72%,#141312 100%);
    box-shadow:0 0 0 ${1.5 * u}px rgba(255,240,220,.10) inset, 0 ${2 * u}px ${1 * u}px rgba(255,255,255,.08) inset,
      0 ${90 * u}px ${160 * u}px rgba(0,0,0,.65), 0 ${30 * u}px ${60 * u}px rgba(0,0,0,.45)}
  .bezel{background:#050505;box-shadow:0 0 0 ${1 * u}px rgba(0,0,0,.9) inset;height:100%}
  .screen{position:relative;overflow:hidden;background:#fff}
  .screen img{display:block}
  .status{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start}
  .ear{display:flex;justify-content:center;font-weight:600;letter-spacing:-.01em;line-height:1}
  .ear b{font-weight:600}
  .icons{align-items:center}
  .island{position:absolute;background:#000;border-radius:999px;box-shadow:0 0 0 ${0.6 * u}px rgba(255,255,255,.04) inset}
  .island::after{content:"";position:absolute;right:22%;top:30%;width:${11 * u}px;height:${11 * u}px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#2b3550,#0a0c12 60%)}
  .glass{position:absolute;inset:0;background:linear-gradient(118deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,0) 32%);pointer-events:none}
  .key{position:absolute;width:${7 * u}px;background:linear-gradient(90deg,#2b2926,#56524c 50%,#2b2926);border-radius:${3 * u}px}
  .key.l{left:${-5 * u}px}.key.r{right:${-5 * u}px}
`;

const glow = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The hero's roster of bots (every frame with a `bot`), in rows of at most 4, the rows as even as they can be. */
function rosterRows(list) {
  const rows = Math.ceil(list.length / 4), per = Math.ceil(list.length / Math.max(1, rows)), out = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
}

/**
 * One store frame at W x H: the words on top (kicker, headline, one sentence), the phone under them. On the tall App Store
 * canvases the whole phone fits under the words; on Play's 9:16 it is larger and runs off the bottom edge on purpose.
 * The page places the phone once the words are laid out (window.layout), so a longer headline simply moves it down.
 */
function framePage(f, W, H, i, all) {
  const u = W / 1320;
  const tall = H / W > 2;
  const screen = path.join(OUT, "screens", `${f.key}.png`);
  const accent = f.accent ?? BRAND.accent;
  const pad = 90 * u;
  const titleSize = (f.titleSize ?? (tall ? 126 : 112)) * u;
  const P = Math.round((tall ? 1000 : 900) * u);
  const ph = phone(screen, P, { time: f.time });
  const iconPath = f.hero ? iconFile() : null;
  const roster = f.hero ? all.filter((x) => x.bot && !x.hero) : [];
  const layout = { tall, gap: (tall ? 92 : 64) * u, bottom: (tall ? 110 : 0) * u, bleed: tall ? 0 : 0.2, height: ph.height, width: P };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}${PHONE_CSS(u)}
    .bg{position:absolute;inset:0;background:
      radial-gradient(ellipse ${1500 * u}px ${900 * u}px at 50% ${-160 * u}px, rgba(255,226,192,.17), rgba(255,226,192,.05) 45%, rgba(255,226,192,0) 72%),
      radial-gradient(ellipse ${1500 * u}px ${1500 * u}px at 50% var(--gy), ${glow(accent, 0.30)}, ${glow(accent, 0.10)} 38%, ${glow(accent, 0)} 70%),
      linear-gradient(180deg,#0e0d0c 0%,#0a0908 50%,#060505 100%)}
    .grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay}
    .words{position:absolute;left:${pad}px;right:${pad}px;top:${(tall ? 176 : 118) * u}px;text-align:center}
    .kicker{display:inline-flex;align-items:center;gap:${16 * u}px;font-weight:500;font-size:${30 * u}px;letter-spacing:.18em;text-transform:uppercase;color:rgba(244,236,225,.72)}
    .kicker i{width:${14 * u}px;height:${14 * u}px;border-radius:50%;background:${accent};box-shadow:0 0 ${20 * u}px ${glow(accent, 0.95)}}
    h1{margin-top:${30 * u}px;min-height:${2.06 * titleSize}px;font-weight:600;font-size:${titleSize}px;line-height:1.03;letter-spacing:-.037em;color:#f7f0e7;text-wrap:balance}
    h1 em{font-family:"Instrument Serif";font-style:italic;font-weight:400;letter-spacing:-.012em;font-size:1.13em;line-height:.9;padding-right:.04em}
    p.sub{margin:${30 * u}px auto 0;max-width:${1040 * u}px;min-height:${f.hero ? 0 : 2.68 * (tall ? 44 : 41) * u}px;font-size:${(tall ? 44 : 41) * u}px;line-height:1.34;color:rgba(244,236,225,.64);text-wrap:balance}
    .roster{display:flex;justify-content:center;gap:${14 * u}px;margin:${16 * u}px auto 0}
    .rosters{margin-top:${44 * u}px}
    .roster span{display:inline-flex;align-items:center;gap:${12 * u}px;padding:${14 * u}px ${26 * u}px ${15 * u}px ${22 * u}px;border-radius:999px;
      font-size:${30 * u}px;font-weight:500;letter-spacing:-.005em;color:rgba(247,240,231,.88);
      background:linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.035));box-shadow:0 0 0 ${1.2 * u}px rgba(255,240,220,.13) inset,0 ${10 * u}px ${30 * u}px rgba(0,0,0,.35)}
    .roster span i{width:${12 * u}px;height:${12 * u}px;border-radius:50%;box-shadow:0 0 ${12 * u}px currentColor}
    .roster span.own{background:none;box-shadow:0 0 0 ${1.2 * u}px rgba(255,240,220,.28) inset;color:rgba(247,240,231,.7)}
    .stage{position:absolute;left:50%;top:0;width:${P}px;margin-left:${-P / 2}px;transform-origin:50% 0}
    .halo{position:absolute;left:${-0.08 * P}px;right:${-0.08 * P}px;top:${0.06 * ph.height}px;bottom:${0.04 * ph.height}px;border-radius:${0.3 * P}px;
      background:${glow(accent, 0.55)};filter:blur(${110 * u}px);opacity:.55}
    .floor{position:absolute;left:${0.08 * P}px;right:${0.08 * P}px;bottom:${-50 * u}px;height:${110 * u}px;border-radius:50%;background:rgba(0,0,0,.85);filter:blur(${40 * u}px)}
    .kicker:has(.icon){font-size:${34 * u}px;gap:${20 * u}px}
    .kicker .icon{width:${96 * u}px;height:${96 * u}px;border-radius:${22 * u}px;margin-right:${6 * u}px;box-shadow:0 ${16 * u}px ${40 * u}px rgba(0,0,0,.6),0 0 0 ${1 * u}px rgba(255,255,255,.08)}
  </style></head><body>
    <div class="bg"></div>${GRAIN}
    <div class="words">
      <div class="kicker">${iconPath ? `<img class="icon" src="${url(iconPath)}">` : "<i></i>"}${esc(f.kicker)}</div>
      <h1>${rich(f.title)}</h1>
      ${f.sub ? `<p class="sub">${rich(f.sub)}</p>` : ""}
      ${roster.length ? '<div class="rosters">' : ""}${rosterRows(roster).map((row) => `<div class="roster">${row.map((b) => b.bot.own
        ? `<span class="own">+ ${esc(b.bot.name)}</span>`
        : `<span style="color:${b.accent}"><i style="background:${b.accent}"></i><b style="font-weight:500;color:rgba(247,240,231,.9)">${esc(b.bot.name)}</b></span>`).join("")}</div>`).join("")}${roster.length ? "</div>" : ""}
    </div>
    <div class="stage"><div class="halo"></div><div class="floor"></div>${ph.html}</div>
    <script>window.layout = ${JSON.stringify(layout)};
      window.place = () => {
        const L = window.layout, words = document.querySelector(".words").getBoundingClientRect(), stage = document.querySelector(".stage");
        const top = words.bottom + L.gap;
        const fit = L.tall ? Math.min(1, (innerHeight - L.bottom - top) / L.height) : 1;
        stage.style.top = top + "px";
        stage.style.transform = "scale(" + fit + ")";
        document.querySelector(".bg").style.setProperty("--gy", (top + L.height * fit * 0.45) + "px");
        window.placed = { top, fit, bottom: top + L.height * fit };
      };
      window.place();
    </script>
  </body></html>`;
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

/** The Play feature graphic: the hero's words on the left, the hero's phone on the right running off the bottom. */
function featurePage(W, H) {
  const u = W / 1024;
  const f = FRAMES.find((x) => x.key === FEATURE.screen) ?? FRAMES[0];
  const accent = f.accent ?? BRAND.accent;
  const P = Math.round(330 * u);
  const ph = phone(path.join(OUT, "screens", `${f.key}.png`), P, { time: f.time });
  const iconPath = iconFile();
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(W, H)}${PHONE_CSS(u * 0.42)}
    .bg{position:absolute;inset:0;background:
      radial-gradient(ellipse ${700 * u}px ${420 * u}px at 72% 105%, ${glow(accent, 0.38)}, ${glow(accent, 0.08)} 45%, ${glow(accent, 0)} 72%),
      radial-gradient(ellipse ${760 * u}px ${380 * u}px at 22% -20%, rgba(255,226,192,.16), rgba(255,226,192,0) 70%),
      linear-gradient(180deg,#0e0d0c,#080707)}
    .grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay}
    .words{position:absolute;left:${70 * u}px;top:0;bottom:0;width:${560 * u}px;display:flex;flex-direction:column;justify-content:center}
    .brand{display:flex;align-items:center;gap:${14 * u}px;font-weight:500;font-size:${17 * u}px;letter-spacing:.2em;text-transform:uppercase;color:rgba(244,236,225,.72)}
    .brand i{width:${9 * u}px;height:${9 * u}px;border-radius:50%;background:${accent};box-shadow:0 0 ${12 * u}px ${glow(accent, 0.95)}}
    .brand img{width:${54 * u}px;height:${54 * u}px;border-radius:${12 * u}px;box-shadow:0 ${8 * u}px ${20 * u}px rgba(0,0,0,.5)}
    h1{margin-top:${20 * u}px;font-weight:600;font-size:${60 * u}px;line-height:1.03;letter-spacing:-.035em;color:#f7f0e7}
    h1 em{font-family:"Instrument Serif";font-style:italic;font-weight:400;letter-spacing:-.01em;font-size:1.13em;line-height:.9}
    p{margin-top:${18 * u}px;font-size:${22 * u}px;line-height:1.35;color:rgba(244,236,225,.64)}
    .stage{position:absolute;right:${80 * u}px;top:${58 * u}px;width:${P}px}
    .halo{position:absolute;inset:${20 * u}px ${-30 * u}px 0;border-radius:${100 * u}px;background:${glow(accent, 0.6)};filter:blur(${60 * u}px);opacity:.5}
  </style></head><body>
    <div class="bg"></div>${GRAIN}
    <div class="words">
      <div class="brand">${iconPath ? `<img src="${url(iconPath)}">` : "<i></i>"}${esc(BRAND.name)}</div>
      <h1>${rich(FEATURE.title)}</h1>
      <p>${rich(FEATURE.sub)}</p>
    </div>
    <div class="stage"><div class="halo"></div>${ph.html}</div>
  </body></html>`;
}

/** Every frame on one page, to review (and to judge at the size a store shows them). */
async function writeSheet(browser, groups, file) {
  const W = 2780;
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
  const frames = FRAMES.filter((f) => !f.off);
  const pick = frames.filter((f) => !only || only.test(f.key));
  if (!only) for (const t of SIZES.targets) fs.rmSync(path.join(OUT, t.dir), { recursive: true, force: true });
  const { chromium } = playwright();
  const browser = await chromium.launch();
  const made = {};
  try {
    for (const t of SIZES.targets) {
      made[t.dir] = [];
      for (const f of pick) {
        const n = frames.indexOf(f) + 1;
        const file = path.join(OUT, t.dir, `${String(n).padStart(2, "0")}-${f.key}.png`);
        const r = await shoot(browser, framePage(f, t.w, t.h, n, frames), t.w, t.h, file);
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
  summarise(frames);
}

await main();
