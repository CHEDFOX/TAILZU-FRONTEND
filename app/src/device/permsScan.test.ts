// node --test --experimental-strip-types src/device/permsScan.test.ts
//
// The scans for location, contacts and health (perms/SPEC.md 5.2, 6.5 item 8, 8):
//  - the two health packages, the HealthKit core and the TulmiPerms module are named only in src/device/natives.ts;
//  - src never calls HealthKit's background APIs (a cold launch must register no observer query);
//  - the three actions never put a coordinate or a health number in state.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CORE_ACTIONS } from "../sdui/registry.ts";

const app = process.cwd();

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => relative(app, f).split(sep).join("/");
const src = files(join(app, "src")).map((f) => ({ r: rel(f), text: readFileSync(f, "utf8") }));

test("the health packages and TulmiPerms are reached only through natives.ts", () => {
  const names = ["@kingstinct/react-native-healthkit", "@react-native-healthkit/core", "react-native-health-connect", "TulmiPerms", "tulmi-perms"];
  const bad: string[] = [];
  for (const f of src) {
    if (f.r === "src/device/natives.ts") continue;
    const code = noComments(f.text);
    for (const n of names) if (code.includes(n)) bad.push(`${f.r} names ${n}`);
  }
  assert.deepEqual(bad, []);
});

test("no HealthKit background API is called anywhere in src", () => {
  const apis = ["configureBackgroundTypes", "enableBackgroundDelivery", "disableBackgroundDelivery", "disableAllBackgroundDelivery", "subscribeToChanges", "subscribeToQuantitySamples", "subscribeToCategorySamples", "subscribeToObserverQuery"];
  const bad: string[] = [];
  for (const f of src) {
    const code = noComments(f.text);
    for (const a of apis) if (code.includes(a)) bad.push(`${f.r} uses ${a}`);
  }
  assert.deepEqual(bad, []);
});

test("natives.ts requires each health package only on its own platform, after the presence check", () => {
  const t = readFileSync(join(app, "src/device/natives.ts"), "utf8");
  assert.match(t, /if \(platform !== "ios"\) return null;[\s\S]*?hasHybridObject[\s\S]*?require\("@kingstinct\/react-native-healthkit"\)/);
  assert.match(t, /if \(platform !== "android"\) return null;[\s\S]*?TurboModuleRegistry\.get\("HealthConnect"\)[\s\S]*?require\("react-native-health-connect"\)/);
  assert.ok(!/^import .*(healthkit|health-connect)/m.test(t), "no top-level import of a health package");
  // the require sits inside a load callback handed to the pure helper, which checks presence first
  assert.match(t, /healthKitFrom<[^>]*>\(/);
  assert.match(t, /healthConnectFrom<[^>]*>\(/);
});

test("the three actions are registered", () => {
  for (const a of ["location.area", "contact.pick", "health.sync"]) assert.ok((CORE_ACTIONS as readonly string[]).includes(a), a);
});

function block(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${from} block`);
  return text.slice(a, b);
}

test("the actions write only the area's words and the one email to state, and health writes nothing", () => {
  const t = readFileSync(join(app, "src/sdui/actions.ts"), "utf8");
  const loc = block(t, 'case "location.area": {', 'case "contact.pick": {');
  assert.deepEqual([...loc.matchAll(/store\.set\(([^)]*)\)/g)].map((m) => m[1]), ["action.assignTo, r.label"]);
  const con = block(t, 'case "contact.pick": {', 'case "health.sync": {');
  assert.deepEqual([...con.matchAll(/store\.set\(([^)]*)\)/g)].map((m) => m[1]), ["action.assignTo, r.email"]);
  const hea = block(t, 'case "health.sync": {', 'case "biometricPrompt": {');
  assert.ok(!/store\.set|setState|assignTo/.test(hea), "health.sync writes nothing to state");
  // the analytics call for each carries the outcome only
  for (const b of [loc, con, hea]) for (const m of b.matchAll(/trackEvent\([^)]*\)/g)) assert.match(m[0], /\{ outcome: r\.outcome \}\)$/);
});

test("location in the permission actions is real, not the old 'treat as denied'", () => {
  const t = readFileSync(join(app, "src/sdui/actions.ts"), "utf8");
  assert.ok(!t.includes("expo-location not installed"));
  assert.match(t, /case "location": granted = await locationGranted\(\)/);
  assert.match(t, /locationRequest\(\)/);
});

test("no value is logged by the three paths", () => {
  for (const f of ["src/device/locate.ts", "src/device/locateCore.ts", "src/device/health.ts", "src/device/healthCore.ts", "src/device/contact.ts", "src/device/contactCore.ts"]) {
    assert.ok(!/console\.(log|warn|error|info|debug)/.test(noComments(readFileSync(join(app, f), "utf8"))), f);
  }
});
