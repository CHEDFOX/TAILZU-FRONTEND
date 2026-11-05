/**
 * Scroll: its children in a box that scrolls on its own, inside a card (the terms and privacy card on Home). Its size and look are the
 * node's style (maxHeight, radius, fill); its gap and padding go to the content. The bar flashes once on open, so it reads as more below.
 */
import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, type ViewStyle } from "react-native";
import type { CompProps } from "./props";

const INNER = ["gap", "rowGap", "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"] as const;

export const Scroll = ({ children, style }: CompProps) => {
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle & Record<string, unknown>;
  const outer: Record<string, unknown> = {}, inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) ((INNER as readonly string[]).includes(k) ? inner : outer)[k] = v;
  const ref = useRef<ScrollView>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.flashScrollIndicators(), 400); return () => clearTimeout(t); }, []);
  return (
    <ScrollView ref={ref} style={[{ flexGrow: 0 }, outer as ViewStyle]} contentContainerStyle={inner as ViewStyle}
      showsVerticalScrollIndicator persistentScrollbar nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
};
