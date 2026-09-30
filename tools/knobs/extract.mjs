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
// The app, and the desktop app (its window renders the same bootstrap; its
// main process reads the same flags through its own copy of the knobs). The
// desktop lives in its own repo, TAILZU-DESKTOP: DESKTOP_DIR names a checkout,
// or it is looked for beside this one. Without it the manifest would silently
// lose every desktop key, so it is required.
const desktop = [process.env.DESKTOP_DIR, path.resolve(repo, "../TAILZU-DESKTOP"), path.resolve(repo, "../tailzu-desktop")]
  .find((d) => d && fs.existsSync(path.join(d, "knobs.js")));
if (!desktop) {
  console.error("No TAILZU-DESKTOP checkout: set DESKTOP_DIR (the desktop's knobs are part of this manifest).");
  process.exit(2);
}
const roots = [path.join(repo, "app/src"), path.join(repo, "app/App.tsx"), desktop];
const out = path.join(here, "app-knobs.json");

const files = [];
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (/node_modules|dist|build|assets$/.test(path.basename(p))) return;
    for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    return;
  }
  if (p.includes("node_modules") || p.includes(`${path.sep}dist${path.sep}`)) return;
  if (/\.(ts|tsx|js|html)$/.test(p) && !/knobs\.(ts|js)$/.test(p) && !/gen-\w+\.js$/.test(p)) files.push(p);
};
roots.forEach(walk);

const KIND = { txt: "labels", num: "flags", bool: "flags", str: "flags", color: "flags", list: "flags", tuple: "flags", obj: "flags" };
// A TypeScript type argument may sit between the name and the call: obj<T>("k", {}).
const call = /\b(txt|num|bool|str|color|list|tuple|obj)(?:<[^()]*?>)?\(\s*(["'])((?:(?!\2).)+)\2\s*,\s*/g;

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

/**
 * A reader imported under another name — `import { color as knobColor }` —
 * is still a reader. Missing it made the manifest drop every knob the name
 * card reads (profile.color.*), and a key the manifest does not list looks
 * unread, so it gets deleted from the server while the app still asks for it.
 */
const aliasImport = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\bknobs(?:\.js)?["']/g;
function aliasesIn(src) {
  const out = {};
  for (const [, names] of src.matchAll(aliasImport)) {
    for (const spec of names.split(",")) {
      const m = /^\s*(\w+)\s+as\s+(\w+)\s*$/.exec(spec);
      if (m && KIND[m[1]] && m[2] !== m[1]) out[m[2]] = m[1];
    }
  }
  return out;
}

const manifest = { labels: {}, flags: {}, dynamic: {} };
const where = {};
const clashes = [];
for (const f of files.sort()) {
  const src = fs.readFileSync(f, "utf8");
  const aliases = aliasesIn(src);
  const aliasCall = Object.keys(aliases).length
    ? new RegExp(`\\b(${Object.keys(aliases).join("|")})(?:<[^()]*?>)?\\(\\s*(["'])((?:(?!\\2).)+)\\2\\s*,\\s*`, "g")
    : null;
  const matches = [...src.matchAll(call), ...(aliasCall ? src.matchAll(aliasCall) : [])].sort((a, b) => a.index - b.index);
  for (const m of matches) {
    const [, name, , key] = m;
    const fn = aliases[name] ?? name;
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
