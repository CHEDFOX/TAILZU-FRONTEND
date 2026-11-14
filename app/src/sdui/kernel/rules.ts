/**
 * RULES AND TIMERS AS DATA (pure SPEC 2.4, B3).
 *
 *   { "id": "kb",    "when": { "expr": "device.keyboard.enabled" }, "do": …, "once": true }
 *   { "id": "tick",  "every": 1000, "whileVisible": true, "do": … }
 *   { "id": "nudge", "after": 8000, "do": … }
 *
 * This replaces the `visibleIf + onAppear` trick, the Countdown component and every polling screen. A state
 * machine needs no new idea either: a state is a path in the store, and a transition is a rule.
 *
 * The machine here is pure. It holds no timer of its own: the renderer calls `tick(scope, now)` and is told what
 * fired and when to come back (`nextWakeAt`). That is the whole scheduler interface, which means the timing can be
 * tested by passing times in, and nothing runs in the background.
 *
 * The caps come from SPEC 5.1: at most 32 rules, 4 timers, `every` no faster than a second (a quarter second only
 * while the node is visible and the app is in front), no longer than a day, and no more than 10 fires a second
 * whatever the data says.
 *
 * A `when` that reads the clock (`now()`, `since()`, `fmt.elapsed`) becomes true with nothing written to the
 * store, so it asks to be woken each second until it fires. Everything else waits for a store change.
 */

import { LIMITS, everyFloorMs } from "./limits.ts";
import { type Compiled, type Scope, readsTime, tryCompileExpr } from "./expr.ts";
import { isExprCondition } from "./text.ts";

/** A rule as the server writes it. */
export interface RuleSpec {
  id: string;
  /** `{ expr }`, fired on the change from false to true. */
  when?: unknown;
  /** Milliseconds between fires. */
  every?: number;
  /** Milliseconds after the rule starts, once. */
  after?: number;
  /** The action. The kernel never looks inside it; the renderer runs it. */
  do: unknown;
  /** Fire at most once, ever. */
  once?: boolean;
  /** `when` must hold this long before it fires. */
  debounceMs?: number;
  /** Live only while the node is visible. A node's rules always are. */
  whileVisible?: boolean;
}

/** A rule that compiled. */
export interface CompiledRule {
  id: string;
  kind: "when" | "every" | "after";
  when: Compiled | null;
  every: number;
  after: number;
  do: unknown;
  once: boolean;
  debounceMs: number;
  whileVisible: boolean;
  /** True when the `when` reads the clock, so only time can make it come true. */
  watchesClock: boolean;
}

/** What came out of compiling a screen's rules. */
export interface CompiledRules {
  rules: CompiledRule[];
  errors: string[];
}

const whole = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;

/**
 * Compile a screen's (or a node's) rules. Bad rules are dropped with a reason, so one wrong rule never costs the
 * screen the other thirty-one. `foreground` only changes how fast `every` is allowed to be.
 */
