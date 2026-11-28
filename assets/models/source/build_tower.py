"""
Azure Crest Residences: procedural model (FICTIONAL project, style-inspired only).

Run headless (no Blender UI or skills needed):
  blender -b --factory-startup -P assets/models/source/build_tower.py -- \
      --seed assets/seed/project.json --out apps/web/public/models/azure-crest.glb \
      [--preview assets/models/previews] [--samples 64]

Contract with the website (packages/3d):
- 1 scene unit = 1 floor. Podium occupies 0..2, unit floor F spans 2+(F-3) .. 3+(F-3).
- Towers centred at x = BUILDING_OFFSET[b]; unit quadrants at +-UNIT_OFFSET.
- Every unit is its own mesh named exactly Unit.meshId (e.g. T1_F12_U02).
- Sea faces -Z in three.js (seed: positions 01/02 have sea/park views).
Blender is Z-up; glTF export converts to Y-up, so three (x, y, z) == Blender (x, -z, y).
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- constants (keep in sync with packages/3d/src/layout.ts)
BUILDING_OFFSET = {"T1": -8.0, "T2": 8.0}
UNIT_OFFSET = 1.9
POS_OFFSET = {"01": (-1, -1), "02": (1, -1), "03": (-1, 1), "04": (1, 1)}  # (dx, dz) signs in three.js space
PODIUM_TOP = 2.0
FLOOR_H = 1.0
SLAB_T = 0.14
CORE_HALF = 3.8  # glass line half-width
GLASS_R = 1.5  # corner radius of the glass line (rounded curtain-wall corners)
GLASS_DIV = 6  # mullion bays per half facade and per corner arc (~0.38 units = ~1.3 m)
SHAFT_HALF = 1.25  # structural core (lifts, stairs) half-width; homes wrap around it
# Seamless textures made by assets/images/prepare_images.py. The GLB embeds the 512 px set (web);
# cinematic.py switches TEX_DIR to the 2048 px set for its Cycles renders.
TEX_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "textures", "web"))


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--seed", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--preview", default=None)
    p.add_argument("--samples", type=int, default=64)
    return p.parse_args(argv)


def b(x, y, z):
    """three.js coords -> Blender coords."""
    return (x, -z, y)


# ---------------------------------------------------------------- deterministic RNG
class Rng:
    def __init__(self, seed):
        self.s = seed

    def __call__(self):
        self.s = (self.s * 16807) % 2147483647
        return self.s / 2147483647


# ---------------------------------------------------------------- materials
def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    r, g, bl = (int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    srgb = lambda c: ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    bsdf.inputs["Base Color"].default_value = (srgb(r), srgb(g), srgb(bl), 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        er, eg, eb = (int(emission[i : i + 2], 16) / 255 for i in (1, 3, 5))
        bsdf.inputs["Emission Color"].default_value = (srgb(er), srgb(eg), srgb(eb), 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def textured(name, tex, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    """PBR material whose base colour is a seamless texture (exported into the GLB as a JPEG)."""
    m = material(name, "#FFFFFF", metallic, roughness, emission, strength)
    nt = m.node_tree
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(os.path.join(TEX_DIR, tex + ".jpg"), check_existing=True)
    nt.links.new(img.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


def glass(name, color, alpha, roughness=0.05):
    m = material(name, color, metallic=0.0, roughness=roughness)
    m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = alpha
    m.blend_method = "BLEND"
    m.surface_render_method = "BLENDED"
    return m


def make_materials():
    return {
        "plaster": textured("Plaster", "plaster", roughness=0.55),
        "bronze": textured("Bronze", "bronze", metallic=0.85, roughness=0.32),
        "unit_glass": material("UnitGlass", "#9CC1D3", metallic=0.25, roughness=0.08),
        "dark_glass": material("PodiumGlass", "#3A4954", metallic=0.6, roughness=0.12, emission="#FFD9A0", strength=0.06),
        "crown_glass": material("CrownGlass", "#4E6672", metallic=0.7, roughness=0.04, emission="#FFCF96", strength=0.35),
        "pool": material("Pool", "#2EC4DD", metallic=0.1, roughness=0.05, emission="#2EC4DD", strength=0.25),
        "water": material("Lagoon", "#3E9CC0", metallic=0.05, roughness=0.12),
        "green": material("Planting", "#4C7A3E", roughness=0.85),
        "trunk": material("Trunk", "#8A6A48", roughness=0.9),
        "stone": textured("Stone", "travertine", roughness=0.75),
        "ground": material("Ground", "#D6C3A0", roughness=0.95),
        "road": material("Road", "#8D939A", roughness=0.85),
        "context": textured("Context", "city", metallic=0.45, roughness=0.2),  # assets/images/city_facade.py
        # curtain wall + what shows through it
        "mullion": material("Mullion", "#4A3B2D", metallic=0.85, roughness=0.32),
        "interior": material("InteriorWall", "#EFE6D8", roughness=0.85, emission="#FFE7C7", strength=0.12),
        "int_fabric": material("InteriorFabric", "#D8CDBC", roughness=0.95),
        "int_dark": material("InteriorDark", "#3E342B", roughness=0.6),
        "int_rug": material("InteriorRug", "#B9A88E", roughness=1.0),
        "int_light": material("InteriorLight", "#FFE0B5", emission="#FFC98A", strength=6.0),
        "sheer": glass("Sheer", "#F4EFE7", 0.72, roughness=0.9),
    }


# ---------------------------------------------------------------- geometry helpers (all coords Blender, Z-up)
def rounded_rect(cx, cy, hx, hy, r, seg=6):
    r = min(r, hx * 0.99, hy * 0.99)
    pts = []
    corners = [(cx + hx - r, cy - hy + r, -90), (cx + hx - r, cy + hy - r, 0), (cx - hx + r, cy + hy - r, 90), (cx - hx + r, cy - hy + r, 180)]
    for (ox, oy, start) in corners:
        for i in range(seg + 1):
            a = math.radians(start + 90 * i / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts  # CCW


def rect(cx, cy, hx, hy):
    return [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)]


def star(cx, cy, r_out, r_in, n=6, rot=0.0):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + math.pi * i / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def add_prism(bm, pts, z0, z1, smooth_sides=False):
    """Extruded polygon with separate cap/side vertices so caps stay flat."""
    n = len(pts)
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    sb = [bm.verts.new((x, y, z0)) for x, y in pts]
    st = [bm.verts.new((x, y, z1)) for x, y in pts]
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((sb[i], sb[j], st[j], st[i]))
        f.smooth = smooth_sides


def add_box(bm, cx, cy, z0, hx, hy, z1):
    add_prism(bm, rect(cx, cy, hx, hy), z0, z1)


def add_tapered(bm, pts, z0, z1, scale_top):
    """Prism whose top ring is scaled about the centroid (for palm crowns, context towers)."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    top_pts = [(cx + (x - cx) * scale_top, cy + (y - cy) * scale_top) for x, y in pts]
    n = len(pts)
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in top_pts]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))


