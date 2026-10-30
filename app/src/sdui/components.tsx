/**
 * Component registry — maps SDUI node `type`s to React Native components, plus
 * token-aware styling. The renderer (Renderer.tsx) resolves props/bind/style
 * and hands them to these.
 */
import { useStorePrice } from "../billing/storePrice";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  LayoutAnimation,
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
import type { GestureResponderEvent, LayoutChangeEvent, TextStyle } from "react-native";
import type { Node, NodeEvent, ThemeTokens } from "./types";
import type { Ctx } from "./actions";
import { Store, getPath } from "./state";
import { tightRoom } from "./tightText";
import * as api from "../api";
import { errorDetail, streamErrorMessage, userErrorMessage } from "./client";
import { isStreamAvailable, startStream, type LiveSession } from "../../modules/tulmi-stream";
import { VoiceToggle } from "./morphControls";
import { SpringPressable } from "./motion";
import { createHold, type HoldIO } from "./holdToSpeak";
import { Image as ExpoImage } from "expo-image";
import { resolveMedia } from "../media/resolveMedia";
import { useFocusFill } from "../media/focusFill";
import * as K from "./knobs";

/**
 * The platform serif — what the "display" slot draws in until the backend
 * names a face (theme.font.display, or theme.font.family for the whole app).
 * The two faces are knobs too, for a server that wants a different fallback
 * without naming one in the theme.
 */
const serif = () => Platform.select({
  ios: K.str("ui.font.serifIos", "Georgia"),
  android: K.str("ui.font.serifAndroid", "serif"),
  default: K.str("ui.font.serifAndroid", "serif"),
});

/**
 * Resolve a role's family SLOT to a face. "body" is the running face, which
 * is the system font until the theme names one; "display" is the heading
 * face, which is `display`, else `family`, else the platform serif. Anything
 * else is taken as a face name.
 */
export function fontSlot(theme: ThemeTokens, slot: string | undefined): string | undefined {
  if (!slot || slot === "body") return theme.font?.family;
  if (slot === "display") return theme.font?.display ?? theme.font?.family ?? serif();
  return slot;
}

/**
 * A role from the backend's type scale, as a React Native text style.
 *
 * The backend writes the scale; this only translates it. The one thing the
 * device adds is the resolution of slots and colour keys, which cannot be
 * done anywhere else. `fallback` is the renderer's own copy of the role, used
 * only when the theme does not carry it — a bootstrap cached before the scale
 * existed — so nothing goes unsized.
 */
export function typeRole(theme: ThemeTokens, role: string, fallback?: TextStyle): TextStyle {
  const r = theme.font?.roles?.[role];
  if (!r) return fallback ?? {};
  const out: TextStyle = { fontSize: r.size };
  const fam = fontSlot(theme, r.family);
  if (fam) out.fontFamily = fam;
  if (r.weight) out.fontWeight = r.weight as TextStyle["fontWeight"];
  if (r.lineHeight != null) out.lineHeight = r.lineHeight;
  if (r.letterSpacing != null) out.letterSpacing = r.letterSpacing;
  if (r.italic) out.fontStyle = "italic";
  if (r.transform) out.textTransform = r.transform;
  if (r.align) out.textAlign = r.align;
  if (r.color) out.color = theme.color[r.color] ?? r.color;
  if (r.marginTop != null) out.marginTop = r.marginTop;
  if (r.marginBottom != null) out.marginBottom = r.marginBottom;
  if (r.marginVertical != null) out.marginVertical = r.marginVertical;
  return out;
}

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
 * never rewrite it.
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

// --- Component props bag ----------------------------------------------------

export interface CompProps {
  node: Node;
  props: Record<string, any>;
  style: any;
  store: Store;
  children: React.ReactNode;
  fire: (event: NodeEvent, value?: any) => void;
  /** Full render context (store + actions + flags + labels + nav). Lets
   *  a component evaluate conditions against real flags. */
  ctx: Ctx;
}

// --- Components -------------------------------------------------------------

