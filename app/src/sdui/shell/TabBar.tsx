/** The tab row: a full-width bar tied by its thread, or a centred dock of squares when the server sends one. */
import { Pressable, StyleSheet, View } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { TabThreadIcon, ThreadRail } from "./ThreadIcons";
import type { NavApi } from "../actions";
import type { BootstrapResponse, ThemeTokens } from "../types";
import { num, color } from "../knobs";
import type { SetState } from "./types";
import { styles, TAB_RAIL_TOP } from "./styles";

type TabsNavigation = Extract<BootstrapResponse["navigation"], { kind: "tabs" }>;

export function TabBar({ boot, theme, insets, dock, tabs, tabsWidth, setTabsWidth, tabId, tabPluck, setTabPluck, nav }: {
  boot: BootstrapResponse | null; theme: ThemeTokens; insets: EdgeInsets;
  dock: TabsNavigation["dock"]; tabs: TabsNavigation["tabs"];
  tabsWidth: number; setTabsWidth: (w: number) => void; tabId: string;
  tabPluck: number; setTabPluck: SetState<number>; nav: NavApi;
}) {
  return (
    <View style={[styles.tabs, {
      // NO PLATE UNDER THE TABS.
      //
      // The bar had its own surface colour and a hairline above it, which
      // is what a tab bar needs when it is a strip of labels sitting on
      // scrolling content. It is not what these need: three marks that
      // appear and disappear read as objects on the app's own ground, and
      // a panel behind them puts a box around the quietest thing on the
      // screen.
      //
      // The colours still come from the theme, so a future ground that
      // needs the separation can have it back by sending one.
      backgroundColor: theme.color.tabBar ?? color("app.color.tabBar", "transparent"),
      borderTopColor: theme.color.tabBarBorder ?? color("app.color.tabBarBorder", "transparent"),
      borderTopWidth: theme.color.tabBarBorder ? StyleSheet.hairlineWidth : 0,
      // Lift the row clear of the system gesture area on BOTH platforms.
      // There was no inset at all, so the tabs sat directly against the
      // home indicator on iPhone and the gesture bar on Android — a tap
      // near the bottom of a tab went to the OS, not to us. The floor keeps
      // a comfortable strip on hardware with no inset to report.
      paddingBottom: Math.max(insets.bottom, num("app.tabs.minBottomInset", 12)) + (dock?.lift ?? num("app.tabs.lift", 6)),
      // A DOCK IS CENTRED; A BAR IS SPREAD. The tabs themselves carry no
      // flex when docked, so the row has to be the thing that gathers them.
      ...(dock ? { justifyContent: "center" as const, paddingTop: num("app.tabs.dockPaddingTop", 10) } : null),
    }]}
    onLayout={(e) => setTabsWidth(e.nativeEvent.layout.width)}>
      {/* The thread that makes the row one object rather than three icons.
          Behind them, and untouchable — it reports where you are, it is
          never something to press. */}
      {/* Never under a dock: the rail exists to tie a spread-out row into
          one object, and squares sitting together already are one. A
          thread running between them would be drawing the join twice. */}
      {!dock && (boot?.navigation.kind !== "tabs" || boot.navigation.rail !== false) && (
        <ThreadRail
          width={tabsWidth}
          count={tabs.length}
          index={Math.max(0, tabs.findIndex((t) => t.id === tabId))}
          color={theme.color.muted}
          top={TAB_RAIL_TOP}
        />
      )}
      {tabs.map((t) => {
        const active = t.id === tabId;
        return (
          <Pressable
            key={t.id}
            // Docked, a tab is a square of a stated size on its own ground;
            // undocked it is a share of the row, which is what every build
            // before the dock existed drew. The server decides which by
            // sending the block or not.
            style={dock ? [styles.chip, {
              width: dock.size,
              height: dock.size,
              borderRadius: dock.radius,
              backgroundColor: active
                ? (dock.activeBackground ?? dock.background)
                : dock.background,
              marginHorizontal: dock.gap / 2,
            }] : styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.title}
            onPress={() => {
              // Bump the nonce so tapping the tab you are already on
              // plucks the thread again — the tap should always feel
              // answered, not only when it changes screens.
              setTabPluck((n) => n + 1);
              nav.switchTab(t.id);
            }}
          >
            <TabThreadIcon
              id={t.id}
              title={t.title}
              active={active}
              color={theme.color.muted}
              nonce={tabPluck}
              surface={theme.color.surface}
              glyph={t.glyph}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
