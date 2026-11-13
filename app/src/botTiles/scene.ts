/**
 * SCENES: THE LOOKS FORMAT 2 ANIMATION LANGUAGE (anim/SPEC.md sections 2 and 3).
 *
 * A scene is data: layered shapes that morph, turn and scale; dot fields where every dot follows its own formula;
 * springs; ropes and closed soft rings (chains); groups that act as joints; repeats; keyframes; and live inputs
 * (taps, his voice, his own motion, the moment's events). It is interpreted here, by the one core the phone, the
 * window and the server all run, so a new animation this language can express is a server push, not a release.
 *
 * Nothing here imports anything: core.ts hands in the expression compiler (so the dependency runs one way) and the
 * host hands in a drawing context. genDesktop.mjs puts this file and core.ts into one generated module. The one
 * exception is `renderStill` at the end, which reaches for Skia and the tile engine at call time, inside a try, so
 * the window and the server — handed the same generated module, with neither — simply get a null back.
 *
 * Three rules worth knowing before reading on:
 *   - every value is a number, an expression, keyframes or a spring; never code, never a string the host runs;
 *   - frames never parse and never allocate: every buffer is made when a scene starts playing and reused;
 *   - a scene that misbehaves while playing is dropped alone (SceneRun.dead), and the bot, the grid and the loop
 *     carry on. A catalog that does not compile is refused whole, by the caller, as today.
 */

/** The drawing vocabulary a scene needs: core.ts's TileCtx, with the four members format 2 added (all optional). */
export interface SceneCtx {
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "round" | "miter" | "bevel";
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  stroke(): void;
  bezierCurveTo?(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  clip?(): void;
  dots?(xy: Float32Array, n: number, radius: number, color: string): void;
}

/** A compiled number, as core.ts's expression compiler makes it: a constant, or bytecode over named values. */
export interface Xp { c: number; code: Float64Array | null }

/** core.ts hands this in: its compiler, its runner, and the opcodes, so the hoister can read and write bytecode. */
export interface XApi {
  compile(src: string, names: readonly string[]): Xp;
  run(code: Float64Array, vars: Float64Array): number;
  ops: { NUM: number; VAR: number; NEG: number; NOT: number; BIN: number; TERN: number; CALL: number };
}

/**
 * The budgets. Starting values (anim/SPEC.md 3.7), set from the device session before format 2 is frozen. The server
 * reads this very table out of the generated engine, so the two can never disagree.
 */
export const SCENE_LIMITS = {
  /** Executed expression ops per frame, counted at compile time after hoisting. */
  ops: 8000,
  opsScreen: 12000,
  dotsEl: 400,
  dotsScene: 600,
  dotsScreen: 600,
  /** Drawing calls per scene per frame: each dots() group and each shape counts one. */
  draws: 160,
  els: 24,
  depth: 3,
  repeat: 32,
  pathTokens: 900,
  morph: 4,
  keys: 64,
  keysScene: 512,
  vars: 8,
  emit: 4,
  events: 8,
  chains: 3,
  chainN: 24,
  chainIter: 4,
  /** Live at once: per moment, and over the whole screen. */
  liveMoment: 2,
  liveScreen: 4,
  scenes: 48,
  bytes: 24576,
  boxW: 3,
  boxH: 2,
  catalogBytes: 262144,
  /** The governor: over this many milliseconds (step, evaluation and draw together) a scene freezes, then is dropped. */
  ms: 2.0,
} as const;

/** The physics step, as core.ts's. Chains and springs are stepped at this, whatever the frame rate. */
const SSTEP = 1 / 120;
const SMAX_FRAME = 1 / 20;
const TAU2 = Math.PI * 2;

/**
 * The names every scene expression may read, in the order their values are handed to it. The host writes them into
 * SceneRun.base each frame. A scene's own `ev.<name>`s and `vars` follow these, then (inside a dot field) the per-dot
 * names, or (inside a repeat) `j` and `nj`.
 */
export const SCENE_BASE = [
  "t", "u", "T", "D", "beat", "k", "side", "rnd", "rnd2", "W", "x", "px",
  "vx", "level", "talk", "tapx", "tapy", "tapt", "taps", "seed",
] as const;
export const NBASE = SCENE_BASE.length;
/** Where the host writes each base name (the rest follow SCENE_BASE's order). */
export const B_T = 0, B_U = 1, B_TT = 2, B_D = 3, B_BEAT = 4, B_K = 5, B_SIDE = 6, B_RND = 7, B_RND2 = 8, B_W = 9;
export const B_X = 10, B_PX = 11, B_VX = 12, B_LEVEL = 13, B_TALK = 14, B_TAPX = 15, B_TAPY = 16, B_TAPT = 17, B_TAPS = 18, B_SEED = 19;

/** The per-dot names a dot field's expressions may also read, and the two a repeat's child may. */
const DOT_NAMES = ["i", "col", "row", "n", "qx", "qy", "d", "ang"];
const REP_NAMES = ["j", "nj"];

/** What a name costs to read: it changes every frame (FRAME), per dot or per instance (DOT), or neither (once a play). */
const C_FRAME = 1, C_DOT = 2;
/** The base names that are the same for a whole play: the rest change with the frame. */
const BASE_STILL = new Set(["D", "rnd", "rnd2", "W", "seed"]);
/** Of the per-dot names, `n` (the count) and `nj` are the same for every dot. */
const DOT_STILL = new Set(["n", "nj"]);

const sclamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const isRec2 = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const SPAINT_RE = /^#[0-9a-fA-F]{6}$/;
const okScenePaint = (p: unknown): boolean =>
  typeof p === "string" && (SPAINT_RE.test(p) || p === "$color" || p === "$paint" || p === "ink" || p === "paper");

// ===================================================================== values

const V_CONST = 0, V_EXPR = 1, V_KEYS = 2, V_SPRING = 3;

/** One number of a scene: a constant, an expression, keyframes over some clock, or a spring chasing a target. */
export class Val {
  kind = V_CONST;
  c = 0;
  code: Float64Array | null = null;
  /** Keyframes, flat: time, value, ease, and a cubic ease's four numbers. */
  keys: Float64Array | null = null;
  by: Val | null = null;
  loop = false;
  /** A spring: what it chases, its stiffness and damping, and where its state lives in the run. */
  target: Val | null = null;
  k = 160;
  damp = 0.8;
  slot = -1;
  /** Executed ops, for the budget. */
  ops = 0;
}

const VZERO = new Val();

const KSTRIDE = 7;
const E_LIN = 0, E_IN = 1, E_OUT = 2, E_INOUT = 3, E_STEP = 4, E_CUBIC = 5;
const EASES: Record<string, number> = { lin: E_LIN, in: E_IN, out: E_OUT, inout: E_INOUT, step: E_STEP };

/** Count the ops bytecode runs: with no jumps in the language, what is compiled is what runs. */
function countOps(code: Float64Array | null, X: XApi): number {
  if (!code) return 0;
  const o = X.ops;
  let n = 0;
  for (let i = 0; i < code.length; n++) {
    const op = code[i];
    i += op === o.CALL ? 3 : op === o.NUM || op === o.VAR || op === o.BIN ? 2 : 1;
  }
  return n;
}

/** A cubic-bezier ease, solved for y at x (Newton, then bisection: a handful of steps, no allocation). */
function cubicEase(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 12; i++) {
    const v = bx(u);
    if (v < x) lo = u; else hi = u;
    u = (lo + hi) / 2;
  }
  return by(u);
}

function easeAt(kind: number, e: Float64Array, at: number, w: number): number {
  if (kind === E_STEP) return w >= 1 ? 1 : 0;
  if (kind === E_IN) return w * w;
  if (kind === E_OUT) return 1 - (1 - w) * (1 - w);
  if (kind === E_INOUT) return w * w * (3 - 2 * w);
  if (kind === E_CUBIC) return cubicEase(e[at + 3], e[at + 4], e[at + 5], e[at + 6], w);
  return w;
}

/** Compile one numeric field. `names` are what it may read; `springs` collects the springs so the run can step them. */
function compileVal(raw: unknown, names: readonly string[], X: XApi, springs: Val[], errs: string[], at: string, keyBudget: { n: number }): Val {
  const v = new Val();
  if (raw == null) return v;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) { errs.push(`${at}: a number`); return v; }
    v.c = raw;
    return v;
  }
  if (typeof raw === "string") {
    try {
      const xp = X.compile(raw, names);
      if (xp.code) { v.kind = V_EXPR; v.code = xp.code; v.ops = countOps(xp.code, X); } else v.c = xp.c;
    } catch (e) { errs.push(`${at}: ${(e as Error).message}`); }
    return v;
  }
  if (!isRec2(raw)) { errs.push(`${at}: a number, an expression, keyframes or a spring`); return v; }
  if (raw.spring !== undefined) {
    for (const k of Object.keys(raw)) if (!["spring", "k", "damp"].includes(k)) errs.push(`${at}: unknown field ${k}`);
    v.kind = V_SPRING;
    v.target = compileVal(raw.spring, names, X, springs, errs, `${at}.spring`, keyBudget);
    if (v.target.kind === V_SPRING) errs.push(`${at}: a spring cannot chase a spring`);
    v.k = typeof raw.k === "number" && raw.k > 0 && raw.k <= 2000 ? raw.k : 160;
    if (raw.k != null && v.k !== raw.k) errs.push(`${at}.k: in (0, 2000]`);
    v.damp = typeof raw.damp === "number" && raw.damp >= 0 && raw.damp <= 4 ? raw.damp : 0.8;
    if (raw.damp != null && v.damp !== raw.damp) errs.push(`${at}.damp: in [0, 4]`);
    v.slot = springs.length;
    springs.push(v);
    v.ops = v.target.ops;
    return v;
  }
  if (Array.isArray(raw.k)) {
    for (const k of Object.keys(raw)) if (!["k", "by", "loop"].includes(k)) errs.push(`${at}: unknown field ${k}`);
    const list = raw.k as unknown[];
    if (!list.length || list.length > SCENE_LIMITS.keys) { errs.push(`${at}.k: 1 to ${SCENE_LIMITS.keys} keys`); return v; }
    keyBudget.n += list.length;
    const flat = new Float64Array(list.length * KSTRIDE);
    let last = -Infinity;
    list.forEach((key, i) => {
      const w = `${at}.k[${i}]`;
      if (!Array.isArray(key) || key.length < 2 || key.length > 3) { errs.push(`${w}: [time, value] or [time, value, ease]`); return; }
      const time = Number(key[0]), value = Number(key[1]);
      if (!Number.isFinite(time) || !Number.isFinite(value)) { errs.push(`${w}: numbers`); return; }
      if (time < last) errs.push(`${w}: keys go forward in time`);
      last = time;
      flat[i * KSTRIDE] = time;
      flat[i * KSTRIDE + 1] = value;
      const ease = key[2];
      if (ease == null) flat[i * KSTRIDE + 2] = E_LIN;
      else if (typeof ease === "string" && ease in EASES) flat[i * KSTRIDE + 2] = EASES[ease];
      else if (Array.isArray(ease) && ease.length === 4 && ease.every((q) => typeof q === "number" && Number.isFinite(q))) {
        flat[i * KSTRIDE + 2] = E_CUBIC;
        for (let q = 0; q < 4; q++) flat[i * KSTRIDE + 3 + q] = Number(ease[q]);
      } else errs.push(`${w}: an ease (${Object.keys(EASES).join(", ")}) or [x1, y1, x2, y2]`);
    });
    v.kind = V_KEYS;
    v.keys = flat;
    v.by = raw.by === undefined ? null : compileVal(raw.by, names, X, springs, errs, `${at}.by`, keyBudget);
    if (v.by && v.by.kind === V_SPRING) errs.push(`${at}.by: not a spring`);
    v.loop = raw.loop === true;
    v.ops = (v.by?.ops ?? 0) + 1;
    return v;
  }
  errs.push(`${at}: a number, an expression, keyframes or a spring`);
  return v;
}

