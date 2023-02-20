import { useStore } from '../useStore'
import { DoubleSide, Vector3, Quaternion } from 'three'
import { Program } from '../lang/abstractSyntaxTree'
import { toolTipModification } from '../lang/std/sketch'
import { roundOff } from '../lib/utils'

export const SketchPlane = () => {
  const { ast, guiMode, updateAst, programMemory } = useStore((s) => ({
    guiMode: s.guiMode,
    ast: s.ast,
    updateAst: s.updateAst,
    programMemory: s.programMemory,
  }))
  if (guiMode.mode !== 'sketch') {
    return null
  }
  if (!(guiMode.sketchMode === 'sketchEdit') && !('isTooltip' in guiMode)) {
    return null
  }

  const sketchGridName = 'sketchGrid'

  let clickDetectQuaternion = new Quaternion(...guiMode.rotation)

  let temp = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    Math.PI / 2
  )
  let position = guiMode.position
  const gridQuaternion = new Quaternion().multiplyQuaternions(
    new Quaternion(...guiMode.rotation),
    temp
  )

  return (
    <>
      <mesh
        quaternion={clickDetectQuaternion}
        position={position}
        name={sketchGridName}
        onClick={(e) => {
          if (!('isTooltip' in guiMode)) {
            return
          }
          const sketchGridIntersection = e.intersections.find(
            ({ object }) => object.name === sketchGridName
          )
          const inverseQuaternion = clickDetectQuaternion.clone().invert()
          let transformedPoint = sketchGridIntersection?.point.clone()
          if (transformedPoint) {
            transformedPoint.applyQuaternion(inverseQuaternion)
            transformedPoint?.sub(
              new Vector3(...position).applyQuaternion(inverseQuaternion)
            )
          }

          const point = roundy(transformedPoint)
          let _ast: Program = ast
            ? ast
            : {
                type: 'Program',
                start: 0,
                end: 0,
                body: [],
                nonCodeMeta: {},
              }
          const addLinePoint: [number, number] = [point.x, point.y]
          const { modifiedAst } = toolTipModification(
            _ast,
            programMemory,
            addLinePoint,
            guiMode
          )
          updateAst(modifiedAst)
        }}
      >
        <planeGeometry args={[30, 40]} />
        <meshStandardMaterial
          color="blue"
          side={DoubleSide}
          opacity={0}
          transparent
        />
      </mesh>
      <gridHelper
        args={[30, 40, 'blue', 'hotpink']}
        quaternion={gridQuaternion}
        position={position}
      />
    </>
  )
}

function roundy({ x, y, z }: any) {
  return {
    x: roundOff(x, 2),
    y: roundOff(y, 2),
    z: roundOff(z, 2),
  }
}
