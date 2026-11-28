'use client';

import type { Unit } from '@gsc/contracts';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { type BufferGeometry, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Served from apps/web/public; built by assets/models/source/build_tower.py. */
export const DEFAULT_MODEL_URL = '/models/azure-crest.glb';

/**
 * architectural: marketing look (clear glass, only hover/selection tinted), used by the showcase hero.
 * availability: every unit tinted by its sales status, used by the explorer.
 */
export type ColorMode = 'architectural' | 'availability';

export interface UnitPaintProps {
  units: Unit[];
  colorMode: ColorMode;
  selectedUnitId?: string;
  hoveredUnitId: string | null;
  highlightIds?: Set<string>;
  onSelect?: (unit: Unit) => void;
  /** over=false only clears the hover if it still belongs to this unit (pointer-out can arrive after the next pointer-over). */
  onHover: (unitId: string, over: boolean) => void;
  shadows: boolean;
}

export const AVAILABILITY_COLORS: Record<Unit['availability'], string> = {
  available: '#1F9D55',
  reserved: '#D97706',
  sold: '#9CA3AF',
  hold: '#6366F1',
};
const GOLD = '#C8A55A';

/** Ground-level meshes receive shadows but never cast them (saves a shadow pass on large flat geometry). */
const RECEIVE_ONLY = /^(Site_Ground|Site_Plaza|Site_Lagoon|Site_Road|Podium_Pool)/;

type Paint = 'base' | 'dim' | 'hover' | 'selected';

/**
 * Hover / selection are drawn as a second copy of that one unit on top of the merged glazing; the polygon offset
 * makes the copy win the depth test against the identical surface underneath.
 */
const OVERLAY = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 } as const;
/** Click / hover targets: one mesh per unit that the raycaster sees but the renderer skips (material.visible=false). */
const PICK = new MeshBasicMaterial({ visible: false });

/** Draw-call batching: geometries can only be merged when they carry the same attributes (and all/none indexed). */
function layout(g: BufferGeometry): string {
  return `${Object.keys(g.attributes).sort().join('+')}|${g.index ? 'i' : 'n'}`;
}

interface Batch {
  key: string;
  geometry: BufferGeometry;
  material: Material;
  castShadow: boolean;
}

