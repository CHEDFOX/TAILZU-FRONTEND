/**
 * LISTS, WITHOUT THE APP KNOWING WHAT IS IN THEM (pure/SPEC.md 2.6, B6).
 *
 * Everything here is arithmetic and bookkeeping: how many rows a window holds, which path the next page is allowed to
 * come from, what a page of rows does to the rows already held, and which child of a Screen becomes the screen's own
 * scroller. No React and no react-native, so it runs under `node --test` and reads the same on the desktop.
 *
 * The caps are pure/SPEC.md 5.1's, written here as constants until K1's kernel exports them (this block may not import
 * the kernel yet). They are the device's own floor: the server lints the same numbers, and a server that forgets is
 * still clamped here.
 */

/** pure/SPEC.md 5.1, the list row. */
export const LIST_LIMITS = {
  /** Rows one page may bring. More than this is cut. */
  pageMax: 100,
  /** Rows a list holds at once. Full means the list stops asking for more. */
  heldMax: 2000,
  /** Copies `Each` will make. A hard cap: `Each` is for small arrays, `List` is for long ones. */
  eachMax: 200,
  /** Rows a list draws when it is NOT the scroller (no virtualisation, so nothing off-screen is free). */
  flatMax: 100,
  /** Characters of an endpoint path. */
  pathMax: 1024,
  /** Failed page fetches in a row before the list stops asking by itself. */
  failMax: 3,
} as const;

/** How tall one row is taken to be before anything is measured. */
export const ROW_SIZE = { min: 8, max: 2000, fallback: 64 } as const;

/** A row size the server sent, clamped; anything unusable becomes the fallback. */
export function rowSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return ROW_SIZE.fallback;
  return Math.min(ROW_SIZE.max, Math.max(ROW_SIZE.min, Math.round(n)));
}

/** What a FlatList is told about its window, worked out from the row size and the height it has. */
export interface WindowPlan {
  initialNumToRender: number;
  maxToRenderPerBatch: number;
  /** In screenfuls, the way FlatList counts it. */
  windowSize: number;
  updateCellsBatchingPeriod: number;
}

/**
 * The window for rows `size` tall in a viewport `height` tall.
 *
 * One screenful plus a row, so the first paint is never short; batches of about half a screenful; and five screenfuls
 * kept mounted (two above, the visible one, two below), which is RN's own default shape, held between 3 and 11 so a
 * tiny row in a tall view does not mount a thousand cells.
 */
export function windowPlan(size: number, height: number): WindowPlan {
  const rows = height > 0 && size > 0 ? Math.ceil(height / size) : 10;
  const perScreen = Math.min(60, Math.max(1, rows));
  const keep = Math.min(2000, perScreen * 5);
  return {
    initialNumToRender: perScreen + 1,
    maxToRenderPerBatch: Math.max(1, Math.ceil(perScreen / 2)),
    windowSize: Math.min(11, Math.max(3, Math.round(keep / perScreen))),
    updateCellsBatchingPeriod: 50,
  };
}

/** Where row `index` sits when every row is `size` tall (FlatList's getItemLayout, for a list that says `uniform`). */
export function itemLayout(size: number, index: number): { length: number; offset: number; index: number } {
  return { length: size, offset: size * index, index };
}

/**
 * A PATH THE LIST MAY FETCH (pure/SPEC.md 2.2 and the network row of 5.1).
 *
 * A list's first page and every `next` after it come from the server as text, so each is checked here before it is
 * used: our own API, under `/v1/`, no scheme, no `..`, no `//`, no control characters, no whitespace — decoded
 * as well as written, because `%2e%2e` is `..` to everything downstream of us. Anything else
 * is null, and the caller stops. This is the one gate — the `next` of page 7 is as untrusted as the first.
 */
