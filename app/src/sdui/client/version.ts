/**
 * THE VERSION OF THE BINARY THAT IS ACTUALLY RUNNING.
 *
 * This was the literal "1.0.0" while the store build was 1.0.1, so the update
 * gate compared the server's minimum against a number no device had, and every
 * capability handshake reported the wrong build. The native version is what
 * the store installed; expo-constants' manifest version is the fallback for a
 * runtime without expo-application, and the old literal is the last resort.
 */
function readAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const v = require("expo-application")?.nativeApplicationVersion;
    if (typeof v === "string" && v) return v;
  } catch { /* not in this runtime */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const C = require("expo-constants");
    const v = (C?.default ?? C)?.expoConfig?.version;
    if (typeof v === "string" && v) return v;
  } catch { /* not in this runtime */ }
  return "1.0.0";
}

export const APP_VERSION = readAppVersion();