// ===================================================================== hoisting

/**
 * Per-dot and per-instance expressions are split three ways before they run (SPEC 3.2): the parts that read no
 * per-dot name run once a frame, the parts that read only rest names run once when the scene starts, and only what
 * is left runs per dot per frame. The language's bytecode has no jumps, so it is a post-order walk of a tree: this
 * rebuilds that tree, marks every node with what it reads, and writes three programs back out.
 */
interface HNode { op: number; a: number; b: number; kids: HNode[]; mask: number }

function readTree(code: Float64Array, X: XApi, classOf: (i: number) => number): HNode | null {
  const o = X.ops, stack: HNode[] = [];
  for (let i = 0; i < code.length;) {
    const op = code[i];
    let node: HNode;
    if (op === o.NUM) { node = { op, a: code[i + 1], b: 0, kids: [], mask: 0 }; i += 2; }
    else if (op === o.VAR) { node = { op, a: code[i + 1], b: 0, kids: [], mask: classOf(code[i + 1]) }; i += 2; }
    else if (op === o.NEG || op === o.NOT) { const k = stack.pop(); if (!k) return null; node = { op, a: 0, b: 0, kids: [k], mask: k.mask }; i += 1; }
    else if (op === o.BIN) {
      const r = stack.pop(), l = stack.pop();
      if (!l || !r) return null;
      node = { op, a: code[i + 1], b: 0, kids: [l, r], mask: l.mask | r.mask };
      i += 2;
    } else if (op === o.TERN) {
      const c = stack.pop(), b = stack.pop(), a = stack.pop();
      if (!a || !b || !c) return null;
      node = { op, a: 0, b: 0, kids: [a, b, c], mask: a.mask | b.mask | c.mask };
      i += 1;
    } else if (op === o.CALL) {
      const argc = code[i + 2], kids: HNode[] = [];
      for (let q = 0; q < argc; q++) { const k = stack.pop(); if (!k) return null; kids.unshift(k); }
      node = { op, a: code[i + 1], b: argc, kids, mask: kids.reduce((m, k) => m | k.mask, 0) };
      i += 3;
    } else return null;
    stack.push(node);
  }
  return stack.length === 1 ? stack[0] : null;
}

function emitTree(n: HNode, X: XApi, out: number[]): void {
  const o = X.ops;
  for (const k of n.kids) emitTree(k, X, out);
  if (n.op === o.NUM || n.op === o.VAR || n.op === o.BIN) out.push(n.op, n.a);
  else if (n.op === o.CALL) out.push(n.op, n.a, n.b);
  else out.push(n.op);
}

/** A per-dot expression, hoisted: what is left to run per dot, and the frame and static programs feeding its slots. */
export interface Hoisted {
  code: Float64Array | null;
  c: number;
  frame: Float64Array[];
  still: Float64Array[];
  opsFrame: number;
  opsStill: number;
  opsDot: number;
}

function hoist(xp: Xp, X: XApi, classOf: (i: number) => number, slot0: number): Hoisted {
  const out: Hoisted = { code: null, c: xp.c, frame: [], still: [], opsFrame: 0, opsStill: 0, opsDot: 0 };
  if (!xp.code) return out;
  const tree = readTree(xp.code, X, classOf);
  if (!tree) { out.code = xp.code; out.opsDot = countOps(xp.code, X); return out; }
  const o = X.ops;
  const leaf = (n: HNode) => n.op === o.NUM || n.op === o.VAR;
  // A node that does not read a per-dot name runs once a frame; one that reads no frame name runs once a play.
  const lift = (n: HNode): HNode => {
    if (leaf(n)) return n;
    if (!(n.mask & C_DOT)) {
      const code: number[] = [];
      emitTree(n, X, code);
      const bc = Float64Array.from(code);
      out.opsFrame += countOps(bc, X);
      out.frame.push(bc);
      return { op: o.VAR, a: slot0 + out.frame.length - 1, b: 0, kids: [], mask: 0 };
    }
    if (!(n.mask & C_FRAME)) {
      const code: number[] = [];
      emitTree(n, X, code);
      const bc = Float64Array.from(code);
      out.opsStill += countOps(bc, X);
      out.still.push(bc);
      return { op: o.VAR, a: -1 - (out.still.length - 1), b: 0, kids: [], mask: C_DOT };
    }
    n.kids = n.kids.map(lift);
    return n;
  };
  const top = lift(tree);
  // Static slots sit after the frame slots, which are only counted once every subtree has been lifted.
  const fix = (n: HNode): void => {
    if (n.op === o.VAR && n.a < 0) n.a = slot0 + out.frame.length + (-n.a - 1);
    for (const k of n.kids) fix(k);
  };
  fix(top);
  const code: number[] = [];
  emitTree(top, X, code);
  out.code = Float64Array.from(code);
  out.opsDot = countOps(out.code, X);
  return out;
}

// ===================================================================== paths

const SO_M = 1, SO_L = 2, SO_Q = 3, SO_C = 4, SO_Z = 5, SO_O = 6;
const SARGS: Record<number, number> = { 1: 2, 2: 2, 3: 4, 4: 6, 5: 0, 6: 3 };

/** The format-1 path grammar with cubics added: M x y, L x y, Q cx cy x y, C c1x c1y c2x c2y x y, Z, O cx cy r. */
function compilePath(d: unknown, errs: string[], at: string): Float64Array | null {
  if (typeof d !== "string") { errs.push(`${at}: d is the path`); return null; }
  const toks = d.replace(/([MLQCZO])/g, " $1 ").trim().split(/[\s,]+/).filter((x) => x !== "");
  if (toks.length > SCENE_LIMITS.pathTokens) { errs.push(`${at}: at most ${SCENE_LIMITS.pathTokens} path tokens`); return null; }
  const ops: number[] = [];
  let i = 0, first = true, bad = false;
  const num = (): number => {
    const v = Number(toks[i++]);
    if (!Number.isFinite(v) || Math.abs(v) > 3) { errs.push(`${at}: a number in [-3, 3] at "${toks[i - 1] ?? "end"}"`); bad = true; return 0; }
    return v;
  };
  while (i < toks.length && !bad) {
    const c = toks[i++];
    if (c === "M") ops.push(SO_M, num(), num());
    else if (c === "L" && !first) ops.push(SO_L, num(), num());
    else if (c === "Q" && !first) ops.push(SO_Q, num(), num(), num(), num());
    else if (c === "C" && !first) ops.push(SO_C, num(), num(), num(), num(), num(), num());
    else if (c === "Z" && !first) ops.push(SO_Z);
    else if (c === "O") ops.push(SO_O, num(), num(), num());
    else { errs.push(`${at}: "${c}" (paths are M, L, Q, C, Z and O, starting with M or O)`); bad = true; break; }
    first = false;
  }
  if (bad || !ops.length) { if (!ops.length && !bad) errs.push(`${at}: an empty path`); return null; }
  return Float64Array.from(ops);
}

/** Two paths morph only when they are the same commands in the same order. */
function sameShape(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length;) {
    if (a[i] !== b[i]) return false;
    i += 1 + SARGS[a[i]];
  }
  return true;
}

// ===================================================================== elements

const EL_SHAPE = 1, EL_DOTS = 2, EL_CHAIN = 3, EL_GROUP = 4, EL_REPEAT = 5, EL_PART = 6;
const GRID_HEX = 0, GRID_SQUARE = 1;

/** One element of a scene, compiled. Which fields matter depends on `kind`. */
export class SceneEl {
  id = "";
  kind = EL_SHAPE;
  /** The anchor it hangs on (core.ts's ANCHORS index), or -1 for the scene's own origin. */
  on = -1;
  x: Val = VZERO; y: Val = VZERO; rot: Val = VZERO; sx = VONE(); sy = VONE(); alpha = VONE(); show = VONE();
  back = false;
  // shape
  path: Float64Array | null = null;
  morph: Float64Array[] = [];
  m: Val = VZERO;
  fill = "";
  stroke = "";
  width: Val = VZERO;
  // dots
  grid = GRID_HEX;
  cols = 0; rows = 0; gap = 0.1;
  along = -1; alongN = 0;
  rmax = 0.05;
  pal: string[] = [];
  qx: Float32Array | null = null;
  qy: Float32Array | null = null;
  qd: Float32Array | null = null;
  qa: Float32Array | null = null;
  n = 0;
  /** A dot field's dots in all: `n` per copy, times `rmul`. The run's buffers are this long, copy by copy. */
  nAll = 0;
  hr: Hoisted | null = null;
  hdx: Hoisted | null = null;
  hdy: Hoisted | null = null;
  hpaint: Hoisted | null = null;
  /** The same four, in order, and where each one's still values sit: made at compile time, so a frame makes none. */
  hall: Array<Hoisted | null> = [];
  hplace = new Int32Array(4);
  /** Which dot field this is in the run's buffers (-1: not a dot field). */
  dotIx = -1;
  nameLen = 0;
  nFrame = 0;
  nStill = 0;
  // chain
  cn = 0; clen = 0.1; cg = 1; cdrag = 0.92; cstiff = 0.8; citer = 2; cclosed = false; carea = 0;
  cfloor = NaN;
  cfrom = -1; cto = -1;        // -1 free; 0..13 an anchor; 100+ an element index
  cfromX = 0; cfromY = 0; ctoX = 0; ctoY = 0;
  cdots = 0;
  slot = -1;                   // which chain state in the run
  // group / repeat
  els: SceneEl[] = [];
  clip = -1;
  rn = 1;
  /** How many copies of this element the repeats above it make (1: it is drawn once). */
  rmul = 1;
  // part
  part = "";
  /** The catalog part itself (core.ts owns parts; scene.ts only hands it back). Null: no such part. */
  partRef: unknown = null;
  paint = "$color";
  /** Executed ops per frame this element costs, and the dots and draw calls it may ask for. */
  ops = 0;
  dots = 0;
  draws = 0;
}

function VONE(): Val { const v = new Val(); v.c = 1; return v; }

/** The bot's own look while a scene is live (SPEC 2.6). */
export class SceneRig {
  alpha: Val = VONE(); sx = VONE(); sy = VONE(); rot: Val = VZERO;
  about = 13;
  /** head face antennae arms legs body wear, as bits. */
  hide = 0;
  any = false;
}
export const RIG_GROUPS = ["head", "face", "antennae", "arms", "legs", "body", "wear"];

/** A scene, compiled: what it draws, what it reads, and what it costs. */
export class Scene {
  id: string;
  label = "";
  bw = 1; bh = 1;
  still = 0;
  fixed = false;
  tap = false;
  events: string[] = [];
  varNames: string[] = [];
  vars: Val[] = [];
  emitNames: string[] = [];
  emitWhen: Val[] = [];
  rig: SceneRig | null = null;
  els: SceneEl[] = [];
  springs: Val[] = [];
  chains: SceneEl[] = [];
  /** Chain states this scene needs: one per chain element, times the repeats above it. */
  chainSlots = 0;
  /** Every element in draw order, flattened, so the run can keep one state array per element. */
  flat: SceneEl[] = [];
  anchors: number[] = [];
  /** How many names a scene expression reads: the base ones, its events and its vars (a repeat's j and nj follow). */
  nameLen: number = NBASE;
  ops = 0;
  dots = 0;
  draws = 0;
  ok = true;
  why = "";
  constructor(id: string) { this.id = id; }
}

const SCENE_ID_RE = /^[a-z][a-z0-9_.-]{0,23}$/;
const EV_NAME_RE = /^[a-z][a-z0-9_.]{0,23}$/;

/**
 * Compile one scene. `anchorIndex` turns an anchor's name into core.ts's code; `partRef` gives the catalog's part
 * by id (null: there is none), which a `part` element keeps so it can be drawn without another lookup. Errors are collected, never thrown: the caller refuses the whole catalog, as it does for everything else.
 */
