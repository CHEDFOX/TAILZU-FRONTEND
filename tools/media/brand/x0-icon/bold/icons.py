"""X0 Bot bold icon directions. See README.md.

    python3 icons.py [variant ...] [--n 2048] [--out DIR]

Writes DIR/<variant>/icon-1024.png (RGB, no alpha, full bleed). --n is the working
resolution (the output is half of it: 2048 -> 1024; 1024 -> 512 for quick previews).
"""
import os
import sys
import time

import numpy as np

from lib import (Canvas, blur, glass_spec, lin, mix, normals, bevel_height, round_mask, save_png, smooth,
                 sd_arc, sd_circle, sd_ellipse, sd_rbox, sd_segment, sd_poly_mask, star_points)

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- palette (evolved)
OBSIDIAN_TOP = "#1B1714"   # glass where the light falls on it
OBSIDIAN = "#0A0908"       # glass body
OBSIDIAN_DEEP = "#030303"
EMBER_CORE = "#FFF7EA"     # the hot centre of an eye
EMBER_RIM = "#FFC98A"      # the edge of an eye
EMBER = "#FFB765"          # amber bloom
EMBER_HALO = "#FF6B2C"     # outer halo, warms the glass
CREAM = "#FBF0DE"
CREAM_2 = "#F3E2C6"
CLAY = "#C9683F"
CLAY_HI = "#DB7A47"
CLAY_LO = "#AE4D28"


# ---------------------------------------------------------------- light

def ember(cv, cov, power=1.0, halo=1.0, core=EMBER_CORE, rim=EMBER_RIM, mid=EMBER, outer=EMBER_HALO, hot=0.35, depth=0.010):
    """A glowing shape: emissive body running from amber at its edge to a hot white middle,
    then four bloom layers (tight amber to wide ember) that light the surface around it."""
    inner = np.clip(blur(cov, depth) * 1.6 - 0.45, 0, 1) * cov
    body = mix(lin(rim) * 0.95, lin(core) * (1.0 + hot), inner)
    cv.over(cov, body * power)
    cv.add(blur(cov, 0.004), mid, 0.40 * power)
    cv.add(blur(cov, 0.018), mid, 0.55 * power * halo)
    cv.add(blur(cov, 0.055), outer, 0.42 * power * halo)
    cv.add(blur(cov, 0.16), outer, 0.20 * power * halo)


# ---------------------------------------------------------------- glass

def obsidian(cv, top=OBSIDIAN_TOP, body=OBSIDIAN, deep=OBSIDIAN_DEEP, vignette=0.4):
    """Full-bleed dark glass: light falls on the top of the dome, the bottom and corners sink away."""
    X, Y = cv.X, cv.Y
    g = mix(lin(top), lin(body), smooth(0.0, 0.6, Y))
    g = mix(g, lin(deep), smooth(0.6, 1.02, Y) * 0.85)
    r = np.hypot(X - 0.5, (Y - 0.45) * 1.05)
    cv.img[:] = g * (1 - vignette * smooth(0.30, 0.76, r))[..., None]


def dome_reflection(cv, y0=0.255, k=0.62, top=0.035, fade=(0.10, 0.30), gain=0.06, crisp=1.0, sheen=0.025, color="#FFF1E2"):
    """What makes black read as glass: a softbox reflected in a domed visor. Its lower edge is
    crisp and bows up toward the sides (as on a real dome); it fades toward the top and the sides.
    Plus a broad faint sheen where light falls on the top of the dome."""
    X, Y = cv.X, cv.Y
    edge = y0 - k * (X - 0.5) ** 2              # crisp lower edge of the reflection
    inside = np.clip(0.5 - (Y - edge) / (cv.px * 1.2 * crisp), 0, 1)
    upper = smooth(top - 0.03, top + 0.07, Y + 0.6 * (X - 0.5) ** 2)    # soft top edge, also curved
    sides = smooth(fade[0], fade[1], X) * smooth(1 - fade[0], 1 - fade[1], X)
    lift = 0.55 + 0.45 * smooth(edge - 0.16, edge, Y)                   # a touch brighter toward its crisp edge
    cv.add(inside * upper * sides * lift, color, gain)
    s = np.exp(-((X - 0.5) / 0.45) ** 2) * smooth(0.62, 0.0, Y) ** 2
    cv.add(s, "#FFE6CC", sheen)


