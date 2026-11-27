"""
Azure Crest Residences: photoreal golden-hour renders for the website's scroll-dive hero (FICTIONAL project).

Reuses the geometry from build_tower.py, then adds render-only dressing (glass balustrades, cove lights,
lit interiors, detailed palms, yachts, beach, skyline haze) and renders depth LAYERS with transparent
backgrounds so the web page can move them at different speeds (parallax).

  blender -b --factory-startup -P assets/models/source/cinematic.py -- \
      --seed assets/seed/project.json --out apps/web/public/cinematic [--quality draft|final] [--beauty]

Shots (sun low over the sea, +Y in Blender):
  A  "waterfront": from the beach across the lagoon. Layers: sky (opaque), towers, mid, fg.
  C  "rooftop":    from Tower 1's sky terrace towards the sunset. Layers: view (opaque), terrace.
Each shot renders in landscape (16:9) and portrait (9:16). A manifest.json records the files and the
crown's on-screen rectangle in shot A, which the page uses as the portal into shot C.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tower as bt  # noqa: E402

SUN_ELEV = 3.2  # degrees
SUN_ROT = 18.0  # degrees from +Y (sea)


def parse_args():
    import argparse

    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--seed", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--quality", default="final", choices=["draft", "final"])
    p.add_argument("--beauty", action="store_true", help="single combined frame per shot (look development)")
    p.add_argument("--only", default="A,C")
    p.add_argument("--orient", default="landscape,portrait")
    return p.parse_args(argv)


# ---------------------------------------------------------------- node helpers
def srgb(hexc):
    f = lambda c: ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    return tuple(f(int(hexc[i : i + 2], 16) / 255) for i in (1, 3, 5)) + (1.0,)


class NT:
    """Tiny shader-graph builder."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.t = mat.node_tree
        self.t.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial")

    def n(self, kind, **props):
        node = self.t.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.t.links.new(a, b)

    def math(self, op, a, b=None):
        m = self.n("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def mix_rgb(self, fac, a, b):
        m = self.n("ShaderNodeMix", data_type="RGBA")
        ins = {s.identifier: s for s in m.inputs}
        for key, v in (("Factor_Float", fac), ("A_Color", a), ("B_Color", b)):
            if isinstance(v, (int, float)) or isinstance(v, tuple):
                ins[key].default_value = v
            else:
                self.link(v, ins[key])
        return [s for s in m.outputs if s.identifier == "Result_Color"][0]

    def principled(self, color=None, rough=0.5, metal=0.0, **inputs):
        p = self.n("ShaderNodeBsdfPrincipled")
        if isinstance(color, tuple):
            p.inputs["Base Color"].default_value = color
        elif color is not None:
            self.link(color, p.inputs["Base Color"])
        p.inputs["Roughness"].default_value = rough
        p.inputs["Metallic"].default_value = metal
        for k, v in inputs.items():
            k = k.replace("_", " ")
            if isinstance(v, (int, float, tuple)):
                p.inputs[k].default_value = v
            else:
                self.link(v, p.inputs[k])
        return p

    def noise(self, scale, detail=4.0, vector=None):
        nz = self.n("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = detail
        if vector is not None:
            self.link(vector, nz.inputs["Vector"])
        return nz

    def position(self):
        return self.n("ShaderNodeNewGeometry").outputs["Position"]

    def bump(self, height, strength, distance=0.1):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        return b.outputs["Normal"]

    def surface(self, shader_out):
        self.link(shader_out, self.out.inputs["Surface"])


def mat_new(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


# ---------------------------------------------------------------- cinematic materials (render-only)
def shade_plaster(m):
    g = NT(m)
    bev = g.n("ShaderNodeBevel", samples=6)
    bev.inputs["Radius"].default_value = 0.035
    nz = g.noise(40.0, 2.0)
    col = g.mix_rgb(g.math("MULTIPLY", nz.outputs["Fac"], 0.15), srgb("#F4F0E9"), srgb("#E7E0D4"))
    p = g.principled(col, rough=0.42, Normal=bev.outputs["Normal"])
    g.surface(p.outputs[0])


def shade_bronze(m):
    g = NT(m)
    nz = g.noise(60.0, 6.0)
    rough = g.math("ADD", g.math("MULTIPLY", nz.outputs["Fac"], 0.15), 0.25)
    p = g.principled(srgb("#A7794A"), rough=0.3, metal=1.0)
    g.link(rough, p.inputs["Roughness"])
    g.surface(p.outputs[0])


def shade_curtain_wall(m):
    """Unit glazing: reflective glass, bronze mullions, warm interiors lit at random (per unit)."""
    g = NT(m)
    pos = g.position()
    sep = g.n("ShaderNodeSeparateXYZ")
    g.link(pos, sep.inputs[0])
    # Vertical mullions every 0.62 units along the facade (x+y works for both facade orientations).
    along = g.math("ADD", sep.outputs[0], sep.outputs[1])
    mull = g.math("LESS_THAN", g.math("FRACT", g.math("MULTIPLY", along, 1 / 0.62)), 0.07)
    # Spandrel band at floor level.
    zf = g.math("FRACT", sep.outputs[2])
    spandrel = g.math("LESS_THAN", zf, 0.26)
    frame = g.math("MAXIMUM", mull, spandrel)

    obj = g.n("ShaderNodeObjectInfo")
    rnd = obj.outputs["Random"]
    lit = g.math("GREATER_THAN", rnd, 0.38)
    # Rooms: soft variation across the glazing (lamps, curtains, depth).
    room = g.noise(3.0, 2.0)
    room_v = g.math("ADD", g.math("MULTIPLY", room.outputs["Fac"], 1.6), -0.35)
    warmth = g.mix_rgb(g.math("FRACT", g.math("MULTIPLY", rnd, 7.31)), srgb("#FFB46B"), srgb("#FFE2B8"))
    strength = g.math("MULTIPLY", g.math("MULTIPLY", lit, g.math("MAXIMUM", room_v, 0.0)), 3.2)
    strength = g.math("MULTIPLY", strength, g.math("SUBTRACT", 1.0, frame))

    glass = g.principled(srgb("#1E2B33"), rough=0.035, Specular_IOR_Level=0.7, Coat_Weight=0.4)
    g.link(warmth, glass.inputs["Emission Color"])
    g.link(strength, glass.inputs["Emission Strength"])
    metal = g.principled(srgb("#7B5B3A"), rough=0.35, metal=1.0)
    mix = g.n("ShaderNodeMixShader")
    g.link(frame, mix.inputs[0])
    g.link(glass.outputs[0], mix.inputs[1])
    g.link(metal.outputs[0], mix.inputs[2])
    g.surface(mix.outputs[0])


def shade_clear_glass(m, tint="#DDEFF2"):
    g = NT(m)
    p = g.principled(srgb(tint), rough=0.01, Transmission_Weight=1.0, IOR=1.45)
    g.surface(p.outputs[0])


def shade_crown(m):
    g = NT(m)
    p = g.principled(srgb("#28414A"), rough=0.02, Specular_IOR_Level=0.8, Emission_Color=srgb("#FFD6A0"), Emission_Strength=1.6)
    g.surface(p.outputs[0])


def shade_podium_glass(m):
    g = NT(m)
    p = g.principled(srgb("#202A30"), rough=0.03, Emission_Color=srgb("#FFCF94"), Emission_Strength=2.2)
    g.surface(p.outputs[0])


def shade_water(m, deep="#0B3F4C", scale=0.6, ripple=0.25):
    g = NT(m)
    pos = g.position()
    big = g.noise(scale, 8.0, pos)
    small = g.noise(scale * 9, 4.0, pos)
    h = g.math("ADD", big.outputs["Fac"], g.math("MULTIPLY", small.outputs["Fac"], 0.35))
    p = g.principled(srgb(deep), rough=0.03, Specular_IOR_Level=0.8, Normal=g.bump(h, ripple, 0.2))
    g.surface(p.outputs[0])


def shade_pool(m):
    g = NT(m)
    nz = g.noise(4.0, 3.0)
    p = g.principled(srgb("#1C9FB4"), rough=0.02, Emission_Color=srgb("#2FB9CC"), Emission_Strength=0.25,
                     Normal=g.bump(nz.outputs["Fac"], 0.15, 0.05))
    g.surface(p.outputs[0])


def shade_textured(m, a, b_, scale, rough=0.8, bump=0.0):
    g = NT(m)
    nz = g.noise(scale, 6.0)
    col = g.mix_rgb(nz.outputs["Fac"], srgb(a), srgb(b_))
    kw = {"Normal": g.bump(nz.outputs["Fac"], bump, 0.05)} if bump else {}
    p = g.principled(col, rough=rough, **kw)
    g.surface(p.outputs[0])


def shade_paving(m):
    g = NT(m)
    brick = g.n("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = 1.4
    brick.inputs["Mortar Size"].default_value = 0.01
    brick.inputs["Color1"].default_value = srgb("#EDE6DA")
    brick.inputs["Color2"].default_value = srgb("#E2D9CA")
    brick.inputs["Mortar"].default_value = srgb("#CFC4B2")
    g.link(g.position(), brick.inputs["Vector"])
    p = g.principled(brick.outputs["Color"], rough=0.6)
    g.surface(p.outputs[0])


def shade_teak(m):
    """Teak planks running towards the sea, with per-plank tone variation."""
    g = NT(m)
    sep = g.n("ShaderNodeSeparateXYZ")
    g.link(g.position(), sep.inputs[0])
    comb = g.n("ShaderNodeCombineXYZ")
    g.link(sep.outputs[1], comb.inputs[0])
    g.link(sep.outputs[0], comb.inputs[1])
    brick = g.n("ShaderNodeTexBrick")
    brick.offset = 0.37
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Brick Width"].default_value = 1.4
    brick.inputs["Row Height"].default_value = 0.055
    brick.inputs["Mortar Size"].default_value = 0.003
    brick.inputs["Bias"].default_value = 0.0
    brick.inputs["Color1"].default_value = srgb("#9A6438")
    brick.inputs["Color2"].default_value = srgb("#7C4E2C")
    brick.inputs["Mortar"].default_value = srgb("#2E1E12")
    g.link(comb.outputs[0], brick.inputs["Vector"])
    grain = g.noise(60.0, 4.0)
    col = g.mix_rgb(g.math("MULTIPLY", grain.outputs["Fac"], 0.25), brick.outputs["Color"], srgb("#B07A4A"))
    p = g.principled(col, rough=0.45, Coat_Weight=0.25, Normal=g.bump(brick.outputs["Fac"], 0.3, 0.01))
    g.surface(p.outputs[0])


def shade_city(m):
    """Distant towers at dusk: blue-grey glass with a random grid of lit windows."""
    g = NT(m)
    pos = g.position()
    scale = g.n("ShaderNodeVectorMath", operation="MULTIPLY")
    scale.inputs[1].default_value = (1 / 0.9, 1 / 0.9, 1 / 0.8)
    g.link(pos, scale.inputs[0])
    cell = g.n("ShaderNodeVectorMath", operation="FLOOR")
    g.link(scale.outputs[0], cell.inputs[0])
    wn = g.n("ShaderNodeTexWhiteNoise", noise_dimensions="3D")
    g.link(cell.outputs[0], wn.inputs["Vector"])
    lit = g.math("GREATER_THAN", wn.outputs["Value"], 0.72)
    p = g.principled(srgb("#67747F"), rough=0.3, Specular_IOR_Level=0.4, Emission_Color=srgb("#FFC98F"))
    g.link(g.math("MULTIPLY", lit, 0.0), p.inputs["Emission Strength"])
    g.surface(p.outputs[0])


def shade_leaf(m, color="#3F6B32"):
    g = NT(m)
    nz = g.noise(8.0, 3.0)
    col = g.mix_rgb(g.math("MULTIPLY", nz.outputs["Fac"], 0.6), srgb(color), srgb("#7C9A45"))
    p = g.principled(col, rough=0.55, Subsurface_Weight=0.25)
    g.surface(p.outputs[0])


def shade_bark(m):
    g = NT(m)
    wave = g.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z")
    wave.inputs["Scale"].default_value = 6.0
    wave.inputs["Distortion"].default_value = 2.0
    g.link(g.position(), wave.inputs["Vector"])
    col = g.mix_rgb(wave.outputs["Fac"], srgb("#6E5640"), srgb("#A08766"))
    p = g.principled(col, rough=0.9, Normal=g.bump(wave.outputs["Fac"], 0.4, 0.05))
    g.surface(p.outputs[0])


def shade_emit(m, color, strength):
    g = NT(m)
    e = g.n("ShaderNodeEmission")
    e.inputs["Color"].default_value = srgb(color)
    e.inputs["Strength"].default_value = strength
    g.surface(e.outputs[0])


def shade_clouds(m):
    """Streaky golden-hour cirrus: emissive wisps on a transparent sheet (cheap, no volumes)."""
    g = NT(m)
    vm = g.n("ShaderNodeVectorMath", operation="MULTIPLY")
    vm.inputs[1].default_value = (1 / 520, 1 / 120, 1.0)
    g.link(g.position(), vm.inputs[0])
    nz = g.noise(1.0, 10.0, vm.outputs[0])
    nz.inputs["Roughness"].default_value = 0.62
    mr = g.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    mr.inputs["From Min"].default_value = 0.5
    mr.inputs["From Max"].default_value = 0.74
    g.link(nz.outputs["Fac"], mr.inputs["Value"])
    mask = g.math("MULTIPLY", mr.outputs["Result"], 0.85)
    tint = g.mix_rgb(nz.outputs["Fac"], srgb("#F7C2A8"), srgb("#FFE6CF"))
    em = g.n("ShaderNodeEmission")
    g.link(tint, em.inputs["Color"])
    em.inputs["Strength"].default_value = 0.55
    tr = g.n("ShaderNodeBsdfTransparent")
    mix = g.n("ShaderNodeMixShader")
    g.link(mask, mix.inputs[0])
    g.link(tr.outputs[0], mix.inputs[1])
    g.link(em.outputs[0], mix.inputs[2])
    g.surface(mix.outputs[0])
    m.shadow_method = "NONE" if hasattr(m, "shadow_method") else None


def shade_simple(m, color, rough=0.5, metal=0.0, **kw):
    g = NT(m)
    g.surface(g.principled(srgb(color), rough=rough, metal=metal, **kw).outputs[0])


def upgrade_materials():
    M = bpy.data.materials
    shade_plaster(M["Plaster"])
    shade_bronze(M["Bronze"])
    shade_curtain_wall(M["UnitGlass"])
    shade_crown(M["CrownGlass"])
    shade_podium_glass(M["PodiumGlass"])
    shade_pool(M["Pool"])
    shade_water(M["Lagoon"])
    shade_leaf(M["Planting"], "#3D6630")
    shade_paving(M["Stone"])
    shade_textured(M["Ground"], "#D8C9AC", "#C9B794", 3.0)
    shade_textured(M["Road"], "#3B3F44", "#4A4E53", 30.0, rough=0.7)
    shade_city(M["Context"])


# ---------------------------------------------------------------- render-only geometry
def mesh_obj(name, bm, mat, coll):
    return bt.to_object(name, bm, mat, coll)


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


def tower_dressing(bid, floors, coll):
    """Glass balustrades + warm cove lights under every balcony edge (mirrors build_tower's slab maths)."""
    bx, by = bt.BUILDING_OFFSET[bid], 0.0
    glass, cove = bmesh.new(), bmesh.new()
    for f in range(3, floors + 1):
        z0 = bt.PODIUM_TOP + (f - 3) * bt.FLOOR_H
        wave = math.sin(f * 0.75 + (0 if bid == "T1" else 1.3))
        hx = bt.CORE_HALF + 0.55 + 0.35 * wave
        hy = bt.CORE_HALF + 0.55 - 0.35 * wave
        outline = bt.rounded_rect(bx, by, hx, hy, 1.4, 8)
        if f > 3:
            add_ring(glass, outline, 0.05, 0.015, z0 + bt.SLAB_T, z0 + bt.SLAB_T + 0.3)
        add_ring(cove, outline, 0.12, 0.02, z0 - 0.012, z0 + 0.001)
    mesh_obj(f"{bid}_Balustrade", glass, MAT["balustrade"], coll)
    mesh_obj(f"{bid}_Cove", cove, MAT["cove"], coll)


def roof_dressing(bid, floors, coll):
    """Teak deck, sun loungers, terrace glass, planters on the sky terrace."""
    bx, by = bt.BUILDING_OFFSET[bid], 0.0
    cz = bt.PODIUM_TOP + (floors - 2) * bt.FLOOR_H + bt.SLAB_T
    deck, lounger, cushion, glass, green = (bmesh.new() for _ in range(5))
    bt.add_prism(deck, bt.rounded_rect(bx, by + 0.5, bt.CORE_HALF + 0.2, 3.75, 1.2, 8), cz - 0.01, cz + 0.004)
    for side in (-1, 1):
        for k in range(3):
            lx = bx + side * (bt.CORE_HALF - 1.05)
            ly = by + 1.75 + k * 0.55
            bt.add_box(lounger, lx, ly, cz, 0.12, 0.22, cz + 0.05)
            bt.add_box(cushion, lx, ly - 0.03, cz + 0.05, 0.11, 0.19, cz + 0.08)
            bt.add_box(cushion, lx, ly + 0.17, cz + 0.05, 0.11, 0.05, cz + 0.13)
    bt.add_box(glass, bx, by + bt.CORE_HALF + 0.22, cz, bt.CORE_HALF + 0.1, 0.01, cz + 0.36)
    for side in (-1, 1):
        bt.add_box(green, bx + side * (bt.CORE_HALF - 0.1), by + 1.35, cz, 0.25, 0.18, cz + 0.22)
    mesh_obj(f"{bid}_Deck", deck, MAT["teak"], coll)
    mesh_obj(f"{bid}_Loungers", lounger, MAT["bronze_dark"], coll)
    mesh_obj(f"{bid}_Cushions", cushion, MAT["linen"], coll)
    mesh_obj(f"{bid}_TerraceGlass", glass, MAT["balustrade"], coll)
    mesh_obj(f"{bid}_RoofPlanting", green, MAT["leaf"], coll)


def palm(trunk_bm, leaf_bm, x, y, z, height, lean=(0.0, 0.0), fronds=11, frond_len=1.5, seed=0.0):
    """A coconut palm: curved ringed trunk + drooping pinnate fronds built from leaflet quads."""
    rng = bt.Rng(int(seed * 1000) + 11)
    segs = 10
    pts = []
    for i in range(segs + 1):
        t = i / segs
        bend = t * t
        pts.append((x + lean[0] * bend, y + lean[1] * bend, z + height * t))
    rings = []
    for i, (px, py, pz) in enumerate(pts):
        r = 0.11 * (1.0 - 0.35 * i / segs) * (1.15 if i == 0 else 1.0)
        rings.append([trunk_bm.verts.new((px + r * math.cos(a), py + r * math.sin(a), pz)) for a in (k * math.pi / 4 for k in range(8))])
    for i in range(segs):
        for k in range(8):
            k2 = (k + 1) % 8
            trunk_bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    top = Vector(pts[-1])
    for f in range(fronds):
        az = 2 * math.pi * f / fronds + rng() * 0.4
        up = 0.55 - 0.9 * rng()  # initial pitch
        L = frond_len * (0.8 + 0.4 * rng())
        dirv = Vector((math.cos(az), math.sin(az), 0))
        side = Vector((-math.sin(az), math.cos(az), 0))
        n = 34
        spine = []
        for s in range(n + 1):
            t = s / n
            pitch = up - 1.6 * t * t  # droop
            spine.append(top + dirv * (L * t) + Vector((0, 0, L * 0.45 * (pitch * t))))
        for s in range(1, n - 1):
            t = s / n
            leaflet = 0.36 * L * math.sin(math.pi * min(1.0, t * 1.08)) * (1 - 0.35 * t)
            for sgn in (-1, 1):
                a = spine[s]
                b = spine[s + 2]
                jitter = (rng() - 0.5) * 0.15
                tip = a + side * (sgn * leaflet) + Vector((0, 0, -leaflet * (0.45 + t * 0.5 + jitter))) + dirv * (leaflet * 0.45)
                v = [leaf_bm.verts.new(q) for q in (a, b, tip)]
                leaf_bm.faces.new(v)


def yacht(bm_hull, bm_glass, x, y, heading, L=4.0):
    W = L * 0.24
    ca, sa = math.cos(heading), math.sin(heading)

    def tr(px, py):
        return (x + px * ca - py * sa, y + px * sa + py * ca)

    hull = [(-L / 2, -W / 2), (L * 0.15, -W / 2), (L / 2, 0), (L * 0.15, W / 2), (-L / 2, W / 2)]
    bt.add_tapered(bm_hull, [tr(*p) for p in hull], -0.55, -0.05, 1.0)
    bt.add_tapered(bm_hull, [tr(*p) for p in hull], -0.75, -0.55, 0.88)
    cabin = [(-L * 0.35, -W * 0.36), (L * 0.1, -W * 0.36), (L * 0.22, 0), (L * 0.1, W * 0.36), (-L * 0.35, W * 0.36)]
    bt.add_tapered(bm_glass, [tr(*p) for p in cabin], -0.05, 0.22, 0.92)
    top = [(-L * 0.3, -W * 0.3), (L * 0.02, -W * 0.3), (L * 0.1, 0), (L * 0.02, W * 0.3), (-L * 0.3, W * 0.3)]
    bt.add_tapered(bm_hull, [tr(*p) for p in top], 0.22, 0.3, 1.0)


# ---------------------------------------------------------------- scene assembly
MAT = {}
LAYERS = ("bg", "towers", "mid", "fg", "roof")


def build(seed):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    colls = {}
    for name in LAYERS:
        c = bpy.data.collections.new(name)
        scn.collection.children.link(c)
        colls[name] = c

    M = bt.make_materials()
    rng = bt.Rng(7)
    for bdef in seed["project"]["buildings"]:
        units = [u for u in seed["units"] if u["building"] == bdef["id"]]
        bt.build_tower(bdef["id"], bdef["floors"], units, M, colls["towers"], rng)
    bt.build_podium(M, colls["towers"])
    bt.build_site(M, colls["bg"], rng)
    # Replace the low-poly site extras with detailed render versions.
    for name in ("Site_PalmTrunks", "Site_PalmFronds", "Context_Buildings", "Site_Ground", "Site_Lagoon"):
        bpy.data.objects.remove(bpy.data.objects[name])
    bpy.data.objects["Site_Plaza"].users_collection[0].objects.unlink(bpy.data.objects["Site_Plaza"])
    colls["towers"].objects.link(bpy.data.objects["Site_Plaza"])

    upgrade_materials()
    for key, fn in {
        "balustrade": lambda m: shade_clear_glass(m),
        "cove": lambda m: shade_emit(m, "#FFC789", 9.0),
        "teak": shade_teak,
        "linen": lambda m: shade_simple(m, "#F1ECE2", rough=0.8),
        "bronze_dark": lambda m: shade_simple(m, "#5C4630", rough=0.4, metal=1.0),
        "leaf": lambda m: shade_leaf(m),
        "bark": shade_bark,
        "sand": lambda m: shade_textured(m, "#E5D3B0", "#D2BC93", 6.0, rough=0.95, bump=0.3),
        "hull": lambda m: shade_simple(m, "#F6F5F1", rough=0.15, Coat_Weight=1.0),
        "yacht_glass": lambda m: shade_simple(m, "#1A2227", rough=0.05),
        "lamp": lambda m: shade_emit(m, "#FFD29A", 25.0),
        "pole": lambda m: shade_simple(m, "#3A3530", rough=0.5, metal=0.8),
        "sea": lambda m: shade_water(m, "#0C4656", 0.08, 0.35),
        "land": lambda m: shade_textured(m, "#CDBB98", "#BBA784", 0.2),
        "clouds": shade_clouds,
    }.items():
        MAT[key] = mat_new(f"cin_{key}")
        fn(MAT[key])

    for name in ("T1_RoofPool", "T2_RoofPool"):  # flush with the deck (render only)
        bpy.data.objects[name].location.z -= 0.056
    louvres = bmesh.new()
    for i in range(70):
        x = -12.0 + i * 0.35
        for y in (6.63, -6.63):
            bt.add_box(louvres, x, y, 0.95, 0.03, 0.07, bt.PODIUM_TOP - 0.03)
    mesh_obj("Podium_Louvres", louvres, bpy.data.materials["Bronze"], colls["towers"])
    for bdef in seed["project"]["buildings"]:
        tower_dressing(bdef["id"], bdef["floors"], colls["towers"])
        roof_dressing(bdef["id"], bdef["floors"], colls["roof"])

    # Ground to the horizon: land behind (city side, -Y), sea in front (+Y); the lagoon is the near sea.
    land, sea, ctx = bmesh.new(), bmesh.new(), bmesh.new()
    bt.add_box(land, 0, -1500, -0.25, 3000, 1488.5, -0.1)
    bt.add_box(sea, 0, 1511.5, -0.6, 3000, 1500, -0.4)
    mesh_obj("Land", land, MAT["land"], colls["bg"])
    mesh_obj("Sea", sea, MAT["sea"], colls["bg"])
    sky_sheet = bmesh.new()
    bt.add_prism(sky_sheet, [(-4000, -4000), (4000, -4000), (4000, 4000), (-4000, 4000)], 95.0, 95.01)
    clouds = mesh_obj("Clouds", sky_sheet, MAT["clouds"], colls["bg"])
    clouds.visible_shadow = False
    # Warm lounge downlight under the crown canopy (only lights the terrace).
    lounge = bpy.data.objects.new("LoungeLight", bpy.data.lights.new("LoungeLight", "AREA"))
    lounge.data.shape = "RECTANGLE"
    lounge.data.size, lounge.data.size_y = 5.5, 3.0
    lounge.data.energy = 120
    lounge.data.color = (1.0, 0.8, 0.6)
    t1f = next(b for b in seed["project"]["buildings"] if b["id"] == "T1")["floors"]
    lounge.location = (bt.BUILDING_OFFSET["T1"], -0.4, bt.PODIUM_TOP + (t1f - 2) * bt.FLOOR_H + bt.SLAB_T + 1.55)
    colls["roof"].objects.link(lounge)
    # Skyline: a believable downtown behind the site, taller further back.
    for i in range(80):
        x = (rng() - 0.5) * 520
        y = -95 - rng() ** 0.8 * 340
        far = (-y - 95) / 340
        hx, hy = 2.5 + rng() * 4.0, 2.5 + rng() * 4.0
        h = 3 + rng() * (5 + 26 * far) * (1.3 if abs(x) < 140 else 0.6)
        bt.add_tapered(ctx, bt.rounded_rect(x, y, hx, hy, 0.5 + rng(), 3), -0.1, h, 0.85 + 0.15 * rng())
    mesh_obj("Skyline", ctx, bpy.data.materials["Context"], colls["bg"])

    # Promenade palms + lamps (mid layer), plaza palms stay with the towers.
    trunks_mid, leaves_mid, trunks_t, leaves_t, lamps, poles = (bmesh.new() for _ in range(6))
    for i, x in enumerate(range(-30, 31, 4)):
        if abs(x) <= 2:
            continue
        palm(trunks_mid, leaves_mid, x + 0.4 * rng(), 10.2, 0.0, 2.8 + rng() * 1.2, (0.25 * (rng() - 0.5), 0.3 * rng()), seed=i)
        if i % 2 == 0:
            bt.add_box(poles, x + 2, 10.6, 0.0, 0.025, 0.025, 1.1)
            bt.add_box(lamps, x + 2, 10.6, 1.1, 0.07, 0.07, 1.22)
    for j, (x, y) in enumerate([(-24, -8), (-24, -2), (-24, 4), (24, -8), (24, -2), (24, 4), (-18, -12.5), (18, -12.5)]):
        palm(trunks_t, leaves_t, x, y, 0.0, 2.6 + rng(), (0.2 * (rng() - 0.5), 0.2 * (rng() - 0.5)), seed=50 + j)
    mesh_obj("Mid_PalmTrunks", trunks_mid, MAT["bark"], colls["mid"])
    mesh_obj("Mid_PalmLeaves", leaves_mid, MAT["leaf"], colls["mid"])
    mesh_obj("Mid_LampPoles", poles, MAT["pole"], colls["mid"])
    mesh_obj("Mid_Lamps", lamps, MAT["lamp"], colls["mid"])
    mesh_obj("Plaza_PalmTrunks", trunks_t, MAT["bark"], colls["towers"])
    mesh_obj("Plaza_PalmLeaves", leaves_t, MAT["leaf"], colls["towers"])

    # Yachts on the lagoon (mid layer).
    hull, yglass = bmesh.new(), bmesh.new()
    for (x, y, hd, L) in [(-26, 22, 0.25, 3.6), (30, 18, 2.9, 4.2), (-44, 34, 3.3, 2.8)]:
        yacht(hull, yglass, x, y, hd, L)
    mesh_obj("Yacht_Hulls", hull, MAT["hull"], colls["mid"])
    mesh_obj("Yacht_Glass", yglass, MAT["yacht_glass"], colls["mid"])
    return colls


# ---------------------------------------------------------------- render setup
def setup_render(quality):
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
    c = scn.cycles
    c.samples = 48 if quality == "draft" else 112
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.03 if quality == "draft" else 0.012
    c.use_denoising = True
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces, c.transmission_bounces = 8, 3, 4, 8
    c.caustics_reflective = c.caustics_refractive = False
    c.blur_glossy = 1.0
    scn.render.use_persistent_data = True
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Punchy"
    scn.view_settings.exposure = -0.45
    scn.render.image_settings.file_format = "WEBP"
    scn.render.image_settings.color_mode = "RGBA"
    scn.render.image_settings.quality = 84

    world = bpy.data.worlds.new("Sky")
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(SUN_ELEV)
    sky.sun_rotation = math.radians(SUN_ROT)
    sky.sun_disc = True
    sky.sun_size = math.radians(1.4)
    sky.sun_intensity = 0.25
    sky.altitude = 80
    sky.air_density = 1.0
    sky.dust_density = 1.6
    sky.ozone_density = 3.0
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 0.28
    world.mist_settings.start = 70
    world.mist_settings.depth = 420
    world.mist_settings.falloff = "QUADRATIC"

    el, rot = math.radians(SUN_ELEV), math.radians(SUN_ROT)
    sun_dir = Vector((-math.sin(rot) * math.cos(el), math.cos(rot) * math.cos(el), math.sin(el)))
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.78, 0.55)
    sun.data.angle = math.radians(1.2)
    sun.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()
    scn.collection.objects.link(sun)
    bpy.context.view_layer.use_pass_mist = True


def setup_compositor(enabled, haze=True, glare=True):
    scn = bpy.context.scene
    scn.use_nodes = True
    scn.render.use_compositing = True
    t = scn.node_tree
    t.nodes.clear()
    rl = t.nodes.new("CompositorNodeRLayers")
    comp = t.nodes.new("CompositorNodeComposite")
    cur = rl.outputs["Image"]
    if enabled and haze:
        mix = t.nodes.new("CompositorNodeMixRGB")
        mix.blend_type = "MIX"
        mul = t.nodes.new("CompositorNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = 0.28
        t.links.new(rl.outputs["Mist"], mul.inputs[0])
        t.links.new(mul.outputs[0], mix.inputs[0])
        t.links.new(cur, mix.inputs[1])
        mix.inputs[2].default_value = (0.86, 0.72, 0.66, 1.0)
        cur = mix.outputs[0]
    if enabled and glare:
        gl = t.nodes.new("CompositorNodeGlare")
        gl.glare_type = "FOG_GLOW"
        gl.quality = "HIGH"
        gl.threshold = 1.2
        gl.size = 8
        gl.mix = -0.6
        t.links.new(cur, gl.inputs[0])
        cur = gl.outputs[0]
    t.links.new(cur, comp.inputs["Image"])
    if not enabled:
        t.links.new(rl.outputs["Alpha"], comp.inputs["Alpha"])


def make_camera(name, loc, target, lens, focus=None, fstop=5.6):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.clip_end = 8000
    if focus:
        cam.data.dof.use_dof = True
        cam.data.dof.focus_distance = focus
        cam.data.dof.aperture_fstop = fstop
    return cam


def cam_space(cam, forward, right, up):
    m = cam.matrix_world
    f = (m.to_3x3() @ Vector((0, 0, -1))).normalized()
    r = (m.to_3x3() @ Vector((1, 0, 0))).normalized()
    f.z = 0
    f.normalize()
    r.z = 0
    r.normalize()
    return cam.location + f * forward + r * right + Vector((0, 0, up))


def build_foreground(cam, coll, portrait):
    """Beach + two big framing palms close to the camera (rebuilt per orientation)."""
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob)
    sand, trunks, leaves = bmesh.new(), bmesh.new(), bmesh.new()
    bt.add_prism(sand, [(-400, 57), (400, 57), (400, 400), (-400, 400)], -0.7, -0.18)
    spread = 2.7 if portrait else 4.4
    for side, (fwd, h, seed) in ((-1, (8.5, 4.6, 0.3)), (1, (10.5, 5.2, 0.7))):
        p = cam_space(cam, fwd, side * spread, 0)
        palm(trunks, leaves, p.x, p.y, -0.2, h, (side * 0.6, -0.4), fronds=13, frond_len=2.4, seed=seed)
    mesh_obj("FG_Sand", sand, MAT["sand"], coll)
    mesh_obj("FG_PalmTrunks", trunks, MAT["bark"], coll)
    mesh_obj("FG_PalmLeaves", leaves, MAT["leaf"], coll)


# ---------------------------------------------------------------- passes
def set_pass(visible, indirect, film_transparent, composite):
    vl = bpy.context.view_layer
    for lc in vl.layer_collection.children:
        lc.exclude = False
        lc.holdout = False
        lc.indirect_only = lc.name not in visible and lc.name in indirect
        lc.hide_viewport = False
        if lc.name not in visible and lc.name not in indirect:
            lc.exclude = True
    bpy.context.scene.render.film_transparent = film_transparent
    setup_compositor(composite)


def render(path):
    scn = bpy.context.scene
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {os.path.basename(os.path.dirname(path))}/{os.path.basename(path)}")


def crown_rect(cam, bid, floors):
    bx = bt.BUILDING_OFFSET[bid]
    cz = bt.PODIUM_TOP + (floors - 2) * bt.FLOOR_H + bt.SLAB_T
    xs, ys = [], []
    for x in (bx - 4.1, bx + 4.1):
        for y in (-3.8, 4.3):
            for z in (cz - 0.3, cz + 1.9):
                v = world_to_camera_view(bpy.context.scene, cam, Vector((x, y, z)))
                xs.append(v.x)
                ys.append(1 - v.y)
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


def main():
    args = parse_args()
    with open(args.seed, encoding="utf-8") as fh:
        seed = json.load(fh)
    colls = build(seed)
    setup_render(args.quality)
    scn = bpy.context.scene
    t1 = next(b for b in seed["project"]["buildings"] if b["id"] == "T1")
    roof_cz = bt.PODIUM_TOP + (t1["floors"] - 2) * bt.FLOOR_H + bt.SLAB_T

    cam_a = make_camera("CamA", (11.0, 66.0, 2.1), (-1.0, 0.0, 12.8), 35, focus=66, fstop=0.7)
    cam_c = make_camera("CamC", (-8.0, 0.1, roof_cz + 0.38), (-7.6, 40.0, roof_cz - 1.6), 24)
    bpy.context.view_layer.update()  # camera matrices are used by cam_space/crown_rect below
    out_root = os.path.abspath(args.out)
    manifest_path = os.path.join(out_root, "manifest.json")
    manifest = {"version": 1, "sun": {"elevation": SUN_ELEV}, "orientations": {}}
    if os.path.exists(manifest_path):  # partial re-renders (--only C) keep the other shot's entries
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    every = set(LAYERS)

    for orient in args.orient.split(","):
        portrait = orient == "portrait"
        w, h = (1080, 1920) if portrait else (2560, 1440)
        if args.quality == "draft":
            w, h = w // 2, h // 2
        scn.render.resolution_x, scn.render.resolution_y = w, h
        d = os.path.join(out_root, orient)
        os.makedirs(d, exist_ok=True)
        entry = manifest["orientations"].get(orient, {"A": [], "C": []})
        entry.update({"width": w, "height": h})

        if "A" in args.only:
            scn.camera = cam_a
            build_foreground(cam_a, colls["fg"], portrait)
            entry["crown"] = crown_rect(cam_a, "T1", t1["floors"])
            if args.beauty:
                set_pass(every - {"roof"}, set(), False, True)
                render(os.path.join(d, "A-beauty.webp"))
            else:
                entry["A"] = []
                for layer, opaque in (("bg", True), ("towers", False), ("mid", False), ("fg", False)):
                    vis = {layer} | ({"roof"} if layer == "towers" else set())
                    set_pass(vis, every - vis, not opaque, opaque)
                    render(os.path.join(d, f"A-{layer}.webp"))
                    entry["A"].append(f"A-{layer}.webp")

        if "C" in args.only:
            scn.camera = cam_c
            for ob in list(colls["fg"].objects):
                bpy.data.objects.remove(ob)
            if "T1_CrownGlass" in bpy.data.objects:
                bpy.data.objects.remove(bpy.data.objects["T1_CrownGlass"])
            # The terrace layer must carry everything at deck level, or the pool renders as a hole.
            for name in ("T1_RoofPool", "T1_CrownFrame"):
                ob = bpy.data.objects[name]
                for c in list(ob.users_collection):
                    c.objects.unlink(ob)
                colls["roof"].objects.link(ob)
            # Terrace = everything on Tower 1's crown (render-only roof dressing + crown objects).
            terrace = {"roof"}
            if args.beauty:
                set_pass(every, set(), False, True)
                render(os.path.join(d, "C-beauty.webp"))
            else:
                set_pass(every - terrace, terrace, False, True)
                render(os.path.join(d, "C-view.webp"))
                set_pass(terrace, every - terrace, True, False)
                render(os.path.join(d, "C-terrace.webp"))
                entry["C"] = ["C-view.webp", "C-terrace.webp"]
        manifest["orientations"][orient] = entry

    if not args.beauty:
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)
    print("CROWN", {k: v.get("crown") for k, v in manifest["orientations"].items()})


main()