export function compileScene(
  id: string,
  spec: unknown,
  X: XApi,
  anchorIndex: (name: string) => number,
  partRef: (id: string) => unknown,
  errs: string[],
): Scene {
  const sc = new Scene(id);
  const at = `scenes.${id}`;
  const n0 = errs.length;
  const fail = (m: string) => errs.push(`${at}${m}`);
  if (!SCENE_ID_RE.test(id)) fail(": the id is lower case letters, digits, _ . and -, up to 24");
  if (!isRec2(spec)) { fail(": an object"); sc.ok = false; sc.why = "not an object"; return sc; }
  const KEYS = ["format", "label", "note", "box", "still", "fixed", "tap", "events", "vars", "emit", "rig", "els"];
  for (const k of Object.keys(spec)) if (!KEYS.includes(k)) fail(`: unknown field ${k}`);
  sc.label = String(spec.label ?? "");
  const box = spec.box;
  if (!Array.isArray(box) || box.length !== 2 || !box.every((q) => typeof q === "number" && q > 0)) fail(".box: [width, height] in bot heights");
  else {
    sc.bw = Number(box[0]); sc.bh = Number(box[1]);
    if (sc.bw > SCENE_LIMITS.boxW || sc.bh > SCENE_LIMITS.boxH) fail(`.box: at most ${SCENE_LIMITS.boxW} by ${SCENE_LIMITS.boxH} bot heights`);
  }
  sc.still = typeof spec.still === "number" && spec.still >= 0 ? spec.still : 0;
  if (spec.still != null && sc.still !== spec.still) fail(".still: seconds from 0");
  sc.fixed = spec.fixed === true;
  sc.tap = spec.tap === true;
  // Events it reads, as ev.<name>.
  if (spec.events != null) {
    if (!Array.isArray(spec.events) || spec.events.length > SCENE_LIMITS.events) fail(`.events: at most ${SCENE_LIMITS.events} names`);
    else for (const e of spec.events) {
      if (typeof e !== "string" || !EV_NAME_RE.test(e)) { fail(`.events: "${String(e)}" is not an event name (no "-")`); continue; }
      if (!sc.events.includes(e)) sc.events.push(e);
    }
  }
  const names: string[] = [...SCENE_BASE, ...sc.events.map((e) => `ev.${e}`)];
  const keyBudget = { n: 0 };
  // Vars, in order: each may read the ones before it.
  if (spec.vars != null) {
    if (!isRec2(spec.vars)) fail(".vars: an object");
    else {
      const entries = Object.entries(spec.vars);
      if (entries.length > SCENE_LIMITS.vars) fail(`.vars: at most ${SCENE_LIMITS.vars}`);
      for (const [vn, raw] of entries.slice(0, SCENE_LIMITS.vars)) {
        if (!SCENE_ID_RE.test(vn)) { fail(`.vars.${vn}: a name in lower case`); continue; }
        if (names.includes(vn)) { fail(`.vars.${vn}: that name is taken`); continue; }
        const v = compileVal(raw, names, X, sc.springs, errs, `${at}.vars.${vn}`, keyBudget);
        sc.varNames.push(vn);
        sc.vars.push(v);
        names.push(vn);
        sc.ops += v.ops;
      }
    }
  }
  // emit: a moment event, when the expression turns true.
  if (spec.emit != null) {
    if (!Array.isArray(spec.emit) || spec.emit.length > SCENE_LIMITS.emit) fail(`.emit: at most ${SCENE_LIMITS.emit} [event, expression] pairs`);
    else for (const pair of spec.emit) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || !EV_NAME_RE.test(pair[0])) { fail(".emit: [event, expression]"); continue; }
      const v = compileVal(pair[1], names, X, sc.springs, errs, `${at}.emit.${pair[0]}`, keyBudget);
      sc.emitNames.push(pair[0]);
      sc.emitWhen.push(v);
      sc.ops += v.ops;
    }
  }
  // The bot himself, while the scene is live.
  if (spec.rig != null) {
    const r = spec.rig;
    if (!isRec2(r)) fail(".rig: an object");
    else {
      const rig = new SceneRig();
      for (const k of Object.keys(r)) if (!["alpha", "sx", "sy", "rot", "about", "hide"].includes(k)) fail(`.rig: unknown field ${k}`);
      if (r.alpha != null) rig.alpha = compileVal(r.alpha, names, X, sc.springs, errs, `${at}.rig.alpha`, keyBudget);
      if (r.sx != null) rig.sx = compileVal(r.sx, names, X, sc.springs, errs, `${at}.rig.sx`, keyBudget);
      if (r.sy != null) rig.sy = compileVal(r.sy, names, X, sc.springs, errs, `${at}.rig.sy`, keyBudget);
      if (r.rot != null) rig.rot = compileVal(r.rot, names, X, sc.springs, errs, `${at}.rig.rot`, keyBudget);
      if (r.about != null) {
        const a = anchorIndex(String(r.about));
        if (a < 0) fail(`.rig.about: not an anchor (${String(r.about)})`); else rig.about = a;
      }
      if (r.hide != null) {
        if (!Array.isArray(r.hide)) fail(".rig.hide: a list of groups");
        else for (const g of r.hide) {
          const i = RIG_GROUPS.indexOf(String(g));
          if (i < 0) fail(`.rig.hide: not a group (${RIG_GROUPS.join(", ")})`); else rig.hide |= 1 << i;
        }
      }
      rig.any = true;
      sc.rig = rig;
      sc.ops += rig.alpha.ops + rig.sx.ops + rig.sy.ops + rig.rot.ops;
    }
  }
  sc.nameLen = names.length;
  // The elements.
  const byId = new Map<string, SceneEl>();
  const ctx: ElCtx = { sc, X, names, errs, keyBudget, anchorIndex, partRef, byId, at, rmul: 1 };
  if (!Array.isArray(spec.els)) fail(".els: a list of elements");
  else sc.els = compileEls(spec.els, ctx, 1, `${at}.els`);
  if (sc.flat.length > SCENE_LIMITS.els) fail(`: at most ${SCENE_LIMITS.els} elements, counting a group's children`);
  if (keyBudget.n > SCENE_LIMITS.keysScene) fail(`: at most ${SCENE_LIMITS.keysScene} keyframes`);
  // Chains are counted by instance: a chain inside a `repeat n: 2` is two ropes to step (H15-Q4).
  if (sc.chainSlots > SCENE_LIMITS.chains) {
    fail(sc.chainSlots > sc.chains.length
      ? `: ${sc.chainSlots} chains counting repeats, over the ${SCENE_LIMITS.chains} a scene may have`
      : `: at most ${SCENE_LIMITS.chains} chains`);
  }
  // A group's clip names a shape, which may be written after it, so it is resolved once every id is known.
  for (const el of sc.flat) {
    if (el.kind !== EL_GROUP || el.clip < 100) continue;
    const target = byId.get(String(el.part));
    if (!target || target.kind !== EL_SHAPE) { fail(`.${el.id}.clip: no shape "${el.part}"`); el.clip = -1; }
    else el.clip = sc.flat.indexOf(target);
  }
  for (const el of sc.flat) { sc.ops += el.ops; sc.dots += el.dots; sc.draws += el.draws; }
  if (sc.dots > SCENE_LIMITS.dotsScene) {
    const repeated = sc.flat.some((el) => el.kind === EL_DOTS && el.rmul > 1);
    fail(repeated
      ? `: ${sc.dots} dots counting repeats, over the ${SCENE_LIMITS.dotsScene} a scene may have`
      : `: at most ${SCENE_LIMITS.dotsScene} dots`);
  }
  if (sc.draws > SCENE_LIMITS.draws) fail(`: at most ${SCENE_LIMITS.draws} drawing calls a frame`);
  if (sc.ops > SCENE_LIMITS.ops) fail(`: ${sc.ops} expression ops a frame, over the ${SCENE_LIMITS.ops} it may run`);
  if (errs.length > n0) { sc.ok = false; sc.why = errs[n0]; }
  return sc;
}

interface ElCtx {
  sc: Scene;
  X: XApi;
  names: string[];
  errs: string[];
  keyBudget: { n: number };
  anchorIndex: (name: string) => number;
  partRef: (id: string) => unknown;
  byId: Map<string, SceneEl>;
  at: string;
  /** How many copies of the element being compiled the repeats above it make: 1 outside any repeat. */
  rmul: number;
}

function compileEls(list: unknown[], ctx: ElCtx, depth: number, at: string): SceneEl[] {
  const out: SceneEl[] = [];
  if (depth > SCENE_LIMITS.depth + 1) { ctx.errs.push(`${at}: groups go ${SCENE_LIMITS.depth} deep`); return out; }
  list.forEach((raw, i) => {
    const el = compileEl(raw, ctx, depth, `${at}[${i}]`);
    if (el) out.push(el);
  });
  return out;
}

const COMMON = ["id", "kind", "on", "x", "y", "rot", "sx", "sy", "alpha", "show", "back", "note"];

