/**
 * THE ONE PLACE BLIP IS TOLD WHERE TO STAND.
 *
 * Blip is a single character that walks between the steps of onboarding, and
 * the steps live in two different trees: the first three (hello, sign in, the
 * code) in the sign-in gate, the rest in the app. Anything drawn inside a tree
 * is rebuilt when the tree is, so he cannot live in either. He lives in an
 * overlay (BlipHost) mounted once in App.tsx, and the trees only SAY where he
 * should stand: a stage says "the progress bar is here, in this look", a spot
 * says "stand on me, in this pose, saying this".
 *
 * This file is the board they write on and the overlay reads. It holds no
 * pixels and imports nothing from React Native, so every rule below is tested
 * on its own (stageBus.test.ts) and the same file is what Metro bundles.
 *
 * Nothing here decides what is drawn. It only keeps the facts straight:
 *   - which stage is on screen, and which step it is on;
 *   - which spot is current (the last one pushed that is still there);
 *   - how far the current step has scrolled;
 *   - the furthest step each stage has reached, so a refetch never walks
 *     anyone backward;
 *   - whether the overlay should hold the paper while the app changes trees.
 */

// --- Shapes -----------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

/** What the server says the stage looks like. The overlay holds no colours of its own. */
export interface StageLook {
  ground: string;
  progress: { on: string; off: string; height: number; gap: number };
  bubble: { background: string; border: string; ink: string; font: string; size: number; bigSize: number };
  blip: { dot: string; sticker: string; glow: string };
  glide: { slide: number; outMs: number; inMs: number; inDelayMs: number };
}

export interface StageInfo {
  id: string;
  /** Overall index of this stage's first step (0 for sign-in, 3 after it). */
  first: number;
  /** How many progress segments there are in all. */
  of: number;
  /** The step showing now, within this stage. */
  step: number;
  look: StageLook;
  /** Where the stage's top-left corner is in the window. Null until measured. */
  origin: { x: number; y: number } | null;
}

export interface SpotInfo {
  token: number;
  stage: string;
  /** Which step layer owns it, so its scroll offset can be found. */
  layer: string;
  pose: string;
  h: number;
  say: string;
  bubble: "side" | "corner";
  burst: boolean;
  /** Relative to the step's scroll content. Null until measured. */
  rect: Rect | null;
  /** Bumped on every change, so the overlay can tell "same spot, new words". */
  rev: number;
}

/**
 * Where the app is, as far as the overlay cares. SduiApp maps its own phase
 * onto these (see the effect there): "stage" and "pending" are the moments
 * between a screen being asked for and the stage inside it being drawn.
 */
export type AppPhase = "loading" | "auth" | "connect" | "language" | "pending" | "stage" | "other";

/** off: draw nothing. live: a stage is on screen. hold: no stage, but keep the paper up. */
export type Mode = "off" | "live" | "hold";

export interface Snapshot {
  /** Changes whenever anything below does. */
  rev: number;
  mode: Mode;
  /** The stage on screen, or the one just left while holding. */
  stage: StageInfo | null;
  spot: SpotInfo | null;
  /** The current spot's step layer, scrolled this far. */
  scroll: number;
  reduced: boolean;
  appPhase: AppPhase;
  /** When the hold began (ms, Date.now), or 0. */
  holdSince: number;
}

/** What React needs to re-render for: not the spot rect, not the scroll. */
export interface View {
  mode: Mode;
  stage: Pick<StageInfo, "id" | "first" | "of" | "step" | "look"> | null;
}

// --- The look, with a fallback for every key --------------------------------

/**
 * The look the server asked for, filled in where it said nothing. The server
 * sends all of it, so these only matter to a stage whose props were cut short;
 * they are the approved design's own values (paper, ink, neon), and a stage
 * must never be able to leave the overlay without a colour to paint.
 */
