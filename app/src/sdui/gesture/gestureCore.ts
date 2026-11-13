/**
 * GESTURES ON ANY NODE: the rules, compiled (pure SPEC 2.5, block B5). GestureView.tsx wires them to fingers.
 *
 * A node carries a list of gestures. Each one says what it listens for (a tap, a double tap, a long press, a
 * drag, a pan, a swipe, a pinch, a hover), where its value goes (`into`, a name under `ui.`), and what to do
 * when it commits or is given up. This replaces every one-off: SwipeAction, SwipePill's drag, PullBot's pull,
 * ScreenHoldTouches, and the global 260 ms tap delay that DoubleTap needed — a double tap is now per node, so
 * no other tap in the app waits for it.
 *
 * TWO KINDS OF `ui.*` VALUE, and the difference is the whole design:
 *   - WHILE A FINGER MOVES, `ui.<into>.x / y / scale / progress` live only as UI-thread shared values, and only
 *     `motion.drive` reads them. Nothing crosses to JavaScript, so following a finger never waits on a render.
 *   - WHEN THE GESTURE ENDS, the settled values are written to the store, once. In expressions, in `commitIf`
 *     and in rules, `ui.*` always means that: the value at the end.
 *
 * Built like pullBotCore.ts: every function a frame calls is a worklet and plain TypeScript, numbers only, no
 * imports, nothing allocated in a frame. The compiling half runs once per screen on the JS thread.
 *
 * Degrade rule (SPEC 2.0 principle 5): nothing here throws. A gesture that cannot be read is left out and named
 * in `bad`; the others still work.
 */

// ===================================================================== limits and defaults

/**
 * SPEC 5.1's gesture and path numbers. They are the kernel's (src/sdui/kernel/limits.ts) and this is a copy,
 * because this block is written beside the kernel and may not import it yet. When V1 wires the kernel in, these
 * should come from LIMITS and this table should go.
 */
export const GESTURE_LIMITS = {
  /** Live gestures on one screen. */
  perScreen: 12,
  /** Gestures on one node. */
  perNode: 6,
  /** Snap points in one drag. */
  snaps: 16,
  /** A state path: segments and characters. */
  pathSegments: 12,
  pathChars: 128,
} as const;

/**
 * The defaults, each one a knob the server can retune for everyone (GestureView.tsx reads `gesture.*` and
 * hands them in). The literals here are only what holds before the first bootstrap has ever arrived.
 */
export const GESTURE_DEFAULTS = {
  /** The window a second tap has to land in to be a double tap. The old global delay, now per node. */
  doubleTapMs: 260,
  /** How long a press is held before it is a long press. */
  longPressMs: 500,
  /** How far a finger may wander and still count as a tap or a long press. */
  slopPx: 12,
  /** A swipe: how far, and how fast, before it counts. */
  swipeDistance: 48,
  swipeVelocity: 320,
  /** How far a drag's own speed carries it when the finger lifts, in milliseconds of travel. */
  projectMs: 90,
  /** A dragged value's spring home, when it is let go or sent back. */
  springK: 220,
  springDamp: 0.85,
  /** How far past its bounds a drag may be pulled, before the rubber band stops giving. */
  rubberPx: 120,
} as const;

/** The same shape, as the server may send it: every default, all numbers. */
export type GestureDefaults = { -readonly [K in keyof typeof GESTURE_DEFAULTS]: number };

/** The kinds a gesture may be. A name outside this list is not a gesture this build will ever have. */
export const GESTURE_KINDS = Object.freeze([
  "tap", "doubleTap", "longPress", "drag", "pan", "swipe", "pinch", "hover",
] as const);

export type GestureKind = (typeof GESTURE_KINDS)[number];

/** How a gesture gets on with the others: alone, alongside, or only once another has given up. */
export const CLAIM_EXCLUSIVE = 0, CLAIM_SIMULTANEOUS = 1, CLAIM_AFTER = 2;

/** Which way a drag or a swipe may go. */
export const AXIS_X = 0, AXIS_Y = 1, AXIS_BOTH = 2;

/** What `swipeOf` answers. Numbers, because it answers on the UI thread. */
export const SWIPE_NONE = 0, SWIPE_LEFT = 1, SWIPE_RIGHT = 2, SWIPE_UP = 3, SWIPE_DOWN = 4;

// ===================================================================== the arithmetic (worklets)

/** Hold a number between two others. */
export function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The rubber band past a bound: the further out it is pulled, the less it gives, and it never reaches `pull`.
 * The curve SwipePill and PullBot already use, so a drag past its end feels the same everywhere in the app.
 */
export function rubber(over: number, pull: number): number {
  "worklet";
  if (pull <= 0) return 0;
  const a = over < 0 ? -over : over;
  const y = (a * pull) / (a + pull);
  return over < 0 ? -y : y;
}

