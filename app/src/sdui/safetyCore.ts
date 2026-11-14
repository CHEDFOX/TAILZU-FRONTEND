/**
 * THE SAFETY FLOOR'S DECISIONS, pure and tested in Node (safety.ts is the wiring).
 *
 * The server draws the app. So the app has to survive the server being wrong: a node type this build cannot draw, a
 * node that throws, a screen that takes the launch down with it. This file holds the three answers to that, each as a
 * plain function over plain values:
 *
 *   • the floor — what the kill switches (`sdui.safe`, `sdui.off`, `sdui.motion`) and the crash guard add up to;
 *   • the crash-loop record — what the breadcrumb of the screen being drawn means on the next launch;
 *   • the report bag — one line per type+screen that went wrong, for the handshake.
 *
 * Nothing here knows about React, storage or the bootstrap, so all of it can be read straight in a test.
 */

/**
 * VOCAB 1: every node type this build draws (components/index.ts REGISTRY).
 *
 * Safe mode is "vocab-1 types only", and in THIS build that is every type there is — so turning safe mode on changes
 * nothing about which types draw. The list is here, rather than read off the registry, so that a type added later by
 * a newer vocabulary is off in safe mode by default: a rescue should only ever draw what the oldest player could.
 */
export const VOCAB1_TYPES: readonly string[] = [
  "Screen", "Stack", "Text", "Image", "Button", "TextField", "Grid", "SafeArea", "SVG", "Scroll",
  "VoiceButton", "VoiceToggle",
  "SwipePill", "AppleSignIn", "GoogleSignIn", "CodeEntry", "AuthPhase", "OnboardStage", "BlipSpot",
  "Rise", "MorphOut",
  "BotTiles", "BotCard", "BotBuddy", "BlipWalkOut",
  "WriteOn", "LiveMark", "HeadBar",
  "LiveView",
  "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords",
  "PersonBot",
];
const VOCAB1 = new Set(VOCAB1_TYPES);

export type MotionMode = "on" | "reduced" | "off";

/** The kill switches as the bootstrap sends them (`sdui.safe`, `sdui.off`, `sdui.motion`). */
export interface SafetyKnobs {
  safe: boolean;
  off: readonly string[];
  motion: string;
}

/** What this device turned off for itself: the crash guard's doing, never the server's. */
export interface DeviceFloor {
  safe: boolean;
  off: readonly string[];
}

/** The two added together — the one thing the renderer and the motion code ask. */
export interface Floor {
  safe: boolean;
  off: readonly string[];
  motion: MotionMode;
}

/** Defaults that change nothing: no safe mode, nothing switched off, motion as it always was. */
export const OPEN_FLOOR: Floor = { safe: false, off: [], motion: "on" };

/**
 * BLOCK NAMES `sdui.off` MAY CARRY, beside node types and screen ids.
 *
 * SPEC 5.3's own example is `sdui.off: ["List", "motion", …]`: "those node types OR BLOCKS are treated as unknown".
 * A block is not a type, so naming one cannot work by name-matching the tree — it has to switch the block itself off,
 * which for the three this build has is exactly what safe mode does to each of them one at a time. The names are the
 * handshake's own closed set (SPEC 2.0, principle 2); the blocks this build does not have yet ("list", "input", …)
 * are off already, so naming one is harmlessly nothing.
 */
const BLOCK_MOTION = "motion";
const BLOCK_GESTURE = "gesture";
const BLOCK_RULES = "rules";

/** The server's switches and the device's own, as one floor. Safe mode implies no motion. */
export function floorFrom(knobs: SafetyKnobs, device: DeviceFloor): Floor {
  const safe = knobs.safe || device.safe;
  const named = new Set<string>();
  for (const s of knobs.off) if (typeof s === "string" && s) named.add(s);
  for (const s of device.off) if (typeof s === "string" && s) named.add(s);
  const motion: MotionMode = safe || named.has(BLOCK_MOTION) ? "off"
    : knobs.motion === "off" ? "off"
      : knobs.motion === "reduced" ? "reduced"
        : "on";
  return { safe, off: [...named], motion };
}

/** This node type is to be treated as unknown, so its `fallback` draws (or nothing). */
export function nodeOff(type: string, floor: Floor): boolean {
  if (!type) return false;
  if (floor.off.includes(type)) return true;
  // Safe mode: anything the first vocabulary did not have is unknown for this launch.
  return floor.safe && !VOCAB1.has(type);
}

