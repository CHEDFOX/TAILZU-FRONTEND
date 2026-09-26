/**
 * SDUI v3 components — the "kitchen sink" batch added so future features go
 * backend-JSON-only. Every component here reads `node`, `props`, `style`,
 * `children`, `fire` from the standard CompProps interface (see components.tsx).
 * Kept in its own file so the v1/v2 primitives stay easy to audit.
 *
 * EVERY LOOK HERE IS THE SERVER'S. These were a module-level StyleSheet of
 * dark literals — white text, near-black cards — fixed at load, so a light
 * theme drew white on white and nothing short of a build could change it.
 * Each value is now resolved at render, the same way everywhere:
 *
 *   the node's own prop  →  the theme token, where one draws exactly what
 *   this always drew (the cards' #0b0b0f is theme.color.card)  →  a
 *   ui.<Component>.<name> knob  →  the literal it used to be.
 *
 * So nothing changes until the server says so, and then it changes for every
 * screen at once, or for one node.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Easing, Modal as RNModal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Slider from "@react-native-community/slider";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Image as ExpoImage } from "expo-image";
import Svg, { Circle, Path, Polyline } from "react-native-svg";
import QRCode from "react-native-qrcode-svg";
import { useFocusFill } from "../media/focusFill";
import { WebView } from "react-native-webview";

import type { CompProps } from "./components";
import { useTheme } from "./components";
import { evalCondition } from "./actions";
import { MediaPlayer } from "../media/MediaPlayer";
import { resolveMedia } from "../media/resolveMedia";
import * as K from "./knobs";

/** A number from a prop when it parses, else undefined — so `??` falls through. */
const pn = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
/** A string from a prop when present, else undefined. */
const ps = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

/** The platform's monospace face, for the countdown's digits. */
const mono = () => (Platform.OS === "ios"
  ? K.str("ui.Countdown.fontIos", "Menlo")
  : K.str("ui.Countdown.fontAndroid", "monospace"));

// ---------------------------------------------------------------------------
// Layout / navigation
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

// MasonryGrid: like Grid but tries to distribute across N columns by index —
// good enough without measuring child heights (cheap, matches most feeds).
const MasonryGrid = ({ props, children, style }: CompProps) => {
  const columns = Math.max(1, Number(props.columns ?? K.num("ui.MasonryGrid.columns", 2)));
  const gap = Number(props.gap ?? K.num("ui.MasonryGrid.gap", 12));
  const kids = React.Children.toArray(children);
  const cols: React.ReactNode[][] = Array.from({ length: columns }, () => []);
  kids.forEach((k, i) => cols[i % columns].push(k));
  return (
    <View style={[{ flexDirection: "row", marginHorizontal: -gap / 2 }, style]}>
      {cols.map((col, i) => (
        <View key={i} style={{ flex: 1, paddingHorizontal: gap / 2 }}>
          {col.map((k, j) => (
            <View key={j} style={{ marginBottom: gap }}>{k}</View>
          ))}
        </View>
      ))}
    </View>
  );
};

/** The dim behind a modal or a sheet. */
const scrimColor = (props: Record<string, any>, key: "plain" | "blur") =>
  ps(props.scrimColor) ?? (key === "blur"
    ? K.color("ui.Modal.scrimBlur", "rgba(0,0,0,0.2)")
    : K.color("ui.Modal.scrim", "rgba(0,0,0,0.5)"));

