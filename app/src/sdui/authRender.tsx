/**
 * A renderer context for the sign-in screen.
 *
 * RenderNode needs a Ctx — a store, an action table, flags, labels, navigation.
 * The auth screen has none of those: it runs before there is a session, its
 * state lives in AuthFlowContext rather than in an SDUI store, and there is
 * nowhere to navigate to until someone is signed in.
 *
 * So this builds the smallest honest one. The store is real but empty (nothing
 * on this screen binds to state), and every escape hatch is a no-op rather than
 * a throw: a server-composed sign-in screen that tries to navigate, or names an
 * action that does not exist, must do nothing at all rather than take down the
 * one screen a user cannot get past.
 */
import { useMemo } from "react";
import { Store } from "./state";
import { REGISTRY } from "./components";
import type { Ctx } from "./actions";
import type { Node } from "./types";

/**
 * Every node type the server's tree uses that THIS binary cannot draw.
 *
 * The point of the check is the failure it prevents. The auth screen's
 * components ship in the binary; the tree that uses them ships from the server
 * over a channel that reaches every installed build at once. So a backend
 * turning auth.sdui on reaches old binaries too, and there the tree renders as
 * nothing — no pills, no buttons, no way to sign in, on the one screen a user
 * cannot go around. A person in that state cannot even update, because the app
 * is what they would have updated from.
 *
 * So the app decides, not the flag. If anything in the tree is unknown here,
 * the native screen draws instead and the switch is simply ignored.
 */
export function missingComponents(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const c of node) missingComponents(c, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const n = node as Node & Record<string, unknown>;
  if (typeof n.type === "string" && !REGISTRY[n.type] && !found.includes(n.type)) {
    found.push(n.type);
  }
  // `fallback` is deliberately not walked: it is what runs WHEN the type above
  // is missing, so counting it would report a problem the tree already solves.
  if (Array.isArray(n.children)) missingComponents(n.children, found);
  return found;
}

export function useAuthSduiCtx(): Ctx {
  return useMemo(() => {
    const store = new Store({});
    const noop = () => {};
    return {
      store,
      actions: {},
      flags: {},
      labels: {},
      nav: { push: noop, back: noop, switchTab: noop, replace: noop },
    } as unknown as Ctx;
  }, []);
}
