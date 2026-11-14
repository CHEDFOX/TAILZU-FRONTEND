// node --test
//
// The copied grammar: that it is still byte for byte what core.ts says, that a number means the same thing in both
// engines, and that the kernel stayed pure (no React Native, no import of core.ts).
import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNumeric, numericError, runNumeric } from "./coreGrammar.ts";
import { compileExpr } from "./expr.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");

test("the copy of core.ts's numeric grammar is identical, as CI checks it", () => {
  const r = spawnSync(process.execPath, ["tools/ci/marked-regions.mjs", "--lang", "TS"], { cwd: REPO, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /CoreExprGrammar \(TS\): identical/);
});

test("the kernel is pure: no React Native, no bot tiles, nothing but its own siblings", () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length >= 9, "every kernel source is looked at");
  for (const f of files) {
    const text = readFileSync(join(HERE, f), "utf8");
    for (const m of text.matchAll(/^(?:import|export)[^;]*?from\s+"([^"]+)";/gms)) {
      assert.match(m[1]!, /^\.\/[\w.]+\.ts$/, `${f} may only reach its own siblings, not ${m[1]}`);
    }
    assert.ok(!/require\(/.test(text), `${f} requires nothing`);
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(text), `${f} never calls eval or builds a function`);
  }
});

/** The numeric engine with no names: a screen's constant arithmetic, worked out by the bot tiles' own bytecode. */
const byCore = (src: string): number => runNumeric(compileNumeric(src, []), new Float64Array(0));
const byKernel = (src: string): number => Number(compileExpr(src).run({}));

test("a number means the same thing in a bot's moment and on a screen", () => {
  for (const src of [
    "2 + 3 * 4",
    "(2 + 3) * 4",
    "10 / 4",
    "10 % 3",
    "-7 % 3",
    "1 / 0",
    "5 % 0",
    "0.1 + 0.2",
    "1e3 + 1",
    "min(3, 1, 2)",
    "max(3, 1, 2)",
    "clamp(9, 0, 3)",
    "round(2.5)",
    "floor(-1.5)",
    "ceil(1.2)",
    "abs(0 - 3)",
    "sqrt(-4)",
    "sqrt(9)",
    "sin(1) + cos(2)",
    "atan2(1, 2)",
    "3 < 4 ? 10 : 20",
    "4 < 3 ? 10 : 20",
    "-2 - -3",
  ]) {
    assert.strictEqual(byKernel(src), byCore(src), src);
  }
});

test("powers: the same arithmetic, spelled ** on a screen and ^ in a moment", () => {
  assert.strictEqual(byKernel("2 ** 3"), byCore("2 ^ 3"));
  assert.strictEqual(byKernel("-2 ** 2"), byCore("-2 ^ 2"));
  assert.strictEqual(numericError("2 ** 3"), 'unexpected "*"', "the moment grammar has no **");
  assert.strictEqual(numericError("2 ^ 3"), "");
});

test("where the two differ on purpose, they differ in one direction only", () => {
  // A moment deals only in numbers, so it answers 1 and 0; a screen answers true and false, and may answer text.
  assert.strictEqual(byCore("3 < 4"), 1);
  assert.strictEqual(compileExpr("3 < 4").run({}), true);
  // The screen's names are not a moment's names, and neither engine knows the other's.
  assert.match(numericError("state.x"), /unknown name/);
  assert.strictEqual(numericError("t + u", ["t", "u"]), "", "a moment's names still compile");
});

test("both engines turn what is not a number into 0, and neither one throws while running", () => {
  assert.strictEqual(byCore("1 / 0"), 0);
  assert.strictEqual(byKernel("1 / 0"), 0);
  assert.strictEqual(runNumeric(compileNumeric("t * 2", ["t"]), Float64Array.from([Number.NaN])), 0);
  assert.strictEqual(runNumeric(compileNumeric("t * 2", ["t"]), Float64Array.from([3])), 6);
});
