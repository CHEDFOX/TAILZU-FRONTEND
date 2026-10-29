/**
 * THE STORE SCREENS: each frame's app screen (frames.mjs), built by the server's own screen builders with the frame's sample
 * day and drawn by the phone app's own renderer (TAILZU-FRONTEND/app/src/sdui through react-native-web, the bundle the
 * backend's render check makes: TAILZU-BACKEND/tulmi/scripts/bots-render/render.ts). Nothing here is a mock-up: the
 * screen JSON is what the server would send, and the pixels are what the app's renderer draws for it.
 *
 * Run by build.mjs (one command for everything). On its own, from TAILZU-BACKEND/tulmi:
 *   npx tsx ../../TAILZU-FRONTEND/tools/media/store/screens.mts [--out <dir>] [--only <frame key regex>] [--all]
 * (--all also renders the frames marked off.)
 *
 * Writes, in --out (default tools/media/store/out/screens/):
 *   <key>.png    the screen at 3x (a 402 x 874 pt phone: 1206 x 2622), status bar area left clear for the frame's own
 *   <key>.json   the screen as built
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
/** The phone the screens are drawn on (frames.mjs SIZES.phone), at 3x. */
const PHONE = { ...SIZES.phone, scale: 3 } as { w: number; h: number; top: number; bottom: number; scale: number };

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
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function draw(browser: any, bundle: string, screen: unknown, spec: ScreenSpec, file: string) {
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: PHONE.w, height: PHONE.h }, deviceScaleFactor: PHONE.scale, reducedMotion: "reduce" });
  try {
    page.on("pageerror", (e: Error) => errors.push(e.message));
    const fonts = botsFonts();
    const faces = Object.values(FACE as Record<string, string>).map((f) => `@font-face{font-family:"${f}";src:url(${fonts[f]})}`).join("");
    const insets = { top: PHONE.top, bottom: PHONE.bottom, left: 0, right: 0 };
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
    const checked = await page.evaluate(`${CHECK}(${JSON.stringify(RULES.map((r: { name: string; re: RegExp }) => [r.name, r.re.source]))})`) as { out: string[]; text: string };
    await page.screenshot({ path: file });
    return { errors, flags: checked.out, text: checked.text };
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const frames = (FRAMES as Array<{ key: string; screen?: ScreenSpec; off?: boolean }>).filter((f) => f.screen && (!only || only.test(f.key)) && (!f.off || has("all")));
  const browser = await R.launchBrowser();
  const bundle = await R.buildPhoneBundle();
  const report: Record<string, unknown> = {};
  try {
    for (const f of frames) {
      const misses: string[] = [];
      const screen = await build(f.screen!, misses);
      fs.writeFileSync(path.join(OUT, `${f.key}.json`), JSON.stringify(screen, null, 1));
      const r = await draw(browser, bundle, screen, f.screen!, path.join(OUT, `${f.key}.png`));
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
