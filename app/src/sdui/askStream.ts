/**
 * AN ANSWER AS IT IS WRITTEN, ON THE PHONE (types.ts callEndpoint `stream`, backend shared/types/sdui.ts section 3f). Free of
 * react-native, so it is tested on its own (askStream.test.ts).
 *
 * A call with `stream: "reply"` makes a stream id, writes `{ id, text: "", step: "" }` at `reply`, sends the id as the body's
 * `streamId`, and while the call is out listens on the live socket (live.ts) for the topic `ask:<id>`: each piece's words are
 * appended to `reply.text` (a screen binds a small Text to it, so only that line changes), `reply.step` says what the bot is
 * doing, a `reset` starts the words over. Pieces are numbered: one missing (a dropped socket) stops the appending, and the call's
 * own answer, whole, follows as it always did. The listening ends when the call settles.
 */

export interface StreamState {
  id: string;
  text: string;
  step: string;
}

/** A piece as the server sends it (the live event's `data`). */
export interface StreamPiece {
  n?: unknown;
  text?: unknown;
  step?: unknown;
  reset?: unknown;
  end?: unknown;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A stream id: 22 letters and digits (the server takes 16 to 64 of letters, digits, - and _). */
export function makeStreamId(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 22; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return s;
}

/** One stream's pieces, in order, into writes of the state that holds it. */
export class StreamTap {
  private next = 0;
  private broken = false;
  private text = "";
  private done = false;
  private readonly write: (patch: Partial<StreamState>) => void;

  constructor(write: (patch: Partial<StreamState>) => void) { this.write = write; }

  /** Whether a piece went missing (nothing more is appended). */
  get gap(): boolean { return this.broken; }

  take(raw: unknown): void {
    if (this.broken || this.done || !raw || typeof raw !== "object") return;
    const p = raw as StreamPiece;
    const n = typeof p.n === "number" ? p.n : -1;
    if (n < this.next) return; // seen
    if (n > this.next) { this.broken = true; return; }
    this.next++;
    if (p.reset === true) { this.text = ""; this.write({ text: "" }); }
    if (typeof p.text === "string" && p.text) { this.text += p.text; this.write({ text: this.text }); }
    if (typeof p.step === "string" && p.step) this.write({ step: p.step.slice(0, 80) });
    if (p.end === true) this.done = true;
  }
}

/** Who listens for which stream id, while their calls are out. */
const taps = new Map<string, (data: unknown) => void>();

/** Listen for stream `id`'s pieces; returns the way to stop. */
export function listenStream(id: string, fn: (data: unknown) => void): () => void {
  taps.set(id, fn);
  return () => { if (taps.get(id) === fn) taps.delete(id); };
}

/** A live event: true when it was a stream's (`ask:<id>`) and was handed to its listener, if any. */
export function streamEvent(topic: string, data: unknown): boolean {
  if (!topic.startsWith("ask:")) return false;
  const fn = taps.get(topic.slice(4));
  if (fn) { try { fn(data); } catch { /* the screen's own problem */ } }
  return true;
}

/** How many streams are listened for (tests). */
export const listening = (): number => taps.size;
