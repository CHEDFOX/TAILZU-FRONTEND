# X0 Bot icon: the bold round

One idea per icon: few shapes, one gesture, and light carrying the emotion instead of a cute scene. Every file is `<direction>/icon-1024.png`: 1024 x 1024, RGB, no alpha, full bleed, with everything important inside the central 80%.

| Rank | Folder | Idea |
| --- | --- | --- |
| 1 | `e-diamond-ring/` | **Diamond ring.** A total eclipse at the moment the light peeks out. The ring of light is the 0, the four-point burst is the X, and the dark moon is the bot's glass visor. |
| 1b | `e-diamond-ring-face/` | The same mark with the bot showing: the moon smiles with closed eyes. It has more character but is a little softer, and it edges toward a halo emoji. |
| 2 | `a-visor/` | **Visor.** The whole tile is the dark glass visor, with one gesture: a wink (one eye closed in a smile, one wide open). It reads best from across a room. |
| 3 | `b-x0-eyes/` | **X0 eyes.** The name is the face: the X is a twinkle and the 0 is a ring of light. It's clear, but it reads a little like text ("XO"). |
| 4 | `d-players/` | **Players.** One crossing of the noughts-and-crosses grid, a clay X, and a 0 that is the bot, winking. It's graphic, but it says "game". |
| dropped | `c-over-the-edge/` | Two eyes and four fingertips over one horizon line. It's lovely large, but at 29 px it's two dots on a line. |

Why the diamond ring ranks first: it's one shape plus one burst, with no scene. It's a symbol, not a mascot, in the same family as the ChatGPT knot or the Claude spark. It holds up at 29 px as "a ring with a spark" and stands out among colourful apps on dark and light walls. It also tells the brand story without words: X0 is written in light, the moon is the visor, and the burst is the instant something peeks out. That's Peek-a-bot as an event rather than a drawing.

## Palette (evolved)

| Name | Hex | Role |
| --- | --- | --- |
| Obsidian | `#0A0908` to `#030303`, lit top `#131010` to `#1B1714` | the glass |
| Ember core | `#FFF0DA` / `#FFF7EA` | inside an eye or the burst (the old warm glow `#FFF1D6`, made hotter) |
| Ember rim | `#FFC98A` | the edge of the light |
| Amber | `#FFB765` | tight bloom |
| Ember halo | `#FF6B2C` | wide bloom and corona; this is what warms the black |
| Cream / clay | `#FBF0DE`, `#F3E2C6`, `#C9683F` | unchanged, used in D |

## Re-render

Python 3 with numpy and Pillow builds the icons. Node with Playwright builds the review images.

```sh
python3 icons.py                       # all final picks -> <folder>/icon-1024.png (2048 working size, ~70 s)
python3 icons.py e-diamond-ring --n 1024 --out /tmp/prev   # a quick 512 preview of one
python3 icons.py x-rise --out /tmp/prev                    # the explorations that lost (x-* in VARIANTS)
node sheets.mjs sheet /tmp/x0-bold-sheet.png               # large, 60/40/29 pt on dark and light walls, 29 px at 1x
node sheets.mjs home  /tmp/x0-bold-home.png                # in a row of a mock home screen: plain and colourful apps
```

The output is deterministic: the same code produces the same bytes (the dither has a fixed seed).

- `lib.py`: the raster kit. It draws in linear light at 2048 px using signed-distance shapes with analytic anti-aliasing. Bloom is a real Gaussian (FFT) added as light. The glass is a height field lit by a small studio environment. A soft-shoulder tone map rolls hot cores to warm white, then the image is downsampled 2x in linear light, converted to sRGB and dithered.
- `icons.py`: the directions (`a_visor`, `b_x0`, `c_edge`, `d_players`, `e_diamond`) and `VARIANTS`. The `x-*` entries are the explorations that lost, each with a one-line reason.
- `sheets.mjs` and `sheets.json`: the review sheet and home-screen mock. They use a superellipse iOS mask, and the titles and lines live in the JSON.