def glass_shape(cv, d, R=0.05, top=OBSIDIAN_TOP, body=OBSIDIAN, shadow=0.35, spec_gain=2.4, box=(22, 75, -45, 45), floor=0.15):
    """An obsidian glass object on a field, from its distance field: contact shadow on the field,
    a body lit from above, bevel rims that reflect a softbox."""
    X, Y = cv.X, cv.Y
    c = cv.cov(d)
    if shadow:
        sh = blur(c, 0.03)
        cv.mul(1 - shadow * sh * (1 - c))
    y0 = float(np.min(np.where(c > 0.5, Y, 1.0)))
    body_col = mix(lin(top), lin(body), smooth(y0, y0 + 0.35, Y))
    cv.over(c, body_col)
    h = bevel_height(d, R)
    nx, ny, nz = normals(h, cv.px)
    spec, fres = glass_spec(nx, ny, nz, f0=0.04, box=box, soft=8.0, floor=floor)
    cv.add(spec * c, "#FFF3E6", spec_gain)
    return c


def field(cv, top, bottom, glow_at=(0.5, 0.2), glow=0.0, glow_col="#FFD7B0"):
    X, Y = cv.X, cv.Y
    cv.img[:] = mix(lin(top), lin(bottom), smooth(0.0, 1.0, Y))
    if glow:
        r = np.hypot(X - glow_at[0], Y - glow_at[1])
        cv.add(np.exp(-(r / 0.5) ** 2), glow_col, glow)


# ---------------------------------------------------------------- eye shapes (coverage masks)

def eye_arc(cv, cx, cy, R=0.10, t=0.042, a0=200, a1=340):
    """Content arc (a closed, smiling eye). cy is the arc's visual middle."""
    return cv.cov(sd_arc(cv.X, cv.Y, cx, cy + R * 0.62, R, a0, a1, t))


def eye_smile(cv, cx, cy, w=0.24, h=0.16, cut=0.125, tilt=0.0, inner=1.5, round_r=0.012):
    """Filled happy eye: an ellipse with its lower part bitten out by a wider, lower ellipse."""
    X, Y = cv.X, cv.Y
    a = sd_ellipse(X, Y, cx, cy, w / 2, h, tilt)
    b = sd_ellipse(X, Y, cx, cy + cut, w / 2 * inner, h * 0.98, tilt)
    return round_mask(cv.cov(np.maximum(a, -b)), round_r)


def eye_pill(cv, cx, cy, w=0.15, h=0.25, tilt=0.0):
    return cv.cov(sd_rbox(cv.X, cv.Y, cx, cy, w / 2, h / 2, w / 2, tilt))


def eye_twinkle(cv, cx, cy, r_out=0.155, r_in=0.036, deg=45, bulge=0.22, round_r=0.006):
    return round_mask(sd_poly_mask(cv, star_points(cx, cy, r_out, r_in, deg, bulge)), round_r)


def eye_ring(cv, cx, cy, a=0.096, b=0.116, t=0.048):
    return cv.cov(np.abs(sd_ellipse(cv.X, cv.Y, cx, cy, a, b)) - t / 2)


# ---------------------------------------------------------------- A. the face is the icon

