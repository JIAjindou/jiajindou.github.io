"""Make the white background of figure images transparent (for the dark theme).

Only the background is touched: near-white, low-saturation pixels connected to
the image border. Inside that region white becomes transparent and light grey
(soft shadows, anti-aliased edges) becomes translucent black ("colour to alpha"
against white), so on a white page the result looks exactly like the original
and on a dark page shadows stay shadows. Interior whites (boxes, highlights)
keep full opacity.

Usage: python tools/make_transparent.py images/FOO_fig.webp [...]
Writes images/FOO_fig.t.webp next to each input and prints how much of the
image became transparent and how much dark ink sits right on the removed
background (a high value = dark text/lines that won't read on a dark page).
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

LIGHT = 200      # min(R,G,B) above this can be background (white or light shadow)
NEUTRAL = 28     # max-min channel spread allowed for background (no tinted pixels)


def convert(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3] / 255.0
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    cand = (lo > LIGHT) & (hi - lo < NEUTRAL) & (alpha > 0.5)
    # Keep only candidate regions that touch the border: that's the background.
    lab, n = ndimage.label(cand)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, border[border > 0])
    # Colour-to-alpha against white inside the background region.
    new_a = np.where(bg, (255.0 - lo) / 255.0, 1.0)
    safe = np.maximum(new_a, 1e-3)[..., None]
    unmixed = np.clip((rgb - (1.0 - safe) * 255.0) / safe, 0, 255)
    out_rgb = np.where(bg[..., None], unmixed, rgb)
    out_a = np.minimum(alpha, new_a)
    out = np.dstack([out_rgb, out_a * 255.0]).round().astype(np.uint8)
    # Snap near-clear / near-opaque alpha (smaller files, no visible change) and
    # blank the colour of fully clear pixels.
    al = out[..., 3]
    al[al < 10] = 0
    al[al > 245] = 255
    out[al == 0, :3] = 0
    dst = path.rsplit(".", 1)[0] + ".t.webp"
    Image.fromarray(out, "RGBA").save(dst, "WEBP", quality=82, alpha_quality=90, method=6)
    # Dark ink touching the removed background (text/lines that would vanish on dark).
    ring = ndimage.binary_dilation(bg, iterations=2) & ~bg
    ink = ring & (hi < 110)
    return dst, (out_a < 0.1).mean(), ink.sum() / max(1, ring.sum())


if __name__ == "__main__":
    for p in sys.argv[1:]:
        dst, clear, ink = convert(p)
        print(f"{dst:<40} transparent={clear:5.1%}  dark-ink-on-bg={ink:5.1%}")
