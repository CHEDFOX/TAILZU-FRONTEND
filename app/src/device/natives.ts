// The one gate for native code added AFTER the current store build.
//
// Rule: the runtime label (app.config.ts) is not bumped for additions, so JS
// may only reach a native package or local-module function that older binaries
// might lack through this file, and must handle `null`. Anything already in
// app/native-inputs.lock can be imported normally. natives.test.ts enforces it.
import { requireOptionalNativeModule } from "expo-modules-core";

/** The native module called `name`, or null when this binary does not have it. */
export function optionalNative<T = unknown>(name: string): T | null {
  try {
    return requireOptionalNativeModule<T>(name) ?? null;
  } catch {
    return null;
  }
}
