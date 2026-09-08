/**
 * Component registry — maps SDUI node `type`s to React Native components, plus
 * token-aware styling. The renderer (Renderer.tsx) resolves props/bind/style
 * and hands them to these.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from "expo-audio";
import type { Node, NodeEvent, ThemeTokens } from "./types";
import type { Ctx } from "./actions";
import { Store, getPath } from "./state";
import * as api from "../api";
import { isStreamAvailable, startStream, type LiveSession } from "../../modules/tulmi-stream";
import { VoiceToggle, RefineButton, DraftButton } from "./morphControls";
import { SpringPressable } from "./motion";
import { DictionaryEditor, WordChips } from "./dictionary";
import { Image as ExpoImage } from "expo-image";
import { resolveMedia } from "../media/resolveMedia";

/**
 * Display serif for headings (Plutto uses PlayfairDisplay). We use the platform
 * serif so it works with no bundled font; swap for @expo-google-fonts/playfair
 * later to match exactly. The backend can also override via theme.font.family.
 */
const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });

// --- Theme context ----------------------------------------------------------

export const ThemeContext = createContext<ThemeTokens | null>(null);
export const useTheme = (): ThemeTokens => {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("ThemeContext missing");
  return t;
};

// --- Styling ----------------------------------------------------------------

/**
 * Copy renders EXACTLY as the backend wrote it. This used to Title-Case every
 * static string — which mangled whole body paragraphs into "Tap Tailzu Again
 * And Turn On "Allow Full Access"" and made every screen read broken. Casing
 * is an authoring decision, and the catalog owns the copy; the renderer must
 * never rewrite it. (Overline keeps its uppercase via its own textTransform.)
 */
export function staticText(_node: Node, raw: string): string {
  return raw;
}

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
function readableOn(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg || "").trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000000" : "#ffffff";
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

function textVariant(variant: string | undefined, theme: ThemeTokens): any {
  const f = theme.font.sizes;
  const fam = theme.font.family ?? SERIF;
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

// --- Component props bag ----------------------------------------------------

export interface CompProps {
  node: Node;
  props: Record<string, any>;
  style: any;
  store: Store;
  children: React.ReactNode;
  fire: (event: NodeEvent, value?: any) => void;
  /** Full render context (store + actions + flags + labels + nav). Lets
   *  conditional components (e.g. IfElse) evaluate against real flags. */
  ctx: Ctx;
}

// --- Components -------------------------------------------------------------

const Screen = ({ children, style }: CompProps) => {
  const theme = useTheme();
  // A SCREEN CAN BE TRANSPARENT.
  //
  // The background was pinned to the theme, and a ScrollView's own style is
  // not the same object as its content container — so a screen laid over a
  // full-window backdrop painted the theme's black straight over it. The art
  // was loaded, positioned and completely invisible, which reads as "the
  // upload failed" rather than "the layer order is wrong".
  //
  // backgroundColor is lifted out of the node's style and applied to the
  // ScrollView; everything else still styles the content container, where
  // padding belongs. Say nothing and it is the theme's background, as before.
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, any>;
  const { backgroundColor, ...content } = flat;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: backgroundColor ?? theme.color.bg }}
      contentContainerStyle={[
        {
          paddingHorizontal: theme.space.content ?? theme.space.lg,
          paddingTop: theme.space.contentTop ?? theme.space.lg,
          paddingBottom: 120, // airy scroll buffer (clears the tab bar)
        },
        content,
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
};

/**
 * A box — and, when the backend gives it one, a tappable box.
 *
 * It used to be a bare View, so `on.onPress` on a Stack did nothing at all.
 * Not an error, not a warning: the node rendered perfectly and simply could
 * not be tapped. The Languages rows were built that way and every tap fell
 * through, which is the kind of failure that looks like a backend bug for a
 * day before anyone suspects the container.
 *
 * Pressable only when there is something to press, so the thousands of plain
 * Stacks in the tree keep costing exactly one View.
 */
const Stack = ({ node, props, children, style, fire }: CompProps) => {
  if (!node.on?.onPress && !node.on?.onLongPress) return <View style={style}>{children}</View>;
  // How far it dims under a finger. A Stack is the app's general-purpose
  // pressable — the allow pill, the plan rows, the deck cards are all one —
  // so the one number that says "this was pressed" cannot be fixed in the
  // binary. 1 disables the dim for anything that shows its press another way.
  const pressOpacity = props?.pressOpacity !== undefined ? Number(props.pressOpacity) : 0.6;
  return (
    <Pressable
      onPress={node.on?.onPress ? () => fire("onPress") : undefined}
      onLongPress={node.on?.onLongPress ? () => fire("onLongPress") : undefined}
      // A row of text is not obviously a button, so the press has to say so.
      style={({ pressed }) => [style, pressed && { opacity: pressOpacity }]}
      accessibilityRole="button"
    >
      {children}
    </Pressable>
  );
};

const Spacer = ({ style }: CompProps) => <View style={style.height || style.width ? style : { flex: 1 }} />;

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
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 7 * 86400) return `${Math.round(secs / 86400)}d ago`;
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  });
}

