// node src/botTiles/genDesktop.mjs [path/to/TAILZU-DESKTOP/botTiles.js]
// node src/botTiles/genDesktop.mjs --server [path/to/TAILZU-BACKEND/shared/bots/engines/f2.cjs]
//
// The window's copy of the living tiles' core (TAILZU-DESKTOP/botTiles.js) and the server's checking engine
// (TAILZU-BACKEND/shared/bots/engines/f2.cjs) are GENERATED from the phone's sources, so the three can only differ
// by a missed regeneration, and every repo's tests catch that:
//   - the header carries sha256 of each source (scene.ts, then core.ts); this repo's core.test.ts compares them
//     with the sources, when the other repo is checked out beside this one;
//   - the header carries sha256 of the generated body (the desktop's botTiles.test.js recomputes it, so a hand
//     edit to the generated file fails there).
// Two sources now: scene.ts (the format-2 animation language) comes first, because core.ts reads it. core.ts's
// import of it is dropped, since in the generated module they are one scope.
// TypeScript's own transpiler strips the types; the module becomes the window's usual UMD (window.TailzuBotTiles,
// or module.exports for node --test and the server's createRequire).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** In order: the scene engine, then the core that reads it. */
export const SOURCES = [join(HERE, "scene.ts"), join(HERE, "core.ts")];
export const SOURCE = SOURCES[SOURCES.length - 1];
export const DEFAULT_OUT = resolve(HERE, "../../../../TAILZU-DESKTOP/botTiles.js");
export const SERVER_OUT = resolve(HERE, "../../../../TAILZU-BACKEND/shared/bots/engines/f2.cjs");

export const sha = (s) => createHash("sha256").update(s).digest("hex");

/** The header's hashes, read back from a generated file: one per source, and the body's. */
export function hashesOf(text) {
  const src = /core\.ts sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const scene = /scene\.ts sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const body = /body sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const at = text.indexOf("\n(function (root, factory)");
  return { src, scene, body, actualBody: at >= 0 ? sha(text.slice(at + 1)) : null };
}

/** Read every source, in order. */
export function readSources() {
  return SOURCES.map((p) => readFileSync(p, "utf8"));
}

/** One source's own imports of another are dropped: in the generated module they share one scope. */
function unimport(source) {
  return source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/scene\.ts";\n/m, "")
    .replace(/^export\s*(type\s*)?\{[^}]*\}\s*from\s*"\.\/scene\.ts";\n/gm, "");
}

export function build(sources) {
  const list = Array.isArray(sources) ? sources : [sources];
  const ts = createRequire(join(HERE, "../../package.json"))("typescript");
  const names = [];
  const parts = list.map((source) => {
    const js = ts.transpileModule(unimport(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
    }).outputText;
    const body = js
      .replace(/^export (class|function|const|let) ([A-Za-z0-9_]+)/gm, (_m, kw, name) => { names.push(name); return `${kw} ${name}`; })
      .replace(/^export \{\};?\s*$/gm, "")
      .trimEnd();
    if (/^export /m.test(body)) throw new Error("genDesktop: an export it cannot rewrite is left in a source");
    return body;
  });
  const body = parts.join("\n\n");
  const umd = [
    "(function (root, factory) {",
    "  const api = factory();",
    '  if (typeof module === "object" && module && module.exports) module.exports = api;',
    "  else root.TailzuBotTiles = api;",
    '})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
    '  "use strict";',
    body.split("\n").map((l) => (l ? "  " + l : l)).join("\n"),
    `  return { ${names.join(", ")} };`,
    "});",
    "",
  ].join("\n");
  const header = [
    "// GENERATED: do not edit. The living bot tiles' physics and drawing, shared with the phone and the server.",
    "// Source: TAILZU-FRONTEND/app/src/botTiles/{scene,core}.ts; regenerate with `node src/botTiles/genDesktop.mjs` there.",
    `// scene.ts sha256 ${sha(list[0])}`,
    `// core.ts sha256 ${sha(list[list.length - 1])}`,
    `// body sha256 ${sha(umd)}`,
    "",
  ].join("\n");
  return header + umd;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const server = args[0] === "--server";
  const rest = server ? args.slice(1) : args;
  const out = rest[0] ? resolve(rest[0]) : server ? SERVER_OUT : DEFAULT_OUT;
  writeFileSync(out, build(readSources()));
  console.log(`genDesktop: wrote ${out}`);
}
