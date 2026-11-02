/** Text: the server's copy, set in its type role, with relative times and store prices filled in. */
import { Text, type TextStyle } from "react-native";
import { useStorePrice } from "../../billing/storePrice";
import type { Node, ThemeTokens } from "../types";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import { typeRole, fontSlot } from "../theme/typeRole";
import type { CompProps } from "./props";
import { tightRoom } from "./tightText";

/**
 * Copy renders EXACTLY as the backend wrote it. This used to Title-Case every
 * static string — which mangled whole body paragraphs into "Tap Tailzu Again
 * And Turn On "Allow Full Access"" and made every screen read broken. Casing
 * is an authoring decision, and the catalog owns the copy; the renderer must
 * never rewrite it.
 */
export function staticText(_node: Node, raw: string): string {
  return raw;
}

/**
 * The renderer's own copy of the Text variants — the fallback typeRole()
 * uses when a theme predates the backend's scale. Not a second source of
 * truth: when the theme carries the role, none of this is read.
 */
function legacyVariant(variant: string | undefined, theme: ThemeTokens): TextStyle {
  const f = theme.font.sizes;
  const fam = fontSlot(theme, "display");
  switch (variant) {
    case "brand":
      return { fontFamily: fam, color: theme.color.text, fontSize: f.brand, lineHeight: 38, letterSpacing: 0.2 };
    case "h1":
      return { fontFamily: fam, color: theme.color.text, fontSize: f.h1, lineHeight: 34, letterSpacing: 0.3 };
    case "overline":
      return { color: theme.color.label, fontSize: f.overline, letterSpacing: 3, fontWeight: "500", textTransform: "uppercase", marginBottom: 10 };
    case "quote":
      return { fontFamily: fam, color: theme.color.muted ?? theme.color.text, fontSize: f.lg, lineHeight: 28, fontStyle: "italic" };
    case "label":
      return { color: theme.color.label, fontSize: f.label, letterSpacing: 1, marginBottom: 8 };
    case "muted":
      return { color: theme.color.muted, fontSize: f.body, lineHeight: 22 };
    case "caption":
      return { color: theme.color.muted, fontSize: f.caption };
    default: // body
      return { color: theme.color.body ?? theme.color.text, fontSize: f.body, lineHeight: 26, fontWeight: "300" };
  }
}

function textVariant(variant: string | undefined, theme: ThemeTokens): TextStyle {
  return typeRole(theme, variant ?? "body", legacyVariant(variant, theme));
}

/**
 * Turn an ISO timestamp into something a person reads.
 *
 * This has to happen on the device, not the server: the server knows the
 * instant but not the timezone, and a history list that says 08:30 to someone
 * who dictated at 14:00 is worse than no time at all.
 *
 * Recent entries get elapsed time, because in a list of things you just did
 * "4m ago" answers the question and a date does not. Past a week the date is
 * the more useful fact and the year appears only when it is not this one.
 */
function humanTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const secs = Math.max(0, (Date.now() - then) / 1000);
  // The words and the cut-offs are the server's (ui.time.*): the thresholds
  // in seconds, the phrases with {n} for the count.
  if (secs < K.num("ui.time.justNowSecs", 45)) return K.txt("ui.time.justNow", "just now");
  if (secs < 3600) return K.txt("ui.time.minutesAgo", "{n}m ago", { n: Math.round(secs / 60) });
  if (secs < 86400) return K.txt("ui.time.hoursAgo", "{n}h ago", { n: Math.round(secs / 3600) });
  if (secs < K.num("ui.time.relativeDays", 7) * 86400) return K.txt("ui.time.daysAgo", "{n}d ago", { n: Math.round(secs / 86400) });
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric", month: K.str("ui.time.month", "short") as "short", ...(sameYear ? {} : { year: "numeric" }),
  });
}

export const TextC = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  const raw = staticText(node, props.content ?? "");
  // `format` lets the backend hand over a machine value and ask for the human
  // one, instead of shipping a pre-formatted string it cannot localise or
  // place in the reader's timezone.
  const shown =
    props.format === "relative" && typeof raw === "string" ? humanTime(raw)
    : props.format === "datetime" && typeof raw === "string" && Number.isFinite(Date.parse(raw))
      ? new Date(raw).toLocaleString(undefined, {
          dateStyle: String(props.dateStyle ?? K.str("ui.Text.dateStyle", "medium")) as "medium",
          timeStyle: String(props.timeStyle ?? K.str("ui.Text.timeStyle", "short")) as "short",
        })
    : raw;
  // A plan's price: the store's own words once it answers (billing/storePrice.ts), the server's until then.
  const storeWords = useStorePrice(props.storePrice);
  const look = [textVariant(props.variant, theme), style];
  return (
    <Text
      style={[...look, tightRoom(look)]}
      // Authored on the history rows and previously dropped, so a long
      // dictation rendered in full and blew the card out.
      numberOfLines={Number(props.numberOfLines) > 0 ? Number(props.numberOfLines) : undefined}
    >
      {storeWords ?? shown}
    </Text>
  );
};
