'use client';

import type { Unit } from '@gsc/contracts';
import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { Material, Mesh, MeshStandardMaterial } from 'three';

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

/** Stable pseudo-random "lights on" per unit (same answer on every render and device). */
export function isLit(id: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100 < 62;
}

/** Shared material cache: at most ~13 materials for 152 units, so state changes never allocate per frame. */
function useUnitMaterials(glass: Material | undefined) {
  const cache = useMemo(() => new Map<string, Material>(), []);
  useEffect(() => () => cache.forEach((m) => m.dispose()), [cache]);

  return (unit: Unit, mode: ColorMode, paint: Paint): Material => {
    // Architectural mode matches the golden-hour renders: dark glass, ~60% of homes lit from inside.
    const lit = mode === 'architectural' && paint === 'base' && isLit(unit.id);
    const key = `${mode}:${paint}:${mode === 'availability' ? unit.availability : lit ? 'lit' : ''}`;
    let m = cache.get(key);
    if (m) return m;
    const tint = mode === 'availability' ? AVAILABILITY_COLORS[unit.availability] : null;
    if (paint === 'dim') {
      m = new MeshStandardMaterial({ color: '#B9C6CF', transparent: true, opacity: 0.14, depthWrite: false, roughness: 0.2 });
    } else if (paint === 'selected') {
      m = new MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.25 });
    } else if (!tint && paint === 'base') {
      m = new MeshStandardMaterial({
        color: '#465B69',
        metalness: 0.55,
        roughness: 0.12,
        envMapIntensity: 1.3,
        emissive: lit ? '#FFB46B' : '#000000',
        emissiveIntensity: lit ? 0.13 : 0,
      });
      void glass;
    } else {
      const color = tint ?? '#7F9DAD';
      m = new MeshStandardMaterial({
        color,
        emissive: paint === 'hover' ? GOLD : color,
        emissiveIntensity: paint === 'hover' ? 0.45 : tint ? 0.22 : 0,
        metalness: tint ? 0.25 : 0.55,
        roughness: tint ? 0.3 : 0.1,
      });
    }
    cache.set(key, m);
    return m;
  };
}

/** The glTF masterplan. Unit meshes are matched to seed data by name (`Unit.meshId`). */
export function TowerModel({ url, ...p }: UnitPaintProps & { url: string }) {
  const { nodes } = useGLTF(url, false, false); // no Draco/meshopt: the file is ~100 KB gzipped, no decoder download
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

  return (
    <group>
      {statics.map((m) => (
        <mesh
          key={m.uuid}
          geometry={m.geometry}
          material={m.material}
          castShadow={p.shadows && !RECEIVE_ONLY.test(m.name)}
          receiveShadow={p.shadows}
        />
      ))}
      {unitMeshes.map(({ unit, mesh }) => {
        const paint: Paint =
          unit.id === p.selectedUnitId
            ? 'selected'
            : p.highlightIds && !p.highlightIds.has(unit.id)
              ? 'dim'
              : unit.id === p.hoveredUnitId
                ? 'hover'
                : 'base';
        return (
          <mesh
            key={unit.id}
            name={unit.meshId}
            geometry={mesh.geometry}
            material={material(unit, p.colorMode, paint)}
            castShadow={p.shadows}
            receiveShadow={p.shadows}
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
        );
      })}
    </group>
  );
}

useGLTF.preload(DEFAULT_MODEL_URL, false, false);
