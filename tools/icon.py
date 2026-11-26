"""Zeichnet das App-Icon (Flugbogen mit Flugzeug auf dunklem Grund) in icons/.
Aufruf: python tools/icon.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ZIEL = Path(__file__).resolve().parent.parent / "icons"
ZIEL.mkdir(exist_ok=True)
S = 1024
BG_TOP, BG_BOT = (34, 48, 90), (10, 15, 28)
AMBER = (255, 180, 60)

img = Image.new("RGB", (S, S))
d = ImageDraw.Draw(img)
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)))

# Globus-Andeutung: zwei Breitenkreise
glob = Image.new("RGBA", (S, S), (0, 0, 0, 0))
g = ImageDraw.Draw(glob)
g.ellipse([150, 150, 874, 874], outline=(255, 255, 255, 28), width=8)
g.ellipse([330, 150, 694, 874], outline=(255, 255, 255, 20), width=6)
g.line([(150, 512), (874, 512)], fill=(255, 255, 255, 20), width=6)
img.paste(glob, (0, 0), glob)

# Flugbogen (gestrichelt) von links unten nach rechts oben
def bogen(t):
    x0, y0, x1, y1 = 230, 720, 800, 330
    cx, cy = 420, 260
    x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1
    y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1
    return x, y

ebene = Image.new("RGBA", (S, S), (0, 0, 0, 0))
e = ImageDraw.Draw(ebene)
n = 26
for i in range(n):
    if i % 2:
        continue
    a, b = bogen(i / n * 0.86), bogen((i + 1) / n * 0.86)
    e.line([a, b], fill=AMBER + (255,), width=26)
for p in (bogen(0),):
    e.ellipse([p[0] - 34, p[1] - 34, p[0] + 34, p[1] + 34], fill=AMBER + (255,))
glow = ebene.filter(ImageFilter.GaussianBlur(18))
img.paste(glow, (0, 0), glow)
img.paste(ebene, (0, 0), ebene)

# Flugzeug am Ende des Bogens, in Flugrichtung gedreht
def flugzeug(size):
    p = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    q = ImageDraw.Draw(p)
    s = size / 24
    pts = [(21, 16), (21, 14), (13, 9), (13, 3.5), (12, 2), (11, 3.5), (11, 9), (3, 14), (3, 16), (11, 13.5),
           (11, 19), (9, 20.5), (9, 22), (12, 21), (15, 22), (15, 20.5), (13, 19), (13, 13.5)]
    q.polygon([(x * s, y * s) for x, y in pts], fill=(255, 255, 255, 255))
    return p

x, y = bogen(0.97)
x2, y2 = bogen(0.999)
winkel = math.degrees(math.atan2(-(y2 - y), x2 - x)) - 90
pl = flugzeug(300).rotate(winkel, resample=Image.BICUBIC, expand=True)
img.paste(pl, (int(x - pl.width / 2), int(y - pl.height / 2)), pl)

img.save(ZIEL / "logo-1024.png")
for name, g in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    img.resize((g, g), Image.LANCZOS).save(ZIEL / name)
print("Icons erzeugt")
