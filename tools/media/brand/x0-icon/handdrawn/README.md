# X0 Bot icon: the real peek, hand-drawn

The keyboard mic key's Peek-a-bot (`app/targets/keyboard/PeekBotView.swift`) peeks up over an edge:
head rising from below, paws gripping the edge, one antenna with a clay ball. The face is only the
eyes, with a tiny mouth or blush where it helps. The feeling comes from the eyes, the head tilt, the
antenna's swing and a motion mark. Grounds, and in most versions the bot, are drawn with simulated
media: brush ink, crayon, chalk, pencil, risograph, torn paper.

| Version | Ground and media | Feeling |
| --- | --- | --- |
| `1-curious` | cream paper, scribbled clay sun, brush ink and crayon fills | looks up at its swinging antenna, head cocked, one eye wider |
| `2-happy` | clay crayon ground, charcoal ledge, inked bot | happy squint, blush, antenna bobbing |
| `3-wink` | ink-black chalkboard, chalk ledge and chalk antenna, painted bot | wink and smirk, a chalk sparkle |
| `4-shy` | kraft card, torn paper edge, pencil line | peeks lower, one paw, sideways glance, blush |
| `5-riso` | two-colour risograph (clay + black), off register, screened tints | starry-eyed, antenna pinging |
| `6-hello` | apricot crayon ground and charcoal ledge only; the bot is painted with no outline | small smile, one paw waving |

Each folder holds `icon-1024.png`: 8-bit RGB, no alpha, full bleed (the OS rounds the corners). The
bot stays inside the central ~80%. These are raster by design (the grain lives in the pixels), so
there is no `icon.svg`. The generator is the source.

## Files

- `draw.js`: the drawing library (runs in the browser). It has seeded noise, a paper-tooth height
  map, and the media model: every mark is drawn as pressure and then deposited through the tooth
  (crayon breaks up at low pressure, ink lands nearly solid). It also has wobbled, tapered brush lines
  with overshoot and heavier weight on the shadow side, crayon hatching and scribbles.
- `bot.js`: the Peek-a-bot (`HD.icon(art, spec)`). It covers geometry from the key (head 1.12 x 0.86,
  visor 0.84 x 0.46; eyes and antenna a bit larger for 29 px), eyes and expressions, the ledge, paws
  and motion marks.
- `versions.js`: the six versions (pose, feeling, media per part, ground, seed).
- `render.mjs`: renders in headless Chromium through Playwright, at a 2048 master averaged down to 1024,
  and writes the PNGs.
- `sheet.mjs`: the comparison sheet (220 pt with a 22.37% corner radius; 60/40/29 pt on dark and light
  wallpapers at 2x; 29 px at 1x).

## Re-render

Needs Node 22+ and Playwright with Chromium (`require("playwright")` must resolve).

```sh
cd tools/media/brand/x0-icon/handdrawn
node render.mjs                         # all six -> <version>/icon-1024.png (~3 s each)
node render.mjs 2 3                     # only some (by number or id)
node render.mjs --size 1024 --out /tmp/prev   # quick preview -> /tmp/prev/<version>/icon-512.png
node sheet.mjs /tmp/x0-handdrawn-sheet.png    # sheet from this folder's PNGs
node sheet.mjs /tmp/sheet.png /tmp/prev       # ...or from a preview folder
```

All randomness is seeded (`seed` in each version), so a re-render is byte-identical. To try a
variation, change a version's `bot` (tilt, rise, `face.eyes` = pill | happy | wink | star | round,
`face.look`, `antenna.angle` / `curl` / `marks` = swing | bob | pop) or its `style` / `ground`, and
re-render.
