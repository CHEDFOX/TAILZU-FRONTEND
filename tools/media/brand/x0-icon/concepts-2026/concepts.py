"""Logo concepts for X0 Bot, drawn from the brand's own art (tools/media/trailer): icons at 1024, logo lockups, and a
# Run from tools/media/trailer:  python3 ../brand/x0-icon/concepts-2026/concepts.py "$PWD" <outDir>
home-screen mock at real size next to the current icon."""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageFilter
R = sys.argv[1]; OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
CLAY, INK, PAPER, VISOR, CREAM = (201, 104, 63), (10, 10, 10), (246, 241, 232), (44, 40, 37), (250, 241, 226)
def L(p): im = Image.open(os.path.join(R, p)).convert("RGBA"); return im.crop(im.getbbox())
head, face, eyes, hands, bar, mark = (L(f"hero/hang-{n}-1632.png") for n in ("head", "face", "eyes", "hands", "bar")), None, None, None, None, None
head, face, eyes, hands, bar = [L(f"hero/hang-{n}-1632.png") for n in ("head", "face", "eyes", "hands", "bar")]
markim = Image.open(os.path.join(R, "components/mark-x0-ink.png")).convert("RGBA")
MW = markim.width
xpart = markim.crop((0, 0, int(MW * 0.495), markim.height)); xpart = xpart.crop(xpart.getbbox())
ring = markim.crop((int(MW * 0.5), 0, MW, markim.height)); ring = ring.crop(ring.getbbox())
FONT = os.path.join(R, "fonts/Geist[wght].ttf")
def font(size, w=700):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_axes([w])
    except Exception: pass
    return f
def tint(im, c):
    o = Image.new("RGBA", im.size, c + (255,)); o.putalpha(im.getchannel("A")); return o
def solid(ringim):
    # the painted 0 filled in: everything not reachable from outside the ring
    a = ringim.getchannel("A").point(lambda v: 255 if v > 90 else 0)
    pad = Image.new("L", (a.width + 4, a.height + 4), 0); pad.paste(a, (2, 2))
    ImageDraw.floodfill(pad, (0, 0), 128)
    inside = pad.point(lambda v: 0 if v == 128 else 255).crop((2, 2, a.width + 2, a.height + 2))
    inside = ImageChops.lighter(inside, ringim.getchannel("A"))
    o = Image.new("RGBA", ringim.size, INK + (255,)); o.putalpha(inside); return o
ZERO = solid(ring)
def outlined(im, px):
    # an ink line round a cream piece (as the films' come-back gloves): the alpha dilated, filled ink, the piece on top
    a = im.getchannel("A").filter(ImageFilter.MaxFilter(px * 2 + 1))
    o = Image.new("RGBA", im.size, INK + (255,)); o.putalpha(a); o.alpha_composite(im); return o
