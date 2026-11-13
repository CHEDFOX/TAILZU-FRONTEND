// node --test
//
// Rules and timers: what compiles, what is dropped and why, and the timing arithmetic — all by passing times in,
// because the machine has no clock of its own.
import test from "node:test";
import assert from "node:assert";
import { LIMITS } from "./limits.ts";
import type { Scope } from "./expr.ts";
import { RuleMachine, compileRules, driveRules, ruleDeps } from "./rules.ts";

const scope = (over: Record<string, unknown> = {}): Scope => ({ state: over, device: { keyboard: { enabled: false } } });

test("a rule is a when, an every or an after, with an id and something to do", () => {
  const { rules, errors } = compileRules([
    { id: "kb", when: { expr: "device.keyboard.enabled" }, do: { kind: "navigate" }, once: true },
    { id: "tick", every: 1000, do: { kind: "setState" } },
    { id: "nudge", after: 8000, do: { kind: "setState" } },
  ]);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(rules.map((r) => r.kind), ["when", "every", "after"]);
  assert.strictEqual(rules[2]!.once, true, "an after fires once by its nature");
  assert.deepStrictEqual(ruleDeps(rules), ["device.keyboard.enabled"]);
});

test("every way a rule can be wrong is said out loud, and the others still compile", () => {
  const { rules, errors } = compileRules([
    { id: "ok", after: 10, do: 1 },
    { id: "", after: 10, do: 1 },
    { id: "ok", after: 10, do: 1 },
    { id: "nodo", after: 10 } as never,
    { id: "nothing", do: 1 } as never,
    { id: "both", every: 1000, after: 10, do: 1 },
    { id: "badwhen", when: "device.online", do: 1 },
    { id: "badexpr", when: { expr: "state." }, do: 1 },
    { id: "fast", every: 100, do: 1 },
    "not a rule" as never,
  ]);
  assert.deepStrictEqual(rules.map((r) => r.id), ["ok"]);
  assert.strictEqual(errors.length, 9);
  assert.ok(errors.some((e) => /no id/.test(e)));
  assert.ok(errors.some((e) => /two rules are called/.test(e)));
  assert.ok(errors.some((e) => /does nothing/.test(e)));
  assert.ok(errors.some((e) => /neither when, every nor after/.test(e)));
  assert.ok(errors.some((e) => /not two of them/.test(e)));
  assert.ok(errors.some((e) => /not \{ expr/.test(e)));
  assert.ok(errors.some((e) => /the shortest here is 1000 ms/.test(e)));
});

test("a quarter-second timer is only for a node that is visible, with the app in front", () => {
  assert.strictEqual(compileRules([{ id: "t", every: 250, whileVisible: true, do: 1 }]).rules.length, 1);
  assert.strictEqual(compileRules([{ id: "t", every: 250, do: 1 }]).rules.length, 0);
  assert.strictEqual(compileRules([{ id: "t", every: 250, whileVisible: true, do: 1 }], { foreground: false }).rules.length, 0);
});

test("the caps hold: 32 rules, 4 timers", () => {
  const many = Array.from({ length: LIMITS.rules + 4 }, (_, i) => ({ id: `r${i}`, when: { expr: "state.x" }, do: 1 }));
  const r = compileRules(many);
  assert.strictEqual(r.rules.length, LIMITS.rules);
  assert.ok(r.errors.some((e) => /at most 32 rules/.test(e)));

  const timers = Array.from({ length: LIMITS.timers + 2 }, (_, i) => ({ id: `t${i}`, every: 1000, do: 1 }));
  const t = compileRules(timers);
  assert.strictEqual(t.rules.length, LIMITS.timers);
  assert.ok(t.errors.some((e) => /at most 4 timers/.test(e)));
});

test("a when fires on the change from false to true, and once means once", () => {
  const { rules } = compileRules([{ id: "kb", when: { expr: "state.on" }, do: "go", once: true }]);
  const m = new RuleMachine(rules, { now: 0 });
  assert.deepStrictEqual(m.tick(scope({ on: false }), 0).fired, []);
  assert.deepStrictEqual(m.tick(scope({ on: true }), 10).fired, [{ id: "kb", do: "go" }]);
  assert.deepStrictEqual(m.tick(scope({ on: true }), 20).fired, [], "still true is not a change");
  m.tick(scope({ on: false }), 30);
  assert.deepStrictEqual(m.tick(scope({ on: true }), 40).fired, [], "once already fired");
  assert.strictEqual(m.fireCount("kb"), 1);
});

test("a when without once fires again each time it becomes true, and never while it just stays true", () => {
  const { rules } = compileRules([{ id: "r", when: { expr: "state.on" }, do: "go" }]);
  const m = new RuleMachine(rules, { now: 0 });
  m.tick(scope({ on: true }), 0);
  assert.deepStrictEqual(m.tick(scope({ on: true }), 100).fired, [], "still true is not a new change");
  assert.deepStrictEqual(m.tick(scope({ on: true }), 200).fired, []);
  assert.strictEqual(m.fireCount("r"), 1);
  m.tick(scope({ on: false }), 1000);
  assert.strictEqual(m.tick(scope({ on: true }), 2000).fired.length, 1);
  assert.strictEqual(m.fireCount("r"), 2);
});

test("a debounce makes the condition hold first, and the machine asks to be woken then", () => {
  const { rules } = compileRules([{ id: "r", when: { expr: "state.on" }, debounceMs: 500, do: "go" }]);
  const m = new RuleMachine(rules, { now: 0 });
  const first = m.tick(scope({ on: true }), 1000);
  assert.deepStrictEqual(first.fired, []);
  assert.strictEqual(first.nextWakeAt, 1500, "come back when it would be old enough");
  assert.deepStrictEqual(m.tick(scope({ on: false }), 1200).fired, [], "it stopped holding, so it is disarmed");
  m.tick(scope({ on: true }), 1300);
  assert.deepStrictEqual(m.tick(scope({ on: true }), 1700).fired, [], "the wait starts again from 1300");
  assert.strictEqual(m.tick(scope({ on: true }), 1800).fired.length, 1);
});

test("an after fires once, that long after the rule started", () => {
  const { rules } = compileRules([{ id: "n", after: 8000, do: "hint" }]);
  const m = new RuleMachine(rules, { now: 1000 });
  const early = m.tick(scope(), 5000);
  assert.deepStrictEqual(early.fired, []);
  assert.strictEqual(early.nextWakeAt, 9000);
  assert.strictEqual(m.tick(scope(), 9000).fired.length, 1);
  assert.deepStrictEqual(m.tick(scope(), 20000).fired, []);
});

test("an every fires on its period and asks for the next one, with no catching up in a burst", () => {
  const { rules } = compileRules([{ id: "t", every: 1000, do: "tick" }]);
  const m = new RuleMachine(rules, { now: 0 });
  assert.deepStrictEqual(m.tick(scope(), 500).fired, []);
  assert.strictEqual(m.tick(scope(), 1000).fired.length, 1);
  assert.strictEqual(m.tick(scope(), 1500).fired.length, 0);
  const late = m.tick(scope(), 60_000);
  assert.strictEqual(late.fired.length, 1, "away for a minute: one tick, not sixty");
  assert.strictEqual(late.nextWakeAt, 61_000);
});

test("a timer that is only live while visible starts again when the node comes back", () => {
  const { rules } = compileRules([{ id: "t", every: 1000, whileVisible: true, do: "tick" }]);
  const m = new RuleMachine(rules, { now: 0 });
  m.setVisible(false, 100);
  assert.deepStrictEqual(m.tick(scope(), 5000).fired, [], "nothing runs off screen");
  m.setVisible(true, 5000);
  assert.deepStrictEqual(m.tick(scope(), 5500).fired, []);
  assert.strictEqual(m.tick(scope(), 6000).fired.length, 1);
});

test("nothing fires more than ten times a second, whatever the data asks for", () => {
  const rules = compileRules(
    Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, when: { expr: "state.on" }, do: i })),
  ).rules;
  const m = new RuleMachine(rules, { now: 0 });
  const t = m.tick(scope({ on: true }), 0);
  assert.strictEqual(t.fired.length, LIMITS.firesPerSecond);
  assert.strictEqual(t.throttled, 10);
  assert.ok(t.nextWakeAt !== null, "it asks to come back for the ones it held");
  const later = m.tick(scope({ on: true }), 1500);
  assert.ok(later.fired.length > 0, "a second later there is room again");
});

