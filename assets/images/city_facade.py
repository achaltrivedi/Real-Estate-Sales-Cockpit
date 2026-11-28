"""Seamless curtain-wall texture for the distant skyline blocks in the live model (no photography needed).

    python assets/images/city_facade.py

One repeat = 4 floors x 4 bays (build_tower.py maps it at UV_SIZE["Context"] scene units): dark blue-grey
glazing with a soft vertical sky gradient per pane, slim mullions, a lighter spandrel at each floor line and a
few warm lit windows. Writes assets/models/textures/city.jpg (2048 px) and textures/web/city.jpg (512 px).
"""
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "..", "models", "textures")
N = 2048
FLOORS, BAYS = 4, 4
PANES = 3  # panes per bay


def main():
    rng = np.random.default_rng(31)
    img = np.zeros((N, N, 3), np.float32)
    fh, bw = N // FLOORS, N // BAYS
    pw = bw // PANES
    grad = np.linspace(1.0, 0.72, fh)[:, None, None]  # sky reflection fades towards the floor below
    for f in range(FLOORS):
        y0 = f * fh
        for p in range(BAYS * PANES):
            x0 = p * pw
            base = np.array([118, 102, 86], np.float32) * (0.85 + 0.3 * rng.random())  # BGR blue-grey glass
            pane = np.broadcast_to(base, (fh, pw, 3)) * grad
            if rng.random() < 0.16:  # a lit home
                warm = np.array([120, 190, 245], np.float32) * (0.75 + 0.25 * rng.random())
                pane = pane * 0.35 + warm * 0.65
            img[y0 : y0 + fh, x0 : x0 + pw] = pane
        img[y0 + fh - int(fh * 0.16) : y0 + fh] = (176, 184, 190)  # spandrel / slab edge (bottom of each floor)
    for p in range(BAYS * PANES + 1):  # mullions, heavier at the bay lines
        w = 10 if p % PANES == 0 else 5
        x = (p * pw) % N
        img[:, max(0, x - w // 2) : x + w // 2 + 1] = (70, 78, 86)
        if x - w // 2 < 0:
            img[:, N - w // 2 :] = (70, 78, 86)
    img = cv2.GaussianBlur(img, (0, 0), 1.2)
    os.makedirs(os.path.join(TEX, "web"), exist_ok=True)
    out = np.clip(img, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(TEX, "city.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 86])
    cv2.imwrite(os.path.join(TEX, "web", "city.jpg"), cv2.resize(out, (512, 512), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 82])
    print("wrote city.jpg")


if __name__ == "__main__":
    main()