export function apiPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  if (!p || p.length > LIST_LIMITS.pathMax) return null;
  if (!p.startsWith("/v1/")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(p)) return null;
  if (!walksUp(p)) return null;
  // A scheme only means a second origin where the request is addressed, which is the part before `?` or `#`. The
  // same test over the query refused real cursors — "?before=2026-11-13T10:00:00Z" is a time, not a scheme — and
  // paging stopped with nothing said. An absolute URL in a query value is still refused: it needs `//`, above.
  const cut = p.search(/[?#]/);
  const path = cut < 0 ? p : p.slice(0, cut);
  if (/[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  // Percent-encoding is the same path once something decodes it — `new URL()` here and OkHttp on Android both read
  // `%2e%2e` as `..` — so the same checks run again on the decoded text. A broken escape is refused outright.
  let decoded: string;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (!walksUp(decoded) || !decoded.startsWith("/v1/")) return null;
  return p;
}

/** False when a path could leave `/v1/`: a parent step, an authority, or a Windows separator. */
function walksUp(path: string): boolean {
  return !(path.includes("..") || path.includes("//") || path.includes("\\"));
}

/**
 * A HEIGHT A LIST CAN WINDOW INSIDE.
 *
 * A FlatList only windows when it has a viewport of its own. `scroll: true` with no height is a FlatList that grows
 * to its content, which mounts every row — worse than the plain block. So a List outside the Screen's slot takes the
 * scroller path only when its own style gives it a real number of points.
 */
export function boundedHeight(style: { height?: unknown; maxHeight?: unknown } | null | undefined): number {
  if (!style) return 0;
  for (const raw of [style.height, style.maxHeight]) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  }
  return 0;
}

/** Where a list is in its paging. Held outside React so a re-render never asks for the same page twice. */
export interface PageState {
  /** The path of the page to ask for next, or null when there is nothing to ask for. */
  next: string | null;
  loading: boolean;
  /** Nothing more to fetch: the server sent no `next`, or the list is full. */
  done: boolean;
  /** Rows held now. */
  held: number;
  /** Failures in a row. At `failMax` the list stops asking by itself; a pull to refresh starts again. */
  fails: number;
}

/** A fresh paging state for `endpoint` (the first page). A path that is not ours leaves the list with nothing to ask. */
export function firstPage(endpoint: unknown, held = 0): PageState {
  const next = apiPath(endpoint);
  return { next, loading: false, done: next === null, held, fails: 0 };
}

/** True when the list may ask for a page now. */
export function canAsk(s: PageState): boolean {
  return !s.loading && !s.done && s.next !== null && s.fails < LIST_LIMITS.failMax && s.held < LIST_LIMITS.heldMax;
}

/** The state while the page is in the air. */
export function asking(s: PageState): PageState {
  return { ...s, loading: true };
}

/**
 * The rows and the next path inside a response body.
 *
 * `{ items: [...], next: "/v1/…" }` is the shape; `rows` and `data` are read too, because three server routes already
 * answer that way. Anything else gives no rows, which the list shows as "nothing more", never as an error.
 */
export function pageBody(body: unknown): { items: unknown[]; next: string | null } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = [b.items, b.rows, b.data].find((v) => Array.isArray(v));
  const items = Array.isArray(raw) ? raw.slice(0, LIST_LIMITS.pageMax) : [];
  return { items, next: apiPath(b.next) };
}

/** A row's key: the `key` prop read off the row, else its place in the list. Always a string. */
export function keyOf(item: unknown, keyProp: string, index: number): string {
  if (keyProp && item && typeof item === "object") {
    const v = (item as Record<string, unknown>)[keyProp];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return `#${index}`;
}

export type PageMode = "append" | "prepend" | "replace";

/**
 * The rows held after a page arrives.
 *
 * Rows that are already held (same key) are not added twice — two pages that overlap by one row is ordinary, and a
 * duplicate key in a FlatList is a row that will not redraw. The list stops at `heldMax`: the extra rows are dropped
 * rather than the oldest, because dropping the oldest moves everything under the finger.
 */
export function merged(held: readonly unknown[], incoming: readonly unknown[], mode: PageMode, keyProp: string): unknown[] {
  // A refresh replaces everything, so it starts from no rows — but it still de-duplicates, because a page may hold
  // the same row twice and a duplicate key in a FlatList is a row that stops redrawing.
  const base = mode === "replace" ? [] : held;
  const seen = new Set<string>();
  if (keyProp) base.forEach((it, i) => seen.add(keyOf(it, keyProp, i)));
  const fresh = keyProp
    ? incoming.filter((it, i) => {
        const k = keyOf(it, keyProp, base.length + i);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
    : incoming.slice();
  const room = Math.max(0, LIST_LIMITS.heldMax - base.length);
  const take = fresh.slice(0, room);
  if (mode === "replace") return take;
  return mode === "prepend" ? [...take, ...base] : [...base, ...take];
}

/**
 * A KEY PER ROW, EACH ONE UNIQUE.
 *
 * `keyOf` reads the row's own id, and two rows can carry the same one — a server that repeats a row, an `Each` over
 * an array of equal strings, a page that overlaps. React treats a repeated key as the same row, so the second one
 * stops redrawing. Here a repeat keeps its place instead: no row is dropped, and no two keys match.
 */
export function rowKeys(items: readonly unknown[], keyProp: string): string[] {
  const seen = new Set<string>();
  return items.map((item, index) => {
    let k = keyOf(item, keyProp, index);
    while (seen.has(k)) k = `${k}~${index}`;
    seen.add(k);
    return k;
  });
}

/** The state and the rows after a page that arrived. */
export function pageOk(
  held: readonly unknown[],
  body: unknown,
  mode: PageMode,
  keyProp: string,
): { state: PageState; items: unknown[] } {
  const { items, next } = pageBody(body);
  const rows = merged(held, items, mode, keyProp);
  const full = rows.length >= LIST_LIMITS.heldMax;
  return {
    state: { next, loading: false, done: next === null || full, held: rows.length, fails: 0 },
    items: rows,
  };
}

/** The state after a page that did not arrive. The path is kept, so a pull to refresh can try it again. */
export function pageFailed(s: PageState): PageState {
  return { ...s, loading: false, fails: s.fails + 1 };
}

/** A pull to refresh: back to the first page, forgetting failures. */
export function refreshed(endpoint: unknown): PageState {
  return firstPage(endpoint, 0);
}

/**
 * A LIST IN A SCREEN BECOMES THE SCREEN'S SCROLLER (pure/SPEC.md 2.6).
 *
 * `Screen` wraps its children in a ScrollView, and a FlatList inside one is a nested VirtualizedList: React Native
 * turns windowing off, so a two-thousand-row feed mounts two thousand rows. So when a Screen's body holds a List, the
 * Screen stops scrolling: the nodes above the List become its header, the nodes below become its footer, and the List
 * is the scroller.
 *
 * This is the pure half of that hand-off — which child, and what is above and below it. The Screen does the rendering
 * (its own file, PLAYER-UI's pen).
 */
export interface ScreenListPlan {
  /** Where the List sits among the Screen's children. */
  index: number;
  /** The children before it, in order. */
  header: number[];
  /** The children after it, in order. */
  footer: number[];
}

/** The first top-level List among a Screen's children, with what sits above and below it. Null when there is none. */
export function screenListPlan(children: readonly { type?: unknown }[] | undefined | null): ScreenListPlan | null {
  if (!Array.isArray(children)) return null;
  const index = children.findIndex((c) => c?.type === "List");
  if (index < 0) return null;
  return {
    index,
    header: children.map((_, i) => i).filter((i) => i < index),
    footer: children.map((_, i) => i).filter((i) => i > index),
  };
}

/** How many copies `Each` makes: the array's length, the node's own `max`, and the hard cap, whichever is smallest. */
export function eachCount(length: number, max: unknown): number {
  const n = typeof max === "number" ? max : typeof max === "string" ? Number(max) : NaN;
  // A number is a cap, never below zero; anything that is not a number is no cap of its own.
  const asked = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : LIST_LIMITS.eachMax;
  return Math.max(0, Math.min(length, asked, LIST_LIMITS.eachMax));
}

/** The array a `data` prop stands for. Anything that is not an array is no rows, never a crash. */
export function rowsOf(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}