const TextC = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  const raw = staticText(node, props.content ?? "");
  // `format` lets the backend hand over a machine value and ask for the human
  // one, instead of shipping a pre-formatted string it cannot localise or
  // place in the reader's timezone.
  const shown =
    props.format === "relative" && typeof raw === "string" ? humanTime(raw)
    : props.format === "datetime" && typeof raw === "string" && Number.isFinite(Date.parse(raw))
      ? new Date(raw).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : raw;
  return (
    <Text
      style={[textVariant(props.variant, theme), style]}
      // Authored on the history rows and previously dropped, so a long
      // dictation rendered in full and blew the card out.
      numberOfLines={Number(props.numberOfLines) > 0 ? Number(props.numberOfLines) : undefined}
    >
      {shown}
    </Text>
  );
};

const ImageC = ({ props, style }: CompProps) => {
  // Resolve the source through the media registry so both a raw URL string AND
  // a media-key spec ({ key: "card.voice" }) work — the old code fed
  // props.source straight into { uri }, so a { key } object produced a broken
  // image. Use expo-image so remote GIFs animate on both platforms and
  // contentFit ("cover" for a background fill, "contain" for a framed asset)
  // is honored.
  const m = resolveMedia(props.source as any);
  const src = m.kind === "uri" ? { uri: m.uri } : m.kind === "bundled" ? m.source : null;
  // Defaults, and ONLY where the caller left a gap.
  //
  // These used to be unconditional and merged UNDER the incoming style, which
  // meant `aspectRatio: 1.6` survived any style that set width and height but
  // not a ratio — and Yoga, holding a width and a ratio, derives the height
  // and ignores the one it was given. Every full-bleed image in the app came
  // out as a rounded 1.6 landscape strip cropped through its own middle: the
  // opening media, the flow clip, every hero. The style was correct and the
  // default quietly outranked it.
  const s = (StyleSheet.flatten(style as any) ?? {}) as Record<string, any>;
  // Four insets fix both dimensions, so the box is already fully described.
  const pinned =
    s.position === "absolute" &&
    (s.top != null || s.bottom != null) && (s.left != null || s.right != null);
  const base: Record<string, any> = {};
  if (s.width == null && !pinned) base.width = "100%";
  if (s.aspectRatio == null && s.height == null && !pinned) {
    base.aspectRatio = props.aspectRatio ?? 1.6;
  }
  if (s.borderRadius == null) base.borderRadius = 10;
  if (!src) return <View style={[base, style] as any} />;
  return <ExpoImage source={src as any} contentFit={props.contentFit ?? "cover"} style={[base, style] as any} />;
};

const Icon = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ fontSize: 20, color: theme.color.text }, style]}>{props.name}</Text>;
};

// The brand accent — the warm amber the keyboard flashes on every key press.
// Buttons app-wide flash it on tap ("typing has our color" carried into the
// app). Matches the backend's ACCENT_AMBER / keyboard KEY_PRESSED.
export const BRAND_ACCENT = "#E8A23C";

