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
//   tile-300.png                300 x 300    1:1 app tile icon
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
/** The bots' own colours (backend palette.ts), for the underline of a frame that is one bot's. */
const COLOR = { xode: "#4F7A3A", keylessbord: "#A9573A", plan: "#8F6A1F", travel: "#3E6E8E", ink: INK };

/** The frames, in story order: the first is the one the Store shows first. */
const FRAMES = [
  { key: "home", screen: "bots.home", title: "Your bots,\nall in *one* place", color: COLOR.ink, pose: "hello" },
  { key: "keylessbord", screen: "bots.keybot", title: "Hold a key.\n*Speak* in any app", color: COLOR.keylessbord, pose: "curious" },
  { key: "ask", screen: "bots.ask", title: "Ask once.\nThe right bot *takes* it", color: COLOR.ink, pose: "wink" },
  { key: "xode", screen: "bots.code", title: "Xode fixes\nyour *code*", color: COLOR.xode, pose: "happy" },
  { key: "notes", screen: "bots.notes", title: "Notes that\n*write* themselves", color: COLOR.ink, pose: "shy" },
  { key: "activity", screen: "bots.activity", title: "See what\nyour bots *did*", color: COLOR.ink, pose: "starry" },
] as const;

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

/** One screenshot: the headline on the left, the app's window on the right, the bot peeking over its top edge. */
function screenshotPage(f: (typeof FRAMES)[number], shot: string): string {
  // The window as big as the frame lets it be, so the app reads at the Store's size; the words take what is left.
  const winW = 1360;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
  <div style="position:relative;width:1920px;height:1080px;overflow:hidden">
    <div style="position:absolute;left:84px;top:0;bottom:0;width:420px;display:flex;flex-direction:column;justify-content:center">
      ${headline(f.title, f.color, 60)}
    </div>
    <div class="brand" style="position:absolute;left:84px;bottom:70px">
      <img src="${url(path.join(HERE, "out/icons/app-store-1024.png"))}">X0 Bot
    </div>
    <div style="position:absolute;right:56px;top:50%;transform:translateY(-47%)">
      <img src="${url(path.join(ART, `bot-${f.pose}.png`))}" style="position:absolute;width:170px;left:60px;top:-90px;z-index:2">
      <div style="position:relative;z-index:1">${windowOf(shot, winW)}</div>
    </div>
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

async function shoot(browser: any, html: string, file: string, w: number, h: number, scale: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const tmp = path.join(OUT, `.${path.basename(file)}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto(url(tmp), { waitUntil: "networkidle" });
  await page.evaluate(() => (document as any).fonts.ready);
  await page.screenshot({ path: file, type: "png", omitBackground: false });
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
  const tile = `<!doctype html><html><body style="margin:0"><img src="${url(path.join(HERE, "out/icons/app-store-1024.png"))}" style="width:300px;height:300px;display:block"></body></html>`;
  await shoot(browser, tile, path.join(OUT, "tile-300.png"), 300, 300, 1);
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
