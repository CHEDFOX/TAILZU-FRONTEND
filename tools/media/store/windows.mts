// THE MICROSOFT STORE SET for X0 Bot on Windows: one command draws every image Partner Center asks for.
//
//   npx tsx tools/media/store/windows.mts                # the desktop screens (the window's own renderer) + every image
//   npx tsx tools/media/store/windows.mts --no-screens   # only re-compose, from the screens already in out/windows/screens
//
// The look is the phone set's (build.mjs): white paper, a heavy Geist headline at the top left with one word written by
// hand (Caveat) over a brush underline in the frame's bot's colour, and the painted bot of the icon. Each screenshot is a
// real screen of the desktop app, drawn by the window's own renderer (TAILZU-DESKTOP app.html + sdui.js, through the
// backend's scripts/bots-render) with the sample day, in a Windows 11 window.
//
// What it makes, in tools/media/store/out/windows/ (RGB PNG, sRGB):
//   screenshots/NN-<key>.png   3840 x 2160   Desktop screenshots (Partner Center: 1366 x 768 or larger, up to 10)
//   box-art-1x1.png            2160 x 2160   1:1 box art
//   poster-2x3.png             1440 x 2160   2:3 poster art
//   hero-16x9.png              3840 x 2160   16:9 super hero art (nothing in the bottom left, where the Store sets the title)
//   tile-300.png                300 x 300    1:1 app tile icon, round corners, clear outside them
//   sheet.png                                every image on one page, to review
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(process.env.X0_BACKEND ?? path.join(HERE, "../../../../TAILZU-BACKEND/tulmi"));
const imp = (rel: string) => import(pathToFileURL(path.join(TULMI, rel)).href);
process.env.PUBLIC_ORIGIN = "https://api.local";
const argv = process.argv.slice(2);
const OUT = path.join(HERE, "out/windows");
const SHOTS = path.join(OUT, "screens");
const ART = path.join(HERE, "out/art");
const url = (p: string) => pathToFileURL(p).href;

const INK = "#0A0A0A", PAPER = "#FFFFFF", LINE = "#E6E6E6";
/** The photo frames' colours (the phone set's): ink with an olive-teal undertone in the shadows, cream light, clay marks. */
const DARK = "#0C110F", CREAM = "#F6EEDF", CLAY = "#c9683f";
/** The bots' own colours (backend palette.ts), for the underline of a frame that is one bot's. */
const COLOR = { xode: "#4F7A3A", keylessbord: "#A9573A", plan: "#8F6A1F", travel: "#3E6E8E", ink: INK };

/**
 * The frames, in story order: the first is the one the Store shows first. As on the phone (build.mjs `card`): the app as
 * a white card cut from a real screen (`card`, in the screen's pixels: the window is drawn 2560 x 1600), one part of it
 * lifted out, bigger, over the card (`pop`) with the hand-drawn arrow at it, and the bot peeking over the card's edge.
 */
