/**
 * B11, SHELL AND PRESENTATIONS AS TREES (pure SPEC 2.10). OFF unless a screen or the bootstrap states it needs `shell` and this client
 * declared it: V1 calls `registerShell(registry)` and wires nothing else. Nothing here replaces today's tab bar, header or toast; they
 * draw when the server sends no tree.
 */
import { normalizePresentation, PRESENTATIONS, TRANSITIONS } from "./presentation";
import { DETENT_NAMES, MAX_DETENTS } from "./sheetMath";
import { HeaderTree, ModalTree, SheetTree, TabBarTree, ToastTree } from "./trees";

export { normalizePresentation } from "./presentation";
export type { PresentSpec, Presentation, Transition } from "./presentation";
export { detentHeights, normalizeDetents, settle, clampDrag } from "./sheetMath";
export type { TreeHost } from "./trees";

/** What V1 hands the shell, so it can read state and run actions without importing the renderer. */
export interface ShellHost {
  read(path: string): unknown;
  subscribe(path: string, cb: () => void): () => void;
  dispatch(actionRef: unknown): void;
  setState(path: string, value: unknown): void;
}

/** The exact props of every shell node and key, for the server lint and V1. Unknown props are ignored; bad values clamp. */
export const SPEC = Object.freeze({
  block: "shell",
  bootstrap: {
    "shell.tabBar": "tree of TabBar (children: the tab items)",
    "shell.header": "tree of Header (slots: leading, children, trailing)",
    "shell.toast": "tree of Toast (children: the words)",
  },
  nodes: {
    TabBar: { height: "number 40..120", background: "colour", borderColor: "colour", bottomInset: "number 0..80" },
    Header: { height: "number 32..120", background: "colour" },
    Toast: { bottom: "number 0..400", background: "colour", ms: "number 800..10000" },
    Modal: { background: "colour", dismissible: "boolean", backdrop: "colour", radius: "number 0..40" },
    Sheet: { background: "colour", detents: `up to ${MAX_DETENTS} of ${Object.keys(DETENT_NAMES).join("|")} or a fraction 0.1..1`, initial: "detent index", dismissible: "boolean", backdrop: "colour", radius: "number 0..40" },
  },
  navigate: {
    presentation: PRESENTATIONS,
    detents: "as Sheet.detents",
    transition: TRANSITIONS,
    dismissible: "boolean",
  },
  default: "push (today's behaviour) for a missing or wrong value",
});

export interface ShellRegistry {
  /** `helpers` are plain functions V1 may call; they are not node types. */
  register(block: string, spec: typeof SPEC, nodes: Record<string, unknown>, helpers?: Record<string, unknown>): void;
}

/** V1 calls this once, only for a client that declares `shell`. */
export function registerShell(registry: ShellRegistry): void {
  registry.register("shell", SPEC, { TabBar: TabBarTree, Header: HeaderTree, Toast: ToastTree, Modal: ModalTree, Sheet: SheetTree }, { present: normalizePresentation });
}
