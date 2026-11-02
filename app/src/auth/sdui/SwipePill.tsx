import React from "react";
import { useAuthFlow } from "../AuthFlowContext";
import type { CompProps } from "../../sdui/components/props";
import * as K from "../../sdui/knobs";
// TYPE-ONLY: the pill component itself is fetched lazily below, at render
// time. The pill used to live in AuthGateScreen, and a value import of that
// module here closed a cycle (components → the sign-in nodes → AuthGateScreen →
// authRender → components) that Metro resolves by handing someone a
// half-initialised module: the app threw during module init, before the first
// render. The pill is a module of its own now (gate/MethodPill); the lazy
// require stays so that SwipePill's props stay loosely typed to what the
// server sends.
import type { Field } from "../gate/types";

/**
 * SwipePill — one sign-in method. Swipe the badge or tap the arrow.
 *
 * props.method  "email" | "phone"
 * props.hintDelayMs  when the badge nudges itself to advertise the gesture
 */
export const SwipePill = ({ props, style }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  // Resolved at RENDER time, not module-init time (see the type import above).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MethodPill } = require("../gate/MethodPill") as {
    MethodPill: React.ComponentType<{
      field: Field;
      onSubmit: (f: Field, value: string) => void;
      hintDelay: number;
      look?: Record<string, unknown>;
      style?: object;
    }>;
  };
  const method = props?.method === "phone" ? "phone" : "email";
  if (!flow) return null;
  // A method the backend offers but this build cannot serve draws nothing.
  // Better an absent row than a row that fails when someone taps it.
  if (method === "phone" && !flow.phoneEnabled) return null;
  const field: Field = { id: method, type: method };
  // Only the keys the server actually sent are forwarded, so MethodPill keeps
  // its own value for everything else rather than being handed undefined.
  const look: Record<string, unknown> = {};
  for (const k of [
    "height", "radius", "background", "borderColor", "textColor",
    "placeholderColor", "badgeBackground", "badgeBorderColor",
    "targetBackground", "targetIconColor", "fontSize", "paddingLeft",
    // The onboarding sign-in's plain field and its button (variant "field").
    // Left out, the pill is the swipe pill it always was.
    "submitLabel", "placeholder", "presetCountry",
    "buttonBackground", "buttonTextColor", "buttonHeight", "buttonRadius",
    "countryBackground", "countryBorderColor",
  ]) {
    if (props?.[k] !== undefined) look[k] = props[k];
  }
  if (props?.variant === "field") look.variant = "field";
  return (
    <MethodPill
      field={field}
      onSubmit={(f, value) => flow.submit(f.type, value)}
      hintDelay={Number(props?.hintDelayMs) || K.num("ui.SwipePill.hintDelayMs", 1100)}
      look={look}
      style={style}
    />
  );
};
