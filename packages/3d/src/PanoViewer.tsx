'use client';

import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { type Mesh, type MeshBasicMaterial, type PerspectiveCamera, SRGBColorSpace, type Texture, TextureLoader, Vector3 } from 'three';

/**
 * Equirectangular panorama viewer (the 360° tours).
 *
 * Bearings are degrees in the plan, 0 = straight ahead in the image centre, +90 = a quarter turn to the left
 * (the plan's +x, see the tour data). Drag / swipe to look around, wheel / pinch to zoom, arrow keys too.
 * A new `src` cross-fades in while the camera eases a little forward, like taking a step.
 */
export interface PanoHotspot {
  id: string;
  /** Bearing from the current stop, degrees. */
  bearing: number;
  /** Floor distance in metres (places the marker on the floor). */
  distance: number;
  label: ReactNode;
}

export interface PanoViewerProps {
  src: string;
  /** Where to face when `src` changes (degrees, bearing); the camera turns there during the cross-fade. */
  yaw?: number;
  hotspots?: PanoHotspot[];
  onHotspot?: (id: string) => void;
  /** Current view direction (degrees, bearing) and horizontal field of view, throttled to visible changes. */
  onView?: (yaw: number, hfov: number) => void;
  /** Fires once the first panorama is on screen. */
  onReady?: () => void;
  /** A panorama failed to load. */
  onError?: (src: string) => void;
  /** Neighbouring panoramas to fetch in the background (HTTP cache only; uploaded when shown). */
  preload?: string[];
  eyeHeight?: number;
  reducedMotion?: boolean;
  className?: string;
}

const R = 60;
const DEG = Math.PI / 180;
const cache = new Map<string, Promise<Texture>>();
const loader = new TextureLoader();

function loadPano(url: string, maxAniso: number): Promise<Texture> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = Math.min(8, maxAniso);
      return tex;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
    // Keep GPU memory bounded: only the panorama on screen and the one fading out stay uploaded.
    while (cache.size > 3) {
      const [oldUrl, oldP] = cache.entries().next().value as [string, Promise<Texture>];
      cache.delete(oldUrl);
      oldP.then((t) => setTimeout(() => t.dispose(), 2000)).catch(() => undefined);
    }
  }
  return p;
}

/** Direction for a bearing (degrees) and a downward pitch (radians), in the viewer's frame. */
function dir(bearing: number, down: number) {
  const b = bearing * DEG;
  return new Vector3(-Math.sin(b) * Math.cos(down), -Math.sin(down), -Math.cos(b) * Math.cos(down));
}

