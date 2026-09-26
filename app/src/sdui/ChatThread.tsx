/**
 * ChatThread — the Training tab's conversation, rendered from state.
 *
 * SDUI has no repeater. `List` renders its children and nothing else, so a
 * growing thread could not be expressed as backend JSON at all: every screen
 * that wanted one had to know its rows at build time, which is why the Train
 * tab was a form with three variant slots stapled under it rather than a
 * conversation.
 *
 * This is the repeater, scoped to one shape. It reads an array from the store
 * and draws it. The backend owns what goes in — every string in the thread is
 * something a server action appended — and owns how it looks, because all the
 * colours and radii below are props with defaults rather than constants.
 *
 * Row shapes (whatever the server appends):
 *   { role: "ask",      text }                what the app asked
 *   { role: "mine",     text }                what the user answered
 *   { role: "note",     text }                a centred aside ("Learned: dry")
 *   { role: "variants", options: [{ angle, text }] }
 *
 * Picking is handled here rather than by the server, because the tap has to
 * feel instant and a round trip cannot. The choice is written straight into
 * the store — at paths the SERVER names — and then `onSelect` fires. So the
 * server still decides what a pick MEANS; it just does not have to be present
 * for the row to respond.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { CompProps } from "./components";
import * as K from "./knobs";

type Option = { angle?: string; text?: string };
type Row = { role?: string; text?: string; label?: string; options?: Option[] };

/**
 * Everything visual, so the server can move all of it without a build: the
 * ui.ChatThread.look knob for every thread, then a node's `colors` / `look`
 * over that. The literal is what the thread always drew.
 */
const defaults = () => K.obj("ui.ChatThread.look", {
  askBg: "rgba(255,255,255,0.06)",
  askBorder: "rgba(255,255,255,0.09)",
  askText: "rgba(255,255,255,0.9)",
  mineBg: "#FFFFFF",
  mineText: "#000000",
  noteText: "#E8A23C",
  noteBg: "rgba(232,162,60,0.1)",
  noteBorder: "rgba(232,162,60,0.26)",
  variantBg: "rgba(255,255,255,0.05)",
  variantBorder: "rgba(255,255,255,0.1)",
  variantText: "rgba(255,255,255,0.92)",
  angleText: "rgba(255,255,255,0.4)",
  pickedBg: "rgba(232,162,60,0.13)",
  pickedBorder: "#E8A23C",
  labelText: "rgba(255,255,255,0.38)",
  radius: 16,
  gap: 11,
  tailRadius: 5,
  mineMaxWidth: "82%",
  askMaxWidth: "88%",
  bubbleFontSize: 14.5,
  mineLineHeight: 21,
  askLineHeight: 22,
  minePadV: 10,
  askPadV: 12,
  bubblePadH: 14,
  noteFontSize: 11,
  noteTracking: 0.5,
  notePadV: 5,
  notePadH: 11,
  noteRadius: 999,
  variantsGap: 7,
  labelFontSize: 10.5,
  labelTracking: 1.4,
  variantRadius: 14,
  variantPadV: 11,
  variantPadH: 13,
  variantFontSize: 14,
  variantLineHeight: 21,
  angleFontSize: 10,
  angleTracking: 1,
  angleMarginBottom: 4,
  dimmedOpacity: 0.3,
  activeOpacity: 0.85,
  borderWidth: 1,
  paddingBottom: 10,
  scrollDelayMs: 60
});
type Look = ReturnType<typeof defaults>;

