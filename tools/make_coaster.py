"""Generate the printable coaster (tracking target) for Cup Shadow.

Outputs:
  assets/coaster.png        target image used to build the .mind tracking file
  print/coaster-A4.pdf      A4 page, coaster at exact size (150 mm) with cut marks
  print/coaster-A4.png      same page as an image

The design is deliberately busy and asymmetric: image tracking needs many
sharp corners and no repeating pattern. The middle stays quiet because the
cup covers it anyway.

Run:  python3 tools/make_coaster.py   (from the cup-shadow folder)
Same SEED -> same coaster. If you change the design, rebuild assets/coaster.mind.
"""
import math, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SEED = 7
SIZE_MM = 150          # printed coaster width (must match coasterMM in the app)
CUP_SPOT_MM = 64       # dashed circle where the cup stands
DPI = 300
ROOT = Path(__file__).resolve().parent.parent

px_per_mm = DPI / 25.4
S = round(SIZE_MM * px_per_mm)
C = S / 2
mm = lambda v: v * px_per_mm

PAPER = (244, 236, 220)
INK = (34, 24, 18)
RED = (184, 70, 38)

rnd = random.Random(SEED)
img = Image.new("RGB", (S, S), PAPER)
d = ImageDraw.Draw(img)

FUT = "/System/Library/Fonts/Supplemental/Futura.ttc"
def font(size_mm, index=0):
    return ImageFont.truetype(FUT, round(mm(size_mm)), index=index)

# ---- border -------------------------------------------------------------
d.rectangle([mm(3), mm(3), S - mm(3), S - mm(3)], outline=INK, width=round(mm(1.2)))
d.rectangle([mm(5), mm(5), S - mm(5), S - mm(5)], outline=INK, width=round(mm(0.4)))

placed = [(S / 2, mm(11), mm(6))]  # (x, y, r) to avoid overlaps; first = keep the red arrow clear
spot_r = mm(CUP_SPOT_MM / 2)
ring_r = spot_r + mm(9)  # text ring outer edge

def free(x, y, r):
    if math.hypot(x - C, y - C) < ring_r + r + mm(1):
        return False
    if x - r < mm(7) or y - r < mm(7) or x + r > S - mm(7) or y + r > S - mm(7):
        return False
    return all(math.hypot(x - a, y - b) > r + c + mm(1.2) for a, b, c in placed)

def rot(pts, cx, cy, a):
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + px * ca - py * sa, cy + px * sa + py * ca) for px, py in pts]

def bean(x, y, r, a, col):
    pts = [(r * math.cos(t) * 0.62, r * math.sin(t)) for t in [i * math.pi / 18 for i in range(36)]]
    d.polygon(rot(pts, x, y, a), fill=col)
    crease = [(math.sin(t * math.pi) * r * 0.18, (t * 2 - 1) * r * 0.85) for t in [i / 12 for i in range(13)]]
    d.line(rot(crease, x, y, a), fill=PAPER, width=max(2, round(r * 0.14)))

def tri(x, y, r, a, col):
    d.polygon(rot([(0, -r), (r * 0.87, r * 0.5), (-r * 0.87, r * 0.5)], x, y, a), fill=col)

def square(x, y, r, a, col):
    s = r * 0.75
    d.polygon(rot([(-s, -s), (s, -s), (s, s), (-s, s)], x, y, a), outline=col, width=round(r * 0.28))

def star(x, y, r, a, col):
    n = rnd.choice([4, 5, 6])
    pts = []
    for i in range(n * 2):
        rr = r if i % 2 == 0 else r * 0.42
        t = i * math.pi / n
        pts.append((rr * math.cos(t), rr * math.sin(t)))
    d.polygon(rot(pts, x, y, a), fill=col)

def ring(x, y, r, a, col):
    d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=round(r * 0.3))
    d.ellipse([x - r * 0.2, y - r * 0.2, x + r * 0.2, y + r * 0.2], fill=col)

def zig(x, y, r, a, col):
    pts = [(-r + i * r / 3, (r * 0.45 if i % 2 else -r * 0.45)) for i in range(7)]
    d.line(rot(pts, x, y, a), fill=col, width=round(r * 0.22), joint="curve")

def cross(x, y, r, a, col):
    w = r * 0.32
    d.polygon(rot([(-w, -r), (w, -r), (w, -w), (r, -w), (r, w), (w, w), (w, r), (-w, r), (-w, w), (-r, w), (-r, -w), (-w, -w)], x, y, a), fill=col)

def half(x, y, r, a, col):
    deg = math.degrees(a)
    d.pieslice([x - r, y - r, x + r, y + r], deg, deg + 180, fill=col)

def dots(x, y, r, a, col):
    for i in range(3):
        for j in range(3):
            if (i + j) % 2 == 0:
                px, py = rot([((i - 1) * r * 0.6, (j - 1) * r * 0.6)], x, y, a)[0]
                d.ellipse([px - r * 0.2, py - r * 0.2, px + r * 0.2, py + r * 0.2], fill=col)

WORDS = ["woof", "puff", "grr", "shh", "sip", "hot", "bloom", "hey", "oh!", "zz", "pop", "mm"]

