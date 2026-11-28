"""
Azure Crest Residences: 360-degree tours (FICTIONAL project).

Builds every residence interior from the website's own floor plans (walls, doors, glazing, furniture: exported
by `pnpm --filter @gsc/web tours:export` to tours.json) plus the amenity spaces, and renders an equirectangular
panorama at every tour stop. The view through the glass is real: an HDR panorama rendered from the exterior
scene (cinematic.py) at that residence's own floor, with its tower hidden, so the lagoon, the second tower, the
beaches and the islands are where they are in the 3D model.

  blender -b --factory-startup -P assets/models/source/tours.py -- --seed assets/seed/project.json \
      --out apps/web/public/tours [--quality draft|final] [--only env,studio,1br,lobby,...] [--force-env]

Then `python assets/images/tour_sizes.py` writes the 2048 px phone versions.

Conventions (shared with apps/web/src/features/residence/tour.ts):
  plan (x, y) metres, y towards the view side  ->  Blender (x, -y, z).
  Every panorama is centred on the view side (plan +y); see `pano_rotation`.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_tower as bt  # noqa: E402
import cinematic as cin  # noqa: E402
import interiors as hd  # noqa: E402
from cinematic import NT, mat_new, srgb  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_DIR = os.path.join(ROOT, "assets", "models", "env")  # git-ignored HDR cache
EYE = 1.55  # metres
EYE_UNITS = 0.47  # the same eye height in the exterior model (1 unit = 1 floor = 3.3 m)
SEA_THETA = math.pi  # interior view side (-Y) looks at the exterior sea (+Y)
# Which way each unit position looks in the exterior (interior -Y turned by theta): sea, sea, city, and the
# marina corner looking diagonally along the coast past the second tower.
POSITION_THETA = {"01": math.pi, "02": math.pi, "03": 0.0, "04": 0.75 * math.pi}
WARM = (1.0, 0.76, 0.52)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--seed", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--quality", default="final", choices=["draft", "final"])
    p.add_argument("--only", default="")
    p.add_argument("--stops", default="", help="comma list of stop ids to render (default all)")
    p.add_argument("--force-env", action="store_true")
    p.add_argument("--test-orient", action="store_true")
    return p.parse_args(argv)


# ---------------------------------------------------------------- render setup
def gpu_cycles(samples, threshold):
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
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = threshold
    c.use_denoising = True
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces, c.transmission_bounces, c.transparent_max_bounces = 8, 3, 3, 8, 12
    c.caustics_reflective = c.caustics_refractive = False
    c.blur_glossy = 1.0
    c.sample_clamp_indirect = 8.0
    scn.render.use_persistent_data = True


def pano_camera(name, loc, rot):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "PANO"
    try:
        cam.data.panorama_type = "EQUIRECTANGULAR"
    except AttributeError:  # Blender < 4.0
        cam.data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam.data.clip_start = 0.02
    cam.data.clip_end = 8000
    cam.location = loc
    cam.rotation_euler = rot
    bpy.context.scene.camera = cam
    return cam


# Panorama centred on world +X (what an Environment Texture expects), and the tour convention (plan +y = -Y).
ENV_ROT = (math.pi / 2, 0.0, -math.pi / 2)
PANO_ROT = (math.pi / 2, 0.0, math.pi)


def render_to(path, w, h, fmt="WEBP", quality=84):
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.resolution_percentage = 100
    st = scn.render.image_settings
    st.file_format = fmt
    if fmt == "OPEN_EXR":
        st.color_depth = "16"
        st.exr_codec = "ZIP"
        st.color_mode = "RGB"
    else:
        st.color_mode = "RGB"
        st.quality = quality
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDERED", os.path.relpath(path, ROOT))


# ---------------------------------------------------------------- exterior: HDR views + outdoor stops
def exterior_views(seed, tours, args):
    """Build the cinematic exterior once; render the window views (EXR) and the outdoor tour stops (WebP)."""
    cin.build(seed)
    cin.setup_render("final")
    cin.set_pass(set(cin.LAYERS), set(), False, True)
    scn = bpy.context.scene
    scn.view_settings.exposure = -0.45
    draft = args.quality == "draft"
    W = 2048 if draft else 4096
    ENV_W = 4096  # cached and reused by every later run, so always full resolution

    t1 = next(b for b in seed["project"]["buildings"] if b["id"] == "T1")
    roof_cz = bt.PODIUM_TOP + (t1["floors"] - 2) * bt.FLOOR_H + bt.SLAB_T
    t1_objects = [ob for ob in bpy.data.objects if ob.name.startswith("T1") or ob.name == "LoungeLight"]

    views = {}
    for t, r in tours["residences"].items():
        vp = r["viewpoint"]
        sx, sz = {"01": (-1, -1), "02": (1, -1), "03": (-1, 1), "04": (1, 1)}[vp["position"]]
        x = bt.BUILDING_OFFSET[vp["building"]] + sx * bt.UNIT_OFFSET
        y = -sz * bt.UNIT_OFFSET
        z = bt.PODIUM_TOP + (vp["floor"] - 3) * bt.FLOOR_H + bt.SLAB_T + EYE_UNITS
        views[t] = ((x, y, z), True)
    views["sky"] = ((-8.0, 0.0, roof_cz + EYE_UNITS), True)
    views["ground"] = ((0.0, 7.6, EYE_UNITS), False)

    wanted = set(args.only.split(",")) if args.only else None
    for name, (loc, hide_t1) in views.items():
        path = os.path.join(ENV_DIR, f"{name}.exr")
        if os.path.exists(path) and not args.force_env:
            continue
        if wanted and name not in wanted and "env" not in wanted and not needs_env(name, wanted, tours):
            continue
        for ob in t1_objects:
            ob.hide_render = hide_t1
        cin.setup_compositor(True, haze=True, glare=False)
        pano_camera(f"Env_{name}", loc, ENV_ROT)
        render_to(path, ENV_W, ENV_W // 2, "OPEN_EXR")
    for ob in t1_objects:
        ob.hide_render = False

    # Outdoor stops: rendered directly in the exterior scene, centred on the sea.
    outdoor = {"podium-pool": (0.0, -1.7, bt.PODIUM_TOP + 0.1 + EYE_UNITS), "promenade": (8.0, 10.4, EYE_UNITS)}
    for key, loc in outdoor.items():
        if wanted and key not in wanted:
            continue
        if key == "podium-pool":
            dress_podium()
        cin.setup_compositor(True, haze=True, glare=True)
        pano_camera(f"Pano_{key}", loc, (math.pi / 2, 0.0, 0.0))
        stop = tours["amenities"][key]["stops"][0]["id"]
        render_to(os.path.join(args.out, key, f"{stop}-4096.webp"), W, W // 2, quality=86)


def needs_env(name, wanted, tours):
    if name in tours["residences"]:
        return name in wanted
    if name == "sky":
        return "sky-lounge" in wanted
    return bool({"lobby", "spa", "gym"} & wanted)


def dress_podium():
    """Render-only pool deck furniture (exterior model units: 1 unit = 3.3 m)."""
    if "Podium_Loungers" in bpy.data.objects:
        return
    z = bt.PODIUM_TOP + 0.1
    teak, lounge, cushion, umb, leaf, trunk = (bmesh.new() for _ in range(6))
    for side in (-1, 1):
        for i in range(5):
            y = 0.0 + i * 1.05
            x = side * 3.0
            bt.add_box(lounge, x, y, z + 0.012, 0.11, 0.3, z + 0.08)
            bt.add_box(cushion, x, y + 0.05, z + 0.08, 0.1, 0.24, z + 0.1)
            if i % 2 == 0:
                bt.add_box(umb, x + side * 0.28, y + 0.5, z, 0.012, 0.012, z + 0.75)
                bt.add_tapered(umb, bt.rounded_rect(x + side * 0.28, y + 0.5, 0.42, 0.42, 0.41, 6), z + 0.72, z + 0.82, 0.05)
    for j, (x, y) in enumerate([(-3.4, -3.5), (3.4, -3.5), (-3.4, 5.0), (3.4, 5.0)]):
        cin.palm(trunk, leaf, x, y, z + 0.35, 2.4, (0.1, 0.05), seed=90 + j)
    cin.mesh_obj("Podium_Loungers", lounge, cin.MAT["bronze_dark"], bpy.context.scene.collection)
    cin.mesh_obj("Podium_Cushions", cushion, cin.MAT["linen"], bpy.context.scene.collection)
    cin.mesh_obj("Podium_Umbrellas", umb, cin.MAT["linen"], bpy.context.scene.collection)
    cin.mesh_obj("Podium_PalmTrunks", trunk, cin.MAT["bark"], bpy.context.scene.collection)
    cin.mesh_obj("Podium_PalmLeaves", leaf, cin.MAT["leaf"], bpy.context.scene.collection)


# ---------------------------------------------------------------- interior scene
def interior_scene(env_name, theta, args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    draft = args.quality == "draft"
    gpu_cycles(48 if draft else 80, 0.04 if draft else 0.03)
    scn = bpy.context.scene
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Base Contrast"
    scn.view_settings.exposure = 0.55

    world = bpy.data.worlds.new("View")
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(ENV_DIR, f"{env_name}.exr"), check_existing=True)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.vector_type = "POINT"
    mp.inputs["Rotation"].default_value = (0, 0, theta)
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 1.0
    world.cycles.sampling_method = "MANUAL"
    world.cycles.sample_map_resolution = 2048

    # The exterior's sun lamp, turned into this room's frame (the HDR alone carries only the faint sun disc).
    el, rot = math.radians(cin.SUN_ELEV), math.radians(cin.SUN_ROT)
    ext_dir = Vector((math.sin(rot) * math.cos(el), math.cos(rot) * math.cos(el), math.sin(el)))  # matches cinematic.py's lamp and sky disc
    d = Matrix.Rotation(-theta, 3, "Z") @ ext_dir
    d.z = max(d.z, math.sin(math.radians(9)))  # a little higher than outside so the light reaches the floor
    d.normalize()
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.6
    sun.data.color = (1.0, 0.74, 0.5)
    sun.data.angle = math.radians(1.0)
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scn.collection.objects.link(sun)
    return scn


# ---------------------------------------------------------------- materials
M = {}


def mat(key, fn):
    m = mat_new(f"in_{key}")
    fn(m)
    M[key] = m
    return m


def simple(color, rough=0.5, metal=0.0, **kw):
    def f(m):
        g = NT(m)
        g.surface(g.principled(srgb(color), rough=rough, metal=metal, **kw).outputs[0])

    return f


def fabric(color, color2=None):
    def f(m):
        g = NT(m)
        nz = g.noise(220.0, 2.0)
        col = g.mix_rgb(g.math("MULTIPLY", nz.outputs["Fac"], 0.35), srgb(color), srgb(color2 or color))
        p = g.principled(col, rough=0.92, Sheen_Weight=0.35, Normal=g.bump(nz.outputs["Fac"], 0.12, 0.01))
        g.surface(p.outputs[0])

    return f


def planks(tex, size, row, length, c1, c2, mortar, rough=0.38, coat=0.15, mix=0.7):
    """Planks running along plan y (towards the view), real-world scale, tone varying per plank."""

    def f(m):
        g = NT(m)
        sep = g.n("ShaderNodeSeparateXYZ")
        g.link(g.position(), sep.inputs[0])
        comb = g.n("ShaderNodeCombineXYZ")
        g.link(sep.outputs[1], comb.inputs[0])
        g.link(sep.outputs[0], comb.inputs[1])
        b = g.n("ShaderNodeTexBrick")
        b.offset = 0.41
        b.inputs["Scale"].default_value = 1.0
        b.inputs["Brick Width"].default_value = length
        b.inputs["Row Height"].default_value = row
        b.inputs["Mortar Size"].default_value = 0.0025
        b.inputs["Bias"].default_value = 0.0
        b.inputs["Color1"].default_value = srgb(c1)
        b.inputs["Color2"].default_value = srgb(c2)
        b.inputs["Mortar"].default_value = srgb(mortar)
        g.link(comb.outputs[0], b.inputs["Vector"])
        col = g.mix_rgb(mix, b.outputs["Color"], g.image(tex, size, comb.outputs[0]))
        p = g.principled(col, rough=rough, Coat_Weight=coat, Normal=g.bump(b.outputs["Fac"], 0.2, 0.004))
        g.surface(p.outputs[0])

    return f


def stone_tiles(m):
    g = NT(m)
    b = g.n("ShaderNodeTexBrick")
    b.offset = 0.5
    b.inputs["Scale"].default_value = 1.0
    b.inputs["Brick Width"].default_value = 1.2
    b.inputs["Row Height"].default_value = 0.6
    b.inputs["Mortar Size"].default_value = 0.002
    st = g.image("travertine", 1.1)
    g.link(st, b.inputs["Color1"])
    g.link(st, b.inputs["Color2"])
    b.inputs["Mortar"].default_value = srgb("#BDB09B")
    g.link(g.position(), b.inputs["Vector"])
    p = g.principled(b.outputs["Color"], rough=0.24, Normal=g.bump(b.outputs["Fac"], 0.15, 0.003))
    g.surface(p.outputs[0])


def stone(rough=0.3, size=1.0, tint=None):
    def f(m):
        g = NT(m)
        col = g.image("travertine", size)
        if tint:
            col = g.mix_rgb(0.45, col, srgb(tint))
        g.surface(g.principled(col, rough=rough).outputs[0])

    return f


def plaster(color="#EEE8DE", amount=0.3, rough=0.85):
    def f(m):
        g = NT(m)
        col = g.mix_rgb(amount, srgb(color), g.image("plaster", 1.6))
        g.surface(g.principled(col, rough=rough).outputs[0])

    return f


def window_glass(m):
    """Mostly transparent (keeps camera rays and sunlight straight through) with a faint reflection."""
    g = NT(m)
    tr = g.n("ShaderNodeBsdfTransparent")
    gl = g.n("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.02
    mx = g.n("ShaderNodeMixShader")
    mx.inputs[0].default_value = 0.07
    g.link(tr.outputs[0], mx.inputs[1])
    g.link(gl.outputs[0], mx.inputs[2])
    g.surface(mx.outputs[0])


def sheer(m):
    g = NT(m)
    tl = g.n("ShaderNodeBsdfTranslucent")
    tl.inputs["Color"].default_value = srgb("#F6F0E6")
    df = g.n("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = srgb("#F3EEE6")
    tr = g.n("ShaderNodeBsdfTransparent")
    a = g.n("ShaderNodeMixShader")
    a.inputs[0].default_value = 0.5
    g.link(tl.outputs[0], a.inputs[1])
    g.link(df.outputs[0], a.inputs[2])
    b = g.n("ShaderNodeMixShader")
    b.inputs[0].default_value = 0.45
    g.link(a.outputs[0], b.inputs[1])
    g.link(tr.outputs[0], b.inputs[2])
    g.surface(b.outputs[0])


def water(m):
    """Refractive pool surface. Shadow rays pass straight through (tinted), so sun and lamps light the mosaic
    basin; with a plain refractive surface the basin stays unlit and the pool reads as a pale mirror slab."""
    g = NT(m)
    nz = g.noise(3.0, 3.0)
    p = g.principled(srgb("#7FC4CC"), rough=0.02, Transmission_Weight=1.0, IOR=1.33, Normal=g.bump(nz.outputs["Fac"], 0.08, 0.05))
    tr = g.n("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = srgb("#B8E0E4")
    lp = g.n("ShaderNodeLightPath")
    mx = g.n("ShaderNodeMixShader")
    g.link(lp.outputs["Is Shadow Ray"], mx.inputs[0])
    g.link(p.outputs[0], mx.inputs[1])
    g.link(tr.outputs[0], mx.inputs[2])
    g.surface(mx.outputs[0])


def mosaic(m):
    g = NT(m)
    b = g.n("ShaderNodeTexBrick")
    b.inputs["Scale"].default_value = 40.0
    b.inputs["Mortar Size"].default_value = 0.04
    b.inputs["Brick Width"].default_value = 0.5
    b.inputs["Row Height"].default_value = 0.5
    b.inputs["Color1"].default_value = srgb("#2D6C78")
    b.inputs["Color2"].default_value = srgb("#3F8590")
    b.inputs["Mortar"].default_value = srgb("#CFE0DE")
    g.link(g.position(), b.inputs["Vector"])
    g.surface(g.principled(b.outputs["Color"], rough=0.2).outputs[0])


def rug(c1, c2):
    def f(m):
        g = NT(m)
        nz = g.noise(9.0, 6.0)
        col = g.mix_rgb(nz.outputs["Fac"], srgb(c1), srgb(c2))
        g.surface(g.principled(col, rough=1.0, Sheen_Weight=0.6, Normal=g.bump(g.noise(300.0, 2.0).outputs["Fac"], 0.3, 0.01)).outputs[0])

    return f


def canvas(m):
    g = NT(m)
    w = g.n("ShaderNodeTexWave")
    w.inputs["Scale"].default_value = 0.45
    w.inputs["Distortion"].default_value = 1.6
    w.inputs["Detail"].default_value = 1.0
    g.link(g.position(), w.inputs["Vector"])
    ramp = g.n("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = srgb("#D8C3A4")
    ramp.color_ramp.elements[1].color = srgb("#F0E8DC")
    e = ramp.color_ramp.elements.new(0.5)
    e.color = srgb("#B99A78")
    g.link(w.outputs["Fac"], ramp.inputs[0])
    g.surface(g.principled(ramp.outputs[0], rough=0.9).outputs[0])


def emit(color, strength):
    return lambda m: cin.shade_emit(m, color, strength)


def make_materials():
    M.clear()
    mat("oak_floor", planks("oak", 1.6, 0.19, 1.9, "#D2B08A", "#BF9B74", "#7A5C40"))
    mat("tiles", stone_tiles)
    mat("stone", stone(0.28))
    mat("stone_wall", stone(0.4, 1.3))
    mat("stone_dark", stone(0.35, 1.0, "#6B5A48"))
    mat("plaster", plaster())
    mat("ceiling", plaster("#F4F1EB", 0.15, 0.92))
    mat("oak", planks("oak", 1.2, 0.6, 2.4, "#C7A27C", "#BE9874", "#8E6E50", rough=0.45, coat=0.1, mix=0.8))
    mat("walnut", simple("#5A3D29", 0.5, Coat_Weight=0.2))
    mat("bronze", cin.shade_bronze)
    mat("black", simple("#1E1D1C", 0.35, 0.8))
    mat("glass", window_glass)
    mat("clear", lambda m: cin.shade_clear_glass(m, "#E8F1F2"))
    mat("mirror", simple("#E6E6E4", 0.02, 1.0))
    mat("porcelain", simple("#F6F5F1", 0.08, Coat_Weight=1.0))
    mat("linen", fabric("#F3EFE8", "#E9E3D8"))
    mat("duvet", fabric("#ECE6DB", "#E2DACC"))
    mat("fabric", fabric("#E6DED1", "#D9CFC0"))
    mat("taupe", fabric("#B9A68D", "#A99479"))
    mat("navy", fabric("#1E2A3B", "#2A374A"))
    mat("throw", fabric("#BFA07A", "#AD8C66"))
    mat("rug", rug("#CDBFA8", "#BCAC92"))
    mat("rug_dark", rug("#6E6458", "#5E554A"))
    mat("sheer", sheer)
    mat("leaf", cin.shade_leaf)
    mat("pot", stone(0.6, 0.7, "#A99C88"))
    mat("water", water)
    # a filled bath: opaque so a shallow layer inside porcelain doesn't go black under transmission
    mat("bathwater", simple("#CFE3E1", 0.03, Coat_Weight=0.6))
    mat("mosaic", mosaic)
    mat("canvas", canvas)
    mat("rubber", simple("#2A2A2B", 0.9))
    mat("led", emit("#FFC98A", 9.0))
    mat("lamp", emit("#FFD9AE", 1.3))
    mat("downlight", emit("#FFE2BC", 12.0))
    mat("amber", emit("#E7A456", 1.6))
    mat("screen", emit("#20303C", 0.6))
    mat("basin", simple("#E2DFD8", 0.25))
    hd.make_materials(mat, fabric, simple)


# ---------------------------------------------------------------- geometry builder (plan metres -> Blender)
BEVELLED = {"fabric", "taupe", "navy", "linen", "duvet", "throw", "porcelain", "oak", "walnut", "stone", "pot", "leaf"}


class Builder:
    def __init__(self):
        self.bms = {}

    def bm(self, key):
        if key not in self.bms:
            self.bms[key] = bmesh.new()
        return self.bms[key]

    def box(self, key, x0, y0, x1, y1, z0, z1):
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
            return
        bt.add_prism(self.bm(key), [(x0, -y1), (x1, -y1), (x1, -y0), (x0, -y0)], z0, z1)

    def prism(self, key, pts, z0, z1, smooth=False):
        bt.add_prism(self.bm(key), [(x, -y) for x, y in reversed(pts)], z0, z1, smooth_sides=smooth)

    def rbox(self, key, x0, y0, x1, y1, z0, z1, r, seg=6):
        cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2
        pts = bt.rounded_rect(cx, -cy, hx, hy, r, seg)
        bt.add_prism(self.bm(key), pts, z0, z1, smooth_sides=True)

    def cyl(self, key, cx, cy, r, z0, z1, seg=24):
        pts = [(cx + r * math.cos(2 * math.pi * i / seg), -cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        bt.add_prism(self.bm(key), pts, z0, z1, smooth_sides=True)

    def sphere(self, key, cx, cy, cz, r, sx=1.0, sy=1.0, sz=1.0, subdiv=2):
        mtx = Matrix.Translation((cx, -cy, cz)) @ Matrix.Diagonal((r * sx, r * sy, r * sz, 1.0))
        res = bmesh.ops.create_icosphere(self.bm(key), subdivisions=subdiv, radius=1.0, matrix=mtx)
        for v in res["verts"]:
            for f in v.link_faces:
                f.smooth = True

    def torus(self, key, cx, cy, cz, R, r, seg=48, rseg=8):
        bm = self.bm(key)
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                rr = R + r * math.cos(b)
                ring.append(bm.verts.new((cx + rr * math.cos(a), -cy + rr * math.sin(a), cz + r * math.sin(b))))
            rings.append(ring)
        for i in range(seg):
            for j in range(rseg):
                a, b = rings[i], rings[(i + 1) % seg]
                f = bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
                f.smooth = True

    def finish(self):
        coll = bpy.context.scene.collection
        for key, bm in self.bms.items():
            me = bpy.data.meshes.new(key)
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(key, me)
            ob.data.materials.append(M[key])
            coll.objects.link(ob)
            if key in BEVELLED:
                mod = ob.modifiers.new("Bevel", "BEVEL")
                mod.width = 0.012
                mod.segments = 2
                mod.limit_method = "ANGLE"
        self.bms = {}


def spot(x, y, z, energy=22.0, size=110.0):
    li = bpy.data.lights.new("Downlight", "SPOT")
    li.energy = energy
    li.color = WARM
    li.spot_size = math.radians(size)
    li.spot_blend = 0.9
    li.shadow_soft_size = 0.04
    ob = bpy.data.objects.new("Downlight", li)
    ob.location = (x, -y, z)
    bpy.context.scene.collection.objects.link(ob)


def point(x, y, z, energy=8.0, radius=0.06):
    li = bpy.data.lights.new("Lamp", "POINT")
    li.energy = energy
    li.color = WARM
    li.shadow_soft_size = radius
    ob = bpy.data.objects.new("Lamp", li)
    ob.location = (x, -y, z)
    bpy.context.scene.collection.objects.link(ob)


# ---------------------------------------------------------------- furniture
PLAN = {"W": 0.0, "D": 0.0}
WET = {"ensuite", "bath", "powder"}


def wall_face(room, side, fallback):
    """Where the finished wall surface is on that side of the room (walls are centred on the plan lines)."""
    if not room or PLAN["W"] <= 0:
        return fallback
    W, D = PLAN["W"], PLAN["D"]
    clad = 0.02 if room.get("kind") in WET else 0.0
    if side == "left":
        return room["x"] + (0.125 if abs(room["x"]) < 1e-6 else 0.06) + clad
    if side == "right":
        e = room["x"] + room["w"]
        return e - (0.125 if abs(e - W) < 1e-6 else 0.06) - clad
    if side == "top":
        return room["y"] + (0.125 if abs(room["y"]) < 1e-6 else 0.06) + clad
    e = room["y"] + room["h"]
    return e - (0.125 if abs(e - D) < 1e-6 else 0.06) - clad


def lamp_on(b, cx, cy, z):
    b.cyl("bronze", cx, cy, 0.05, z, z + 0.32, 12)
    b.cyl("lamp", cx, cy, 0.15, z + 0.3, z + 0.52, 24)
    point(cx, cy, z + 0.42, 7.0, 0.05)


def pendant(b, cx, cy, z, H, r=0.13):
    b.cyl("black", cx, cy, 0.004, z + r, H, 6)
    b.sphere("lamp", cx, cy, z, r, subdiv=3)
    point(cx, cy, z, 10.0, r * 0.8)


def plant(b, cx, cy, h=1.6, r=0.24):
    if hd.plant_asset(cx, cy, big=h >= 1.7, rot=(cx * 37 + cy * 11) % 360):
        return
    b.cyl("pot", cx, cy, r, 0.0, 0.5, 20)
    b.cyl("rubber", cx, cy, r * 0.9, 0.5, 0.52, 20)
    import random

    rnd = random.Random(int(cx * 100 + cy * 10))
    bm = b.bm("leaf")
    for k in range(3):  # a few slender stems, each carrying leaves in its upper part
        a0 = rnd.random() * 2 * math.pi
        lean = 0.12 + 0.1 * rnd.random()
        top = (cx + lean * math.cos(a0), cy + lean * math.sin(a0), h * (0.8 + 0.2 * rnd.random()))
        b.cyl("walnut", (cx + top[0]) / 2, (cy + top[1]) / 2, 0.012, 0.5, top[2], 6)
        for i in range(26):
            t = 0.35 + 0.65 * rnd.random()
            px = cx + (top[0] - cx) * t + (rnd.random() - 0.5) * r * 1.6
            py = cy + (top[1] - cy) * t + (rnd.random() - 0.5) * r * 1.6
            pz = 0.5 + (top[2] - 0.5) * t
            L = 0.11 + 0.07 * rnd.random()
            mtx = (
                Matrix.Translation((px, -py, pz))
                @ Matrix.Rotation(rnd.random() * 2 * math.pi, 4, "Z")
                @ Matrix.Rotation(-0.3 - 0.6 * rnd.random(), 4, "Y")
                @ Matrix.Diagonal((L, L * 0.55, 0.008, 1.0))
            )
            res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=mtx)
            for v in res["verts"]:
                for f in v.link_faces:
                    f.smooth = True


def fixture(b, f, room, H, coffee=None):
    k = f["kind"]
    x0, y0, w, h = f["x"], f["y"], f["w"], f["h"]
    x1, y1 = x0 + w, y0 + h
    side = f.get("side")
    if k == "bed":
        head = side or "left"
        if True:
            wall = wall_face(room, head, None) if room else None
            hd.bed(b, x0, y0, x1, y1, head, wall)
            return
        b.box("taupe", x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06, 0.06, 0.3)
        b.box("linen", x0 + 0.02, y0 + 0.02, x1 - 0.02, y1 - 0.02, 0.3, 0.52)
        horiz = head in ("left", "right")
        # duvet + throw at the foot
        if horiz:
            fx0, fx1 = (x0 + w * 0.3, x1) if head == "left" else (x0, x1 - w * 0.3)
            b.box("duvet", fx0, y0, fx1, y1, 0.5, 0.58)
            tx0, tx1 = (x1 - w * 0.25, x1 + 0.01) if head == "left" else (x0 - 0.01, x0 + w * 0.25)
            b.box("throw", tx0, y0 - 0.01, tx1, y1 + 0.01, 0.55, 0.6)
            px = x0 + 0.1 if head == "left" else x1 - 0.55
            for i in range(2):
                py = y0 + 0.1 + i * (h - 0.2) / 2
                b.rbox("linen", px, py + 0.03, px + 0.45, py + (h - 0.2) / 2 - 0.03, 0.52, 0.7, 0.08)
            hx0, hx1 = (x0 - 0.12, x0) if head == "left" else (x1, x1 + 0.12)
            if room:
                fw = wall_face(room, head, hx0 if head == "left" else hx1)
                hx0, hx1 = (fw, max(fw + 0.1, x0 + 0.02)) if head == "left" else (min(fw - 0.1, x1 - 0.02), fw)
            b.box("taupe", hx0, y0 - 0.25, hx1, y1 + 0.25, 0.0, 1.25)
        else:
            fy0, fy1 = (y0 + h * 0.3, y1) if head == "top" else (y0, y1 - h * 0.3)
            b.box("duvet", x0, fy0, x1, fy1, 0.5, 0.58)
            ty0, ty1 = (y1 - h * 0.25, y1 + 0.01) if head == "top" else (y0 - 0.01, y0 + h * 0.25)
            b.box("throw", x0 - 0.01, ty0, x1 + 0.01, ty1, 0.55, 0.6)
            py = y0 + 0.1 if head == "top" else y1 - 0.55
            for i in range(2):
                px = x0 + 0.1 + i * (w - 0.2) / 2
                b.rbox("linen", px + 0.03, py, px + (w - 0.2) / 2 - 0.03, py + 0.45, 0.52, 0.7, 0.08)
            hy0, hy1 = (y0 - 0.12, y0) if head == "top" else (y1, y1 + 0.12)
            if room:
                fw = wall_face(room, head, hy0 if head == "top" else hy1)
                hy0, hy1 = (fw, max(fw + 0.1, y0 + 0.02)) if head == "top" else (min(fw - 0.1, y1 - 0.02), fw)
            b.box("taupe", x0 - 0.25, hy0, x1 + 0.25, hy1, 0.0, 1.25)
    elif k == "nightstand":
        b.box("oak", x0, y0, x1, y1, 0.0, 0.5)
        lamp_on(b, (x0 + x1) / 2, (y0 + y1) / 2, 0.5)
    elif k == "sofa":
        hd.sofa(b, x0, y0, x1, y1, side or "left")
    elif k == "armchair" and hd.have_library():
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        face = 0.0
        if coffee is not None:
            face = math.degrees(math.atan2(coffee[0] - cx, coffee[1] - cy))
        hd.lounge_chair(b, cx, cy, face, fit=min(w, h) * 1.15)
    elif k in ("sofa", "armchair"):
        key = "fabric" if k == "sofa" else "navy"
        if k == "armchair" and coffee is not None:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            dx, dy = coffee[0] - cx, coffee[1] - cy
            side = ("left" if dx > 0 else "right") if abs(dx) > abs(dy) else ("top" if dy > 0 else "bottom")
        side = side or "left"
        back = 0.2 if k == "sofa" else 0.16
        b.rbox(key, x0, y0, x1, y1, 0.08, 0.42, 0.06)
        # back cushion + arms
        if side in ("left", "right"):
            bx0, bx1 = (x0, x0 + back) if side == "left" else (x1 - back, x1)
            b.rbox(key, bx0, y0, bx1, y1, 0.42, 0.82, 0.05)
            for (ay0, ay1) in ((y0, y0 + 0.16), (y1 - 0.16, y1)):
                b.rbox(key, x0, ay0, x1, ay1, 0.42, 0.62, 0.05)
            sx0, sx1 = (x0 + back, x1) if side == "left" else (x0, x1 - back)
            n = max(1, round((h - 0.32) / 0.75))
            for i in range(n):
                cy0 = y0 + 0.16 + i * (h - 0.32) / n
                b.rbox(key, sx0 + 0.01, cy0 + 0.01, sx1 - 0.02, cy0 + (h - 0.32) / n - 0.01, 0.42, 0.5, 0.05)
            if k == "sofa":
                for py in (y0 + 0.25, y1 - 0.65):
                    b.rbox("navy" if py < y0 + 1 else "throw", bx0 + (0.17 if side == "left" else -0.17), py, bx1 + (0.17 if side == "left" else -0.17), py + 0.4, 0.5, 0.85, 0.06)
        else:
            by0, by1 = (y0, y0 + back) if side == "top" else (y1 - back, y1)
            b.rbox(key, x0, by0, x1, by1, 0.42, 0.82, 0.05)
            for (ax0, ax1) in ((x0, x0 + 0.16), (x1 - 0.16, x1)):
                b.rbox(key, ax0, y0, ax1, y1, 0.42, 0.62, 0.05)
            sy0, sy1 = (y0 + back, y1) if side == "top" else (y0, y1 - back)
            n = max(1, round((w - 0.32) / 0.75))
            for i in range(n):
                cx0 = x0 + 0.16 + i * (w - 0.32) / n
                b.rbox(key, cx0 + 0.01, sy0 + 0.01, cx0 + (w - 0.32) / n - 0.01, sy1 - 0.02, 0.42, 0.5, 0.05)
    elif k == "coffee" and hd.coffee_set(b, x0, y0, x1, y1):
        pass
    elif k == "coffee":
        b.rbox("stone", x0, y0, x1, y1, 0.0, 0.38, min(w, h) * 0.48, 8)
        b.box("walnut", x0 + w * 0.3, y0 + h * 0.3, x0 + w * 0.55, y0 + h * 0.5, 0.38, 0.44)
        b.cyl("bronze", x0 + w * 0.68, y0 + h * 0.62, 0.12, 0.38, 0.45, 20)
    elif k == "dining":
        b.rbox("oak", x0, y0, x1, y1, 0.72, 0.76, 0.08)
        for t in (0.25, 0.75):
            if w >= h:
                b.box("oak", x0 + w * t - 0.05, y0 + h * 0.3, x0 + w * t + 0.05, y1 - h * 0.3, 0.0, 0.72)
            else:
                b.box("oak", x0 + w * 0.3, y0 + h * t - 0.05, x1 - w * 0.3, y0 + h * t + 0.05, 0.0, 0.72)
        seats = f.get("seats", 4)
        per = max(1, seats // 2)
        for i in range(per):
            t = (i + 0.5) / per
            if w >= h:
                cx = x0 + w * t
                for sgn in (-1, 1):
                    cy = y0 - 0.22 if sgn < 0 else y1 + 0.22
                    b.rbox("fabric", cx - 0.22, cy - 0.2, cx + 0.22, cy + 0.2, 0.0, 0.47, 0.06)
                    by = cy - 0.2 if sgn < 0 else cy + 0.12
                    b.rbox("fabric", cx - 0.22, by, cx + 0.22, by + 0.08, 0.47, 0.88, 0.04)
            else:
                cy = y0 + h * t
                for sgn in (-1, 1):
                    cx = x0 - 0.22 if sgn < 0 else x1 + 0.22
                    b.rbox("fabric", cx - 0.2, cy - 0.22, cx + 0.2, cy + 0.22, 0.0, 0.47, 0.06)
                    bx = cx - 0.2 if sgn < 0 else cx + 0.12
                    b.rbox("fabric", bx, cy - 0.22, bx + 0.08, cy + 0.22, 0.47, 0.88, 0.04)
        n = 3 if max(w, h) > 1.5 else 1
        for i in range(n):
            t = (i + 0.5) / n
            px, py = (x0 + w * t, (y0 + y1) / 2) if w >= h else ((x0 + x1) / 2, y0 + h * t)
            pendant(b, px, py, 1.92, H, 0.11)
        b.cyl("bronze", (x0 + x1) / 2, (y0 + y1) / 2, 0.09, 0.76, 0.98, 16)
    elif k == "counter":
        b.box("oak", x0, y0, x1, y1, 0.08, 0.86)
        b.box("black", x0 + 0.02, y0 + 0.02, x1 - 0.02, y1 - 0.02, 0.0, 0.08)
        b.box("stone", x0 - 0.01, y0 - 0.01, x1 + 0.01, y1 + 0.01, 0.86, 0.9)
        # wall side: stone splashback, upper cabinets with an under-cabinet LED
        sd = side or "top"
        if sd in ("top", "bottom"):
            f_ = wall_face(room, sd, y0 if sd == "top" else y1)
            wy0, wy1 = (f_, f_ + 0.02) if sd == "top" else (f_ - 0.02, f_)
            uy0, uy1 = (f_, f_ + 0.36) if sd == "top" else (f_ - 0.36, f_)
            b.box("stone_wall", x0, wy0, x1, wy1, 0.9, 1.5)
            b.box("oak", x0, uy0, x1, uy1, 1.5, min(H, 2.4))
            b.box("led", x0 + 0.05, uy0 + 0.03 if sd == "top" else uy1 - 0.06, x1 - 0.05, uy0 + 0.06 if sd == "top" else uy1 - 0.03, 1.495, 1.5)
            if w > 1.6:
                b.box("black", x0 + w * 0.62, y0 + 0.1, x0 + w * 0.62 + 0.6, y1 - 0.08, 0.9, 0.905)
                b.box("rubber", x0 + w * 0.15, y0 + 0.12, x0 + w * 0.15 + 0.55, y1 - 0.1, 0.86, 0.902)
                tx = x0 + w * 0.15 + 0.275
                ty = y0 + 0.06 if sd == "top" else y1 - 0.06
                b.cyl("bronze", tx, ty, 0.015, 0.9, 1.2, 8)
                b.box("bronze", tx - 0.01, ty, tx + 0.01, ty + (0.16 if sd == "top" else -0.16), 1.17, 1.2)
        else:
            f_ = wall_face(room, sd, x0 if sd == "left" else x1)
            wx0, wx1 = (f_, f_ + 0.02) if sd == "left" else (f_ - 0.02, f_)
            ux0, ux1 = (f_, f_ + 0.36) if sd == "left" else (f_ - 0.36, f_)
            b.box("stone_wall", wx0, y0, wx1, y1, 0.9, 1.5)
            b.box("oak", ux0, y0, ux1, y1, 1.5, min(H, 2.4))
    elif k == "island":
        b.box("stone", x0, y0, x1, y1, 0.0, 0.93)
        for t in (0.3, 0.7):
            pendant(b, x0 + w * t if w >= h else (x0 + x1) / 2, (y0 + y1) / 2 if w >= h else y0 + h * t, 1.8, H, 0.11)
    elif k == "stools":
        n = f.get("seats", 3)
        for i in range(n):
            cx = x0 + w * (i + 0.5) / n
            cy = (y0 + y1) / 2 + 0.05
            b.cyl("bronze", cx, cy, 0.02, 0.0, 0.62, 8)
            b.cyl("navy", cx, cy, 0.18, 0.62, 0.7, 20)
    elif k == "tub":
        r = min(w, h) * 0.45
        b.rbox("porcelain", x0, y0, x1, y1, 0.0, 0.56, r, 8)
        b.rbox("bathwater", x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0.5, 0.561, r * 0.8, 8)
        tx, ty = (x0 - 0.12, (y0 + y1) / 2) if w >= h else ((x0 + x1) / 2, y0 - 0.12)
        b.cyl("bronze", tx, ty, 0.02, 0.0, 0.95, 8)
    elif k == "shower":
        b.box("stone", x0, y0, x1, y1, 0.0, 0.02)
        rx0, ry0, rx1, ry1 = room["x"], room["y"], room["x"] + room["w"], room["y"] + room["h"]
        if abs(x0 - rx0) > 0.15:
            b.box("glass", x0, y0, x0 + 0.012, y1, 0.02, 2.05)
        if abs(x1 - rx1) > 0.15:
            b.box("glass", x1 - 0.012, y0, x1, y1, 0.02, 2.05)
        if abs(y0 - ry0) > 0.15:
            b.box("glass", x0, y0, x1, y0 + 0.012, 0.02, 2.05)
        if abs(y1 - ry1) > 0.15:
            b.box("glass", x0, y1 - 0.012, x1, y1, 0.02, 2.05)
        b.cyl("bronze", (x0 + x1) / 2, (y0 + y1) / 2, 0.14, 2.18, 2.2, 24)
        b.cyl("bronze", (x0 + x1) / 2, (y0 + y1) / 2, 0.012, 2.2, H, 8)
    elif k == "wc":
        sd = side or "top"
        if sd in ("top", "bottom"):
            wy = y0 if sd == "top" else y1
            d = 1 if sd == "top" else -1
            b.rbox("porcelain", x0 + 0.03, wy + d * 0.02, x1 - 0.03, wy + d * 0.58, 0.28, 0.42, 0.16, 6)
            b.box("bronze", (x0 + x1) / 2 - 0.1, wy, (x0 + x1) / 2 + 0.1, wy + d * 0.012, 0.95, 1.1)
        else:
            wx = x0 if sd == "left" else x1
            d = 1 if sd == "left" else -1
            b.rbox("porcelain", wx + d * 0.02, y0 + 0.03, wx + d * 0.58, y1 - 0.03, 0.28, 0.42, 0.16, 6)
            b.box("bronze", wx, (y0 + y1) / 2 - 0.1, wx + d * 0.012, (y0 + y1) / 2 + 0.1, 0.95, 1.1)
    elif k == "vanity":
        sd = side or "left"
        b.box("oak", x0, y0, x1, y1, 0.35, 0.8)
        b.box("stone", x0 - 0.01, y0 - 0.01, x1 + 0.01, y1 + 0.01, 0.8, 0.84)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        b.cyl("porcelain", cx, cy, 0.19, 0.84, 0.97, 28)
        b.cyl("basin", cx, cy, 0.16, 0.96, 0.971, 28)
        if sd in ("left", "right"):
            wx = wall_face(room, sd, x0 if sd == "left" else x1)
            d = 1 if sd == "left" else -1
            b.box("led", wx, y0 + 0.02, wx + d * 0.01, y1 - 0.02, 1.08, 1.97)
            b.box("mirror", wx + d * 0.012, y0 + 0.05, wx + d * 0.03, y1 - 0.05, 1.1, 1.95)
            b.cyl("bronze", wx + d * 0.06, cy, 0.012, 0.84, 1.08, 8)
        else:
            wy = wall_face(room, sd, y0 if sd == "top" else y1)
            d = 1 if sd == "top" else -1
            b.box("led", x0 + 0.02, wy, x1 - 0.02, wy + d * 0.01, 1.08, 1.97)
            b.box("mirror", x0 + 0.05, wy + d * 0.012, x1 - 0.05, wy + d * 0.03, 1.1, 1.95)
            b.cyl("bronze", cx, wy + d * 0.06, 0.012, 0.84, 1.08, 8)
    elif k == "wardrobe":
        b.box("oak", x0, y0, x1, y1, 0.0, min(H - 0.02, 2.55))
        n = max(2, round(max(w, h) / 0.55))
        for i in range(1, n):
            t = i / n
            if h >= w:
                b.box("bronze", x1 - 0.005 if (x0 + x1) / 2 < room["x"] + room["w"] / 2 else x0 - 0.008, y0 + h * t - 0.006, x1 + 0.008 if (x0 + x1) / 2 < room["x"] + room["w"] / 2 else x0 + 0.005, y0 + h * t + 0.006, 0.9, 1.6)
            else:
                b.box("bronze", x0 + w * t - 0.006, y1 - 0.005, x0 + w * t + 0.006, y1 + 0.008, 0.9, 1.6)
    elif k == "desk":
        b.box("oak", x0, y0, x1, y1, 0.73, 0.77)
        for xx in (x0 + 0.04, x1 - 0.07):
            b.box("bronze", xx, y0 + 0.05, xx + 0.03, y1 - 0.05, 0.0, 0.73)
        b.rbox("navy", (x0 + x1) / 2 - 0.22, y0 - 0.52, (x0 + x1) / 2 + 0.22, y0 - 0.1, 0.0, 0.46, 0.06)
        b.rbox("navy", (x0 + x1) / 2 - 0.22, y0 - 0.56, (x0 + x1) / 2 + 0.22, y0 - 0.48, 0.46, 0.85, 0.04)
        lamp_on(b, x1 - 0.18, (y0 + y1) / 2, 0.77)
    elif k == "stair":
        n = int(H / 0.18)
        for i in range(n):
            ty0 = y0 + h * i / n
            b.box("oak", x0 + 0.04, ty0, x1 - 0.04, ty0 + h / n + 0.02, (i + 1) * H / n - 0.05, (i + 1) * H / n)
        b.box("clear", x0, y0, x0 + 0.012, y1, 0.0, H)
    elif k == "pool":
        b.box("water", x0, y0, x1, y1, -0.08, -0.06)
        b.box("mosaic", x0, y0, x1, y1, -1.2, -1.15)
        for (a, c, d_, e) in ((x0, y0, x0 + 0.05, y1), (x1 - 0.05, y0, x1, y1), (x0, y0, x1, y0 + 0.05), (x0, y1 - 0.05, x1, y1)):
            b.box("mosaic", a, c, d_, e, -1.2, -0.06)
        b.box("led", x0 + 0.05, y0 + 0.05, x1 - 0.05, y0 + 0.07, -0.4, -0.35)
        hd.pool_edge(b, x0, y0, x1, y1, -0.07, 1.2, steps_at="left" if w > 2.5 else None, rails=w > 2.5, lights=True)
    elif k == "lounger":
        b.box("walnut", x0, y0, x1, y1, 0.0, 0.3)
        b.rbox("linen", x0 + 0.03, y0 + 0.03, x1 - 0.03, y1 - 0.03, 0.3, 0.38, 0.04)
        b.box("linen", x0 + 0.03, y0 + 0.03, x1 - 0.03, y0 + 0.5, 0.38, 0.62)


# ---------------------------------------------------------------- shell
COVE_ROOMS = {"living", "livingDining", "studio", "master", "bedroom"}
FLOOR_MAT = {"ensuite": "tiles", "bath": "tiles", "powder": "tiles", "foyer": "tiles", "laundry": "tiles", "store": "tiles"}


def spans_minus(a, b, cuts):
    spans = [(a, b)]
    for c0, c1 in cuts:
        nxt = []
        for s0, s1 in spans:
            if c1 <= s0 or c0 >= s1:
                nxt.append((s0, s1))
            else:
                if c0 > s0:
                    nxt.append((s0, c0))
                if c1 < s1:
                    nxt.append((c1, s1))
        spans = nxt
    return [(s0, s1) for s0, s1 in spans if s1 - s0 > 0.02]


def wavy_edge(W, D, d, n=3, steps=14):
    pts = [(0.0, D), (0.0, D + d * 0.55)]
    for i in range(n):
        xa, xb = W / n * i, W / n * (i + 1)
        xm = (xa + xb) / 2
        for s in range(1, steps + 1):
            t = s / steps
            x = (1 - t) ** 2 * xa + 2 * (1 - t) * t * xm + t * t * xb
            y = (1 - t) ** 2 * (D + d * 0.55) + 2 * (1 - t) * t * (D + d * 1.45) + t * t * (D + d * 0.55)
            pts.append((x, y))
    pts.append((W, D))
    return pts


def build_shell(b, plan, walls, H):
    W, D = plan["width"], plan["depth"]
    rooms = plan["rooms"]
    openings = plan["openings"]
    windows = plan["windows"]

    # floors
    for r in rooms:
        b.box(FLOOR_MAT.get(r["kind"], "oak_floor"), r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"], -0.03, 0.0)
    # walls
    for s in walls:
        t = 0.25 if s["exterior"] else 0.12
        if abs(s["y1"] - s["y2"]) < 1e-6:
            b.box("plaster", s["x1"] - t / 2, s["y1"] - t / 2, s["x2"] + t / 2, s["y1"] + t / 2, 0.0, H)
        else:
            b.box("plaster", s["x1"] - t / 2, s["y1"] - t / 2, s["x1"] + t / 2, s["y2"] + t / 2, 0.0, H)
    # headers, doors
    for o in openings:
        ext = o["at"] < 1e-6 or (o["axis"] == "h" and abs(o["at"] - D) < 1e-6) or (o["axis"] == "v" and abs(o["at"] - W) < 1e-6)
        t = 0.25 if ext else 0.12
        span = o["to"] - o["from"]
        z_head = 2.35 if o["type"] != "open" else (2.5 if span < 1.8 else None)
        if z_head is not None:
            if o["axis"] == "h":
                b.box("plaster", o["from"], o["at"] - t / 2, o["to"], o["at"] + t / 2, z_head, H)
            else:
                b.box("plaster", o["at"] - t / 2, o["from"], o["at"] + t / 2, o["to"], z_head, H)
        if o["type"] == "entry":
            if o["axis"] == "h":
                b.box("walnut", o["from"], o["at"] - 0.03, o["to"], o["at"] + 0.03, 0.0, 2.35)
                b.box("bronze", o["to"] - 0.12, o["at"] + 0.03, o["to"] - 0.1, o["at"] + 0.06, 0.6, 1.6)
        elif o["type"] == "door":
            L = span
            sgn = -1 if o.get("into") == "-" else 1
            hinge = o["to"] if o.get("hinge") == "to" else o["from"]
            if o["axis"] == "h":
                hx = hinge + (-0.045 if o.get("hinge") == "to" else 0)
                b.box("oak", hx, o["at"], hx + 0.045, o["at"] + sgn * L, 0.01, 2.33)
            else:
                hy = hinge + (-0.045 if o.get("hinge") == "to" else 0)
                b.box("oak", o["at"], hy, o["at"] + sgn * L, hy + 0.045, 0.01, 2.33)
    # glazing: frameless panes with slim bronze mullions, sheer curtains stacked at each end
    for w in windows:
        a, c = w["from"], w["to"]
        n = max(1, math.ceil((c - a) / 1.7))
        inward = -1 if (w["axis"] == "h" and w["at"] > 0) or (w["axis"] == "v" and w["at"] > 0) else 1
        for (key, z0, z1) in (("glass", 0.0, H),):
            if w["axis"] == "h":
                b.box(key, a, w["at"] - 0.01, c, w["at"] + 0.01, z0, z1)
            else:
                b.box(key, w["at"] - 0.01, a, w["at"] + 0.01, c, z0, z1)
        for i in range(n + 1):
            p = a + (c - a) * i / n
            if w["axis"] == "h":
                b.box("black", p - 0.025, w["at"] - 0.04, p + 0.025, w["at"] + 0.04, 0.0, H)
            else:
                b.box("black", w["at"] - 0.04, p - 0.025, w["at"] + 0.04, p + 0.025, 0.0, H)
        if w["axis"] == "h":
            b.box("black", a, w["at"] - 0.05, c, w["at"] + 0.05, 0.0, 0.04)
            for (s0, s1) in ((a + 0.02, a + 0.5), (c - 0.5, c - 0.02)):
                b.box("sheer", s0, w["at"] + inward * 0.18, s1, w["at"] + inward * 0.22, 0.02, H - 0.04)
        else:
            b.box("black", w["at"] - 0.05, a, w["at"] + 0.05, c, 0.0, 0.04)
            for (s0, s1) in ((a + 0.02, a + 0.5), (c - 0.5, c - 0.02)):
                b.box("sheer", w["at"] + inward * 0.18, s0, w["at"] + inward * 0.22, s1, 0.02, H - 0.04)
    # wet rooms clad in travertine to the ceiling
    cuts_all = openings + windows
    for r in rooms:
        if r["kind"] not in ("ensuite", "bath", "powder"):
            continue
        x0, y0, x1, y1 = r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]
        for (axis, at, a0, a1, inward) in (("h", y0, x0, x1, 1), ("h", y1, x0, x1, -1), ("v", x0, y0, y1, 1), ("v", x1, y0, y1, -1)):
            ext = at < 1e-6 or (axis == "h" and abs(at - D) < 1e-6) or (axis == "v" and abs(at - W) < 1e-6)
            off = 0.125 if ext else 0.06
            cuts = [(o["from"], o["to"]) for o in cuts_all if o["axis"] == axis and abs(o["at"] - at) < 1e-6]
            for s0, s1 in spans_minus(a0 + off, a1 - off, cuts):
                if axis == "h":
                    b.box("stone_wall", s0, at + inward * off, s1, at + inward * (off + 0.015), 0.0, H)
                else:
                    b.box("stone_wall", at + inward * off, s0, at + inward * (off + 0.015), s1, 0.0, H)
    # ceiling (with a void over any stair), coves and downlights
    voids = [f for f in plan["fixtures"] if f["kind"] == "stair"]
    cuts_x = sorted({0.0, W} | {v["x"] for v in voids} | {v["x"] + v["w"] for v in voids})
    cuts_y = sorted({0.0, D} | {v["y"] for v in voids} | {v["y"] + v["h"] for v in voids})
    for i in range(len(cuts_x) - 1):
        for j in range(len(cuts_y) - 1):
            cx, cy = (cuts_x[i] + cuts_x[i + 1]) / 2, (cuts_y[j] + cuts_y[j + 1]) / 2
            if any(v["x"] < cx < v["x"] + v["w"] and v["y"] < cy < v["y"] + v["h"] for v in voids):
                continue
            b.box("ceiling", cuts_x[i] - 0.15, cuts_y[j] - 0.15, cuts_x[i + 1] + 0.15, cuts_y[j + 1] + 0.15, H, H + 0.15)
    for v in voids:  # the upper level, so the stair leads somewhere
        x0, y0, x1, y1 = v["x"] - 0.5, v["y"] - 0.5, v["x"] + v["w"] + 0.5, v["y"] + v["h"] + 0.5
        b.box("ceiling", x0, y0, x1, y1, H + 3.0, H + 3.1)
        for (a, c, d_, e) in ((x0, y0, x1, y0 + 0.1), (x0, y1 - 0.1, x1, y1), (x0, y0, x0 + 0.1, y1), (x1 - 0.1, y0, x1, y1)):
            b.box("plaster", a, c, d_, e, H, H + 3.0)
        b.box("oak_floor", x0, y0, v["x"], y1, H + 0.15, H + 0.18)
    for r in rooms:
        x0, y0, x1, y1 = r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]
        cove = r["kind"] in COVE_ROOMS and min(r["w"], r["h"]) > 2.6
        drop = 0.0
        if cove:
            drop = 0.2
            band = 0.42
            ix0, iy0, ix1, iy1 = x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06
            for (a, c, d_, e) in ((ix0, iy0, ix1, iy0 + band), (ix0, iy1 - band, ix1, iy1), (ix0, iy0, ix0 + band, iy1), (ix1 - band, iy0, ix1, iy1)):
                b.box("ceiling", a, c, d_, e, H - drop, H)
            jx0, jy0, jx1, jy1 = ix0 + band, iy0 + band, ix1 - band, iy1 - band
            for (a, c, d_, e) in ((jx0, jy0, jx1, jy0 + 0.07), (jx0, jy1 - 0.07, jx1, jy1), (jx0, jy0, jx0 + 0.07, jy1), (jx1 - 0.07, jy0, jx1, jy1)):
                b.box("ceiling", a, c, d_, e, H - drop - 0.02, H - drop + 0.02)
            for (a, c, d_, e) in ((jx0 + 0.02, jy0 + 0.02, jx1 - 0.02, jy0 + 0.04), (jx0 + 0.02, jy1 - 0.04, jx1 - 0.02, jy1 - 0.02), (jx0 + 0.02, jy0 + 0.02, jx0 + 0.04, jy1 - 0.02), (jx1 - 0.04, jy0 + 0.02, jx1 - 0.02, jy1 - 0.02)):
                b.box("led", a, c, d_, e, H - drop + 0.02, H - drop + 0.03)
            gx0, gy0, gx1, gy1 = x0 + 0.35, y0 + 0.35, x1 - 0.35, y1 - 0.35
            zl = H - drop
        else:
            gx0, gy0, gx1, gy1 = x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5
            zl = H
        if r["kind"] in ("wardrobe", "store", "corridor", "laundry", "walkin") or r["w"] * r["h"] < 2.0:
            spot((x0 + x1) / 2, (y0 + y1) / 2, H - 0.01, 14.0)
            b.cyl("downlight", (x0 + x1) / 2, (y0 + y1) / 2, 0.035, H - 0.006, H, 12)
            continue
        nx = max(1, round((gx1 - gx0) / 1.8) + 1)
        ny = max(1, round((gy1 - gy0) / 1.8) + 1)
        for i in range(nx):
            for j in range(ny):
                px = gx0 + (gx1 - gx0) * (i / (nx - 1) if nx > 1 else 0.5)
                py = gy0 + (gy1 - gy0) * (j / (ny - 1) if ny > 1 else 0.5)
                if cove and not (x0 + 0.5 < px < x1 - 0.5 and y0 + 0.5 < py < y1 - 0.5):
                    continue
                spot(px, py, H - 0.01, 16.0 if cove else 20.0)
                b.cyl("downlight", px, py, 0.035, H - 0.006, H, 12)
        if cove:
            pass

    # outside: balcony (wavy slab, glass balustrade, the balcony above, privacy fins) or terrace
    d = plan["outdoor"]["depth"]
    if plan["outdoor"]["kind"] == "balcony":
        edge = wavy_edge(W, D, d)
        b.prism("tiles", edge, -0.3, -0.02)
        b.prism("ceiling", edge, H + 0.15, H + 0.45)
        rail = edge[1:-1]
        for p, q in zip(rail[:-1], rail[1:]):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            ln = math.hypot(q[0] - p[0], q[1] - p[1])
            nx_, ny_ = -(q[1] - p[1]) / ln, (q[0] - p[0]) / ln
            quad = [(p[0] - nx_ * 0.06, p[1] - ny_ * 0.06), (q[0] - nx_ * 0.06, q[1] - ny_ * 0.06), (q[0] - nx_ * 0.075, q[1] - ny_ * 0.075), (p[0] - nx_ * 0.075, p[1] - ny_ * 0.075)]
            b.prism("glass", quad, -0.02, 1.02)
            quad2 = [(p[0] - nx_ * 0.04, p[1] - ny_ * 0.04), (q[0] - nx_ * 0.04, q[1] - ny_ * 0.04), (q[0] - nx_ * 0.095, q[1] - ny_ * 0.095), (p[0] - nx_ * 0.095, p[1] - ny_ * 0.095)]
            b.prism("bronze", quad2, 1.02, 1.07)
            _ = (mx, my)
        for fx in (-0.3, W):
            b.box("plaster", fx, D, fx + 0.3, D + d * 0.55 + 0.1, -0.3, H + 0.45)
        b.box("ceiling", -0.3, D - 0.15, W + 0.3, D + 0.12, H, H + 0.45)
    else:
        pools = [f for f in plan["fixtures"] if f["kind"] == "pool"]
        xs = sorted({0.0, W} | {p["x"] for p in pools} | {p["x"] + p["w"] for p in pools})
        ys = sorted({D, D + d} | {p["y"] for p in pools} | {p["y"] + p["h"] for p in pools})
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                if any(p["x"] < cx < p["x"] + p["w"] and p["y"] < cy < p["y"] + p["h"] for p in pools):
                    continue
                b.box("tiles", xs[i], ys[j], xs[i + 1], ys[j + 1], -0.3, -0.02)
        for (a, c, d_, e) in ((0, D + d - 0.02, W, D + d), (-0.02, D, 0, D + d), (W, D, W + 0.02, D + d)):
            b.box("glass", a, c, d_, e, -0.02, 1.1)
        b.box("bronze", 0, D + d - 0.03, W, D + d + 0.01, 1.1, 1.14)
        b.box("ceiling", -0.3, D - 0.15, W + 0.3, D + 1.2, H, H + 0.45)  # deep overhang shading the glass
        plant(b, W - 0.6, D + d - 0.6, 2.2, 0.35)
        plant(b, 0.6, D + 0.7, 1.8, 0.3)
    # slab edge below the floor (so looking down past the glass shows the building, not the void)
    b.box("plaster", -0.3, -0.3, W + 0.3, D + 0.12, -0.6, -0.03)


def solid_spans(plan, walls, y, x0, x1):
    """Stretches of the wall along plan line y within [x0, x1] with no opening in them."""
    segs = [(min(w["x1"], w["x2"]), max(w["x1"], w["x2"])) for w in walls if abs(w["y1"] - y) < 1e-6 and abs(w["y2"] - y) < 1e-6]
    spans = []
    for a, c in segs:
        a, c = max(a, x0), min(c, x1)
        if c - a > 0.02:
            spans.append((a, c))
    cuts = [(o["from"], o["to"]) for o in plan["openings"] if o["axis"] == "h" and abs(o["at"] - y) < 1e-6]
    cuts += [(w["from"], w["to"]) for w in plan["windows"] if w["axis"] == "h" and abs(w["at"] - y) < 1e-6]
    out = []
    for a, c in spans:
        out += spans_minus(a, c, cuts)
    return out


def dress(b, plan, H, walls=()):
    rooms = {r["id"]: r for r in plan["rooms"]}
    fixtures = plan["fixtures"]
    coffees = {f["room"]: (f["x"] + f["w"] / 2, f["y"] + f["h"] / 2) for f in fixtures if f["kind"] == "coffee"}
    for f in fixtures:
        room = rooms.get(f["room"]) or {"x": 0, "y": plan["depth"], "w": plan["width"], "h": plan["outdoor"]["depth"]}
        fixture(b, f, room, H, coffees.get(f["room"]))
    # rugs under living groups and beds, plants and art in living rooms
    for r in plan["rooms"]:
        fs = [f for f in fixtures if f["room"] == r["id"]]
        group = [f for f in fs if f["kind"] in ("sofa", "coffee", "armchair")]
        if group:
            x0 = min(f["x"] for f in group) - 0.25
            y0 = min(f["y"] for f in group) - 0.25
            x1 = max(f["x"] + f["w"] for f in group) + 0.25
            y1 = max(f["y"] + f["h"] for f in group) + 0.25
            b.rbox("rug", max(x0, r["x"] + 0.2), max(y0, r["y"] + 0.2), min(x1, r["x"] + r["w"] - 0.2), min(y1, r["y"] + r["h"] - 0.2), 0.0, 0.012, 0.05)
        beds = [f for f in fs if f["kind"] == "bed"]
        for bd in beds:
            b.box("rug_dark" if r["kind"] == "master" else "rug", max(bd["x"] - 0.6, r["x"] + 0.15), max(bd["y"] - 0.6, r["y"] + 0.15), min(bd["x"] + bd["w"] + 0.6, r["x"] + r["w"] - 0.15), min(bd["y"] + bd["h"] + 0.6, r["y"] + r["h"] - 0.15), 0.0, 0.01)
        if r["kind"] in ("living", "livingDining", "studio"):
            for (px, py) in ((r["x"] + 0.45, r["y"] + r["h"] - 0.5), (r["x"] + r["w"] - 0.45, r["y"] + r["h"] - 0.5)):
                if not any(f["x"] - 0.3 < px < f["x"] + f["w"] + 0.3 and f["y"] - 0.3 < py < f["y"] + f["h"] + 0.3 for f in fs):
                    plant(b, px, py)
            # artwork on the longest solid stretch of the back wall (never floating in an opening)
            spans = solid_spans(plan, walls, r["y"], r["x"], r["x"] + r["w"])
            if spans:
                a, c = max(spans, key=lambda sp: sp[1] - sp[0])
                half = min(0.75, (c - a) / 2 - 0.2)
                if half >= 0.45:
                    ax = (a + c) / 2
                    b.box("walnut", ax - half, r["y"] + 0.06, ax + half, r["y"] + 0.1, 1.05, 2.15)
                    b.box("canvas", ax - half + 0.05, r["y"] + 0.1, ax + half - 0.05, r["y"] + 0.105, 1.1, 2.1)
        if r["kind"] in ("master", "bedroom") and not any(f["kind"] == "armchair" for f in fs):
            pass


# ---------------------------------------------------------------- residences
def render_stops(group, stops, args, out, to_blender):
    draft = args.quality == "draft"
    W = 2048 if draft else 4096
    wanted = set(args.stops.split(",")) if args.stops else None
    cam = pano_camera("Pano", (0, 0, 0), PANO_ROT)
    for s in stops:
        if wanted and s["id"] not in wanted:
            continue
        cam.location = to_blender(s)
        render_to(os.path.join(out, group, f"{s['id']}-4096.webp"), W, W // 2, quality=86)


def residence(t, r, args):
    plan, walls = r["plan"], r["walls"]
    interior_scene(t, POSITION_THETA[r["viewpoint"]["position"]], args)
    make_materials()
    H = 3.2 if t == "penthouse" else 3.0
    PLAN["W"], PLAN["D"] = plan["width"], plan["depth"]
    b = Builder()
    build_shell(b, plan, walls, H)
    dress(b, plan, H, walls)
    b.finish()
    render_stops(t, r["stops"], args, args.out, lambda s: (s["at"][0], -s["at"][1], EYE))


# ---------------------------------------------------------------- amenities (plan metres, view side +y)
def room_box(b, W, D, H, glass_sides=("bottom",), floor="tiles", wall="plaster", ceiling="ceiling", hole=None):
    """hole = (x0, y0, x1, y1) left open in the structural slab, e.g. for a sunken pool."""
    if floor:
        b.box(floor, 0, 0, W, D, -0.03, 0.0)
    b.box(ceiling, -0.2, -0.2, W + 0.2, D + 0.2, H, H + 0.2)
    sides = {"top": (0, -0.25, W, 0), "bottom": (0, D, W, D + 0.25), "left": (-0.25, 0, 0, D), "right": (W, 0, W + 0.25, D)}
    for name, (x0, y0, x1, y1) in sides.items():
        if name in glass_sides:
            if name in ("top", "bottom"):
                y = y0 if name == "bottom" else y1
                b.box("glass", 0, y - 0.01, W, y + 0.01, 0, H)
                n = max(1, math.ceil(W / 1.8))
                for i in range(n + 1):
                    b.box("black", W * i / n - 0.03, y - 0.05, W * i / n + 0.03, y + 0.05, 0, H)
            else:
                x = x0 if name == "right" else x1
                b.box("glass", x - 0.01, 0, x + 0.01, D, 0, H)
                n = max(1, math.ceil(D / 1.8))
                for i in range(n + 1):
                    b.box("black", x - 0.05, D * i / n - 0.03, x + 0.05, D * i / n + 0.03, 0, H)
        else:
            b.box(wall, x0, y0, x1, y1, 0, H)
    if hole is None:
        b.box("plaster", -0.3, -0.3, W + 0.3, D + 0.3, -0.6, -0.03)
    else:
        hx0, hy0, hx1, hy1 = hole
        for (a, c, d_, e) in ((-0.3, -0.3, W + 0.3, hy0), (-0.3, hy1, W + 0.3, D + 0.3), (-0.3, hy0, hx0, hy1), (hx1, hy0, W + 0.3, hy1)):
            b.box("plaster", a, c, d_, e, -0.6, -0.03)


def downlights(b, x0, y0, x1, y1, H, step=2.0, energy=26.0):
    nx = max(1, round((x1 - x0) / step))
    ny = max(1, round((y1 - y0) / step))
    for i in range(nx):
        for j in range(ny):
            px = x0 + (x1 - x0) * (i + 0.5) / nx
            py = y0 + (y1 - y0) * (j + 0.5) / ny
            spot(px, py, H - 0.01, energy)
            b.cyl("downlight", px, py, 0.04, H - 0.006, H, 12)


def lounge_group(b, cx, cy, sofa_w=2.6, arm=True):
    """Sofa facing the view (+y) across a stone table, armchairs either side, on a rug."""
    b.rbox("rug", cx - 1.9, cy - 1.6, cx + 1.9, cy + 1.5, 0.0, 0.012, 0.05)
    fixture(b, {"kind": "sofa", "x": cx - sofa_w / 2, "y": cy - 1.35, "w": sofa_w, "h": 0.95, "side": "top"}, None, 4)
    fixture(b, {"kind": "coffee", "x": cx - 0.7, "y": cy - 0.15, "w": 1.4, "h": 0.8}, None, 4)
    if arm:
        for x in (cx - 1.75, cx + 1.0):
            fixture(b, {"kind": "armchair", "x": x, "y": cy + 0.35, "w": 0.8, "h": 0.8}, None, 4, (cx, cy + 0.25))


def lobby(b):
    W, D, H = 16.0, 12.0, 6.5
    room_box(b, W, D, H, ("bottom",), floor="tiles", wall="stone_wall")
    # bronze fins on the side walls, a backlit stone feature wall behind the concierge
    for i in range(int(D / 0.6)):
        y = 0.4 + i * 0.6
        b.box("bronze", 0.0, y, 0.18, y + 0.05, 0.0, H)
        b.box("bronze", W - 0.18, y, W, y + 0.05, 0.0, H)
    b.box("amber", 4.6, 0.0, 11.4, 0.06, 0.6, 4.6)
    b.box("stone", 4.4, 0.06, 11.6, 0.1, 0.4, 4.8)
    b.rbox("stone", 5.8, 1.6, 10.2, 2.4, 0.0, 1.08, 0.35)
    b.box("bronze", 5.9, 2.38, 10.1, 2.42, 0.0, 0.1)
    for x in (7.0, 9.0):
        lamp_on(b, x, 1.95, 1.08)
    # sculptural chandelier: nested glowing bronze rings
    for i, (R, z) in enumerate(((2.6, 4.9), (1.9, 4.5), (1.2, 4.15))):
        b.torus("bronze", 8.0, 6.2, z, R, 0.05)
        b.torus("lamp", 8.0, 6.2, z - 0.06, R, 0.018)
        point(8.0 + R * 0.7, 6.2, z - 0.2, 40.0, 0.2)
        point(8.0 - R * 0.7, 6.2, z - 0.2, 40.0, 0.2)
        b.cyl("black", 8.0 + R, 6.2, 0.004, z, H, 6)
        b.cyl("black", 8.0 - R, 6.2, 0.004, z, H, 6)
    lounge_group(b, 4.4, 5.2)
    lounge_group(b, 11.6, 5.2)
    for (x, y) in ((1.2, 10.6), (14.8, 10.6), (1.2, 1.2), (14.8, 1.2)):
        plant(b, x, y, 3.2, 0.45)
    b.rbox("stone", 7.2, 9.6, 8.8, 10.4, 0.0, 0.75, 0.6)
    b.sphere("bronze", 8.0, 10.0, 1.32, 0.5, 0.8, 0.8, 1.15, 4)  # polished bronze ovoid
    downlights(b, 1.0, 1.0, W - 1.0, D - 1.0, H, 2.6, 60.0)


def spa(b):
    W, D, H = 14.0, 10.0, 3.6
    px0, py0, px1, py1 = 1.2, 4.6, 9.6, 8.6  # vitality pool
    room_box(b, W, D, H, ("bottom",), floor=None, wall="stone_dark", hole=(px0, py0, px1, py1))  # floor laid around the pool below
    # oak slat ceiling
    for i in range(int(W / 0.12)):
        x = i * 0.12
        b.box("oak", x, 0, x + 0.06, D, H - 0.12, H)
    # vitality pool
    for (a, c, d_, e) in ((0, 0, W, py0), (0, py1, W, D), (0, py0, px0, py1), (px1, py0, W, py1)):
        b.box("tiles", a, c, d_, e, -0.03, 0.0)
    b.box("water", px0, py0, px1, py1, -0.1, -0.08)
    b.box("mosaic", px0, py0, px1, py1, -1.3, -1.25)
    for (a, c, d_, e) in ((px0, py0, px0 + 0.05, py1), (px1 - 0.05, py0, px1, py1), (px0, py0, px1, py0 + 0.05), (px0, py1 - 0.05, px1, py1)):
        b.box("mosaic", a, c, d_, e, -1.3, -0.08)
    b.box("led", px0 + 0.06, py0 + 0.05, px1 - 0.06, py0 + 0.07, -0.5, -0.45)
    b.box("led", px0 + 0.06, py1 - 0.07, px1 - 0.06, py1 - 0.05, -0.5, -0.45)
    hd.pool_edge(b, px0, py0, px1, py1, -0.09, 1.3, steps_at="left")
    # heated stone loungers and a relaxation corner
    for i in range(4):
        y = 1.0 + i * 1.0
        b.rbox("stone", 10.6, y, 13.4, y + 0.75, 0.0, 0.45, 0.2)
        b.rbox("linen", 10.7, y + 0.05, 12.9, y + 0.7, 0.45, 0.52, 0.1)
    for i in range(3):
        fixture(b, {"kind": "lounger", "x": 10.8 + i * 1.0, "y": 6.4, "w": 0.75, "h": 1.95}, None, H)
    for (x, y) in ((0.6, 0.6), (13.4, 9.3), (0.6, 9.3)):
        plant(b, x, y, 1.6, 0.3)
    for x in (2.0, 4.0, 6.0, 8.0):
        b.cyl("lamp", x, 0.25, 0.06, 0.0, 0.12, 12)
        point(x, 0.35, 0.2, 3.0, 0.05)
    b.box("led", 0.1, 0.12, W - 0.1, 0.14, H - 0.2, H - 0.16)
    downlights(b, 1.0, 1.0, W - 1.0, D - 1.0, H, 2.4, 12.0)


def gym(b):
    W, D, H = 14.0, 9.0, 3.6
    room_box(b, W, D, H, ("bottom",), floor="hd_rubber", wall="plaster")
    b.box("oak_floor", 0, 0, W, 2.2, 0.0, 0.01)
    b.box("mirror", 0.3, 0.07, W - 0.3, 0.1, 0.2, 2.6)
    hd.gym_room(b, W, D, H, plant)
    b.box("led", 0.1, 0.12, W - 0.1, 0.14, H - 0.2, H - 0.16)
    downlights(b, 1.0, 1.0, W - 1.0, D - 1.0, H, 2.4, 30.0)


def sky_lounge(b):
    W, D, H = 16.0, 10.0, 4.2
    room_box(b, W, D, H, ("bottom", "left", "right"), floor="oak_floor", wall="stone_wall")
    # deck outside, so looking down shows the terrace rather than the drop
    b.box("tiles", -6, D, W + 6, D + 5, -0.3, -0.02)
    b.box("tiles", -6, -2, 0, D, -0.3, -0.02)
    b.box("tiles", W, -2, W + 6, D, -0.3, -0.02)
    b.box("glass", -6, D + 5, W + 6, D + 5.02, -0.02, 1.1)
    for x in (-3.0, 19.0):
        fixture(b, {"kind": "lounger", "x": x, "y": D + 1.5, "w": 0.75, "h": 1.95}, None, H)
    # bar against the back wall
    b.box("bronze", 4.0, 0.8, 12.0, 1.5, 0.0, 1.05)
    b.box("stone", 3.95, 0.75, 12.05, 1.55, 1.05, 1.1)
    for tier in range(3):
        z = 1.3 + tier * 0.55
        b.box("oak", 4.5, 0.05, 11.5, 0.35, z, z + 0.04)
        for i in range(22):
            x = 4.7 + i * 0.3
            b.cyl("amber", x, 0.2, 0.04, z + 0.04, z + 0.32 + 0.04 * (i % 3), 10)
    b.box("led", 4.5, 0.05, 11.5, 0.07, 1.25, 2.95)
    for i in range(6):
        x = 4.8 + i * 1.3
        b.cyl("bronze", x, 1.95, 0.02, 0.0, 0.66, 8)
        b.cyl("navy", x, 1.95, 0.2, 0.66, 0.74, 20)
        pendant(b, x, 1.15, 2.4, H, 0.1)
    lounge_group(b, 3.4, 7.2)
    lounge_group(b, 12.6, 7.2)
    for (x, y) in ((0.6, 0.6), (15.4, 0.6), (8.0, 9.4)):
        plant(b, x, y, 2.0, 0.35)
    b.box("led", 0.1, 0.1, W - 0.1, 0.12, H - 0.2, H - 0.16)
    downlights(b, 1.0, 2.5, W - 1.0, D - 1.0, H, 2.4, 22.0)


AMENITY_BUILD = {"lobby": (lobby, "ground"), "spa": (spa, "ground"), "gym": (gym, "ground"), "sky-lounge": (sky_lounge, "sky")}


def amenity(key, tour, args):
    fn, env = AMENITY_BUILD[key]
    PLAN["W"] = PLAN["D"] = 0.0
    interior_scene(env, SEA_THETA, args)
    make_materials()
    b = Builder()
    fn(b)
    b.finish()
    render_stops(key, tour["stops"], args, args.out, lambda s: (s["at"][0], -s["at"][1], EYE))


# ---------------------------------------------------------------- orientation test
def test_orient(args):
    """Coloured markers around a panorama camera: red at plan +y (view), green at plan +x, blue at plan -y."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    gpu_cycles(16, 0.1)
    scn = bpy.context.scene
    world = bpy.data.worlds.new("W")
    scn.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
    M.clear()
    mat("red", emit("#FF0000", 2.0))
    mat("green", emit("#00FF00", 2.0))
    mat("blue", emit("#0000FF", 2.0))
    b = Builder()
    b.box("red", -0.5, 2.5, 0.5, 3.0, 0.0, 3.0)
    b.box("green", 2.5, -0.5, 3.0, 0.5, 0.0, 3.0)
    b.box("blue", -0.5, -3.0, 0.5, -2.5, 0.0, 3.0)
    b.finish()
    pano_camera("Test", (0, 0, 1.5), PANO_ROT)
    render_to(os.path.join(ROOT, "assets", "models", "env", "orient-test.png"), 512, 256, "PNG")


def main():
    args = parse_args()
    args.out = os.path.abspath(args.out)
    if args.test_orient:
        test_orient(args)
        return
    with open(args.seed, encoding="utf-8") as fh:
        seed = json.load(fh)
    with open(os.path.join(HERE, "tours.json"), encoding="utf-8") as fh:
        tours = json.load(fh)
    os.makedirs(ENV_DIR, exist_ok=True)
    wanted = set(args.only.split(",")) if args.only else None
    exterior_views(seed, tours, args)
    for t, r in tours["residences"].items():
        if wanted is None or t in wanted:
            residence(t, r, args)
    for key, tour in tours["amenities"].items():
        if key in AMENITY_BUILD and (wanted is None or key in wanted):
            amenity(key, tour, args)


if __name__ == "__main__":
    main()
