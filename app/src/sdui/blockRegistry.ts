/**
 * What V1 hands to each block's register function: the one thing a block needs to say, its name and its schema.
 * A block that is not registered stays OFF for every screen (spec 2.0 principle 2).
 */
export interface BlockRegistry {
  addBlock(name: string, spec: unknown): void;
}
