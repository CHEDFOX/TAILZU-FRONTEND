"""X0 Bot: eight quick minimal concepts (pick a direction before any polished render). See README.md.

    python3 concepts.py [name ...] [--n 2048]

Writes <name>/icon-1024.png (RGB, full bleed). Flat two/three-tone shapes with a hint of shading;
drawn with the same raster kit as ../bold (signed distance shapes, analytic edges, fixed dither).
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bold"))
from lib import Canvas, blur, lin, mix, round_mask, save_png, smooth, sd_circle, sd_ellipse, sd_rbox, sd_segment, sd_poly_mask  # noqa: E402

# loud fields
SUN = "#FFC21A"      # sunflower
CORAL = "#FF4F2E"    # electric coral
LIME = "#C6F53B"     # acid lime
COBALT = "#2447FF"   # cobalt
BLACK = "#0E0E0E"
WHITE = "#FFF8EF"


# ---------------------------------------------------------------- helpers

def field(cv, color, lift=0.06):
    """A loud flat field with the faintest light from the top (keeps it from looking dead)."""
    c = lin(color)
    g = 1 + lift * (0.5 - cv.Y) * 2
    cv.img[:] = c * g[..., None]


def paint(cv, d, color, shade=0.07, soft_shadow=0.0):
    """Fill a shape (distance field) in one colour, a touch lighter at its top."""
    c = cv.cov(d)
    if soft_shadow:
        cv.mul(1 - soft_shadow * blur(c, 0.02) * (1 - c))
    y0 = float(np.min(np.where(c > 0.5, cv.Y, 1.0)))
    col = lin(color) * (1 + shade * (1 - smooth(y0, y0 + 0.5, cv.Y)))[..., None]
    cv.over(c, col)
    return c


def lid_eye(cv, cx, cy, w, h, lid=0.25, tilt=0.0, rot=0.0):
    """An eye with attitude: an ellipse whose top is cut by a straight lid.
    lid: how much of the height the lid covers (0 = open, 0.5 = half shut); tilt (deg): the lid's slant."""
    X, Y = cv.X, cv.Y
    e = sd_ellipse(X, Y, cx, cy, w / 2, h / 2, rot)
    a = np.deg2rad(tilt)
    ly = cy - h / 2 + lid * h
    d_lid = ((ly + np.tan(a) * (X - cx)) - Y) * np.cos(a)
    return round_mask(cv.cov(np.maximum(e, d_lid)), 0.01)


def pupil_eye(cv, cx, cy, w, h, px, py, pr, lid=0.3, tilt=0.0):
    """A white eye (with a lid) and its pupil; returns (white, pupil) coverage."""
    white = lid_eye(cv, cx, cy, w, h, lid, tilt)
    pupil = cv.cov(sd_circle(cv.X, cv.Y, px, py, pr)) * white
    return white, pupil


def head_box(cv, x0, y0, x1, y1, r, deg=0.0):
    """Our bot's head: a rounded box (not a blob)."""
    return sd_rbox(cv.X, cv.Y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, r, deg)


# ---------------------------------------------------------------- 1. Kilroy peek

def kilroy(cv):
    """The universal 'peeking over a wall': head, fingers and wall are ONE black shape; the eyes
    are two sly slits of the field showing through."""
    field(cv, SUN)
    X, Y = cv.X, cv.Y
    wall = 0.70
    d = wall - Y                                                    # the wall: everything below the line
    d = np.minimum(d, head_box(cv, 0.24, 0.30, 0.76, 0.90, 0.21))  # the head rising over it
    for s in (-1, 1):                                               # three fingertips each side
        for k in range(3):
            fx = 0.5 + s * (0.305 + 0.056 * k)
            d = np.minimum(d, sd_rbox(X, Y, fx, wall - 0.014, 0.025, 0.045, 0.025))
    paint(cv, d, BLACK, shade=0.0)
    # eyes: negative slits, lids heavy and slanted, both glancing left
    for cx in (0.40, 0.60):
        m = lid_eye(cv, cx - 0.012, 0.545, 0.115, 0.10, lid=0.45, tilt=-9)
        cv.over(m, lin(SUN))


# ---------------------------------------------------------------- 2. Sly square

def sly_square(cv):
    """A huge box head cropped off the bottom right; two narrowed eyes sliding left."""
    field(cv, CORAL)
    d = head_box(cv, 0.17, 0.25, 1.25, 1.3, 0.25)
    paint(cv, d, WHITE, soft_shadow=0.25)
    for cx, lid in ((0.40, 0.42), (0.67, 0.55)):          # one eye a little more shut: sly, not sleepy
        m = lid_eye(cv, cx, 0.57, 0.16, 0.15, lid=lid, tilt=-18, rot=-6)
        cv.over(m, lin(BLACK))


# ---------------------------------------------------------------- 3. The visor alone

def visor_alone(cv):
    """One black glass band tilted across acid lime; two bright determined eyes inside."""
    field(cv, LIME)
    X, Y = cv.X, cv.Y
    deg = -10
    d = sd_rbox(X, Y, 0.5, 0.52, 0.47, 0.155, 0.155, deg)
    c = paint(cv, d, BLACK, shade=0.12, soft_shadow=0.3)
    # a single glass glint along the top of the band
    a = np.deg2rad(deg)
    u = (X - 0.5) * np.cos(a) + (Y - 0.52) * np.sin(a)
    v = -(X - 0.5) * np.sin(a) + (Y - 0.52) * np.cos(a)
    glint = np.clip(0.5 - (np.abs(v + 0.112) - 0.006) / cv.px, 0, 1) * smooth(0.33, 0.25, np.abs(u + 0.08))
    cv.add(glint * c, "#FFFFFF", 0.22)
    # determined eyes: rounded slabs with the inner top corners pulled down
    for s in (-1, 1):
        cx, cy = 0.5 + s * 0.17, 0.52 - s * 0.17 * np.tan(a) * -1
        m = lid_eye(cv, cx, cy + 0.01, 0.15, 0.14, lid=0.3, tilt=-s * 16 + deg, rot=deg)
        cv.over(m, lin("#FFFFFF"))
        cv.add(blur(m, 0.01), LIME, 0.25)


