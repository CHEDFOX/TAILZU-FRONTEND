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
import { AudioModule, setAudioModeAsync } from "expo-audio";
import { isStreamAvailable, startStream, type LiveSession } from "../../modules/tulmi-stream";
import * as api from "../api";
import { callEndpoint } from "./client";
import type { CompProps } from "./components";
import * as K from "./knobs";

type Turn = { role: "user" | "assistant"; text: string };

/*
 * The level's shape — how often the decay timer runs while listening, where
 * the level lands on a word, where it falls back to and how fast, and where it
 * sits while thinking and speaking — is the node's props first, then the
 * ui.VoiceSession.* knobs, then these literals.
 */

export const VoiceSession = ({ props, store, fire }: CompProps): null => {
  const endpoint = String(props?.path ?? K.str("ui.VoiceSession.path", "/v1/train/converse"));
  const silenceMs = Math.max(K.num("ui.VoiceSession.minSilenceMs", 600), Number(props?.silenceMs) || K.num("ui.VoiceSession.silenceMs", 1500));
  const maxTurns = Math.max(2, Number(props?.maxTurns) || K.num("ui.VoiceSession.maxTurns", 40));

  // Read by the running loop through a ref, so a retune reaches a session in
  // progress without tearing the conversation down and starting it again.
  const tuneNow = {
    tickMs: Number(props?.levelTickMs ?? K.num("ui.VoiceSession.levelTickMs", 90)),
    onSpeech: Number(props?.levelOnSpeech ?? K.num("ui.VoiceSession.levelOnSpeech", 0.8)),
    floor: Number(props?.levelFloor ?? K.num("ui.VoiceSession.levelFloor", 0.15)),
    decay: Number(props?.levelDecay ?? K.num("ui.VoiceSession.levelDecay", 0.86)),
    thinking: Number(props?.levelThinking ?? K.num("ui.VoiceSession.levelThinking", 0.12)),
    speaking: Number(props?.levelSpeaking ?? K.num("ui.VoiceSession.levelSpeaking", 0.5)),
  };
  const tune = useRef(tuneNow);
  tune.current = tuneNow;
  // The words said out loud when something fails — the node's first, then
  // the knob, then these.
  const errsNow = {
    micStopped: String(props?.errorMicStopped ?? K.txt("ui.VoiceSession.errorMicStopped", "The microphone stopped.")),
    startFailed: String(props?.errorStartFailed ?? K.txt("ui.VoiceSession.errorStartFailed", "Couldn't start listening.")),
    serverFailed: String(props?.errorServer ?? K.txt("ui.VoiceSession.errorServer", "Couldn't reach the server.")),
    needsUpdate: String(props?.errorNeedsUpdate ?? K.txt("ui.VoiceSession.errorNeedsUpdate", "Live voice needs the latest app version.")),
    permission: String(props?.errorPermission ?? K.txt("ui.VoiceSession.errorPermission", "Microphone permission denied")),
  };
  const errs = useRef(errsNow);
  errs.current = errsNow;
  const language = props?.language ? String(props.language) : undefined;
  // What the phone SPEAKS in: a locale ("hi-IN"), where `language` is the hint
  // the recogniser and the partner get ("hi", "hinglish"). The server sends
  // both; without the second, the voice follows the hint as best it can.
  const speakLanguage = props?.speakLanguage ? String(props.speakLanguage) : language;

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
    /** Stream credentials, fetched while the greeting is being spoken. */
    warm: null as Promise<{ url: string; token: string } | null> | null,
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

    /**
     * PLAY-ONLY, WHICH IS THE ONE CATEGORY WITH NO EARPIECE IN IT.
     *
     * Held for as long as the reply is being spoken, and given back the moment
     * the mic is needed again.
     */
    const speakerOnly = () =>
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
        .catch(() => { /* nothing to do but speak anyway */ });

    /** Back to the category that can hear, before anything tries to. */
    const micReady = () =>
      setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      }).catch(() => { /* the stream module sets it too, on every turn */ });

    /** Speech arrived: push the bubble up and restart the clock. */
    const heard = () => {
      setLevel(tune.current.onSpeech);
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
      setLevel(tune.current.floor);
      // The reply was spoken under a play-only category. The mic needs the
      // recording one back, and it needs it before the stream opens — not
      // after, which would be a session change under a live capture.
      await micReady();
      if (!r.alive) return;

      // The level has no real amplitude behind it — the streamer hands over
      // text, not PCM. So it is driven by the arrival of words and decays
      // between them, which is a true signal about speech even though it is
      // not loudness.
      r.decay = setInterval(() => {
        const t = tune.current;
        if (r.level > t.floor) setLevel(Math.max(t.floor, r.level * t.decay));
      }, tune.current.tickMs);

      try {
        // Taken from the warm-up when it is there — it was started at mount
        // and has been resolving behind the greeting, so the first turn does
        // not pay for it. Cleared after use: credentials are short-lived, and
        // a later turn asking again is correct rather than wasteful.
        const warmed = r.warm ? await r.warm : null;
        r.warm = null;
        const { url, token } = warmed ?? (await api.streamConfig());
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
            onError: (m) => fail(m || errs.current.micStopped),
            onClosed: () => { r.session = null; },
          },
        );
        armSilence();
      } catch (e) {
        fail(e instanceof Error ? e.message : errs.current.startFailed);
      }
    }

    async function respond(): Promise<void> {
      if (!r.alive) return;
      setState("thinking");
      setLevel(tune.current.thinking);
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
        setLevel(tune.current.speaking);
        // OUT LOUD, AND THE CATEGORY IS THE ONLY THING THAT DECIDES IT.
        //
        // Listening runs on .playAndRecord, because one session has to serve
        // the mic and the synthesiser. That category's default output is the
        // RECEIVER — the earpiece — and .defaultToSpeaker does not fix it:
        // it is a default, weighed when the session activates, and this
        // session is already active and stays active between turns. Re-setting
        // the category with that option changes nothing about a route that has
        // already been chosen. That was the first attempt and it did not work.
        //
        // .playback has no receiver to fall back to. It is the play-only
        // category, its output is the speaker, and there is no default to
        // overrule — so the reply is spoken under .playback and nothing has to
        // be persuaded.
        //
        // Safe because the mic is already closed: closeMic() runs before
        // respond(), so nothing is capturing while the category is play-only.
        // Listening puts .playAndRecord back before it opens the mic again.
        await speakerOnly();
        Speech.speak(reply, {
          language: speakLanguage,
          onDone: () => { if (r.alive) void listen(); },
          // A synthesiser that fails silently would strand the conversation in
          // "speaking" forever, so both exits go back to listening.
          onStopped: () => { if (r.alive) void listen(); },
          onError: () => { if (r.alive) void listen(); },
        });
      } catch (e) {
        fail(e instanceof Error ? e.message : errs.current.serverFailed);
      }
    }

    void (async () => {
      if (!isStreamAvailable()) {
        fail(errs.current.needsUpdate);
        return;
      }

      /**
       * THE WARM-UP HAPPENS BEHIND THE GREETING, NOT BEFORE IT.
       *
       * Opening a session costs a permission check and a fetch for the stream
       * credentials, and both used to run in silence with the screen already
       * up. Then it listened. So the first thing the app ever said arrived
       * only after the user had spoken into that silence and waited out a full
       * round trip — which reads as broken, not as thinking.
       *
       * The greeting is already written when the screen arrives — the server
       * composed it from the name and what it has actually learned — so it can
       * be said at once, and the warm-up moves underneath it. Both of these
       * are started WITHOUT awaiting, so they run while the sentence is being
       * spoken; by the time it ends the credentials are in hand and listen()
       * has only the microphone left to open.
       *
       * The mic itself is deliberately NOT opened early. Speaking holds the
       * audio session on .playback, and a capture opened under it would be
       * fighting the category the reply needs — see speakerOnly() above.
       */
      const permission = AudioModule.requestRecordingPermissionsAsync();
      r.warm = api.streamConfig().catch(() => null);

      // THE SEEDED TRANSCRIPT IS NOT MINE TO THROW AWAY.
      //
      // This used to clear it. The screen seeds `turns` with the greeting so
      // the model's first reply answers something rather than starting in
      // mid-air, and clearing it here deleted that a frame after it arrived.
      // Whatever the screen put there is adopted instead.
      const seeded = store.get(turnsPath);
      r.turns = Array.isArray(seeded) ? (seeded as Turn[]) : [];

      const greeting = String(props?.greeting ?? "").trim();
      if (greeting) {
        setState("speaking");
        setLevel(tune.current.speaking);
        store.set(linePath, greeting);
        // Already in `turns` from the seed; saying it again would double it.
        if (!r.turns.some((t) => t.text === greeting)) say("assistant", greeting);
        await speakerOnly();
        if (!r.alive) return;
        Speech.speak(greeting, {
          language: speakLanguage,
          onDone: () => { void afterGreeting(permission); },
          onStopped: () => { void afterGreeting(permission); },
          onError: () => { void afterGreeting(permission); },
        });
        return;
      }

      await afterGreeting(permission);
    })();

    /** The permission is only WAITED for here, once there is nothing left to
     *  hide the wait behind. A denial has to be said out loud rather than
     *  leaving the orb moving with no microphone behind it. */
    async function afterGreeting(permission: Promise<{ granted: boolean }>) {
      if (!r.alive) return;
      const perm = await permission.catch(() => ({ granted: false }));
      if (!r.alive) return;
      if (!perm.granted) {
        fail(errs.current.permission);
        return;
      }
      await listen();
    }

    return () => {
      // Leaving the screen must take the mic and the voice with it. Without
      // this, navigating away mid-answer leaves the synthesiser talking to an
      // empty room and the socket open.
      r.alive = false;
      closeMic();
      Speech.stop();
      setState("idle");
      setLevel(0);
      // AND PUT THE AUDIO SESSION BACK.
      //
      // Speaking switches the whole process to .playback — it is the one
      // category with no earpiece in it, which is why the reply comes out of
      // the speaker. But the category is SHARED, and the app may be holding a
      // Flow session on .playAndRecord for the keyboard: switching it stops
      // that engine, the liveness heartbeat stops with it, and two and a half
      // seconds later the keyboard decides the session is dead and re-opens
      // the app to arm one.
      //
      // Only listen() restored it, so leaving this screen between turns left
      // the entire app in .playback until it was relaunched — and every mic
      // tap on the keyboard bounced back here. That is the regression, and it
      // shipped with the earpiece fix.
      void micReady();
    };
  }, [
    endpoint, silenceMs, maxTurns, language,
    statePath, levelPath, linePath, turnsPath,
    store, fire,
  ]);

  return null;
};
