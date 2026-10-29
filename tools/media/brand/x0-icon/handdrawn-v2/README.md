# X0 Bot icon, hand-drawn v2: bigger, bolder, the eyes first

The second round of the hand-drawn Peek-a-bot icons. v1 is kept in `../handdrawn/`. This round
answers the review of v1:

- The head fills ~70% of the width, cropped tight.
- The eyes are the hero: big glowing eyes with catchlights, lids, lifted cheeks and brow lines on the
  visor (or ink eyes on the face plate in 5).
- There is no scribbled sun. Each ground has one intentional thing at most: warm light, a glow, or one
  brush ring.
- The edge is a single confident brush line, and the ground carries on below it. There is no band.
- The hands have three fingers hooked over the line.
- The finish is a clean brush-ink line with weight on the shadow side, flat fills with a soft gradient
  and a cel shadow, and grain kept to the paper.

| Version | Ground | Feeling |
| --- | --- | --- |
| `1-happy` | clay, warm light behind | happy squint (∩ ∩), lifted blushing cheeks, head tilted, antenna bouncing |
| `2-wink` | ink-dark, chalky edge, warm glow off the antenna | a wink, the other brow cocked, head tilted, one sparkle |
| `3-curious` | cream paper, one clay brush ring (ensō) | wide eyes up at its own antenna, head cocked hard |
| `4-peekaboo` (new) | sand card, a single line, lots of space below (Kilroy-style) | shy: glancing away, brows up in the middle, blush, antenna drooping |
| `5-oh` (new) | peach, brush-ink minimal, no visor | "Oh!": ink eyes on the face plate, brows up, a little 'o'; the antenna is one whippy brush stroke |

Each folder holds `icon-1024.png`: 8-bit RGB, no alpha, full bleed (the OS rounds the corners). The
bot stays inside the central ~80%. These are raster by design, so the generator is the source.

## Files

- `draw.js`: the drawing library, shared with v1 plus stroke width profiles. It has seeded noise, the
  paper tooth, and the pressure-to-deposit media model. It also has brush lines with taper,
  overshoot and shadow-side weight.
- `bot.js`: the v2 bot (`HD.icon(art, spec)`). It covers the head and visor proportions, the eyes
  (`eyePts`: lids, cheeks; `arc` eyes for a closed smile), the brows, blush and mouth, the antenna (a
  bent stalk or a free cubic `path`), the hands, and the single-line edge (everything above it is
  clipped, so the ground continues below).
- `versions.js`: the five versions.
- `render.mjs`, `sheet.mjs`: rendering and the comparison sheet, the same as v1.

## Re-render

Needs Node 22+ and Playwright with Chromium (`require("playwright")` must resolve).

```sh
cd tools/media/brand/x0-icon/handdrawn-v2
node render.mjs                               # all five -> <version>/icon-1024.png (2048 master, ~3 s each)
node render.mjs 1 2                           # only some
node render.mjs --size 1024 --out /tmp/prev   # quick preview -> /tmp/prev/<version>/icon-512.png
node sheet.mjs /tmp/x0-handdrawn-v2-sheet.png # 220 pt, then 60/40/29 pt on dark and light wallpapers, 29 px at 1x
```

Everything is seeded, so a re-render is byte-identical. The pose and feeling live in each version's
`bot`: `tilt`, `rise` (how far above the edge), `face.look`, `face.eyes[i]` (`hs`/`ws`, `lid: [depth,
slope]`, `cheek`, `arc`, `brow: {gap, len, bend, rot}`), `blush`, `mouth`, and `antenna` (`angle`/`curl`
or `path`).