def visor_light(cv, sheen=0.03, rim=0.0, bounce=0.0, band=0.0):
    """Modern glass cues for the full-bleed visor, no slab: a soft pool of light on the top of the
    dome, a thin crisp highlight hugging the top edge (kept well inside the iOS mask), and warm
    light from the eyes bouncing off the lower curve of the glass."""
    X, Y = cv.X, cv.Y
    s = np.exp(-((X - 0.5) / 0.38) ** 2) * np.exp(-((Y - 0.0) / 0.30) ** 2)
    cv.add(s, "#FFE6CC", sheen)
    if rim:
        yc = 0.028 + 0.55 * (X - 0.5) ** 4 * 16            # follows the flat top, lifts toward the corners
        line = np.exp(-((Y - yc) / 0.0045) ** 2) * smooth(0.13, 0.32, X) * smooth(0.87, 0.68, X)
        cv.add(line, "#FFF1E2", rim)
    if bounce:
        b = np.exp(-((X - 0.5) / 0.30) ** 2) * np.exp(-((Y - 1.0) / 0.10) ** 2)
        cv.add(b, EMBER_HALO, bounce)
    if band:
        dome_reflection(cv, y0=0.17, k=0.8, top=0.05, gain=band, fade=(0.1, 0.36), sheen=0.0)


def a_visor(cv, eyes="wink", gap=0.21, ey=0.475, size=1.1, glass=("#131010", "#080707", "#030303"),
             core="#FFF0DA", hot=0.18, depth=0.028, halo=0.75, wink_at=None, **light):
    obsidian(cv, top=glass[0], body=glass[1], deep=glass[2], vignette=0.3)
    if eyes == "wink":
        lx, rx = wink_at or (0.5 - gap, 0.5 + gap)     # the arc is wider than the pill: place them by eye
        L = eye_arc(cv, lx, ey + 0.012, 0.112 * size, 0.047 * size)
        R = eye_pill(cv, rx, ey, 0.16 * size, 0.275 * size)
    elif eyes == "arc":
        L, R = eye_arc(cv, 0.5 - gap, ey, 0.112 * size, 0.047 * size), eye_arc(cv, 0.5 + gap, ey, 0.112 * size, 0.047 * size)
    elif eyes == "smile":
        L = eye_smile(cv, 0.5 - gap, ey + 0.02, 0.25 * size, 0.165 * size, 0.125 * size, -4, inner=1.25)
        R = eye_smile(cv, 0.5 + gap, ey + 0.02, 0.25 * size, 0.165 * size, 0.125 * size, 4, inner=1.25)
    ember(cv, np.maximum(L, R), core=core, hot=hot, depth=depth, halo=halo)
    visor_light(cv, **light)


# ---------------------------------------------------------------- B. the name is the face

def b_x0(cv, gap=0.21, ey=0.475, size=1.08):
    obsidian(cv, top="#131010", body="#080707", deep="#030303", vignette=0.3)
    S = eye_twinkle(cv, 0.5 - gap, ey, r_out=0.16 * size, r_in=0.036 * size, bulge=0.22)
    O = eye_ring(cv, 0.5 + gap, ey, 0.10 * size, 0.122 * size, 0.05 * size)
    ember(cv, np.maximum(S, O), core="#FFF0DA", hot=0.18, depth=0.02, halo=0.75)
    visor_light(cv)


# ---------------------------------------------------------------- C. over the edge

def c_edge(cv, sky=("#24150F", "#120B08"), ground=("#0C0806", "#050303"), line_y=0.615, line_t=0.036,
           eye_y=0.52, gap=0.115, eye=(0.098, 0.15), hands=0.255, tip=0.046, line_col=CREAM_2, finger_col=CREAM):
    """Only the peek: two lit eyes and four fingertips over one bold horizon, everything else dark."""
    X, Y = cv.X, cv.Y
    cv.img[:] = mix(lin(sky[0]), lin(sky[1]), smooth(0.0, line_y, Y))
    r = np.hypot(X - 0.5, Y - eye_y)
    cv.add(np.exp(-(r / 0.35) ** 2) * cv.cov(Y - line_y), EMBER_HALO, 0.05)
    cv.over(cv.cov(line_y - Y), mix(lin(ground[0]), lin(ground[1]), smooth(line_y, 1.0, Y)))
    L, R = eye_pill(cv, 0.5 - gap, eye_y, *eye), eye_pill(cv, 0.5 + gap, eye_y, *eye)
    ember(cv, np.maximum(L, R), core="#FFF0DA", hot=0.18, depth=0.02, halo=0.8)
    cv.over(cv.cov(np.abs(Y - line_y) - line_t / 2), line_col)
    for s in (-1, 1):                       # two fingertips per hand, hooked over the line
        for dx in (-tip * 0.62, tip * 0.62):
            fx = 0.5 + s * hands + dx
            d = sd_rbox(X, Y, fx, line_y - tip * 0.42, tip / 2, tip * 0.62, tip / 2)
            cv.over(cv.cov(d), finger_col)


