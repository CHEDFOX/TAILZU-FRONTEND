# X0 Bot icon: Peek-a-bot in soft 3D

The mic key's Peek-a-bot rendered as a glossy toy on a dark background (three.js, real lighting), four variants.

- `scene.js`: the scene and renderer (runs in the browser). The head is a superquadric, the visor a glass pillow whose emissive map draws the eyes. Ears, antenna and ball are analytic shapes too. Lighting is a studio environment of softboxes, a soft key light jittered per frame, and rim lights, with per-vertex ambient occlusion. Frames are supersampled, composited over the background, and downsampled. `VARIANTS` at the bottom holds the four looks.
- `render.mjs`: drives headless Chromium (Playwright, SwiftShader WebGL) and writes `<variant>/icon-1024.png` and `play-512.png` (RGB, no alpha).
- `sheet.mjs`: comparison sheet (large icons, then 60/40/29 pt on dark and light wallpapers, and 29 px at 1x).

Re-render (three.js is not a repo dependency; install it anywhere outside the repo):

```sh
npm i --prefix /tmp/three3d three@0.169.0
THREE_DIR=/tmp/three3d/node_modules/three node render.mjs                # all variants, 2048 supersampled, 40 samples (~2.5 min each)
THREE_DIR=/tmp/three3d/node_modules/three node render.mjs 2-x0 --size 1024 --samples 6 --out /tmp/prev   # quick preview (512 output)
node sheet.mjs /tmp/sheet.png 1-glow 2-x0 3-front 4-rise
```
