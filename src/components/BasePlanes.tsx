import { useState } from 'react'
import { DoubleSide } from 'three'
import { useStore } from '../useStore'
import { Intersection } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { addSketchTo, Program } from '../lang/abstractSyntaxTree'

const opacity = 0.1

export const BasePlanes = () => {
  const [axisIndex, setAxisIndex] = useState<null | number>(null)
  const { setGuiMode, guiMode, ast, updateAst } = useStore(
    ({ guiMode, setGuiMode, ast, updateAst }) => ({
      guiMode,
      setGuiMode,
      ast,
      updateAst,
    })
  )

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

    let _ast: Program = ast
      ? ast
      : {
          type: 'Program',
          start: 0,
          end: 0,
          body: [],
        }
    const axis = axisIndex === 0 ? 'xy' : axisIndex === 1 ? 'xz' : 'yz'
    const { modifiedAst, id, pathToNode } = addSketchTo(_ast, axis)

    setGuiMode({
      mode: 'sketch',
      sketchMode: 'sketchEdit',
      axis,
      pathToNode,
    })

    updateAst(modifiedAst)
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
          <Text fontSize={1} color="#555" position={[1, 1, 0.01]} font={'/roboto.woff'}>
            {index === 0 ? 'xy' : index === 1 ? 'xz' : 'yz'}
          </Text>
          <Text fontSize={1} color="#555" position={[1, 1, -0.01]} font={'/roboto.woff'}>
            {index === 0 ? 'xy' : index === 1 ? 'xz' : 'yz'}
          </Text>
        </mesh>
      ))}
    </>
  )
}