def box_uv(bm, size):
    """World-scale box mapping: each face is projected along its dominant axis and one texture repeat
    covers `size` scene units, so every surface shows the material at the same real-world scale."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co
            u, v = ((c.y, c.z), (c.x, c.z), (c.x, c.y))[ax]
            loop[uv].uv = (u / size, v / size)


# Texture repeat size per material (scene units; 1 unit = 1 floor, about 3.4 m).
UV_SIZE = {"Plaster": 1.4, "Bronze": 1.0, "Stone": 0.8, "Teak": 0.6, "Sand": 2.5, "Context": 4.0}


def to_object(name, bm, mat, collection):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    if mat.name in UV_SIZE:
        box_uv(bm, UV_SIZE[mat.name])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def add_ring(bm, pts, inset, thick, z0, z1):
    """Thin wall following a closed outline (glass balustrades, cove strips)."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)

    def shrink(d):
        out = []
        for x, y in pts:
            vx, vy = x - cx, y - cy
            L = math.hypot(vx, vy) or 1
            out.append((x - vx / L * d, y - vy / L * d))
        return out

    outer, inner = shrink(inset), shrink(inset + thick)
    n = len(pts)
    ob = [bm.verts.new((x, y, z0)) for x, y in outer]
    ot = [bm.verts.new((x, y, z1)) for x, y in outer]
    ib = [bm.verts.new((x, y, z0)) for x, y in inner]
    it = [bm.verts.new((x, y, z1)) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ob[i], ob[j], ot[j], ot[i]))
        bm.faces.new((ib[j], ib[i], it[i], it[j]))
        bm.faces.new((ot[i], ot[j], it[j], it[i]))
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))


def add_band(bm, pts, inset, z0, z1):
    """Single vertical strip following a closed outline (double-sided glass, light strips): 1/4 of add_ring's geometry."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    ring = []
    for x, y in pts:
        vx, vy = x - cx, y - cy
        L = math.hypot(vx, vy) or 1
        ring.append((x - vx / L * inset, y - vy / L * inset))
    bot = [bm.verts.new((x, y, z0)) for x, y in ring]
    top = [bm.verts.new((x, y, z1)) for x, y in ring]
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((bot[i], bot[j], top[j], top[i]))
        f.smooth = True


def fnv_lit(unit_id, pct=38):
    """Same answer as isLit() in packages/3d/src/TowerModel.tsx: is this home's light on at golden hour?"""
    h = 2166136261
    for ch in unit_id:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h % 100 < pct


def glass_quadrant(bx, by, q):
    """Glass line of one quarter of the tower, CCW from the axis at q*90 deg to the axis at (q+1)*90 deg:
    a straight run, the rounded corner, another straight run. Returns [(x, y, nx, ny)] with outward normals;
    every point is a mullion position."""
    H, R, n = CORE_HALF, GLASS_R, GLASS_DIV
    a = q * math.pi / 2
    d0 = (math.cos(a), math.sin(a))
    d1 = (math.cos(a + math.pi / 2), math.sin(a + math.pi / 2))
    pts = []
    for k in range(n + 1):  # along the first facade, from the axis to the corner
        t = (H - R) * k / n
        pts.append((bx + d0[0] * H + d1[0] * t, by + d0[1] * H + d1[1] * t, d0[0], d0[1]))
    cx, cy = bx + (d0[0] + d1[0]) * (H - R), by + (d0[1] + d1[1]) * (H - R)
    for k in range(1, n + 1):
        th = a + (math.pi / 2) * k / n
        pts.append((cx + R * math.cos(th), cy + R * math.sin(th), math.cos(th), math.sin(th)))
    for k in range(1, n + 1):  # along the second facade, back to the next axis
        t = (H - R) * (n - k) / n
        pts.append((bx + d1[0] * H + d0[0] * t, by + d1[1] * H + d0[1] * t, d1[0], d1[1]))
    return pts


def glass_ring(bx, by):
    ring = []
    for q in range(4):
        ring += glass_quadrant(bx, by, q)[1:]
    return ring  # closed, CCW


def add_strip(bm, pts, z0, z1, off=0.0, smooth=True):
    """Open vertical strip through (x, y, nx, ny) points, pushed `off` along the normals; faces point outward."""
    bot = [bm.verts.new((x + nx * off, y + ny * off, z0)) for x, y, nx, ny in pts]
    top = [bm.verts.new((x + nx * off, y + ny * off, z1)) for x, y, nx, ny in pts]
    for i in range(len(pts) - 1):
        f = bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
        f.smooth = smooth