# ---------------------------------------------------------------- 4. Half-peek

def half_peek(cv):
    """Only the top of the head clears the bottom edge; eyes just over it, sliding right."""
    field(cv, COBALT)
    d = head_box(cv, 0.08, 0.53, 0.92, 1.5, 0.3)
    paint(cv, d, BLACK, shade=0.0)
    for cx in (0.36, 0.64):
        w, p = pupil_eye(cv, cx, 0.80, 0.19, 0.17, cx + 0.045, 0.815, 0.05, lid=0.36, tilt=4)
        cv.over(w, lin(WHITE))
        cv.over(p, lin(BLACK))


# ---------------------------------------------------------------- 5. X0 attitude

def x0_attitude(cv):
    """The name in the face: one eye squeezed into an X (a cheeky wink), the other a wide 0."""
    field(cv, BLACK, lift=0.0)
    X, Y = cv.X, cv.Y
    deg = 8
    d = head_box(cv, 0.12, 0.22, 1.2, 1.3, 0.26, deg)
    paint(cv, d, CORAL, soft_shadow=0.0)
    # X: two thick strokes, wider than tall (a squeeze, not a cross-out)
    cx, cy = 0.38, 0.57
    for s in (-1, 1):                                        # a squeezed-shut wink: two wide, flat strokes
        dd = sd_segment(X, Y, cx - 0.085, cy - s * 0.04, cx + 0.085, cy + s * 0.04, 0.026)
        cv.over(cv.cov(dd), lin(BLACK))
    # 0: a tall bold ring
    o = np.abs(sd_ellipse(X, Y, 0.70, 0.535, 0.075, 0.098)) - 0.027
    cv.over(cv.cov(o), lin(BLACK))


# ---------------------------------------------------------------- 6. Antenna as signature

def bolt_antenna(cv):
    """A plain box head; its one signature: an antenna that is a lightning zag."""
    field(cv, WHITE, lift=0.0)
    X, Y = cv.X, cv.Y
    d = head_box(cv, 0.14, 0.42, 0.86, 1.3, 0.24)
    bolt = [(0.555, 0.445), (0.505, 0.30), (0.585, 0.30), (0.53, 0.12), (0.70, 0.33), (0.615, 0.33), (0.66, 0.445)]
    paint(cv, d, COBALT, shade=0.06)
    b = round_mask(sd_poly_mask(cv, bolt), 0.006)
    cv.over(b, lin(COBALT))
    for cx in (0.37, 0.63):                                  # eyes rolled up toward the bolt
        w, p = pupil_eye(cv, cx, 0.66, 0.16, 0.15, cx + 0.03, 0.625, 0.045, lid=0.22, tilt=-10)
        cv.over(w, lin(WHITE))
        cv.over(p, lin(BLACK))


# ---------------------------------------------------------------- 7. Two-tone

def two_tone(cv):
    """Pure black and white: a black box head bleeding off the bottom left, two white eyes cut out
    of it, one narrower (a smirk in the eyes)."""
    field(cv, WHITE, lift=0.0)
    d = head_box(cv, -0.25, 0.2, 0.84, 1.35, 0.27, -9)
    paint(cv, d, BLACK, shade=0.0)
    m1 = lid_eye(cv, 0.36, 0.58, 0.13, 0.17, lid=0.18, tilt=-14, rot=-9)
    m2 = lid_eye(cv, 0.62, 0.53, 0.13, 0.17, lid=0.42, tilt=-14, rot=-9)
    cv.over(np.maximum(m1, m2), lin(WHITE))


# ---------------------------------------------------------------- 8. One eye round the corner (own idea)

def corner_eye(cv):
    """Peek-a-boo at its purest: a huge head slides in from the right edge and only ONE eye has
    cleared the corner. One shape, one mark, total curiosity."""
    field(cv, COBALT)
    d = head_box(cv, 0.42, 0.16, 1.45, 1.4, 0.3, 6)
    paint(cv, d, SUN, shade=0.06, soft_shadow=0.25)
    w, p = pupil_eye(cv, 0.64, 0.50, 0.25, 0.25, 0.585, 0.49, 0.072, lid=0.3, tilt=-8)
    cv.over(w, lin(WHITE))
    cv.over(p, lin(BLACK))


CONCEPTS = {
    "1-kilroy": kilroy,
    "2-sly-square": sly_square,
    "3-visor": visor_alone,
    "4-half-peek": half_peek,
    "5-x0-attitude": x0_attitude,
    "6-bolt-antenna": bolt_antenna,
    "7-two-tone": two_tone,
    "8-corner-eye": corner_eye,
}


def main(argv):
    n = 2048
    names = []
    i = 0
    while i < len(argv):
        if argv[i] == "--n":
            n = int(argv[i + 1]); i += 2
        else:
            names.append(argv[i]); i += 1
    for name in names or CONCEPTS:
        cv = Canvas(n)
        CONCEPTS[name](cv)
        d = os.path.join(HERE, name)
        os.makedirs(d, exist_ok=True)
        save_png(cv.finish(out=n // 2), os.path.join(d, "icon-1024.png"))
        print(name)


if __name__ == "__main__":
    main(sys.argv[1:])
