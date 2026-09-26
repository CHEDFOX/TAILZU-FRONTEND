#!/usr/bin/env node
/**
 * Every flag and label the two keyboards read, with the default written in
 * native code next to it → tools/knobs/keyboard-knobs.json.
 *
 * The backend fills any key it does not already send with that default
 * (its src/experience/keyboardKnobsData.ts is a copy), so no keyboard ever
 * decides a value the server did not send, and the control console can
 * find and change every one.
 *
 *   node tools/knobs/extract-keyboard.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const out = path.join(here, "keyboard-knobs.json");
const IOS = path.join(repo, "app/targets/keyboard");
const ANDROID = path.join(repo, "app/modules/tulmi-keyboard/android");

const read = (dir, ext) => fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort()
  .map((f) => ({ f: path.relative(repo, path.join(dir, f)), src: fs.readFileSync(path.join(dir, f), "utf8") }));

/** A literal default after `(key, `: string, number (Kotlin 8f / 1L too), bool. */
function literal(rest) {
  let m;
  if ((m = /^"((?:[^"\\]|\\.)*)"\s*\)/.exec(rest))) return { v: JSON.parse(`"${m[1].replace(/\\\(/g, "(")}"`) };
  if ((m = /^(-?\d+(?:\.\d+)?)[fFLd]?\s*\)/.exec(rest))) return { v: Number(m[1]) };
  if ((m = /^(true|false)\s*\)/.exec(rest))) return { v: m[1] === "true" };
  return null;
}

function scan(files, fns, direct) {
  const flags = {}, labels = {}, dynamic = {}, clashes = [];
  const put = (bucket, key, v, at) => {
    const prev = bucket[key];
    if (prev !== undefined && JSON.stringify(prev.v) !== JSON.stringify(v)) clashes.push(`${key}: ${JSON.stringify(prev.v)} (${prev.at}) vs ${JSON.stringify(v)} (${at})`);
    if (prev === undefined) bucket[key] = { v, at };
    delete dynamic[key];
  };
  for (const { f, src } of files) {
    const lineOf = (i) => src.slice(0, i).split("\n").length;
    const re = new RegExp(`\\b(${fns.join("|")})\\(\\s*"([^"]+)"\\s*,\\s*`, "g");
    for (const m of src.matchAll(re)) {
      const [, fn, key] = m;
      const isLabel = /label/i.test(fn);
      // Flags are the kb.* namespace; anything else read this way is a node
      // prop or a JSON field inside a flag, not a knob of its own.
      if (!isLabel && !key.startsWith("kb.")) continue;
      const lit = literal(src.slice(m.index + m[0].length));
      const at = `${f}:${lineOf(m.index)}`;
      if (!lit) { if (!(key in (isLabel ? labels : flags))) dynamic[key] = { at }; continue; }
      put(isLabel ? labels : flags, key, lit.v, at);
    }
    for (const m of src.matchAll(direct)) {
      const key = m[1];
      if (!(key in flags) && !(key in labels)) dynamic[key] = { at: `${f}:${lineOf(m.index)}` };
    }
  }
  const strip = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k].v]));
  return { flags: strip(flags), labels: strip(labels), dynamic: Object.keys(dynamic).sort(), clashes };
}

const ios = scan(read(IOS, ".swift"),
  ["flagBool", "flagDouble", "flagCGFloat", "flagString", "flagColor", "flagIcon", "hostLabel", "label"],
  /flags\??\["(kb\.[^"]+)"\]/g);
const android = scan([...read(ANDROID, ".kt")],
  ["flagFloat", "flagBoolean", "label", "optBoolean", "optString", "optInt", "optDouble"],
  /(?:flags\??(?:\.get\(|\[)|optJSONObject\(|optJSONArray\()"(kb\.[^"]+)"/g);

const clashes = [...ios.clashes.map((c) => "ios " + c), ...android.clashes.map((c) => "android " + c)];
if (clashes.length) console.error("Note — one key, two defaults (first kept):\n  " + clashes.join("\n  "));
const doc = { ios: { flags: ios.flags, labels: ios.labels, dynamic: ios.dynamic },
  android: { flags: android.flags, labels: android.labels, dynamic: android.dynamic } };
const text = JSON.stringify(doc, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (cur !== text) { console.error("keyboard-knobs.json is out of date: run node tools/knobs/extract-keyboard.mjs"); process.exit(1); }
  console.log("keyboard knob manifest up to date");
} else {
  fs.writeFileSync(out, text);
  for (const [p, d] of Object.entries(doc)) {
    console.log(`${p}: ${Object.keys(d.flags).length} flags, ${Object.keys(d.labels).length} labels, ${d.dynamic.length} dynamic`);
  }
}
