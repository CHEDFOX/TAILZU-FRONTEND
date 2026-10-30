// THE APP OUTSIDE ITS WINDOW: the X0 widget (iOS and Android), the Bots at work Live Activity on the Lock Screen, and the
// Keybot keyboard, drawn as HTML for the store frames (build.mjs) and the App Preview (preview.mts).
//
// These parts of the app are drawn by the phone itself (SwiftUI, Glance, the keyboard extension), not by the SDUI renderer
// the screens come from, so here they are drawn from their own specs, number for number:
//   widget          app/targets/widgets (X0: small, medium, large; needs, working, done, quiet), the design sheet's sizes
//                   and margins, the bots' faces (the server's blip/bots/head-*.png), the hanging bot (X0Hang) and the
//                   peek-bot key (X0Peek) from the widget's own asset catalog
//   Live Activity   Bots at work (BotsAtWorkAttributes): face, task, the five-stage bar, minutes; Done with the PR
//   Android widget  the same glance in Material You rounding (28 dp outer, 16 dp inner, 16 dp padding), Roboto
//   keyboard        targets/keyboard/default-config.json's light tree: the tools row (the mic key, the suggestion bar, the
//                   tone pill), the letter rows and the bottom row; the mic key is the Peek-a-bot (peekbot.js)
// Every function returns HTML sized in points; the caller sets the scale (CSS zoom). Colour, as in the app, is white and
// ink with greys, and the bots' own colours only on what is a bot's.
//
//   const S = surfaces({ url, name })   // url(absPath) -> a URL the page can load; name: who the glance greets (default Maya)
//   S.iosLarge(state), S.iosHome({ widget }), S.liveBanner(state), S.iosLock({ activity }), S.androidLarge(state),
//   S.androidHome({ widget }), S.keyboard({ suggestion }), S.phone(inner, { w, h, platform })
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(process.env.X0_BACKEND ?? path.join(HERE, "../../../../TAILZU-BACKEND/tulmi"));
const WIDGET_ART = path.resolve(HERE, "../../../app/targets/widgets/Assets.xcassets");

/** The Bots app's ink and greys (backend experience/bots/palette.ts C). */
export const T = { ground: "#FFFFFF", ink: "#0A0A0A", meta: "#5C5C5C", line: "#E6E6E6", surface: "#F5F5F5", outline: "#D4D4D4", idle: "#8A8A8A", hollow: "#C9C9C9" };
/** The bots' own colours (palette.ts: moss, clay, ochre, sea) and their heads. */
export const BOTS = {
  code: { name: "Code bot", color: "#4F7A3A" },
  keybot: { name: "Keybot", color: "#A9573A" },
  plan: { name: "Plan bot", color: "#8F6A1F" },
  travel: { name: "Travel bot", color: "#3E6E8E" },
};
/** The icon's clay (the bar the X0 bot hangs from). */
export const CLAY = "#C9683F";

/** The glance the frames and the preview show: the sample day's (the same job and question as Home's sample). */
export const GLANCE = {
  me: { name: "Maya", greeting: "Good evening", line: "Anything to write up before the day ends?", done: 4, saved: "2 h" },
  ask: { bot: "code", question: "Round the cart total per item, or once at the end?", answers: ["Per item", "At the end"] },
  job: { bot: "code", headline: "Fixing cart", task: "Fix cart total rounding", stage: 3, of: 5, mins: 12, pr: 128, total: 18 },
  words: "1,240",
  travel: "finding stays near the wedding",
};
export const STAGES = ["Understand", "Plan", "Build", "Check", "Ship"];

const IOS = "Inter, Geist, sans-serif";
const ANDROID = "Roboto, Inter, Geist, sans-serif";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page's @font-face rules for the surfaces (Roboto from fonts/; Inter, standing in for the system face, if installed). */
export function surfaceFonts(url) {
  const F = (f) => url(path.join(HERE, "fonts", f));
  return `@font-face{font-family:Roboto;font-weight:400;src:url(${F("roboto-400.woff2")}) format("woff2")}
  @font-face{font-family:Roboto;font-weight:500;src:url(${F("roboto-500.woff2")}) format("woff2")}
  @font-face{font-family:Roboto;font-weight:600 700;src:url(${F("roboto-700.woff2")}) format("woff2")}
  .l1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .clamp{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}`;
}

