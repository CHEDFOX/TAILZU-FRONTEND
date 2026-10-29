/**
 * THE STORE SCREENS: each frame's app screen (frames.mjs), built by the server's own screen builders with the frame's sample
 * day and drawn by the phone app's own renderer (TAILZU-FRONTEND/app/src/sdui through react-native-web, the bundle the
 * backend's render check makes: TAILZU-BACKEND/tulmi/scripts/bots-render/render.ts). Nothing here is a mock-up: the
 * screen JSON is what the server would send, and the pixels are what the app's renderer draws for it.
 *
 * Run by build.mjs (one command for everything). On its own, from TAILZU-BACKEND/tulmi:
 *   npx tsx ../../TAILZU-FRONTEND/tools/media/store/screens.mts [--out <dir>] [--only <frame key regex>] [--all]
 * (--all also renders the frames marked off. --probe "text|text" prints where those words sit and the boxes around them,
 * for writing a frame's `pop`.)
 *
 * Writes, in --out (default tools/media/store/out/screens/):
 *   <key>.png       the screen at 4x, on the phone frames.mjs SIZES.phone names (or the screen's own `viewport`)
 *   <key>.pop.png   the part of it a frame lifts out (`pop`: the smallest element holding all of `has`, or the card around it),
 *   <key>.pop.json  and where that part sits on the screen, in points
 *   <key>.json      the screen as built
 *   report.json  per screen: the visible words that break a store rule (an old brand name, another company's name, an
 *                amount of money), page errors, and the api calls that had no sample answer
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(process.env.X0_BACKEND ?? path.join(HERE, "../../../../TAILZU-BACKEND/tulmi"));
const imp = (rel: string) => import(pathToFileURL(path.join(TULMI, rel)).href);

process.env.PUBLIC_ORIGIN = "https://api.local";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(flag("out") ?? path.join(HERE, "out/screens"));
const only = flag("only") ? new RegExp(flag("only")!) : undefined;
const has = (name: string): boolean => argv.includes(`--${name}`);


const R = await imp("scripts/bots-render/render.ts");
const { sample, apiFor } = await imp("scripts/bots-render/samples/index.ts");
const { buildBotsScreen } = await imp("src/experience/bots/index.ts");
const { fakeDeps, IST } = await imp("src/experience/bots/fixtures.ts");
const { FACE, botsFonts } = await imp("src/experience/bots/kit.ts");
const { FRAMES, RULES, SIZES } = await import(pathToFileURL(path.join(HERE, "frames.mjs")).href);
/** The phone the screens are drawn on (frames.mjs SIZES.phone; a screen may name its own `viewport`). */
type Viewport = { w: number; h: number; top: number; bottom: number; scale: number };
const PHONE = { scale: 4, ...SIZES.phone } as Viewport;

const USER = { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya Sharma", email: "aanya@example.in" };

interface ScreenSpec {
  id: string;
  variant?: string;
  params?: Record<string, string | number | boolean>;
  /** Answers over the sample's (by "METHOD /path"), or a function of the sample's answers that returns them; null removes one. */
  api?: Record<string, unknown> | ((answers: Record<string, any>) => Record<string, unknown>); // eslint-disable-line @typescript-eslint/no-explicit-any
  /** fakeDeps overrides: bots, jobs, tasks, minutesSaved… */
  fake?: Record<string, unknown>;
  /** Nothing working, nothing waiting. */
  quiet?: boolean;
  /** Scroll the page: a number of points, or the text to bring near the top. */
  scroll?: number | { to: string; offset?: number };
  /** Values put into the screen's state before it is drawn (what someone has typed, a tab picked). */
  state?: Record<string, unknown>;
  /** Another phone size or safe area for this screen (points). */
  viewport?: Partial<Viewport>;
}

/** The part of a screen a frame lifts out: the smallest element holding every text in `has`; `card` widens it to the card around it. */
interface PopSpec { has: string[]; card?: boolean; up?: number; bare?: boolean; pad?: number; tall?: number; union?: boolean }

async function build(spec: ScreenSpec, misses: string[]): Promise<unknown> {
  let s: { params?: Record<string, unknown>; fake?: Record<string, unknown>; area: string } & Record<string, unknown>;
  try { s = sample(spec.id, spec.variant); } catch { s = { id: spec.id, area: "shell" }; }
  const api: Record<string, unknown> = { ...(await apiFor(s)) };
  const extra = typeof spec.api === "function" ? spec.api(structuredClone(api)) : spec.api ?? {};
  for (const [k, v] of Object.entries(extra)) { if (v === null) delete api[k]; else api[k] = v; }
  const deps = fakeDeps({ ...(spec.quiet ? { jobs: [], tasks: [] } : {}), ...(s.fake ?? {}), ...(spec.fake ?? {}), api });
  const inner = deps.api;
  deps.api = (async (method: string, route: string, body?: unknown) => {
    try { return await inner(method as "GET", route, body); } catch (e) { misses.push(`${method} ${route}`); throw e; }
  }) as typeof deps.api;
  const screen = await buildBotsScreen({
    screenId: spec.id, client: "phone", params: { ...(s.params ?? {}), ...(spec.params ?? {}) } as Record<string, string>,
    tzOffsetMinutes: IST, user: USER, can: new Set(["BotsKit", ...R.PHONE_COMPONENTS]), desk: { pages: false, notes: false },
  }, deps) as { state?: Record<string, unknown> };
  if (spec.state) screen.state = { ...(screen.state ?? {}), ...spec.state };
  return screen;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serveAssets(route: any): Promise<void> | void {
  const u = new URL(route.request().url());
  const file = path.join(TULMI, u.pathname);
  if (/^\/(fonts|blip)\//.test(u.pathname) && fs.existsSync(file)) {
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "font/ttf" });
  }
  return route.fulfill({ status: 404, body: "" });
}