export function compileRules(list: unknown, opts?: { foreground?: boolean }): CompiledRules {
  const errors: string[] = [];
  const rules: CompiledRule[] = [];
  if (list === undefined || list === null) return { rules, errors };
  if (!Array.isArray(list)) return { rules, errors: ["rules must be a list"] };
  const foreground = opts?.foreground !== false;
  const seen = new Set<string>();
  let timers = 0;

  for (const raw of list) {
    if (rules.length >= LIMITS.rules) {
      errors.push(`a screen has at most ${LIMITS.rules} rules; the rest were dropped`);
      break;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push("a rule must be an object"); continue; }
    const spec = raw as RuleSpec;
    const id = typeof spec.id === "string" && spec.id ? spec.id : "";
    if (!id) { errors.push("a rule has no id"); continue; }
    if (seen.has(id)) { errors.push(`two rules are called "${id}"`); continue; }
    if (!("do" in spec) || spec.do === undefined || spec.do === null) { errors.push(`the rule "${id}" does nothing`); continue; }

    const whileVisible = spec.whileVisible === true;
    const hasWhen = spec.when !== undefined && spec.when !== null;
    const hasEvery = spec.every !== undefined && spec.every !== null;
    const hasAfter = spec.after !== undefined && spec.after !== null;
    const kinds = (hasWhen ? 1 : 0) + (hasEvery ? 1 : 0) + (hasAfter ? 1 : 0);
    if (kinds === 0) { errors.push(`the rule "${id}" says neither when, every nor after`); continue; }
    if (kinds > 1) { errors.push(`the rule "${id}" is a when, an every or an after, not two of them`); continue; }

    if (hasWhen) {
      if (!isExprCondition(spec.when)) { errors.push(`the rule "${id}" has a when that is not { expr: "…" }`); continue; }
      const c = tryCompileExpr((spec.when as { expr: string }).expr);
      if (!c.ok) { errors.push(`the rule "${id}": ${c.error}`); continue; }
      const asked = Math.max(0, whole(spec.debounceMs, 0));
      if (asked > LIMITS.timerMaxMs) { errors.push(`the rule "${id}" waits ${asked} ms before firing; the longest is ${LIMITS.timerMaxMs} ms`); continue; }
      seen.add(id);
      rules.push({
        id, kind: "when", when: c.expr, every: 0, after: 0, do: spec.do,
        once: spec.once === true, debounceMs: asked, whileVisible, watchesClock: readsTime(c.expr.deps),
      });
      continue;
    }

    if (timers >= LIMITS.timers) { errors.push(`a screen has at most ${LIMITS.timers} timers; "${id}" was dropped`); continue; }
    if (hasEvery) {
      const floor = everyFloorMs(whileVisible, foreground);
      const asked = whole(spec.every, 0);
      if (asked < floor) { errors.push(`the rule "${id}" asks for every ${asked} ms; the shortest here is ${floor} ms`); continue; }
      if (asked > LIMITS.timerMaxMs) { errors.push(`the rule "${id}" asks for every ${asked} ms; the longest is ${LIMITS.timerMaxMs} ms`); continue; }
      timers += 1;
      seen.add(id);
      rules.push({ id, kind: "every", when: null, every: asked, after: 0, do: spec.do, once: spec.once === true, debounceMs: 0, whileVisible, watchesClock: false });
      continue;
    }

    const after = whole(spec.after, -1);
    if (after < 0) { errors.push(`the rule "${id}" has an after that is not a number of milliseconds`); continue; }
    // A timer longer than a day is refused rather than clamped: `setTimeout` takes a 32-bit delay and fires a
    // longer one AT ONCE, so a far-off `after` would spin instead of waiting (SPEC 5.1, LIMITS.timerMaxMs).
    if (after > LIMITS.timerMaxMs) { errors.push(`the rule "${id}" waits ${after} ms; the longest is ${LIMITS.timerMaxMs} ms`); continue; }
    timers += 1;
    seen.add(id);
    rules.push({ id, kind: "after", when: null, every: 0, after, do: spec.do, once: true, debounceMs: 0, whileVisible, watchesClock: false });
  }

  return { rules, errors };
}

/** One rule that fired, for the renderer to run. */
export interface Fired {
  id: string;
  do: unknown;
}

/** What one tick came to. */
export interface Tick {
  fired: Fired[];
  /** When the machine wants to be called again, or null when only a store change can wake it. */
  nextWakeAt: number | null;
  /** How many fires the ten-a-second cap held back. */
  throttled: number;
}

/** What the renderer has to give the machine. It is the whole scheduler contract. */
export interface RuleHost {
  /**
   * What time it is, in milliseconds. A clock that steps BACKWARDS (the device's own clock corrected, a zone
   * change, `Date.now()` after a sync) is tolerated: `tick` pulls every timer back with it rather than sleep out
   * the size of the jump.
   */
  now(): number;
  /** Come back at this time, or stop the timer when it is null. */
  wake(at: number | null): void;
}

interface RuleState {
  /** `when`: what it said last time. */
  was: boolean;
  /** `when` with a debounce: when it may fire, once it has held. */
  armedAt: number | null;
  /** How many times it has fired. */
  fires: number;
  /** `every`/`after`: when the clock started. */
  startedAt: number;
  /** `every`: when it last fired. */
  lastAt: number;
}

/**
 * The live state of one screen's rules. Pure: it is driven by `tick`, and it keeps its own small record of what
 * has fired, what is armed and when each timer started.
 */
export class RuleMachine {
  rules: readonly CompiledRule[];
  private states: RuleState[];
  private visible: boolean;
  private window: number[] = [];

  constructor(rules: readonly CompiledRule[], opts?: { now?: number; visible?: boolean }) {
    this.rules = rules;
    this.visible = opts?.visible !== false;
    const now = opts?.now ?? 0;
    this.states = rules.map(() => ({ was: false, armedAt: null, fires: 0, startedAt: now, lastAt: now }));
  }

