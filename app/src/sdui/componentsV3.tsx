/**
 * SDUI v3 components — the "kitchen sink" batch added so future features go
 * backend-JSON-only. Every component here reads `node`, `props`, `style`,
 * `children`, `fire` from the standard CompProps interface (see components.tsx).
 * Kept in its own file so the v1/v2 primitives stay easy to audit.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Easing, FlatList, Modal as RNModal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import type { GestureResponderEvent } from "react-native";
import Slider from "@react-native-community/slider";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Image as ExpoImage } from "expo-image";
import Svg, { Circle, G, Path, Polyline, Rect } from "react-native-svg";
import QRCode from "react-native-qrcode-svg";
import { WebView } from "react-native-webview";

import type { CompProps } from "./components";
import { useTheme, tok, staticText } from "./components";
import { evalCondition } from "./actions";
import { MediaPlayer } from "../media/MediaPlayer";

// ---------------------------------------------------------------------------
// Layout / navigation
// ---------------------------------------------------------------------------

const Grid = ({ props, children, style }: CompProps) => {
  const columns = Math.max(1, Number(props.columns ?? 2));
  const gap = Number(props.gap ?? 12);
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
  const columns = Math.max(1, Number(props.columns ?? 2));
  const gap = Number(props.gap ?? 12);
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

const ModalC = ({ node, props, children, fire, store, style }: CompProps) => {
  const bindKey = node.bind?.open;
  const [ver, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const open = bindKey ? !!store.get(bindKey) : !!props.open;
  const dismissable = props.dismissable !== false;
  const close = () => {
    if (bindKey) store.set(bindKey, false);
    fire("onDismiss");
  };
  return (
    <RNModal visible={open} transparent animationType="fade" onRequestClose={dismissable ? close : undefined}>
      {/* props.blur → frost the content behind the card instead of just dimming it. */}
      {props.blur ? (
        <BlurView intensity={Number(props.blurIntensity ?? 45)} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      ) : null}
      <Pressable style={props.blur ? styles.modalScrimBlur : styles.modalScrim} onPress={dismissable ? close : undefined}>
        <Pressable onPress={(e) => e.stopPropagation()} style={[styles.modalCard, style]}>
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

const BottomSheet = ({ node, children, fire, store, style }: CompProps) => {
  const bindKey = node.bind?.open;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const open = !!store.get(bindKey ?? "");
  const close = () => {
    if (bindKey) store.set(bindKey, false);
    fire("onDismiss");
  };
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.sheetScrim} onPress={close}>
        <Pressable onPress={(e) => e.stopPropagation()} style={[styles.sheet, style]}>
          <View style={styles.sheetHandle} />
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

