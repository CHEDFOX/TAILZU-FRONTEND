/**
 * Sentry crash + error reporting. Same pattern as analytics — no-op if
 * SENTRY_DSN is unset.
 */
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { num } from "../sdui/knobs";
import { scrubEvent } from "./scrubCore";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const DSN = extra.sentryDsn ?? "";

let inited = false;

export function initSentry(): void {
  if (inited || !DSN) return;
  inited = true;
  try {
    Sentry.init({
      dsn: DSN,
      // Debug is off in prod; toggle via env for triage.
      debug: false,
      // Ship only errors + warnings by default; enable tracesSampleRate later
      // if we want performance instrumentation.
      tracesSampleRate: num("telemetry.sentry.tracesSampleRate", 0.05),
      // Attach basic context — the RN SDK auto-captures OS + app version.
      environment: process.env.NODE_ENV ?? "production",
      // No health number and no named area ever leaves on a crash report (scrubCore.ts; perms/SPEC.md 4.6).
      beforeSend: (event) => scrubEvent(event),
    });
  } catch {
    /* silent — never block boot */
  }
}
