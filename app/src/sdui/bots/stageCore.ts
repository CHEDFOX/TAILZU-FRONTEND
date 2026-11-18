/**
 * THE BOT STAGE'S GEOMETRY AND RULES (BotStage.tsx), pure: which mode the thought is in, how tall the stage is drawn, where
 * the resting pill and the open box go for a given screen, and a tap against a double tap. Tested in Node.
 *
 * Coordinates: "stage px" are the stage's own (its top left 0, 0; the bot's world is the stage); "window px" are the
 * screen's (a veiled thought is drawn over the whole window, in a Modal).
 */
import { trailRoom } from "../../botTiles/core.ts";

export type StageMode = "rest" | "listen" | "open" | "full";

/**
 * pillH, pillFont, pillPad, pillMax: the resting pill (40 high, 14 px words, 16 padding, 260 at most on a phone). gutter:
 * the room kept at each side. floorPad: the stage's floor this far over its bottom. restOver: the room over the pill.
 * square: the open square's largest side, and its bottom over his crown. wideMin / wideMaxFrac: the open wide box's
 * height (min px, max share of the window). lowBottom: a "low" stage's bottom over the window's safe bottom; lowTop: the
 * box's top under the window's safe top. fullTop, fullInset, fullOver: the full box. doubleTapMs: a single tap waits this
 * long for a second. openMs, fullMs, veilMs, unfullMs, standMs: the timings (grow, grow full, the veil, the shrink after
 * full un-blurs, his breath after a thought closes).
 */
export const STAGE = {
  pillH: 40, pillFont: 14, pillPad: 16, pillMax: 260,
  gutter: 16, floorPad: 2, minUnder: 18, restOver: 48,
  squareMax: 360, squareOver: 64,
  wideMin: 56, wideMaxFrac: 0.55,
  lowBottom: 24, lowTop: 56,
  fullTop: 12, fullInset: 16, fullOver: 72,
  doubleTapMs: 260,
  openMs: 360, fullMs: 420, veilMs: 260, unfullMs: 380, standMs: 1300,
};

export interface Rect { x: number; y: number; w: number; h: number }
/** The window: its size and its safe insets. */
export interface Win { w: number; h: number; top: number; bottom: number }

/** The thought's mode, in this order: full, open, listening (only with a thought), rest. */
export function stageMode(o: { thought: boolean; full: boolean; open: boolean; listen: boolean }): StageMode {
  if (!o.thought) return "rest";
  if (o.full) return "full";
  if (o.open) return "open";
  if (o.listen) return "listen";
  return "rest";
}

/**
 * What he does: thinking, listening (only with a thought), standing (by an open thought, a breath after it closes), or his own
 * play. Thinking comes first: a voice chat listens for all of its turns (sending included, so the box keeps its words), and he
 * thinks while a turn's words go.
 */
export function stageAct(o: { thought: boolean; listening: boolean; thinking: boolean; standing: boolean }): "think" | "listen" | "stand" | "play" {
  if (o.thinking) return "think";
  if (o.listening && o.thought) return "listen";
  return o.standing ? "stand" : "play";
}

/**
 * Whether opening a "low" thought walks him to the middle of his stage: not while outWhen holds him off it (the walk would
 * bring him back in, and he would stay), nor before he is placed, nor with Reduce Motion.
 */
export function walksLow(o: { low: boolean; still: boolean; placed: boolean; out: boolean | null }): boolean {
  return o.low && !o.still && o.placed && o.out !== true;
}

/**
 * The least a stage is drawn: him (size), the room under his feet, and with a resting box the trail's room over his
 * crown and the pill with its room. Everything touchable at rest is inside the stage (Android never hands a touch to a
 * child drawn outside its parent; a pill drawn over the page would also cover the newest message).
 */
export function minStageHeight(size: number, restBox: boolean): number {
  return Math.ceil(size + STAGE.minUnder + (restBox ? trailRoom(1) + STAGE.restOver : 0));
}

/** The stage's height at rest: the server's, never under the least. */
export function restHeight(height: number, size: number, restBox: boolean): number {
  return Math.max(Number(height) || 0, minStageHeight(size, restBox));
}

/**
 * A stage whose thought opens inline (no veil: the space's composer) grows by what the box grew over the resting pill,
 * so the box stays inside the stage and the feed above simply gets shorter.
 */
export function grownHeight(rest: number, boxH: number): number {
  return rest + Math.max(0, Math.round(boxH) - STAGE.pillH);
}

/** Where the pill's bottom sits (stage y): the trail's room over his crown as he stands. */
export function pillBottom(floor: number, crownHeight: number): number {
  return floor - crownHeight - trailRoom(1);
}

/** Where the pill's centre may go (followStep's bounds): inside the gutters. */
export function pillBounds(stageW: number, pillW: number): { lo: number; hi: number } {
  return { lo: STAGE.gutter + pillW / 2, hi: stageW - STAGE.gutter - pillW / 2 };
}

