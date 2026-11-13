// node --test
//
// The expression language: what it means, what it refuses, and what a hostile screen cannot make it do.
import test from "node:test";
import assert from "node:assert";
import { LIMITS } from "./limits.ts";
import {
  FUNCTION_NAMES, KernelError, TIME_DEP, compileExpr, dependsOn, pick, readsTime, runExpr, toText, tryCompileExpr,
} from "./expr.ts";
import type { Scope } from "./expr.ts";

const scope = (over: Partial<Scope> = {}): Scope => ({
  state: { done: [1, 2], items: [1, 2, 3, 4, 5], busy: false, name: "Asha", note: { id: "n1", title: "{{ state.x }}" }, n: 3 },
  device: { perm: { mic: "granted" }, width: 390, keyboard: { enabled: true } },
  local: { dismissed: true },
  env: { locale: "en-US", now: 1_700_000_000_000, timeZone: "UTC", intl: true },
  ...over,
});

const run = (src: string, s: Scope = scope()): unknown => compileExpr(src).run(s);

test("arithmetic, precedence and the brackets", () => {
  assert.strictEqual(run("2 + 3 * 4"), 14);
  assert.strictEqual(run("(2 + 3) * 4"), 20);
  assert.strictEqual(run("10 / 4"), 2.5);
  assert.strictEqual(run("10 % 3"), 1);
  assert.strictEqual(run("-7 % 3"), 2, "the remainder is the bot engine's floor-mod, never negative for a positive divisor");
  assert.strictEqual(run("2 ** 3 ** 2"), 512, "powers go right to left");
  assert.strictEqual(run("-2 ** 2"), -4, "the power binds tighter than the minus");
});

test("dividing by zero is 0, and so is anything that stops being a number", () => {
  assert.strictEqual(run("1 / 0"), 0);
  assert.strictEqual(run("5 % 0"), 0);
  assert.strictEqual(run("1e308 * 1e308"), 0, "overflow is 0, never Infinity");
  assert.strictEqual(run("sqrt(-4)"), 0);
  assert.strictEqual(run("state.missing + 1"), 1, "nothing counts as 0 in arithmetic");
});

test("text joins with +, and a row or a list never prints as [object Object]", () => {
  assert.strictEqual(run("'hi ' + state.name"), "hi Asha");
  assert.strictEqual(run("state.n + ' left'"), "3 left");
  assert.strictEqual(run("'' + state.note"), "");
  assert.strictEqual(run("'' + state.items"), "");
  assert.strictEqual(toText(undefined), "");
  assert.strictEqual(toText(1 / 0), "0");
});

test("comparing, and the three ways to ask for a value when there is none", () => {
  assert.strictEqual(run("state.n > 2 && !state.busy"), true);
  assert.strictEqual(run("state.busy ? 0.4 : 1"), 1);
  assert.strictEqual(run("state.missing ?? 'none'"), "none");
  assert.strictEqual(run("state.busy ?? 'none'"), false, "false is a value, so ?? keeps it");
  assert.strictEqual(run("state.gone == null"), true, "nothing equals nothing");
  assert.strictEqual(run("'a' < 'b'"), true);
  assert.strictEqual(run("state.note?.id"), "n1");
  assert.strictEqual(run("state.gone?.id"), undefined);
});

test("the fixed functions", () => {
  assert.strictEqual(run("count(state.done) + ' of ' + count(state.items)"), "2 of 5");
  assert.strictEqual(run("min(3, 1, 2)"), 1);
  assert.strictEqual(run("clamp(9, 0, 3)"), 3);
  assert.strictEqual(run("round(2.345, 2)"), 2.35);
  assert.strictEqual(run("upper(slice(state.name, 0, 2))"), "AS");
  assert.strictEqual(run("join(state.done, '-')"), "1-2");
  assert.strictEqual(run("includes(state.done, 2)"), true);
  assert.strictEqual(run("contains(state.name, 'sh')"), true);
  assert.strictEqual(run("pad('7', 3, '0')"), "007");
  assert.strictEqual(run("replace('a.b.c', '.', '/')"), "a/b/c");
  assert.strictEqual(run("first(state.items)"), 1);
  assert.strictEqual(run("last(state.items)"), 5);
});

test("the catalog function gives back data, which is never looked at for holes again", () => {
  const s = scope({ text: () => "{{ state.name }} said hi" });
  assert.strictEqual(run("t('greeting')", s), "{{ state.name }} said hi");
  assert.strictEqual(run("t('greeting')", scope()), "greeting", "no catalog: the key itself");
});

test("the clock is a dependency of its own, so the renderer knows to tick", () => {
  const c = compileExpr("fmt.elapsed(state.startedAt)");
  assert.ok(readsTime(c.deps));
  assert.ok(c.deps.includes(TIME_DEP));
  assert.ok(!readsTime(compileExpr("state.n + 1").deps));
  const s = scope({ state: { startedAt: 1_700_000_000_000 - 65_000 } });
  assert.strictEqual(compileExpr("fmt.elapsed(state.startedAt)").run(s), "1:05");
  assert.strictEqual(compileExpr("since(state.startedAt)").run(s), 65_000, "since() is milliseconds, like now()");
});

test("every path an expression reads is written down, and a change is matched against it", () => {
  const c = compileExpr("state.a.b + device.perm.mic + count(state.list)");
  assert.deepStrictEqual([...c.deps], ["device.perm.mic", "state.a.b", "state.list"]);
  assert.ok(dependsOn(c.deps, "state.a.b"));
  assert.ok(dependsOn(c.deps, "state.a"), "a change further up reaches it");
  assert.ok(dependsOn(c.deps, "state.a.b.c"), "a change further down reaches it too");
  assert.ok(!dependsOn(c.deps, "state.other"));
  const dyn = compileExpr("state.rows[state.i].name");
  assert.ok(dyn.deps.includes("state.rows.*"), "an index that is itself an expression widens the path");
  assert.ok(dependsOn(dyn.deps, "state.rows.3.name"));
});

