import { useState } from 'react'
import { DoubleSide } from 'three'
import { useStore } from '../useStore'
import { Intersection } from '@react-three/fiber'

const opacity = 0.1

export const BasePlanes = () => {
  const [axisIndex, setAxisIndex] = useState<null | number>(null)
  const { setGuiMode, guiMode } = useStore(({ guiMode, setGuiMode }) => ({
    guiMode,
    setGuiMode,
  }))

  const onPointerEvent = ({
    intersections,
  }: {
    intersections: Intersection[]
  }) => {
    if (!intersections.length) {
      setAxisIndex(null)
      return
    }
    let closestIntersection = intersections[0]
    intersections.forEach((intersection) => {
      if (intersection.distance < closestIntersection.distance)
        closestIntersection = intersection
    })
    const smallestIndex = Number(closestIntersection.eventObject.name)
    setAxisIndex(smallestIndex)
  }
  const onClick = () => {
    if (guiMode.mode !== 'sketch') {
      return null
    }
    if (guiMode.sketchMode !== 'selectFace') {
      return null
    }
    setGuiMode({
      mode: 'sketch',
      sketchMode: 'points',
      axis: axisIndex === 0 ? 'yz' : axisIndex === 1 ? 'xy' : 'xz',
    })
  }
  if (guiMode.mode !== 'sketch') {
    return null
  }
  if (guiMode.sketchMode !== 'selectFace') {
    return null
  }
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <mesh
          key={index}
          rotation-x={index === 1 ? -Math.PI / 2 : 0}
          rotation-y={index === 2 ? -Math.PI / 2 : 0}
          onPointerMove={onPointerEvent}
          onPointerOut={onPointerEvent}
          onClick={onClick}
          name={`${index}`}
        >
          <planeGeometry args={[5, 5]} />
          <meshStandardMaterial
            color="blue"
            side={DoubleSide}
            transparent
            opacity={opacity + (axisIndex === index ? 0.3 : 0)}
          />
        </mesh>
      ))}
    </>
  )
}
