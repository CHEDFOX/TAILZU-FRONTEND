/**
 * DottedFrame — a dotted border with round corners, drawn the same on every platform (KitExtras). Android draws a view's
 * `borderStyle: "dotted"` solid once it has a radius, and iOS spaces its dots its own way; an SVG rect with round dots
 * (a dash of nothing, round caps) looks like the window's CSS dotted border everywhere. It lies over its parent, touches
 * pass through it, and the parent keeps its own padding (a border of that width is left for it to sit on).
 */
import React, { useState } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";

export function DottedFrame({ radius, width = 2, color = "#0a0a0a" }: { radius: number; width?: number; color?: string }): React.ReactElement {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const half = width / 2;
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width), h = Math.round(e.nativeEvent.layout.height);
        if (w !== size.w || h !== size.h) setSize({ w, h });
      }}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
    >
      {size.w > 0 && size.h > 0 && (
        <Svg width={size.w} height={size.h}>
          <Rect
            x={half} y={half} width={Math.max(0, size.w - width)} height={Math.max(0, size.h - width)}
            rx={Math.max(0, radius - half)} ry={Math.max(0, radius - half)}
            fill="none" stroke={color} strokeWidth={width}
            // A dot every two widths: a dash of nothing with round caps is a round dot.
            strokeDasharray={`0.01 ${width * 2}`} strokeLinecap="round"
          />
        </Svg>
      )}
    </View>
  );
}

/**
 * A Stack's style with a dotted border and a radius: the frame draws it, so the view's own border is made transparent (it
 * still takes its room, so the content sits where it would).
 */
export function dottedOf(style: Record<string, any> | undefined): { radius: number; width: number; color: string } | null {
  if (!style || style.borderStyle !== "dotted") return null;
  const radius = Number(style.borderRadius) || 0;
  const width = Number(style.borderWidth) || 0;
  if (radius <= 0 || width <= 0) return null;
  return { radius, width, color: typeof style.borderColor === "string" ? style.borderColor : "#0a0a0a" };
}
