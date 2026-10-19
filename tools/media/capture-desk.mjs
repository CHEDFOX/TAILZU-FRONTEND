/**
 * The desktop app's own pages, captured for the films: TAILZU-DESKTOP's
 * app.html and sdui.js, drawn by Chromium against a real backend, and
 * driven the way a person would. Today, the gear, Settings, "Give it a
 * name", the name typed a letter at a time, Save, the toast. Each step is a
 * PNG of the window's content at 2×, and deskapp/meta.js says where the
 * things that get clicked are, in the window's points.
 *
 *   # a backend on :8787 with in-memory stores (no Supabase, no keys used):
 *   cd TAILZU-BACKEND/tulmi && DEV_SKIP_AUTH=true OPENROUTER_API_KEY=film \
 *     OPENAI_API_KEY=film STT_PROVIDER=openai PORT=8787 HOST=127.0.0.1 npx tsx src/server.ts
 *   PW_ROOT=<dir with playwright> node tools/media/capture-desk.mjs [../TAILZU-DESKTOP]
 *
 * MODE=today captures the Today page instead, whole (deskapp/today-full.png)
 * with where its figures and sections are, for a backend whose in-memory
 * stores hold a day of dictations (desk-seed/README.md), the browser in
 * India's time zone and its clock at that backend's.
 *
 * The window is the app's own default, 1120×780, in dark mode as a Mac at
 * night would show it. The bridge the Electron preload exposes is stood in
 * for (an env with the backend's address and a session, defaults for the
 * rest): nothing on the page is drawn here, only driven.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_ROOT || here, "/"));
const { chromium } = require("playwright");
const desk = path.resolve(process.argv[2] || path.join(here, "..", "..", "..", "TAILZU-DESKTOP"));
const out = path.join(here, "deskapp");
const NAME = process.env.NAME || "Zara", BASE = process.env.BASE || "http://127.0.0.1:8787", MODE = process.env.MODE || "name";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--disable-web-security", "--allow-file-access-from-files"] });
const ctx = await browser.newContext({
  viewport: { width: 1120, height: 780 }, deviceScaleFactor: 2, colorScheme: "dark", timezoneId: process.env.TZ_ID || "Asia/Kolkata",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Tailzu/0.3.12 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36",
});
await ctx.addInitScript(({ base }) => {
  Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  const env = { baseUrl: base, session: { accessToken: "dev", access_token: "dev", expiresAt: Date.now() + 864e5 }, appVersion: "0.3.12", platform: "darwin", hotkey: "⌘ ⇧ Space", launchCount: 9 };
  const noop = () => {};
  const local = { pill: true, pauseFlush: true, autoStart: false, live: false, tap: true, tapKeys: ["Ctrl", "Alt"], hotkey: "⌘+Shift+Space", hold: false, notesHotkey: "⌘+Alt+N" };
  window.tailzuApp = new Proxy({ env: async () => env, config: async () => local, session: async () => env.session },
    { get: (o, k) => k in o ? o[k] : (typeof k === "string" && k.startsWith("on") ? noop : async () => null) });
  window.tailzu = new Proxy({}, { get: () => noop });
}, { base: BASE });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page:", e.message));
if (process.env.CLOCK) await page.clock.setFixedTime(new Date(process.env.CLOCK));
// A fresh account each run: the name starts empty.
await fetch(BASE + "/v1/personality", { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer dev" }, body: JSON.stringify({ assistantName: "" }) }).catch(() => {});
await page.goto("file://" + path.join(desk, "app.html"));
await page.waitForSelector("#view *", { timeout: 20000 }); await page.waitForTimeout(1200);
if (MODE === "voices") {
  // The Voices page whole, on each of its tabs, and after a voice is chosen;
  // with where each card is, by its voice's name.
  await page.getByText("Voices", { exact: true }).first().click(); await page.waitForTimeout(1500);
  const whole = async (id) => {
    const H = await page.evaluate(() => document.getElementById("mast").getBoundingClientRect().height + document.getElementById("view").scrollHeight);
    await page.setViewportSize({ width: 1120, height: Math.ceil(H) }); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `voices-${id}.png`) }); console.log(`voices-${id}.png`);
    return Math.ceil(H);
  };
  const cards = () => page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("#view *")) {
      const NAMES = ["ZU", "PROFESSIONAL", "FRIENDLY", "WITTY", "CONCISE", "GENTLE", "PLAYFUL", "ROMANTIC", "EXECUTIVE", "EXPLAINER", "HYPE", "POETIC", "SHAKESPEARE", "PIRATE", "MOVIE TRAILER", "NOIR"];
      if (el.children.length || !NAMES.includes(el.textContent.trim().toUpperCase())) continue;
      let c = el; for (let i = 0; i < 4 && c; i++) { c = c.parentElement; const b = c && c.getBoundingClientRect(); if (b && b.width > 200 && b.width < 300 && b.height > 150) break; }
      const b = c && c.getBoundingClientRect(); if (b && b.width > 200 && b.width < 300 && b.height > 150) out[el.textContent.trim().toUpperCase()] = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    }
    return out;
  });
  const meta = { w: 1120, tabs: {} };
  meta.h = await whole("chats"); meta.cards = await cards();
  const tab = (name) => page.locator("#view *").filter({ hasText: new RegExp(`^${name}$`, "i") }).last().click();
  for (const t of ["Work", "Email"]) { await tab(t); await page.waitForTimeout(1500); await whole(t.toLowerCase()); }
  await tab("Chats"); await page.waitForTimeout(1200);
  const pick = process.env.PICK || "WITTY";
  const box = meta.cards[pick]; meta.pick = pick;
  await page.mouse.click(box[0] + box[2] / 2, box[1] + box[3] / 2); await page.waitForTimeout(1800);
  await whole("picked");
  const tabsAt = await page.evaluate(() => [...document.querySelectorAll("#view *")].filter((e) => !e.children.length && ["CHATS", "WORK", "EMAIL", "OTHER"].includes(e.textContent.trim().toUpperCase())).map((e) => { const b = e.getBoundingClientRect(); return [e.textContent.trim().toUpperCase(), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }));
  meta.tabs = Object.fromEntries(tabsAt.map(([n, ...r]) => [n, r]));
  fs.writeFileSync(path.join(out, "voices-meta.js"), "window.TZ_DESK_VOICES = " + JSON.stringify(meta) + ";\n");
  console.log(JSON.stringify(meta).slice(0, 600));
  await browser.close(); process.exit(0);
}
if (MODE === "today") {
  // The page whole: the window grown to its height, the masthead at its top.
  const H = await page.evaluate(() => document.getElementById("mast").getBoundingClientRect().height + document.getElementById("view").scrollHeight);
  await page.setViewportSize({ width: 1120, height: Math.ceil(H) }); await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, "today-full.png") });
  const at = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const byText = (s) => [...document.querySelectorAll("#view *")].find((e) => e.children.length === 0 && e.textContent.trim() === s);
    const tile = (lab) => { const l = byText(lab); let e = l; e = e && e.parentElement; return r(e); };
    return { mast: r(document.getElementById("mast")), words: tile("Words today"), back: tile("Time back"), streak: tile("Day streak"),
      hours: r(byText("Today, hour by hour")), race: r(byText("Said against typed")), backLine: r([...document.querySelectorAll("#view *")].find((e) => /back today\.$/.test(e.textContent.trim()) && e.children.length <= 3)) };
  });
  fs.writeFileSync(path.join(out, "today-meta.js"), "window.TZ_DESK_TODAY = " + JSON.stringify({ w: 1120, h: Math.ceil(H), at }) + ";\n");
  console.log("today-full.png", JSON.stringify(at));
  await browser.close(); process.exit(0);
}

const meta = { w: 1120, h: 780, name: NAME, shots: [], at: {} };
const box = async (loc) => { const b = await loc.boundingBox(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
const shot = async (id) => { await page.screenshot({ path: path.join(out, id + ".png"), caret: "initial" }); meta.shots.push(id); console.log(id); };

await shot("today");
meta.at.gear = await box(page.locator("#gear"));
await page.click("#gear"); await page.waitForTimeout(1200);
const give = page.getByText("Give it a name", { exact: true });
await give.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
await shot("settings");
meta.at.give = await box(give);
await give.click(); await page.waitForTimeout(1200);
await shot("name");
const input = page.locator("input[placeholder='A name of your own']");
meta.at.input = await box(input);
const save = page.getByText("Save", { exact: true });
meta.at.save = await box(save);
await input.click(); await page.waitForTimeout(200); await shot("name-focus");
for (let i = 1; i <= NAME.length; i++) { await input.type(NAME[i - 1]); await page.waitForTimeout(120); await shot("name-" + i); }
await save.hover(); await page.waitForTimeout(250); await shot("save-hover");
await save.click();
for (let i = 0; i < 8; i++) { await page.waitForTimeout(250); await shot("saved-" + i); }
meta.at.h1 = await box(page.locator(".d-h1").first());
// The tray's two dots, as the app ships them: grey at rest (a template), amber while it listens.
for (const f of ["tray.png", "tray-live.png"]) fs.copyFileSync(path.join(desk, "assets", f), path.join(out, f));
fs.writeFileSync(path.join(out, "meta.js"), "window.TZ_DESK_META = " + JSON.stringify(meta) + ";\n");
console.log("meta.js", JSON.stringify(meta.at));
await browser.close();