const Button = ({ props, style, fire }: CompProps) => {
  const theme = useTheme();
  const isSecondary = props.variant === "secondary";
  const isGhost = props.variant === "ghost";
  const bg =
    props.variant === "danger" ? theme.color.danger :
    isGhost || isSecondary ? "transparent" : theme.color.primary;
  // Secondary was a hard-coded near-white, which is invisible on a light
  // theme — the tone editor's Edit and Cancel rendered as empty pills for
  // anyone whose phone was in light mode. The theme's own text colour reads
  // on the theme's own surface, in both modes.
  const labelColor = isGhost || isSecondary ? theme.color.text : readableOn(bg);
  return (
    <SpringPressable
      onPress={() => fire("onPress")}
      disabled={props.disabled}
      impactOnRelease={!isSecondary && !isGhost}
      // The press flash. Amber by default because that is the brand's "we
      // heard that"; "none" removes it for a button whose own colour change
      // already says so.
      flashColor={props.flashColor === "none" ? undefined : String(props.flashColor ?? BRAND_ACCENT)}
      style={[
        // paddingHorizontal matters: a hug-width button without it renders the
        // label touching the pill's edges ("Allow Microphone" overflow bug).
        {
          backgroundColor: bg,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.pill,
          paddingVertical: props.paddingVertical !== undefined ? Number(props.paddingVertical) : 17,
          paddingHorizontal: props.paddingHorizontal !== undefined ? Number(props.paddingHorizontal) : 28,
          alignItems: "center",
          justifyContent: "center",
          opacity: props.disabled ? 0.5 : 1,
        },
        // Secondary: a quiet hairline outline (the editorial look the auth
        // screen's social circles use) — the old solid gray chip read heavy
        // and cheap next to the white primary.
        isSecondary ? { borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.04)" } : null,
        style,
      ]}
    >
      {/* The label's own type. It lives inside the component, so without these
          a backend could restyle the pill and never the words on it. */}
      <Text
        style={{
          color: props.labelColor ? String(props.labelColor) : labelColor,
          fontWeight: props.fontWeight ? String(props.fontWeight) as any : (isSecondary ? "600" : "700"),
          fontSize: props.fontSize !== undefined ? Number(props.fontSize) : 16,
          letterSpacing: props.tracking !== undefined ? Number(props.tracking) : 0.4,
        }}
      >
        {props.label ?? ""}
      </Text>
    </SpringPressable>
  );
};

const TextField = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  return (
    <TextInput
      value={String(props.value ?? "")}
      onChangeText={(t) => {
        if (bindPath) store.set(bindPath, t);
        fire("onChange", t);
      }}
      placeholder={props.placeholder}
      placeholderTextColor={theme.color.muted}
      multiline={props.multiline}
      autoCapitalize={props.autoCapitalize}
      autoCorrect={props.autoCorrect}
      style={[
        {
          backgroundColor: theme.color.inputBg, color: theme.color.text, borderRadius: theme.radius.md,
          paddingHorizontal: 12, paddingVertical: 10, minHeight: props.multiline ? 80 : 44,
          borderWidth: 1, borderColor: theme.color.border, textAlignVertical: props.multiline ? "top" : "center",
        },
        style,
      ]}
    />
  );
};

const Chip = ({ props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const selected = props.group ? store.get(props.group) === props.value : !!props.selected;
  return (
    <SpringPressable
      onPress={() => {
        if (props.group) store.set(props.group, props.value);
        fire("onPress");
      }}
      // Chips get a slightly gentler press than buttons — they're smaller.
      pressScale={0.92}
      flashColor={BRAND_ACCENT}
      style={[
        {
          paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1,
          backgroundColor: selected ? theme.color.primary : theme.color.inputBg,
          borderColor: selected ? theme.color.primary : theme.color.border,
        },
        style,
      ]}
    >
      <Text style={{ color: selected ? readableOn(theme.color.primary) : theme.color.muted, fontWeight: selected ? "700" : "400" }}>{props.label ?? ""}</Text>
    </SpringPressable>
  );
};

const Card = ({ node, children, style, fire }: CompProps) => {
  const theme = useTheme();
  const base = { backgroundColor: theme.color.card, borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border };
  // A Card with an onPress handler is tappable. The old Card ignored `fire`
  // entirely, so every Card that carried `on.onPress` (the tone cards on the
  // You tab, media cards, etc.) was silently dead. Wrap it in a gentle
  // SpringPressable when — and only when — an onPress is wired, so plain Cards
  // stay inert Views.
  // onLongPress too. It was never wired, and long-press is the ONLY delete
  // affordance in the app — the history row's "hold to delete" did nothing,
  // so DELETE /v1/history/:id was unreachable from the interface entirely.
  if (node.on?.onPress || node.on?.onLongPress) {
    return (
      <SpringPressable
        onPress={node.on?.onPress ? () => fire("onPress") : undefined}
        onLongPress={node.on?.onLongPress ? () => fire("onLongPress") : undefined}
        pressScale={0.98}
        style={[base, style]}
      >
        {children}
      </SpringPressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
};

const Divider = ({ style }: CompProps) => {
  const theme = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.color.border, marginVertical: 8 }, style]} />;
};

