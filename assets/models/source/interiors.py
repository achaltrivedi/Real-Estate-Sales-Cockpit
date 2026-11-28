"""
High-definition interior pieces for the tour renders (FICTIONAL project), used by tours.py.

* Procedural, modelled at real dimensions with rounded, softly crowned cushions (sofas, beds, pillows, gym pads),
  tubular steel and chrome (treadmills, racks, rails), hex dumbbells, kettlebells and plates, and pool details
  (bullnose coping, entry steps, grab rails, waterline tiles, underwater lights).
* CC0 models from Poly Haven (marble coffee table, lounge chairs, ottoman, vases, potted plants, ceiling lamp)
  and CC0 ambientCG materials (fabric weave, leather, marble, rubber flooring), fetched into
  assets/models/library/ by fetch_assets.py. If the library is missing, everything falls back to procedural.

Plan convention as in tours.py: plan (x, y) metres, y towards the view  ->  Blender (x, -y, z).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.abspath(os.path.join(HERE, "..", "library"))
WARM = (1.0, 0.76, 0.52)


def have_library():
    return os.path.isdir(os.path.join(LIB, "polyhaven")) and os.path.isdir(os.path.join(LIB, "ambientcg"))


# ---------------------------------------------------------------- materials (ambientCG, box-projected at real scale)
def pbr(folder, size, tint=None, tint_amt=0.0, rough_mul=1.0, rough_add=0.0, bump=0.25, sheen=0.0, coat=0.0, metal=0.0):
    """Material builder for an ambientCG 2K set. Height for the bump comes from AO (fabric weave) or colour."""
    from cinematic import NT, srgb

    def f(m):
        g = NT(m)
        base = os.path.join(LIB, "ambientcg", folder, f"{folder}_2K-JPG_")

        def tex(kind, non_color):
            path = base + kind + ".jpg"
            if not os.path.exists(path):
                return None
            t = g.n("ShaderNodeTexImage", projection="BOX", projection_blend=0.3)
            t.image = bpy.data.images.load(path, check_existing=True)
            if non_color:
                t.image.colorspace_settings.name = "Non-Color"
            vm = g.n("ShaderNodeVectorMath", operation="SCALE")
            g.link(g.n("ShaderNodeTexCoord").outputs["Object"], vm.inputs[0])
            vm.inputs["Scale"].default_value = 1.0 / size
            g.link(vm.outputs["Vector"], t.inputs["Vector"])
            return t.outputs["Color"]

        col = tex("Color", False)
        if tint:
            col = g.mix_rgb(tint_amt, col, srgb(tint))
        rough = tex("Roughness", True)
        r = g.math("ADD", g.math("MULTIPLY", rough, rough_mul), rough_add) if rough is not None else 0.6
        height = tex("AmbientOcclusion", True) or tex("Color", True)
        p = g.principled(col, rough=0.5, metal=metal, Normal=g.bump(height, bump, 0.004))
        if not isinstance(r, float):
            g.link(r, p.inputs["Roughness"])
        if sheen:
            p.inputs["Sheen Weight"].default_value = sheen
        if coat:
            p.inputs["Coat Weight"].default_value = coat
        g.surface(p.outputs[0])

    return f


def chrome(m):
    from cinematic import NT, srgb

    g = NT(m)
    g.surface(g.principled(srgb("#D9DCDF"), rough=0.08, metal=1.0).outputs[0])


def knurl(m):
    """Brushed steel with a fine diamond knurl (dumbbell and barbell grips)."""
    from cinematic import NT, srgb

    g = NT(m)
    w = g.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="DIAGONAL")
    w.inputs["Scale"].default_value = 900.0
    g.link(g.n("ShaderNodeTexCoord").outputs["Object"], w.inputs["Vector"])
    g.surface(g.principled(srgb("#B9BCBF"), rough=0.32, metal=1.0, Normal=g.bump(w.outputs["Fac"], 0.35, 0.002)).outputs[0])


def screen_ui(m):
    """Treadmill console: dark glass with a soft cyan readout band."""
    from cinematic import NT, srgb

    g = NT(m)
    grad = g.n("ShaderNodeTexGradient")
    g.link(g.n("ShaderNodeTexCoord").outputs["Generated"], grad.inputs["Vector"])
    band = g.math("GREATER_THAN", g.math("SINE", g.math("MULTIPLY", grad.outputs["Fac"], 40.0)), 0.6)
    col = g.mix_rgb(band, srgb("#0E1A22"), srgb("#3FA9C9"))
    p = g.principled(srgb("#06090C"), rough=0.05, Emission_Color=col, Emission_Strength=0.9)
    g.surface(p.outputs[0])


def make_materials(mat, fabric_fallback, simple):
    """Adds the high-definition materials to tours.py's M (via its `mat`). Falls back to procedural looks."""
    lib = have_library()
    if lib:
        mat("hd_fabric", pbr("Fabric061", 0.35, "#E4DCCD", 0.72, rough_mul=0.4, rough_add=0.58, bump=0.45, sheen=0.5))
        mat("hd_fabric_dark", pbr("Fabric061", 0.35, "#3F4A55", 0.78, rough_mul=0.4, rough_add=0.58, bump=0.45, sheen=0.5))
        mat("hd_boucle", pbr("Fabric061", 0.18, "#EEE9E0", 0.82, rough_mul=0.3, rough_add=0.68, bump=0.8, sheen=0.7))
        mat("hd_taupe", pbr("Fabric061", 0.35, "#A8957D", 0.75, rough_mul=0.4, rough_add=0.58, bump=0.45, sheen=0.5))
        mat("hd_terracotta", pbr("Fabric061", 0.3, "#B5714E", 0.7, rough_mul=0.4, rough_add=0.58, bump=0.5, sheen=0.5))
        mat("hd_leather", pbr("Leather037", 0.45, "#2A2522", 0.55, rough_mul=0.5, rough_add=0.18, bump=0.3, coat=0.15))
        mat("hd_leather_tan", pbr("Leather037", 0.45, "#8A5A3A", 0.5, rough_mul=0.5, rough_add=0.2, bump=0.3, coat=0.15))
        mat("hd_marble", pbr("Marble016", 1.6, rough_mul=0.25, rough_add=0.05, bump=0.05, coat=0.6))
        mat("hd_rubber", pbr("Rubber004", 1.2, "#2E2F31", 0.35, rough_mul=0.4, rough_add=0.55, bump=0.3))
    else:
        mat("hd_fabric", fabric_fallback("#E6DED1", "#D9CFC0"))
        mat("hd_fabric_dark", fabric_fallback("#3F4A55", "#36414B"))
        mat("hd_boucle", fabric_fallback("#EEE9E0", "#E3DCD0"))
        mat("hd_taupe", fabric_fallback("#B9A68D", "#A99479"))
        mat("hd_terracotta", fabric_fallback("#B5714E", "#A5633F"))
        mat("hd_leather", simple("#2A2522", 0.35, Coat_Weight=0.15))
        mat("hd_leather_tan", simple("#8A5A3A", 0.38, Coat_Weight=0.15))
        mat("hd_marble", simple("#EDEBE7", 0.08, Coat_Weight=0.6))
        mat("hd_rubber", simple("#2E2F31", 0.85))
    mat("hd_chrome", chrome)
    mat("hd_knurl", knurl)
    mat("hd_steel", simple("#2B2D30", 0.38, 0.9))  # powder-coated graphite frames
    mat("hd_hexrubber", simple("#1D1E20", 0.62))
    mat("hd_belt", simple("#1A1B1C", 0.75))
    mat("hd_screen", screen_ui)
    mat("hd_coping", simple("#E9E3D7", 0.35))


