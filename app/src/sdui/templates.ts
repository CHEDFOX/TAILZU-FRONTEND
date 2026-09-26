/**
 * Named templates — the app owns a handful of layouts; the backend just picks
 * one by name and hands it content `blocks`. Same idea as Plutto's templates:
 * the server decides WHICH layout + WHAT content, the app owns HOW it's drawn.
 *
 * A screen uses either `root` (a full hand-built tree) or `template` + `blocks`.
 */
import type { Node, ScreenResponse } from "./types";
import { num, str } from "./knobs";

type Composer = (screen: ScreenResponse, blocks: Node[]) => Node;

/** Plain scrolling column of blocks. */
const scroll: Composer = (_screen, blocks) => ({
  type: "Screen",
  children: blocks,
});

/** A titled feature: big heading (from screen.title) then the blocks. */
const feature: Composer = (screen, blocks) => ({
  type: "Screen",
  children: [
    ...(screen.title ? [{ type: "Heading", props: { content: screen.title } } as Node] : []),
    { type: "Spacer", style: { height: num("template.feature.gap", 8) } },
    ...blocks,
  ],
});

/** Blocks stacked with consistent gaps (cards/rows). */
const list: Composer = (_screen, blocks) => ({
  type: "Screen",
  children: [{ type: "Stack", style: { direction: "column", gap: num("template.list.gap", 10) }, children: blocks }],
});

/** Vertically + horizontally centered content (welcome, empty states). */
const centered: Composer = (_screen, blocks) => ({
  type: "Screen",
  style: { justify: "center", flex: 1 },
  children: [
    { type: "Stack", style: { direction: "column", align: "center", gap: num("template.centered.gap", 12) }, children: blocks },
  ],
});

/**
 * Detail: title + subtitle + a hairline divider then blocks. For entity pages
 * (a saved reply, a personality profile, a snippet's variants).
 */
const detail: Composer = (screen, blocks) => ({
  type: "Screen",
  children: [
    ...(screen.title ? [{ type: "Heading", props: { content: screen.title } } as Node] : []),
    { type: "Divider", style: { marginVertical: num("template.detail.dividerMargin", 12) } } as Node,
    ...blocks,
  ],
});

/**
 * Grid: renders blocks as a two-column grid. The screen can bump the column
 * count via `screen.template === "grid"` + `screen.state?.templateColumns`.
 */
const grid: Composer = (screen, blocks) => ({
  type: "Screen",
  children: [
    {
      type: "Grid",
      props: { columns: screen.state?.templateColumns ?? num("template.grid.columns", 2), gap: num("template.grid.gap", 12) },
      children: blocks,
    },
  ],
});

/**
 * Hero: a big brand mark or image at the top, title/subtitle below, then
 * blocks. Used for paywall / marketing / welcome screens.
 */
const hero: Composer = (screen, blocks) => ({
  type: "Screen",
  children: [
    { type: "Hero", props: { title: screen.title, subtitle: screen.state?.subtitle, image: screen.state?.image } },
    { type: "Spacer", style: { height: num("template.hero.gap", 20) } },
    ...blocks,
  ],
});

const TEMPLATES: Record<string, Composer> = { scroll, feature, list, centered, detail, grid, hero };

/** Build a renderable root from a screen's `template` + `blocks`. */
export function composeTemplate(screen: ScreenResponse): Node {
  const blocks = screen.blocks ?? [];
  const composer = TEMPLATES[screen.template ?? str("template.default", "scroll")] ?? scroll;
  return composer(screen, blocks);
}
