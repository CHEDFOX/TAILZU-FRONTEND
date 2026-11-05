/**
 * THE voiceLive AND voiceStop ACTIONS (VOICE_LIVE_CAPABILITY): listening with live words, turn by turn, on the phone's live
 * dictation stream (modules/tulmi-stream over /v1/transcribe-stream). The loop itself (pauses, turns, quiet, the made-up
 * level) is voiceLiveCore.ts; this file opens the microphone, writes what the screen asked for and runs its actions.
 *
 * One session per screen (its Store). It ends on voiceStop, when the screen goes (ScreenHost calls leaveVoice), when the app
 * goes to the background, after a quiet spell, or after 20 minutes. The words and the level go on the voice bus
 * (voiceBus.ts), never into the screen's state: only `statePath` ("listening" / "sending" / "") and `into` (a turn's words,
 * once) are written.
 *
 * The capability is declared only by a binary that has the stream module (client/capabilities.ts), so a screen never asks a
 * phone that cannot.
 */
import { AppState } from "react-native";
import { AudioModule } from "expo-audio";
import * as api from "../../api";
import { isStreamAvailable, startStream, type StreamOptions } from "../../../modules/tulmi-stream";
import { num, txt } from "../knobs";
import type { ActionRef, Condition } from "../types";
import { stopAudio } from "../../media/media";
import { VoiceSession } from "./voiceLiveCore";
import { setVoiceLevel, setVoiceWords } from "./voiceBus";

export interface VoiceLiveSpec {
  mode: "once" | "chat";
  statePath: string;
  into: string;
  silenceMs?: number;
  language?: string;
  onHeard: ActionRef;
  stopWhen?: Condition;
  onEnd?: ActionRef;
  onError?: ActionRef;
  onBlocked?: ActionRef;
}

/** What the action needs of the screen that ran it. */
export interface VoiceLiveIO {
  owner: object;
  set(path: string, value: unknown): void;
  run(ref: ActionRef | undefined, event?: unknown): Promise<void>;
  cond(c: Condition): boolean;
}

/** The session open on each screen. */
const open = new WeakMap<object, { session: VoiceSession; off: () => void }>();

/** True while a session listens or sends on this screen. */
export function voiceOn(owner: object): boolean {
  const o = open.get(owner);
  return !!o && !o.session.done;
}

/** voiceStop: the session on this screen ends now; the words of its turn not yet sent are dropped. */
export function voiceStop(owner: object): void {
  open.get(owner)?.session.stop();
}

/** The screen went (ScreenHost): its session ends. */
export function leaveVoice(owner: object): void {
  voiceStop(owner);
}

export async function voiceLive(a: VoiceLiveSpec, io: VoiceLiveIO): Promise<void> {
  // One session per screen: a new one (a double tap while he listens) takes over.
  voiceStop(io.owner);
  const failed = txt("voice.failed", "Couldn't hear you. Try again.");
  if (!isStreamAvailable()) { await io.run(a.onError, failed); return; }
  try {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      await io.run(a.onBlocked ?? a.onError, txt("media.micOff", "X0 Bot needs the microphone to hear you."));
      return;
    }
  } catch {
    await io.run(a.onError, failed);
    return;
  }
  let cfg: { url: string; token: string };
  try { cfg = await api.streamConfig(); } catch { await io.run(a.onError, failed); return; }
  // Whatever was playing stops: one sound at a time, and the microphone hears the person, not the phone.
  stopAudio();

  const owner = io.owner;
  let ended = false;
  const session = new VoiceSession({
    mode: a.mode === "chat" ? "chat" : "once",
    silenceMs: Number(a.silenceMs) > 0 ? Number(a.silenceMs) : num("ui.VoiceLive.silenceMs", 900),
    firstQuietMs: num("ui.VoiceLive.firstQuietMs", 8000),
    chatQuietMs: num("ui.VoiceLive.chatQuietMs", 12000),
    maxMs: num("ui.VoiceLive.maxMs", 1200000),
    graceMs: num("ui.VoiceLive.graceMs", 700),
  }, {
    open: (on) => {
      const o: StreamOptions = { url: cfg.url, token: cfg.token };
      if (a.language) o.language = a.language;
      return startStream(o, {
        onPartial: on.partial,
        onFinal: on.final,
        onError: (m, f) => on.error(m, f.code),
        onClosed: on.closed,
      });
    },
    status: (s) => io.set(a.statePath, s),
    words: (t) => setVoiceWords(owner, t),
    level: (v) => setVoiceLevel(owner, v),
    heard: async (t) => {
      io.set(a.into, t);
      await io.run(a.onHeard);
      // A chat can run long: the next turn opens with a fresh sign-in token.
      if (a.mode === "chat") { try { cfg = await api.streamConfig(); } catch { /* the last one may still do */ } }
    },
    stopWhen: () => (a.stopWhen ? io.cond(a.stopWhen) : false),
    ended: () => {
      if (ended) return;
      ended = true;
      off();
      if (open.get(owner)?.session === session) open.delete(owner);
      void io.run(a.onEnd);
    },
    failed: (m, code) => {
      if (code === "permission") void io.run(a.onBlocked ?? a.onError, txt("media.micOff", "X0 Bot needs the microphone to hear you."));
      else void io.run(a.onError, m || failed);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  // The app to the background: the session ends (it never listens from behind another app).
  // ("inactive" is a pulled-down notification shade on iOS: still here.)
  const sub = AppState.addEventListener("change", (st) => { if (st === "background") session.background(); });
  const off = () => { try { sub.remove(); } catch { /* gone */ } };
  open.set(owner, { session, off });
  session.start();
}
