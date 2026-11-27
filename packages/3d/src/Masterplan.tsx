'use client';

/**
 * Procedural masterplan: the instant placeholder while the glTF streams in, and the
 * fallback if it fails to load. Kept in the same coordinates as the model.
 */
export function Masterplan() {
  return (
    <group>
      {/* plot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#E9DFCC" />
      </mesh>
      {/* access road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 16]}>
        <planeGeometry args={[90, 5]} />
        <meshStandardMaterial color="#9AA3AF" />
      </mesh>
      {/* podiums */}
      {[-8, 8].map((x) => (
        <mesh key={x} position={[x, 1, 0]}>
          <boxGeometry args={[11, 2, 11]} />
          <meshStandardMaterial color="#D8CCB4" />
        </mesh>
      ))}
      {/* pool deck */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, -10]}>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color="#38BDF8" />
      </mesh>
      {/* park */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-22, 0.02, -6]}>
        <circleGeometry args={[8, 40]} />
        <meshStandardMaterial color="#86C28B" />
      </mesh>
      {[[-24, -8], [-19, -3], [-21, -10], [-26, -4]].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x!, 1.2, z!]}>
          <coneGeometry args={[1, 2.6, 8]} />
          <meshStandardMaterial color="#3F8F4E" />
        </mesh>
      ))}
    </group>
  );
}
