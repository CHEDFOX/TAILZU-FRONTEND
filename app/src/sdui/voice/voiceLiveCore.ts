/**
 * LIVE WORDS, TURN BY TURN (the voiceLive action; voiceLive.ts wires it to the phone). Pure: no React Native, no timers of
 * its own (the IO's), so the whole loop is tested in Node.
 *
 * A session is one or more turns. A turn opens the stream, takes its words as they come (every segment the stream
 * finalised, then the current partial: the stream's partial is only the segment it is in, so a pause inside a turn would
 * otherwise lose what came before it), and ends when `silenceMs` passes with no new words and there are some. Then the
 * stream is closed (a moment's grace for its last final), the words go to `heard` (awaited: the screen sends them), and a
 * chat listens again unless `stopWhen` holds. A turn with no words at all ends the session quietly after `firstQuietMs`
 * (the first turn) or `chatQuietMs` (a later one); a session never runs past `maxMs`. stop() ends it at once and drops the
 * words of the turn not yet sent; so does the app going to the background.
 *
 * The voice level is made up from the words (the stream sends no level): each change sets it to min(1, 0.55 + 0.1 x the
 * new words), and it decays x0.85 every 80 ms. It goes to `level`, never into the screen's state.
 */

export type VoiceStatus = "listening" | "sending" | "";
export type EndWhy = "done" | "stop" | "quiet" | "max" | "error" | "background";

export interface VoiceSpec {
  mode: "once" | "chat";
  /** A pause this long (ms) with words ends the turn. */
  silenceMs: number;
  /** No words at all for this long ends the session: in the first turn, and in a later one. */
  firstQuietMs: number;
  chatQuietMs: number;
  /** The longest a session runs. */
  maxMs: number;
  /** How long a closing turn waits for the stream's last final before it takes the words it has. */
  graceMs: number;
}

export const VOICE_DEFAULTS: VoiceSpec = { mode: "once", silenceMs: 900, firstQuietMs: 8000, chatQuietMs: 12000, maxMs: 20 * 60_000, graceMs: 700 };

/** The made-up level: a new word lifts it, and it decays. */
export const LEVEL = { base: 0.55, perWord: 0.1, decay: 0.85, tickMs: 80 };

export interface StreamEvents {
  partial(text: string): void;
  final(text: string): void;
  /** code "permission": no microphone. */
  error(message: string, code?: string): void;
  closed(): void;
}

export interface StreamHandle {
  /** Finish gracefully: its last final, then closed. */
  stop(): void;
  /** Drop it now. */
  cancel(): void;
}

export interface VoiceIO {
  /** Open the microphone stream for one turn (throws when it cannot). */
  open(on: StreamEvents): StreamHandle;
  status(s: VoiceStatus): void;
  /** The turn's words so far ("" between turns): what LiveWords shows. */
  words(text: string): void;
  level(v: number): void;
  /** A turn's words: written to `into`, then the screen's onHeard, awaited. */
  heard(text: string): Promise<void>;
  /** Holds after a chat turn: the chat stops (the screen asks something first). */
  stopWhen(): boolean;
  /** The session is over (every way it can end). */
  ended(why: EndWhy): void;
  /** It failed: no microphone (code "permission"), or anything else. */
  failed(message: string, code?: string): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

/** How many words a text has. */
export function countWords(t: string): number {
  const s = t.trim();
  return s ? s.split(/\s+/).length : 0;
}

/** The level after the words grew by `added` (0: changed in place, still a word). */
export function levelOnWords(added: number): number {
  return Math.min(1, LEVEL.base + LEVEL.perWord * Math.max(1, added));
}

/** Segments joined: the finals with a space between, then the partial. */
export function joinTurn(finals: string[], partial: string): string {
  return [...finals, partial].map((s) => s.trim()).filter(Boolean).join(" ");
}

export class VoiceSession {
  spec: VoiceSpec;
  io: VoiceIO;
  /** Over: nothing more runs. */
  done = false;
  turn = 0;
  status: VoiceStatus = "";
  finals: string[] = [];
  partial = "";
  /** The turn's words as last shown. */
  text = "";
  level = 0;
  handle: StreamHandle | null = null;
  /** The stream of a turn closing (stop() sent, its last final awaited). */
  closing = false;
  silenceT: unknown = null;
  quietT: unknown = null;
  maxT: unknown = null;
  graceT: unknown = null;
  levelT: unknown = null;
  /** Bumped each turn: an event from a stream that is no longer this turn's is dropped. */
  epoch = 0;

  constructor(spec: Partial<VoiceSpec>, io: VoiceIO) {
    this.spec = { ...VOICE_DEFAULTS, ...spec };
    this.io = io;
  }

