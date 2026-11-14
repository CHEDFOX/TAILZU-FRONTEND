/**
 * List: any number of rows, drawn one template at a time, paged from the server (pure/SPEC.md 2.6, B6).
 *
 * This is the node that ends the payload ceiling. Today a long feed is a screen with every row baked into it; here
 * the screen sends one row template and a path, and the rows arrive a page at a time as the person reaches the end.
 *
 * WHEN IT VIRTUALISES, AND WHY NOT ALWAYS. A FlatList inside a ScrollView is a nested VirtualizedList: React Native
 * turns windowing off and mounts every row, which is worse than not having a List at all. So this node scrolls by
 * itself only when it is the screen's scroller (the Screen handed it its slot, v3Host.ScreenScrollerContext) or when
 * the server says it is a bounded box of its own — `scroll: true` AND a real height in its style, because a FlatList
 * with no viewport of its own grows to its content and windows nothing either. Anywhere else it draws a capped
 * block of rows and lets whatever is around it scroll. The server lint refuses a List inside a same-axis scroller,
 * so that case is a mistake being drawn safely, not a shape anyone should ship.
 *
 * Rows come in already resolved (V1 evaluates `$` and `$t` before props reach here). Drawing the row template, going
 * to the network and writing to the store are all the host's (v3Host.ts): this file decides what and when, never how.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import * as K from "../knobs";
import { useTheme } from "../theme/ThemeContext";
import type { CompProps } from "./props";
import {
  LIST_LIMITS, apiPath, asking, boundedHeight, canAsk, firstPage, keyOf, pageFailed, pageOk, refreshed, rowKeys,
  rowSize, rowsOf, itemLayout, windowPlan, type PageMode, type PageState,
} from "./listCore";
import { useScreenScroller, useV3Host, type ItemScope } from "./v3Host";

/** What the server's `page` block says. Anything missing simply means "no paging". */
interface PageSpec {
  endpoint?: unknown;
  cursor?: unknown;
  into?: unknown;
  mode?: unknown;
}

const MODES: PageMode[] = ["append", "prepend", "replace"];

