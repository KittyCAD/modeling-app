export const AxisIndicator = () => (
  <>
    <mesh position={[0.5, 0, 0]}>
      <boxBufferGeometry args={[1, 0.05, 0.05]} />
      <meshStandardMaterial color="red" />
    </mesh>
    <mesh position={[0, 0.5, 0]}>
      <boxBufferGeometry args={[0.05, 1, 0.05]} />
      <meshStandardMaterial color="blue" />
    </mesh>
    <mesh position={[0, 0, 0.5]}>
      <boxBufferGeometry args={[0.05, 0.05, 1]} />
      <meshStandardMaterial color="green" />
    </mesh>
  </>
)
