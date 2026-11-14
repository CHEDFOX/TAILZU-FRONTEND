/**
 * WHICH BLOCKS ARE LIVE, FOR THIS CLIENT AND FOR THIS SCREEN (pure/SPEC.md 2.0 principle 2, 2.11, 2.12).
 *
 * Two different questions, and keeping them apart is the whole of the gate:
 *
 *   1. What does this CLIENT have? Whatever actually registered (registry.ts), less what a kill switch turned off
 *      (`sdui.safe`, `sdui.off`, SPEC 5.3). That list is what the handshake sends as `blocks`, and it is a promise:
 *      a name is there only when the code behind it is loaded and working.
 *   2. What does this SCREEN need? Its own `needs: ["list", "expr"]`. Every block is OFF for a screen that does not
 *      name one, so a screen written before any of this behaves exactly as it did (SPEC 2.0 principle 6: no lowering).
 *
 * A screen that needs a block this client does not have is not drawn half-working: it draws the server's fallback,
 * or, failing that, the small "open X0 again / update X0" tree below.
 *
 * Nothing here imports React, React Native or the store. The renderer wiring is in registry.ts and ScreenTree.tsx.
 */

import { BLOCKS, type BlockName, FUNCTION_NAMES, LIMITS, VOCAB, isBlock, missingBlocks } from "../kernel/index.ts";

/** The field a screen states its blocks in (SPEC 2.12: the server's `needs(screen)` writes it). */
export const NEEDS_KEY = "needs";

/** The blocks a screen says it needs, in the kernel's own order, with anything that is not a block name kept as it is. */
export function screenNeeds(screen: unknown): string[] {
  const raw = (screen as { needs?: unknown } | null | undefined)?.needs;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const n of raw) {
    const s = typeof n === "string" ? n : String(n);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * What this client declares: the blocks that registered, less anything switched off, in the kernel's order.
 *
 * Safe mode says vocab 1 only (SPEC 5.2), so it declares nothing at all — which is honest, because safe mode will
 * not draw a vocab-2 node even if the code for it is loaded.
 */
export function declaredBlocks(
  registered: readonly string[],
  floor?: { safe?: boolean; off?: readonly string[] },
): BlockName[] {
  if (floor?.safe) return [];
  const have = new Set(registered.filter(isBlock));
  const off = new Set(floor?.off ?? []);
  return BLOCKS.filter((b) => have.has(b) && !off.has(b));
}

/** The blocks live for ONE screen: what it asked for, and only what this client really has. */
export function blocksForScreen(declared: readonly string[], needs: readonly string[]): BlockName[] {
  const have = new Set(declared.filter(isBlock));
  return BLOCKS.filter((b) => have.has(b) && needs.includes(b));
}

/** What the screen asked for and this client cannot do. Empty means it can be drawn. */
export function missingForScreen(declared: readonly string[], needs: readonly string[]): string[] {
  return missingBlocks(declared, needs);
}

/** A node, as the renderer draws it. Only the few keys this file writes. */
export interface SmallNode {
  type: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: SmallNode[];
}

/** What to tell someone whose app cannot draw a screen yet (SPEC 2.12). */
export interface UpdateWords {
  /** An update is already downloaded, or the blocks are in a bundle this binary can still receive. */
  reopen: string;
  /** This binary is too old: the store has the build with them. */
  update: string;
}

/**
 * THE SCREEN SOMEONE SEES INSTEAD (SPEC 2.12).
 *
 * The server normally sends its own small screen, and its own is always preferred: it knows the words, the store
 * link and the person's language. This is the last resort — the server sent a screen needing a block, gave it no
 * fallback, and we will not draw a slide-to-confirm that does nothing. Text and Stack only: both are vocab 1, so
 * this draws on a client in safe mode too.
 */
export function updateTree(missing: readonly string[], words: UpdateWords, sameRuntime: boolean): SmallNode {
  const line = sameRuntime ? words.reopen : words.update;
  return {
    type: "Stack",
    style: { padding: "lg", gap: "sm", align: "center", justify: "center", flex: 1 },
    children: [
      { type: "Text", props: { content: line, role: "body", align: "center" } },
      // The names, so a tester can see WHICH block is missing without a log. Never shown to anyone who has them all.
      { type: "Text", props: { content: missing.join(", "), role: "caption", align: "center" } },
    ],
  };
}

/**
 * ONE NUMBER FOR "DO WE AGREE ABOUT THE KERNEL?" (SPEC 2.11, `kernel: "<sha>"`).
 *
 * The generated copies carry a sha chain in their header (genKernel.mjs), but the phone runs the source and cannot
 * read a header, so this hashes the part the two sides have to agree about: the vocabulary number, the block names,
 * every limit, and every function an expression may call. A kernel that differs in any of those gives a different
 * number, and the server can work the same number out of its generated copy. FNV-1a, because it has to be cheap and
 * identical in three languages' worth of runtimes — it says "the same" or "not the same", and nothing else.
 */
export function kernelFingerprint(): string {
  const face = JSON.stringify({ v: VOCAB, b: BLOCKS, l: LIMITS, f: FUNCTION_NAMES });
  let h = 0x811c9dc5;
  for (let i = 0; i < face.length; i += 1) {
    h ^= face.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    const hi = face.charCodeAt(i) >> 8;
    if (hi) { h ^= hi; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return `k2-${h.toString(16).padStart(8, "0")}`;
}