/**
 * HOW TALL ONE SCREENFUL ACTUALLY IS.
 *
 * The window is not the answer. A scroll view sits under whatever chrome the
 * shell is showing — a header, a tab bar, the home indicator's inset — so a
 * pane sized to the WINDOW is taller than the space it is scrolling inside,
 * and whatever sits at the bottom of it starts below the fold. The training
 * tab's way in is at the bottom of its opening pane, which is exactly how a
 * button that used to be on screen ended up under it.
 *
 * Only the scroll view knows its own height, so it is the scroll view that
 * says. The window remains the fallback for a pane that is not inside one.
 */
const ScreenViewport = createContext<number>(0);

/**
 * A FOOTER THE KEYBOARD DOES NOT COVER (a Stack with `keyboard: "above"`).
 *
 * A Bots page's footer (Home's "Ask any bot…", the Code bot's "Tell Code bot what to do") sits under the scroll, outside it,
 * so neither iOS's own inset nor the Screen's room on Android reached it: the keyboard came up over the very field being typed
 * in, and over that field's own Paste menu. While one of ITS fields has the keyboard, the footer takes a bottom margin as tall
 * as the part of it the keyboard would cover, so it sits just above the keyboard and the scroll above gives up the room; what is
 * under it (the tab bar) stays under the keyboard. A field in the scrolling body is the Screen's, as before: the footer stays put.
 */
const FooterField = createContext<((focused: boolean) => void) | null>(null);
/** A footer's field has the keyboard: the Screen leaves the keyboard to the footer (no room of its own on Android, no scroll). */
let footerFocused = false;

function KeyboardAbove({ style, children }: { style: any; children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const [lift, setLift] = useState(0);
  const lifted = useRef(0);
  const focused = useRef(false);
  const kbTop = useRef<number | null>(null);
  const place = useCallback((ms?: number) => {
    const go = (next: number) => {
      if (Math.abs(next - lifted.current) < 1) return;
      if (Platform.OS === "ios") {
        const duration = ms && ms > 0 ? ms : 250;
        LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types.keyboard } });
      }
      lifted.current = next;
      setLift(next);
    };
    const top = kbTop.current;
    if (!focused.current || top == null || !ref.current) { go(0); return; }
    // Where its foot would be with no lift (the margin moves it up by what it is lifted now), against the keyboard's top.
    ref.current.measureInWindow((_x, y, _w, h) => go(Math.max(0, Math.round(y + h + lifted.current - top))));
  }, []);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      kbTop.current = e?.endCoordinates?.screenY ?? null;
      place(e?.duration);
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      kbTop.current = null;
      place(e?.duration);
    });
    return () => { show.remove(); hide.remove(); if (focused.current) footerFocused = false; };
  }, [place]);
  const onField = useCallback((on: boolean) => {
    focused.current = on;
    footerFocused = on;
    // Already up (a field above had it): lift now, the keyboard sends nothing new.
    const m = on && Keyboard.isVisible?.() ? Keyboard.metrics?.() : undefined;
    if (m) kbTop.current = m.screenY;
    place();
  }, [place]);
  const own = Number((StyleSheet.flatten(style) as Record<string, any> | undefined)?.marginBottom ?? 0) || 0;
  return (
    <FooterField.Provider value={onField}>
      <View ref={ref} style={[style, lift ? { marginBottom: own + lift } : null]}>{children}</View>
    </FooterField.Provider>
  );
}

