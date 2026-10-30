/**
 * The Bots kit's layout and drawing nodes: Grid, SafeArea and SVG. Every one
 * reads `node`, `props`, `style`, `children`, `fire` from the standard
 * CompProps interface (see components.tsx).
 *
 * EVERY LOOK HERE IS THE SERVER'S: the node's own prop, then a ui.<Component>.<name>
 * knob, then the literal it has always been. So nothing changes until the server
 * says so, and then it changes for every screen at once, or for one node.
 */
import React from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { CompProps } from "./components";
import * as K from "./knobs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgShapes } from "./SvgShapes";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const Grid = ({ props, children, style }: CompProps) => {
  const columns = Math.max(1, Number(props.columns ?? K.num("ui.Grid.columns", 2)));
  const gap = Number(props.gap ?? K.num("ui.Grid.gap", 12));
  const kids = React.Children.toArray(children);
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 }, style]}>
      {kids.map((k, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, padding: gap / 2 }}>
          {k}
        </View>
      ))}
    </View>
  );
};

/**
 * A box, and — for a Bots app page (the kit) — the device's safe-area insets on the edges it names.
 *
 * `edges` pads those edges by the insets; `inset: "add"` (the default) adds them to the node's own padding on that
 * side, "max" takes the larger of the two (a tab bar's 16 under its icons, or the home indicator's 34, not both).
 * `barStyle` sets the status bar's content colour while the node is up: a white page needs dark content. Without
 * any of them it is the plain flex box it always was.
 */
const SafeArea = ({ props, children, style }: CompProps) => {
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

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const SVGC = ({ props, style }: CompProps) => Array.isArray(props.shapes) ? (
  // The Bots kit's glyphs: several shapes, and the breathe / pop / draw motions (SvgShapes.tsx).
  <View style={style} accessible={!!props.accessibilityLabel} accessibilityLabel={props.accessibilityLabel}>
    <SvgShapes viewBox={String(props.viewBox ?? "0 0 24 24")} shapes={props.shapes} />
  </View>
) : (
  <View style={style}>
    <Svg viewBox={String(props.viewBox ?? K.str("ui.SVG.viewBox", "0 0 100 100"))}>
      <Path
        d={String(props.d ?? "")}
        fill={String(props.fill ?? K.color("ui.SVG.fill", "#fff"))}
        stroke={String(props.stroke ?? "none")}
        strokeWidth={Number(props.strokeWidth ?? 0)}
        // Caps and joins, so a stroked glyph can have soft ends. Without them
        // every backend-drawn icon is cut square — which on a thin ✕ or a
        // chevron is the difference between a drawn mark and a cropped one.
        strokeLinecap={(props.strokeLinecap ?? K.str("ui.SVG.strokeLinecap", "round")) as "butt" | "round" | "square"}
        strokeLinejoin={(props.strokeLinejoin ?? K.str("ui.SVG.strokeLinejoin", "round")) as "miter" | "round" | "bevel"}
      />
    </Svg>
  </View>
);

export const REGISTRY_V3: Record<string, React.ComponentType<CompProps>> = {
  Grid, SafeArea, SVG: SVGC,
};
