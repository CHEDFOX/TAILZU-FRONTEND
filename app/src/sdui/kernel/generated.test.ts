// node --test
//
// The two generated copies of the kernel (the window's and the server's) are this folder, unchanged. When the
// sibling repos are checked out beside this one, a missed regeneration fails here; when they are not, the parts
// that need no sibling still run.
import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error a plain .mjs script, no types
import { DESKTOP_OUT, SERVER_OUT, SOURCE_NAMES, SOURCES, build, hashesOf, readSources, sha } from "./genKernel.mjs";

const sources: string[] = readSources();
const names: string[] = SOURCE_NAMES;

test("every source is listed, in an order where a file only reads the ones above it", () => {
  assert.strictEqual(sources.length, names.length);
  assert.deepStrictEqual(names.slice(0, 3), ["limits.ts", "blocks.ts", "paths.ts"]);
  for (let i = 0; i < names.length; i += 1) {
    const text = sources[i]!;
    for (const m of text.matchAll(/from\s+"\.\/([\w.]+\.ts)";/g)) {
      const at = names.indexOf(m[1]!);
      assert.ok(at >= 0, `${names[i]} imports ${m[1]}, which the generator does not carry`);
      assert.ok(at < i, `${names[i]} imports ${m[1]}, which comes after it`);
    }
  }
  for (const p of SOURCES as string[]) assert.ok(existsSync(p), p);
});

test("generating twice gives the same bytes, so a rebuild is never a diff", () => {
  const a = build(sources);
  const b = build(readSources());
  assert.strictEqual(a, b);
  assert.ok(a.includes("root.TailzuKernel = api"), "the window gets it as a UMD, like botTiles.js");
  assert.ok(a.includes("module.exports = api"), "node and the server require it");
});

test("the header's body hash is the body, so a hand edit to a copy cannot hide", () => {
  const text = build(sources);
  const h = hashesOf(text);
  assert.strictEqual(h.actualBody, h.body);
  for (const n of names) assert.strictEqual(h.src[n], sha(sources[names.indexOf(n)]!), n);
  const edited = text.replace("return { LIMITS", "return { /* hand edit */ LIMITS");
  assert.notStrictEqual(hashesOf(edited).actualBody, hashesOf(edited).body);
});

test("two files may not declare the same top-level name, because the copy is one scope", () => {
  const clash = [...sources, "export const LIMITS = 1;\n"];
  assert.throws(() => build(clash), /declare "LIMITS"/);
});

for (const [what, out] of [["the window's", DESKTOP_OUT], ["the server's", SERVER_OUT]] as const) {
  test(`${what} copy is this folder, regenerated`, { skip: existsSync(out) ? false : `${out} is not checked out here` }, () => {
    const text = readFileSync(out, "utf8");
    const h = hashesOf(text);
    assert.strictEqual(h.actualBody, h.body, `${out} was edited by hand: run \`node src/sdui/kernel/genKernel.mjs\``);
    for (const n of names) {
      assert.strictEqual(h.src[n], sha(sources[names.indexOf(n)]!), `${n} changed: regenerate ${out}`);
    }
    assert.strictEqual(text, build(sources), "byte for byte what this folder generates");
  });
}
