/**
 * HOLD TO SPEAK, AS A RULE AND NOT A TANGLE OF FLAGS.
 *
 * A held mic button has three things going on at once that a tap does not: a
 * finger that is down or up, a recorder that takes a moment to get ready (the
 * permission sheet, the audio session, the file), and a recording that is
 * either under way or not. The ways those can interleave are where a held
 * button goes wrong, and each one is a real thing a thumb does:
 *
 *   - lift the finger while the recorder is still getting ready: no
 *     recording may start, because nobody is holding;
 *   - tap, rather than hold: a recording too short to have said anything is
 *     dropped, not sent off to be transcribed;
 *   - press again while the last one is still starting: one recording, not two;
 *   - lift the finger the instant after record(): that recording must still be
 *     found, and stopped.
 *
 * VoiceButton owns the recorder; this owns the order of events, and is tested
 * on its own (holdToSpeak.test.ts), free of react-native.
 */
export interface HoldIO {
  /** Ask for the mic and get the recorder ready. False: not allowed, or failed (the caller has said why). */
  prepare(): Promise<boolean>;
  /** Start recording. */
  record(): void;
  /** A real recording ended: stop it and send it for transcription. */
  finish(): Promise<void>;
  /** A press too short to have said anything: stop, and throw away what was recorded. */
  discard(): Promise<void>;
  /** Already transcribing: ignore presses. */
  busy(): boolean;
  now(): number;
  /** How long a hold must last to count as speaking. */
  minMs(): number;
}

export function createHold(io: HoldIO) {
  /** A finger is down right now. */
  let pressing = false;
  /** The recorder is getting ready. */
  let arming = false;
  /** A recording is under way. Synchronous, unlike React state, so a release always finds it. */
  let armed = false;
  let since = 0;

  return {
    async press(): Promise<void> {
      pressing = true;
      if (armed || arming || io.busy()) return;
      arming = true;
      try {
        const ok = await io.prepare();
        // Checked again here, after the wait: the finger may be up by now.
        if (!ok || !pressing) return;
        io.record();
        armed = true;
        since = io.now();
      } finally {
        arming = false;
      }
    },

    async release(): Promise<void> {
      pressing = false;
      if (!armed) return;
      armed = false;
      if (io.now() - since < io.minMs()) await io.discard();
      else await io.finish();
    },

    /** Whether a recording is under way. */
    get recording(): boolean { return armed; },
  };
}