const Screen = ({ props, children, style, ctx }: CompProps) => {
  const [vh, setVh] = useState(0);
  // Pull-a-bot, when the screen on show asks for it (ScreenResponse.pullBot): the same scroll, with a bot in its pull.
  const pull = usePullBot();
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
  /**
   * A SCROLL THAT DOES NOT TAKE THE TOUCH OFF ITS OWN CONTROLS.
   *
   * A scroll view cancels the touches inside it the moment its pan recognizer
   * engages — which is correct for a list of rows and wrong for a screen whose
   * content includes something you DRAG. The training tab's way in is a disc
   * pulled across a pill: nobody draws that arc perfectly level, so the first
   * few points of vertical drift handed the gesture to the scroll, the disc
   * sprang home, and the slide did nothing at all. It only appeared when that
   * screen started scrolling, because a scroll view with nothing to scroll
   * never cancels anything.
   *
   * Asked for by the backend, per screen, because it is a real trade: a screen
   * that holds its touches cannot be scrolled by dragging from ON a control.
   */
  const hold = props?.holdTouches === true;
  /**
   * A FIELD THE KEYBOARD COVERED.
   *
   * A box low on a screen (Connected apps' search sits under every tile) went
   * under the keyboard the moment it was tapped, and what was typed into it
   * could not be seen. iOS lifts the content and scrolls the focused field
   * into view itself, asked with automaticallyAdjustKeyboardInsets. Android
   * does nothing: the app draws edge to edge, so the window no longer shrinks
   * for the keyboard. There the screen gets room under its content as tall as
   * the keyboard, and once that has landed, the focused field is scrolled up
   * to sit just above it.
   */
  const scroll = useRef<ScrollView>(null);
  const scrolled = useRef(0);
  useEffect(() => { pageScrolled(0); }, []);
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      if (footerFocused) return; // the footer's own field: the footer moves (KeyboardAbove), the page does not
      const top = e?.endCoordinates?.screenY ?? 0;
      setKb(e?.endCoordinates?.height ?? 0);
      const input = TextInput.State.currentlyFocusedInput?.() as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
      if (!input?.measureInWindow || !top) return;
      setTimeout(() => input.measureInWindow!((_x, y, _w, h) => {
        const under = y + h + K.num("ui.Screen.keyboardGap", 16) - top;
        if (under > 0) scroll.current?.scrollTo({ y: scrolled.current + under, animated: true });
      }), 60);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const contentStyle = [
    {
      paddingHorizontal: theme.space.content ?? theme.space.lg,
      paddingTop: theme.space.contentTop ?? theme.space.lg,
      // Airy scroll buffer (clears the tab bar).
      paddingBottom: Number(props?.paddingBottom ?? K.num("ui.Screen.paddingBottom", 120)) + kb,
    },
    content,
  ];
  const onScrollY = (y: number) => { scrolled.current = y; pageScrolled(y); };
  const scrollProps = {
    automaticallyAdjustKeyboardInsets: true,
    // For the nodes that follow the page (pageBus.ts): where it is scrolled, where a finger is.
    onTouchStart: (e: GestureResponderEvent) => pageTouched(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onTouchMove: (e: GestureResponderEvent) => pageTouched(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onTouchEnd: () => pageTouched(NaN, NaN),
    scrollEventThrottle: 16,
    onLayout: (e: LayoutChangeEvent) => {
      const h = Math.round(e.nativeEvent.layout.height);
      if (h > 0 && h !== vh) setVh(h);
    },
    style: { flex: 1, backgroundColor: backgroundColor ?? theme.color.bg },
    canCancelContentTouches: !hold,
    directionalLockEnabled: hold,
    keyboardShouldPersistTaps: "handled" as const,
  };
  return (
    <ScreenViewport.Provider value={vh}>
    {pull ? (
      <PullBotScroll spec={pull} scroll={scrollProps} contentStyle={contentStyle} onScrollY={onScrollY} scrollRef={scroll} ctx={ctx}>
        {children}
      </PullBotScroll>
    ) : (
      <ScrollView
        ref={scroll}
        {...scrollProps}
        onScroll={(e) => onScrollY(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={contentStyle}
      >
        {children}
      </ScrollView>
    )}
    </ScreenViewport.Provider>
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
  /**
   * ONE WINDOW TALL, WHATEVER THE WINDOW IS.
   *
   * A screen that scrolls cannot lay its first pane out with flex — a
   * ScrollView's content is sized by its content, so `flex: 1` inside one
   * collapses to nothing and the pane's spacers vanish. The device is the only
   * thing that knows how tall a window is, so it is the device that answers:
   * the backend says "this pane is the opening view", and the height follows
   * the phone rather than a number guessed on a server.
   */
  const fill = props?.fillViewport === true;
  const win = useWindowDimensions();
  // The scroll view's own height when this pane is inside one, the window when
  // it is not. See ScreenViewport: the window is taller than the space the
  // pane actually scrolls in, by exactly the chrome around it, and that
  // difference is a control pushed under the fold.
  const screenH = useContext(ScreenViewport);
  const sized = fill ? [style, { minHeight: screenH || win.height }] : style;
  if (props?.keyboard === "above" && !node.on?.onPress && !node.on?.onLongPress) return <KeyboardAbove style={sized}>{children}</KeyboardAbove>;
  if (!node.on?.onPress && !node.on?.onLongPress) return <View style={sized}>{children}</View>;
  // How far it dims under a finger. A Stack is the app's general-purpose
  // pressable — the allow pill, the plan rows, the deck cards are all one —
  // so the one number that says "this was pressed" cannot be fixed in the
  // binary. 1 disables the dim for anything that shows its press another way.
  const pressOpacity = props?.pressOpacity !== undefined ? Number(props.pressOpacity) : K.num("ui.Stack.pressOpacity", 0.6);
  /**
   * AN EDGE THAT ONLY EXISTS WHILE A FINGER IS ON IT.
   *
   * A border is the loudest thing a row can wear, and on a list where every
   * row is selectable it is loud on all of them at once — which says nothing
   * about which one you are choosing. Drawn on press instead, it says exactly
   * that and nothing the rest of the time.
   *
   * Only while pressed, not for a moment afterwards: a timed flash is a
   * decision about how long, made in the binary, and the press already lasts
   * precisely as long as the user holds it.
   */
  const pressBorderColor = props?.pressBorderColor ? String(props.pressBorderColor) : "";
  const pressBorderWidth = props?.pressBorderWidth !== undefined
    ? Number(props.pressBorderWidth) : K.num("ui.Stack.pressBorderWidth", 1);
  /**
   * HOW FAR PAST ITS OWN EDGE IT STILL ANSWERS.
   *
   * A target the size of the thing drawn is a target the size of the thing
   * drawn, and a small round control — a close arrow, a chevron in a corner —
   * is routinely smaller than the finger reaching for it. The slop is the
   * difference, taken outward, so the control can stay the size it looks best
   * at and still be hit. The backend sets it because the backend decided how
   * big to draw it.
   */
  const hitSlop = props?.hitSlop !== undefined ? Number(props.hitSlop) : undefined;
  return (
    <Pressable
      onPress={node.on?.onPress ? () => fire("onPress") : undefined}
      onLongPress={node.on?.onLongPress ? () => fire("onLongPress") : undefined}
      hitSlop={Number.isFinite(hitSlop) && (hitSlop as number) > 0 ? hitSlop : undefined}
      // A row of text is not obviously a button, so the press has to say so.
      style={({ pressed }) => [
        sized,
        pressed && { opacity: pressOpacity },
        pressed && pressBorderColor
          ? { borderWidth: pressBorderWidth, borderColor: pressBorderColor }
          : null,
      ]}
      accessibilityRole="button"
      // What a screen reader says for a box whose content is a picture (the Bots kit's icon buttons).
      accessibilityLabel={typeof props?.accessibilityLabel === "string" ? props.accessibilityLabel : undefined}
    >
      {children}
    </Pressable>
  );
};

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

const TextC = ({ node, props, style }: CompProps) => {
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

const ImageC = ({ props, style }: CompProps) => {
  // Resolve the source through the media registry so both a raw URL string AND
  // a media-key spec ({ key: "card.voice" }) work — the old code fed
  // props.source straight into { uri }, so a { key } object produced a broken
  // image. Use expo-image so remote GIFs animate on both platforms and
  // contentFit ("cover" for a background fill, "contain" for a framed asset)
  // is honored.
  const m = resolveMedia(props.source as any);
  const src = m.kind === "uri" ? { uri: m.uri } : m.kind === "bundled" ? m.source : null;
  // Called unconditionally — it is a hook, and the early return for a missing
  // source is below it for that reason.
  const placed = useFocusFill(props);
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
    base.aspectRatio = props.aspectRatio ?? K.num("ui.Image.aspectRatio", 1.6);
  }
  if (s.borderRadius == null) base.borderRadius = Number(props.radius ?? K.num("ui.Image.radius", 10));
  if (!src) return <View style={[base, style] as any} />;
  // FOCUS PLACEMENT, the same as Video. When the backend says where the
  // subject sits in the art and where it should land, the still is sized and
  // slid here rather than handed to `cover` and centred. Whether a subject
  // gets cut off the side of the screen has nothing to do with whether it
  // moves, so a still needs this exactly as much as a clip does — it was only
  // ever wired to Video because the first case that needed it was a film.
  if (placed.on) {
    return (
      <View style={[base, style, { overflow: "hidden" }] as any} onLayout={placed.onLayout}>
        {placed.fit ? (
          <ExpoImage
            source={src as any}
            contentFit="cover"
            style={{ position: "absolute", ...placed.fit }}
          />
        ) : null}
      </View>
    );
  }
  return <ExpoImage source={src as any} contentFit={props.contentFit ?? K.str("ui.Image.contentFit", "cover")} style={[base, style] as any} />;
};

// The press flash: a neutral pale-ink veil, like the keyboard's KEY_PRESSED.
// Not the brand amber — amber is only for what is live (recording, listening),
// and a tap is not. It is the ui.Button.flashColor knob,
// read at each press.

const Button = ({ props, style, fire }: CompProps) => {
  const theme = useTheme();
  const isSecondary = props.variant === "secondary";
  const isGhost = props.variant === "ghost";
  const bg =
    props.variant === "danger" ? theme.color.danger :
    isGhost || isSecondary ? K.color("ui.Button.clearBackground", "transparent") : theme.color.primary;
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
      // The press flash, a neutral veil by default ("we heard that" without
      // the live colour); "none" removes it for a button whose own colour
      // change already says so.
      flashColor={props.flashColor === "none" ? undefined : String(props.flashColor ?? K.color("ui.Button.flashColor", "rgba(243,226,198,0.18)"))}
      pressScale={props.pressScale !== undefined ? Number(props.pressScale) : undefined}
      style={[
        // paddingHorizontal matters: a hug-width button without it renders the
        // label touching the pill's edges ("Allow Microphone" overflow bug).
        {
          backgroundColor: bg,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.pill ?? K.num("ui.Button.radius", 999),
          paddingVertical: props.paddingVertical !== undefined ? Number(props.paddingVertical) : K.num("ui.Button.paddingVertical", 17),
          paddingHorizontal: props.paddingHorizontal !== undefined ? Number(props.paddingHorizontal) : K.num("ui.Button.paddingHorizontal", 28),
          alignItems: "center",
          justifyContent: "center",
          opacity: props.disabled ? Number(props.disabledOpacity ?? K.num("ui.Button.disabledOpacity", 0.5)) : 1,
        },
        // Secondary: a quiet hairline outline (the editorial look the auth
        // screen's social circles use) — the old solid gray chip read heavy
        // and cheap next to the white primary.
        isSecondary ? {
          borderWidth: Number(props.borderWidth ?? K.num("ui.Button.secondaryBorderWidth", 1)),
          borderColor: String(props.borderColor ?? K.color("ui.Button.secondaryBorder", "rgba(255,255,255,0.18)")),
          backgroundColor: String(props.background ?? K.color("ui.Button.secondaryFill", "rgba(255,255,255,0.04)")),
        } : null,
        style,
      ]}
    >
      {/* The label's type comes from the scale (button / buttonSecondary);
          a node can still override any of it per button. */}
      <Text
        style={[
          typeRole(theme, isSecondary ? "buttonSecondary" : "button",
            { fontWeight: isSecondary ? "600" : "700", fontSize: 16, letterSpacing: 0.4 }),
          {
            color: props.labelColor ? String(props.labelColor) : labelColor,
            ...(props.fontWeight ? { fontWeight: String(props.fontWeight) as any } : null),
            ...(props.fontSize !== undefined ? { fontSize: Number(props.fontSize) } : null),
            ...(props.tracking !== undefined ? { letterSpacing: Number(props.tracking) } : null),
          },
        ]}
      >
        {props.label ?? ""}
      </Text>
    </SpringPressable>
  );
};

const TextField = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  // In a footer that stays above the keyboard: it moves while this field has it.
  const footer = useContext(FooterField);
  return (
    <TextInput
      value={String(props.value ?? "")}
      onFocus={footer ? () => footer(true) : undefined}
      onBlur={footer ? () => footer(false) : undefined}
      onChangeText={(t) => {
        if (bindPath) store.set(bindPath, t);
        fire("onChange", t);
      }}
      placeholder={props.placeholder}
      placeholderTextColor={props.placeholderColor ?? theme.color.muted}
      // The return key runs the node's on.onSubmit (the Bots app's ask bar sends with it). A field without one
      // keeps the keyboard's own return, as before.
      onSubmitEditing={node.on?.onSubmit ? (e) => fire("onSubmit", e.nativeEvent.text) : undefined}
      returnKeyType={props.returnKeyType}
      submitBehavior={node.on?.onSubmit && !props.multiline ? "blurAndSubmit" : undefined}
      multiline={props.multiline}
      autoCapitalize={props.autoCapitalize}
      autoCorrect={props.autoCorrect}
      style={[
        {
          backgroundColor: props.background ?? theme.color.inputBg, color: props.color ?? theme.color.text,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.md ?? K.num("ui.TextField.radius", 13),
          paddingHorizontal: Number(props.paddingHorizontal ?? K.num("ui.TextField.paddingHorizontal", 12)),
          paddingVertical: Number(props.paddingVertical ?? K.num("ui.TextField.paddingVertical", 10)),
          minHeight: props.multiline
            ? Number(props.minHeightMultiline ?? K.num("ui.TextField.minHeightMultiline", 80))
            : Number(props.minHeight ?? K.num("ui.TextField.minHeight", 44)),
          borderWidth: Number(props.borderWidth ?? K.num("ui.TextField.borderWidth", 1)),
          borderColor: props.borderColor ?? theme.color.border, textAlignVertical: props.multiline ? "top" : "center",
        },
        style,
      ]}
    />
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
 *
 * Two more things the server can ask for, both off unless it does:
 *   • props.hold === true: hold to speak. Press-in starts, release stops, the
 *     way a walkie-talkie works. A press too short to have said anything (under
 *     ui.VoiceButton.holdMinMs) is thrown away and reported as an error, so a
 *     tap is not mistaken for a recording. Always the file-based path: a held
 *     button is a short try-it, not a live session.
 *   • bind.state: where to write what the button is doing, "idle", "recording"
 *     or "busy", so the screen around it can say so (a ring, a line of words).
 * And its children, when it has any, are drawn in place of the label.
 */
const VoiceButton = ({ node, props, style, store, fire, children }: CompProps) => {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const bindPath = node.bind?.value;
  const statePath = node.bind?.state;
  const hold = props.hold === true;

  // Live (streaming) session + the text committed so far this dictation.
  const live = useRef<{ session: LiveSession | null; committed: string }>({
    session: null,
    committed: "",
  });
  const wantLive = props.live === true && !hold && isStreamAvailable();

  // What a failure says. The node's words first, then the ui.VoiceButton.*
  // knobs, then these. These are the ONLY words a failure shows: an error's
  // own message is written for a developer ("Mic start: Error Domain=…") and
  // goes to the log.
  const errPermission = String(props.errorPermission ?? K.txt("ui.VoiceButton.errorPermission", "Microphone permission denied"));
  const errMic = String(props.errorMic ?? K.txt("ui.VoiceButton.errorMic", "Couldn't start the microphone. Try again."));
  const errNoAudio = String(props.errorNoAudio ?? K.txt("ui.VoiceButton.errorNoAudio", "No audio captured"));
  const errTranscribe = String(props.errorTranscribe ?? K.txt("ui.VoiceButton.errorTranscribe", "Couldn't turn that into text. Try again."));
  /** A caught failure, worded; its raw detail goes to the log. */
  const failWith = (e: unknown, fallback: string) => {
    // eslint-disable-next-line no-console
    console.warn("[Tailzu][VoiceButton]", errorDetail(e));
    fire("onError", userErrorMessage(e, fallback));
  };

  // Stop the recorder + live stream on unmount if we're still recording, so a
  // tab switch / navigation / SDUI refetch mid-dictation doesn't leak the mic
  // or the streaming WebSocket. Mirrors VoiceToggle's teardown (morphControls).
  // Idempotent: optional-chaining + `.catch` make a double-stop / not-recording
  // unmount safe. CANCEL, not stop: a graceful stop still delivers onClosed,
  // which refined the text and fired onChange into a screen that had gone.
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  // What the button is doing, for the screen around it. Written only when it
  // changes, and put back to idle when the button goes, so a step that glides
  // away mid-recording does not leave a ring lit behind it.
  useEffect(() => {
    if (!statePath) return;
    const now = busy ? "busy" : recording ? "recording" : "idle";
    if (store.get(statePath) !== now) store.set(statePath, now);
  }, [statePath, busy, recording, store]);
  useEffect(() => () => {
    if (statePath && store.get(statePath) !== "idle") store.set(statePath, "idle");
  }, [statePath, store]);
  useEffect(() => () => {
    if (recordingRef.current) {
      try { live.current.session?.cancel(); } catch { /* already gone */ }
      live.current.session = null;
      recorder.stop().catch(() => {});
    }
  }, [recorder]);

  async function startLive() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        fire("onError", errPermission);
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
          onError: (m, failure) => {
            fire("onError", streamErrorMessage(m, failure.code, { permission: errPermission, other: errMic }));
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
    } catch (e) {
      failWith(e, errMic);
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
        fire("onError", errPermission);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      failWith(e, errMic);
    }
  }

  async function stop() {
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        fire("onError", errNoAudio);
        return;
      }
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
    } catch (e) {
      failWith(e, errTranscribe);
    } finally {
      setBusy(false);
    }
  }

  // HOLD TO SPEAK. The order of events (finger down, recorder ready, finger up,
  // too short to count) is holdToSpeak's, which is tested on its own; what it
  // is told to DO is here. The machine is built once, so it reads the latest
  // closures through a ref (they close over state that changes every render).
  const holdIO = useRef<HoldIO | null>(null);
  holdIO.current = {
    prepare: async () => {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) { fire("onError", errPermission); return false; }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        return true;
      } catch (e) {
        failWith(e, errMic);
        return false;
      }
    },
    record: () => { recorder.record(); setRecording(true); },
    finish: () => stop(),
    discard: async () => {
      // Too short to have said anything: a tap. Drop it, and say so.
      setRecording(false);
      try { await recorder.stop(); } catch { /* nothing was recorded */ }
      fire("onError", errNoAudio);
    },
    busy: () => busy,
    now: () => Date.now(),
    minMs: () => K.num("ui.VoiceButton.holdMinMs", 350),
  };
  const holder = useRef<ReturnType<typeof createHold> | null>(null);
  if (!holder.current) {
    holder.current = createHold({
      prepare: () => holdIO.current!.prepare(),
      record: () => holdIO.current!.record(),
      finish: () => holdIO.current!.finish(),
      discard: () => holdIO.current!.discard(),
      busy: () => holdIO.current!.busy(),
      now: () => holdIO.current!.now(),
      minMs: () => holdIO.current!.minMs(),
    });
  }

  const label = busy
    ? (props.transcribingLabel ?? K.txt("ui.VoiceButton.transcribingLabel", "Transcribing…"))
    : recording
    ? (props.stopLabel ?? K.txt("ui.VoiceButton.stopLabel", "■ Stop & transcribe"))
    : (props.label ?? K.txt("ui.VoiceButton.label", "🎙️ Record"));
  const bg = recording ? (props.recordingBackground ?? theme.color.danger) : (props.background ?? theme.color.primary);

  const onPress = wantLive
    ? recording
      ? stopLive
      : startLive
    : recording
    ? stop
    : start;

  return (
    <Pressable
      // A held button acts on press-in and release, never on the tap between.
      onPress={hold ? undefined : onPress}
      onPressIn={hold ? () => { void holder.current!.press(); } : undefined}
      onPressOut={hold ? () => { void holder.current!.release(); } : undefined}
      disabled={busy}
      // Its children draw the face (an icon, no words), so a held button is
      // named for a screen reader here: the node's own, else the knob's.
      accessibilityRole={hold ? "button" : undefined}
      accessibilityLabel={hold ? String(props.accessibilityLabel || props.label || K.txt("ui.VoiceButton.holdLabel", "Hold to speak")) : undefined}
      style={[
        {
          backgroundColor: bg,
          borderRadius: props.radius !== undefined ? Number(props.radius) : theme.radius.md ?? K.num("ui.VoiceButton.radius", 13),
          paddingVertical: Number(props.paddingVertical ?? K.num("ui.VoiceButton.paddingVertical", 13)),
          alignItems: "center",
          opacity: busy ? Number(props.busyOpacity ?? K.num("ui.VoiceButton.busyOpacity", 0.6)) : 1,
        },
        style,
      ]}
    >
      {/* `children` is an empty ARRAY for a node with none, so length is the
          only honest test (GoogleSignIn learned this the hard way). */}
      {React.Children.count(children) > 0 ? children : (
        <Text
          // ITS FACE, WHEN THE SCREEN SETS ONE. Beside a pill in the app's own
          // face, the theme's bold system "mic" read as a different control,
          // and "■ Stop & transcribe" wrapped to two lines in half a row and
          // stood the button taller than the pill. The server can set the
          // face, size and ink; and the label is one line, whatever it says.
          numberOfLines={1}
          style={[
            typeRole(theme, "mic", { fontWeight: "700", fontSize: 15 }),
            props.fontFamily ? { fontFamily: String(props.fontFamily), fontWeight: "normal" as const } : null,
            props.fontSize != null ? { fontSize: Number(props.fontSize) } : null,
            { color: recording ? String(props.recordingColor ?? K.color("ui.VoiceButton.recordingColor", "#fff")) : props.color ? String(props.color) : readableOn(String(props.background ?? theme.color.primary)) },
          ]}
        >{label}</Text>
      )}
    </Pressable>
  );
};

