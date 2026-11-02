/** SVG: a server-drawn glyph — one path, or the Bots kit's animated shapes (SvgShapes.tsx). */
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as K from "../knobs";
import type { CompProps } from "./props";
import { SvgShapes } from "./SvgShapes";

export const SVGC = ({ props, style }: CompProps) => Array.isArray(props.shapes) ? (
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
