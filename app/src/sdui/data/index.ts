/**
 * B10 data half (`data` block, pure SPEC 2.10): callEndpoint's new options and `subscribe`. OFF unless a screen states it needs `data` and
 * this client declared it: V1 calls `registerData(registry)` and maps the action's keys onto the options below.
 */
import { ENDPOINT_LIMITS, type CallOptions } from "../client/endpointCore";
import { SPEC as SUBSCRIBE_SPEC, SUBSCRIBE_LIMITS, bindSubscribeHost, subscribeEvent, type SubscribeHost } from "../live/subscribe";

export { callEndpoint, clearCallCache } from "../client/endpoint";
export { applyOptimistic, progressSink, safeStatePath } from "../client/endpointCore";
export type { CallOptions } from "../client/endpointCore";
export { subscribeEvent, bindSubscribeHost, subscribeHub, SubscriptionHub, normalizeSubscribe } from "../live/subscribe";

/** The exact keys the callEndpoint action gains, and the subscribe action. Paths stay relative, under /v1/, our origin only. */
export const SPEC = Object.freeze({
  block: "data",
  callEndpoint: {
    multipart: `{ files: [{ field, uri (file: content: ph:), name?, type? }] ≤ ${ENDPOINT_LIMITS.files}, fields? }`,
    progressInto: "state path; gets { loaded, total, pct }",
    retry: `{ times 0..${ENDPOINT_LIMITS.retryMax}, backoff "exp" | "fixed" | ms, idempotent? }`,
    queue: '"outbox" (kept offline, sent in order; client-side id, see offline/outbox)',
    cache: `{ key, ttlMs ≤ ${ENDPOINT_LIMITS.cacheTtlMaxMs} } (GET only; emptied by any successful write and sign-out)`,
    optimistic: "{ path, value }; undone if the call fails",
  },
  subscribe: SUBSCRIBE_SPEC,
  limits: { ...ENDPOINT_LIMITS, ...SUBSCRIBE_LIMITS },
});

export interface DataRegistry { register(block: string, spec: typeof SPEC, impl: Record<string, unknown>): void }

export function registerData(registry: DataRegistry): void {
  registry.register("data", SPEC, { bindSubscribeHost, subscribeEvent });
}

export type { SubscribeHost };
export type ActionOptions = CallOptions;
