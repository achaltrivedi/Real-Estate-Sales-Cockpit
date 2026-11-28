"""Write the 2048 px phone versions of the 360-degree tour panoramas (apps/web/public/tours/**/<stop>-4096.webp).

    python assets/images/tour_sizes.py [--force]
"""
import glob
import os
import sys

import cv2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOURS = os.path.join(ROOT, "apps", "web", "public", "tours")
force = "--force" in sys.argv

for src in sorted(glob.glob(os.path.join(TOURS, "*", "*-4096.webp"))):
    dst = src.replace("-4096.webp", "-2048.webp")
    if not force and os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        continue
    im = cv2.imread(src, cv2.IMREAD_COLOR)
    if im is None:  # an interrupted render; tour_audit.py flags it for re-rendering
        print(f"skip {os.path.relpath(src, ROOT)}: does not decode")
        continue
    h, w = im.shape[:2]
    if w != 2 * h:
        raise SystemExit(f"{src}: not equirectangular ({w}x{h})")
    small = cv2.resize(im, (2048, 1024), interpolation=cv2.INTER_AREA)
    cv2.imwrite(dst, small, [cv2.IMWRITE_WEBP_QUALITY, 84])
    print(os.path.relpath(dst, ROOT), f"{os.path.getsize(dst) // 1024} KB")
