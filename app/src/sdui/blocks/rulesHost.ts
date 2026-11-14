/**
 * THE SCHEDULER AROUND THE KERNEL'S RULE MACHINE (pure/SPEC.md 2.4, B3).
 *
 * `RuleMachine` is pure and holds no timer: it is asked what fires now and says when it wants to be asked again.
 * This is the other half — one timer, one re-entrancy guard, and the rule that a pass is also run whenever
 * anything the rules read has changed. It takes the clock, the timer and "run this action" as arguments, so it
 * is driven with made-up times in a test and with the real ones on a phone (useRules.ts).
 *
 * No React here, and no `runAction`: that is exactly what makes the firing order testable in Node.
 */

import { RuleMachine, type CompiledRule, driveRules, type RuleHost } from "../kernel/rules.ts";
import { LIMITS } from "../kernel/index.ts";
import type { Scope } from "../kernel/index.ts";

/** What the host needs from the world around it. */
export interface RulesWorld {
  now(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
  /** The scope to work the rules out in, read fresh on every pass. */
  scope(): Scope;
  /** Run what a rule said to do. */
  fire(action: unknown, id: string): void;
}

/** One screen's (or one node's) rules, running. */
export class RulesHost {
  readonly machine: RuleMachine;
  private readonly world: RulesWorld;
  private handle: unknown = null;
  private alive = true;
  // A rule's own action writes to the store, which wakes this again from inside itself. The machine's edge and
  // its ten-a-second cap stop that being a loop; this stops the stack nesting.
  private running = false;
  private again = false;

  constructor(rules: readonly CompiledRule[], world: RulesWorld, visible = true) {
    this.world = world;
    this.machine = new RuleMachine(rules, { now: world.now(), visible });
  }

  private host(): RuleHost {
    return {
      now: () => this.world.now(),
      wake: (at) => {
        if (this.handle !== null) { this.world.clearTimer(this.handle); this.handle = null; }
        if (at === null || !this.alive) return;
        const wait = Math.max(0, Math.min(LIMITS.timerMaxMs, at - this.world.now()));
        this.handle = this.world.setTimer(wait, () => { this.handle = null; this.pass(); });
      },
    };
  }

  /** Look at every rule now: what fires, fires, and the next wake is set. */
  pass(): void {
    if (!this.alive) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      const tick = driveRules(this.machine, this.host(), this.world.scope());
      for (const f of tick.fired) {
        try { this.world.fire(f.do, f.id); } catch { /* one action that throws is not the other rules' business */ }
      }
    } catch {
      // A scope that cannot be read is not a reason to lose the screen; the next change asks again.
    } finally {
      this.running = false;
    }
    if (this.again) { this.again = false; this.pass(); }
  }

  /** The node went off or came back on screen (SPEC 2.4: a node's rules are live only while it is). */
  setVisible(visible: boolean): void {
    this.machine.setVisible(visible, this.world.now());
    this.pass();
  }

  /** How many times a rule has fired. For the tests and for the report. */
  fires(id: string): number {
    return this.machine.fireCount(id);
  }

  /** The screen or the node has gone. */
  stop(): void {
    this.alive = false;
    if (this.handle !== null) { this.world.clearTimer(this.handle); this.handle = null; }
  }
}
