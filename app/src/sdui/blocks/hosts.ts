/**
 * WHAT EACH BLOCK ASKED THE RENDERER FOR (the host interfaces they each declared).
 *
 * Every block was written without the store, the API client or the evaluator, and said what it needed instead:
 * `MotionHost` (motion/MotionView.tsx), `GestureHost` (gesture/GestureView.tsx), `V3Host` (components/v3Host.ts)
 * and `ShellHost` (shell/blocks/index.ts). This file is the one implementation of all four, built from a screen's
 * `Ctx`, so a block still knows nothing about the renderer and the renderer knows nothing about their insides.
 *
 * Nothing here imports Renderer.tsx: drawing a list row is handed in as `renderItem` by ScreenTree.tsx, which has
 * both. That keeps this file out of an import cycle, and keeps it readable.
 */

import type React from "react";
import type { SharedValue } from "react-native-reanimated";
import { callEndpoint } from "../client/endpoint";
import type { Ctx } from "../actions";
import { evalAnyCondition, runAction } from "../actions";
import type { Store } from "../state";
import type { GestureHost } from "../gesture";
import type { MotionHost } from "../motion";
import { holdValue, releaseValue } from "../motion/values";
import type { ItemScope, V3Host } from "../components/v3Host";
import type { ShellHost } from "../shell/blocks";
import { noteBadNode } from "../safety";
import { statePathOk } from "../kernel/index.ts";

/** A sink for anything a block could not read, for the handshake's `sdui.bad` (SPEC 2.11). */
export function blockBad(block: string): (notes: readonly string[], node?: unknown) => void {
  return (notes) => {
    for (const n of notes.slice(0, 2)) {
      try { noteBadNode(`${block}:${String(n).slice(0, 40)}`); } catch { /* reporting is never the next error */ }
    }
  };
}

/** Write one value at a state path, under state.ts's own rules as well as the kernel's. */
function writeState(store: Store, path: unknown, value: unknown): boolean {
  if (typeof path !== "string" || !statePathOk(path)) return false;
  store.set(path, value);
  return true;
}

/**
 * STATE ON THE UI THREAD, for `motion.drive.by: "state.progress"` (V2's hand-off, MotionHost.value).
 *
 * Only the renderer owns the store, so only the renderer can put one of its numbers somewhere a worklet may read
 * it. A name is mirrored the first time a motion asks for it and kept up to date until the screen goes; every
 * other name — `ui.*` above all — is answered with null and falls through to the motion block's own value bus,
 * where gestures and scrolls write.
 */
export class StateMirror {
  private readonly store: Store;
  private readonly held = new Map<string, SharedValue<number>>();
  private stopStore: (() => void) | null = null;

  constructor(store: Store) {
    this.store = store;
  }

  /** The handle for this name, or null when it is not one of ours. */
  value(name: string): SharedValue<number> | null {
    if (!name.startsWith("state.")) return null;
    const kept = this.held.get(name);
    if (kept) return kept;
    const sv = holdValue(name);
    if (!sv) return null;          // the value bus is full; the motion simply does not drive
    this.held.set(name, sv);
    sv.value = this.numberAt(name);
    if (!this.stopStore) this.stopStore = this.store.subscribe(() => this.sync());
    return sv;
  }

  private numberAt(name: string): number {
    const v = this.store.get(name.slice("state.".length));
    return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
  }

  /** Every mirrored name, after a store write. */
  sync(): void {
    for (const [name, sv] of this.held) {
      const n = this.numberAt(name);
      if (sv.value !== n) sv.value = n;
    }
  }

  /** The screen has gone. */
  stop(): void {
    this.stopStore?.();
    this.stopStore = null;
    for (const name of this.held.keys()) releaseValue(name);
    this.held.clear();
  }
}

/** The motion block's host: a state path on the UI thread, and somewhere to put what it could not read. */
export function makeMotionHost(mirror: StateMirror): MotionHost {
  return {
    value: (name) => mirror.value(name),
    bad: blockBad("motion"),
  };
}

/**
 * The gesture block's host.
 *
 * `setUi` must be SYNCHRONOUS: `test(commitIf)` is asked on the next line, and SPEC 2.5 says `ui.*` in an
 * expression always means the value at gesture end — so the condition has to read what was just written.
 */
export function makeGestureHost(ctx: Ctx): GestureHost {
  return {
    setUi(into, values) {
      if (typeof into !== "string" || !into) return;
      for (const k of Object.keys(values)) {
        const n = values[k];
        if (typeof n !== "number" || !Number.isFinite(n)) continue;
        writeState(ctx.store, `ui.${into}.${k}`, n);
      }
    },
    dispatch(action, value) {
      void runAction(action as never, value === undefined ? ctx : { ...ctx, event: value });
    },
    // A condition this host cannot answer is NOT a commit: a slide-to-confirm must never fire by accident.
    test: (cond) => evalAnyCondition(cond, ctx),
    read: (path) => ctx.store.get(path),
    bad: blockBad("gesture"),
  };
}

/** What the list, input and media nodes need: drawing a row, a page of rows, and the store. */
export function makeV3Host(
  ctx: Ctx,
  renderItem: (template: unknown, scope: ItemScope, key: string) => React.ReactNode,
  itemBool: (expr: unknown, scope: ItemScope) => boolean,
): V3Host {
  return {
    renderItem,
    itemBool,
    read: (path) => ctx.store.get(path),
    setState: (path, value) => { writeState(ctx.store, path, value); },
    /**
     * One page. `listCore.apiPath` has already pinned the path to ours under `/v1/`; the client adds the origin,
     * the auth and the timeouts, and REJECTS anything that is not a 2xx (the list counts failures and stops
     * asking after three). The request itself cannot be cancelled mid-flight, so an aborted page is a rejection
     * the caller ignores rather than a socket closed early.
     */
    fetchPage(path, signal) {
      const call = callEndpoint("GET", path);
      if (!signal) return call;
      return Promise.race([
        call,
        new Promise<never>((_resolve, reject) => {
          if (signal.aborted) { reject(new Error("aborted")); return; }
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      ]);
    },
  };
}

/** The shell block's host: the tab bar, the header and the toast read state and run actions like any node. */
export function makeShellHost(ctx: Ctx): ShellHost {
  return {
    read: (path) => ctx.store.get(path),
    subscribe: (_path, cb) => ctx.store.subscribe(cb),
    dispatch: (actionRef) => { void runAction(actionRef as never, ctx); },
    setState: (path, value) => { writeState(ctx.store, path, value); },
  };
}

/** What the data block's `subscribe` writes into: the screen's own store, under the same path rules. */
export function makeSubscribeHost(store: Store): { read(path: string): unknown; write(path: string, value: unknown): void } {
  return {
    read: (path) => store.get(path),
    write: (path, value) => { writeState(store, path, value); },
  };
}
