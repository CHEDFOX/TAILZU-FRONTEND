"""Tiny deterministic raster kit for the X0 Bot bold icons.

Everything is drawn at N x N (default 2048) in linear light, in unit coordinates
(x right, y down, the icon is [0,1] x [0,1]), then tone-mapped, box-downsampled to
1024 in linear light, converted to sRGB and dithered with a fixed seed. Same input,
same bytes.

Shapes are signed distance fields (negative inside, unit coordinates) turned into
coverage with an analytic one-pixel edge, so edges are clean at any size. Glow is
real bloom: shape coverage blurred with a Gaussian (FFT, separable) and added as light.
Glass is a height field built from a shape's distance (a rounded bevel), lit by a
small studio environment (a softbox above, a dim floor) with Fresnel.
"""
import numpy as np
from PIL import Image

N = 2048


# ---------------------------------------------------------------- colour

def lin(hex_or_rgb):
    """sRGB hex ('#RRGGBB') or 0..1 tuple -> linear RGB float32 array."""
    if isinstance(hex_or_rgb, str):
        h = hex_or_rgb.lstrip("#")
        c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)
    else:
        c = np.asarray(hex_or_rgb, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def mix(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[..., None]
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- canvas

class Canvas:
    def __init__(self, n=N):
        self.n = n
        t = (np.arange(n, dtype=np.float32) + 0.5) / n
        self.X, self.Y = np.meshgrid(t, t)
        self.px = 1.0 / n
        self.img = np.zeros((n, n, 3), np.float32)

    # coverage from a signed distance field (unit coords)
    def cov(self, d, soft=1.0):
        return np.clip(0.5 - d / (self.px * soft), 0, 1).astype(np.float32)

    def fill(self, color):
        self.img[:] = lin(color) if isinstance(color, str) else color

    def over(self, cov, color, alpha=1.0):
        """Paint colour (hex, linear rgb, or HxWx3 field) over the image with coverage."""
        c = lin(color) if isinstance(color, str) else color
        a = (np.asarray(cov, np.float32) * alpha)[..., None]
        self.img = self.img * (1 - a) + c * a

    def add(self, light, color, gain=1.0):
        """Add light: a coverage/intensity map times a colour."""
        c = lin(color) if isinstance(color, str) else color
        self.img = self.img + (np.asarray(light, np.float32) * gain)[..., None] * c

    def mul(self, m):
        self.img = self.img * (m[..., None] if m.ndim == 2 else m)

    # ---- output
    def finish(self, knee=0.82, seed=7, out=1024):
        x = tonemap(self.img, knee)
        f = self.n // out
        if f > 1:
            x = x.reshape(out, f, out, f, 3).mean(axis=(1, 3))
        s = to_srgb(x) * 255.0
        rng = np.random.default_rng(seed)
        s = s + (rng.random(s.shape, dtype=np.float32) + rng.random(s.shape, dtype=np.float32) - 1.0) * 0.75
        return np.clip(np.round(s), 0, 255).astype(np.uint8)


def tonemap(x, knee=0.82):
    """Identity below the knee, smooth exponential shoulder above it (per channel),
    so hot glow cores roll off to warm white instead of clipping flat."""
    k = knee
    over = np.maximum(x - k, 0)
    return np.where(x < k, x, k + (1 - k) * (1 - np.exp(-over / (1 - k)))).astype(np.float32)


def save_png(rgb_u8, path):
    Image.fromarray(rgb_u8, "RGB").save(path, optimize=True)


# ---------------------------------------------------------------- blur (separable Gaussian via FFT)

def blur(a, sigma, mode="constant"):
    """Gaussian blur; sigma in unit coords (fraction of icon width) of the canvas a belongs to."""
    n = a.shape[0]
    s = sigma * n
    if s < 0.3:
        return a
    pad = int(np.ceil(3.5 * s)) + 2
    out = a.astype(np.float32)
    for axis in (0, 1):
        pw = [(0, 0)] * out.ndim
        pw[axis] = (pad, pad)
        p = np.pad(out, pw, mode=mode)
        m = p.shape[axis]
        F = np.fft.rfft(p, axis=axis)
        f = np.fft.rfftfreq(m)
        g = np.exp(-2.0 * (np.pi * f * s) ** 2).astype(np.float32)
        shp = [1] * out.ndim
        shp[axis] = -1
        p = np.fft.irfft(F * g.reshape(shp), n=m, axis=axis).astype(np.float32)
        sl = [slice(None)] * out.ndim
        sl[axis] = slice(pad, pad + out.shape[axis])
        out = p[tuple(sl)]
    return out


def round_mask(c, radius, n=None):
    """Round the sharp corners of a coverage mask: blur then re-threshold (radius in unit coords)."""
    n = n or c.shape[0]
    b = blur(c, radius * 0.5)
    e = 0.75 / n / max(radius, 1e-6)  # keep a ~1.5 px edge
    return smooth(0.5 - e, 0.5 + e, b).astype(np.float32)


# ---------------------------------------------------------------- signed distance fields (unit coords)

def rot(X, Y, cx, cy, deg):
    a = np.deg2rad(deg)
    x, y = X - cx, Y - cy
    return (x * np.cos(a) + y * np.sin(a)), (-x * np.sin(a) + y * np.cos(a))


def sd_circle(X, Y, cx, cy, r):
    return np.hypot(X - cx, Y - cy) - r


def sd_ellipse(X, Y, cx, cy, a, b, deg=0.0):
    x, y = rot(X, Y, cx, cy, deg) if deg else (X - cx, Y - cy)
    k0 = np.sqrt((x / a) ** 2 + (y / b) ** 2)
    k1 = np.sqrt((x / (a * a)) ** 2 + (y / (b * b)) ** 2) + 1e-9
    return k0 * (k0 - 1.0) / k1


def sd_rbox(X, Y, cx, cy, hw, hh, r, deg=0.0):
    x, y = rot(X, Y, cx, cy, deg) if deg else (X - cx, Y - cy)
    qx, qy = np.abs(x) - hw + r, np.abs(y) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def sd_segment(X, Y, ax, ay, bx, by, r):
    px, py = X - ax, Y - ay
    vx, vy = bx - ax, by - ay
    h = np.clip((px * vx + py * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - vx * h, py - vy * h) - r


def sd_arc(X, Y, cx, cy, R, a0, a1, r):
    """Arc of radius R from angle a0 to a1 (degrees, 0 = +x, 90 = down since y is down), round caps, half-thickness r."""
    x, y = X - cx, Y - cy
    ang = np.rad2deg(np.arctan2(y, x))
    mid = (a0 + a1) / 2
    half = (a1 - a0) / 2
    da = (ang - mid + 180) % 360 - 180
    inside = np.abs(da) <= half
    d_ring = np.abs(np.hypot(x, y) - R) - r
    e0 = (cx + R * np.cos(np.deg2rad(a0)), cy + R * np.sin(np.deg2rad(a0)))
    e1 = (cx + R * np.cos(np.deg2rad(a1)), cy + R * np.sin(np.deg2rad(a1)))
    d_cap = np.minimum(np.hypot(X - e0[0], Y - e0[1]), np.hypot(X - e1[0], Y - e1[1])) - r
    return np.where(inside, d_ring, d_cap)


def normalize_implicit(f, px):
    """Turn an implicit function into an approximate distance by dividing by its gradient."""
    gy, gx = np.gradient(f, px)
    return f / np.maximum(np.hypot(gx, gy), 1e-6)


def sd_superellipse(X, Y, cx, cy, a, b, p, px):
    f = (np.abs((X - cx) / a) ** p + np.abs((Y - cy) / b) ** p) ** (1.0 / p) - 1.0
    return normalize_implicit(f * min(a, b), px)


def sd_star4(X, Y, cx, cy, r, p, deg, px):
    """Four-point twinkle: |u|^p + |v|^p = 1 with p < 1 gives concave sides and long points.
    deg=45 points the tips along the diagonals, so it reads as an X."""
    u, v = rot(X, Y, cx, cy, deg)
    f = (np.abs(u / r) ** p + np.abs(v / r) ** p) ** (1.0 / p) - 1.0
    return normalize_implicit(f * r * 0.35, px)


def sd_poly_mask(cv, pts, ss=4):
    """Rasterise a polygon (list of unit-coord points) into coverage via supersampling."""
    from PIL import ImageDraw
    n = cv.n * ss
    im = Image.new("L", (n, n), 0)
    ImageDraw.Draw(im).polygon([(x * n, y * n) for x, y in pts], fill=255)
    a = np.asarray(im, np.float32) / 255.0
    return a.reshape(cv.n, ss, cv.n, ss).mean(axis=(1, 3))


# ---------------------------------------------------------------- iOS mask (for previews only)

def ios_mask(n, radius=0.2237):
    """Continuous-corner rounded square close to the iOS icon shape (superellipse-ish blend)."""
    t = (np.arange(n, dtype=np.float32) + 0.5) / n
    X, Y = np.meshgrid(t, t)
    d = sd_superellipse(X, Y, 0.5, 0.5, 0.5, 0.5, 5.0, 1.0 / n)
    return np.clip(0.5 - d * n, 0, 1)


# ---------------------------------------------------------------- glass

def bevel_height(d, R):
    """Height field from an inside distance: a quarter-circle bevel of width R, flat beyond."""
    t = np.clip(-d / R, 0, 1)
    return R * np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1))


def normals(h, px):
    gy, gx = np.gradient(h, px)
    nz = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    return -gx * nz, -gy * nz, nz


def studio_env(rx, ry, rz, box=(18, 72, -58, 58), soft=10.0, floor=0.0, side=0.0):
    """Radiance seen along reflection vector r (y down = image down; up is -y).
    A big softbox above-front, an optional dim floor and side strips."""
    elev = np.rad2deg(np.arcsin(np.clip(-ry, -1, 1)))
    azim = np.rad2deg(np.arctan2(rx, rz))
    e0, e1, a0, a1 = box
    sb = smooth(e0 - soft, e0 + soft, elev) * (1 - smooth(e1 - soft, e1 + soft, elev)) \
        * smooth(a0 - soft, a0 + soft, azim) * (1 - smooth(a1 - soft, a1 + soft, azim))
    out = sb.astype(np.float32)
    if floor:
        out = out + floor * smooth(-10, -40, elev)
    if side:
        out = out + side * smooth(55, 80, np.abs(azim)) * (1 - smooth(20, 60, np.abs(elev)))
    return out


def glass_spec(nx, ny, nz, f0=0.04, **env):
    rx, ry, rz = 2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1
    fres = f0 + (1 - f0) * (1 - np.clip(nz, 0, 1)) ** 5
    return studio_env(rx, ry, rz, **env) * fres, fres


def star_points(cx, cy, r_out, r_in, deg=45.0, bulge=0.35, seg=24):
    """Four-point twinkle as a polygon: tips at r_out (along deg, deg+90, ...), waist at r_in,
    edges bowed inward (quadratic curves pulled toward the centre by `bulge`)."""
    pts = []
    for k in range(4):
        a_tip = np.deg2rad(deg + 90 * k)
        a_w = np.deg2rad(deg + 90 * k + 45)
        a_tip2 = np.deg2rad(deg + 90 * (k + 1))
        tip = np.array([cx + r_out * np.cos(a_tip), cy + r_out * np.sin(a_tip)])
        waist = np.array([cx + r_in * np.cos(a_w), cy + r_in * np.sin(a_w)])
        tip2 = np.array([cx + r_out * np.cos(a_tip2), cy + r_out * np.sin(a_tip2)])
        c = np.array([cx, cy])
        for p0, p1 in ((tip, waist), (waist, tip2)):
            ctrl = (p0 + p1) / 2 * (1 - bulge) + c * bulge
            for i in range(seg):
                t = i / seg
                pts.append(tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * ctrl + t * t * p1))
    return pts