export const ChatThread = ({ node, props, style, store, fire }: CompProps): React.ReactElement => {
  const c = { ...defaults(), ...(props?.colors ?? {}), ...(props?.look ?? {}) } as Look;
  const pickLabel = String(props?.pickLabel ?? K.txt("ui.ChatThread.pickLabel", "Tap the one that sounds like you"));

  // Where a pick is written. The server names these so the action that runs
  // afterwards can read them as ordinary $state references.
  const chosenPath = String(props?.chosenPath ?? "_chosen");
  const rejAPath = String(props?.rejectedAPath ?? "_rejA");
  const rejBPath = String(props?.rejectedBPath ?? "_rejB");
  const anglePath = String(props?.anglePath ?? "_angle");

  const threadKey = node.bind?.thread;
  const [, force] = useState(0);
  useEffect(
    () => (threadKey ? store.subscribe(() => force((n) => n + 1)) : undefined),
    [threadKey, store],
  );

  const raw = store.get(threadKey ?? "");
  const rows: Row[] = Array.isArray(raw) ? (raw as Row[]) : [];

  // Which option was taken in which row. Keyed by row index: the thread only
  // ever grows, so an index is stable for the life of the screen.
  const [picked, setPicked] = useState<Record<number, number>>({});

  const scroller = useRef<ScrollView>(null);
  const count = rows.length;
  useEffect(() => {
    // A new row that lands below the fold is a row nobody sees. The delay is
    // for layout: scrolling before the row has measured lands short.
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), Number(c.scrollDelayMs));
    return () => clearTimeout(t);
  }, [count]);

  const bubble = (r: Row, i: number) => {
    if (r.role === "mine") {
      return (
        <View
          key={i}
          style={{
            alignSelf: "flex-end", maxWidth: c.mineMaxWidth as `${number}%`, backgroundColor: c.mineBg,
            paddingVertical: c.minePadV, paddingHorizontal: c.bubblePadH,
            borderRadius: c.radius, borderBottomRightRadius: c.tailRadius,
          }}
        >
          <Text style={{ fontSize: c.bubbleFontSize, lineHeight: c.mineLineHeight, color: c.mineText }}>{r.text ?? ""}</Text>
        </View>
      );
    }
    if (r.role === "note") {
      return (
        <View
          key={i}
          style={{
            alignSelf: "center", backgroundColor: c.noteBg, borderColor: c.noteBorder,
            borderWidth: c.borderWidth, borderRadius: c.noteRadius, paddingVertical: c.notePadV, paddingHorizontal: c.notePadH,
          }}
        >
          <Text style={{ fontSize: c.noteFontSize, letterSpacing: c.noteTracking, color: c.noteText }}>{r.text ?? ""}</Text>
        </View>
      );
    }
    if (r.role === "variants") {
      const options = Array.isArray(r.options) ? r.options.filter((o) => o?.text) : [];
      if (!options.length) return null;
      const chose = picked[i];
      return (
        <View key={i} style={{ gap: c.variantsGap }}>
          <Text
            style={{
              fontSize: c.labelFontSize, letterSpacing: c.labelTracking, textTransform: "uppercase",
              color: c.labelText,
            }}
          >
            {r.label ?? pickLabel}
          </Text>
          {options.map((o, j) => {
            const isPicked = chose === j;
            const dimmed = chose != null && !isPicked;
            return (
              <TouchableOpacity
                key={j}
                activeOpacity={c.activeOpacity}
                disabled={chose != null}
                onPress={() => {
                  // Snapshot BEFORE the optimistic UI, and in the order the
                  // server's pick endpoint expects: what was taken, then the
                  // two that were not.
                  const others = options.filter((_, k) => k !== j);
                  store.set(chosenPath, o.text ?? "");
                  store.set(anglePath, o.angle ?? "");
                  store.set(rejAPath, others[0]?.text ?? "");
                  store.set(rejBPath, others[1]?.text ?? "");
                  setPicked((p) => ({ ...p, [i]: j }));
                  fire("onSelect", o.text ?? "");
                }}
                style={{
                  backgroundColor: isPicked ? c.pickedBg : c.variantBg,
                  borderColor: isPicked ? c.pickedBorder : c.variantBorder,
                  borderWidth: c.borderWidth, borderRadius: c.variantRadius,
                  paddingVertical: c.variantPadV, paddingHorizontal: c.variantPadH,
                  opacity: dimmed ? c.dimmedOpacity : 1,
                }}
              >
                {o.angle ? (
                  <Text
                    style={{
                      fontSize: c.angleFontSize, letterSpacing: c.angleTracking, textTransform: "uppercase",
                      color: isPicked ? c.pickedBorder : c.angleText, marginBottom: c.angleMarginBottom,
                    }}
                  >
                    {o.angle}
                  </Text>
                ) : null}
                <Text style={{ fontSize: c.variantFontSize, lineHeight: c.variantLineHeight, color: c.variantText }}>{o.text}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }
    // Anything else is something the app said.
    return (
      <View
        key={i}
        style={{
          alignSelf: "flex-start", maxWidth: c.askMaxWidth as `${number}%`, backgroundColor: c.askBg,
          borderColor: c.askBorder, borderWidth: c.borderWidth,
          paddingVertical: c.askPadV, paddingHorizontal: c.bubblePadH,
          borderRadius: c.radius, borderBottomLeftRadius: c.tailRadius,
        }}
      >
        <Text style={{ fontSize: c.bubbleFontSize, lineHeight: c.askLineHeight, color: c.askText }}>{r.text ?? ""}</Text>
      </View>
    );
  };

  // Keyed on the whole look, so a new bootstrap or a restyled node redraws.
  const lookKey = JSON.stringify(c);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const body = useMemo(() => rows.map(bubble), [rows, picked, lookKey]);

  return (
    <ScrollView
      ref={scroller}
      style={[{ flex: 1 }, style]}
      contentContainerStyle={{ gap: c.gap, paddingBottom: c.paddingBottom }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
};
