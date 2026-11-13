#!/usr/bin/env node
/**
 * Open-licence footage for the campaign: search Coverr, Mixkit and the Internet Archive for a phrase, download the
 * candidates, make a contact sheet of each, and write a manifest with every clip's source, page and licence.
 *
 *   node tools/media/ad/stock/find.mjs "<query>" [--n 6] [--out <dir>] [--sources coverr,mixkit,archive] [--min 4] [--max 60]
 *
 * Coverr (coverr.co): free for commercial use, no attribution (Coverr licence). Mixkit (mixkit.co): Mixkit licence, free
 * for commercial use, no attribution. Internet Archive: only items whose licenceurl is public domain / CC0 are taken.
 * Every clip lands in <out>/<source>-<id>/clip.mp4 with sheet.png (12 frames) and meta.json; <out>/manifest.json lists
 * them all. Downloads are untrusted data: nothing here runs them, ffprobe/ffmpeg only read them.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const query = argv.find((a) => !a.startsWith("--"));
if (!query) { console.error('usage: find.mjs "<query>" [--n 6] [--out dir] [--sources coverr,mixkit,archive]'); process.exit(1); }
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const N = Number(opt("n", "6")), OUT = path.resolve(opt("out", path.join("stock", "found", query.replace(/[^a-z0-9]+/gi, "-").toLowerCase())));
const SOURCES = opt("sources", "coverr,mixkit,archive").split(",");
const MIN = Number(opt("min", "3")), MAX = Number(opt("max", "90"));
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
fs.mkdirSync(OUT, { recursive: true });

async function text(url) { const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json" } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
const uniq = (a) => [...new Set(a)];

/** Coverr: the search page carries the result cards; each video has a cdn id and renditions 360p/720p/1080p. */
async function coverr(q) {
  const html = await text(`https://coverr.co/s?q=${encodeURIComponent(q)}`);
  const ids = uniq([...html.matchAll(/cdn\.coverr\.co\/videos\/([A-Za-z0-9-]+)\/(?:360|720|1080)p\.mp4/g)].map((m) => m[1]));
  const titles = {}; for (const m of html.matchAll(/"title":"([^"]{3,120})"[^{}]{0,400}?cdn\.coverr\.co\/videos\/([A-Za-z0-9-]+)\//g)) titles[m[2]] = titles[m[2]] || m[1];
  return ids.map((id) => ({ source: "coverr", id, title: titles[id] || id, page: `https://coverr.co/videos/${id}`, licence: "Coverr licence: free for commercial use, no attribution required",
    urls: [`https://cdn.coverr.co/videos/${id}/1080p.mp4`, `https://cdn.coverr.co/videos/${id}/720p.mp4`, `https://cdn.coverr.co/videos/${id}/360p.mp4`] }));
}
/** Mixkit: the category/search page lists videos with their asset ids. */
async function mixkit(q) {
  const slug = q.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let html = "";
  for (const u of [`https://mixkit.co/free-stock-video/${slug}/`, `https://mixkit.co/free-stock-video/?q=${encodeURIComponent(q)}`]) { try { html = await text(u); break; } catch (e) { /* next */ } }
  const ids = uniq([...html.matchAll(/assets\.mixkit\.co\/videos\/(\d+)\/\1-(?:360|720|1080)\.mp4/g)].map((m) => m[1]));
  const titles = {}; for (const m of html.matchAll(/<h2[^>]*>\s*([^<]{3,120}?)\s*<\/h2>[\s\S]{0,1200}?assets\.mixkit\.co\/videos\/(\d+)\//g)) titles[m[2]] = titles[m[2]] || m[1].trim();
  return ids.map((id) => ({ source: "mixkit", id, title: titles[id] || `mixkit ${id}`, page: `https://mixkit.co/free-stock-video/?q=${encodeURIComponent(q)}`, licence: "Mixkit licence: free for commercial use, no attribution required",
    urls: [`https://assets.mixkit.co/videos/${id}/${id}-1080.mp4`, `https://assets.mixkit.co/videos/${id}/${id}-720.mp4`] }));
}
/**
 * The Internet Archive: public-domain / CC0 films only (a licence URL that says so, or a NASA item: a US government
 * work). Downloads the h.264 derivative (<name>.ia.mp4, else _512kb.mp4, else any mp4), which is the lightest file that
 * is still judgeable; the item's other video files (the MPEG-2 original, often 720x480) are listed in meta.json as
 * `files` so one chosen clip can have its original fetched afterwards.
 */
async function archive(q) {
  const lic = "(licenseurl:*publicdomain* OR licenseurl:*zero* OR collection:nasa)";
  const j = JSON.parse(await text(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${q} AND mediatype:movies AND ${lic}`)}&fl[]=identifier&fl[]=title&fl[]=licenseurl&fl[]=collection&rows=${N * 2}&output=json`));
  const out = [];
  for (const d of j.response.docs) {
    try {
      const meta = JSON.parse(await text(`https://archive.org/metadata/${d.identifier}`));
      const vids = (meta.files || []).filter((x) => /\.(mp4|m4v|mpe?g|mov|avi|mkv|ogv)$/i.test(x.name));
      // judge on the small 512 kb derivative (about 4 MB a minute); the picked clip's better file is fetched afterwards from `files`
      const f = vids.find((x) => /_512kb\.mp4$/i.test(x.name)) || vids.find((x) => /\.ia\.mp4$/i.test(x.name)) || vids.find((x) => /\.mp4$/i.test(x.name));
      if (!f) continue;
      if ((Number(f.size) || 0) > 300e6) { console.error(`  archive ${d.identifier}: ${(Number(f.size) / 1e6).toFixed(0)} MB, too long, skipped`); continue; }
      const coll = [].concat(d.collection || []);
      const licence = d.licenseurl ? `${d.licenseurl} (public domain / CC0)` : coll.includes("nasa") ? "NASA item: US government work, public domain (archive.org collection nasa)" : null;
      if (!licence) continue;
      out.push({ source: "archive", id: d.identifier, title: d.title, page: `https://archive.org/details/${d.identifier}`, licence, collection: coll,
        files: vids.map((x) => ({ name: x.name, size: Number(x.size) || 0, format: x.format, width: x.width, height: x.height, url: `https://archive.org/download/${d.identifier}/${encodeURIComponent(x.name)}` })),
        urls: [`https://archive.org/download/${d.identifier}/${encodeURIComponent(f.name)}`] });
    } catch (e) { /* skip */ }
    if (out.length >= N) break;
  }
  return out;
}

async function download(c, dir) {
  for (const u of c.urls) {
    const r = spawnSync("curl", ["-sS", "-L", "-A", UA, "--max-time", c.source === "archive" ? "900" : "180", "-o", path.join(dir, "clip.mp4"), "-w", "%{http_code}", u], { encoding: "utf8" });
    if (r.stdout.trim() === "200" && fs.existsSync(path.join(dir, "clip.mp4")) && fs.statSync(path.join(dir, "clip.mp4")).size > 50000) return u;
    fs.rmSync(path.join(dir, "clip.mp4"), { force: true });
  }
  return null;
}
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
  try { const j = JSON.parse(r.stdout); const s = j.streams[0]; return { w: s.width, h: s.height, fps: eval(s.r_frame_rate), dur: Number(j.format.duration) }; } catch { return null; }
}
/** A contact sheet: 12 frames for a clip, 48 for a film longer than two minutes (one every dur/48 s, so a stretch can be found). */
function sheet(file, to, dur) {
  const long = dur > 120, n = long ? 48 : 12;
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `fps=${n}/${Math.max(dur, 0.5)},scale=${long ? 240 : 320}:-2,tile=${long ? "8x6" : "6x2"}:padding=4:margin=4:color=0xDDDDDD`, "-frames:v", "1", to]);
}

