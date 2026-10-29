# X0 Bot: Half-peek, upside down

The black box head hangs into a white tile from the top edge and looks down at you. The eyes are wide and curious, one a touch bigger. Files are `<name>/icon-1024.png` (1024, RGB, full bleed); the soft renders also have `play-512.png`.

Ranked:
1. `soft-sideways`: soft-matte render. The pupils glance down and to the side, and one brow tick is raised. The most curious and alive.
2. `soft-drop`: soft-matte render. Both eyes look straight down at you.
3. `flat-3-sideways`: the flat version of #1.
4. `flat-1-drop`: the flat version of #2. Flipped: the eyes sit right by the rim, so it peeks over the edge.
5. `flat-4-tilt`: the head cocked. Livelier, but the crop goes lopsided.
6. `flat-2-upright`: right way up, hanging, with the chin below the eyes. A box head is symmetric, so the silhouette is the same as flipped. With the eyes higher it hangs rather than peeks, so flipped reads better.
7. `flat-5-antenna`: a stub of antenna points down from the crown. It reads as a drip or lollipop stick. Dropped.

The ground is a true white with a breath of warm grey at the bottom (`#FFFFFF` to `#ECEAE6`) and a soft shadow under the head. The tile holds on light wallpapers because of that bottom tone and the black head.

```sh
python3 flat.py                                     # the five flat takes (uses ../bold/lib.py)
cd ../peek-soft && THREE_DIR=/tmp/three3d/node_modules/three node render.mjs soft-drop soft-sideways --out ../half-peek   # the soft renders (scene in ../peek-soft/scene.js)
REF=/path/to/grok-bot-1024.png node sheets.mjs sheet /tmp/x0-halfpeek-sheet.png
REF=/path/to/grok-bot-1024.png node sheets.mjs home  /tmp/x0-halfpeek-home.png
```

The soft renders use the shared soft-matte scene in `../peek-soft/scene.js`. Its eyes there are real geometry: satin white discs that sit on the curved head, and glossy pupils with a catchlight. The reference icon (another company's) is never stored here; pass its path in `REF`.
