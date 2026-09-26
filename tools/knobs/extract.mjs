#!/usr/bin/env node
/**
 * Collect every knob the app reads — txt(), num(), bool(), str(), color(),
 * list(), obj() from app/src/sdui/knobs.ts — with the fallback written next
 * to it, into tools/knobs/app-knobs.json.
 *
 * The backend sends every knob in that file explicitly (its
 * src/experience/app-knobs.json is a copy), so each one is visible and
 * changeable from the control console. Run after adding knobs:
 *
 *   node tools/knobs/extract.mjs          # write the manifest
 *   node tools/knobs/extract.mjs --check  # fail if it is out of date (CI)
 *
 * A fallback that is not a literal (a theme colour, a constant) is listed
 * under "dynamic": the app keeps deciding it from its own inputs unless the
 * server sets the key, which the console can do like any other.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const roots = [path.join(repo, "app/src"), path.join(repo, "app/App.tsx")];
const out = path.join(here, "app-knobs.json");

const files = [];
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  if (/\.(ts|tsx)$/.test(p) && !p.endsWith("knobs.ts")) files.push(p);
};
roots.forEach(walk);

const KIND = { txt: "labels", num: "flags", bool: "flags", str: "flags", color: "flags", list: "flags", obj: "flags" };
const call = /\b(txt|num|bool|str|color|list|obj)\(\s*(["'])((?:(?!\2).)+)\2\s*,\s*/g;

/** Read the literal default starting at `i`; undefined if it is not a literal. */
function literalAt(src, i) {
  const rest = src.slice(i);
  let m;
  if ((m = /^"((?:[^"\\]|\\.)*)"\s*[,)]/.exec(rest))) return JSON.parse(`"${m[1]}"`);
  if ((m = /^'((?:[^'\\]|\\.)*)'\s*[,)]/.exec(rest))) return JSON.parse(`"${m[1].replace(/"/g, '\\"').replace(/\\'/g, "'")}"`);
  if ((m = /^(-?\d+(?:\.\d+)?)\s*[,)]/.exec(rest))) return Number(m[1]);
  if ((m = /^(true|false)\s*[,)]/.exec(rest))) return m[1] === "true";
  if (rest[0] === "[" || rest[0] === "{") {
    // A JSON-shaped literal: find its end by bracket depth, then try JSON.
    let depth = 0, j = 0, q = null;
    for (; j < rest.length; j++) {
      const ch = rest[j];
      if (q) { if (ch === "\\") j++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") { depth--; if (depth === 0) break; }
    }
    const body = rest.slice(0, j + 1)
      .replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(body); } catch { return undefined; }
  }
  return undefined;
}

const manifest = { labels: {}, flags: {}, dynamic: {} };
const where = {};
const clashes = [];
for (const f of files.sort()) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(call)) {
    const [, fn, , key] = m;
    const bucket = KIND[fn];
    const value = literalAt(src, m.index + m[0].length);
    const rel = path.relative(repo, f) + ":" + (src.slice(0, m.index).split("\n").length);
    if (value === undefined) {
      if (!(key in manifest[bucket])) manifest.dynamic[key] = { kind: fn, at: rel };
      continue;
    }
    const prev = manifest[bucket][key];
    if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(value)) {
      clashes.push(`${key}: ${JSON.stringify(prev)} at ${where[key]} vs ${JSON.stringify(value)} at ${rel}`);
    }
    if (prev === undefined) { manifest[bucket][key] = value; where[key] = rel; }
    delete manifest.dynamic[key];
  }
}
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const doc = { labels: sortObj(manifest.labels), flags: sortObj(manifest.flags), dynamic: sortObj(manifest.dynamic) };
const text = JSON.stringify(doc, null, 2) + "\n";

if (clashes.length) {
  console.error("Same knob, different fallbacks — make them agree:\n  " + clashes.join("\n  "));
  process.exit(1);
}
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (cur !== text) { console.error("tools/knobs/app-knobs.json is out of date: run node tools/knobs/extract.mjs"); process.exit(1); }
  console.log("knob manifest up to date");
} else {
  fs.writeFileSync(out, text);
  console.log(`${Object.keys(doc.labels).length} labels, ${Object.keys(doc.flags).length} flags, ${Object.keys(doc.dynamic).length} dynamic → ${path.relative(repo, out)}`);
}
