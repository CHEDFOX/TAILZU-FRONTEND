/**
 * THE APP PREVIEW: the video at the top of the App Store page (and in search, in place of the screenshots), 886 x 1920
 * (the 6.9" preview size), H.264, 30 fps, with a silent stereo track (App Store Connect wants one). Only the app: no hands,
 * no device, no price, nothing of anyone else's.
 *
 *   cd TAILZU-BACKEND/tulmi && npx tsx ../../TAILZU-FRONTEND/tools/media/store/preview.mts [--out <dir>] [--poster <ms>]
 *
 * Writes, in tools/media/store/out/preview/ (or --out):
 *   x0-app-preview.mp4   the preview
 *   poster.png           its poster frame (the still shown before it plays): the moment at --poster ms (default below)
 *   beats.png            one frame from each beat, to review
 *   screens/             the app screens it is cut from
 *
 * The beats, all of them the app's own pictures:
 *   1  the launch: the bot pulls himself up over his bar, the bar is pulled in to its middle, the app is there. The real
 *      art (app/assets/launch) moved by the real numbers (app/src/launch/launchCore.ts: barDy, head, glove, strip).
 *   2  Home with the bots (bots.home, drawn by the app's own renderer: screens.mts).
 *   3  the Home Screen: X0's widget asks for Code bot; "Per item" is tapped and taken in place, and Code bot is back at work.
 *   4  the Lock Screen: Bots at work runs as a Live Activity, Build, Check, Ship, then "Done — tap to see the PR"; a tap opens
 *      the app on the job, shipped (bots.done).
 *   5  Keybot: X0's family chat with the Keybot keyboard up; the Peek-a-bot key listens, thinks, and the words land clean in
 *      the box; sent.
 *   6  the launch picture again, with the mark and one line.
 * The widget, the Live Activity and the keyboard are drawn by surfaces.mjs from their own specs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../../app");
const TULMI = path.resolve(process.env.X0_BACKEND ?? path.join(HERE, "../../../../TAILZU-BACKEND/tulmi"));
const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(flag("out") ?? path.join(HERE, "out/preview"));

const Sc = await import(pathToFileURL(path.join(HERE, "screens.mts")).href);
const { SETS, DICTATION } = await import(pathToFileURL(path.join(HERE, "frames.mjs")).href);
const { surfaces, surfaceFonts } = await import(pathToFileURL(path.join(HERE, "surfaces.mjs")).href);
const L = await import(pathToFileURL(path.join(APP, "src/launch/launchCore.ts")).href);

/** The phone, in points, and the video's pixels: 443 x 960 at 2x is 886 x 1920. */
const W = 443, H = 960, SCALE = 2, FPS = 30;
/** The keyboard's height (surfaces.mjs keyboard(): its padding, tools row, four key rows, the home indicator's room). */
const KB_H = 8 + 44 + 10 + 4 * 44 + 3 * 10 + 34;

/** The beats, in ms. */
const T = {
  launch: 250,                                   // the splash, still, then the motion (launchCore LAUNCH_MS)
  homeIn: 250 + L.LAUNCH_MS,                     // the curtain fades into Home (launchCore FADE_MS)
  goHome: [5000, 5550],                          // to the Home Screen
  press: [7250, 7570], answered: 7480,           // "Per item", taken in place: Done
  working: [8350, 8650],                         // Code bot back at work
  sleep: [9950, 10200], wake: [10250, 10600],    // the Lock Screen
  stages: [11850, 12950], done: 14050,           // Check, Ship; Done
  tap: [15250, 15450], open: [15450, 15950],     // the banner tapped: the app, on the job
  push: [17650, 18100],                          // to the family chat
  listen: [18700, 20700], think: [20700, 21200], wrote: 21200, send: 21950,
  end: [22800, 23250], total: 24300,
};
const POSTER = Number(flag("poster") ?? 6400);

// ------------------------------------------------------------------ the app's screens

