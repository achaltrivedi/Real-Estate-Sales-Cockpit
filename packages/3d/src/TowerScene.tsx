'use client';

import type { Unit } from '@gsc/contracts';
import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACESFilmicToneMapping, Vector3 } from 'three';
import { isNarrowScreen } from './capability';
import { type Dive, layoutUnits, unitCenter, unitFacing } from './layout';
import { Masterplan } from './Masterplan';
import { AVAILABILITY_COLORS, DEFAULT_MODEL_URL, TowerModel, useStaticShadows, type ColorMode, type UnitPaintProps } from './TowerModel';
import { GoldenSky, HAZE, LagoonWater, SUN_POSITION } from './Waterfront';

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
  /** Fly the camera right up to a residence or amenity (see `unitDive`); `onDiveEnd` fires on arrival. */
  dive?: Dive | null;
  onDiveEnd?: () => void;
  /** Stop drawing while something opaque covers the scene (e.g. a 360° tour on top). */
  paused?: boolean;
  className?: string;
}

/** Sea-side three-quarter view: lagoon in the foreground, city behind. */
const HOME_TARGET = new Vector3(0, 12, 0);
const HOME_CAMERA = new Vector3(30, 20, -44);
const HOME_TARGET_TUPLE: [number, number, number] = [0, 12, 0];

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
  dive = null,
  onDiveEnd,
  paused = false,
  className,
}: TowerSceneProps) {
  const visible = useOnScreen();
  const [hovered, setHovered] = useState<string | null>(null);
  const [userTookControl, setUserTookControl] = useState(false);
  const [shadows, setShadows] = useState(false);
  const [narrow, setNarrow] = useState(false);
  /** Resolution scale: starts sharp and steps down if the device can't hold a smooth frame rate. */
  const [dpr, setDpr] = useState(() => Math.min(1.5, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  const selected = units.find((u) => u.id === selectedUnitId);

  useEffect(() => {
    const n = isNarrowScreen();
    setNarrow(n);
    setShadows(!n); // phones: skip the shadow pass and use a smaller water reflection
  }, []);
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
      ref={visible.ref}
      className={className}
      style={{ minHeight: 360, background: `linear-gradient(180deg, #7C93AC 0%, #B7B9BE 45%, ${HAZE} 62%, #1C4A55 63%, #0F3A45 100%)` }}
    >
      <Canvas
        camera={{ position: HOME_CAMERA.toArray(), fov: 42, near: 0.5, far: 1500 }}
        dpr={dpr}
        // Only draw while the scene can be seen: off-screen, in a background tab or under a tour, the render loop
        // (scene + planar water reflection, every frame) would otherwise keep the GPU and main thread busy.
        frameloop={visible.on && !paused ? 'always' : 'never'}
        shadows={shadows}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.95, powerPreference: 'high-performance' }}
      >
        <PerformanceMonitor
          bounds={() => [45, 58]}
          flipflops={3}
          onIncline={() => setDpr((d) => Math.min(d + 0.25, Math.min(1.75, window.devicePixelRatio || 1)))}
          onDecline={() => setDpr((d) => Math.max(d - 0.25, 0.85))}
          onFallback={() => setDpr(1)}
        />
        <fog attach="fog" args={[HAZE, 60, 520]} />
        <GoldenSky />
        <Suspense fallback={null}>
          <LagoonWater resolution={narrow ? 256 : 512} />
        </Suspense>
        <hemisphereLight args={['#C9D3DE', '#B79E84', 0.5]} />
        <directionalLight
          position={SUN_POSITION}
          intensity={2.8}
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
        <Environment resolution={256} frames={1}>
          {/* Reflections come from the same golden-hour sky (no HDR download), plus a sea-coloured floor and a warm sun disc. */}
          <GoldenSky distance={400} />
          <Lightformer form="rect" intensity={0.9} color="#3E7A86" scale={[400, 400, 1]} position={[0, -15, 0]} rotation-x={-Math.PI / 2} />
          <Lightformer form="circle" intensity={6} color="#FFD7A8" scale={14} position={SUN_POSITION} />
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
          minDistance={dive ? 0.2 : 12}
          enabled={!dive}
          maxDistance={95}
          maxPolarAngle={dive ? Math.PI / 1.9 : Math.PI / 2.15}
          autoRotate={autoRotate && !userTookControl && !selected && !dive}
          autoRotateSpeed={0.5}
          onStart={() => setUserTookControl(true)}
        />
        <FocusRig unit={selected ?? null} dive={dive} onDiveEnd={onDiveEnd} />
      </Canvas>
    </div>
  );
}

/** Whether an element is in (or within 100 px of) the viewport and the tab is visible. */
function useOnScreen() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => e && setInView(e.isIntersecting), { rootMargin: '100px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  useEffect(() => {
    const on = () => setPageVisible(document.visibilityState !== 'hidden');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return { ref: setEl, on: inView && pageVisible };
}

/** Instant placeholder while the model streams, and the fallback if it fails: masterplan + one box per unit. */
function ProceduralScene({ units, colorMode, selectedUnitId, hoveredUnitId, highlightIds, onSelect, onHover, shadows }: UnitPaintProps) {
  const boxes = useMemo(() => layoutUnits(units), [units]);
  useStaticShadows(shadows);
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
function FocusRig({ unit, dive, onDiveEnd }: { unit: Unit | null; dive: Dive | null; onDiveEnd?: () => void }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = size.height > 0 ? size.width / size.height : 0;
  const goal = useRef<{ target: Vector3; camera: Vector3; speed: number; done?: () => void } | null>(null);
  const key = dive ? `dive:${dive.target.join(',')}` : (unit?.id ?? 'home');
  const diveEnd = useRef(onDiveEnd);
  diveEnd.current = onDiveEnd;
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
    if (dive) {
      // A slower, eased approach that ends at the glass; the caller then cuts to the interior.
      goal.current = { target: new Vector3(...dive.target), camera: new Vector3(...dive.camera), speed: 2.4, done: () => diveEnd.current?.() };
    } else if (unit) {
      const t = new Vector3(...unitCenter(unit));
      // Approach from outside the tower, looking straight at the unit's corner.
      const [fx, fz] = unitFacing(unit);
      goal.current = { target: t, camera: t.clone().add(new Vector3(fx * 22, 7, fz * 22)), speed: 3.5 };
    } else {
      goal.current = { target: HOME_TARGET.clone(), camera: homeCamera(aspect || 1.4), speed: 3.5 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * g.speed);
    controls.target.lerp(g.target, k);
    camera.position.lerp(g.camera, k);
    controls.update();
    const near = g.done ? 0.3 : 0.05;
    if (camera.position.distanceTo(g.camera) < near && controls.target.distanceTo(g.target) < near) {
      goal.current = null;
      g.done?.();
    }
  });
  return null;
}
