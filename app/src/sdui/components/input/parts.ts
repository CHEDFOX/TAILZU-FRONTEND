/**
 * What every input kind is handed, and the one way any of them writes (pure/SPEC.md 2.8).
 *
 * A kind never touches the store, the renderer or the network. It gets its value already resolved, and it calls
 * `write` with what the person did — a value that inputCore has already sanitized, capped and shaped. `write` puts
 * it at the node's bound path through the host and fires `onChange`. That is the whole surface.
 */
import { useCallback } from "react";
import type { Node } from "../../types";
import type { CompProps } from "../props";
import type { InputHost } from "../v3Host";

export interface KindProps {
  node: Node;
  props: Record<string, any>;
  style: any;
  /** The value as the screen holds it now (V1 resolved it). */
  value: unknown;
  /** The person did something: this is the value for the store. */
  write: (value: unknown) => void;
  fire: CompProps["fire"];
  disabled: boolean;
}

/** The state path this input writes to: its `bind.value`, or the `into` prop for a node with no binding. */
export function writePath(node: Node, props: Record<string, any>): string {
  const bound = node.bind?.value;
  if (typeof bound === "string" && bound.trim()) return bound.trim();
  return typeof props.into === "string" ? props.into.trim() : "";
}

/**
 * The writer for one input node.
 *
 * Without a host there is nowhere to write, so the value only goes out as the node's own `onChange` event — a screen
 * built for a client that has the block still shows the field, and a tap still reaches the server, it just does not
 * keep the value on the device.
 */
export function useWrite(
  host: InputHost | null,
  node: Node,
  props: Record<string, any>,
  fire: CompProps["fire"],
): (value: unknown) => void {
  const path = writePath(node, props);
  return useCallback((value: unknown) => {
    if (host && path) host.setState(path, value);
    fire("onChange", value);
  }, [host, path, fire]);
}
