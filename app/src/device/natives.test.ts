// Fails when src/ imports a native package that is not in native-inputs.lock
// anywhere except src/device/natives.ts (see the rule there).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const app = process.cwd();
const src = join(app, "src");

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
  }
  return out;
}

function pkgOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isNative(name: string): boolean {
  const dir = join(app, "node_modules", name);
  if (!existsSync(dir)) return false;
  return (
    existsSync(join(dir, "ios")) ||
    existsSync(join(dir, "android")) ||
    existsSync(join(dir, "expo-module.config.json")) ||
    readdirSync(dir).some((f) => f.endsWith(".podspec"))
  );
}

test("src only imports native packages that are in native-inputs.lock", (t) => {
  if (!existsSync(join(app, "node_modules"))) return t.skip("node_modules is not installed");
  const lock = JSON.parse(readFileSync(join(app, "native-inputs.lock"), "utf8"));
  const known = new Set(Object.keys(lock.packages));
  const gate = join("src", "device", "natives.ts");
  const bad: string[] = [];
  for (const f of files(src)) {
    const r = relative(app, f);
    if (r === gate) continue;
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)) {
      const name = pkgOf(m[1]);
      if (name && !known.has(name) && isNative(name)) bad.push(`${r.split(sep).join("/")} imports ${name}`);
    }
  }
  assert.deepEqual(bad, [], "native packages added after the lock must go through src/device/natives.ts");
});