G = hands.width // 2
GLOVES = [hands.crop((0, 0, G, hands.height)), hands.crop((G, 0, hands.width, hands.height))]
GLOVES = [g.crop(g.getbbox()) for g in GLOVES]
def zero_face(h, gloves=True, eye_scale=1.0, ring=None):
    """The 0 as the bot's head: the painted 0 filled ink, a dark visor inset, the cream eyes, gloves over its top."""
    w = int(h * ZERO.width / ZERO.height)
    body = ZERO.resize((w, h), Image.LANCZOS)
    vis = tint(ZERO, VISOR).resize((int(w * 0.70), int(h * 0.62)), Image.LANCZOS)
    c = Image.new("RGBA", (int(w * 1.5), int(h * 1.25)), (0, 0, 0, 0)); ox, oy = (c.width - w) // 2, int(h * 0.16)
    c.alpha_composite(body, (ox, oy)); c.alpha_composite(vis, (ox + (w - vis.width) // 2, oy + int(h * 0.13)))
    ew = int(w * 0.62 * eye_scale); e = eyes.resize((ew, int(ew * eyes.height / eyes.width)), Image.LANCZOS)
    c.alpha_composite(e, (ox + (w - ew) // 2, oy + int(h * 0.30)))
    if gloves:
        # each glove grips the 0's top edge: its fingers over the rim, the rim cutting across its palm
        gw = int(w * 0.26)
        for side, fx in ((0, 0.27), (1, 0.73)):
            g = GLOVES[side].resize((gw, int(gw * GLOVES[side].height / GLOVES[side].width)), Image.LANCZOS)
            g = outlined(g, max(3, gw // 28))
            # the rim's height at this x: the first opaque row of the body in that column
            colx = int(w * fx); A_ = body.getchannel("A"); top = next((y for y in range(h) if A_.getpixel((colx, y)) > 128), 0)
            c.alpha_composite(g, (ox + colx - g.width // 2, oy + top - int(g.height * 0.55)))
    if ring is not None:
        # the painted 0 itself, in cream, a little larger than the face, so the face sits inside its own brush ring
        rw, rh = int(w * 1.14), int(h * 1.10); rr = tint(ring, CREAM).resize((rw, rh), Image.LANCZOS)
        under = Image.new("RGBA", (c.width + 40, c.height + 40), (0, 0, 0, 0)); under.alpha_composite(rr, (ox + 20 - (rw - w) // 2, oy + 20 - (rh - h) // 2))
        under.alpha_composite(c, (20, 20)); c = under
    return c.crop(c.getbbox())
def rounded(img, r=0.2237):
    m = Image.new("L", img.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, img.width - 1, img.height - 1], int(img.width * r), fill=255)
    o = img.copy(); o.putalpha(m); return o
def paper(sz, col=PAPER):
    im = Image.new("RGBA", (sz, sz), col + (255,)); return im
S = 1024
icons = {}
# A: the 0 is his face, on clay
a = paper(S, CLAY); zf = zero_face(int(S * 0.70)); a.alpha_composite(zf, ((S - zf.width) // 2, int(S * 0.15))); icons["A"] = a
# A2: the same on paper (light) - the clay bar as the icon's top edge
a2 = paper(S, PAPER); d = ImageDraw.Draw(a2)
zf2 = zero_face(int(S * 0.70)); a2.alpha_composite(zf2, ((S - zf2.width) // 2, int(S * 0.15))); icons["A2"] = a2
# B: the hanging bot, sharpened: no bar, the icon's top edge is what he holds; bigger eyes
b = paper(S, PAPER)
hw = int(S * 0.92); hb = face.resize((hw, int(hw * face.height / face.width)), Image.LANCZOS)
b.alpha_composite(hb, ((S - hw) // 2, int(S * 0.0)))
ew = int(hw * 0.56); eb = eyes.resize((ew, int(ew * eyes.height / eyes.width)), Image.LANCZOS)
b.alpha_composite(eb, ((S - ew) // 2 + int(hw * 0.03), int(S * 0.12)))
for side, fx in ((0, 0.30), (1, 0.70)):
    gw = int(S * 0.21); g = outlined(GLOVES[side].resize((gw, int(gw * GLOVES[side].height / GLOVES[side].width)), Image.LANCZOS), 7)
    b.alpha_composite(g, (int(S * fx) - g.width // 2, -int(g.height * 0.12)))
icons["B"] = b
# C: the team: four dotted heads round an empty seat (a pencil circle) for yours, on ink
c = paper(S, INK); dc = ImageDraw.Draw(c)
hs = int(S * 0.36)
pos = [(0.08, 0.10), (0.56, 0.10), (0.08, 0.56), (0.56, 0.56)]
for (fx, fy), n in zip(pos, ("keybot", "plan", "travel", "code")):
    h_ = Image.open(os.path.join(R, f"assets/head-{n}.png")).convert("RGBA").resize((hs, hs), Image.NEAREST)
    c.alpha_composite(h_, (int(S * fx), int(S * fy)))
cr = int(S * 0.13); cx = cy = S // 2
for k in range(0, 360, 14): 
    import math
    a0, a1 = math.radians(k), math.radians(k + 8)
    dc.arc([cx - cr, cy - cr, cx + cr, cy + cr], k, k + 8, fill=CREAM, width=14)
icons["C"] = c
# the current icon, for comparison
cur = Image.open(os.path.join(R, "../../../app/assets/icon.png")).convert("RGBA").resize((S, S), Image.LANCZOS); icons["now"] = cur
for k, im in icons.items(): rounded(im).save(f"{OUT}/icon-{k}.png")
# the logo lockups
def lockup(h=360, bg=PAPER, fg=INK):
    zf = zero_face(h, ring=ring if fg != INK else None); xh = int(h * 0.92); xx = xpart.resize((int(xh * xpart.width / xpart.height), xh), Image.LANCZOS)
    if fg != INK: xx = tint(xx, fg)
    W_ = xx.width + zf.width + 140; im = Image.new("RGBA", (W_ + 120, h + 260), bg + (255,))
    im.alpha_composite(xx, (60, im.height - 70 - xh)); im.alpha_composite(zf, (60 + xx.width + 50, im.height - 70 - zf.height))
    return im
lockup().save(f"{OUT}/logo-A-light.png"); lockup(bg=INK, fg=CREAM).save(f"{OUT}/logo-A-dark.png")
# the board
B = Image.new("RGBA", (2400, 2050), (236, 233, 226, 255)); dB = ImageDraw.Draw(B)
dB.text((80, 60), "X0 Bot: logo concepts", font=font(64, 800), fill=INK)
cols = [("now", "Today: the hanging bot"), ("A", "A. The 0 is his face (clay)"), ("A2", "A. The 0 is his face (paper)"), ("B", "B. The hanging bot, sharpened"), ("C", "C. The team, a seat for yours")]
for i, (k, label) in enumerate(cols):
    x = 80 + i * 455
    B.alpha_composite(rounded(icons[k]).resize((400, 400), Image.LANCZOS), (x, 200))
    dB.text((x, 625), label, font=font(30, 600), fill=INK)
# home screen at real size (60 pt = 180 px at 3x, shown at 1:1 of a 3x phone): one row of each, with grey neighbours
ph = Image.new("RGBA", (1100, 1250), (32, 36, 44, 255)); dp = ImageDraw.Draw(ph)
for gy in range(6):
    for gx in range(4):
        x, y = 70 + gx * 250, 90 + gy * 190
        dp.rounded_rectangle([x, y, x + 150, y + 150], 34, fill=(70, 76, 88))
order = ["now", "A", "A2", "B", "C"]
for j, k in enumerate(order):
    gx, gy = j % 4, 1 + j // 4
    x, y = 70 + gx * 250, 90 + gy * 190
    ph.alpha_composite(rounded(icons[k]).resize((150, 150), Image.LANCZOS), (x, y))
    dp.text((x + 75, y + 160), {"now": "today", "A": "A clay", "A2": "A paper", "B": "B", "C": "C"}[k], font=font(24, 500), fill=(230, 230, 230), anchor="mt")
B.alpha_composite(ph.resize((880, 1000)), (80, 760))
dB.text((80, 700), "On a home screen, at real size", font=font(34, 700), fill=INK)
# lockups and the small sizes
la = Image.open(f"{OUT}/logo-A-light.png"); ld = Image.open(f"{OUT}/logo-A-dark.png")
la.thumbnail((640, 400)); ld.thumbnail((640, 400))
dB.text((1080, 700), "A as the logo: the X, then the 0 that looks back", font=font(34, 700), fill=INK)
B.alpha_composite(la, (1080, 770)); B.alpha_composite(ld, (1080 + la.width + 40, 770))
dB.text((1080, 1230), "Small: 64, 40 and 24 px", font=font(34, 700), fill=INK)
for i, k in enumerate(order):
    y = 1300 + i * 140; dB.text((1080, y + 40), {"now": "today", "A": "A clay", "A2": "A paper", "B": "B", "C": "C"}[k], font=font(28, 500), fill=INK)
    x = 1280
    for s in (64, 40, 24):
        B.alpha_composite(rounded(icons[k]).resize((s, s), Image.LANCZOS), (x, y + (64 - s) // 2 + 20)); x += s + 40
B.convert("RGB").save(f"{OUT}/board.png")
print("ok")
