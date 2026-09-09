/**
 * VoiceSession — a spoken conversation, driven entirely from the server.
 *
 * Renders nothing. It owns the audio loop and writes what it knows into the
 * SDUI store, so the screen around it stays ordinary backend-authored JSON: a
 * VoiceBubble bound to `level` and `state`, a Text bound to `line`, a Button
 * whose action posts `$state.turns` wherever the server wants them.
 *
 * The loop, one turn at a time:
 *
 *   listening   the native streamer (TulmiStream, already in the binary) opens
 *               a socket to /v1/transcribe-stream and fills in text as the
 *               user talks. A pause of `silenceMs` with something said ends
 *               the turn — the stream is closed, because the mic must be shut
 *               while the app talks or it transcribes its own voice.
 *   thinking    the whole conversation so far goes to `path`; the reply comes
 *               back as text.
 *   speaking    expo-speech says it. When it finishes, listening resumes.
 *
 * This is turn-based, not full duplex: you cannot talk over it. Barge-in needs
 * a bidirectional audio session, which needs a native module we do not have —
 * so it is deliberately absent rather than half-present. Everything here runs
 * on modules that already shipped, which is why the whole screen arrives over
 * the air.
 *
 * Props (all server-authored):
 *   path         conversation endpoint (default /v1/train/converse)
 *   silenceMs    pause that ends a turn (default 1500)
 *   maxTurns     stop listening after this many exchanges (default 40)
 *   language     passed to both the streamer and the speech synthesiser
 *   statePath    store key for "idle"|"listening"|"thinking"|"speaking"|"error"
 *   levelPath    store key for the 0..1 the bubble follows
 *   linePath     store key for the most recent line, whoever said it
 *   turnsPath    store key for the whole transcript, as [{ role, text }]
 */
import { useEffect, useRef } from "react";
import * as Speech from "expo-speech";
import { AudioModule } from "expo-audio";
import { isStreamAvailable, startStream, type LiveSession } from "../../modules/tulmi-stream";
import * as api from "../api";
import { callEndpoint } from "./client";
import type { CompProps } from "./components";

type Turn = { role: "user" | "assistant"; text: string };

/** How often the decay timer runs while listening. */
const LEVEL_TICK_MS = 90;
/** Where the level lands on a word, and where it falls back to. */
const LEVEL_ON_SPEECH = 0.8;
const LEVEL_FLOOR = 0.15;
const LEVEL_DECAY = 0.86;

