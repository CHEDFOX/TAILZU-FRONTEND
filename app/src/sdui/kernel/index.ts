/**
 * THE KERNEL: everything a screen means, with nothing that draws (pure SPEC 2.0, principle 1).
 *
 * One source, three copies. The phone imports this folder; `genKernel.mjs` writes the window's copy
 * (TAILZU-DESKTOP/src/app/sdui/kernel.js) and the server's (TAILZU-BACKEND/shared/sdui/kernel.cjs) from the same
 * files, with a sha chain in each header, so the three can only differ by a missed regeneration — and each repo's
 * tests catch that.
 *
 * Nothing here imports React Native, and nothing here imports `src/botTiles/core.ts`: the kernel keeps its own
 * marked copy of that file's numeric grammar instead (coreGrammar.ts), which CI diffs byte for byte.
 *
 * Nothing in the app imports this yet. The renderer picks it up in V1, so the kernel cannot change what the store
 * build draws.
 */

export { LIMITS, byteLen, everyFloorMs, stringFits } from "./limits.ts";
export type { LimitName } from "./limits.ts";

export { BLOCKS, LATER_BLOCKS, VOCAB, canDraw, isBlock, missingBlocks, unknownBlocks } from "./blocks.ts";
export type { BlockName } from "./blocks.ts";

export {
  encodeHole, localKeyError, localKeyOk, looksLikeSecret, networkPathError, networkPathOk, pathsTouch,
  statePathError, statePathOk,
} from "./paths.ts";

export { MOMENT_FUNCS, MOMENT_VARS, compileNumeric, numericError, runNumeric } from "./coreGrammar.ts";
export type { NumericExpr } from "./coreGrammar.ts";

export {
  PLAIN_ENV, finite, fmtCurrency, fmtDatetime, fmtDuration, fmtElapsed, fmtNumber, fmtPlural, fmtRelative, millisOf,
} from "./format.ts";
export type { FormatEnv } from "./format.ts";

export {
  FUNCTION_NAMES, KernelError, TIME_DEP, compileExpr, dependsOn, pick, readsTime, runExpr, toText, tryCompileExpr,
} from "./expr.ts";
export type { Compiled, Scope } from "./expr.ts";

export {
  compileCondition, compileProp, compileText, isEvaluable, isExprCondition, isTextTemplate, isValueBinding,
  looksLikeForgottenTemplate, runProp,
} from "./text.ts";
export type { CompiledProp, CompiledText, ExprCondition, TextTemplate, ValueBinding } from "./text.ts";

export { ARGS_KEY, ARGS_UP_KEY, checkDefs, expandItem, expandTree } from "./defs.ts";
export type { DefSpec, Defs, Expansion } from "./defs.ts";

export { RuleMachine, compileRules, driveRules, ruleDeps } from "./rules.ts";
export type { CompiledRule, CompiledRules, Fired, RuleHost, RuleSpec, Tick } from "./rules.ts";
