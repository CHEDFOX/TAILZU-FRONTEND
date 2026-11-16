/**
 * THE speak ACTION: words said by the phone's own voice (expo-speech). Nothing leaves the phone, which is why a call from a person
 * who has not agreed to AI is opened with it (the server's bots.plan.call screen).
 *
 * A plain speak is what it always was: said, and nothing after. Two extras, sent only to a build that declares BOT_CALL_CAPABILITY:
 *   loud     the audio session set to playback first (as playAudio does, media.ts), so the silent switch does not mute it: a
 *            call the person just answered must be heard.
 *   onDone   run once when the words have been said, stopped or failed, so the call can listen next. A watchdog runs it if the
 *            voice never says it is done (a silent synthesiser must not strand the call).
 * Such a speech belongs to the screen that started it (`owner`, its Store): leaving the screen (ScreenHost) stops it, and a newer
 * one takes over; neither runs onDone.
 */
import * as Speech from "expo-speech";
import { setAudioModeAsync } from "expo-audio";
import type { ActionRef } from "../types";
// A live call (callRealtime.ts) holds the microphone and the speaker together; only its rules file is imported, never the call.
import { callOn } from "./callRealtimeCore";

export interface SpeakLine {
  text: string;
  voice?: string;
  loud?: boolean;
  onDone?: ActionRef;
}

/** What the action needs of the screen that ran it. */
export interface SpeakIO {
  owner: object;
  run(ref?: ActionRef): Promise<void>;
}

interface Speaking { owner: object; dropped: boolean; done: boolean; watchdog?: ReturnType<typeof setTimeout> }
/** The speech with loud or onDone this module started and has not heard the end of. */
let current: Speaking | null = null;

/** The current one dropped (its onDone never runs) and the voice stopped. */
function drop(s: Speaking): void {
  s.dropped = true;
  if (s.watchdog) clearTimeout(s.watchdog);
  if (current === s) current = null;
  try { Speech.stop(); } catch { /* nothing to stop */ }
}

/** How long the words could take, and then some: past this, the speech is taken as done. */
const watchdogMs = (text: string) => Math.max(4000, 90 * text.length + 3000);

export async function speakLine(a: SpeakLine, io: SpeakIO): Promise<void> {
  const text = typeof a.text === "string" ? a.text : String(a.text ?? "");
  // NOT WHILE A LIVE CALL IS ON. The bot is already talking, live, and this voice would set the audio session under the call's
  // own. `onDone` still runs, so a screen waiting to listen next is never stranded.
  if (callOn()) { await io.run(a.onDone); return; }
  // Today's speak, untouched: no audio session change, nothing run after.
  if (!a.loud && !a.onDone) {
    try { Speech.speak(text, { voice: a.voice }); } catch { /* no-op */ }
    return;
  }
  if (current) drop(current);
  const me: Speaking = { owner: io.owner, dropped: false, done: false };
  current = me;
  if (a.loud) await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  if (me.dropped) return; // the screen went, or another speech, while the session was set
  const finish = () => {
    if (me.done) return;
    me.done = true;
    if (me.watchdog) clearTimeout(me.watchdog);
    if (current === me) current = null;
    if (!me.dropped) void io.run(a.onDone);
  };
  if (!text.trim()) { finish(); return; }
  me.watchdog = setTimeout(finish, watchdogMs(text));
  try {
    Speech.speak(text, { voice: a.voice, onDone: finish, onStopped: finish, onError: finish });
  } catch {
    finish();
  }
}

/** The screen whose store is `owner` has gone (ScreenHost): its speech stops, and its onDone never runs. */
export function leaveSpeech(owner: object): void {
  if (current && current.owner === owner) drop(current);
}