/** This whole screen is off — the crash guard put it there, or the server named it in `sdui.off`. */
export function screenOff(screenId: string, floor: Floor): boolean {
  return !!screenId && floor.off.includes(screenId);
}

/** Rules and timers run. Safe mode freezes them, and so does `sdui.off: ["rules"]`. */
export function rulesOn(floor: Floor): boolean {
  return !floor.safe && !floor.off.includes(BLOCK_RULES);
}

/** Gestures (the edge swipe back, the pull, and whatever follows them) are live. Safe mode drops them. */
export function gesturesOn(floor: Floor): boolean {
  return !floor.safe && !floor.off.includes(BLOCK_GESTURE);
}

// ---------------------------------------------------------------------------
// The crash-loop record
// ---------------------------------------------------------------------------

/**
 * What the last launch left behind.
 *
 * `open` is the whole trick: every launch writes it true as it starts and false once it has stayed up a few seconds.
 * A launch that finds it still true knows the previous one never got that far — it was killed mid-draw — and
 * `screen` names what it was drawing at the time. No crash reporter needed, and it survives a launch so broken that
 * nothing else gets a chance to report.
 */
export interface BootGuard {
  open: boolean;
  /** The screen being drawn right now, written as each screen starts. */
  screen: string;
  /** The screen the crashes are piling up on. */
  loopScreen: string;
  crashes: number;
  /** Screens this device switched off for itself after two crashes on each. */
  off: string[];
}

export const EMPTY_GUARD: BootGuard = { open: false, screen: "", loopScreen: "", crashes: 0, off: [] };

/** How many of its own screens one device will ever switch off. A cap, so a bad spell cannot empty the app. */
export const MAX_OFF = 8;
const ID_MAX = 64;

const id = (s: unknown): string => (typeof s === "string" ? s.slice(0, ID_MAX) : "");

/** Read a kept record. Anything unreadable, half-written or from another build reads as "nothing kept". */
export function readGuard(raw: string | null | undefined): BootGuard {
  if (!raw) return { ...EMPTY_GUARD, off: [] };
  try {
    const o = JSON.parse(raw) as Partial<BootGuard> | null;
    if (!o || typeof o !== "object") return { ...EMPTY_GUARD, off: [] };
    return {
      open: o.open === true,
      screen: id(o.screen),
      loopScreen: id(o.loopScreen),
      crashes: typeof o.crashes === "number" && Number.isFinite(o.crashes) ? Math.max(0, Math.floor(o.crashes)) : 0,
      off: Array.isArray(o.off) ? o.off.filter((s) => typeof s === "string" && s).map(id).slice(0, MAX_OFF) : [],
    };
  } catch {
    return { ...EMPTY_GUARD, off: [] };
  }
}

/** What a launch starts with, and whether it is a rescue. */
export interface LaunchStart {
  guard: BootGuard;
  /** This launch draws in safe mode. */
  safe: boolean;
  /** For the handshake: `loop:<screen>`, or "" when this is an ordinary launch. */
  note: string;
}

/**
 * Open a launch.
 *
 * One crash is bad luck — a screen is tried again. Two in a row on the same screen is a loop, and the second one has
 * already cost the person the app twice, so this launch is a rescue: safe mode, that screen off, and the server told
 * on the next bootstrap. The count resets at that point: the screen is off now, so whatever happens next is new.
 */
export function startLaunch(prev: BootGuard): LaunchStart {
  const g: BootGuard = { ...prev, off: [...prev.off] };
  let safe = false;
  let note = "";
  if (prev.open && prev.screen) {
    const s = prev.screen;
    g.crashes = prev.loopScreen === s ? prev.crashes + 1 : 1;
    g.loopScreen = s;
    if (g.crashes >= 2) {
      safe = true;
      note = `loop:${s}`;
      if (!g.off.includes(s) && g.off.length < MAX_OFF) g.off.push(s);
      g.crashes = 0;
    }
  }
  g.open = true;
  g.screen = "";
  return { guard: g, safe, note };
}

/**
 * A screen starts drawing. Written synchronously, because the point of it is to survive what happens next.
 *
 * It OPENS the record as well as naming the screen: a launch that went to the background closed it (leftLaunch), and
 * coming back to a screen that is drawing again is exactly when the crumb has to mean something again.
 */
