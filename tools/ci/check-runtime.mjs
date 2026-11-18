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

/**
 * The Android health build switch, per EAS build profile (app/eas.json's env).
 * It decides whether Health Connect is in the Android binary at all, which no
 * package version or module function shows, so the lock records it: a profile
 * flipped without the lock being refreshed is caught here, and anyone reading
 * the lock can see which profile ships health. It needs no runtime bump — the
 * modules are reached through src/device/natives.ts, so an older binary finds
 * nothing and declares nothing.
 */
function androidSwitch(name) {
  const path = join(app, "eas.json");
  if (!exists(path)) return {};
  const profiles = json(path).build ?? {};
  const out = {};
  for (const profile of Object.keys(profiles).sort()) {
    const value = (profiles[profile]?.env?.[name] ?? "").trim().toLowerCase();
    out[profile] = value === "on" ? "on" : "off";
  }
  return out;
}

const androidHealth = () => androidSwitch("TULMI_ANDROID_HEALTH");

/**
 * The Android SLEEP build switch, per profile (perms2/SPEC.md 10.1). Sleep is
 * its own line on Play's Health Connect form with its own answer, so it has its
 * own switch: steps and exercise can ship the day they are approved without
 * waiting for sleep, and sleep the day it is without holding steps back.
 *
 * It only means anything with TULMI_ANDROID_HEALTH on — app.config.ts ANDs the
 * two — so a profile with sleep on and health off is a mistake, not a shape:
 * whoever wrote it meant to ship sleep and would get a build with neither.
 * That is refused below, in --write as well as in a check, so the lock can never
 * record it.
 */
const androidHealthSleep = () => androidSwitch("TULMI_ANDROID_HEALTH_SLEEP");

/**
 * The three 8.9.1 Android switches, per profile (perms2/SPEC.md 2, 5, 7). Each
 * decides whether a permission is in the merged manifest and, for motion and
 * arrival, whether Play services location is in the binary at all — none of which
 * a package version or a module function shows, so the lock records them. A
 * profile flipped without the lock being refreshed is caught here.
 */
const androidCalendar = () => androidSwitch("TULMI_ANDROID_CALENDAR");
const androidMotion = () => androidSwitch("TULMI_ANDROID_MOTION");
const androidArrival = () => androidSwitch("TULMI_ANDROID_ARRIVAL");

// ARRIVAL IS NO LONGER REFUSED OUTSIDE n0 (8.9.1, Android halves on). This file
// used to refuse TULMI_ANDROID_ARRIVAL in any profile but the proof build, while
// the three Android halves shipped off. They now ship ON in `preview` and
// `production`, so the refusal is gone and every profile may carry arrival.
//
// WHAT HAS NOT CHANGED, AND IS NOW THE OWNER'S STEP: a release carrying
// ACCESS_BACKGROUND_LOCATION is refused by Play unless the background-location
// declaration has been APPROVED, with the demo video, in Play Console. The words
// of that declaration are in backend docs/owner-8.9.1.md 6.1, and its video's
// script is 6.2 — that is the owner checklist for both. Nothing in
// this repository can see whether Play has answered, so no check here can stand
// in for it: do not upload the Android release until it has. `n0` is still the
// proof profile the video is recorded on.

/** Profiles that ask for sleep without health. Refused: see androidHealthSleep. */
function sleepWithoutHealth(cur) {
  const health = cur.androidHealth ?? {};
  return Object.entries(cur.androidHealthSleep ?? {})
    .filter(([profile, value]) => value === "on" && health[profile] !== "on")
    .map(([profile]) => profile);
}

/**
 * `throughNatives`: the native packages and local modules that came AFTER the
 * binary people are running, so an older binary does not have them.
 *
 * It is hand-kept, because nothing in the tree can tell them from the packages
 * that shipped with that binary — which is the whole point. A top-level import
 * of one of these would crash the running build over the air, so they may only
 * be reached through app/src/device/natives.ts, which asks for them by name and
 * handles a missing module (perms/SPEC.md rule 6, 5.2; pure §2.11). The scan in
 * src/device/natives.test.ts reads this field and keeps those names out of the
 * list it treats as safe to import anywhere. `--write` carries it over
 * untouched; add a name here by hand when a new package or module lands, and
 * clear the list when the runtime changes, because every binary then has them.
 */
