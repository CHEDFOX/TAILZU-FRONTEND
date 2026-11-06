/**
 * What this binary can do that a JavaScript update cannot add (binaryCore.ts has the rules): read once from the native bridge,
 * since it cannot change while the binary runs.
 */
import { Platform } from "react-native";
import { binaryFeatures as nativeFeatures } from "../../modules/tulmi-bridge";
import { cleanFeatures, type BinaryFeature } from "./binaryCore";

let read: BinaryFeature[] | null = null;

export function binaryFeatures(): readonly BinaryFeature[] {
  if (!read) read = cleanFeatures(nativeFeatures(), Platform.OS);
  return read;
}

export function hasBinaryFeature(f: BinaryFeature): boolean {
  return binaryFeatures().includes(f);
}
