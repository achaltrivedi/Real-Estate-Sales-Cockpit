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

# ---------------------------------------------------------------- constants (keep in sync with packages/3d/src/layout.ts)
BUILDING_OFFSET = {"T1": -8.0, "T2": 8.0}
UNIT_OFFSET = 1.9
POS_OFFSET = {"01": (-1, -1), "02": (1, -1), "03": (-1, 1), "04": (1, 1)}  # (dx, dz) signs in three.js space
PODIUM_TOP = 2.0
FLOOR_H = 1.0
SLAB_T = 0.14
CORE_HALF = 3.8  # glass line half-width


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


def make_materials():
    return {
        "plaster": material("Plaster", "#F3EFE8", roughness=0.55),
        "bronze": material("Bronze", "#9A7448", metallic=0.85, roughness=0.32),
        "unit_glass": material("UnitGlass", "#9CC1D3", metallic=0.25, roughness=0.08),
        "dark_glass": material("PodiumGlass", "#3A4954", metallic=0.6, roughness=0.12, emission="#FFD9A0", strength=0.15),
        "crown_glass": material("CrownGlass", "#A9D8E6", metallic=0.3, roughness=0.05, emission="#BFEFFF", strength=0.35),
        "pool": material("Pool", "#2EC4DD", metallic=0.1, roughness=0.05, emission="#2EC4DD", strength=0.25),
        "water": material("Lagoon", "#3E9CC0", metallic=0.05, roughness=0.12),
        "green": material("Planting", "#4C7A3E", roughness=0.85),
        "trunk": material("Trunk", "#8A6A48", roughness=0.9),
        "stone": material("Stone", "#E6DECF", roughness=0.9),
        "ground": material("Ground", "#D9CDB6", roughness=0.95),
        "road": material("Road", "#8D939A", roughness=0.85),
        "context": material("Context", "#CBD4DC", roughness=0.7),
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


def to_object(name, bm, mat, collection):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- builders
def build_tower(bid, floors, units, M, col, rng):
    ox = BUILDING_OFFSET[bid]
    bx, by = ox, 0.0  # tower centre in Blender XY (three z = 0)

    slabs, fins, planters, crown_frame = (bmesh.new() for _ in range(4))
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
        # Planters on a few balconies.
        if f <= top_unit_floor and rng() < 0.3:
            side = int(rng() * 4)
            off = (rng() - 0.5) * 4.0
            px, py = {0: (bx + off, by - hy + 0.3), 1: (bx + off, by + hy - 0.3), 2: (bx - hx + 0.3, by + off), 3: (bx + hx - 0.3, by + off)}[side]
            add_box(planters, px, py, z0 + SLAB_T, 0.7 if side < 2 else 0.16, 0.16 if side < 2 else 0.7, z0 + SLAB_T + 0.18)

    # Unit glass volumes: one named mesh per unit (the pickable objects).
    for u in units:
        pos = u["code"][-2:]
        sx, sz = POS_OFFSET[pos]
        cx, cy, _ = b(ox + sx * UNIT_OFFSET, 0, sz * UNIT_OFFSET)
        z0 = PODIUM_TOP + (u["floor"] - 3) * FLOOR_H + SLAB_T
        z1 = PODIUM_TOP + (u["floor"] - 2) * FLOOR_H
        half = CORE_HALF / 2 - 0.02
        ubm = bmesh.new()
        add_box(ubm, cx, cy, z0, half, half, z1)
        to_object(u["meshId"], ubm, M["unit_glass"], col)

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
    # Slim bronze handrail on top of the terrace's glass balustrade.
    add_box(crown_frame, bx, by + CORE_HALF + 0.22, cz + 0.33, CORE_HALF + 0.1, 0.025, cz + 0.37)

    to_object(f"{bid}_Slabs", slabs, M["plaster"], col)
    to_object(f"{bid}_Fins", fins, M["bronze"], col)
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
    for (x, y) in spots:
        h = 2.4 + rng() * 0.8
        add_tapered(trunks, rounded_rect(x, y, 0.13, 0.13, 0.12, 2), 0.0, h, 0.7)
        add_tapered(fronds, star(x, y, 1.2, 0.3, 6, rng() * 3), h - 0.15, h + 0.1, 0.35)

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
