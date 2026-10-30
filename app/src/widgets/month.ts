/**
 * THE MONTH, FOR THE WIDGET.
 *
 * The bootstrap's quota flags are the numbers the stats screen draws and the
 * keyboard reads; the widget shows the same ones, so it is written here from
 * the same source, every time a bootstrap lands. The widget reads the App
 * Group (iOS) or the app's SharedPreferences (Android) and draws; it never
 * asks the server, and it is never told anything the user said.
 *
 * It cannot read the server's labels or flags either, so they travel with the
 * numbers: every word on the widget (widget.month.* labels), its colours
 * (widget.color.* for the dark theme, widget.color.light.* for the light one;
 * widget.alpha.* for builds that still fade one ink), where a tap goes, how often it asks again,
 * a subscriber's span, whether the streak shows, and the headline and line it
 * draws. On iOS the Live Activity's words (publishFlowCopy) and the Dictate
 * control's screen go out at the same moment. Each fallback here is the
 * literal the Swift and Kotlin sides keep.
 */
import { Platform } from "react-native";
import { setWidgetDictate, setWidgetMonth, setWidgetTheme, type WidgetMonth, type WidgetTheme } from "../../modules/tulmi-bridge";
import { bool, color, num, setKnobs, str, txt } from "../sdui/knobs";
import type { BootstrapResponse } from "../sdui/types";
import { publishFlowCopy, publishSetupActivity } from "./flow";

/** The widget's words. `{n}` is a count the widget fills in. */
export function widgetMonthLabels(): Record<string, string> {
  return {
    thisMonth: txt("widget.month.thisMonth", "THIS MONTH"),
    wordsLeft: txt("widget.month.wordsLeft", "WORDS LEFT"),
    brand: txt("widget.month.brand", "X0"),
    gaugeWords: txt("widget.month.gaugeWords", "words"),
    streakShort: txt("widget.month.streakShort", "{n}d"),
    streakLong: txt("widget.month.streakLong", "{n}-day streak"),
    wordsThisMonth: txt("widget.month.wordsThisMonth", "Words this month"),
    wordsLeftTitle: txt("widget.month.wordsLeftTitle", "Words left"),
    inlinePaid: txt("widget.month.inlinePaid", "X0 · {n} words"),
    inlineFree: txt("widget.month.inlineFree", "X0 · {n} left"),
    inlineStreak: txt("widget.month.inlineStreak", " · {n}d"),
    // The iOS widget gallery's name and description. Android's picker shows
    // them before the app has ever run, so it keeps its own string resources
    // (the same words: tailzu_widget_strings.xml).
    displayName: txt("widget.month.displayName", "This month"),
    description: txt("widget.month.description", "Your words this month."),
  };
}

/**
 * The widgets' colours, the app's own palette (backend bots/palette.ts) by
 * role, for each theme: `colors` the dark one (the key every build reads),
 * `light` the light one. pale is the ink (the number, a primary button); meta
 * the grey of a label; line the hairline, a border, the line's track; surface
 * an avatar's disc; mark the line's fill. Never a bot's colour: that is theirs.
 */
export function widgetColors(): { colors: Record<string, string>; light: Record<string, string> } {
  return {
    colors: {
      ground: color("widget.color.ground", "#0A0A0A"),
      pale: color("widget.color.pale", "#FFFFFF"),
      mark: color("widget.color.mark", "#FFFFFF"),
      meta: color("widget.color.meta", "#A3A3A3"),
      line: color("widget.color.line", "#262626"),
      surface: color("widget.color.surface", "#171717"),
    },
    light: {
      ground: color("widget.color.light.ground", "#FFFFFF"),
      pale: color("widget.color.light.pale", "#0A0A0A"),
      mark: color("widget.color.light.mark", "#0A0A0A"),
      meta: color("widget.color.light.meta", "#5C5C5C"),
      line: color("widget.color.light.line", "#E6E6E6"),
      surface: color("widget.color.light.surface", "#F5F5F5"),
    },
  };
}

/** The alphas a build that fades one ink reads (the Android and iOS widgets before the two palettes). */
function widgetAlphas(): Record<string, number> {
  return {
    dim: num("widget.alpha.dim", 0.52),
    rule: num("widget.alpha.rule", 0.13),
    track: num("widget.alpha.track", 0.14),
  };
}

/**
 * Write the month (and everything the widget draws it with) where the widget
 * reads it: the App Group on iOS, the app's SharedPreferences on Android.
 *
 * `labels` is the same bootstrap's labels. This runs just BEFORE that
 * bootstrap is set as the one in hand, so without them the knobs still read
 * the previous one (or, on a first launch, the fallbacks) — pass them.
 */
export function publishWidgetMonth(
  flags: Record<string, unknown> | undefined,
  labels?: Record<string, string>,
): void {
  if ((Platform.OS !== "ios" && Platform.OS !== "android") || !flags) return;
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
  const { colors, light } = widgetColors();
  // `light` rides beside the fields WidgetMonth names: the JSON is the widgets' to read, and a build that does not know it skips it.
  const month: WidgetMonth & { light: Record<string, string> } = {
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
    colors,
    light,
    alpha: widgetAlphas(),
    // A tap opens the Bots app's Usage: this month as meters, and when it resets.
    url: str("widget.month.url", "tulmi://screen/bots.usage"),
    refreshSec: num("widget.month.refreshSec", 3600),
    span: paidSpan,
    // Minimal by default: the streak shows only when the server turns it on.
    showStreak: bool("widget.month.streak", false),
    // The progress line shows unless the server hides it.
    showProgress: bool("widget.month.show.progress", true),
  };
  setWidgetMonth(month);
  // The theme (colours + alphas) lands on every bootstrap, so every surface has
  // the server's colours even before month stats exist. Both platforms.
  publishWidgetTheme();
  // The Live Activity's words and the Dictate control's screen land with the
  // month, from the same bootstrap. iOS only: Android records in the keyboard
  // itself, so there is no background mic session to show or to arm.
  if (Platform.OS === "ios") {
    publishFlowCopy();
    publishSetupActivity();
    setWidgetDictate({
      path: str("widget.dictate.path", "screen/flow_arm"),
      label: txt("widget.dictate.label", "Dictate"),
      symbol: str("widget.dictate.symbol", "waveform"),
      description: txt("widget.dictate.description", "Turn on the X0 mic, ready for your keyboard."),
    });
  }
}

/**
 * Write the widget theme where every surface reads it (the App Group on iOS,
 * the app's SharedPreferences on Android) — the colours and alphas, from the
 * same widget.color.* / widget.color.light.* / widget.alpha.* knobs the month draws with. Published on
 * every bootstrap so the colours are the server's even before month stats have
 * been written. Each value falls back to the literal the native sides keep.
 */
export function publishWidgetTheme(): void {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  const { colors, light } = widgetColors();
  // `light` beside the fields WidgetTheme names, as with the month.
  const theme: WidgetTheme & { light: Record<string, string> } = { colors, light, alpha: widgetAlphas() };
  setWidgetTheme(theme);
}
