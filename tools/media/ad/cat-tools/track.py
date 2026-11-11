"""Track the cat's nose: the solid dark body (a box-blurred dark mask, so the rug's dark speckle drops out) in the upper
part of the frame, and its point nearest the girl's head. Writes track.json: per frame [x, y] in 1080x1920 px."""
import sys, json, numpy as np
from PIL import Image, ImageFilter
src, n = sys.argv[1], int(sys.argv[2])
GIRL = (860, 1075)
out = []
def largest(m):
    # the biggest 4-connected blob (the cat; the rug's dark bits are small)
    H, W = m.shape; seen = np.zeros_like(m); best = None; bn = 0
    for y0, x0 in zip(*np.nonzero(m)):
        if seen[y0, x0]: continue
        st = [(y0, x0)]; seen[y0, x0] = True; pts = []
        while st:
            y, x = st.pop(); pts.append((y, x))
            for yy, xx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
                if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; st.append((yy, xx))
        if len(pts) > bn: bn = len(pts); best = pts
    o = np.zeros_like(m)
    if best: ys, xs = zip(*best); o[list(ys), list(xs)] = True
    return o
for i in range(1, n + 1):
    im = Image.open(f"{src}/f{i:03d}.jpg").convert("L").resize((270, 480))
    dark = im.point(lambda v: 255 if v < 36 else 0).filter(ImageFilter.BoxBlur(5))
    m = np.asarray(dark, dtype=np.float32) / 255 > 0.6
    m[:, :28] = False; m[256:, :] = False   # the shoe at the left edge, and her hair below
    m = largest(m)
    ys, xs = np.nonzero(m)
    if len(xs) == 0: out.append(out[-1] if out else [540, 300]); continue
    gx, gy = GIRL[0] / 4, GIRL[1] / 4
    d = (xs - gx) ** 2 + (ys - gy) ** 2; k = np.argsort(d)[:12]
    out.append([float(xs[k].mean() * 4), float(ys[k].mean() * 4)])
a = np.array(out)
sm = a.copy()   # a light temporal smoothing (5-frame centred mean)
for i in range(len(a)): sm[i] = a[max(0, i - 2): i + 3].mean(0)
json.dump({"girl": GIRL, "cat": sm.round(1).tolist()}, open(sys.argv[3], "w"))
print(sm[0], sm[len(sm) // 2], sm[-1])
