'use client';

import type { Unit } from '@gsc/contracts';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { layoutUnits, unitCenter } from './layout';
import { Masterplan } from './Masterplan';

export interface TowerSceneProps {
  units: Unit[];
  selectedUnitId?: string;
  /** Units matching the explorer filters; others are dimmed. */
  highlightIds?: Set<string>;
  onSelect?: (unit: Unit) => void;
  /** Slow cinematic orbit until the user interacts (showcase hero). */
  autoRotate?: boolean;
  className?: string;
}

const COLORS: Record<Unit['availability'], string> = {
  available: '#1F9D55',
  reserved: '#D97706',
  sold: '#9CA3AF',
  hold: '#6366F1',
};

const HOME_TARGET = new Vector3(0, 11, 0);
const HOME_CAMERA = new Vector3(44, 30, 52);

/**
 * Procedural tower built from seed data. Swap boxes for the glTF model
 * (assets/models/azure-crest.glb) when it exists; keep this props API stable.
 */
export function TowerScene({ units, selectedUnitId, highlightIds, onSelect, autoRotate = false, className }: TowerSceneProps) {
  const boxes = useMemo(() => layoutUnits(units), [units]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [userTookControl, setUserTookControl] = useState(false);
  const selected = units.find((u) => u.id === selectedUnitId);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered]);

  return (
    <div className={className} style={{ minHeight: 360 }}>
      <Canvas camera={{ position: HOME_CAMERA.toArray(), fov: 42 }} dpr={[1, 2]} shadows={false}>
        <color attach="background" args={['#F6F1E8']} />
        <fog attach="fog" args={['#F6F1E8', 70, 140]} />
        <hemisphereLight args={['#ffffff', '#E9DFCC', 0.8]} />
        <directionalLight position={[25, 45, 20]} intensity={1.2} />
        <Masterplan />
        {boxes.map(({ unit, position, size }) => {
          const dim = highlightIds && !highlightIds.has(unit.id);
          const isSel = unit.id === selectedUnitId;
          const isHover = unit.id === hovered;
          return (
            <mesh
              key={unit.id}
              position={position}
              scale={isSel ? 1.08 : 1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(unit);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(unit.id);
              }}
              onPointerOut={() => setHovered((h) => (h === unit.id ? null : h))}
            >
              <boxGeometry args={size} />
              <meshStandardMaterial
                color={isSel ? '#C8A55A' : COLORS[unit.availability]}
                emissive={isSel || isHover ? '#C8A55A' : '#000000'}
                emissiveIntensity={isSel ? 0.35 : isHover ? 0.2 : 0}
                transparent
                opacity={dim ? 0.1 : isSel ? 1 : 0.88}
                depthWrite={!dim}
              />
            </mesh>
          );
        })}
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={12}
          maxDistance={90}
          maxPolarAngle={Math.PI / 2.15}
          autoRotate={autoRotate && !userTookControl && !selected}
          autoRotateSpeed={0.6}
          onStart={() => setUserTookControl(true)}
        />
        <FocusRig target={selected ? unitCenter(selected) : null} />
      </Canvas>
    </div>
  );
}

/** Smoothly flies the camera to the selected unit (or back home when cleared), then hands control back. */
function FocusRig({ target }: { target: [number, number, number] | null }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  const goal = useRef<{ target: Vector3; camera: Vector3 } | null>(null);
  const key = target?.join(',') ?? 'home';
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!target) return; // don't animate on mount when nothing is selected
    }
    if (target) {
      const t = new Vector3(...target);
      // Approach from outside the tower, on the side the unit faces.
      const out = new Vector3(t.x, 0, t.z).normalize();
      if (out.lengthSq() === 0) out.set(1, 0, 1).normalize();
      goal.current = { target: t, camera: t.clone().add(out.multiplyScalar(26)).add(new Vector3(0, 9, 0)) };
    } else {
      goal.current = { target: HOME_TARGET.clone(), camera: HOME_CAMERA.clone() };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 3.5);
    controls.target.lerp(g.target, k);
    camera.position.lerp(g.camera, k);
    controls.update();
    if (camera.position.distanceTo(g.camera) < 0.05 && controls.target.distanceTo(g.target) < 0.05) goal.current = null;
  });
  return null;
}
