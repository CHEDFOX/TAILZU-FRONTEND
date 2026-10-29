/**
 * THE FEEL OF THE APP'S OWN MOMENTS.
 *
 * A screen's own `haptic` action was already the server's. The native components were not: the sign-in pills,
 * the mic and refine controls, the dictionary, the swipe rows, the name card and coverflow each played a fixed
 * style. Each call now names its moment as a knob, app.haptics.<moment>, with today's style as the fallback:
 *
 *   haptic(str("app.haptics.dictionary.saved", "success"))
 *
 * so the console can change any one, or turn it off ("none"). A style this build does not know plays nothing.
 */
import * as Haptics from "expo-haptics";

export type HapticStyle = "light" | "medium" | "heavy" | "rigid" | "soft" | "selection" | "success" | "warning" | "error" | "none";

const IMPACT: Record<string, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
  soft: Haptics.ImpactFeedbackStyle.Soft,
};
const NOTIFY: Record<string, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

/** Play `style` (a moment's knob): never throws, never waits. */
export function haptic(style: string): void {
  try {
    if (style === "selection") { Haptics.selectionAsync().catch(() => {}); return; }
    if (Object.hasOwn(IMPACT, style)) { Haptics.impactAsync(IMPACT[style]!).catch(() => {}); return; }
    if (Object.hasOwn(NOTIFY, style)) { Haptics.notificationAsync(NOTIFY[style]!).catch(() => {}); return; }
  } catch {
    // a haptic is never worth an error
  }
}
