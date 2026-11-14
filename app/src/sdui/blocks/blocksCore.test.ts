// node --test --experimental-strip-types src/sdui/blocks/blocksCore.test.ts
//
// THE GATE: what this client declares, what a screen needs, and what someone sees when the two disagree.
import test from "node:test";
import assert from "node:assert";
import {
  blocksForScreen, declaredBlocks, kernelFingerprint, missingForScreen, screenNeeds, updateTree,
} from "./blocksCore.ts";
import { BLOCKS } from "../kernel/blocks.ts";

const WORDS = { reopen: "Open X0 again to see this", update: "Update X0 to see this" };

test("a client declares the blocks that registered, in the kernel's order, and nothing else", () => {
  const made = declaredBlocks(["list", "expr", "nonsense", "defs"]);
  assert.deepStrictEqual(made, ["expr", "defs", "list"], "kernel order, and a name no build will ever have is dropped");
});

test("a kill switch takes a block off the list, and safe mode takes them all", () => {
  assert.deepStrictEqual(declaredBlocks(["expr", "motion"], { off: ["motion"] }), ["expr"]);
  assert.deepStrictEqual(declaredBlocks(["expr", "motion"], { safe: true }), [], "safe mode is vocab 1 only");
});

test("a screen states what it needs, and every block is off for a screen that does not", () => {
  assert.deepStrictEqual(screenNeeds({ needs: ["list", "expr", "list"] }), ["list", "expr"], "no repeats");
  assert.deepStrictEqual(screenNeeds({}), [], "a screen from before vocab 2 asks for nothing");
  // Declared is not enough: the screen has to ask.
  assert.deepStrictEqual(blocksForScreen(["expr", "list", "motion"], ["expr", "list"]), ["expr", "list"]);
  assert.deepStrictEqual(blocksForScreen(["expr", "list", "motion"], []), [], "no needs, no blocks");
});

test("a screen that needs a block this client lacks is named, not half-drawn", () => {
  assert.deepStrictEqual(missingForScreen(["expr"], ["expr", "gesture"]), ["gesture"]);
  assert.deepStrictEqual(missingForScreen(["expr", "gesture"], ["expr", "gesture"]), [], "nothing missing: draw it");
});

test("the card someone sees instead says which way out they have", () => {
  const same = updateTree(["list"], WORDS, true);
  assert.strictEqual(same.children?.[0]?.props?.content, WORDS.reopen, "an update is already waiting for this binary");
  const older = updateTree(["list"], WORDS, false);
  assert.strictEqual(older.children?.[0]?.props?.content, WORDS.update, "this binary is too old: the store has it");
  assert.strictEqual(older.children?.[1]?.props?.content, "list", "and which block it was");
  // Text and Stack only, so the card draws on a client in safe mode too.
  assert.strictEqual(older.type, "Stack");
  assert.deepStrictEqual(older.children?.map((c) => c.type), ["Text", "Text"]);
});

test("the kernel fingerprint is stable, and says the two sides are talking about the same language", () => {
  const a = kernelFingerprint();
  assert.match(a, /^k2-[0-9a-f]{8}$/);
  assert.strictEqual(a, kernelFingerprint(), "the same kernel gives the same number");
  // It is made from the vocabulary, the block names, the limits and the functions — so it moves when any does.
  assert.ok(BLOCKS.length > 0);
});