def word(x, y, r, a, col):
    f = font(r / px_per_mm * 0.95, index=rnd.choice([0, 2]))
    t = rnd.choice(WORDS)
    tw = d.textlength(t, font=f)
    layer = Image.new("RGBA", (int(tw) + 20, int(r * 2.2)), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((10, r * 0.2), t, font=f, fill=col)
    layer = layer.rotate(math.degrees(a), expand=True, resample=Image.BICUBIC)
    img.paste(layer, (int(x - layer.width / 2), int(y - layer.height / 2)), layer)
    return tw / 2

shapes = [bean, bean, tri, square, star, ring, zig, cross, half, dots]

# big shapes first, then fill with smaller ones
for size_mm_, tries, count in [(9, 4000, 14), (6, 6000, 34), (4.2, 8000, 60), (2.8, 12000, 110)]:
    n = 0
    for _ in range(tries):
        if n >= count:
            break
        r = mm(size_mm_ * rnd.uniform(0.8, 1.15))
        x, y = rnd.uniform(0, S), rnd.uniform(0, S)
        if not free(x, y, r):
            continue
        a = rnd.uniform(0, math.tau)
        col = RED if rnd.random() < 0.22 else INK
        if size_mm_ >= 4 and rnd.random() < 0.16:
            rw = word(x, y, r, a, col)
            placed.append((x, y, max(r, rw * 0.9)))
        else:
            rnd.choice(shapes)(x, y, r, a, col)
            placed.append((x, y, r))
        n += 1

# ---- cup spot + text ring ---------------------------------------------
d.ellipse([C - ring_r, C - ring_r, C + ring_r, C + ring_r], fill=PAPER)
d.ellipse([C - ring_r, C - ring_r, C + ring_r, C + ring_r], outline=INK, width=round(mm(0.8)))
text = "  THE CUP HAS A SHADOW  ·  PLACE THE CUP HERE  ·  BLOW TO BLOOM  ·  "
f = font(3.6, index=0)
rr = spot_r + mm(4.2)
total = sum(d.textlength(ch, font=f) for ch in text)
ang = -math.pi / 2 - (total / rr) / 2
for ch in text:
    w = d.textlength(ch, font=f)
    a = ang + (w / 2) / rr
    layer = Image.new("RGBA", (round(mm(6)), round(mm(6))), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((layer.width / 2, layer.height / 2), ch, font=f, fill=INK, anchor="mm")
    layer = layer.rotate(-math.degrees(a) - 90, resample=Image.BICUBIC)
    x, y = C + rr * math.cos(a), C + rr * math.sin(a)
    img.paste(layer, (round(x - layer.width / 2), round(y - layer.height / 2)), layer)
    ang += w / rr
# dashed cup circle
for i in range(48):
    a0 = i * math.tau / 48
    d.arc([C - spot_r, C - spot_r, C + spot_r, C + spot_r], math.degrees(a0), math.degrees(a0) + 4.2, fill=INK, width=round(mm(0.7)))

# orientation mark: arrow at the top edge ("this side away from you")
ax = C
d.polygon([(ax, mm(8)), (ax - mm(4), mm(14)), (ax + mm(4), mm(14))], fill=RED)

img.save(ROOT / "assets" / "coaster.png", optimize=True)
# smaller copy for the tracking compiler (it downsamples anyway)
img.resize((1000, 1000), Image.LANCZOS).save(ROOT / "assets" / "coaster-target.png", optimize=True)

# ---- A4 print sheet ----------------------------------------------------
A4W, A4H = round(210 * px_per_mm), round(297 * px_per_mm)
page = Image.new("RGB", (A4W, A4H), "white")
pd = ImageDraw.Draw(page)
ox, oy = (A4W - S) // 2, round(mm(40))
page.paste(img, (ox, oy))
# cut marks
L = mm(8); g = mm(2)
for cx_, cy_ in [(ox, oy), (ox + S, oy), (ox, oy + S), (ox + S, oy + S)]:
    sx = -1 if cx_ == ox else 1
    sy = -1 if cy_ == oy else 1
    pd.line([(cx_ + sx * g, cy_), (cx_ + sx * (g + L), cy_)], fill="black", width=3)
    pd.line([(cx_, cy_ + sy * g), (cx_, cy_ + sy * (g + L))], fill="black", width=3)
tf = ImageFont.truetype(FUT, round(mm(5)))
sf = ImageFont.truetype(FUT, round(mm(3.2)))
pd.text((A4W / 2, mm(20)), "Cup Shadow — coaster", font=tf, fill="black", anchor="mm")
lines = [
    "Print at 100% / Actual size (NOT 'fit to page'). The square must measure 150 mm.",
    "Cut on the corner marks. Matte paper or card is best: glossy paper reflects light and breaks tracking.",
    "Glue onto cardboard so it stays flat. Stand the cup on the dashed circle.",
    "Place it with the red arrow pointing AWAY from where people stand.",
]
y = oy + S + mm(14)
for t in lines:
    pd.text((A4W / 2, y), t, font=sf, fill="black", anchor="mm")
    y += mm(7)
# 50 mm check ruler
ry = y + mm(8)
pd.line([(A4W / 2 - mm(25), ry), (A4W / 2 + mm(25), ry)], fill="black", width=4)
for k in range(6):
    xk = A4W / 2 - mm(25) + mm(10) * k
    pd.line([(xk, ry - mm(2)), (xk, ry + mm(2))], fill="black", width=3)
pd.text((A4W / 2, ry + mm(6)), "this line = 50 mm (check with a ruler after printing)", font=sf, fill="black", anchor="mm")
page.save(ROOT / "print" / "coaster-A4.pdf", resolution=DPI)
page.save(ROOT / "print" / "coaster-A4.png", dpi=(DPI, DPI), optimize=True)
print("ok", S, "px")