def add_frame_ring(bm, ring, off0, off1, z0, z1):
    """Band around a (x, y, nx, ny) ring standing off0..off1 proud of the glass: the outer face plus the top and
    bottom ledges (the inner face sits against the glass). Each face group has its own smooth-shaded vertices,
    so the export stays small and the edges stay crisp."""
    n = len(ring)

    def lay(off, z):
        return [bm.verts.new((x + nx * off, y + ny * off, z)) for x, y, nx, ny in ring]

    def quads(a, b_, flip=False):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[j], a[i], b_[i], b_[j]) if flip else (a[i], a[j], b_[j], b_[i]))
            f.smooth = True

    quads(lay(off1, z0), lay(off1, z1))  # outer face
    quads(lay(off1, z1), lay(off0, z1))  # top ledge
    quads(lay(off1, z0), lay(off0, z0), flip=True)  # soffit


def add_post(bm, x, y, nx, ny, w, d0, d1, z0, z1):
    """Vertical fin 2w wide (along the facade) from d0 to d1 out from the glass: its two sides and face only
    (the back is against the glass, the ends meet slabs)."""
    tx, ty = -ny, nx
    c = [(x + nx * d0 - tx * w, y + ny * d0 - ty * w), (x + nx * d1 - tx * w, y + ny * d1 - ty * w),
         (x + nx * d1 + tx * w, y + ny * d1 + ty * w), (x + nx * d0 + tx * w, y + ny * d0 + ty * w)]
    for i in range(3):  # side, face, side; wound so the normals point away from the fin
        (ax, ay), (bx_, by_) = c[i], c[i + 1]
        v = [bm.verts.new(p) for p in ((ax, ay, z0), (bx_, by_, z0), (bx_, by_, z1), (ax, ay, z1))]
        bm.faces.new(v)


def furnish(bms, bx, by, q, zf, zc, lit, rng):
    """A home seen through the glass: living group by one facade, dining by the other, sheers, lights when lit.
    Positions are (a, b) = distance out along the quadrant's two axes; half the homes are mirrored."""
    H = CORE_HALF
    a_dir = (round(math.cos(q * math.pi / 2)), round(math.sin(q * math.pi / 2)))
    b_dir = (round(math.cos((q + 1) * math.pi / 2)), round(math.sin((q + 1) * math.pi / 2)))
    if rng() < 0.5:
        a_dir, b_dir = b_dir, a_dir

    def box(key, a, b_, ha, hb, z0, z1):
        x, y = bx + a_dir[0] * a + b_dir[0] * b_, by + a_dir[1] * a + b_dir[1] * b_
        hx = abs(a_dir[0]) * ha + abs(b_dir[0]) * hb
        hy = abs(a_dir[1]) * ha + abs(b_dir[1]) * hb
        if z1 - z0 < 0.02:  # rugs and ceiling panels: one flat quad (materials are double-sided)
            bm_ = bms[key]
            z = z1 if key != "int_light" else z0
            v = [bm_.verts.new(p) for p in ((x - hx, y - hy, z), (x + hx, y - hy, z), (x + hx, y + hy, z), (x - hx, y + hy, z))]
            bm_.faces.new(v if key != "int_light" else v[::-1])
            return
        add_box(bms[key], x, y, z0, hx, hy, z1)

    # living: sofa facing the view along the b-facade, rug, coffee table, an armchair
    sa = 1.75 + rng() * 0.5
    box("int_rug", sa, H - 1.15, 0.55, 0.42, zf, zf + 0.006)
    box("int_fabric", sa, H - 1.62, 0.34, 0.1, zf, zf + 0.11)  # seat
    box("int_fabric", sa, H - 1.75, 0.34, 0.035, zf, zf + 0.23)  # back
    box("int_dark", sa, H - 1.12, 0.15, 0.09, zf, zf + 0.1)
    box("int_fabric", sa + 0.62, H - 0.95, 0.1, 0.1, zf, zf + 0.13)
    # dining by the a-facade
    da = H - 0.75
    box("int_dark", da, 2.0, 0.13, 0.27, zf + 0.2, zf + 0.22)
    box("int_dark", da, 2.0, 0.03, 0.2, zf, zf + 0.2)
    # sheer curtains drawn part-way along one facade
    if rng() < 0.6:
        b0 = 0.15 + rng() * 0.8
        b1 = min(H - GLASS_R - 0.05, b0 + 0.5 + rng() * 1.3)
        box("sheer", H - 0.05, (b0 + b1) / 2, 0.006, (b1 - b0) / 2, zf, zc - 0.01)
    if lit:
        box("int_light", sa, H - 1.2, 0.36, 0.2, zc - 0.012, zc)
        box("int_light", da, 2.0, 0.12, 0.3, zc - 0.012, zc)
        if rng() < 0.6:
            box("int_light", sa + 0.62, H - 0.95, 0.035, 0.035, zf + 0.13, zf + 0.42)  # floor lamp


