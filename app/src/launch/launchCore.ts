/**
 * THE LAUNCH: the native splash, then the bot pulls himself up over his bar and is gone, hands and all; his hands come
 * back and grip the bar, and it is pulled in to its middle with them; and the app is there.
 *
 * The native splash (app.config.ts, expo-splash-screen) is the app icon's Blip, small, in ink: hanging upside down from
 * a piece of bar by his robot hands, his shades on, his feelers hanging from the top of his head (at the bottom),
 * centred on white: the Bots app's own paper, so the end of the launch is already the app's ground. His feelers swing
 * with physics as he moves (feelerTrack, below).
 * LaunchCurtain draws that same picture in the same place from the same art (assets/launch, cut by
 * tools/media/brand/blip-icon/launch/gen.mjs), lifts the native splash from under it, and plays the motion
 * below. It lets go once the motion is over and the app has a screen (SduiApp calls liftLaunch()), whichever is later.
 *
 * Every moving part is a function of t, the ms since the motion began, sampled into keys for Animated.interpolate:
 * the whole motion runs on the native driver, so a busy JavaScript thread during start-up cannot stutter it.
 *
 * THE MOTION ITSELF IS THE SERVER'S ("the launch the server sends", below): the functions here are the one this build
 * was cut with, and launchMotion(spec) compiles the one the server sent into the same shape. launchMotion.ts says
 * which of the two plays.
 *
 * Nothing here imports React Native, so the numbers are tested on their own (launchCore.test.ts), and the backend's
 * tests/launch-motion.test.ts plays its own file through launchMotion() when the two repos sit side by side.
 */

import { compileWith } from "../botTiles/core.ts";
import { FEELER_ART } from "./feelerArt.ts";

/** The ground. The NATIVE splash's colour (app.config.ts), so it is a constant: a server value could only break the join. */
export const GROUND = "#FFFFFF";

/** The splash art's size in points: app.config.ts imageWidth. The art is centred in the window on both. */
export const SPLASH_PT = 136;

/** One art pixel in points (the art is 544 px square, 4x). */
export const U = SPLASH_PT / 544;

/** The bar, in the art's pixels (launch.mjs prints it; the bar layer's own bounds). */
export const BAR = { x0: 48, y0: 138, x1: 495, y1: 195 } as const;

/** The bar's top edge, in points from the art's top: the ledge he goes over. Nothing of him shows above it. */
export const BAR_TOP = BAR.y0 * U + SPLASH_PT * 0.012;

/** Where the gloves grip: the bar's lower edge, as a fraction of the art below BAR_TOP (their squeeze's origin). */
export const GRIP_AT = (BAR.y1 * U - BAR_TOP) / SPLASH_PT;

/** How long the motion lasts, ms: then the window is the app's white. */
export const LAUNCH_MS = 2200;

/** How long the curtain takes to fade into the app, ms. */
export const FADE_MS = 220;

/** How many strips the bar is cut into for its pull-in. */
export const STRIPS = 48;

// The beats (t, ms):
//   0      the splash, still · 200 a glint across his shades (where the old bot blinked)
//   420    he gathers: a small dip, the bar giving under him · 560 he pulls himself up, quick out and slow in, a little
//          sway, his head going up behind the bar · 690 / 740 his gloves let go, left then right, while he is still
//          rising: each slips behind the bar after him, fingers first, and is gone as his head is
//   900    the bar springs back up, free of him, and settles; half a second with nobody there
//   1400 / 1450  his gloves come back to the bar's middle, side by side: the left in from above, grabbing its top,
//          the right in from below, grabbing its bottom; each squeezes as it lands, and the bar gives
//   1730   the bar's middle pinches · 1810 it is pulled in to its middle, faster and faster, into his gloves there,
//          the two twisting against each other as it goes · 1970 they close on the middle · 2120 gone · 2200 white