export const DEFAULT_LOOK: StageLook = {
  ground: "#EFEDE8",
  progress: { on: "#1C1A17", off: "rgba(28,26,23,0.13)", height: 4, gap: 4 },
  bubble: { background: "#FCFBF8", border: "#1C1A17", ink: "#1C1A17", font: "Tailzu Hand", size: 19, bigSize: 22 },
  blip: { dot: "#F3E2C6", sticker: "#151311", glow: "#39FF14" },
  glide: { slide: 26, outMs: 230, inMs: 320, inDelayMs: 60 },
};

/** Reduced motion: no travel, and a plain fade each way. */
export const REDUCED_GLIDE: StageLook["glide"] = { slide: 0, outMs: 260, inMs: 260, inDelayMs: 0 };

export function readLook(p: Record<string, unknown> | null | undefined): StageLook {
  const d = DEFAULT_LOOK;
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const str = (v: unknown, f: string) => (typeof v === "string" && v ? v : f);
  const num = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const pr = o(p?.progress), bu = o(p?.bubble), bl = o(p?.blip), gl = o(p?.glide);
  return {
    ground: str(p?.ground, d.ground),
    progress: { on: str(pr.on, d.progress.on), off: str(pr.off, d.progress.off), height: num(pr.height, d.progress.height), gap: num(pr.gap, d.progress.gap) },
    bubble: {
      background: str(bu.background, d.bubble.background), border: str(bu.border, d.bubble.border), ink: str(bu.ink, d.bubble.ink),
      font: str(bu.font, d.bubble.font), size: num(bu.size, d.bubble.size), bigSize: num(bu.bigSize, d.bubble.bigSize),
    },
    blip: { dot: str(bl.dot, d.blip.dot), sticker: str(bl.sticker, d.blip.sticker), glow: str(bl.glow, d.blip.glow) },
    glide: {
      slide: num(gl.slide, d.glide.slide), outMs: num(gl.outMs, d.glide.outMs),
      inMs: num(gl.inMs, d.glide.inMs), inDelayMs: num(gl.inDelayMs, d.glide.inDelayMs),
    },
  };
}

// --- The rules that are worth testing alone ---------------------------------

/**
 * While the app swaps trees (sign-in lands, the first screen is fetched, the
 * screen is drawn) there is, for a moment, no stage on screen. The overlay
 * keeps the paper and Blip where they were for those, so he stands still on
 * paper instead of the dark loading ground showing through.
 */
const HOLD_PHASES: ReadonlySet<AppPhase> = new Set(["auth", "loading", "pending", "stage"]);

export function holdsIn(phase: AppPhase): boolean {
  return HOLD_PHASES.has(phase);
}

/**
 * SduiApp's own phase, mapped onto the overlay's.
 *
 * "ready" with no screen yet is the wait for the first fetch, which the paper
 * is held through ("pending"). But if that fetch FAILED, the app is showing
 * its "Couldn't load this screen" card with Retry, and nothing is coming to
 * hand the paper over to: holding would cover the card, and its Retry button,
 * for the whole hold timeout. That is "other", which lets go at once.
 */
export function appPhaseFor(o: {
  phase: string;
  hasScreen: boolean;
  rootType?: string | null;
  failed?: boolean;
}): AppPhase {
  if (o.phase !== "ready") return o.phase as AppPhase;
  if (!o.hasScreen) return o.failed ? "other" : "pending";
  return o.rootType === "OnboardStage" ? "stage" : "other";
}

/** The progress bar's filled segments: everything up to and including this step. */
export function progressFill(s: Pick<StageInfo, "first" | "step" | "of">): number {
  return Math.max(0, Math.min(s.of, s.first + s.step + 1));
}

/**
 * Which child a stage shows.
 *
 *   stored   the step the screen's own state holds.
 *   floor    the furthest step this stage reached before its store was rebuilt
 *            (a refetch makes a new store with the step back at zero).
 *   phase    the sign-in flow's phase, when the stage is inside the gate.
 *   phaseStep  children that belong to a phase (the code step owns "verify").
 *
 * A phase that owns a child shows it, whatever `stored` says. A phase that
 * owns none (entry, sending) shows the stored step, but never a child some
 * other phase owns: coming back to sign-in with a remembered step of 2 must
 * land on Sign in, not on a Code step with no code to enter.
 */
