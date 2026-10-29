"""X0 Bot, Half-peek upside down: flat takes. See README.md.

    python3 flat.py [name ...] [--n 2048]

The black box head hangs into a white tile from the top edge; two white eyes with dark pupils look
down at you. Writes <name>/icon-1024.png (RGB, full bleed). Uses the raster kit in ../bold/lib.py.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bold"))
from lib import Canvas, blur, lin, rot, save_png, smooth, sd_arc, sd_circle, sd_ellipse, sd_rbox, sd_segment  # noqa: E402

INK = "#111111"
WHITE_TOP, WHITE_BOTTOM = "#FFFFFF", "#ECEAE6"   # a true white, a breath of grey at the bottom so the tile holds on light walls


def ground(cv):
    cv.img[:] = mix_rows(cv, WHITE_TOP, WHITE_BOTTOM)


def mix_rows(cv, a, b):
    t = smooth(0.35, 1.0, cv.Y)[..., None]
    return lin(a) * (1 - t) + lin(b) * t


PIVOT = (0.5, 0.0)   # the head tilts about the middle of the top edge


def turn(x, y, deg, pivot=PIVOT):
    """Where a point of the untilted drawing lands once the head is tilted by deg."""
    a = np.deg2rad(deg)
    dx, dy = x - pivot[0], y - pivot[1]
    return pivot[0] + dx * np.cos(a) - dy * np.sin(a), pivot[1] + dx * np.sin(a) + dy * np.cos(a)


def head(cv, rim=0.47, x0=0.08, x1=0.92, r=0.3, deg=0.0, pivot=PIVOT):
    """The box head hanging in from the top edge; its lowest point is at `rim`."""
    X, Y = cv.X, cv.Y
    if deg:
        X, Y = rot(X, Y, pivot[0], pivot[1], deg)
        X, Y = X + pivot[0], Y + pivot[1]
    return sd_rbox(X, Y, (x0 + x1) / 2, rim - 0.6, (x1 - x0) / 2, 0.6, r)


def drop_shadow(cv, d, dy=0.028, sigma=0.032, k=0.2):
    """A soft shadow under the head, so it reads as an object, not a cut-out."""
    c = cv.cov(d)
    n = cv.n
    s = int(round(dy * n))
    shifted = np.zeros_like(c)
    shifted[s:] = c[:-s]
    cv.mul(1 - k * blur(shifted, sigma) * (1 - c))
    return c


def eye(cv, cx, cy, w, h, px, py, pr):
    """A wide white eye (lids lifted) and its pupil."""
    white = cv.cov(sd_ellipse(cv.X, cv.Y, cx, cy, w / 2, h / 2))
    pupil = cv.cov(sd_circle(cv.X, cv.Y, px, py, pr)) * white
    cv.over(white, lin("#FFFFFF"))
    cv.over(pupil, lin(INK))


def take(cv, rim=0.47, eyes_y=0.335, look=(0.0, 1.0), gaze=0.042, tilt=0.0, brow=False, antenna=False, small=0.17, big=0.198):
    ground(cv)
    d = head(cv, rim=rim, deg=tilt)
    if antenna:   # a short stub pointing down from the crown (the head hangs upside down)
        ax, ay = 0.5 + 0.13, rim - 0.02                                   # (antenna is only used untilted)
        d = np.minimum(d, sd_segment(cv.X, cv.Y, ax, ay, ax + 0.03, ay + 0.085, 0.026))
    c = drop_shadow(cv, d)
    cv.over(c, lin(INK))
    # eyes: the left a touch smaller; pupils look along `look` (down toward the middle of the tile by default)
    lx, ly = look
    n = np.hypot(lx, ly) or 1
    lx, ly = lx / n, ly / n
    for cx, size, inward in ((0.355, small, 1), (0.645, big, -1)):
        ex, ey = turn(cx, eyes_y, tilt)                                   # eye centres move with the tilted head
        gx = lx * gaze + (0.012 * inward if look == (0.0, 1.0) else 0.0)  # looking straight down: converge a touch
        eye(cv, ex, ey, size, size * 1.06, ex + gx, ey + ly * gaze, size * 0.27)
    if brow:      # a little raised brow tick over the bigger eye
        bx, by = 0.645 + 0.01, eyes_y - big * 0.53 - 0.045
        m = cv.cov(sd_arc(cv.X, cv.Y, bx, by + 0.11, 0.11, 242, 300, 0.012))
        cv.over(m, lin("#FFFFFF"))


TAKES = {
    "flat-1-drop": lambda cv: take(cv),                                                    # flipped: eyes by the rim, looking down at you
    "flat-2-upright": lambda cv: take(cv, rim=0.5, eyes_y=0.25),                           # right way up, hanging: eyes higher, chin below
    "flat-3-sideways": lambda cv: take(cv, look=(-0.75, 0.66), gaze=0.046, brow=True),     # glance down and to the side, one brow up
    "flat-4-tilt": lambda cv: take(cv, tilt=8, look=(0.2, 1.0)),                          # the head cocked, curious
    "flat-5-antenna": lambda cv: take(cv, antenna=True),                                   # flipped, with a stub of antenna pointing down
}


def main(argv):
    n, names, i = 2048, [], 0
    while i < len(argv):
        if argv[i] == "--n":
            n = int(argv[i + 1]); i += 2
        else:
            names.append(argv[i]); i += 1
    for name in names or TAKES:
        cv = Canvas(n)
        TAKES[name](cv)
        d = os.path.join(HERE, name)
        os.makedirs(d, exist_ok=True)
        save_png(cv.finish(out=n // 2), os.path.join(d, "icon-1024.png"))
        print(name)


if __name__ == "__main__":
    main(sys.argv[1:])
