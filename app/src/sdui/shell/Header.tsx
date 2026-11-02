/** The shell's header: back (or the screen's title) on the left, the Settings lines on the tab roots. */
import { Pressable, Text, View } from "react-native";
import { SettingsLines } from "./ThreadIcons";
import { typeRole } from "../theme/typeRole";
import type { NavApi } from "../actions";
import type { ScreenResponse, ThemeTokens } from "../types";
import { txt, str } from "../knobs";
import { styles } from "./styles";

export function Header({ canGoBack, nav, theme, shown }: { canGoBack: boolean; nav: NavApi; theme: ThemeTokens; shown: ScreenResponse | null }) {
  return (
    <View style={styles.header}>
      {canGoBack ? (
        /**
         * A REAL TARGET, not a character with slop around it.
         *
         * The Pressable wrapped the "‹" and nothing else, so its frame was
         * the frame of a glyph — a few points of ink about ten wide. Slop
         * was the first answer and it is the weaker one: it is honoured
         * only where the touch still lands inside the ancestors' bounds,
         * it is invisible to anyone reading the layout, and it leaves the
         * thing itself the wrong size.
         *
         * The button is now 44 by 44 — the smallest target a thumb hits
         * reliably — with the chevron centred in it. Negative margins pull
         * that box back over the header's padding so the arrow stays where
         * it was drawn and the row keeps its height: the target grew, the
         * design did not move.
         */
        <Pressable
          onPress={nav.back}
          accessibilityRole="button"
          accessibilityLabel={txt("a11y.back", "Back")}
          style={styles.back}
          // What is left over goes up and left — the corner a hand comes
          // from, and the one place nothing else is waiting to take it.
          hitSlop={{ top: 12, bottom: 8, left: 8, right: 0 }}
        >
          <Text style={[typeRole(theme, "headerIcon", styles.headerIcon), { color: theme.color.text }]}>‹</Text>
        </Pressable>
      ) : (
        <Text style={[typeRole(theme, "title", styles.brand), { color: theme.color.text, flex: 1 }]} numberOfLines={1}>{shown?.title ?? txt("app.name", "X0 Bot")}</Text>
      )}
      {canGoBack && <Text style={[typeRole(theme, "title", styles.brand), { color: theme.color.text, flex: 1, marginLeft: 8 }]} numberOfLines={1}>{shown?.title ?? ""}</Text>}
      {/* Settings gear — top-right on the tab roots (Home / You). Opens the
          Settings screen (pushed, with a back arrow). Replaces the old dev
          "Connection" entry, and stands in for the removed Settings tab.
          Hidden on pushed screens, where the back arrow + title own the bar. */}
      {!canGoBack && (
        <Pressable onPress={() => nav.push(str("nav.settingsScreenId", "settings"))} hitSlop={12} accessibilityLabel={txt("a11y.settings", "Settings")}>
          <SettingsLines color={theme.color.muted} />
        </Pressable>
      )}
    </View>
  );
}