export function resolveStep(o: {
  stored: number;
  floor: number;
  phase?: string | null;
  phaseStep?: Record<string, number> | null;
  count: number;
}): { idx: number; fromPhase: boolean } {
  const last = Math.max(0, o.count - 1);
  const clamp = (n: number) => Math.max(0, Math.min(last, Math.floor(Number.isFinite(n) ? n : 0)));
  const owned = o.phaseStep ?? null;
  if (owned && o.phase && Object.prototype.hasOwnProperty.call(owned, o.phase)) {
    return { idx: clamp(owned[o.phase]), fromPhase: true };
  }
  let idx = clamp(Math.max(o.stored, o.floor));
  if (owned && o.phase) {
    const lowest = Math.min(...Object.values(owned).filter((n) => Number.isFinite(n)));
    if (Number.isFinite(lowest) && idx >= lowest) idx = clamp(lowest - 1);
  }
  return { idx, fromPhase: false };
}

// --- The board --------------------------------------------------------------

type Listener = () => void;

let stages: StageInfo[] = [];
/** The last stage to leave, kept only while the app is changing trees. */
let kept: StageInfo | null = null;
/** Set when a tree failed and the app fell back to something else: nothing is held until a stage mounts again. */
let abandoned = false;
let holdSince = 0;
let spots: SpotInfo[] = [];
let nextToken = 1;
const scrolls = new Map<string, number>();
const furthest = new Map<string, number>();
let appPhase: AppPhase = "loading";
let reduced = false;
let rev = 0;
const listeners = new Set<Listener>();

let snap: Snapshot | null = null;
let view: View | null = null;

function mode(): Mode {
  if (stages.length) return "live";
  if (kept && HOLD_PHASES.has(appPhase)) return "hold";
  return "off";
}

function commit(): void {
  rev++;
  snap = null;
  // A hold that has ended (the app settled somewhere that is not onboarding)
  // forgets the stage, so a later hold cannot resurrect it.
  if (!stages.length && kept && !HOLD_PHASES.has(appPhase)) kept = null;
  const m = mode();
  if (m === "hold" && !holdSince) holdSince = Date.now();
  if (m !== "hold") holdSince = 0;
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* a listener that throws must not stop the rest */ }
  }
}

function top(): StageInfo | null {
  return stages.length ? stages[stages.length - 1] : kept;
}

export function mountStage(info: StageInfo): void {
  stages = [...stages.filter((s) => s.id !== info.id), { ...info }];
  abandoned = false;
  commit();
}

export function updateStage(id: string, patch: Partial<StageInfo>): void {
  const i = stages.findIndex((s) => s.id === id);
  if (i < 0) return;
  const cur = stages[i];
  let changed = false;
  for (const k of Object.keys(patch) as (keyof StageInfo)[]) {
    if (!sameValue(cur[k], patch[k])) { changed = true; break; }
  }
  if (!changed) return;
  stages = stages.map((s, j) => (j === i ? { ...s, ...patch } : s));
  commit();
}

export function unmountStage(id: string): void {
  const i = stages.findIndex((s) => s.id === id);
  if (i < 0) return;
  const gone = stages[i];
  stages = stages.filter((_, j) => j !== i);
  if (!stages.length && !abandoned) kept = gone;
  commit();
}

/** Stand here. Returns the token that updates and removes this spot. */
export function pushSpot(s: Omit<SpotInfo, "token" | "rev" | "rect"> & { rect?: Rect | null }): number {
  const token = nextToken++;
  spots = [...spots, { ...s, rect: s.rect ?? null, token, rev: 1 }];
  commit();
  return token;
}