const A = "/v1/botsapp/bots", THREAD = `GET ${A}/threads/th-home`;
const V = { w: W, h: H, top: 54, bottom: 34, scale: SCALE };
const CHAT = { w: W, h: H - KB_H, top: 54, bottom: 0, scale: SCALE };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thread = (sent: boolean) => (a: Record<string, any>) => {
  // Leo's photo is a picture the renderer cannot fetch: his message says it. Mom's shared list is left out, so the chat fits
  // under its own header above the keyboard.
  const msgs = a[THREAD].messages.filter((m: { id: string }) => m.id !== "msg1")
    .map((m: { id: string }) => m.id === "msg2" ? { ...m, text: "Picked up the cake for tonight.", files: [] } : m.id === "msg3" ? { ...m, text: "Perfect, thank you!" } : m);
  const last = msgs[msgs.length - 1];
  if (sent) msgs.push({ id: "msg5", from: { userId: "u", name: "Aanya", you: true }, text: DICTATION.wrote, at: last.at + 4 * 60_000, files: [], item: null });
  return { [THREAD]: { ...a[THREAD], messages: msgs } };
};
const SCREENS: Record<string, Record<string, unknown>> = {
  home: { id: "bots.home", viewport: V, api: { "GET /v1/bots/first-run/arrival": { due: false }, "GET /v1/account/deletion": { scheduled: null }, "GET /v1/bots/push-ask": { due: false } } },
  done: { id: "bots.done", viewport: V },
  chat0: { id: "bots.thread", params: { id: "th-home" }, viewport: CHAT, api: thread(false) },
  chat1: { id: "bots.thread", params: { id: "th-home" }, viewport: CHAT, api: thread(false), state: { say: DICTATION.wrote } },
  chat2: { id: "bots.thread", params: { id: "th-home" }, viewport: CHAT, api: thread(true) },
};

