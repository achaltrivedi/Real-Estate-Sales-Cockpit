'use client';

import type { Unit } from '@gsc/contracts';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Vector3 } from 'three';
import { isNarrowScreen } from './capability';
import { layoutUnits, unitCenter, unitFacing } from './layout';
import { Masterplan } from './Masterplan';
import { AVAILABILITY_COLORS, DEFAULT_MODEL_URL, TowerModel, type ColorMode, type UnitPaintProps } from './TowerModel';

export interface TowerSceneProps {
  units: Unit[];
  selectedUnitId?: string;
  /** Units matching the explorer filters; others are dimmed. */
  highlightIds?: Set<string>;
  onSelect?: (unit: Unit) => void;
  /** Slow cinematic orbit until the user interacts (showcase hero). */
  autoRotate?: boolean;
  /** 'availability' (default) tints units by sales status; 'architectural' shows the clean marketing look. */
  colorMode?: ColorMode;
  /** glTF masterplan; unit meshes must be named by `Unit.meshId`. Falls back to procedural boxes on error. */
  modelUrl?: string;
  className?: string;
}

/** Sea-side three-quarter view: lagoon in the foreground, city behind. */
const HOME_TARGET = new Vector3(0, 12, 0);
const HOME_CAMERA = new Vector3(30, 20, -44);
const HOME_TARGET_TUPLE: [number, number, number] = [0, 12, 0];
const HORIZON = '#D9C7B4';

/** Pull the home camera back in tall/narrow viewports (phones, side panels) so both crowns stay in frame. */
function homeCamera(aspect: number): Vector3 {
  const k = Math.max(1, 1.2 / Math.max(aspect, 0.3));
  return HOME_TARGET.clone().add(HOME_CAMERA.clone().sub(HOME_TARGET).multiplyScalar(k));
}

export function TowerScene({
  units,
  selectedUnitId,
  highlightIds,
  onSelect,
  autoRotate = false,
  colorMode = 'availability',
  modelUrl = DEFAULT_MODEL_URL,
  className,
}: TowerSceneProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [userTookControl, setUserTookControl] = useState(false);
  const [shadows, setShadows] = useState(false);
  const selected = units.find((u) => u.id === selectedUnitId);

  useEffect(() => setShadows(!isNarrowScreen()), []); // phones: skip the shadow pass
  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered]);

  const onHover = useCallback((id: string, over: boolean) => setHovered((h) => (over ? id : h === id ? null : h)), []);
  const paint: UnitPaintProps = { units, colorMode, selectedUnitId, hoveredUnitId: hovered, highlightIds, onSelect, onHover, shadows };
  const fallback = <ProceduralScene {...paint} />;

  return (
    <div
      className={className}
      style={{ minHeight: 360, background: `linear-gradient(180deg, #6F8296 0%, #A9AAAD 42%, #CDB8A4 62%, ${HORIZON} 72%)` }}
    >
      <Canvas
        camera={{ position: HOME_CAMERA.toArray(), fov: 42, near: 0.5, far: 400 }}
        dpr={[1, 2]}
        shadows={shadows}
      >
        <fog attach="fog" args={[HORIZON, 85, 190]} />
        <hemisphereLight args={['#C9D3DE', '#B79E84', 0.45]} />
        <directionalLight
          position={[-22, 16, -60]}
          intensity={2.6}
          color="#FFC994"
          castShadow={shadows}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-left={-40}
          shadow-camera-right={40}
          shadow-camera-top={40}
          shadow-camera-bottom={-40}
          shadow-camera-far={140}
        />
        <Environment resolution={128} frames={1}>
          {/* Local studio-style light rig: gives the glass and bronze something to reflect, no HDR download. */}
          <Lightformer form="rect" intensity={2.2} color="#FFF4E6" scale={[60, 20, 1]} position={[0, 30, -40]} />
          <Lightformer form="rect" intensity={1.2} color="#CFE6F2" scale={[60, 20, 1]} position={[0, 20, 50]} rotation-y={Math.PI} />
          <Lightformer form="ring" intensity={3} color="#FFD7A8" scale={10} position={[-40, 25, -30]} />
          <Lightformer form="rect" intensity={0.6} color="#E9DFCC" scale={[100, 100, 1]} position={[0, -10, 0]} rotation-x={Math.PI / 2} />
        </Environment>

        <ModelErrorBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <TowerModel url={modelUrl} {...paint} />
          </Suspense>
        </ModelErrorBoundary>

        <OrbitControls
          makeDefault
          target={HOME_TARGET_TUPLE}
          enablePan={false}
          minDistance={12}
          maxDistance={95}
          maxPolarAngle={Math.PI / 2.15}
          autoRotate={autoRotate && !userTookControl && !selected}
          autoRotateSpeed={0.5}
          onStart={() => setUserTookControl(true)}
        />
        <FocusRig unit={selected ?? null} />
      </Canvas>
    </div>
  );
}

/** Instant placeholder while the model streams, and the fallback if it fails: masterplan + one box per unit. */
function ProceduralScene({ units, colorMode, selectedUnitId, hoveredUnitId, highlightIds, onSelect, onHover }: UnitPaintProps) {
  const boxes = useMemo(() => layoutUnits(units), [units]);
  return (
    <group>
      <Masterplan />
      {boxes.map(({ unit, position, size }) => {
        const dim = highlightIds && !highlightIds.has(unit.id);
        const isSel = unit.id === selectedUnitId;
        const isHover = unit.id === hoveredUnitId;
        const base = colorMode === 'availability' ? AVAILABILITY_COLORS[unit.availability] : '#8FAABA';
        return (
          <mesh
            key={unit.id}
            position={position}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(unit);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(unit.id, true);
            }}
            onPointerOut={() => onHover(unit.id, false)}
          >
            <boxGeometry args={size} />
            <meshStandardMaterial
              color={isSel ? '#C8A55A' : base}
              emissive={isSel || isHover ? '#C8A55A' : '#000000'}
              emissiveIntensity={isSel ? 0.35 : isHover ? 0.2 : 0}
              transparent
              opacity={dim ? 0.1 : isSel ? 1 : 0.88}
              depthWrite={!dim}
            />
          </mesh>
        );
      })}
    </group>
  );
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[3d] model failed to load, using procedural fallback', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Smoothly flies the camera to the selected unit (or back home when cleared), then hands control back. */
function FocusRig({ unit }: { unit: Unit | null }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = size.height > 0 ? size.width / size.height : 0;
  const goal = useRef<{ target: Vector3; camera: Vector3 } | null>(null);
  const key = unit?.id ?? 'home';
  const first = useRef(true);
  const framed = useRef(false);

  // Frame the home view for this viewport once its size is known (size is 0x0 on the very first render).
  useEffect(() => {
    if (framed.current || aspect === 0 || unit) return;
    framed.current = true;
    camera.position.copy(homeCamera(aspect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!unit) return; // don't animate on mount when nothing is selected
    }
    if (unit) {
      const t = new Vector3(...unitCenter(unit));
      // Approach from outside the tower, looking straight at the unit's corner.
      const [fx, fz] = unitFacing(unit);
      goal.current = { target: t, camera: t.clone().add(new Vector3(fx * 22, 7, fz * 22)) };
    } else {
      goal.current = { target: HOME_TARGET.clone(), camera: homeCamera(aspect || 1.4) };
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
