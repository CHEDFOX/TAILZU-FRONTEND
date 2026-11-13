// node --test --experimental-strip-types src/sdui/voice/callRealtime.imports.test.ts
//
// THE LIVE CALL'S CLIENT IS NEVER IMPORTED, ANYWHERE. The same JavaScript reaches binaries made before react-native-webrtc was
// linked, and a static import of a native module that is not there throws while the bundle is loading — the app would not start
// at all. So the client is named in exactly one file, in one require, behind the binary's own feature and inside try/catch.
//
// This walks the real source tree, so a new file that imports it fails here rather than on somebody's phone.

import test from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT = "react-native-webrtc";
/** The one file allowed to name it (its path, as walked). */
const ALLOWED = join("src", "sdui", "voice", "callRealtime.ts");
const ROOTS = ["src", "modules"];
const SKIP = new Set(["node_modules", "build", "ios", "android", "apple", "macos"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));

test("the source tree is there to search (a test that finds no files proves nothing)", () => {
  assert.ok(files.length > 100, `only ${files.length} files walked`);
  assert.ok(files.includes(ALLOWED), `${ALLOWED} not walked`);
});

test("no file imports the live call's client", () => {
  const bad: string[] = [];
  for (const path of files) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      // An import or export of the module itself, static or dynamic — the three ways a bundle would load it at startup.
      if (/^\s*(import|export)\b[^\n]*["']react-native-webrtc["']/.test(line)) bad.push(`${path}: ${line.trim()}`);
      if (/\bimport\s*\(\s*["']react-native-webrtc["']/.test(line)) bad.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

/** A line that only talks about the client (a note to a reader) is fine; a line of code that names it is not. */
const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line) || /(\/\/|\/\*|\*\s).*react-native-webrtc/.test(line);

test("only callRealtime.ts names it in code; everywhere else it is a comment at most", () => {
  const bad: string[] = [];
  for (const path of files) {
    if (path === ALLOWED || path.endsWith("callRealtime.imports.test.ts")) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.includes(CLIENT) && !isComment(line)) bad.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test("the one require is behind the binary's feature and inside try/catch", () => {
  const src = readFileSync(ALLOWED, "utf8");
  const requires = src.match(/require\(\s*["']react-native-webrtc["']\s*\)/g) ?? [];
  assert.strictEqual(requires.length, 1);
  // The require is reached only after the binary says it has the client, and anything it throws is caught.
  const loader = src.slice(src.indexOf("function loadWebrtc"), src.indexOf("function modelName"));
  assert.ok(loader.includes('hasBinaryFeature("realtimeCall")'), "the require is not behind the binary's feature");
  assert.ok(loader.includes("try {") && loader.includes("} catch"), "the require is not inside try/catch");
  assert.ok(loader.includes(requires[0]), "the require moved out of loadWebrtc");
});