/** A value held in bounds, with a rubber band outside them when the gesture asked for one. */
export function bounded(v: number, lo: number, hi: number, pull: number): number {
  "worklet";
  if (v < lo) return pull > 0 ? lo + rubber(v - lo, pull) : lo;
  if (v > hi) return pull > 0 ? hi + rubber(v - hi, pull) : hi;
  return v;
}

/**
 * Where a value would coast to when the finger lifts: its speed carried on for `ms` of travel. The honest
 * version of iOS's deceleration, short enough that a flick lands where it looks like it is going.
 */
export function project(v: number, velocity: number, ms: number): number {
  "worklet";
  const p = v + (velocity * ms) / 1000;
  return p === p ? p : v;
}

/** The snap point nearest a value, or the value itself when there are none. */
export function nearestSnap(v: number, points: readonly number[]): number {
  "worklet";
  if (points.length === 0) return v;
  let best = points[0];
  let bestD = v - best < 0 ? best - v : v - best;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const d = v - p < 0 ? p - v : v - p;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/**
 * Where a drag ends up: its own speed carries it, the snap points pull it to the nearest, and the bounds hold
 * it. In that order, because a flick should be able to cross to the next snap point but never off the end.
 */
export function settle(
  v: number, velocity: number, lo: number, hi: number, snaps: readonly number[], projectMs: number,
): number {
  "worklet";
  const p = project(v, velocity, projectMs);
  const s = nearestSnap(p, snaps);
  return clamp(s, lo, hi);
}

/** How far along its run a value is, 0 to 1. A run of nothing is 0, never a division by nothing. */
export function progressOf(v: number, lo: number, hi: number): number {
  "worklet";
  const span = hi - lo;
  if (!(span > 0)) return 0;
  return clamp((v - lo) / span, 0, 1);
}

/**
 * Which way a swipe went, if it went anywhere: far enough OR fast enough, on the axis the gesture allows. Far
 * enough OR fast enough rather than both, because a short flick and a long slow drag are both plainly a swipe.
 */
export function swipeOf(
  dx: number, dy: number, vx: number, vy: number, axis: number, distance: number, velocity: number,
): number {
  "worklet";
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  const avx = vx < 0 ? -vx : vx, avy = vy < 0 ? -vy : vy;
  // Sideways when the gesture only allows sideways, or when it allows either and the finger went that way.
  // An axis the gesture does not allow cannot reach the other branch, so there is no second guard for it.
  const horizontal = axis === AXIS_X || (axis === AXIS_BOTH && ax >= ay);
  if (horizontal) {
    if (ax < distance && avx < velocity) return SWIPE_NONE;
    return dx < 0 ? SWIPE_LEFT : SWIPE_RIGHT;
  }
  if (ay < distance && avy < velocity) return SWIPE_NONE;
  return dy < 0 ? SWIPE_UP : SWIPE_DOWN;
}

// ===================================================================== which values a gesture owns

/**
 * THE FOUR `ui.<into>` VALUES, as a bit each.
 *
 * A gesture owns only the values its own fingers move, and writes only those when it ends. Two gestures on one
 * `into` is the usual photo viewer — a pan and a pinch, both `into: "photo"`, both `claim: "simultaneous"` —
 * and if each wrote all four, every pinch would put the stored x and y back to nothing while the picture sat
 * somewhere else, and every pan would put the stored scale back to 1.
 */
export const UI_X = 1, UI_Y = 2, UI_SCALE = 4, UI_PROGRESS = 8;

/** Which of the four this kind writes. A drag locked to one axis does not own the other one. */
export function uiFields(kind: GestureKind, axis: number): number {
  if (kind === "pinch") return UI_SCALE;
  if (kind === "drag" || kind === "pan") {
    let m = UI_PROGRESS;
    if (axis !== AXIS_Y) m |= UI_X;
    if (axis !== AXIS_X) m |= UI_Y;
    return m;
  }
  // tap, doubleTap, longPress, swipe and hover all say where the finger was and whether they happened.
  return UI_X | UI_Y | UI_PROGRESS;
}

/** The end values, cut down to the ones this gesture owns: what goes into the store. */
export function pickUi(fields: number, x: number, y: number, scale: number, progress: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (fields & UI_X) out.x = x;
  if (fields & UI_Y) out.y = y;
  if (fields & UI_SCALE) out.scale = scale;
  if (fields & UI_PROGRESS) out.progress = progress;
  return out;
}

/**
 * What `onCancel: { kind: "spring", to }` writes: the axis that was dragged, put back, and how far along that
 * leaves it. The other axis is left exactly where it was, because nothing asked it to move.
 */
export function cancelUi(axis: number, to: number, progress: number): Record<string, number> {
  const out: Record<string, number> = { progress };
  if (axis !== AXIS_Y) out.x = to;
  if (axis !== AXIS_X) out.y = to;
  return out;
}

/** Where a gesture's values sit when nothing has touched them yet, so a second mount starts where a first did. */
export function restUi(fields: number, min: number, max: number): Record<string, number> {
  const at = clamp(0, min, max);
  const out: Record<string, number> = {};
  if (fields & UI_X) out.x = at;
  if (fields & UI_Y) out.y = at;
  if (fields & UI_SCALE) out.scale = 1;
  if (fields & UI_PROGRESS) out.progress = progressOf(at, min, max);
  return out;
}

// ===================================================================== names and paths

/**
 * An `into` name: where a gesture's values go, under `ui.`. The path rules of SPEC 5.1, so a gesture can never
 * write somewhere a state path could not — including the three names that would reach an object's own guts.
 */
export function okInto(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > GESTURE_LIMITS.pathChars) return false;
  const parts = name.split(".");
  if (parts.length > GESTURE_LIMITS.pathSegments) return false;
  for (const p of parts) {
    if (!p) return false;
    if (p === "__proto__" || p === "constructor" || p === "prototype") return false;
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
      if (!ok) return false;
    }
  }
  return true;
}

