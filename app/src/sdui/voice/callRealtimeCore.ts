/**
 * PLAN EASE'S CALL AS A LIVE CONVERSATION: THE RULES (the voiceCall action; callRealtime.ts wires them to the phone). Pure: no
 * react-native, no live client, no timers of its own, so every rule here is tested in Node (callRealtimeCore.test.ts).
 *
 * The call's audio goes straight from the phone to the voice service over WebRTC; our server holds the session beside it and
 * does everything that matters (the tools, the record, the ending). What reaches this phone is a read-only stream of events on
 * the data channel, and all this file does is turn those events into what the screen shows: a phase, the bot's words as they
 * are spoken, the person's last words, and whether the bot has been heard at all (which is what a fallback to the turn call
 * needs to know). The app NEVER sends on that channel.
 *
 * Also here, because other files need it and none of them may load the live client: which screen holds the call, so media.ts,
 * sounds.ts and speech.ts can stand aside while one is on (`callOn`) and the shell can end it when the screen goes
 * (`leaveCall`). The hold starts when the microphone and the audio session are first asked for — a warmed-up call counts.
 */

/** What the screen draws. `connecting` until the first audio; `idle` after the app came back; `ended` once it is over. */
export type CallPhase = "connecting" | "speaking" | "listening" | "thinking" | "idle" | "ended";

/** Every number the call runs on. None of them is about money: the server owns the call's cost and its length. */
export const CALL = {
  /** The data channel the service's events come on. Read only, by convention and by this code. */
  channel: "oai-events",
  /** From the server's `live` reply to "data channel open and the connection up". Past it: close, then the turn call. */
  connectMs: 10_000,
  /** From sending POST live, whatever the server takes to answer (it may take up to 13 s before it replies). */
  overallMs: 25_000,
  /** The live part can never run longer than this, whatever the reply says: the server's own hard length. */
  maxSecCap: 900,
  /** Past the reply's maxSec by this much the phone closes by itself, even if our server died. */
  overrunMs: 10_000,
  /** A connection that says "disconnected" has this long to come back by itself before the call is given up. */
  iceGraceMs: 5_000,
  /** State writes: at most ten a second, however fast the words come. */
  writeMs: 100,
  /** How often the voice level is read from the connection's own statistics. */
  levelMs: 100,
  /** The bot's words kept on screen. */
  saidMax: 280,
  /** The person's last words kept on screen. */
  heardMax: 300,
  /** How long a warmed microphone and offer are worth using. */
  warmMs: 20_000,
} as const;

/**
 * PHONES WHOSE OWN ECHO CANCELLER IS NOT GOOD ENOUGH, so the call asks the live client for its software one instead
 * (callAudio prepare {aec:"soft"}). Entries are matched against "<manufacturer> <model>", upper case, as a substring, so
 * "INFINIX X67" covers every variant of that model. The list starts empty and is filled by the device matrix (P4); it lives
 * here rather than in native code so it can be updated over the air.
 *
 * The ask takes effect at the NEXT START OF THE APP: the live client builds its audio as the app starts, before any of this
 * runs, so `prepare` only remembers the ask and the native side applies it then (CallAec.kt; docs/STREAMING.md).
 */
export const SOFT_AEC_MODELS: readonly string[] = [];

/** Which echo canceller this phone's call asks for. iOS has voice processing in the audio session and never needs the hook. */
export function aecFor(platform: string, name: string): "hw" | "soft" {
  if (platform !== "android") return "hw";
  const n = String(name ?? "").toUpperCase();
  if (!n) return "hw";
  return SOFT_AEC_MODELS.some((m) => n.includes(m.toUpperCase())) ? "soft" : "hw";
}

/** The live seconds this call may still run, from the server's reply: never more than the hard length, never below zero. */
export function maxSecOf(said: unknown): number {
  const n = Number(said);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(CALL.maxSecCap, Math.floor(n));
}

/** When the phone closes on its own: the reply's seconds and ten more. 0 (no usable reply) means the backstop is off. */
export function overrunMsOf(maxSec: number): number {
  return maxSec > 0 ? maxSec * 1000 + CALL.overrunMs : 0;
}

/** At most ten state writes a second: either write now, or in this many ms. */
export function writeWaitMs(lastMs: number, nowMs: number): number {
  const since = nowMs - lastMs;
  return since >= CALL.writeMs ? 0 : CALL.writeMs - since;
}

// =============================================================== what the screen shows

export interface CallState {
  phase: CallPhase;
  /** The bot has been heard at least once. A fallback then goes straight to listening instead of playing the opening again. */
  spoke: boolean;
  /** The bot's words, as they are spoken. */
  said: string;
  /** The person's last words, as the service transcribed them. */
  heard: string;
  /** A tool ran this turn: the call re-reads the call's own view after the next spoken reply. */
  owed: boolean;
}