/** His head at a moment: how far it has gone up (points), its sway (degrees), its squash, the blink, and whether it shows. */
export interface HeadPose { dy: number; sway: number; sq: number; shut: number; shown: number }
/** One glove at a moment (the fields are described on glove(), below). */
export interface GlovePose { grip: number; dy: number; edge: number; lift: number; flip: number; gx: number; turn: number; size: number; shown: number }
/** One strip of the bar at a moment. */
export interface StripPose { dx: number; sx: number; sy: number; shown: number }

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const K = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (x: number) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const out = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const inOut = (x: number) => { const c = clamp(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

/** The bar's drop under him at t, points: a dip as he gathers, harder as he pulls, a kick as each glove lets go, then a spring back past rest. */
export function barDy(t: number): number {
  const gather = K(t, 420, 560), pull = K(t, 560, 900), free = K(t, 900, 1250);
  const sag = t < 560 ? ease(gather) * 1.6 : t < 900 ? 1.6 + Math.sin(pull * Math.PI) * 1.4 : 0;
  const spring = t >= 900 ? -Math.sin(free * Math.PI * 2.5) * (1 - free) * 3.2 : 0;
  const kick = -LET_GO.reduce((k, go) => k + Math.sin(K(t, go, go + 60) * Math.PI), 0) * 1.2;
  // His gloves grabbing it again: the one from above pushes it down a little, the one from below up.
  const grab = COME_BACK.reduce((k, c, side) => k + Math.sin(K(t, c + COME_BACK_MS - 20, c + COME_BACK_MS + 70) * Math.PI) * (side ? -0.9 : 0.9), 0);
  return sag + spring + kick + grab;
}

/** The head at t: how far it has gone up (dy, points, on top of the bar's), its sway (degrees), its squash, the blink. */
export function head(t: number): HeadPose {
  const gather = K(t, 420, 560), pull = K(t, 560, 900);
  const dip = ease(gather) * 3.5 * (1 - ease(K(t, 560, 640)));
  return {
    dy: dip - inOut(pull) * SPLASH_PT * 0.47,
    sway: Math.sin(pull * Math.PI) * -2.5,
    sq: t >= 560 && t < 900 ? 1 - Math.sin(pull * Math.PI) * 0.04 : 1,
    shut: (t > 200 && t < 280) || (t > 600 && t < 660) ? 1 : 0,
    shown: t < 900 ? 1 : 0,
  };
}

/** When each glove lets go, ms: the left, then the right, while his head is still going up behind the bar. */
export const LET_GO = [690, 740] as const;

/** How long a glove takes to slip behind the bar, ms (and to come back from behind it). */
export const LET_GO_MS = 140;

/**
 * When each glove comes back, ms: to the bar's middle, side by side, the left in from above to grip its top (turned over,
 * fingers down its face), the right in from below to grip its bottom.
 */
export const COME_BACK = [1400, 1450] as const;
export const COME_BACK_MS = 200;

/** The bar's middle pinches, ms: until then the bar is drawn whole; from then, in strips. */
export const PINCH_AT = 1730;

/** The bar is pulled in to its middle from SUCK_AT, and gone, gloves and all, at GONE_AT, ms. */
export const SUCK_AT = 1810;
export const GONE_AT = 2120;

/** How far a glove's clip edge comes down as it goes behind the bar, points: from the bar's top edge to its lower one. */
export const SLIP = BAR.y1 * U - BAR_TOP;

/** How far a glove comes in from, points: the left from above the bar, the right from below it. */
export const FROM = SPLASH_PT * 0.25;

/** How far the left glove's clip edge goes up as it comes in from above, points: out of its way. */
export const OPEN = SPLASH_PT * 0.45;

/** The bar's middle, top to bottom, points from the art's top: the left glove is turned over about it. */
export const BAR_MID = (BAR.y0 + BAR.y1) / 2 * U;

/** The last of it, ms: the gloves close on the middle and are gone with the bar. */
export const CLOSE_MS = 150;

/** Each glove in the art: its middle and half its width, points (launch.mjs; the hands layer's bounds, each side). */
export const GLOVES = [{ cx: 159 * U, half: 36 * U }, { cx: 385.5 * U, half: 36.5 * U }] as const;

const MID = SPLASH_PT / 2;

/**
 * How far the bar at x (points across the art) has been pulled in to its middle at t, 0 to 1: the near parts first,
 * each faster as it goes.
 */
export function pulled(x: number, t: number): number {
  const d = Math.min(1, Math.abs(x - MID) / ((BAR.x1 - BAR.x0) * U / 2));
  return Math.pow(K(K(t, SUCK_AT, GONE_AT), d * 0.22, d * 0.22 + 0.78), 2.6);
}

/** Where a glove grips the bar when it comes back, points across the art: the bar's middle, the two side by side. */
export const heldAt = (side: 0 | 1): number => (side ? MID + GLOVES[1].half + 1 : MID - GLOVES[0].half - 1);

/** Where a glove's middle is at t, points across the art: where he held the bar; then the middle; closing on it at the end. */
export function gloveX(side: 0 | 1, t: number): number {
  if (t < COME_BACK[side]) return GLOVES[side].cx;
  const x = heldAt(side);
  return x + (MID - x) * ease(K(t, GONE_AT - CLOSE_MS, GONE_AT));
}

/**
 * A glove at t (side 0 left, 1 right).
 *
 * Holding and letting go: grip, a squeeze toward the bar; dy, how far it has gone up into the bar; edge, how far the edge
 * it is clipped at has come down the bar's face (the fingers going behind it).
 *
 * Coming back, out of sight until then: lift, how far it still is from the bar (the left above it, the right below it),
 * fading in (shown) as it comes, quick out and slow in; flip, -1 for the left, turned over about the bar's middle so it
 * grips the top, fingers down; edge, opened up out of the left's way. Each squeezes as it lands, and the bar gives.
 *
 * Then gx, how far it is from where the art has it; turn, the two twisting against each other as the bar is pulled in to
 * them (degrees); size, 1 until they close on the middle at the end.
 */
export function glove(side: 0 | 1, t: number): GlovePose {
  const away = ease(K(t, LET_GO[side], LET_GO[side] + LET_GO_MS));
  const c = COME_BACK[side], landed = c + COME_BACK_MS, back = out(K(t, c, landed));
  const close = ease(K(t, GONE_AT - CLOSE_MS, GONE_AT)), wring = K(t, SUCK_AT, GONE_AT);
  const coming = t >= c, gone = t >= LET_GO[side] + LET_GO_MS;
  return {
    grip: ease(K(t, 560, 680)) * 0.22 + Math.sin(K(t, landed - 30, landed + 110) * Math.PI) * 0.12,
    dy: coming ? 0 : -away * SPLASH_PT * 0.06,
    edge: coming ? (side ? 0 : -OPEN) : away * SLIP,
    lift: coming ? (1 - back) * FROM * (side ? 1 : -1) : 0,
    flip: coming && !side ? -1 : 1,
    gx: gloveX(side, t) - GLOVES[side].cx,
    turn: Math.sin(wring * Math.PI * 2) * (1 - close) * 10 * (side ? 1 : -1),
    size: 1 - close,
    shown: t >= GONE_AT ? 0 : !gone ? 1 : !coming ? 0 : K(t, c, c + COME_BACK_MS * 0.5),
  };
}

/**
 * Strip i of n at t: the middle pinches; then each is pulled toward the bar's middle (the near ones first, each faster as
 * it goes), thinner, stretched along the way it goes, and gone when it gets there.
 */
export function strip(i: number, n: number, t: number): StripPose {
  const w = (BAR.x1 - BAR.x0) * U, x = BAR.x0 * U + w * (i + 0.5) / n, d = Math.abs(x - MID) / (w / 2);
  const k = pulled(x, t), near = Math.exp(-d * d * 9);
  return { dx: -(x - MID) * k, sx: 1 + k * 2.2, sy: (1 - ease(K(t, PINCH_AT, SUCK_AT)) * 0.38 * near) * (1 - k * 0.85), shown: k >= 0.995 ? 0 : 1 };
}

// --- the launch the server sends ------------------------------------------------------------------------------------

/**
 * THE LAUNCH IS DATA. The motion above is the one this build was cut with; the one that plays is the server's
 * (TAILZU-BACKEND shared/launch/launch.json, docs/launch.md), carried whole in every phone's bootstrap as
 * "app.launch" and kept with the rest of it. Here it is compiled: every field is a formula in the bots' motion
 * language (botTiles/core.ts compileWith, the engine the tiny bots' moments run on) of t, the ms since the motion
 * began, and the art's geometry. Nothing the server sends is run as code: a formula becomes that language's own
 * bytecode, which only does arithmetic.
 *
 * launchMotion(spec) gives a Launch shaped exactly like the functions above, so LaunchCurtain plays either one. A
 * spec this build cannot compile comes back with `errors`, v 0 and the build's own motion, and launchMotion.ts plays
 * the copy the build carries instead.
 */

/** The format this build plays (the backend's experience/phone/launch.ts LAUNCH_FORMAT, kept in step). */
export const LAUNCH_FORMAT = 1;

/** The longest launch this build plays, ms (the backend refuses more). The curtain's own cap still opens the app. */
export const LAUNCH_MAX_MS = 10000;

/** A launch as the server sends it (docs/launch.md has the format). Every field is a number or a formula. */
export interface LaunchSpec {
  v: number;
  format?: number;
  note?: string;
  length: number;
  fade?: number;
  pinchAt: number;
  macros?: Record<string, [string[], string]>;
  let?: Array<[string, string | number]>;
  bar?: Record<string, unknown>;
  head?: Record<string, unknown>;
  gloves?: Record<string, unknown>;
  strip?: Record<string, unknown>;
}

/** A launch, compiled: the same parts the functions above are, plus how long it runs and where it came from. */
export interface Launch {
  /** The served launch's version; 0 for the motion this build was cut with. */
  v: number;
  length: number;
  fade: number;
  pinchAt: number;
  /** Empty when the spec compiled. Otherwise why it did not, and the parts are the build's own. */
  errors: string[];
  bar(t: number): number;
  head(t: number): HeadPose;
  glove(side: 0 | 1, t: number): GlovePose;
  strip(i: number, n: number, t: number): StripPose;
}

/** Every part at rest: what a field the launch leaves out is, and what the splash is drawn in. */
const REST = {
  bar: { dy: 0 },
  head: { dy: 0, sway: 0, sq: 1, shut: 0, shown: 1 },
  gloves: { grip: 0, dy: 0, edge: 0, lift: 0, flip: 1, gx: 0, turn: 0, size: 1, shown: 1 },
  strip: { dx: 0, sx: 1, sy: 1, shown: 1 },
} as const;
type PartName = keyof typeof REST;

/** The names every formula reads, and each part's own (docs/launch.md). t is first: the rest never change. */
const LAUNCH_NAMES = ["t", "Z", "U", "barTop", "barMid", "barBottom", "barLeft", "barRight", "mid"];
const PART_NAMES: Record<PartName, readonly string[]> = { bar: [], head: [], gloves: ["side", "cx", "half"], strip: ["i", "n", "x", "d"] };
/** The art's geometry, in LAUNCH_NAMES order after t. */
const BAR_LEFT = BAR.x0 * U, BAR_RIGHT = BAR.x1 * U;
const GEO = [SPLASH_PT, U, BAR_TOP, BAR_MID, BAR.y1 * U, BAR_LEFT, BAR_RIGHT, MID];

/** The motion language reads at most this many names in one formula (compileWith's own ceiling). */
const MAX_NAMES = 32;
const MAX_LETS = 12, MAX_SRC = 400;
const LET_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

type Macros = Record<string, [string[], string]>;
type Fx = (vals: Float64Array) => number;

/** Spell out the launch's macros in `src`, as the desktop's blipCatalog.js expand() does: name(a, b) becomes the
 *  macro's body with its parameters replaced. The language itself has no functions of its own. */
export function expandLaunchMacros(src: string, macros: Macros): string {
  let out = String(src);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const name of Object.keys(macros)) {
      const [params, body] = macros[name]!;
      const re = new RegExp(`\\b${name}\\(`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(out))) {
        // The arguments: up to the matching ")", split on the commas at the top level.
        let depth = 1, i = m.index + m[0].length, start = i;
        const args: string[] = [];
        for (; i < out.length && depth; i++) {
          const ch = out[i];
          if (ch === "(") depth++;
          else if (ch === ")") { depth--; if (!depth) args.push(out.slice(start, i)); }
          else if (ch === "," && depth === 1) { args.push(out.slice(start, i)); start = i + 1; }
        }
        if (depth) throw new Error(`unclosed ${name}(`);
        if (args.length !== params.length) throw new Error(`${name} takes ${params.length}`);
        let b = body;
        params.forEach((p, k) => { b = b.replace(new RegExp(`\\b${p}\\b`, "g"), `(${args[k]!.trim()})`); });
        out = `${out.slice(0, m.index)}(${b})${out.slice(i)}`;
        re.lastIndex = 0;
        changed = true;
        if (out.length > 8000) throw new Error("too long");
      }
    }
    if (!changed) return out;
  }
  throw new Error("macros nest too deep");
}

