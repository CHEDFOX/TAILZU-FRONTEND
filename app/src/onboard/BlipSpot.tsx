/**
 * BlipSpot — an empty box that says "Blip stands here, in this pose, saying
 * this".
 *
 * It draws nothing. Blip is the overlay's (BlipHost), and he walks to
 * whichever spot is current. All a spot does is keep the overlay told: it
 * registers when its step is the one on screen, measures itself against the
 * step's scroll content (so a slide in progress, or a scroll, does not
 * confuse the numbers), and removes itself when it goes.
 *
 * The server makes sure one spot is showing at a time in a step (with
 * visibleIf), so there is no arbitration here. If two ever do show, the most
 * recently mounted wins, which is the overlay's rule (stageBus).
 *
 * The box is the size his picture is: a little wider than he is tall, so his
 * arms and his shadow have room.
 *
 * A corner spot (the big ones on hello and done, where his words sit at the
 * top right of the content, not beside him) stretches across its parent
 * instead, which is what lets his bubble be anchored to the parent's right
 * edge as it is in the design.
 */
import React, { useContext, useEffect, useRef } from "react";
import { View } from "react-native";
import type { CompProps } from "../sdui/components";
import { boxOf } from "./blipMotion";
import { StepCtx } from "./OnboardStage";
import * as bus from "./stageBus";

export const BlipSpot = ({ props, style }: CompProps): React.ReactElement => {
  const step = useContext(StepCtx);
  const ref = useRef<View>(null);
  const token = useRef<number | null>(null);

  const h = Math.max(24, Number(props?.h) || 100);
  const pose = String(props?.pose ?? "present");
  const say = typeof props?.say === "string" ? props.say : "";
  const bubble = props?.bubble === "corner" ? "corner" : "side";
  const burst = props?.burst === true;
  const box = boxOf(h);
  const current = !!step?.current;
  const layer = step?.layer ?? "";
  const stageId = step?.stageId ?? "";

  const measure = () => {
    const node = ref.current, content = step?.contentRef.current, t = token.current;
    if (!node || !content || t === null) return;
    // Relative to the scroll content, not the window: a transform on an
    // ancestor (the glide) and the scroll offset play no part in it.
    node.measureLayout(content, (x, y, w, hh) => {
      if (token.current === t) bus.updateSpot(t, { rect: { x, y, w, h: hh } });
    }, () => { /* not laid out yet; onLayout will come */ });
  };

  // Stand here, while this is the step on screen.
  useEffect(() => {
    if (!current) return;
    const t = bus.pushSpot({ stage: stageId, layer, pose, h, say, bubble, burst });
    token.current = t;
    measure();
    return () => {
      bus.popSpot(t);
      if (token.current === t) token.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, layer, stageId]);

  // New words or a new pose for the same spot.
  useEffect(() => {
    if (token.current !== null) bus.updateSpot(token.current, { pose, h, say, bubble, burst });
  }, [pose, h, say, bubble, burst]);

  // The step changed size (a font arrived, a line wrapped): measure again.
  useEffect(() => { measure(); }, [step?.tick]);

  return (
    <View
      ref={ref}
      collapsable={false}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onLayout={measure}
      style={[
        bubble === "corner" ? { alignSelf: "stretch", height: box.h } : { width: box.w, height: box.h },
        style,
      ]}
    />
  );
};