const ModalC = ({ node, props, children, fire, store, style }: CompProps) => {
  const theme = useTheme();
  const bindKey = node.bind?.open;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const open = bindKey ? !!store.get(bindKey) : !!props.open;
  const dismissable = props.dismissable !== false;
  const close = () => {
    if (bindKey) store.set(bindKey, false);
    fire("onDismiss");
  };
  const scrimPad = pn(props.scrimPadding) ?? K.num("ui.Modal.scrimPadding", 24);
  const card = {
    backgroundColor: ps(props.cardBackground) ?? theme.color.card ?? K.color("ui.Modal.cardBackground", "#0b0b0f"),
    borderRadius: pn(props.radius) ?? K.num("ui.Modal.radius", 16),
    padding: pn(props.padding) ?? K.num("ui.Modal.padding", 20),
    minWidth: pn(props.minWidth) ?? K.num("ui.Modal.minWidth", 260),
    maxWidth: pn(props.maxWidth) ?? K.num("ui.Modal.maxWidth", 400),
    width: "100%" as const,
  };
  return (
    <RNModal
      visible={open}
      transparent
      animationType={(ps(props.animation) ?? K.str("ui.Modal.animation", "fade")) as "fade"}
      onRequestClose={dismissable ? close : undefined}
    >
      {/* props.blur → frost the content behind the card instead of just dimming it. */}
      {props.blur ? (
        <BlurView
          intensity={Number(props.blurIntensity ?? K.num("ui.Modal.blurIntensity", 45))}
          // Pinned dark before, which is wrong the moment a screen is light —
          // the Stats tab's expanded card sits on an amber page.
          tint={String(props.blurTint ?? K.str("ui.Modal.blurTint", "dark")) as any}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      <Pressable
        style={{
          flex: 1, alignItems: "center", justifyContent: "center", padding: scrimPad,
          backgroundColor: scrimColor(props, props.blur ? "blur" : "plain"),
        }}
        onPress={dismissable ? close : undefined}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={[card, style]}>
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

const BottomSheet = ({ node, props, children, fire, store, style }: CompProps) => {
  const theme = useTheme();
  const bindKey = node.bind?.open;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const open = !!store.get(bindKey ?? "");
  const close = () => {
    if (bindKey) store.set(bindKey, false);
    fire("onDismiss");
  };
  const radius = pn(props.radius) ?? K.num("ui.BottomSheet.radius", 20);
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: ps(props.scrimColor) ?? K.color("ui.BottomSheet.scrim", "rgba(0,0,0,0.5)") }}
        onPress={close}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[{
            backgroundColor: ps(props.background) ?? theme.color.card ?? K.color("ui.BottomSheet.background", "#0b0b0f"),
            borderTopLeftRadius: radius, borderTopRightRadius: radius,
            padding: pn(props.padding) ?? K.num("ui.BottomSheet.padding", 20),
            paddingBottom: pn(props.paddingBottom) ?? K.num("ui.BottomSheet.paddingBottom", 40),
          }, style]}
        >
          <View style={{
            alignSelf: "center",
            width: pn(props.handleWidth) ?? K.num("ui.BottomSheet.handleWidth", 40),
            height: pn(props.handleHeight) ?? K.num("ui.BottomSheet.handleHeight", 5),
            borderRadius: K.num("ui.BottomSheet.handleRadius", 3),
            backgroundColor: ps(props.handleColor) ?? K.color("ui.BottomSheet.handleColor", "#444"),
            marginBottom: K.num("ui.BottomSheet.handleMarginBottom", 12),
          }} />
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

const ActionSheet = ({ node, props, fire, store, style }: CompProps) => {
  const theme = useTheme();
  const bindKey = node.bind?.open;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const open = !!store.get(bindKey ?? "");
  const close = () => {
    if (bindKey) store.set(bindKey, false);
    fire("onDismiss");
  };
  const actions = Array.isArray(props.actions) ? props.actions : [];
  const radius = pn(props.radius) ?? K.num("ui.ActionSheet.radius", 20);
  const row = {
    paddingVertical: pn(props.rowPadding) ?? K.num("ui.ActionSheet.rowPadding", 18),
    alignItems: "center" as const,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ps(props.dividerColor) ?? K.color("ui.ActionSheet.dividerColor", "#222"),
  };
  const text = {
    color: ps(props.textColor) ?? K.color("ui.ActionSheet.textColor", "#fff"),
    fontSize: pn(props.fontSize) ?? K.num("ui.ActionSheet.fontSize", 17),
  };
  const destructive = ps(props.destructiveColor) ?? K.color("ui.ActionSheet.destructiveColor", "#ff5a5f");
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: ps(props.scrimColor) ?? K.color("ui.ActionSheet.scrim", "rgba(0,0,0,0.5)") }}
        onPress={close}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[{
            backgroundColor: ps(props.background) ?? theme.color.card ?? K.color("ui.ActionSheet.background", "#0b0b0f"),
            borderTopLeftRadius: radius, borderTopRightRadius: radius,
            paddingBottom: pn(props.paddingBottom) ?? K.num("ui.ActionSheet.paddingBottom", 40),
          }, style]}
        >
          {actions.map((a: any, i: number) => (
            <Pressable
              key={i}
              onPress={() => { close(); fire("onSelect", a); }}
              style={row}
            >
              <Text style={[text, a.destructive && { color: destructive }]}>{a.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

const Popover = ({ props, children, style }: CompProps) => (
  <View style={[{
    backgroundColor: ps(props.background) ?? K.color("ui.Popover.background", "#1a1a1f"),
    borderRadius: pn(props.radius) ?? K.num("ui.Popover.radius", 12),
    padding: pn(props.padding) ?? K.num("ui.Popover.padding", 14),
    shadowColor: K.color("ui.Popover.shadowColor", "#000"),
    shadowOpacity: K.num("ui.Popover.shadowOpacity", 0.4),
    shadowRadius: K.num("ui.Popover.shadowRadius", 12),
    shadowOffset: { width: 0, height: K.num("ui.Popover.shadowOffsetY", 6) },
  }, style]}>
    {children}
    {props.title ? (
      <Text style={{
        color: ps(props.titleColor) ?? K.color("ui.Popover.titleColor", "#fff"),
        fontWeight: (ps(props.titleWeight) ?? K.str("ui.Popover.titleWeight", "700")) as "700",
        marginTop: K.num("ui.Popover.titleMarginTop", 6),
      }}>{String(props.title)}</Text>
    ) : null}
  </View>
);

const Tooltip = ({ props, children, style }: CompProps) => {
  const [visible, setVisible] = useState(false);
  return (
    <Pressable onLongPress={() => setVisible(true)} onPressOut={() => setVisible(false)}>
      <View style={style}>{children}</View>
      {visible && (
        <View style={{
          position: "absolute",
          top: pn(props.offset) ?? K.num("ui.Tooltip.offset", -30),
          backgroundColor: ps(props.background) ?? K.color("ui.Tooltip.background", "rgba(20,20,25,0.95)"),
          paddingHorizontal: K.num("ui.Tooltip.paddingHorizontal", 10),
          paddingVertical: K.num("ui.Tooltip.paddingVertical", 6),
          borderRadius: pn(props.radius) ?? K.num("ui.Tooltip.radius", 6),
        }}>
          <Text style={{
            color: ps(props.color) ?? K.color("ui.Tooltip.color", "#fff"),
            fontSize: pn(props.fontSize) ?? K.num("ui.Tooltip.fontSize", 12),
          }}>{String(props.content ?? "")}</Text>
        </View>
      )}
    </Pressable>
  );
};

const Collapsible = ({ props, children, style }: CompProps) => {
  const [open, setOpen] = useState(!!props.defaultOpen);
  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingVertical: pn(props.headerPadding) ?? K.num("ui.Collapsible.headerPadding", 14),
        }}
      >
        <Text style={{
          color: ps(props.titleColor) ?? K.color("ui.Collapsible.titleColor", "#fff"),
          fontSize: pn(props.titleSize) ?? K.num("ui.Collapsible.titleSize", 16),
          fontWeight: (ps(props.titleWeight) ?? K.str("ui.Collapsible.titleWeight", "600")) as "600",
        }}>{String(props.title ?? "")}</Text>
        <Text style={{
          color: ps(props.chevronColor) ?? K.color("ui.Collapsible.chevronColor", "#aaa"),
          fontSize: pn(props.chevronSize) ?? K.num("ui.Collapsible.chevronSize", 16),
        }}>
          {open
            ? (ps(props.openGlyph) ?? K.txt("ui.Collapsible.openGlyph", "▾"))
            : (ps(props.closedGlyph) ?? K.txt("ui.Collapsible.closedGlyph", "▸"))}
        </Text>
      </Pressable>
      {open && <View style={{ paddingVertical: pn(props.bodyPadding) ?? K.num("ui.Collapsible.bodyPadding", 8) }}>{children}</View>}
    </View>
  );
};

// StickyHeader: header pins on scroll. React Native's stickyHeaderIndices handles
// this natively; we just wrap children in a ScrollView with the first item pinned.
const StickyHeader = ({ children, style }: CompProps) => (
  <ScrollView stickyHeaderIndices={[0]} style={style}>{children}</ScrollView>
);

const SwipeableRow = ({ children, style }: CompProps) => (
  // Full swipe-action gestures need react-native-gesture-handler + reanimated;
  // shipping a no-swipe passthrough that still renders the content. Backend can
  // author the actions today; this wrapper picks up gesture behavior via OTA.
  <View style={style}>{children}</View>
);

const PullToRefresh = ({ children, fire, style }: CompProps) => {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      style={style}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await fire("onRefresh");
            setRefreshing(false);
          }}
        />
      }
    >
      {children}
    </ScrollView>
  );
};

const SafeArea = ({ children, style }: CompProps) => (
  <View style={[{ flex: 1 }, style]}>{children}</View>
);

const Tabs = ({ props, style }: CompProps) => {
  const [active, setActive] = useState(0);
  const tabs: Array<{ id: string; title: string }> = Array.isArray(props.tabs) ? props.tabs : [];
  const activeColor = ps(props.activeColor) ?? K.color("ui.Tabs.activeColor", "#fff");
  return (
    <View style={style}>
      <View style={{
        flexDirection: "row",
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: ps(props.dividerColor) ?? K.color("ui.Tabs.dividerColor", "#222"),
      }}>
        {tabs.map((t, i) => (
          <Pressable
            key={t.id}
            onPress={() => setActive(i)}
            style={[
              {
                paddingVertical: K.num("ui.Tabs.paddingVertical", 12),
                paddingHorizontal: K.num("ui.Tabs.paddingHorizontal", 16),
              },
              active === i && { borderBottomWidth: K.num("ui.Tabs.indicatorWidth", 2), borderBottomColor: activeColor },
            ]}
          >
            <Text style={[
              { color: ps(props.color) ?? K.color("ui.Tabs.color", "#888") },
              active === i && {
                color: activeColor,
                fontWeight: (ps(props.activeWeight) ?? K.str("ui.Tabs.activeWeight", "700")) as "700",
              },
            ]}>{t.title}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * An iOS-shaped switch that is ours, not Apple's.
 *
 * It was 44x26 with a thumb that teleported and a hardcoded iOS green. The
 * green is the problem: a system colour on a control the system did not draw
 * reads as borrowed, and it is the one element on the screen not speaking the
 * product's own language. On means ON in this app, so it wears the accent.
 *
 * Real iOS proportions (51x31, 27 thumb) because those are simply the ones
 * that look right, and a spring on the thumb because the whole appeal of this
 * control is that it feels like a physical thing being thrown.
 */
const Switch = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = !!store.get(bindKey ?? "");
  const theme = useTheme();
  const onColor = (props.onColor as string) || theme.color.primary;
  const offColor = ps(props.offColor) ?? theme.color.border ?? K.color("ui.Switch.offColor", "#333");
  // Apple's own proportions, and the spring the thumb is thrown on.
  const g = {
    ...K.obj("ui.Switch.look", {
      width: 51, height: 31, radius: 16, padding: 2, thumb: 27, thumbRadius: 14, travel: 20,
      thumbColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 2, shadowOffsetY: 1, elevation: 2,
      friction: 9, tension: 90
    }),
    ...(props.look ?? {}),
  };
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,   // track colour interpolates, which the native driver cannot
      friction: Number(g.friction),
      tension: Number(g.tension),
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, anim]);
  const toggle = () => {
    if (bindKey) store.set(bindKey, !value);
    fire("onChange", !value);
  };
  return (
    <Pressable onPress={toggle} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <Animated.View
        style={[
          {
            width: Number(g.width), height: Number(g.height), borderRadius: Number(g.radius),
            padding: Number(g.padding), justifyContent: "center",
          },
          {
            backgroundColor: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [offColor, onColor],
            }),
          },
          style,
        ]}
      >
        <Animated.View
          style={[
            {
              width: Number(g.thumb), height: Number(g.thumb), borderRadius: Number(g.thumbRadius),
              backgroundColor: String(props.thumbColor ?? g.thumbColor),
              shadowColor: String(g.shadowColor), shadowOpacity: Number(g.shadowOpacity), shadowRadius: Number(g.shadowRadius),
              shadowOffset: { width: 0, height: Number(g.shadowOffsetY) }, elevation: Number(g.elevation),
            },
            { transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, Number(g.travel)] }) }] },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
};

