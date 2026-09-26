/**
 * THE MONTH, FOR THE WIDGET.
 *
 * The bootstrap's quota flags are the numbers the stats screen draws and the
 * keyboard reads; the widget shows the same ones, so it is written here from
 * the same source, every time a bootstrap lands. The widget reads the App
 * Group and draws; it never asks the server, and it is never told anything
 * the user said.
 *
 * It cannot read the server's labels or flags either, so they travel with the
 * numbers: every word on the widget (widget.month.* labels), its colours
 * (widget.color.*, widget.alpha.*), where a tap goes, how often it asks again,
 * a subscriber's span, and the headline and line it draws. The Live
 * Activity's words (publishFlowCopy) and the Dictate control's screen go out
 * at the same moment. Each fallback here is the literal the Swift side keeps.
 */
import { Platform } from "react-native";
import { setWidgetDictatePath, setWidgetMonth } from "../../modules/tulmi-bridge";
import { color, num, setKnobs, str, txt } from "../sdui/knobs";
import type { BootstrapResponse } from "../sdui/types";
import { publishFlowCopy } from "./flow";

/** The widget's words. `{n}` is a count the widget fills in. */
export function widgetMonthLabels(): Record<string, string> {
  return {
    thisMonth: txt("widget.month.thisMonth", "THIS MONTH"),
    wordsLeft: txt("widget.month.wordsLeft", "WORDS LEFT"),
    brandCaps: txt("widget.month.brandCaps", "TAILZU"),
    brand: txt("widget.month.brand", "Tailzu"),
    gaugeWords: txt("widget.month.gaugeWords", "words"),
    streakShort: txt("widget.month.streakShort", "{n}d"),
    streakLong: txt("widget.month.streakLong", "{n}-day streak"),
    wordsThisMonth: txt("widget.month.wordsThisMonth", "Words this month"),
    wordsLeftTitle: txt("widget.month.wordsLeftTitle", "Words left"),
    inlinePaid: txt("widget.month.inlinePaid", "Tailzu · {n} words"),
    inlineFree: txt("widget.month.inlineFree", "Tailzu · {n} left"),
    inlineStreak: txt("widget.month.inlineStreak", " · {n}d"),
    displayName: txt("widget.month.displayName", "The Month"),
    description: txt("widget.month.description", "Words this month, and your streak."),
  };
}

/**
 * Write the month (and everything the widget draws it with) to the App Group.
 *
 * `labels` is the same bootstrap's labels. This runs just BEFORE that
 * bootstrap is set as the one in hand, so without them the knobs still read
 * the previous one (or, on a first launch, the fallbacks) — pass them.
 */
export function publishWidgetMonth(
  flags: Record<string, unknown> | undefined,
  labels?: Record<string, string>,
): void {
  if (Platform.OS !== "ios" || !flags) return;
  if (labels) setKnobs({ flags: flags as NonNullable<BootstrapResponse["flags"]>, labels });
  const count = (k: string): number => {
    const v = Number(flags[k]);
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  };
  const used = count("quota.wordsUsed");
  const total = count("quota.wordsFree");
  const remaining = flags["quota.wordsRemaining"] != null ? count("quota.wordsRemaining") : Math.max(0, total - used);
  const entitled = flags["quota.entitled"] === true;
  // A subscriber has no words left to show, so theirs is the month's count
  // against a span no month reaches — the same rule the stats screen draws.
  const span = num("widget.month.paidSpan", 120000);
  const paidSpan = span > 0 ? span : 120000;
  const fraction = entitled
    ? Math.min(1, used / paidSpan)
    : total > 0 ? Math.min(1, used / total) : 0;
  setWidgetMonth({
    used,
    total,
    remaining,
    earned: count("quota.wordsEarned"),
    base: count("quota.wordsBase"),
    streak: count("quota.streakDays"),
    entitled,
    updatedAt: Date.now(),
    headline: entitled ? used : remaining,
    fraction,
    labels: widgetMonthLabels(),
    colors: {
      ground: color("widget.color.ground", "#0F0D0B"),
      pale: color("widget.color.pale", "#F3E2C6"),
      amber: color("widget.color.amber", "#E8A23C"),
    },
    alpha: {
      dim: num("widget.alpha.dim", 0.52),
      rule: num("widget.alpha.rule", 0.13),
      track: num("widget.alpha.track", 0.14),
    },
    url: str("widget.month.url", "tulmi://screen/stats"),
    refreshSec: num("widget.month.refreshSec", 3600),
    span: paidSpan,
  });
  // The Live Activity's words and the Dictate control's screen land with the
  // month, from the same bootstrap.
  publishFlowCopy();
  setWidgetDictatePath(str("widget.dictate.path", "screen/flow_arm"));
}