// ===================================================================== the compiled shape

/** One gesture, read and made safe. Numbers where a frame needs them; the actions stay as the server sent them. */
export interface Gesture {
  kind: GestureKind;
  /** Where the values go, under `ui.`; "" when this gesture keeps none. */
  into: string;
  /** Which of the four values this gesture owns and writes when it ends (UI_X | UI_Y | …). */
  fields: number;
  /** Which way it may go (drag, pan, swipe). */
  axis: number;
  /** A drag's run and its snap points. */
  min: number;
  max: number;
  snaps: number[];
  /** How far past the bounds it may be pulled; 0 for a hard stop. */
  rubber: number;
  /** The spring it settles with. */
  springK: number;
  springDamp: number;
  projectMs: number;
  /** Taps: how many, and the window between them. Long press: how long. Both: how far a finger may wander. */
  taps: number;
  windowMs: number;
  holdMs: number;
  slop: number;
  /** A swipe's thresholds. */
  distance: number;
  velocity: number;
  /** A pinch's run. */
  minScale: number;
  maxScale: number;
  /** CLAIM_EXCLUSIVE | CLAIM_SIMULTANEOUS | CLAIM_AFTER, and the id it waits for. */
  claim: number;
  after: string;
  /** This gesture's own id, so another can wait for it. */
  id: string;
  /** The server's actions, untouched: the host runs them. `commitIf` is a condition the host evaluates. */
  do: unknown;
  commitIf: unknown;
  onCommit: unknown;
  onCancel: unknown;
  onLeft: unknown;
  onRight: unknown;
  onUp: unknown;
  onDown: unknown;
  /** `onCancel: { kind: "spring", to }` is ours, not an action: the value springs back here instead. */
  cancelTo: number | null;
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pos = (v: unknown, dflt: number, hi: number): number => clamp(fin(v) ?? dflt, 0, hi);

function axisOf(raw: unknown, dflt: number): number {
  return raw === "x" ? AXIS_X : raw === "y" ? AXIS_Y : raw === "both" ? AXIS_BOTH : dflt;
}

function claimOf(raw: unknown): { claim: number; after: string } {
  if (raw === "simultaneous") return { claim: CLAIM_SIMULTANEOUS, after: "" };
  if (typeof raw === "string" && raw.startsWith("after:")) {
    const id = raw.slice(6);
    if (id) return { claim: CLAIM_AFTER, after: id };
  }
  return { claim: CLAIM_EXCLUSIVE, after: "" };
}

/** `onCancel: { kind: "spring", to: 0 }` — the one action a gesture answers itself, because it is a value move. */
function cancelSpring(raw: unknown): number | null {
  if (!isRec(raw) || raw.kind !== "spring") return null;
  return fin(raw.to) ?? 0;
}

function readSnaps(raw: unknown, bad: string[], where: string): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { bad.push(`${where}.snap: a list of numbers`); return []; }
  if (raw.length > GESTURE_LIMITS.snaps) { bad.push(`${where}.snap: at most ${GESTURE_LIMITS.snaps} points`); return []; }
  const out: number[] = [];
  for (const v of raw) {
    const n = fin(v);
    if (n === null) { bad.push(`${where}.snap: numbers`); return []; }
    out.push(n);
  }
  return out;
}

