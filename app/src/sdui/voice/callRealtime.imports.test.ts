// node --test --experimental-strip-types src/sdui/voice/callRealtime.imports.test.ts
//
// THE LIVE CLIENT IS NEVER IMPORTED, ANYWHERE. The same JavaScript reaches binaries made before react-native-webrtc was linked, and
// a static import of a native module that is not there throws while the bundle is loading — the app would not start at all. So it is
// named in one require per owner, inside try/catch, and nowhere else.
//
// There are two owners, and there should never be a third without a reason written here:
//   voice/callRealtime.ts  Plan Ease's call as one live conversation, behind the binary's own `realtimeCall` feature.
//   sdui/call/session.ts   one of our own calls (the `call` block; TAILZU-BACKEND/docs/rooms.md). It needs no binary feature: a
//                          binary without the client loads null, and then the block is never registered, so the server never sends
//                          a screen that needs it (blocks/registry.ts).
//
// This walks the real source tree, so a new file that imports it fails here rather than on somebody's phone.

import test from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT = "react-native-webrtc";
/** The files allowed to name it (their paths, as walked). */
const REALTIME = join("src", "sdui", "voice", "callRealtime.ts");
const CALL_BLOCK = join("src", "sdui", "call", "session.ts");
const ALLOWED = [REALTIME, CALL_BLOCK];
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
  for (const a of ALLOWED) assert.ok(files.includes(a), `${a} not walked`);
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

test("only its two owners name it in code; everywhere else it is a comment at most", () => {
  const bad: string[] = [];
  for (const path of files) {
    if (ALLOWED.includes(path) || path.endsWith("callRealtime.imports.test.ts")) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.includes(CLIENT) && !isComment(line)) bad.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test("each owner has one require, inside try/catch", () => {
  for (const path of ALLOWED) {
    const src = readFileSync(path, "utf8");
    const requires = src.match(/require\(\s*["']react-native-webrtc["']\s*\)/g) ?? [];
    assert.strictEqual(requires.length, 1, `${path}: one require`);
    // The require's own function, and anything it throws is caught.
    const at = src.indexOf(requires[0]!);
    const before = src.slice(0, at);
    const open = before.lastIndexOf("try {");
    assert.ok(open > 0 && src.indexOf("} catch", at) > at, `${path}: the require is not inside try/catch`);
  }
});

test("Plan Ease's own require is behind the binary's feature", () => {
  const src = readFileSync(REALTIME, "utf8");
  const loader = src.slice(src.indexOf("function loadWebrtc"), src.indexOf("function modelName"));
  assert.ok(loader.includes('hasBinaryFeature("realtimeCall")'), "the require is not behind the binary's feature");
  assert.ok(loader.includes("try {") && loader.includes("} catch"), "the require is not inside try/catch");
});

test("the call block promises nothing on a binary without the client", () => {
  // Its gate is the load itself: no client, no block, so the server never sends a screen that needs it.
  const src = readFileSync(CALL_BLOCK, "utf8");
  assert.match(src, /export const callAvailable = \(\): boolean => loadWebrtc\(\) !== null;/);
  const registry = readFileSync(join("src", "sdui", "blocks", "registry.ts"), "utf8");
  assert.match(registry, /if \(callAvailable\(\)\) turnOn\("call"/);
});