# ---------------------------------------------------------------- D. players (noughts and crosses)

def d_players(cv, bg=("#FBF1E1", "#EEDDC0"), grid="#1A1612", xcol=CLAY):
    """One crossing of the noughts-and-crosses grid: a clay X, and a 0 that is the bot's visor, awake."""
    X, Y = cv.X, cv.Y
    field(cv, *bg)
    gx, gy, t = 0.415, 0.415, 0.05
    cv.over(cv.cov(sd_segment(X, Y, gx, -0.3, gx, 1.3, t / 2)), grid)
    cv.over(cv.cov(sd_segment(X, Y, -0.3, gy, 1.3, gy, t / 2)), grid)
    cx, cy, a, w = 0.226, 0.226, 0.086, 0.062
    for s in (-1, 1):
        cv.over(cv.cov(sd_segment(X, Y, cx - a, cy - s * a, cx + a, cy + s * a, w / 2)), xcol)
    ox, oy = 0.685, 0.685
    glass_shape(cv, sd_ellipse(X, Y, ox, oy, 0.19, 0.205), R=0.055, shadow=0.25)
    m = np.maximum(eye_arc(cv, ox - 0.072, oy - 0.005, 0.048, 0.019), eye_pill(cv, ox + 0.072, oy - 0.01, 0.06, 0.104))
    ember(cv, m, core="#FFF0DA", hot=0.18, depth=0.015, halo=0.7)


# ---------------------------------------------------------------- E1. rise: the visor rising over the bottom edge

def e_rise(cv, bg=(CLAY_HI, CLAY_LO), top_y=0.33, half_w=0.40, eyes="smile"):
    X, Y = cv.X, cv.Y
    field(cv, *bg, glow=0.07)
    cx, cy = 0.5, top_y + half_w * 0.9
    d_top = sd_ellipse(X, Y, cx, cy, half_w, half_w * 0.9)
    d_side = sd_rbox(X, Y, cx, (cy + 1.3) / 2, half_w, (1.3 - cy) / 2, 0.0)
    glass_shape(cv, np.minimum(d_top, d_side), R=0.07)
    ey = cy - 0.03
    if eyes == "smile":
        m = np.maximum(eye_smile(cv, cx - 0.15, ey, 0.19, 0.125, 0.10, -4), eye_smile(cv, cx + 0.15, ey, 0.19, 0.125, 0.10, 4))
    else:
        m = np.maximum(eye_pill(cv, cx - 0.14, ey, 0.11, 0.18), eye_pill(cv, cx + 0.14, ey, 0.11, 0.18))
    ember(cv, m)


# ---------------------------------------------------------------- E2. diamond ring: the 0 in light, the X where it peeks out

