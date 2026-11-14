/**
 * THE CLOSED LIST OF BUILDING BLOCKS, and the vocabulary number (pure SPEC 2.0, principle 2).
 *
 * A client says `vocab: 2` (it has this kernel) and then names the blocks it actually has. The blocks arrive over
 * several updates, so one number could never say which of them a phone holds. The names are closed here: a server
 * that asks for a name this list does not know is asking for something no build will ever have, and that is an
 * error, not a missing feature.
 *
 * A screen states the blocks it needs. Every block is OFF for a screen that does not name it.
 */

/** The vocabulary this kernel speaks. Vocab 1 is the old fixed node list, with no expressions. */
export const VOCAB = 2;

/** Every block name there is. In the order of SPEC 2.1: expressions first, the shell last. */
export const BLOCKS = Object.freeze([
  "expr",
  "defs",
  "rules",
  "device",
  "local",
  "paint",
  "motion",
  "gesture",
  "list",
  "input",
  "media",
  "data",
  "shell",
  // One of our own calls, held for a screen (TAILZU-BACKEND/docs/rooms.md): take a seat, change the microphone and camera, leave,
  // and a `Caller` node that draws one person. The phone says it only where its binary links the live client; the window always can.
  "call",
] as const);

export type BlockName = (typeof BLOCKS)[number];

const BLOCK_SET: ReadonlySet<string> = new Set(BLOCKS);

/**
 * Names that are planned but belong to another spec, so a server asking for one is early, not wrong. `scene` is the
 * standalone drawing node, which arrives with the animation spec's format 3. It is not in BLOCKS until it ships.
 */
export const LATER_BLOCKS = Object.freeze(["scene"] as const);

/** True when the name is a block this kernel knows. */
export function isBlock(name: unknown): name is BlockName {
  return typeof name === "string" && BLOCK_SET.has(name);
}

/** The names in a list that no build will ever declare, so the server can be told it asked for nonsense. */
export function unknownBlocks(names: readonly unknown[]): string[] {
  const bad: string[] = [];
  for (const n of names) {
    if (isBlock(n)) continue;
    const s = typeof n === "string" ? n : String(n);
    if (!bad.includes(s)) bad.push(s);
  }
  return bad;
}

/** The blocks a screen needs that this client did not declare. Empty means it can be drawn. */
export function missingBlocks(declared: readonly unknown[], needed: readonly unknown[]): string[] {
  const have = new Set(declared.filter(isBlock));
  const out: string[] = [];
  for (const n of needed) {
    const s = typeof n === "string" ? n : String(n);
    if (!have.has(s as BlockName) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** True when every block the screen needs is one this client declared. */
export function canDraw(declared: readonly unknown[], needed: readonly unknown[]): boolean {
  return missingBlocks(declared, needed).length === 0;
}
