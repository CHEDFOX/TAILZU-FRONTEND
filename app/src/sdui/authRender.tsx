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
import type { Ctx } from "./actions";

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