const SliderC = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = Number(store.get(bindKey ?? "") ?? props.default ?? 0);
  return (
    <Slider
      style={[{ width: "100%" }, style]}
      minimumValue={Number(props.min ?? 0)}
      maximumValue={Number(props.max ?? 100)}
      step={Number(props.step ?? 1)}
      value={value}
      onValueChange={(v) => {
        if (bindKey) store.set(bindKey, v);
        fire("onChange", v);
      }}
      minimumTrackTintColor={ps(props.minTrackColor) ?? K.color("ui.Slider.minTrackColor", "#ffffff")}
      maximumTrackTintColor={ps(props.maxTrackColor) ?? K.color("ui.Slider.maxTrackColor", "#333")}
      thumbTintColor={ps(props.thumbColor) ?? K.color("ui.Slider.thumbColor", "#ffffff")}
    />
  );
};

const Stepper = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const min = Number(props.min ?? -Infinity);
  const max = Number(props.max ?? Infinity);
  const step = Number(props.step ?? 1);
  const value = Number(store.get(bindKey ?? "") ?? 0);
  const set = (n: number) => {
    const clamped = Math.max(min, Math.min(max, n));
    if (bindKey) store.set(bindKey, clamped);
    fire("onChange", clamped);
  };
  const btnSize = pn(props.buttonSize) ?? K.num("ui.Stepper.buttonSize", 32);
  const btn = {
    width: btnSize, height: btnSize,
    borderRadius: pn(props.buttonRadius) ?? K.num("ui.Stepper.buttonRadius", 16),
    backgroundColor: ps(props.buttonBackground) ?? K.color("ui.Stepper.buttonBackground", "#1c1c25"),
    alignItems: "center" as const, justifyContent: "center" as const,
  };
  const btnText = {
    color: ps(props.buttonColor) ?? K.color("ui.Stepper.buttonColor", "#fff"),
    fontSize: pn(props.buttonFontSize) ?? K.num("ui.Stepper.buttonFontSize", 18),
    fontWeight: (ps(props.buttonWeight) ?? K.str("ui.Stepper.buttonWeight", "600")) as "600",
  };
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: pn(props.gap) ?? K.num("ui.Stepper.gap", 12) }, style]}>
      <Pressable onPress={() => set(value - step)} style={btn}>
        <Text style={btnText}>{ps(props.minusGlyph) ?? K.txt("ui.Stepper.minusGlyph", "−")}</Text>
      </Pressable>
      <Text style={{
        color: ps(props.valueColor) ?? K.color("ui.Stepper.valueColor", "#fff"),
        fontSize: pn(props.valueSize) ?? K.num("ui.Stepper.valueSize", 16),
        minWidth: pn(props.valueMinWidth) ?? K.num("ui.Stepper.valueMinWidth", 28),
        textAlign: "center",
      }}>{value}</Text>
      <Pressable onPress={() => set(value + step)} style={btn}>
        <Text style={btnText}>{ps(props.plusGlyph) ?? K.txt("ui.Stepper.plusGlyph", "+")}</Text>
      </Pressable>
    </View>
  );
};

const SegmentedControl = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const options: Array<{ label: string; value: any }> = Array.isArray(props.options) ? props.options : [];
  const active = store.get(bindKey ?? "");
  return (
    <View style={[{
      flexDirection: "row",
      backgroundColor: ps(props.background) ?? K.color("ui.SegmentedControl.background", "#1c1c25"),
      borderRadius: pn(props.radius) ?? K.num("ui.SegmentedControl.radius", 8),
      padding: pn(props.padding) ?? K.num("ui.SegmentedControl.padding", 2),
    }, style]}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          onPress={() => {
            if (bindKey) store.set(bindKey, o.value);
            fire("onChange", o.value);
          }}
          style={[
            {
              flex: 1, alignItems: "center",
              paddingVertical: K.num("ui.SegmentedControl.itemPadding", 8),
              borderRadius: pn(props.itemRadius) ?? K.num("ui.SegmentedControl.itemRadius", 6),
            },
            active === o.value && { backgroundColor: ps(props.activeBackground) ?? K.color("ui.SegmentedControl.activeBackground", "#fff") },
          ]}
        >
          <Text style={[
            {
              color: ps(props.color) ?? K.color("ui.SegmentedControl.color", "#aaa"),
              fontSize: pn(props.fontSize) ?? K.num("ui.SegmentedControl.fontSize", 13),
              fontWeight: (ps(props.fontWeight) ?? K.str("ui.SegmentedControl.fontWeight", "600")) as "600",
            },
            active === o.value && { color: ps(props.activeColor) ?? K.color("ui.SegmentedControl.activeColor", "#000") },
          ]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const SearchField = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = String(store.get(bindKey ?? "") ?? "");
  const muted = ps(props.placeholderColor) ?? K.color("ui.SearchField.placeholderColor", "#666");
  return (
    <View style={[{
      flexDirection: "row", alignItems: "center",
      backgroundColor: ps(props.background) ?? K.color("ui.SearchField.background", "#1c1c25"),
      borderRadius: pn(props.radius) ?? K.num("ui.SearchField.radius", 10),
      paddingHorizontal: pn(props.paddingHorizontal) ?? K.num("ui.SearchField.paddingHorizontal", 12),
      paddingVertical: pn(props.paddingVertical) ?? K.num("ui.SearchField.paddingVertical", 8),
    }, style]}>
      <Text style={{
        color: ps(props.iconColor) ?? K.color("ui.SearchField.iconColor", "#666"),
        marginRight: K.num("ui.SearchField.iconGap", 8),
      }}>{ps(props.icon) ?? K.txt("ui.SearchField.icon", "🔍")}</Text>
      <TextInput
        placeholder={String(props.placeholder ?? K.txt("ui.SearchField.placeholder", "Search"))}
        placeholderTextColor={muted}
        value={value}
        onChangeText={(t) => {
          if (bindKey) store.set(bindKey, t);
          fire("onChange", t);
        }}
        onSubmitEditing={(e) => fire("onSubmit", e.nativeEvent.text)}
        style={{
          flex: 1,
          color: ps(props.color) ?? K.color("ui.SearchField.color", "#fff"),
          fontSize: pn(props.fontSize) ?? K.num("ui.SearchField.fontSize", 15),
        }}
        returnKeyType="search"
      />
    </View>
  );
};

const Picker = ({ node, props, style, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindKey = node.bind?.value;
  const options: Array<{ label: string; value: any }> = Array.isArray(props.options) ? props.options : [];
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = store.get(bindKey ?? "");
  const current = options.find((o) => o.value === value);
  const color = ps(props.color) ?? K.color("ui.Picker.color", "#fff");
  const fontSize = pn(props.fontSize) ?? K.num("ui.Picker.fontSize", 15);
  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          backgroundColor: ps(props.background) ?? K.color("ui.Picker.background", "#1c1c25"),
          borderRadius: pn(props.radius) ?? K.num("ui.Picker.radius", 10),
          paddingHorizontal: pn(props.paddingHorizontal) ?? K.num("ui.Picker.paddingHorizontal", 14),
          paddingVertical: pn(props.paddingVertical) ?? K.num("ui.Picker.paddingVertical", 12),
        }}
      >
        <Text style={{ color, fontSize }}>{current?.label ?? String(props.placeholder ?? K.txt("ui.Picker.placeholder", "Select…"))}</Text>
        <Text style={{ color: ps(props.chevronColor) ?? K.color("ui.Picker.chevronColor", "#888") }}>
          {ps(props.chevronGlyph) ?? K.txt("ui.Picker.chevronGlyph", "▾")}
        </Text>
      </Pressable>
      <RNModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{
            flex: 1, alignItems: "center", justifyContent: "center",
            padding: K.num("ui.Modal.scrimPadding", 24),
            backgroundColor: ps(props.scrimColor) ?? K.color("ui.Modal.scrim", "rgba(0,0,0,0.5)"),
          }}
          onPress={() => setOpen(false)}
        >
          <View style={{
            backgroundColor: ps(props.sheetBackground) ?? theme.color.card ?? K.color("ui.Picker.sheetBackground", "#0b0b0f"),
            borderRadius: pn(props.sheetRadius) ?? K.num("ui.Picker.sheetRadius", 16),
            minWidth: K.num("ui.Picker.sheetMinWidth", 260),
            maxWidth: K.num("ui.Picker.sheetMaxWidth", 400),
            width: (ps(props.sheetWidth) ?? K.str("ui.Picker.sheetWidth", "80%")) as `${number}%`,
          }}>
            {options.map((o) => (
              <Pressable
                key={String(o.value)}
                onPress={() => {
                  if (bindKey) store.set(bindKey, o.value);
                  fire("onChange", o.value);
                  setOpen(false);
                }}
                style={{
                  paddingVertical: K.num("ui.Picker.optionPadding", 16),
                  alignItems: "center",
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: ps(props.dividerColor) ?? K.color("ui.Picker.dividerColor", "#222"),
                }}
              >
                <Text style={{ color, fontSize }}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </RNModal>
    </View>
  );
};

// DatePicker: minimalist; a full RN date wheel needs a third-party lib.
// Ships as a text input formatted YYYY-MM-DD; upgrade in an OTA when Skia-based
// picker is picked. Backend push works; UX is placeholder-grade.
const DatePicker = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = String(store.get(bindKey ?? "") ?? "");
  return (
    <TextInput
      style={[{
        backgroundColor: ps(props.background) ?? K.color("ui.DatePicker.background", "#1c1c25"),
        color: ps(props.color) ?? K.color("ui.DatePicker.color", "#fff"),
        borderRadius: pn(props.radius) ?? K.num("ui.DatePicker.radius", 10),
        paddingHorizontal: pn(props.paddingHorizontal) ?? K.num("ui.DatePicker.paddingHorizontal", 14),
        paddingVertical: pn(props.paddingVertical) ?? K.num("ui.DatePicker.paddingVertical", 12),
      }, style]}
      placeholder={String(props.placeholder ?? K.txt("ui.DatePicker.placeholder", "YYYY-MM-DD"))}
      placeholderTextColor={ps(props.placeholderColor) ?? K.color("ui.DatePicker.placeholderColor", "#666")}
      value={value}
      onChangeText={(t) => {
        if (bindKey) store.set(bindKey, t);
        fire("onChange", t);
      }}
    />
  );
};