type Rect = { x: number; y: number; w: number; h: number };
/** The photo behind a frame (photos/, CREDITS.md): where its focus is (0..1), a blur, how light. */
type Photo = { file: string; x: number; y: number; blur?: number; light?: number };
const FRAMES: ReadonlyArray<{ key: string; screen: string; title: string; color: string; pose: string; card: Rect; pop: Rect; photo: Photo }> = [
  { key: "home", screen: "bots.home", title: "Your bots, all\nin *one* place", color: COLOR.ink, pose: "hello",
    card: { x: 520, y: 40, w: 1880, h: 1250 }, pop: { x: 570, y: 720, w: 1772, h: 312 }, photo: { file: "team.jpg", x: 0.48, y: 0.42, light: 0.5 } },
  { key: "keylessbord", screen: "bots.keybot", title: "Hold a key.\n*Speak* in any app", color: COLOR.keylessbord, pose: "curious",
    card: { x: 540, y: 60, w: 1960, h: 1250 }, pop: { x: 572, y: 340, w: 936, h: 588 }, photo: { file: "connect.jpg", x: 0.45, y: 0.5, blur: 12, light: 0.55 } },
  { key: "ask", screen: "bots.ask", title: "Ask once. The\nright bot *takes* it", color: COLOR.ink, pose: "wink",
    card: { x: 540, y: 160, w: 1840, h: 1250 }, pop: { x: 578, y: 462, w: 1760, h: 196 }, photo: { file: "ask.jpg", x: 0.55, y: 0.5, blur: 30, light: 0.7 } },
  { key: "xode", screen: "bots.code", title: "Xode fixes your\ncode, and *asks*", color: COLOR.xode, pose: "happy",
    card: { x: 540, y: 40, w: 1960, h: 1250 }, pop: { x: 572, y: 792, w: 1270, h: 480 }, photo: { file: "code.jpg", x: 0.47, y: 0.5, light: 0.55 } },
  { key: "notes", screen: "bots.notes", title: "Notes that\n*write* themselves", color: COLOR.ink, pose: "shy",
    card: { x: 540, y: 140, w: 1960, h: 1250 }, pop: { x: 572, y: 625, w: 1896, h: 380 }, photo: { file: "notes.jpg", x: 0.5, y: 0.45, light: 0.5 } },
  { key: "activity", screen: "bots.activity", title: "See what your\nbots *did*", color: COLOR.ink, pose: "starry",
    card: { x: 540, y: 140, w: 1960, h: 1250 }, pop: { x: 572, y: 712, w: 1896, h: 452 }, photo: { file: "plan.jpg", x: 0.5, y: 0.42, light: 0.55 } },
];

const fontFace = `
@font-face{font-family:Geist;src:url(${url(path.join(HERE, "fonts/Geist[wght].ttf"))}) format("truetype");font-weight:100 900}
@font-face{font-family:Caveat;font-weight:700;src:url(${url(path.join(HERE, "fonts/Caveat-Bold.woff2"))}) format("woff2")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const underline = (color: string) => path.join(ART, `underline-${color.replace("#", "").toLowerCase()}.png`);

/** The headline: heavy Geist, the *word* by hand with the brush underline in the frame's colour (build.mjs headline). */
function headline(title: string, color: string, size: number): string {
  const ul = underline(color);
  const words = esc(title).replace(/\n/g, "<br>").replace(/\*([^*]+)\*/g, (_, w) =>
    `<span class="hand">${w}${fs.existsSync(ul) ? `<img class="ul" src="${url(ul)}">` : ""}</span>`);
  return `<h1 style="font-size:${size}px">${words}</h1>`;
}

const BASE_CSS = `
${fontFace}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:${PAPER};-webkit-font-smoothing:antialiased}
h1{font-family:Geist,sans-serif;font-weight:800;line-height:1.02;letter-spacing:-.045em;color:${INK}}
h1 .hand{position:relative;display:inline-block;font-family:Caveat,cursive;font-weight:700;font-size:1.34em;line-height:.7;letter-spacing:-.005em;
  transform:rotate(-2.5deg) translateY(.02em);margin:0 .02em}
