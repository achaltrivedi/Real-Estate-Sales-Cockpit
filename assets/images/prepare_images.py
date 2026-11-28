"""
Prepare the AI-generated source images for the site and the 3D model (fictional project).

    python assets/images/prepare_images.py

Reads   assets/source-images/<section>/*.png   (git-ignored originals, ~230 MB)
Writes  apps/web/public/images/{interiors,amenities}/<name>-{1600,800}.webp   site photography
        apps/web/public/brand/monogram.png                                     logo as an alpha mask (any colour via CSS)
        apps/web/src/app/icon.png, apple-icon.png                              favicons
        assets/models/textures/<name>.jpg                                      2048 px seamless textures (Cycles renders)
        assets/models/textures/web/<name>.jpg                                  512 px versions embedded in the GLB

Every source image carries Gemini's visible sparkle watermark at the same place (a 96 px star whose box
starts 160 px in from the bottom-right corner, ~50% white). It is removed exactly by reverse alpha blending,
    original = (marked - a * 255) / (1 - a)
with the per-pixel alpha `a` stored in gemini-sparkle-alpha.png (16-bit, measured from three dark images).
This restores the real pixels (wood grain, water, rails) instead of smearing them like inpainting would.
"""

import os
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "source-images")
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "apps", "web", "public")
APP = os.path.join(ROOT, "apps", "web", "src", "app")
TEX = os.path.join(ROOT, "assets", "models", "textures")

ALPHA = cv2.imread(os.path.join(HERE, "gemini-sparkle-alpha.png"), cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0

# Photography used on the site. Exterior concept images of *other* towers are kept as look-dev reference only,
# so the site never shows a building that contradicts our 3D model; the arrival court and facade close-up match it.
PHOTOS = {
    "interiors": ["studio-living", "1br-living", "1br-bedroom", "2br-living-dining", "2br-master", "3br-family-living",
                  "3br-kitchen", "penthouse-living", "penthouse-terrace", "bathroom"],
    "amenities": ["lobby", "podium-pool", "sky-lounge", "spa", "gym", "promenade", "kids-club"],
    "exteriors": ["ext-arrival", "ext-facade-detail"],
}


def unmark(img):
    """Remove the sparkle by reverse alpha blending (exact for a lossless source)."""
    n = ALPHA.shape[0]
    h, w = img.shape[:2]
    a = ALPHA[..., None]
    c = img[h - n:, w - n:, :3].astype(np.float32)
    out = img.copy()
    out[h - n:, w - n:, :3] = np.clip((c - a * 255.0) / (1.0 - a), 0, 255).round().astype(np.uint8)
    return out


def load(section, name):
    p = os.path.join(SRC, section, name + ".png")
    img = cv2.imread(p, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"missing source image: {p}")
    return unmark(img)


def resize_w(img, w):
    h = round(img.shape[0] * w / img.shape[1])
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)


def save_webp(img, path, q=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, q])