function compileEl(raw: unknown, ctx: ElCtx, depth: number, at: string): SceneEl | null {
  const { X, errs, keyBudget, sc } = ctx;
  if (!isRec2(raw)) { errs.push(`${at}: an object`); return null; }
  const kinds: Record<string, number> = { shape: EL_SHAPE, dots: EL_DOTS, chain: EL_CHAIN, group: EL_GROUP, repeat: EL_REPEAT, part: EL_PART };
  const kind = kinds[String(raw.kind)];
  if (!kind) { errs.push(`${at}.kind: one of ${Object.keys(kinds).join(", ")}`); return null; }
  const el = new SceneEl();
  el.kind = kind;
  el.id = typeof raw.id === "string" ? raw.id : "";
  if (el.id && !SCENE_ID_RE.test(el.id)) errs.push(`${at}.id: lower case letters, digits, _ . and -`);
  // Inside a repeat an element is drawn once per instance, so the names `j` and `nj` are readable there.
  const names = ctx.rmul > 1 ? [...ctx.names, ...REP_NAMES] : ctx.names;
  // How many copies of this element exist. A chain keeps one rope per copy and a dot field one slice per copy.
  el.rmul = ctx.rmul;
  const val = (k: string, dflt?: number): Val => {
    if (raw[k] === undefined) { const v = new Val(); v.c = dflt ?? 0; return v; }
    return compileVal(raw[k], names, X, sc.springs, errs, `${at}.${k}`, keyBudget);
  };
  if (raw.on != null && raw.on !== "scene") {
    const a = ctx.anchorIndex(String(raw.on));
    if (a < 0) errs.push(`${at}.on: not an anchor (${String(raw.on)})`); else { el.on = a; if (!sc.anchors.includes(a)) sc.anchors.push(a); }
  }
  el.x = val("x"); el.y = val("y"); el.rot = val("rot");
  el.sx = val("sx", 1); el.sy = val("sy", 1); el.alpha = val("alpha", 1); el.show = val("show", 1);
  el.back = raw.back === true;
  el.ops = el.x.ops + el.y.ops + el.rot.ops + el.sx.ops + el.sy.ops + el.alpha.ops + el.show.ops;
  const only = (extra: string[]) => { for (const k of Object.keys(raw)) if (!COMMON.includes(k) && !extra.includes(k)) errs.push(`${at}: unknown field ${k}`); };

  if (kind === EL_SHAPE) {
    only(["d", "morph", "m", "fill", "stroke", "width"]);
    el.path = compilePath(raw.d, errs, at);
    if (Array.isArray(raw.morph)) {
      if (raw.morph.length > SCENE_LIMITS.morph) errs.push(`${at}.morph: at most ${SCENE_LIMITS.morph} targets`);
      for (const d of raw.morph.slice(0, SCENE_LIMITS.morph)) {
        const p = compilePath(d, errs, `${at}.morph`);
        if (p && el.path && !sameShape(el.path, p)) { errs.push(`${at}.morph: the same commands in the same order as d`); continue; }
        if (p) el.morph.push(p);
      }
    } else if (raw.morph != null) errs.push(`${at}.morph: a list of paths`);
    el.m = val("m");
    el.ops += el.m.ops;
    if (raw.fill != null && !okScenePaint(raw.fill)) errs.push(`${at}.fill: bad paint`); else el.fill = String(raw.fill ?? "");
    if (raw.stroke != null && !okScenePaint(raw.stroke)) errs.push(`${at}.stroke: bad paint`); else el.stroke = String(raw.stroke ?? "");
    if (!el.fill && !el.stroke) errs.push(`${at}: a fill or a stroke`);
    el.width = val("width", 0.03);
    el.ops += el.width.ops;
    el.draws = (el.fill ? 1 : 0) + (el.stroke ? 1 : 0);
  } else if (kind === EL_PART) {
    only(["part", "paint"]);
    el.part = String(raw.part ?? "");
    el.partRef = ctx.partRef(el.part);
    if (!el.partRef) errs.push(`${at}.part: no part "${el.part}"`);
    if (raw.paint != null && !okScenePaint(raw.paint)) errs.push(`${at}.paint: bad paint`); else el.paint = String(raw.paint ?? "$color");
    el.draws = 2;
  } else if (kind === EL_DOTS) {
    only(["grid", "cols", "rows", "gap", "along", "n", "rmax", "r", "dx", "dy", "paint", "pal"]);
    compileDots(el, raw, ctx, names, at);
  } else if (kind === EL_CHAIN) {
    only(["n", "len", "from", "to", "g", "drag", "stiff", "iter", "closed", "floor", "area", "stroke", "width", "fill", "dots", "paint"]);
    compileChain(el, raw, ctx, at);
  } else if (kind === EL_GROUP) {
    only(["els", "clip"]);
    if (raw.clip != null) {
      if (typeof raw.clip !== "string") errs.push(`${at}.clip: a shape's id`);
      else { el.clip = 100; el.part = raw.clip; }
    }
  } else if (kind === EL_REPEAT) {
    only(["n", "el"]);
    const n = Number(raw.n);
    if (!Number.isFinite(n) || n < 1 || n > SCENE_LIMITS.repeat || Math.floor(n) !== n) errs.push(`${at}.n: a whole number in [1, ${SCENE_LIMITS.repeat}]`);
    el.rn = sclamp(Math.floor(n) || 1, 1, SCENE_LIMITS.repeat);
  }
  // Depth-first, so flat[] is draw order and a parent always comes before its children.
  sc.flat.push(el);
  // A repeated chain gets one state per copy, side by side from its own slot.
  if (el.kind === EL_CHAIN) { el.slot = sc.chainSlots; sc.chainSlots += el.rmul; sc.chains.push(el); }
  if (el.id) ctx.byId.set(el.id, el);
  if (kind === EL_GROUP) {
    el.els = Array.isArray(raw.els) ? compileEls(raw.els, ctx, depth + 1, `${at}.els`) : [];
    if (!Array.isArray(raw.els)) errs.push(`${at}.els: a list of elements`);
  } else if (kind === EL_REPEAT) {
    const was = ctx.rmul;
    ctx.rmul = was * el.rn;
    const child = raw.el == null ? null : compileEl(raw.el, ctx, depth + 1, `${at}.el`);
    ctx.rmul = was;
    if (!child) errs.push(`${at}.el: one element`);
    else {
      el.els = [child];
      // A repeat draws its child n times, so the child's own cost counts n times.
      const sub = subtree(child);
      for (const s of sub) { s.ops *= el.rn; s.draws *= el.rn; s.dots *= el.rn; }
    }
  }
  return el;
}

function subtree(el: SceneEl): SceneEl[] {
  const out = [el];
  for (const k of el.els) out.push(...subtree(k));
  return out;
}

function compileDots(el: SceneEl, raw: Record<string, unknown>, ctx: ElCtx, names: string[], at: string): void {
  const { errs, X, sc, keyBudget } = ctx;
  if (raw.along != null) {
    const target = ctx.byId.get(String(raw.along));
    if (!target || target.kind !== EL_SHAPE || !target.path) { errs.push(`${at}.along: no shape "${String(raw.along)}" before this one`); return; }
    el.along = sc.flat.indexOf(target);
    const n = Number(raw.n);
    if (!Number.isFinite(n) || n < 1 || n > SCENE_LIMITS.dotsEl) { errs.push(`${at}.n: a whole number in [1, ${SCENE_LIMITS.dotsEl}]`); return; }
    el.alongN = Math.floor(n);
    el.n = el.alongN;
  } else {
    el.grid = raw.grid === "square" ? GRID_SQUARE : GRID_HEX;
    if (raw.grid != null && raw.grid !== "hex" && raw.grid !== "square") errs.push(`${at}.grid: hex or square`);
    el.cols = Math.floor(Number(raw.cols));
    el.rows = Math.floor(Number(raw.rows));
    if (!(el.cols >= 1 && el.rows >= 1)) { errs.push(`${at}: cols and rows from 1`); return; }
    el.gap = typeof raw.gap === "number" && raw.gap > 0 && raw.gap <= 1 ? raw.gap : 0.1;
    if (raw.gap != null && el.gap !== raw.gap) errs.push(`${at}.gap: in (0, 1]`);
    el.n = el.cols * el.rows;
  }
  // Inside a repeat the field is drawn once per copy, so the field's own budget counts every copy's dots.
  el.nAll = el.n * el.rmul;
  if (el.nAll > SCENE_LIMITS.dotsEl) {
    errs.push(el.rmul > 1
      ? `${at}: ${el.nAll} dots counting ${el.rmul} repeats, over the ${SCENE_LIMITS.dotsEl} one field may have`
      : `${at}: ${el.n} dots, over the ${SCENE_LIMITS.dotsEl} one field may have`);
    return;
  }
  el.rmax = typeof raw.rmax === "number" && raw.rmax > 0 && raw.rmax <= 0.5 ? raw.rmax : 0.05;
  if (raw.rmax != null && el.rmax !== raw.rmax) errs.push(`${at}.rmax: in (0, 0.5]`);
  const pal = Array.isArray(raw.pal) ? raw.pal : ["$color"];
  if (pal.length < 1 || pal.length > 2) errs.push(`${at}.pal: one or two paints`);
  for (const p of pal.slice(0, 2)) { if (!okScenePaint(p)) errs.push(`${at}.pal: bad paint ${String(p)}`); else el.pal.push(String(p)); }
  if (!el.pal.length) el.pal.push("$color");
  // The per-dot names, then the slots hoisting will fill.
  const dotNames = [...names, ...DOT_NAMES];
  el.nameLen = dotNames.length;
  // In a repeated field every copy's dots sit in one buffer, so `j` is a per-dot name like `i` and `nj` is still.
  // Only the two the repeat itself appended, by place, so a var of the same name is not mistaken for one of them.
  const repAt = el.rmul > 1 ? names.length - REP_NAMES.length : names.length;
  const classOf = (i: number): number => {
    if (i < NBASE) return BASE_STILL.has(SCENE_BASE[i]) ? 0 : C_FRAME;
    if (i < repAt) return C_FRAME;                              // an event's age, or a var
    if (i < names.length) return dotNames[i] === "j" ? C_DOT : 0;
    return DOT_STILL.has(dotNames[i]) ? 0 : C_DOT;
  };
  let slot0 = el.nameLen;
  const one = (key: string, dflt: string): Hoisted => {
    const src = raw[key] === undefined ? dflt : raw[key];
    const v = compileVal(src, dotNames, X, sc.springs, errs, `${at}.${key}`, keyBudget);
    if (v.kind === V_SPRING || v.kind === V_KEYS) { errs.push(`${at}.${key}: a number or an expression (a dot's own value cannot be a spring or keyframes)`); }
    const xp: Xp = { c: v.c, code: v.code };
    const h = hoist(xp, X, classOf, slot0);
    slot0 += h.frame.length + h.still.length;
    el.nFrame += h.frame.length;
    el.nStill += h.still.length;
    return h;
  };
  el.hr = one("r", "0.02");
  el.hdx = one("dx", "0");
  el.hdy = one("dy", "0");
  el.hpaint = one("paint", "0");
  // The lists the run walks every frame, made once here: a frame allocates nothing (SPEC 1.3).
  el.hall = [el.hr, el.hdx, el.hdy, el.hpaint];
  let place = el.nameLen;
  for (let k = 0; k < 4; k++) {
    const hh = el.hall[k];
    if (!hh) continue;
    el.hplace[k] = place + hh.frame.length;
    place += hh.frame.length + hh.still.length;
  }
  const perDot = el.hr.opsDot + el.hdx.opsDot + el.hdy.opsDot + el.hpaint.opsDot;
  const perFrame = el.hr.opsFrame + el.hdx.opsFrame + el.hdy.opsFrame + el.hpaint.opsFrame;
  // Half the dots are brought up to date each frame (SPEC 3.2), and all of them are drawn every frame.
  // Inside a repeat the caller multiplies all of this by the repeat count. The per-dot part is then exact; the
  // frame part is counted once per copy though it really runs once, which errs on the safe side of the budget.
  el.ops = el.ops + perFrame + perDot * Math.ceil(el.n / 2);
  el.dots = el.n;
  // One call per non-empty (radius step, colour) group: seven steps that draw, times the palette.
  el.draws = 7 * el.pal.length;
}

function compileChain(el: SceneEl, raw: Record<string, unknown>, ctx: ElCtx, at: string): void {
  const { errs } = ctx;
  const n = Math.floor(Number(raw.n));
  if (!(n >= 2 && n <= SCENE_LIMITS.chainN)) { errs.push(`${at}.n: a whole number in [2, ${SCENE_LIMITS.chainN}]`); return; }
  el.cn = n;
  // `len` is the WHOLE chain's rest length in bot heights, end to end (the perimeter when closed), so lowering `n`
  // to fit the budget makes a coarser rope, not a shorter one. One segment is len/(n-1), or len/n closed (H15-Q6).
  el.clen = typeof raw.len === "number" && raw.len > 0 && raw.len <= 3 ? raw.len : 0.3;
  if (raw.len != null && el.clen !== raw.len) errs.push(`${at}.len: in (0, 3]`);
  const clampNum = (k: string, lo: number, hi: number, dflt: number): number => {
    if (raw[k] == null) return dflt;
    const v = Number(raw[k]);
    if (!(Number.isFinite(v) && v >= lo && v <= hi)) { errs.push(`${at}.${k}: in [${lo}, ${hi}]`); return dflt; }
    return v;
  };
  el.cg = clampNum("g", -10, 10, 1);
  el.cdrag = clampNum("drag", 0, 1, 0.92);
  el.cstiff = clampNum("stiff", 0, 1, 0.8);
  el.citer = Math.floor(clampNum("iter", 1, SCENE_LIMITS.chainIter, 2));
  el.cclosed = raw.closed === true;
  el.carea = clampNum("area", 0, 2, 0);
  if (el.carea > 0 && !el.cclosed) errs.push(`${at}.area: only a closed chain has one`);
  el.cfloor = raw.floor == null ? NaN : clampNum("floor", -10, 10, 0);
  // A pin: nothing, an anchor, or "<element>:x,y". A named element is read as an offset in the chain's own frame,
  // so inside a repeat each copy's rope hangs off that copy's element without naming it again.
  const end = (k: string): [number, number, number] => {
    const v = raw[k];
    if (v == null) return [-1, 0, 0];
    const s = String(v);
    const colon = s.indexOf(":");
    if (colon > 0) {
      const target = ctx.byId.get(s.slice(0, colon));
      const bits = s.slice(colon + 1).split(",");
      const ox = Number(bits[0]), oy = Number(bits[1]);
      if (!target || !Number.isFinite(ox) || !Number.isFinite(oy)) { errs.push(`${at}.${k}: "<element>:x,y", naming an element before this one`); return [-1, 0, 0]; }
      return [100 + ctx.sc.flat.indexOf(target), ox, oy];
    }
    const a = ctx.anchorIndex(s);
    if (a < 0) { errs.push(`${at}.${k}: an anchor, "<element>:x,y", or nothing`); return [-1, 0, 0]; }
    if (!ctx.sc.anchors.includes(a)) ctx.sc.anchors.push(a);
    return [a, 0, 0];
  };
  const f = end("from"), t = end("to");
  el.cfrom = f[0]; el.cfromX = f[1]; el.cfromY = f[2];
  el.cto = t[0]; el.ctoX = t[1]; el.ctoY = t[2];
  if (raw.stroke != null && !okScenePaint(raw.stroke)) errs.push(`${at}.stroke: bad paint`); else el.stroke = String(raw.stroke ?? "");
  if (raw.fill != null && !okScenePaint(raw.fill)) errs.push(`${at}.fill: bad paint`); else el.fill = String(raw.fill ?? "");
  if (el.fill && !el.cclosed) errs.push(`${at}.fill: only a closed chain is filled`);
  if (raw.paint != null && !okScenePaint(raw.paint)) errs.push(`${at}.paint: bad paint`); else el.paint = String(raw.paint ?? "$color");
  el.cdots = typeof raw.dots === "number" && raw.dots > 0 && raw.dots <= 0.3 ? raw.dots : 0;
  if (raw.dots != null && !el.cdots) errs.push(`${at}.dots: a radius in (0, 0.3]`);
  const wv = raw.width;
  el.width = new Val();
  el.width.c = typeof wv === "number" && wv > 0 && wv <= 0.3 ? wv : 0.02;
  if (!el.stroke && !el.fill && !el.cdots) errs.push(`${at}: a stroke, a fill or dots`);
  // Each constraint pass touches every segment; the run also integrates every point.
  el.ops += el.cn * (1 + el.citer) * Math.ceil(1 / 60 / SSTEP);
  el.draws = (el.stroke ? 1 : 0) + (el.fill ? 1 : 0) + (el.cdots ? 1 : 0);
}