def e_diamond(cv, R=0.272, t=0.036, at=225, c=(0.525, 0.525), face=None, face_power=0.5, burst=0.225,
              sky=("#150E0B", "#050404"), rays=0.10, falloff=62, moon_glass=0.0, ring_far=0.42, eye_gap=0.098):
    """A total eclipse at the instant the light peeks out: the ring of light is the 0, the
    four-point burst where it breaks through is the X. face: None, "smile", "arc" or "open":
    the bot's eyes on the dark moon (dimmed so the mark still wins at small sizes)."""
    X, Y = cv.X, cv.Y
    cx, cy = c
    cv.img[:] = mix(lin(sky[0]), lin(sky[1]), smooth(0.0, 1.0, Y))
    r = np.hypot(X - cx, Y - cy)
    ang = np.rad2deg(np.arctan2(Y - cy, X - cx))
    da = np.abs((ang - at + 180) % 360 - 180)                 # angular distance from the burst
    near = np.exp(-(da / falloff) ** 2)
    outside = smooth(R - 0.004, R + 0.004, r)
    # corona: soft light outside the disc, stronger toward the burst, with faint streamers
    k = np.maximum(r - R, 0)
    streak = 1 + rays * np.sin(np.deg2rad(ang) * 9 + 0.7) * np.sin(np.deg2rad(ang) * 5 + 2.1)
    cv.add(np.exp(-k / 0.09) * outside * (0.28 + 0.72 * near) * streak, EMBER_HALO, 0.40)
    cv.add(np.exp(-k / 0.028) * outside * (0.40 + 0.60 * near), EMBER, 0.50)
    # the ring: light hugging the limb of the moon; thick and white-hot by the burst, a thinner
    # amber line on the far side (light falls off away from where it breaks through)
    thick = t * (ring_far + (1 - ring_far) * near)
    band = np.clip(0.5 - (np.abs(r - (R + thick * 0.5)) - thick * 0.5) / cv.px, 0, 1)
    limb = np.exp(-np.maximum(r - R, 0) / np.maximum(thick, 1e-4) * 0.9)      # brightest at the limb
    level = (0.70 + 0.45 * near) * (0.75 + 0.25 * limb)
    body = mix(lin("#FFC27E"), lin("#FFF4E4") * 1.25, smooth(0.0, 0.8, near) * 0.6 + 0.4 * limb)
    cv.over(band, body * level[..., None])
    lit = band * (0.55 + 0.75 * near)
    cv.add(blur(lit, 0.004), EMBER, 0.45)
    cv.add(blur(lit, 0.016), EMBER, 0.50)
    cv.add(blur(lit, 0.05), EMBER_HALO, 0.32)
    # the moon: black glass with a faint lit rim, brightest by the burst
    disc = cv.cov(r - R)
    cv.over(disc, mix(lin("#100C0A"), lin("#020202"), smooth(cy - R, cy + R * 0.6, Y)))
    cv.add(disc * np.exp(-np.maximum(R - r, 0) / 0.008) * (0.25 + 0.75 * near), "#FFB27A", 0.12)
    if moon_glass:
        # a soft reflection across the moon's upper half: the visor's glass
        e_edge = cy - R * 0.30 - 1.6 * (X - cx) ** 2
        m = np.clip(0.5 - (Y - e_edge) / (cv.px * 1.5), 0, 1) * disc * smooth(cy - R, cy - R + 0.10, Y)
        m = m * smooth(cx - R * 0.95, cx - R * 0.45, X) * smooth(cx + R * 0.95, cx + R * 0.45, X)
        cv.add(m * (0.5 + 0.5 * smooth(e_edge - 0.12, e_edge, Y)), "#FFE8D2", moon_glass)
    if face:
        ey, g = cy + 0.005, eye_gap
        if face == "smile":
            m = np.maximum(eye_smile(cv, cx - g, ey, 0.13, 0.088, 0.072, -4, inner=1.25, round_r=0.008),
                           eye_smile(cv, cx + g, ey, 0.13, 0.088, 0.072, 4, inner=1.25, round_r=0.008))
        elif face == "open":
            m = np.maximum(eye_pill(cv, cx - g * 0.9, ey, 0.068, 0.112), eye_pill(cv, cx + g * 0.9, ey, 0.068, 0.112))
        else:
            m = np.maximum(eye_arc(cv, cx - g, ey, 0.062, 0.024), eye_arc(cv, cx + g, ey, 0.062, 0.024))
        ember(cv, m, power=face_power, halo=0.7)
    # the burst: a four-point star on the ring, with a hot core
    bx, by = cx + (R + t * 0.40) * np.cos(np.deg2rad(at)), cy + (R + t * 0.40) * np.sin(np.deg2rad(at))
    S = eye_twinkle(cv, bx, by, r_out=burst, r_in=0.019, deg=45, bulge=0.33, round_r=0.004)
    S = S * (0.55 + 0.45 * np.exp(-((X - bx) ** 2 + (Y - by) ** 2) / (2 * 0.10 ** 2)))   # light fades along the spikes
    cv.add(blur(S, 0.035), EMBER, 0.7)
    ember(cv, S, power=1.1, halo=1.1, hot=0.6, depth=0.006)
    cv.add(np.exp(-((X - bx) ** 2 + (Y - by) ** 2) / (2 * 0.028 ** 2)), EMBER_CORE, 1.0)
    cv.add(np.exp(-((X - bx) ** 2 + (Y - by) ** 2) / (2 * 0.09 ** 2)), EMBER, 0.25)


