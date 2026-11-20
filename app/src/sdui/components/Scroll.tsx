/**
 * Scroll: its children in a box that scrolls on its own, inside a card (the terms and privacy card on Home). Its size and look are the
 * node's style (maxHeight, radius, fill); its gap and padding go to the content. The bar flashes once on open, so it reads as more below.
 *
 * `horizontal` (ScrollX): it scrolls SIDEWAYS instead — a week of days, a row of anything longer than the screen. The direction has to
 * reach the CONTENT, not the box: a ScrollView lays its children out in contentContainerStyle, so a flexDirection left on the outer
 * style does nothing and the row comes out as a column. That is why this is a capability and not merely a style — a build without it
 * would draw the week down the screen.
 */
import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, type ViewStyle } from "react-native";
import type { CompProps } from "./props";
import { publishScroll, useScrollInto } from "../motion/scroll";

const INNER = ["gap", "rowGap", "columnGap", "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] as const;
/** Sideways, these lay the CONTENT out and belong with it; left on the box they would do nothing. */
const INNER_X = ["flexDirection", "alignItems", "justifyContent"] as const;

export const Scroll = ({ children, style, props }: CompProps) => {
  const horizontal = props?.horizontal === true;
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle & Record<string, unknown>;
  const outer: Record<string, unknown> = {}, inner: Record<string, unknown> = {};
  const toInner = (k: string) => (INNER as readonly string[]).includes(k) || (horizontal && (INNER_X as readonly string[]).includes(k));
  for (const [k, v] of Object.entries(flat)) (toInner(k) ? inner : outer)[k] = v;
  if (horizontal && inner.flexDirection === undefined) inner.flexDirection = "row";
  if (horizontal && inner.alignItems === undefined) inner.alignItems = "center";
  const ref = useRef<ScrollView>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.flashScrollIndicators(), 400); return () => clearTimeout(t); }, []);
  // KitExtras `startAtEnd`: it opens at its end, and stays there while content grows if the person is within 80 px of it.
  const atEnd = props?.startAtEnd === true;
  const ends = useRef({ y: 0, view: 0, content: 0, first: true });
  // Scroll offset as a `ui.*` value, when this box asked for one (`scrollInto`): sdui/motion/scroll.ts.
  const into = useScrollInto(props);
  const onSize = (w: number, h: number) => {
    const e = ends.current;
    const near = e.first || e.y + e.view >= e.content - 80;
    e.content = horizontal ? w : h;
    if (atEnd && near && h > 0) { const first = e.first; e.first = false; requestAnimationFrame(() => ref.current?.scrollToEnd({ animated: !first })); }
  };
  return (
    <ScrollView ref={ref} horizontal={horizontal} style={[{ flexGrow: 0 }, outer as ViewStyle]} contentContainerStyle={inner as ViewStyle}
      onContentSizeChange={onSize} scrollEventThrottle={32}
      onScroll={atEnd || into ? (e) => {
        const at = horizontal ? e.nativeEvent.contentOffset.x : e.nativeEvent.contentOffset.y;
        if (atEnd) ends.current.y = at;
        if (into) publishScroll(into, at);
      } : undefined}
      onLayout={(e) => { ends.current.view = horizontal ? e.nativeEvent.layout.width : e.nativeEvent.layout.height; }}
      showsVerticalScrollIndicator={!horizontal} showsHorizontalScrollIndicator={false}
      persistentScrollbar nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
};
