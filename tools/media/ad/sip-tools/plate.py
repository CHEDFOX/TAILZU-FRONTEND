"""The freeze plate: frames 1-144 as shot; from frame 145 (t = 6.0 s) the frame is frozen except a soft region above the
cup, where the clip's own steam keeps rising (later and earlier stretches, aligned to the frozen frame and cross-faded)."""
import sys, numpy as np
from PIL import Image, ImageFilter, ImageDraw
src, out, N = sys.argv[1], sys.argv[2], int(sys.argv[3])
W, H = 1080, 1920
load = lambda i: np.asarray(Image.open(f"{src}/f{i:03d}.jpg").convert("RGB"), dtype=np.float32)
F0 = 145
ref = load(F0).mean(2)
def shift_of(img, box=(300, 900, 900, 1700)):
    x0, y0, x1, y1 = box
    A = ref[y0:y1, x0:x1] - ref[y0:y1, x0:x1].mean(); g = img.mean(2)[y0:y1, x0:x1]; B = g - g.mean()
    R = np.fft.fft2(A) * np.conj(np.fft.fft2(B)); R /= np.abs(R) + 1e-9
    r = np.fft.ifft2(R).real; y, x = np.unravel_index(r.argmax(), r.shape)
    if y > r.shape[0] // 2: y -= r.shape[0]
    if x > r.shape[1] // 2: x -= r.shape[1]
    return int(x), int(y)
def aligned(i):
    im = load(i); dx, dy = shift_of(im)
    return np.roll(im, (dy, dx), axis=(0, 1))
# the mask: a soft column over the steam, left of the monitor, above the hands and the cup's rim
m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
d.polygon([(745, 1150), (735, 1000), (760, 860), (820, 790), (895, 800), (902, 960), (900, 1150)], fill=255)
m = np.asarray(m.filter(ImageFilter.GaussianBlur(22)), dtype=np.float32) / 255
yy = np.arange(H)[:, None]; m *= np.clip((1172 - yy) / 40, 0, 1)   # fade out before the fingers and the rim
M = m[..., None]
SEGS = [list(range(145, 193)), list(range(97, 145)), list(range(49, 97))]
XF = 12
seg_frames = [[aligned(i) for i in s] for s in SEGS]
bgs = [np.min(np.stack(s), axis=0) for s in seg_frames]
frozen = load(F0)
base = frozen * (1 - M) + bgs[0] * M          # the frozen frame with its own steam taken out
# the steam timeline: segment k starts at 36k frames; the last XF frames of each overlap the next
timeline = []
for k, s in enumerate(SEGS):
    for j in range(len(s)): timeline.append((k, j, 36 * k + j))
def steam(n):   # n = frames since the freeze
    acc = np.zeros_like(frozen); wsum = 0
    for k, s in enumerate(SEGS):
        j = n - 36 * k
        if 0 <= j < len(s):
            w = 1.0
            if k > 0 and j < XF: w = (j + 0.5) / XF
            if k < len(SEGS) - 1 and j >= 36: w = 1 - (j - 36 + 0.5) / XF
            acc += w * (seg_frames[k][j] - bgs[k]); wsum += w
    return acc / max(wsum, 1e-6)
for n in range(N):
    if n < F0 - 1: img = load(n + 1)
    else:
        k = n - (F0 - 1)
        img = np.clip(base + M * steam(k), 0, 255)
    Image.fromarray(img.astype(np.uint8)).save(f"{out}/s{n + 1:04d}.jpg", quality=93)
Image.fromarray((m * 255).astype(np.uint8)).save(f"{out}/../mask.png")
print("plate", N, "frames")
