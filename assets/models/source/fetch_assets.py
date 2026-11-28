"""Download the free CC0 furniture models and materials the tour renders use (Poly Haven + ambientCG).

    python assets/models/source/fetch_assets.py          # from the repo root; skips anything already there

Everything lands in assets/models/library/ (git-ignored): Poly Haven glTF models with 2K textures in
library/polyhaven/<id>/, ambientCG 2K JPG materials in library/ambientcg/<id>/ (only the colour, normal (GL),
roughness and AO maps are kept from each zip). Both libraries are CC0: free for commercial use, no credit needed.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
LIB = os.path.join(ROOT, "assets", "models", "library")
UA = {"User-Agent": "asset-fetcher/1.0"}

POLYHAVEN = [
    # seating
    "sofa_03", "sofa_02", "modern_arm_chair_01", "mid_century_lounge_chair", "Ottoman_01", "dining_chair_02",
    "bar_chair_round_01",
    # tables
    "modern_coffee_table_01", "coffee_table_round_01", "side_table_01", "side_table_tall_01",
    # decor
    "throw_pillows_01", "ceramic_vase_01", "ceramic_vase_02", "ceramic_vase_03", "ceramic_vase_04",
    "potted_plant_01", "potted_plant_02", "pachira_aquatica_01", "calathea_orbifolia_01", "modern_ceiling_lamp_01",
]
AMBIENTCG = ["Fabric061", "Leather037", "Marble016", "Rubber004"]
KEEP = ("_Color.jpg", "_NormalGL.jpg", "_Roughness.jpg", "_AmbientOcclusion.jpg")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def safe_join(base, rel):
    out = os.path.normpath(os.path.join(base, rel))
    if not out.startswith(os.path.normpath(base) + os.sep):
        raise ValueError(f"refusing path outside {base}: {rel}")
    return out


def polyhaven(asset):
    dst = os.path.join(LIB, "polyhaven", asset)
    if os.path.exists(os.path.join(dst, ".done")):
        return 0
    g = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))["gltf"]["2k"]["gltf"]
    files = {f"{asset}_2k.gltf": g["url"], **{rel: v["url"] for rel, v in g.get("include", {}).items()}}
    total = 0
    for rel, url in files.items():
        path = safe_join(dst, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = get(url)
        with open(path, "wb") as fh:
            fh.write(data)
        total += len(data)
    open(os.path.join(dst, ".done"), "w").close()
    return total


def ambientcg(asset):
    dst = os.path.join(LIB, "ambientcg", asset)
    if os.path.exists(os.path.join(dst, ".done")):
        return 0
    info = json.loads(get(f"https://ambientcg.com/api/v2/full_json?id={asset}&include=downloadData"))["foundAssets"][0]
    dls = [x for c in info["downloadFolders"].values() for cat in c["downloadFiletypeCategories"].values() for x in cat["downloads"]]
    url = next(x["downloadLink"] for x in dls if x.get("attribute") == "2K-JPG")
    data = get(url)
    os.makedirs(dst, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            base = os.path.basename(name)
            if base.endswith(KEEP) and "/" not in name.strip("/"):
                with open(safe_join(dst, base), "wb") as fh:
                    fh.write(z.read(name))
    open(os.path.join(dst, ".done"), "w").close()
    return len(data)


def main():
    total = 0
    for a in POLYHAVEN:
        n = polyhaven(a)
        total += n
        print(f"polyhaven {a:28s} {n / 1e6:6.1f} MB" if n else f"polyhaven {a:28s} (have it)", flush=True)
    for a in AMBIENTCG:
        n = ambientcg(a)
        total += n
        print(f"ambientcg {a:28s} {n / 1e6:6.1f} MB" if n else f"ambientcg {a:28s} (have it)", flush=True)
    print(f"downloaded {total / 1e6:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