function checkThroughNatives(cur) {
  const problems = [];
  for (const name of cur.throughNatives ?? []) {
    if (!(name in cur.packages) && !(name in cur.modules)) {
      problems.push(`${name} is in throughNatives but is neither an installed native package nor a local module.`);
    }
  }
  return problems;
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
    androidHealth: androidHealth(),
    androidHealthSleep: androidHealthSleep(),
    androidCalendar: androidCalendar(),
    androidMotion: androidMotion(),
    androidArrival: androidArrival(),
    // Hand-kept, so --write carries it over instead of rebuilding it: nothing
    // in the tree tells an addition the running binary does not have from a
    // package that shipped with it. See the field's note below.
    throughNatives: prev?.throughNatives ?? [],
    packages,
    modules,
    sourcesSha256: h.digest("hex"),
  };
}

const prev = exists(lockPath) ? json(lockPath) : null;

/** Refused in --write as well as in a check, so the lock can never record it. */
function refuseSleepWithoutHealth(cur) {
  const wrong = sleepWithoutHealth(cur);
  if (!wrong.length) return;
  for (const profile of wrong) {
    console.log(
      `::error::app/eas.json's "${profile}" profile sets TULMI_ANDROID_HEALTH_SLEEP on with ` +
        "TULMI_ANDROID_HEALTH off. Sleep comes from Health Connect, so that build would carry neither. " +
        "Turn health on for that profile, or sleep off."
    );
  }
  process.exit(1);
}

if (process.argv.includes("--write")) {
  const cur = compute(prev);
  refuseSleepWithoutHealth(cur);
  writeFileSync(lockPath, JSON.stringify(cur, null, 2) + "\n");
  console.log(`Wrote ${lockPath} (runtime ${cur.runtime}, ${Object.keys(cur.packages).length} native packages).`);
  process.exit(0);
}

if (!prev) {
  console.log("::error::app/native-inputs.lock is missing. Run: node tools/ci/check-runtime.mjs --write");
  process.exit(1);
}
const cur = compute(prev);
refuseSleepWithoutHealth(cur);
const bad = []; // existing native code changed: needs a runtime bump
const add = []; // additions or source-only change: lock refresh only
if (cur.expoSdk !== prev.expoSdk) bad.push(`Expo SDK changed ${prev.expoSdk} -> ${cur.expoSdk}.`);
if (cur.reactNative !== prev.reactNative) bad.push(`react-native changed ${prev.reactNative} -> ${cur.reactNative}.`);
if (JSON.stringify(cur.reanimatedStaticFlags) !== JSON.stringify(prev.reanimatedStaticFlags)) bad.push("Reanimated static feature flags changed.");
if (JSON.stringify(cur.androidHealth) !== JSON.stringify(prev.androidHealth ?? {})) {
  add.push(`The Android health build switch changed: ${JSON.stringify(cur.androidHealth)}.`);
}
if (JSON.stringify(cur.androidHealthSleep) !== JSON.stringify(prev.androidHealthSleep ?? {})) {
  add.push(`The Android sleep build switch changed: ${JSON.stringify(cur.androidHealthSleep)}.`);
}
// The three 8.9.1 Android switches, each on its own: a flip is an addition (the
// code is reached through src/device/natives.ts, so an older binary finds
// nothing), and a lock refresh is all it needs.
for (const k of ["androidCalendar", "androidMotion", "androidArrival"]) {
  if (JSON.stringify(cur[k]) !== JSON.stringify(prev[k] ?? {})) {
    add.push(`The ${k} build switch changed: ${JSON.stringify(cur[k])}.`);
  }
}
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
const stale = checkThroughNatives(cur);
if (stale.length) {
  for (const p of stale) console.log(`::error::${p} Fix the list in app/native-inputs.lock.`);
  process.exit(1);
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