export function drawingScreen(prev: BootGuard, screenId: string): BootGuard {
  return { ...prev, open: true, screen: id(screenId), off: [...prev.off] };
}

/**
 * The launch stayed up. Close it and forget the crashes.
 *
 * A launch that only stayed up BECAUSE a screen was switched off says nothing about that screen, so a rescue keeps
 * the list; an ordinary clean launch clears it, and the app is whole again.
 */
export function cleanLaunch(prev: BootGuard, wasSafe: boolean): BootGuard {
  return { open: false, screen: "", loopScreen: "", crashes: 0, off: wasSafe ? [...prev.off] : [] };
}

/**
 * THE LAUNCH LEFT THE FOREGROUND, and that is not a death.
 *
 * Without this the crumb only ever closed on a timer, so anything that ended a launch inside those few seconds —
 * someone force-quitting from the app switcher, a glance at a notification, a silent push that woke the app and was
 * suspended again — was left on disk as a launch killed mid-draw. Two of those on one screen and the next launch was
 * a rescue, with a screen switched off and `loop:` sent to the server, over a person doing nothing wrong.
 *
 * Reaching the background is proof the launch drew and survived, so the record closes and the crash count goes. The
 * device's own off list stays, unlike a clean launch's: a second in the foreground is not proof the app is whole, and
 * the next launch that really does stay up gives those screens back.
 */
export function leftLaunch(prev: BootGuard): BootGuard {
  return { open: false, screen: "", loopScreen: "", crashes: 0, off: [...prev.off] };
}

// ---------------------------------------------------------------------------
// The report bag
// ---------------------------------------------------------------------------

/** How many `bad` lines ride on a handshake. The whole report stays under anim §3.9's 512 bytes (safetyReportOf). */
export const MAX_BAD = 4;

/** The bytes the whole `sdui` report may take on the handshake (anim §3.9). */
export const REPORT_MAX_BYTES = 512;

/** How much of a type or screen id one `bad` line keeps. Four lines of these fit the cap with room for `why`. */
const LINE_MAX = 40;

/**
 * The node types that threw, one line per type and screen.
 *
 * Once per pair, because a node that throws throws on every render and the point is to name it, not to count it.
 * Only the type and the screen id — both ours, neither anything about the person.
 */
export class BadNodes {
  private seen: string[] = [];

  /** Returns true the first time this type+screen is heard of, so the caller can log it once too. */
  note(type: string, screen: string): boolean {
    const cut = (s: unknown): string => (typeof s === "string" ? s.slice(0, LINE_MAX) : "");
    const line = `${cut(type) || "?"}:${cut(screen) || "?"}`;
    if (this.seen.includes(line)) return false;
    if (this.seen.length < MAX_BAD) this.seen.push(line);
    return true;
  }

  list(): string[] {
    return [...this.seen];
  }

  any(): boolean {
    return this.seen.length > 0;
  }
}

/** What the handshake says about the safety floor (capabilities.ts `sdui`). */
export interface SafetyReport {
  /** This build HAS the floor: per-node boundaries, the kill switches and the crash guard. */
  safe: 1;
  /** Nothing has gone wrong on this launch. */
  ok: boolean;
  /** This launch is drawing in safe mode. */
  mode?: "safe";
  /** `<type>:<screen>` for each node that threw. */
  bad?: string[];
  /** Why safe mode is on, when the device decided it: `loop:<screen>`. */
  why?: string;
}

/**
 * The cap is a promise, not an estimate.
 *
 * Four lines of a long type on a long screen, plus a `why`, added up to more than anim §3.9's 512 bytes — on the one
 * launch that has most to say, the handshake would have been the thing that was too big. Lines are short now, and
 * whatever is still over the cap is dropped from the end until it fits: fewer names, always sent.
 */
export function safetyReportOf(bad: BadNodes, safe: boolean, why: string): SafetyReport {
  const out: SafetyReport = { safe: 1, ok: !bad.any() && !safe };
  if (safe) out.mode = "safe";
  if (bad.any()) out.bad = bad.list();
  if (why) out.why = id(why);
  while (out.bad && JSON.stringify(out).length > REPORT_MAX_BYTES) {
    out.bad.pop();
    if (!out.bad.length) delete out.bad;
  }
  return out;
}