const ProgressBar = ({ style }: CompProps) => {
  const theme = useTheme();
  return <ActivityIndicator color={theme.color.primary} style={style} />;
};

// List is rendered specially by the renderer (needs per-item scope); placeholder here.
const ListPlaceholder = ({ children }: CompProps) => <View>{children}</View>;

// --- SDUI v2 content blocks -------------------------------------------------

// Tiny uppercase kicker above a heading (the Plutto "overline").
const Overline = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ color: theme.color.label, fontSize: theme.font.sizes.overline, letterSpacing: 3, fontWeight: "500", textTransform: "uppercase", marginBottom: 10 }, style]}>{staticText(node, props.content ?? "")}</Text>;
};

const Heading = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  const fam = theme.font.family ?? SERIF;
  return <Text style={[{ fontFamily: fam, color: theme.color.text, fontSize: theme.font.sizes.h1, lineHeight: 34, letterSpacing: 0.3, marginBottom: 24 }, style]}>{staticText(node, props.content ?? "")}</Text>;
};

const Paragraph = ({ node, props, style }: CompProps) => {
  const theme = useTheme();
  return <Text style={[{ color: theme.color.body ?? theme.color.text, fontSize: theme.font.sizes.body, lineHeight: 26, fontWeight: "300", marginBottom: 18 }, style]}>{staticText(node, props.content ?? "")}</Text>;
};

const Quote = ({ props, style }: CompProps) => {
  const theme = useTheme();
  const fam = theme.font.family ?? SERIF;
  return <Text style={[{ fontFamily: fam, color: theme.color.muted, fontSize: theme.font.sizes.lg, lineHeight: 28, fontStyle: "italic", textAlign: "center", marginVertical: 16 }, style]}>{props.content ?? ""}</Text>;
};

const Badge = ({ props, style }: CompProps) => {
  const theme = useTheme();
  // Accept both `label` (canonical) and `text` (used by the paywall plan cards)
  // so a badge is never rendered empty. "brand"/"accent" both map to the accent.
  const tone = props.tone === "accent" || props.tone === "brand" ? theme.color.primary : theme.color.label;
  const content = props.label ?? props.text ?? "";
  return (
    <View style={[{ alignSelf: "flex-start", paddingHorizontal: 11, paddingVertical: 5, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: tone, marginBottom: 24 }, style]}>
      <Text style={{ color: tone, fontSize: theme.font.sizes.overline, fontWeight: "500", letterSpacing: 2.5, textTransform: "uppercase" }}>{content}</Text>
    </View>
  );
};

const KeyValue = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.border }, style]}>
      <Text style={{ color: theme.color.muted, fontSize: theme.font.sizes.body }}>{props.label ?? ""}</Text>
      <Text style={{ color: theme.color.text, fontSize: theme.font.sizes.body, fontWeight: "600" }}>{props.value ?? ""}</Text>
    </View>
  );
};

const Hero = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{ borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: theme.color.card, borderWidth: 1, borderColor: theme.color.border, marginBottom: 12 }, style]}>
      {props.image ? (
        <Image source={{ uri: props.image }} style={{ width: "100%", height: 140 }} />
      ) : null}
      <View style={{ padding: 16 }}>
        {props.title ? <Text style={{ color: theme.color.text, fontSize: theme.font.sizes.h1, fontWeight: "800" }}>{props.title}</Text> : null}
        {props.subtitle ? <Text style={{ color: theme.color.muted, fontSize: theme.font.sizes.body, marginTop: 4 }}>{props.subtitle}</Text> : null}
      </View>
    </View>
  );
};

