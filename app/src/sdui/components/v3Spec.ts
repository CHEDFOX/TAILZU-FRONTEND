/**
 * THE CONTRACT FOR LISTS, INPUTS AND MEDIA (pure/SPEC.md 2.6, 2.8, 2.10 — blocks `list`, `input`, `media`).
 *
 * One object, so the server's lint (S1) and the renderer (V1) read the same thing this folder implements: every node
 * type these blocks add, every prop it takes, every event it fires, every state path it writes, and the caps. It is
 * data, not code: no imports beyond the numbers the implementation already enforces, so the server can mirror it.
 *
 * A prop that is not listed here is ignored by the node (pure/SPEC.md principle 5). A value out of range is clamped,
 * never a throw.
 *
 * ON THE EVENT NAMES. `NodeEvent` in types.ts is a closed list, and this package does not hold that file, so these
 * nodes fire the nearest names it already has: `onResult` for what arrived, `onComplete` for what finished,
 * `onChange` for what changed, `onError` for what did not, `onSubmit` for a value sent on purpose, `onDismiss` for
 * one taken back. The names these nodes would rather have (onPage, onScan, onCapture, onCommit, onPermission, onPlay,
 * onPause, onEnd, onReady) are a line for V0, which holds types.ts; the server can keep using these until then.
 */
import { LIST_LIMITS, ROW_SIZE } from "./listCore";
import { INPUT_KINDS, INPUT_KINDS_WAVE1, INPUT_KINDS_WAVE2, INPUT_LIMITS } from "./input/inputCore";
import { BARCODE_TYPES, MEDIA_LIMITS } from "./mediaCore";

export interface NodeSpec {
  /** The handshake block this node belongs to; the server sends it only to a client that declared the block. */
  block: "list" | "input" | "media";
  what: string;
  props: Record<string, string>;
  /** `bind.<key>`: a state path whose value arrives as that prop. */
  binds?: Record<string, string>;
  events?: Record<string, string>;
  /** State paths this node writes, and what it writes there. */
  writes?: Record<string, string>;
  limits?: Record<string, number | string>;
}