// ===================================================================== a scene, playing

/** Where a scene is drawn, and in what. The host fills this once and keeps it. */
export interface SceneDraw {
  /** The scene's origin, in the tile's pixels. */
  ox: number;
  oy: number;
  /** The bot's height in pixels: a scene's own numbers are in bot heights. */
  S: number;
  /** 1 or -1: the scene mirrors with his facing unless it is `fixed`. */
  mirror: number;
  alpha: number;
  color: string;
  ink: string;
  paper: string;
  /** Six numbers per anchor (point, forward, down), as core.ts's anchor() gives them; null: only `scene` works. */
  anchors: Float64Array | null;
  /** The scene track said `back`: every element goes behind the bot, whatever it says itself. */
  allBack: boolean;
}

const M_A = 0, M_B = 1, M_C = 2, M_D = 3, M_E = 4, M_F = 5;

/**
 * One play of one scene: its buffers, its physics, and its drawing. Made when the scene starts and reused every
 * frame. Nothing here allocates once `start()` has run.
 */
export class SceneRun {
  scene: Scene;
  /** The base names (SCENE_BASE), then each `ev.<name>`, then each var: the host writes the first NBASE. */
  vars: Float64Array;
  dead = false;
  why = "";
  /** Events the scene asked the moment to fire this step; the host drains it. */
  fired: string[] = [];
  /** The bot's own look this frame, when the scene has a `rig`. */
  rigOn = false;
  rigAlpha = 1; rigSx = 1; rigSy = 1; rigRot = 0; rigAbout = 13; rigHide = 0;
  /** What the last frame really cost: drawing calls, and the dots drawn. */
  drawCalls = 0;

  private spring: Float64Array;
  private springV: Float64Array;
  private springOn: Uint8Array;
  private emitWas: Uint8Array;
  private emitAt: Float64Array;
  private chainX: Float64Array[] = [];
  private chainY: Float64Array[] = [];
  private chainPX: Float64Array[] = [];
  private chainPY: Float64Array[] = [];
  private chainArea: number[] = [];
  private chainReady: Uint8Array;
  /** Per dot field: its rest places, its slots and the values last worked out. */
  private dotVars: Float64Array[] = [];
  private dotStill: Float32Array[][] = [];
  private dotR: Float32Array[] = [];
  private dotDX: Float32Array[] = [];
  private dotDY: Float32Array[] = [];
  private dotP: Uint8Array[] = [];
  private dotEl: SceneEl[] = [];
  private scratch: Float32Array;
  /** Half the dots are brought up to date each frame: this says which half. */
  private phase = 0;
  /** Which copy of a repeated element is being drawn, and how many copies there are in all. */
  private inst = 0;
  private instN = 1;
  private pending = 0;
  private saves = 0;
  private started = false;
  /** Six numbers per level: the scene's own frame, then one per group a child sits in. */
  private mat = new Float64Array(6 * 12);
  private held = new Float64Array(6 * 12);
  private flatXY = new Float64Array(2 * SCENE_LIMITS.chainN);

  constructor(scene: Scene, seed: number) {
    this.scene = scene;
    // The base names, the events, the vars, and two more for a repeat's `j` and `nj`.
    this.vars = new Float64Array(scene.nameLen + REP_NAMES.length);
    this.vars[B_SEED] = seed;
    this.spring = new Float64Array(scene.springs.length);
    this.springV = new Float64Array(scene.springs.length);
    this.springOn = new Uint8Array(scene.springs.length);
    this.emitWas = new Uint8Array(scene.emitNames.length);
    this.emitAt = new Float64Array(scene.emitNames.length).fill(-99);
    this.chainReady = new Uint8Array(scene.chainSlots);
    let widest: number = SCENE_LIMITS.chainN;
    for (const el of scene.flat) if (el.kind === EL_DOTS && el.n > widest) widest = el.n;
    this.scratch = new Float32Array(widest * 2);
  }

  /** The buffers for this play: rest places, the static per-dot values, and the chains at rest. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const sc = this.scene;
    for (const el of sc.flat) {
      if (el.kind === EL_CHAIN) {
        // One rope per copy: a chain inside a repeat keeps each copy's points apart, side by side from its slot.
        for (let c = 0; c < el.rmul; c++) {
          this.chainX.push(new Float64Array(el.cn));
          this.chainY.push(new Float64Array(el.cn));
          this.chainPX.push(new Float64Array(el.cn));
          this.chainPY.push(new Float64Array(el.cn));
          this.chainArea.push(0);
        }
      }
      if (el.kind !== EL_DOTS) continue;
      const n = el.n;
      // Rest places come from the compiled data alone, so they are worked out once and shared by every play.
      if (!el.qx) {
        el.qx = new Float32Array(n); el.qy = new Float32Array(n); el.qd = new Float32Array(n); el.qa = new Float32Array(n);
        if (el.along >= 0) alongPath(sc.flat[el.along], el);
        else restGrid(el);
        for (let i = 0; i < n; i++) { el.qd[i] = Math.hypot(el.qx[i], el.qy[i]); el.qa[i] = Math.atan2(el.qy[i], el.qx[i]); }
      }
      el.dotIx = this.dotEl.length;
      this.dotEl.push(el);
      this.dotVars.push(new Float64Array(el.nameLen + el.nFrame + el.nStill));
      // Every copy's dots live in one buffer, copy by copy: dot k belongs to copy floor(k / n) and is its dot k % n.
      const nAll = el.nAll || n;
      this.dotR.push(new Float32Array(nAll));
      this.dotDX.push(new Float32Array(nAll));
      this.dotDY.push(new Float32Array(nAll));
      this.dotP.push(new Uint8Array(nAll));
      const still: Float32Array[] = [];
      for (let s = 0; s < el.nStill; s++) still.push(new Float32Array(nAll));
      this.dotStill.push(still);
    }
    this.stillValues();
  }

  /** The per-dot values that never change through a play (SPEC 3.2): worked out once, here. */
  private stillValues(): void {
    const X = this.api;
    if (!X) return;
    const nameLen = this.scene.nameLen;
    for (let e = 0; e < this.dotEl.length; e++) {
      const el = this.dotEl[e], V = this.dotVars[e], buf = this.dotStill[e];
      V.set(this.vars.subarray(0, nameLen));
      let s = 0;
      for (let k = 0; k < el.hall.length; k++) {
        const h = el.hall[k];
        if (!h) continue;
        for (let q = 0; q < h.still.length; q++, s++) {
          const code = h.still[q], out = buf[s];
          for (let i = 0; i < (el.nAll || el.n); i++) {
            this.dotNames(V, el, i);
            const v = X.run(code, V);
            out[i] = v === v ? v : 0;
          }
        }
      }
    }
  }

  /**
   * The per-dot names for dot k of the element's buffer, written into its own values array. In a repeated field the
   * buffer holds every copy's dots one after another, so dot k is dot k % n of copy floor(k / n), which the field
   * reads as `j` (of `nj`): per dot, never per frame, so the hoisting holds.
   */
  private dotNames(V: Float64Array, el: SceneEl, k: number): void {
    let i = k;
    if (el.rmul > 1) {
      const at0 = el.nameLen - DOT_NAMES.length - REP_NAMES.length;
      i = k % el.n;
      V[at0] = Math.floor(k / el.n);
      V[at0 + 1] = el.rmul;
    }
    const at = el.nameLen - DOT_NAMES.length;
    V[at] = i;
    V[at + 1] = el.along >= 0 ? i : i % el.cols;
    V[at + 2] = el.along >= 0 ? 0 : Math.floor(i / el.cols);
    V[at + 3] = el.n;
    V[at + 4] = el.qx ? el.qx[i] : 0;
    V[at + 5] = el.qy ? el.qy[i] : 0;
    V[at + 6] = el.qd ? el.qd[i] : 0;
    V[at + 7] = el.qa ? el.qa[i] : 0;
  }

  /** core.ts hands its runner in once, so bytecode can be run without an import. */
  api: XApi | null = null;

  private ev(code: Float64Array | null, c: number): number {
    const X = this.api;
    if (!code || !X) return c;
    const v = X.run(code, this.vars);
    return v === v ? v : 0;
  }

  /** One value, now. Keyframes read their own clock; a spring reads the state the step left. */
  value(v: Val): number {
    if (v.kind === V_CONST) return v.c;
    if (v.kind === V_EXPR) return this.ev(v.code, v.c);
    if (v.kind === V_SPRING) return this.spring[v.slot];
    const keys = v.keys;
    if (!keys) return 0;
    const n = keys.length / KSTRIDE;
    let at = v.by ? this.value(v.by) : this.vars[B_T];
    const first = keys[0], last = keys[(n - 1) * KSTRIDE];
    if (v.loop && last > first) at = first + (((at - first) % (last - first)) + (last - first)) % (last - first);
    if (at <= first) return keys[1];
    if (at >= last) return keys[(n - 1) * KSTRIDE + 1];
    let i = 1;
    while (i < n && keys[i * KSTRIDE] < at) i++;
    const t0 = keys[(i - 1) * KSTRIDE], v0 = keys[(i - 1) * KSTRIDE + 1];
    const t1 = keys[i * KSTRIDE], v1 = keys[i * KSTRIDE + 1];
    const w = t1 === t0 ? 1 : (at - t0) / (t1 - t0);
    return v0 + (v1 - v0) * easeAt(keys[i * KSTRIDE + 2], keys, i * KSTRIDE, w);
  }