/**
 * VoiceButton — dictation for the main app, written to bind.value.
 *
 * Two modes, picked by the server:
 *   • Live (props.live === true, native module present): streams mic audio over
 *     a WebSocket and fills the field word-by-word as you speak. See STREAMING.md.
 *   • File-based (default / fallback): records the mic (expo-audio), uploads to
 *     /v1/transcribe-clean, writes the cleaned text once.
 *
 * Live falls back to file-based automatically if the native module is missing.
 */
const VoiceButton = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const bindPath = node.bind?.value;

  // Live (streaming) session + the text committed so far this dictation.
  const live = useRef<{ session: LiveSession | null; committed: string }>({
    session: null,
    committed: "",
  });
  const wantLive = props.live === true && isStreamAvailable();

  // Stop the recorder + live stream on unmount if we're still recording, so a
  // tab switch / navigation / SDUI refetch mid-dictation doesn't leak the mic
  // or the streaming WebSocket. Mirrors VoiceToggle's teardown (morphControls).
  // Idempotent: optional-chaining + `.catch` make a double-stop / not-recording
  // unmount safe.
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => () => {
    if (recordingRef.current) {
      live.current.session?.stop();
      live.current.session = null;
      recorder.stop().catch(() => {});
    }
  }, [recorder]);

  async function startLive() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", "Microphone permission denied");
        return;
      }
      const { url, token } = await api.streamConfig();
      live.current.committed = "";
      setRecording(true);
      const write = (text: string) => {
        if (bindPath) store.set(bindPath, text);
      };
      live.current.session = startStream(
        { url, token, targetApp: props.targetApp, language: props.language },
        {
          onPartial: (t) => write(live.current.committed + t),
          onFinal: (t) => {
            live.current.committed += t.endsWith(" ") ? t : `${t} `;
            write(live.current.committed);
          },
          onError: (m) => {
            fire("onError", m);
            endLive();
          },
          onClosed: async () => {
            endLive();
            const raw = live.current.committed.trim();
            write(raw);
            fire("onChange", raw);
            if (!raw) return;
            // Auto-refine: the raw dictation shows live, then is replaced by the
            // backend's cleaned-up version — no manual "Refine" step.
            try {
              setBusy(true);
              const { refinedText } = await api.refine(raw, {
                targetApp: props.targetApp,
                language: props.language,
              });
              const finalText = refinedText?.trim() || raw;
              write(finalText);
              fire("onChange", finalText);
            } catch {
              // keep the raw transcript if refine fails
            } finally {
              setBusy(false);
            }
          },
        },
      );
    } catch (e: any) {
      fire("onError", e?.message ?? "mic error");
      endLive();
    }
  }

  function stopLive() {
    setBusy(true);
    live.current.session?.stop();
  }

  function endLive() {
    setRecording(false);
    setBusy(false);
    live.current.session = null;
  }

  async function start() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", "Microphone permission denied");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) {
      fire("onError", e?.message ?? "mic error");
    }
  }

  async function stop() {
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No audio captured");
      const { cleanedText } = await api.transcribeClean(uri, {
        targetApp: props.targetApp,
        language: props.language,
      });
      // Only write on a non-empty result — recording silence returns "" and
      // must NOT wipe whatever the user already had in the bound field.
      if (cleanedText) {
        if (bindPath) store.set(bindPath, cleanedText);
        fire("onChange", cleanedText);
      }
    } catch (e: any) {
      fire("onError", e?.message ?? "transcription failed");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? (props.transcribingLabel ?? "Transcribing…")
    : recording
    ? (props.stopLabel ?? "■ Stop & transcribe")
    : (props.label ?? "🎙️ Record");
  const bg = recording ? theme.color.danger : theme.color.primary;

  const onPress = wantLive
    ? recording
      ? stopLive
      : startLive
    : recording
    ? stop
    : start;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[
        { backgroundColor: bg, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center", opacity: busy ? 0.6 : 1 },
        style,
      ]}
    >
      <Text style={{ color: recording ? "#fff" : readableOn(theme.color.primary), fontWeight: "700", fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
};

/**
 * LanguageGreetingGrid — Plutto-style language picker: a large serif greeting
 * that rotates through each language's own "hello", over a centered grid of
 * hairline pills. Pure Animated (no native deps) → ships over OTA.
 *
 * Backend node: { type:"LanguageGreetingGrid", bind:{ value:"language" },
 *   props:{ items:[{ value, label, greeting }] },
 *   on:{ onChange:<set state>, onSubmit:<save + navigate> } }
 * `onSubmit` lets a tap proceed immediately (like Plutto); omit it to keep a
 * separate Continue button. Falls back to a built-in list if items is absent.
 */
const LANG_GREETINGS_FALLBACK = [
  { value: "en", label: "English", greeting: "Hello" },
  { value: "hi", label: "Hindi", greeting: "नमस्ते" },
  { value: "hinglish", label: "Hinglish", greeting: "Namaste" },
  { value: "es", label: "Spanish", greeting: "Hola" },
  { value: "fr", label: "French", greeting: "Bonjour" },
  { value: "ar", label: "Arabic", greeting: "مرحبا" },
  { value: "pt", label: "Portuguese", greeting: "Olá" },
  { value: "auto", label: "Auto-detect", greeting: "Welcome" },
];

const LanguageGreetingGrid = ({ node, props, store, fire }: CompProps) => {
  const theme = useTheme();
  const items: Array<{ value: string; label: string; greeting?: string }> =
    Array.isArray(props.items) && props.items.length ? props.items : LANG_GREETINGS_FALLBACK;
  const bindPath = node.bind?.value;
  const greetings = items.map((i) => i.greeting).filter(Boolean) as string[];

  const [gi, setGi] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    if (greetings.length < 2) return;
    const id = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 280, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setGi((p) => (p + 1) % greetings.length);
        Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
      });
    }, 2500);
    return () => clearInterval(id);
  }, [greetings.length, fade]);

  const select = (value: string) => {
    if (bindPath) store.set(bindPath, value);
    fire("onChange", value);
    fire("onSubmit", value); // backend may map → save + navigate (Plutto proceeds on tap)
  };

  const white = theme.color.text ?? "rgba(255,255,255,0.96)";
  const hair = theme.color.hairline ?? "rgba(255,255,255,0.12)";
  const fam = theme.font?.family ?? SERIF;

  return (
    <View style={{ alignItems: "center", paddingVertical: 28 }}>
      <Animated.Text
        style={{
          fontFamily: fam, fontSize: 46, fontWeight: "300", color: white,
          textAlign: "center", letterSpacing: 0.2, marginBottom: 40, opacity: fade,
        }}
      >
        {greetings.length ? greetings[gi % greetings.length] : "Hello"}
      </Animated.Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
        {items.map((l) => (
          <Pressable
            key={l.value}
            onPress={() => select(l.value)}
            style={({ pressed }) => ({
              minWidth: 104, height: 52, borderRadius: 26, borderWidth: 0.5, borderColor: hair,
              alignItems: "center", justifyContent: "center", paddingHorizontal: 18,
              opacity: pressed ? 0.55 : 1,
            })}
          >
            <Text style={{ color: white, fontSize: 15, fontWeight: "300", letterSpacing: 0.5 }}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

/**
 * Row — a tappable settings/list row: label on the left, an optional value +
 * chevron on the right, separated by a hairline. `danger` tints the label (e.g.
 * Delete account). Fires onPress, and onLongPress when the backend binds one.
 *
 * onLongPress was already in the node event type and had never been wired to
 * anything, so a tree could ask for it and silently get nothing. A row only
 * becomes long-pressable when a handler is actually bound — otherwise a long
 * hold stays an ordinary press, as it was.
 */
const Row = ({ props, style, node, fire }: CompProps) => {
  const theme = useTheme();
  const danger = !!props.danger;
  const showChevron = props.chevron !== false;
  const hasLongPress = !!node?.on?.onLongPress;
  return (
    <Pressable
      onPress={() => fire("onPress")}
      onLongPress={hasLongPress ? () => fire("onLongPress") : undefined}
      delayLongPress={Number(props.longPressMs) > 0 ? Number(props.longPressMs) : 400}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 17,
          borderBottomWidth: props.divider === false ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.color.border,
          opacity: pressed ? 0.55 : 1,
        },
        style,
      ]}
    >
      <Text style={{ flex: 1, color: danger ? theme.color.danger : theme.color.text, fontSize: 16, fontWeight: "400" }}>
        {props.label}
      </Text>
      {props.value ? <Text style={{ color: theme.color.muted, fontSize: 15, marginRight: showChevron ? 8 : 0 }}>{props.value}</Text> : null}
      {showChevron ? <Text style={{ color: theme.color.muted, fontSize: 20, marginTop: -2 }}>›</Text> : null}
    </Pressable>
  );
};

/**
 * Pager — horizontal, full-width paged swipe between child "pages" (e.g. the
 * Refine and Reply playgrounds on Home). On arrival it gives a one-time peek
 * nudge (scrolls a touch and springs back) so the user knows there's more to
 * the side, and shows page dots. Pure RN ScrollView — no extra deps.
 */
const Pager = ({ children, props }: CompProps) => {
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(0);
  const pages = React.Children.toArray(children);
  const hint = props.hint !== false && pages.length > 1;
  const peek = Number(props.peek) || 42;
  // A real spring-driven nudge (not a flat scroll): the page physically slides a
  // little to reveal the next section, then settles back with a soft bounce —
  // so the swipe is discoverable. Drives the ScrollView offset via a listener.
  const nudge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!hint) return;
    const sub = nudge.addListener(({ value }) => ref.current?.scrollTo({ x: value, animated: false }));
    const t = setTimeout(() => {
      Animated.sequence([
        Animated.spring(nudge, { toValue: peek, friction: 6, tension: 70, useNativeDriver: false }),
        Animated.spring(nudge, { toValue: 0, friction: 7, tension: 55, useNativeDriver: false }),
      ]).start(() => nudge.removeListener(sub));
    }, 650);
    return () => { clearTimeout(t); nudge.removeListener(sub); };
  }, [hint, peek, nudge]);

  return (
    <View style={props.height ? { height: Number(props.height) } : { flex: 1 }}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
      >
        {pages.map((p, i) => (
          <View key={i} style={{ width }}>{p}</View>
        ))}
      </ScrollView>
      {pages.length > 1 && (
        <View style={styles_dots.row} pointerEvents="none">
          {pages.map((_, i) => (
            <View key={i} style={[styles_dots.dot, { backgroundColor: i === idx ? "#fff" : "rgba(255,255,255,0.28)" }]} />
          ))}
        </View>
      )}
    </View>
  );
};

