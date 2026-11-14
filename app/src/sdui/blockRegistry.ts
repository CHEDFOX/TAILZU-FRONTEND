/**
 * What V1 hands to each block's register function: the one thing a block needs to say, its name and its schema.
 * A block that is not registered stays OFF for every screen (spec 2.0 principle 2).
 */
export interface BlockRegistry {
  addBlock(name: string, spec: unknown): void;
  /**
   * The shape data, shell and call use: the block, what it promises, the node types it draws, and its helpers. Only a type the SPEC
   * itself declares under `nodes` becomes a node (blocks/registry.ts Adapter), so a helper can never be drawn.
   */
  register?(block: string, spec: unknown, nodes?: Record<string, unknown>, helpers?: Record<string, unknown>): void;
}
