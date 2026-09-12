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

type Option = { angle?: string; text?: string };
type Row = { role?: string; text?: string; label?: string; options?: Option[] };

/** Everything visual, so the server can move all of it without a build. */
const D = {
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
};

export const ChatThread = ({ node, props, style, store, fire }: CompProps): React.ReactElement => {
  const c = { ...D, ...(props?.colors ?? {}) } as typeof D;
  const pickLabel = String(props?.pickLabel ?? "Tap the one that sounds like you");

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
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [count]);

  const bubble = (r: Row, i: number) => {
    if (r.role === "mine") {
      return (
        <View
          key={i}
          style={{
            alignSelf: "flex-end", maxWidth: "82%", backgroundColor: c.mineBg,
            paddingVertical: 10, paddingHorizontal: 14,
            borderRadius: c.radius, borderBottomRightRadius: 5,
          }}
        >
          <Text style={{ fontSize: 14.5, lineHeight: 21, color: c.mineText }}>{r.text ?? ""}</Text>
        </View>
      );
    }
    if (r.role === "note") {
      return (
        <View
          key={i}
          style={{
            alignSelf: "center", backgroundColor: c.noteBg, borderColor: c.noteBorder,
            borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11,
          }}
        >
          <Text style={{ fontSize: 11, letterSpacing: 0.5, color: c.noteText }}>{r.text ?? ""}</Text>
        </View>
      );
    }
    if (r.role === "variants") {
      const options = Array.isArray(r.options) ? r.options.filter((o) => o?.text) : [];
      if (!options.length) return null;
      const chose = picked[i];
      return (
        <View key={i} style={{ gap: 7 }}>
          <Text
            style={{
              fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase",
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
                activeOpacity={0.85}
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
                  borderWidth: 1, borderRadius: 14,
                  paddingVertical: 11, paddingHorizontal: 13,
                  opacity: dimmed ? 0.3 : 1,
                }}
              >
                {o.angle ? (
                  <Text
                    style={{
                      fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
                      color: isPicked ? c.pickedBorder : c.angleText, marginBottom: 4,
                    }}
                  >
                    {o.angle}
                  </Text>
                ) : null}
                <Text style={{ fontSize: 14, lineHeight: 21, color: c.variantText }}>{o.text}</Text>
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
          alignSelf: "flex-start", maxWidth: "88%", backgroundColor: c.askBg,
          borderColor: c.askBorder, borderWidth: 1,
          paddingVertical: 12, paddingHorizontal: 14,
          borderRadius: c.radius, borderBottomLeftRadius: 5,
        }}
      >
        <Text style={{ fontSize: 14.5, lineHeight: 22, color: c.askText }}>{r.text ?? ""}</Text>
      </View>
    );
  };

  const body = useMemo(() => rows.map(bubble), [rows, picked, c.radius]);

  return (
    <ScrollView
      ref={scroller}
      style={[{ flex: 1 }, style]}
      contentContainerStyle={{ gap: c.gap, paddingBottom: 10 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
};