test("a when whose expression blows up is false, not a crash", () => {
  const big = "x".repeat(9000);
  const { rules } = compileRules([{ id: "r", when: { expr: "(state.big + state.big) == ''" }, do: 1 }]);
  const m = new RuleMachine(rules, { now: 0 });
  assert.deepStrictEqual(m.tick({ state: { big } }, 0).fired, []);
});

test("a when built on the clock asks to be woken, because nothing will write to the store", () => {
  const { rules } = compileRules([{ id: "dl", when: { expr: "now() > state.deadline" }, do: "ring" }]);
  assert.ok(ruleDeps(rules).includes("@time"));
  const m = new RuleMachine(rules, { now: 0 });
  let woke: number | null = -1;
  let clock = 0;
  const host = { now: () => clock, wake: (at: number | null) => { woke = at; } };
  const at = (now: number): Scope => ({ state: { deadline: 5000 }, env: { locale: "en-US", now } });

  assert.deepStrictEqual(driveRules(m, host, at(0)).fired, [], "not yet");
  assert.strictEqual(woke, 1000, "come back in a second and look again, which a store change never would");
  clock = 6000;
  assert.strictEqual(driveRules(m, host, at(6000)).fired.length, 1, "and then it fires on its own");

  const quiet = compileRules([{ id: "s", when: { expr: "state.on" }, do: 1 }]);
  assert.strictEqual(new RuleMachine(quiet.rules, { now: 0 }).tick(scope({ on: false }), 0).nextWakeAt, null,
    "a when with no clock in it still waits for the store, and asks for no timer");
});