const ActionSheet = ({ node, props, fire, store, style }: CompProps) => {
  const bindKey = node.bind?.open;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const open = !!store.get(bindKey ?? "");
  const close = () => {
    if (bindKey) store.set(bindKey, false);
    fire("onDismiss");
  };
  const actions = Array.isArray(props.actions) ? props.actions : [];
  return (
    <RNModal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.sheetScrim} onPress={close}>
        <Pressable onPress={(e) => e.stopPropagation()} style={[styles.actionSheet, style]}>
          {actions.map((a: any, i: number) => (
            <Pressable
              key={i}
              onPress={() => { close(); fire("onSelect", a); }}
              style={styles.actionRow}
            >
              <Text style={[styles.actionText, a.destructive && { color: "#ff5a5f" }]}>{a.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </RNModal>
  );
};

const Popover = ({ props, children, style }: CompProps) => (
  <View style={[styles.popover, style]}>
    {children}
    {props.title ? <Text style={styles.popoverTitle}>{String(props.title)}</Text> : null}
  </View>
);

const Tooltip = ({ props, children, style }: CompProps) => {
  const [visible, setVisible] = useState(false);
  return (
    <Pressable onLongPress={() => setVisible(true)} onPressOut={() => setVisible(false)}>
      <View style={style}>{children}</View>
      {visible && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>{String(props.content ?? "")}</Text>
        </View>
      )}
    </Pressable>
  );
};

const Collapsible = ({ props, children, style }: CompProps) => {
  const [open, setOpen] = useState(!!props.defaultOpen);
  return (
    <View style={style}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.collapsibleHeader}>
        <Text style={styles.collapsibleTitle}>{String(props.title ?? "")}</Text>
        <Text style={styles.collapsibleChevron}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open && <View style={{ paddingVertical: 8 }}>{children}</View>}
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
  return (
    <View style={style}>
      <View style={styles.tabsRow}>
        {tabs.map((t, i) => (
          <Pressable key={t.id} onPress={() => setActive(i)} style={[styles.tabItem, active === i && styles.tabItemActive]}>
            <Text style={[styles.tabText, active === i && styles.tabTextActive]}>{t.title}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const Switch = ({ node, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = !!store.get(bindKey ?? "");
  const toggle = () => {
    if (bindKey) store.set(bindKey, !value);
    fire("onChange", !value);
  };
  return (
    <Pressable onPress={toggle} style={[styles.switchTrack, value && styles.switchTrackOn, style]}>
      <Animated.View style={[styles.switchThumb, value && { transform: [{ translateX: 20 }] }]} />
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
      minimumTrackTintColor="#ffffff"
      maximumTrackTintColor="#333"
      thumbTintColor="#ffffff"
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
  return (
    <View style={[styles.stepperRow, style]}>
      <Pressable onPress={() => set(value - step)} style={styles.stepperBtn}><Text style={styles.stepperBtnText}>−</Text></Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable onPress={() => set(value + step)} style={styles.stepperBtn}><Text style={styles.stepperBtnText}>+</Text></Pressable>
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
    <View style={[styles.segmentedTrack, style]}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          onPress={() => {
            if (bindKey) store.set(bindKey, o.value);
            fire("onChange", o.value);
          }}
          style={[styles.segmentedItem, active === o.value && styles.segmentedItemActive]}
        >
          <Text style={[styles.segmentedText, active === o.value && styles.segmentedTextActive]}>{o.label}</Text>
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
  return (
    <View style={[styles.searchField, style]}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        placeholder={String(props.placeholder ?? "Search")}
        placeholderTextColor="#666"
        value={value}
        onChangeText={(t) => {
          if (bindKey) store.set(bindKey, t);
          fire("onChange", t);
        }}
        onSubmitEditing={(e) => fire("onSubmit", e.nativeEvent.text)}
        style={styles.searchInput}
        returnKeyType="search"
      />
    </View>
  );
};

const Picker = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const options: Array<{ label: string; value: any }> = Array.isArray(props.options) ? props.options : [];
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const value = store.get(bindKey ?? "");
  const current = options.find((o) => o.value === value);
  return (
    <View style={style}>
      <Pressable onPress={() => setOpen(true)} style={styles.pickerField}>
        <Text style={styles.pickerText}>{current?.label ?? String(props.placeholder ?? "Select…")}</Text>
        <Text style={styles.pickerChevron}>▾</Text>
      </Pressable>
      <RNModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}>
          <View style={styles.pickerSheet}>
            {options.map((o) => (
              <Pressable
                key={String(o.value)}
                onPress={() => {
                  if (bindKey) store.set(bindKey, o.value);
                  fire("onChange", o.value);
                  setOpen(false);
                }}
                style={styles.pickerOption}
              >
                <Text style={styles.pickerOptionText}>{o.label}</Text>
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
      style={[styles.textField, style]}
      placeholder={String(props.placeholder ?? "YYYY-MM-DD")}
      placeholderTextColor="#666"
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
  const color = String(props.color ?? "#ffffff");
  const w = 100, h = 40;
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
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} />
      </Svg>
    </View>
  );
};

const BarChart = ({ props, style }: CompProps) => {
  const series: Array<{ label: string; value: number }> = Array.isArray(props.series) ? props.series : [];
  const max = Math.max(1, ...series.map((s) => s.value));
  const color = String(props.color ?? "#ffffff");
  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 120 }, style]}>
      {series.map((s, i) => (
        <View key={i} style={{ flex: 1, alignItems: "center" }}>
          <View style={{ backgroundColor: color, width: "70%", height: `${(s.value / max) * 100}%`, borderRadius: 3 }} />
          <Text style={styles.barLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
};

const Sparkline = ({ props, style }: CompProps) => {
  const data: number[] = Array.isArray(props.data) ? props.data : [];
  const color = String(props.color ?? "#ffffff");
  const w = 100, h = 30;
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
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={1} />
      </Svg>
    </View>
  );
};

const ProgressRing = ({ props, style }: CompProps) => {
  const progress = Math.max(0, Math.min(1, Number(props.progress ?? 0)));
  const size = Number(props.size ?? 80);
  const stroke = Number(props.stroke ?? 6);
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#333" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={String(props.color ?? "#ffffff")} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * progress} ${c}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {props.label != null && (
        <Text style={{ position: "absolute", color: "#fff", fontWeight: "700" }}>{String(props.label)}</Text>
      )}
    </View>
  );
};

const Gauge = ({ props, style }: CompProps) => {
  const min = Number(props.min ?? 0), max = Number(props.max ?? 100);
  const value = Math.max(min, Math.min(max, Number(props.value ?? 0)));
  const pct = (value - min) / Math.max(1e-9, max - min);
  return (
    <View style={style}>
      <View style={styles.gaugeTrack}>
        <View style={[styles.gaugeFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.gaugeText}>{value}</Text>
    </View>
  );
};

const StatCard = ({ props, style }: CompProps) => {
  const delta = props.delta != null ? Number(props.delta) : null;
  return (
    <View style={[styles.statCard, style]}>
      <Text style={styles.statLabel}>{String(props.label ?? "")}</Text>
      <Text style={styles.statValue}>{String(props.value ?? "")}</Text>
      {delta != null && (
        <Text style={[styles.statDelta, delta >= 0 ? styles.deltaPos : styles.deltaNeg]}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}
        </Text>
      )}
    </View>
  );
};

// Default categorical palette (brand amber first, then a legible set on dark).
// Backend can override per-slice with `color`.
const PIE_PALETTE = ["#E8A23C", "#6EA8FE", "#48D39A", "#F0736A", "#B98CFF", "#F2C078", "#7DD3FC", "#FCA5A5"];

// PieChart / Donut. Renders `data: [{ label, value, color? }]` as SVG arc
// slices. Donut by default (set `donut:false` for a full pie); optional center
// label and a legend (below by default, `legend:"right"` to sit beside it).
const PieChart = ({ props, style }: CompProps) => {
  const raw: Array<{ label?: string; value: number; color?: string }> =
    Array.isArray(props.data) ? props.data : [];
  const data = raw.filter((d) => (Number(d?.value) || 0) > 0);
  const size = Number(props.size ?? 168);
  const isDonut = props.donut !== false;
  const thickness = Number(props.thickness ?? size * 0.26);
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
    return { d, frac, a0, a1, color: d.color ?? PIE_PALETTE[i % PIE_PALETTE.length], i };
  });

  return (
    <View style={[{ flexDirection: legendRight ? "row" : "column", alignItems: "center", gap: 16 }, style]}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size}>
          {total <= 0 ? (
            <Circle cx={cx} cy={cy} r={r - 1} fill="none" stroke="#2a2a30" strokeWidth={2} />
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
          <View style={styles.pieCenter} pointerEvents="none">
            {props.centerValue != null && <Text style={styles.pieCenterValue}>{String(props.centerValue)}</Text>}
            {props.centerLabel != null && <Text style={styles.pieCenterLabel}>{String(props.centerLabel)}</Text>}
          </View>
        )}
      </View>
      {showLegend && slices.length > 0 && (
        <View style={{ gap: 7 }}>
          {slices.map((s) => (
            <View key={s.i} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>{String(s.d.label ?? "")}</Text>
              <Text style={styles.legendValue}>{Math.round(s.frac * 100)}%</Text>
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
  const level = Math.max(0, Math.min(1, Number(store.get(bindKey ?? "") ?? props.level ?? 0.2)));
  const bars = 20;
  return (
    <View style={[styles.waveform, style]}>
      {Array.from({ length: bars }).map((_, i) => {
        const rand = 0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + level * 3));
        return <View key={i} style={{ width: 3, marginHorizontal: 1.5, height: `${rand * level * 100}%`, backgroundColor: "#fff", borderRadius: 1.5 }} />;
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

// Video/Audio: real playback requires expo-video/expo-audio hooks. Ship a
// placeholder that shows a link + tap-to-open; upgrade via OTA to the fancy
// player when we style it. Backend contract stays stable.
// Real media node (was a text placeholder): renders the app's MediaPlayer.
// `playing` is bindable, so the backend can drive play/pause from state —
// e.g. the Train screen's refine trigger plays the brand media while the
// variants generate and pauses when they land. An mp4 freezes on its frame
// when paused; an animated GIF unmounts when paused, revealing whatever the
// backend stacked beneath it.
const Video = ({ props, style }: CompProps) => {
  const raw: any = props.source;
  // Accept a full MediaSpec ({ source, freezeOnPause, … }) or a bare source.
  const spec = raw && typeof raw === "object" && "source" in raw ? raw : { source: raw };
  return (
    <MediaPlayer
      spec={spec as any}
      style={style}
      contentFit={(props.contentFit as any) ?? "cover"}
      autoplay={typeof props.autoplay === "boolean" ? props.autoplay : undefined}
      loop={(props.loop as boolean | undefined) ?? true}
      muted={props.muted !== false}
      playing={typeof props.playing === "boolean" ? props.playing : undefined}
    />
  );
};
const Audio = ({ props, style }: CompProps) => (
  <View style={[styles.mediaPlaceholder, style]}>
    <Text style={styles.mediaText}>♫ Audio: {String(props.source ?? "")}</Text>
  </View>
);
const Camera = ({ props, style }: CompProps) => (
  <View style={[styles.mediaPlaceholder, style]}>
    <Text style={styles.mediaText}>📷 Camera ({String(props.mode ?? "photo")})</Text>
  </View>
);
const QRScanner = ({ style }: CompProps) => (
  <View style={[styles.mediaPlaceholder, style]}>
    <Text style={styles.mediaText}>▧ QR Scanner</Text>
  </View>
);
const ImagePickerButton = ({ props, fire, style }: CompProps) => (
  <Pressable onPress={() => fire("onPress")} style={[styles.pill, style]}>
    <Text style={styles.pillText}>{String(props.label ?? "Pick image")}</Text>
  </Pressable>
);

const Avatar = ({ props, style }: CompProps) => {
  const size = Number(props.size ?? 40);
  const initials = String(props.name ?? "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#333", alignItems: "center", justifyContent: "center", overflow: "hidden" }, style]}>
      {props.source ? (
        <ExpoImage source={{ uri: String(props.source) }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.4 }}>{initials}</Text>
      )}
    </View>
  );
};

const AvatarStack = ({ props, style }: CompProps) => {
  const avatars: Array<{ source?: string; name?: string }> = Array.isArray(props.avatars) ? props.avatars : [];
  const size = Number(props.size ?? 32);
  return (
    <View style={[{ flexDirection: "row" }, style]}>
      {avatars.slice(0, 5).map((a, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3, borderWidth: 2, borderColor: "#000", borderRadius: size / 2 }}>
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
const Toast = ({ props, style }: CompProps) => (
  <View style={[styles.toast, style]}>
    <Text style={styles.toastText}>{String(props.message ?? "")}</Text>
  </View>
);
const Snackbar = ({ props, fire, style }: CompProps) => (
  <View style={[styles.snackbar, style]}>
    <Text style={styles.snackText}>{String(props.message ?? "")}</Text>
    {props.actionLabel && (
      <Pressable onPress={() => fire("onPress")}>
        <Text style={styles.snackAction}>{String(props.actionLabel)}</Text>
      </Pressable>
    )}
  </View>
);

const LoadingSkeleton = ({ props, style }: CompProps) => {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })).start();
  }, [shimmer]);
  const opacity = shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.7, 0.3] });
  return (
    <Animated.View style={[{ backgroundColor: "#222", borderRadius: Number(props.radius ?? 6), height: Number(props.height ?? 16), width: props.width ?? "100%", opacity }, style]} />
  );
};

const Confetti = ({ style }: CompProps) => (
  <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
    <Text style={styles.confettiText}>🎉</Text>
  </View>
);

const Rating = ({ node, props, style, store, fire }: CompProps) => {
  const bindKey = node.bind?.value;
  const [, force] = useState(0);
  useEffect(() => bindKey ? store.subscribe(() => force((n) => n + 1)) : undefined, [bindKey, store]);
  const max = Number(props.max ?? 5);
  const value = Number(store.get(bindKey ?? "") ?? 0);
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
          <Text style={{ fontSize: 28, color: i < value ? "#FFC94A" : "#333" }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
};

const EmptyState = ({ props, style }: CompProps) => (
  <View style={[styles.emptyState, style]}>
    {props.icon && <Text style={{ fontSize: 48, marginBottom: 8 }}>{String(props.icon)}</Text>}
    <Text style={styles.emptyTitle}>{String(props.title ?? "")}</Text>
    {props.subtitle && <Text style={styles.emptySubtitle}>{String(props.subtitle)}</Text>}
  </View>
);

const Countdown = ({ props, fire, style }: CompProps) => {
  const until = String(props.until ?? "");
  const target = useMemo(() => new Date(until).getTime(), [until]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, target - now);
  useEffect(() => {
    if (remaining === 0) fire("onComplete");
  }, [remaining, fire]);
  const s = Math.floor(remaining / 1000);
  const dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (
    <Text style={[styles.countdown, style]}>
      {dd > 0 ? `${dd}d ` : ""}{String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
    </Text>
  );
};

// Lottie: real playback needs `lottie-react-native`. Preset name maps to a
// bundled JSON later; ship an emoji fallback so it visibly renders now.
const LottieAnimation = ({ props, style }: CompProps) => (
  <View style={[{ alignItems: "center", justifyContent: "center", height: Number(props.height ?? 120) }, style]}>
    <Text style={{ fontSize: 64 }}>{String(props.fallback ?? "✨")}</Text>
  </View>
);

// ---------------------------------------------------------------------------
// Meta / helpers
// ---------------------------------------------------------------------------

const WebViewC = ({ props, style }: CompProps) => (
  <View style={[{ minHeight: 300 }, style]}>
    <WebView source={{ uri: String(props.url ?? "about:blank") }} style={{ flex: 1 }} />
  </View>
);

const SVGC = ({ props, style }: CompProps) => (
  <View style={style}>
    <Svg viewBox={String(props.viewBox ?? "0 0 100 100")}>
      <Path d={String(props.d ?? "")} fill={String(props.fill ?? "#fff")} stroke={String(props.stroke ?? "none")} strokeWidth={Number(props.strokeWidth ?? 0)} />
    </Svg>
  </View>
);

const Gradient = ({ props, children, style }: CompProps) => {
  const colors: string[] = Array.isArray(props.colors) ? props.colors : ["#000", "#333"];
  const direction = String(props.direction ?? "vertical");
  const start = direction === "horizontal" ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 };
  const end = direction === "horizontal" ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 };
  return <LinearGradient colors={colors as any} start={start} end={end} style={style}>{children}</LinearGradient>;
};

const BlurBackground = ({ props, children, style }: CompProps) => (
  <View style={[{ overflow: "hidden", borderRadius: Number(props.radius ?? 0) }, style]}>
    <BlurView intensity={Number(props.intensity ?? 60)} tint={String(props.tint ?? "dark") as any} style={StyleSheet.absoluteFill} />
    <View style={{ padding: Number(props.padding ?? 0) }}>{children}</View>
  </View>
);

const QRCodeC = ({ props, style }: CompProps) => (
  <View style={style}>
    <QRCode value={String(props.value ?? "")} size={Number(props.size ?? 200)} backgroundColor="transparent" color="#fff" />
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalScrimBlur: { flex: 1, backgroundColor: "rgba(0,0,0,0.2)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#0b0b0f", borderRadius: 16, padding: 20, minWidth: 260, maxWidth: 400, width: "100%" },
  sheetScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#0b0b0f", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetHandle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#444", marginBottom: 12 },
  actionSheet: { backgroundColor: "#0b0b0f", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  actionRow: { paddingVertical: 18, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#222" },
  actionText: { color: "#fff", fontSize: 17 },
  popover: { backgroundColor: "#1a1a1f", borderRadius: 12, padding: 14, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  popoverTitle: { color: "#fff", fontWeight: "700", marginTop: 6 },
  tooltip: { position: "absolute", top: -30, backgroundColor: "rgba(20,20,25,0.95)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  tooltipText: { color: "#fff", fontSize: 12 },
  collapsibleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  collapsibleTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  collapsibleChevron: { color: "#aaa", fontSize: 16 },
  tabsRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#222" },
  tabItem: { paddingVertical: 12, paddingHorizontal: 16 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: "#fff" },
  tabText: { color: "#888" },
  tabTextActive: { color: "#fff", fontWeight: "700" },
  switchTrack: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#333", padding: 3, justifyContent: "center" },
  switchTrackOn: { backgroundColor: "#4CD964" },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepperBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1c1c25", alignItems: "center", justifyContent: "center" },
  stepperBtnText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  stepperValue: { color: "#fff", fontSize: 16, minWidth: 28, textAlign: "center" },
  segmentedTrack: { flexDirection: "row", backgroundColor: "#1c1c25", borderRadius: 8, padding: 2 },
  segmentedItem: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  segmentedItemActive: { backgroundColor: "#fff" },
  segmentedText: { color: "#aaa", fontSize: 13, fontWeight: "600" },
  segmentedTextActive: { color: "#000" },
  searchField: { flexDirection: "row", alignItems: "center", backgroundColor: "#1c1c25", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  searchIcon: { color: "#666", marginRight: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  pickerField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1c1c25", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  pickerText: { color: "#fff", fontSize: 15 },
  pickerChevron: { color: "#888" },
  pickerSheet: { backgroundColor: "#0b0b0f", borderRadius: 16, minWidth: 260, maxWidth: 400, width: "80%" },
  pickerOption: { paddingVertical: 16, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#222" },
  pickerOptionText: { color: "#fff", fontSize: 15 },
  textField: { backgroundColor: "#1c1c25", color: "#fff", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  barLabel: { color: "#888", fontSize: 10, marginTop: 4 },
  gaugeTrack: { height: 8, backgroundColor: "#1c1c25", borderRadius: 4, overflow: "hidden" },
  gaugeFill: { height: "100%", backgroundColor: "#4CD964" },
  gaugeText: { color: "#fff", marginTop: 4, fontWeight: "600" },
  statCard: { backgroundColor: "#0b0b0f", padding: 14, borderRadius: 12, gap: 4 },
  statLabel: { color: "#888", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  statValue: { color: "#fff", fontSize: 28, fontWeight: "800" },
  statDelta: { fontSize: 12 },
  deltaPos: { color: "#4CD964" },
  deltaNeg: { color: "#ff5a5f" },
  waveform: { flexDirection: "row", alignItems: "flex-end", height: 48 },
  mediaPlaceholder: { backgroundColor: "#1c1c25", borderRadius: 12, padding: 16 },
  mediaText: { color: "#aaa" },
  pill: { backgroundColor: "#fff", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24, alignItems: "center" },
  pillText: { color: "#000", fontWeight: "700" },
  toast: { backgroundColor: "#0b0b0f", borderRadius: 10, padding: 12 },
  toastText: { color: "#fff" },
  snackbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#0b0b0f", borderRadius: 10, padding: 14, gap: 12 },
  snackText: { color: "#fff", flex: 1 },
  snackAction: { color: "#4CD964", fontWeight: "700" },
  emptyState: { alignItems: "center", padding: 32 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  emptySubtitle: { color: "#888", marginTop: 6, textAlign: "center" },
  countdown: { color: "#fff", fontSize: 24, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  confettiText: { fontSize: 96, textAlign: "center", marginTop: 60 },
  // Pie / donut chart
  pieCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  pieCenterValue: { color: "#fff", fontSize: 26, fontWeight: "800" },
  pieCenterLabel: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { color: "rgba(255,255,255,0.82)", fontSize: 13, minWidth: 96 },
  legendValue: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
});

export const REGISTRY_V3: Record<string, React.ComponentType<CompProps>> = {
  Grid, MasonryGrid, Modal: ModalC, BottomSheet, ActionSheet, Popover, Tooltip,
  Collapsible, StickyHeader, SwipeableRow, PullToRefresh, SafeArea, Tabs,
  Switch, Slider: SliderC, Stepper, SegmentedControl, SearchField, Picker, DatePicker,
  LineChart, BarChart, Sparkline, ProgressRing, Gauge, StatCard, Waveform,
  PieChart, DonutChart: PieChart,
  Video, Audio, Camera, QRScanner, ImagePickerButton, Avatar, AvatarStack,
  Toast, Snackbar, LoadingSkeleton, Confetti, Rating, EmptyState, Countdown, LottieAnimation,
  WebView: WebViewC, SVG: SVGC, Gradient, BlurBackground, QRCode: QRCodeC,
  IfElse, ForEach, Portal,
};
