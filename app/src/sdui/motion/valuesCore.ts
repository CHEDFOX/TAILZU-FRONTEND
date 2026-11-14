/**
 * THE `ui.*` VALUE BUS, worked out (pure SPEC 2.5). values.ts fills it with Reanimated shared values.
 *
 * Names in, numbers out, and a count of who is still using each one. No React, no React Native, no
 * Reanimated — so what the bus does with a name can be tested in Node, and values.ts stays four lines of
 * wiring around it.
 *
 * WHY THE HOLDS. A value lives in a module, not in a screen, so two things would go wrong without them:
 * a name a screen is finished with would keep its place against the cap for the rest of the launch, and the
 * sixteenth screen's values would be silently refused; and a name is not meant to be dropped while a finger
 * is still writing it. So a view that writes or reads a name holds it while it is mounted, a held name is
 * never swept, and an unheld one goes the moment the cap needs its place.
 */

/** `ui.pill.x` and `pill.x` are the same name. The `ui.` is how the server writes it; the bus drops it. */
export function bareName(name: string): string {
  return name.startsWith("ui.") ? name.slice(3) : name;
}

interface Held<T> { value: T; refs: number }

export class ValueBus<T> {
  private readonly map = new Map<string, Held<T>>();
  private readonly max: number;
  private readonly make: () => T;

  constructor(max: number, make: () => T) {
    this.max = max > 0 ? max : 0;
    this.make = make;
  }

  /**
   * The value under this name, made if nobody has made it yet. Null only when the cap is reached and every
   * name in the bus is being held, which the caller must survive: the motion simply does not drive.
   */
  get(name: string): T | null {
    const key = bareName(name);
    if (!key) return null;
    const had = this.map.get(key);
    if (had) return had.value;
    if (!this.room()) return null;
    const value = this.make();
    this.map.set(key, { value, refs: 0 });
    return value;
  }

  /** The same value, and a promise to call `release` with the same name when this view goes away. */
  hold(name: string): T | null {
    const key = bareName(name);
    const v = this.get(key);
    if (v === null) return null;
    const h = this.map.get(key);
    if (h) h.refs += 1;
    return v;
  }

  /** Let go of one hold. The name goes when the last view keeping it has gone. */
  release(name: string): void {
    const h = this.map.get(bareName(name));
    if (!h) return;
    h.refs -= 1;
    if (h.refs <= 0) this.map.delete(bareName(name));
  }

  /** The value under this name, or null — without making one. For a reader that must not create names. */
  peek(name: string): T | null {
    return this.map.get(bareName(name))?.value ?? null;
  }

  /** How many views are holding this name. */
  holds(name: string): number {
    return this.map.get(bareName(name))?.refs ?? 0;
  }

  /** How many names exist. */
  get size(): number { return this.map.size; }

  /** Forget every name: a sign-out, safe mode, a test. */
  clear(): void { this.map.clear(); }

  /** Make room by forgetting what nobody holds. True when there is room for one more name. */
  private room(): boolean {
    if (this.map.size < this.max) return true;
    for (const [key, h] of this.map) if (h.refs <= 0) this.map.delete(key);
    return this.map.size < this.max;
  }
}
