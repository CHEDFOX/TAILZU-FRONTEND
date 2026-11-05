/**
 * LiveWords — the words of the voice session open on this screen, as they are heard (types.ts LiveWordsProps, component
 * "LiveWords"): the newest light grey, each settling to ink over `settleMs`; a word the stream corrects is born again. Only
 * the words: no placeholder, no caret, no button, no label (the owner's spec for listening). Empty between turns.
 *
 * The words come from the voice bus (voice/voiceBus.ts), not the screen's state, so a partial redraws this node and
 * nothing else.
 *
 *   { type: "LiveWords", props: { size, lineHeight, fontFamily, color?, freshColor?, settleMs? } }
 */
import React, { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import * as K from "../knobs";
import type { CompProps } from "./props";
import { onVoiceWords, voiceWords } from "../voice/voiceBus";
import { LiveWordsTrack, mixColor } from "./liveWordsCore";

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const LiveWords = ({ props, store, style }: CompProps): React.ReactElement => {
  const size = Number(props?.size) || 16;
  const lineHeight = Number(props?.lineHeight) || 22;
  const face = typeof props?.fontFamily === "string" && props.fontFamily ? props.fontFamily : "Tailzu Geist";
  const ink = typeof props?.color === "string" ? props.color : "#0a0a0a";
  const fresh = typeof props?.freshColor === "string" ? props.freshColor : "#b5b5b5";
  const settleMs = Number(props?.settleMs) > 0 ? Number(props.settleMs) : K.num("ui.LiveWords.settleMs", 600);
  const track = useRef(new LiveWordsTrack());
  const [, redraw] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const settle = () => {
      // While a word is still settling, a few redraws a second carry its colour to ink; then nothing runs.
      if (timer || track.current.settled(now(), settleMs)) return;
      timer = setInterval(() => {
        redraw((n) => n + 1);
        if (track.current.settled(now(), settleMs) && timer) { clearInterval(timer); timer = null; }
      }, K.num("ui.LiveWords.tickMs", 50));
    };
    const take = () => { track.current.update(voiceWords(store), now()); redraw((n) => n + 1); settle(); };
    take();
    const off = onVoiceWords(store, take);
    return () => { off(); if (timer) clearInterval(timer); };
  }, [store, settleMs]);
  const t = now();
  const words = track.current.words;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[{ fontSize: size, lineHeight, minHeight: lineHeight, fontFamily: face, fontWeight: "normal", color: ink }, style]}
    >
      {words.map((w, i) => (
        <Text key={i} style={{ color: mixColor(fresh, ink, track.current.k(i, t, settleMs)) }}>
          {i < words.length - 1 ? `${w.text} ` : w.text}
        </Text>
      ))}
    </Text>
  );
};
