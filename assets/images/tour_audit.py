"""Audit every render the site ships (360-degree tours + the hero layers) and say what still needs rendering.

A render counts as done only if it decodes completely, has the right size, isn't blank, and is newer than
everything it was made from (make-style), so an interrupted batch can always be resumed safely.

    python assets/images/tour_audit.py            # human report; exit 1 if anything is missing or stale
    python assets/images/tour_audit.py --plan     # machine plan for assets/models/source/finish_renders.sh
"""
import json
import os
import sys

import cv2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "models", "source")
ENV = os.path.join(ROOT, "assets", "models", "env")
TOURS = os.path.join(ROOT, "apps", "web", "public", "tours")
HERO = os.path.join(ROOT, "apps", "web", "public", "cinematic")
SEED = os.path.join(ROOT, "assets", "seed", "project.json")


def mtime(p):
    return os.path.getmtime(p) if os.path.exists(p) else 0.0


SCENE = max(mtime(os.path.join(SRC, f)) for f in ("cinematic.py", "build_tower.py"))  # the exterior world
SCENE = max(SCENE, mtime(SEED))
INTERIOR = max(SCENE, mtime(os.path.join(SRC, "tours.py")), mtime(os.path.join(SRC, "interiors.py")), mtime(os.path.join(SRC, "tours.json")))


def image_problem(path, w, h, newer_than):
    """None when the image is complete and current, else a short reason."""
    if not os.path.exists(path):
        return "missing"
    if os.path.getsize(path) < 4096:
        return "truncated"
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        return "does not decode (partial write?)"
    if im.shape[1] != w or im.shape[0] != h:
        return f"{im.shape[1]}x{im.shape[0]}, want {w}x{h} (draft?)"
    if im.mean() < 12:
        return "blank / black"
    if mtime(path) < newer_than:
        return "older than its sources"
    return None


def env_problem(name):
    p = os.path.join(ENV, f"{name}.exr")
    if not os.path.exists(p):
        return "missing"
    if os.path.getsize(p) < 4_000_000:
        return "truncated"
    if mtime(p) < SCENE:
        return "older than the exterior scene"
    return None


def env_for(group, tours):
    if group in tours["residences"]:
        return group
    return {"lobby": "ground", "spa": "ground", "gym": "ground", "sky-lounge": "sky"}.get(group)  # podium-pool/promenade: direct


def audit():
    tours = json.load(open(os.path.join(SRC, "tours.json"), encoding="utf-8"))
    groups = {**{k: v["stops"] for k, v in tours["residences"].items()}, **{k: v["stops"] for k, v in tours["amenities"].items()}}
    envs = {}
    for g in groups:
        e = env_for(g, tours)
        if e and e not in envs:
            envs[e] = env_problem(e)
    stale_env = {e for e, why in envs.items() if why}

    renders, sizes, report = {}, [], []
    for e, why in envs.items():
        if why:
            report.append(f"env/{e}.exr: {why}")
    for g, stops in groups.items():
        e = env_for(g, tours)
        for s in stops:
            big = os.path.join(TOURS, g, f"{s['id']}-4096.webp")
            why = "its window view is being re-rendered" if e in stale_env else None
            why = image_problem(big, 4096, 2048, max(INTERIOR, mtime(os.path.join(ENV, f"{e}.exr")) if e else INTERIOR)) or why
            if why:
                renders.setdefault(g, []).append(s["id"])
                report.append(f"tours/{g}/{s['id']}-4096: {why}")
                continue
            small = big.replace("-4096.webp", "-2048.webp")
            why = image_problem(small, 2048, 1024, mtime(big))
            if why:
                sizes.append(small)
                report.append(f"tours/{g}/{s['id']}-2048: {why}")

    manifest = json.load(open(os.path.join(HERO, "manifest.json"), encoding="utf-8")) if os.path.exists(os.path.join(HERO, "manifest.json")) else {}
    hero = set()
    for orient in ("landscape", "portrait"):
        files = manifest.get("orientations", {}).get(orient, {})
        for shot in ("A", "C"):
            names = files.get(shot) or []
            if not names:
                hero.add(shot)
                report.append(f"cinematic/{orient} {shot}: not in manifest")
            for n in names:
                p = os.path.join(HERO, orient, n)
                why = None if os.path.exists(p) and cv2.imread(p, cv2.IMREAD_UNCHANGED) is not None else "missing or does not decode"
                why = why or ("older than the exterior scene" if mtime(p) < SCENE else None)
                if why:
                    hero.add(shot)
                    report.append(f"cinematic/{orient}/{n}: {why}")
    return stale_env, renders, sizes, hero, report


def main():
    stale_env, renders, sizes, hero, report = audit()
    if "--plan" in sys.argv:
        for e in sorted(stale_env):
            print(f"ENV {e}")
        tours = json.load(open(os.path.join(SRC, "tours.json"), encoding="utf-8"))
        every = {**tours["residences"], **tours["amenities"]}
        for g, ids in renders.items():
            # a group that needs every stop can share one Blender launch with the others
            print(f"RENDER {g} {'ALL' if len(ids) == len(every[g]['stops']) else ','.join(ids)}")
        if sizes:
            print("SIZES")
        if hero:
            print(f"HERO {','.join(sorted(hero))}")
        return
    if not report:
        print("All renders complete and current.")
        return
    print("\n".join(report))
    print(f"\n{sum(len(v) for v in renders.values())} panoramas to render, {len(sizes)} phone sizes, env: {sorted(stale_env) or '-'}, hero: {sorted(hero) or '-'}")
    sys.exit(1)


if __name__ == "__main__":
    main()
