// node src/botTiles/genStarter.mjs [path/to/looks.json]
//
// The bots' looks and moments STARTER PACK: what a build draws and plays before it has heard from the server (first
// launch, offline). The catalog lives on the server (TAILZU-BACKEND shared/bots/looks.json); at release this copies
// it, unchanged, into the phone (src/botTiles/starter.ts) and the window (TAILZU-DESKTOP/botLooks.js). Both carry the
// sha256 of the server's file, and tests on both sides fail when it moved on without them (when the backend is
// checked out beside them), or when a copy was edited by hand.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOOKS_SOURCE = resolve(HERE, "../../../../TAILZU-BACKEND/shared/bots/looks.json");
export const PROJECT_SOURCE = resolve(HERE, "../../../../TAILZU-BACKEND/shared/bots/project.mjs");
/** The format the copies are cut down to: what this build's core plays (core.ts LOOKS_FORMAT). */
export const STARTER_FORMAT = 2;

/** The one shared projection (anim/SPEC.md 5.1), so the copy is exactly what the server would serve this build. */
async function projector() {
  if (!existsSync(PROJECT_SOURCE)) throw new Error(`genStarter: ${PROJECT_SOURCE} is not beside this repo`);
  const { projectLooks } = await import(pathToFileURL(PROJECT_SOURCE).href);
  return projectLooks;
}
export const PHONE_OUT = join(HERE, "starter.ts");
export const DESKTOP_OUT = resolve(HERE, "../../../../TAILZU-DESKTOP/botLooks.js");

export const sha = (s) => createHash("sha256").update(s).digest("hex");

/** The two hashes a generated copy carries: of the server's file, and of its own body (a hand edit shows). */
export function hashesOf(text) {
  const src = /looks\.json sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const body = /body sha256 ([0-9a-f]{64})/.exec(text)?.[1] ?? null;
  const at = text.indexOf("\n// --\n");
  return { src, body, actualBody: at >= 0 ? sha(text.slice(at + 7)) : null };
}

const header = (source, body, how) => [
  "// GENERATED: do not edit. The bots' looks and moments as this build ships them (first launch, offline).",
  `// Source: TAILZU-BACKEND/shared/bots/looks.json; ${how}`,
  `// looks.json sha256 ${sha(source)}`,
  `// body sha256 ${sha(body)}`,
  "// --",
  "",
].join("\n");

/** The phone's copy: a TypeScript module. `cut` is the catalog already cut down to this build's format. */
export function buildPhone(source, cut) {
  const json = JSON.stringify(cut ?? JSON.parse(source));
  const body = `export const STARTER: unknown = ${json};\n`;
  return header(source, body, "regenerate with `node src/botTiles/genStarter.mjs` in TAILZU-FRONTEND/app.") + body;
}

/** The window's copy: a script (window.TailzuBotLooks), or module.exports for node --test. */
export function buildDesktop(source, cut) {
  const json = JSON.stringify(cut ?? JSON.parse(source));
  const body = [
    "(function (root) {",
    `  const looks = ${json};`,
    '  if (typeof module === "object" && module && module.exports) module.exports = looks;',
    "  else root.TailzuBotLooks = looks;",
    '})(typeof globalThis !== "undefined" ? globalThis : this);',
    "",
  ].join("\n");
  return header(source, body, "regenerate with `node src/botTiles/genStarter.mjs` in TAILZU-FRONTEND/app.") + body;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = process.argv[2] ? resolve(process.argv[2]) : LOOKS_SOURCE;
  const source = readFileSync(from, "utf8");
  const projectLooks = await projector();
  const cut = projectLooks(JSON.parse(source), STARTER_FORMAT);
  writeFileSync(PHONE_OUT, buildPhone(source, cut));
  console.log(`genStarter: wrote ${PHONE_OUT} (format ${STARTER_FORMAT})`);
  if (existsSync(dirname(DESKTOP_OUT))) {
    writeFileSync(DESKTOP_OUT, buildDesktop(source, cut));
    console.log(`genStarter: wrote ${DESKTOP_OUT} (format ${STARTER_FORMAT})`);
  }
}
