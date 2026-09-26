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

/**
 * `flags` and `labels` are the bootstrap's — the same ones the rest of the app
 * renders with. They were empty here, so the server's sign-in tree could not
 * use "@label" copy, "$flags.x" values or `{ flag }` conditions: every one
 * resolved to nothing on the one screen that has to work.
 */
export function useAuthSduiCtx(
  flags?: Record<string, unknown> | null,
  labels?: Record<string, string> | null,
): Ctx {
  const store = useMemo(() => new Store({}), []);
  return useMemo(() => {
    const noop = () => {};
    return {
      store,
      actions: {},
      flags: flags ?? {},
      labels: labels ?? {},
      nav: { push: noop, back: noop, switchTab: noop, replace: noop },
      /**
       * THE ESCAPE HATCH THAT WAS MISSING ONE.
       *
       * The rule above is that every hatch is a no-op rather than a throw, and
       * `toast` was not in the list — so it was `undefined` on this ctx while
       * several actions call it on their failure path. `openUrl` is the one
       * that matters now that the consent line opens the Terms:
       * `Linking.openURL(...).catch(() => ctx.toast(...))`. A device with no
       * browser to hand the link to would have turned a dead tap into a crash,
       * on the one screen a user cannot go around.
       *
       * Silent, because there is nowhere on this screen to put a toast and
       * nothing useful to say: the link did not open, and the same words are
       * reachable from Settings once they are in.
       */
      toast: noop,
      haptic: noop,
      refresh: noop,
      reloadScreen: noop,
    } as unknown as Ctx;
  }, [store, flags, labels]);
}