export const SPEC: Record<string, NodeSpec> = {
  List: {
    block: "list",
    what: "Rows from an array, one template each, windowed, paged from a /v1/ path. A List in a Screen becomes the screen's scroller.",
    props: {
      data: "array — the rows, already resolved (`{ \"$\": \"state.feed\" }`)",
      item: "node — the row template, drawn once per row with `item` and `index` in scope",
      key: "string — the row's own id field; without it a row's place is its key",
      estimatedSize: `number — how tall one row is taken to be (${ROW_SIZE.min}..${ROW_SIZE.max}, default ${ROW_SIZE.fallback})`,
      uniform: "boolean — every row is exactly estimatedSize tall, so the list can jump straight to any row",
      horizontal: "boolean — rows run across instead of down",
      scroll: "boolean — this List is its own bounded scroller. It needs a numeric `height` or `maxHeight` in its style as well: without one a FlatList grows to its content and windows nothing. Without both, and without the Screen's slot, it draws a capped block of rows",
      page: "{ endpoint: '/v1/…', cursor?: state path, into: state path, mode?: append | prepend | replace }",
      pageMode: "append | prepend | replace — overrides page.mode",
      onEndReached: "'page' (default) or 'none' — whether reaching the end asks for the next page",
      endThreshold: "number — how near the end counts as the end (screenfuls, 0.05..2, default 0.4)",
      refresh: "boolean — pull to refresh, which asks for the first page again",
      sticky: "expression — true for a row that sticks to the top while its section scrolls",
      clip: "boolean — keep off-screen rows out of the view tree (default true)",
    },
    events: {
      onResult: "a page arrived: { count, more }",
      onError: "a page did not arrive; the rows already held stay",
    },
    writes: {
      "page.into": "the rows held now, after merging and de-duplicating by key (a refresh de-duplicates too)",
      "page.cursor": "the path of the next page, or null when there is none",
    },
    limits: {
      page: LIST_LIMITS.pageMax,
      held: LIST_LIMITS.heldMax,
      withoutScroller: LIST_LIMITS.flatMax,
      pathChars: LIST_LIMITS.pathMax,
      failsBeforeStopping: LIST_LIMITS.failMax,
      paths: "our API only, under /v1/, no scheme, no .., no //",
    },
  },

  Each: {
    block: "list",
    what: "One template repeated over a small array. Everything is drawn; nothing is windowed.",
    props: {
      data: "array — the entries, already resolved",
      item: "node — the template, drawn with `item` and `index` in scope",
      key: "string — the entry's own id field",
      max: `number — copies to draw, at most ${LIST_LIMITS.eachMax}`,
    },
    limits: { copies: LIST_LIMITS.eachMax },
  },

  Input: {
    block: "input",
    what: "One field node with a `kind`. The value is sanitized, capped, and written to the node's bound path — never evaluated.",
    props: {
      kind: INPUT_KINDS.join(" | "),
      label: "string — a line above the field (switch and slideToConfirm carry their own)",
      placeholder: "string",
      disabled: "boolean",
      maxLength: "number — text, multiline and search",
      length: `number — code: how many boxes (1..${INPUT_LIMITS.codeMax}, default 6)`,
      digitsOnly: "boolean — code: digits only",
      min: "number — number, slider, stepper",
      max: "number — number, slider, stepper; chips: how many chips",
      step: "number — slider, stepper",
      decimals: "number — number: digits after the point (default 2; 0 refuses the point)",
      live: "boolean — slider: write while the finger moves, at most ten times a second. Off, the value lands on release",
      threshold: "number — slideToConfirm: how far across counts (0.5..1, default 0.9; anything else is 0.9)",
      options: "array — segmented, picker: strings, or { value, label }",
      stars: `number — rating: how many (1..${INPUT_LIMITS.ratingMax}, default 5)`,
      minuteStep: "number — time: minutes per row (1..30, default 5)",
      into: "state path — where to write when the node has no `bind.value`",
      autoFocus: "boolean",
    },
    binds: { value: "the value the field shows and writes back" },
    events: {
      onChange: "every change, with the value as it is stored",
      onSubmit: "the return key, a code's last box, a slider's finger lifting, or a slide that went far enough",
      onDismiss: "slideToConfirm: it sprang back",
    },
    limits: {
      text: INPUT_LIMITS.textMax,
      line: INPUT_LIMITS.lineMax,
      search: INPUT_LIMITS.searchMax,
      code: INPUT_LIMITS.codeMax,
      chips: INPUT_LIMITS.chipsMax,
      chipChars: INPUT_LIMITS.chipMax,
      options: INPUT_LIMITS.optionsMax,
      wave1: INPUT_KINDS_WAVE1.join(" "),
      wave2: INPUT_KINDS_WAVE2.join(" "),
      formats: "number → number | null; switch → boolean; chips → string[]; date → YYYY-MM-DD; time → HH:MM (24h); segmented/picker → one of the option values",
    },
  },

  Video: {
    block: "media",
    what: "A clip, played by expo-video. What it is doing goes into state.",
    props: {
      source: "https URL",
      contentFit: "contain | cover | fill (default contain)",
      loop: "boolean",
      muted: "boolean",
      volume: "number 0..1",
      rate: `number ${MEDIA_LIMITS.rate.min}..${MEDIA_LIMITS.rate.max}`,
      autoplay: "boolean",
      playing: "boolean — usually bound; true plays, false pauses",
      controls: "boolean — the platform's own controls (default true)",
      fullscreen: "boolean — offer the fullscreen button (default true)",
      into: "{ playing?, time?, duration?, progress?, ended?, loading? } — state paths",
      tickMs: `number — how often the state paths are written (at least ${MEDIA_LIMITS.tickMinMs})`,
    },
    binds: { playing: "play or pause from the screen's own state" },
    events: {
      onResult: "{ ready: true } — the first frame is drawn",
      onChange: "{ playing, time } — it started or stopped",
      onComplete: "{ time } — it reached the end",
    },
    writes: { "into.*": "playing, time, duration, progress (0..1), ended, loading" },
    limits: { sources: "https only", urlChars: MEDIA_LIMITS.urlMax },
  },

  Audio: {
    block: "media",
    what: "A sound, played by expo-audio. It draws its children; the player is behind them.",
    props: {
      source: "https URL",
      loop: "boolean",
      muted: "boolean",
      volume: "number 0..1",
      rate: `number ${MEDIA_LIMITS.rate.min}..${MEDIA_LIMITS.rate.max}`,
      playing: "boolean — usually bound; true plays, false pauses",
      into: "{ playing?, time?, duration?, progress?, ended?, loading? } — state paths",
    },
    binds: { playing: "play or pause from the screen's own state" },
    events: { onComplete: "{ time } — it reached the end" },
    writes: { "into.*": "playing, time, duration, progress (0..1), ended, loading" },
    limits: { sources: "https only", urlChars: MEDIA_LIMITS.urlMax },
  },

  Camera: {
    block: "media",
    what: "The viewfinder, and the code scanner. It never asks for the permission itself.",
    props: {
      mode: "photo | scan",
      facing: "back | front",
      zoom: "number 0..1",
      torch: "boolean",
      active: "boolean — false stops the preview (default true)",
      quality: "number 0..1 — the picture's quality (default 0.7)",
      capture: "boolean — usually bound; false to true takes one picture, and the node puts it back to false",
      barcodeTypes: `array — any of ${BARCODE_TYPES.join(" ")} (default qr)`,
      scanInto: "state path — the last scan, { type, data }",
      readyInto: "state path — true once the preview is drawn. The preview starting is not an `onResult`: that event means a code was read",
      permissionInto: "state path — granted | unasked | blocked",
      children: "what is drawn until the permission is granted (the server's own card), and over the preview after",
    },
    binds: { capture: "the screen's own shutter flag" },
    events: {
      onResult: "{ type, data } — one scan, de-duplicated and rate-capped. Nothing else fires it, so a scan action always has a code",
      onComplete: "{ uri, width, height } — a picture, as a local file; uploading it is the `uploadFile` action",
      onChange: "granted | unasked | blocked — the camera permission",
      onError: "the camera could not start, or the picture could not be taken",
    },
    writes: {
      scanInto: "{ type, data } — the last scan",
      permissionInto: "granted | unasked | blocked",
      readyInto: "true once the preview is drawn",
    },
    limits: {
      sameCodeAgainMs: MEDIA_LIMITS.scanRepeatMs,
      scansPerSecond: MEDIA_LIMITS.scansPerSecond,
      scanChars: MEDIA_LIMITS.scanDataMax,
    },
  },
};

/** The node types each block brings, which is what V1 registers and the server declares. */
export const BLOCK_NODES: Record<"list" | "input" | "media", string[]> = {
  list: ["List", "Each"],
  input: ["Input"],
  media: ["Video", "Audio", "Camera"],
};
