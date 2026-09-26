/**
 * Morphing voice + action controls for the playground (Home: Refine ⇄ Reply).
 *
 * VoiceToggle — the brand soundwave on a white circle (right edge of a type
 * box). Tap → the mark collapses (scaleY spring) into a straight line while
 * recording; tap → audio is sent to the backend and it springs back. Writes
 * `recording` into screen state so other controls can react.
 *
 * MorphPad — the shared half-width white button with a black zig-zag that morphs
 * to a single wave while `working`, and flattens to a line while `recording`
 * (voice always wins the shape). RefineButton + DraftButton wrap it.
 *
 * All motion is spring physics (RN Animated — no worklet/babel deps) and every
 * interaction is haptic-tuned.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Easing } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import * as api from "../api";
import type { CompProps } from "./components";
import { useStoreVersion } from "./state";
import { resolveMedia, type MediaSpec } from "../media/resolveMedia";
import { MediaPlayer } from "../media/MediaPlayer";
import * as K from "./knobs";

const MARK = require("../../assets/tailzu-mark.png");
/** The mark ⇄ line morph's spring. */
const spring = () => ({
  friction: K.num("ui.VoiceToggle.morphFriction", 7),
  tension: K.num("ui.VoiceToggle.morphTension", 120),
  useNativeDriver: true,
});
/**
 * The press every control here shares: down to a scale on a stiff spring,
 * back up on a softer one. The scale differs per control (a round mic dips
 * further than a wide pad); the springs are one feel.
 */
const pressDown = (toValue: number) => ({
  toValue,
  friction: K.num("ui.morph.pressDownFriction", 8),
  tension: K.num("ui.morph.pressDownTension", 300),
  useNativeDriver: true,
});
const pressUp = () => ({
  toValue: 1,
  friction: K.num("ui.morph.pressUpFriction", 6),
  tension: K.num("ui.morph.pressUpTension", 220),
  useNativeDriver: true,
});

// App-wide recording lock. The Home Pager mounts BOTH of its pages at once
// (RN ScrollView pagingEnabled renders every child), so two VoiceToggles —
// each with its own AudioRecorder — are live simultaneously. Only one iOS
// AVAudioSession exists; letting two recorders prepare/record at the same time
// leaves the session in a broken state where neither captures audio. This flag
// guarantees a single active recording at any moment across the whole screen.
let micRecordingActive = false;

/**
 * Normalise the two shapes the backend can send for a mic-state media:
 *
 *   simple  → MediaSpec       (source only — playback defaults)
 *   rich    → { source: MediaSpec, autoplay?, loop?, speed?, muted?,
 *              maxDurationMs?, tint?, playing?, onEnd? }
 *
 * `null` when the spec doesn't resolve, so callers can fall back to the
 * built-in Tailzu-mark → line morph.
 */
type MicMediaProps = {
  source: MediaSpec;
  autoplay?: boolean;
  loop?: boolean;
  speed?: number;
  muted?: boolean;
  maxDurationMs?: number;
  tint?: string;
  playing?: boolean;
  /**
   * True when the source freezes on its current frame while paused (video /
   * Lottie) rather than disappearing (GIF/APNG, which expo-image can only stop
   * by unmounting). When true we DON'T show the static idle mark — the frozen
   * frame itself is the idle state. Defaults false (GIF behavior).
   */
  freezeOnPause?: boolean;
  /** When true, this state's media fires the node's `onComplete` NodeEvent
   * on playback end. Wire an SDUI action tree in `on.onComplete` to react. */
  fireOnEnd?: boolean;
  /**
   * Voice-reactive playback. When true (default: false), the media's `speed`
   * is driven live by the recorder's audio level while recording, so the
   * animation gets faster when the user speaks louder and slower when they
   * whisper. Only meaningful during the "recording" state (idle state uses
   * `speed` as authored).
   *
   * NOTE: this is amplitude-driven, not fundamental-pitch. True pitch
   * detection needs FFT on raw PCM which expo-audio doesn't expose. For
   * mic-button viz effects, amplitude reads the same to the eye.
   *
   * Only Lottie + video/MP4 respect a live speed change — GIF/APNG can't be
   * retimed at the OS level, so those animations keep looping at their
   * baked-in rate regardless of this flag.
   */
  voiceReactive?: boolean;
  /** Speed multiplier bounds. Default [0.5, 2.0]. */
  speedRange?: [number, number];
  /** Level (dB) window that maps into speedRange. Default [-45, -5]. */
  levelRange?: [number, number];
  /** Attack/release smoothing 0…1 (default 0.7 — higher = more sluggish). */
  speedSmoothing?: number;
};