# ---------------------------------------------------------------- E3. the 0 is the head

def e_zero(cv, bg=(CLAY_HI, CLAY_LO)):
    X, Y = cv.X, cv.Y
    field(cv, *bg, glow=0.07)
    cx, cy, a, b, t = 0.5, 0.5, 0.30, 0.36, 0.085
    outer = sd_ellipse(X, Y, cx, cy, a, b)
    inner = sd_ellipse(X, Y, cx, cy, a - t, b - t)
    c = cv.cov(outer)
    cv.mul(1 - 0.3 * blur(c, 0.03) * (1 - c))
    cv.over(c, mix(lin(CREAM), lin(CREAM_2), smooth(0.2, 0.85, Y)))
    glass_shape(cv, inner, R=0.045, shadow=0.0)
    m = np.maximum(eye_smile(cv, cx - 0.095, cy - 0.01, 0.14, 0.10, 0.08, -4), eye_smile(cv, cx + 0.095, cy - 0.01, 0.14, 0.10, 0.08, 4))
    ember(cv, m, halo=0.8)


# ---------------------------------------------------------------- registry

VARIANTS = {
    # ---- final picks (see README.md)
    "a-visor": lambda cv: a_visor(cv, "wink", size=1.2, wink_at=(0.318, 0.742)),
    "b-x0-eyes": lambda cv: b_x0(cv),
    "c-over-the-edge": lambda cv: c_edge(cv),
    "d-players": lambda cv: d_players(cv),
    "e-diamond-ring": lambda cv: e_diamond(cv),
    "e-diamond-ring-face": lambda cv: e_diamond(cv, face="arc", face_power=0.55),
    # ---- explorations that lost (kept so the reasoning can be re-seen)
    "x-visor-arcs": lambda cv: a_visor(cv, "arc"),                         # calm, but reads as "^^" emoji
    "x-visor-smile": lambda cv: a_visor(cv, "smile"),                      # filled happy eyes: pointed, a bit sinister small
    "x-visor-glossy": lambda cv: a_visor(cv, "wink", band=0.04),           # visor reflection band: reads as a 2012 helmet
    "x-diamond-moon-glass": lambda cv: e_diamond(cv, moon_glass=0.035),   # reflection on the moon muddies the black
    "x-diamond-open-eyes": lambda cv: e_diamond(cv, face="open", face_power=0.6),  # blank stare
    "x-rise": lambda cv: e_rise(cv),                                       # visor rising over the bottom edge: a ghost
    "x-zero-head": lambda cv: e_zero(cv),                                  # the 0 as the head shell: a vanity mirror
}


FINAL = ["a-visor", "b-x0-eyes", "c-over-the-edge", "d-players", "e-diamond-ring", "e-diamond-ring-face"]


def main(argv):
    n = 2048
    out = HERE
    names = []
    i = 0
    while i < len(argv):
        if argv[i] == "--n":
            n = int(argv[i + 1]); i += 2
        elif argv[i] == "--out":
            out = argv[i + 1]; i += 2
        else:
            names.append(argv[i]); i += 1
    names = names or FINAL
    for name in names:
        t = time.time()
        cv = Canvas(n)
        VARIANTS[name](cv)
        rgb = cv.finish(out=n // 2)
        d = os.path.join(out, name)
        os.makedirs(d, exist_ok=True)
        fn = "icon-1024.png" if n // 2 == 1024 else f"icon-{n // 2}.png"
        save_png(rgb, os.path.join(d, fn))
        print(f"{name}: {os.path.join(d, fn)} ({time.time() - t:.1f}s)")


if __name__ == "__main__":
    main(sys.argv[1:])
