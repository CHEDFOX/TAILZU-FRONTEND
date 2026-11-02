/** What the renderer (Renderer.tsx) hands every node component. */
import type React from "react";
import type { Node, NodeEvent } from "../types";
import type { Ctx } from "../actions";
import type { Store } from "../state";

export interface CompProps {
  node: Node;
  props: Record<string, any>;
  style: any;
  store: Store;
  children: React.ReactNode;
  fire: (event: NodeEvent, value?: any) => void;
  /** Full render context (store + actions + flags + labels + nav). Lets
   *  a component evaluate conditions against real flags. */
  ctx: Ctx;
}
