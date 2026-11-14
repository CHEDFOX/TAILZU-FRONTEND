/**
 * Video: a clip the server names, played by expo-video (pure/SPEC.md 2.10, B10).
 *
 * The library is already in the binary and had no node, so a clip on a screen meant an app update. Here it is data:
 * a source, how it fills its box, whether it loops, and a set of state paths the player writes what it is doing into
 * (`into: { playing, time, duration, progress, ended }`), so the screen's own rules and text can react to it with no
 * further app code.
 *
 * The source is https only (mediaCore.mediaUrl): a clip is fetched by the OS media stack, outside our client, so a
 * plain http URL would be an unencrypted request made by the app, and a `file://` from a server would be the server
 * reading this phone's disk.
 */
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { CompProps } from "./props";
import { useV3Host } from "./v3Host";
import { clampRate, clampVolume, contentFit, mediaInto, mediaUrl, statusWrites, tickMs, type MediaStatus } from "./mediaCore";

export const Video = ({ props, style, children, fire }: CompProps) => {
  const host = useV3Host();
  const url = mediaUrl(props.source ?? props.url ?? props.uri);
  const loop = props.loop === true;
  const muted = props.muted === true;
  const player = useVideoPlayer(url, (p) => {
    p.loop = loop;
    p.muted = muted;
    p.volume = clampVolume(props.volume);
    p.playbackRate = clampRate(props.rate);
    if (props.autoplay === true) p.play();
  });

  // Play and pause follow the resolved prop, so a screen drives the clip from its own state (bind: { playing: … }).
  useEffect(() => {
    if (!player || !url) return;
    try {
      if (props.playing === true && !player.playing) player.play();
      if (props.playing === false && player.playing) player.pause();
    } catch { /* a player released under us is not an error worth a screen */ }
  }, [player, url, props.playing]);

  useEffect(() => {
    if (!player || !url) return;
    try {
      player.loop = loop;
      player.muted = muted;
      player.volume = clampVolume(props.volume);
      player.playbackRate = clampRate(props.rate);
    } catch { /* same */ }
  }, [player, url, loop, muted, props.volume, props.rate]);

  // WHAT IT IS DOING, INTO THE STORE — read on a tick rather than per frame, and written only where it changed
  // (mediaCore.statusWrites). A clip that is paused writes nothing at all.
  const into = mediaInto(props.into);
  const was = useRef<MediaStatus | null>(null);
  const wrote = useRef(false);
  useEffect(() => {
    if (!player || !url || !host) return;
    const every = tickMs(props.tickMs);
    const read = () => {
      let now: MediaStatus;
      try {
        now = {
          playing: player.playing === true,
          time: Number(player.currentTime) || 0,
          duration: Number(player.duration) || 0,
          ended: Number(player.duration) > 0 && Number(player.currentTime) >= Number(player.duration) - 0.05,
          loading: player.status === "loading",
        };
      } catch { return; }
      for (const [path, value] of statusWrites(into, was.current, now)) host.setState(path, value);
      if (now.ended && !(was.current?.ended ?? false) && wrote.current) fire("onComplete", { time: now.time });
      if (was.current && was.current.playing !== now.playing) fire("onChange", { playing: now.playing, time: now.time });
      was.current = now;
      wrote.current = true;
    };
    read();
    const t = setInterval(read, every);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, url, host, props.into, props.tickMs]);

  // No source the player may load: whatever the node holds (a poster, a line of text), or nothing.
  if (!url) return <View style={style}>{children}</View>;

  return (
    <VideoView
      player={player}
      style={style}
      contentFit={contentFit(props.contentFit)}
      nativeControls={props.controls !== false}
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: props.fullscreen !== false }}
      onFirstFrameRender={() => fire("onResult", { ready: true })}
    />
  );
};