h1 .ul{position:absolute;left:-6%;width:112%;bottom:-.2em;height:.28em;object-fit:fill}
.on-photo h1,.on-photo h1 .hand{color:${CREAM}}
.on-photo h1{text-shadow:0 2px 30px rgba(6,9,8,.35)}
.brand{display:flex;align-items:center;gap:14px;font-family:Geist,sans-serif;font-weight:700;font-size:26px;letter-spacing:-.02em;color:${INK}}
.brand img{width:52px;height:52px;border-radius:12px}
`;

/** A Windows 11 window round a screen: the title bar (the app's name, the three buttons), rounded, a soft shadow. */
function windowOf(shot: string, w: number): string {
  const bar = 34;
  const btn = (d: string) => `<svg width="46" height="${bar}" viewBox="0 0 46 34"><path d="${d}" stroke="#1A1A1A" stroke-width="1" fill="none"/></svg>`;
  return `<div style="width:${w}px;border-radius:12px;overflow:hidden;background:#fff;border:1px solid ${LINE};
      box-shadow:0 2px 6px rgba(0,0,0,.05),0 28px 70px rgba(0,0,0,.13)">
    <div style="height:${bar}px;display:flex;align-items:center;background:#F9F9F9;border-bottom:1px solid ${LINE}">
      <img src="${url(path.join(HERE, "out/icons/app-store-1024.png"))}" style="width:16px;height:16px;margin:0 10px 0 12px;border-radius:3px">
      <span style="font:500 12px 'Segoe UI',Geist,sans-serif;color:#1A1A1A">X0 Bot</span>
      <span style="flex:1"></span>
      ${btn("M18 17h10")}${btn("M18.5 12.5h9v9h-9z")}${btn("M18 12l10 10M28 12L18 22")}
    </div>
    <img src="${url(shot)}" style="display:block;width:100%">
  </div>`;
}

const GRAIN = `<svg style="position:absolute;inset:0;opacity:.1;mix-blend-mode:overlay;pointer-events:none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .6 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

/**
 * The photograph, full bleed, under the phone set's grade: a split tone (ink shadows with an olive-teal undertone, cream
 * light, colour held back so the clay marks are the brightest thing), a vignette, and the shade the headline sits on.
 */
function photoLayer(ph: Photo): string {
  const light = ph.light ?? 0.55, blur = ph.blur ?? 0;
  const filter = `brightness(${(0.62 + light * 0.5).toFixed(3)}) contrast(1.14) saturate(0.5) sepia(0.12)${blur ? ` blur(${blur}px)` : ""}`;
  return `
    <img src="${url(path.join(HERE, "photos", ph.file))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
      object-position:${ph.x * 100}% ${ph.y * 100}%;filter:${filter};${blur ? "transform:scale(1.05);" : ""}">
    <div style="position:absolute;inset:0;background:#2E3B33;mix-blend-mode:soft-light;opacity:.55"></div>
    <div style="position:absolute;inset:0;background:#13201B;mix-blend-mode:lighten;opacity:.85"></div>
    <div style="position:absolute;inset:0;background:#F2E4CB;mix-blend-mode:multiply;opacity:.9"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 110% 100% at 60% 50%, rgba(8,12,10,0) 48%, rgba(8,12,10,.62) 100%)"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(100deg, rgba(8,12,10,.82) 0%, rgba(8,12,10,.5) 26%, rgba(8,12,10,.08) 46%, rgba(8,12,10,0) 56%)"></div>
    ${GRAIN}`;
}

/** The black bot on a dark photo: a cream sticker edge round him, so he reads, and a soft shadow under it. */
const STICKER = [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]].map(([x, y]) => `drop-shadow(${x}px ${y}px 0 ${CREAM})`).join(" ")
  + " drop-shadow(0 10px 22px rgba(6,9,8,.45))";

/** A piece of the screen, `r` of it, drawn at scale `k` (the screen is 2560 x 1600). */
const cut = (shot: string, r: Rect, k: number): string =>
  `<img src="${url(shot)}" style="position:absolute;left:${-r.x * k}px;top:${-r.y * k}px;width:${2560 * k}px;height:${1600 * k}px;max-width:none">`;

/**
 * One screenshot, the phone set's card (build.mjs): the headline at the top left, the card on the right, the part that
 * matters lifted out of it, bigger, with the arrow at it from the left, and the bot peeking over the card's top edge.
 */