const styles_dots = {
  row: { position: "absolute" as const, bottom: 12, left: 0, right: 0, flexDirection: "row" as const, justifyContent: "center" as const, gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
};

import { REGISTRY_V3 } from "./componentsV3";
import { Slideshow } from "./Slideshow";
import { ParticleMark } from "./ParticleMark";
import { ChatThread } from "./ChatThread";
import { Rise } from "./Rise";
import { SwipePill, AppleSignIn, GoogleSignIn, CodeEntry, AuthPhase } from "./authComponents";
import { VoiceBubble } from "./VoiceBubble";
import { SwipeAction } from "./SwipeAction";
import { VoiceSession } from "./VoiceSession";
import { BinaryReveal } from "./BinaryReveal";
import KeyboardPreview from "./KeyboardPreview";
import { MorphOut } from "./MorphOut";
import { WordMeter } from "./WordMeter";

export const REGISTRY: Record<string, React.ComponentType<CompProps>> = {
  Screen, Stack, Spacer, Text: TextC, Image: ImageC, Icon, Button,
  TextField, Chip, Card, Divider, ProgressBar, List: ListPlaceholder, VoiceButton,
  Overline, Heading, Paragraph, Quote, Badge, KeyValue, Hero,
  LanguageGreetingGrid, VoiceToggle, RefineButton, DraftButton, Pager, Row,
  DictionaryEditor, WordChips, Slideshow, ParticleMark, BinaryReveal,
  ChatThread, VoiceBubble, VoiceSession, SwipeAction,
  SwipePill, AppleSignIn, GoogleSignIn, CodeEntry, AuthPhase, Rise,
  KeyboardPreview, MorphOut, WordMeter,
  ...REGISTRY_V3,
};