function launchMacros(spec: unknown): Macros {
  const out: Macros = {};
  for (const [name, def] of Object.entries((spec ?? {}) as Record<string, unknown>)) {
    if (!LET_NAME.test(name) || !Array.isArray(def) || !Array.isArray(def[0]) || typeof def[1] !== "string") throw new Error(`macros.${name}: [[parameters], body]`);
    if (!def[0].every((p: unknown) => typeof p === "string" && LET_NAME.test(p))) throw new Error(`macros.${name}: its parameters`);
    out[name] = [def[0] as string[], def[1]];
  }
  return out;
}

/** One field: a number, or a formula over `names` (their values are handed to it at play time). */
function launchNumber(x: unknown, names: readonly string[], macros: Macros, where: string): Fx {
  if (typeof x === "number") {
    if (!Number.isFinite(x)) throw new Error(`${where}: not a finite number`);
    return () => x;
  }
  if (typeof x !== "string" || !x.trim() || x.length > MAX_SRC) throw new Error(`${where}: a number or an expression`);
  try {
    return compileWith(expandLaunchMacros(x, macros), names);
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
}

interface Lets { names: string[]; run: Array<{ at: number; f: Fx }> }

/** `let`: [name, formula] pairs, each able to read the ones before it. Gives the names after them and their runners. */
function launchLets(spec: unknown, names: string[], macros: Macros, where: string): Lets {
  if (spec === undefined) return { names, run: [] };
  if (!Array.isArray(spec) || spec.length > MAX_LETS) throw new Error(`${where}.let: at most ${MAX_LETS} [name, expression] pairs`);
  const run: Array<{ at: number; f: Fx }> = [];
  let ns = names;
  for (const pair of spec) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string" || !LET_NAME.test(pair[0])) throw new Error(`${where}.let: a new name and an expression`);
    // A launch's own lets are compiled again for each part, so one named like a part's own name (side, i, n, d, x,
    // cx, half) has nowhere to go: it is refused here, and the name is said so an admin can see which one it was.
    if (ns.includes(pair[0])) throw new Error(`${where}.let: a new name and an expression (${pair[0]} is already a name here)`);
    run.push({ at: ns.length, f: launchNumber(pair[1], ns, macros, `${where}.let ${pair[0]}`) });
    ns = ns.concat(pair[0]);
  }
  return { names: ns, run };
}

