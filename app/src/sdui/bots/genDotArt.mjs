// node src/sdui/bots/genDotArt.mjs [path/to/TAILZU-DESKTOP/dotArt.js]
//
// The window's copy of the dot art's physics (TAILZU-DESKTOP/dotArt.js) is GENERATED from this repo's dotArtCore.ts, so a picture
// moves the same on both, and the two can only differ by a missed regeneration, which the tests catch:
//   - the header carries sha256 of dotArtCore.ts; dotArtCore.test.ts compares it when the window's repo is checked out beside;
//   - the header carries sha256 of the generated body; the window's dotArt.test.js recomputes it, so a hand edit fails there.
// TypeScript's own transpiler strips the types; the module becomes the window's usual UMD (window.TailzuDotArt, or module.exports
// for node --test), as genDesktop.mjs does for the tiles' core.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = join(HERE, "dotArtCore.ts");
export const DEFAULT_OUT = resolve(HERE, "../../../../../TAILZU-DESKTOP/dotArt.js");

export const sha = (s) => createHash("sha256").update(s).digest("hex");

/** The header's hashes, read back from a generated file. */
export function hashesOf(text) {
  const src = /dotArtCore\.ts sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const body = /body sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const at = text.indexOf("\n(function (root, factory)");
  return { src, body, actualBody: at >= 0 ? sha(text.slice(at + 1)) : null };
}

export const readSource = () => readFileSync(SOURCE, "utf8");

export function build(source) {
  const ts = createRequire(join(HERE, "../../../package.json"))("typescript");
  const names = [];
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText;
  const body = js
    .replace(/^export (class|function|const|let) ([A-Za-z0-9_]+)/gm, (_m, kw, name) => { names.push(name); return `${kw} ${name}`; })
    .replace(/^export \{\};?\s*$/gm, "")
    .trimEnd();
  if (/^(export|import) /m.test(body)) throw new Error("genDotArt: an import or export it cannot rewrite is left in the source");
  const umd = [
    "(function (root, factory) {",
    "  const api = factory();",
    '  if (typeof module === "object" && module && module.exports) module.exports = api;',
    "  else root.TailzuDotArt = api;",
    '})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
    '  "use strict";',
    body.split("\n").map((l) => (l ? "  " + l : l)).join("\n"),
    `  return { ${names.join(", ")} };`,
    "});",
    "",
  ].join("\n");
  const header = [
    "// GENERATED: do not edit. Dot art that obeys physics: the rules of the DotArt node, shared with the phone.",
    "// Source: TAILZU-FRONTEND/app/src/sdui/bots/dotArtCore.ts; regenerate with `node src/sdui/bots/genDotArt.mjs` there.",
    `// dotArtCore.ts sha256 ${sha(source)}`,
    `// body sha256 ${sha(umd)}`,
    "",
  ].join("\n");
  return header + umd;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
  writeFileSync(out, build(readSource()));
  console.log(`genDotArt: wrote ${out}`);
}
