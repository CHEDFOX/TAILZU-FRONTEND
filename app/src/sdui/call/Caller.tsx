/**
 * `Caller`: ONE PERSON IN THE CALL THIS SCREEN HOLDS (the `call` block; TAILZU-BACKEND/docs/rooms.md).
 *
 * It draws their camera when they are sending one, and the first letter of their name when they are not, so a tile never goes blank
 * mid-call. `who` is "me", "speaker" (whoever is talking) or an `identity` from the call's own state, and the LAYOUT IS THE SERVER'S: a
 * grid is `Each` over `call.people` with one of these inside, a big-and-small is two of them in boxes the server sized.
 *
 * With no call on the screen it draws its ground and nothing else, so a screen lays out the same before anyone has joined.
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { CompProps } from "../components/props";
import { whoIs } from "./callCore.ts";
import { currentCall, watchCall } from "./holder.ts";
import { rtcView } from "./session.ts";

/** The view that draws one track. It comes from session.ts, the one file the block names the client in. */
type ViewProps = { streamURL: string; mirror?: boolean; objectFit?: "cover" | "contain"; zOrder?: number; style?: unknown };

function trackView(): React.ComponentType<ViewProps> | null {
  const v = rtcView();
  return typeof v === "function" || (typeof v === "object" && v !== null) ? (v as React.ComponentType<ViewProps>) : null;
}

const letterOf = (name: string): string => (name.trim()[0] ?? "").toUpperCase();

export const Caller = ({ props, style }: CompProps) => {
  // The call changes under this node (someone joins, a camera goes off), so it redraws on the holder's word rather than on a timer.
  const [, bump] = useState(0);
  useEffect(() => watchCall(() => bump((n) => n + 1)), []);

  const session = currentCall();
  const radius = typeof props.radius === "number" ? props.radius : 0;
  const ground = {
    backgroundColor: typeof props.background === "string" ? props.background : "#262626",
    borderRadius: radius,
    overflow: "hidden" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  if (!session) return <View style={[ground, style]} />;

  const snap = session.snapshot();
  const identity = whoIs(String(props.who ?? "me"), snap);
  const person = snap.me?.identity === identity ? snap.me : snap.people.find((p) => p.identity === identity);
  const stream = identity ? session.streamFor(identity) : null;
  const View_ = stream ? trackView() : null;

  if (stream && View_) {
    return (
      <View style={[ground, style]}>
        <View_
          streamURL={stream.id}
          mirror={props.mirror === true}
          objectFit={props.fit === "contain" ? "contain" : "cover"}
          // Their own picture sits over the others, as a corner tile does.
          zOrder={props.who === "me" ? 1 : 0}
          style={{ width: "100%", height: "100%" }}
        />
      </View>
    );
  }

  // No picture: their initial, which is also what a tile shows before anyone's camera is on.
  return (
    <View style={[ground, style]}>
      <Text
        style={{
          color: typeof props.nameColor === "string" ? props.nameColor : "#ffffff",
          fontSize: 28,
          ...(typeof props.fontFamily === "string" ? { fontFamily: props.fontFamily } : {}),
        }}
      >
        {letterOf(person?.name ?? "")}
      </Text>
    </View>
  );
};
