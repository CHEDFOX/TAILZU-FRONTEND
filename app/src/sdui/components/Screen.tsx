/**
 * Screen: the page — its scroll, its pull-a-bot, its keyboard handling — and the contexts the nodes inside read
 * (one screenful's height, a footer that stays above the keyboard).
 */
import React, { createContext, useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, LayoutAnimation, Platform, ScrollView, StyleSheet, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import { usePullBot, PullBotScroll } from "../bots/PullBot";
import type { CompProps } from "./props";
import { pageScrolled, pageTouched } from "./pageBus";

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
export const ScreenViewport = createContext<number>(0);

/**
 * A FOOTER THE KEYBOARD DOES NOT COVER (a Stack with `keyboard: "above"`).
 *
 * A Bots page's footer (Home's "Ask any bot…", the Code bot's "Tell Code bot what to do") sits under the scroll, outside it,
 * so neither iOS's own inset nor the Screen's room on Android reached it: the keyboard came up over the very field being typed
 * in, and over that field's own Paste menu. While one of ITS fields has the keyboard, the footer takes a bottom margin as tall
 * as the part of it the keyboard would cover, so it sits just above the keyboard and the scroll above gives up the room; what is
 * under it (the tab bar) stays under the keyboard. A field in the scrolling body is the Screen's, as before: the footer stays put.
 */
export const FooterField = createContext<((focused: boolean) => void) | null>(null);
/** A footer's field has the keyboard: the Screen leaves the keyboard to the footer (no room of its own on Android, no scroll). */
let footerFocused = false;

export function KeyboardAbove({ style, children }: { style: any; children: React.ReactNode }) {
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

export const Screen = ({ props, children, style, ctx }: CompProps) => {
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
  /**
   * STARTS AT ITS END (KitExtras `startAtEnd`: a space's feed, newest at the bottom). It opens scrolled to the end; while the
   * person is within 80 px of the end, content that grows (a new message) or a view that gets shorter (the composer opening
   * under it) keeps the end in view; scrolled further up, their place is kept.
   */
  const atEnd = props?.startAtEnd === true;
  const ends = useRef({ content: 0, view: 0, first: true });
  const nearEnd = () => scrolled.current + ends.current.view >= ends.current.content - K.num("ui.Screen.endSlop", 80);
  const toEnd = (animated: boolean) => requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated }));
  const onContentSize = (_w: number, h: number) => {
    const e = ends.current;
    const near = e.first || nearEnd();
    e.content = h;
    if (!atEnd || !near || h <= 0) return;
    toEnd(!e.first);
    e.first = false;
  };
  const scrollProps = {
    automaticallyAdjustKeyboardInsets: true,
    // For the nodes that follow the page (pageBus.ts): where it is scrolled, where a finger is.
    onTouchStart: (e: GestureResponderEvent) => pageTouched(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onTouchMove: (e: GestureResponderEvent) => pageTouched(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onTouchEnd: () => pageTouched(NaN, NaN),
    scrollEventThrottle: 16,
    onLayout: (e: LayoutChangeEvent) => {
      const h = Math.round(e.nativeEvent.layout.height);
      if (atEnd && h > 0 && h !== ends.current.view) {
        const near = nearEnd();
        ends.current.view = h;
        if (near && !ends.current.first) toEnd(false);
      }
      if (h > 0 && h !== vh) setVh(h);
    },
    onContentSizeChange: onContentSize,
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
