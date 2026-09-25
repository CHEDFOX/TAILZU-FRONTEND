/**
 * THE MONTH, FOR THE WIDGET.
 *
 * The bootstrap's quota flags are the numbers the stats screen draws and the
 * keyboard reads; the widget shows the same ones, so it is written here from
 * the same source, every time a bootstrap lands. The widget reads the App
 * Group and draws; it never asks the server, and it is never told anything
 * the user said.
 */
import { Platform } from "react-native";
import { setWidgetMonth } from "../../modules/tulmi-bridge";

export function publishWidgetMonth(flags: Record<string, unknown> | undefined): void {
  if (Platform.OS !== "ios" || !flags) return;
  const num = (k: string): number => {
    const v = Number(flags[k]);
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  };
  const used = num("quota.wordsUsed");
  const total = num("quota.wordsFree");
  setWidgetMonth({
    used,
    total,
    remaining: flags["quota.wordsRemaining"] != null ? num("quota.wordsRemaining") : Math.max(0, total - used),
    earned: num("quota.wordsEarned"),
    base: num("quota.wordsBase"),
    streak: num("quota.streakDays"),
    entitled: flags["quota.entitled"] === true,
    updatedAt: Date.now(),
  });
}
