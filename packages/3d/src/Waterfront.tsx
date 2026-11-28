'use client';

import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { PlaneGeometry, RepeatWrapping, ShaderMaterial, TextureLoader, Vector3 } from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';

/**
 * Golden-hour environment shared by every live view: one low sun over the sea (-z), a physically based
 * sky, and an animated, reflective lagoon that mirrors the towers. The land, beaches, marina and islands
 * come from the GLB (assets/models/source/build_tower.py); this file only draws sky and water.
 */

/** Direction towards the sun: low (~8 degrees) over the sea, a little to the left of the home view. */
export const SUN_DIR = new Vector3(-0.34, 0.14, -0.93).normalize();
/** Key light position (same direction as the sky's sun, far enough for the shadow camera). */
export const SUN_POSITION: [number, number, number] = SUN_DIR.clone().multiplyScalar(65).toArray() as [number, number, number];
/** Water surface height (three.js y). The GLB's beaches, pontoons and yachts are modelled around it. */
export const WATER_LEVEL = -0.4;
/** Haze colour: matches the sky just above the horizon, so distant water and land melt into it. */
export const HAZE = '#C9CED1';
export const WATER_NORMALS_URL = '/textures/water-normals.jpg';

const SKY = { turbidity: 5, rayleigh: 2.2, mieCoefficient: 0.005, mieDirectionalG: 0.88 } as const;
/**
 * three's Sky is calibrated for a tone-mapping exposure of ~0.5; the scene is lit for ~1.0. Scaling the sky's
 * own output keeps its blue gradient instead of clipping to white, without darkening the buildings.
 */
const SKY_GAIN = 0.52;

/** Sky dome. `distance` keeps the camera (<= ~100 units out) well inside the dome. */
export function GoldenSky({ distance = 1000 }: { distance?: number }) {
  const sky = useMemo(() => {
    const s = new Sky();
    const m = s.material as ShaderMaterial;
    const end = 'gl_FragColor = vec4( retColor, 1.0 );';
    if (m.fragmentShader.includes(end)) {
      m.fragmentShader = m.fragmentShader.replace('void main() {', 'uniform float skyGain;\n\t\tvoid main() {').replace(end, 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
      m.uniforms.skyGain = { value: SKY_GAIN };
    }
    m.uniforms.turbidity!.value = SKY.turbidity;
    m.uniforms.rayleigh!.value = SKY.rayleigh;
    m.uniforms.mieCoefficient!.value = SKY.mieCoefficient;
    m.uniforms.mieDirectionalG!.value = SKY.mieDirectionalG;
    (m.uniforms.sunPosition!.value as Vector3).copy(SUN_DIR);
    return s;
  }, []);
  useEffect(() => () => sky.material.dispose(), [sky]);
  return <primitive object={sky} scale={distance} />;
}

/**
 * Reflective lagoon (three's planar-mirror Water). Reflections are rendered at `resolution` px:
 * 512 on desktop, 256 on phones, which keeps the extra pass cheap.
 */
export function LagoonWater({ resolution = 512, url = WATER_NORMALS_URL }: { resolution?: number; url?: string }) {
  const normals = useLoader(TextureLoader, url);
  const water = useMemo(() => {
    normals.wrapS = normals.wrapT = RepeatWrapping;
    const w = new Water(new PlaneGeometry(2400, 2400), {
      textureWidth: resolution,
      textureHeight: resolution,
      waterNormals: normals,
      sunDirection: SUN_DIR.clone(),
      sunColor: 0xffd7a8,
      waterColor: 0x0e4653,
      distortionScale: 1.6,
      fog: true,
      alpha: 1,
    });
    w.rotation.x = -Math.PI / 2;
    w.position.y = WATER_LEVEL;
    w.material.uniforms.size!.value = 3.2; // ripple scale: fine near the quay, calm towards the horizon
    w.receiveShadow = false;
    w.name = 'Lagoon';
    return w;
  }, [normals, resolution]);

  useEffect(
    () => () => {
      water.geometry.dispose();
      water.material.dispose();
    },
    [water],
  );

  useFrame((_, dt) => {
    water.material.uniforms.time!.value += dt * 0.3;
  });

  return <primitive object={water} />;
}
