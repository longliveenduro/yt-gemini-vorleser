#!/usr/bin/env python3
"""Erzeugt die Erweiterungs-Icons (icons/icon{16,32,48,128}.png). Optional: nur nötig, wenn das Motiv geändert wird.

Benötigt Pillow:  pip install pillow
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

SCALE = 4          # Supersampling für glatte Kanten
BASE = 128 * SCALE
BG = (29, 95, 138, 255)      # Blau
FG = (255, 255, 255, 255)    # Weiß
SPARK = (255, 209, 102, 255) # Warmes Gelb


def sparkle(draw, cx, cy, r, color):
    """Vierzackiger Stern mit eingezogenen Seiten."""
    pts = []
    for i in range(8):
        angle = math.pi / 4 * i - math.pi / 2
        radius = r if i % 2 == 0 else r * 0.3
        pts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    draw.polygon(pts, fill=color)


def render():
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = BASE / 128.0

    d.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=int(28 * s), fill=BG)

    # Lautsprecher
    d.rectangle([22 * s, 50 * s, 44 * s, 78 * s], fill=FG)
    d.polygon([(44 * s, 50 * s), (68 * s, 30 * s), (68 * s, 98 * s), (44 * s, 78 * s)], fill=FG)

    # Schallwellen
    for radius, width in ((26, 7), (44, 7)):
        box = [(68 - radius) * s + 6 * s, (64 - radius) * s, (68 + radius) * s + 6 * s, (64 + radius) * s]
        d.arc(box, start=-48, end=48, fill=FG, width=int(width * s))

    # Funkeln: „Zusammenfassung“
    sparkle(d, 98 * s, 30 * s, 17 * s, SPARK)
    return img


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    big = render()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(out / f"icon{size}.png")
        print("geschrieben:", out / f"icon{size}.png")


if __name__ == "__main__":
    main()
