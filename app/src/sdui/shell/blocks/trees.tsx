/**
 * THE SHELL AS TREES (pure SPEC 2.10 B11): the tab bar, header, toast, sheet and modal drawn from plain props and the child trees V1
 * has already drawn. Each is a small frame; the content inside is the server's. They are used only when the bootstrap sends the tree
 * (`shell.tabBar`, `shell.header`, `shell.toast`) or a navigate asks for a sheet or modal, and only when this client declared `shell`.
 * Otherwise today's TabBar.tsx, Header.tsx and ToastView.tsx draw, untouched. A bad value clamps; a throw is caught by the node's boundary.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, PanResponder, Pressable, StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
// @ts-ignore pure JS, shipped with react-native; no types
import normalizeColor from "@react-native/normalize-colors";
import { clampDrag, detentHeights, settle } from "./sheetMath";

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
/** A colour only when react-native itself can read it (SPEC 5.4: colours go through the palette parser); else the default. */
const col = (v: unknown, d: string): string => {
  if (typeof v !== "string" || v.length > 64) return d;
  try { return normalizeColor(v) != null ? v : d; } catch { return d; }
};
/** The default panel colour for the current theme. */
const useSurface = (): string => (useColorScheme() === "dark" ? "#1c1c25" : "#ffffff");

export interface TreeHost { dispatch?(actionRef: unknown): void }

/** The tab bar: a row that holds the server's tab items (each a child tree). */
export function TabBarTree({ children, height, background, borderColor, bottomInset }: { children?: ReactNode; height?: number; background?: string; borderColor?: string; bottomInset?: number }) {
  return (
    <View style={[s.tabs, { minHeight: num(height, 56, 40, 120), paddingBottom: num(bottomInset, 0, 0, 80), backgroundColor: col(background, "transparent"), borderTopColor: col(borderColor, "transparent"), borderTopWidth: borderColor ? StyleSheet.hairlineWidth : 0 }]}>
      {children}
    </View>
  );
}

/** The header: leading, centre and trailing child trees on one row. */
export function HeaderTree({ leading, children, trailing, height, background }: { leading?: ReactNode; children?: ReactNode; trailing?: ReactNode; height?: number; background?: string }) {
  return (
    <View style={[s.header, { height: num(height, 48, 32, 120), backgroundColor: col(background, "transparent") }]}>
      <View style={s.side}>{leading}</View>
      <View style={s.centre}>{children}</View>
      <View style={[s.side, { alignItems: "flex-end" }]}>{trailing}</View>
    </View>
  );
}

/** The toast: a line over the bottom of the screen; `children` is what it says. It goes away by itself after `ms`. */
export function ToastTree({ children, bottom, background, ms, onDone }: { children?: ReactNode; bottom?: number; background?: string; ms?: number; onDone?: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  const wait = num(ms, 2500, 800, 10_000);
  useEffect(() => { const t = setTimeout(() => done.current?.(), wait); return () => clearTimeout(t); }, [wait]);
  return (
    <View pointerEvents="none" style={[s.toast, { bottom: num(bottom, 76, 0, 400), backgroundColor: col(background, "#1c1c25") }]} accessibilityLiveRegion="polite">
      {children}
    </View>
  );
}

/** A modal: the server's tree centred over a dimmed screen. Tap outside closes it unless `dismissible` is false. */
export function ModalTree({ children, visible = true, dismissible = true, onClose, backdrop, radius, background }: { children?: ReactNode; visible?: boolean; dismissible?: boolean; onClose?: () => void; backdrop?: string; radius?: number; background?: string }) {
  const surface = useSurface();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={() => { if (dismissible) onClose?.(); }}>
      <Pressable style={[s.backdrop, { backgroundColor: col(backdrop, "rgba(0,0,0,0.5)"), justifyContent: "center" }]} onPress={() => { if (dismissible) onClose?.(); }}>
        <Pressable style={[s.card, { backgroundColor: col(background, surface), borderRadius: num(radius, 16, 0, 40) }]} onPress={() => {}}>{children}</Pressable>
      </Pressable>
    </Modal>
  );
}

/** A sheet from the bottom with detents (sheetMath.ts): drag the handle to move between them or down to close. */
export function SheetTree({ children, detents, initial = 0, visible = true, dismissible = true, onClose, onDetent, backdrop, radius, background }: {
  children?: ReactNode; detents?: unknown; initial?: number; visible?: boolean; dismissible?: boolean;
  onClose?: () => void; onDetent?: (index: number) => void; backdrop?: string; radius?: number; background?: string;
}) {
  const surface = useSurface();
  const { height: screenH } = useWindowDimensions();
  // Depend on the heights' VALUES: a new array with the same numbers (a reload, a state write) must not move the sheet.
  const heights = useMemo(() => detentHeights(detents, screenH), [detents, screenH]);
  const key = heights.join(",");
  const start = Math.min(heights.length - 1, Math.max(0, Math.floor(num(initial, 0))));
  const top = heights[heights.length - 1] ?? 0;
  const [h] = useState(() => new Animated.Value(heights[start] ?? 0));
  const base = useRef(heights[start] ?? 0);
  const cb = useRef({ onClose, onDetent, heights, dismissible });
  cb.current = { onClose, onDetent, heights, dismissible };
  const back = () => { Animated.spring(h, { toValue: base.current, useNativeDriver: true, bounciness: 0 }).start(); };
  const release = (dy: number, vy: number) => {
    const to = settle(cb.current.heights, base.current - dy, -vy * 1000, cb.current.dismissible);
    if (to === "close") { cb.current.onClose?.(); back(); return; }  // if it stays visible it springs back
    base.current = cb.current.heights[to];
    cb.current.onDetent?.(to);
    back();
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_e, g) => h.setValue(clampDrag(cb.current.heights, base.current - g.dy, cb.current.dismissible)),
    onPanResponderRelease: (_e, g) => release(g.dy, g.vy),
    onPanResponderTerminate: (_e, g) => release(g.dy, 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [h]);
  useEffect(() => { base.current = heights[start] ?? 0; h.setValue(base.current); }, [key, start, h]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fixed height at the highest detent, moved with a transform: no layout of the content on every frame.
  const translateY = h.interpolate({ inputRange: [0, Math.max(1, top)], outputRange: [Math.max(1, top), 0], extrapolate: "clamp" });
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={() => { if (dismissible) onClose?.(); }}>
      <Pressable style={[s.backdrop, { backgroundColor: col(backdrop, "rgba(0,0,0,0.4)"), justifyContent: "flex-end" }]} onPress={() => { if (dismissible) onClose?.(); }}>
        <Animated.View style={[s.sheet, { height: top, backgroundColor: col(background, surface), transform: [{ translateY }], borderTopLeftRadius: num(radius, 20, 0, 40), borderTopRightRadius: num(radius, 20, 0, 40) }]}>
          <View {...pan.panHandlers} style={s.grab}><View style={s.grip} /></View>
          <Pressable style={{ flex: 1 }} onPress={() => {}}>{children}</Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  side: { flex: 1, justifyContent: "center" },
  centre: { flex: 2, alignItems: "center", justifyContent: "center" },
  toast: { position: "absolute", left: 16, right: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  backdrop: { flex: 1 },
  card: { marginHorizontal: 24, overflow: "hidden" },
  sheet: { overflow: "hidden" },
  grab: { alignItems: "center", paddingVertical: 8 },
  grip: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.5)" },
});
