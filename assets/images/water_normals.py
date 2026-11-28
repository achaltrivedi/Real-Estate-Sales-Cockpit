"""
Procedural, perfectly tiling water normal map for the live lagoon (packages/3d LagoonWater).

    python assets/images/water_normals.py   ->  apps/web/public/textures/water-normals.jpg (512 px)

A random height field is synthesised in the frequency domain (so it wraps seamlessly), shaped like
wind-blown ripples (power-law spectrum, slightly stretched across the wind), and converted to
tangent-space normals the way three's Water shader expects (blue-dominant, +Z up).
"""

import os

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "textures", "water-normals.jpg")
N = 512


def main():
    rng = np.random.default_rng(7)
    kx = np.fft.fftfreq(N) * N
    ky = np.fft.fftfreq(N) * N
    KX, KY = np.meshgrid(kx, ky)
    k = np.sqrt((KX * 1.0) ** 2 + (KY * 1.6) ** 2)  # ripples a little longer along the wind
    amp = np.where(k > 1.5, np.maximum(k, 1.5) ** -1.9, 0.0) * np.exp(-((k / 140.0) ** 2))
    spec = (rng.normal(size=(N, N)) + 1j * rng.normal(size=(N, N))) * amp
    h = np.real(np.fft.ifft2(spec))
    h = (h - h.mean()) / h.std()

    # Periodic central differences -> normals.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    s = 2.2
    n = np.dstack([-dx * s, -dy * s, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    rgb = ((n * 0.5 + 0.5) * 255).round().astype(np.uint8)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cv2.imwrite(OUT, rgb[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 90])
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
