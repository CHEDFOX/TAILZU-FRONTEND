import { useEffect } from "react";
import { LAST_BOOT_NOTE } from "../../client";
import type { BootstrapResponse, ScreenResponse } from "../../types";
import { num } from "../../knobs";
import { getLastBoot, setLastBoot } from "../../../storage";
import { lastBootNote } from "../../safety";
import type { NavItem, Phase, Ref } from "../types";

/** Where a boot got to, written as it goes, so the next launch can report a launch that hung. */
export function useBootBreadcrumbs({
  phase, boot, screen, screenError, stack, kbWantedRef, kbRoutedRef,
}: {
  phase: Phase;
  boot: BootstrapResponse | null;
  screen: ScreenResponse | null;
  screenError: string | null;
  stack: NavItem[];
  kbWantedRef: Ref<boolean>;
  kbRoutedRef: Ref<boolean>;
}) {
  // BREADCRUMBS. A boot that hangs cannot report on itself, so each stage
  // writes where it got to and the NEXT launch carries that on its bootstrap —
  // the first call any launch makes, and therefore the one that always gets
  // through. Diagnostic only; nothing branches on it.
  useEffect(() => {
    void (async () => {
      // Both never throw: diagnostics must never break a boot.
      // The safety floor's own record is synchronous, so it can name the screen a launch died on — which is the one
      // thing this asynchronous crumb could never catch (sdui/safety.ts).
      const crumb = (await getLastBoot()) ?? "none";
      const died = lastBootNote();
      LAST_BOOT_NOTE.value = died ? `${crumb} ${died}` : crumb;
      await setLastBoot("started");
    })();
  }, []);

  // Where the boot actually ended up, written a few seconds in — long after a
  // healthy launch has a screen, and while a stuck one is still stuck.
  useEffect(() => {
    const t = setTimeout(() => {
      void setLastBoot(
        `phase=${phase} boot=${boot ? 1 : 0} screen=${screen ? 1 : 0}` +
        ` err=${screenError ? 1 : 0} stack=${stack.length}` +
        ` kbWants=${kbWantedRef.current ? 1 : 0} kbRouted=${kbRoutedRef.current ? 1 : 0}`,
      );
    }, num("app.boot.breadcrumbMs", 6000));
    return () => clearTimeout(t);
  }, [phase, boot, screen, screenError, stack.length]);
}
