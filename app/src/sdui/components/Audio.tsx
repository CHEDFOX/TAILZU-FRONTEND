/**
 * Audio: a sound the server names, played by expo-audio (pure/SPEC.md 2.10, B10).
 *
 * It draws nothing of its own. Whatever the node holds is its face — a Button the server bound to `state.playing`, a
 * Text bound to `state.at` — and this node is the player behind it: it follows the `playing` prop, and it writes
 * where it is into the state paths the node names (`into: { playing, time, duration, progress, ended }`).
 *
 * Which means a player with a scrubber, a time, a title and a pause button is a screen, not an app update.
 */
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import type { CompProps } from "./props";
import { useV3Host } from "./v3Host";
import { clampRate, clampVolume, mediaInto, mediaUrl, statusWrites, type MediaStatus } from "./mediaCore";

export const AudioNode = ({ props, style, children, fire }: CompProps) => {
  const host = useV3Host();
  const url = mediaUrl(props.source ?? props.url ?? props.uri);
  const player = useAudioPlayer(url ?? null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!url) return;
    try {
      player.loop = props.loop === true;
      player.muted = props.muted === true;
      player.volume = clampVolume(props.volume);
      player.playbackRate = clampRate(props.rate);
    } catch { /* a player released under us is not an error worth a screen */ }
  }, [player, url, props.loop, props.muted, props.volume, props.rate]);

  // Play and pause follow the resolved prop, so the screen's own button drives it.
  useEffect(() => {
    if (!url) return;
    try {
      if (props.playing === true && !status.playing) player.play();
      if (props.playing === false && status.playing) player.pause();
    } catch { /* same */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, props.playing, status.playing]);

  const into = mediaInto(props.into);
  const was = useRef<MediaStatus | null>(null);
  useEffect(() => {
    if (!url || !host) return;
    const now: MediaStatus = {
      playing: status.playing === true,
      time: Number(status.currentTime) || 0,
      duration: Number(status.duration) || 0,
      ended: status.didJustFinish === true,
      loading: status.isBuffering === true || status.isLoaded === false,
    };
    for (const [path, value] of statusWrites(into, was.current, now)) host.setState(path, value);
    if (now.ended && !(was.current?.ended ?? false)) fire("onComplete", { time: now.time });
    was.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, host, status.playing, status.currentTime, status.duration, status.didJustFinish, status.isBuffering, status.isLoaded]);

  return <View style={style}>{children}</View>;
};
