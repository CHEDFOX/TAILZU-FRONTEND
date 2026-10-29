# X0 Bot icon, hand-drawn v4: faces, shapes and colours

Built on the v3 Curious bot: the hand-made line, the peek with hands on one drawn edge, the antenna
that just boinged, and the brush stroke behind. v4 varies three things:
- **the face:** eight minimal, hand-drawn expressions;
- **the head and visor shape:** a few members of the same Peek-a-bot family;
- **the colour:** a new, cleaner palette, with each ground chosen to suit its face's mood.

The bot stays cream with a dark visor and warm eyes. The ground, a soft light behind the head, a light
vignette and the brush stroke carry the colour. v1–v3 are kept in `../handdrawn*`.

| Version | Head / visor | Ground / stroke | Face |
| --- | --- | --- | --- |
| `1-curious` | wide rounded / rounded | deep teal / apricot | wide eyes up at the antenna, one brow lifted, head cocked |
| `2-happy` | bun / round screen | marigold / cream | soft happy squint, rosy cheeks, a small smile |
| `3-smirk` | wide capsule / rounded | coral / cream | half-lidded, one brow up, a lopsided smirk |
| `4-oh` | squashed oval / none (ink eyes on the face plate) | sky blue / coral | wide eyes, brows up, a tiny 'o'; the antenna pops |
| `5-wink` | tall rounded square / two eye windows | deep plum / coral | a wink and a cocked brow (drawn on the face plate), a little smile |
| `6-sleepy` | bun / rounded | warm charcoal, amber glow / amber | eyes gently closed, cheeks, "z z" |
| `7-glance` | wide rounded / wide band | fresh mint / deep teal | a sideways glance, a brow raised on the face plate |
| `8-sparkle` | squashed oval / round screen | clean cream / strong clay | sparkling star eyes, rosy cheeks |
| `9-curious-twin` | tall rounded square / two eye windows | lilac / coral | curious, looking up, a brow on the face plate |

`shapes/` holds the shape grid: the same Curious face in one neutral colour, so a shape can be picked
apart from the face and colour.
- `h1`–`h5` are the head shapes (wide rounded, bun / dome, tall rounded square, wide capsule, squashed
  oval), each with the rounded visor.
- `v1`–`v5` are the visor shapes (rounded, wide band, round screen, two eye windows, no visor), each on
  the wide rounded head.

Each folder holds `icon-1024.png`: 8-bit RGB, no alpha, full bleed (the OS rounds the corners). The
bot stays inside the central ~80%. These are raster by design, so the generator is the source.

## Files

- `draw.js`: the drawing library (as v3). A path can now have several parts (two eye windows).
- `bot.js`: the bot.
  - Head shapes: `bot.head` is rounded, dome, square, capsule or oval.
  - Visor kinds: `bot.visorKind` is rounded, band, round or twin; `bot.visor: false` means no visor.
  - Face parts:
    - eyes: open with lids and cheeks, gaze-aimed glow and catchlights;
    - `arc` eyes, with `down` for content;
    - `star` eyes;
    - brows on the visor or on the face plate;
    - blush;
    - mouths: smile, smirk or o, on the visor or on the plate.
- `versions.js`: the palette `C`, the shape presets `SHAPE` and `VISOR`, the nine versions, and
  `HD.SHAPES` (the neutral grid).
- `render.mjs`: rendering. `--set shapes` renders the shape grid into `shapes/`.
- `sheet.mjs`: the comparison sheet. `--grid dir "Title" ids` adds a row of small specimens.
- `home.mjs`: a mock iPhone home screen (dark and light wallpaper) with the icons among neutral
  placeholder apps.

## Re-render

Needs Node 22+ and Playwright with Chromium (`require("playwright")` must resolve).

```sh
cd tools/media/brand/x0-icon/handdrawn-v4
node render.mjs                     # the nine versions -> <version>/icon-1024.png (2048 master, ~4 s each)
node render.mjs --set shapes        # the neutral shape grid -> shapes/<id>/icon-1024.png
node sheet.mjs /tmp/x0-faces-v4-sheet.png . \
  --grid shapes "Head shapes (one neutral colour, rounded visor)" "h1-rounded,h2-bun,h3-square,h4-capsule,h5-oval" \
  --grid shapes "Visor shapes (on the wide rounded head)" "v1-rounded,v2-band,v3-round,v4-twin,v5-none"
node home.mjs /tmp/x0-faces-v4-home.png .
node render.mjs --size 1024 --out /tmp/prev   # quick preview (512 PNGs)
```

Everything is seeded, so a re-render is byte-identical. To try a combination, add a
`make(id, name, note, colour, { shape, visor, tilt, rise, face, antenna, after })` entry in
`versions.js`:
- `colour` is a key of `C`;
- `shape` is a key of `SHAPE`;
- `visor` is a key of `VISOR`.
