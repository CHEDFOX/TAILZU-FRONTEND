/**
 * Slideshow — cycles through a list of media specs at a backend-defined
 * speed. A general SDUI primitive; the intro screen is one caller, but
 * anything else (paywall carousel, onboarding walkthrough, empty-state
 * demo) can drop it into a screen tree unchanged.
 *
 * Props (all backend-controlled — no hardcoded values here):
 *   frames        MediaSpec[]  ordered list of media to cycle through
 *   frameMs       number       ms per frame (default 120 — cinematic fast)
 *   loops         number       cycles to run then fire onComplete
 *                              (default 1). Pass 0 or omit for infinite.
 *   contentFit    "contain" | "cover" | "fill"  (default "cover" so the
 *                              media fills the frame edge to edge —
 *                              intro-style, not letterboxed).
 *
 * Events:
 *   onComplete    fired after `loops` full cycles. The action tree
 *                 the backend wires to onComplete is what dismisses
 *                 the intro / navigates onward.
 *
 * The current-frame MediaPlayer is torn down and rebuilt on each step so
 * the same file (e.g. an animated GIF) resets its animation for the next
 * cycle — matches the "slideshow" mental model rather than "the media
 * just keeps playing regardless of when we advance".
 */
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { MediaPlayer } from "../media/MediaPlayer";
import type { MediaSpec } from "../media/resolveMedia";
import type { CompProps } from "./components";

export const Slideshow = ({ props, style, fire }: CompProps): React.ReactElement | null => {
  const frames = (Array.isArray(props.frames) ? props.frames : []) as MediaSpec[];
  const frameMs = Number(props.frameMs) || 120;
  const loops = Number(props.loops) || 1;
  const contentFit = (props.contentFit as "contain" | "cover" | "fill" | undefined) ?? "cover";

  const [index, setIndex] = useState(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (frames.length === 0) return;
    // Track cycles inside the interval so a re-mount doesn't reset them.
    let cyclesDone = 0;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = i + 1;
        if (next >= frames.length) {
          cyclesDone += 1;
          if (loops > 0 && cyclesDone >= loops) {
            clearInterval(id);
            if (!completedRef.current) {
              completedRef.current = true;
              // Defer to the next frame so onComplete's setState calls
              // don't race with our own setIndex above.
              setTimeout(() => fire("onComplete"), 0);
            }
            return i; // freeze on the last frame while dismiss animates
          }
          return 0;
        }
        return next;
      });
    }, frameMs);
    return () => clearInterval(id);
  }, [frames, frameMs, loops, fire]);

  if (frames.length === 0) return null;
  const current = frames[Math.min(index, frames.length - 1)];

  return (
    <View style={style} pointerEvents="none">
      <MediaPlayer
        // key forces a fresh mount per frame so animated media (GIF/APNG)
        // restarts from frame 0 on each slideshow step. Static images
        // don't care — the swap is a normal re-render.
        key={index}
        spec={current}
        style={{ width: "100%", height: "100%" }}
        contentFit={contentFit}
        autoplay
        loop={false}
        muted
      />
    </View>
  );
};