/** The words on show (in the viewport) that a store would refuse, by RULES in frames.mjs. */
const CHECK = `((rules) => {
  const seen = [];
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth; };
  const walker = document.createTreeWalker(document.getElementById("root"), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { const t = n.textContent.trim(); if (t && n.parentElement && vis(n.parentElement)) seen.push(t); }
  for (const i of document.querySelectorAll("input, textarea")) { if (vis(i)) seen.push(i.value || i.placeholder || ""); }
  const text = seen.join("\\n");
  const out = [];
  for (const [name, src] of rules) { const re = new RegExp(src, "gi"); let m; while ((m = re.exec(text))) out.push(name + ": " + JSON.stringify(text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).replace(/\\n/g, " / "))); }
  return { out, text };
})`;

/** A page with the screen drawn by the phone's renderer, on a phone of this size, with its fonts and pictures in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openScreen(browser: any, bundle: string, screen: unknown, V: Viewport, errors: string[]): Promise<any> {
  const page = await browser.newPage({ viewport: { width: V.w, height: V.h }, deviceScaleFactor: V.scale, reducedMotion: "reduce" });
  page.on("pageerror", (e: Error) => errors.push(e.message));
  const fonts = botsFonts();
  const faces = Object.values(FACE as Record<string, string>).map((f) => `@font-face{font-family:"${f}";src:url(${fonts[f]})}`).join("");
  const insets = { top: V.top, bottom: V.bottom, left: 0, right: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.route("https://phone.local/**", (r: any) => new URL(r.request().url()).pathname === "/bundle.js"
    ? r.fulfill({ body: bundle, contentType: "text/javascript" })
    : r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;overflow:hidden}*{caret-color:transparent}${faces}</style></head><body><div id="root"></div><script>window.__SCREEN__=${JSON.stringify(screen).replace(/</g, "\\u003c")};window.__INSETS__=${JSON.stringify(insets)};</script><script src="/bundle.js"></script></body></html>` }));
  await page.route("https://api.local/**", serveAssets);
  await page.goto("https://phone.local/index.html");
  await page.waitForFunction("window.__RENDERED__ === true", null, { timeout: 20_000 });
  await page.evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  })()`);
  await page.waitForTimeout(350);
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function draw(browser: any, bundle: string, screen: unknown, spec: ScreenSpec, file: string, pop?: PopSpec) {
  const errors: string[] = [];
  const V: Viewport = { ...PHONE, ...(spec.viewport ?? {}) };
  const page = await openScreen(browser, bundle, screen, V, errors);
  try {
    if (spec.scroll !== undefined) {
      const to = typeof spec.scroll === "number" ? { px: spec.scroll } : { text: spec.scroll.to, offset: spec.scroll.offset ?? 12 };
      const done = await page.evaluate(`((to) => {
        const scrollers = [...document.querySelectorAll("#root *")].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 4; });
        if (!scrollers.length) return "no scrolling part";
        let box = scrollers.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (to.px !== undefined) { box.scrollTop = to.px; return "ok"; }
        const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (n.textContent.trim() === to.text || n.textContent.includes(to.text)) {
            const r = n.parentElement.getBoundingClientRect(), b = box.getBoundingClientRect();
            box.scrollTop += r.top - b.top - to.offset; return "ok";
          }
        }
        return "text not found: " + to.text;
      })(${JSON.stringify(to)})`);
      if (done !== "ok") errors.push(`scroll: ${done}`);
      await page.waitForTimeout(250);
    }
    if (flag("probe")) {
      // --probe "text|text": where those words are, and the boxes around them (for writing a frame's `pop`).
      console.log(await page.evaluate(`((texts) => texts.map((t) => {
        const w = document.createTreeWalker(document.getElementById("root"), NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.includes(t)) {
          const chain = []; let e = n.parentElement;
          for (let i = 0; e && i < 7; i++, e = e.parentElement) { const b = e.getBoundingClientRect(); chain.push(Math.round(b.x) + "," + Math.round(b.y) + " " + Math.round(b.width) + "x" + Math.round(b.height) + " r" + getComputedStyle(e).borderTopLeftRadius); }
          return t + ": " + chain.join("  <  ");
        }
        return t + ": not found";
      }).join("\\n"))(${JSON.stringify(flag("probe")!.split("|"))})`));
    }
    const checked = await page.evaluate(`${CHECK}(${JSON.stringify(RULES.map((r: { name: string; re: RegExp }) => [r.name, r.re.source]))})`) as { out: string[]; text: string };
    await page.screenshot({ path: file });
    let popped: unknown = null;
    if (pop) {
      // A part that runs below the screen's foot is lifted from the same screen on a taller phone, where it is all on show.
      const VH = pop.tall ?? V.h;
      const target = pop.tall ? await openScreen(browser, bundle, screen, { ...V, h: pop.tall }, errors) : page;
      const box = await target.evaluate(`((p) => {
        const root = document.getElementById("root");
        const holders = p.has.map((t) => {
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.includes(t)) return n.parentElement;
          return null;
        });
        if (holders.some((h) => !h)) return { error: "not on the screen: " + p.has.filter((_, i) => !holders[i]).join(", ") };
        if (p.union) {
          // The full-width rows that hold each text, from the first to the last (several rows of a list, without the rest of it).
          const rows = holders.map((h) => { let r = h; while (r.parentElement && r.getBoundingClientRect().width < innerWidth * 0.85) r = r.parentElement; return r.getBoundingClientRect(); });
          const x = Math.min(...rows.map((r) => r.left)), y = Math.min(...rows.map((r) => r.top));
          const r = Math.max(...rows.map((r) => r.right)), b = Math.max(...rows.map((r) => r.bottom)), pad = p.pad || 0;
          return { x: x - pad, y: y - pad, w: r - x + 2 * pad, h: b - y + 2 * pad, radius: 0 };
        }
        let el = holders[0];
        while (el && !holders.every((h) => el.contains(h))) el = el.parentElement;
        for (let i = 0; i < (p.up || 0) && el.parentElement; i++) el = el.parentElement;
        if (p.card) {
          let c = el;
          const isCard = (e) => { const s = getComputedStyle(e); return parseFloat(s.borderTopLeftRadius) >= 10 && (parseFloat(s.borderTopWidth) >= 1 || (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "rgb(255, 255, 255)")); };
          while (c && c !== root && !isCard(c)) c = c.parentElement;
          if (c && c !== root) el = c;
        }
        if (p.bare) { el.style.borderColor = "transparent"; }
        const b = el.getBoundingClientRect(), pad = p.pad || 0;
        return { x: b.left - pad, y: b.top - pad, w: b.width + 2 * pad, h: b.height + 2 * pad, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
      })(${JSON.stringify(pop)})`) as { error?: string; x: number; y: number; w: number; h: number; radius: number };
      if (box.error) errors.push(`pop: ${box.error}`);
      else {
        const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(V.w - Math.max(0, box.x), box.w), height: Math.min(VH - Math.max(0, box.y), box.h) };
        await target.screenshot({ path: file.replace(/\.png$/, ".pop.png"), clip });
        popped = { ...clip, radius: box.radius, screen: { w: V.w, h: V.h } };
        fs.writeFileSync(file.replace(/\.png$/, ".pop.json"), JSON.stringify(popped, null, 1));
      }
      if (target !== page) await target.close();
    }
    return { errors, flags: checked.out, text: checked.text, pop: popped };
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const frames = (FRAMES as Array<{ key: string; screen?: ScreenSpec; pop?: PopSpec; off?: boolean }>).filter((f) => f.screen && (!only || only.test(f.key)) && (!f.off || has("all")));
  const browser = await R.launchBrowser();
  const bundle = await R.buildPhoneBundle();
  const report: Record<string, unknown> = {};
  try {
    for (const f of frames) {
      const misses: string[] = [];
      const screen = await build(f.screen!, misses);
      fs.writeFileSync(path.join(OUT, `${f.key}.json`), JSON.stringify(screen, null, 1));
      for (const old of [".pop.png", ".pop.json"]) fs.rmSync(path.join(OUT, `${f.key}${old}`), { force: true });
      const r = await draw(browser, bundle, screen, f.screen!, path.join(OUT, `${f.key}.png`), f.pop);
      report[f.key] = { screen: f.screen!.id, ...r, misses: [...new Set(misses)] };
      const warn = [...r.errors.map((e) => `error: ${e}`), ...r.flags, ...[...new Set(misses)].map((m) => `no sample answer: ${m}`)];
      console.log(`${warn.length ? "CHECK" : "ok   "} ${f.key.padEnd(10)} ${f.screen!.id}${warn.length ? "\n        " + warn.join("\n        ") : ""}`);
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
}

await main();
