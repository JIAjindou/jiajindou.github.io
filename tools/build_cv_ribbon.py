"""Generate _includes/cv_ribbon.svg: the CV's still, vector version of the
homepage roadmap's particle ribbons, drawn from _data/roadmap.yml.

Seven equal columns, a node at each column's centre. Rerun after changing the
roadmap's stages or tracks. Seeded, so the output only changes with the data.
"""
import math
import random
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
data = yaml.safe_load((REPO / "_data" / "roadmap.yml").read_text(encoding="utf-8"))
stages, tracks = data["stages"], data["tracks"]

W, H, MID, OFF = 1000.0, 130.0, 65.0, 30.0
n = len(stages)
col = W / n
cx = [(i + 0.5) * col for i in range(n)]
by_key = {t["key"]: t for t in tracks}
rand = random.Random(7)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def line_y(track, x):
    """Height of a track's line: trunk at the ends, its own lane in between."""
    start = track["from"] * col - 42
    end = cx[-1] - 8
    return MID + track["side"] * OFF * smooth((x - start) / 84) * (1 - smooth((x - (end - 84)) / 84))


def half_width(track, x):
    """Ribbon half-width: pinched through the nodes on this track, wide between."""
    pins = [cx[i] for i, s in enumerate(stages) if s["track"] in (track["key"], "trunk")]
    near = min(abs(x - p) for p in pins)
    return (1.5 + 6.5 * (1 - math.exp(-(near / 44) ** 2))) * min(1.0, x / 50, (W - x) / 50)


def mix(hex_color, f):
    c = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(v + (255 - v) * f):02x}" for v in c)


# Particles, grouped into one path per (colour, size, opacity) to keep the file small.
SIZES = [(1.4, 0.55), (2.0, 0.75), (2.7, 0.9), (4.4, 1.0)]
groups = {}
for track in tracks:
    for _ in range(1500):
        x = rand.uniform(0, W)
        y = line_y(track, x) + max(-2.5, min(2.5, rand.gauss(0, 1))) * half_width(track, x)
        r = rand.random()
        size = 3 if r < 0.05 else 0 if r < 0.45 else 1 if r < 0.8 else 2
        tint = 0 if size == 3 or rand.random() < 0.55 else 0.3 if rand.random() < 0.6 else 0.55
        key = (mix(track["color"], tint), size)
        groups.setdefault(key, []).append(f"M{x:.1f} {y:.1f}h0")

out = [f'<svg class="cv-ribbon" viewBox="0 0 {W:.0f} {H:.0f}" role="img" '
       'aria-label="Two research directions splitting from a shared start and merging again">']
for (color, size), dots in sorted(groups.items()):
    width, alpha = SIZES[size]
    out.append(f'<path d="{"".join(dots)}" fill="none" stroke="{color}" stroke-width="{width}" '
               f'stroke-linecap="round" opacity="{alpha}"/>')

# A faint guide line under each ribbon.
for track in tracks:
    points = " ".join(f"{x},{line_y(track, x):.1f}" for x in range(0, int(W) + 1, 6))
    out.append(f'<polyline points="{points}" fill="none" stroke="{track["color"]}" stroke-width="1" opacity="0.3"/>')

for i, stage in enumerate(stages):
    track = by_key.get(stage["track"])
    color = track["color"] if track else data["trunk"]["color"]
    y = MID + (track["side"] * OFF if track else 0)
    out.append(f'<circle cx="{cx[i]:.1f}" cy="{y:.1f}" r="4.6" fill="#fff" stroke="{color}" stroke-width="1.7"/>')

for track in tracks:
    first = next(i for i, s in enumerate(stages) if s["track"] == track["key"])
    y = MID + track["side"] * (OFF + 25) + 4
    out.append(f'<text x="{cx[first] + 14:.1f}" y="{y:.1f}" fill="{track["color"]}" font-size="12.5" '
               f'font-weight="600" letter-spacing="1.5" font-family="\'Google Sans\',\'Noto Sans\',sans-serif">'
               f'{track["name"].upper()}</text>')
out.append("</svg>")

path = REPO / "_includes" / "cv_ribbon.svg"
path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
print(f"{path}: {path.stat().st_size // 1024} KB")
