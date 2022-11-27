import { useStore } from '../useStore'

export const SketchPlane = () => {
  const { setGuiMode, guiMode } = useStore(({ guiMode, setGuiMode }) => ({
    guiMode,
    setGuiMode,
  }))
  if (guiMode.mode !== 'sketch') {
    return null
  }
  if (guiMode.sketchMode !== 'points') {
    return null
  }

  const ninty = Math.PI / 2
  const rotation: [number, number, number] = [0, 0, 0]
  if (guiMode.axis === 'yz') {
    rotation[0] = ninty
  } else if (guiMode.axis === 'xy') {
    rotation[1] = ninty
  } else if (guiMode.axis === 'xz') {
    rotation[2] = ninty
  }
  return <gridHelper args={[30, 40, 'blue', 'hotpink']} rotation={rotation} />
}
