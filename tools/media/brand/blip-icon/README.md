# Blip app icon

Two finished icon families. Each folder holds the master and three companions:

- `icon.svg`: the master icon.
- `alt.svg`: the same design on the other ground.
- `listening.svg`: eye up, antenna sending.
- `done.svg`: happy eye and a sparkle.

All of them are 1000x1000, full bleed and self-contained (no images, text or styles). Every id carries a prefix unique to its file, so the SVGs can be inlined side by side.

| Folder | Look | Master ground | `alt.svg` |
|---|---|---|---|
| `refined/` | The dotted head from onboarding, made exactly: sleepy lid, brow, freckles, buck-tooth smile, both antennae. Whole dots sized by the light, and an ink sticker edge. | dark | paper |
| `cute/` | Rounder head, glossy eye with two glints, pink dot blush. | warm cream | dark, with a cream die-cut edge |

`icon-1024.png` is the master exported for the stores (no corner mask; the OS adds it). `sheet.png` shows the family at home-screen sizes.

## Regenerating

The SVGs come from the generator scripts, not from hand edits. The refined generator's neon rim light on the head is used only in `listening.svg`.

    OUT=refined node refined/gen.mjs      # writes refined/*.svg
    node cute/gen.mjs cute                # writes cute/*.svg

## Checking at real sizes

`kit/` holds the render helpers the icons were made with (Playwright with Chromium):

- `sheet.mjs out.png a.svg=Label ...` renders a contact sheet: the master, 120/60/40/29 pt on two wallpapers, and a 1x 29 px worst case.
- `png.mjs in.svg out.png 1024` exports one PNG.
- `run.mjs` with `page.html` runs Blip's real figure (`app/src/onboard/blipFigure.ts`) and its dither in a page. Bundle the figure first:

      esbuild app/src/onboard/blipFigure.ts --bundle --format=iife --global-name=BF --outfile=tools/media/brand/blip-icon/kit/blipFigure.js

`kit/README.md` is the brief the designs were made against: who Blip is, the palette, and the rules for the files.