  /**
   * One step: the vars in order, the springs, the rig, and the emitters. Chains are stepped where they are drawn,
   * so a pin that follows an element is read at the place the element really is.
   */
  step(dt: number): void {
    if (this.dead) return;
    if (!this.started) this.start();
    const sc = this.scene, V = this.vars;
    const h = dt > SMAX_FRAME ? SMAX_FRAME : dt > 0 ? dt : 0;
    this.pending = Math.min(SMAX_FRAME, this.pending + h);
    for (let i = 0; i < sc.vars.length; i++) V[NBASE + sc.events.length + i] = this.value(sc.vars[i]);
    // Springs, at the fixed step, so the same play looks the same at any frame rate.
    const steps = Math.min(16, Math.round(h / SSTEP));
    for (let s = 0; s < sc.springs.length; s++) {
      const sp = sc.springs[s], target = sp.target ? this.value(sp.target) : 0;
      if (!this.springOn[s]) { this.spring[s] = target; this.springV[s] = 0; this.springOn[s] = 1; continue; }
      let p = this.spring[s], v = this.springV[s];
      const damping = 2 * sp.damp * Math.sqrt(sp.k);
      for (let q = 0; q < steps; q++) {
        v += (sp.k * (target - p) - damping * v) * SSTEP;
        p += v * SSTEP;
      }
      if (!Number.isFinite(p) || !Number.isFinite(v)) { this.kill("nan"); return; }
      this.spring[s] = p; this.springV[s] = v;
    }
    if (sc.rig) {
      this.rigOn = true;
      this.rigAlpha = sclamp(this.value(sc.rig.alpha), 0, 1);
      this.rigSx = sclamp(this.value(sc.rig.sx), 0, 8);
      this.rigSy = sclamp(this.value(sc.rig.sy), 0, 8);
      this.rigRot = sclamp(this.value(sc.rig.rot), -Math.PI * 2, Math.PI * 2);
      this.rigAbout = sc.rig.about;
      this.rigHide = sc.rig.hide;
    }
    // emit: when the expression turns from false to true, and not twice within half a second.
    for (let i = 0; i < sc.emitWhen.length; i++) {
      const on = this.value(sc.emitWhen[i]) > 0 ? 1 : 0;
      const now = V[B_T];
      if (on && !this.emitWas[i] && now - this.emitAt[i] >= 0.5) {
        this.emitAt[i] = now;
        if (this.fired.length < SCENE_LIMITS.emit) this.fired.push(sc.emitNames[i]);
      }
      this.emitWas[i] = on;
    }
    this.phase ^= 1;
    this.updateDots();
  }

  /** Half the dots, this frame: each one's radius, its offset and its colour. */
  private updateDots(): void {
    const X = this.api;
    if (!X) return;
    for (let e = 0; e < this.dotEl.length; e++) {
      const el = this.dotEl[e], V = this.dotVars[e], still = this.dotStill[e];
      V.set(this.vars.subarray(0, this.scene.nameLen));
      // The frame-level parts of each value, once. The lists and the slots were worked out at compile time.
      let slot = el.nameLen, s = 0;
      const hall = el.hall, places = el.hplace;
      for (let k = 0; k < hall.length; k++) {
        const hh = hall[k];
        if (!hh) continue;
        for (let q = 0; q < hh.frame.length; q++) V[slot + q] = X.run(hh.frame[q], V);
        slot += hh.frame.length + hh.still.length;
      }
      const rbuf = this.dotR[e], xbuf = this.dotDX[e], ybuf = this.dotDY[e], pbuf = this.dotP[e];
      const pal = el.pal.length;
      const nAll = el.nAll || el.n;
      for (let i = this.phase; i < nAll; i += 2) {
        this.dotNames(V, el, i);
        s = 0;
        for (let k = 0; k < hall.length; k++) {
          const hh = hall[k];
          if (!hh) continue;
          for (let q = 0; q < hh.still.length; q++) V[places[k]! + q] = still[s + q][i];
          s += hh.still.length;
        }
        const r = el.hr ? (el.hr.code ? X.run(el.hr.code, V) : el.hr.c) : 0;
        const dx = el.hdx ? (el.hdx.code ? X.run(el.hdx.code, V) : el.hdx.c) : 0;
        const dy = el.hdy ? (el.hdy.code ? X.run(el.hdy.code, V) : el.hdy.c) : 0;
        const p = el.hpaint ? (el.hpaint.code ? X.run(el.hpaint.code, V) : el.hpaint.c) : 0;
        rbuf[i] = r === r ? sclamp(r, 0, el.rmax) : 0;
        xbuf[i] = dx === dx ? sclamp(dx, -10, 10) : 0;
        ybuf[i] = dy === dy ? sclamp(dy, -10, 10) : 0;
        pbuf[i] = p === p ? sclamp(Math.round(p), 0, pal - 1) : 0;
      }
    }
  }

  /** Reduce Motion, or a scene that has been slowed: the frame at `still`, with the physics settled. */
  settle(at: number): void {
    if (!this.started) this.start();
    this.vars[B_T] = at;
    this.vars[B_U] = this.vars[B_D] > 0 ? sclamp(at / this.vars[B_D], 0, 1) : 0;
    this.phase = 0;
    this.step(SSTEP);
    this.phase = 1;
    this.updateDots();
    this.phase = 0;
    for (let i = 0; i < this.chainReady.length; i++) this.chainReady[i] = 0;
    this.pending = 0;
  }

  /** A dot field's values as they stand (tests and tuning): its radii, offsets and colour choices. */
  readDots(ix: number): { r: Float32Array; dx: Float32Array; dy: Float32Array; paint: Uint8Array } | null {
    if (ix < 0 || ix >= this.dotR.length) return null;
    return { r: this.dotR[ix], dx: this.dotDX[ix], dy: this.dotDY[ix], paint: this.dotP[ix] };
  }

  /** The scene went wrong while playing: it alone is dropped, and the moment carries on without it. */
  kill(why: string): void {
    this.dead = true;
    this.why = why;
  }

  // ------------------------------------------------------------------ drawing

  /** Both passes of one frame: `back` draws what sits behind the bot, then the rig is drawn, then the front. */
  draw(ctx: SceneCtx, d: SceneDraw, back: boolean): void {
    if (this.dead) return;
    const before = this.saves;
    this.drawCalls = 0;
    try {
      const m = this.mat;
      m[M_A] = d.S * (this.scene.fixed ? 1 : d.mirror);
      m[M_B] = 0;
      m[M_C] = 0;
      m[M_D] = d.S;
      m[M_E] = d.ox;
      m[M_F] = d.oy;
      this.walk(ctx, d, this.scene.els, 0, d.alpha, back);
      if (this.drawCalls > SCENE_LIMITS.draws) this.kill("draws");
    } catch (e) {
      // A scene's fault is its own: unwind its own saves and let the bot, the grid and the loop carry on.
      while (this.saves > before) { try { ctx.restore(); } catch { break; } this.saves--; }
      this.kill("throw");
      void e;
    }
    // Both passes of one frame share the time to step: a chain drawn in front would never move if the back pass
    // spent it. The front pass is the last one, so it is the one that clears it.
    if (!back) this.pending = 0;
  }

  private walk(ctx: SceneCtx, d: SceneDraw, els: SceneEl[], depth: number, alpha: number, back: boolean): void {
    if (depth > 9) return;
    // The frame this level was handed: an element with an anchor of its own overwrites it, so it is kept here.
    const base0 = depth * 6;
    for (let i = 0; i < 6; i++) this.held[base0 + i] = this.mat[base0 + i];
    for (const el of els) {
      const mine = el.back || d.allBack;
      if (mine !== back) { if (el.kind !== EL_GROUP && el.kind !== EL_REPEAT) continue; }
      if (this.value(el.show) <= 0) continue;
      const a = alpha * sclamp(this.value(el.alpha), 0, 1);
      if (a <= 0.004) continue;
      const base = depth * 6;
      const into = (depth + 1) * 6;
      const m = this.mat;
      // Where this element hangs: its own anchor, or the frame its parent gives it.
      if (el.on >= 0 && d.anchors) {
        const q = el.on * 6;
        m[base] = d.anchors[q + 2] * d.S; m[base + 1] = d.anchors[q + 3] * d.S;
        m[base + 2] = d.anchors[q + 4] * d.S; m[base + 3] = d.anchors[q + 5] * d.S;
        m[base + 4] = d.anchors[q]; m[base + 5] = d.anchors[q + 1];
      } else {
        for (let i = 0; i < 6; i++) m[base + i] = this.held[base + i];
      }
      const x = sclamp(this.value(el.x), -10, 10), y = sclamp(this.value(el.y), -10, 10);
      const rot = this.value(el.rot), sx = sclamp(this.value(el.sx), -8, 8), sy = sclamp(this.value(el.sy), -8, 8);
      if (!Number.isFinite(x + y + rot + sx + sy)) { this.kill("nan"); return; }
      const c = Math.cos(rot), s = Math.sin(rot);
      const a0 = m[base], b0 = m[base + 1], c0 = m[base + 2], d0 = m[base + 3];
      m[into + 4] = m[base + 4] + a0 * x + c0 * y;
      m[into + 5] = m[base + 5] + b0 * x + d0 * y;
      m[into] = (a0 * c + c0 * s) * sx;
      m[into + 1] = (b0 * c + d0 * s) * sx;
      m[into + 2] = (c0 * c - a0 * s) * sy;
      m[into + 3] = (d0 * c - b0 * s) * sy;
      if (el.kind === EL_GROUP) {
        let clipped = false;
        if (el.clip >= 0 && ctx.clip) {
          ctx.save();
          this.saves++;
          clipped = true;
          const shape = this.scene.flat[el.clip];
          ctx.beginPath();
          this.path(ctx, shape, into);
          ctx.clip();
        }
        this.walk(ctx, d, el.els, depth + 1, a, back);
        if (clipped) { ctx.restore(); this.saves--; }
      } else if (el.kind === EL_REPEAT) {
        if (!el.els.length) continue;
        // The child is drawn n times and reads which copy it is as `j` (of `nj`). Repeats inside repeats count
        // through: `j` is the copy's number among all of them, so a chain's rope and a dot field's slice line up.
        const at = this.scene.nameLen;
        const wasJ = this.vars[at], wasN = this.vars[at + 1];
        const wasInst = this.inst, wasInstN = this.instN;
        for (let j = 0; j < el.rn; j++) {
          this.inst = wasInst * el.rn + j;
          this.instN = wasInstN * el.rn;
          this.vars[at] = this.inst;
          this.vars[at + 1] = this.instN;
          this.walk(ctx, d, el.els, depth + 1, a, back);
        }
        this.inst = wasInst;
        this.instN = wasInstN;
        this.vars[at] = wasJ;
        this.vars[at + 1] = wasN;
      } else if (mine === back) {
        this.drawOne(ctx, d, el, into, a);
      }
    }
  }

  /** A paint token as a colour: the bot's own, the ground's ink or paper, or the colour as given. */
  private col(d: SceneDraw, p: string): string {
    return p === "$color" || p === "$paint" ? d.color : p === "ink" ? d.ink : p === "paper" ? d.paper : p;
  }

  private drawOne(ctx: SceneCtx, d: SceneDraw, el: SceneEl, m0: number, alpha: number): void {
    const m = this.mat;
    const scale = Math.sqrt(Math.abs(m[m0] * m[m0 + 3] - m[m0 + 1] * m[m0 + 2])) || 1;
    ctx.globalAlpha = alpha;
    if (el.kind === EL_SHAPE) {
      ctx.beginPath();
      this.path(ctx, el, m0);
      if (el.fill) { ctx.fillStyle = this.col(d, el.fill); ctx.fill(); this.drawCalls++; }
      if (el.stroke) {
        ctx.strokeStyle = this.col(d, el.stroke);
        ctx.lineWidth = Math.max(0.5, this.value(el.width) * scale);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        this.drawCalls++;
      }
    } else if (el.kind === EL_DOTS) {
      this.drawDots(ctx, d, el, m0, alpha);
    } else if (el.kind === EL_CHAIN) {
      this.drawChain(ctx, d, el, m0, scale);
    } else if (el.kind === EL_PART) {
      // A catalog part is drawn by core.ts, which owns parts: it hands the drawing in through onPart.
      if (this.onPart && el.partRef) {
        this.onPart(ctx, el.partRef, m[m0 + 4], m[m0 + 5], m[m0], m[m0 + 1], m[m0 + 2], m[m0 + 3], this.col(d, el.paint), alpha);
        this.drawCalls += 2;
      }
    }
  }