export const List = ({ node, props, style, children, fire }: CompProps) => {
  const theme = useTheme();
  const host = useV3Host();
  const slot = useScreenScroller();
  // The held cap is the device's own floor (pure/SPEC.md 5.1): a seeded array longer than that is cut here, not
  // handed to a FlatList. Memoised because every identity below hangs off it.
  const rows = useMemo(() => rowsOf(props.data).slice(0, LIST_LIMITS.heldMax), [props.data]);
  const keyProp = typeof props.key === "string" ? props.key : typeof props.keyProp === "string" ? props.keyProp : "";
  const size = rowSize(props.estimatedSize);
  const horizontal = props.horizontal === true;
  const page: PageSpec = props.page && typeof props.page === "object" ? (props.page as PageSpec) : {};
  const mode: PageMode = MODES.includes(props.pageMode as PageMode) ? (props.pageMode as PageMode)
    : MODES.includes(page.mode as PageMode) ? (page.mode as PageMode) : "append";
  const intoPath = typeof page.into === "string" ? page.into : "";
  const cursorPath = typeof page.cursor === "string" ? page.cursor : "";
  const endpoint = apiPath(page.endpoint);
  const template = props.item ?? node.props?.item;
  // This list pages when there is a host, somewhere to put the rows, and a path of ours to ask: the node's own
  // endpoint, or a cursor the screen kept from last time.
  const saved = host && cursorPath ? apiPath(host.read(cursorPath)) : null;
  const pages = Boolean(host && intoPath && (endpoint || saved));

  // Paging lives in a ref, not in state: a re-render must never be able to ask for the same page twice, and the
  // rows themselves are the store's (the host writes them at `page.into`, and they come back as `data`).
  const paging = useRef<PageState>(firstPage(page.endpoint, rows.length));
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  const scroller = useRef<FlatList<unknown>>(null);
  const ends = useRef({ y: 0, view: 0, content: 0, first: true });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // A screen left while a page is in the air: the fetch goes with it.
      inFlight.current?.abort();
    };
  }, []);
  // A cursor the screen kept from last time wins over the first page: coming back to a feed does not start it again.
  useEffect(() => {
    if (!host || !cursorPath) return;
    const kept = apiPath(host.read(cursorPath));
    if (kept) paging.current = { ...paging.current, next: kept, done: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (fresh: boolean) => {
    if (!host || !intoPath) return;
    if (fresh) paging.current = refreshed(endpoint);
    const state = paging.current;
    if (!canAsk(state) || !state.next) return;
    paging.current = asking(state);
    if (fresh) setRefreshing(true); else setBusy(true);
    const stop = new AbortController();
    inFlight.current?.abort();
    inFlight.current = stop;
    // THE FETCH THIS NODE IS STILL WAITING FOR. A pull to refresh over a page in flight aborts that page; the
    // aborted one must then touch nothing — not the paging state, not the spinner, not `onError` — because the
    // refresh owns all three now. Without this, a refresh mid-page reports a failure that did not happen, unlocks
    // paging while the refresh is still running, and lets a late body overwrite the refreshed rows.
    const mine = () => alive.current && inFlight.current === stop;
    try {
      const body = await host.fetchPage(state.next, stop.signal);
      if (!mine()) return;
      const held = fresh ? [] : rowsOf(host.read(intoPath) ?? props.data);
      const next = pageOk(held, body, fresh ? "replace" : mode, keyProp);
      paging.current = next.state;
      host.setState(intoPath, next.items);
      if (cursorPath) host.setState(cursorPath, next.state.next);
      // `onResult` is the page that arrived and `onError` the one that did not: the two event names this build has
      // (types.ts NodeEvent). A name of their own is a line for V0 — see the questions in this package.
      fire("onResult", { count: next.items.length, more: !next.state.done });
    } catch {
      if (!mine() || stop.signal.aborted) return;
      paging.current = pageFailed(paging.current);
      // A page that did not arrive is the screen's to explain; the rows already held stay on screen.
      fire("onError");
    } finally {
      if (mine()) {
        inFlight.current = null;
        setBusy(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, intoPath, cursorPath, endpoint, mode, keyProp, props.data]);

  /**
   * THE SAME NODE, A DIFFERENT FEED.
   *
   * A live update or a filter can swap `page.endpoint` or `page.into` while the node stays where it is in the tree.
   * The paging ref was set up once, so without this the list keeps following the old feed's `next` and writes those
   * rows into the new path. The first run is skipped: that is the ref's own first value, and the cursor the screen
   * kept has just been read into it.
   */
  const feed = `${endpoint ?? ""}|${intoPath}`;
  const onFeed = useRef(feed);
  useEffect(() => {
    if (onFeed.current === feed) return;
    onFeed.current = feed;
    inFlight.current?.abort();
    inFlight.current = null;
    paging.current = firstPage(endpoint, 0);
    setBusy(false);
    setRefreshing(false);
  }, [feed, endpoint]);

  /**
   * THE FIRST PAGE.
   *
   * A feed starts empty: `state.feed` is nothing until a page arrives. Nothing on screen means nothing to reach the
   * end of and nothing to pull, so without this the list would wait for a scroll that can never happen. Once per
   * feed, and only while there is nothing held.
   */
  const asked = useRef("");
  useEffect(() => {
    if (!pages || rows.length > 0 || asked.current === feed) return;
    asked.current = feed;
    void load(false);
  }, [pages, rows.length, feed, load]);

  const onEnd = useCallback(() => {
    if (pages && props.onEndReached !== "none") void load(false);
  }, [pages, props.onEndReached, load]);

  const onRefresh = useCallback(() => { void load(true); }, [load]);

  const drawRow = useCallback((item: unknown, index: number, key: string) => {
    const scope: ItemScope = { item, index };
    return host?.renderItem(template, scope, key) ?? null;
  }, [host, template]);

  // One key per row, each one unique: a server that repeats a row must not hand React two cells with one key.
  const keys = useMemo(() => rowKeys(rows, keyProp), [rows, keyProp]);
  const keyExtractor = useCallback((_item: unknown, index: number) => keys[index] ?? keyOf(_item, keyProp, index), [keys, keyProp]);
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<unknown>) => <>{drawRow(item, index, keys[index] ?? `#${index}`)}</>,
    [drawRow, keys],
  );

  const sticky = useMemo(() => {
    if (!host?.itemBool || props.sticky === undefined) return undefined;
    const out: number[] = [];
    rows.forEach((item, index) => { if (host.itemBool!(props.sticky, { item, index })) out.push(index); });
    return out.length ? out : undefined;
  }, [host, props.sticky, rows]);

  // How near the end counts as the end. FlatList takes this with `??`, so a NaN would get through and the list
  // would never page at all; a huge one would fetch every page at once. Clamped both ways.
  const endThreshold = useMemo(() => {
    const t = Number(props.endThreshold);
    return Number.isFinite(t) ? Math.min(2, Math.max(0.05, t)) : K.num("ui.List.endThreshold", 0.4);
  }, [props.endThreshold]);

  const flat = useMemo(() => StyleSheet.flatten(style) as ViewStyle | undefined, [style]);
  const boxHeight = boundedHeight(flat);
  const ownScroller = props.scroll === true && boxHeight > 0;
  const plan = useMemo(() => windowPlan(size, slot ? 0 : boxHeight), [size, slot, boxHeight]);
  const atEnd = slot?.startAtEnd === true;

  const onContentSize = useCallback((_w: number, h: number) => {
    const e = ends.current;
    const near = e.first || e.y + e.view >= e.content - K.num("ui.List.endSlop", 80);
    e.content = h;
    if (!atEnd || !near || h <= 0) return;
    const animated = !e.first;
    e.first = false;
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated }));
  }, [atEnd]);
  const onLayout = useCallback((e: LayoutChangeEvent) => { ends.current.view = e.nativeEvent.layout.height; }, []);
  const onScrollY = slot?.onScrollY;
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    ends.current.y = e.nativeEvent.contentOffset.y;
    ends.current.content = e.nativeEvent.contentSize.height;
    onScrollY?.(e.nativeEvent.contentOffset.y);
  }, [onScrollY]);

  const spinner = useMemo(() => (busy && !refreshing ? (
    <View style={{ paddingVertical: K.num("ui.List.spinnerPad", 18), alignItems: "center" }}>
      <ActivityIndicator color={theme.color.muted ?? theme.color.text} />
    </View>
  ) : null), [busy, refreshing, theme]);

  const headerEl = useMemo(() => (slot?.header ? <>{slot.header}</> : undefined), [slot?.header]);
  const footerEl = useMemo(
    () => (slot?.footer || spinner ? <>{spinner}{slot?.footer}</> : undefined),
    [slot?.footer, spinner],
  );
  const emptyEl = useMemo(() => (children ? <>{children}</> : undefined), [children]);
  // VirtualizedList adds one to every sticky index when there is a ListHeaderComponent, and makes the header itself
  // sticky when the indices hold 0 (VirtualizedList.js: `stickyOffset`). These are plain row indices, so they are
  // shifted to match.
  const stickyIndices = useMemo(
    () => (horizontal ? undefined : headerEl ? sticky?.map((i) => i + 1) : sticky),
    [horizontal, headerEl, sticky],
  );
  const listStyle = useMemo(
    () => [slot ? { flex: 1, backgroundColor: slot.backgroundColor } : null, style] as StyleProp<ViewStyle>,
    [slot, style],
  );

  /**
   * NOTHING TO DRAW ROWS WITH.
   *
   * No host (the renderer has not turned this block on) or no row template: whatever the server put inside the node
   * is what there is, which is where the empty state goes. An empty feed that pages is NOT this case — it keeps its
   * scroller below, so it can show its spinner and be pulled. When the Screen has already handed its scroll over,
   * its header and footer are drawn here too, otherwise a screen whose feed is empty would be a blank page with its
   * own title missing.
   */
  const bare = !host || template == null || (!rows.length && !busy && !pages);
  if (bare) {
    return (
      <View style={[slot ? { flex: 1, backgroundColor: slot.backgroundColor } : null, style]}>
        {slot?.header}
        {children}
        {slot?.footer}
      </View>
    );
  }

  // THE PLAIN BLOCK. Not the screen's scroller and not its own bounded box: no FlatList, no windowing, a hard cap on
  // rows. It still pages (the first page above), it simply cannot ask for more by itself.
  if (!slot && !ownScroller) {
    return (
      <View style={style}>
        {rows.length
          ? rows.slice(0, LIST_LIMITS.flatMax).map((item, index) => (
            <React.Fragment key={keys[index] ?? `#${index}`}>{drawRow(item, index, keys[index] ?? `#${index}`)}</React.Fragment>
          ))
          : children}
        {spinner}
      </View>
    );
  }

  const refresh = (props.refresh === true || slot?.refreshControl) && pages ? (
    slot?.refreshControl ?? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.muted} />
  ) : undefined;

  return (
    <FlatList
      data={rows}
      extraData={template}
      horizontal={horizontal}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      getItemLayout={props.uniform === true ? (_d, index) => itemLayout(size, index) : undefined}
      initialNumToRender={plan.initialNumToRender}
      maxToRenderPerBatch={plan.maxToRenderPerBatch}
      windowSize={plan.windowSize}
      updateCellsBatchingPeriod={plan.updateCellsBatchingPeriod}
      removeClippedSubviews={props.clip !== false}
      onEndReached={onEnd}
      onEndReachedThreshold={endThreshold}
      refreshControl={refresh}
      ListHeaderComponent={headerEl}
      ListFooterComponent={footerEl}
      // An empty feed keeps its scroller, so it can still be pulled and still shows its spinner.
      ListEmptyComponent={emptyEl}
      stickyHeaderIndices={stickyIndices}
      // A feed whose newest row is at the bottom (the Screen's `startAtEnd`): it opens at its end, and stays there
      // while rows arrive if the person has not scrolled away. Their place is kept when they have.
      ref={scroller}
      onContentSizeChange={onContentSize}
      onLayout={onLayout}
      onScroll={onScroll}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
      style={listStyle}
      contentContainerStyle={slot?.contentStyle as StyleProp<ViewStyle>}
    />
  );
};
