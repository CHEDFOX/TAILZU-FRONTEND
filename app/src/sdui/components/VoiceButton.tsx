import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import * as api from "../../api";
import { isStreamAvailable, startStream, type LiveSession } from "../../../modules/tulmi-stream";
import { errorDetail, streamErrorMessage, userErrorMessage } from "../client";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import { typeRole } from "../theme/typeRole";
import { readableOn } from "../theme/style";
import type { CompProps } from "./props";
import { createHold, type HoldIO } from "./holdToSpeak";

/**
 * VoiceButton — dictation for the main app, written to bind.value.
 *
 * Two modes, picked by the server:
 *   • Live (props.live === true, native module present): streams mic audio over
 *     a WebSocket and fills the field word-by-word as you speak. See docs/STREAMING.md.
 *   • File-based (default / fallback): records the mic (expo-audio), uploads to
 *     /v1/transcribe-clean, writes the cleaned text once.
 *
 * Live falls back to file-based automatically if the native module is missing.
 *
 * Two more things the server can ask for, both off unless it does:
 *   • props.hold === true: hold to speak. Press-in starts, release stops, the
 *     way a walkie-talkie works. A press too short to have said anything (under
 *     ui.VoiceButton.holdMinMs) is thrown away and reported as an error, so a
 *     tap is not mistaken for a recording. Always the file-based path: a held
 *     button is a short try-it, not a live session.
 *   • bind.state: where to write what the button is doing, "idle", "recording"
 *     or "busy", so the screen around it can say so (a ring, a line of words).
 * And its children, when it has any, are drawn in place of the label.
 */
