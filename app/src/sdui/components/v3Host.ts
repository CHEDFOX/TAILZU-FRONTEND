/**
 * THE SEAM BETWEEN THESE NODES AND THE RENDERER (pure/SPEC.md 2.0; the parallel-build seam rule).
 *
 * Lists, inputs and media are the three blocks that cannot be drawn from their props alone: a list draws one template
 * once per row, an input writes what a person typed, a player fetches a page. All three of those belong to the
 * renderer (V1) — the expression evaluator, the screen store, the API client — and none of them belong here.
 *
 * So this file declares what these nodes need and nothing more. V1 builds one object with these methods and puts it
 * in the context below; until it does, the value is null and every node here degrades to what it can draw without it
 * (a list of already-resolved rows, an input that reports its value as an event, a player with no state writes).
 * Nothing here reaches into the store, the client or the kernel by itself.
 */
import { createContext, useContext } from "react";
import type React from "react";

/** What a row or a template is drawn with: the row itself, where it sits, and a template's own arguments. */
export interface ItemScope {
  item: unknown;
  index: number;
  args?: Record<string, unknown>;
}

/** Lists (B6): drawing one template per row, and fetching pages. */
export interface ListHost {
  /**
   * Draw a node template once, with `item`, `index` and `args` in scope for its expressions.
   * `template` is the server's node (`List.item`, `Each.item`); V1 knows how to resolve and render it.
   */
  renderItem(template: unknown, scope: ItemScope, key: string): React.ReactNode;
  /**
   * GET one page. The path is already checked by listCore.apiPath: ours, under `/v1/`. The host adds the origin,
   * the auth and the timeouts, and may reject.
   */
  fetchPage(path: string, signal: AbortSignal): Promise<unknown>;
  /** Read a dot-path out of the screen's store (the paging cursor). */
  read(path: string): unknown;
  /** Write a dot-path into the screen's store. The host checks the path (state.ts:setPath rules). */
  setState(path: string, value: unknown): void;
  /**
   * Is this item expression true for this row (`List.sticky`)? Optional: without it a list has no sticky rows,
   * which is a look, not a behaviour.
   */
  itemBool?(expr: unknown, scope: ItemScope): boolean;
}

/** Inputs (B8): the one way a typed, dragged or picked value reaches the screen. */
export interface InputHost {
  /**
   * Write a value at a state path. The value is already sanitized and capped by inputCore; the host checks the path.
   * It is stored as it is — never filled, never evaluated (pure/SPEC.md 2.2, principle 4).
   */
  setState(path: string, value: unknown): void;
  read(path: string): unknown;
}

/** Media (B10): where a player writes what it is doing. */
export interface MediaHost {
  setState(path: string, value: unknown): void;
  read(path: string): unknown;
}

/** One object with all three, which is what V1 passes. */
export interface V3Host extends ListHost, InputHost, MediaHost {}

/** V1 puts the real host here. Null means these nodes draw what they can and write nothing. */
export const V3HostContext = createContext<V3Host | null>(null);

/** The host, or null. */
export function useV3Host(): V3Host | null {
  return useContext(V3HostContext);
}

/**
 * A SCREEN THAT HANDS ITS SCROLL TO A LIST (pure/SPEC.md 2.6).
 *
 * A Screen whose body holds a List stops scrolling and gives the List its header, its footer and its pull. The Screen
 * fills this in and renders the List inside it; the List takes it and becomes the screen's scroller. Nothing here is
 * set by anyone else, and a List that finds nothing draws as a plain block of rows instead (no nested scrollers,
 * which is the whole point).
 *
 * The Screen's own file is PLAYER-UI's pen, so this side only declares the shape.
 */
export interface ScreenScrollerSlot {
  /** The nodes above the List, already drawn. */
  header?: React.ReactNode;
  /** The nodes below it. */
  footer?: React.ReactNode;
  /** The Screen's content padding, so the rows sit where the Screen's children would have. */
  contentStyle?: unknown;
  /** The Screen's background, so the list is not a black hole over a backdrop. */
  backgroundColor?: string;
  /** The Screen's pull-a-bot control, when it has one. The list puts it on its own scroller. */
  refreshControl?: React.ReactElement;
  /** The Screen's `startAtEnd` (a feed, newest at the bottom). */
  startAtEnd?: boolean;
  /** Where the scroll is, for the nodes that follow the page (pageBus) and for `scrollInto`. */
  onScrollY?: (y: number) => void;
}

export const ScreenScrollerContext = createContext<ScreenScrollerSlot | null>(null);

/** The slot this list was given, or null when it is not a screen's scroller. */
export function useScreenScroller(): ScreenScrollerSlot | null {
  return useContext(ScreenScrollerContext);
}
