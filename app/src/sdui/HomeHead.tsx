/**
 * HOME'S HEADER, ALIVE (types.ts WriteOnProps, LiveMarkProps, HeadBarProps; components "WriteOn", "LiveMark",
 * "HeadBar", sent with BotsMotion). Three small nodes, each with a still fallback on the server for older builds:
 *
 *   WriteOn   the bold line that writes itself in, word by word at dictation's uneven pace (core writeOnTimes), with
 *             Keybot's clay caret blinking after the last word, as if Keybot were writing it to you; the caret fades
 *             a few seconds after. Once per app open and line (`once`, which carries the part of the day): a return
 *             to Home finds it written, and a return in the middle carries on where it was. Reduce Motion: written.
 *   LiveMark  the Tailzu dot mark, alive (core LiveMark): its ring dots drift on springs, its eyes look toward the
 *             finger and swing with a scroll, a ring dot lights in a bot's colour while that bot works (`lit`); a tap
 *             squishes it and runs on.onPress (Ask). Reduce Motion: still, and the tap goes straight through.
 *   HeadBar   a compact bar (its children: the mark and "Your bots") pinned at the top of the screen, outside the
 *             scroll (the kit puts it before the Screen), that comes in once the page has scrolled past `at` (the big
 *             header has gone under it) and goes again near the top.
 *
 * The scroll and the finger come from the screen on show (pageBus.ts), with no render per event.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import type { CompProps } from "./components";
import { LiveMark, writeOnTimes } from "../botTiles/core";
import { TileSurface, useReducedMotion, useTileLoop, type Painter } from "../botTiles/TileSurface";
import { onPage, pageNow } from "./pageBus";

const seedOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// ------------------------------------------------------------------ WriteOn

/** When each line began to write itself (by `once`), for the life of the app. */
const STARTED = new Map<string, number>();
/** How long the caret stays after the last word, before it fades. */
const CARET_STAYS_MS = 2600;

export function WriteOn({ props }: CompProps): React.ReactElement {
  const content = String(props?.content ?? "");
  const words = useMemo(() => content.split(/\s+/).filter(Boolean), [content]);
  const once = String(props?.once || content);
  const times = useMemo(() => writeOnTimes(words, seedOf(once)), [words, once]);
  const size = Number(props?.size) || 30;
  const lh = Number(props?.lineHeight) || Math.round(size * 1.18);
  const caretH = Math.round(size * 0.9);
  const font = {
    fontFamily: String(props?.fontFamily || "Tailzu Geist Bold"), fontWeight: "normal" as const, fontSize: size, lineHeight: lh,
    letterSpacing: Number(props?.tracking) || 0, color: String(props?.color || "#0a0a0a"),
  };
  const reduced = useReducedMotion();
  const ops = useMemo(() => words.map(() => new Animated.Value(0)), [words]);
  const caretOp = useRef(new Animated.Value(0)).current;
  const caretXY = useRef(new Animated.ValueXY({ x: 0, y: (lh - caretH) / 2 })).current;
  const boxes = useRef<Array<{ x: number; y: number; w: number } | undefined>>([]);
  const shown = useRef(-1);
  const [laid, setLaid] = useState(false);

  const moveCaret = (i: number, jump = false) => {
    const b = boxes.current[i];
    if (!b) return;
    const to = { x: b.x + b.w + Math.round(size * 0.08), y: b.y + (lh - caretH) / 2 };
    if (jump) caretXY.setValue(to);
    else Animated.spring(caretXY, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 3 }).start();
  };

  useEffect(() => {
    if (reduced === null || !words.length || !laid) return;
    if (reduced) { ops.forEach((o) => o.setValue(1)); caretOp.setValue(0); return; }
    let start = STARTED.get(once);
    if (start === undefined) { start = Date.now(); STARTED.set(once, start); }
    const el = Date.now() - start, end = times[times.length - 1]! + 200;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    // The words already written show at once; the rest come at their times, the caret after each.
    words.forEach((_w, i) => {
      if (times[i]! <= el) { ops[i]!.setValue(1); shown.current = i; return; }
      timers.push(setTimeout(() => {
        shown.current = i;
        Animated.timing(ops[i]!, { toValue: 1, duration: 170, useNativeDriver: true }).start();
        moveCaret(i);
      }, times[i]! - el));
    });
    if (shown.current >= 0) moveCaret(shown.current, true);
    if (el >= end + CARET_STAYS_MS) { caretOp.setValue(0); return () => timers.forEach(clearTimeout); }
    // Keybot's caret: blinking while he writes and a moment after, then it fades.
    caretOp.setValue(1);
    const blink = Animated.loop(Animated.sequence([
      Animated.timing(caretOp, { toValue: 0, duration: 90, delay: 440, useNativeDriver: true }),
      Animated.timing(caretOp, { toValue: 1, duration: 90, delay: 330, useNativeDriver: true }),
    ]));
    blink.start();
    timers.push(setTimeout(() => { blink.stop(); Animated.timing(caretOp, { toValue: 0, duration: 420, useNativeDriver: true }).start(); }, end + CARET_STAYS_MS - el));
    return () => { timers.forEach(clearTimeout); blink.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, words, times, once, ops, laid]);

  return (
    <View accessible accessibilityRole="header" accessibilityLabel={content} style={{ alignSelf: "stretch" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: Math.round(size * 0.24) }} importantForAccessibility="no-hide-descendants">
        {words.map((w, i) => (
          <Animated.Text
            key={`${i}-${w}`}
            onLayout={(e) => {
              const { x, y, width } = e.nativeEvent.layout;
              boxes.current[i] = { x, y, w: width };
              if (!laid && boxes.current.filter(Boolean).length >= words.length) setLaid(true);
            }}
            style={[font, { opacity: ops[i], transform: [{ translateY: ops[i]!.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }]}
          >{w}</Animated.Text>
        ))}
      </View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute", left: 0, top: 0, width: Math.max(2, Math.round(size * 0.075)), height: caretH, borderRadius: 2,
          backgroundColor: String(props?.caretColor || "#A9573A"), opacity: caretOp, transform: caretXY.getTranslateTransform(),
        }}
      />
    </View>
  );
}