function screenshotPage(f: (typeof FRAMES)[number], shot: string): string {
  const C = { left: 700, top: 292, w: 1130 };
  const k = C.w / f.card.w, cardH = f.card.h * k;
  const kp = k * 1.16;                                   // the lifted part, a little bigger than the card
  const pw = f.pop.w * kp, ph = f.pop.h * kp;
  const cx = C.left + (f.pop.x + f.pop.w / 2 - f.card.x) * k, cy = C.top + (f.pop.y + f.pop.h / 2 - f.card.y) * k;
  const pl = Math.max(C.left - 70, Math.min(cx - pw / 2, 1920 - 40 - pw)), pt = cy - ph / 2;
  const aw = 64, ah = aw * 728 / 263;                    // the arrow: down, then right, its tip at the part's left edge
  const arrow = path.join(ART, `arrow-${CLAY.replace("#", "")}.png`);
  const botW = 250, botH = botW * 483 / 833;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
  <div style="position:relative;width:1920px;height:1080px;overflow:hidden;background:${DARK}">
    ${photoLayer(f.photo)}
    <div class="on-photo" style="position:absolute;left:96px;top:84px;width:1100px">${headline(f.title, CLAY, 74)}</div>
    <div class="brand" style="position:absolute;left:96px;bottom:72px;color:${CREAM}">
      <img src="${url(path.join(HERE, "out/icons/app-store-1024.png"))}">X0 Bot
    </div>
    <img src="${url(path.join(ART, `bot-${f.pose}.png`))}" style="position:absolute;width:${botW}px;left:${C.left + C.w - botW - 90}px;top:${C.top - botH * 0.8}px;z-index:5;
      filter:${STICKER}">
    <div style="position:absolute;left:${C.left - 10}px;top:${C.top - 10}px;width:${C.w + 20}px;height:${cardH + 20}px;border-radius:40px;background:${CREAM};
      box-shadow:0 30px 90px rgba(6,9,8,.45);z-index:2"></div>
    <div style="position:absolute;left:${C.left}px;top:${C.top}px;width:${C.w}px;height:${cardH}px;overflow:hidden;background:#fff;
      border-radius:30px;z-index:2">${cut(shot, f.card, k)}</div>
    <div style="position:absolute;left:${pl - 8}px;top:${pt - 8}px;width:${pw + 16}px;height:${ph + 16}px;border-radius:32px;background:${CREAM};
      box-shadow:0 34px 90px rgba(6,9,8,.5);z-index:3"></div>
    <div style="position:absolute;left:${pl}px;top:${pt}px;width:${pw}px;height:${ph}px;overflow:hidden;background:#fff;
      border-radius:24px;z-index:3">${cut(shot, f.pop, kp)}</div>
    ${fs.existsSync(arrow) ? `<img src="${url(arrow)}" style="position:absolute;width:${aw}px;left:${pl - aw - 4}px;top:${pt + ph / 2 - ah * 0.94}px;z-index:4">` : ""}
  </div></body></html>`;
}

/** The hanging bot of the icon and the launch (art.mjs renderHang), the name under it: box art and poster. */
function brandPage(w: number, h: number, o: { botW: number; title: number; sub: string; gap: number }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
  <div style="width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${o.gap}px">
    <img src="${url(path.join(ART, "hang-splash-1632.png"))}" style="width:${o.botW}px">
    <div style="text-align:center">
      <div style="font:800 ${o.title}px Geist,sans-serif;letter-spacing:-.05em;color:${INK}">X0 Bot</div>
      <div style="font:500 ${Math.round(o.title * 0.24)}px Geist,sans-serif;letter-spacing:-.01em;color:#5C5C5C;margin-top:${Math.round(o.title * 0.12)}px">${o.sub}</div>
    </div>
  </div></body></html>`;
}