# every procedural piece here is already smooth and rounded; tours.Builder must not bevel these
SOFT_KEYS = {"hd_fabric", "hd_fabric_dark", "hd_boucle", "hd_taupe", "hd_terracotta", "hd_leather", "hd_leather_tan"}


# ---------------------------------------------------------------- geometry primitives
def soft_box(bm, x0, y0, x1, y1, z0, z1, r=0.05, crown=0.0, cuts=10, tilt=None):
    """Rounded box with radius `r` on every edge and an optional crowned top (a stuffed cushion).

    Built as a subdivided cube whose vertices are pushed onto the rounded-box surface, so it is smooth at any
    size with no modifiers. `tilt` = (axis "x"|"y", angle, pivot_z) leans it back (sofa back cushions)."""
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    hx, hy, hz = (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2
    r = min(r, hx * 0.98, hy * 0.98, hz * 0.98)
    cx, cy, cz = (x0 + x1) / 2, -(y0 + y1) / 2, (z0 + z1) / 2
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=2.0)
    bmesh.ops.subdivide_edges(tmp, edges=tmp.edges[:], cuts=cuts, use_grid_fill=True)
    core = Vector((hx - r, hy - r, hz - r))
    for v in tmp.verts:
        p = Vector((v.co.x * hx, v.co.y * hy, v.co.z * hz))
        q = Vector((max(-core.x, min(core.x, p.x)), max(-core.y, min(core.y, p.y)), max(-core.z, min(core.z, p.z))))
        d = p - q
        p = q + (d.normalized() * r if d.length > 1e-9 else d)
        if crown and p.z > 0:
            u, w = p.x / hx, p.y / hy
            p.z += crown * max(0.0, 1 - u * u) * max(0.0, 1 - w * w) * (p.z / hz)
        if tilt:
            axis, ang, pz = tilt
            rel = Vector((p.x, p.y, p.z + cz - pz))
            rel = Matrix.Rotation(ang, 3, "X" if axis == "x" else "Y") @ rel
            p = Vector((rel.x, rel.y, rel.z - cz + pz))
        v.co = Vector((cx + p.x, cy + p.y, cz + p.z))
    for f in tmp.faces:
        f.smooth = True
    me = bpy.data.meshes.new("tmp_soft")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def tube(bm, pts, r, seg=12, caps=True):
    """Round tube along a plan-space polyline [(x, y, z), ...], with mitred joints."""
    P = [Vector((x, -y, z)) for x, y, z in pts]
    rings = []
    n1 = None
    for i, p in enumerate(P):
        if i == 0:
            t = (P[1] - P[0]).normalized()
        elif i == len(P) - 1:
            t = (P[-1] - P[-2]).normalized()
        else:
            t = ((P[i] - P[i - 1]).normalized() + (P[i + 1] - P[i]).normalized()).normalized()
        if n1 is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n1 = t.cross(up).normalized()
        else:  # carry the previous frame along (rotation-minimising), so the tube doesn't twist
            n1 = (n1 - t * n1.dot(t)).normalized()
        n2 = t.cross(n1).normalized()
        # at a bend the ring sits on the mitre plane: stretch it along the bend so the tube keeps its radius
        stretch, bend = 1.0, None
        if 0 < i < len(P) - 1:
            a = (P[i] - P[i - 1]).normalized()
            c = max(0.3, a.dot(t))
            stretch = 1.0 / c
            bend = (a - t * a.dot(t))
            bend = bend.normalized() if bend.length > 1e-6 else None
        ring = []
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            off = (n1 * math.cos(ang) + n2 * math.sin(ang)) * r
            if bend is not None:
                off += bend * off.dot(bend) * (stretch - 1.0)
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            f = bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
            f.smooth = True
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])


