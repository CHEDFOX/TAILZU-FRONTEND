// Keeps the runtime label (app/app.config.ts `runtimeVersion`) honest.
//
//   node tools/ci/check-runtime.mjs            check (default)
//   node tools/ci/check-runtime.mjs --write    rewrite app/native-inputs.lock
//
// The label changes only when native code that already exists changes: an Expo
// SDK / React Native upgrade, any installed native package version, a local
// module function removed or renamed, a Reanimated static flag. Additions and
// art/version/permission-string changes never need a bump. No dependencies;
// without node_modules, the package list comes from the previous lock and the
// versions from app/package-lock.json.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const lockPath = process.env.CHECK_RUNTIME_LOCK || join(app, "native-inputs.lock");
const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));
const exists = (p) => existsSync(p);

const SKIP_DIR = new Set(["node_modules", "build", ".gradle", "Pods", "DerivedData", ".git", ".cxx"]);
const SKIP_FILE = /\.(png|jpe?g|gif|webp|heic|svg|ttf|otf|woff2?|icns|ico|pdf|mp3|wav|m4a|mp4)$|^(README.*|FONTS\.md|\.DS_Store)$/i;

function walk(dir, out = []) {
  if (!exists(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, out);
    } else if (!SKIP_FILE.test(name)) out.push(p);
  }
  return out;
}

const rel = (p) => p.slice(app.length + 1).split("\\").join("/");

function runtimeString() {
  const m = read(join(app, "app.config.ts")).match(/^\s*runtimeVersion:\s*"([^"]+)"/m);
  if (!m) throw new Error("runtimeVersion string not found in app/app.config.ts");
  return m[1];
}

function isNative(dir) {
  if (exists(join(dir, "ios")) || exists(join(dir, "android")) || exists(join(dir, "expo-module.config.json"))) return true;
  return readdirSync(dir).some((f) => f.endsWith(".podspec"));
}

function compute(prev) {
  const pl = json(join(app, "package-lock.json")).packages;
  const installed = (n) => pl["node_modules/" + n]?.version;
  const hasModules = exists(join(app, "node_modules"));
  let names;
  if (hasModules) {
    names = Object.keys(pl)
      .filter((k) => /^node_modules\/(@[^/]+\/)?[^/]+$/.test(k))
      .map((k) => k.slice("node_modules/".length))
      .filter((n) => exists(join(app, "node_modules", n)) && isNative(join(app, "node_modules", n)));
  } else {
    names = Object.keys(prev?.packages ?? {});
  }
  const packages = {};
  for (const n of names.sort()) packages[n] = installed(n) ?? null;

  const modules = {};
  const modRoot = join(app, "modules");
  for (const m of readdirSync(modRoot).sort()) {
    if (!statSync(join(modRoot, m)).isDirectory()) continue;
    const fns = new Set();
    for (const f of walk(join(modRoot, m))) {
      if (!/\.(swift|kt)$/.test(f)) continue;
      for (const x of read(f).matchAll(/\b(?:Async)?Function\(\s*"([^"]+)"/g)) fns.add(x[1]);
    }
    modules[m] = [...fns].sort();
  }

  const h = createHash("sha256");
  for (const f of [...walk(join(app, "modules")), ...walk(join(app, "targets"))].sort()) {
    h.update(rel(f) + "\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  const rn = installed("react-native");
  const expo = installed("expo");
  return {
    runtime: runtimeString(),
    expoSdk: expo ? expo.split(".")[0] : null,
    reactNative: rn ?? null,
    reanimatedStaticFlags: json(join(app, "package.json")).reanimated?.staticFeatureFlags ?? {},
    packages,
    modules,
    sourcesSha256: h.digest("hex"),
  };
}

const prev = exists(lockPath) ? json(lockPath) : null;

if (process.argv.includes("--write")) {
  const cur = compute(prev);
  writeFileSync(lockPath, JSON.stringify(cur, null, 2) + "\n");
  console.log(`Wrote ${lockPath} (runtime ${cur.runtime}, ${Object.keys(cur.packages).length} native packages).`);
  process.exit(0);
}

if (!prev) {
  console.log("::error::app/native-inputs.lock is missing. Run: node tools/ci/check-runtime.mjs --write");
  process.exit(1);
}
const cur = compute(prev);
const bad = []; // existing native code changed: needs a runtime bump
const add = []; // additions or source-only change: lock refresh only
if (cur.expoSdk !== prev.expoSdk) bad.push(`Expo SDK changed ${prev.expoSdk} -> ${cur.expoSdk}.`);
if (cur.reactNative !== prev.reactNative) bad.push(`react-native changed ${prev.reactNative} -> ${cur.reactNative}.`);
if (JSON.stringify(cur.reanimatedStaticFlags) !== JSON.stringify(prev.reanimatedStaticFlags)) bad.push("Reanimated static feature flags changed.");
for (const [n, v] of Object.entries(prev.packages)) {
  if (!(n in cur.packages)) bad.push(`Native package ${n} was removed.`);
  else if (cur.packages[n] !== v) bad.push(`Native package ${n} changed ${v} -> ${cur.packages[n]}.`);
}
for (const n of Object.keys(cur.packages)) if (!(n in prev.packages)) add.push(`New native package ${n}@${cur.packages[n]}.`);
for (const [m, fns] of Object.entries(prev.modules)) {
  if (!(m in cur.modules)) { bad.push(`Local module ${m} was removed.`); continue; }
  for (const f of fns) if (!cur.modules[m].includes(f)) bad.push(`Local module ${m} lost function ${f} (removed or renamed).`);
}
for (const [m, fns] of Object.entries(cur.modules)) {
  const old = prev.modules[m] ?? [];
  for (const f of fns) if (!old.includes(f)) add.push(`Local module ${m} gained function ${f}.`);
  if (!(m in prev.modules)) add.push(`New local module ${m}.`);
}
const bumped = cur.runtime !== prev.runtime;
const srcChanged = cur.sourcesSha256 !== prev.sourcesSha256;

if (bad.length && !bumped) {
  for (const b of bad) console.log(`::error::${b} Change runtimeVersion in app/app.config.ts, then run: node tools/ci/check-runtime.mjs --write`);
  process.exit(1);
}
if (bad.length || add.length || srcChanged || bumped) {
  const why = [...(bumped ? [`Runtime changed ${prev.runtime} -> ${cur.runtime}.`] : []), ...add];
  console.log(`::warning::native-inputs.lock is out of date (${why.join(" ") || "native sources changed"}). No runtime bump is needed for this. Run: node tools/ci/check-runtime.mjs --write`);
  process.exit(1);
}
console.log("Runtime inputs match the lock.");