export function PanoViewer({ className, ...props }: PanoViewerProps) {
  return (
    <div className={className} style={{ touchAction: 'none', cursor: 'grab' }}>
      <Canvas
        camera={{ fov: 75, near: 0.05, far: 200, position: [0, 0, 0] }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        flat
        onCreated={({ gl }) => gl.setClearColor('#0B1622')}
      >
        <Pano {...props} />
      </Canvas>
    </div>
  );
}

function Pano({ src, yaw = 0, hotspots = [], onHotspot, onView, onReady, onError, preload = [], eyeHeight = 1.55, reducedMotion = false }: Omit<PanoViewerProps, 'className'>) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const back = useRef<Mesh>(null);
  const front = useRef<Mesh>(null);
  const [shown, setShown] = useState<string | null>(null);
  const fade = useRef(1);
  const view = useRef<ViewState>({ yaw, pitch: -4 * DEG, fov: 75, vy: 0, vp: 0, step: 0, goal: null });
  const lastReport = useRef({ yaw: NaN, fov: NaN });
  const ready = useRef(false);
  const maxAniso = gl.capabilities.getMaxAnisotropy();

  // Swap panoramas: the new one fades in on the inner sphere, then becomes the backdrop.
  useEffect(() => {
    let live = true;
    loadPano(src, maxAniso).then(
      (tex) => {
        if (!live) return;
        const f = front.current?.material as MeshBasicMaterial | undefined;
        const b = back.current?.material as MeshBasicMaterial | undefined;
        if (!f || !b) return;
        if (b.map) {
          f.map = tex;
          f.needsUpdate = true;
          fade.current = reducedMotion ? 1 : 0;
          view.current.step = reducedMotion ? 0 : 1;
        } else {
          b.map = tex;
          b.needsUpdate = true;
          fade.current = 1;
        }
        const v = view.current;
        v.vy = v.vp = 0;
        if (b.map === tex) v.yaw = yaw;
        else v.goal = v.yaw + ((((yaw - v.yaw) % 360) + 540) % 360) - 180; // shortest way round
        setShown(src);
        if (!ready.current) {
          ready.current = true;
          onReady?.();
        }
      },
      () => {
        if (live) onError?.(src);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const t = setTimeout(() => {
      for (const u of preload) {
        const img = new Image();
        img.decoding = 'async';
        img.src = u;
      }
    }, 800);
    return () => clearTimeout(t);
  }, [preload]);

  useControls(view);

  useFrame((_, dt) => {
    const v = view.current;
    // Inertia after a flick.
    if (Math.abs(v.vy) > 1e-4 || Math.abs(v.vp) > 1e-4) {
      v.yaw += v.vy * dt * 60;
      v.pitch += v.vp * dt * 60;
      const k = Math.exp(-dt * 6);
      v.vy *= k;
      v.vp *= k;
    }
    if (v.goal !== null) {
      const d = v.goal - v.yaw;
      v.yaw += d * (1 - Math.exp(-dt * 4.5));
      v.pitch *= Math.exp(-dt * 3);
      if (Math.abs(d) < 0.2) v.goal = null;
    }
    v.pitch = Math.max(-85 * DEG, Math.min(85 * DEG, v.pitch));
    // Cross-fade + a slight forward "step".
    const f = front.current?.material as MeshBasicMaterial | undefined;
    const b = back.current?.material as MeshBasicMaterial | undefined;
    if (f && b && fade.current < 1) {
      fade.current = Math.min(1, fade.current + dt / 0.7);
      f.opacity = fade.current;
      if (fade.current >= 1) {
        b.map = f.map;
        b.needsUpdate = true;
        f.opacity = 0;
      }
    } else if (f && f.opacity !== 0 && fade.current >= 1) {
      f.opacity = 0;
    }
    v.step = Math.max(0, v.step - dt / 0.9);
    const ease = v.step * v.step;
    const fov = v.fov * (1 - 0.16 * ease);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.rotation.set(v.pitch, v.yaw * DEG, 0, 'YXZ');
    const hfov = (2 * Math.atan(Math.tan((fov * DEG) / 2) * (size.width / Math.max(1, size.height)))) / DEG;
    const last = lastReport.current;
    if (onView && (!(Math.abs(last.yaw - v.yaw) < 0.5) || !(Math.abs(last.fov - hfov) < 0.5))) {
      last.yaw = v.yaw;
      last.fov = hfov;
      onView(((v.yaw % 360) + 540) % 360 - 180, hfov);
    }
  });

  const spots = useMemo(
    () =>
      hotspots.map((h) => {
        const d = Math.max(0.8, h.distance);
        const down = Math.atan2(eyeHeight, d);
        return { ...h, pos: dir(h.bearing, down).multiplyScalar(Math.hypot(d, eyeHeight)) };
      }),
    [hotspots, eyeHeight],
  );

  return (
    <>
      {/* Inside-out spheres: mirrored on x so the image reads correctly from the centre, turned so u = 0.5 faces -z. */}
      <mesh ref={back} scale={[-1, 1, 1]} rotation={[0, -Math.PI / 2, 0]} renderOrder={0}>
        <sphereGeometry args={[R, 96, 48]} />
        <meshBasicMaterial side={2} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={front} scale={[-1, 1, 1]} rotation={[0, -Math.PI / 2, 0]} renderOrder={1}>
        <sphereGeometry args={[R * 0.98, 96, 48]} />
        <meshBasicMaterial side={2} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {shown === src &&
        spots.map((h) => (
          <group key={h.id} position={h.pos}>
            <Html center zIndexRange={[20, 0]}>
              <button
                type="button"
                onClick={() => onHotspot?.(h.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className="pano-spot"
              >
                <span className="pano-spot-ring" aria-hidden />
                <span className="pano-spot-label">{h.label}</span>
              </button>
            </Html>
          </group>
        ))}
    </>
  );
}

type ViewState = { yaw: number; pitch: number; fov: number; vy: number; vp: number; step: number; goal: number | null };

/** Pointer drag (with inertia), pinch and wheel zoom, arrow keys. */
function useControls(view: RefObject<ViewState>) {
  const el = useThree((s) => s.gl.domElement);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const target = el.parentElement ?? el;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let last = { x: 0, y: 0, t: 0 };
    const perPx = () => view.current.fov / Math.max(1, size.height);

    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      target.setPointerCapture?.(e.pointerId);
      view.current.vy = view.current.vp = 0;
      view.current.goal = null;
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      (target as HTMLElement).style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) view.current.fov = clampFov(view.current.fov * (pinch / d));
        pinch = d;
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const k = perPx();
      view.current.yaw += dx * k;
      view.current.pitch += dy * k * DEG;
      const now = performance.now();
      const dt = Math.max(1, now - last.t);
      view.current.vy = ((dx * k) / dt) * 16;
      view.current.vp = ((dy * k * DEG) / dt) * 16;
      last = { x: e.clientX, y: e.clientY, t: now };
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (performance.now() - last.t > 80) view.current.vy = view.current.vp = 0;
      (target as HTMLElement).style.cursor = 'grab';
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.fov = clampFov(view.current.fov * Math.exp(e.deltaY * 0.001));
    };
    const key = (e: KeyboardEvent) => {
      const step = 6;
      if (e.key === 'ArrowLeft') view.current.yaw += step;
      else if (e.key === 'ArrowRight') view.current.yaw -= step;
      else if (e.key === 'ArrowUp') view.current.pitch += step * DEG;
      else if (e.key === 'ArrowDown') view.current.pitch -= step * DEG;
      else if (e.key === '+' || e.key === '=') view.current.fov = clampFov(view.current.fov - 6);
      else if (e.key === '-') view.current.fov = clampFov(view.current.fov + 6);
      else return;
      e.preventDefault();
    };
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, [el, size.height, view]);
}

const clampFov = (f: number) => Math.max(35, Math.min(95, f));