/** Merge meshes that share a material into one draw call each. Node transforms are baked by build_tower.py. */
function batch<T>(items: T[], pick: (t: T) => { geometry: BufferGeometry; material: Material; castShadow: boolean }): Batch[] {
  const groups = new Map<string, { material: Material; castShadow: boolean; geoms: BufferGeometry[] }>();
  for (const it of items) {
    const { geometry, material, castShadow } = pick(it);
    const key = `${material.uuid}|${castShadow}|${layout(geometry)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material, castShadow, geoms: [] }));
    g.geoms.push(geometry);
  }
  const out: Batch[] = [];
  for (const [key, g] of groups) {
    const geometry = g.geoms.length === 1 ? g.geoms[0]!.clone() : mergeGeometries(g.geoms, false);
    if (geometry) out.push({ key, geometry, material: g.material, castShadow: g.castShadow });
  }
  return out;
}

function useDisposeBatches(batches: Batch[]) {
  useEffect(() => () => batches.forEach((b) => b.geometry.dispose()), [batches]);
}

/**
 * The sun and every caster are static, so the shadow map is drawn once (and again when the casters change)
 * instead of every frame.
 */
export function useStaticShadows(enabled: boolean, ...deps: unknown[]) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, enabled, ...deps]);
}

/**
 * Stable pseudo-random "lights on" per unit (same answer on every render and device). ~38%: golden hour, not night.
 * build_tower.py's fnv_lit() mirrors this to place the warm ceiling lights inside those homes.
 */
export function isLit(id: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100 < 38;
}

/**
 * Curtain-wall glass for the architectural look: mostly see-through head-on (the furnished rooms, sheers and
 * lit ceilings modelled behind it show), turning to a mirror of the sky at grazing angles like real glazing.
 */
function curtainGlass(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: '#8FA9B8',
    metalness: 1,
    roughness: 0.03,
    envMapIntensity: 1.35,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float gscFresnel = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
      diffuseColor.a = mix(diffuseColor.a, 0.94, gscFresnel);
      #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => 'gsc-curtain-glass';
  return m;
}

/** Shared material cache: at most ~13 materials for 152 units, so state changes never allocate per frame. */
function useUnitMaterials(glass: Material | undefined) {
  const cache = useMemo(() => new Map<string, Material>(), []);
  useEffect(() => () => cache.forEach((m) => m.dispose()), [cache]);

  return (unit: Unit, mode: ColorMode, paint: Paint): Material => {
    // Architectural mode matches the golden-hour renders: clear curtain-wall glass over furnished, partly lit homes.
    const key = `${mode}:${paint}:${mode === 'availability' ? unit.availability : ''}`;
    let m = cache.get(key);
    if (m) return m;
    const tint = mode === 'availability' ? AVAILABILITY_COLORS[unit.availability] : null;
    if (paint === 'dim') {
      m = new MeshStandardMaterial({ color: '#B9C6CF', transparent: true, opacity: 0.14, depthWrite: false, roughness: 0.2 });
    } else if (paint === 'selected') {
      m = new MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.25, ...OVERLAY });
    } else if (!tint && paint === 'base') {
      m = curtainGlass();
      void glass;
    } else {
      const color = tint ?? '#7F9DAD';
      m = new MeshStandardMaterial({
        color,
        emissive: paint === 'hover' ? GOLD : color,
        emissiveIntensity: paint === 'hover' ? 0.45 : tint ? 0.22 : 0,
        metalness: tint ? 0.25 : 0.55,
        roughness: tint ? 0.3 : 0.1,
        ...(paint === 'hover' ? OVERLAY : {}),
      });
    }
    cache.set(key, m);
    return m;
  };
}

/**
 * The glTF masterplan. Unit meshes are matched to seed data by name (`Unit.meshId`).
 * ~220 meshes are drawn as ~30 batches: static parts merged per material, unit glazing merged per paint, with
 * hover / selection as single-unit overlays and invisible per-unit meshes for picking.
 */
export function TowerModel({ url, ...p }: UnitPaintProps & { url: string }) {
  const { nodes } = useGLTF(url, false, false); // no Draco/meshopt: the file is ~0.8 MB gzipped, no decoder download
  const byMeshId = useMemo(() => new Map(p.units.map((u) => [u.meshId, u])), [p.units]);

  const { statics, unitMeshes } = useMemo(() => {
    const statics: Mesh[] = [];
    const unitMeshes: { unit: Unit; mesh: Mesh }[] = [];
    for (const obj of Object.values(nodes)) {
      if (!(obj as Mesh).isMesh) continue;
      const mesh = obj as Mesh;
      const unit = byMeshId.get(mesh.name);
      if (unit) unitMeshes.push({ unit, mesh });
      else statics.push(mesh);
    }
    return { statics, unitMeshes };
  }, [nodes, byMeshId]);

  const material = useUnitMaterials(unitMeshes[0]?.mesh.material as Material | undefined);

  const staticBatches = useMemo(
    () =>
      batch(statics, (m) => ({
        geometry: m.geometry,
        material: m.material as Material,
        castShadow: !RECEIVE_ONLY.test(m.name),
      })),
    [statics],
  );
  useDisposeBatches(staticBatches);

  // Glazing only re-merges when the colour mode or the explorer's filter changes, never on hover / selection.
  const { colorMode, highlightIds } = p;
  const unitBatches = useMemo(
    () =>
      batch(unitMeshes, ({ unit, mesh }) => ({
        geometry: mesh.geometry,
        material: material(unit, colorMode, highlightIds && !highlightIds.has(unit.id) ? 'dim' : 'base'),
        castShadow: false, // glazing: the slabs, core and mullions cast the tower's shadow
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unitMeshes, colorMode, highlightIds],
  );
  useDisposeBatches(unitBatches);
  useStaticShadows(p.shadows, staticBatches);

  const overlays = unitMeshes.filter(
    ({ unit }) => unit.id === p.selectedUnitId || (unit.id === p.hoveredUnitId && !(p.highlightIds && !p.highlightIds.has(unit.id))),
  );

  return (
    <group>
      {staticBatches.map((b) => (
        <mesh key={b.key} geometry={b.geometry} material={b.material} castShadow={p.shadows && b.castShadow} receiveShadow={p.shadows} />
      ))}
      {unitBatches.map((b) => (
        <mesh key={b.key} geometry={b.geometry} material={b.material} receiveShadow={p.shadows} />
      ))}
      {overlays.map(({ unit, mesh }) => (
        <mesh
          key={`overlay:${unit.id}`}
          geometry={mesh.geometry}
          material={material(unit, p.colorMode, unit.id === p.selectedUnitId ? 'selected' : 'hover')}
          receiveShadow={p.shadows}
          raycast={() => null}
        />
      ))}
      {unitMeshes.map(({ unit, mesh }) => (
        <mesh
          key={unit.id}
          name={unit.meshId}
          geometry={mesh.geometry}
          material={PICK}
          onClick={(e) => {
            e.stopPropagation();
            p.onSelect?.(unit);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            p.onHover(unit.id, true);
          }}
          onPointerOut={() => p.onHover(unit.id, false)}
        />
      ))}
    </group>
  );
}

useGLTF.preload(DEFAULT_MODEL_URL, false, false);
