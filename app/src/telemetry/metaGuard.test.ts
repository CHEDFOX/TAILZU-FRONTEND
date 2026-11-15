// node --test --experimental-strip-types src/telemetry/metaGuard.test.ts
//
// THE TWO NATIVE PACKAGES THAT LEFT THE IPHONE BINARY STAY OUT OF REACH OVER THE AIR.
//
// 8.9.1 keeps Meta's SDK and expo-tracking-transparency out of the iOS project (package.json's
// expo.autolinking.ios.exclude, react-native.config.js, plugins/withNoMetaIos.js), under the SAME runtime as the
// installed 8.9 iPhones, which were built WITH both. tools/ci/check-runtime.mjs cannot see that: it builds its
// package list from node_modules and package-lock.json, where both are still installed, so excluding one from a
// platform is not "a native package was removed" to it and asks for no runtime bump. src/device/natives.test.ts
// only refuses packages that are missing from the lock, and these are in it.
//
// So nothing else catches a top-level `import ... from "expo-tracking-transparency"` added later: it would pass
// every check and crash every 8.9.1 iPhone at launch, over the air. This is that check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const app = process.cwd();
const src = join(app, "src");
/** The one file allowed to name an excluded package, and only lazily, inside a try/catch (see its own note). */
const GATE = join("src", "telemetry", "meta.ts");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const excluded: string[] = JSON.parse(readFileSync(join(app, "package.json"), "utf8"))
  .expo?.autolinking?.ios?.exclude ?? [];

test("the iOS-excluded native packages are named nowhere in src but meta.ts", () => {
  assert.ok(excluded.length, "package.json must still list expo.autolinking.ios.exclude");
  const bad: string[] = [];
  for (const f of files(src)) {
    const r = relative(app, f);
    if (r === GATE) continue;
    const text = readFileSync(f, "utf8");
    for (const name of excluded) {
      if (text.includes(`"${name}"`)) bad.push(`${r.split(sep).join("/")} names ${name}`);
    }
  }
  assert.deepEqual(bad, [], "a package that is not in the iPhone binary may only be reached from src/telemetry/meta.ts");
});

test("meta.ts never reaches for the tracking prompt, and the iPhone leaves before the SDK is required", () => {
  const meta = readFileSync(join(app, GATE), "utf8");
  // App Tracking Transparency is not in the binary at all: no call to it may be in the bundle either.
  assert.ok(!meta.includes('"expo-tracking-transparency"'), "meta.ts must not reach for expo-tracking-transparency");
  // AND THE ORDER INSIDE initMeta MATTERS: the iPhone returns before load(), so the require of Meta's SDK — which
  // is not in that binary — is never reached there.
  const init = meta.slice(meta.indexOf("export function initMeta"));
  const leaves = init.indexOf('if (Platform.OS === "ios") return;');
  const requires = init.indexOf("load()");
  assert.ok(leaves >= 0, "initMeta must return on iOS");
  assert.ok(requires >= 0, "initMeta must load the SDK through load()");
  assert.ok(leaves < requires, "the iOS return must come before load()");
});
