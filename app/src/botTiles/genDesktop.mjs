// node src/botTiles/genDesktop.mjs [path/to/TAILZU-DESKTOP/botTiles.js]
//
// The window's copy of the living tiles' core (TAILZU-DESKTOP/botTiles.js) is GENERATED from core.ts, so the two
// can only differ by a missed regeneration, and both repos' tests catch that:
//   - the header carries sha256 of core.ts (this repo's core.test.ts compares it with the source, when the desktop
//     repo is checked out beside this one);
//   - the header carries sha256 of the generated body (the desktop's botTiles.test.js recomputes it, so a hand edit
//     to the generated file fails there).
// TypeScript's own transpiler strips the types; the module becomes the window's usual UMD (window.TailzuBotTiles,
// or module.exports for node --test).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = join(HERE, "core.ts");
export const DEFAULT_OUT = resolve(HERE, "../../../../TAILZU-DESKTOP/botTiles.js");

export const sha = (s) => createHash("sha256").update(s).digest("hex");

/** The header's two hashes, read back from a generated file. */
export function hashesOf(text) {
  const src = /core\.ts sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const body = /body sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const at = text.indexOf("\n(function (root, factory)");
  return { src, body, actualBody: at >= 0 ? sha(text.slice(at + 1)) : null };
}

export function build(source) {
  const ts = createRequire(join(HERE, "../../package.json"))("typescript");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText;
  const names = [];
  const body = js
    .replace(/^export (class|function|const|let) ([A-Za-z0-9_]+)/gm, (_m, kw, name) => { names.push(name); return `${kw} ${name}`; })
    .replace(/^export \{\};?\s*$/gm, "")
    .trimEnd();
  if (/^export /m.test(body)) throw new Error("genDesktop: an export it cannot rewrite is left in core.ts");
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
    "// GENERATED: do not edit. The living bot tiles' physics and drawing, shared with the phone.",
    "// Source: TAILZU-FRONTEND/app/src/botTiles/core.ts; regenerate with `node src/botTiles/genDesktop.mjs` there.",
    `// core.ts sha256 ${sha(source)}`,
    `// body sha256 ${sha(umd)}`,
    "",
  ].join("\n");
  return header + umd;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
  writeFileSync(out, build(readFileSync(SOURCE, "utf8")));
  console.log(`genDesktop: wrote ${out}`);
}
