// node --test --experimental-strip-types src/sdui/blocks/rulesHost.test.ts
//
// RULES, DRIVEN BY A CLOCK THE TEST OWNS: a `when` fires on the edge and only on the edge, a timer comes round,
// and a rule that is only live while its node is visible stops when the node goes.
import test from "node:test";
import assert from "node:assert";
import { RulesHost, type RulesWorld } from "./rulesHost.ts";
import { compileRules } from "../kernel/rules.ts";

/** A clock and a timer the test moves by hand. */
function world(state: Record<string, unknown>): RulesWorld & { tick(ms: number): void; fired: string[]; state: Record<string, unknown> } {
  let now = 1000;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  const fired: string[] = [];
  return {
    state,
    fired,
    now: () => now,
    setTimer(ms, fn) { const t = { at: now + ms, fn, id: ++seq }; timers.push(t); return t.id; },
    clearTimer(h) { timers = timers.filter((t) => t.id !== h); },
    scope: () => ({ state, env: { locale: "en-US", now } }),
    fire: (_action, id) => { fired.push(id); },
    tick(ms) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
      }
      now = until;
    },
  };
}

test("a `when` fires on the change from false to true, once, not on every pass after it", () => {
  const w = world({ done: false });
  const { rules, errors } = compileRules([{ id: "go", when: { expr: "state.done" }, do: { kind: "navigate" } }]);
  assert.deepStrictEqual(errors, []);
  const host = new RulesHost(rules, w);
  host.pass();
  assert.deepStrictEqual(w.fired, [], "nothing while it is false");
  w.state.done = true;
  host.pass();
  assert.deepStrictEqual(w.fired, ["go"], "the edge");
  host.pass();
  host.pass();
  assert.deepStrictEqual(w.fired, ["go"], "still true is not a second change");
  w.state.done = false;
  host.pass();
  w.state.done = true;
  host.pass();
  assert.deepStrictEqual(w.fired, ["go", "go"], "false and true again is a new edge");
  host.stop();
});

test("`once` means once, whatever happens afterwards", () => {
  const w = world({ done: false });
  const { rules } = compileRules([{ id: "kb", when: { expr: "state.done" }, do: {}, once: true }]);
  const host = new RulesHost(rules, w);
  for (const v of [true, false, true]) { w.state.done = v; host.pass(); }
  assert.deepStrictEqual(w.fired, ["kb"]);
  host.stop();
});

test("`every` comes round by itself, on its own timer, and never faster than the floor", () => {
  const w = world({});
  const { rules, errors } = compileRules([{ id: "tick", every: 1000, do: {} }]);
  assert.deepStrictEqual(errors, []);
  const host = new RulesHost(rules, w);
  host.pass();
  assert.strictEqual(w.fired.length, 0, "a period has to pass before the first one");
  w.tick(2500);
  assert.strictEqual(w.fired.length, 2, "once a second after that, and never twice in one");
  host.stop();
  w.tick(5000);
  assert.strictEqual(w.fired.length, 2, "a stopped host has no timer left");
});

test("`after` fires once, when its wait is up", () => {
  const w = world({});
  const { rules } = compileRules([{ id: "nudge", after: 8000, do: {} }]);
  const host = new RulesHost(rules, w);
  host.pass();
  w.tick(7999);
  assert.deepStrictEqual(w.fired, []);
  w.tick(2);
  assert.deepStrictEqual(w.fired, ["nudge"]);
  w.tick(60000);
  assert.deepStrictEqual(w.fired, ["nudge"], "once");
  host.stop();
});

test("a rule that is only live while its node is visible stops with the node", () => {
  const w = world({ done: false });
  const { rules } = compileRules([{ id: "go", when: { expr: "state.done" }, do: {}, whileVisible: true }]);
  const host = new RulesHost(rules, w, false);
  w.state.done = true;
  host.pass();
  assert.deepStrictEqual(w.fired, [], "the node is not on screen");
  host.setVisible(true);
  assert.deepStrictEqual(w.fired, ["go"], "and fires the moment it is");
  host.stop();
});

test("an action that writes the thing the rule reads cannot nest passes for ever", () => {
  const w = world({ n: 0 });
  const { rules } = compileRules([{ id: "bump", when: { expr: "state.n < 3" }, do: {} }]);
  const host = new RulesHost(rules, {
    ...w,
    // The worst case: the action writes, and the write asks for another pass from inside this one.
    fire: (_a, id) => { w.fired.push(id); (w.state.n as number) < 10 && (w.state.n = (w.state.n as number) + 1); host.pass(); },
  });
  host.pass();
  assert.ok(w.fired.length <= 2, `the edge holds and the stack does not grow: ${w.fired.length}`);
  host.stop();
});
