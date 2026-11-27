'use client';

import type { Unit } from '@gsc/contracts';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import { layoutUnits } from './layout';

export interface TowerSceneProps {
  units: Unit[];
  selectedUnitId?: string;
  /** Units matching the explorer filters; others are dimmed. */
  highlightIds?: Set<string>;
  onSelect?: (unit: Unit) => void;
  className?: string;
}

const COLORS: Record<Unit['availability'], string> = {
  available: '#1F9D55',
  reserved: '#D97706',
  sold: '#9CA3AF',
  hold: '#6366F1',
};

/**
 * Procedural tower built from seed data. Phase 1 (Dev A): swap boxes for the glTF model
 * (assets/models/azure-crest.glb) and highlight by `unit.meshId`. Keep this props API stable.
 */
export function TowerScene({ units, selectedUnitId, highlightIds, onSelect, className }: TowerSceneProps) {
  const boxes = useMemo(() => layoutUnits(units), [units]);
  return (
    <div className={className} style={{ minHeight: 420 }}>
      <Canvas camera={{ position: [28, 22, 34], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, 40, 20]} intensity={1.1} />
        {boxes.map(({ unit, position, size }) => {
          const dim = highlightIds && !highlightIds.has(unit.id);
          const selected = unit.id === selectedUnitId;
          return (
            <mesh
              key={unit.id}
              position={position}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(unit);
              }}
            >
              <boxGeometry args={size} />
              <meshStandardMaterial
                color={selected ? '#C8A55A' : COLORS[unit.availability]}
                transparent
                opacity={dim ? 0.12 : selected ? 1 : 0.85}
              />
            </mesh>
          );
        })}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#E9DFCC" />
        </mesh>
        <OrbitControls makeDefault enablePan={false} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
    </div>
  );
}
