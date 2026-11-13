// node src/sdui/kernel/genKernel.mjs                 writes both copies (the window's and the server's)
// node src/sdui/kernel/genKernel.mjs --desktop [out]  only TAILZU-DESKTOP/src/app/sdui/kernel.js
// node src/sdui/kernel/genKernel.mjs --server  [out]  only TAILZU-BACKEND/shared/sdui/kernel.cjs
//
// The kernel is written once, here, and the window's copy and the server's are GENERATED from it, so the three can
// only differ by a missed regeneration — and every repo's tests catch that:
//   - the header carries sha256 of each source file in order; this repo's generated.test.ts compares them with the
//     sources, when the sibling repos are checked out beside this one;
//   - the header carries sha256 of the generated body, which the desktop's kernel.test.js and the server's
//     sdui-kernel.test.ts recompute, so a hand edit to a generated file fails there.
//
// The same scheme as src/botTiles/genDesktop.mjs, and the same transpiler (esbuild is not in node_modules, and
// TypeScript's own one is enough: it only has to strip the types). The sources import each other with "./x.ts";
// in the generated module they are one scope, so those imports are dropped and the top-level names must be unique
// across the files — this script refuses a duplicate rather than let one file quietly shadow another.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** In dependency order: a file may only read names from the files above it. index.ts is for the app, not for this. */
export const SOURCE_NAMES = ["limits.ts", "blocks.ts", "paths.ts", "coreGrammar.ts", "format.ts", "expr.ts", "text.ts", "defs.ts", "rules.ts"];
export const SOURCES = SOURCE_NAMES.map((n) => join(HERE, n));
export const DESKTOP_OUT = resolve(HERE, "../../../../../TAILZU-DESKTOP/src/app/sdui/kernel.js");
export const SERVER_OUT = resolve(HERE, "../../../../../TAILZU-BACKEND/shared/sdui/kernel.cjs");

export const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Read every source, in order. */
export function readSources() {
  return SOURCES.map((p) => readFileSync(p, "utf8"));
}

/** The header's hashes, read back from a generated file: one per source, and the body's. */
export function hashesOf(text) {
  const src = {};
  for (const name of SOURCE_NAMES) {
    const m = new RegExp(`${name.replace(".", "\\.")} sha256 ([0-9a-f]{64})`).exec(text);
    src[name] = m ? m[1] : null;
  }
  const body = /body sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const at = text.indexOf("\n(function (root, factory)");
  return { src, body, actualBody: at >= 0 ? sha(text.slice(at + 1)) : null };
}

/** A source's imports of its siblings go: in the generated module they share one scope. */
function unimport(source) {
  return source.replace(/^import\s+(type\s+)?(\{[\s\S]*?\}|\w+)\s+from\s+"\.\/[\w.]+\.ts";\n/gm, "");
}

export function build(sources) {
  const list = Array.isArray(sources) ? sources : [sources];
  const ts = createRequire(join(HERE, "../../../package.json"))("typescript");
  const names = [];
  const declared = new Map();
  const parts = list.map((source, i) => {
    const js = ts.transpileModule(unimport(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
    }).outputText;
    const body = js
      .replace(/^export (class|function|const|let) ([A-Za-z0-9_]+)/gm, (_m, kw, name) => { names.push(name); return `${kw} ${name}`; })
      .replace(/^export \{\};?\s*$/gm, "")
      .trimEnd();
    if (/^export /m.test(body)) throw new Error(`genKernel: ${SOURCE_NAMES[i]} has an export this script cannot rewrite`);
    // One scope, so two files may not declare the same top-level name.
    for (const m of body.matchAll(/^(?:class|function|const|let|var) ([A-Za-z0-9_$]+)/gm)) {
      const was = declared.get(m[1]);
      if (was !== undefined) throw new Error(`genKernel: both ${SOURCE_NAMES[was]} and ${SOURCE_NAMES[i]} declare "${m[1]}"`);
      declared.set(m[1], i);
    }
    return body;
  });
  const body = parts.join("\n\n");
  const umd = [
    "(function (root, factory) {",
    "  const api = factory();",
    '  if (typeof module === "object" && module && module.exports) module.exports = api;',
    "  else root.TailzuKernel = api;",
    '})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
    '  "use strict";',
    body.split("\n").map((l) => (l ? "  " + l : l)).join("\n"),
    `  return { ${names.join(", ")} };`,
    "});",
    "",
  ].join("\n");
  const header = [
    "// GENERATED: do not edit. The screen kernel: expressions, formats, templates, rules, limits and paths.",
    "// Source: TAILZU-FRONTEND/app/src/sdui/kernel/; regenerate with `node src/sdui/kernel/genKernel.mjs` there.",
    ...SOURCE_NAMES.map((n, i) => `// ${n} sha256 ${sha(list[i])}`),
    `// body sha256 ${sha(umd)}`,
    "",
  ].join("\n");
  return header + umd;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args[0] === "--desktop" || args[0] === "--server" ? args[0] : null;
  const rest = only ? args.slice(1) : args;
  const text = build(readSources());
  const outs = [];
  if (only !== "--server") outs.push(only === "--desktop" && rest[0] ? resolve(rest[0]) : DESKTOP_OUT);
  if (only !== "--desktop") outs.push(only === "--server" && rest[0] ? resolve(rest[0]) : SERVER_OUT);
  for (const out of outs) {
    writeFileSync(out, text);
    console.log(`genKernel: wrote ${out}`);
  }
}
