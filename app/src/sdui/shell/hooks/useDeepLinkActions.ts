import { useEffect } from "react";
import { Store } from "../../state";
import { runAction, type NavApi } from "../../actions";
import type { ActionSpec, BootstrapResponse } from "../../types";
import { list } from "../../knobs";
import type { Ref } from "../types";

/**
 * Action `kind`s a `tulmi://action?kind=…` deep link is allowed to trigger.
 * Kept to a small, side-effect-safe set: an arbitrary/unknown kind from a URL
 * is ignored, never dispatched. These take no complex object params, so the
 * URL query (`Record<string,string>`) maps straight onto the ActionSpec.
 *
 * This set is the CEILING. The server can narrow it (deeplink.allowedActions)
 * — turn one off while it is misbehaving — but never widen it: what a link
 * from anywhere on the internet may do is decided by the binary.
 */
const DEEPLINK_ACTIONS = new Set<string>([
  "iap.restore",
  "iap.showPaywall",
  "requestReview",
  "openSettings",
]);

function deepLinkActionAllowed(kind: string): boolean {
  if (!DEEPLINK_ACTIONS.has(kind)) return false;
  return list<string>("deeplink.allowedActions", ["iap.restore", "iap.showPaywall", "requestReview", "openSettings"])
    .includes(kind);
}

/** The bare actions a tulmi://action link may run: a small ceiling the binary keeps, which the server can only narrow. */
export function useDeepLinkActions({
  runLinkActionRef, boot, nav, showToast,
}: {
  runLinkActionRef: Ref<(kind: string, params?: Record<string, string>) => void>;
  boot: BootstrapResponse | null;
  nav: NavApi;
  showToast: (message: string, tone?: string) => void;
}) {
  useEffect(() => {
    runLinkActionRef.current = (kind, params) => {
      // Only known, side-effect-safe kinds may be triggered from a URL; anything
      // else is ignored (never dispatched) so a crafted link can't run arbitrary
      // actions or crash the app.
      if (!deepLinkActionAllowed(kind)) return;
      // `kind` last: a query parameter must not be able to name another one.
      const action = { ...(params ?? {}), kind } as unknown as ActionSpec;
      void runAction(action, {
        store: new Store({}),
        actions: {},
        flags: boot?.flags ?? {},
        labels: boot?.labels ?? {},
        nav,
        toast: showToast,
      });
    };
  }, [boot, nav, showToast]);
}
