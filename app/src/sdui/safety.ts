/**
 * THE SAFETY FLOOR — what holds when the server is wrong.
 *
 * The app draws whatever the server describes, so every new construction is also a new way for the app to break in
 * front of someone. This is the floor underneath that, and it is three things:
 *
 *   1. A PER-NODE BOUNDARY (Renderer.tsx). A node that throws draws its own `fallback`, or nothing, and its siblings
 *      and the rest of the screen keep drawing. The type and the screen ride back on the next handshake.
 *   2. KILL SWITCHES, read through knobs.ts, so they come from `bootstrap.flags` and are cached on disk with the rest
 *      of the bootstrap — which means they still hold on a phone with no signal:
 *        sdui.safe   true          → no rules, no motion, no gestures, vocab-1 types only
 *        sdui.off    ["List", …]   → those node types, blocks or screen ids are treated as unknown
 *        sdui.motion "off"|"reduced"
 *   3. A CRASH-LOOP GUARD. The screen being drawn is written synchronously (storage.ts, MMKV); two launches killed on
 *      the same screen start the next one in safe mode with that screen switched off, and say so. Only the
 *      foreground counts: a launch that reached the background, or was never in front of anyone, did not die of a
 *      screen, and the record closes rather than blaming one.
 *
 * Every default changes nothing: with no flags set and no crash behind it, the floor is open and the app draws as it
 * always did.
 *
 * The decisions themselves are in safetyCore.ts, pure and tested in Node. This file is only the wiring: the knobs,
 * the synchronous store, and the one launch's worth of state.
 */
import { AppState } from "react-native";
import { bool, list, num, str } from "./knobs";
import { readBootGuardSync, writeBootGuardSync } from "../storage";
import {
  BadNodes, type BootGuard, type Floor, type SafetyReport,
  EMPTY_GUARD,
  cleanLaunch, drawingScreen, floorFrom, gesturesOn as coreGesturesOn, leftLaunch, nodeOff as coreNodeOff,
  readGuard, rulesOn as coreRulesOn, safetyReportOf, screenOff as coreScreenOff, startLaunch,
} from "./safetyCore";

// This launch's own state. Nothing here survives the process; the record on disk is the only thing that does.
let guard: BootGuard = { ...EMPTY_GUARD, off: [] };
let deviceSafe = false;
let why = "";
let diedOn = "";
let drawing = "";
let started = false;
let cleanTimer: ReturnType<typeof setTimeout> | null = null;
let appSub: { remove: () => void } | null = null;
const bad = new BadNodes();

/**
 * Open this launch, once, the first time anything asks.
 *
 * Lazily rather than from an entry point on purpose: the floor is read by the renderer on its very first node, so
 * asking it IS the earliest moment, and no file can forget to call it. Idempotent and synchronous.
 */
function ensureStarted(): void {
  if (started) return;
  started = true;
  const prev = readGuard(readBootGuardSync());
  diedOn = prev.open ? prev.screen : "";
  const r = startLaunch(prev);
  guard = r.guard;
  deviceSafe = r.safe;
  why = r.note;
  writeBootGuardSync(JSON.stringify(guard));
  watchForeground();
}

/**
 * LEAVING THE FOREGROUND CLOSES THE CRUMB, AND COMING BACK OPENS IT AGAIN.
 *
 * The timer below is not enough on its own: an app force-quit from the switcher, or backgrounded and later reclaimed
 * by the OS, ends inside those few seconds with the record still open, and reads on the next launch as a launch that
 * died mid-draw. Two of those on one screen and someone who never saw a crash gets a rescue launch with that screen
 * switched off. Reaching the background is proof the launch drew and lived, so it closes the record itself.
 *
 * Coming back re-opens it on the screen still being drawn, so the guard keeps working for the rest of the launch.
 */
function watchForeground(): void {
  if (appSub) return;
  try {
    appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") noteBack(); else noteLeft();
    });
  } catch { /* no AppState (tests, and any host without one): the timer alone, as before */ }
}

/** Only the foreground draws screens. A launch the OS woke in the background cannot die of a screen it never showed. */
function inForeground(): boolean {
  try {
    const s = AppState.currentState;
    return s !== "background" && s !== "inactive";
  } catch {
    return true;
  }
}

// The floor is asked once per node drawn, so it is worked out once per set of answers and kept until one of them
// changes — which is to say, until a new bootstrap lands. Three reads and a string compare on the hot path.
let cachedFloor: Floor | null = null;
let cachedFrom = "";

