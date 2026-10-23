# Blip icon kit

Everything runs with plain `node` (v22); Chromium and Playwright are preinstalled.
Run the scripts from this folder, or give their full paths.

KIT=/tmp/claude-0/-home-user/36aabdc6-23c5-5bb4-b965-f6afd0072759/scratchpad/logo/kit

## Tools

- `node $KIT/sheet.mjs out.png a.svg=Label b.svg=Label ...` makes a contact sheet. Each icon gets one row with:
  - the master at 360 px;
  - the icon as a phone shows it (squircle mask, 3x) at 120/60/40/29 pt on a dark wallpaper;
  - 60/40 on a light wallpaper;
  - a 1x 29 px worst case, enlarged.

  Look at the sheet with the Read tool; it shows you the image.
- `node $KIT/png.mjs in.svg out.png 1024 [1]` exports one PNG; pass `1` to add the squircle corners.
- `node $KIT/run.mjs script.js out.json` runs `script.js` in a browser page. The script is the body of an async function and can use `KIT` and `BF`; it should `return` JSON. See `example-bust.js`, which writes an SVG string from the real figure.
  - `BF` is Blip's real figure code (app/src/onboard/blipFigure.ts, bundled): `figure`, `makeDither`, `BAYER`, `POSES`, `arcPath`, `ellipsePath`, `roundRect`, `grey`.
  - `KIT.state(pose, overrides)` gives a still figure state, e.g. `{tilt, brows, look:[x,y], mouth:"grin"|"smile"}`.
  - `KIT.figure(g, H, st)` draws him in greys into a .84H x H box.
  - `KIT.geo(H, st)` says where his head, eye, antenna ball, mouth and ears are, so you can draw vector parts on top.
  - `KIT.dither(draw, {x0,y0,w,h,cell, grid, bayer})` turns ANY grey drawing into Blip's dots: the ink sticker plus the Bayer-lit pale dots. With `grid:true` it also returns each cell's luminance, for size-graded halftones.
  - `KIT.dotsPath(points, r, scale, ox, oy)` turns dot centres into one compact `<path d>`.

## Who Blip is (read app/src/onboard/blipFigure.ts `figure()` for the exact drawing)

Look at the frames: /home/user/TAILZU-FRONTEND/tools/media/app/blip/wave-l/004.png and the other folders.

- **Head:** an ellipse a little wider than tall, lit from the upper left. In the app, shading is the density of pale dots.
- **Ears:** small rounded tabs on the sides.
- **Antennae:** two.
  - LEFT: a curved stalk ending in a ball, which glows neon #39FF14 when he listens.
  - RIGHT: a bent, angular wire (up, then a kink to the right), with no ball.
- **Eye:** ONE big eye, a little left of centre, with:
  - a thick dark ring;
  - a white eyeball and a dark pupil with a small glint at its upper left;
  - a grey upper lid over the top of the eyeball (a sleepy, friendly look);
  - a dark brow arc above it.
- **Face:** three freckles on the right cheek. The mouth is small and set right of centre: a smile with one tiny white buck tooth, or a grin.
- **Body:** a neck, a striped jumper, arms with round hands, striped socks and shoes.
- **The dot look:** an ink "sticker" (dark dots one cell wider than his shape) with pale cream dots inside. On light paper it reads as a die-cut sticker.

## Brand palette

| Role | Colour |
|---|---|
| ink | #151311, #1C1A17 |
| paper | #EFEDE8 |
| surface | #FCFBF8 |
| cream dots | #F3E2C6 |
| neon (antenna/listening only, use sparingly) | #39FF14 |
| tan | #E9CBA2 |
| rust | #C77A3A |

Amber #E8A23C is reserved for streaks in the app, so avoid it.

The current icon is ../try/current-faceDark.svg, its moods are in ../project/Face.dc.html, and ../try/sheet0.png shows it next to a raw real-dither test. The user's verdict on the current icon: "looks fine — refine it further and make it aesthetic", and "also create a cute version".

## Output rules for every icon SVG

- **Canvas:** `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">`, full-bleed square, no width/height attributes. The OS applies its own corner mask, so paint the whole square. No transparency.
- **Self-contained:** no `<image>`, no external refs, no data: URIs, no `<text>`, no `<style>`, no CSS classes. Use attributes only.
  - Gradients and a sparing `<filter>` (blur for glow) are fine.
- **Ids:** every id must start with a prefix unique to the file (e.g. `cuD-`), so several icons can be inlined in one HTML page.
- **Size:** each file under 100 KB. Merge dots into a few `<path>`s with `KIT.dotsPath`; never use one `<circle>` per dot.
- **Safe area:** keep the eye and antenna ball inside the central 80%; nothing important within 100 units of an edge.
- **Small sizes:** at 60 pt it must still read as Blip (the eye plus the neon antenna); at 29 pt it must read as a face, not mush.