  /** core.ts sets this so a scene can draw one of the catalog's parts without knowing what a part is. */
  onPart: ((ctx: SceneCtx, part: unknown, ox: number, oy: number, fx: number, fy: number, dx: number, dy: number, paint: string, alpha: number) => void) | null = null;

  /** A path, in the element's frame, with morph targets blended in. */
  private path(ctx: SceneCtx, el: SceneEl, m0: number): void {
    const p = el.path;
    if (!p) return;
    const m = this.mat;
    // The frame and the morph pair live on the run while the path is walked, so px/py/at make no closures.
    this.pA = m[m0]; this.pB = m[m0 + 1]; this.pC = m[m0 + 2]; this.pD = m[m0 + 3]; this.pE = m[m0 + 4]; this.pF = m[m0 + 5];
    this.pP = p;
    // Morph: m runs from 0 (the path itself) to the number of targets.
    let lo: Float64Array | null = null, hi: Float64Array | null = null, w = 0;
    if (el.morph.length) {
      const mm = sclamp(this.value(el.m), 0, el.morph.length);
      const i = Math.min(el.morph.length - 1, Math.floor(mm));
      w = mm - i;
      lo = i === 0 ? p : el.morph[i - 1];
      hi = el.morph[i];
    }
    this.pLo = lo; this.pHi = hi; this.pW = w;
    for (let i = 0; i < p.length;) {
      const cmd = p[i];
      if (cmd === SO_M) { ctx.moveTo(this.px(this.at(i + 1), this.at(i + 2)), this.py(this.at(i + 1), this.at(i + 2))); i += 3; }
      else if (cmd === SO_L) { ctx.lineTo(this.px(this.at(i + 1), this.at(i + 2)), this.py(this.at(i + 1), this.at(i + 2))); i += 3; }
      else if (cmd === SO_Q) {
        ctx.quadraticCurveTo(this.px(this.at(i + 1), this.at(i + 2)), this.py(this.at(i + 1), this.at(i + 2)), this.px(this.at(i + 3), this.at(i + 4)), this.py(this.at(i + 3), this.at(i + 4)));
        i += 5;
      } else if (cmd === SO_C) {
        const x1 = this.px(this.at(i + 1), this.at(i + 2)), y1 = this.py(this.at(i + 1), this.at(i + 2));
        const x2 = this.px(this.at(i + 3), this.at(i + 4)), y2 = this.py(this.at(i + 3), this.at(i + 4));
        const x3 = this.px(this.at(i + 5), this.at(i + 6)), y3 = this.py(this.at(i + 5), this.at(i + 6));
        if (ctx.bezierCurveTo) ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        else {
          // No cubics on this host: two quadratics, which is close enough at a bot's size.
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          ctx.quadraticCurveTo(x1, y1, mx, my);
          ctx.quadraticCurveTo(x2, y2, x3, y3);
        }
        i += 7;
      } else if (cmd === SO_Z) { ctx.closePath(); i += 1; }
      else if (cmd === SO_O) {
        // A circle: the frame may squash it, so it is drawn as four quadratics.
        const cx = this.at(i + 1), cy = this.at(i + 2), r = this.at(i + 3), k = r * 0.5523;
        ctx.moveTo(this.px(cx + r, cy), this.py(cx + r, cy));
        ctx.quadraticCurveTo(this.px(cx + r, cy + k * 1.2), this.py(cx + r, cy + k * 1.2), this.px(cx, cy + r), this.py(cx, cy + r));
        ctx.quadraticCurveTo(this.px(cx - r, cy + k * 1.2), this.py(cx - r, cy + k * 1.2), this.px(cx - r, cy), this.py(cx - r, cy));
        ctx.quadraticCurveTo(this.px(cx - r, cy - k * 1.2), this.py(cx - r, cy - k * 1.2), this.px(cx, cy - r), this.py(cx, cy - r));
        ctx.quadraticCurveTo(this.px(cx + r, cy - k * 1.2), this.py(cx + r, cy - k * 1.2), this.px(cx + r, cy), this.py(cx + r, cy));
        ctx.closePath();
        i += 4;
      } else break;
    }
  }

  /** While a path is walked: its frame, and the morph pair it blends. */
  private pA = 1; private pB = 0; private pC = 0; private pD = 1; private pE = 0; private pF = 0;
  private pP: Float64Array | null = null;
  private pLo: Float64Array | null = null;
  private pHi: Float64Array | null = null;
  private pW = 0;
  private px(x: number, y: number): number { return this.pA * x + this.pC * y + this.pE; }
  private py(x: number, y: number): number { return this.pB * x + this.pD * y + this.pF; }
  private at(k: number): number {
    const lo = this.pLo, hi = this.pHi;
    return lo && hi ? lo[k] + (hi[k] - lo[k]) * this.pW : this.pP![k];
  }

  /**
   * A dot field. The core quantizes, not the host, so the phone and the window draw the same dots: eight radius
   * steps (step 0 draws nothing) and at most two colours, which is at most fourteen calls.
   */
  private drawDots(ctx: SceneCtx, d: SceneDraw, el: SceneEl, m0: number, alpha: number): void {
    const e = el.dotIx;
    if (e < 0 || e >= this.dotR.length) return;
    // Inside a repeat only this copy's slice of the buffer is drawn, under this copy's own frame and alpha.
    const from = el.rmul > 1 ? sclamp(this.inst, 0, el.rmul - 1) * el.n : 0;
    const m = this.mat;
    const a = m[m0], b = m[m0 + 1], c = m[m0 + 2], dd = m[m0 + 3], ox = m[m0 + 4], oy = m[m0 + 5];
    const scale = Math.sqrt(Math.abs(a * dd - b * c)) || 1;
    const rbuf = this.dotR[e], xbuf = this.dotDX[e], ybuf = this.dotDY[e], pbuf = this.dotP[e];
    const qx = el.qx, qy = el.qy;
    if (!qx || !qy) return;
    const xy = this.scratch;
    ctx.globalAlpha = alpha;
    for (let p = 0; p < el.pal.length; p++) {
      const colour = this.col(d, el.pal[p]);
      for (let step = 1; step <= 7; step++) {
        let n = 0;
        for (let i = 0; i < el.n; i++) {
          const k = from + i;
          if (pbuf[k] !== p) continue;
          const q = Math.round((rbuf[k] / el.rmax) * 7);
          if (q !== step) continue;
          const lx = qx[i] + xbuf[k], ly = qy[i] + ybuf[k];
          xy[n * 2] = a * lx + c * ly + ox;
          xy[n * 2 + 1] = b * lx + dd * ly + oy;
          n++;
        }
        if (!n) continue;
        const r = ((step / 7) * el.rmax) * scale;
        if (ctx.dots) ctx.dots(xy, n, r, colour);
        else {
          ctx.fillStyle = colour;
          ctx.beginPath();
          for (let i = 0; i < n; i++) { ctx.moveTo(xy[i * 2] + r, xy[i * 2 + 1]); ctx.arc(xy[i * 2], xy[i * 2 + 1], r, 0, TAU2); }
          ctx.fill();
        }
        this.drawCalls++;
      }
    }
  }

  /** Both ends of a chain, in its own frame: pinXY[0,1] is `from` and pinXY[2,3] is `to`. */
  private pinXY = new Float64Array(4);

  /**
   * One end of a chain, in the chain's own (bot-height) frame: the element's own origin, an anchor, or another
   * element. True: it is pinned, and the two numbers are in pinXY. It writes, so a frame allocates nothing.
   */
  private pin(el: SceneEl, which: number, d: SceneDraw, m0: number): boolean {
    const ref = which ? el.cto : el.cfrom;
    const k = which * 2;
    if (ref < 0) return false;
    if (ref >= 100) {
      // The named element's own frame was the parent's; its offset is read in this chain's frame, which is enough
      // for a tail that hangs off a body drawn beside it.
      this.pinXY[k] = which ? el.ctoX : el.cfromX;
      this.pinXY[k + 1] = which ? el.ctoY : el.cfromY;
      return true;
    }
    if (!d.anchors) return false;
    const m = this.mat;
    const a = m[m0], b = m[m0 + 1], c = m[m0 + 2], dd = m[m0 + 3], ox = m[m0 + 4], oy = m[m0 + 5];
    // An anchor is in pixels: bring it back into this chain's frame.
    const det = a * dd - b * c;
    if (!det) return false;
    const q = ref * 6;
    const dx = d.anchors[q] - ox, dy = d.anchors[q + 1] - oy;
    this.pinXY[k] = (dd * dx - c * dy) / det;
    this.pinXY[k + 1] = (-b * dx + a * dy) / det;
    return true;
  }