// ---------------------------------------------------------------------------
// Data viz
// ---------------------------------------------------------------------------

// Min/max via a single pass. Math.min(...arr) spreads the array as call
// arguments, which throws "Maximum call stack size exceeded" for large
// backend-supplied series — reduce is O(n) and stack-safe.
function extent(arr: number[]): [number, number] {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return [mn, mx];
}

// LineChart: renders series as a polyline in a normalized 100x40 SVG box.
// No axes / grid — good enough for sparkline-heavy dashboards; upgrade later.
const LineChart = ({ props, style }: CompProps) => {
  const series: Array<{ x: number; y: number }> = Array.isArray(props.series) ? props.series : [];
  const color = String(props.color ?? K.color("ui.LineChart.color", "#ffffff"));
  const w = 100, h = pn(props.aspectHeight) ?? K.num("ui.LineChart.aspectHeight", 40);
  if (series.length === 0) return <View style={[{ width: "100%", aspectRatio: w / h }, style]} />;
  const [minX, maxX] = extent(series.map((s) => s.x));
  const [minY, maxY] = extent(series.map((s) => s.y));
  const pts = series.map((s) => {
    const nx = (s.x - minX) / Math.max(1e-9, maxX - minX);
    const ny = (s.y - minY) / Math.max(1e-9, maxY - minY);
    return `${(nx * w).toFixed(2)},${(h - ny * h).toFixed(2)}`;
  }).join(" ");
  return (
    <View style={[{ width: "100%", aspectRatio: w / h }, style]}>
      <Svg viewBox={`0 0 ${w} ${h}`}>
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={pn(props.strokeWidth) ?? K.num("ui.LineChart.strokeWidth", 1.2)} />
      </Svg>
    </View>
  );
};