/** The resting pill (stage px), its centre at cx. */
export function pillRect(cx: number, pillW: number, bottom: number, stageW: number): Rect {
  const b = pillBounds(stageW, pillW);
  const c = b.lo <= b.hi ? Math.min(b.hi, Math.max(b.lo, cx)) : stageW / 2;
  return { x: c - pillW / 2, y: bottom - STAGE.pillH, w: pillW, h: STAGE.pillH };
}

/** Listening: the box stays where the pill was, at the pill's widest, and grows up with the words. */
export function listenRect(pill: Rect, stageW: number, contentH: number, maxW = STAGE.pillMax): Rect {
  const w = Math.min(maxW, stageW - 2 * STAGE.gutter);
  const x = Math.min(stageW - STAGE.gutter - w, Math.max(STAGE.gutter, pill.x + pill.w / 2 - w / 2));
  const h = Math.max(STAGE.pillH, Math.round(contentH));
  return { x, y: pill.y + pill.h - h, w, h };
}

/** Open and wide, inline (stage px): the stage's width less the gutters, as tall as what is in it, its bottom where the pill's was. */
export function wideRect(stageW: number, bottom: number, contentH: number, winH: number): Rect {
  const h = Math.min(Math.max(STAGE.wideMin, Math.round(contentH)), Math.round(winH * STAGE.wideMaxFrac));
  return { x: STAGE.gutter, y: bottom - h, w: stageW - 2 * STAGE.gutter, h };
}

/**
 * Open and square (window px): a side as wide as the column allows (360 at most), centred over him, its bottom 64 px over
 * his crown; never over the safe top (a keyboard up makes it smaller).
 */
export function squareRect(win: Win, crown: { x: number; y: number }): Rect {
  const bottom = crown.y - STAGE.squareOver;
  const room = bottom - (win.top + STAGE.fullTop);
  const side = Math.max(0, Math.min(STAGE.squareMax, win.w - 2 * STAGE.gutter, room));
  const x = Math.min(win.w - STAGE.gutter - side, Math.max(STAGE.gutter, crown.x - side / 2));
  return { x, y: bottom - side, w: side, h: side };
}

/** Full (window px): near the whole screen, 16 from its sides, from the safe top + 12 down to 72 px over his crown. */
export function fullRect(win: Win, crown: { x: number; y: number }): Rect {
  const y = win.top + STAGE.fullTop;
  return { x: STAGE.fullInset, y, w: win.w - 2 * STAGE.fullInset, h: Math.max(0, crown.y - STAGE.fullOver - y) };
}

/**
 * place "low" (window px): while open the stage moves down to 24 px over the safe bottom (or over the keyboard), and the box
 * fills from the safe top + 56 down to the trail's room over his crown. crownInStage: his crown in the stage's own px.
 */
export function lowLayout(win: Win, stageH: number, crownInStage: { x: number; y: number }, stageX: number, kbTop?: number): { stageY: number; box: Rect } {
  const floor = kbTop && kbTop > 0 ? Math.min(kbTop - 8, win.h - win.bottom - STAGE.lowBottom) : win.h - win.bottom - STAGE.lowBottom;
  const stageY = floor - stageH;
  const top = win.top + STAGE.lowTop;
  const bottom = stageY + crownInStage.y - trailRoom(1);
  return { stageY, box: { x: stageX + STAGE.gutter, y: top, w: Math.max(0, win.w - 2 * (stageX + STAGE.gutter)), h: Math.max(STAGE.wideMin, bottom - top) } };
}

/**
 * A veiled stage with a keyboard up: how far it and its box rise so his feet stay over the keyboard (0 without one).
 */
export function keyboardLift(stageBottom: number, kbTop: number | null): number {
  return kbTop && kbTop > 0 ? Math.max(0, Math.round(stageBottom - kbTop + 8)) : 0;
}

/**
 * A tap on him. Without a double tap: a press at once. With one: the first tap waits (doubleTapMs) for a second; a second
 * inside that is a double, and the waiting press is dropped. `pending`: when the waiting tap came (null: none).
 */
export function tapOn(pending: number | null, now: number, hasDouble: boolean, ms = STAGE.doubleTapMs): { run: "press" | "double" | "wait"; pending: number | null } {
  if (!hasDouble) return { run: "press", pending: null };
  if (pending != null && now - pending <= ms) return { run: "double", pending: null };
  return { run: "wait", pending: now };
}

/** A waiting tap whose time has come is a press. */
export function tapDue(pending: number | null, now: number, ms = STAGE.doubleTapMs): boolean {
  return pending != null && now - pending > ms;
}

/**
 * A tap, in the STAGE's own pixels. React Native gives a Pressable the point in the touched view's coordinates, and
 * his hit area is its own view, translated onto his body, so a tap on him arrives relative to that view's corner.
 * A live scene's box is in the stage's pixels (the surface is the stage), so the corner is added back. `view`: where
 * that view's top left sits in the stage (null for the stage's own Pressable, which is already there).
 */
export function tapInStage(x: number, y: number, view: { x: number; y: number } | null): { x: number; y: number } {
  return { x: x + (view ? view.x : 0), y: y + (view ? view.y : 0) };
}