def cylinder_axis(bm, a, b, r, seg=24, smooth=True):
    """Closed cylinder between plan-space points a and b (any direction)."""
    A, B = Vector((a[0], -a[1], a[2])), Vector((b[0], -b[1], b[2]))
    t = (B - A).normalized()
    up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
    n1 = t.cross(up).normalized()
    n2 = t.cross(n1)
    r0, r1 = [], []
    for k in range(seg):
        ang = 2 * math.pi * k / seg
        off = (n1 * math.cos(ang) + n2 * math.sin(ang)) * r
        r0.append(bm.verts.new(A + off))
        r1.append(bm.verts.new(B + off))
    for k in range(seg):
        f = bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
        f.smooth = smooth
    bm.faces.new(list(reversed(r0)))
    bm.faces.new(r1)


def hex_axis(bm, a, b, r):
    """Hexagonal prism between a and b (rubber dumbbell heads)."""
    cylinder_axis(bm, a, b, r, seg=6, smooth=False)


def ring_plate(bm, c, axis, R, r_hole, thick, seg=48):
    """Weight plate: an annulus with a raised rim, its axis along plan "x" or "y"."""
    cx, cy, cz = c
    for (rad_o, rad_i, t) in ((R, r_hole, thick), (R * 0.97, R * 0.72, thick * 1.25)):
        outer0, outer1, inner0, inner1 = [], [], [], []
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            for rad, lst0, lst1 in ((rad_o, outer0, outer1), (rad_i, inner0, inner1)):
                u, w = rad * math.cos(ang), rad * math.sin(ang)
                if axis == "x":
                    p0, p1 = (cx - t / 2, -(cy + u), cz + w), (cx + t / 2, -(cy + u), cz + w)
                else:
                    p0, p1 = (cx + u, -(cy - t / 2), cz + w), (cx + u, -(cy + t / 2), cz + w)
                lst0.append(bm.verts.new(p0))
                lst1.append(bm.verts.new(p1))
        for k in range(seg):
            n = (k + 1) % seg
            for q in ((outer0[k], outer0[n], outer1[n], outer1[k]), (inner0[n], inner0[k], inner1[k], inner1[n]),
                      (outer0[n], outer0[k], inner0[k], inner0[n]), (outer1[k], outer1[n], inner1[n], inner1[k])):
                f = bm.faces.new(q)
                f.smooth = q[0] in outer0 and q[1] in outer0


def sphere(bm, c, r, sz=1.0, subdiv=3):
    mtx = Matrix.Translation((c[0], -c[1], c[2])) @ Matrix.Diagonal((r, r, r * sz, 1.0))
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0, matrix=mtx)
    for v in res["verts"]:
        for f in v.link_faces:
            f.smooth = True


def torus_axis(bm, c, R, r, axis="z", seg=36, rseg=10, arc=2 * math.pi):
    cx, cy, cz = c
    rings = []
    n = seg + (0 if arc >= 2 * math.pi - 1e-6 else 1)
    for i in range(n):
        a = arc * i / seg
        ring = []
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            rr = R + r * math.cos(b)
            u, w, h = rr * math.cos(a), rr * math.sin(a), r * math.sin(b)
            if axis == "z":
                p = (cx + u, -(cy + w), cz + h)
            elif axis == "x":  # ring standing in the plan y-z plane
                p = (cx + h, -(cy + u), cz + w)
            else:  # "y": ring standing in the plan x-z plane
                p = (cx + u, -(cy + h), cz + w)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if arc >= 2 * math.pi - 1e-6 else [])
    for a, b in pairs:
        for j in range(rseg):
            f = bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
            f.smooth = True


# ---------------------------------------------------------------- lights
def point(x, y, z, energy=8.0, radius=0.06, color=WARM):
    li = bpy.data.lights.new("Lamp", "POINT")
    li.energy = energy
    li.color = color
    li.shadow_soft_size = radius
    ob = bpy.data.objects.new("Lamp", li)
    ob.location = (x, -y, z)
    bpy.context.scene.collection.objects.link(ob)


# ---------------------------------------------------------------- Poly Haven models
_ASSET_CACHE = {}
# per-model fixes: which object to keep from a multi-variant set, material swaps
ASSET_OPTS = {
    "throw_pillows_01": {"recolor": True},
}