interface Runner { vals: Float64Array; run: Array<{ at: number; f: Fx }>; fields: Fx[] }

/**
 * One part, compiled. Its names are the ones every formula reads, then its own (side, i…), then the launch's lets and
 * then the part's: the launch's are compiled again for each part, because each part reads them from its own slots.
 */
function launchPart(kind: PartName, body: unknown, top: unknown, macros: Macros): Runner {
  const rest = REST[kind] as Record<string, number>;
  const spec = (body ?? {}) as Record<string, unknown>;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${kind}: an object`);
  for (const k of Object.keys(spec)) {
    if (k !== "let" && !Object.prototype.hasOwnProperty.call(rest, k)) throw new Error(`${kind}.${k}: not something the ${kind} has (${Object.keys(rest).join(", ")})`);
  }
  const base = [...LAUNCH_NAMES, ...PART_NAMES[kind]];
  // Counted before anything is compiled, so this says what is wrong rather than the language's own ceiling.
  const names = base.length + (Array.isArray(top) ? top.length : 0) + (Array.isArray(spec.let) ? spec.let.length : 0);
  if (names > MAX_NAMES) throw new Error(`${kind}: at most ${MAX_NAMES} names (the launch's lets and its own, with ${base.join(", ")})`);
  const withTop = launchLets(top, base, macros, "launch");
  const all = launchLets(spec.let, withTop.names, macros, kind);
  const fields = Object.keys(rest).map((k) => (spec[k] === undefined ? () => rest[k]! : launchNumber(spec[k], all.names, macros, `${kind}.${k}`)));
  return { vals: new Float64Array(all.names.length), run: [...withTop.run, ...all.run], fields };
}

/** t, the geometry and the part's own names into its slots, then its lets. Nothing is allocated while it plays. */
function runPart(p: Runner, t: number, own?: readonly number[]): Float64Array {
  const v = p.vals;
  v[0] = t;
  for (let i = 0; i < GEO.length; i++) v[i + 1] = GEO[i]!;
  if (own) for (let i = 0; i < own.length; i++) v[LAUNCH_NAMES.length + i] = own[i]!;
  for (const r of p.run) v[r.at] = r.f(v);
  return v;
}

/** How far from rest a launch may begin and still be the splash's own frame. */
const REST_EPS = 1e-6;

/**
 * THE LAUNCH MUST BEGIN ON THE SPLASH'S FRAME. The curtain draws t 0 and then lifts the native splash from under it,
 * so a launch that is not at rest there jumps at the join: a head already 8 points up, a glove already gone. Every
 * part is played once at 0 and compared with REST, and a launch that starts anywhere else is refused, so the copy
 * this build carries plays instead. Playing each part here also finds a formula that misbehaves now, not mid-launch.
 */
function atRest(play: Launch): void {
  const same = (got: number, want: number, where: string) => {
    if (!(Math.abs(got - want) <= REST_EPS)) throw new Error(`starts away from the splash frame: ${where} ${got}`);
  };
  same(play.bar(0), REST.bar.dy, "bar.dy");
  const h = play.head(0);
  for (const k of Object.keys(REST.head) as Array<keyof HeadPose>) same(h[k], REST.head[k], `head.${k}`);
  for (const side of [0, 1] as const) {
    const g = play.glove(side, 0);
    for (const k of Object.keys(REST.gloves) as Array<keyof GlovePose>) same(g[k], REST.gloves[k], `gloves.${k} (${side ? "right" : "left"})`);
  }
  for (const i of [0, STRIPS >> 1, STRIPS - 1]) {
    const s = play.strip(i, STRIPS, 0);
    for (const k of Object.keys(REST.strip) as Array<keyof StripPose>) same(s[k], REST.strip[k], `strip.${k} (${i})`);
  }
}

/**
 * HIS FEELERS MUST STAY FINITE. They are worked out from the head the launch gives (feelerTrack), and a head that
 * runs away carries them to NaN; the curtain turns each by "<n>deg", and a turn of "NaNdeg" is a key Animated cannot
 * read — it throws as the curtain draws, in release too, before any of the app has run, every start, because the
 * launch is kept on the device. So the whole track is worked out here and a launch whose feelers run away is refused.
 * The track is kept with the launch (feelCache), so the curtain pays nothing for this.
 */
function finiteFeelers(play: Launch): void {
  for (const a of feelerTrack(play)) {
    for (const k of ["l1", "l2", "r1", "r2"] as const) if (!Number.isFinite(a[k])) throw new Error(`his feelers run away: ${k} is ${a[k]}`);
  }
}

/**
 * A launch as the server sent it, compiled into the motion LaunchCurtain plays. It never throws: a spec this build
 * cannot play comes back with `errors` and the motion this build was cut with, so nothing ever has no launch.
 */
export function launchMotion(spec: unknown): Launch {
  try {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("a launch: an object");
    const c = spec as LaunchSpec;
    const allowed = ["v", "format", "note", "length", "fade", "pinchAt", "macros", "let", ...Object.keys(REST)];
    for (const k of Object.keys(c)) if (!allowed.includes(k)) throw new Error(`${k}: not something a launch has`);
    if (!Number.isInteger(c.v) || c.v < 1) throw new Error("v: a whole number, 1 or more");
    if ((c.format ?? LAUNCH_FORMAT) !== LAUNCH_FORMAT) throw new Error(`format: this build plays ${LAUNCH_FORMAT}`);
    if (!(Number.isFinite(c.length) && c.length > 0 && c.length <= LAUNCH_MAX_MS)) throw new Error(`length: ms, up to ${LAUNCH_MAX_MS}`);
    if (!(Number.isFinite(c.pinchAt) && c.pinchAt > 0 && c.pinchAt < c.length)) throw new Error("pinchAt: ms, inside the launch");
    const fade = c.fade === undefined ? FADE_MS : c.fade;
    if (!(Number.isFinite(fade) && fade >= 0 && fade <= 2000)) throw new Error("fade: ms, up to 2000");
    const macros = launchMacros(c.macros);
    const parts = { bar: launchPart("bar", c.bar, c.let, macros), head: launchPart("head", c.head, c.let, macros),
      gloves: launchPart("gloves", c.gloves, c.let, macros), strip: launchPart("strip", c.strip, c.let, macros) };
    const w = BAR_RIGHT - BAR_LEFT;   // the bar, left to right, points
    const play: Launch = {
      v: c.v, length: c.length, fade, pinchAt: c.pinchAt, errors: [],
      bar: (t) => parts.bar.fields[0]!(runPart(parts.bar, t)),
      head: (t) => {
        const v = runPart(parts.head, t), f = parts.head.fields;
        return { dy: f[0]!(v), sway: f[1]!(v), sq: f[2]!(v), shut: f[3]!(v), shown: f[4]!(v) };
      },
      glove: (side, t) => {
        const v = runPart(parts.gloves, t, [side, GLOVES[side].cx, GLOVES[side].half]), f = parts.gloves.fields;
        return { grip: f[0]!(v), dy: f[1]!(v), edge: f[2]!(v), lift: f[3]!(v), flip: f[4]!(v), gx: f[5]!(v), turn: f[6]!(v), size: f[7]!(v), shown: f[8]!(v) };
      },
      strip: (i, n, t) => {
        const x = BAR_LEFT + w * (i + 0.5) / Math.max(1, n), d = Math.abs(x - MID) / (w / 2);
        const v = runPart(parts.strip, t, [i, n, x, d]), f = parts.strip.fields;
        return { dx: f[0]!(v), sx: f[1]!(v), sy: f[2]!(v), shown: f[3]!(v) };
      },
    };
    // Played here, so a launch that would jump at the join, or draw a key Animated cannot read, is found now.
    atRest(play);
    finiteFeelers(play);
    return play;
  } catch (e) {
    return { ...BUILT_IN, v: 0, errors: [(e as Error).message || "a launch this build cannot play"] };
  }
}

/** The motion this build was cut with: what plays when neither the server's launch nor the build's copy compiles. */
export const BUILT_IN: Launch = {
  v: 0, length: LAUNCH_MS, fade: FADE_MS, pinchAt: PINCH_AT, errors: [],
  bar: barDy, head, glove, strip,
};

/**
 * Which launch to play: the one the server last sent (the bootstrap's "app.launch", kept with the rest of it) while it
 * compiles and is not older than the one this build carries; else the build's copy; else the motion above. A launch is
 * never half-played: one field this build cannot compile refuses the whole launch.
 */
export function pickLaunch(kept: unknown, starter: unknown): Launch {
  const ok = (x: unknown): Launch | null => {
    if (x === null || x === undefined) return null;
    const l = launchMotion(x);
    return l.errors.length ? null : l;
  };
  const build = ok(starter), sent = ok(kept);
  if (sent && (!build || sent.v >= build.v)) return sent;
  return build ?? BUILT_IN;
}

/**
 * The window the curtain samples a launch over: how far it keys each part, and where the bar pinches inside it. Never
 * two keys at the same moment, however short or odd a launch the server sent (Animated wants a rising input range).
 */
export function launchWindow(launch: Launch): { end: number; pinch: number } {
  const end = Math.max(launch.length, 60);
  return { end, pinch: Math.min(Math.max(2, launch.pinchAt), end - 1) };
}

/** How long the curtain plays a launch, ms: its own length, never past the moment the app opens whatever happens. */
export function playMs(launch: Launch, capMs: number): number {
  return Math.max(0, Math.min(launch.length, capMs - launch.fade));
}

export interface Track { inputRange: number[]; outputRange: number[] }

/**
 * A sampling, trimmed: a run of keys with the same value keeps only its two ends. What Animated.interpolate draws is
 * the same line (the keys it drops sit on it), and a field that holds still for most of the launch — every strip
 * before the pinch, a glove that is not there yet — costs a handful of keys instead of hundreds.
 *
 * A sample that is not a finite number is drawn as 0: Animated throws on a key it cannot read ("NaNdeg"), and the
 * launch must never be the thing that stops the app opening. launchMotion refuses such a launch outright; this is
 * the backstop under that.
 */
function trim(inputRange: number[], outputRange: number[]): Track {
  const vs = outputRange.map((v) => (Number.isFinite(v) ? v : 0));
  const ti: number[] = [], to: number[] = [];
  for (let i = 0; i < inputRange.length; i++) {
    const flat = i > 0 && i < inputRange.length - 1 && vs[i - 1] === vs[i] && vs[i] === vs[i + 1];
    if (flat) continue;
    ti.push(inputRange[i]!);
    to.push(vs[i]!);
  }
  return { inputRange: ti, outputRange: to };
}

/** f sampled every `step` ms from `from` to `to`, for Animated.interpolate (clamped outside). */
export function keys(f: (t: number) => number, from = 0, to = LAUNCH_MS, step = 10): Track {
  const inputRange: number[] = [];
  for (let t = from; t < to; t += step) inputRange.push(t);
  inputRange.push(to);
  return trim(inputRange, inputRange.map((t) => +f(t).toFixed(3)));
}

/** The same, as "<n>deg" for a rotation. */
export function degKeys(f: (t: number) => number, from = 0, to = LAUNCH_MS, step = 10): { inputRange: number[]; outputRange: string[] } {
  return asDeg(keys(f, from, to, step));
}

/** A sampled track as "<n>deg", for a rotation. */
export function asDeg(k: Track): { inputRange: number[]; outputRange: string[] } {
  return { inputRange: k.inputRange, outputRange: k.outputRange.map((v) => `${v}deg`) };
}

/**
 * Every field of one part sampled in one sweep: the part's formulas (and its lets) are run once per moment rather
 * than once per field, which is what keeps the curtain's 48 strips cheap to key.
 */
export function partKeys<T extends object>(f: (t: number) => T, from: number, to: number, step = 10): { [K in keyof T]: Track } {
  const ts: number[] = [];
  for (let t = from; t < to; t += step) ts.push(t);
  ts.push(to);
  const rows = ts.map(f);
  const out = {} as { [K in keyof T]: Track };
  for (const k of Object.keys(rows[0] ?? {}) as Array<keyof T>) out[k] = trim(ts, rows.map((r) => +Number(r[k]).toFixed(3)));
  return out;
}

// --- the feelers ---------------------------------------------------------------------------------------------------

/**
 * BLIP'S FEELERS hang from the top of his head (he hangs upside down, so that is the bottom of the picture) and swing
 * with physics. Each is two links: the first hangs from its root on his head, the second from the first one's end. They
 * are part of the head: inside its clip, they go up behind the bar with it. Each link is a pendulum on a moving pivot, with gravity, a spring toward
 * its rest angle (relative to the head for the first, to the first for the second) and damping:
 *
 *   L a'' = -(g - Ay) sin a + Ax cos a  +  L k (rest - a)  -  L c a'
 *
 * where a is the link's angle as a CSS rotation of it hanging straight down (+ve swings it left) and (Ax, Ay) is its
 * pivot's acceleration (y down: a pivot rising faster makes the link hang heavier, one slowing makes it lighter). The first link's pivot is the root, carried by the head's motion (head(t): its rise, sway and
 * squash, and the bar's dip under him); the second's is the first one's end. Integrated once in 1 ms steps from the
 * rest the splash is drawn in, sampled every 10 ms for the native driver like everything else. The feelers are the
 * icon's own, cut in two and drawn at rest; the geometry and the numbers come from the art's generator (feelerArt.ts).
 */
export interface FeelerAngles { l1: number; l2: number; r1: number; r2: number }

const FA = FEELER_ART;
const FEEL_DT = 1;   // ms

/** A moment of the head, as the feelers' physics reads it: his pose and the bar he hangs from. */
interface HeadAt { h: HeadPose; bar: number }

function headAt(launch: Launch, t: number): HeadAt {
  const tt = Math.max(0, t);
  return { h: launch.head(tt), bar: launch.bar(Math.min(tt, launch.pinchAt)) };
}

function pointOf(at: HeadAt, x: number, y: number): [number, number] {
  const cx = SPLASH_PT / 2, px = x * U, py = y * U - BAR_TOP + at.h.dy;   // the head piece's frame: origin at the bar's top, x across the art
  const sy = py * at.h.sq, a = at.h.sway * Math.PI / 180;
  return [cx + (px - cx) * Math.cos(a) - sy * Math.sin(a), (px - cx) * Math.sin(a) + sy * Math.cos(a) + BAR_TOP + at.bar];
}

/** Where a point of the head's art (544 px frame) is at t, in points from the art's top left. */
export function headPoint(x: number, y: number, t: number, launch: Launch = BUILT_IN): [number, number] {
  return pointOf(headAt(launch, t), x, y);
}

/** How long the feelers are worked out for in the motion this build was cut with, ms: his head is gone after. */
export const FEELERS_MS = 900;

/** When they fade in that motion, ms: over the end of his rise, before his head goes at 900. */
export const FEELERS_OUT = [790, 880] as const;

/** How long before his head goes the feelers start and finish fading, ms. */
const FADE_BEFORE = [110, 20] as const;

const windowCache = new WeakMap<Launch, { end: number; out: [number, number] }>();

/**
 * The window the feelers belong to IN THE LAUNCH THAT IS PLAYING: up to the moment his head goes (the first 10 ms
 * sample where it no longer shows, or the end of the launch if it never does), fading out over the 90 ms before
 * that. They hang below his head, so at the top of his climb their tips still trail below the bar when the rest of
 * him is behind it: the fade is what takes them with him.
 *
 * The motion this build was cut with hides his head at 900, so for it this is FEELERS_MS and FEELERS_OUT exactly;
 * a slower pull-up from the server carries its feelers all the way up instead of losing them partway.
 */
export function feelerWindow(launch: Launch = BUILT_IN): { end: number; out: [number, number] } {
  const done = windowCache.get(launch);
  if (done) return done;
  let end = launch.length;
  for (let t = 0; t <= launch.length; t += 10) if (!(launch.head(t).shown > 0)) { end = t; break; }
  const w = { end, out: [end - FADE_BEFORE[0], end - FADE_BEFORE[1]] as [number, number] };
  windowCache.set(launch, w);
  return w;
}

const feelCache = new WeakMap<Launch, FeelerAngles[]>();
/**
 * The feelers' turns every 10 ms over the launch's own feeler window (feelerWindow: his head is gone after it), in
 * degrees, as the views apply them:
 * each piece's turn about its pivot AWAY FROM ITS DRAWN REST (so 0 is the art as drawn): l1 the left's first piece
 * inside the head, l2 its second piece inside the first; r1, r2 the right's. They follow the launch that is playing,
 * so a new motion from the server carries them with it.
 *
 * The springs' rests are worked out so that rest under gravity is the drawn shape: for a piece at angle a,
 * k (r - a) = (g / L) sin a, so r = a + (g / (L k)) sin a.
 */
export function feelerTrack(launch: Launch = BUILT_IN): FeelerAngles[] {
  const done = feelCache.get(launch);
  if (done) return done;
  const last = feelerWindow(launch).end;
  const rad = Math.PI / 180, { g, k1, k2, c1, c2 } = FA.phys, out: FeelerAngles[] = [];
  // His head at every millisecond the physics asks about, worked out once: the two sides and the three steps of each
  // finite difference would otherwise run the launch's formulas six times over for the same moment.
  const poses: HeadAt[] = [];
  for (let t = -1; t <= last + 1; t++) poses.push(headAt(launch, t));
  const poseAt = (t: number): HeadAt => poses[Math.max(0, Math.min(poses.length - 1, t + 1))]!;
  const sides = (["L", "R"] as const).map((s) => {
    const L1 = FA.L1[s] * U, L2 = FA.L2[s] * U, e1 = FA.rest[s].a1 * rad, e2 = FA.rest[s].a2 * rad;
    return {
      root: FA.roots[s], L1, L2, e1, e2,
      rest1: e1 + (g / (L1 * k1)) * Math.sin(e1), rest2: e2 - e1 + (g / (L2 * k2)) * Math.sin(e2),
      a1: e1, v1: 0, a2: e2, v2: 0,
    };
  });
  const dt = FEEL_DT / 1000, h = 1;   // s; the finite-difference step for the root's acceleration, ms
  for (let t = 0; t <= last; t += FEEL_DT) {
    const sway = poseAt(t).h.sway * rad;
    for (const S of sides) {
      const p0 = pointOf(poseAt(t - h), S.root[0], S.root[1]), p1 = pointOf(poseAt(t), S.root[0], S.root[1]), p2 = pointOf(poseAt(t + h), S.root[0], S.root[1]);
      const hs = h / 1000, ax = (p2[0] - 2 * p1[0] + p0[0]) / (hs * hs), ay = (p2[1] - 2 * p1[1] + p0[1]) / (hs * hs);
      // the first piece (its world angle a1; its spring's rest rides the head's sway)
      const acc1 = (-(g - ay) * Math.sin(S.a1) + ax * Math.cos(S.a1)) / S.L1 + k1 * (sway + S.rest1 - S.a1) - c1 * S.v1;
      // the first piece's end: the second's pivot, and its acceleration
      const jx = ax + S.L1 * (Math.sin(S.a1) * S.v1 * S.v1 - Math.cos(S.a1) * acc1), jy = ay + S.L1 * (-Math.cos(S.a1) * S.v1 * S.v1 - Math.sin(S.a1) * acc1);
      const acc2 = (-(g - jy) * Math.sin(S.a2) + jx * Math.cos(S.a2)) / S.L2 + k2 * (S.a1 + S.rest2 - S.a2) - c2 * S.v2;
      S.v1 += acc1 * dt; S.a1 += S.v1 * dt; S.v2 += acc2 * dt; S.a2 += S.v2 * dt;
    }
    if (t % 10 === 0) {
      const [L, R] = sides, d = 180 / Math.PI;
      out.push({
        l1: (L.a1 - sway - L.e1) * d, l2: (L.a2 - L.a1 - (L.e2 - L.e1)) * d,
        r1: (R.a1 - sway - R.e1) * d, r2: (R.a2 - R.a1 - (R.e2 - R.e1)) * d,
      });
    }
  }
  feelCache.set(launch, out);
  return out;
}

/** How much of the feelers shows at t: all of them while his head is up, fading over the launch's own window. */
export function feelersShown(t: number, launch: Launch = BUILT_IN): number {
  const { out } = feelerWindow(launch);
  return launch.head(t).shown * (1 - K(t, out[0], out[1]));
}

/** One feeler angle at t (degrees), from the track: the views' keys. */
export function feeler(which: keyof FeelerAngles, t: number, launch: Launch = BUILT_IN): number {
  const tr = feelerTrack(launch), i = Math.max(0, Math.min(tr.length - 1, Math.round(t / 10)));
  return tr[i]![which];
}

// --- the lift -----------------------------------------------------------------------------------------------------

let lifted = false;
const waiting = new Set<() => void>();

/** The app has something to show: the native splash goes (if it is still up) and the curtain lets go. Idempotent. */
export function liftLaunch(): void {
  hideNativeSplash();
  if (lifted) return;
  lifted = true;
  for (const f of Array.from(waiting)) f();
  waiting.clear();
}

/** Calls `f` once, when the launch is lifted (at once if it already has been). Returns the unsubscribe. */
export function onLift(f: () => void): () => void {
  if (lifted) { f(); return () => {}; }
  waiting.add(f);
  return () => { waiting.delete(f); };
}

export const isLifted = (): boolean => lifted;

/** Lift the native splash. index.ts holds it (preventAutoHideAsync); a runtime without the module has none to lift. */
export function hideNativeSplash(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("expo-splash-screen").hideAsync?.()?.catch?.(() => {});
  } catch { /* nothing was holding it */ }
}
