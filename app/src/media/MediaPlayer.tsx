/**
 * MediaPlayer — one component that renders any backend-supplied media with
 * uniform playback controls.
 *
 * Supported source types (auto-detected by content-type or extension):
 *   • static image  → PNG, JPG, WebP, SVG   (expo-image)
 *   • animated img  → GIF, APNG              (expo-image plays natively)
 *   • Lottie        → JSON                   (lottie-react-native)
 *   • video         → MP4, MOV, WebM         (expo-video, muted by default so
 *                                              autoplay isn't blocked)
 *   • emoji         → glyph                  (Text)
 *
 * Backend playback controls (all optional, sensible defaults for each type):
 *   autoplay        — start immediately on mount (default true for animatable
 *                     sources; irrelevant for static images).
 *   loop            — repeat forever (default true for animations, false for
 *                     Lottie one-shots when explicitly set).
 *   speed           — playback rate multiplier (Lottie + video).
 *   muted           — video only; default true so autoplay works inside a
 *                     silent phone / silent app.
 *   maxDurationMs   — hard cap; stops playback after N ms even if the file
 *                     hasn't reached its natural end. Useful for "flash this
 *                     animation for 2s then freeze on the last frame".
 *   tint            — color tint applied to bundled + template PNGs; no-op
 *                     for full-color URL assets.
 *   playing         — controlled play flag. When set, overrides autoplay:
 *                     true → play, false → pause. Lets backend drive
 *                     start/stop from state (e.g. `bind: "recording"`).
 *   onEnd           — SDUI action ref fired when playback completes the last
 *                     loop, or when maxDurationMs elapses (fired via `fire`).
 *
 * The player always renders SOMETHING when the spec resolves — for missing
 * assets it returns null so the caller's fallback path takes over.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image as RNImage, Text, View, StyleProp, TextStyle, ImageStyle, ViewStyle } from "react-native";
import { Image as ExpoImage, ImageContentFit } from "expo-image";
import { resolveMedia, MediaSpec } from "./resolveMedia";

// Lottie + video are heavy — require them lazily so a bundle that never plays
// either type doesn't pay the cost. `require` is used instead of `import`
// so TypeScript doesn't hard-fail during the pre-install `tsc --noEmit`
// check even if the package isn't installed yet (both are in package.json).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LottieView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  LottieView = require("lottie-react-native").default ?? require("lottie-react-native");
} catch { /* module absent (Expo Go) */ }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ExpoVideo: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let useVideoPlayer: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v = require("expo-video");
  ExpoVideo = v.VideoView;
  useVideoPlayer = v.useVideoPlayer;
} catch { /* module absent (Expo Go) */ }

export type MediaFire = (eventName: string, payload?: unknown) => void;

type Props = {
  spec: MediaSpec | null | undefined;
  style?: StyleProp<ImageStyle | ViewStyle>;
  contentFit?: ImageContentFit;
  tintColor?: string;
  /** Backend-supplied playback controls (see file-level doc). */
  autoplay?: boolean;
  loop?: boolean;
  speed?: number;
  muted?: boolean;
  maxDurationMs?: number;
  /** Controlled play flag — overrides autoplay when defined. */
  playing?: boolean;
  /** Fire an SDUI event when playback ends (or maxDurationMs elapses). */
  onEnd?: () => void;
  testID?: string;
  accessibilityLabel?: string;
};

type MediaKind = "image" | "lottie" | "video" | "emoji" | "unknown";

function classify(uri: string, contentType?: string): MediaKind {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("application/json") || ct.includes("lottie")) return "lottie";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/")) return "image";
  const lower = uri.toLowerCase();
  if (lower.endsWith(".json") || lower.includes("lottie")) return "lottie";
  if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(lower)) return "video";
  if (/\.(png|jpe?g|webp|gif|apng|svg|heic|heif)(\?|$)/i.test(lower)) return "image";
  return "image"; // default — expo-image will handle most and log its own error
}

