/**
 * Reels — one child per screenful, snapped vertically.
 *
 * The haptics editor is four keyboards and no room to show two at once, so it
 * is not a list: each keyboard gets the whole window and you move between them
 * the way you move between reels. Paging rather than scrolling matters here —
 * a keyboard caught half off the bottom is a keyboard whose bottom row cannot
 * be tapped, and free scrolling makes that the normal resting state.
 *
 * WHAT SITS ON TOP DOES NOT MOVE. Anything the backend places over this — the
 * every-key switch, a back arrow — is a sibling of the Reels node, not a child
 * of it. A control that scrolls away with the reel it happens to sit on reads
 * as belonging to that reel, and the every-key switch belongs to all of them.
 *
 *   { "type": "Reels", "on": { "onSelect": "noteReel" },
 *     "children": [ …one node per reel… ] }
 *
 * onSelect fires with the reel number as `$event`.
 */
import React, { useCallback, useRef, useState } from "react";
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import * as Haptics from "expo-haptics";
import type { CompProps } from "./components";

export const Reels = ({ props, style, children, fire }: CompProps): React.ReactElement => {
  const reels = React.Children.toArray(children);
  // Measured, not assumed: this sits under a header whose height the backend
  // decides, so the page size is whatever is actually left.
  const [height, setHeight] = useState(0);
  const index = useRef(0);
  /** A tick as each reel arrives. The pages look alike, so the change wants
   *  confirming by touch as well as by sight. */
  const haptic = props?.haptic !== false;
  /**
   * PAGING, as a choice rather than a fact of the component.
   *
   * Paging is right for the haptics editor — a keyboard resting half off the
   * bottom has a bottom row nobody can tap — and wrong for a reel of text,
   * where snapping fights the reader. It was neither: it was compiled in.
   */
  const paging = props?.paging !== false;
  const decel = props?.decelerationRate === "normal" ? "normal" : "fast";
  /** Where each reel sits in its page. "center" unless a screen says otherwise. */
  const align = String(props?.align ?? "center");
  const showsIndicator = props?.showsIndicator === true;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHeight((cur) => (Math.abs(cur - h) < 1 ? cur : h));
  }, []);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height) return;
    const i = Math.round(e.nativeEvent.contentOffset.y / height);
    if (i === index.current) return;
    index.current = i;
    if (haptic) Haptics.selectionAsync().catch(() => {});
    fire("onSelect", i);
  }, [height, haptic, fire]);

  return (
    <View style={[{ flex: 1 }, style]} onLayout={onLayout}>
      <ScrollView
        pagingEnabled={paging}
        showsVerticalScrollIndicator={showsIndicator}
        // decelerationRate "fast" alone still lets a page drift; pagingEnabled
        // is what guarantees a reel comes to rest filling the window.
        decelerationRate={decel}
        onMomentumScrollEnd={onMomentumEnd}
        // Nothing renders until the height is known — a reel laid out at zero
        // and then re-laid out is a visible jump on the first frame.
        scrollEnabled={height > 0}
      >
        {height > 0
          ? reels.map((reel, i) => (
              <View key={i} style={{ height, justifyContent: align as "center" | "flex-start" | "flex-end" }}>
                {reel}
              </View>
            ))
          : null}
      </ScrollView>
    </View>
  );
};
