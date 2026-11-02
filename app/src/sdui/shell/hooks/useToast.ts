import { useCallback, useRef } from "react";
import { num } from "../../knobs";
import type { Toast, SetState } from "../types";

/** The one toast and its one timer. */
export function useToast({ setToast }: { setToast: SetState<Toast | null> }) {
  // One timer for the one toast: a second toast used to be cleared early by
  // the first one's timer.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, tone?: string) => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), num("app.toastMs", 2800));
  }, []);
  return showToast;
}
