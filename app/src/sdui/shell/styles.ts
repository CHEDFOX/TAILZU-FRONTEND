/** The shell's styles: header, tab row, toast, and the developer Connection screen. */
import { StyleSheet } from "react-native";
import { THREAD_RAIL_HEIGHT } from "./ThreadIcons";
import { num } from "../knobs";

/**
 * The tab row's own spacing, named because the rail has to line up with the
 * icons and a rail that floats above or below them looks like a bug rather
 * than like a thread. Derived, not typed twice: the rail sits where the icon
 * centreline sits.
 */
// Module scope: the StyleSheet is built once, after App.tsx has pointed the
// knobs at the last bootstrap on disk.
const TAB_PAD_TOP = num("app.tabs.paddingTop", 12);
const TAB_PAD_V = num("app.tabs.paddingV", 6);
const TAB_ICON = num("app.tabs.iconSize", 26);
export const TAB_RAIL_TOP = TAB_PAD_TOP + TAB_PAD_V + (TAB_ICON - THREAD_RAIL_HEIGHT) / 2;

export const styles = StyleSheet.create({
  app: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingTop: num("app.header.paddingTop", 56),
    paddingBottom: num("app.header.paddingBottom", 12),
    paddingHorizontal: num("app.header.paddingX", 16),
  },
  brand: { fontSize: 22, fontWeight: "800" },
  // 44 square is the target; the negative margins are what keep the chevron
  // where it was and stop the taller box growing the header row.
  back: {
    width: 44, height: 44,
    alignItems: "center", justifyContent: "center",
    marginLeft: -14, marginRight: -10, marginVertical: -8,
  },
  headerIcon: { fontSize: 24, fontWeight: "700" },
  tabs: { flexDirection: "row", borderTopWidth: 1, paddingTop: TAB_PAD_TOP },
  tab: { flex: 1, paddingVertical: TAB_PAD_V, alignItems: "center", justifyContent: "center" },
  // A docked tab. No flex — its size is stated, and the row centres what it
  // is given. Everything that varies comes off navigation.dock.
  chip: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  tabUnderline: { height: 2, width: 28, borderRadius: 2, marginTop: 6 },
  loadingOverlay: { position: "absolute", top: 8, right: 16 },
  toast: { position: "absolute", left: 16, right: 16, padding: 14 },
  input: {
    backgroundColor: "#1c1c25", color: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44, borderWidth: 1, borderColor: "#2a2a36",
  },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