  /** The first turn. */
  start(): void {
    if (this.done) return;
    this.maxT = this.io.setTimeout(() => this.end("max"), this.spec.maxMs);
    this.listen();
  }

  /** voiceStop (or a tap on him): over now, the words not yet sent dropped. */
  stop(): void { this.end("stop"); }

  /** The app went to the background: over, the words dropped. */
  background(): void { this.end("background"); }

  private setStatus(s: VoiceStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.io.status(s);
  }

  private listen(): void {
    if (this.done) return;
    this.turn++;
    const epoch = ++this.epoch;
    this.finals = [];
    this.partial = "";
    this.text = "";
    this.closing = false;
    this.io.words("");
    this.setStatus("listening");
    this.armQuiet();
    const mine = () => !this.done && epoch === this.epoch;
    try {
      this.handle = this.io.open({
        partial: (t) => { if (mine()) { this.partial = t; this.changed(); } },
        final: (t) => { if (mine()) { this.finals.push(t); this.partial = ""; this.changed(); } },
        error: (m, code) => { if (mine()) this.fail(m, code); },
        closed: () => { if (mine() && this.closing) this.send(); },
      });
    } catch (e) {
      this.fail(e instanceof Error ? e.message : "", undefined);
    }
  }

  /** New words: shown, the level lifted, the pause timer started again. */
  private changed(): void {
    if (this.closing) {
      // A last final while closing: take it, nothing else to wait for.
      this.text = joinTurn(this.finals, this.partial);
      this.io.words(this.text);
      return;
    }
    const next = joinTurn(this.finals, this.partial);
    if (next === this.text) return;
    const added = countWords(next) - countWords(this.text);
    this.text = next;
    this.io.words(next);
    if (!next) return;
    this.clear("quietT");
    this.setLevel(levelOnWords(added));
    this.clear("silenceT");
    this.silenceT = this.io.setTimeout(() => this.pause(), this.spec.silenceMs);
  }

  private setLevel(v: number): void {
    this.level = v;
    this.io.level(v);
    if (this.levelT == null) this.levelT = this.io.setTimeout(() => this.decay(), LEVEL.tickMs);
  }

  private decay(): void {
    this.levelT = null;
    if (this.done) return;
    this.level *= LEVEL.decay;
    if (this.level < 0.01) this.level = 0;
    this.io.level(this.level);
    if (this.level > 0) this.levelT = this.io.setTimeout(() => this.decay(), LEVEL.tickMs);
  }

  private armQuiet(): void {
    this.clear("quietT");
    const ms = this.turn <= 1 ? this.spec.firstQuietMs : this.spec.chatQuietMs;
    this.quietT = this.io.setTimeout(() => { if (!this.text) this.end("quiet"); }, ms);
  }

  /** A pause with words: the turn is over. The stream finishes (a moment's grace for its last final). */
  private pause(): void {
    this.silenceT = null;
    if (this.done || this.closing || !this.text) return;
    this.closing = true;
    this.clear("quietT");
    const h = this.handle;
    try { h?.stop(); } catch { /* already gone */ }
    this.graceT = this.io.setTimeout(() => this.send(), this.spec.graceMs);
  }

  /** The turn's words go to the screen; then, in a chat, the next turn. */
  private async send(): Promise<void> {
    if (this.done || !this.closing) return;
    this.closing = false;
    this.clear("graceT");
    this.clear("silenceT");
    this.handle = null;
    this.epoch++;
    const words = joinTurn(this.finals, this.partial);
    this.setStatus("sending");
    try {
      await this.io.heard(words);
    } catch {
      /* the screen's own error path said what went wrong */
    }
    if (this.done) return;
    this.io.words("");
    if (this.spec.mode === "chat" && !this.io.stopWhen()) { this.listen(); return; }
    this.end("done");
  }

  private fail(message: string, code: string | undefined): void {
    if (this.done) return;
    this.io.failed(message, code);
    this.end("error");
  }

  private clear(k: "silenceT" | "quietT" | "maxT" | "graceT" | "levelT"): void {
    const h = this[k];
    if (h != null) this.io.clearTimeout(h);
    this[k] = null;
  }

  /** Over: the stream dropped, the words gone, the screen told. */
  end(why: EndWhy): void {
    if (this.done) return;
    this.done = true;
    this.epoch++;
    for (const k of ["silenceT", "quietT", "maxT", "graceT", "levelT"] as const) this.clear(k);
    const h = this.handle;
    this.handle = null;
    // A turn that finished normally has already closed its stream; anything else is dropped where it is.
    if (h) { try { h.cancel(); } catch { /* already gone */ } }
    this.finals = [];
    this.partial = "";
    this.text = "";
    this.level = 0;
    this.io.level(0);
    this.io.words("");
    this.setStatus("");
    this.io.ended(why);
  }
}