  /** A rope or a closed soft ring: stepped here, where its pins are known, then drawn. */
  private drawChain(ctx: SceneCtx, d: SceneDraw, el: SceneEl, m0: number, scale: number): void {
    // One rope per copy, from the element's own slot: inside a repeat each copy keeps its own points.
    const s = el.slot + (el.rmul > 1 ? sclamp(this.inst, 0, el.rmul - 1) : 0);
    if (el.slot < 0 || s >= this.chainX.length) return;
    const X = this.chainX[s], Y = this.chainY[s], PX = this.chainPX[s], PY = this.chainPY[s];
    const m = this.mat;
    const a = m[m0], b = m[m0 + 1], c = m[m0 + 2], dd = m[m0 + 3], ox = m[m0 + 4], oy = m[m0 + 5];
    const seg = el.clen / (el.cclosed ? el.cn : Math.max(1, el.cn - 1));
    const P = this.pinXY;
    const p0 = this.pin(el, 0, d, m0), p1 = this.pin(el, 1, d, m0);
    if (!this.chainReady[s]) {
      this.chainReady[s] = 1;
      for (let i = 0; i < el.cn; i++) {
        let x: number, y: number;
        if (el.cclosed) {
          const ang = (i / el.cn) * TAU2, r = el.clen / TAU2;
          x = (p0 ? P[0] : 0) + Math.cos(ang) * r;
          y = (p0 ? P[1] : 0) + Math.sin(ang) * r;
        } else {
          x = (p0 ? P[0] : 0) + (p1 ? (P[2] - P[0]) * (i / (el.cn - 1)) : 0);
          y = (p0 ? P[1] : 0) + (p1 ? (P[3] - P[1]) * (i / (el.cn - 1)) : seg * i);
        }
        X[i] = x; Y[i] = y; PX[i] = x; PY[i] = y;
      }
      this.chainArea[s] = polyArea(X, Y, el.cn);
    }
    const steps = Math.min(16, Math.round(this.pending / SSTEP));
    for (let q = 0; q < steps; q++) {
      for (let i = 0; i < el.cn; i++) {
        const vx = (X[i] - PX[i]) * el.cdrag, vy = (Y[i] - PY[i]) * el.cdrag;
        PX[i] = X[i]; PY[i] = Y[i];
        X[i] += vx;
        Y[i] += vy + el.cg * SSTEP * SSTEP;
      }
      for (let it = 0; it < el.citer; it++) {
        const last = el.cclosed ? el.cn : el.cn - 1;
        for (let i = 0; i < last; i++) {
          const j = (i + 1) % el.cn;
          let dx = X[j] - X[i], dy = Y[j] - Y[i];
          const len = Math.hypot(dx, dy) || 1e-6;
          const push = ((len - seg) / len) * 0.5 * el.cstiff;
          dx *= push; dy *= push;
          X[i] += dx; Y[i] += dy;
          X[j] -= dx; Y[j] -= dy;
        }
        if (el.carea > 0) {
          const now = polyArea(X, Y, el.cn), want = this.chainArea[s];
          const k = ((want - now) / Math.max(1e-4, Math.abs(want))) * el.carea * 0.25;
          for (let i = 0; i < el.cn; i++) {
            const pi = (i + el.cn - 1) % el.cn, ni = (i + 1) % el.cn;
            let nx = Y[ni] - Y[pi], ny = -(X[ni] - X[pi]);
            const l = Math.hypot(nx, ny) || 1e-6;
            nx /= l; ny /= l;
            X[i] += nx * k * seg;
            Y[i] += ny * k * seg;
          }
        }
        if (p0) { X[0] = P[0]; Y[0] = P[1]; }
        if (p1) { X[el.cn - 1] = P[2]; Y[el.cn - 1] = P[3]; }
        if (el.cfloor === el.cfloor) for (let i = 0; i < el.cn; i++) if (Y[i] > el.cfloor) Y[i] = el.cfloor;
      }
    }
    for (let i = 0; i < el.cn; i++) if (!Number.isFinite(X[i] + Y[i])) { this.kill("nan"); return; }
    // Drawn: as a line, as a filled ring, or as dots.
    const need = el.cn * 2;
    if (this.flatXY.length < need) this.flatXY = new Float64Array(need);
    const xy = this.flatXY;
    for (let i = 0; i < el.cn; i++) { xy[i * 2] = a * X[i] + c * Y[i] + ox; xy[i * 2 + 1] = b * X[i] + dd * Y[i] + oy; }
    if (el.fill || el.stroke) {
      ctx.beginPath();
      ctx.moveTo(xy[0], xy[1]);
      for (let i = 1; i < el.cn; i++) ctx.lineTo(xy[i * 2], xy[i * 2 + 1]);
      if (el.cclosed) ctx.closePath();
      if (el.fill) { ctx.fillStyle = this.col(d, el.fill); ctx.fill(); this.drawCalls++; }
      if (el.stroke) {
        ctx.strokeStyle = this.col(d, el.stroke);
        ctx.lineWidth = Math.max(0.5, el.width.c * scale);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        this.drawCalls++;
      }
    }
    if (el.cdots) {
      const r = el.cdots * scale, colour = this.col(d, el.paint);
      const buf = this.scratch.length >= need ? this.scratch : new Float32Array(need);
      for (let i = 0; i < need; i++) buf[i] = xy[i];
      if (ctx.dots) ctx.dots(buf, el.cn, r, colour);
      else {
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let i = 0; i < el.cn; i++) { ctx.moveTo(buf[i * 2] + r, buf[i * 2 + 1]); ctx.arc(buf[i * 2], buf[i * 2 + 1], r, 0, TAU2); }
        ctx.fill();
      }
      this.drawCalls++;
    }
  }
}

function polyArea(x: Float64Array, y: Float64Array, n: number): number {
  let a = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += x[i] * y[j] - x[j] * y[i]; }
  return a / 2;
}

/** The rest places of a grid field, centred on the element's origin. */
function restGrid(el: SceneEl): void {
  const qx = el.qx, qy = el.qy;
  if (!qx || !qy) return;
  const rowGap = el.grid === GRID_HEX ? el.gap * 0.866 : el.gap;
  for (let i = 0; i < el.n; i++) {
    const c = i % el.cols, r = Math.floor(i / el.cols);
    const off = el.grid === GRID_HEX && r % 2 ? el.gap / 2 : 0;
    qx[i] = (c - (el.cols - 1) / 2) * el.gap + off;
    qy[i] = (r - (el.rows - 1) / 2) * rowGap;
  }
}

/** The rest places of a field laid along a shape: n points, evenly spaced by length. */
function alongPath(shape: SceneEl | undefined, el: SceneEl): void {
  const qx = el.qx, qy = el.qy;
  if (!qx || !qy) return;
  const pts: number[] = [];
  if (shape?.path) flatten(shape.path, pts);
  if (pts.length < 4) { for (let i = 0; i < el.n; i++) { qx[i] = 0; qy[i] = 0; } return; }
  const m = pts.length / 2;
  let total = 0;
  const run: number[] = [0];
  for (let i = 1; i < m; i++) { total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]); run.push(total); }
  for (let i = 0; i < el.n; i++) {
    const want = total * (el.n === 1 ? 0 : i / (el.n - 1));
    let k = 1;
    while (k < m - 1 && run[k] < want) k++;
    const a = run[k - 1], b = run[k], w = b === a ? 0 : (want - a) / (b - a);
    qx[i] = pts[k * 2 - 2] + (pts[k * 2] - pts[k * 2 - 2]) * w;
    qy[i] = pts[k * 2 - 1] + (pts[k * 2 + 1] - pts[k * 2 - 1]) * w;
  }
}

/** A path as a polyline: curves in eight pieces, a circle in twenty-four. */
function flatten(p: Float64Array, out: number[]): void {
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const q = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    for (let s = 1; s <= 8; s++) {
      const u = s / 8, v = 1 - u;
      out.push(v * v * x0 + 2 * v * u * x1 + u * u * x2, v * v * y0 + 2 * v * u * y1 + u * u * y2);
    }
  };
  for (let i = 0; i < p.length;) {
    const cmd = p[i];
    if (cmd === SO_M) { cx = p[i + 1]; cy = p[i + 2]; sx = cx; sy = cy; out.push(cx, cy); i += 3; }
    else if (cmd === SO_L) { cx = p[i + 1]; cy = p[i + 2]; out.push(cx, cy); i += 3; }
    else if (cmd === SO_Q) { q(cx, cy, p[i + 1], p[i + 2], p[i + 3], p[i + 4]); cx = p[i + 3]; cy = p[i + 4]; i += 5; }
    else if (cmd === SO_C) {
      for (let s = 1; s <= 8; s++) {
        const u = s / 8, v = 1 - u;
        out.push(
          v * v * v * cx + 3 * v * v * u * p[i + 1] + 3 * v * u * u * p[i + 3] + u * u * u * p[i + 5],
          v * v * v * cy + 3 * v * v * u * p[i + 2] + 3 * v * u * u * p[i + 4] + u * u * u * p[i + 6],
        );
      }
      cx = p[i + 5]; cy = p[i + 6];
      i += 7;
    } else if (cmd === SO_Z) { out.push(sx, sy); cx = sx; cy = sy; i += 1; }
    else if (cmd === SO_O) {
      for (let s = 0; s <= 24; s++) { const ang = (s / 24) * TAU2; out.push(p[i + 1] + Math.cos(ang) * p[i + 3], p[i + 2] + Math.sin(ang) * p[i + 3]); }
      i += 4;
    } else break;
  }
}

// ===================================================================== one still picture

/** What a still asks for: the bot's slug as the glance names it, the moment, and the person's own bot colour. */
export interface StillAsk {
  avatar: string;
  moment: string;
  /** #rrggbb, or nothing for the engine's palette. */
  color?: string | null;
}

/** Frames settled before anything else (so he stands), the rate a moment is stepped at, and the furthest it is run. */
const STILL_SETTLE = 40, STILL_FPS = 30, STILL_MAX = 360;

/** A module this build may not have (the window and the server have none of them): null rather than a throw. */
function stillDep<T>(load: () => unknown): T | null {
  try {
    return load() as T;
  } catch {
    return null;
  }
}

/** The same slug always settles the same way. */
function stillSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * ONE STILL OF ANY MOMENT, AS PNG BYTES (native/SPEC.md 2.7). A widget, a Live Activity and a key print cannot
 * animate and have no network, so the phone draws the frame itself, from the catalog it already has, and leaves the
 * file in the art channel. Every animation the catalog gains — format 1 or a format-2 scene — gets its still here,
 * with no new code on either native side.
 *
 *   at      0 to 1 of the moment's own duration, not seconds
 *   size    pixels; the longer edge wins, and the square is drawn on a CPU raster (never a GPU or offscreen one:
 *           iOS forbids GPU work from a background app, and a catalog sync can run in a silent-push wake)
 *   scheme  only paints that depend on the ground follow it. The engine's ink and paper are fixed, so today both
 *           schemes give the same bytes; it is taken now so a scheme-aware paint needs no new signature.
 *
 * An unknown moment, one the server has switched off, or one this build's format cannot play draws the moment's
 * fallback act instead. Nothing personal goes anywhere to make it. Never throws: any failure is a null, and the
 * caller falls back to a bundled pose. The window and the server have no Skia, so there it is always null.
 */
export function renderStill(
  ask: StillAsk,
  at: number,
  size: { w: number; h: number },
  scheme: "light" | "dark",
): Uint8Array | null {
  void scheme;
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
  let surface: any = null;
  try {
    const sk = stillDep<any>(() => require("@shopify/react-native-skia"));
    const ctxMod = stillDep<any>(() => require("../onboard/skiaCtx"));
    const core = stillDep<any>(() => require("./core"));
    if (!sk?.Skia?.Surface?.Make || !ctxMod?.SkiaCtx || !core?.BotTile) return null;
    const slug = String(ask.avatar ?? "");
    const px = Math.max(8, Math.min(1024, Math.round(Math.max(size.w, size.h)) || 0));
    if (!slug || !px) return null;
    // The catalog in use, with the server's off list; before the kept copy has loaded, the build's starter pack.
    const live = stillDep<any>(() => require("./looks"));
    const now = typeof live?.looksNow === "function" ? live.looksNow() : null;
    let looks = now?.looks ?? null;
    if (!looks) {
      const starter = stillDep<any>(() => require("./starter"));
      looks = starter?.STARTER ? core.compileLooks(starter.STARTER) : null;
    }
    const kind = core.kindOf(slug);
    const seed = stillSeed(slug);
    const colour = ask.color && /^#[0-9a-f]{6}$/i.test(ask.color) ? ask.color : core.PALETTE[seed % core.PALETTE.length];
    surface = sk.Skia.Surface.Make(px, px);
    if (!surface) return null;
    const tile = new core.BotTile({
      kind,
      color: colour,
      mood: "idle",
      seed,
      size: px * 0.78,
      avatar: looks?.avatar ? looks.avatar(kind, slug) : null,
      toys: false,
    });
    tile.cloth = 0;
    tile.resize(px, px, px * 0.92);
    for (let i = 0; i < STILL_SETTLE; i++) tile.step(1 / STILL_FPS);
    const off = now?.off ? !!now.off(ask.moment) : false;
    const moment = !off && looks?.moment ? looks.moment(String(ask.moment ?? "")) : null;
    if (moment && tile.playMoment(moment, "once")) {
      const u = Math.max(0, Math.min(1, Number(at) || 0));
      const frames = Math.min(STILL_MAX, Math.round(u * moment.dur * STILL_FPS));
      for (let i = 0; i < frames; i++) tile.step(1 / STILL_FPS);
    } else if (looks?.fallback) {
      // Unknown, switched off, or past what this build plays: the act the catalog names instead.
      tile.setAct(looks.fallback(String(ask.moment ?? "")));
      for (let i = 0; i < STILL_SETTLE; i++) tile.step(1 / STILL_FPS);
    }
    // The physics are settled, then it is drawn once: what a person sees is a frame, never a loop.
    tile.still = true;
    const canvas = surface.getCanvas();
    canvas.clear(sk.Skia.Color("transparent"));
    tile.draw(new ctxMod.SkiaCtx(canvas), 1);
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      return image.encodeToBytes(sk.ImageFormat.PNG, 100) ?? null;
    } finally {
      try { image.dispose(); } catch { /* already gone */ }
    }
  } catch {
    return null;
  } finally {
    try { surface?.dispose(); } catch { /* already gone */ }
  }
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
}