export const callStart = (): CallState => ({ phase: "connecting", spoke: false, said: "", heard: "", owed: false });

/** One event off the data channel, as much of it as these rules read. */
export interface CallEvent {
  type?: unknown;
  delta?: unknown;
  transcript?: unknown;
  response?: { output?: unknown } | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The last `max` characters, so a long reply keeps its newest words. */
export function tail(s: string, max: number): string {
  return s.length <= max ? s : s.slice(s.length - max);
}

/** Does this finished response hold a tool call? Then our server runs it, and the Plan may change. */
export function hasToolCall(e: CallEvent): boolean {
  const out = e.response?.output;
  if (!Array.isArray(out)) return false;
  return out.some((o) => o && typeof o === "object" && (o as { type?: unknown }).type === "function_call");
}

/**
 * One event in, the next state out — plus `reread`, which asks the call to read the view again now (a tool ran, so a button on
 * the item card may have become "Paid" or "Done"). Anything unknown leaves the state as it was.
 */
export function step(s: CallState, e: CallEvent): { next: CallState; reread: boolean } {
  const kind = text(e.type);
  switch (kind) {
    case "output_audio_buffer.started":
      // A new reply starts: his last words go, and from here a fallback can skip the opening.
      return { next: { ...s, phase: "speaking", spoke: true, said: "" }, reread: false };
    case "response.output_audio_transcript.delta":
      return { next: { ...s, said: tail(s.said + text(e.delta), CALL.saidMax) }, reread: false };
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      return { next: { ...s, phase: "listening" }, reread: false };
    // Barge-in shows at once; the service stops and cuts off the unheard part of the reply itself.
    case "input_audio_buffer.speech_started":
      return { next: { ...s, phase: "listening" }, reread: false };
    case "input_audio_buffer.speech_stopped":
      return { next: { ...s, phase: "thinking" }, reread: false };
    case "conversation.item.input_audio_transcription.completed":
      return { next: { ...s, heard: text(e.transcript).slice(0, CALL.heardMax) }, reread: false };
    case "response.done":
      if (hasToolCall(e)) return { next: { ...s, phase: "thinking", owed: true }, reread: false };
      // A spoken reply after a tool turn: now the view is worth reading again.
      return s.owed ? { next: { ...s, owed: false }, reread: true } : { next: s, reread: false };
    default:
      return { next: s, reread: false };
  }
}

/** What goes to the action's `statePath`: the one thing the screen's own fallback reads. */
export function stateOf(s: CallState): { spoke: boolean } {
  return { spoke: s.spoke };
}

/**
 * The media closed and we did not close it. The call's own view says what happened: still answered means the live part broke
 * and the call carries on turn by turn (the person taps nothing); anything else means it is over. A view we could not read
 * falls back too, which is the kinder of the two mistakes.
 */
export function afterClose(view: unknown): "ended" | "fallback" {
  const state = view && typeof view === "object" ? (view as { state?: unknown }).state : undefined;
  return state === "ended" || state === "missed" ? "ended" : "fallback";
}

/** The state paths to set true after a tool turn: the view's `acted` names, through the action's own map. */
export function actedWrites(acted: unknown, map: Record<string, string> | undefined): string[] {
  if (!map || !Array.isArray(acted)) return [];
  const out: string[] = [];
  for (const name of acted) {
    if (typeof name !== "string") continue;
    const path = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
    if (typeof path === "string" && path && !out.includes(path)) out.push(path);
  }
  return out;
}

// =============================================================== the one call on this phone

/** The call on show, as much of it as the rest of the app needs to know. */
export interface HeldCall {
  /** The screen that holds it (its Store). */
  owner: unknown;
  /** End it: "left" when the screen went, "set" when the screen asked. */
  end(why: "left" | "set"): void;
}

let held: HeldCall | null = null;

/** callRealtime.ts says which call is up; the same call says when it is over. */
export function holdCall(call: HeldCall): void {
  held = call;
}

export function dropCall(call: HeldCall): void {
  if (held === call) held = null;
}

/** True while a live call is on: the other audio actions (media.ts, speech.ts) stand aside rather than take the session. */
export function callOn(): boolean {
  return held !== null;
}

/** The screen that held a call has gone (the shell's ScreenHost): the call ends with it. */
export function leaveCall(owner: unknown): void {
  const c = held;
  if (c && c.owner === owner) c.end("left");
}

/** The screen asked for it to end (voiceCallSet end), or a new one is starting. */
export function endCallNow(): void {
  held?.end("set");
}
