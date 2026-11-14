/**
 * THE ONE CALL THIS APP IS IN (the `call` block; TAILZU-BACKEND/docs/rooms.md).
 *
 * A phone is in one call at a time, so there is one session, held here. The actions (`call.join`, `call.set`, `call.leave`) reach it, and
 * every `Caller` node on the screen watches it so a tile redraws the moment someone's camera comes on.
 *
 *   startCall(session, screenId)  the call this screen holds; any call before it is hung up first
 *   currentCall()                 the session, or null
 *   endCall()                     let it go (leaving the screen, or hanging up)
 *   watchCall(fn)                 tell me when the pictures change; returns the way to stop
 *
 * It is kept by SCREEN. Leaving the screen ends the call, which is what stops a microphone being left open behind a screen nobody is
 * looking at; a refresh of the same screen keeps it.
 */
import type { CallSession } from "./session.ts";

let session: CallSession | null = null;
let heldBy = "";
const watchers = new Set<() => void>();

/** Tell every Caller node to look again. */
export function callChanged(): void {
  for (const fn of [...watchers]) {
    try { fn(); } catch { /* one tile that throws is not the call's problem */ }
  }
}

export function startCall(next: CallSession, screenId: string): void {
  if (session) session.finish("ended");
  session = next;
  heldBy = screenId;
  callChanged();
}

export const currentCall = (): CallSession | null => session;

/** The screen holding the call, for the renderer's check when a screen goes. */
export const callHeldBy = (): string => heldBy;

export function endCall(): void {
  const s = session;
  session = null;
  heldBy = "";
  if (s) s.finish("ended");
  callChanged();
}

export function watchCall(fn: () => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}