  /**
   * A node went off or back on screen. Timers that are only live while visible start again from here, so a screen
   * that was away for an hour does not fire sixty missed ticks at once.
   */
  setVisible(visible: boolean, now: number): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) return;
    for (let i = 0; i < this.rules.length; i += 1) {
      if (!this.rules[i]!.whileVisible) continue;
      this.states[i]!.startedAt = now;
      this.states[i]!.lastAt = now;
      this.states[i]!.armedAt = null;
      this.states[i]!.was = false;
    }
  }

  /** True when a rule is live right now. */
  private live(rule: CompiledRule): boolean {
    return this.visible || !rule.whileVisible;
  }

  /** The ten-a-second cap, over a sliding second. */
  private allow(now: number): boolean {
    while (this.window.length > 0 && now - this.window[0]! >= 1000) this.window.shift();
    if (this.window.length >= LIMITS.firesPerSecond) return false;
    this.window.push(now);
    return true;
  }

  /**
   * Work out what fires at `now`, in this scope. Call it on a store change and whenever `nextWakeAt` came round;
   * calling it more often than that is allowed and changes nothing.
   */
  tick(scope: Scope, now: number): Tick {
    const fired: Fired[] = [];
    let throttled = 0;
    let next: number | null = null;
    // Never ask for a wake further off than a timer may be: a host that turns this into a `setTimeout` delay has
    // only 32 bits for it, and a longer one fires straight away.
    const latest = now + LIMITS.timerMaxMs;
    const wake = (at: number): void => {
      const when = at > latest ? latest : at;
      if (next === null || when < next) next = when;
    };
    // A clock that moved backwards (the device's own, or a zone change) must not park the ten-a-second window.
    while (this.window.length > 0 && this.window[this.window.length - 1]! > now) this.window.pop();

    for (let i = 0; i < this.rules.length; i += 1) {
      const rule = this.rules[i]!;
      const st = this.states[i]!;
      // The same backward jump would otherwise leave every timer waiting out the size of the jump.
      if (st.startedAt > now) st.startedAt = now;
      if (st.lastAt > now) st.lastAt = now;
      if (st.armedAt !== null && st.armedAt > now + rule.debounceMs) st.armedAt = now + rule.debounceMs;
      if (!this.live(rule)) { st.was = false; st.armedAt = null; continue; }
      if (rule.once && st.fires > 0) continue;

      if (rule.kind === "when") {
        // A condition built on `now()`, `since()` or `fmt.elapsed` becomes true by itself, with nothing written
        // to the store to wake anyone. It is re-checked each second, which is the floor an `every` has anyway.
        if (rule.watchesClock) wake(now + LIMITS.everyMs);
        let is = false;
        try {
          is = !!rule.when!.run(scope);
        } catch {
          is = false;
        }
        if (!is) { st.was = false; st.armedAt = null; continue; }
        if (!st.was) {
          st.was = true;
          st.armedAt = now + rule.debounceMs;
        }
        // Armed at nothing while it is still true means this edge has already fired: a condition that stays true
        // is not a second change.
        if (st.armedAt === null) continue;
        if (now < st.armedAt) { wake(st.armedAt); continue; }
        if (this.allow(now)) { st.armedAt = null; st.fires += 1; fired.push({ id: rule.id, do: rule.do }); }
        else { throttled += 1; wake(now + 100); }
        continue;
      }

      if (rule.kind === "after") {
        const due = st.startedAt + rule.after;
        if (now < due) { wake(due); continue; }
        if (this.allow(now)) { st.fires += 1; fired.push({ id: rule.id, do: rule.do }); }
        else { throttled += 1; wake(now + 100); }
        continue;
      }

      // every: one fire per tick at most, and the next one is a whole period after this one.
      const since = now - st.lastAt;
      if (since < rule.every) { wake(st.lastAt + rule.every); continue; }
      if (this.allow(now)) {
        st.fires += 1;
        st.lastAt = now;
        fired.push({ id: rule.id, do: rule.do });
        wake(now + rule.every);
      } else {
        throttled += 1;
        wake(now + 100);
      }
    }

    return { fired, nextWakeAt: next, throttled };
  }

  /** How many times a rule has fired. For tests and for the report the device sends back. */
  fireCount(id: string): number {
    const i = this.rules.findIndex((r) => r.id === id);
    return i === -1 ? 0 : this.states[i]!.fires;
  }
}

/** Run one tick and tell the host when to come back. The renderer's loop in one line. */
export function driveRules(machine: RuleMachine, host: RuleHost, scope: Scope): Tick {
  const t = machine.tick(scope, host.now());
  host.wake(t.nextWakeAt);
  return t;
}

/** The paths every `when` in this set reads, so a store change can be matched against them. */
export function ruleDeps(rules: readonly CompiledRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (!r.when) continue;
    for (const d of r.when.deps) if (!out.includes(d)) out.push(d);
  }
  return out.sort();
}