async function renderScreens(): Promise<void> {
  const dir = path.join(OUT, "screens");
  fs.mkdirSync(dir, { recursive: true });
  const browser = await Sc.R.launchBrowser();
  const bundle = await Sc.R.buildPhoneBundle();
  const fr = { user: SETS.global.user, swap: SETS.global.swap };
  try {
    for (const [name, spec] of Object.entries(SCREENS)) {
      const misses: string[] = [];
      const screen = await Sc.build(spec, misses, fr);
      const r = await Sc.draw(browser, bundle, screen, spec, path.join(dir, `${name}.png`));
      const warn = [...r.errors, ...r.flags];
      console.log(`${warn.length ? "CHECK" : "ok   "} ${name.padEnd(6)} ${spec.id}${warn.length ? "  " + warn.join(" | ") : ""}`);
    }
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------ the page

const url = (f: string) => `https://preview.local${f.split(path.sep).map(encodeURIComponent).join("/")}`;
const ROOTS = [HERE, OUT, APP, TULMI];

function page(): string {
  const S = surfaces({ url });
  const G = (f: string) => url(path.join(APP, "assets/launch", f));
  const shot = (n: string) => url(path.join(OUT, "screens", `${n}.png`));
  const Z = L.SPLASH_PT, U = L.U, B = L.BAR, WIDE = 60;
  const stripW = (B.x1 - B.x0) * U / L.STRIPS, barH = (B.y1 - B.y0) * U;
  const strips = Array.from({ length: L.STRIPS }, (_, i) => {
    const left = B.x0 * U + i * stripW;
    return `<div class="strip" style="position:absolute;overflow:hidden;left:${left}px;top:${B.y0 * U}px;width:${stripW + 0.6}px;height:${barH}px;transform-origin:50% 50%">
      <img src="${G("bar.png")}" style="position:absolute;left:${-left}px;top:${-B.y0 * U}px;width:${Z}px;height:${Z}px"></div>`;
  }).join("");
  const below = `position:absolute;top:${L.BAR_TOP}px;height:${Z}px;overflow:hidden`;
  const lifted = `position:absolute;top:${-L.BAR_TOP}px;left:0;width:${Z}px;height:${Z}px`;
  // The launch, as LaunchCurtain lays it: the head behind the bar (clipped to below its top edge), the bar (whole, then in
  // strips), the gloves in front, each its own half.
  const launch = `<div id="art" style="position:absolute;left:${(W - Z) / 2}px;top:${(H - Z) / 2}px;width:${Z}px;height:${Z}px">
      <div id="below" style="${below};left:${-WIDE}px;width:${Z + 2 * WIDE}px"><div id="headp" style="position:absolute;top:0;left:${WIDE}px;width:${Z}px;height:${Z}px;transform-origin:50% 0%">
        <img src="${G("head.png")}" style="${lifted}"><img id="blink" src="${G("blink.png")}" style="${lifted};opacity:0"></div></div>
      <img id="barwhole" src="${G("bar.png")}" style="position:absolute;left:0;top:0;width:${Z}px;height:${Z}px">
      <div id="strips" style="position:absolute;left:0;top:0;width:${Z}px;height:${Z}px;opacity:0">${strips}</div>
      ${[0, 1].map((s) => `<div id="glove${s}" style="${below};left:${s * Z / 2}px;width:${Z / 2}px"><div class="grip" style="position:absolute;top:0;left:0;width:${Z}px;height:${Z}px;transform-origin:50% ${L.GRIP_AT * 100}%">
        <img class="gl" src="${G("hands.png")}" style="${lifted};left:${-s * Z / 2}px"></div></div>`).join("")}
    </div>`;
  const status = S.statusBar("#000", W);
  const k = W / 440;
  // The widget's states, stacked: the question, the answer pressed, Done, and back at work.
  const widget = (id: string, html: string) => `<div id="${id}" class="ws" style="position:absolute;left:0;top:0;opacity:0">${html}</div>`;
  const home = S.iosHome({ top: 210, width: 404, widget: `<div style="position:relative;width:338px;height:354px">${widget("w-needs", S.iosLarge("needs"))}${widget("w-press", S.iosLarge("needs", { press: 1 }))}${widget("w-answered", S.iosLarge("answered"))}${widget("w-working", S.iosLarge("working"))}</div>` });
  const banner = (id: string, html: string) => `<div id="${id}" class="bn" style="position:absolute;left:16px;top:600px;opacity:0;transform-origin:50% 50%">${html}</div>`;
  const lock = `${S.iosLock({ activity: "" })}${banner("b3", S.liveBanner("working", { stage: 3, mins: 12 }))}${banner("b4", S.liveBanner("working", { stage: 4, mins: 15 }))}${banner("b5", S.liveBanner("working", { stage: 5, mins: 17 }))}${banner("bd", S.liveBanner("done"))}`;
  const kb = S.keyboard({ w: W, canvasId: "mic", suggestion: `<span id="sug" style="display:flex;align-items:center;gap:8px"></span>` });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:"Geist";font-weight:100 900;src:url(${url(path.join(HERE, "fonts/Geist[wght].ttf"))}) format("truetype")}
    ${surfaceFonts(url)}
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:${W}px;height:${H}px;overflow:hidden;background:#fff;-webkit-font-smoothing:antialiased}
    .scene{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;opacity:0}
    .full{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
  </style></head><body>
    <div id="s-home" class="scene"><img class="full" src="${shot("home")}">${status}</div>
    <div id="s-hs" class="scene"><div style="zoom:${k}">${home}</div></div>
    <div id="s-lock" class="scene"><div style="zoom:${k}">${lock}</div></div>
    <div id="s-done" class="scene"><img class="full" src="${shot("done")}">${status}</div>
    <div id="s-chat" class="scene" style="background:#fff">
      <img id="c0" class="full" src="${shot("chat0")}" style="height:${H - KB_H}px"><img id="c1" class="full" src="${shot("chat1")}" style="height:${H - KB_H}px;opacity:0">
      <img id="c2" class="full" src="${shot("chat2")}" style="height:${H - KB_H}px;opacity:0">${status}
      <div style="position:absolute;left:0;top:${H - KB_H}px">${kb}</div></div>
    <div id="s-splash" class="scene" style="background:#fff;opacity:1">${launch}</div>
    <div id="s-end" class="scene" style="background:#fff">
      <img src="${G("splash.png")}" style="position:absolute;left:${(W - 2.1 * Z) / 2}px;top:${180}px;width:${2.1 * Z}px;height:${2.1 * Z}px">
      <div style="position:absolute;left:0;right:0;top:520px;text-align:center;font:800 104px/1 Geist;letter-spacing:-.05em;color:#0A0A0A">X0</div>
      <div style="position:absolute;left:0;right:0;top:640px;text-align:center;font:600 27px/1.2 Geist;letter-spacing:-.02em;color:#0A0A0A">Your team of bots</div></div>
    <div id="black" class="full" style="background:#000;opacity:0"></div>
    <script>
      // A seeded random, so the keyboard's bot does the same thing on every run.
      (() => { let s = 20261030; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    </script>
    <script src="${url(path.join(HERE, "peekbot.js"))}"></script>
    <script>${PAGE_JS}</script>
  </body></html>`;
}

/** The page's render(t, launch): every layer's place at t (ms). `launch` is launchCore's state at t, worked out in Node. */
const PAGE_JS = String.raw`
const T = __T__;
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const K = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
const inOut = (x) => { const c = clamp(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
const set = (id, o, tf) => { const e = $(id); e.style.opacity = o; if (tf !== undefined) e.style.transform = tf; };

const bot = PeekBot.makeBot(); bot.peekIn = 0.3; bot.blinkIn = 2;   // he peeks out once as the chat comes in
const mic = $("mic"), mctx = mic.getContext("2d");
let lastT = -1;
function drawMic(t) {
  const listening = t >= T.listen[0] && t < T.listen[1], thinking = t >= T.think[0] && t < T.think[1];
  const done = t >= T.wrote && t < T.wrote + 900;
  const mode = listening ? "listen" : thinking ? "think" : done ? "done" : "idle";
  // a voice: syllables, a breath between phrases
  const s = (t - T.listen[0]) / 1000, level = listening ? clamp(0.25 + 0.55 * Math.abs(Math.sin(s * 9.1)) * (0.6 + 0.4 * Math.sin(s * 2.3)) * (s % 1.1 < 0.92 ? 1 : 0.2)) : 0;
  const steps = lastT < 0 ? 1 : Math.max(1, Math.round((t - lastT) / 16.67));
  for (let i = 0; i < steps; i++) bot.update(1 / 60, { mode, level, typing: false });
  lastT = t;
  const size = mic.width;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, size, size); mctx.setTransform(1, 0, 0, 1, size / 2, size / 2);
  bot.draw(mctx, size / 2 - 1);
  const sug = $("sug");
  if (listening) {
    const bars = Array.from({ length: 22 }, (_, i) => 3 + 15 * clamp(level * (0.45 + 0.55 * Math.abs(Math.sin(i * 1.3 + s * 11)))));
    sug.innerHTML = '<span style="display:flex;align-items:center;gap:2.5px">' + bars.map((h) => '<span style="width:3px;height:' + h.toFixed(1) + 'px;border-radius:2px;background:#6b6b70"></span>').join("") + '</span><span>Listening…</span>';
  } else if (thinking) sug.innerHTML = '<span>Writing…</span>';
  else sug.innerHTML = "";
}

window.render = (t, launch) => {
  // 1 the launch, then the curtain fades into Home
  const L = launch;
  if (L) {
    $("below").style.transform = "translateY(" + L.bar + "px)";
    $("headp").style.opacity = L.head.shown;
    $("headp").style.transform = "rotate(" + L.head.sway + "deg) scaleY(" + L.head.sq + ") translateY(" + L.head.dy + "px)";
    $("blink").style.opacity = L.head.shut;
    $("barwhole").style.opacity = L.whole; $("barwhole").style.transform = "translateY(" + L.bar + "px)";
    $("strips").style.opacity = 1 - L.whole; $("strips").style.transform = "translateY(" + L.bar + "px)";
    [...document.querySelectorAll(".strip")].forEach((e, i) => { const s = L.strips[i]; e.style.opacity = s.shown; e.style.transform = "translateX(" + s.dx + "px) scaleX(" + s.sx + ") scaleY(" + s.sy + ")"; });
    [0, 1].forEach((s) => { const g = L.gloves[s], el = $("glove" + s); el.style.opacity = g.shown; el.style.transform = "translateY(" + L.bar + "px)";
      el.querySelector(".grip").style.transform = "scaleY(" + (1 - g.grip) + ")"; el.querySelector(".gl").style.transform = "translateY(" + g.dy + "px)"; });
  }
  set("s-splash", 1 - K(t, T.homeIn, T.homeIn + 220));
  // 2 Home; 3 off to the Home Screen: the app shrinks away toward the foot, the Home Screen settles in
  const gh = inOut(K(t, T.goHome[0], T.goHome[1]));
  // The app stays whole above the Home Screen as it shrinks away, and fades only at the end of its way down.
  set("s-home", t < T.homeIn ? 0 : 1 - ease(K(t, T.goHome[0] + 250, T.goHome[1] - 80)), "translateY(" + (gh * 300) + "px) scale(" + (1 - 0.8 * gh) + ")");
  $("s-home").style.borderRadius = (gh * 60) + "px";
  $("s-home").style.zIndex = 5;
  $("s-home").style.boxShadow = "0 20px 60px rgba(0,0,0," + (0.25 * Math.sin(gh * Math.PI)) + ")";
  const hsIn = t >= T.goHome[0] ? 1 : 0;
  const sleep = K(t, T.sleep[0], T.sleep[1]);
  set("s-hs", t < T.sleep[1] ? hsIn : 0, "scale(" + (1.1 - 0.1 * out(K(t, T.goHome[0], T.goHome[1] + 150))) + ")");
  // the widget: the question, "Per item" pressed, Done, at work
  const pr = K(t, T.press[0], T.press[0] + 110) * (1 - K(t, T.press[1] - 140, T.press[1]));
  const wk = ease(K(t, T.working[0], T.working[1]));
  set("w-needs", t < T.answered ? 1 - pr : 0);
  set("w-press", t < T.answered ? pr : 0);
  set("w-answered", t >= T.answered ? 1 - wk : 0, "scale(" + (t >= T.answered ? 1 : 1) + ")");
  set("w-working", wk);
  // to sleep, and awake on the Lock Screen
  set("black", t < T.sleep[1] ? ease(sleep) * (t > T.sleep[0] ? 1 : 0) : t < T.wake[1] ? 1 - ease(K(t, T.wake[0], T.wake[1])) : 0);
  const opened = ease(K(t, T.open[0], T.open[1]));
  set("s-lock", t >= T.sleep[1] && t < T.open[1] + 50 ? 1 : 0);
  // Bots at work: Build, Check, Ship, Done; tapped
  const st = (a, b) => t >= a && t < b ? 1 : 0, fade = (a) => ease(K(t, a, a + 260));
  const tap = K(t, T.tap[0], T.tap[0] + 100) * (1 - K(t, T.tap[1] - 60, T.tap[1]));
  const bscale = "scale(" + (1 - 0.035 * tap) + ")";
  set("b3", t < T.stages[0] + 260 ? 1 : 0, bscale);
  set("b4", t >= T.stages[0] && t < T.stages[1] + 260 ? fade(T.stages[0]) : 0, bscale);
  set("b5", t >= T.stages[1] && t < T.done + 260 ? fade(T.stages[1]) : 0, bscale);
  set("bd", t >= T.done ? fade(T.done) : 0, bscale);
  // the app opens on the job, out of the banner
  const push = inOut(K(t, T.push[0], T.push[1]));
  set("s-done", t >= T.open[0] ? opened : 0, "translate(" + (-0.28 * W * push) + "px," + ((1 - opened) * 170) + "px) scale(" + (0.45 + 0.55 * out(K(t, T.open[0], T.open[1]))) + ")");
  $("s-done").style.borderRadius = ((1 - opened) * 40) + "px";
  $("s-done").style.filter = "brightness(" + (1 - 0.12 * push) + ")";
  // 5 the family chat, Keybot up
  set("s-chat", t >= T.push[0] ? 1 : 0, "translateX(" + ((1 - push) * W) + "px)");
  $("s-chat").style.boxShadow = "-20px 0 40px rgba(0,0,0," + (0.12 * (1 - push)) + ")";
  set("c1", t >= T.wrote && t < T.send + 150 ? ease(K(t, T.wrote, T.wrote + 200)) : 0);
  set("c2", t >= T.send ? ease(K(t, T.send, T.send + 220)) : 0);
  if (t >= T.push[0] - 200 && t < T.end[1]) drawMic(t);
  // 6 the launch picture, the mark and one line
  set("s-end", ease(K(t, T.end[0], T.end[1])));
};
const W = ${W};
`.replace("__T__", JSON.stringify(T));

/** launchCore's state at t ms into the motion (the same functions LaunchCurtain samples into its keys). */
function launchState(tm: number) {
  const t = Math.max(0, Math.min(L.LAUNCH_MS, tm));
  return {
    bar: L.barDy(t), head: L.head(t), gloves: [L.glove(0, t), L.glove(1, t)],
    whole: t < L.PINCH_AT ? 1 : 0,
    strips: Array.from({ length: L.STRIPS }, (_, i) => L.strip(i, L.STRIPS, t)),
  };
}

// ------------------------------------------------------------------ capture and encode

function encoder(file: string) {
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map", "0:v", "-map", "1:a", "-shortest",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    // Apple's preview spec: H.264 High, level 4.0, 10 to 12 Mbps: held at 10 (constant, so a still beat does not drop below it).
    "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-preset", "slow", "-b:v", "10M", "-minrate", "10M", "-maxrate", "10M", "-bufsize", "10M", "-x264-params", "nal-hrd=cbr",
    "-r", String(FPS), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  return { ff, done };
}

async function main(): Promise<void> {
  if (!argv.includes("--no-screens")) await renderScreens();
  const browser = await Sc.R.launchBrowser();
  try {
    const pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
    pg.on("pageerror", (e: Error) => console.error("page error:", e.message));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pg.route("https://preview.local/**", (r: any) => {
      const u = new URL(r.request().url());
      if (u.pathname === "/index.html") return r.fulfill({ contentType: "text/html", body: page() });
      const f = decodeURIComponent(u.pathname);
      if (!ROOTS.some((root) => f.startsWith(root + path.sep)) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      const type = f.endsWith(".png") ? "image/png" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".ttf") ? "font/ttf" : f.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
      return r.fulfill({ body: fs.readFileSync(f), contentType: type });
    });
    await pg.goto("https://preview.local/index.html");
    await pg.evaluate(`(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))); })()`);
    const missing = await pg.evaluate(`[...document.images].filter((i) => !i.naturalWidth).map((i) => i.src)`);
    if ((missing as string[]).length) console.warn("images that did not load:", missing);

    const file = path.join(OUT, "x0-app-preview.mp4");
    const { ff, done } = encoder(file);
    const frames = Math.round((T.total / 1000) * FPS);
    const beats = [1100, 3600, 6400, 7400, 9300, 11300, 14700, 16800, 19700, 21600, 23900];
    const beatShots: Buffer[] = [];
    for (let n = 0; n < frames; n++) {
      const t = (n * 1000) / FPS;
      await pg.evaluate(([tt, l]: [number, unknown]) => (window as unknown as { render: (a: number, b: unknown) => void }).render(tt, l), [t, launchState(t - T.launch)] as [number, unknown]);
      const buf = await pg.screenshot({ type: "png" });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (beats.some((b) => Math.abs(b - t) < 1000 / FPS / 2)) beatShots.push(buf);
      if (Math.abs(t - POSTER) < 1000 / FPS / 2) fs.writeFileSync(path.join(OUT, "poster.png"), buf);
      if (n % 90 === 0) process.stdout.write(`  ${(t / 1000).toFixed(1)} s\r`);
    }
    ff.stdin.end();
    await done;
    console.log(`ok    ${path.relative(process.cwd(), file)}  ${W * SCALE}x${H * SCALE}  ${FPS} fps  ${(T.total / 1000).toFixed(1)} s`);
    // The beats, side by side, small: to review.
    const sheet = await browser.newPage({ viewport: { width: 230 * beatShots.length + 20, height: 520 }, deviceScaleFactor: 1 });
    await sheet.setContent(`<body style="margin:0;background:#ddd;display:flex;gap:10px;padding:10px">${beatShots.map((b) => `<img src="data:image/png;base64,${b.toString("base64")}" style="width:220px;height:477px;border-radius:12px">`).join("")}</body>`);
    await sheet.screenshot({ path: path.join(OUT, "beats.png") });
    // The poster as an opaque RGB PNG, as App Store Connect likes its stills.
    const poster = path.join(OUT, "poster.png");
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", poster, "-pix_fmt", "rgb24", poster + ".rgb.png"]);
    fs.renameSync(poster + ".rgb.png", poster);
    console.log(`ok    poster.png (at ${POSTER} ms), beats.png`);
  } finally {
    await browser.close();
  }
}

await main();