# ---------------------------------------------------------------- textures
def tileable(img, sigma_frac=0.12, feather=0.3):
    """Flatten large-scale lighting, then cross-fade with a half-offset copy so all four edges wrap.
    Variance-preserving blend keeps contrast in the cross-fade zone."""
    f = img.astype(np.float32)
    h, w = f.shape[:2]
    mean = f.reshape(-1, 3).mean(0)
    low = cv2.GaussianBlur(f, (0, 0), sigma_frac * max(h, w), borderType=cv2.BORDER_REFLECT)
    flat = f - low + mean
    rolled = np.roll(np.roll(flat, h // 2, 0), w // 2, 1)

    def ramp(n):
        d = np.minimum(np.arange(n), np.arange(n)[::-1]) / (feather * n)
        d = np.clip(d, 0, 1)
        return d * d * (3 - 2 * d)

    wgt = (ramp(h)[:, None] * ramp(w)[None, :])[..., None]
    mix = ((flat - mean) * wgt + (rolled - mean) * (1 - wgt)) / np.sqrt(wgt**2 + (1 - wgt) ** 2)
    return np.clip(mix + mean, 0, 255).astype(np.uint8)


def tint(img, dark, light, contrast=1.0):
    """Map luminance onto a two-colour gradient (BGR hex strings given as RGB '#rrggbb')."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    g = np.clip((g - g.mean()) * contrast + 0.5, 0, 1)[..., None]
    hx = lambda s: np.array([int(s[5:7], 16), int(s[3:5], 16), int(s[1:3], 16)], np.float32)
    return np.clip(hx(dark) * (1 - g) + hx(light) * g, 0, 255).astype(np.uint8)


TEXTURES = {
    # name: (source, post-process)
    "travertine": ("travertine", lambda t: t),
    "plaster": ("warm-white", lambda t: t),
    "oak": ("light-oak", lambda t: t),
    # The source "bronze" reads as pale wood: keep only its brushed grain and tint it champagne bronze.
    "bronze": ("bronze", lambda t: tint(t, "#6E5233", "#C9A574", 1.6)),
    # Weathered grey teak warmed to the oiled teak of the terrace photography.
    "teak": ("teak", lambda t: tint(t, "#3E2616", "#B7865B", 1.15)),
}


def square(img):
    h, w = img.shape[:2]
    s = min(h, w)
    y, x = (h - s) // 2, (w - s) // 2
    return img[y:y + s, x:x + s]


# ---------------------------------------------------------------- logo
def logo_mask(img):
    """Ivory background + champagne strokes -> white strokes with coverage alpha, cropped to the emblem."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    bg = cv2.GaussianBlur(g, (0, 0), 60)  # the background has a soft vignette
    # The strokes carry a light-to-dark gradient; saturate coverage so every line renders solid (edges stay anti-aliased).
    a = np.clip((bg - g - 4) / 30.0, 0, 1)
    ys, xs = np.nonzero(a > 0.5)
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    r = int(max(ys.max() - ys.min(), xs.max() - xs.min()) / 2 * 1.08)
    a = a[cy - r:cy + r, cx - r:cx + r]
    return a


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"put the source images in {SRC}")

    for section, names in PHOTOS.items():
        out_section = "amenities" if section == "exteriors" else section
        for name in names:
            img = load(section, name)
            for w in (1600, 800):
                save_webp(resize_w(img, w), os.path.join(PUBLIC, "images", out_section, f"{name}-{w}.webp"))
            print("photo", out_section, name, img.shape[1], "x", img.shape[0])

    os.makedirs(os.path.join(TEX, "web"), exist_ok=True)
    for name, (src, post) in TEXTURES.items():
        t = post(tileable(square(load("textures", src))))
        t = cv2.resize(t, (2048, 2048), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(TEX, f"{name}.jpg"), t, [cv2.IMWRITE_JPEG_QUALITY, 86])
        cv2.imwrite(os.path.join(TEX, "web", f"{name}.jpg"), cv2.resize(t, (512, 512), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 82])
        print("texture", name)

    a = logo_mask(load("brand", "logo"))
    mask = cv2.resize(a, (512, 512), interpolation=cv2.INTER_AREA)
    rgba = np.dstack([np.full((512, 512, 3), 255, np.uint8), (mask * 255).round().astype(np.uint8)])
    os.makedirs(os.path.join(PUBLIC, "brand"), exist_ok=True)
    cv2.imwrite(os.path.join(PUBLIC, "brand", "monogram.png"), rgba)

    # Favicons: champagne emblem on the night colour, with breathing room.
    for fname, size in (("icon.png", 512), ("apple-icon.png", 180)):
        inner = int(size * 0.74)
        m = cv2.resize(a, (inner, inner), interpolation=cv2.INTER_AREA)[..., None]
        canvas = np.zeros((size, size, 3), np.float32)
        canvas[:] = (0x20, 0x15, 0x0B)  # BGR of #0B1520
        o = (size - inner) // 2
        ink = np.array((0xA0, 0xC3, 0xD9), np.float32)  # BGR of #D9C3A0 (champagne light)
        canvas[o:o + inner, o:o + inner] = canvas[o:o + inner, o:o + inner] * (1 - m) + ink * m
        cv2.imwrite(os.path.join(APP, fname), canvas.round().astype(np.uint8))
    print("brand ok")


if __name__ == "__main__":
    main()