test("the cost is known before it runs: an expression over the cap is refused", () => {
  const long = Array.from({ length: 80 }, (_, i) => String(i)).join(" + ");
  assert.ok(long.length < LIMITS.exprChars);
  const small = tryCompileExpr(long, { maxOps: 8 });
  assert.strictEqual(small.ok, false);
  assert.match(small.ok === false ? small.error : "", /at most 8 operations/);
  const ok = compileExpr("1 + 1");
  assert.ok(ok.ops > 0 && ok.ops <= LIMITS.exprOps);
  const huge = "1 + ".repeat(LIMITS.exprChars).slice(0, LIMITS.exprChars + 1) + "1";
  assert.strictEqual(tryCompileExpr(huge).ok, false, "source longer than the character cap is refused");
});

test("the language is closed: no loops, no new functions, no regular expressions, no reaching out", () => {
  for (const src of [
    "state.x = 1",
    "for (;;) 1",
    "(a) => a",
    "/ab+/.test('abb')",
    "fetch('https://x')",
    "eval('1')",
    "globalThis",
    "window.alert(1)",
    "require('fs')",
    "state.name.toUpperCase()",
    "import('x')",
    "`a${1}b`",
  ]) {
    assert.strictEqual(tryCompileExpr(src).ok, false, `${src} must be refused`);
  }
  assert.ok(!FUNCTION_NAMES.includes("eval"));
  assert.ok(FUNCTION_NAMES.includes("fmt.relative"));
});

test("the prototype chain is not reachable, however it is spelled", () => {
  const s = scope({ state: { a: { b: 1 } } });
  assert.strictEqual(run("state.__proto__", s), undefined);
  assert.strictEqual(run("state.constructor", s), undefined);
  assert.strictEqual(run("state.a.prototype", s), undefined);
  assert.strictEqual(run("state['__proto__']", s), undefined);
  assert.strictEqual(run("state['constructor']", s), undefined);
  assert.strictEqual(run("state.a.hasOwnProperty", s), undefined, "an inherited name is not a value");
  assert.strictEqual(pick({ toString: () => "x" }, "toString"), undefined, "a function is never handed back");
  assert.strictEqual(pick(Object.create({ secret: 1 }), "secret"), undefined, "only a value the object owns");
  assert.strictEqual(pick([1, 2, 3], "length"), 3);
  assert.strictEqual(pick("abc", 1), "b");
});

test("a value that came from the server is data: holes in it are never a second expression", () => {
  const s = scope();
  assert.strictEqual(run("state.note.title", s), "{{ state.x }}", "a stored title keeps its braces");
});

test("hostile shapes: deep nesting, a huge string, a name that is not there", () => {
  const deep = "(".repeat(120) + "1" + ")".repeat(120);
  assert.ok(deep.length < LIMITS.exprChars);
  assert.strictEqual(compileExpr(deep).run(scope()), 1);
  assert.strictEqual(tryCompileExpr("(".repeat(300) + "1").ok, false, "brackets that never close are refused");

  const big = "x".repeat(LIMITS.stringBytes - 10);
  const s = scope({ state: { big } });
  const grow = compileExpr("state.big + state.big");
  const r = runExpr(grow, s);
  assert.strictEqual(r.ok, false, "a string over the prop ceiling is refused, not drawn");
  assert.match(r.ok === false ? r.error : "", /bytes/);
  assert.strictEqual(tryCompileExpr("nope.x").ok, false);
  assert.strictEqual(tryCompileExpr("stateX").ok, false);
  assert.strictEqual(tryCompileExpr("").ok, false);
  assert.strictEqual(tryCompileExpr(null).ok, false);
});

test("a refusal is a KernelError with a code, so the device can report it", () => {
  try {
    compileExpr("1 +");
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof KernelError);
    assert.strictEqual((e as KernelError).code, "expr");
  }
});

test("the 8 KB ceiling holds whichever function built the string, not only + and join", () => {
  const big = "x".repeat(LIMITS.stringBytes + 10);
  const s = scope({ state: { big } });
  for (const src of ["upper(state.big)", "lower(state.big)", "trim(state.big)", "slice(state.big, 0)", "pad(state.big, 1)", "t(state.big)"]) {
    const r = runExpr(compileExpr(src), s);
    assert.strictEqual(r.ok, false, src);
    assert.match(r.ok === false ? r.error : "", /over 8192 bytes/, src);
  }
  assert.strictEqual(compileExpr("len(upper(state.big))").run(s), big.length, "a number worked out of a long value is fine");
  assert.strictEqual(compileExpr("slice(state.big, 0, 5)").run(s), "xxxxx", "and a short piece of it comes through");
});

test("replace works out how long the answer would be before it builds it", () => {
  const hay = "ab".repeat(4000);
  const wide = "y".repeat(100);
  const r = runExpr(compileExpr("replace(state.hay, 'a', state.wide)"), scope({ state: { hay, wide } }));
  assert.strictEqual(r.ok, false, "8 KB of needles widened a hundredfold is refused");
  assert.match(r.ok === false ? r.error : "", /over 8192 bytes/);
  assert.strictEqual(compileExpr("replace('a-b-c', '-', ' ')").run(scope()), "a b c");
});