/** The kill switches and the crash guard, as one answer. */
export function floor(): Floor {
  ensureStarted();
  const knobs = { safe: bool("sdui.safe", false), off: list<string>("sdui.off", []), motion: str("sdui.motion", "on") };
  const key = `${knobs.safe}|${knobs.motion}|${knobs.off.join(",")}|${deviceSafe}|${guard.off.join(",")}`;
  if (cachedFloor && cachedFrom === key) return cachedFloor;
  cachedFrom = key;
  cachedFloor = floorFrom(knobs, { safe: deviceSafe, off: guard.off });
  return cachedFloor;
}

/** Treat this node type as unknown, so its `fallback` draws (or nothing). */
export function nodeOff(type: string): boolean {
  return coreNodeOff(type, floor());
}

/** This whole screen is switched off — by the server, or by the crash guard after two launches died on it. */
export function screenOff(screenId: string): boolean {
  return coreScreenOff(screenId, floor());
}

/** Motion as this launch is allowed to play it. "reduced" means the same thing Reduce Motion means here: be there already. */
export function motionMode(): Floor["motion"] {
  return floor().motion;
}

/** Gestures are live. Safe mode drops them. */
export function gesturesOn(): boolean {
  return coreGesturesOn(floor());
}

/** Rules and timers run. Safe mode freezes them. */
export function rulesOn(): boolean {
  return coreRulesOn(floor());
}

/** Safe mode, however it got turned on. */
export function safeMode(): boolean {
  return floor().safe;
}

/**
 * A screen is about to draw. Written to disk on the spot, because its whole job is to outlive what happens next.
 *
 * Also starts the clock on a clean launch: once the app has held a screen for a few seconds it has plainly not died
 * of it, so the crash count goes back to nothing.
 */
export function noteScreen(screenId: string): void {
  ensureStarted();
  if (!screenId || screenId === drawing) return;
  drawing = screenId;
  // A background launch (a silent push, a widget refresh) reaches here without a person ever seeing the screen, and
  // nothing it does counts as dying of one. The crumb waits for the foreground, which noteBack opens it on.
  if (!inForeground()) return;
  openCrumb();
}

function openCrumb(): void {
  guard = drawingScreen(guard, drawing);
  writeBootGuardSync(JSON.stringify(guard));
  if (!cleanTimer) cleanTimer = setTimeout(markClean, num("sdui.cleanAfterMs", 4000));
}

/** The launch stayed up. Close the record (safetyCore explains what a rescue keeps). */
export function markClean(): void {
  if (cleanTimer) { clearTimeout(cleanTimer); cleanTimer = null; }
  guard = cleanLaunch(guard, deviceSafe);
  writeBootGuardSync(JSON.stringify(guard));
}

/** The app left the foreground: it plainly did not die mid-draw, so the record closes (safetyCore.leftLaunch). */
function noteLeft(): void {
  if (cleanTimer) { clearTimeout(cleanTimer); cleanTimer = null; }
  if (!guard.open) return;
  guard = leftLaunch(guard);
  writeBootGuardSync(JSON.stringify(guard));
}

/** Back in the foreground, still on the same screen: the crumb opens again and the clock starts over. */
function noteBack(): void {
  if (guard.open || !drawing) return;
  openCrumb();
}

/**
 * A node threw while drawing. Named once per type and screen, and never more than a handful per launch.
 *
 * The type and the screen id are ours; nothing about the person goes anywhere near this.
 */
export function noteBadNode(type: string, err?: unknown): void {
  if (!bad.note(type, drawing)) return;
  // eslint-disable-next-line no-console
  console.warn(`[Tailzu][sdui] bad: ${type}:${drawing || "?"}`, err instanceof Error ? err.message : err);
}

/** What the handshake says about the floor (capabilities.ts `sdui`). */
export function safetyReport(): SafetyReport {
  ensureStarted();
  return safetyReportOf(bad, floor().safe, why);
}

/** What THIS DEVICE turned off for itself — the crash guard's screens, never the server's own list (SPEC 2.11). */
export function deviceOff(): string[] {
  ensureStarted();
  return [...guard.off];
}

/**
 * THE SYNCHRONOUS HALF OF THE BOOT BREADCRUMB, for LAST_BOOT_NOTE (client/capabilities.ts).
 *
 * The crumb that already rides on every bootstrap is written to AsyncStorage, which lands too late to name the
 * screen a launch died on. This is what the synchronous record knows instead: `died=<screen>`, and `loop:<screen>`
 * when it has now happened twice and the rescue fired. Empty on an ordinary launch, so the crumb reads as it did.
 */
export function lastBootNote(): string {
  ensureStarted();
  if (!diedOn) return "";
  return why ? `died=${diedOn} ${why}` : `died=${diedOn}`;
}
