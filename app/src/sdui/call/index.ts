/**
 * THE `call` BLOCK, TURNED ON (pure/SPEC.md 2.0 principle 2; the feature is TAILZU-BACKEND/docs/rooms.md).
 *
 * One of our own calls, held for a screen. The block is registered only by a binary that really links the live client, so a phone that
 * cannot hold a call never promises `call` and the server keeps sending it the screen that says joining is coming.
 *
 *   registerCall(registry)   the block and its one node, `Caller`
 *   runCallJoin / Set / Leave   what actions.ts calls for `call.join`, `call.set` and `call.leave`
 *
 * The session is session.ts, the arithmetic is callCore.ts, and which call this app is in is holder.ts.
 */
import type { BlockRegistry } from "../blockRegistry";
import { Caller } from "./Caller.tsx";
import { CALL_SPEC } from "./callCore.ts";
import { callChanged, currentCall, endCall, startCall } from "./holder.ts";
import { CallSession, callAvailable, loadWebrtc, type SessionApi } from "./session.ts";

export { CALL_SPEC as SPEC } from "./callCore.ts";
export { callAvailable, currentCall, endCall };

/** The block, and the node that draws one person. A binary without the live client never gets here (registry.ts asks first). */
export function registerCall(registry: BlockRegistry): void {
  if (registry.register) registry.register("call", CALL_SPEC, { Caller }, {});
  else registry.addBlock("call", CALL_SPEC);
}

/** What the action needs of the app around it: its signed-in POST, the screen's store, and the screen it is on. */
export interface CallActionCtx {
  post<T>(path: string, body: unknown): Promise<T>;
  write(path: string, value: unknown): void;
  screenId: string;
  run(ref: unknown): void | Promise<void>;
}

export interface JoinAction {
  join: string;
  statePath: string;
  knock?: string;
  video?: boolean;
  onEnd?: unknown;
  onBlocked?: unknown;
  onError?: unknown;
}

/**
 * Take a seat and hold the call for this screen. It returns once the call is up or has failed, not when it ends: `onEnd` says that.
 */
export async function runCallJoin(a: JoinAction, ctx: CallActionCtx): Promise<void> {
  const rtc = loadWebrtc();
  if (!rtc) { await ctx.run(a.onError); return; }
  // A second join on the same screen (a refresh) keeps the call it already has.
  if (currentCall()) return;

  const api: SessionApi = {
    post: ctx.post,
    write: (state) => ctx.write(a.statePath, state),
    changed: callChanged,
    onEnd: () => { endCall(); void ctx.run(a.onEnd); },
    onBlocked: () => { void ctx.run(a.onBlocked); },
    onError: () => { void ctx.run(a.onError); },
  };
  const session = new CallSession(rtc, api);
  startCall(session, ctx.screenId);
  await session.join({ join: a.join, ...(a.knock ? { knock: a.knock } : {}), ...(a.video === undefined ? {} : { video: a.video }) });
}

/** The person's own switches. Nothing happens when there is no call, which is what a stale button press is. */
export async function runCallSet(op: "mic" | "cam" | "speaker" | "flip", value?: boolean): Promise<void> {
  await currentCall()?.set(op, value);
}

/** Hang up. The join's `onEnd` follows from the session itself. */
export async function runCallLeave(): Promise<void> {
  await currentCall()?.leave();
}
