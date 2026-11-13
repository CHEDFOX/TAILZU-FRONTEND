/** B7 paint: the block's registration. V1 calls registerPaint when the client declares "paint"; a screen then opts in per render. */
import type { BlockRegistry } from "../blockRegistry";
import { PAINT_SPEC } from "./paintCore";

export { PAINT_SPEC as SPEC } from "./paintCore";
export function registerPaint(registry: BlockRegistry): void {
  registry.addBlock("paint", PAINT_SPEC);
}
