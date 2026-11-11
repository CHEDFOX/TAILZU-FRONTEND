"""Paint out the shoe at the left edge: the rug's border copied from just below it, feathered in. The camera is locked
(0 px drift over the clip), so one patch, re-cut from each frame's own pixels, holds for every frame."""
import sys, numpy as np
from PIL import Image, ImageFilter, ImageDraw
src, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
X0, X1, Y0, Y1, DY = 0, 100, 455, 610, 150     # the shoe's box (with a margin) and how far below the source strip lies
m = Image.new("L", (1080, 1920), 0); ImageDraw.Draw(m).rounded_rectangle([X0 - 40, Y0, X1, Y1], 30, fill=255)
m = np.asarray(m.filter(ImageFilter.GaussianBlur(10)), dtype=np.float32)[..., None] / 255
for i in range(1, n + 1):
    a = np.asarray(Image.open(f"{src}/f{i:03d}.jpg").convert("RGB"), dtype=np.float32)
    patch = np.roll(a, -DY, axis=0)                     # each pixel takes the one DY px below it
    o = a * (1 - m) + patch * m
    Image.fromarray(np.clip(o, 0, 255).astype(np.uint8)).save(f"{out}/s{i:04d}.jpg", quality=94)
print("patched", n)
