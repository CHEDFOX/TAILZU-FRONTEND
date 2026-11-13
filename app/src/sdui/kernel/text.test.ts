// node --test
//
// Text with holes, values, and the rule the whole thing rests on: a bare string is never a template.
import test from "node:test";
import assert from "node:assert";
import { LIMITS } from "./limits.ts";
import type { Scope } from "./expr.ts";
import {
  compileCondition, compileProp, compileText, isEvaluable, isExprCondition, isTextTemplate, isValueBinding,
  looksLikeForgottenTemplate, runProp,
} from "./text.ts";

const scope: Scope = {
  state: { done: [1, 2], items: [1, 2, 3], note: { id: "n 1/2", title: "Call {{ state.secret }}" }, secret: "s3cret" },
  env: { locale: "en-US", now: 1_700_000_000_000, timeZone: "UTC", intl: true },
};

test("holes are filled, and the literals around them are kept as they are", () => {
  const t = compileText("{{ count(state.done) }} of {{ count(state.items) }} done");
  assert.strictEqual(t.run(scope), "2 of 3 done");
  assert.strictEqual(t.holes.length, 2);
  assert.deepStrictEqual([...t.literals], ["", " of ", " done"]);
  assert.strictEqual(compileText("no holes here").run(scope), "no holes here");
  assert.strictEqual(compileText("{{ state.missing }}!").run(scope), "!", "nothing draws as nothing");
});

test("ONLY the two shapes are evaluated; a bare string is data, whatever it holds", () => {
  assert.ok(isTextTemplate({ $t: "a" }));
  assert.ok(isValueBinding({ $: "1" }));
  assert.ok(!isEvaluable("{{ state.secret }}"));
  assert.ok(!isEvaluable({ title: "{{ state.secret }}" }));
  assert.ok(!isEvaluable({ $t: 5 }));
  assert.ok(!isEvaluable(["{{ state.secret }}"]));

  // A title that came from a person, or from a stranger's calendar invite, is drawn as written.
  const prop = compileProp("Call {{ state.secret }}");
  assert.strictEqual(prop.kind, "constant");
  assert.strictEqual(runProp(prop, scope), "Call {{ state.secret }}");

  // And the same words, arriving through the store, are not looked at a second time either.
  const bound = compileProp({ $: "state.note.title" });
  assert.strictEqual(runProp(bound, scope), "Call {{ state.secret }}");
});

test("a value binding is one value, with its own kind", () => {
  const p = compileProp({ $: "count(state.items) > 2" });
  assert.strictEqual(p.kind, "value");
  assert.strictEqual(runProp(p, scope), true);
  assert.ok(p.deps.includes("state.items"));
});

test("holes in a path are URL-encoded, display text is not", () => {
  const path = compileText("/v1/notes/{{ state.note.id }}", { encode: true });
  assert.strictEqual(path.run(scope), "/v1/notes/n%201%2F2");
  const shown = compileText("note {{ state.note.id }}");
  assert.strictEqual(shown.run(scope), "note n 1/2");
  const climb = compileText("/v1/notes/{{ state.evil }}", { encode: true });
  assert.strictEqual(
    climb.run({ ...scope, state: { evil: "../admin" } }),
    "/v1/notes/%2E%2E%2Fadmin",
    "the dots are encoded too, so a filled value can never spell a dot segment",
  );
});

test("a hole that is never closed, or holds another hole, is refused", () => {
  assert.throws(() => compileText("a {{ state.x"), /never closed/);
  assert.throws(() => compileText("a {{ {{ state.x }} }}"), /another hole/);
  assert.throws(() => compileText("{{ nope.x }}"), /there is no name nope/);
  assert.throws(() => compileText(7 as unknown as string), /must be a string/);
});

test("a text cannot be made huge, by holes or by what they fill with", () => {
  const many = "{{ 1 }}".repeat(LIMITS.textHoles + 1);
  assert.throws(() => compileText(many), /at most|operations/);
  const big = "x".repeat(LIMITS.stringBytes - 4);
  const t = compileText("{{ state.big }}{{ state.big }}");
  assert.throws(() => t.run({ state: { big } }), /bytes/);
});

test("a condition is the { expr } shape, and nothing else", () => {
  assert.ok(isExprCondition({ expr: "1" }));
  assert.ok(!isExprCondition({ $: "1" }));
  const c = compileCondition({ expr: "count(state.done) == 2" });
  assert.strictEqual(c.run(scope), true);
  assert.throws(() => compileCondition("count(state.done) == 2"), /condition/);
});

test("the warning for a forgotten $t never refuses anything", () => {
  assert.ok(looksLikeForgottenTemplate("{{ state.x }} left"));
  assert.ok(!looksLikeForgottenTemplate("plain words"));
  assert.ok(!looksLikeForgottenTemplate({ $t: "{{ 1 }}" }));
});
