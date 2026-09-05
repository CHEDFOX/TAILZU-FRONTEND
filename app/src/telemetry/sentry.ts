/**
 * Sentry crash + error reporting. Same pattern as analytics — no-op if
 * SENTRY_DSN is unset.
 */
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

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
      tracesSampleRate: 0.05,
      // Attach basic context — the RN SDK auto-captures OS + app version.
      environment: process.env.NODE_ENV ?? "production",
    });
  } catch {
    /* silent — never block boot */
  }
}

export function captureError(err: unknown, context?: Record<string, any>): void {
  if (!DSN) return;
  try { Sentry.captureException(err, context ? { extra: context } : undefined); } catch { /* no-op */ }
}
