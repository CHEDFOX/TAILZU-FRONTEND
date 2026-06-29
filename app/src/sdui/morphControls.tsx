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
import { Animated, Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import * as api from "../api";
import type { CompProps } from "./components";
import { useStoreVersion } from "./state";

const MARK = require("../../assets/tailzu-mark.png");
const SPRING = { friction: 7, tension: 120, useNativeDriver: true };

// ── VoiceToggle ──────────────────────────────────────────────────────────────
export const VoiceToggle = ({ node, props, store, fire }: CompProps) => {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const bindPath = node.bind?.value;
  const size = Number(props.size) || 38;

  const collapse = useRef(new Animated.Value(0)).current; // 0 soundwave, 1 line
  const press = useRef(new Animated.Value(1)).current;
  const morphTo = useCallback((v: number) => Animated.spring(collapse, { toValue: v, ...SPRING }).start(), [collapse]);

  const start = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { fire("onError", "Microphone permission denied"); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      store.set("recording", true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      morphTo(1);
    } catch (e: any) {
      fire("onError", e?.message ?? "mic error");
    }
  }, [recorder, store, fire, morphTo]);

  const stop = useCallback(async () => {
    setRecording(false);
    store.set("recording", false);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    morphTo(0);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No audio captured");
      const { cleanedText } = await api.transcribeClean(uri, { targetApp: props.targetApp, language: props.language });
      if (bindPath) store.set(bindPath, cleanedText);
      fire("onChange", cleanedText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      fire("onError", e?.message ?? "transcription failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [recorder, store, bindPath, props.targetApp, props.language, fire, morphTo]);

  const markStyle = {
    opacity: collapse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0, 0] }),
    transform: [{ scaleY: collapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.06] }) }],
  };
  const lineStyle = {
    opacity: collapse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
    transform: [{ scaleX: collapse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
  };

  return (
    <Pressable
      onPressIn={() => Animated.spring(press, { toValue: 0.88, friction: 8, tension: 300, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 1, friction: 6, tension: 220, useNativeDriver: true }).start()}
      onPress={() => (recording ? stop() : start())}
      disabled={busy}
    >
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden" },
          { transform: [{ scale: press }] },
        ]}
      >
        <Animated.Image source={MARK} resizeMode="contain" style={[{ width: size * 0.7, height: size * 0.7, position: "absolute" }, markStyle]} />
        <Animated.View style={[{ position: "absolute", width: size * 0.5, height: 2.6, borderRadius: 2, backgroundColor: "#000" }, lineStyle]} />
      </Animated.View>
    </Pressable>
  );
};

// ── Shared morphing button ───────────────────────────────────────────────────
const N = 26;

/** SVG path for the morph: m = 0 zig-zag → 1 wave, f = 0 normal → 1 line. */
function shapePath(W: number, H: number, m: number, f: number): string {
  const pathW = W * 0.42;
  const cx = W / 2, cy = H / 2, half = pathW / 2, amp = 8;
  let d = "";
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = cx - half + t * pathW;
    const zig = (i % 2 === 0 ? -1 : 1) * amp * (0.55 + 0.45 * Math.sin(i * 1.9));
    const wave = Math.sin(t * Math.PI * 2) * amp;
    const y = cy + ((1 - m) * zig + m * wave) * (1 - f);
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function MorphPad({
  width: W, height: H, working, recording, onPress, disabled,
}: { width: number; height: number; working: boolean; recording: boolean; onPress: () => void; disabled: boolean }) {
  const morph = useRef(new Animated.Value(0)).current; // 0 zig-zag, 1 wave
  const flat = useRef(new Animated.Value(0)).current;   // 0 normal, 1 line
  const press = useRef(new Animated.Value(1)).current;
  const pathRef = useRef<any>(null);
  const mRef = useRef(0);
  const fRef = useRef(0);

  const redraw = useCallback(() => {
    pathRef.current?.setNativeProps?.({ d: shapePath(W, H, mRef.current, fRef.current) });
  }, [W, H]);

  useEffect(() => {
    const idM = morph.addListener(({ value }) => { mRef.current = value; redraw(); });
    const idF = flat.addListener(({ value }) => { fRef.current = value; redraw(); });
    redraw();
    return () => { morph.removeListener(idM); flat.removeListener(idF); };
  }, [morph, flat, redraw]);

  useEffect(() => {
    Animated.spring(morph, { toValue: working ? 1 : 0, friction: 8, tension: 120, useNativeDriver: false }).start();
  }, [working, morph]);
  useEffect(() => {
    Animated.spring(flat, { toValue: recording ? 1 : 0, friction: 8, tension: 140, useNativeDriver: false }).start();
  }, [recording, flat]);

  const initialD = useMemo(() => shapePath(W, H, 0, 0), [W, H]);

  return (
    <Pressable
      onPressIn={() => { if (!disabled) Animated.spring(press, { toValue: 0.94, friction: 8, tension: 300, useNativeDriver: true }).start(); }}
      onPressOut={() => Animated.spring(press, { toValue: 1, friction: 6, tension: 220, useNativeDriver: true }).start()}
      onPress={onPress}
    >
      <Animated.View
        style={[
          { width: W, height: H, borderRadius: H / 2, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
          { transform: [{ scale: press }] },
        ]}
      >
        <Svg width={W} height={H}>
          <Path ref={pathRef} d={initialD} stroke="#000" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
  const W = Number(props.width) || 150;
  const H = Number(props.height) || 50;

  const onPress = useCallback(async () => {
    if (recording || working) return;
    const text = (bindPath ? store.get(bindPath) : "") || "";
    if (!String(text).trim()) { fire("onError", "Type or speak something first"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setWorking(true);
    try {
      const { refinedText } = await api.refine(String(text), { targetApp: props.targetApp, language: props.language });
      if (bindPath && refinedText) store.set(bindPath, refinedText);
      fire("onChange", refinedText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      fire("onError", e?.message ?? "refine failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setWorking(false);
    }
  }, [recording, working, bindPath, store, props.targetApp, props.language, fire]);

  return <MorphPad width={W} height={H} working={working} recording={recording} onPress={onPress} disabled={recording || working} />;
};

// ── DraftButton — composes a reply via /v1/draft (message + intent → result) ──
export const DraftButton = ({ node, props, store, fire }: CompProps) => {
  useStoreVersion(store);
  const recording = !!store.get("recording");
  const msgKey = props.messageKey || "screenContent";
  const intentKey = node.bind?.value || props.intentKey || "intent";
  const resultKey = props.resultKey || "result";
  const [working, setWorking] = useState(false);
  const W = Number(props.width) || 150;
  const H = Number(props.height) || 50;

  const onPress = useCallback(async () => {
    if (recording || working) return;
    const message = String(store.get(msgKey) || "");
    const intent = String(store.get(intentKey) || "");
    if (!message.trim() || !intent.trim()) { fire("onError", "Paste a message and say your intent"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setWorking(true);
    try {
      const { draftText } = await api.draft(message, intent, { targetApp: props.targetApp, language: props.language });
      store.set(resultKey, draftText);
      fire("onChange", draftText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      fire("onError", e?.message ?? "draft failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setWorking(false);
    }
  }, [recording, working, msgKey, intentKey, resultKey, store, props.targetApp, props.language, fire]);

  return <MorphPad width={W} height={H} working={working} recording={recording} onPress={onPress} disabled={recording || working} />;
};
