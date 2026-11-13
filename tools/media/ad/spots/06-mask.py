#!/usr/bin/env python3
"""THE HOLD (spot 06): the patches that paint the clothing wordmark out of the sprinter's release.

  python3 -I spots/06-mask.py      (after: node prep.mjs <mixkit 588> footage-06-a/ --from 8.2 --to 10.6 --crop 0.47,0,0.316,1 --fps 24 --no-interp)

In frames 40-51 of footage-06-a/ (the film uses 42-51) a grey wordmark runs down the outer edge of her left thigh. Inside a loose hand-drawn
region per frame, every row is scanned from the legging outwards: the grey letters (neutral, lighter than the black
fabric) are taken until the background (bright cyan sky, the green fence) begins, and replaced by the fabric's own
colour from just inside them. Each patch is an RGBA PNG (the fabric where the letters were, transparent elsewhere,
feathered) that 06.js draws over its frame: spots/06-mask/aNN.png.
"""
import os, numpy as np
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
FOOT = os.path.join(HERE, "..", "footage-06-a")
OUT = os.path.join(HERE, "06-mask")
# loose regions (frame px): the letters are inside, the sleeve and the hand mostly outside
LOOSE = {
    40: [(700, 566), (790, 566), (790, 780), (676, 780)],
    41: [(690, 518), (790, 518), (790, 780), (676, 780)],
    42: [(680, 462), (780, 462), (770, 780), (640, 780)],
    43: [(656, 436), (770, 436), (760, 780), (624, 780)],
    44: [(644, 434), (750, 434), (742, 780), (616, 780)],
    45: [(632, 428), (735, 428), (722, 795), (610, 795)],
    46: [(636, 428), (730, 428), (722, 785), (612, 785)],
    47: [(626, 428), (722, 428), (722, 590), (624, 590)],
    48: [(614, 590), (690, 590), (690, 800), (606, 800)],
    49: [(600, 428), (672, 428), (672, 805), (594, 805)],
    50: [(590, 428), (660, 428), (660, 815), (584, 815)],
    51: [(580, 428), (650, 428), (650, 825), (574, 825)],
}
os.makedirs(OUT, exist_ok=True)
for i, poly in LOOSE.items():
    a = np.asarray(Image.open(os.path.join(FOOT, "s%04d.jpg" % i)).convert("RGB")).astype(np.int32)
    H, W, _ = a.shape
    reg = Image.new("L", (W, H), 0); ImageDraw.Draw(reg).polygon(poly, fill=255); reg = np.asarray(reg) > 0
    lum = a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11
    neutral = (a.max(-1) - a.min(-1)) < 22
    fabric = neutral & (lum < 100)
    letter = neutral & (lum >= 100) & (lum < 218)
    bg = ((a[..., 2] - a[..., 0]) >= 14) | ((a[..., 1] - a[..., 0]) >= 10) | (lum >= 238)   # sky, fence, sleeve
    mask = np.zeros((H, W), bool)
    ys = np.nonzero(reg.any(1))[0]
    # the leg's outer edge per row: the last pixel, from the right, that is not background; its outer envelope, smoothed
    edge_x = {}
    for y in ys:
        xs = np.nonzero(reg[y])[0]; x0, x1 = xs[0], xs[-1]; b = x1
        while b > x0 and bg[y, b]: b -= 1
        edge_x[y] = b
    mx = {y: max(edge_x[q] for q in range(y - 5, y + 6) if q in edge_x) for y in ys}            # the outer envelope (letter tips included)
    sm = {y: int(round(np.mean([mx[q] for q in range(y - 5, y + 6) if q in mx]))) for y in ys}  # smoothed
    for y in ys:
        xs = np.nonzero(reg[y])[0]; x0 = xs[0]; b = min(sm[y], edge_x[y])
        x = x0; last_fabric = None
        while x <= b:
            if fabric[y, x]: last_fabric = x; x += 1; continue
            if letter[y, x] and last_fabric is not None and x - last_fabric <= 4:
                s0 = x
                while x <= b and not fabric[y, x]: x += 1
                e = b if b - x <= 4 or x > b else x   # letters that reach the edge: cover their blend into the sky too
                mask[y, max(0, s0 - 2):e + 1] = True
                continue
            last_fabric = None
            x += 1
    # over the letters' rows the leg's edge is redrawn as the smoothed line: fabric from the letters out to it
    rows = np.nonzero(mask.any(1))[0]
    if len(rows):
        for y in range(rows.min() - 3, rows.max() + 4):
            if y in sm:
                xs = np.nonzero(mask[y])[0]; xa = min(xs.min() if len(xs) else sm[y] - 14, sm[y] - 14)
                mask[y, xa:sm[y] + 2] = True
    # fill the letters from the fabric around them (a diffusion from the known fabric pixels), grown a touch, feathered
    grow = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    gy, gx = np.nonzero(grow)
    if not len(gy): print(i, "no letters found"); continue
    Y0, Y1, X0, X1 = max(0, gy.min() - 14), min(H, gy.max() + 15), max(0, gx.min() - 14), min(W, gx.max() + 15)
    g = grow[Y0:Y1, X0:X1]; known = fabric[Y0:Y1, X0:X1] & ~g
    val = np.where(known[..., None], a[Y0:Y1, X0:X1], 0).astype(np.float32); wt = known.astype(np.float32)
    for _ in range(220):
        sv = np.zeros_like(val); sw = np.zeros_like(wt)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv += np.roll(np.roll(val * wt[..., None], dy, 0), dx, 1); sw += np.roll(np.roll(wt, dy, 0), dx, 1)
        upd = g & (sw > 0)
        val[upd] = sv[upd] / sw[upd][:, None]; wt = np.where(g, (sw > 0).astype(np.float32), wt)
    full = np.zeros((H, W, 3), np.float32); full[Y0:Y1, X0:X1] = val; val = full
    m = Image.fromarray((grow * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
    f = Image.fromarray(np.clip(val, 0, 255).astype(np.uint8))
    rgba = f.convert("RGBA"); rgba.putalpha(m)
    bb = m.getbbox()
    rgba.save(os.path.join(OUT, "a%02d.png" % i), optimize=True)
    print(i, "letters", int(mask.sum()), "px, box", bb)
