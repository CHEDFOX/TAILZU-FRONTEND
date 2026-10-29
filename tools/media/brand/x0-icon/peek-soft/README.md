# X0 Bot icon: Peek-a-bot, soft matte

One big, soft, matte 3D head peeking up into the tile from the bottom edge and cropped by it. What makes it ours (and not Grok Bot's blob) is our wide rounded bot head, the dark glass visor band with two warm glowing eyes, and a short antenna with a small warm tip instead of a ball. Every file is `<name>/icon-1024.png` (1024 x 1024, RGB, no alpha, full bleed; the face sits inside the central 80%) plus `play-512.png`.

| Rank | Folder | What it is |
| --- | --- | --- |
| 1 | `cream-black/` | Cream head rising into black, with a straight-on visor and two warm open eyes. The purest and most iconic version; it reads from across a room. |
| 2 | `curious/` | The same head entering on a tilt from the bottom left, eyes glancing up. It has the most life, and its diagonal energy is our own. |
| 3 | `coral-black/` | One bold colour, a coral head on black. It holds its own among colourful apps, and coral rather than orange keeps it away from a jack-o'-lantern. |
| 4 | `wink/` | Number 1 with a wink. More personality, a little less calm. |
| 5 | `cream-clay/` | Cream head on a clay ground, the warmest and most on-brand. Clay is a quieter ground than black, so the head pops less. |
| 6 | `ink-cream/` | A charcoal matte head with a gloss-black visor on cream. Premium up close, but at icon size the visor and head merge. |

Tried and dropped:
- An orange "clay" head on black, which read as a pumpkin.
- A tall head, which read as a milk carton with a big forehead.
- A more pillowy front (superquadric depth exponent q < 2), which creased, and the glossy visor showed the crease.
- Bloom, which spilled grey haze off the silhouette.
- Two eyes on the head itself (no visor). This was not rendered: it is the Grok Bot face.

## How it is made

- `scene.js` (runs in the browser): the head is a superquadric (a soft rounded box) in a matte material. The material has high roughness, low specular, a little warm sheen, wrapped diffuse light (the light soaks past the terminator the way it does in clay or soft rubber) and a faint warm emissive term in place of subsurface scattering. The visor is a satin dark-glass pillow on the face, with the eyes drawn into its emissive map in floating point (crisp cores and a soft halo in the glass). The antenna is a capsule with a short glowing cap. The light is one large soft key from the upper left (jittered every frame for soft shadows) inside a dim studio environment, with faint rims to keep the silhouette. Ambient occlusion is baked per vertex from the same analytic shapes. Frames are sub-pixel jittered and averaged, composited over a flat 2D ground (with an optional soft shade halo on light grounds) and box-downsampled. `VARIANTS` at the bottom holds the six looks; the shared `HEAD`, `VISOR`, `ANT`, `LIGHT` and `PEEK` (framing) constants are just above it.
- `render.mjs` drives headless Chromium (Playwright with SwiftShader WebGL) and writes the PNGs.
- `sheets.mjs` and `sheets.json` build the review sheet and the home-screen mock. The reference icon (another company's, for comparison only) is never stored here; you pass its path in `REF`.

```sh
npm i --prefix /tmp/three3d three@0.169.0          # three.js is not a repo dependency
export THREE_DIR=/tmp/three3d/node_modules/three
node render.mjs                                      # all six, 2048 supersampled, 32 samples (~3 min each)
node render.mjs curious --size 1024 --samples 8 --out /tmp/prev   # quick preview (512 output)
REF=/path/to/grok-bot-1024.png node sheets.mjs sheet /tmp/x0-peeksoft-sheet.png
REF=/path/to/grok-bot-1024.png node sheets.mjs home  /tmp/x0-peeksoft-home.png
```
