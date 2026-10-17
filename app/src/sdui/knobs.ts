/**
 * KNOBS — every value the app would otherwise decide for itself, asked of
 * the server instead.
 *
 * The rule of this app is that the backend creates and the app renders. The
 * screens were already the server's; what was left in code was the glue:
 * the words on an error card, how long boot waits before giving up, the
 * colour of a toast, which screen a quota error opens. Each of those is now
 * a knob: a key the server sends a value for, with the value that used to
 * be hardcoded kept here only as the fallback for the moment before the
 * first bootstrap has ever arrived.
 *
 *   txt("error.screenTitle", "Couldn't load this screen")  → bootstrap.labels
 *   num("app.boot.watchdogMs", 12000)                      → bootstrap.flags
 *   bool / str / list / obj                                → bootstrap.flags
 *   color("app.color.toastBg", "#1C1C1E")                  → bootstrap.flags
 *
 * The backend sends every knob's value explicitly (src/experience/knobs.ts
 * in the backend), so the control console can find and change each one, for
 * anyone, live. The last bootstrap is cached on disk, so after the first
 * launch the server's values hold offline too.
 */
import type { BootstrapResponse } from "./types";

type Flags = Record<string, unknown>;
let labels: Record<string, string> = {};
let flags: Flags = {};
let source: unknown = null;

/** Point the knobs at a bootstrap. Cheap and idempotent; call on every render. */
export function setKnobs(boot: Pick<BootstrapResponse, "labels" | "flags"> | null | undefined): void {
  if (!boot || boot === source) return;
  source = boot;
  labels = (boot.labels ?? {}) as Record<string, string>;
  flags = (boot.flags ?? {}) as Flags;
}

/** Text. `{name}` placeholders are filled from `vars`. */
export function txt(key: string, fallback: string, vars?: Record<string, string | number>): string {
  const v = labels[key];
  const s = typeof v === "string" ? v : fallback;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export function num(key: string, fallback: number): number {
  const v = flags[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function bool(key: string, fallback: boolean): boolean {
  const v = flags[key];
  return typeof v === "boolean" ? v : fallback;
}

export function str(key: string, fallback: string): string {
  const v = flags[key];
  return typeof v === "string" ? v : fallback;
}

/** A colour: any CSS colour string the server sends, else the fallback. */
export function color(key: string, fallback: string): string {
  const v = flags[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * A list, shaped like its fallback: when the fallback's items are numbers,
 * strings or objects, the server's list is used only if every item is one too
 * (numbers finite, objects non-null). A console list with a null or a string
 * among the numbers otherwise reaches an animation or a .toLowerCase() and
 * takes the app down; now it is ignored and the fallback holds.
 */
export function list<T>(key: string, fallback: T[]): T[] {
  const v = flags[key];
  if (!Array.isArray(v)) return fallback;
  const sample = fallback[0];
  if (sample === undefined) return v.filter((x) => x !== null && x !== undefined) as T[];
  const ok = (x: unknown): boolean =>
    typeof sample === "number" ? typeof x === "number" && Number.isFinite(x)
      : typeof sample === "string" ? typeof x === "string"
        : typeof sample === "object" ? !!x && typeof x === "object" && !Array.isArray(x)
          : typeof x === typeof sample;
  return v.every(ok) ? (v as T[]) : fallback;
}

/** A numeric tuple of exactly `len` finite numbers (a curve, a ramp), else the fallback. */
export function tuple(key: string, fallback: number[], len: number): number[] {
  const v = list<number>(key, fallback);
  return v.length === len ? v : fallback;
}

export function obj<T extends object>(key: string, fallback: T): T {
  const v = flags[key];
  return v && typeof v === "object" && !Array.isArray(v) ? ({ ...fallback, ...(v as object) } as T) : fallback;
}