export function updateSpot(token: number, patch: Partial<Omit<SpotInfo, "token" | "rev">>): void {
  const i = spots.findIndex((s) => s.token === token);
  if (i < 0) return;
  const cur = spots[i];
  let changed = false;
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    if (!sameValue(cur[k], patch[k])) { changed = true; break; }
  }
  if (!changed) return;
  spots = spots.map((s, j) => (j === i ? { ...s, ...patch, rev: s.rev + 1 } : s));
  commit();
}

export function popSpot(token: number): void {
  if (!spots.some((s) => s.token === token)) return;
  spots = spots.filter((s) => s.token !== token);
  commit();
}

/**
 * How far a step layer has scrolled. Keyed by the LAYER, not the stage: every
 * time a step is shown it is a new layer scrolled to the top, and the old
 * layer's last offset must not leak into it.
 */
export function setScroll(layer: string, y: number): void {
  const cur = scrolls.get(layer);
  if (cur === y) return;
  scrolls.set(layer, y);
  const active = spots.length ? spots[spots.length - 1] : null;
  if (active && active.layer === layer) commit();
}

export function getScroll(layer: string): number {
  return scrolls.get(layer) ?? 0;
}

export function forgetScroll(layer: string): void {
  scrolls.delete(layer);
}

/**
 * The furthest step a stage has shown. A MAX, never a set: stepping back
 * inside a stage is the person's choice, but a screen being fetched again
 * (connecting an app refreshes it, so does coming back from the full
 * languages list) must not put anyone back at the start.
 */
export function remember(id: string, step: number): void {
  const n = Math.max(0, Math.floor(step));
  if (n > (furthest.get(id) ?? 0)) furthest.set(id, n);
}

export function remembered(id: string): number {
  return furthest.get(id) ?? 0;
}

export function setAppPhase(p: AppPhase): void {
  if (p === appPhase) return;
  appPhase = p;
  commit();
}

export function setReduced(b: boolean): void {
  if (b === reduced) return;
  reduced = b;
  commit();
}

/** The overlay gave up waiting (the app never reached a tree). Drop the hold. */
export function release(): void {
  if (!kept) return;
  kept = null;
  commit();
}

/**
 * A tree failed to draw and the app fell back to something else (the sign-in
 * gate to its native screen, the whole app to its error card). There is no
 * next stage coming, so there is nothing to hold the paper for: let go now,
 * and do not hold for the stage that is about to unmount because of it. The
 * next stage to mount switches holding back on.
 */
export function abandon(): void {
  abandoned = true;
  kept = null;
  commit();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function snapshot(): Snapshot {
  if (snap) return snap;
  const spot = spots.length ? spots[spots.length - 1] : null;
  snap = {
    rev,
    mode: mode(),
    stage: top(),
    spot,
    scroll: spot ? scrolls.get(spot.layer) ?? 0 : 0,
    reduced,
    appPhase,
    holdSince,
  };
  return snap;
}

/**
 * The part of the snapshot React re-renders for. The same object comes back
 * until one of its fields changes, which is what useSyncExternalStore needs:
 * a scroll or a spot measuring itself must not re-render the overlay.
 */
export function viewSnapshot(): View {
  const s = snapshot();
  const st = s.stage;
  const next: View = {
    mode: s.mode,
    stage: st ? { id: st.id, first: st.first, of: st.of, step: st.step, look: st.look } : null,
  };
  const prev = view;
  if (
    prev && prev.mode === next.mode &&
    (prev.stage === next.stage ||
      (!!prev.stage && !!next.stage && prev.stage.id === next.stage.id && prev.stage.first === next.stage.first &&
        prev.stage.of === next.stage.of && prev.stage.step === next.stage.step && prev.stage.look === next.stage.look))
  ) {
    return prev;
  }
  view = next;
  return next;
}

/** For tests: forget everything. */
export function _reset(): void {
  stages = []; kept = null; abandoned = false; holdSince = 0; spots = []; nextToken = 1;
  scrolls.clear(); furthest.clear();
  appPhase = "loading"; reduced = false; rev = 0; listeners.clear();
  snap = null; view = null;
}

// --- Small helpers ------------------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}
