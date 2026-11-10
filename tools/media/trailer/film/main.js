/* THE FILM'S SHELL: the frame grid, the two layouts, the assets, the layer order, and the dispatch to the beats.
 *
 * The timeline is authored in FRAMES at 30 fps on a 112.5 bpm grid: BEAT = 16 f, an 8th = 8 f, a 16th = 4 f, so every
 * cut lands on a whole frame and the sound (window.__cues, also in frames) cannot drift from the picture. Duration 74
 * beats = 1184 f = 39.467 s.
 *
 * Every beat is a module in film/beats-*.js that calls FILM.register({ name, f0, f1, draw(S, f), cues() }). The shell
 * draws, every frame: the white fill, the paper, the camera (only f64-f255: 1.00 -> 0.85, then a hard cut back to 1.0),
 * the beat that owns the frame, then the grain. A beat draws everything visible in its frames, including what persists
 * from before (the heap, a headline), through the pure-function helpers in common.js.
 *
 * S, the scene handed to a beat: { ctx, W, H, u, portrait, L (this cut's layout), A (assets), R (the peek rig), f, t, cam }.
 */
window.FILM = (() => {
  "use strict";
  const FPS = 30, BEAT_F = 16, DURATION_F = 1184;
  const beats = [];
  const register = (b) => { beats.push(b); beats.sort((a, c) => a.f0 - c.f0); };

  /** The two cuts' layouts. Everything in px of the frame (both have a 1080 short side, so u = 1 at full size). */
  const LAYOUTS = {
    portrait: {
      W: 1080, H: 1920,
      hero: { x: 132, y: 100, size: 816 },        // the opening and the end: ONE transform, so the loop is true
      heroPlan: { x: 100, y: 92, size: 816 },     // Plan's drop-in
      stage: { x: 72, y: 850, w: 868, h: 420 },   // the episodes' stage card (the day card runs to 1280)
      textX: 72, headBase: [370, 480], headSize: 96, handSize: 110,
      pileHead: { base: [1040, 1178], size: 120, hand: 138 },
      payoffHead: { base: [640, 778], size: 120, hand: 138 },
      cam: { cx: 540, cy: 560 },
      heap: { x0: 600, x1: 1070, land: { x: 840, y: 1200 }, noteLand: { x: 870, y: 1120 }, topY: 920, tailY: 1270 },
      hookCard: { w: 460, h: 300 },
      peekX: 400, peekW: 560, peekX2: 540, peekW2: 600,
      side: { x: 700, y: 400, w: 340 },           // the listen dots and the scrawl, beside his head
      planNote: { x: 900, y: 585 },
      team: { deckTop: 1150, heroX: 540, heroW: 520, slots: [200, 370, 540, 710, 880], head: 128, nameBase: 1230 },
      mark: { x: 72, y: 740, w: 460 }, endLine: { x: 72, base: 1095, size: 60 }, stamp: { x: 72, y: 1125, w: 560, h: 150 },
      dot: { x: 223, y: 350 },
      safeBottom: 1280,
    },
    landscape: {
      W: 1920, H: 1080,
      hero: { x: 70, y: -100, size: 979 },
      heroPlan: { x: 957, y: -135, size: 685 },
      stage: { x: 800, y: 330, w: 1000, h: 650 },
      textX: 96, headBase: [420, 540], headSize: 84, handSize: 97,   // the left column is 700 px: 'Nothing goes live' fits at 84
      pileHead: { base: [760, 898], size: 120, hand: 138 },
      payoffHead: { base: [560, 698], size: 120, hand: 138 },
      cam: { cx: 960, cy: 400 },
      heap: { x0: 1150, x1: 1900, land: { x: 1450, y: 900 }, noteLand: { x: 1480, y: 820 }, topY: 450, tailY: 980 },
      hookCard: { w: 460, h: 300 },
      peekX: 1150, peekW: 520, peekX2: 1300, peekW2: 560,
      side: { x: 1450, y: 40, w: 390 },
      planNote: { x: 1740, y: 300 },
      team: { deckTop: 760, heroX: 1300, heroW: 520, slots: [900, 1100, 1300, 1500, 1700], head: 128, nameBase: 840 },
      mark: { x: 1000, y: 300, w: 460 }, endLine: { x: 1000, base: 690, size: 60 }, stamp: { x: 1000, y: 740, w: 560, h: 150 },
      dot: { x: 188, y: 200 },
      safeBottom: 1000,
    },
  };

  /** The camera: 1.00 -> 0.85 about L.cam over f64-f128 (E.io), held to f255, then 1.0 (a hard cut). */
  function camera(f) { if (f < 64 || f >= 256) return 1; return 1 - 0.15 * X0.E.io(X0.K(f, 64, 128)); }

  /** The assets, by name (urls relative to engine.js: the trailer folder). */
  const MANIFEST = {
    paper: "components/paper.jpg",
    head: "hero/hang-head-1632.png", bar: "hero/hang-bar-1632.png", hands: "hero/hang-hands-1632.png", blink: "hero/hang-blink-1632.png",
    face: "hero/hang-face-1632.png", eyes: "hero/hang-eyes-1632.png", lidL: "hero/hang-lidL-1632.png", lidR: "hero/hang-lidR-1632.png",
    "ul-ink": "../store/out/art/underline-0a0a0a.png", "ul-keybot": "../store/out/art/underline-a9573a.png", "ul-plan": "../store/out/art/underline-8f6a1f.png",
    "ul-travel": "../store/out/art/underline-3e6e8e.png", "ul-bar": "../store/out/art/underline-c9683f.png", "ul-code": "peek/underline-4f7a3a.png",
    "head-keybot": "assets/head-keybot.png", "head-plan": "assets/head-plan.png", "head-travel": "assets/head-travel.png", "head-code": "assets/head-code.png",
  };
  const COMPONENTS = ["swash-bar", "swash-ink", "swash-moss", "swash-clay", "swash-ochre", "swash-sea", "band-bar", "mark-x0-ink", "hatch", "listen-dots", "tape-grey",
    "scrap-note", "scrap-packing", "scrap-blank-1", "scrap-blank-2", "scrap-blank-3", "scrap-tiny", "strike-ink", "clay-dot", "bar-stroke", "ink-sun", "ink-dashes-ink", "ink-dashes-ochre",
    "ink-comma", "ink-dot", "ink-tick", "beetle-a", "beetle-b", "pen-frame", "pen-pill", "pen-pill-yes", "pen-stamp", "tap-ring", "sparkle-sea-a", "sparkle-sea-b", "pencil-ring", "ring-ink-wide"];
  const PEEK = ["bot-curious-nohands", "bot-happy-nohands", "bot-shy-nohands", "bot-starry-nohands", "bot-hello-nohands", "bot-wink-nohands", "glove-L", "glove-R"];

  /** A JSON file beside the page (XHR: fetch() refuses file: URLs even when Chromium is told to allow them). */
  function fetchJson(url) {
    return new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", url); x.onload = () => { try { res(JSON.parse(x.responseText)); } catch (e) { rej(e); } }; x.onerror = () => rej(new Error("json: " + url)); x.send(); });
  }

  /** Load everything and wire the page. */
  async function start() {
    const q = new URLSearchParams(location.search);
    const W = +(q.get("w") || 1080), H = +(q.get("h") || 1920), portrait = H > W;
    const L = LAYOUTS[portrait ? "portrait" : "landscape"], u = Math.min(W, H) / 1080;
    const cv = document.getElementById("c"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    await X0.fonts();
    const base = document.currentScript ? "" : "";
    const man = { ...MANIFEST };
    for (const c of COMPONENTS) man[c] = `components/${c}.png`;
    for (const p of PEEK) man[p] = `peek/${p}.png`;
    const A = await X0.load(man);
    const meta = { components: await fetchJson("components/components.json"), peek: await fetchJson("peek/peek.json"), hero: await fetchJson("hero/bounds.json") };
    const R = { img: Object.fromEntries(PEEK.map((p) => [p, A[p]])), meta: meta.peek };
    const chrome = q.get("chrome");
    const S = { ctx, W, H, u, portrait, L, A, R, meta, f: 0, t: 0, cam: 1, BEAT_F, FPS, lang: q.get("lang") || "hi" };
    window.TRAILER = { duration: DURATION_F / FPS, frames: DURATION_F, fps: FPS, layout: L, scene: S };

    window.__frame = (t) => {
      const f = Math.round(t * FPS); S.f = f; S.t = f / FPS; S.cam = camera(f);
      ctx.setTransform(u, 0, 0, u, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      // 1 the white, 2 the paper (one crop per cut, never tiled)
      ctx.fillStyle = X0.C.paper; ctx.fillRect(0, 0, W / u, H / u);
      X0.cover(ctx, A.paper, 0, 0, W / u, H / u, { alpha: 0.9 });
      // 3 the camera
      ctx.save();
      if (S.cam !== 1) X0.camera(ctx, S.cam, L.cam.cx, L.cam.cy);
      // 4-8 the beat that owns this frame
      const b = beats.find((x) => f >= x.f0 && f < x.f1) || beats[beats.length - 1];
      if (b) b.draw(S, f);
      ctx.restore();
      // 9 the grain, light and seeded; no vignette (it greys white paper)
      X0.grain(ctx, W / u, H / u, f >= 1164 ? 1164 / FPS : S.t, 0.03, 1 / u);
      if (chrome) drawChrome(S, chrome);
      if (q.get("hud")) hud(S, b);
    };
    window.__cues = () => {
      const out = [];
      // `f` is the FRAME when a cue has no `at`; with `at` given it is the cue's own field (a bell's frequency) and stays
      const push = (c) => { if (!c) return; if (c.at != null) { out.push({ ...c, at: +c.at.toFixed(4) }); return; } const { f, ...rest } = c; out.push({ ...rest, at: +(f / FPS).toFixed(4) }); };
      rhythm().forEach(push);
      for (const b of beats) if (b.cues) for (const c of b.cues(S)) push(c);
      out.sort((a, c) => a.at - c.at);
      return out;
    };
    window.__ready = true;
  }

  /** The bed and the beat for the whole film (the storyboard's sound plan); the beats add their own sounds. */
  function rhythm() {
    const c = [];
    // the drone: in at f64, out f952-f984
    c.push({ f: 64, kind: "drone", dur: (984 - 64) / FPS, gain: 0.6, a: 1.2, r: 1.1 });
    // the heartbeat under the pile-up and the empty stage (56 bpm = every 32 f), and alone under the question
    for (let f = 64; f <= 224; f += 32) c.push({ f, kind: "heart", gain: 0.6 });
    for (const f of [784, 816]) c.push({ f, kind: "heart", gain: 0.6 });
    // the pulse: full-time f64-f112, half-time f256-f736 and f816-f848, full-time f864-f944
    for (const f of [64, 80, 96, 112]) c.push({ f, kind: "pulse", gain: 0.3 });
    for (let f = 256; f <= 736; f += 32) c.push({ f, kind: "pulse", gain: 0.35 });
    for (const f of [816, 848]) c.push({ f, kind: "pulse", gain: 0.35 });
    for (let f = 864; f <= 944; f += 16) c.push({ f, kind: "pulse", gain: 0.35 });
    return c;
  }

  /** The platforms' chrome, for checking stills: Reels (top 270, bottom 420-480, rail x > 950 from y 1000), Shorts (bottom 340), TikTok (bottom 550). */
  function drawChrome(S, which) {
    const { ctx, W, H, u } = S; if (!S.portrait) return;
    ctx.save(); ctx.setTransform(u, 0, 0, u, 0, 0); ctx.fillStyle = "rgba(60,80,200,0.22)"; ctx.strokeStyle = "rgba(60,80,200,0.7)"; ctx.lineWidth = 3;
    const box = (x, y, w, h, label) => { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); X0.text(ctx, label, x + 12, y + 30, X0.font(600, 24), "#2238a8"); };
    if (which === "1" || which === "reels" || which === "all") { box(0, 0, 1080, 270, "Reels top"); box(0, 1440, 1080, 480, "Reels caption + audio"); box(950, 1000, 130, 440, "rail"); }
    if (which === "shorts" || which === "all") box(0, 1580, 1080, 340, "Shorts");
    if (which === "tiktok" || which === "all") box(0, 1370, 1080, 550, "TikTok");
    ctx.strokeStyle = "rgba(200,40,40,0.8)"; ctx.setLineDash([12, 10]); ctx.beginPath(); ctx.moveTo(0, 1280); ctx.lineTo(1080, 1280); ctx.stroke();
    ctx.restore();
  }
  function hud(S, b) {
    const { ctx, u } = S; ctx.save(); ctx.setTransform(u, 0, 0, u, 0, 0);
    X0.text(ctx, `f${S.f}  b${(S.f / BEAT_F).toFixed(2)}  ${S.t.toFixed(3)}s  ${b ? b.name : "-"}  cam ${S.cam.toFixed(3)}`, 16, S.H / u - 16, X0.font(500, 22, "GeistMono"), "#c03030");
    ctx.restore();
  }

  return { FPS, BEAT_F, DURATION_F, LAYOUTS, beats, register, start, camera };
})();