const found = [];
for (const s of SOURCES) {
  try { const list = await ({ coverr, mixkit, archive })[s](query); console.error(`${s}: ${list.length} results`); found.push(...list.slice(0, N)); }
  catch (e) { console.error(`${s}: ${e.message}`); }
}
const manifest = [];
for (const c of found) {
  const dir = path.join(OUT, `${c.source}-${c.id}`.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80)); fs.mkdirSync(dir, { recursive: true });
  const url = await download(c, dir); if (!url) { console.error(`  ${c.source} ${c.id}: no download`); continue; }
  const max = c.source === "archive" && !argv.includes("--max") ? 3600 : MAX; // an archive film is minutes long; a stretch is cut from it later
  const p = probe(path.join(dir, "clip.mp4")); if (!p || p.dur < MIN || p.dur > max) { console.error(`  ${c.source} ${c.id}: ${p ? p.dur.toFixed(1) + " s" : "unreadable"}, skipped`); fs.rmSync(dir, { recursive: true, force: true }); continue; }
  sheet(path.join(dir, "clip.mp4"), path.join(dir, "sheet.png"), p.dur);
  const meta = { ...c, url, ...p, dir, sheet: path.join(dir, "sheet.png"), file: path.join(dir, "clip.mp4") };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1)); manifest.push(meta);
  console.log(`${c.source}  ${c.id}  ${p.w}x${p.h} ${p.fps.toFixed(0)} fps ${p.dur.toFixed(1)} s  ${c.title}`);
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ query, found: manifest }, null, 1));
console.log(`${manifest.length} clips in ${OUT}`);