/** Read one gesture. Returns null when there is nothing usable, with the reason in `bad`. */
function readGesture(raw: unknown, where: string, bad: string[], d: GestureDefaults): Gesture | null {
  if (!isRec(raw)) { bad.push(`${where}: a gesture`); return null; }
  const kind = raw.kind;
  if (typeof kind !== "string" || !(GESTURE_KINDS as readonly string[]).includes(kind)) {
    bad.push(`${where}.kind: one of ${GESTURE_KINDS.join(", ")}`);
    return null;
  }
  let into = "";
  if (raw.into !== undefined && raw.into !== null) {
    if (!okInto(raw.into)) { bad.push(`${where}.into: a plain name of at most ${GESTURE_LIMITS.pathSegments} parts`); return null; }
    into = raw.into;
  }
  const min = fin(raw.min) ?? 0;
  const maxRaw = fin(raw.max);
  // A run that ends before it starts is a server mistake, not a reason to draw nothing: it collapses to a point.
  const max = maxRaw === null ? (kind === "pinch" ? 0 : min) : Math.max(min, maxRaw);
  const { claim, after } = claimOf(raw.claim);
  const axis = axisOf(raw.axis, kind === "drag" || kind === "swipe" ? AXIS_X : AXIS_BOTH);
  const g: Gesture = {
    kind: kind as GestureKind,
    into,
    fields: uiFields(kind as GestureKind, axis),
    axis,
    min,
    max,
    snaps: readSnaps(raw.snap, bad, where),
    rubber: raw.rubber === true ? d.rubberPx : pos(raw.rubber, 0, 1000),
    springK: clamp(fin(raw.springK) ?? d.springK, 1, 10000),
    springDamp: clamp(fin(raw.springDamp) ?? d.springDamp, 0.05, 4),
    projectMs: pos(raw.projectMs, d.projectMs, 1000),
    taps: kind === "doubleTap" ? 2 : clamp(Math.round(fin(raw.taps) ?? 1), 1, 3),
    windowMs: pos(raw.window, d.doubleTapMs, 2000),
    holdMs: pos(raw.hold, d.longPressMs, 10000),
    slop: pos(raw.slop, d.slopPx, 200),
    distance: pos(raw.distance, d.swipeDistance, 2000),
    velocity: pos(raw.velocity, d.swipeVelocity, 20000),
    minScale: clamp(fin(raw.minScale) ?? 0.5, 0.05, 20),
    maxScale: clamp(fin(raw.maxScale) ?? 4, 0.05, 20),
    claim,
    after,
    id: typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : "",
    do: raw.do ?? null,
    commitIf: raw.commitIf ?? null,
    onCommit: raw.onCommit ?? null,
    onCancel: cancelSpring(raw.onCancel) === null ? (raw.onCancel ?? null) : null,
    onLeft: raw.onLeft ?? null,
    onRight: raw.onRight ?? null,
    onUp: raw.onUp ?? null,
    onDown: raw.onDown ?? null,
    cancelTo: cancelSpring(raw.onCancel),
  };
  if (g.maxScale < g.minScale) g.maxScale = g.minScale;
  return g;
}

/**
 * Order a node's gestures so that one asking to run `after:<id>` comes after the one it names. A cycle, or a
 * name nobody has, leaves the order as written: it is a server mistake, and a mistake must not hang a screen.
 */
export function claimOrder(list: readonly Gesture[]): Gesture[] {
  const out: Gesture[] = [];
  const left = [...list];
  let guard = left.length * left.length + 1;
  while (left.length > 0 && guard-- > 0) {
    let moved = false;
    for (let i = 0; i < left.length; i++) {
      const g = left[i];
      const waits = g.claim === CLAIM_AFTER && g.after
        && left.some((o, j) => j !== i && o.id === g.after);
      if (waits) continue;
      out.push(g);
      left.splice(i, 1);
      moved = true;
      break;
    }
    if (!moved) break;
  }
  for (const g of left) out.push(g);
  return out;
}

/**
 * Compile a node's `gestures`. Never throws. More than this node may hold is cut, with a note; a gesture that
 * cannot be read is left out and the others still work.
 */
export function compileGestures(raw: unknown, d: GestureDefaults = GESTURE_DEFAULTS): { list: Gesture[]; bad: string[] } {
  const bad: string[] = [];
  if (raw === undefined || raw === null) return { list: [], bad };
  if (!Array.isArray(raw)) { bad.push("gestures: a list"); return { list: [], bad }; }
  const list: Gesture[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (list.length >= GESTURE_LIMITS.perNode) { bad.push(`gestures: at most ${GESTURE_LIMITS.perNode} on one node`); break; }
    const g = readGesture(raw[i], `gestures[${i}]`, bad, d);
    if (g) list.push(g);
  }
  return { list: claimOrder(list), bad };
}

/** True when a node's gestures move a value a finger follows, which is the only reason to keep shared values. */
export function needsValues(list: readonly Gesture[]): boolean {
  for (const g of list) if (g.into) return true;
  return false;
}
