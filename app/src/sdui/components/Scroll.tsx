/**
 * Scroll: its children in a box that scrolls on its own, inside a card (the terms and privacy card on Home). Its size and look are the
 * node's style (maxHeight, radius, fill); its gap and padding go to the content. The bar flashes once on open, so it reads as more below.
 */
import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, type ViewStyle } from "react-native";
import type { CompProps } from "./props";
import { publishScroll, useScrollInto } from "../motion/scroll";

const INNER = ["gap", "rowGap", "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] as const;

export const Scroll = ({ children, style, props }: CompProps) => {
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle & Record<string, unknown>;
  const outer: Record<string, unknown> = {}, inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) ((INNER as readonly string[]).includes(k) ? inner : outer)[k] = v;
  const ref = useRef<ScrollView>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.flashScrollIndicators(), 400); return () => clearTimeout(t); }, []);
  // KitExtras `startAtEnd`: it opens at its end, and stays there while content grows if the person is within 80 px of it.
  const atEnd = props?.startAtEnd === true;
  const ends = useRef({ y: 0, view: 0, content: 0, first: true });
  // Scroll offset as a `ui.*` value, when this box asked for one (`scrollInto`): sdui/motion/scroll.ts.
  const into = useScrollInto(props);
  const onSize = (_w: number, h: number) => {
    const e = ends.current;
    const near = e.first || e.y + e.view >= e.content - 80;
    e.content = h;
    if (atEnd && near && h > 0) { const first = e.first; e.first = false; requestAnimationFrame(() => ref.current?.scrollToEnd({ animated: !first })); }
  };
  return (
    <ScrollView ref={ref} style={[{ flexGrow: 0 }, outer as ViewStyle]} contentContainerStyle={inner as ViewStyle}
      onContentSizeChange={onSize} scrollEventThrottle={32}
      onScroll={atEnd || into ? (e) => {
        const y = e.nativeEvent.contentOffset.y;
        if (atEnd) ends.current.y = y;
        if (into) publishScroll(into, y);
      } : undefined}
      onLayout={(e) => { ends.current.view = e.nativeEvent.layout.height; }}
      showsVerticalScrollIndicator persistentScrollbar nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
};
