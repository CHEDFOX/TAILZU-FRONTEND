import React from "react";
import { View } from "react-native";
import { useAuthFlow } from "../AuthFlowContext";
import type { CompProps } from "../../sdui/components/props";

/**
 * AuthPhase — draws its children only during the phases the server names.
 *
 * `visibleIf` cannot express this: the flow's phase lives in a React context,
 * not in the SDUI store, so there is no state path for a condition to read.
 * Rather than mirror the phase into the store — two copies of one truth, and a
 * frame where they disagree — the gate is a node.
 *
 * props.phases  e.g. ["entry"] or ["verify", "verifying"]
 */
export const AuthPhase = ({ props, children }: CompProps): React.ReactElement | null => {
  const flow = useAuthFlow();
  if (!flow) return null;
  const want = Array.isArray(props?.phases) ? (props.phases as string[]) : [];
  if (want.length && !want.includes(flow.phase)) return null;
  return <View>{children}</View>;
};