export function surfaces({ url, name }) {
  const head = (slug) => url(path.join(TULMI, "blip/bots", `head-${slug}.png`));
  const hangSrc = url(path.join(WIDGET_ART, "X0Hang.imageset/x0-hang@3x.png"));
  const peekSrc = url(path.join(WIDGET_ART, "X0Peek.imageset/x0-peek@3x.png"));

  /** A bot's face (its head; `mono` as the Lock Screen draws it). */
  const face = (slug, size, o = {}) => `<img src="${head(slug)}" style="width:${size}px;height:${size}px;display:block;flex-shrink:0;${o.mono ? "filter:grayscale(1) brightness(2.1) contrast(1.1);" : ""}${o.style ?? ""}">`;
  /** Home's status marks: working = the bot's colour with its halo; needs = filled ink; done = a hollow ring. */
  const mark = (kind, color, size = 8) => kind === "working"
    ? `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 0 ${size * 0.45}px ${color}33;flex-shrink:0"></span>`
    : kind === "needs" ? `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${color ?? T.ink};flex-shrink:0"></span>`
      : `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;border:1.5px solid ${color ?? T.ink};box-sizing:border-box;flex-shrink:0"></span>`;
  /** Pills: ink primary, outlined secondary, quiet text. `press` 0..1 darkens and squeezes it (a tap, no hand). */
  function pill(label, kind, o = {}) {
    const h = o.h ?? 32, fs = o.fs ?? 13, px = o.px ?? 14, press = o.press ?? 0;
    const base = `height:${h}px;padding:0 ${px}px;border-radius:${h / 2}px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:${fs}px;font-weight:${o.weight ?? 600};white-space:nowrap;flex-shrink:0;letter-spacing:-.1px;transform:scale(${1 - 0.05 * press});${o.grow ? "flex:1;" : ""}${o.style ?? ""}`;
    if (kind === "primary") return `<div style="${base}background:${press ? `rgba(10,10,10,${1 - 0.28 * press})` : T.ink};color:#fff">${o.icon ?? ""}${esc(label)}</div>`;
    if (kind === "secondary") return `<div style="${base}border:1px solid ${T.outline};color:${T.ink}">${esc(label)}</div>`;
    return `<div style="${base}color:${T.meta};font-weight:500">${esc(label)}</div>`;
  }
  const check = (size, color = "#fff", w = 2.6) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block"><path d="M4.6 12.6l4.6 4.6L19.6 6.6" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  /**
   * The goal gradient: one segment per stage, done ones filled, the current one striped, in the bot's colour. `stage` may be
   * fractional (3.4: the third done, the fourth under way) for motion; `done` fills them all.
   */
  function stageBar(stage, of, color, o = {}) {
    const h = o.h ?? 6, gap = o.gap ?? 3, track = o.track ?? T.line, cur = Math.floor(stage);
    const segs = Array.from({ length: of }, (_, i) => {
      const n = i + 1;
      let bg = track;
      if (o.done || n < cur) bg = color;
      else if (n === cur) bg = `repeating-linear-gradient(-45deg, ${color} 0 4px, ${color}99 4px 7px)`;
      return `<div style="flex:1;height:${h}px;border-radius:${h / 2}px;background:${bg}"></div>`;
    }).join("");
    const labels = o.labels ? `<div style="display:flex;gap:${gap}px;margin-top:5px">${STAGES.slice(0, of).map((s, i) => {
      const n = i + 1, on = n === cur && !o.done;
      const c = on ? (o.ink ?? T.ink) : n < cur || o.done ? (o.meta ?? T.meta) : (o.idle ?? T.idle);
      return `<div style="flex:1;font-size:${o.lfs ?? 10}px;line-height:12px;font-weight:${on ? 700 : 500};color:${c};white-space:nowrap;overflow:hidden">${s}</div>`;
    }).join("")}</div>` : "";
    return `<div style="width:100%"><div style="display:flex;gap:${gap}px">${segs}</div>${labels}</div>`;
  }
  /** Home's week beads: one filled per thing done, and one open: the next. */
  const beads = (done, ink = T.ink, hollow = T.hollow, size = 7, gap = 4) => `<span style="display:inline-flex;gap:${gap}px;align-items:center">${Array.from({ length: Math.min(done, 6) }, () => `<span style="width:${size}px;height:${size}px;border-radius:50%;background:${ink};display:inline-block"></span>`).join("")}<span style="width:${size}px;height:${size}px;border-radius:50%;border:1.5px solid ${hollow};box-sizing:border-box;display:inline-block"></span></span>`;
  const peek = (size) => `<img src="${peekSrc}" style="width:${size}px;height:${size}px;display:block;flex-shrink:0">`;
  const hang = (w, style = "") => `<img src="${hangSrc}" style="width:${w}px;height:${(w * 267 / 447).toFixed(1)}px;display:block;${style}">`;
  const askBar = (h = 40, fs = 14, label = "Ask any bot…") => `<div style="height:${h}px;border-radius:${h / 2}px;background:${T.surface};border:1px solid ${T.line};display:flex;align-items:center;padding:0 4px 0 ${h * 0.4}px;width:100%;box-sizing:border-box">
    <div style="flex:1;font-size:${fs}px;color:${T.meta}">${esc(label)}</div>${peek(h - 8)}</div>`;

  const G = name ? { ...GLANCE, me: { ...GLANCE.me, name } } : GLANCE, J = G.job, A = G.ask;
  const crew = {
    needs: [{ slug: "code", state: "needs" }, { slug: "keybot", state: "idle" }, { slug: "plan", state: "idle" }, { slug: "travel", state: "idle" }],
    working: [{ slug: "code", state: "working", doing: "fixing cart" }, { slug: "travel", state: "working", doing: G.travel }, { slug: "keybot", state: "idle" }, { slug: "plan", state: "idle" }],
    done: [{ slug: "code", state: "done" }, { slug: "travel", state: "working", doing: G.travel }, { slug: "keybot", state: "idle" }, { slug: "plan", state: "idle" }],
    quiet: [{ slug: "code", state: "idle" }, { slug: "keybot", state: "idle" }, { slug: "plan", state: "idle" }, { slug: "travel", state: "idle" }],
  };
  function status(b, fs = 10.5) {
    const st = `font-size:${fs}px;line-height:${fs * 1.3}px;display:flex;align-items:flex-start;gap:4px;min-width:0`;
    const two = (t) => `<span class="clamp" style="-webkit-line-clamp:2">${t}</span>`;
    if (b.state === "needs") return `<div style="${st};align-items:center;color:${T.ink};font-weight:600">${mark("needs", null, 6)}<span class="l1">needs you</span></div>`;
    if (b.state === "working") return `<div style="${st};color:${BOTS[b.slug].color};font-weight:500"><span style="margin-top:${fs * 0.4}px;display:flex">${mark("working", BOTS[b.slug].color, 6)}</span>${two(esc(b.doing))}</div>`;
    if (b.state === "done") return `<div style="${st};align-items:center;color:${T.ink};font-weight:600">${mark("done", null, 7)}<span class="l1">PR ready</span></div>`;
    return `<div style="${st};color:${T.meta}">${two(b.slug === "keybot" ? `${G.words} words today` : "Ready")}</div>`;
  }
  const seats = (list, size = 30) => `<div style="display:flex;gap:8px;width:100%">${list.map((b) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
    ${face(b.slug, size)}<div class="l1" style="font-size:11.5px;line-height:14px;font-weight:600;margin-top:2px">${BOTS[b.slug].name}</div>${status(b)}</div>`).join("")}</div>`;
  const hello = (fs = 12.5) => `<div class="l1" style="font-size:${fs}px;line-height:${fs * 1.25}px;color:${T.meta}">${G.me.greeting}, ${G.me.name}</div>`;
  const week = (fs = 11.5) => `<div style="display:flex;align-items:center;gap:8px;font-size:${fs}px;line-height:${fs * 1.3}px;color:${T.meta};white-space:nowrap">${beads(G.me.done)}<span>${G.me.done} things done this week · ${G.me.saved} saved</span></div>`;

  // ------------------------------------------------------------------ iOS: the X0 widget, large (338 x 354; 364 x 382 on a 6.9" phone)

  /**
   * The large widget in one state: "needs" (the question; `press` on the first answer), "answered" (the answer taken: Done),
   * "working" (the job's stage bar; `stage` may be fractional), "done" (finished, See the PR), "quiet".
   */
  function iosLarge(state = "needs", o = {}) {
    const W = 338, H = 354, c = BOTS.code.color;
    let inner;
    const top = `<div style="display:flex;flex-direction:column;gap:4px">${hello()}${week()}</div>`;
    if (state === "needs" || state === "answered") {
      const answers = state === "answered"
        ? pill("Done", "primary", { h: 32, icon: check(13) })
        : `${pill(A.answers[0], "primary", { h: 32, press: o.press })}${pill(A.answers[1], "secondary", { h: 32 })}${pill("You decide", "quiet", { h: 32, px: 6 })}`;
      inner = `${top}<div style="margin-top:12px;border:1px solid ${T.line};border-radius:18px;padding:12px 14px 14px">
        <div style="display:flex;align-items:center;gap:6px;font-size:10.5px;line-height:13px;font-weight:700;letter-spacing:.5px">${mark("needs", null, 7)}NEEDS YOU · CODE BOT<div style="flex:1"></div>${face("code", 30)}</div>
        <div class="clamp" style="-webkit-line-clamp:2;margin-top:2px;font-size:16px;line-height:20.5px;font-weight:600;letter-spacing:-.3px">${esc(A.question)}</div>
        <div style="display:flex;gap:6px;margin-top:12px">${answers}</div></div>
        <div style="margin-top:14px">${seats(crew.needs)}</div><div style="flex:1"></div>${askBar(40)}`;
    } else if (state === "working" || state === "done") {
      const done = state === "done", stage = o.stage ?? J.stage;
      inner = `${top}<div style="margin-top:12px;border:1px solid ${T.line};border-radius:18px;padding:14px">
        <div style="display:flex;align-items:center;gap:12px">${face("code", 44)}<div style="flex:1;min-width:0"><div style="font-size:19px;line-height:23px;font-weight:700;letter-spacing:-.45px">${done ? "Done · PR #" + J.pr : J.headline}</div><div class="l1" style="font-size:12px;line-height:15px;color:${T.meta}">Code bot · ${esc(J.task)}</div></div></div>
        <div style="margin-top:14px">${stageBar(stage, J.of, c, { h: 7, labels: true, lfs: 9.5, done })}</div>
        <div style="display:flex;margin-top:10px;font-size:11.5px;line-height:14px">${done ? `<span style="font-weight:600">All checks pass</span><span style="color:${T.meta}">&nbsp;· ${J.total} min</span>` : `<span style="font-weight:600">Step ${Math.floor(stage)} of ${J.of}</span><span style="color:${T.meta}">&nbsp;· ${o.mins ?? J.mins} min in</span>`}</div></div>
        <div style="margin-top:14px">${seats(done ? crew.done : crew.working)}</div><div style="flex:1"></div>${askBar(40)}`;
    } else {
      return `<div style="position:relative;width:${W}px;height:${H}px;border-radius:22px;overflow:hidden;background:#fff;color:${T.ink};font-family:${IOS}">${hang(104, "position:absolute;top:0;right:24px")}
        <div style="position:absolute;inset:16px;display:flex;flex-direction:column">${hello(13)}<div class="clamp" style="-webkit-line-clamp:3;width:192px;margin-top:6px;font-size:24px;line-height:28px;font-weight:700;letter-spacing:-.8px">${esc(G.me.line)}</div>
        <div style="margin-top:12px">${week()}</div><div style="flex:1"></div>${seats(crew.quiet)}<div style="margin-top:14px">${askBar(40)}</div></div></div>`;
    }
    return `<div style="position:relative;width:${W}px;height:${H}px;border-radius:22px;overflow:hidden;background:#fff;color:${T.ink};font-family:${IOS};box-shadow:0 1px 2px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.10)">
      <div style="position:absolute;inset:16px;display:flex;flex-direction:column">${inner}</div></div>`;
  }

  /** The Home Screen's wallpaper (a soft blue-grey, the design sheet's), the Lock Screen's (night), Android's (sage). */
  const WALL = {
    ios: "linear-gradient(160deg,#c9d6df 0%,#a3b8c9 35%,#7f93b0 70%,#5d6f93 100%)",
    lock: "linear-gradient(170deg,#0e1630 0%,#27305e 45%,#5b3e72 80%,#8c5a6f 100%)",
    android: "linear-gradient(170deg,#dfe7d8 0%,#c3d4bf 40%,#9db8a2 75%,#7b9b8a 100%)",
  };

  /** The status bar: 9:41, and the signal, wifi and battery marks. */
  function statusBar(color = "#fff", w = 440, o = {}) {
    const ic = `<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="${color}"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="${color}"/><rect x="10" y="3" width="3" height="9" rx="1" fill="${color}"/><rect x="15" y="0" width="3" height="12" rx="1" fill="${color}"/></svg>
      <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.2l2.3-2.6a3.3 3.3 0 0 0-4.6 0z" fill="${color}"/><path d="M3.3 6.1a6.7 6.7 0 0 1 9.4 0l1.5-1.7a9 9 0 0 0-12.4 0z" fill="${color}"/><path d="M.6 3.1a10.7 10.7 0 0 1 14.8 0l1-1.2A12.3 12.3 0 0 0-.4 1.9z" fill="${color}" opacity=".9"/></svg>
      <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="${color}" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.4" fill="${color}"/><path d="M25 4.5v4a2 2 0 0 0 0-4z" fill="${color}" opacity=".45"/></svg>`;
    return `<div style="position:absolute;left:0;top:0;width:${w}px;height:54px;font-family:${IOS};color:${color}">
      ${o.time === false ? "" : `<div style="position:absolute;left:${w * 0.13}px;top:18px;width:54px;text-align:center;font-size:17px;font-weight:600;letter-spacing:-.2px">9:41</div>`}
      <div style="position:absolute;right:${w * 0.075}px;top:21px;display:flex;gap:6px;align-items:center">${ic}</div>
      <div style="position:absolute;left:${(w - 126.67) / 2}px;top:11.33px;width:126.67px;height:37.33px;border-radius:19px;background:#000"></div></div>`;
  }

  /** A 6.9" Home Screen (440 x 956) with the large X0 widget (`width` wide, `top` down) and its name under it; nothing of anyone else's. */
  function iosHome(o = {}) {
    const ww = o.width ?? 364, k = ww / 338, top = o.top ?? 76;
    return `<div style="position:relative;width:440px;height:956px;overflow:hidden;background:${WALL.ios}">
      ${statusBar("#fff")}
      <div style="position:absolute;left:${(440 - ww) / 2}px;top:${top}px"><div style="zoom:${k}">${o.widget ?? iosLarge("needs")}</div></div>
      <div style="position:absolute;left:0;right:0;top:${top + 354 * k + 6}px;text-align:center;font:500 12px/15px ${IOS};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35)">X0</div>
      <div style="position:absolute;left:${(440 - 140) / 2}px;bottom:8px;width:140px;height:5px;border-radius:3px;background:rgba(255,255,255,.85)"></div></div>`;
  }

  // ------------------------------------------------------------------ iOS: Bots at work, the Live Activity

  /** The Lock Screen banner (408 wide on a 6.9" phone): "working" (`stage`, `mins`), "needs", or "done" (the PR). */
  function liveBanner(state = "working", o = {}) {
    const c = BOTS.code.color, stage = o.stage ?? J.stage, step = Math.min(J.of, Math.floor(stage));
    let body;
    if (state === "working") {
      body = `<div style="display:flex;align-items:center;gap:12px">${face("code", 44)}<div style="flex:1;min-width:0"><div style="font-size:16px;line-height:20px;font-weight:700;letter-spacing:-.3px">${J.headline}</div><div class="l1" style="font-size:12.5px;line-height:16px;color:${T.meta}">Code bot · ${STAGES[step - 1]}, step ${step} of ${J.of}</div></div><div style="font-size:12px;color:${T.meta};align-self:flex-start;margin-top:2px">${o.mins ?? J.mins} min</div></div>
        <div style="margin-top:12px">${stageBar(stage, J.of, c, { h: 6, labels: true })}</div>`;
    } else if (state === "needs") {
      body = `<div style="display:flex;gap:12px">${face("code", 44)}<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;font-size:10.5px;line-height:13px;font-weight:700;letter-spacing:.5px">${mark("needs", null, 7)}NEEDS YOU · CODE BOT</div>
        <div style="font-size:15px;line-height:19px;font-weight:600;letter-spacing:-.25px;margin-top:4px">${esc(A.question)}</div>
        <div style="display:flex;gap:6px;margin-top:10px">${pill(A.answers[0], "primary", { h: 30, fs: 12.5 })}${pill(A.answers[1], "secondary", { h: 30, fs: 12.5 })}${pill("You decide", "quiet", { h: 30, fs: 12.5, px: 4 })}</div></div></div>`;
    } else {
      body = `<div style="display:flex;align-items:center;gap:12px">${face("code", 44)}<div style="flex:1;min-width:0"><div style="font-size:16px;line-height:20px;font-weight:700;letter-spacing:-.3px">Done — tap to see the PR</div><div class="l1" style="font-size:12.5px;line-height:16px;color:${T.meta}">${J.headline} · PR #${J.pr} · ${J.total} min</div></div>
        <div style="width:30px;height:30px;border-radius:50%;background:${T.ink};display:flex;align-items:center;justify-content:center;transform:scale(${o.pop ?? 1})">${check(14)}</div></div>
        <div style="margin-top:12px">${stageBar(J.of, J.of, c, { h: 6, labels: true, done: true })}</div>`;
    }
    return `<div style="width:${o.w ?? 408}px;border-radius:24px;background:#fff;color:${T.ink};padding:14px 16px;font-family:${IOS};box-shadow:0 2px 12px rgba(0,0,0,.25)">${body}</div>`;
  }

  /** A 6.9" Lock Screen (440 x 956): the date, 9:41, and the Live Activity banner low on it, where iOS puts it. */
  function iosLock(o = {}) {
    const glyph = (d) => `<div style="width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center">${d}</div>`;
    const torch = `<svg width="20" height="24" viewBox="0 0 20 24"><path d="M5 1h10v5l-2.5 4v12a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 22V10L5 6z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
    const cam = `<svg width="26" height="20" viewBox="0 0 26 20"><path d="M3 5h4l2-3h8l2 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><circle cx="13" cy="11.5" r="4" fill="none" stroke="#fff" stroke-width="1.8"/></svg>`;
    return `<div style="position:relative;width:440px;height:956px;overflow:hidden;background:${WALL.lock};font-family:${IOS};color:#fff">
      ${statusBar("#fff", 440, { time: false })}
      <div style="position:absolute;left:0;right:0;top:84px;text-align:center;font-size:21px;line-height:26px;font-weight:600;color:rgba(255,255,255,.9)">Friday 30 October</div>
      <div style="position:absolute;left:0;right:0;top:104px;text-align:center;font-size:112px;line-height:120px;font-weight:600;letter-spacing:-3px;color:rgba(255,255,255,.94);font-family:'Inter Display',${IOS}">9:41</div>
      <div style="position:absolute;left:16px;top:${o.bannerTop ?? 640}px">${o.activity ?? liveBanner("working")}</div>
      <div style="position:absolute;left:46px;bottom:44px">${glyph(torch)}</div><div style="position:absolute;right:46px;bottom:44px">${glyph(cam)}</div>
      <div style="position:absolute;left:${(440 - 140) / 2}px;bottom:8px;width:140px;height:5px;border-radius:3px;background:rgba(255,255,255,.85)"></div></div>`;
  }

  // ------------------------------------------------------------------ Android: the X0 widget, 4 x 4 (376 x 440 dp)

  function androidLarge(state = "needs") {
    const P = (label, kind) => pill(label, kind, { h: 36, fs: 14, weight: 500, px: 16 });
    let inner;
    if (state === "needs") {
      inner = `<div style="font-size:14px;line-height:18px;color:${T.meta}">${G.me.greeting}, ${G.me.name}</div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:${T.meta}">${beads(G.me.done)}<span>${G.me.done} things done this week · ${G.me.saved} saved</span></div>
        <div style="margin-top:14px;border-radius:16px;background:${T.surface};padding:14px 16px 16px">
          <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;line-height:14px;font-weight:700;letter-spacing:.5px">${mark("needs", null, 7)}NEEDS YOU · CODE BOT<div style="flex:1"></div>${face("code", 34)}</div>
          <div class="clamp" style="-webkit-line-clamp:2;margin-top:4px;font-size:18px;line-height:23px;font-weight:500">${esc(A.question)}</div>
          <div style="display:flex;gap:8px;margin-top:14px">${P(A.answers[0], "primary")}${P(A.answers[1], "secondary")}</div></div>
        <div style="margin-top:16px">${seats(crew.needs, 34)}</div><div style="flex:1"></div>${askBar(46, 15)}`;
    } else {
      inner = `<div style="font-size:14px;line-height:18px;color:${T.meta}">${G.me.greeting}, ${G.me.name}</div>
        <div style="margin-top:14px;border-radius:16px;background:${T.surface};padding:16px">
          <div style="display:flex;align-items:center;gap:12px">${face("code", 48)}<div style="flex:1;min-width:0"><div style="font-size:20px;line-height:24px;font-weight:700">${J.headline}</div><div class="l1" style="font-size:13px;line-height:17px;color:${T.meta}">Code bot · Build, step 3 of 5</div></div></div>
          <div style="margin-top:14px">${stageBar(3, 5, BOTS.code.color, { h: 8, labels: true, lfs: 10.5 })}</div></div>
        <div style="margin-top:16px">${seats(crew.working, 34)}</div><div style="flex:1"></div>${askBar(46, 15)}`;
    }
    return `<div style="position:relative;width:376px;height:440px;border-radius:28px;background:#fff;color:${T.ink};overflow:hidden;font-family:${ANDROID};box-shadow:0 1px 3px rgba(0,0,0,.10)">
      <div style="position:absolute;inset:16px;display:flex;flex-direction:column">${inner}</div></div>`;
  }

  // ------------------------------------------------------------------ the Keybot keyboard (light), 440 wide

  /**
   * The keyboard: the tools row (the Peek-a-bot mic key as a canvas the page draws, with id `canvasId`; the suggestion bar;
   * the tone pill), three letter rows and the bottom row, on the light keyboard's ground. `suggestion` is what the bar says.
   */
  function keyboard(o = {}) {
    const W = o.w ?? 440, key = "rgba(255,255,255,.92)", fn = "rgba(255,255,255,.4)", sh = "0 1px 0 rgba(0,0,0,.28)";
    const K = (ch, flex = 1, bg = key, fs = 23) => `<div style="flex:${flex};height:44px;border-radius:5px;background:${bg};box-shadow:${sh};display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:400;color:#000">${ch}</div>`;
    const row = (keys, pad = 0) => `<div style="display:flex;gap:6px;height:44px;padding:0 ${pad}px">${keys}</div>`;
    const letters = (s) => [...s].map((c) => K(c)).join("");
    const shift = `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 3 3 12.5h5V20h8v-7.5h5z" fill="none" stroke="#000" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    const del = `<svg width="24" height="18" viewBox="0 0 26 18"><path d="M8 1h15a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8L1 9z" fill="none" stroke="#000" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 5.5l7 7M19 5.5l-7 7" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    const globe = `<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#000" stroke-width="1.5"/><path d="M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19" fill="none" stroke="#000" stroke-width="1.5"/></svg>`;
    const sug = o.suggestion ?? "";
    return `<div style="position:relative;width:${W}px;padding:8px 3px 0;background:#D3D5DB;font-family:${IOS};box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:8px;height:44px;padding:1px 4px">
        <canvas id="${o.canvasId ?? "mic"}" width="168" height="168" style="width:42px;height:42px;border-radius:50%;background:#1B1712;flex-shrink:0"></canvas>
        <div style="flex:1;height:36px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:15px;color:#3c3c43;white-space:nowrap;overflow:hidden">${sug}</div>
        <div style="width:96px;height:36px;border-radius:18px;background:#fff;border:1px solid rgba(0,0,0,.16);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:#000;box-sizing:border-box">${esc(o.tone ?? "Casual")}</div></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        ${row(letters("qwertyuiop"))}${row(letters("asdfghjkl"), 20)}
        ${row(`${K(shift, 1.35, fn)}<div style="flex:.22"></div>${letters("zxcvbnm")}<div style="flex:.22"></div>${K(del, 1.35, fn)}`)}
        ${row(`${K("123", 2.4, fn, 16)}${K(globe, 1.1, fn)}${K(".", 1.29, fn, 20)}${K("", 5.2, key)}${K("@", 1.29, fn, 20)}${K("return", 2.4, fn, 16)}`)}
      </div><div style="height:${o.home ?? 34}px;position:relative"><div style="position:absolute;left:${(W - 140) / 2}px;bottom:8px;width:140px;height:5px;border-radius:3px;background:#000"></div></div></div>`;
  }

  // ------------------------------------------------------------------ a phone to hold a screen (no brand on it)

  /** A plain phone: a dark rounded body around `inner` (w x h points of screen), an island or a punch-hole camera on top. */
  function phone(inner, o = {}) {
    const w = o.w ?? 440, h = o.h ?? 956, b = o.bezel ?? 14, r = o.radius ?? 62;
    const cam = o.platform === "android"
      ? `<div style="position:absolute;left:${w / 2 - 7}px;top:14px;width:14px;height:14px;border-radius:50%;background:#000;z-index:3"></div>`
      : "";
    return `<div style="position:relative;width:${w + 2 * b}px;height:${h + 2 * b}px;border-radius:${r + b}px;background:#111;padding:${b}px;box-sizing:border-box;
      box-shadow:inset 0 0 0 2px #2a2a2a, 0 0 0 1.5px #3a3a3a">
      <div style="position:relative;width:${w}px;height:${h}px;border-radius:${r}px;overflow:hidden;background:#fff">${inner}${cam}</div></div>`;
  }

  function androidHome(o = {}) {
    return `<div style="position:relative;width:412px;height:892px;overflow:hidden;background:${WALL.android};font-family:${ANDROID}">
      <div style="position:absolute;left:24px;top:14px;font-size:14px;font-weight:500;color:#1d1b20">9:41</div>
      <div style="position:absolute;left:18px;top:70px">${o.widget ?? androidLarge("needs")}</div></div>`;
  }

  return { face, mark, pill, check, stageBar, beads, peek, hang, askBar, iosLarge, iosHome, statusBar, liveBanner, iosLock, androidLarge, androidHome, keyboard, phone, WALL };
}
