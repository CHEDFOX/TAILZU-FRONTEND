import { StatusBar, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CompProps } from "./props";

/**
 * A box, and — for a Bots app page (the kit) — the device's safe-area insets on the edges it names.
 *
 * `edges` pads those edges by the insets; `inset: "add"` (the default) adds them to the node's own padding on that
 * side, "max" takes the larger of the two (a tab bar's 16 under its icons, or the home indicator's 34, not both).
 * `barStyle` sets the status bar's content colour while the node is up: a white page needs dark content. Without
 * any of them it is the plain flex box it always was.
 */
export const SafeArea = ({ props, children, style }: CompProps) => {
  const insets = useSafeAreaInsets();
  const edges: string[] = Array.isArray(props?.edges) ? props.edges.map(String) : [];
  if (!edges.length && !props?.barStyle) return <View style={[{ flex: 1 }, style]}>{children}</View>;
  // flex 1 unless the node sizes itself: a tab bar at the foot of a page is as tall as its content.
  const own = (StyleSheet.flatten(style) ?? {}) as Record<string, any>;
  const flat = (own.flex === undefined && own.flexGrow === undefined ? { flex: 1, ...own } : own) as Record<string, any>;
  const max = props?.inset === "max";
  const side = (edge: "top" | "bottom" | "left" | "right", inset: number) => {
    const key = `padding${edge[0]!.toUpperCase()}${edge.slice(1)}`;
    const axis = edge === "top" || edge === "bottom" ? flat.paddingVertical : flat.paddingHorizontal;
    const own = Number(flat[key] ?? axis ?? flat.padding ?? 0) || 0;
    return { [key]: max ? Math.max(own, inset) : own + inset };
  };
  const pad = Object.assign({},
    ...(edges.includes("top") ? [side("top", insets.top)] : []),
    ...(edges.includes("bottom") ? [side("bottom", insets.bottom)] : []),
    ...(edges.includes("left") ? [side("left", insets.left)] : []),
    ...(edges.includes("right") ? [side("right", insets.right)] : []));
  return (
    <View style={[flat, pad]}>
      {props?.barStyle === "dark-content" || props?.barStyle === "light-content"
        ? <StatusBar barStyle={props.barStyle} />
        : null}
      {children}
    </View>
  );
};
