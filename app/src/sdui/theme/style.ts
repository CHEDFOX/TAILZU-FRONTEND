/**
 * A node's style bag (the SDUI short keys, React Native names, "$token" references) resolved against the theme into
 * a React Native style, and the ink that reads on a given ground.
 */
import type { ThemeTokens } from "../types";
import { getPath } from "../state";
import * as K from "../knobs";

/** Resolve a "$color.primary"-style token against the theme, else pass through. */
export function tok(value: any, theme: ThemeTokens): any {
  if (typeof value === "string" && value.startsWith("$")) return getPath(theme, value.slice(1));
  return value;
}

/**
 * Black or white, whichever reads on `bg` — so a white button gets dark text
 * and a dark button gets white. Lets the backend set any primary color (white
 * for the app's white buttons, or the sacred orange) without breaking labels.
 */
export function readableOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg || "").trim());
  if (!m) return K.color("ui.readableOn.unknown", "#fff");
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > K.num("ui.readableOn.threshold", 0.6)
    ? K.color("ui.readableOn.dark", "#000000")
    : K.color("ui.readableOn.light", "#ffffff");
}

/**
 * SDUI-canonical keys that are RENAMED on the way through, so the passthrough
 * below must not copy them across under their original names — `direction` is
 * not a React Native style, and setting it would make Yoga read right-to-left.
 */
const RESHAPED = new Set([
  "direction", "align", "justify", "wrap", "background", "radius", "alignSelf",
]);

const ALIGN: Record<string, any> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const JUSTIFY: Record<string, any> = {
  start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around",
};

