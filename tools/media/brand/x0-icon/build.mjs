// node build.mjs [concepts.png] [top2.png]
// Writes every <concept>/icon.svg and <concept>/icon-1024.png (full square, no mask), play-512.png for the top two,
// then the comparison sheet (each concept large under the iOS mask, its name and idea, and every icon at home-screen
// sizes on a dark and a light wallpaper) and the top-two sheet (each on a phone home screen among neutral placeholder
// apps, plus the 512 px Google Play icon under Play's mask). Playwright with Chromium.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { CONCEPTS } from "./gen.mjs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = "/tmp/claude-0/-home-user/36aabdc6-23c5-5bb4-b965-f6afd0072759/scratchpad";
const [OUT1 = `${SCRATCH}/x0-icon-concepts.png`, OUT2 = `${SCRATCH}/x0-icon-top2-in-context.png`] = process.argv.slice(2);
export const TOP = ["wink", "butler"];

// ---------------------------------------------------------------- files
const icons = {};
for (const c of CONCEPTS) {
  fs.mkdirSync(path.join(here, c.id), { recursive: true });
  icons[c.id] = c.draw();
  fs.writeFileSync(path.join(here, c.id, "icon.svg"), icons[c.id]);
}
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
async function png(svgText, out, size) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><body style="margin:0">${svgText.replace("<svg", `<svg width="${size}" height="${size}" style="display:block"`)}</body>`);
  await p.waitForTimeout(80);
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
for (const c of CONCEPTS) await png(icons[c.id], path.join(here, c.id, "icon-1024.png"), 1024);
for (const id of TOP) await png(icons[id], path.join(here, id, "play-512.png"), 512);

// ---------------------------------------------------------------- shared page bits
const uri = (s) => "data:image/svg+xml;base64," + Buffer.from(s).toString("base64");
// the iOS icon shape, close enough: a superellipse of n = 5 in a unit box
const sqPath = (() => { const pts = []; for (let i = 0; i < 240; i++) { const t = (i / 240) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); pts.push([0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** 0.4, 0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** 0.4]); } return "M" + pts.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join("L") + "Z"; })();
const head = `<meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:#1C1A17;-webkit-font-smoothing:antialiased}
.ic{display:block;clip-path:url(#sq)}.sh{filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.28)) drop-shadow(0 6px 14px rgba(0,0,0,.14))}
</style>`;
const clipDef = `<svg width="0" height="0" style="position:absolute"><clipPath id="sq" clipPathUnits="objectBoundingBox"><path d="${sqPath}"/></clipPath><clipPath id="play" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".2" ry=".2"/></clipPath></svg>`;
const icon = (id, s, cls = "sh") => `<div class="${cls}" style="width:${s}px;height:${s}px;flex:none"><img class="ic" src="${uri(icons[id])}" width="${s}" height="${s}"></div>`;
const WALL_DARK = "radial-gradient(120% 80% at 15% 10%,#3B3F7A 0,transparent 55%),radial-gradient(90% 70% at 90% 90%,#6A2E4E 0,transparent 60%),linear-gradient(160deg,#1C2340,#0E1222 60%,#241830)";
const WALL_LIGHT = "radial-gradient(100% 70% at 10% 0%,#FFE7C9 0,transparent 60%),radial-gradient(90% 80% at 100% 100%,#C7D6EE 0,transparent 60%),linear-gradient(160deg,#F3E9DC,#DCE3EE)";

async function shoot(html, out, width) {
  const p = await b.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await p.setContent(html);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await p.waitForTimeout(150);
  await p.screenshot({ path: out, fullPage: true });
  await p.close();
  console.log("wrote", out);
}

// ---------------------------------------------------------------- 1. the comparison sheet
const card = (c, i) => `<div style="background:#fff;border-radius:28px;padding:30px 30px 26px;box-shadow:0 1px 0 rgba(0,0,0,.05)">
  <div style="display:flex;justify-content:center;padding:6px 0 22px">${icon(c.id, 300)}</div>
  <div style="display:flex;align-items:baseline;gap:10px"><span style="font:600 13px Inter;color:#A9573A;letter-spacing:.06em">0${i + 1}</span><span style="font:700 24px 'Inter Display',Inter;letter-spacing:-.01em">${c.name}</span><span style="font:500 13px Inter;color:#8a847b;margin-left:auto">${c.id}/</span></div>
  <div style="font:400 15.5px/1.45 Inter;color:#4a453e;margin-top:6px;min-height:45px">${c.idea}</div></div>`;
const wall = (bg, dark) => `<div style="flex:1;border-radius:28px;padding:30px 30px 26px;background:${bg}">
  <div style="font:600 13px Inter;letter-spacing:.06em;color:${dark ? "#ffffffb0" : "#1c1a17a0"};margin-bottom:22px">${dark ? "DARK" : "LIGHT"} WALLPAPER</div>
  <div style="display:flex;justify-content:space-between">${CONCEPTS.map((c) => `<div style="display:flex;flex-direction:column;align-items:center;gap:7px">${icon(c.id, 60)}<div style="font:500 11px Inter;color:${dark ? "#fff" : "#1c1a17"}">${c.name}</div></div>`).join("")}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:26px">${CONCEPTS.map((c) => `<div style="width:60px;display:flex;gap:10px;align-items:center;justify-content:center">${icon(c.id, 40)}${icon(c.id, 29)}</div>`).join("")}</div>
  <div style="margin-top:10px;font:500 11px Inter;color:${dark ? "#ffffff80" : "#1c1a1780"}">Top row: 60 pt, the home screen. Bottom row: 40 and 29 pt, Spotlight and Settings.</div></div>`;
await shoot(`<!doctype html><html><head>${head}</head><body style="background:#EFEBE4">${clipDef}
<div style="width:1500px;padding:56px 60px 60px">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:34px">
    <div><div style="font:700 44px/1 'Inter Display',Inter;letter-spacing:-.02em">X0 Bot: app icon concepts</div>
    <div style="font:400 18px/1.4 Inter;color:#5e584f;margin-top:12px">Six directions, drawn from scratch. Shown under the iOS mask; the files are full-bleed squares.</div></div>
    <div style="display:flex;gap:8px">${["#0a0a0a", "#F3E2C6", "#F4F1EA", "#A9573A", "#C8643F", "#E8A23C"].map((c) => `<div style="width:30px;height:30px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)"></div>`).join("")}</div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">${CONCEPTS.map(card).join("")}</div>
  <div style="font:700 24px 'Inter Display',Inter;margin:44px 0 16px">At home-screen sizes</div>
  <div style="display:flex;gap:24px">${wall(WALL_DARK, true)}${wall(WALL_LIGHT, false)}</div>
</div></body></html>`, OUT1, 1500);

// ---------------------------------------------------------------- 2. the top two, in context
// neutral placeholder apps: a gradient tile and a plain white glyph; no real brand's look
const G = {
  sun: `<circle cx="40" cy="40" r="15" fill="#FFE27A"/><path d="M34 74a14 14 0 0 1 2-28 18 18 0 0 1 34 4 12 12 0 0 1 0 24Z" fill="#fff"/>`,
  ring: `<circle cx="50" cy="50" r="22" fill="none" stroke="#fff" stroke-width="9"/>`,
  note: `<circle cx="40" cy="64" r="11" fill="#fff"/><rect x="47" y="24" width="8" height="42" rx="3" fill="#fff"/><rect x="47" y="24" width="22" height="8" rx="3" fill="#fff"/>`,
  mail: `<rect x="24" y="32" width="52" height="36" rx="6" fill="#fff"/><path d="M26 35 50 54 74 35" fill="none" stroke="#0003" stroke-width="5"/>`,
  road: `<path d="M30 80 48 20h4L70 80" fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round"/>`,
  lines: `<rect x="28" y="30" width="44" height="7" rx="3.5" fill="#fff"/><rect x="28" y="46" width="44" height="7" rx="3.5" fill="#fff"/><rect x="28" y="62" width="28" height="7" rx="3.5" fill="#fff"/>`,
  clock: `<circle cx="50" cy="50" r="26" fill="#fff"/><path d="M50 34v17l11 7" fill="none" stroke="#222" stroke-width="5" stroke-linecap="round"/>`,
  peak: `<path d="M22 72 42 42 54 58 62 48 78 72Z" fill="#fff"/><circle cx="66" cy="32" r="7" fill="#fff"/>`,
  cal: `<rect x="26" y="26" width="48" height="50" rx="8" fill="#fff"/><rect x="26" y="26" width="48" height="14" rx="7" fill="#0002"/>`,
  folder: `<path d="M24 34h20l6 6h26v32H24Z" fill="#fff"/>`,
  cards: `<rect x="26" y="34" width="48" height="30" rx="6" fill="#fff" opacity=".6"/><rect x="26" y="44" width="48" height="30" rx="6" fill="#fff"/>`,
  heart: `<path d="M50 74C30 60 24 50 24 41c0-8 6-14 13-14 6 0 10 4 13 8 3-4 7-8 13-8 7 0 13 6 13 14 0 9-6 19-26 33Z" fill="#fff"/>`,
  rupee: `<path d="M34 28h34M34 40h34M40 28c22 0 22 24 0 24h-6l26 22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  bubble: `<path d="M26 36a10 10 0 0 1 10-10h28a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H44l-12 10v-10h0a6 6 0 0 1-6-6Z" fill="#fff"/>`,
  play: `<path d="M40 30v40l32-20Z" fill="#fff"/>`,
  bag: `<path d="M28 40h44l-4 36H32Z" fill="#fff"/><path d="M40 40v-6a10 10 0 0 1 20 0v6" fill="none" stroke="#fff" stroke-width="6"/>`,
  ball: `<circle cx="50" cy="50" r="24" fill="#fff"/><path d="M38 30c8 12 8 28 0 40M62 30c-8 12-8 28 0 40" fill="none" stroke="#c33" stroke-width="3"/>`,
  globe: `<circle cx="50" cy="50" r="25" fill="none" stroke="#fff" stroke-width="6"/><path d="M25 50h50M50 25c-12 14-12 36 0 50M50 25c12 14 12 36 0 50" fill="none" stroke="#fff" stroke-width="5"/>`,
  phone: `<path d="M36 26c4 0 8 10 8 13s-5 4-5 7c0 6 9 15 15 15 3 0 4-5 7-5s13 4 13 8-6 10-12 10C42 74 26 58 26 38c0-6 6-12 10-12Z" fill="#fff"/>`,
  cam: `<rect x="24" y="34" width="52" height="38" rx="9" fill="#fff"/><circle cx="50" cy="53" r="11" fill="#555"/><rect x="40" y="27" width="20" height="10" rx="3" fill="#fff"/>`,
  gear: `<circle cx="50" cy="50" r="15" fill="none" stroke="#fff" stroke-width="10" stroke-dasharray="7 4.6"/><circle cx="50" cy="50" r="24" fill="none" stroke="#fff" stroke-width="5"/>`,
  car: `<rect x="22" y="46" width="56" height="20" rx="8" fill="#fff"/><path d="M32 46l7-14h22l7 14" fill="#fff"/><circle cx="35" cy="68" r="6" fill="#333"/><circle cx="65" cy="68" r="6" fill="#333"/>`,
  fork: `<path d="M38 24v22a6 6 0 0 0 12 0V24M44 24v52M62 24c-8 6-8 22 0 26v26" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`,
  people: `<circle cx="40" cy="40" r="11" fill="#fff"/><circle cx="62" cy="44" r="9" fill="#fff" opacity=".8"/><path d="M20 76c2-14 10-20 20-20s18 6 20 20Z" fill="#fff"/>`,
};
const tile = (a, c, g) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="100" height="100" fill="url(#t)"/>${G[g]}</svg>`;
const APPS = [
  ["Weather", "#5AB0F5", "#2C6FD6", "sun"], ["Camera", "#9a9a9e", "#5d5d62", "cam"], ["Music", "#FF6C8A", "#E2304E", "note"], ["Mail", "#57A7FF", "#1E6FE8", "mail"],
  ["Maps", "#8DD58B", "#3FA35C", "road"], ["Notes", "#FFD55C", "#F2B11E", "lines"], ["Clock", "#2a2a2c", "#0e0e10", "clock"], ["Gallery", "#FFB25B", "#E5527A", "peak"],
  ["Calendar", "#FF7A6B", "#E24A3B", "cal"], ["Files", "#5BC0F8", "#1D8BE0", "folder"], ["Wallet", "#3a3a40", "#141418", "cards"], ["Health", "#FF8FA8", "#F24E76", "heart"],
  ["Pay", "#6E62F2", "#4535C8", "rupee"], ["Chat", "#43D19E", "#14A57A", "bubble"], ["Video", "#A46CF7", "#6C3AD8", "play"], ["Shop", "#FFA45C", "#F2702E", "bag"],
  ["Cricket", "#5FBF6A", "#2E8A42", "ball"], ["Rides", "#3b3b3b", "#151515", "car"], ["Food", "#FF8A5C", "#E8483A", "fork"], ["Friends", "#FFB38A", "#F07A62", "people"],
];
const DOCK = [["Phone", "#5FE07A", "#28B54A", "phone"], ["Browser", "#62B7FF", "#2A74E8", "globe"], ["Settings", "#a7a7ad", "#6b6b72", "gear"]];
const app = ([name, a, c, g], s = 60, dark = true, label = true) =>
  `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:${s}px">
   <div class="sh" style="width:${s}px;height:${s}px"><img class="ic" src="${uri(tile(a, c, g))}" width="${s}" height="${s}"></div>
   ${label ? `<div style="font:500 11px Inter;color:${dark ? "#fff" : "#1c1a17"};white-space:nowrap">${name}</div>` : ""}</div>`;
const ours = (id, s = 60, dark = true, label = true) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:${s}px">${icon(id, s)}${label ? `<div style="font:500 11px Inter;color:${dark ? "#fff" : "#1c1a17"};white-space:nowrap">X0 Bot</div>` : ""}</div>`;
function phone(id, dark) {
  const grid = APPS.map((a) => app(a, 60, dark));
  grid.splice(6, 1, ours(id, 60, dark)); // X0 Bot takes the second row, third column
  const ink = dark ? "#fff" : "#111";
  return `<div style="width:410px;height:864px;border-radius:66px;background:#0b0b0c;padding:10px;box-shadow:0 30px 60px -20px rgba(0,0,0,.45),0 0 0 2px #2a2a2c inset">
  <div style="position:relative;width:390px;height:844px;border-radius:56px;overflow:hidden;background:${dark ? WALL_DARK : WALL_LIGHT}">
    <div style="position:absolute;left:50%;top:11px;transform:translateX(-50%);width:124px;height:36px;border-radius:20px;background:#000"></div>
    <div style="position:absolute;left:44px;top:18px;font:600 16px Inter;color:${ink}">9:41</div>
    <div style="position:absolute;right:34px;top:21px;display:flex;gap:6px;align-items:center"><div style="width:17px;height:11px;border-radius:2px;background:${ink};opacity:.9"></div><div style="width:25px;height:12px;border-radius:4px;border:1.5px solid ${ink};opacity:.9;padding:1.5px"><div style="width:70%;height:100%;border-radius:2px;background:${ink}"></div></div></div>
    <div style="position:absolute;left:0;right:0;top:78px;display:grid;grid-template-columns:repeat(4,60px);justify-content:space-between;padding:0 27px;row-gap:26px">${grid.join("")}</div>
    <div style="position:absolute;left:50%;bottom:120px;transform:translateX(-50%);font:500 11px Inter;color:${ink};opacity:.75;background:${dark ? "#ffffff22" : "#00000014"};padding:5px 12px;border-radius:12px">Search</div>
    <div style="position:absolute;left:12px;right:12px;bottom:12px;height:92px;border-radius:38px;background:${dark ? "#ffffff2a" : "#ffffff70"};backdrop-filter:blur(20px);display:flex;justify-content:space-between;align-items:center;padding:0 18px">
      ${app(DOCK[0], 60, dark, false)}${app(DOCK[1], 60, dark, false)}${ours(id, 60, dark, false)}${app(DOCK[2], 60, dark, false)}</div>
  </div></div>`;
}
const playIcon = (id) => `<div style="width:256px;height:256px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.18)) drop-shadow(0 10px 22px rgba(0,0,0,.12))"><img src="${uri(icons[id])}" width="256" height="256" style="display:block;clip-path:url(#play)"></div>`;
const listing = (id) => `<div style="display:flex;gap:14px;align-items:center;background:#fff;border-radius:18px;padding:14px 16px;margin-top:16px;width:400px">
  <div style="width:64px;height:64px;flex:none"><img src="${uri(icons[id])}" width="64" height="64" style="display:block;clip-path:url(#play)"></div>
  <div style="flex:1"><div style="font:600 17px Inter">X0 Bot</div><div style="font:400 13px Inter;color:#6b665e;margin-top:2px">Voice keyboard and helper bots</div><div style="font:500 12px Inter;color:#6b665e;margin-top:4px">Productivity · Hindi, English, Hinglish</div></div>
  <div style="font:600 14px Inter;color:#fff;background:#1c1a17;border-radius:20px;padding:8px 18px">Install</div></div>`;
const top = TOP.map((id) => CONCEPTS.find((c) => c.id === id));
await shoot(`<!doctype html><html><head>${head}</head><body style="background:#EFEBE4">${clipDef}
<div style="width:1560px;padding:56px 60px 64px">
  <div style="font:700 40px/1 'Inter Display',Inter;letter-spacing:-.02em">Top two, in context</div>
  <div style="font:400 18px/1.4 Inter;color:#5e584f;margin-top:12px;margin-bottom:36px">1. ${top[0].name}: ${top[0].idea} &nbsp; 2. ${top[1].name}: ${top[1].idea}</div>
  <div style="display:flex;gap:40px;align-items:flex-start">
    ${phone(TOP[0], true)}${phone(TOP[1], false)}
    <div style="flex:1;padding-left:8px">
      <div style="font:600 13px Inter;letter-spacing:.06em;color:#8a847b;margin-bottom:16px">GOOGLE PLAY, 512 PX (PLAY'S MASK, SHOWN AT 1:1)</div>
      ${TOP.map((id) => `<div style="margin-bottom:34px">${playIcon(id)}${listing(id)}</div>`).join("")}
    </div>
  </div>
</div></body></html>`, OUT2, 1560);
await b.close();