/** The hero: the bot hanging on the right, the two screens behind him; the bottom left kept clear for the Store's title. */
function heroPage(shots: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
  <div style="position:relative;width:1920px;height:1080px;overflow:hidden;background:${PAPER}">
    <div style="position:absolute;left:820px;top:140px;transform:rotate(-3deg);opacity:.98">${windowOf(shots[0]!, 760)}</div>
    <div style="position:absolute;left:1160px;top:330px;transform:rotate(2deg)">${windowOf(shots[1]!, 680)}</div>
    <img src="${url(path.join(ART, "hang-splash-1632.png"))}" style="position:absolute;width:520px;left:250px;top:120px">
  </div></body></html>`;
}

async function shoot(browser: any, html: string, file: string, w: number, h: number, scale: number, clear = false): Promise<void> {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const tmp = path.join(OUT, `.${path.basename(file)}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto(url(tmp), { waitUntil: "networkidle" });
  await page.evaluate(() => (document as any).fonts.ready);
  await page.screenshot({ path: file, type: "png", omitBackground: clear });
  await page.close();
  fs.rmSync(tmp);
}

const R = await imp("scripts/bots-render/render.ts");
const { sample, apiFor } = await imp("scripts/bots-render/samples/index.ts");
const browser = await R.launchBrowser();
try {
  fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!argv.includes("--no-screens")) {
    for (const f of FRAMES) {
      const s = sample(f.screen);
      const r = await R.renderClient(browser, {
        screenId: f.screen, client: "desktop", params: s.deskParams ?? s.params, out: SHOTS, base: f.key,
        api: await apiFor(s), fake: s.fake, compare: false,
      });
      console.log(`screen   ${f.key}: ${path.relative(HERE, r.png)}${r.misses.length ? ` (misses: ${r.misses.join(", ")})` : ""}`);
    }
  }
  const made: string[] = [];
  for (const [i, f] of FRAMES.entries()) {
    const file = path.join(OUT, "screenshots", `${String(i + 1).padStart(2, "0")}-${f.key}.png`);
    await shoot(browser, screenshotPage(f, path.join(SHOTS, `${f.key}.png`)), file, 1920, 1080, 2);
    made.push(file);
  }
  await shoot(browser, brandPage(1080, 1080, { botW: 640, title: 120, sub: "Your bots, on your computer", gap: 40 }), path.join(OUT, "box-art-1x1.png"), 1080, 1080, 2);
  await shoot(browser, brandPage(720, 1080, { botW: 560, title: 104, sub: "Your bots, on your computer", gap: 48 }), path.join(OUT, "poster-2x3.png"), 720, 1080, 2);
  await shoot(browser, heroPage([path.join(SHOTS, "home.png"), path.join(SHOTS, "keylessbord.png")]), path.join(OUT, "hero-16x9.png"), 1920, 1080, 2);
  // The tile icon with round corners and clear outside them (the Store shows it as it is: nothing rounds it for us).
  const tile = `<!doctype html><html><body style="margin:0;background:transparent"><img src="${url(path.join(HERE, "out/icons/app-store-1024.png"))}"
    style="width:300px;height:300px;display:block;border-radius:22.5%"></body></html>`;
  await shoot(browser, tile, path.join(OUT, "tile-300.png"), 300, 300, 1, true);
  // The sheet: every screenshot, then the brand images, small.
  const thumbs = [...made, path.join(OUT, "hero-16x9.png")].map((f) => `<img src="${url(f)}" style="width:620px;border:1px solid ${LINE}">`).join("");
  const sheet = `<!doctype html><html><body style="margin:0;padding:24px;background:#EEE;display:flex;flex-wrap:wrap;gap:20px;width:1960px">${thumbs}
    <img src="${url(path.join(OUT, "box-art-1x1.png"))}" style="width:349px"><img src="${url(path.join(OUT, "poster-2x3.png"))}" style="width:233px">
    <img src="${url(path.join(OUT, "tile-300.png"))}" style="width:150px;align-self:flex-start"></body></html>`;
  await shoot(browser, sheet, path.join(OUT, "sheet.png"), 2008, 1300, 1);
  console.log(`made ${made.length} screenshots and the brand images in ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser.close();
}