import { REGISTRY_V3 } from "./componentsV3";
import { Rise } from "./Rise";
import { SwipePill, AppleSignIn, GoogleSignIn, CodeEntry, AuthPhase } from "./authComponents";
import { MorphOut } from "./MorphOut";
import { OnboardStage } from "../onboard/OnboardStage";
import { BlipSpot } from "../onboard/BlipSpot";
import { BlipWalkOut } from "../onboard/BlipWalkOut";
import { BotTiles } from "./BotTiles";
import { BotCard } from "./BotCard";
import { BotBuddy } from "./BotBuddy";
import { HeadBar, LiveMarkNode, WriteOn } from "./HomeHead";
import { LiveView } from "./LiveView";
import { pageScrolled, pageTouched } from "./pageBus";
import { PullBotScroll, usePullBot } from "./PullBot";

/**
 * Every node type this build draws: the Bots app's (its kit, the sign-in's
 * pieces, the keyboard handoff screens' mic) and nothing else. A type that is
 * not here draws its `fallback`, or nothing.
 *
 * Button stays for the bootstrap's launch card (SduiApp's LaunchCardOverlay),
 * which the server still builds from Text and Button.
 */
export const REGISTRY: Record<string, React.ComponentType<CompProps>> = {
  ...REGISTRY_V3,
  Screen, Stack, Text: TextC, Image: ImageC, Button, TextField,
  // The keyboard handoff screens' mic and dictation (keyboard_record, keyboard_primer, flow_arm).
  VoiceButton, VoiceToggle,
  // The sign-in (auth.screen; authRender.tsx) and the onboarding run around it.
  SwipePill, AppleSignIn, GoogleSignIn, CodeEntry, AuthPhase, OnboardStage, BlipSpot,
  // Entrance motion, and the opening scene drawn into what it becomes.
  Rise, MorphOut,
  // The bots: Home's tiles, the card with one on top, a bot's own tiny bot, Home's welcome.
  BotTiles, BotCard, BotBuddy, BlipWalkOut,
  // Home's header, alive (HomeHead.tsx).
  WriteOn, LiveMark: LiveMarkNode, HeadBar,
  // A running page or artifact, sandboxed (LiveView.tsx).
  LiveView,
};