const BarChart = ({ props, style }: CompProps) => {
  const series: Array<{ label: string; value: number }> = Array.isArray(props.series) ? props.series : [];
  const max = Math.max(1, ...series.map((s) => s.value));
  const color = String(props.color ?? K.color("ui.BarChart.color", "#ffffff"));
  return (
    <View style={[{
      flexDirection: "row", alignItems: "flex-end",
      gap: pn(props.gap) ?? K.num("ui.BarChart.gap", 6),
      height: pn(props.height) ?? K.num("ui.BarChart.height", 120),
    }, style]}>
      {series.map((s, i) => (
        <View key={i} style={{ flex: 1, alignItems: "center" }}>
          <View style={{
            backgroundColor: color,
            width: (ps(props.barWidth) ?? K.str("ui.BarChart.barWidth", "70%")) as `${number}%`,
            height: `${(s.value / max) * 100}%`,
            borderRadius: pn(props.barRadius) ?? K.num("ui.BarChart.barRadius", 3),
          }} />
          <Text style={{
            color: ps(props.labelColor) ?? K.color("ui.BarChart.labelColor", "#888"),
            fontSize: pn(props.labelSize) ?? K.num("ui.BarChart.labelSize", 10),
            marginTop: K.num("ui.BarChart.labelMarginTop", 4),
          }}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
};

const Sparkline = ({ props, style }: CompProps) => {
  const data: number[] = Array.isArray(props.data) ? props.data : [];
  const color = String(props.color ?? K.color("ui.Sparkline.color", "#ffffff"));
  const w = 100, h = pn(props.aspectHeight) ?? K.num("ui.Sparkline.aspectHeight", 30);
  if (data.length === 0) return <View style={[{ width: "100%", aspectRatio: w / h }, style]} />;
  const [min, max] = extent(data);
  const pts = data.map((v, i) => {
    const nx = i / Math.max(1, data.length - 1);
    const ny = (v - min) / Math.max(1e-9, max - min);
    return `${(nx * w).toFixed(2)},${(h - ny * h).toFixed(2)}`;
  }).join(" ");
  return (
    <View style={[{ width: "100%", aspectRatio: w / h }, style]}>
      <Svg viewBox={`0 0 ${w} ${h}`}>
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={pn(props.strokeWidth) ?? K.num("ui.Sparkline.strokeWidth", 1)} />
      </Svg>
    </View>
  );
};

const ProgressRing = ({ props, style }: CompProps) => {
  const progress = Math.max(0, Math.min(1, Number(props.progress ?? 0)));
  const size = Number(props.size ?? K.num("ui.ProgressRing.size", 80));
  const stroke = Number(props.stroke ?? K.num("ui.ProgressRing.stroke", 6));
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={String(props.trackColor ?? K.color("ui.ProgressRing.trackColor", "#333"))} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={String(props.color ?? K.color("ui.ProgressRing.color", "#ffffff"))} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * progress} ${c}`}
          strokeLinecap={(ps(props.linecap) ?? K.str("ui.ProgressRing.linecap", "round")) as "round"}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {props.label != null && (
        <Text style={{
          position: "absolute",
          color: ps(props.labelColor) ?? K.color("ui.ProgressRing.labelColor", "#fff"),
          fontWeight: (ps(props.labelWeight) ?? K.str("ui.ProgressRing.labelWeight", "700")) as "700",
        }}>{String(props.label)}</Text>
      )}
    </View>
  );
};

const Gauge = ({ props, style }: CompProps) => {
  const min = Number(props.min ?? 0), max = Number(props.max ?? 100);
  const value = Math.max(min, Math.min(max, Number(props.value ?? 0)));
  const pct = (value - min) / Math.max(1e-9, max - min);
  const height = pn(props.height) ?? K.num("ui.Gauge.height", 8);
  return (
    <View style={style}>
      <View style={{
        height,
        backgroundColor: ps(props.trackColor) ?? K.color("ui.Gauge.trackColor", "#1c1c25"),
        borderRadius: pn(props.radius) ?? K.num("ui.Gauge.radius", 4),
        overflow: "hidden",
      }}>
        <View style={{ height: "100%", backgroundColor: ps(props.color) ?? K.color("ui.Gauge.color", "#4CD964"), width: `${pct * 100}%` }} />
      </View>
      <Text style={{
        color: ps(props.labelColor) ?? K.color("ui.Gauge.labelColor", "#fff"),
        marginTop: K.num("ui.Gauge.labelMarginTop", 4),
        fontWeight: (ps(props.labelWeight) ?? K.str("ui.Gauge.labelWeight", "600")) as "600",
      }}>{value}</Text>
    </View>
  );
};

const StatCard = ({ props, style }: CompProps) => {
  const theme = useTheme();
  const delta = props.delta != null ? Number(props.delta) : null;
  return (
    <View style={[{
      backgroundColor: ps(props.background) ?? theme.color.card ?? K.color("ui.StatCard.background", "#0b0b0f"),
      padding: pn(props.padding) ?? K.num("ui.StatCard.padding", 14),
      borderRadius: pn(props.radius) ?? K.num("ui.StatCard.radius", 12),
      gap: pn(props.gap) ?? K.num("ui.StatCard.gap", 4),
    }, style]}>
      <Text style={{
        color: ps(props.labelColor) ?? K.color("ui.StatCard.labelColor", "#888"),
        fontSize: pn(props.labelSize) ?? K.num("ui.StatCard.labelSize", 12),
        textTransform: "uppercase",
        letterSpacing: pn(props.labelTracking) ?? K.num("ui.StatCard.labelTracking", 0.6),
      }}>{String(props.label ?? "")}</Text>
      <Text style={{
        color: ps(props.valueColor) ?? K.color("ui.StatCard.valueColor", "#fff"),
        fontSize: pn(props.valueSize) ?? K.num("ui.StatCard.valueSize", 28),
        fontWeight: (ps(props.valueWeight) ?? K.str("ui.StatCard.valueWeight", "800")) as "800",
      }}>{String(props.value ?? "")}</Text>
      {delta != null && (
        <Text style={{
          fontSize: pn(props.deltaSize) ?? K.num("ui.StatCard.deltaSize", 12),
          color: delta >= 0
            ? (ps(props.upColor) ?? K.color("ui.StatCard.upColor", "#4CD964"))
            : (ps(props.downColor) ?? K.color("ui.StatCard.downColor", "#ff5a5f")),
        }}>
          {delta >= 0 ? (ps(props.upGlyph) ?? K.txt("ui.StatCard.upGlyph", "▲")) : (ps(props.downGlyph) ?? K.txt("ui.StatCard.downGlyph", "▼"))} {Math.abs(delta)}
        </Text>
      )}
    </View>
  );
};

// DonutChart. Renders `data: [{ label, value, color? }]` as SVG arc slices.
// Donut by default (set `donut:false` for a full pie); optional center label
// and a legend (below by default, `legend:"right"` to sit beside it).
//
// Registered as DonutChart ONLY. It used to be registered as PieChart too, and
// because this registry was spread after the main one it shadowed the real
// PieChart (./PieChart, which reads the `slices` the catalog sends) — every
// Stats ring came out empty. Slice colours default to the ui.chart.palette knob
// (brand amber first, then a legible set on dark); a slice's own `color` wins.
const DonutChart = ({ props, style }: CompProps) => {
  const palette = Array.isArray(props.palette) && props.palette.length
    ? (props.palette as unknown[]).map(String)
    : K.list<string>("ui.chart.palette", ["#E8A23C", "#6EA8FE", "#48D39A", "#F0736A", "#B98CFF", "#F2C078", "#7DD3FC", "#FCA5A5"]);
  const raw: Array<{ label?: string; value: number; color?: string }> =
    Array.isArray(props.data) ? props.data : [];
  const data = raw.filter((d) => (Number(d?.value) || 0) > 0);
  const size = Number(props.size ?? K.num("ui.DonutChart.size", 168));
  const isDonut = props.donut !== false;
  const thickness = Number(props.thickness ?? size * K.num("ui.DonutChart.thickness", 0.26));
  const r = size / 2;
  const rInner = isDonut ? Math.max(0, r - thickness) : 0;
  const cx = r, cy = r;
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const legendRight = props.legend === "right";
  const showLegend = props.legend !== false;

  const arc = (a0: number, a1: number): string => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    if (rInner <= 0) return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    const ix1 = cx + rInner * Math.cos(a1), iy1 = cy + rInner * Math.sin(a1);
    const ix0 = cx + rInner * Math.cos(a0), iy0 = cy + rInner * Math.sin(a0);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0} Z`;
  };

  let angle = -Math.PI / 2; // start at 12 o'clock
  const slices = data.map((d, i) => {
    const frac = total > 0 ? (Number(d.value) || 0) / total : 0;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    return { d, frac, a0, a1, color: d.color ?? palette[i % Math.max(1, palette.length)], i };
  });

  const legendSize = pn(props.legendSize) ?? K.num("ui.DonutChart.legendSize", 13);
  return (
    <View style={[{
      flexDirection: legendRight ? "row" : "column", alignItems: "center",
      gap: pn(props.gap) ?? K.num("ui.DonutChart.gap", 16),
    }, style]}>
      <View style={{ width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size}>
          {total <= 0 ? (
            <Circle
              cx={cx} cy={cy} r={r - 1} fill="none"
              stroke={String(props.emptyColor ?? K.color("ui.DonutChart.emptyColor", "#2a2a30"))}
              strokeWidth={pn(props.emptyStroke) ?? K.num("ui.DonutChart.emptyStroke", 2)}
            />
          ) : slices.length === 1 ? (
            // A single 100% slice can't be drawn as one arc — use a ring/disc.
            <Circle
              cx={cx} cy={cy} r={isDonut ? (r + rInner) / 2 : r}
              fill={isDonut ? "none" : slices[0].color}
              stroke={isDonut ? slices[0].color : "none"}
              strokeWidth={isDonut ? thickness : 0}
            />
          ) : (
            slices.map((s) => <Path key={s.i} d={arc(s.a0, s.a1)} fill={s.color} />)
          )}
        </Svg>
        {isDonut && (props.centerLabel != null || props.centerValue != null) && (
          <View style={{ position: "absolute", alignItems: "center", justifyContent: "center" }} pointerEvents="none">
            {props.centerValue != null && (
              <Text style={{
                color: ps(props.centerColor) ?? K.color("ui.DonutChart.centerColor", "#fff"),
                fontSize: pn(props.centerSize) ?? K.num("ui.DonutChart.centerSize", 26),
                fontWeight: (ps(props.centerWeight) ?? K.str("ui.DonutChart.centerWeight", "800")) as "800",
              }}>
                {String(props.centerValue)}
              </Text>
            )}
            {props.centerLabel != null && (
              <Text style={{
                color: ps(props.centerLabelColor) ?? K.color("ui.DonutChart.centerLabelColor", "rgba(255,255,255,0.55)"),
                fontSize: pn(props.centerLabelSize) ?? K.num("ui.DonutChart.centerLabelSize", 12),
                marginTop: K.num("ui.DonutChart.centerLabelMarginTop", 2),
              }}>
                {String(props.centerLabel)}
              </Text>
            )}
          </View>
        )}
      </View>
      {showLegend && slices.length > 0 && (
        // Beside the chart the legend must take the REMAINING width and be
        // allowed to shrink inside it (minWidth:0 — without it a flex child
        // refuses to go below its content and the row runs past the card).
        <View style={[{ gap: pn(props.legendGap) ?? K.num("ui.DonutChart.legendGap", 7) }, legendRight ? { flex: 1, minWidth: 0 } : null]}>
          {slices.map((s) => (
            <View key={s.i} style={{ flexDirection: "row", alignItems: "center", gap: K.num("ui.DonutChart.legendRowGap", 8) }}>
              <View style={{
                width: pn(props.dotSize) ?? K.num("ui.DonutChart.dotSize", 10),
                height: pn(props.dotSize) ?? K.num("ui.DonutChart.dotSize", 10),
                borderRadius: pn(props.dotRadius) ?? K.num("ui.DonutChart.dotRadius", 3),
                backgroundColor: s.color,
              }} />
              {/* The ink is the SCREEN's, not the component's. A chart drawn in
                  its own white on a warm ground is the one element that did not
                  get the memo — and legendColor was already being sent and
                  silently dropped.
                  minWidth keeps the values aligned when the legend sits BELOW
                  the chart; flexShrink lets a long label ellipsize rather than
                  push the percentage out of the card when it sits BESIDE it. */}
              <Text
                style={{
                  color: ps(props.legendColor) ?? K.color("ui.DonutChart.legendColor", "rgba(255,255,255,0.82)"),
                  fontSize: legendSize,
                  minWidth: K.num("ui.DonutChart.legendMinWidth", 72),
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                {String(s.d.label ?? "")}
              </Text>
              {/* marginLeft:auto pins the percentage to the right edge of the
                  legend column; flexShrink:0 stops it being the thing that gets
                  squeezed. */}
              <Text style={{
                color: ps(props.legendValueColor) ?? K.color("ui.DonutChart.legendValueColor", "rgba(255,255,255,0.55)"),
                fontSize: legendSize,
                fontWeight: (ps(props.legendValueWeight) ?? K.str("ui.DonutChart.legendValueWeight", "600")) as "600",
                fontVariant: ["tabular-nums"], marginLeft: "auto", flexShrink: 0,
              }}>
                {K.txt("ui.DonutChart.percent", "{pct}%", { pct: Math.round(s.frac * 100) })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const Waveform = ({ node, props, style, store }: CompProps) => {
  const bindKey = node.bind?.level;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const level = Math.max(0, Math.min(1, Number(store.get(bindKey ?? "") ?? props.level ?? K.num("ui.Waveform.level", 0.2))));
  const w = {
    ...K.obj("ui.Waveform.look", {
      bars: 20, barWidth: 3, barGap: 1.5, radius: 1.5, color: "#fff", height: 48,
      floor: 0.4, spread: 0.6, freq: 1.7, levelFreq: 3
    }),
    ...(props.look ?? {}),
  };
  const bars = Math.max(0, Math.round(Number(props.bars ?? w.bars)));
  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-end", height: Number(w.height) }, style]}>
      {Array.from({ length: bars }).map((_, i) => {
        const rand = Number(w.floor) + Number(w.spread) * Math.abs(Math.sin(i * Number(w.freq) + level * Number(w.levelFreq)));
        return (
          <View key={i} style={{
            width: Number(w.barWidth), marginHorizontal: Number(w.barGap), height: `${rand * level * 100}%`,
            backgroundColor: String(props.color ?? w.color), borderRadius: Number(w.radius),
          }} />
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

// Real media node (was a text placeholder): renders the app's MediaPlayer.
// `playing` is bindable, so the backend can drive play/pause from state —
// e.g. the Train screen's refine trigger plays the brand media while the
// variants generate and pauses when they land. An mp4 freezes on its frame
// when paused; an animated GIF unmounts when paused, revealing whatever the
// backend stacked beneath it.
const Video = ({ props, style }: CompProps) => {
  const raw: any = props.source;
  // UNWRAP, don't wrap.
  //
  // This built `{ source: raw }` and handed that to MediaPlayer, which calls
  // resolveMedia on it. resolveMedia knows { url }, { key }, { asset },
  // { data }, { emoji } and a string — it has never known { source }, so every
  // Video node resolved to "empty", MediaPlayer returned null, and the clip was
  // not a broken player or an error: it was nothing at all. `spec as any` is
  // what let the mismatch through the compiler.
  //
  // That is the black intro, and the flow clip that was "just the text", and
  // every hero that turned out to be an mp4. One line, three screens, months.
  //
  // The rich shape ({ source, freezeOnPause, … }) is still accepted — its extra
  // fields were only ever read as separate props, so taking .source loses
  // nothing.
  const spec = raw && typeof raw === "object" && "source" in raw ? raw.source : raw;
  // FOCUS PLACEMENT. When the backend says where the subject is in the art and
  // where it should land on screen, the clip is sized and slid here instead of
  // being handed to `cover` and centred — see media/focusFill.
  const placed = useFocusFill(props);
  const loop = (props.loop as boolean | undefined) ?? K.bool("ui.Video.loop", true);
  const muted = props.muted !== undefined ? props.muted !== false : K.bool("ui.Video.muted", true);
  if (placed.on) {
    return (
      <View style={[style, { overflow: "hidden" }]} onLayout={placed.onLayout}>
        {placed.fit ? (
          <MediaPlayer
            spec={spec}
            style={{ position: "absolute", ...placed.fit }}
            contentFit="cover"
            autoplay={typeof props.autoplay === "boolean" ? props.autoplay : undefined}
            loop={loop}
            muted={muted}
            playing={typeof props.playing === "boolean" ? props.playing : undefined}
            speed={typeof props.speed === "number" ? props.speed : undefined}
          />
        ) : null}
      </View>
    );
  }
  return (
    <MediaPlayer
      spec={spec}
      style={style}
      contentFit={(props.contentFit as any) ?? K.str("ui.Video.contentFit", "cover")}
      autoplay={typeof props.autoplay === "boolean" ? props.autoplay : undefined}
      loop={loop}
      muted={muted}
      playing={typeof props.playing === "boolean" ? props.playing : undefined}
      // Playback rate. MediaPlayer has always taken this and set
      // player.playbackRate; the node simply never forwarded it, so the one
      // speed control in the app was unreachable from the backend.
      speed={typeof props.speed === "number" ? props.speed : undefined}
    />
  );
};

/**
 * PLACEHOLDERS DRAW NOTHING.
 *
 * Audio, Camera and QRScanner have no player or capture behind them yet, and
 * they used to print that fact at the user — "♫ Audio: https://…", "📷 Camera
 * (photo)" — as if a debug line were a feature. A node the build cannot serve
 * now renders nothing, so a screen that uses one reads as a screen without it.
 * The ui.debugPlaceholders knob brings the labels back for whoever is building
 * a screen and needs to see where the node is.
 */
const Placeholder = ({ style, text }: { style: any; text: string }) => {
  if (!K.bool("ui.debugPlaceholders", false)) return null;
  return (
    <View style={[{
      backgroundColor: K.color("ui.Placeholder.background", "#1c1c25"),
      borderRadius: K.num("ui.Placeholder.radius", 12),
      padding: K.num("ui.Placeholder.padding", 16),
    }, style]}>
      <Text style={{ color: K.color("ui.Placeholder.color", "#aaa") }}>{text}</Text>
    </View>
  );
};
const Audio = ({ props, style }: CompProps) => (
  <Placeholder style={style} text={`♫ Audio: ${String(props.source ?? "")}`} />
);
const Camera = ({ props, style }: CompProps) => (
  <Placeholder style={style} text={`📷 Camera (${String(props.mode ?? "photo")})`} />
);
const QRScanner = ({ style }: CompProps) => (
  <Placeholder style={style} text="▧ QR Scanner" />
);
const ImagePickerButton = ({ props, fire, style }: CompProps) => (
  <Pressable
    onPress={() => fire("onPress")}
    style={[{
      backgroundColor: ps(props.background) ?? K.color("ui.ImagePickerButton.background", "#fff"),
      paddingVertical: pn(props.paddingVertical) ?? K.num("ui.ImagePickerButton.paddingVertical", 12),
      paddingHorizontal: pn(props.paddingHorizontal) ?? K.num("ui.ImagePickerButton.paddingHorizontal", 24),
      borderRadius: pn(props.radius) ?? K.num("ui.ImagePickerButton.radius", 24),
      alignItems: "center",
    }, style]}
  >
    <Text style={{
      color: ps(props.color) ?? K.color("ui.ImagePickerButton.color", "#000"),
      fontWeight: (ps(props.fontWeight) ?? K.str("ui.ImagePickerButton.fontWeight", "700")) as "700",
    }}>{String(props.label ?? K.txt("ui.ImagePickerButton.label", "Pick image"))}</Text>
  </Pressable>
);

const Avatar = ({ props, style }: CompProps) => {
  const size = Number(props.size ?? K.num("ui.Avatar.size", 40));
  const maxInitials = K.num("ui.Avatar.maxInitials", 2);
  const initials = String(props.name ?? K.txt("ui.Avatar.unknown", "?")).split(" ").map((s) => s[0]).join("").slice(0, maxInitials).toUpperCase();
  return (
    <View style={[{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: ps(props.background) ?? K.color("ui.Avatar.background", "#333"),
      alignItems: "center", justifyContent: "center", overflow: "hidden",
    }, style]}>
      {props.source ? (
        <ExpoImage source={{ uri: String(props.source) }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Text style={{
          color: ps(props.color) ?? K.color("ui.Avatar.color", "#fff"),
          fontWeight: (ps(props.fontWeight) ?? K.str("ui.Avatar.fontWeight", "700")) as "700",
          fontSize: size * (pn(props.fontScale) ?? K.num("ui.Avatar.fontScale", 0.4)),
        }}>{initials}</Text>
      )}
    </View>
  );
};

const AvatarStack = ({ props, style }: CompProps) => {
  const avatars: Array<{ source?: string; name?: string }> = Array.isArray(props.avatars) ? props.avatars : [];
  const size = Number(props.size ?? K.num("ui.AvatarStack.size", 32));
  const max = pn(props.max) ?? K.num("ui.AvatarStack.max", 5);
  const overlap = pn(props.overlap) ?? K.num("ui.AvatarStack.overlap", 0.3);
  return (
    <View style={[{ flexDirection: "row" }, style]}>
      {avatars.slice(0, max).map((a, i) => (
        <View key={i} style={{
          marginLeft: i === 0 ? 0 : -size * overlap,
          borderWidth: pn(props.ringWidth) ?? K.num("ui.AvatarStack.ringWidth", 2),
          borderColor: ps(props.ringColor) ?? K.color("ui.AvatarStack.ringColor", "#000"),
          borderRadius: size / 2,
        }}>
          <Avatar node={{ type: "Avatar" } as any} props={{ ...a, size }} style={{}} store={null as any} ctx={null as any} fire={() => {}} children={null} />
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

// Toast/Snackbar are usually action-triggered, not node-authored; ship a
// simple always-visible variant for authored use.
const Toast = ({ props, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{
      backgroundColor: ps(props.background) ?? theme.color.card ?? K.color("ui.Toast.background", "#0b0b0f"),
      borderRadius: pn(props.radius) ?? K.num("ui.Toast.radius", 10),
      padding: pn(props.padding) ?? K.num("ui.Toast.padding", 12),
    }, style]}>
      <Text style={{ color: ps(props.color) ?? K.color("ui.Toast.color", "#fff") }}>{String(props.message ?? "")}</Text>
    </View>
  );
};
const Snackbar = ({ props, fire, style }: CompProps) => {
  const theme = useTheme();
  return (
    <View style={[{
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: ps(props.background) ?? theme.color.card ?? K.color("ui.Snackbar.background", "#0b0b0f"),
      borderRadius: pn(props.radius) ?? K.num("ui.Snackbar.radius", 10),
      padding: pn(props.padding) ?? K.num("ui.Snackbar.padding", 14),
      gap: pn(props.gap) ?? K.num("ui.Snackbar.gap", 12),
    }, style]}>
      <Text style={{ color: ps(props.color) ?? K.color("ui.Snackbar.color", "#fff"), flex: 1 }}>{String(props.message ?? "")}</Text>
      {props.actionLabel && (
        <Pressable onPress={() => fire("onPress")}>
          <Text style={{
            color: ps(props.actionColor) ?? K.color("ui.Snackbar.actionColor", "#4CD964"),
            fontWeight: (ps(props.actionWeight) ?? K.str("ui.Snackbar.actionWeight", "700")) as "700",
          }}>{String(props.actionLabel)}</Text>
        </Pressable>
      )}
    </View>
  );
};

const LoadingSkeleton = ({ props, style }: CompProps) => {
  const shimmer = useRef(new Animated.Value(0)).current;
  const durationMs = pn(props.durationMs) ?? K.num("ui.LoadingSkeleton.durationMs", 1200);
  useEffect(() => {
    Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true })).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shimmer]);
  const ramp = K.list<number>("ui.LoadingSkeleton.opacity", [0.3, 0.7, 0.3]);
  const opacity = shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: ramp.length === 3 ? ramp : [0.3, 0.7, 0.3] });
  return (
    <Animated.View style={[{
      backgroundColor: ps(props.color) ?? K.color("ui.LoadingSkeleton.color", "#222"),
      borderRadius: Number(props.radius ?? K.num("ui.LoadingSkeleton.radius", 6)),
      height: Number(props.height ?? K.num("ui.LoadingSkeleton.height", 16)),
      width: props.width ?? "100%",
      opacity,
    }, style]} />
  );
};

// Confetti has no particle system behind it; it used to put one giant 🎉 over
// the screen. Nothing, unless ui.debugPlaceholders asks to see where it is.
const Confetti = ({ style }: CompProps) => {
  if (!K.bool("ui.debugPlaceholders", false)) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Text style={{ fontSize: 96, textAlign: "center", marginTop: 60 }}>🎉</Text>
    </View>
  );
};

const Rating = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const max = Number(props.max ?? K.num("ui.Rating.max", 5));
  const value = Number(store.get(bindKey ?? "") ?? 0);
  const size = pn(props.size) ?? K.num("ui.Rating.size", 28);
  const on = ps(props.onColor) ?? K.color("ui.Rating.onColor", "#FFC94A");
  const off = ps(props.offColor) ?? K.color("ui.Rating.offColor", "#333");
  const glyph = ps(props.glyph) ?? K.txt("ui.Rating.glyph", "★");
  return (
    <View style={[{ flexDirection: "row" }, style]}>
      {Array.from({ length: max }).map((_, i) => (
        <Pressable
          key={i}
          onPress={() => {
            const v = i + 1;
            if (bindKey) store.set(bindKey, v);
            fire("onChange", v);
          }}
        >
          <Text style={{ fontSize: size, color: i < value ? on : off }}>{glyph}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const EmptyState = ({ props, style }: CompProps) => (
  <View style={[{ alignItems: "center", padding: pn(props.padding) ?? K.num("ui.EmptyState.padding", 32) }, style]}>
    {props.icon && (
      <Text style={{
        fontSize: pn(props.iconSize) ?? K.num("ui.EmptyState.iconSize", 48),
        marginBottom: K.num("ui.EmptyState.iconMarginBottom", 8),
      }}>{String(props.icon)}</Text>
    )}
    <Text style={{
      color: ps(props.titleColor) ?? K.color("ui.EmptyState.titleColor", "#fff"),
      fontSize: pn(props.titleSize) ?? K.num("ui.EmptyState.titleSize", 18),
      fontWeight: (ps(props.titleWeight) ?? K.str("ui.EmptyState.titleWeight", "700")) as "700",
    }}>{String(props.title ?? "")}</Text>
    {props.subtitle && (
      <Text style={{
        color: ps(props.subtitleColor) ?? K.color("ui.EmptyState.subtitleColor", "#888"),
        marginTop: K.num("ui.EmptyState.subtitleMarginTop", 6),
        textAlign: "center",
      }}>{String(props.subtitle)}</Text>
    )}
  </View>
);

const Countdown = ({ props, fire, style }: CompProps) => {
  const until = String(props.until ?? "");
  const target = useMemo(() => new Date(until).getTime(), [until]);
  const [now, setNow] = useState(Date.now());
  const tickMs = pn(props.tickMs) ?? K.num("ui.Countdown.tickMs", 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  const remaining = Math.max(0, target - now);
  useEffect(() => {
    if (remaining === 0) fire("onComplete");
  }, [remaining, fire]);
  const s = Math.floor(remaining / 1000);
  const dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (
    <Text style={[{
      color: ps(props.color) ?? K.color("ui.Countdown.color", "#fff"),
      fontSize: pn(props.fontSize) ?? K.num("ui.Countdown.fontSize", 24),
      fontFamily: ps(props.fontFamily) ?? mono(),
    }, style]}>
      {dd > 0 ? K.txt("ui.Countdown.days", "{d}d ", { d: dd }) : ""}{String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
    </Text>
  );
};

/**
 * Lottie — through the app's MediaPlayer, which already plays Lottie JSON.
 *
 * `source` is any media spec (a url, a media-registry key); a bare `preset`
 * is looked up as a media key, so uploading an animation under that name is
 * all it takes. Nothing that resolves → nothing drawn. The old emoji stand-in
 * ("✨" at 64pt) shows only under ui.debugPlaceholders.
 */
const LottieAnimation = ({ props, style }: CompProps) => {
  const raw: any = props.source ?? props.url ?? (props.preset ? { key: String(props.preset) } : null);
  const spec = raw && typeof raw === "object" && "source" in raw ? raw.source : raw;
  const height = Number(props.height ?? K.num("ui.LottieAnimation.height", 120));
  if (spec && resolveMedia(spec).kind !== "empty") {
    return (
      <MediaPlayer
        spec={spec}
        style={[{ height, width: "100%" }, style]}
        contentFit={(props.contentFit as any) ?? "contain"}
        autoplay={typeof props.autoplay === "boolean" ? props.autoplay : undefined}
        loop={typeof props.loop === "boolean" ? props.loop : undefined}
        speed={typeof props.speed === "number" ? props.speed : undefined}
        playing={typeof props.playing === "boolean" ? props.playing : undefined}
      />
    );
  }
  if (!K.bool("ui.debugPlaceholders", false)) return null;
  return (
    <View style={[{ alignItems: "center", justifyContent: "center", height }, style]}>
      <Text style={{ fontSize: 64 }}>{String(props.fallback ?? "✨")}</Text>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Meta / helpers
// ---------------------------------------------------------------------------

const WebViewC = ({ props, style }: CompProps) => (
  <View style={[{ minHeight: pn(props.minHeight) ?? K.num("ui.WebView.minHeight", 300) }, style]}>
    <WebView source={{ uri: String(props.url ?? "about:blank") }} style={{ flex: 1 }} />
  </View>
);

const SVGC = ({ props, style }: CompProps) => (
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

const Gradient = ({ props, children, style }: CompProps) => {
  const colors: string[] = Array.isArray(props.colors) ? props.colors : K.list<string>("ui.Gradient.colors", ["#000", "#333"]);
  const direction = String(props.direction ?? "vertical");
  /**
   * WHERE each colour sits, 0..1. Without this the stops are spread evenly,
   * and an evenly spread scrim is the wrong shape for almost every screen —
   * a backdrop wants to stay clear for most of its height and then fall away
   * quickly where the words start. That is a stop at 0.55, not at 0.5, and it
   * was not expressible.
   */
  const locations: number[] | undefined =
    Array.isArray(props.locations) && props.locations.length === colors.length
      ? props.locations.map(Number)
      : undefined;
  /** Either end, as {x,y} 0..1, for a diagonal the two presets cannot make. */
  const start = props.start ?? (direction === "horizontal" ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 });
  const end = props.end ?? (direction === "horizontal" ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 });
  return (
    <LinearGradient
      colors={colors as any}
      locations={locations as any}
      start={start as any}
      end={end as any}
      style={style}
    >
      {children}
    </LinearGradient>
  );
};

const BlurBackground = ({ props, children, style }: CompProps) => (
  <View style={[{ overflow: "hidden", borderRadius: Number(props.radius ?? 0) }, style]}>
    <BlurView
      intensity={Number(props.intensity ?? K.num("ui.BlurBackground.intensity", 60))}
      tint={String(props.tint ?? K.str("ui.BlurBackground.tint", "dark")) as any}
      style={StyleSheet.absoluteFill}
    />
    <View style={{ padding: Number(props.padding ?? 0) }}>{children}</View>
  </View>
);

const QRCodeC = ({ props, style }: CompProps) => (
  <View style={style}>
    <QRCode
      value={String(props.value ?? "")}
      size={Number(props.size ?? K.num("ui.QRCode.size", 200))}
      backgroundColor={ps(props.background) ?? K.color("ui.QRCode.background", "transparent")}
      color={ps(props.color) ?? K.color("ui.QRCode.color", "#fff")}
    />
  </View>
);

// Conditional / structural helpers
const IfElse = ({ node, children, ctx }: CompProps) => {
  const cond = node.props?.if;
  // Reuse the main action evaluator so IfElse resolves the SAME condition set as
  // the rest of the app — including `{ flag: … }` against the REAL bootstrap
  // flags bag (via ctx.flags), which the old local `{}`-flags evaluator could
  // never satisfy.
  const truthy = evalCondition(cond, ctx);
  const kids = React.Children.toArray(children);
  return <>{truthy ? kids[0] : kids[1] ?? null}</>;
};

const ForEach = ({ node, children, store }: CompProps) => {
  const path = node.props?.items;
  const [, force] = useState(0);
  useEffect(() => path ? store.subscribe(() => force((n) => n + 1)) : undefined, [path, store]);
  const items = Array.isArray(store.get(String(path ?? ""))) ? store.get(String(path ?? "")) : [];
  const template = React.Children.toArray(children)[0];
  return <>{items.map((_: any, i: number) => <View key={i}>{template}</View>)}</>;
};

const Portal = ({ children }: CompProps) => <>{children}</>;

export const REGISTRY_V3: Record<string, React.ComponentType<CompProps>> = {
  Grid, MasonryGrid, Modal: ModalC, BottomSheet, ActionSheet, Popover, Tooltip,
  Collapsible, StickyHeader, SwipeableRow, PullToRefresh, SafeArea, Tabs,
  Switch, Slider: SliderC, Stepper, SegmentedControl, SearchField, Picker, DatePicker,
  LineChart, BarChart, Sparkline, ProgressRing, Gauge, StatCard, Waveform,
  // NOT PieChart — that name belongs to ./PieChart. See DonutChart above.
  DonutChart,
  Video, Audio, Camera, QRScanner, ImagePickerButton, Avatar, AvatarStack,
  Toast, Snackbar, LoadingSkeleton, Confetti, Rating, EmptyState, Countdown, LottieAnimation,
  WebView: WebViewC, SVG: SVGC, Gradient, BlurBackground, QRCode: QRCodeC,
  IfElse, ForEach, Portal,
};