def _load(asset):
    """Import a library glTF once into a hidden collection; returns (root objects, bbox lo, bbox hi)."""
    if asset in _ASSET_CACHE:
        got = _ASSET_CACHE[asset]
        try:  # every new interior scene resets Blender's data, which deletes the imported source objects
            if got is None or all(o.name for o in got[0]):
                return got
        except ReferenceError:
            pass
    path = os.path.join(LIB, "polyhaven", asset, f"{asset}_2k.gltf")
    if not os.path.exists(path):
        _ASSET_CACHE[asset] = None
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    coll = bpy.data.collections.get("AssetSource") or bpy.data.collections.new("AssetSource")
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    coll.hide_render = True
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    bpy.context.view_layer.update()
    meshes = [o for o in new if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    _ASSET_CACHE[asset] = (meshes, lo, hi)
    return _ASSET_CACHE[asset]


def asset_size(asset):
    got = _load(asset)
    if not got:
        return None
    _, lo, hi = got
    return hi - lo


def place(asset, x, y, rot=0.0, z=0.0, fit=None, scale=None, material=None):
    """Instance a library model with its footprint centred on plan (x, y), base at z, turned `rot` degrees
    (counter-clockwise seen from above; 0 = the model's own front, which for Poly Haven faces Blender -Y, i.e.
    plan +y, the view). `fit` = (w, d) plan metres scales it uniformly to fit; returns False if not in the library."""
    got = _load(asset)
    if not got:
        return False
    meshes, lo, hi = got
    size = hi - lo
    s = scale or 1.0
    if fit:
        a = math.radians(rot)
        w = abs(size.x * math.cos(a)) + abs(size.y * math.sin(a))
        d = abs(size.x * math.sin(a)) + abs(size.y * math.cos(a))
        s = min(fit[0] / w, fit[1] / d)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    xf = Matrix.Translation((x, -y, z)) @ Matrix.Rotation(math.radians(rot), 4, "Z") @ Matrix.Scale(s, 4) @ Matrix.Translation(-centre)
    for src in meshes:
        ob = bpy.data.objects.new(f"{asset}_inst", src.data)
        ob.matrix_world = xf @ src.matrix_world
        if material is not None:
            for slot in ob.material_slots:
                slot.link = "OBJECT"
                slot.material = material
        bpy.context.scene.collection.objects.link(ob)
    return True


# ---------------------------------------------------------------- living
def sofa(b, x0, y0, x1, y1, side="top", cover="hd_fabric", pillows=("hd_terracotta", "hd_taupe", "hd_fabric_dark")):
    """Low, deep contemporary sofa. `side` = where its back is. Plinth, crowned seat cushions, leaning back
    cushions, rounded arms, slim bronze legs and loose scatter cushions."""
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    horiz = side in ("top", "bottom")  # back runs along x
    L = (x1 - x0) if horiz else (y1 - y0)
    D = (y1 - y0) if horiz else (x1 - x0)
    arm, back = 0.2, 0.24

    def rect(a0, a1, d0, d1):
        """(along, depth-from-back) -> plan rect."""
        if side == "top":
            return x0 + a0, y0 + d0, x0 + a1, y0 + d1
        if side == "bottom":
            return x0 + a0, y1 - d1, x0 + a1, y1 - d0
        if side == "left":
            return x0 + d0, y0 + a0, x0 + d1, y0 + a1
        return x1 - d1, y0 + a0, x1 - d0, y0 + a1

    fab = b.bm(cover)
    # plinth + body shell
    rx0, ry0, rx1, ry1 = rect(0.03, L - 0.03, 0.03, D - 0.03)
    soft_box(b.bm("walnut"), rx0, ry0, rx1, ry1, 0.07, 0.12, 0.01, cuts=4)
    rx0, ry0, rx1, ry1 = rect(0, L, 0, D)
    soft_box(fab, rx0, ry0, rx1, ry1, 0.12, 0.3, 0.035, cuts=6)
    # arms and back frame
    for a0, a1 in ((0, arm), (L - arm, L)):
        rx0, ry0, rx1, ry1 = rect(a0, a1, 0, D)
        soft_box(fab, rx0, ry0, rx1, ry1, 0.28, 0.6, 0.07, crown=0.01)
    rx0, ry0, rx1, ry1 = rect(arm - 0.01, L - arm + 0.01, 0, back)
    soft_box(fab, rx0, ry0, rx1, ry1, 0.28, 0.72, 0.07)
    # seat cushions (crowned) and back cushions (leaning back)
    n = max(1, round((L - 2 * arm) / 0.9))
    cw = (L - 2 * arm) / n
    tilt_axis = "x" if horiz else "y"
    lean = math.radians(12)
    sign = {"top": -1, "bottom": 1, "left": 1, "right": -1}[side]
    for i in range(n):
        a0 = arm + i * cw + 0.008
        a1 = a0 + cw - 0.016
        rx0, ry0, rx1, ry1 = rect(a0, a1, back - 0.02, D - 0.02)
        soft_box(fab, rx0, ry0, rx1, ry1, 0.3, 0.44, 0.06, crown=0.025)
        rx0, ry0, rx1, ry1 = rect(a0, a1, back - 0.01, back + 0.17)
        soft_box(fab, rx0, ry0, rx1, ry1, 0.44, 0.86, 0.07, crown=0.03, tilt=(tilt_axis, sign * lean, 0.44))
    # legs
    for a in (0.08, L - 0.08):
        for d in (0.08, D - 0.08):
            rx0, ry0, _, _ = rect(a, a, d, d)
            cx, cy = rx0, ry0
            cylinder_axis(b.bm("bronze"), (cx, cy, 0.0), (cx, cy, 0.075), 0.018, 12)
    # scatter cushions near the arms, leaning on the back cushions
    for k, (a, key) in enumerate(((arm + 0.3, pillows[0]), (arm + 0.72, pillows[1]), (L - arm - 0.32, pillows[2]))):
        if a > L - arm - 0.2 and k == 1:
            continue
        rx0, ry0, rx1, ry1 = rect(a - 0.2, a + 0.2, back + 0.16, back + 0.3)
        soft_box(b.bm(key), rx0, ry0, rx1, ry1, 0.43, 0.81, 0.065, crown=0.045, tilt=(tilt_axis, sign * math.radians(22), 0.43))


def bed(b, x0, y0, x1, y1, head="left", wall=None):
    """Upholstered bed: channel-tufted headboard to the wall, crowned mattress, folded-back duvet, four
    pillows, a knit throw across the foot. `wall` = the plan coordinate of the wall face behind the headboard."""
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    horiz = head in ("left", "right")
    L = (x1 - x0) if horiz else (y1 - y0)  # length, head -> foot
    Wd = (y1 - y0) if horiz else (x1 - x0)

    def rect(l0, l1, w0, w1):
        if head == "left":
            return x0 + l0, y0 + w0, x0 + l1, y0 + w1
        if head == "right":
            return x1 - l1, y0 + w0, x1 - l0, y0 + w1
        if head == "top":
            return x0 + w0, y0 + l0, x0 + w1, y0 + l1
        return x0 + w0, y1 - l1, x0 + w1, y1 - l0

    soft_box(b.bm("hd_taupe"), *rect(0.0, L, -0.02, Wd + 0.02), 0.06, 0.32, 0.04, cuts=6)
    soft_box(b.bm("linen"), *rect(0.04, L - 0.02, 0.02, Wd - 0.02), 0.32, 0.54, 0.06, crown=0.015)
    # duvet draped over the lower two thirds (its sides hang over the mattress), a soft turn-down fold,
    # and a knit throw across the foot hanging over both sides
    soft_box(b.bm("duvet"), *rect(L * 0.36, L + 0.05, -0.05, Wd + 0.05), 0.3, 0.6, 0.09, crown=0.025)
    soft_box(b.bm("duvet"), *rect(L * 0.33, L * 0.43, -0.045, Wd + 0.045), 0.42, 0.635, 0.05, crown=0.015)
    soft_box(b.bm("throw"), *rect(L * 0.74, L * 0.94, -0.075, Wd + 0.075), 0.36, 0.632, 0.035, crown=0.02)
    # pillows: two sleeping pillows leaning on two euro squares
    n = 2 if Wd > 1.3 else 1
    pw = (Wd - 0.12) / n
    for i in range(n):
        w0 = 0.06 + i * pw
        soft_box(b.bm("linen"), *rect(0.05, 0.2, w0 + 0.03, w0 + pw - 0.03), 0.54, 0.98, 0.07, crown=0.05,
                 tilt=("y" if horiz else "x", (1 if head in ("left", "bottom") else -1) * math.radians(24), 0.54))
        soft_box(b.bm("duvet"), *rect(0.24, 0.6, w0 + 0.06, w0 + pw - 0.06), 0.54, 0.68, 0.06, crown=0.045)
    # headboard: vertical channels, from the wall face
    hb0 = -0.12 if wall is None else None
    if wall is not None:
        if head == "left":
            hb0 = wall - x0
        elif head == "right":
            hb0 = x1 - wall
        elif head == "top":
            hb0 = wall - y0
        else:
            hb0 = y1 - wall
    hb0 = min(hb0, -0.02)
    ch = max(5, round((Wd + 0.5) / 0.22))
    cw = (Wd + 0.5) / ch
    for i in range(ch):
        w0 = -0.25 + i * cw
        soft_box(b.bm("hd_taupe"), *rect(hb0, hb0 + 0.11, w0 + 0.004, w0 + cw - 0.004), 0.1, 1.3, 0.045, crown=0.0)


def scatter_cushion(b, key, x, y, z, w=0.45, d=0.16, h=0.45, along="x"):
    if along == "x":
        soft_box(b.bm(key), x - w / 2, y - d / 2, x + w / 2, y + d / 2, z, z + h, 0.07, crown=0.05)
    else:
        soft_box(b.bm(key), x - d / 2, y - w / 2, x + d / 2, y + w / 2, z, z + h, 0.07, crown=0.05)


def coffee_set(b, x0, y0, x1, y1):
    """Round marble coffee table (Poly Haven) dressed with a vase and books; procedural fallback."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    fit = min(x1 - x0, y1 - y0)
    if place("coffee_table_round_01", cx, cy, 0.0, fit=(fit * 1.05, fit * 1.05)):
        s = asset_size("coffee_table_round_01")
        top = s.z * min(fit * 1.05 / s.x, fit * 1.05 / s.y)
        place("ceramic_vase_04", cx + fit * 0.16, cy - fit * 0.1, 20.0, z=top, scale=0.9)
        b.box("walnut", cx - fit * 0.28, cy - fit * 0.05, cx - fit * 0.02, cy + fit * 0.17, top, top + 0.035)
        b.box("throw", cx - fit * 0.26, cy - fit * 0.03, cx - fit * 0.04, cy + fit * 0.15, top + 0.035, top + 0.06)
        return True
    return False


def lounge_chair(b, x, y, facing_deg, fit=0.85):
    """A lounge chair turned to face `facing_deg` (plan bearing: 0 = towards the view, +y)."""
    return place("mid_century_lounge_chair", x, y, facing_deg, fit=(fit, fit))


def plant_asset(x, y, big=False, rot=0.0):
    return place("potted_plant_01" if big else "potted_plant_02", x, y, rot, scale=1.25 if big else 1.0)


# ---------------------------------------------------------------- gym
def treadmill(b, x, y, facing="view"):
    """Commercial treadmill, 0.9 x 2.0 m, rear roller at plan (x, y), the console 2 m towards `facing`
    ("view" = plan +y, "back" = plan -y)."""
    # local frame: u across, v along the run (v = 0 at the rear roller, 2.0 at the console)
    sgn = 1 if facing == "view" else -1

    def P(u, v, z):
        return (x + u, y + sgn * v, z)

    steel, rub, belt = b.bm("hd_steel"), b.bm("hd_hexrubber"), b.bm("hd_belt")
    # deck with side rails
    for u in (-0.42, 0.42):
        a, c = P(u - 0.05, 0.0, 0.0), P(u + 0.05, 1.72, 0.0)
        soft_box(steel, a[0], a[1], c[0], c[1], 0.02, 0.22, 0.03, cuts=4)
        a, c = P(u - 0.045, 0.02, 0.0), P(u + 0.045, 1.6, 0.0)
        soft_box(rub, a[0], a[1], c[0], c[1], 0.22, 0.235, 0.008, cuts=3)
    a, c = P(-0.37, 0.05, 0), P(0.37, 1.65, 0)
    soft_box(belt, a[0], a[1], c[0], c[1], 0.16, 0.205, 0.02, cuts=4)
    # motor hood at the front
    a, c = P(-0.47, 1.6, 0), P(0.47, 2.0, 0)
    soft_box(steel, a[0], a[1], c[0], c[1], 0.0, 0.32, 0.09, crown=0.02)
    # uprights leaning back towards the runner, joined to the console
    for u in (-0.4, 0.4):
        tube(steel, [P(u, 1.85, 0.25), P(u, 1.7, 1.15)], 0.04, 14)
    # console arms and handlebar loop
    tube(b.bm("hd_chrome"), [P(-0.4, 1.4, 1.02), P(-0.4, 1.66, 1.12), P(0.4, 1.66, 1.12), P(0.4, 1.4, 1.02)], 0.017, 12, caps=True)
    for u in (-0.4, 0.4):
        tube(b.bm("hd_leather"), [P(u, 1.42, 1.025), P(u, 1.62, 1.1)], 0.021, 12)
    a, c = P(-0.4, 1.66, 0), P(0.4, 1.86, 0)
    soft_box(steel, a[0], a[1], c[0], c[1], 1.1, 1.32, 0.04, tilt=("x", sgn * math.radians(-25), 1.2))
    a, c = P(-0.27, 1.655, 0), P(0.27, 1.68, 0)
    soft_box(b.bm("hd_screen"), a[0], a[1], c[0], c[1], 1.15, 1.31, 0.01, cuts=2, tilt=("x", sgn * math.radians(-25), 1.2))


def dumbbell(b, x, y, z, length, r_head, axis="x"):
    """Rubber hex dumbbell lying along plan `axis`."""
    h = r_head * 0.9
    grip = 0.135
    if axis == "x":
        a0, a1 = (x - length / 2, y, z), (x - grip / 2, y, z)
        b0, b1 = (x + grip / 2, y, z), (x + length / 2, y, z)
    else:
        a0, a1 = (x, y - length / 2, z), (x, y - grip / 2, z)
        b0, b1 = (x, y + grip / 2, z), (x, y + length / 2, z)
    hex_axis(b.bm("hd_hexrubber"), a0, a1, r_head)
    hex_axis(b.bm("hd_hexrubber"), b0, b1, r_head)
    cylinder_axis(b.bm("hd_knurl"), a1, b0, 0.017, 16)
    cylinder_axis(b.bm("hd_chrome"), a1, (a1[0] + (0.012 if axis == "x" else 0), a1[1] + (0.012 if axis == "y" else 0), z), h * 0.55, 20)
    cylinder_axis(b.bm("hd_chrome"), (b0[0] - (0.012 if axis == "x" else 0), b0[1] - (0.012 if axis == "y" else 0), z), b0, h * 0.55, 20)


def dumbbell_rack(b, x0, x1, y, facing="top"):
    """Two-tier angled rack of dumbbells (2.5 kg pairs upwards), against a wall at plan y (rack depth 0.75)."""
    d = 1 if facing == "bottom" else -1  # the side the user stands on
    steel = b.bm("hd_steel")
    for x in (x0, (x0 + x1) / 2, x1):
        tube(steel, [(x, y, 0.0), (x, y, 0.82), (x, y + d * 0.62, 0.52), (x, y + d * 0.62, 0.0)], 0.03, 10)
    for (yy, zz) in ((y + d * 0.18, 0.78), (y + d * 0.5, 0.56)):
        for dz in (0.0,):
            a = (x0, yy - 0.08, zz + dz)
            b_ = (x1, yy + 0.08, zz + dz)
            soft_box(steel, a[0], a[1], b_[0], b_[1], zz - 0.03, zz, 0.01, cuts=3)
    n = max(4, int((x1 - x0) / 0.36))
    for tier, (yy, zz) in enumerate(((y + d * 0.18, 0.78), (y + d * 0.5, 0.56))):
        for i in range(n):
            t = (i + 0.5) / n
            wkg = 2.5 * (1 + i + tier * n)
            r = 0.05 + 0.045 * min(1.0, wkg / 45.0)
            L = 0.3 + 0.12 * min(1.0, wkg / 45.0)
            dumbbell(b, x0 + (x1 - x0) * t, yy, zz + r * 0.88, L, r, axis="y")


def bench(b, x, y, along="y", incline=0.0):
    """Adjustable bench: leather pad on a graphite frame. `incline` (degrees) raises the back pad."""
    steel = b.bm("hd_steel")
    if along == "y":
        tube(steel, [(x, y - 0.6, 0.06), (x, y + 0.6, 0.06)], 0.035, 12)
        for yy in (y - 0.6, y + 0.6):
            tube(steel, [(x - 0.25, yy, 0.03), (x + 0.25, yy, 0.03)], 0.03, 12)
        tube(steel, [(x, y - 0.35, 0.06), (x, y - 0.35, 0.38)], 0.035, 12)
        tube(steel, [(x, y + 0.35, 0.06), (x, y + 0.35, 0.38)], 0.035, 12)
        soft_box(b.bm("hd_leather"), x - 0.15, y - 0.62, x + 0.15, y - 0.06, 0.38, 0.45, 0.025)
        soft_box(b.bm("hd_leather"), x - 0.15, y - 0.03, x + 0.15, y + 0.62, 0.38, 0.45, 0.025,
                 tilt=("x", math.radians(incline), 0.42) if incline else None)
    else:
        tube(steel, [(x - 0.6, y, 0.06), (x + 0.6, y, 0.06)], 0.035, 12)
        for xx in (x - 0.6, x + 0.6):
            tube(steel, [(xx, y - 0.25, 0.03), (xx, y + 0.25, 0.03)], 0.03, 12)
        for xx in (x - 0.35, x + 0.35):
            tube(steel, [(xx, y, 0.06), (xx, y, 0.38)], 0.035, 12)
        soft_box(b.bm("hd_leather"), x - 0.62, y - 0.15, x + 0.62, y + 0.15, 0.38, 0.45, 0.025)


def power_rack(b, x0, y0, x1, y1, H=2.3):
    """Half rack with a loaded barbell and plate storage."""
    steel = b.bm("hd_steel")
    for (x, y) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        soft_box(steel, x - 0.04, y - 0.04, x + 0.04, y + 0.04, 0.0, H, 0.006, cuts=2)
    for (a, c) in (((x0, y0), (x1, y0)), ((x0, y1), (x1, y1))):
        soft_box(steel, a[0] - 0.04, a[1] - 0.04, c[0] + 0.04, c[1] + 0.04, H - 0.08, H, 0.006, cuts=2)
    for (a, c) in (((x0, y0), (x0, y1)), ((x1, y0), (x1, y1))):
        soft_box(steel, a[0] - 0.04, a[1] - 0.04, c[0] + 0.04, c[1] + 0.04, 0.0, 0.06, 0.006, cuts=2)
    # holes down the uprights (chrome dots)
    for (x, y) in ((x0, y1), (x1, y1)):
        for k in range(18):
            z = 0.4 + k * 0.08
            cylinder_axis(b.bm("hd_chrome"), (x - 0.006, y + 0.04, z), (x + 0.006, y + 0.041, z), 0.011, 10)
    # barbell on the J-hooks, two plates each side
    zb = 1.32
    cylinder_axis(b.bm("hd_knurl"), (x0 - 0.5, y1 + 0.06, zb), (x1 + 0.5, y1 + 0.06, zb), 0.014, 16)
    for sx, end in ((-1, x0 - 0.12), (1, x1 + 0.12)):
        for k in range(2):
            ring_plate(b.bm("hd_hexrubber"), (end + sx * (0.04 + k * 0.06), y1 + 0.06, zb), "x", 0.225, 0.026, 0.045)
        cylinder_axis(b.bm("hd_chrome"), (end + sx * 0.0, y1 + 0.06, zb), (end + sx * 0.38, y1 + 0.06, zb), 0.025, 20)
    # plate tree beside it
    tx, ty = x1 + 0.55, (y0 + y1) / 2
    soft_box(steel, tx - 0.25, ty - 0.2, tx + 0.25, ty + 0.2, 0.0, 0.05, 0.01, cuts=2)
    cylinder_axis(steel, (tx, ty, 0.05), (tx, ty, 0.9), 0.03)
    for k, (R, z) in enumerate(((0.225, 0.5), (0.17, 0.78))):
        for sy in (-1, 1):
            cylinder_axis(b.bm("hd_chrome"), (tx, ty, z), (tx, ty + sy * 0.18, z), 0.025)
            ring_plate(b.bm("hd_hexrubber"), (tx, ty + sy * 0.1, z), "y", R, 0.026, 0.045)


def kettlebells(b, x0, x1, y):
    n = max(3, int((x1 - x0) / 0.32))
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        r = 0.08 + 0.012 * i
        sphere(b.bm("hd_hexrubber"), (x, y, r * 0.95), r, sz=0.95)
        torus_axis(b.bm("hd_steel"), (x, y, r * 1.75), r * 0.62, 0.016, axis="y", arc=math.pi, seg=20)


def cable_station(b, x0, y0, x1, H=2.35):
    """Dual adjustable pulley: two weight-stack towers joined overhead."""
    steel = b.bm("hd_steel")
    for x in (x0, x1):
        soft_box(steel, x - 0.2, y0, x + 0.2, y0 + 0.35, 0.0, H, 0.02, cuts=3)
        soft_box(b.bm("hd_chrome"), x - 0.12, y0 + 0.36, x + 0.12, y0 + 0.37, 0.1, 1.2, 0.004, cuts=2)  # stack guard
        for k in range(12):
            soft_box(b.bm("hd_hexrubber"), x - 0.11, y0 + 0.37, x + 0.11, y0 + 0.385, 0.12 + k * 0.05, 0.16 + k * 0.05, 0.004, cuts=2)
        tube(b.bm("hd_chrome"), [(x, y0 + 0.4, 1.5), (x, y0 + 0.55, 1.5)], 0.012, 10)
        sphere(b.bm("hd_steel"), (x, y0 + 0.6, 1.5), 0.045)
    soft_box(steel, x0 - 0.2, y0, x1 + 0.2, y0 + 0.35, H - 0.12, H, 0.02, cuts=3)
    tube(b.bm("hd_chrome"), [(x0 + 0.3, y0 + 0.4, H - 0.3), (x1 - 0.3, y0 + 0.4, H - 0.3)], 0.016, 12)


def mat_roll(b, x, y, z, along="x", color="hd_fabric_dark"):
    if along == "x":
        cylinder_axis(b.bm(color), (x - 0.3, y, z + 0.075), (x + 0.3, y, z + 0.075), 0.075, 24)
    else:
        cylinder_axis(b.bm(color), (x, y - 0.3, z + 0.075), (x, y + 0.3, z + 0.075), 0.075, 24)


# ---------------------------------------------------------------- pools
def pool_edge(b, x0, y0, x1, y1, water_z=-0.08, deep=1.3, steps_at="left", rails=True, lights=True):
    """Bullnose coping round the pool, a waterline tile band, corner entry steps, chrome grab rails and
    underwater lights. The basin itself (mosaic + water) is drawn by the caller."""
    cop = 0.3
    # coping: rounded stone kerb sitting on the deck, overhanging the water by 3 cm
    for (a, c, d_, e) in ((x0 - cop, y0 - cop, x1 + cop, y0 + 0.03), (x0 - cop, y1 - 0.03, x1 + cop, y1 + cop),
                          (x0 - cop, y0, x0 + 0.03, y1), (x1 - 0.03, y0, x1 + cop, y1)):
        soft_box(b.bm("hd_coping"), a, c, d_, e, -0.03, 0.02, 0.02, cuts=4)
    # waterline band: a darker glazed tile under the coping
    for (a, c, d_, e) in ((x0, y0, x1, y0 + 0.052), (x0, y1 - 0.052, x1, y1), (x0, y0, x0 + 0.052, y1), (x1 - 0.052, y0, x1, y1)):
        b.box("hd_steel", a, c, d_, e, water_z - 0.12, -0.03)
    # entry steps in a corner, full width of 1.6 m
    if steps_at:
        w = min(1.6, (y1 - y0) * 0.45)
        for k in range(4):
            depth = 0.34 * (4 - k)
            z = water_z - 0.2 - k * 0.22
            if steps_at == "left":
                soft_box(b.bm("mosaic"), x0, y0, x0 + depth, y0 + w, -deep, z, 0.015, cuts=3)
                b.box("hd_coping", x0 + depth - 0.04, y0 + 0.02, x0 + depth, y0 + w - 0.02, z - 0.005, z + 0.004)
            else:
                soft_box(b.bm("mosaic"), x1 - depth, y0, x1, y0 + w, -deep, z, 0.015, cuts=3)
                b.box("hd_coping", x1 - depth, y0 + 0.02, x1 - depth + 0.04, y0 + w - 0.02, z - 0.005, z + 0.004)
        if rails:
            xr = x0 + 0.35 if steps_at == "left" else x1 - 0.35
            xe = x0 - 0.15 if steps_at == "left" else x1 + 0.15
            for yy in (y0 + 0.12, y0 + w - 0.12):
                tube(b.bm("hd_chrome"), [(xe, yy, 0.02), (xe, yy, 0.82), ((xe + xr) / 2, yy, 0.86), (xr, yy, 0.6), (xr + (0.35 if steps_at == "left" else -0.35), yy, -0.3)], 0.022, 14)
    # ladder at the far end
    if rails:
        xl = x1 - 1.2 if steps_at == "left" else x0 + 1.2
        for xx in (xl - 0.25, xl + 0.25):
            tube(b.bm("hd_chrome"), [(xx, y1 + 0.2, 0.02), (xx, y1 + 0.2, 0.75), (xx, y1 - 0.02, 0.85), (xx, y1 - 0.1, 0.4), (xx, y1 - 0.1, -1.0)], 0.022, 14)
        for k in range(3):
            z = -0.35 - k * 0.28
            soft_box(b.bm("hd_steel"), xl - 0.24, y1 - 0.16, xl + 0.24, y1 - 0.06, z - 0.02, z, 0.008, cuts=2)
    # underwater lights
    if lights:
        n = max(2, int((x1 - x0) / 3.0))
        for k in range(n):
            x = x0 + (x1 - x0) * (k + 0.5) / n
            for (y, d) in ((y0 + 0.005, 1), (y1 - 0.005, -1)):
                cylinder_axis(b.bm("led"), (x, y, -0.55), (x, y + d * 0.012, -0.55), 0.11, 24)
                point(x, y + d * 0.25, -0.55, 18.0, 0.08, (0.75, 0.9, 1.0))


def gym_room(b, W, D, H, plant=None):
    """Residents' gym, view along plan +y: a cardio row at the glass, free weights against the mirrored back
    wall, benches between, a half rack and a cable station to one side."""
    for i in range(4):
        treadmill(b, 2.2 + i * 1.6, D - 3.0, "view")
    dumbbell_rack(b, 2.6, 7.4, 0.12, facing="bottom")
    for x, inc in ((3.4, 0.0), (6.4, 30.0)):
        bench(b, x, 3.4, "y", inc)
    dumbbell(b, 3.85, 3.0, 0.07, 0.36, 0.07, "y")
    dumbbell(b, 3.95, 3.2, 0.07, 0.36, 0.07, "y")
    power_rack(b, 10.6, 1.0, 11.8, 2.2)
    cable_station(b, 8.4, 0.12, 9.6)
    kettlebells(b, 0.6, 2.2, 0.45)
    for k in range(3):
        mat_roll(b, 12.4, 4.2 + k * 0.2, 0.0, "x", ("hd_fabric_dark", "hd_terracotta", "hd_taupe")[k])
    if plant:
        for (x, y) in ((0.6, D - 0.6), (W - 0.6, D - 0.6)):
            if not plant_asset(x, y, big=True):
                plant(b, x, y, 1.8, 0.3)