// ------------------------------------------------------------------ LiveMark

/** The marks, by life, for the life of the app. */
const MARKS = new Map<string, LiveMark>();

export function LiveMarkNode({ props, fire }: CompProps): React.ReactElement {
  const size = Number(props?.size) || 40;
  const life = String(props?.life || "home");
  const reduced = useReducedMotion();
  const mark = useMemo(() => {
    let m = MARKS.get(life);
    if (!m) { m = new LiveMark(seedOf(life)); MARKS.set(life, m); }
    return m;
  }, [life]);
  mark.size = size;
  const lit: string[] = Array.isArray(props?.lit) ? props.lit.map(String) : [];
  const litKey = lit.join(",");
  useEffect(() => { mark.setLit(lit); }, [mark, litKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const painter = useRef<Painter | null>(null);
  const host = useRef<View>(null);
  const paint = () => painter.current?.paint(mark);

  // The finger and the scroll, from the screen on show. Where the mark is: measured now and then, moved by the scroll.
  useEffect(() => {
    if (reduced !== false) return;
    const at = { x: 0, y: 0, scroll: pageNow().y };
    const measure = () => {
      const v = host.current as unknown as { measureInWindow?: (cb: (x: number, y: number) => void) => void } | null;
      const s = pageNow().y;
      v?.measureInWindow?.((x, y) => { at.x = x; at.y = y; at.scroll = s; });
    };
    measure();
    const iv = setInterval(measure, 800);
    let lastY = pageNow().y, lastT = Date.now();
    const off = onPage((e) => {
      const u = 34 / size, top = at.y - (e.y - at.scroll);
      if (e.touchX === e.touchX) mark.look((e.touchX - at.x) * u, (e.touchY - top) * u); else mark.lookAway();
      if (e.y !== lastY) {
        const t = Date.now();
        mark.nudge(((e.y - lastY) / Math.max(8, t - lastT)) * 1000);
        lastY = e.y; lastT = t;
      }
    });
    return () => { off(); clearInterval(iv); };
  }, [mark, size, reduced]);

  useEffect(() => {
    if (reduced === null) return;
    mark.settle(!!reduced);
    paint();
  }, [mark, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useTileLoop({ frame: (dt) => { mark.step(dt); paint(); }, still: paint }, reduced === false, host);

  const press = () => {
    if (reduced) { fire("onPress"); return; }
    mark.press();
    setTimeout(() => fire("onPress"), 170);
  };
  return (
    <Pressable ref={host} onPress={press} accessibilityRole="button" accessibilityLabel={props?.label || "Tailzu"} hitSlop={8} style={{ width: size, height: size }}>
      <TileSurface ref={(r) => { painter.current = r; if (r) r.paint(mark); }} w={size} h={size} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ HeadBar

export function HeadBar({ props, children }: CompProps): React.ReactElement {
  const at = Number(props?.at) || 160;
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const [on, setOn] = useState(pageNow().y > at);
  useEffect(() => onPage((e) => { const now = e.y > at; setOn((o) => (o === now ? o : now)); }), [at]);
  useEffect(() => {
    if (reduced) { v.setValue(on ? 1 : 0); return; }
    Animated.spring(v, { toValue: on ? 1 : 0, useNativeDriver: true, speed: 16, bounciness: 0 }).start();
  }, [on, reduced, v]);
  return (
    <View pointerEvents="box-none" style={{ height: 0, zIndex: 5, overflow: "visible" }}>
      <Animated.View
        pointerEvents={on ? "auto" : "none"}
        style={{
          position: "absolute", left: 0, right: 0, top: 0, backgroundColor: "#ffffff",
          borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e6e6e6",
          opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