function normaliseMic(spec: unknown): MicMediaProps | null {
  if (!spec) return null;
  if (typeof spec === "string") return { source: spec };
  if (typeof spec === "object" && "source" in (spec as Record<string, unknown>)) {
    return spec as MicMediaProps;
  }
  // Old shape: raw MediaSpec object (has "key" / "url" / "asset" / "emoji" / "data").
  return { source: spec as MediaSpec };
}

function hasResolvableSource(spec: MediaSpec): boolean {
  return resolveMedia(spec).kind !== "empty";
}

/**
 * Map an audio level in dB (typically -160…0) into a normalized [0,1] where
 * 0 = quiet floor and 1 = loud ceiling of the supplied range. Values outside
 * are clamped so the derived speed never explodes.
 */
function levelToUnit(db: number, range: [number, number]): number {
  const [floor, ceil] = range;
  if (!Number.isFinite(db)) return 0;
  const t = (db - floor) / (ceil - floor);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ── VoiceToggle ──────────────────────────────────────────────────────────────
export const VoiceToggle = ({ node, props, store, fire }: CompProps) => {
  // Same preset as before but with metering explicitly on so we can read the
  // recorder's dB level in real time. HIGH_QUALITY leaves this off by default
  // — spreading it lets voice-reactive playback work without changing the
  // recording format the backend expects.
  const recorderPreset = useMemo(
    () => ({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }),
    [],
  );
  const recorder = useAudioRecorder(recorderPreset);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  // Live speed multiplier driven by mic level. Only used when
  // active.voiceReactive === true; otherwise the media plays at
  // active.speed (or 1).
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const voiceSpeedRef = useRef(1);
  const bindPath = node.bind?.value;
  const size = Number(props.size) || K.num("ui.VoiceToggle.size", 38);

  // Backend-supplied media for the idle and recording states. Each accepts
  // either a raw MediaSpec (media-store key / url / asset / emoji / data URI)
  // OR the rich `{ source, autoplay?, loop?, speed?, muted?, maxDurationMs?,
  // tint?, onEnd? }` shape that the MediaPlayer consumes. The rich form
  // covers Lottie / video / animated-image playback controls (loop timing,
  // speed, muted-autoplay, hard duration cap, action-on-end).
  //
  // Missing / empty spec → falls back to the built-in Tailzu-mark → line
  // morph so a fresh deploy without uploaded assets keeps rendering.
  const idleMic = normaliseMic(props.iconIdle ?? props.icon);
  const recordingMic = normaliseMic(props.iconRecording);
  const useCustomMedia = idleMic != null && hasResolvableSource(idleMic.source);
  const bg = String(props.background ?? K.color("ui.VoiceToggle.background", "#fff"));
  const contentScale = Number(props.contentScale) || K.num("ui.VoiceToggle.contentScale", 0.7);
  /** The meter: how often it is sampled, and the floor read when it is silent. */
  const meterMs = Number(props.meterIntervalMs ?? K.num("ui.VoiceToggle.meterIntervalMs", 33));
  const meterFloor = K.num("ui.VoiceToggle.meterFloorDb", -160);

  const collapse = useRef(new Animated.Value(0)).current; // 0 soundwave, 1 line
  const press = useRef(new Animated.Value(1)).current;
  const morphTo = useCallback((v: number) => Animated.spring(collapse, { toValue: v, ...spring() }).start(), [collapse]);

  // Pull config for the voice-reactive path off whichever media is currently
  // relevant (recording state — that's when the mic actually samples). Falls
  // back to sane defaults when the backend hasn't opted in.
  const activeReactive = recordingMic ?? idleMic;
  const voiceReactive = !!activeReactive?.voiceReactive;
  const speedRange = activeReactive?.speedRange ?? (K.list<number>("ui.VoiceToggle.speedRange", [0.5, 2.0]) as [number, number]);
  const levelRange = activeReactive?.levelRange ?? (K.list<number>("ui.VoiceToggle.levelRange", [-45, -5]) as [number, number]);
  const smoothing = Math.max(0, Math.min(0.98, activeReactive?.speedSmoothing ?? K.num("ui.VoiceToggle.speedSmoothing", 0.7)));

  // Poll the recorder's metering while recording — we sample at ~30Hz which
  // is plenty for a visible effect without churning the JS thread. The value
  // is smoothed via a one-pole IIR (attack/release lag) so a spike doesn't
  // yank the animation and a lull doesn't slam it to a halt.
  useEffect(() => {
    if (!recording || !voiceReactive) return;
    let alive = true;
    const [minS, maxS] = speedRange;
    const id = setInterval(() => {
      if (!alive) return;
      try {
        // expo-audio's getStatus returns metering only when
        // isMeteringEnabled was set on the preset (we do that above).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status: any = (recorder as any).getStatus?.();
        const db: number = typeof status?.metering === "number" ? status.metering : meterFloor;
        const t = levelToUnit(db, levelRange);
        const target = minS + t * (maxS - minS);
        const next = voiceSpeedRef.current * smoothing + target * (1 - smoothing);
        voiceSpeedRef.current = next;
        setVoiceSpeed(next);
      } catch {
        /* recorder unavailable — leave speed as-is */
      }
    }, meterMs);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, voiceReactive, recorder, speedRange[0], speedRange[1], levelRange[0], levelRange[1], smoothing, meterMs]);

  // When we leave recording, snap the speed back to the authored value so
  // the idle animation isn't stuck in whatever the last loud moment left.
  useEffect(() => {
    if (!recording) {
      voiceSpeedRef.current = 1;
      setVoiceSpeed(1);
    }
  }, [recording]);

  // Release the app-wide mic lock + stop the recorder if this toggle unmounts
  // mid-recording (tab switch, navigation, SDUI refetch). Without this the lock
  // stays `true` for the rest of the session → every VoiceToggle reports "busy"
  // and the mic is dead until app restart, and the AVAudioSession stays open.
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => () => {
    if (recordingRef.current) {
      micRecordingActive = false;
      recorder.stop().catch(() => {});
    }
  }, [recorder]);

  const errPermission = String(props.errorPermission ?? K.txt("ui.VoiceToggle.errorPermission", "Microphone permission denied"));
  const errMic = String(props.errorMic ?? K.txt("ui.VoiceToggle.errorMic", "mic error"));
  const errNoAudio = String(props.errorNoAudio ?? K.txt("ui.VoiceToggle.errorNoAudio", "No audio captured"));
  const errTranscribe = String(props.errorTranscribe ?? K.txt("ui.VoiceToggle.errorTranscribe", "transcription failed"));
  /** How a real error's own message is framed. {message} is the error's. */
  const errMicTemplate = String(props.errorMicTemplate ?? K.txt("ui.VoiceToggle.errorMicTemplate", "Mic error: {message}"));
  const errVoiceTemplate = String(props.errorVoiceTemplate ?? K.txt("ui.VoiceToggle.errorVoiceTemplate", "Voice error: {message}"));
  const frame = (tpl: string, message: string) => tpl.replace(/\{message\}/g, message);

  const errPermissionSettings = String(
    props.errorPermissionSettings ??
      K.txt("ui.VoiceToggle.errorPermissionSettings", "Microphone access is off. Turn it on in Settings › Tailzu › Microphone, then try again."),
  );
  const errMicBusy = String(props.errorMicBusy ?? K.txt("ui.VoiceToggle.errorMicBusy", "Already recording — finish that first."));

  const start = useCallback(async () => {
    // Another VoiceToggle on this screen is already recording — the Pager keeps
    // both pages mounted, so block the second one instead of corrupting the
    // shared audio session.
    if (micRecordingActive) { fire("onError", errMicBusy); return; }
    // Claim the app-wide lock SYNCHRONOUSLY, before any await — otherwise a
    // double-tap (or the two Pager-mounted VoiceToggles) both pass the guard
    // during the async permission/prepare window and both call record(),
    // corrupting the single shared AVAudioSession so neither captures audio.
    // Released on every early-return / catch below.
    micRecordingActive = true;
    try {
      // Check first: after a denial iOS never re-prompts, it just returns
      // `granted:false` silently. Distinguish "never asked" (prompt) from
      // "denied in Settings" (send them to Settings) so a stuck permission
      // stops looking like a network failure.
      let perm = await AudioModule.getRecordingPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (!perm.granted) {
        micRecordingActive = false;
        fire("onError", perm.canAskAgain ? errPermission : errPermissionSettings);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      store.set("recording", true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      morphTo(1);
    } catch (e: any) {
      // Surface the REAL error (not a generic "check your connection"), and
      // release the lock so the button isn't wedged after one failure.
      micRecordingActive = false;
      // eslint-disable-next-line no-console
      console.warn("[Tailzu][mic] start failed:", e);
      fire("onError", e?.message ? frame(errMicTemplate, String(e.message)) : errMic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, store, fire, morphTo, errPermission, errPermissionSettings, errMicBusy, errMic, errMicTemplate]);

  // autoStart — the keyboard's mic handoff.
  //
  // The user has already tapped a mic: the one in the keyboard, which cannot
  // record, so it opens the app instead. Asking them to tap a second mic to
  // say the thing they had already decided to say is the seam that makes the
  // handoff feel like a failure rather than a transition. The backend has been
  // sending `autoStart` on that screen since it was written, and nothing read
  // it.
  //
  // Guarded by a ref, not by the effect's deps: `start` is a useCallback whose
  // identity changes with the labels, and a second automatic recording is far
  // worse than none.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (props.autoStart !== true || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [props.autoStart, start]);

  const stop = useCallback(async () => {
    setRecording(false);
    store.set("recording", false);
    micRecordingActive = false;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    morphTo(0);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error(errNoAudio);
      const { cleanedText } = await api.transcribeClean(uri, { targetApp: props.targetApp, language: props.language });
      // Guard against overwriting the bound field with an empty transcript
      // (silent/short recording). Matches the RefineButton guard so the two
      // primary voice flows behave symmetrically.
      if (bindPath && cleanedText) store.set(bindPath, cleanedText);
      fire("onChange", cleanedText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn("[Tailzu][mic] stop/transcribe failed:", e);
      fire("onError", e?.message ? frame(errVoiceTemplate, String(e.message)) : errTranscribe);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, store, bindPath, props.targetApp, props.language, fire, morphTo, errNoAudio, errTranscribe, errVoiceTemplate]);

  // The morph's shape: where the mark has gone, how flat it squashes, where
  // the line appears and how short it starts — ui.VoiceToggle.morph.
  const M = K.obj("ui.VoiceToggle.morph", { markGoneAt: 0.7, markScaleY: 0.06, lineFrom: 0.5, lineScaleX: 0.2 });
  const markStyle = {
    opacity: collapse.interpolate({ inputRange: [0, M.markGoneAt, 1], outputRange: [1, 0, 0] }),
    transform: [{ scaleY: collapse.interpolate({ inputRange: [0, 1], outputRange: [1, M.markScaleY] }) }],
  };
  const lineStyle = {
    opacity: collapse.interpolate({ inputRange: [0, M.lineFrom, 1], outputRange: [0, 0, 1] }),
    transform: [{ scaleX: collapse.interpolate({ inputRange: [0, 1], outputRange: [M.lineScaleX, 1] }) }],
  };
  const line = {
    width: Number(props.lineWidth ?? K.num("ui.VoiceToggle.lineWidth", 0.5)),
    height: Number(props.lineHeight ?? K.num("ui.VoiceToggle.lineHeight", 2.6)),
    radius: Number(props.lineRadius ?? K.num("ui.VoiceToggle.lineRadius", 2)),
  };

  // Backend-supplied media path — swap the built-in mark → line morph for
  // the MediaPlayer, which renders image / GIF / APNG / Lottie / video from
  // one uniform spec, with backend-controlled playback (loop, speed, autoplay,
  // max duration, tint, muted, onEnd action).
  if (useCustomMedia) {
    // Two modes:
    //   two-media   → iconIdle + iconRecording point to different sources.
    //                 We swap between them on state change (existing behavior).
    //   one-media   → only iconIdle is supplied. We render the same source in
    //                 both states and auto-bind `playing = recording`, so
    //                 tap → play, tap → stop. For GIF/APNG, MediaPlayer
    //                 unmounts the image when playing=false, so we render the
    //                 built-in tailzu-mark as the idle placeholder underneath.
    const active = (recording && recordingMic) ? recordingMic : idleMic!;
    // The decided interaction: the media sits VISIBLE + PAUSED by default and
    // plays ONLY while recording — tap → play, tap → pause. Play is tied purely
    // to the mic state; we intentionally IGNORE any backend `playing`/`autoplay`
    // so a media spec can never make it auto-loop at idle (that was the "it's
    // always playing" bug). A freeze-capable source (MP4 / Lottie) holds a still
    // frame while paused; a GIF/APNG can't be frozen by iOS.
    const renderPlaying = recording;
    // Fire the node's onComplete NodeEvent when playback ends, so backend can
    // wire any action tree via on.onComplete on the VoiceToggle node.
    const handleEnd = active.fireOnEnd
      ? () => fire("onComplete", { state: recording ? "recording" : "idle" })
      : undefined;
    return (
      <Pressable
        onPressIn={() => Animated.spring(press, pressDown(Number(props.mediaPressScale ?? K.num("ui.VoiceToggle.mediaPressScale", 0.9)))).start()}
        onPressOut={() => Animated.spring(press, pressUp()).start()}
        onPress={() => (recording ? stop() : start())}
        disabled={busy}
      >
        <Animated.View
          style={[
            // Round button — borderRadius + overflow clips the media into a
            // circle; bg shows through when a paused source has unmounted.
            { width: size, height: size, borderRadius: size / 2, backgroundColor: bg,
              alignItems: "center", justifyContent: "center", overflow: "hidden" },
            { transform: [{ scale: press }] },
          ]}
        >
          <MediaPlayer
            spec={active.source}
            style={{ width: size, height: size }}
            contentFit="contain"
            tintColor={active.tint}
            // Never auto-play — the media is paused by default and only plays
            // via `playing` (= recording). This is the belt to the `playing`
            // braces so no backend spec can start it looping on mount.
            autoplay={false}
            loop={active.loop}
            speed={
              recording && voiceReactive
                ? voiceSpeed
                : (active.speed ?? 1)
            }
            muted={active.muted}
            maxDurationMs={active.maxDurationMs}
            playing={renderPlaying}
            onEnd={handleEnd}
          />
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPressIn={() => Animated.spring(press, pressDown(Number(props.pressScale ?? K.num("ui.VoiceToggle.pressScale", 0.88)))).start()}
      onPressOut={() => Animated.spring(press, pressUp()).start()}
      onPress={() => (recording ? stop() : start())}
      disabled={busy}
    >
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
          { transform: [{ scale: press }] },
        ]}
      >
        <Animated.Image source={MARK} resizeMode="contain" style={[{ width: size * contentScale, height: size * contentScale, position: "absolute" }, markStyle]} />
        <Animated.View style={[{ position: "absolute", width: size * line.width, height: line.height, borderRadius: line.radius, backgroundColor: String(props.lineColor ?? K.color("ui.VoiceToggle.lineColor", "#000")) }, lineStyle]} />
      </Animated.View>
    </Pressable>
  );
};

// ── Shared morphing button ───────────────────────────────────────────────────
/** The pad's line: how many points, how wide a share of the pad, how tall,
 *  and the zig-zag's irregularity — ui.MorphPad.shape. */
type PadShape = { points: number; widthShare: number; amp: number; zigBase: number; zigVary: number; zigFreq: number };
const padShape = (): PadShape => K.obj("ui.MorphPad.shape", {
  points: 26, widthShare: 0.42, amp: 8, zigBase: 0.55, zigVary: 0.45, zigFreq: 1.9
});

/** SVG path for the morph: m = 0 zig-zag → 1 wave, f = 0 normal → 1 line. */
function shapePath(W: number, H: number, m: number, f: number, S: PadShape): string {
  const N = Math.max(2, Math.round(S.points));
  const pathW = W * S.widthShare;
  const cx = W / 2, cy = H / 2, half = pathW / 2, amp = S.amp;
  let d = "";
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = cx - half + t * pathW;
    const zig = (i % 2 === 0 ? -1 : 1) * amp * (S.zigBase + S.zigVary * Math.sin(i * S.zigFreq));
    const wave = Math.sin(t * Math.PI * 2) * amp;
    const y = cy + ((1 - m) * zig + m * wave) * (1 - f);
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function MorphPad({
  width: W, height: H, working, recording, onPress, disabled, bg, stroke,
}: { width: number; height: number; working: boolean; recording: boolean; onPress: () => void; disabled: boolean; bg?: string; stroke?: string }) {
  const morph = useRef(new Animated.Value(0)).current; // 0 zig-zag, 1 wave
  const flat = useRef(new Animated.Value(0)).current;   // 0 normal, 1 line
  const press = useRef(new Animated.Value(1)).current;
  const pathRef = useRef<any>(null);
  const mRef = useRef(0);
  const fRef = useRef(0);
  const S = padShape();
  const shapeKey = JSON.stringify(S);
  const sRef = useRef(S);
  sRef.current = S;

  const redraw = useCallback(() => {
    pathRef.current?.setNativeProps?.({ d: shapePath(W, H, mRef.current, fRef.current, sRef.current) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, shapeKey]);

  useEffect(() => {
    const idM = morph.addListener(({ value }) => { mRef.current = value; redraw(); });
    const idF = flat.addListener(({ value }) => { fRef.current = value; redraw(); });
    redraw();
    return () => { morph.removeListener(idM); flat.removeListener(idF); };
  }, [morph, flat, redraw]);

  useEffect(() => {
    Animated.spring(morph, {
      toValue: working ? 1 : 0,
      friction: K.num("ui.MorphPad.morphFriction", 8), tension: K.num("ui.MorphPad.morphTension", 120),
      useNativeDriver: false,
    }).start();
  }, [working, morph]);
  useEffect(() => {
    Animated.spring(flat, {
      toValue: recording ? 1 : 0,
      friction: K.num("ui.MorphPad.flatFriction", 8), tension: K.num("ui.MorphPad.flatTension", 140),
      useNativeDriver: false,
    }).start();
  }, [recording, flat]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialD = useMemo(() => shapePath(W, H, 0, 0, sRef.current), [W, H, shapeKey]);

  return (
    <Pressable
      onPressIn={() => { if (!disabled) Animated.spring(press, pressDown(K.num("ui.MorphPad.pressScale", 0.94))).start(); }}
      onPressOut={() => Animated.spring(press, pressUp()).start()}
      onPress={onPress}
    >
      <Animated.View
        style={[
          { width: W, height: H, borderRadius: H / 2, backgroundColor: bg ?? K.color("ui.MorphPad.background", "#fff"), alignItems: "center", justifyContent: "center" },
          { transform: [{ scale: press }] },
        ]}
      >
        <Svg width={W} height={H}>
          <Path ref={pathRef} d={initialD} stroke={stroke ?? K.color("ui.MorphPad.stroke", "#000")} strokeWidth={K.num("ui.MorphPad.strokeWidth", 2.6)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

// ── RefineButton — polishes the bound field in place via /v1/refine ───────────
export const RefineButton = ({ node, props, store, fire }: CompProps) => {
  useStoreVersion(store);
  const recording = !!store.get("recording");
  const bindPath = node.bind?.value;
  const [working, setWorking] = useState(false);
  const W = Number(props.width) || K.num("ui.RefineButton.width", 150);
  const H = Number(props.height) || K.num("ui.RefineButton.height", 50);
  const label = String(props.label ?? K.txt("ui.RefineButton.label", "Refine"));

  const errEmpty = String(props.errorEmpty ?? K.txt("ui.RefineButton.errorEmpty", "Type or speak something first"));
  const errFail = String(props.errorFail ?? K.txt("ui.RefineButton.errorFail", "refine failed"));

  /**
   * The suction, as numbers — how small the word shrinks, how long it takes
   * to go and come back, how deep it sinks, how the working dot breathes.
   * ui.RefineButton.motion, with the node's `motion` over it.
   */
  const A = {
    ...K.obj("ui.RefineButton.motion", {
      suckScale: 0.08, suckMs: 260, fadeMs: 230, sinkMs: 260, sink: 0.34,
      dotInMs: 160, dotLow: 0.35, dotBeatMs: 520, dotOutMs: 120,
      backFriction: 6, backTension: 150, backFadeMs: 240
    }),
    ...(props.motion ?? {}),
  };
  const aRef = useRef(A);
  aRef.current = A;

  // Suction physics: on press the "Refine" text is SUCKED into the button —
  // scaling to a point, sinking down, and fading; while the backend refines, a
  // small pulse sits where it vanished; when the refined text arrives it springs
  // back out (reverse suction). All native-driver so it stays 60fps.
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const sink = useRef(new Animated.Value(0)).current;   // 0 = at rest, 1 = sunk into the button
  const dot = useRef(new Animated.Value(0)).current;    // working pulse
  const pulse = useRef<Animated.CompositeAnimation | null>(null);

  const suckIn = useCallback(() => {
    const a = aRef.current;
    Animated.parallel([
      Animated.timing(scale, { toValue: Number(a.suckScale), duration: Number(a.suckMs), easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: Number(a.fadeMs), easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(sink, { toValue: 1, duration: Number(a.sinkMs), easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      Animated.timing(dot, { toValue: 1, duration: Number(a.dotInMs), useNativeDriver: true }).start();
      pulse.current = Animated.loop(Animated.sequence([
        Animated.timing(dot, { toValue: Number(a.dotLow), duration: Number(a.dotBeatMs), easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(dot, { toValue: 1, duration: Number(a.dotBeatMs), easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      pulse.current.start();
    });
  }, [scale, opacity, sink, dot]);

  const springBack = useCallback(() => {
    const a = aRef.current;
    pulse.current?.stop();
    Animated.timing(dot, { toValue: 0, duration: Number(a.dotOutMs), useNativeDriver: true }).start();
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: Number(a.backFriction), tension: Number(a.backTension), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: Number(a.backFadeMs), easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(sink, { toValue: 0, friction: Number(a.backFriction), tension: Number(a.backTension), useNativeDriver: true }),
    ]).start();
  }, [scale, opacity, sink, dot]);

  const onPress = useCallback(async () => {
    if (recording || working) return;
    const text = (bindPath ? store.get(bindPath) : "") || "";
    if (!String(text).trim()) { fire("onError", errEmpty); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setWorking(true);
    suckIn();
    try {
      // Refine the CURRENT box text in the selected tone — press again to refine
      // the result further (iterate until happy).
      const { refinedText } = await api.refine(String(text), {
        targetApp: props.targetApp, language: props.language, tone: props.tone,
      });
      if (bindPath && refinedText) store.set(bindPath, refinedText);
      fire("onChange", refinedText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      fire("onError", e?.message ?? errFail);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setWorking(false);
      springBack();
    }
  }, [recording, working, bindPath, store, props.targetApp, props.language, props.tone, fire, errEmpty, errFail, suckIn, springBack]);

  const translateY = sink.interpolate({ inputRange: [0, 1], outputRange: [0, H * Number(A.sink)] });
  const bg = String(props.bg ?? K.color("ui.RefineButton.background", "#FFFFFF"));
  const labelColor = String(props.labelColor ?? K.color("ui.RefineButton.labelColor", "#000000"));
  const dotColor = String(props.dotColor ?? K.color("ui.RefineButton.dotColor", "#000000"));
  const dotSize = Number(props.dotSize ?? K.num("ui.RefineButton.dotSize", 7));

  return (
    <Pressable
      onPress={onPress}
      disabled={recording || working}
      style={{ width: W, height: H, borderRadius: H / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
    >
      <Animated.Text
        style={{
          color: labelColor,
          fontWeight: String(props.fontWeight ?? K.str("ui.RefineButton.fontWeight", "700")) as "700",
          fontSize: Number(props.fontSize ?? K.num("ui.RefineButton.fontSize", 16)),
          letterSpacing: Number(props.tracking ?? K.num("ui.RefineButton.tracking", 0.5)),
          ...(props.fontFamily ? { fontFamily: String(props.fontFamily) } : null),
          opacity, transform: [{ scale }, { translateY }],
        }}
      >
        {label}
      </Animated.Text>
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: dotColor, opacity: dot, transform: [{ scale: dot }] }}
      />
    </Pressable>
  );
};

// ── DraftButton — composes a reply via /v1/draft (message + intent → result) ──
export const DraftButton = ({ node, props, store, fire }: CompProps) => {
  useStoreVersion(store);
  const recording = !!store.get("recording");
  const msgKey = props.messageKey || "screenContent";
  const intentKey = node.bind?.value || props.intentKey || "intent";
  const resultKey = props.resultKey || "result";
  const [working, setWorking] = useState(false);
  const W = Number(props.width) || K.num("ui.DraftButton.width", 150);
  const H = Number(props.height) || K.num("ui.DraftButton.height", 50);

  const errEmpty = String(props.errorEmpty ?? K.txt("ui.DraftButton.errorEmpty", "Paste a message and say your intent"));
  const errFail = String(props.errorFail ?? K.txt("ui.DraftButton.errorFail", "draft failed"));

  const onPress = useCallback(async () => {
    if (recording || working) return;
    const message = String(store.get(msgKey) || "");
    const intent = String(store.get(intentKey) || "");
    if (!message.trim() || !intent.trim()) { fire("onError", errEmpty); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setWorking(true);
    try {
      const { draftText } = await api.draft(message, intent, { targetApp: props.targetApp, language: props.language });
      store.set(resultKey, draftText);
      fire("onChange", draftText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      fire("onError", e?.message ?? errFail);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setWorking(false);
    }
  }, [recording, working, msgKey, intentKey, resultKey, store, props.targetApp, props.language, fire, errEmpty, errFail]);

  return <MorphPad width={W} height={H} working={working} recording={recording} onPress={onPress} disabled={recording || working} bg={props.bg} stroke={props.stroke} />;
};