export const VoiceButton = ({ node, props, style, store, fire, children }: CompProps) => {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const bindPath = node.bind?.value;
  const statePath = node.bind?.state;
  const hold = props.hold === true;

  // Live (streaming) session + the text committed so far this dictation.
  const live = useRef<{ session: LiveSession | null; committed: string }>({
    session: null,
    committed: "",
  });
  const wantLive = props.live === true && !hold && isStreamAvailable();

  // What a failure says. The node's words first, then the ui.VoiceButton.*
  // knobs, then these. These are the ONLY words a failure shows: an error's
  // own message is written for a developer ("Mic start: Error Domain=…") and
  // goes to the log.
  const errPermission = String(props.errorPermission ?? K.txt("ui.VoiceButton.errorPermission", "Microphone permission denied"));
  const errMic = String(props.errorMic ?? K.txt("ui.VoiceButton.errorMic", "Couldn't start the microphone. Try again."));
  const errNoAudio = String(props.errorNoAudio ?? K.txt("ui.VoiceButton.errorNoAudio", "No audio captured"));
  const errTranscribe = String(props.errorTranscribe ?? K.txt("ui.VoiceButton.errorTranscribe", "Couldn't turn that into text. Try again."));
  /** A caught failure, worded; its raw detail goes to the log. */
  const failWith = (e: unknown, fallback: string) => {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][VoiceButton]", errorDetail(e));
    fire("onError", userErrorMessage(e, fallback));
  };

  // Stop the recorder + live stream on unmount if we're still recording, so a
  // tab switch / navigation / SDUI refetch mid-dictation doesn't leak the mic
  // or the streaming WebSocket. Mirrors VoiceToggle's teardown (morphControls).
  // Idempotent: optional-chaining + `.catch` make a double-stop / not-recording
  // unmount safe. CANCEL, not stop: a graceful stop still delivers onClosed,
  // which refined the text and fired onChange into a screen that had gone.
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  // What the button is doing, for the screen around it. Written only when it
  // changes, and put back to idle when the button goes, so a step that glides
  // away mid-recording does not leave a ring lit behind it.
  useEffect(() => {
    if (!statePath) return;
    const now = busy ? "busy" : recording ? "recording" : "idle";
    if (store.get(statePath) !== now) store.set(statePath, now);
  }, [statePath, busy, recording, store]);
  useEffect(() => () => {
    if (statePath && store.get(statePath) !== "idle") store.set(statePath, "idle");
  }, [statePath, store]);
  useEffect(() => () => {
    if (recordingRef.current) {
      try { live.current.session?.cancel(); } catch { /* already gone */ }
      live.current.session = null;
      recorder.stop().catch(() => {});
    }
  }, [recorder]);

  async function startLive() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", errPermission);
        return;
      }
      const { url, token } = await api.streamConfig();
      live.current.committed = "";
      setRecording(true);
      const write = (text: string) => {
        if (bindPath) store.set(bindPath, text);
      };
      live.current.session = startStream(
        { url, token, targetApp: props.targetApp, language: props.language },
        {
          onPartial: (t) => write(live.current.committed + t),
          onFinal: (t) => {
            live.current.committed += t.endsWith(" ") ? t : `${t} `;
            write(live.current.committed);
          },
          onError: (m, failure) => {
            fire("onError", streamErrorMessage(m, failure.code, { permission: errPermission, other: errMic }));
            endLive();
          },
          onClosed: async () => {
            endLive();
            const raw = live.current.committed.trim();
            write(raw);
            fire("onChange", raw);
            if (!raw) return;
            // Auto-refine: the raw dictation shows live, then is replaced by the
            // backend's cleaned-up version — no manual "Refine" step.
            try {
              setBusy(true);
              const { refinedText } = await api.refine(raw, {
                targetApp: props.targetApp,
                language: props.language,
              });
              const finalText = refinedText?.trim() || raw;
              write(finalText);
              fire("onChange", finalText);
            } catch {
              // keep the raw transcript if refine fails
            } finally {
              setBusy(false);
            }
          },
        },
      );
    } catch (e) {
      failWith(e, errMic);
      endLive();
    }
  }

  function stopLive() {
    setBusy(true);
    live.current.session?.stop();
  }

  function endLive() {
    setRecording(false);
    setBusy(false);
    live.current.session = null;
  }

  async function start() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", errPermission);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      failWith(e, errMic);
    }
  }

  async function stop() {
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        fire("onError", errNoAudio);
        return;
      }
      const { cleanedText } = await api.transcribeClean(uri, {
        targetApp: props.targetApp,
        language: props.language,
      });
      // Only write on a non-empty result — recording silence returns "" and
      // must NOT wipe whatever the user already had in the bound field.
      if (cleanedText) {
        if (bindPath) store.set(bindPath, cleanedText);
        fire("onChange", cleanedText);
      }
    } catch (e) {
      failWith(e, errTranscribe);
    } finally {
      setBusy(false);
    }
  }

  // HOLD TO SPEAK. The order of events (finger down, recorder ready, finger up,
  // too short to count) is holdToSpeak's, which is tested on its own; what it
  // is told to DO is here. The machine is built once, so it reads the latest
  // closures through a ref (they close over state that changes every render).
  const holdIO = useRef<HoldIO | null>(null);
  holdIO.current = {
    prepare: async () => {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) { fire("onError", errPermission); return false; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        return true;
      } catch (e) {
        failWith(e, errMic);
        return false;
      }
    },
    record: () => { recorder.record(); setRecording(true); },
    finish: () => stop(),
    discard: async () => {
      // Too short to have said anything: a tap. Drop it, and say so.
      setRecording(false);
      try { await recorder.stop(); } catch { /* nothing was recorded */ }
      fire("onError", errNoAudio);
    },
    busy: () => busy,
    now: () => Date.now(),
    minMs: () => K.num("ui.VoiceButton.holdMinMs", 350),
  };
  const holder = useRef<ReturnType<typeof createHold> | null>(null);
  if (!holder.current) {
    holder.current = createHold({
      prepare: () => holdIO.current!.prepare(),
      record: () => holdIO.current!.record(),
      finish: () => holdIO.current!.finish(),
      discard: () => holdIO.current!.discard(),
      busy: () => holdIO.current!.busy(),
      now: () => holdIO.current!.now(),
      minMs: () => holdIO.current!.minMs(),
    });
  }

  const label = busy
    ? (props.transcribingLabel ?? K.txt("ui.VoiceButton.transcribingLabel", "Transcribing…"))
    : recording
    ? (props.stopLabel ?? K.txt("ui.VoiceButton.stopLabel", "■ Stop & transcribe"))
    : (props.label ?? K.txt("ui.VoiceButton.label", "🎙️ Record"));
  const bg = recording ? (props.recordingBackground ?? theme.color.danger) : (props.background ?? theme.color.primary);

  const onPress = wantLive
    ? recording
      ? stopLive
      : startLive
    : recording
    ? stop
    : start;

  return (
    <Pressable
      // A held button acts on press-in and release, never on the tap between.
      onPress={hold ? undefined : onPress}
      onPressIn={hold ? () => { void holder.current!.press(); } : undefined}
      onPressOut={hold ? () => { void holder.current!.release(); } : undefined}
      disabled={busy}
      // Its children draw the face (an icon, no words), so a held button is
      // named for a screen reader here: the node's own, else the knob's.
      accessibilityRole={hold ? "button" : undefined}
      accessibilityLabel={hold ? String(props.accessibilityLabel || props.label || K.txt("ui.VoiceButton.holdLabel", "Hold to speak")) : undefined}
      style={[
        {
          backgroundColor: bg,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.md ?? K.num("ui.VoiceButton.radius", 13),
          paddingVertical: Number(props.paddingVertical ?? K.num("ui.VoiceButton.paddingVertical", 13)),
          alignItems: "center",
          opacity: busy ? Number(props.busyOpacity ?? K.num("ui.VoiceButton.busyOpacity", 0.6)) : 1,
        },
        style,
      ]}
    >
      {/* `children` is an empty ARRAY for a node with none, so length is the
          only honest test (GoogleSignIn learned this the hard way). */}
      {React.Children.count(children) > 0 ? children : (
        <Text
          // ITS FACE, WHEN THE SCREEN SETS ONE. Beside a pill in the app's own
          // face, the theme's bold system "mic" read as a different control,
          // and "■ Stop & transcribe" wrapped to two lines in half a row and
          // stood the button taller than the pill. The server can set the
          // face, size and ink; and the label is one line, whatever it says.
          numberOfLines={1}
          style={[
            typeRole(theme, "mic", { fontWeight: "700", fontSize: 15 }),
            props.fontFamily ? { fontFamily: String(props.fontFamily), fontWeight: "normal" as const } : null,
            props.fontSize != null ? { fontSize: Number(props.fontSize) } : null,
            { color: recording ? String(props.recordingColor ?? K.color("ui.VoiceButton.recordingColor", "#fff")) : props.color ? String(props.color) : readableOn(String(props.background ?? theme.color.primary)) },
          ]}
        >{label}</Text>
      )}
    </Pressable>
  );
};
