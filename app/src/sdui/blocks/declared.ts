/**
 * WHAT THIS CLIENT TELLS THE SERVER IT HAS (pure/SPEC.md 2.11).
 *
 * The handshake has to name the blocks that are really on, but `client/capabilities.ts` must not pull in every
 * block's code to find out — it is built on the very first request, before a screen has been drawn. So the
 * registry leaves the names here as it turns each block on, and this file answers the question with nothing but
 * those names and the kill switches.
 *
 * It also answers which runtime this binary is, which is how the server tells "open X0 again" (an update is
 * waiting for the same binary) from "update X0" (the blocks need a newer one) — SPEC 2.12.
 */

import { declaredBlocks } from "./blocksCore.ts";
import { floor } from "../safety";

let registered: readonly string[] = [];

/** The registry says what turned on, once, as it turns them on. */
export function setRegisteredBlocks(names: readonly string[]): void {
  registered = [...names];
}

/** The names that registered, whatever the kill switches say about them right now. */
export function registeredNames(): readonly string[] {
  return registered;
}

/**
 * What this client declares: registered, less safe mode and `sdui.off` (SPEC 5.3). Asked again every time,
 * because a new bootstrap can switch a block off while the app is up.
 */
export function clientBlocks(): readonly string[] {
  const f = floor();
  return declaredBlocks(registered, { safe: f.safe, off: f.off });
}

/**
 * The binary's runtime string (`tailzu-2026-11-x0-blip`), read through expo-updates and never assumed: a build
 * without it says nothing rather than a number that might be wrong.
 */
export function appRuntime(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates");
    const v = Updates?.runtimeVersion;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}