export function MediaPlayer(p: Props): React.ReactElement | null {
  const {
    spec, style, contentFit = "contain", tintColor,
    autoplay = true, loop = true, speed = 1, muted = true,
    maxDurationMs, playing, onEnd,
    testID, accessibilityLabel,
  } = p;
  const resolved = useMemo(() => resolveMedia(spec), [spec]);

  // Whether the caller controls play/pause explicitly, versus falling back
  // to autoplay-on-mount.
  const shouldPlay = playing != null ? playing : autoplay;

  // Hard max-duration cap — fires onEnd (if provided) after maxDurationMs
  // whether or not the source has looped that many times.
  useEffect(() => {
    if (!maxDurationMs || !shouldPlay) return;
    const id = setTimeout(() => { onEnd?.(); }, maxDurationMs);
    return () => clearTimeout(id);
  }, [maxDurationMs, shouldPlay, onEnd]);

  if (resolved.kind === "empty") return null;

  if (resolved.kind === "emoji") {
    return (
      <Text style={style as StyleProp<TextStyle>} testID={testID} accessibilityLabel={accessibilityLabel}>
        {resolved.glyph}
      </Text>
    );
  }

  if (resolved.kind === "bundled") {
    return (
      <RNImage
        source={resolved.source}
        style={style as StyleProp<ImageStyle>}
        resizeMode={contentFit === "contain" ? "contain" : contentFit === "cover" ? "cover" : "stretch"}
        tintColor={tintColor}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  const uri = resolved.uri;
  const kind = classify(uri, resolved.contentType);

  if (kind === "lottie" && LottieView) {
    return (
      <LottiePlayerInner
        uri={uri}
        style={style}
        contentFit={contentFit}
        shouldPlay={shouldPlay}
        loop={loop}
        speed={speed}
        onEnd={onEnd}
        testID={testID}
      />
    );
  }

  if (kind === "video" && ExpoVideo && useVideoPlayer) {
    return (
      <VideoPlayerInner
        uri={uri}
        style={style}
        contentFit={contentFit}
        shouldPlay={shouldPlay}
        loop={loop}
        speed={speed}
        muted={muted}
        onEnd={onEnd}
        testID={testID}
      />
    );
  }

  // Fallback: static or animated image. expo-image plays GIF / APNG natively
  // and has no runtime pause API — so when the caller explicitly sets
  // `playing = false` on an animated format, we unmount the image so the
  // animation visually stops. Static formats keep rendering (there's nothing
  // to pause on a PNG).
  const isAnimatedFormat = /\.(gif|apng|webp)(\?|$)/i.test(uri.toLowerCase());
  if (playing === false && isAnimatedFormat) return null;
  return (
    <ExpoImage
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      tintColor={tintColor}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      cachePolicy="disk"
      transition={120}
    />
  );
}

/**
 * Lottie in a ref so shouldPlay can drive play() / pause() imperatively —
 * `autoPlay` is a mount-time prop and doesn't respond to state changes.
 * pause() holds the current frame; a subsequent play() resumes from there
 * (not from frame 0), which is what the "tap → play; tap → pause; tap →
 * resume from position" mic pattern needs.
 */
type LottieInnerProps = {
  uri: string;
  style?: StyleProp<ImageStyle | ViewStyle>;
  contentFit: ImageContentFit;
  shouldPlay: boolean;
  loop: boolean;
  speed: number;
  onEnd?: () => void;
  testID?: string;
};

function LottiePlayerInner({ uri, style, contentFit, shouldPlay, loop, speed, onEnd, testID }: LottieInnerProps): React.ReactElement | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  // Track whether the last mount actually started playing so pause() below
  // doesn't fire before Lottie is mounted (which no-ops harmlessly but
  // spams warnings on some versions).
  const startedRef = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    if (shouldPlay) {
      // play() with no args resumes from the current frame in
      // lottie-react-native v6+. On first play, the anim starts at 0.
      ref.current.play?.();
      startedRef.current = true;
    } else if (startedRef.current) {
      ref.current.pause?.();
    }
  }, [shouldPlay]);

  if (!LottieView) return null;
  return (
    <LottieView
      ref={ref}
      source={{ uri }}
      autoPlay={shouldPlay}
      loop={loop}
      speed={speed}
      onAnimationFinish={onEnd}
      style={style}
      resizeMode={contentFit}
      testID={testID}
    />
  );
}

/**
 * expo-video wants its player instance built via `useVideoPlayer` — a hook,
 * so it can't sit in a conditional branch of the main component. Extracted
 * so the hook rule holds while keeping the outer component branch-friendly.
 * pause() holds the current frame; play() resumes from there — same as
 * Lottie above, so the "tap play / tap pause / tap resume" mic pattern is
 * uniform across both.
 */
type VideoInnerProps = {
  uri: string;
  style?: StyleProp<ImageStyle | ViewStyle>;
  contentFit: ImageContentFit;
  shouldPlay: boolean;
  loop: boolean;
  speed: number;
  muted: boolean;
  onEnd?: () => void;
  testID?: string;
};

function VideoPlayerInner({ uri, style, contentFit, shouldPlay, loop, speed, muted, onEnd, testID }: VideoInnerProps): React.ReactElement | null {
  const [ready, setReady] = useState(false);
  const endedRef = useRef(false);
  const player = useVideoPlayer(uri, (pl: { loop: boolean; muted: boolean; playbackRate: number; play: () => void }) => {
    pl.loop = loop;
    pl.muted = muted;
    pl.playbackRate = speed;
    if (shouldPlay) pl.play();
    setReady(true);
  });

  useEffect(() => {
    if (!player) return;
    player.loop = loop;
    player.muted = muted;
    player.playbackRate = speed;
    if (shouldPlay) player.play?.();
    else player.pause?.();
  }, [player, loop, muted, speed, shouldPlay]);

  useEffect(() => {
    if (!player || !onEnd) return;
    // expo-video's status changes carry didJustFinish; we surface once per mount.
    const sub = player.addListener?.("statusChange", (status: { status: string }) => {
      if (status.status === "readyToPlay") { /* no-op */ }
    });
    const endSub = player.addListener?.("playToEnd", () => {
      if (!endedRef.current) { endedRef.current = true; onEnd?.(); }
    });
    return () => {
      sub?.remove?.();
      endSub?.remove?.();
    };
  }, [player, onEnd]);

  if (!ready || !ExpoVideo) return null;
  return (
    <ExpoVideo
      player={player}
      style={style}
      contentFit={contentFit}
      nativeControls={false}
      testID={testID}
    />
  );
}
