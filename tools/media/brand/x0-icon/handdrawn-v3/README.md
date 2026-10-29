# X0 Bot icon, hand-drawn v3: "Curious" in six colourways

The owner picked v2 "3 · Curious": wide eyes looking up at its own antenna, head cocked, one clay
brush ring. v3 keeps that drawing (v1 and v2 are kept in `../handdrawn/` and `../handdrawn-v2/`) and
tries six colour combinations, with a little more hand-made feeling.

**More hand-made, same minimal face:**
- The eyes are slightly asymmetric (the left a touch bigger and higher).
- Each eye's glow hot spot and catchlights point up at the antenna ball (`face.gaze`).
- One tiny lifted brow line sits on the visor over the bigger eye.
- The antenna has just boinged: a small damped wiggle runs along the stalk (`antenna.boing`), and two
  short wobble arcs hug the ball.
- The ring is one real brush stroke. It lands slightly fat, has hairline bristle partings, and runs dry
  into split bristle streaks. The gap between start and end shows on the upper right.
- The line is a bit less even: more width jitter and a touch of dry-brush grain on the outline.

| Version | Ground | Ring | Edge line |
| --- | --- | --- | --- |
| `1-ink` | deep warm ink | clay | chalk cream |
| `2-sage` | sage-olive | cream | ink |
| `3-night` | dusty night blue | warm amber | chalk cream |
| `4-clay` | clay | cream | ink |
| `5-butter` | butter yellow | ink | ink |
| `6-blush` | soft blush-peach | clay | ink |

The bot is the same in all six (cream shell, dark visor, warm glowing eyes, clay ears and ball), drawn
from the same seed, so only the colours change.

Each folder holds `icon-1024.png`: 8-bit RGB, no alpha, full bleed (the OS rounds the corners). The
bot stays inside the central ~80%. These are raster by design, so the generator is the source.

## Files

- `draw.js`: the drawing library (as v2).
- `bot.js`: the v2 bot, plus gaze-aimed eye glow and catchlights, the antenna boing, and a below-edge
  tint with any blend.
- `versions.js`: the shared Curious drawing (`curious(...)`), the brush ring (`enso`), the ball
  wobble, and the six colourways.
- `render.mjs`: rendering (as v2).
- `sheet.mjs`: the sheet (as v2), plus `--extra <png> <label> <note>` to add other icons for comparison.

## Re-render

Needs Node 22+ and Playwright with Chromium (`require("playwright")` must resolve).

```sh
cd tools/media/brand/x0-icon/handdrawn-v3
node render.mjs                               # all six -> <version>/icon-1024.png (2048 master, ~4 s each)
node render.mjs 2 3                           # only some
node render.mjs --size 1024 --out /tmp/prev   # quick preview -> /tmp/prev/<version>/icon-512.png
node sheet.mjs /tmp/x0-curious-v3-sheet.png . \
  --extra ../handdrawn-v2/3-curious/icon-1024.png "v2 · Curious" "The picked v2 icon, for comparison."
```

Everything is seeded, so a re-render is byte-identical. To add a colourway, add a `curious(id, name,
note, { ground, ring, edge, ... })` line at the bottom of `versions.js`. The options are `dark`,
`light` (a soft light behind the head), `below` (a tint below the edge), `stalk` and `marks` (colours
for dark grounds), and `ballGlow`.