test("a timer longer than a day is refused, because setTimeout would fire it straight away", () => {
  const far = compileRules([{ id: "far", after: 3e9, do: 1 }]);
  assert.deepStrictEqual(far.rules, []);
  assert.match(far.errors[0]!, /the longest is 86400000 ms/);
  assert.strictEqual(compileRules([{ id: "e", every: 5e9, do: 1 }]).rules.length, 0);
  assert.strictEqual(compileRules([{ id: "d", when: { expr: "state.x" }, debounceMs: 2e9, do: 1 }]).rules.length, 0);

  const ok = compileRules([{ id: "day", after: LIMITS.timerMaxMs, do: 1 }]);
  assert.strictEqual(ok.rules.length, 1, "a day itself is allowed");
  const wake = new RuleMachine(ok.rules, { now: 0 }).tick(scope(), 0).nextWakeAt;
  assert.ok(wake !== null && wake <= LIMITS.timerMaxMs, "and the wake it asks for fits in a 32-bit delay");
});

test("a clock that steps backwards does not park the timers for the size of the jump", () => {
  const { rules } = compileRules([{ id: "t", every: 1000, do: "tick" }, { id: "n", after: 2000, do: "hint" }]);
  const m = new RuleMachine(rules, { now: 0 });
  assert.strictEqual(m.tick(scope(), 3_600_000).fired.length, 2, "an hour on, both are due");
  // The device's clock is corrected by an hour: without the clamp the next tick would be an hour away.
  const back = m.tick(scope(), 10_000);
  assert.strictEqual(back.fired.length, 0);
  assert.strictEqual(back.nextWakeAt, 11_000, "a second away, not an hour");
  assert.strictEqual(m.tick(scope(), 11_000).fired.length, 1);
});

test("the host is told when to come back, which is the whole scheduler", () => {
  const { rules } = compileRules([{ id: "n", after: 300, do: "hint" }]);
  const m = new RuleMachine(rules, { now: 0 });
  let woke: number | null = -1;
  const host = { now: () => 100, wake: (at: number | null) => { woke = at; } };
  const t = driveRules(m, host, scope());
  assert.deepStrictEqual(t.fired, []);
  assert.strictEqual(woke, 300);
});