export const VoiceSession = ({ props, store, fire }: CompProps): null => {
  const endpoint = String(props?.path ?? "/v1/train/converse");
  const silenceMs = Math.max(600, Number(props?.silenceMs) || 1500);
  const maxTurns = Math.max(2, Number(props?.maxTurns) || 40);
  const language = props?.language ? String(props.language) : undefined;

  const statePath = String(props?.statePath ?? "sessionState");
  const levelPath = String(props?.levelPath ?? "level");
  const linePath = String(props?.linePath ?? "line");
  const turnsPath = String(props?.turnsPath ?? "turns");

  // Everything the loop mutates lives in one ref. State would re-render this
  // component on every partial — several times a second — and it draws nothing,
  // so there is nothing worth re-rendering.
  const run = useRef({
    alive: true,
    session: null as LiveSession | null,
    /** Segments the STT has finalised this turn, plus the live partial. */
    committed: "",
    partial: "",
    silence: null as ReturnType<typeof setTimeout> | null,
    decay: null as ReturnType<typeof setInterval> | null,
    level: 0,
    turns: [] as Turn[],
  });

  useEffect(() => {
    const r = run.current;
    r.alive = true;

    const setState = (s: string) => store.set(statePath, s);
    const setLevel = (v: number) => {
      r.level = v;
      store.set(levelPath, v);
    };
    const say = (role: Turn["role"], text: string) => {
      r.turns = [...r.turns, { role, text }];
      store.set(turnsPath, r.turns);
      store.set(linePath, text);
    };

    const clearTimers = () => {
      if (r.silence) { clearTimeout(r.silence); r.silence = null; }
      if (r.decay) { clearInterval(r.decay); r.decay = null; }
    };

    /** Close the mic. Idempotent — a turn can end from either direction. */
    const closeMic = () => {
      clearTimers();
      try { r.session?.stop(); } catch { /* already gone */ }
      r.session = null;
    };

    const fail = (message: string) => {
      if (!r.alive) return;
      closeMic();
      setState("error");
      setLevel(0);
      fire("onError", message);
    };

    /** A pause long enough to mean "your turn". */
    const armSilence = () => {
      if (r.silence) clearTimeout(r.silence);
      r.silence = setTimeout(() => {
        const said = `${r.committed} ${r.partial}`.replace(/\s+/g, " ").trim();
        if (!said) {
          // Silence with nothing said is not a turn — keep listening rather
          // than sending the model an empty message to answer.
          armSilence();
          return;
        }
        closeMic();
        say("user", said);
        void respond();
      }, silenceMs);
    };

    /** Speech arrived: push the bubble up and restart the clock. */
    const heard = () => {
      setLevel(LEVEL_ON_SPEECH);
      armSilence();
    };

    async function listen(): Promise<void> {
      if (!r.alive) return;
      if (r.turns.length >= maxTurns * 2) {
        setState("idle");
        setLevel(0);
        return;
      }
      r.committed = "";
      r.partial = "";
      setState("listening");
      setLevel(LEVEL_FLOOR);

      // The level has no real amplitude behind it — the streamer hands over
      // text, not PCM. So it is driven by the arrival of words and decays
      // between them, which is a true signal about speech even though it is
      // not loudness.
      r.decay = setInterval(() => {
        if (r.level > LEVEL_FLOOR) setLevel(Math.max(LEVEL_FLOOR, r.level * LEVEL_DECAY));
      }, LEVEL_TICK_MS);

      try {
        const { url, token } = await api.streamConfig();
        if (!r.alive) return;
        r.session = startStream(
          // duplex: this screen answers out loud between turns, so the mic and
          // the synthesiser have to share one audio session rather than take
          // it from each other. See the module's activateSession().
          { url, token, language, duplex: true },
          {
            onPartial: (t) => { r.partial = t; heard(); },
            onFinal: (t) => {
              if (t) r.committed = `${r.committed} ${t}`.trim();
              r.partial = "";
              heard();
            },
            onError: (m) => fail(m || "The microphone stopped."),
            onClosed: () => { r.session = null; },
          },
        );
        armSilence();
      } catch (e) {
        fail(e instanceof Error ? e.message : "Couldn't start listening.");
      }
    }

    async function respond(): Promise<void> {
      if (!r.alive) return;
      setState("thinking");
      setLevel(0.12);
      try {
        const res = (await callEndpoint("POST", endpoint, {
          turns: r.turns,
          language,
        })) as { reply?: string } | null;
        const reply = (res?.reply ?? "").trim();
        if (!r.alive) return;
        if (!reply) { void listen(); return; }
        say("assistant", reply);
        setState("speaking");
        setLevel(0.5);
        Speech.speak(reply, {
          language,
          onDone: () => { if (r.alive) void listen(); },
          // A synthesiser that fails silently would strand the conversation in
          // "speaking" forever, so both exits go back to listening.
          onStopped: () => { if (r.alive) void listen(); },
          onError: () => { if (r.alive) void listen(); },
        });
      } catch (e) {
        fail(e instanceof Error ? e.message : "Couldn't reach the server.");
      }
    }

    void (async () => {
      if (!isStreamAvailable()) {
        fail("Live voice needs the latest app version.");
        return;
      }
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fail("Microphone permission denied");
        return;
      }
      store.set(turnsPath, []);
      await listen();
    })();

    return () => {
      // Leaving the screen must take the mic and the voice with it. Without
      // this, navigating away mid-answer leaves the synthesiser talking to an
      // empty room and the socket open.
      r.alive = false;
      closeMic();
      Speech.stop();
      setState("idle");
      setLevel(0);
    };
  }, [
    endpoint, silenceMs, maxTurns, language,
    statePath, levelPath, linePath, turnsPath,
    store, fire,
  ]);

  return null;
};