export function resolveStyle(style: Record<string, any> | undefined, theme: ThemeTokens): any {
  if (!style) return {};
  const s = style;
  const out: Record<string, any> = {};
  if (s.flex != null) out.flex = s.flex;
  if (s.direction) out.flexDirection = s.direction;
  if (s.align) out.alignItems = ALIGN[s.align];
  if (s.justify) out.justifyContent = JUSTIFY[s.justify];
  if (s.wrap) out.flexWrap = "wrap";
  if (s.gap != null) out.gap = tok(s.gap, theme);
  if (s.padding != null) out.padding = tok(s.padding, theme);
  if (s.margin != null) out.margin = tok(s.margin, theme);
  if (s.width != null) out.width = tok(s.width, theme);
  if (s.height != null) out.height = tok(s.height, theme);
  if (s.opacity != null) out.opacity = s.opacity;
  if (s.background != null) out.backgroundColor = tok(s.background, theme);
  if (s.color != null) out.color = tok(s.color, theme);
  if (s.radius != null) out.borderRadius = tok(s.radius, theme);
  if (s.borderWidth != null) out.borderWidth = s.borderWidth;
  if (s.borderColor != null) out.borderColor = tok(s.borderColor, theme);
  if (s.fontSize != null) out.fontSize = tok(s.fontSize, theme);
  if (s.fontWeight != null) out.fontWeight = tok(s.fontWeight, theme);
  if (s.textAlign != null) out.textAlign = s.textAlign;
  // Positioning + insets + per-side spacing — lets the backend lay out overlays
  // (e.g. the voice toggle pinned to the type box's right edge) declaratively.
  if (s.position) out.position = s.position;
  if (s.top != null) out.top = tok(s.top, theme);
  if (s.right != null) out.right = tok(s.right, theme);
  if (s.bottom != null) out.bottom = tok(s.bottom, theme);
  if (s.left != null) out.left = tok(s.left, theme);
  if (s.zIndex != null) out.zIndex = s.zIndex;
  if (s.alignSelf) out.alignSelf = ALIGN[s.alignSelf] ?? s.alignSelf;
  if (s.overflow) out.overflow = s.overflow;
  if (s.minHeight != null) out.minHeight = tok(s.minHeight, theme);
  if (s.minWidth != null) out.minWidth = tok(s.minWidth, theme);
  if (s.maxWidth != null) out.maxWidth = tok(s.maxWidth, theme);
  if (s.maxHeight != null) out.maxHeight = tok(s.maxHeight, theme);
  // RN/CSS-flavored aliases. The newer catalog screens (personality, paywall,
  // overlays) author styles with React Native property names directly
  // (flexDirection / alignItems / backgroundColor / borderRadius / aspectRatio…)
  // instead of the SDUI-canonical short keys (direction / align / background /
  // radius) handled above. Without these passthroughs every `flexDirection:"row"`
  // was dropped and the row collapsed to a column, and fills/radii vanished.
  // Colors + dimensions route through `tok` so theme tokens still resolve.
  if (s.flexDirection) out.flexDirection = s.flexDirection;
  if (s.alignItems) out.alignItems = s.alignItems;
  if (s.justifyContent) out.justifyContent = s.justifyContent;
  if (s.alignContent) out.alignContent = s.alignContent;
  if (s.flexWrap) out.flexWrap = s.flexWrap;
  if (s.flexGrow != null) out.flexGrow = s.flexGrow;
  if (s.flexShrink != null) out.flexShrink = s.flexShrink;
  if (s.flexBasis != null) out.flexBasis = s.flexBasis;
  if (s.aspectRatio != null) out.aspectRatio = s.aspectRatio;
  if (s.backgroundColor != null) out.backgroundColor = tok(s.backgroundColor, theme);
  if (s.borderRadius != null) out.borderRadius = tok(s.borderRadius, theme);
  if (s.lineHeight != null) out.lineHeight = tok(s.lineHeight, theme);
  if (s.letterSpacing != null) out.letterSpacing = s.letterSpacing;
  if (s.textTransform) out.textTransform = s.textTransform;
  for (const k of ["marginTop", "marginBottom", "marginLeft", "marginRight", "marginHorizontal", "marginVertical",
                   "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "paddingHorizontal", "paddingVertical"]) {
    if (s[k] != null) out[k] = tok(s[k], theme);
  }
  // THE ESCAPE HATCH.
  //
  // Everything above is a whitelist, and a whitelist DROPS WHAT IT DOES NOT
  // KNOW — silently, which is the worst way to fail: a screen sets something,
  // nothing happens, and there is no error to follow. Every key that reaches
  // this point has already been given the token treatment it needs, so the
  // rest pass through untouched.
  //
  // `transform` is the one worth naming. It is an ARRAY of operations in React
  // Native, so it could never have been a whitelist entry alongside the
  // scalars, and without it no backend-authored node could rotate, scale or
  // translate at all — which is the whole of the You tab's card deck.
  for (const k of Object.keys(s)) {
    if (out[k] !== undefined || RESHAPED.has(k)) continue;
    out[k] = typeof s[k] === "string" && s[k].startsWith("$") ? tok(s[k], theme) : s[k];
  }
  // Typography, borders and shadows the backend could not reach before.
  //
  // fontFamily is the significant one: the theme could set ONE family for the
  // whole app and no node could differ, so any typographic pairing — a serif
  // display over a sans body — needed a build. It resolves through `tok`, so
  // "$font.family" works alongside a literal name.
  if (s.fontFamily != null) out.fontFamily = tok(s.fontFamily, theme);
  if (s.fontStyle) out.fontStyle = s.fontStyle;
  if (s.textDecorationLine) out.textDecorationLine = s.textDecorationLine;
  // Per-corner radius and per-side borders — a card with one rounded edge, or
  // a rule under a heading, were both impossible to express.
  for (const k of ["borderTopLeftRadius", "borderTopRightRadius",
                   "borderBottomLeftRadius", "borderBottomRightRadius",
                   "borderTopWidth", "borderBottomWidth", "borderLeftWidth", "borderRightWidth"]) {
    if (s[k] != null) out[k] = tok(s[k], theme);
  }
  for (const k of ["borderTopColor", "borderBottomColor", "borderLeftColor", "borderRightColor"]) {
    if (s[k] != null) out[k] = tok(s[k], theme);
  }
  if (s.borderStyle) out.borderStyle = s.borderStyle;
  // Elevation. iOS wants the four shadow props, Android wants `elevation`;
  // both are passed so one style works on both.
  if (s.shadowColor != null) out.shadowColor = tok(s.shadowColor, theme);
  if (s.shadowOpacity != null) out.shadowOpacity = s.shadowOpacity;
  if (s.shadowRadius != null) out.shadowRadius = s.shadowRadius;
  if (s.shadowOffset != null) out.shadowOffset = s.shadowOffset;
  if (s.elevation != null) out.elevation = s.elevation;
  if (s.rowGap != null) out.rowGap = tok(s.rowGap, theme);
  if (s.columnGap != null) out.columnGap = tok(s.columnGap, theme);
  return out;
}