def palm(trunk_bm, leaf_bm, x, y, z, height, seed=0.0, fronds=9, frond_len=1.35, segs=8):
    """Real-time coconut palm: gently leaning tapered trunk + drooping pinnate fronds (~180 triangles)."""
    rng = Rng(int(seed * 1000) + 11)
    lean = ((rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5)
    pts = []
    for i in range(7):
        t = i / 6
        pts.append((x + lean[0] * t * t, y + lean[1] * t * t, z + height * t))
    rings = []
    for i, (px, py, pz) in enumerate(pts):
        r = 0.1 * (1.0 - 0.35 * i / 6) * (1.2 if i == 0 else 1.0)
        rings.append([trunk_bm.verts.new((px + r * math.cos(a), py + r * math.sin(a), pz)) for a in (k * math.pi / 3 for k in range(6))])
    for i in range(6):
        for k in range(6):
            k2 = (k + 1) % 6
            trunk_bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    top = Vector(pts[-1])
    for f in range(fronds):
        az = 2 * math.pi * f / fronds + rng() * 0.5
        up = 0.5 - 0.85 * rng()
        L = frond_len * (0.8 + 0.4 * rng())
        dirv = Vector((math.cos(az), math.sin(az), 0))
        side = Vector((-math.sin(az), math.cos(az), 0))
        spine = [top + dirv * (L * s / segs) + Vector((0, 0, L * 0.45 * (up - 1.6 * (s / segs) ** 2) * (s / segs))) for s in range(segs + 1)]
        for s in range(1, segs - 1):
            t = s / segs
            leaflet = 0.42 * L * math.sin(math.pi * min(1.0, t * 1.08)) * (1 - 0.35 * t)
            for sgn in (-1, 1):
                a, b_ = spine[s], spine[s + 1]
                tip = a + side * (sgn * leaflet) + Vector((0, 0, -leaflet * (0.45 + t * 0.5))) + dirv * (leaflet * 0.45)
                leaf_bm.faces.new([leaf_bm.verts.new(q) for q in (a, b_, tip)])


def yacht(bm_hull, bm_glass, x, y, heading, L=4.0):
    W = L * 0.24
    ca, sa = math.cos(heading), math.sin(heading)

    def tr(px, py):
        return (x + px * ca - py * sa, y + px * sa + py * ca)

    hull = [(-L / 2, -W / 2), (L * 0.15, -W / 2), (L / 2, 0), (L * 0.15, W / 2), (-L / 2, W / 2)]
    add_tapered(bm_hull, [tr(*p) for p in hull], -0.55, -0.05, 1.0)
    add_tapered(bm_hull, [tr(*p) for p in hull], -0.75, -0.55, 0.88)
    cabin = [(-L * 0.35, -W * 0.36), (L * 0.1, -W * 0.36), (L * 0.22, 0), (L * 0.1, W * 0.36), (-L * 0.35, W * 0.36)]
    add_tapered(bm_glass, [tr(*p) for p in cabin], -0.05, 0.22, 0.92)
    top = [(-L * 0.3, -W * 0.3), (L * 0.02, -W * 0.3), (L * 0.1, 0), (L * 0.02, W * 0.3), (-L * 0.3, W * 0.3)]
    add_tapered(bm_hull, [tr(*p) for p in top], 0.22, 0.3, 1.0)

# ---------------------------------------------------------------- builders
def build_tower(bid, floors, units, M, col, rng):
    ox = BUILDING_OFFSET[bid]
    bx, by = ox, 0.0  # tower centre in Blender XY (three z = 0)

    slabs, fins, planters, crown_frame, rails = (bmesh.new() for _ in range(5))
    top_unit_floor = floors
    roof_z = PODIUM_TOP + (top_unit_floor - 2) * FLOOR_H  # top of last unit floor

    # Floor slabs with gently undulating balcony edges (organic, ref-inspired).
    for f in range(3, top_unit_floor + 2):
        z0 = PODIUM_TOP + (f - 3) * FLOOR_H
        wave = math.sin(f * 0.75 + (0 if bid == "T1" else 1.3))
        hx = CORE_HALF + 0.55 + 0.35 * wave
        hy = CORE_HALF + 0.55 - 0.35 * wave
        if f == top_unit_floor + 1:  # roof slab
            hx = hy = CORE_HALF + 0.35
        add_prism(slabs, rounded_rect(bx, by, hx, hy, 1.4, 8), z0, z0 + SLAB_T, smooth_sides=True)
        if 3 < f <= top_unit_floor:  # slim bronze handrail capping the glass balustrade
            add_band(rails, rounded_rect(bx, by, hx, hy, 1.4, 8), 0.035, z0 + SLAB_T + 0.3, z0 + SLAB_T + 0.325)
        # Planters on a few balconies.
        if f <= top_unit_floor and rng() < 0.3:
            side = int(rng() * 4)
            off = (rng() - 0.5) * 4.0
            px, py = {0: (bx + off, by - hy + 0.3), 1: (bx + off, by + hy - 0.3), 2: (bx - hx + 0.3, by + off), 3: (bx + hx - 0.3, by + off)}[side]
            add_box(planters, px, py, z0 + SLAB_T, 0.7 if side < 2 else 0.16, 0.16 if side < 2 else 0.7, z0 + SLAB_T + 0.18)

    # Unit glazing: one named mesh per unit (the pickable objects) = that home's run of curtain wall,
    # following the rounded glass line. Open strips (no caps): the slabs above and below close them.
    QUAD = {(1, 1): 0, (-1, 1): 1, (-1, -1): 2, (1, -1): 3}  # Blender (x, y) signs -> glass_quadrant index
    ints = {k: bmesh.new() for k in ("int_fabric", "int_dark", "int_rug", "int_light", "sheer")}
    frng = Rng(1009 if bid == "T1" else 2027)  # own stream: the site's palms and planters stay where they were
    for u in units:
        sx, sz = POS_OFFSET[u["code"][-2:]]
        q = QUAD[(sx, -sz)]  # three z -> Blender -y
        z0 = PODIUM_TOP + (u["floor"] - 3) * FLOOR_H + SLAB_T
        z1 = PODIUM_TOP + (u["floor"] - 2) * FLOOR_H
        pts = glass_quadrant(bx, by, q)
        g = 0.012  # hairline gap at the party walls so neighbouring homes never share a face
        x0, y0, nx0, ny0 = pts[0]
        x1, y1, nx1, ny1 = pts[-1]
        pts[0] = (x0 - ny0 * g, y0 + nx0 * g, nx0, ny0)  # step along the tangent, into this quadrant
        pts[-1] = (x1 + ny1 * g, y1 - nx1 * g, nx1, ny1)
        ubm = bmesh.new()
        add_strip(ubm, pts, z0 + 0.004, z1 - 0.004)
        to_object(u["meshId"], ubm, M["unit_glass"], col)
        furnish(ints, bx, by, q, z0, z1, fnv_lit(u["id"]), frng)
    for k, bm_ in ints.items():
        to_object(f"{bid}_Int_{k}", bm_, M[k], col)

    # Structure behind the glass: the core and the party walls between the four homes on each floor.
    core = bmesh.new()
    add_prism(core, rounded_rect(bx, by, SHAFT_HALF, SHAFT_HALF, 0.25, 3), PODIUM_TOP, roof_z)
    span = (CORE_HALF - 0.02 - SHAFT_HALF) / 2
    for sgn in (-1, 1):
        add_box(core, bx + sgn * (SHAFT_HALF + span), by, PODIUM_TOP, span, 0.03, roof_z)
        add_box(core, bx, by + sgn * (SHAFT_HALF + span), PODIUM_TOP, 0.03, span, roof_z)
    to_object(f"{bid}_Core", core, M["interior"], col)

    # Curtain-wall frame: a mullion at every bay (full height) and a transom band at every floor line.
    frame = bmesh.new()
    ring = glass_ring(bx, by)
    for (x, y, nx, ny) in ring:
        add_post(frame, x, y, nx, ny, 0.016, -0.01, 0.075, PODIUM_TOP + SLAB_T, roof_z)
    for f in range(3, top_unit_floor + 2):
        z = PODIUM_TOP + (f - 3) * FLOOR_H
        add_frame_ring(frame, ring, -0.01, 0.06, z - 0.035, z + SLAB_T + 0.04)
    to_object(f"{bid}_Mullions", frame, M["mullion"], col)

    # Bronze fins on the centre line of each facade (also hides the seam between unit volumes).
    for (fx, fy, hx, hy) in [
        (bx, by - CORE_HALF - 0.08, 0.07, 0.22),
        (bx, by + CORE_HALF + 0.08, 0.07, 0.22),
        (bx - CORE_HALF - 0.08, by, 0.22, 0.07),
        (bx + CORE_HALF + 0.08, by, 0.22, 0.07),
    ]:
        add_box(fins, fx, fy, PODIUM_TOP, hx, hy, roof_z + SLAB_T)

    # Crown: glass sky-lounge set back to the city side; open sea-facing terrace with infinity pool.
    # (Blender +y == three -z == sea.)
    cz = roof_z + SLAB_T
    pav_cy, pav_hx, pav_hy = by - 1.0, CORE_HALF - 0.5, CORE_HALF - 1.6
    crown = bmesh.new()
    add_prism(crown, rounded_rect(bx, pav_cy, pav_hx, pav_hy, 0.9, 8), cz, cz + 1.6, smooth_sides=True)
    to_object(f"{bid}_CrownGlass", crown, M["crown_glass"], col)
    pool = bmesh.new()
    add_prism(pool, rounded_rect(bx, by + 2.55, CORE_HALF - 1.4, 0.75, 0.3, 4), cz, cz + 0.06)
    to_object(f"{bid}_RoofPool", pool, M["pool"], col)
    add_prism(slabs, rounded_rect(bx, pav_cy + 0.3, pav_hx + 0.45, pav_hy + 0.6, 1.1, 8), cz + 1.6, cz + 1.78, smooth_sides=True)
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        add_box(crown_frame, bx + sx * (pav_hx - 0.45), pav_cy + sy * (pav_hy - 0.45), cz, 0.07, 0.07, cz + 1.6)
    pav = rounded_rect(bx, pav_cy, pav_hx, pav_hy, 0.9, 8)
    for i in range(0, len(pav), 2):  # mullions around the sky-lounge glazing
        (xa, ya), (xb, yb) = pav[i], pav[(i + 1) % len(pav)]
        L = math.hypot(xb - xa, yb - ya) or 1
        add_post(crown_frame, xa, ya, (yb - ya) / L, -(xb - xa) / L, 0.015, 0.0, 0.06, cz, cz + 1.6)
    # Slim bronze handrail on top of the terrace's glass balustrade.
    add_box(crown_frame, bx, by + CORE_HALF + 0.22, cz + 0.33, CORE_HALF + 0.1, 0.025, cz + 0.37)

    to_object(f"{bid}_Slabs", slabs, M["plaster"], col)
    to_object(f"{bid}_Fins", fins, M["bronze"], col)
    to_object(f"{bid}_Handrails", rails, M["bronze"], col)
    to_object(f"{bid}_Planters", planters, M["green"], col)
    to_object(f"{bid}_CrownFrame", crown_frame, M["bronze"], col)


def build_podium(M, col):
    glass, mass, deck, pool, green = (bmesh.new() for _ in range(5))
    add_prism(glass, rounded_rect(0, 0, 14.2, 6.2, 2.0, 8), 0.0, 0.95, smooth_sides=True)
    add_prism(mass, rounded_rect(0, 0, 14.6, 6.6, 2.2, 8), 0.95, PODIUM_TOP - 0.02, smooth_sides=True)
    add_prism(mass, rounded_rect(0, 0, 15.0, 7.0, 2.4, 8), PODIUM_TOP - 0.02, PODIUM_TOP + 0.1, smooth_sides=True)
    # Deck pool between the towers, facing the sea (three -z == Blender +y).
    add_prism(pool, rounded_rect(0, 2.2, 2.6, 3.2, 0.8, 6), PODIUM_TOP + 0.1, PODIUM_TOP + 0.14)
    for x in (-3.4, 3.4):
        add_box(green, x, 0, PODIUM_TOP + 0.1, 0.35, 5.5, PODIUM_TOP + 0.45)
    add_box(green, 0, -4.5, PODIUM_TOP + 0.1, 3.0, 0.35, PODIUM_TOP + 0.45)
    fins, cove = bmesh.new(), bmesh.new()
    outline = rounded_rect(0, 0, 14.2, 6.2, 2.0, 8)
    per = [math.dist(outline[i], outline[(i + 1) % len(outline)]) for i in range(len(outline))]
    total, s_, acc, i = sum(per), 0.0, 0.0, 0
    while s_ < total - 1e-6:
        while acc + per[i] < s_:
            acc += per[i]
            i += 1
        (xa, ya), (xb, yb) = outline[i], outline[(i + 1) % len(outline)]
        t = (s_ - acc) / (per[i] or 1)
        x, y = xa + (xb - xa) * t, ya + (yb - ya) * t
        L = per[i] or 1
        nx, ny = (yb - ya) / L, -(xb - xa) / L  # outward for a CCW outline
        add_post(fins, x, y, nx, ny, 0.02, 0.0, 0.12, 0.0, 0.95)  # lobby fins
        add_post(fins, x + nx * 0.4, y + ny * 0.4, nx, ny, 0.015, 0.0, 0.1, 0.97, PODIUM_TOP - 0.04)  # louvres
        s_ += 0.42
    add_prism(mass, rounded_rect(0, -7.5, 4.6, 1.3, 0.9, 6), 0.95, 1.03, smooth_sides=True)  # entrance canopy
    add_prism(cove, rounded_rect(0, -7.5, 4.3, 1.05, 0.7, 6), 0.943, 0.95)
    to_object("Podium_Fins", fins, M["bronze"], col)
    to_object("Podium_CanopyLight", cove, M["int_light"], col)
    to_object("Podium_Glass", glass, M["dark_glass"], col)
    to_object("Podium", mass, M["plaster"], col)
    to_object("Podium_Pool", pool, M["pool"], col)
    to_object("Podium_Planting", green, M["green"], col)


def build_site(M, col, rng):
    ground, plaza, water, road, trunks, fronds, ctx = (bmesh.new() for _ in range(7))
    add_box(ground, 0, -34.5, -0.25, 90, 46, -0.1)  # land (Blender y -80..11.5)
    add_prism(plaza, rounded_rect(0, -1, 26, 11, 4, 8), -0.1, 0.0)
    add_box(plaza, 0, 11.0, -0.3, 90, 1.0, 0.0)  # promenade / quay edge
    add_box(water, 0, 52, -0.6, 140, 40, -0.4)  # lagoon on the sea side
    add_box(road, 0, -16.5, -0.1, 90, 2.6, -0.04)

    # Palms along the promenade and around the plaza.
    spots = [(x, 9.6) for x in range(-22, 23, 4) if abs(x) > 2] + [(-24, y) for y in (-8, -2, 4)] + [(24, y) for y in (-8, -2, 4)] + [(x, -12.5) for x in (-18, -10, 10, 18)]
    for i, (x, y) in enumerate(spots):
        h = 2.4 + rng() * 0.8
        palm(trunks, fronds, x, y, 0.0, h, seed=rng() * 3 + i)

    # Low-poly context skyline on the city side and flanks (never on the water side).
    for i in range(22):
        x = (rng() - 0.5) * 160
        y = -36 - rng() * 40
        hx, hy = 2.0 + rng() * 2.5, 2.0 + rng() * 2.5
        h = 3 + rng() * (10 if abs(x) < 30 else 16)
        add_tapered(ctx, rounded_rect(x, y, hx, hy, 0.6, 3), -0.1, h, 0.92)

    to_object("Site_Ground", ground, M["ground"], col)
    to_object("Site_Plaza", plaza, M["stone"], col)
    to_object("Site_Lagoon", water, M["water"], col)
    to_object("Site_Road", road, M["road"], col)
    to_object("Site_PalmTrunks", trunks, M["trunk"], col)
    to_object("Site_PalmFronds", fronds, M["green"], col)
    to_object("Context_Buildings", ctx, M["context"], col)


# ---------------------------------------------------------------- previews
def setup_render(samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            if any(d.type == backend for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == backend
                scn.cycles.device = "GPU"
                break
        except Exception:
            continue
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = 1600, 900
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("Sky")
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(9)
    sky.sun_rotation = math.radians(215)
    sky.air_density = 1.4
    sky.dust_density = 2.5
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 0.35


def render_view(name, cam_three, target_three, lens, out_dir):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = b(*cam_three)
    tgt = bpy.data.objects.new(name + "_target", None)
    bpy.context.scene.collection.objects.link(tgt)
    tgt.location = b(*target_three)
    c = cam.constraints.new("TRACK_TO")
    c.target = tgt
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = os.path.join(out_dir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {name}.png")


# ---------------------------------------------------------------- real-time extras (GLB only; cinematic.py has its own)
def build_glb_extras(seed, M, col):
    """Detail that makes the live model read as built and sited on the water: glass balustrades and cove
    lights on every balcony, a furnished teak roof deck, and the waterfront (land to the horizon, beaches,
    boardwalk, marina with yachts, palm islands). The water surface itself is animated live in packages/3d."""
    X = {
        "teak": textured("Teak", "teak", roughness=0.55),
        "sand": material("Sand", "#E4D3B0", roughness=0.95),
        "linen": material("Linen", "#F1ECE2", roughness=0.8),
        "rail": glass("RailGlass", "#D9EBEE", 0.22),
        "cove": material("Cove", "#FFC789", emission="#FFC789", strength=2.0),
        "hull": material("Hull", "#F6F5F1", roughness=0.2),
        "yacht_glass": material("YachtGlass", "#1A2227", metallic=0.3, roughness=0.05),
        "pole": material("LampPole", "#3A3530", metallic=0.8, roughness=0.5),
        "lamp": material("Lamp", "#FFD29A", emission="#FFD29A", strength=4.0),
        "lawn": material("Lawn", "#6F8F4A", roughness=0.95),
        "canopy": material("Canopy", "#4F7336", roughness=0.9),
    }

    # Balconies + roof terraces, mirroring build_tower's slab maths.
    for bdef in seed["project"]["buildings"]:
        bid, floors = bdef["id"], bdef["floors"]
        bx, by = BUILDING_OFFSET[bid], 0.0
        rail, cove = bmesh.new(), bmesh.new()
        for f in range(3, floors + 1):
            z0 = PODIUM_TOP + (f - 3) * FLOOR_H
            wave = math.sin(f * 0.75 + (0 if bid == "T1" else 1.3))
            outline = rounded_rect(bx, by, CORE_HALF + 0.55 + 0.35 * wave, CORE_HALF + 0.55 - 0.35 * wave, 1.4, 8)
            if f > 3:
                add_band(rail, outline, 0.05, z0 + SLAB_T, z0 + SLAB_T + 0.3)
            add_band(cove, outline, 0.12, z0 - 0.014, z0 + 0.001)
        to_object(f"{bid}_Balustrade", rail, X["rail"], col)
        to_object(f"{bid}_Cove", cove, X["cove"], col)

        cz = PODIUM_TOP + (floors - 2) * FLOOR_H + SLAB_T
        deck, frame, cushion, tglass, green = (bmesh.new() for _ in range(5))
        add_prism(deck, rounded_rect(bx, by + 0.5, CORE_HALF + 0.2, 3.75, 1.2, 8), cz - 0.01, cz + 0.004)
        for side in (-1, 1):
            for k in range(3):
                lx, ly = bx + side * (CORE_HALF - 1.05), by + 1.75 + k * 0.55
                add_box(frame, lx, ly, cz, 0.12, 0.22, cz + 0.05)
                add_box(cushion, lx, ly - 0.03, cz + 0.05, 0.11, 0.19, cz + 0.08)
                add_box(cushion, lx, ly + 0.17, cz + 0.05, 0.11, 0.05, cz + 0.13)
            add_box(green, bx + side * (CORE_HALF - 0.1), by + 1.35, cz, 0.25, 0.18, cz + 0.22)
        add_box(tglass, bx, by + CORE_HALF + 0.22, cz, CORE_HALF + 0.1, 0.01, cz + 0.36)
        to_object(f"{bid}_Deck", deck, X["teak"], col)
        to_object(f"{bid}_Loungers", frame, M["bronze"], col)
        to_object(f"{bid}_Cushions", cushion, X["linen"], col)
        to_object(f"{bid}_TerraceGlass", tglass, X["rail"], col)
        to_object(f"{bid}_RoofPlanting", green, M["green"], col)
        # Sit the pool just proud of the deck. Move the vertices: the web viewer uses geometry, not object transforms.
        bpy.data.objects[f"{bid}_RoofPool"].data.transform(Matrix.Translation((0, 0, -0.05)))

    # Land to the horizon on the city side (replaces the plot-sized ground; the live water fills the rest).
    bpy.data.objects.remove(bpy.data.objects["Site_Ground"])
    bpy.data.objects.remove(bpy.data.objects["Site_Lagoon"])
    land = bmesh.new()
    add_box(land, 0, -194.25, -0.25, 400, 205.75, -0.1)
    to_object("Site_Ground", land, M["ground"], col)

    # Beaches either side of the quay: a curved shoreline sloping under the waterline (water at z = -0.4).
    sand, groyne = bmesh.new(), bmesh.new()
    xs = [30 + 1.5 * i for i in range(61)] + [125 + 25 * i for i in range(12)]
    for sgn in (-1, 1):
        cols = []
        for ax in xs:
            w = 6.0 + 3.0 * math.sin((ax - 30) / 18.0) * math.exp(-(ax - 30) / 90.0) + 1.5 * math.sin(ax / 7.0)
            x = sgn * ax
            cols.append([sand.verts.new(v) for v in ((x, 11.0, -0.07), (x, 12.0 + 0.45 * w, -0.3), (x, 12.0 + w, -0.9))])
        for c0, c1 in zip(cols, cols[1:]):
            for r in range(2):
                quad = (c0[r], c1[r], c1[r + 1], c0[r + 1]) if sgn > 0 else (c1[r], c0[r], c0[r + 1], c1[r + 1])
                sand.faces.new(quad)
        add_box(groyne, sgn * 30, 15.0, -0.9, 0.7, 3.2, 0.05)  # stone groyne where the quay meets the beach
    to_object("Site_Beach", sand, X["sand"], col)
    to_object("Site_Groynes", groyne, M["stone"], col)

    # Travertine promenade on the quay + lamps.
    board, poles, lamps = bmesh.new(), bmesh.new(), bmesh.new()
    add_box(board, 0, 11.05, 0.0, 90, 0.85, 0.02)
    for x in range(-87, 88, 6):
        add_box(poles, x, 11.75, 0.02, 0.025, 0.025, 1.05)
        add_box(lamps, x, 11.75, 1.05, 0.07, 0.07, 1.17)
    to_object("Site_Promenade", board, M["stone"], col)
    to_object("Site_LampPoles", poles, X["pole"], col)
    to_object("Site_Lamps", lamps, X["lamp"], col)

    # Marina on the sea side, in front of Tower 2 (foreground of the home camera): pontoons + moored yachts.
    pont, hull, yglass = bmesh.new(), bmesh.new(), bmesh.new()
    add_box(pont, 21, 20, -0.34, 0.55, 8, -0.24)
    for yk in (14, 18, 22, 26):
        add_box(pont, 21, yk, -0.34, 4.2, 0.18, -0.25)
    for (x, y, hd, L) in [(18.4, 16, 0.0, 3.4), (23.6, 16, math.pi, 3.8), (18.2, 20, 0.0, 3.0), (23.8, 24, math.pi, 4.2), (18.5, 24, 0.0, 3.6),
                          (-26, 24, 0.25, 3.6), (40, 34, 2.9, 4.4), (-48, 40, 3.3, 3.0)]:
        yacht(hull, yglass, x, y, hd, L)
    to_object("Marina_Pontoons", pont, X["teak"], col)
    to_object("Yacht_Hulls", hull, X["hull"], col)
    to_object("Yacht_Glass", yglass, X["yacht_glass"], col)

    # The city behind: only a hazy, glassy downtown skyline breaking the horizon well back from the site
    # (nearby blocks read as clutter around the towers, so the foreground stays open land and landscaping).
    bpy.data.objects.remove(bpy.data.objects["Context_Buildings"])
    crng = Rng(91)
    city = bmesh.new()

    def block(x, y, hx, hy, h):
        add_tapered(city, rounded_rect(x, y, hx, hy, 0.3 + crng() * min(hx, hy) * 0.6, 1), -0.1, h, 0.9 + 0.1 * crng())

    for _ in range(140):  # downtown skyline, taller towards the middle distance
        x, y = (crng() - 0.5) * 760, -110 - crng() ** 0.8 * 280
        core = math.exp(-(((x + 60) / 180.0) ** 2))
        block(x, y, 2.5 + crng() * 4, 2.5 + crng() * 4, 4 + crng() * (10 + 34 * core))
    to_object("Context_City", city, M["context"], col)

    # Landscaping: lawns either side of the plaza, a park strip along the road, and shade trees.
    lawn, canopy, tree_trunks = bmesh.new(), bmesh.new(), bmesh.new()
    lrng = Rng(57)
    for sgn in (-1, 1):
        add_prism(lawn, rounded_rect(sgn * 44, -1.5, 13, 8.5, 3, 6), -0.1, 0.01)
    add_prism(lawn, rounded_rect(0, -23.5, 82, 3.2, 1.5, 4), -0.1, 0.01)

    def shade_tree(x, y, h, r):
        add_tapered(tree_trunks, rounded_rect(x, y, 0.08, 0.08, 0.07, 1), 0.0, h * 0.55, 0.8)
        pts = [(x + r * math.cos(a), y + r * math.sin(a)) for a in (k * math.pi / 4 + 0.3 for k in range(8))]
        add_tapered(canopy, pts, h * 0.45, h * 0.8, 1.25)
        add_tapered(canopy, [(x + (px - x) * 1.25, y + (py - y) * 1.25) for px, py in pts], h * 0.8, h, 0.35)

    for _ in range(60):
        x, y = (lrng() - 0.5) * 160, -23.5 + (lrng() - 0.5) * 5
        if abs(x) > 3:
            shade_tree(x, y, 1.2 + lrng() * 0.8, 0.5 + lrng() * 0.35)
    for sgn in (-1, 1):
        for _ in range(14):
            shade_tree(sgn * (34 + lrng() * 20), -8 + lrng() * 13, 1.1 + lrng() * 0.7, 0.45 + lrng() * 0.3)
    to_object("Site_Lawns", lawn, X["lawn"], col)
    to_object("Site_TreeCanopies", canopy, X["canopy"], col)
    to_object("Site_TreeTrunks", tree_trunks, M["trunk"], col)

    # Two low palm islands across the lagoon give the water depth and scale.
    isl, isl_green, trunks, fronds = (bmesh.new() for _ in range(4))
    for k, (x, y, hx, hy) in enumerate([(-55, 72, 10, 5), (62, 88, 13, 6)]):
        add_tapered(isl, rounded_rect(x, y, hx, hy, 4, 6), -0.9, 0.12, 0.72)
        add_tapered(isl_green, rounded_rect(x, y, hx * 0.55, hy * 0.5, 2.5, 6), 0.12, 0.35, 0.8)
        for j in range(6):
            palm(trunks, fronds, x + (j - 2.5) * hx * 0.16, y + ((j * 7) % 5 - 2) * 0.5, 0.3, 2.4 + (j % 3) * 0.4, seed=40 + k * 10 + j)
    to_object("Site_Islands", isl, X["sand"], col)
    to_object("Site_IslandPlanting", isl_green, M["green"], col)
    to_object("Site_IslandPalmTrunks", trunks, M["trunk"], col)
    to_object("Site_IslandPalmFronds", fronds, M["green"], col)

# ---------------------------------------------------------------- main
def main():
    args = parse_args()
    with open(args.seed, encoding="utf-8") as fh:
        seed = json.load(fh)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection
    M = make_materials()
    rng = Rng(7)

    for bdef in seed["project"]["buildings"]:
        units = [u for u in seed["units"] if u["building"] == bdef["id"]]
        build_tower(bdef["id"], bdef["floors"], units, M, col, rng)
    build_podium(M, col)
    build_site(M, col, rng)
    build_glb_extras(seed, M, col)

    unit_ids = {u["meshId"] for u in seed["units"]}
    unit_meshes = [o for o in bpy.data.objects if o.name in unit_ids]
    assert len(unit_meshes) == len(unit_ids), "every seed unit must have exactly one mesh"
    print(f"UNITS {len(unit_meshes)} OBJECTS {len(bpy.data.objects)}")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(args.out),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_image_format="JPEG",
        export_jpeg_quality=82,
    )
    print(f"EXPORTED {args.out}")

    if args.preview:
        args.preview = os.path.abspath(args.preview)
        os.makedirs(args.preview, exist_ok=True)
        setup_render(args.samples)
        sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
        sun.data.energy = 3.5
        sun.data.color = (1.0, 0.86, 0.7)
        sun.data.angle = math.radians(3)
        sun.rotation_euler = (math.radians(70), 0, math.radians(215))
        col.objects.link(sun)
        render_view("hero", (34, 20, -52), (0, 12, 0), 35, args.preview)
        render_view("aerial", (-46, 48, -40), (0, 6, 0), 32, args.preview)
        render_view("closeup", (14, 18, -20), (-6, 16, 0), 30, args.preview)


if __name__ == "__main__":  # importable by cinematic.py
    main()
